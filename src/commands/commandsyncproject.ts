import * as fs from "fs-extra";
import * as path from "path";
import * as vscode from "vscode";
import { System, UserConfig } from "../extension/system";
import { File, Folder } from "../miiservice/abstract/responsetypes";
import { configManager } from "../modules/config";
import { gitManager } from "../modules/gitmanager";
import { CheckSeverity, SeverityOperation } from "../modules/severity";
import { Validate } from "../transfer/gate";
import { UploadFile } from "../transfer/upload";
import { DownloadComplexLimited } from "../transfer/limited/downloadcomplex";
import { localProjectsTree } from "../ui/treeview/localprojectstree";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resolveRemotePath(projectPath: string, projectItem: any): Promise<string | null> {
  if (projectItem?.project?.remotePath) return projectItem.project.remotePath;
  if (projectItem?.remotePath) return projectItem.remotePath;
  const proj = localProjectsTree.getProjects().find((p) => p.localPath === projectPath);
  if (proj?.remotePath) return proj.remotePath;
  try {
    const f = path.join(projectPath, ".miisync", "path-mapping.json");
    if (await fs.pathExists(f)) {
      const d = await fs.readJson(f);
      if (d.rootRemotePath) return d.rootRemotePath;
      if (d.mappings?.[0]?.remotePath)
        return path.posix.dirname(d.mappings[0].remotePath.replace(/\\/g, "/"));
    }
  } catch {}
  return null;
}

/**
 * Copies all contents of src into dest (overwrite), skipping .git in dest.
 * Then removes files/dirs in dest that don't exist in src (except .git).
 */
async function inPlaceOverwrite(src: string, dest: string): Promise<void> {
  // 1. Copy everything from src → dest
  await fs.copy(src, dest, {
    overwrite: true,
    filter: (srcPath: string) => {
      const rel = path.relative(src, srcPath);
      // Never overwrite git-related local files from the server download
      return rel !== '.git' && !rel.startsWith('.git' + path.sep)
          && rel !== '.gitignore';
    },
  });

  // 2. Delete entries in dest that are not in src (preserve .git)
  await removeExtras(dest, src);
}

async function removeExtras(destDir: string, srcDir: string): Promise<void> {
  let destEntries: fs.Dirent[];
  try { destEntries = await fs.readdir(destDir, { withFileTypes: true }); }
  catch { return; }

  // Files that live only locally and must never be deleted during sync
  const PRESERVE = new Set(['.git', '.gitignore']);

  for (const entry of destEntries) {
    if (PRESERVE.has(entry.name)) continue;

    const destPath = path.join(destDir, entry.name);
    const srcPath  = path.join(srcDir,  entry.name);
    const existsInSrc = await fs.pathExists(srcPath);

    if (!existsInSrc) {
      await fs.remove(destPath).catch(() => {});
    } else if (entry.isDirectory()) {
      await removeExtras(destPath, srcPath);
    }
  }
}

// ─── Pre-sync git check ───────────────────────────────────────────────────────

type PreSyncAction = 'commit' | 'commit-upload' | 'ignore' | 'cancel';

async function handlePreSyncChanges(projectPath: string): Promise<PreSyncAction> {
  const changes = await gitManager.getStatus(projectPath);
  if (changes.length === 0) return 'ignore'; // nothing to handle

  const fileList = changes
    .slice(0, 5)
    .map(c => `  [${c.status[0].toUpperCase()}] ${path.relative(projectPath, c.filePath).replace(/\\/g, '/')}`)
    .join('\n') + (changes.length > 5 ? `\n  ... e mais ${changes.length - 5} arquivo(s)` : '');

  const pick = await vscode.window.showWarningMessage(
    `${changes.length} alteração(ões) local(is) não commitada(s)`,
    {
      modal: true,
      detail:
        `O sync vai sobrescrever esses arquivos com a versão do servidor.\n\n` +
        `${fileList}\n\n` +
        `O que deseja fazer?`,
    },
    'Salvar em git',
    'Salvar em git + subir ao servidor',
    'Ignorar (perder alterações)',
    'Cancelar'
  );

  if (!pick || pick === 'Cancelar') return 'cancel';
  if (pick === 'Salvar em git') return 'commit';
  if (pick === 'Salvar em git + subir ao servidor') return 'commit-upload';
  return 'ignore';
}

async function commitPreSync(projectPath: string): Promise<void> {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  await gitManager.addAndCommit(projectPath, `pre-sync: alterações locais salvas — ${dateStr}`);
}

async function uploadChangesToServer(
  projectPath: string,
  userConfig: UserConfig,
  system: System
): Promise<void> {
  const changes = await gitManager.getStatus(projectPath);
  const toUpload = changes.filter(c => c.status !== 'deleted');
  if (toUpload.length === 0) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Enviando ${toUpload.length} arquivo(s) ao servidor...`, cancellable: false },
    async (progress) => {
      let done = 0;
      for (const f of toUpload) {
        progress.report({ message: `${++done}/${toUpload.length}: ${path.basename(f.filePath)}` });
        await UploadFile(vscode.Uri.file(f.filePath), userConfig, system);
      }
    }
  );
}

// ─── Main command ─────────────────────────────────────────────────────────────

export async function OnCommandSyncProject(projectItem: any) {
  try {
    const projectPath: string =
      projectItem?.fullPath ||
      projectItem?.projectPath ||
      projectItem?.localPath ||
      projectItem;

    if (!projectPath || typeof projectPath !== "string") {
      vscode.window.showErrorMessage("Caminho do projeto inválido para sincronização.");
      return;
    }

    const projectName = path.basename(projectPath);
    const userConfig = await configManager.load();
    if (!userConfig) { vscode.window.showErrorMessage("Configuração não encontrada."); return; }
    const system = configManager.CurrentSystem as System;

    const remotePath = await resolveRemotePath(projectPath, projectItem);
    if (!remotePath || remotePath === "/") {
      vscode.window.showErrorMessage("Não foi possível determinar o caminho remoto do projeto.");
      return;
    }

    const gitInstalled = await gitManager.isInstalled();
    const hasGit = gitInstalled && await gitManager.isGitRepo(projectPath);

    // ── 1. Pre-sync: handle uncommitted changes ───────────────────────────────
    if (hasGit) {
      const preAction = await handlePreSyncChanges(projectPath);
      if (preAction === 'cancel') return;

      if (preAction === 'commit' || preAction === 'commit-upload') {
        await commitPreSync(projectPath);
        vscode.window.showInformationMessage('Alterações salvas no git.');
      }
      if (preAction === 'commit-upload') {
        await uploadChangesToServer(projectPath, userConfig, system);
      }
    }

    // ── 2. Confirmation with git choice inline ───────────────────────────────
    const syncChoice = await vscode.window.showInformationMessage(
      `Sincronizar "${projectName}"?`,
      {
        modal: true,
        detail: `Todos os arquivos locais serão atualizados com a versão do servidor.\nCaminho remoto: ${remotePath}`,
      },
      ...(gitInstalled ? ['Sync com git', 'Sync sem git'] : ['Sincronizar']),
      'Cancelar'
    );
    if (!syncChoice || syncChoice === 'Cancelar') return;
    const syncWithGit = syncChoice === 'Sync com git';

    // ── 3. Download to temp ───────────────────────────────────────────────────
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) { vscode.window.showErrorMessage("Workspace não encontrado."); return; }

    const tempFolder = path.join(workspaceFolder, `.__miisync_sync_temp_${Date.now()}_${projectName}`);
    let downloadOk = false;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Sincronizando "${projectName}"...`, cancellable: false },
      async (progress) => {
        try {
          if (!(await Validate(userConfig as UserConfig, { system }))) return;

          const folder = { files: [], folders: [], path: remotePath, isRemotePath: true } as any;
          if (!(await CheckSeverity(folder, SeverityOperation.download, userConfig as UserConfig, system))) return;

          function getPath(item: File | Folder) {
            if ("FolderName" in item) {
              const rel = path.relative(remotePath, item.Path);
              return tempFolder + path.sep + (rel !== "" ? rel : "");
            }
            const rel = path.relative(remotePath, item.FilePath);
            return tempFolder + path.sep + (rel !== "" ? rel + path.sep : "") + item.ObjectName;
          }

          progress.report({ message: "Baixando arquivos do servidor..." });
          const response = await DownloadComplexLimited(folder, getPath, userConfig as UserConfig, system);
          downloadOk = !response.aborted;
        } catch (err) {
          console.error("Erro no sync download:", err);
        }
      }
    );

    if (!downloadOk) {
      vscode.window.showErrorMessage(`Falha ao baixar "${projectName}" do servidor.`);
      await fs.remove(tempFolder).catch(() => {});
      return;
    }

    // ── 4. In-place overwrite (avoids EPERM from directory rename on Windows) ─
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Aplicando sync em "${projectName}"...`, cancellable: false },
      async () => {
        try {
          await fs.ensureDir(projectPath);
          await inPlaceOverwrite(tempFolder, projectPath);

          // Fix rootLocalPath stored in the new mapping file
          const mappingFile = path.join(projectPath, ".miisync", "path-mapping.json");
          if (await fs.pathExists(mappingFile)) {
            const data = await fs.readJson(mappingFile);
            data.rootLocalPath = projectPath;
            await fs.writeJson(mappingFile, data, { spaces: 2 });
          }

          await fs.remove(tempFolder).catch(() => {});
        } catch (err) {
          vscode.window.showErrorMessage(`Falha ao aplicar sync: ${err}`);
        }
      }
    );

    // ── 5. Git commit (if chosen) ─────────────────────────────────────────────
    if (syncWithGit && gitInstalled) {
      if (hasGit) {
        await gitManager.commitSync(projectPath);
      } else {
        await gitManager.initRepo(projectPath);
      }
    }

    vscode.window.showInformationMessage(`"${projectName}" sincronizado.`);
    vscode.commands.executeCommand("miisync.refreshprojects");
    vscode.commands.executeCommand("miisync.refreshlocalprojects");

  } catch (error) {
    vscode.window.showErrorMessage(`Erro ao sincronizar: ${error}`);
  }
}
