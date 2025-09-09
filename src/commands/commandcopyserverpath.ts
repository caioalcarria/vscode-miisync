import * as vscode from "vscode";
import { configManager } from "../modules/config";
import { GetRemotePathWithMapping } from "../modules/file";

/**
 * Comando para copiar o caminho do arquivo no servidor para a área de transferência
 */
export async function OnCommandCopyServerPath(uri: vscode.Uri): Promise<void> {
    try {
        // Obtém a configuração do usuário
        const userConfig = await configManager.load();
        if (!userConfig) {
            vscode.window.showWarningMessage("Configuração do MiiSync não encontrada.");
            return;
        }

        // Obtém o caminho remoto do arquivo (usando mapeamento se disponível)
        const remotePath = await GetRemotePathWithMapping(uri.fsPath, userConfig);
        
        if (!remotePath) {
            vscode.window.showWarningMessage("Não foi possível determinar o caminho do servidor para este arquivo.");
            return;
        }

        // Copia o caminho para a área de transferência
        await vscode.env.clipboard.writeText(remotePath);
        
        // Mostra notificação de sucesso com o caminho copiado
        vscode.window.showInformationMessage(
            `📋 Caminho copiado: ${remotePath}`,
            { modal: false }
        );

        console.log(`📋 Caminho do servidor copiado: ${remotePath}`);
        
    } catch (error) {
        console.error("❌ Erro ao copiar caminho do servidor:", error);
        vscode.window.showErrorMessage("Erro ao copiar caminho do servidor.");
    }
}
