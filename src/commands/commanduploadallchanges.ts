import { readFile } from "fs-extra";
import * as path from "path";
import * as vscode from "vscode";
import { configManager } from "../modules/config";
import { GetRemotePathWithMapping } from "../modules/file";
import { gitManager } from "../modules/gitmanager";
import { loadMesFileService, saveMesFileService } from "../miiservice/mesfileservice";
import { readFileService } from "../miiservice/readfileservice";
import { saveFileService } from "../miiservice/savefileservice";
import { IsFatalResponse } from "../miiservice/abstract/filters";
import { localProjectsTree, LocalProjectTreeItem, ModifiedFile, FileStatus } from "../ui/treeview/localprojectstree";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isCatalogPath(remotePath: string) {
    return !remotePath.includes('/WEB/');
}

function gitTs() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function uploadFile(localFilePath: string, remotePath: string, content: string): Promise<boolean> {
    const system = configManager.CurrentSystem;
    if (isCatalogPath(remotePath)) {
        return saveMesFileService.call(system, remotePath, content);
    }
    const base64 = encodeURIComponent(Buffer.from(content).toString("base64"));
    const response = await saveFileService.call({ ...system, body: "Content=" + base64 }, remotePath);
    return response != null;
}

async function downloadFromServer(remotePath: string): Promise<string | null> {
    const system = configManager.CurrentSystem;
    if (isCatalogPath(remotePath)) {
        return loadMesFileService.call(system, remotePath);
    }
    const response = await readFileService.call(system, remotePath);
    if (!response || IsFatalResponse(response)) return null;
    const payload = (response as any)?.Rowsets?.Rowset?.Row?.find((r: any) => r.Name === "Payload");
    if (!payload) return null;
    return Buffer.from(payload.Value, "base64").toString("utf8");
}

async function getFilesToUpload(item: LocalProjectTreeItem): Promise<{ project: any; files: ModifiedFile[] } | null> {
    const project = item.project;
    if (!project) return null;

    // Use git status as source of truth if available
    const hasGit = await gitManager.isGitRepo(project.localPath);
    if (hasGit) {
        const gitFiles = await gitManager.getStatus(project.localPath);
        const files: ModifiedFile[] = gitFiles
            .filter(f => f.status !== 'deleted')
            .map(f => ({
                fileName: path.basename(f.filePath),
                filePath: f.filePath,
                relativePath: path.relative(project.localPath, f.filePath),
                lastModified: new Date(),
                hasLocalChanges: true,
                status: f.status === 'added' ? FileStatus.Added : FileStatus.Modified,
            }));
        return { project, files };
    }

    // Fallback: use the modified files from the tree
    const files = project.modifiedFiles.filter(f => f.status !== FileStatus.Deleted);
    return { project, files };
}

function buildConfirmDetail(files: ModifiedFile[], projectName: string): string {
    const lines = files.slice(0, 8).map(f =>
        `  [${f.status}] ${f.relativePath.replace(/\\/g, '/')}`
    );
    if (files.length > 8) lines.push(`  ... e mais ${files.length - 8} arquivo(s)`);
    return `Projeto: ${projectName}\n\n${lines.join('\n')}`;
}

// ─── Upload all ───────────────────────────────────────────────────────────────

export async function OnCommandUploadAllChanges(item: LocalProjectTreeItem) {
    const userConfig = await configManager.load();
    if (!userConfig) { vscode.window.showErrorMessage("Configuração não encontrada."); return; }

    const result = await getFilesToUpload(item);
    if (!result || result.files.length === 0) {
        vscode.window.showInformationMessage("Nenhum arquivo modificado para enviar.");
        return;
    }
    const { project, files } = result;

    const confirm = await vscode.window.showInformationMessage(
        `Enviar ${files.length} arquivo(s) de "${project.name}"?`,
        { modal: true, detail: buildConfirmDetail(files, project.name) },
        "Enviar tudo", "Cancelar"
    );
    if (confirm !== "Enviar tudo") return;

    const uploaded: string[] = [];
    const failed: string[] = [];

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Enviando "${project.name}"...`, cancellable: false },
        async (progress) => {
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                progress.report({ message: `${i + 1}/${files.length}: ${f.fileName}` });
                try {
                    const remotePath = await GetRemotePathWithMapping(f.filePath, userConfig);
                    const content = (await readFile(f.filePath)).toString();
                    const ok = await uploadFile(f.filePath, remotePath, content);
                    if (ok) uploaded.push(f.filePath);
                    else failed.push(f.fileName);
                } catch (e) {
                    failed.push(f.fileName);
                    console.error(`[UploadAll] erro em ${f.fileName}:`, e);
                }
            }
        }
    );

    const summary = failed.length === 0
        ? `✅ ${uploaded.length} arquivo(s) enviado(s) com sucesso.`
        : `⚠️ ${uploaded.length} enviado(s), ${failed.length} falharam: ${failed.join(', ')}`;
    vscode.window.showInformationMessage(summary);

    // Git: offer a single batch commit
    if (uploaded.length > 0) {
        await offerBatchGitCommit(project.localPath, uploaded, configManager.CurrentSystem?.name ?? 'servidor');
    }

    localProjectsTree.refresh();
}

// ─── Upload all with backup ───────────────────────────────────────────────────

export async function OnCommandUploadAllChangesWithBkp(item: LocalProjectTreeItem) {
    const userConfig = await configManager.load();
    if (!userConfig) { vscode.window.showErrorMessage("Configuração não encontrada."); return; }

    const result = await getFilesToUpload(item);
    if (!result || result.files.length === 0) {
        vscode.window.showInformationMessage("Nenhum arquivo modificado para enviar.");
        return;
    }
    const { project, files } = result;

    const confirm = await vscode.window.showInformationMessage(
        `Enviar ${files.length} arquivo(s) de "${project.name}" com backup do servidor?`,
        {
            modal: true,
            detail: buildConfirmDetail(files, project.name) +
                '\n\nCada arquivo terá uma cópia de segurança criada no servidor antes de ser substituído.'
        },
        "Enviar tudo com backup", "Cancelar"
    );
    if (confirm !== "Enviar tudo com backup") return;

    const uploaded: string[] = [];
    const failed: string[] = [];

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Enviando "${project.name}" com backup...`, cancellable: false },
        async (progress) => {
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                progress.report({ message: `${i + 1}/${files.length}: ${f.fileName}` });
                try {
                    const remotePath = await GetRemotePathWithMapping(f.filePath, userConfig);
                    const localContent = (await readFile(f.filePath)).toString();

                    // 1. Download server version
                    const serverContent = await downloadFromServer(remotePath);

                    // 2. Upload backup
                    if (serverContent != null) {
                        const ext = path.extname(f.fileName);
                        const nameNoExt = path.basename(f.fileName, ext);
                        const d = new Date();
                        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                        const timeStr = `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
                        const bkpRemotePath = path.posix.join(
                            path.posix.dirname(remotePath),
                            `${nameNoExt}_BKP_${dateStr}_${timeStr}${ext}`
                        );
                        await uploadFile(f.filePath, bkpRemotePath, serverContent);
                    }

                    // 3. Upload local version
                    const ok = await uploadFile(f.filePath, remotePath, localContent);
                    if (ok) uploaded.push(f.filePath);
                    else failed.push(f.fileName);
                } catch (e) {
                    failed.push(f.fileName);
                    console.error(`[UploadAllBkp] erro em ${f.fileName}:`, e);
                }
            }
        }
    );

    const summary = failed.length === 0
        ? `✅ ${uploaded.length} arquivo(s) enviado(s) com backup.`
        : `⚠️ ${uploaded.length} enviado(s), ${failed.length} falharam: ${failed.join(', ')}`;
    vscode.window.showInformationMessage(summary);

    if (uploaded.length > 0) {
        await offerBatchGitCommit(project.localPath, uploaded, configManager.CurrentSystem?.name ?? 'servidor');
    }

    localProjectsTree.refresh();
}

// ─── Git batch commit ─────────────────────────────────────────────────────────

async function offerBatchGitCommit(projectPath: string, uploadedFiles: string[], serverName: string) {
    if (!(await gitManager.isInstalled())) return;

    const hasGit = await gitManager.isGitRepo(projectPath);
    if (!hasGit) return;

    const cfg = vscode.workspace.getConfiguration('miisync.settings');
    const mode = cfg.get<string>('gitCommitOnUpload', 'ask');
    if (mode === 'disabled') return;

    let doCommit = mode === 'always';
    if (!doCommit) {
        const last = cfg.get<boolean | undefined>('lastUploadGitChoice', undefined);
        const yesLabel = last === true ? '✓ Registrar (lembrado)' : `Registrar ${uploadedFiles.length} arquivo(s) no git`;
        const noLabel  = last === false ? '✓ Não (lembrado)' : 'Não';
        const buttons = last === false
            ? [noLabel, yesLabel, 'Sempre', 'Nunca mais']
            : [yesLabel, noLabel, 'Sempre', 'Nunca mais'];

        const pick = await vscode.window.showInformationMessage(
            `Criar commit de batch upload?`,
            { modal: false },
            ...buttons
        );
        if (!pick) return;
        if (pick === 'Sempre')     { cfg.update('gitCommitOnUpload', 'always',   vscode.ConfigurationTarget.Global); doCommit = true; }
        else if (pick === 'Nunca mais') { cfg.update('gitCommitOnUpload', 'disabled', vscode.ConfigurationTarget.Global); return; }
        else {
            doCommit = pick.includes('Registrar') || (pick.includes('lembrado') && last === true);
            cfg.update('lastUploadGitChoice', doCommit, vscode.ConfigurationTarget.Global);
        }
    }

    if (!doCommit) return;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Git: registrando uploads...', cancellable: false },
        async () => {
            const message = `upload: ${uploadedFiles.length} arquivo(s) → ${serverName} — ${gitTs()}`;
            await gitManager.addAndCommit(projectPath, message, uploadedFiles);
        }
    );
}
