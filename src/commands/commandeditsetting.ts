import * as vscode from "vscode";

/**
 * Comando para editar uma configuração específica
 */
export async function OnCommandEditSetting(): Promise<void> {
  // Executa o comando de mostrar configurações
  await vscode.commands.executeCommand("miisync.showsettings");
}
