import * as path from 'path';
import * as vscode from 'vscode';
import { loadMesFileService, saveMesFileService } from '../miiservice/mesfileservice';
import { configManager } from '../modules/config';
import { trxTempFiles } from '../modules/trxtempfiles';
import { DownloadRemoteFolderAsProject } from '../transfer/download';
import logger from '../ui/logger';
import statusBar, { Icon } from '../ui/statusbar';
import { trxDirectoryTree, TrxItem } from '../ui/treeview/trxexplorer';

export async function OnCommandTrxSetRootPath() {
    const current = trxDirectoryTree.getRootPath();
    const input = await vscode.window.showInputBox({
        title: 'TRX & Queries — Caminho Raiz',
        prompt: 'Digite o caminho da pasta raiz no servidor',
        value: current,
        placeHolder: 'MES'
    });
    if (input !== undefined) {
        trxDirectoryTree.setRootPath(input.trim() || 'MES');
    }
}

export function OnCommandTrxRefresh() {
    trxDirectoryTree.refresh();
}

/**
 * Abre um arquivo diretamente do servidor em um arquivo temporário local.
 * Nenhum download permanente é feito — apenas um arquivo temp para edição.
 */
export async function OnCommandTrxOpenFile(item: TrxItem) {
    const system = configManager.CurrentSystem;
    if (!system || !item.fileData) return;

    const remotePath = item.remotePath;
    const fileName = item.fileData.name;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Abrindo ${fileName} do servidor...`,
        cancellable: false
    }, async () => {
        let content: string | null;
        try {
            content = await loadMesFileService.call(system, remotePath);
        } catch (e: any) {
            vscode.window.showErrorMessage(
                `Erro ao carregar arquivo do servidor: ${e?.message || e}`
            );
            return;
        }

        if (content == null) {
            vscode.window.showErrorMessage(
                `Arquivo não encontrado no servidor: ${remotePath}`
            );
            return;
        }

        const tempPath = await trxTempFiles.write(remotePath, content);

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(tempPath));
        await vscode.window.showTextDocument(doc, { preview: false });

        statusBar.updateBar(`Aberto: ${fileName}`, Icon.success, { duration: 3 });
        logger.infoplus(system.name, 'TRX Open', `${remotePath} → temp`);

        // Define context para habilitar botões de upload no editor
        await vscode.commands.executeCommand('setContext', 'miisync.isTrxTempFile', true);
    });
}

/**
 * Baixa uma pasta do servidor como projeto permanente no workspace.
 * Igual ao "Download as Project" do front web.
 */
export async function OnCommandTrxDownloadFolderAsProject(item: TrxItem) {
    const userConfig = await configManager.load();
    if (!userConfig) return;
    await DownloadRemoteFolderAsProject(item.remotePath, userConfig, configManager.CurrentSystem);
}

/**
 * Faz upload do arquivo temporário TRX aberto no editor para o servidor.
 */
export async function OnCommandTrxUpload() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const localPath = editor.document.uri.fsPath;
    const entry = trxTempFiles.getEntry(localPath);
    if (!entry) {
        vscode.window.showWarningMessage(
            'Este arquivo não foi aberto do servidor via TRX Explorer.\nUse "Abrir do Servidor" para poder fazer upload.'
        );
        return;
    }

    const system = configManager.CurrentSystem;
    if (!system) return;

    const content = editor.document.getText();
    const fileName = path.basename(localPath);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Enviando ${fileName} para o servidor...`,
        cancellable: false
    }, async () => {
        const ok = await saveMesFileService.call(system, entry.remotePath, content);
        if (!ok) {
            vscode.window.showErrorMessage(`Falha no upload: ${fileName}`);
            return;
        }

        statusBar.updateBar(`Upload OK: ${fileName}`, Icon.success, { duration: 3 });
        vscode.window.showInformationMessage(`✅ Upload concluído: ${fileName}`);
        logger.infoplus(system.name, 'TRX Upload', `${fileName} → ${entry.remotePath}`);

        trxDirectoryTree.refresh();
    });
}

/**
 * Faz upload com backup do servidor:
 * 1. Baixa a versão atual do servidor como backup
 * 2. Envia o backup ao servidor com sufixo _BKP_<timestamp>
 * 3. Envia o arquivo modificado para o caminho original
 */
export async function OnCommandTrxUploadWithBkp() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const localPath = editor.document.uri.fsPath;
    const entry = trxTempFiles.getEntry(localPath);
    if (!entry) {
        vscode.window.showWarningMessage(
            'Este arquivo não foi aberto do servidor via TRX Explorer.\nUse "Abrir do Servidor" para poder fazer upload.'
        );
        return;
    }

    const system = configManager.CurrentSystem;
    if (!system) return;

    const content = editor.document.getText();
    const fileName = path.basename(localPath);
    const fileExt = path.extname(fileName);
    const fileNameNoExt = path.basename(fileName, fileExt);
    const remoteFolder = path.dirname(entry.remotePath).replace(/\\/g, '/');

    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR').replace(/\//g, '-');
    const timeStr = now.toLocaleTimeString('pt-BR', { hour12: false }).replace(/:/g, '-');
    const bkpFileName = `${fileNameNoExt}_BKP_${dateStr}_${timeStr}${fileExt}`;
    const bkpRemotePath = `${remoteFolder}/${bkpFileName}`;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Upload com Backup: ${fileName}`,
        cancellable: false
    }, async (progress) => {
        // 1. Baixar versão atual do servidor
        progress.report({ increment: 20, message: 'Baixando versão atual do servidor...' });
        let serverContent: string | null;
        try {
            serverContent = await loadMesFileService.call(system, entry.remotePath);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Erro ao ler arquivo do servidor para backup: ${e?.message || e}`);
            return;
        }
        if (serverContent == null) {
            vscode.window.showErrorMessage(
                `Arquivo não encontrado no servidor para backup: ${entry.remotePath}`
            );
            return;
        }

        // 2. Enviar backup ao servidor
        progress.report({ increment: 30, message: `Enviando backup como ${bkpFileName}...` });
        const bkpOk = await saveMesFileService.call(system, bkpRemotePath, serverContent);
        if (!bkpOk) {
            vscode.window.showErrorMessage('Falha ao enviar backup para o servidor.');
            return;
        }
        logger.infoplus(system.name, 'TRX Backup', `Backup criado: ${bkpRemotePath}`);

        // 3. Enviar arquivo modificado
        progress.report({ increment: 40, message: 'Enviando arquivo modificado...' });
        const uploadOk = await saveMesFileService.call(system, entry.remotePath, content);
        if (!uploadOk) {
            vscode.window.showErrorMessage(`Falha no upload de ${fileName}.`);
            return;
        }

        progress.report({ increment: 10, message: 'Concluído!' });
        statusBar.updateBar(`Upload OK: ${fileName}`, Icon.success, { duration: 3 });
        vscode.window.showInformationMessage(
            `✅ Upload com backup concluído!\nBackup salvo no servidor como: ${bkpFileName}`
        );
        logger.infoplus(system.name, 'TRX Upload+BKP', `${fileName} → ${entry.remotePath}`);

        trxDirectoryTree.refresh();
    });
}
