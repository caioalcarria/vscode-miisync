import * as vscode from 'vscode';
import { localProjectsTree, LocalProject } from '../ui/treeview/localprojectstree';
import { OnCommandVerifyServer } from './commandverifyserver';

/**
 * Handler para verificar integridade do servidor para uma pasta remota já carregada
 */
export async function OnCommandVerifyRemoteFolderIntegrity(remotePath: string): Promise<void> {
    try {
        console.log(`🔍 Verificando integridade da pasta remota: ${remotePath}`);
        
        // Busca projetos locais que correspondem ao caminho remoto
        const projects = localProjectsTree.getProjects();
        const matchingProjects = projects.filter(project => 
            project.remotePath === remotePath || 
            project.remotePath === remotePath + '/' ||
            project.remotePath + '/' === remotePath
        );

        if (matchingProjects.length === 0) {
            vscode.window.showErrorMessage('Nenhum projeto local encontrado para este caminho remoto.');
            return;
        }

        if (matchingProjects.length === 1) {
            // Um projeto apenas - verifica automaticamente
            const project = matchingProjects[0];
            console.log(`🎯 Verificando integridade do projeto: ${project.name}`);
            await OnCommandVerifyServer(project);
        } else {
            // Múltiplos projetos - mostra seletor
            const projectItems = matchingProjects.map(project => ({
                label: project.name,
                description: project.localPath,
                project: project
            }));

            const selectedItem = await vscode.window.showQuickPick(projectItems, {
                placeHolder: `Selecione qual projeto verificar (${matchingProjects.length} projetos encontrados)`,
                title: 'Verify Server Integrity'
            });

            if (selectedItem) {
                console.log(`🎯 Verificando integridade do projeto selecionado: ${selectedItem.project.name}`);
                await OnCommandVerifyServer(selectedItem.project);
            }
        }
    } catch (error) {
        console.error('❌ Erro ao verificar integridade da pasta remota:', error);
        vscode.window.showErrorMessage(`Erro ao verificar integridade: ${error}`);
    }
}
