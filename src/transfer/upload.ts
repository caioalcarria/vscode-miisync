import { pathExists, readFile } from 'fs-extra';
import * as path from 'path';
import { Uri, window } from "vscode";
import { System, UserConfig } from "../extension/system";
import { readFileService } from "../miiservice/readfileservice";
import { saveFileService } from "../miiservice/savefileservice";
import { IsFatalResponse } from "../miiservice/abstract/filters";
import { GetRemotePathWithMapping, PrepareUrisForService } from "../modules/file";
import { CheckSeverity, CheckSeverityFile, CheckSeverityFolder, SeverityOperation } from '../modules/severity';
import { ActionReturn, ActionType, StartAction } from './action';
import { Validate } from "./gate";
import { UploadComplexLimited } from './limited/uploadcomplex';

/**
 * Verifica se o upload foi bem-sucedido comparando o arquivo local com o do servidor
 */
async function verifyUploadIntegrity(localFilePath: string, remotePath: string, localContent: string, system: System): Promise<boolean> {
    try {
        // Baixa o arquivo do servidor para verificação
        const serverResponse = await readFileService.call(system, remotePath);
        
        if (!serverResponse || IsFatalResponse(serverResponse)) {
            console.error('Erro ao baixar arquivo do servidor para verificação:', 
                IsFatalResponse(serverResponse) ? serverResponse.Rowsets.FatalError : 'Resposta inválida');
            return false;
        }

        // Obtém o conteúdo do servidor
        const payload = serverResponse?.Rowsets?.Rowset?.Row?.find((row) => row.Name === "Payload");
        if (!payload) {
            console.error('Payload não encontrado na resposta do servidor');
            return false;
        }

        const serverContent = Buffer.from(payload.Value, 'base64').toString('utf8');
        
        // Compara os conteúdos
        const contentsMatch = localContent === serverContent;
        
        const fileName = path.basename(localFilePath);
        
        if (contentsMatch) {
            window.showInformationMessage(
                `✅ Upload verificado: "${fileName}"`,
                { detail: `Arquivo confirmado no servidor: ${remotePath}` }
            );
        } else {
            window.showWarningMessage(
                `⚠️ Verificação falhou: "${fileName}"`,
                { detail: `O arquivo no servidor difere do local. Servidor: ${serverContent.length} chars, Local: ${localContent.length} chars` }
            );
            
            // Log detalhado para debug
            console.log('=== VERIFICAÇÃO DE INTEGRIDADE FALHOU ===');
            console.log('Arquivo:', fileName);
            console.log('Caminho remoto:', remotePath);
            console.log('Tamanho local:', localContent.length);
            console.log('Tamanho servidor:', serverContent.length);
            console.log('Primeiros 100 chars local:', localContent.substring(0, 100));
            console.log('Primeiros 100 chars servidor:', serverContent.substring(0, 100));
        }
        
        return contentsMatch;
        
    } catch (error) {
        console.error('Erro durante verificação de integridade:', error);
        const fileName = path.basename(localFilePath);
        window.showErrorMessage(
            `❌ Erro na verificação: "${fileName}"`,
            { detail: `Não foi possível verificar se o upload foi bem-sucedido: ${error}` }
        );
        return false;
    }
}

export async function UploadFile(uri: Uri, userConfig: UserConfig, system: System, content?: string) {
    if (!await Validate(userConfig, { system, localPath: uri.fsPath })) {
        return false;
    }
    const fileName = path.basename(uri.fsPath);
    const upload = async () => {
        if (!content) {
            const exists = await pathExists(uri.fsPath);
            if (!exists) {
                return { aborted: true, error: true, message: fileName + " doesn't exist" };
            }
            content = (await readFile(uri.fsPath)).toString();
        }
        if (!await CheckSeverityFile(uri, SeverityOperation.upload, userConfig, system)) return { aborted: true };

        const sourcePath = await GetRemotePathWithMapping(uri.fsPath, userConfig);
        const base64Content = encodeURIComponent(Buffer.from(content || " ").toString('base64'));

        const response = await saveFileService.call({ ...system, body: "Content=" + base64Content }, sourcePath);
        
        if (response == null) {
            return { aborted: true };
        }

        // Verificação de integridade após upload bem-sucedido
        try {
            const startTime = Date.now();
            window.showInformationMessage(`🔍 Verificando integridade: "${fileName}"...`);
            
            const isVerified = await verifyUploadIntegrity(uri.fsPath, sourcePath, content, system);
            const duration = Date.now() - startTime;
            
            if (!isVerified) {
                window.showErrorMessage(
                    `❌ Verificação falhou: "${fileName}"`,
                    { detail: `Upload concluído em ${duration}ms, mas o arquivo no servidor não confere com o local` }
                );
                return { aborted: false, error: true, message: "Upload concluído mas verificação falhou" };
            } else {
                console.log(`✅ Upload verificado com sucesso em ${duration}ms: ${fileName}`);
            }
        } catch (error) {
            console.error('Erro na verificação de integridade:', error);
            // Não aborta se a verificação falhar, apenas avisa
            window.showWarningMessage(
                `⚠️ Upload concluído, mas verificação não pôde ser realizada: "${fileName}"`,
                { detail: `Erro: ${error}` }
            );
        }

        return { aborted: false };
    }
    StartAction(ActionType.upload, { name: "Upload File", resource: fileName, system }, { isSimple: true }, upload);
}

/**
 * Uses Limited
 */
export async function UploadFolder(folderUri: Uri, userConfig: UserConfig, system: System) {
    const folderPath = folderUri.fsPath;
    const folderName = path.basename(folderPath);
    if (!await Validate(userConfig, { system, localPath: folderPath })) { return null; }
    const upload = async () => {
        if (!await CheckSeverityFolder(folderUri, SeverityOperation.upload, userConfig, system)) return { aborted: true };

        const response = await UploadComplexLimited({ path: folderPath, files: [], folders: [] }, userConfig, system);
        return { aborted: response.aborted };
    }
    StartAction(ActionType.upload, { name: "Upload Folder", resource: folderName, system }, { isSimple: false }, upload);
}

/**
 * Uses Limited
 */
export async function UploadUris(uris: Uri[], userConfig: UserConfig, system: System, processName: string) {
    const upload = async (): Promise<ActionReturn> => {
        const folder = await PrepareUrisForService(uris);

        if (!await CheckSeverity(folder, SeverityOperation.upload, userConfig, system)) return { aborted: true };

        const response = await UploadComplexLimited(folder, userConfig, system);
        return { aborted: response.aborted };
    }

    StartAction(ActionType.upload, { name: processName, system }, { isSimple: false }, upload);
}
