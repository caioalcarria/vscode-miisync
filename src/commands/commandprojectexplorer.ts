import * as vscode from 'vscode';
import * as cp from 'child_process';
import { projectExplorerTree, ProjectExplorerItem } from '../ui/treeview/projectexplorertree';

/**
 * Comando para refresh do Project Explorer
 */
export async function OnCommandRefreshProjectExplorer(): Promise<void> {
    try {
        //console.log('🔄 Refreshing Project Explorer');
        projectExplorerTree.refresh();
        vscode.window.showInformationMessage('Project Explorer refreshed');
    } catch (error) {
        console.error('❌ Erro ao fazer refresh do Project Explorer:', error);
        vscode.window.showErrorMessage(`Erro ao atualizar Project Explorer: ${error}`);
    }
}

/**
 * Comando para abrir pasta no explorador de arquivos do sistema
 */
export async function OnCommandOpenInExplorer(item: ProjectExplorerItem): Promise<void> {
    try {
        console.log(`📂 Abrindo no explorador: ${item.fullPath}`);
        
        const platform = process.platform;
        let command: string;
        
        switch (platform) {
            case 'win32':
                command = `explorer "${item.fullPath}"`;
                break;
            case 'darwin':
                command = `open "${item.fullPath}"`;
                break;
            case 'linux':
                command = `xdg-open "${item.fullPath}"`;
                break;
            default:
                vscode.window.showErrorMessage('Platform not supported for opening file explorer');
                return;
        }
        
        cp.exec(command, (error) => {
            if (error) {
                console.error('❌ Erro ao abrir explorador:', error);
                vscode.window.showErrorMessage(`Erro ao abrir explorador: ${error.message}`);
            }
        });
    } catch (error) {
        console.error('❌ Erro ao abrir no explorador:', error);
        vscode.window.showErrorMessage(`Erro ao abrir explorador: ${error}`);
    }
}
