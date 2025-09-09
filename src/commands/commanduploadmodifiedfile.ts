import * as vscode from "vscode";
import { configManager } from "../modules/config";
import { LocalProjectTreeItem } from "../ui/treeview/localprojectstree";
import { UploadFile } from "../transfer/upload";

/**
 * Comando para fazer upload de um arquivo modificado
 */
export async function OnCommandUploadModifiedFile(item: LocalProjectTreeItem): Promise<void> {
    try {
        if (!item.modifiedFile) {
            vscode.window.showWarningMessage("Item selecionado não é um arquivo modificado.");
            return;
        }

        // Obtém a configuração do usuário
        const userConfig = await configManager.load();
        if (!userConfig) {
            vscode.window.showWarningMessage("Configuração do MiiSync não encontrada.");
            return;
        }

        // Confirma com o usuário
        const confirm = await vscode.window.showInformationMessage(
            `Fazer upload de "${item.modifiedFile.fileName}"?`,
            { modal: true },
            "Sim",
            "Não"
        );

        if (confirm !== "Sim") {
            return;
        }

        // Cria URI do arquivo
        const fileUri = vscode.Uri.file(item.modifiedFile.filePath);

        // Faz upload do arquivo
        await UploadFile(fileUri, userConfig, configManager.CurrentSystem);

        vscode.window.showInformationMessage(
            `✅ Arquivo "${item.modifiedFile.fileName}" enviado com sucesso!`
        );

        console.log(`✅ Upload realizado: ${item.modifiedFile.filePath}`);

    } catch (error) {
        console.error("❌ Erro ao fazer upload do arquivo modificado:", error);
        vscode.window.showErrorMessage(`Erro ao fazer upload de "${item.modifiedFile?.fileName}".`);
    }
}
