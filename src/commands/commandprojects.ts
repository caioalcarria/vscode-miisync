import * as vscode from 'vscode';

export async function OnCommandOpenProject(projectPath: string) {
    try {
        // Abrir o projeto em uma nova janela
        const uri = vscode.Uri.file(projectPath);
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    } catch (error) {
        vscode.window.showErrorMessage(`Erro ao abrir projeto: ${error}`);
    }
}

export async function OnCommandRefreshProjects() {
    // Será implementado no arquivo de ativação
    vscode.commands.executeCommand('miisync.refreshprojects');
}
