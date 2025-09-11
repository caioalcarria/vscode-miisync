import * as vscode from "vscode";
import { changeManager } from "../modules/changemanager";

/**
 * Comando para resetar o estado de mudanças (debug/desenvolvimento)
 */
export async function OnCommandResetChangeState(): Promise<void> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showWarningMessage("Nenhuma pasta de workspace aberta.");
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      "Isso irá resetar todo o estado de mudanças detectadas. Continuar?",
      { modal: true },
      "Sim, resetar",
      "Cancelar"
    );

    if (confirm === "Sim, resetar") {
      for (const folder of workspaceFolders) {
        await changeManager.clearProjectChanges(folder.uri.fsPath);
      }

      vscode.window.showInformationMessage(
        "✅ Estado de mudanças resetado com sucesso!"
      );
      console.log("🔄 Estado de mudanças foi resetado manualmente");
    }
  } catch (error) {
    console.error("❌ Erro ao resetar estado de mudanças:", error);
    vscode.window.showErrorMessage("Erro ao resetar estado de mudanças.");
  }
}
