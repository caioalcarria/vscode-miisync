import { lstat } from "fs-extra";
import { Uri, window, TabInputCustom, TabInputText } from "vscode";
import { configManager } from "../modules/config";
import { GetActiveTextEditor } from "../modules/vscode";
import { UploadFile, UploadFolder, UploadUris } from "../transfer/upload";
import { IEditorCommandsContext } from "../types/vscode";
import * as path from 'path';

function getActiveFileUri(): Uri | undefined {
    const textEditor = GetActiveTextEditor();
    if (textEditor?.document?.uri.scheme === 'file') {
        return textEditor.document.uri;
    }
    // Custom editors (e.g. TQSQ) don't surface as activeTextEditor —
    // check the active tab directly.
    const activeTab = window.tabGroups.activeTabGroup.activeTab;
    if (activeTab?.input instanceof TabInputCustom && activeTab.input.uri.scheme === 'file') {
        return activeTab.input.uri;
    }
    if (activeTab?.input instanceof TabInputText && activeTab.input.uri.scheme === 'file') {
        return activeTab.input.uri;
    }
    return undefined;
}

/**
 * Comando de upload que mostra o caminho remoto antes de executar
 * A confirmação agora é feita pelo sistema de severity integrado
 */
export async function OnCommandUploadWithPath(mainUri: Uri, data: IEditorCommandsContext | Uri[]) {
    const userConfig = await configManager.load();
    if (!userConfig) return;

    if (!mainUri) {
        const textEditor = GetActiveTextEditor();
        if (textEditor?.document?.fileName) {
            UploadFile(textEditor.document.uri, userConfig, configManager.CurrentSystem, textEditor.document.getText());
        } else {
            const activeUri = getActiveFileUri();
            if (activeUri) {
                UploadFile(activeUri, userConfig, configManager.CurrentSystem);
            } else {
                window.showErrorMessage("Nenhum arquivo selecionado para upload");
            }
        }
    }
    else if (Array.isArray(data) && data.length > 1) {
        // Para múltiplos arquivos, executa direto
        UploadUris(data, userConfig, configManager.CurrentSystem, "Upload Selection");
    }
    else {
        try {
            const stat = await lstat(mainUri.fsPath);
            if(stat.isDirectory()){
                UploadFolder(mainUri, userConfig, configManager.CurrentSystem);
            } else {
                UploadFile(mainUri, userConfig, configManager.CurrentSystem);
            }
        } catch (error) {
            window.showErrorMessage(`Erro ao fazer upload: ${error}`);
        }
    }
}
