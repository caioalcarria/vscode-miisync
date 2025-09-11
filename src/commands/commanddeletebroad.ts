import { lstat } from "fs-extra";
import { Uri, window } from "vscode";
import { configManager } from "../modules/config";
import { GetActiveTextEditor } from "../modules/vscode";
import { DeleteFile, DeleteFolder, DeleteUris } from "../transfer/delete";
import { IEditorCommandsContext } from "../types/vscode";
import { GetRemotePathWithMapping } from "../modules/file";
import { DoesFileExist, DoesFolderExist } from "../transfer/gate";
import * as path from 'path';


export async function OnCommandDeleteBroad(mainUri: Uri, data: IEditorCommandsContext | Uri[]) {
    const userConfig = await configManager.load();
    if (!userConfig) return;

    // Função para obter caminho remoto e mostrar confirmação
    const confirmDeletion = async (uri: Uri, isDirectory: boolean): Promise<boolean> => {
        const localPath = uri.fsPath;
        const remotePath = await GetRemotePathWithMapping(localPath, userConfig);
        
        if (!remotePath) {
            window.showErrorMessage('Não foi possível determinar o caminho remoto do arquivo.');
            return false;
        }
        
        // Verificar se o arquivo/pasta existe no servidor
        const existsOnServer = isDirectory 
            ? await DoesFolderExist(remotePath, configManager.CurrentSystem)
            : await DoesFileExist(remotePath, configManager.CurrentSystem);
            
        if (!existsOnServer) {
            const fileType = isDirectory ? "pasta" : "arquivo";
            window.showWarningMessage(
                `${fileType} não existe no servidor!`,
                { modal: true, detail: `O ${fileType} não foi encontrado no caminho remoto:\n${remotePath}\n\nNão é possível deletar algo que não existe no servidor.` }
            );
            return false;
        }
        
        const fileName = path.basename(localPath);
        const fileType = isDirectory ? "PASTA" : "ARQUIVO";
        
        // Popup de PERIGO!
        const confirmation = await window.showErrorMessage(
            `🚨 PERIGO! DELETAR ${fileType} DO SERVIDOR! 🚨`,
            {
                modal: true,
                detail: `Você está prestes a DELETAR PERMANENTEMENTE do servidor:\n\n📁 ${fileType}: ${fileName}\n🌐 Caminho remoto: ${remotePath}\n\n⚠️ ESTA AÇÃO NÃO PODE SER DESFEITA!\n⚠️ O arquivo será REMOVIDO DO SERVIDOR DEFINITIVAMENTE!\n\nTem certeza absoluta que deseja continuar?`
            },
            'SIM, DELETAR DO SERVIDOR',
            'CANCELAR'
        );

        if (confirmation !== 'SIM, DELETAR DO SERVIDOR') {
            return false; // Usuário cancelou
        }

        // Segunda confirmação crítica
        const finalConfirmation = await window.showErrorMessage(
            `🔴 CONFIRMAÇÃO FINAL DE DELEÇÃO! 🔴`,
            {
                modal: true,
                detail: `ÚLTIMA CHANCE!\n\nVocê está deletando do servidor:\n${remotePath}\n\nEsta é uma operação IRREVERSÍVEL!`
            },
            'DELETAR PERMANENTEMENTE',
            'CANCELAR'
        );

        return finalConfirmation === 'DELETAR PERMANENTEMENTE';
    };

    if (!mainUri) {
        const textEditor = GetActiveTextEditor();
        if (textEditor?.document?.fileName) {
            const uri = textEditor.document.uri;
            if (await confirmDeletion(uri, false)) {
                DeleteFile(uri, userConfig, configManager.CurrentSystem);
            }
        }
    }
    else if (Array.isArray(data) && data.length > 1) {
        // Para múltiplos arquivos, confirma uma vez para todos
        const confirmation = await window.showErrorMessage(
            `🚨 PERIGO! DELETAR ${data.length} ITENS DO SERVIDOR! 🚨`,
            {
                modal: true,
                detail: `Você está prestes a DELETAR PERMANENTEMENTE ${data.length} itens do servidor!\n\n⚠️ ESTA AÇÃO NÃO PODE SER DESFEITA!\n⚠️ Todos os arquivos serão REMOVIDOS DO SERVIDOR DEFINITIVAMENTE!\n\nTem certeza absoluta que deseja continuar?`
            },
            'SIM, DELETAR TODOS DO SERVIDOR',
            'CANCELAR'
        );

        if (confirmation === 'SIM, DELETAR TODOS DO SERVIDOR') {
            DeleteUris(data, userConfig, configManager.CurrentSystem, "Delete Selection");
        }
    }
    else {
        const stat = await lstat(mainUri.fsPath);
        if (await confirmDeletion(mainUri, stat.isDirectory())) {
            if(stat.isDirectory()){
                DeleteFolder(mainUri, userConfig, configManager.CurrentSystem);
            }
            else{
                DeleteFile(mainUri, userConfig, configManager.CurrentSystem);
            }
        }
    }
}


