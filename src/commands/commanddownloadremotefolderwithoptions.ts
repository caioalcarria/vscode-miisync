import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { localProjectsTree, LocalProject } from '../ui/treeview/localprojectstree';
import { DownloadRemoteFolderAsProject } from '../transfer/download';
import { configManager } from '../modules/config';
import { remoteDirectoryTree } from '../ui/treeview/remotedirectorytree';

/**
 * Opções de download para pastas já carregadas
 */
export enum DownloadOption {
    Duplicate = 'duplicate',
    Replace = 'replace',
    Cancel = 'cancel'
}

/**
 * Handler para download de pasta remota com opções quando já existe localmente
 */
export async function OnCommandDownloadRemoteFolderWithOptions(remotePath: string, folderName: string): Promise<void> {
    try {
        console.log(`📥 Download com opções para pasta: ${remotePath}`);
        
        // Busca projetos locais que correspondem ao caminho remoto
        const projects = localProjectsTree.getProjects();
        const matchingProjects = projects.filter(project => 
            project.remotePath === remotePath || 
            project.remotePath === remotePath + '/' ||
            project.remotePath + '/' === remotePath
        );

        if (matchingProjects.length === 0) {
            // Não há projetos locais - faz download normal
            const userConfig = await configManager.load();
            if (!userConfig) return;
            await DownloadRemoteFolderAsProject(remotePath, userConfig, configManager.CurrentSystem);
            return;
        }

        // Mostra opções para pasta já carregada
        const option = await showDownloadOptionsDialog(folderName, matchingProjects.length);
        
        switch (option) {
            case DownloadOption.Duplicate:
                await handleDuplicateProject(remotePath, folderName);
                break;
                
            case DownloadOption.Replace:
                await handleReplaceProject(remotePath, folderName, matchingProjects);
                break;
                
            case DownloadOption.Cancel:
                console.log('❌ Download cancelado pelo usuário');
                break;
        }
    } catch (error) {
        console.error('❌ Erro no download com opções:', error);
        vscode.window.showErrorMessage(`Erro no download: ${error}`);
    }
}

/**
 * Mostra dialog com opções de download
 */
async function showDownloadOptionsDialog(folderName: string, projectCount: number): Promise<DownloadOption> {
    const projectText = projectCount > 1 ? `${projectCount} projetos` : 'projeto';
    
    const items = [
        {
            label: '$(copy) Duplicar Projeto',
            description: 'Criar uma cópia com nome diferente',
            option: DownloadOption.Duplicate
        },
        {
            label: '$(replace-all) Substituir Projeto',
            description: 'Apagar o projeto existente e baixar novamente do servidor',
            option: DownloadOption.Replace
        },
        {
            label: '$(x) Cancelar',
            description: 'Não fazer nada',
            option: DownloadOption.Cancel
        }
    ];

    const selectedItem = await vscode.window.showQuickPick(items, {
        placeHolder: `A pasta "${folderName}" já está carregada como ${projectText}. O que deseja fazer?`,
        title: 'Pasta Já Carregada',
        ignoreFocusOut: true
    });

    return selectedItem?.option || DownloadOption.Cancel;
}

/**
 * Lida com duplicação de projeto
 */
async function handleDuplicateProject(remotePath: string, originalName: string): Promise<void> {
    // Solicita nome para o projeto duplicado
    const newName = await vscode.window.showInputBox({
        prompt: 'Digite o nome para o projeto duplicado',
        placeHolder: `${originalName}_copy`,
        value: `${originalName}_copy`,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Nome não pode estar vazio';
            }
            if (value.includes('/') || value.includes('\\')) {
                return 'Nome não pode conter barras';
            }
            return null;
        }
    });

    if (!newName) {
        console.log('❌ Duplicação cancelada - nome não fornecido');
        return;
    }

    console.log(`📋 Duplicando projeto como: ${newName}`);
    const userConfig = await configManager.load();
    if (!userConfig) return;
    await DownloadRemoteFolderAsProject(remotePath, userConfig, configManager.CurrentSystem);
    
    // 🔄 FORÇA ATUALIZAÇÃO IMEDIATA: Atualiza árvores
    setTimeout(() => {
        remoteDirectoryTree.forceRefresh();
    }, 1500);
}

/**
 * Lida com substituição de projeto
 */
async function handleReplaceProject(remotePath: string, folderName: string, matchingProjects: LocalProject[]): Promise<void> {
    let projectsToReplace = matchingProjects;

    // Se há múltiplos projetos, pergunta qual substituir
    if (matchingProjects.length > 1) {
        const projectItems = matchingProjects.map(project => ({
            label: project.name,
            description: project.localPath,
            project: project
        }));

        const selectedItems = await vscode.window.showQuickPick(projectItems, {
            placeHolder: 'Selecione qual projeto substituir',
            title: 'Substituir Projeto',
            canPickMany: true
        });

        if (!selectedItems || selectedItems.length === 0) {
            console.log('❌ Substituição cancelada - nenhum projeto selecionado');
            return;
        }

        projectsToReplace = selectedItems.map(item => item.project);
    }

    // Verifica se há modificações locais
    const projectsWithModifications = projectsToReplace.filter(project => 
        project.modifiedFiles && project.modifiedFiles.length > 0
    );

    if (projectsWithModifications.length > 0) {
        const modifiedProjectNames = projectsWithModifications.map(p => p.name).join(', ');
        const confirmed = await vscode.window.showWarningMessage(
            `Os seguintes projetos têm modificações locais não enviadas: ${modifiedProjectNames}.\n\nAo substituir, TODAS as modificações locais serão perdidas. Deseja continuar?`,
            { modal: true },
            'Sim, Substituir e Perder Modificações',
            'Cancelar'
        );

        if (confirmed !== 'Sim, Substituir e Perder Modificações') {
            console.log('❌ Substituição cancelada - usuário não confirmou perda de modificações');
            return;
        }
    }

    // Remove projetos existentes e baixa novamente
    for (const project of projectsToReplace) {
        try {
            console.log(`🗑️ Removendo projeto existente: ${project.name}`);
            
            // Remove pasta do projeto
            if (await fs.pathExists(project.localPath)) {
                await fs.remove(project.localPath);
            }
        } catch (error) {
            console.error(`❌ Erro ao remover projeto ${project.name}:`, error);
            vscode.window.showErrorMessage(`Erro ao remover projeto ${project.name}: ${error}`);
            return;
        }
    }

    // Baixa projeto novamente
    console.log(`📥 Baixando projeto substituído: ${folderName}`);
    await DownloadRemoteFolderAsProject(remotePath, await configManager.load()!, configManager.CurrentSystem);
    
    // 🔄 FORÇA ATUALIZAÇÃO IMEDIATA: Atualiza árvores
    setTimeout(() => {
        remoteDirectoryTree.forceRefresh();
    }, 1500);
}
