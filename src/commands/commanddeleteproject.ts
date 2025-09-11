import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function OnCommandDeleteProject(projectItem: any) {
    try {
        const projectPath = projectItem.projectPath || projectItem;
        const projectName = path.basename(projectPath);
        
        // Popup de confirmação
        const confirmation = await vscode.window.showWarningMessage(
            `Tem certeza que deseja apagar o projeto "${projectName}" LOCALMENTE?`,
            {
                modal: true,
                detail: `Esta ação irá deletar permanentemente a pasta:\n${projectPath}\n\nEsta operação não pode ser desfeita!`
            },
            'Sim, apagar',
            'Cancelar'
        );

        if (confirmation !== 'Sim, apagar') {
            return; // Usuário cancelou
        }

        // Segunda confirmação para operações críticas
        const finalConfirmation = await vscode.window.showWarningMessage(
            `CONFIRMAÇÃO FINAL: Apagar "${projectName}"?`,
            {
                modal: true,
                detail: 'Última chance para cancelar esta operação irreversível.'
            },
            'APAGAR DEFINITIVAMENTE',
            'Cancelar'
        );

        if (finalConfirmation !== 'APAGAR DEFINITIVAMENTE') {
            return; // Usuário cancelou na segunda confirmação
        }

        // Verificar se o diretório existe
        if (!fs.existsSync(projectPath)) {
            vscode.window.showErrorMessage(`Projeto não encontrado: ${projectPath}`);
            return;
        }

        // Verificar se é realmente um diretório
        const stat = fs.statSync(projectPath);
        if (!stat.isDirectory()) {
            vscode.window.showErrorMessage(`O caminho não é um diretório: ${projectPath}`);
            return;
        }

        // Mostrar progresso durante a exclusão
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Apagando projeto "${projectName}"...`,
            cancellable: false
        }, async (progress) => {
            try {
                // Deletar o diretório recursivamente
                await deleteDirectoryRecursive(projectPath);
                
                progress.report({ increment: 100, message: 'Concluído!' });
                
                // Sucesso
                vscode.window.showInformationMessage(
                    `Projeto "${projectName}" foi apagado com sucesso!`
                );

                // Atualizar a lista de projetos
                vscode.commands.executeCommand('miisync.refreshprojects');

            } catch (error) {
                throw error;
            }
        });

    } catch (error) {
        console.error('Erro ao apagar projeto:', error);
        vscode.window.showErrorMessage(`Erro ao apagar projeto: ${error}`);
    }
}

async function deleteDirectoryRecursive(dirPath: string): Promise<void> {
    try {
        // Usar fs.rmSync que é mais moderno e eficiente
        if (fs.rmSync) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        } else {
            // Fallback para versões mais antigas do Node.js
            await deleteDirectoryLegacy(dirPath);
        }
    } catch (error) {
        throw new Error(`Falha ao deletar diretório: ${error}`);
    }
}

async function deleteDirectoryLegacy(dirPath: string): Promise<void> {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        
        if (item.isDirectory()) {
            // Deletar subdiretório recursivamente
            await deleteDirectoryLegacy(fullPath);
        } else {
            // Deletar arquivo
            fs.unlinkSync(fullPath);
        }
    }
    
    // Deletar o diretório vazio
    fs.rmdirSync(dirPath);
}
