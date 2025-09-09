import { Uri } from "vscode";
import { configManager } from "../modules/config";
import { GetRemotePathWithMapping } from "../modules/file";

/**
 * Comando para obter o título dinâmico do upload com o caminho remoto
 */
export async function OnCommandGetUploadTitle(uri: Uri): Promise<string> {
    try {
        const userConfig = await configManager.load();
        if (!userConfig) {
            return "Upload";
        }

        const remotePath = await GetRemotePathWithMapping(uri.fsPath, userConfig);
        return `Upload to ${remotePath}`;
    } catch (error) {
        console.error('Erro ao obter título do upload:', error);
        return "Upload";
    }
}

/**
 * Comando para obter o título dinâmico do download com o caminho remoto
 */
export async function OnCommandGetDownloadTitle(uri: Uri): Promise<string> {
    try {
        const userConfig = await configManager.load();
        if (!userConfig) {
            return "Download";
        }

        const remotePath = await GetRemotePathWithMapping(uri.fsPath, userConfig);
        return `Download from ${remotePath}`;
    } catch (error) {
        console.error('Erro ao obter título do download:', error);
        return "Download";
    }
}
