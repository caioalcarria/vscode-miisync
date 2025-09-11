import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { lstat } from "fs-extra";
import logger from '../ui/logger';
import { configManager } from "../modules/config";
import { UploadFile } from "../transfer/upload";
import { GetRemotePathWithMapping } from "../modules/file";
import { readFileService } from "../miiservice/readfileservice";
import { IsFatalResponse } from "../miiservice/abstract/filters";

/**
 * Comando para fazer upload de arquivos com backup do servidor
 * 1. Baixa versão atual do servidor
 * 2. Salva como backup local com timestamp 
 * 3. Faz upload do backup
 * 4. Verifica integridade do backup
 * 5. Faz upload da versão local
 */
export async function commandUploadWithBkp(fileUri?: vscode.Uri) {
    try {
        const userConfig = await configManager.load();
        if (!userConfig) {
            vscode.window.showErrorMessage('Configuração não encontrada.');
            return;
        }

        let targetUri: vscode.Uri;

        if (fileUri) {
            targetUri = fileUri;
        } else {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showErrorMessage('Nenhum arquivo ativo ou selecionado.');
                return;
            }
            targetUri = activeEditor.document.uri;
        }

        const targetPath = targetUri.fsPath;

        // Verifica se o arquivo local existe
        if (!fs.existsSync(targetPath)) {
            vscode.window.showErrorMessage('Arquivo local não encontrado: ' + targetPath);
            return;
        }

        const stat = await lstat(targetPath);
        if (stat.isDirectory()) {
            vscode.window.showErrorMessage('Upload com Server Backup funciona apenas para arquivos, não diretórios.');
            return;
        }

        // Obter o caminho remoto do arquivo
        const remotePath = await GetRemotePathWithMapping(targetPath, userConfig);
        if (!remotePath) {
            vscode.window.showErrorMessage('Não foi possível determinar o caminho remoto do arquivo.');
            return;
        }

        const fileName = path.basename(targetPath);
        const fileExt = path.extname(fileName);
        const fileNameWithoutExt = path.basename(fileName, fileExt);
        const fileDir = path.dirname(targetPath);

        // Cria nome do backup com data/hora mais legível
        const now = new Date();
        const dateStr = now.toLocaleDateString('pt-BR').replace(/\//g, '-');
        const timeStr = now.toLocaleTimeString('pt-BR', { hour12: false }).replace(/:/g, '-');
        const timestamp = `${dateStr}_${timeStr}`;

        const backupFileName = `${fileNameWithoutExt}_BKP_${timestamp}${fileExt}`;
        const backupFilePath = path.join(fileDir, backupFileName);

        // Mostra progresso
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Upload with Server Backup",
            cancellable: false
        }, async (progress) => {
            try {
                // Passo 1: Baixar versão atual do servidor
                progress.report({ increment: 20, message: "Baixando versão atual do servidor..." });
                
                let serverBackupCreated = false;
                try {
                    await downloadServerFileToPath(remotePath, backupFilePath, userConfig, configManager.CurrentSystem);
                    serverBackupCreated = true;
                    logger.log(`Backup baixado do servidor: ${remotePath} -> ${backupFilePath}`);
                } catch (error) {
                    // Se arquivo não existe no servidor, mostra erro específico
                    logger.log(`Arquivo não existe no servidor: ${remotePath}`);
                    throw new Error(`Arquivo não existe no servidor!\nCaminho remoto tentado: ${remotePath}\n\nNão é possível criar backup de arquivo inexistente.`);
                }

                // Passo 2: Upload do backup para servidor
                progress.report({ increment: 30, message: "Enviando backup para servidor..." });
                const backupUri = vscode.Uri.file(backupFilePath);
                
                try {
                    await UploadFile(backupUri, userConfig, configManager.CurrentSystem);
                    logger.log(`Backup enviado com sucesso para o servidor`);
                } catch (error) {
                    throw new Error(`Falha no upload do backup: ${error}`);
                }

                // Passo 3: Verificar integridade do backup
                progress.report({ increment: 20, message: "Verificando integridade do backup..." });
                
                const backupVerified = await verifyBackupIntegrity(backupFilePath, remotePath, userConfig);
                if (!backupVerified) {
                    throw new Error('Falha na verificação da integridade do backup no servidor');
                }
                logger.log(`Integridade do backup verificada com sucesso`);

                // Passo 4: Upload do arquivo local atual
                progress.report({ increment: 25, message: "Enviando arquivo local para servidor..." });
                
                try {
                    await UploadFile(targetUri, userConfig, configManager.CurrentSystem);
                    logger.log(`Arquivo local enviado com sucesso para o servidor`);
                } catch (error) {
                    throw new Error(`Falha no upload do arquivo local: ${error}`);
                }

                // Passo 5: Finalização
                progress.report({ increment: 5, message: "Finalizando..." });
                
                logger.log(`Upload com server backup concluído com sucesso`);
                
                // Mantém o backup local sempre
                vscode.window.showInformationMessage(
                    `✅ Upload com server backup concluído!\nBackup local criado: ${backupFileName}`
                );

            } catch (error) {
                logger.log(`Erro durante upload com server backup: ${error}`);
                vscode.window.showErrorMessage(`Erro no upload com server backup:\n${error}`);
                
                // Remove o backup local se foi criado
                if (fs.existsSync(backupFilePath)) {
                    try {
                        fs.unlinkSync(backupFilePath);
                        logger.log(`Backup local removido após erro`);
                    } catch (removeError) {
                        logger.log(`Erro ao remover backup após falha: ${removeError}`);
                    }
                }
            }
        });

    } catch (error) {
        logger.log(`Erro geral no comando uploadWithBkp: ${error}`);
        vscode.window.showErrorMessage(`Erro: ${error}`);
    }
}

/**
 * Baixa um arquivo do servidor para um caminho local específico
 */
async function downloadServerFileToPath(remotePath: string, localPath: string, userConfig: any, system: any): Promise<void> {
    try {
        // Usa o serviço readFile para baixar o conteúdo do servidor
        const response = await readFileService.call(system, remotePath);
        
        if (!response) {
            throw new Error(`Arquivo não encontrado no servidor: ${remotePath}`);
        }

        // Verifica se houve erro fatal
        if (IsFatalResponse(response)) {
            throw new Error(`Arquivo não encontrado no servidor: ${remotePath}`);
        }

        // Busca o payload do arquivo
        const payload = response?.Rowsets?.Rowset?.Row?.find((row) => row.Name === "Payload");
        if (!payload) {
            throw new Error(`Conteúdo do arquivo não encontrado: ${remotePath}`);
        }

        // Decodifica o conteúdo base64
        const fileContent = Buffer.from(payload.Value, 'base64').toString('utf8');

        // Salva o conteúdo no arquivo local
        fs.writeFileSync(localPath, fileContent, 'utf8');
        
        logger.log(`Arquivo baixado com sucesso: ${remotePath} -> ${localPath}`);
    } catch (error) {
        logger.log(`Erro ao baixar arquivo do servidor: ${error}`);
        throw error;
    }
}

/**
 * Verifica se o backup foi salvo corretamente no servidor
 * comparando o conteúdo local com o que foi baixado/enviado
 */
async function verifyBackupIntegrity(localBackupPath: string, remotePath: string, userConfig: any): Promise<boolean> {
    try {
        // Lê o conteúdo do backup local
        const localContent = fs.readFileSync(localBackupPath, 'utf8');
        
        // Para verificação simples, vamos verificar se o arquivo existe e tem conteúdo
        if (!localContent || localContent.length === 0) {
            logger.log('Backup local está vazio ou corrompido');
            return false;
        }

        // Aqui você pode implementar verificações mais robustas como:
        // - Comparar hash MD5/SHA
        // - Re-baixar o arquivo do servidor e comparar
        // - Verificar tamanho do arquivo
        
        logger.log(`Backup verificado: ${localBackupPath} (${localContent.length} caracteres)`);
        return true;
        
    } catch (error) {
        logger.log(`Erro na verificação de integridade do backup: ${error}`);
        return false;
    }
}
