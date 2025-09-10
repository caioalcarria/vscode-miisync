import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { localProjectsTree } from '../ui/treeview/localprojectstree';

/**
 * Comando para pesquisar em projeto MiiSync
 */
export async function OnCommandSearchInProject(uri: vscode.Uri): Promise<void> {
    try {
        const folderPath = uri.fsPath;
        console.log(`🔍 Tentando pesquisar na pasta: ${folderPath}`);
        
        // Verifica se a pasta é um projeto MiiSync
        const isMiiSyncProject = await checkIfMiiSyncProject(folderPath);
        
        if (!isMiiSyncProject) {
            vscode.window.showWarningMessage(`A pasta "${path.basename(folderPath)}" não é um projeto MiiSync.`);
            return;
        }
        
        console.log(`✅ Pasta confirmada como projeto MiiSync: ${folderPath}`);
        
        // Abre o painel de pesquisa do VS Code com escopo na pasta
        await vscode.commands.executeCommand('workbench.action.findInFiles', {
            query: '',
            filesToInclude: path.relative(vscode.workspace.workspaceFolders![0].uri.fsPath, folderPath) + '/**',
            isRegex: false,
            isCaseSensitive: false,
            matchWholeWord: false
        });
        
        // Mostra mensagem informativa
        vscode.window.showInformationMessage(`Pesquisa aberta para projeto: ${path.basename(folderPath)}`);
        
    } catch (error) {
        console.error('❌ Erro ao abrir pesquisa em projeto:', error);
        vscode.window.showErrorMessage(`Erro ao abrir pesquisa: ${error}`);
    }
}

/**
 * Verifica se uma pasta é um projeto MiiSync
 */
async function checkIfMiiSyncProject(folderPath: string): Promise<boolean> {
    try {
        // Método 1: Verifica se tem arquivo .miisync/path-mapping.json
        const pathMappingFile = path.join(folderPath, '.miisync', 'path-mapping.json');
        if (await fs.pathExists(pathMappingFile)) {
            return true;
        }
        
        // Método 2: Verifica se está na lista de projetos carregados
        const projects = localProjectsTree.getProjects();
        const isKnownProject = projects.some(project => 
            project.localPath === folderPath ||
            path.resolve(project.localPath) === path.resolve(folderPath)
        );
        
        if (isKnownProject) {
            return true;
        }
        
        // Método 3: Verifica se é subpasta de um projeto conhecido
        const isSubfolderOfProject = projects.some(project => {
            const projectPath = path.resolve(project.localPath);
            const targetPath = path.resolve(folderPath);
            return targetPath.startsWith(projectPath + path.sep) || targetPath === projectPath;
        });
        
        return isSubfolderOfProject;
        
    } catch (error) {
        console.error('❌ Erro ao verificar se é projeto MiiSync:', error);
        return false;
    }
}
