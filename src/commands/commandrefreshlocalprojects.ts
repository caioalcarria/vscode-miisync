import * as vscode from "vscode";
import { localProjectsTree } from "../ui/treeview/localprojectstree";

/**
 * Comando para refrescar a lista de projetos locais
 */
export async function OnCommandRefreshLocalProjects(): Promise<void> {
    try {
        localProjectsTree.refresh();
        console.log("🔄 Lista de projetos locais atualizada");
    } catch (error) {
        console.error("❌ Erro ao atualizar projetos locais:", error);
        vscode.window.showErrorMessage("Erro ao atualizar lista de projetos locais.");
    }
}
