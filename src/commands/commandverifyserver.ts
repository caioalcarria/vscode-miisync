import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import { LocalProject, ServerVerification, ServerVerificationStatus, ServerDifference, ServerDiffType, LocalProjectTreeItem } from '../ui/treeview/localprojectstree';
import { PathMappingManager } from '../modules/pathmapping';
import { localProjectsTree } from '../ui/treeview/localprojectstree';
import { OnCommandShowServerDifferences } from './commandshowserverdifferences';
import { listFilesService } from '../miiservice/listfilesservice';
import { listFoldersService } from '../miiservice/listfoldersservice';
import { configManager } from '../modules/config';
import { IsFatalResponse } from '../miiservice/abstract/filters';
import { readFileService } from '../miiservice/readfileservice';

/**
 * Comando para verificar integridade com o servidor
 */
export async function OnCommandVerifyServer(item: LocalProjectTreeItem): Promise<void> {
    if (!item.project) {
        vscode.window.showErrorMessage('❌ Projeto não especificado para verificação');
        return;
    }

    const project = item.project;

    // Inicia verificação
    await setProjectVerificationStatus(project, ServerVerificationStatus.Checking);
    localProjectsTree.refresh();

    try {
        vscode.window.showInformationMessage(`🔍 Verificando integridade do projeto "${project.name}" com o servidor...`);

        const verification = await performServerVerification(project);
        project.serverVerification = verification;

        // Atualiza árvore
        localProjectsTree.refresh();

        // Mostra resultado
        await showVerificationResults(project, verification);

    } catch (error: any) {
        console.error('❌ Erro na verificação do servidor:', error);
        
        // Marca como erro
        await setProjectVerificationStatus(project, ServerVerificationStatus.Error, error.message);
        localProjectsTree.refresh();
        
        vscode.window.showErrorMessage(`❌ Erro ao verificar servidor: ${error.message}`);
    }
}

/**
 * Realiza a verificação completa com o servidor
 */
async function performServerVerification(project: LocalProject): Promise<ServerVerification> {
    const differences: ServerDifference[] = [];
    
    try {
        // 1. Lista arquivos do servidor
        console.log(`🔍 Iniciando listagem do servidor: ${project.remotePath}`);
        console.log(`📋 Projeto: ${project.name} | Local: ${project.localPath}`);
        const serverFiles = await getServerFileStructure(project.remotePath);
        console.log(`📊 Encontrados ${serverFiles.size} itens no servidor`);
        
        // Debug: se não encontrou nada no servidor
        if (serverFiles.size === 0) {
            console.warn(`⚠️ PROBLEMA: Nenhum arquivo encontrado no servidor para o caminho: ${project.remotePath}`);
        }
        console.log(`📂 Iniciando escaneamento local: ${project.localPath}`);
        const localFiles = await getLocalFileStructure(project.localPath);
        console.log(`📊 Encontrados ${localFiles.size} itens locais`);
        
        // Debug: mostra alguns exemplos
        console.log('📋 Exemplos servidor:', Array.from(serverFiles.keys()).slice(0, 5));
        console.log('📋 Exemplos local:', Array.from(localFiles.keys()).slice(0, 5));
        
        // 3. Compara estruturas
        await compareFileStructures(project, localFiles, serverFiles, differences);
        
        // 4. Determina status final
        const status = differences.length > 0 ? 
            ServerVerificationStatus.OutOfSync : 
            ServerVerificationStatus.UpToDate;
        
        return {
            status,
            lastChecked: new Date(),
            differences,
        };
        
    } catch (error: any) {
        return {
            status: ServerVerificationStatus.Error,
            lastChecked: new Date(),
            differences: [],
            error: error.message
        };
    }
}

/**
 * Obtém estrutura de arquivos do servidor recursivamente
 */
async function getServerFileStructure(remotePath: string): Promise<Map<string, ServerFileInfo>> {
    const files = new Map<string, ServerFileInfo>();
    
    try {
        const currentSystem = configManager.CurrentSystem;
        if (!currentSystem) {
            throw new Error('Sistema não configurado');
        }
        
        console.log(`🔍 Iniciando escaneamento do servidor no caminho: "${remotePath}"`);
        
        // Faz busca recursiva começando pelo diretório do projeto no servidor
        await scanServerDirectory(currentSystem, remotePath, remotePath, files);
        
        console.log(`✅ Escaneamento do servidor concluído. Total de itens: ${files.size}`);
        
    } catch (error) {
        console.error('❌ Erro ao listar arquivos do servidor:', error);
    }
    
    return files;
}

/**
 * Escaneia diretório do servidor recursivamente
 */
async function scanServerDirectory(
    system: any,
    currentPath: string,
    basePath: string,
    files: Map<string, ServerFileInfo>
): Promise<void> {
    try {
        console.log(`📁 Escaneando diretório do servidor: "${currentPath}"`);
        
        // 1. Lista arquivos do diretório atual
        const serverFiles = await listFilesService.call(system, currentPath);
        
        if (serverFiles && !IsFatalResponse(serverFiles)) {
            const fileItems = serverFiles?.Rowsets?.Rowset?.Row || [];
            console.log(`📄 Encontrados ${fileItems.length} arquivos em "${currentPath}"`);
            
            for (const item of fileItems) {
                // Calcula o caminho relativo a partir do basePath
                let fullPath = item.FilePath + "/" + item.ObjectName;
                let relativePath = fullPath.replace(basePath, '').replace(/^\/+/, '');
                relativePath = relativePath.replace(/\\/g, '/'); // Converte \ para /
                
                if (relativePath) {
                    console.log(`📄 Arquivo servidor: "${relativePath}" (full: ${fullPath})`);
                    files.set(relativePath, {
                        path: fullPath,
                        relativePath,
                        isDirectory: false,
                        lastModified: item.Modified ? new Date(item.Modified) : undefined,
                        size: undefined
                    });
                }
            }
        } else {
            console.warn(`⚠️ Erro ou resposta vazia ao listar arquivos em "${currentPath}"`);
        }
        
        // 2. Lista pastas do diretório atual
        const serverFolders = await listFoldersService.call(system, currentPath);
        
        if (serverFolders && !IsFatalResponse(serverFolders)) {
            const folderItems = serverFolders?.Rowsets?.Rowset?.Row || [];
            console.log(`📁 Encontradas ${folderItems.length} pastas em "${currentPath}"`);
            
            for (const folder of folderItems) {
                const folderPath = folder.Path;
                // Calcula o caminho relativo da pasta
                let relativePath = folderPath.replace(basePath, '').replace(/^\/+/, '');
                relativePath = relativePath.replace(/\\/g, '/'); // Converte \ para /
                
                if (relativePath) {
                    console.log(`📁 Pasta servidor: "${relativePath}" (full: ${folderPath})`);
                    // Adiciona a pasta como entrada
                    files.set(relativePath, {
                        path: folderPath,
                        relativePath,
                        isDirectory: true,
                        lastModified: undefined,
                        size: undefined
                    });
                    
                    // Recursivamente escaneia a subpasta
                    await scanServerDirectory(system, folderPath, basePath, files);
                }
            }
        } else {
            console.warn(`⚠️ Erro ou resposta vazia ao listar pastas em "${currentPath}"`);
        }
        
    } catch (error) {
        console.error(`❌ Erro ao escanear diretório do servidor "${currentPath}":`, error);
    }
}

/**
 * Obtém estrutura de arquivos locais
 */
async function getLocalFileStructure(localPath: string): Promise<Map<string, LocalFileInfo>> {
    const files = new Map<string, LocalFileInfo>();
    
    await scanLocalDirectory(localPath, localPath, files);
    
    return files;
}

/**
 * Escaneia diretório local recursivamente
 */
async function scanLocalDirectory(
    currentPath: string, 
    basePath: string, 
    files: Map<string, LocalFileInfo>
): Promise<void> {
    try {
        const items = await fs.readdir(currentPath, { withFileTypes: true });
        
        for (const item of items) {
            // Ignora pasta .miisync
            if (item.name === '.miisync') continue;
            
            const itemPath = path.join(currentPath, item.name);
            const relativePath = path.relative(basePath, itemPath).replace(/\\/g, '/');
            
            if (item.isDirectory()) {
                files.set(relativePath, {
                    path: itemPath,
                    relativePath,
                    isDirectory: true,
                    lastModified: (await fs.stat(itemPath)).mtime
                });
                
                console.log(`📁 Pasta local: ${relativePath}`);
                // Recursão
                await scanLocalDirectory(itemPath, basePath, files);
            } else {
                const stats = await fs.stat(itemPath);
                files.set(relativePath, {
                    path: itemPath,
                    relativePath,
                    isDirectory: false,
                    lastModified: stats.mtime,
                    size: stats.size,
                    contentHash: await calculateFileHash(itemPath)
                });
                
                console.log(`📄 Arquivo local: ${relativePath}`);
            }
        }
    } catch (error) {
        console.warn(`⚠️ Erro ao escanear ${currentPath}:`, error);
    }
}

/**
 * Compara estruturas local e servidor
 */
async function compareFileStructures(
    project: LocalProject,
    localFiles: Map<string, LocalFileInfo>,
    serverFiles: Map<string, ServerFileInfo>,
    differences: ServerDifference[]
): Promise<void> {
    
    // Verifica arquivos que existem localmente
    for (const [relativePath, localFile] of localFiles) {
        const serverFile = serverFiles.get(relativePath);
        
        if (!serverFile) {
            // Arquivo existe apenas localmente
            differences.push({
                path: localFile.path,
                relativePath,
                diffType: ServerDiffType.OnlyInLocal,
                isDirectory: localFile.isDirectory,
                localModified: localFile.lastModified,
                description: 'Existe apenas localmente'
            });
        } else if (!localFile.isDirectory && !serverFile.isDirectory) {
            // Compara conteúdo dos arquivos
            await compareFileContent(localFile, serverFile, differences);
        }
    }
    
    // Verifica arquivos que existem apenas no servidor
    for (const [relativePath, serverFile] of serverFiles) {
        if (!localFiles.has(relativePath)) {
            differences.push({
                path: path.join(project.localPath, relativePath),
                relativePath,
                diffType: ServerDiffType.OnlyInServer,
                isDirectory: serverFile.isDirectory,
                serverModified: serverFile.lastModified,
                description: 'Existe apenas no servidor'
            });
        }
    }
}

/**
 * Compara conteúdo de arquivos
 */
async function compareFileContent(
    localFile: LocalFileInfo,
    serverFile: ServerFileInfo,
    differences: ServerDifference[]
): Promise<void> {
    try {
        const serverContentResponse = await readFileService.call(configManager.CurrentSystem, serverFile.path);
        
        if (!serverContentResponse || IsFatalResponse(serverContentResponse)) {
            throw new Error(`Erro ao baixar arquivo: ${serverFile.relativePath}`);
        }
        
        // Extrai o conteúdo do arquivo (está em base64)
        const payload = serverContentResponse?.Rowsets?.Rowset?.Row?.find(
            (row) => row.Name == "Payload"
        );
        
        if (!payload || !payload.Value) {
            throw new Error(`Conteúdo não encontrado para: ${serverFile.relativePath}`);
        }
        
        const base64Content = payload.Value;
        console.log(`🔍 Base64 length: ${base64Content.length}`);
        console.log(`🔍 Base64 sample (50 chars): "${base64Content.substring(0, 50)}"`);
        
        // Lê o conteúdo local
        const localContent = await fs.readFile(localFile.path, 'utf8');
        
        // Decodifica o conteúdo do servidor da mesma forma que foi salvo no download
        const serverContent = Buffer.from(base64Content, 'base64').toString('utf8');
        
        console.log(`🔍 Comparando arquivo: ${localFile.relativePath}`);
        console.log(`� Tamanho local: ${localContent.length} | Servidor: ${serverContent.length}`);
        console.log(`📝 Conteúdo local (50 chars): "${localContent.substring(0, 50)}"`);
        console.log(`📝 Conteúdo servidor (50 chars): "${serverContent.substring(0, 50)}"`);
        
        // Compara diretamente os conteúdos como string
        if (localContent !== serverContent) {
            console.log(`❌ Conteúdos diferentes!`);
            differences.push({
                path: localFile.path,
                relativePath: localFile.relativePath,
                diffType: ServerDiffType.Different,
                isDirectory: false,
                localModified: localFile.lastModified,
                serverModified: serverFile.lastModified,
                description: 'Conteúdos diferentes'
            });
        } else {
            console.log(`✅ Conteúdos idênticos!`);
        }
        
    } catch (error) {
        console.warn(`⚠️ Erro ao comparar ${localFile.relativePath}:`, error);
        
        differences.push({
            path: localFile.path,
            relativePath: localFile.relativePath,
            diffType: ServerDiffType.Different,
            isDirectory: false,
            localModified: localFile.lastModified,
            serverModified: serverFile.lastModified,
            description: 'Erro na comparação'
        });
    }
}

/**
 * Calcula hash SHA-256 do arquivo
 */
async function calculateFileHash(filePath: string): Promise<string> {
    try {
        // Lê o arquivo como string UTF-8 para manter consistência com o servidor
        const content = await fs.readFile(filePath, 'utf8');
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        console.log(`📋 Hash calculado para ${path.basename(filePath)}: ${hash.substring(0, 8)}...`);
        return hash;
    } catch (error) {
        console.warn(`⚠️ Erro ao calcular hash de ${filePath}:`, error);
        return '';
    }
}

/**
 * Define status de verificação do projeto
 */
async function setProjectVerificationStatus(
    project: LocalProject, 
    status: ServerVerificationStatus,
    error?: string
): Promise<void> {
    if (!project.serverVerification) {
        project.serverVerification = {
            status,
            differences: [],
            lastChecked: new Date()
        };
    } else {
        project.serverVerification.status = status;
        project.serverVerification.lastChecked = new Date();
        if (error) {
            project.serverVerification.error = error;
        }
    }
}

/**
 * Mostra resultados da verificação
 */
async function showVerificationResults(project: LocalProject, verification: ServerVerification): Promise<void> {
    const diffCount = verification.differences.length;
    
    if (verification.status === ServerVerificationStatus.UpToDate) {
        vscode.window.showInformationMessage(
            `✅ Projeto "${project.name}" está sincronizado com o servidor!`
        );
    } else if (verification.status === ServerVerificationStatus.OutOfSync) {
        const action = await vscode.window.showWarningMessage(
            `⚠️ Projeto "${project.name}": encontradas ${diffCount} diferença(s) com o servidor`,
            'Ver Diferenças',
            'OK'
        );
        
        if (action === 'Ver Diferenças') {
            // Mostra painel detalhado com todas as diferenças
            await OnCommandShowServerDifferences(project);
        }
    } else if (verification.status === ServerVerificationStatus.Error) {
        vscode.window.showErrorMessage(
            `❌ Erro na verificação do projeto "${project.name}": ${verification.error}`
        );
    }
}

/**
 * Interfaces auxiliares
 */
interface ServerFileInfo {
    path: string;
    relativePath: string;
    isDirectory: boolean;
    lastModified?: Date;
    size?: number;
}

interface LocalFileInfo {
    path: string;
    relativePath: string;
    isDirectory: boolean;
    lastModified: Date;
    size?: number;
    contentHash?: string;
}
