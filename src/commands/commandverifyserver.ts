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
import { DownloadComplexLimited } from '../transfer/limited/downloadcomplex';

/**
 * Comando para verificar integridade com o servidor
 */
/**
 * Atualiza a metadata de um projeto antigo para incluir informações do servidor
 */
async function updateProjectMetadata(project: { localPath: string; remoteLocation: string }): Promise<void> {
    try {
        const mappingConfig = await PathMappingManager.loadMappingFile(project.localPath);
        if (!mappingConfig) {
            throw new Error('Não foi possível carregar mapping do projeto');
        }

        //console.log(`🔄 Atualizando metadata de ${mappingConfig.mappings.length} arquivos...`);
        
        const currentSystem = configManager.CurrentSystem;
        if (!currentSystem) {
            throw new Error('Sistema não configurado');
        }
        
        // Coleta todos os arquivos do servidor recursivamente
        const allFiles: Array<{ relativePath: string; serverPath: string; Modified: string }> = [];
        
        async function collectFiles(remotePath: string): Promise<void> {
            try {
                //console.log(`📁 Coletando de: ${remotePath}`);
                
                // Lista arquivos do diretório atual
                const serverFiles = await listFilesService.call(currentSystem, remotePath);
                if (serverFiles && !IsFatalResponse(serverFiles)) {
                    const fileItems = serverFiles?.Rowsets?.Rowset?.Row || [];
                    
                    for (const item of fileItems) {
                        const fullPath = item.FilePath + "/" + item.ObjectName;
                        let relativePath = fullPath.replace(project.remoteLocation, '').replace(/^\/+/, '');
                        relativePath = relativePath.replace(/\\/g, '/');
                        
                        if (relativePath) {
                            allFiles.push({
                                relativePath,
                                serverPath: fullPath,
                                Modified: item.Modified
                            });
                        }
                    }
                }
                
                // Lista e processa subpastas
                const serverFolders = await listFoldersService.call(currentSystem, remotePath);
                if (serverFolders && !IsFatalResponse(serverFolders)) {
                    const folderItems = serverFolders?.Rowsets?.Rowset?.Row || [];
                    
                    for (const folder of folderItems) {
                        await collectFiles(folder.Path);
                    }
                }
            } catch (error) {
                console.warn(`⚠️ Erro ao listar ${remotePath}:`, error);
            }
        }
        
        await collectFiles(project.remoteLocation);
        console.log(`📊 Coletados ${allFiles.length} arquivos do servidor`);
        
        // Atualiza metadata de cada arquivo no mapping
        let updatedCount = 0;
        for (const mapping of mappingConfig.mappings) {
            const serverFile = allFiles.find(f => f.relativePath === mapping.localPath);
            if (serverFile) {
                mapping.serverModified = serverFile.Modified;
                
                // Obtém a data de modificação local atual do arquivo
                const localFilePath = path.join(project.localPath, mapping.localPath);
                try {
                    const stats = await require('fs-extra').stat(localFilePath);
                    mapping.localModifiedAtDownload = stats.mtime.toISOString();
                } catch (error) {
                    console.warn(`⚠️ Erro ao obter data do arquivo ${mapping.localPath}:`, error);
                }
                
                // Detecta se é arquivo binário
                const ext = path.extname(mapping.localPath).toLowerCase();
                mapping.isBinary = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', 
                                  '.pdf', '.zip', '.rar', '.7z', '.exe', '.dll', '.bin',
                                  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.avi'].includes(ext);
                updatedCount++;
            }
        }
        
        // Salva mapping atualizado
        await PathMappingManager.saveUpdatedMapping(mappingConfig);
        console.log(`✅ Metadata atualizada! ${updatedCount} de ${mappingConfig.mappings.length} arquivos processados.`);
        
    } catch (error) {
        console.error('❌ Erro ao atualizar metadata:', error);
        throw error;
    }
}

export async function OnCommandVerifyServer(localProject?: LocalProject | LocalProjectTreeItem): Promise<void> {
    if (!localProject) {
        vscode.window.showErrorMessage('❌ Projeto não especificado para verificação');
        return;
    }

    // Se é TreeItem, extrai o projeto
    let project: LocalProject;
    if (localProject instanceof vscode.TreeItem) {
        // É LocalProjectTreeItem
        const treeItem = localProject as LocalProjectTreeItem;
        if (!treeItem.project) {
            vscode.window.showErrorMessage('❌ Projeto não encontrado no item da árvore');
            return;
        }
        project = treeItem.project;
    } else {
        // É LocalProject diretamente
        project = localProject as LocalProject;
    }

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
        // 1. Verificação rápida baseada em metadata local
        console.log(`� Iniciando verificação rápida: ${project.name}`);
        const quickCheckResults = await performQuickIntegrityCheck(project);
        
        if (quickCheckResults.length === 0) {
            console.log(`✅ Verificação rápida: Nenhuma divergência encontrada`);
            return {
                status: ServerVerificationStatus.UpToDate,
                lastChecked: new Date(),
                differences: [],
            };
        }
        
        // Verifica se a maioria dos arquivos não tem metadata (projeto antigo)
        const mappingConfig = await PathMappingManager.loadMappingFile(project.localPath);
        const filesWithoutMetadata = mappingConfig?.mappings.filter(m => !m.serverModified).length || 0;
        const totalFiles = mappingConfig?.mappings.length || 0;
        
        if (filesWithoutMetadata > totalFiles * 0.8) { // Se mais de 80% não tem metadata
            //console.log(`🔄 Projeto parece ser de versão anterior - atualizando metadata...`);
            await updateProjectMetadata({ localPath: project.localPath, remoteLocation: project.remotePath });
            console.log(`✅ Metadata atualizada! Execute a verificação novamente.`);
            
            return {
                status: ServerVerificationStatus.UpToDate,
                lastChecked: new Date(),
                differences: [],
                error: 'Metadata atualizada. Execute a verificação novamente.'
            };
        }
        
        console.log(`⚠️ Verificação rápida: ${quickCheckResults.length} arquivos precisam de verificação detalhada`);
        
        // 2. Verificação detalhada apenas dos arquivos com divergências
        console.log(`� Iniciando verificação detalhada de ${quickCheckResults.length} arquivos...`);
        await performDetailedVerification(project, quickCheckResults, differences);
        
        // 3. Determina status final
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
        };
    }
}

/**
 * Realiza verificação rápida otimizada baseada em metadata local vs servidor
 * COMENTADO PARA IMPLEMENTAR NOVA VERSÃO
 */
/*
async function performQuickIntegrityCheck_OLD(project: LocalProject): Promise<string[]> {
    const suspiciousFiles: string[] = [];
    
    try {
        // Carrega o arquivo de mapeamento
        const mappingConfig = await PathMappingManager.loadMappingFile(project.localPath);
        if (!mappingConfig) {
            console.log(`⚠️ Nenhum arquivo de mapeamento encontrado para ${project.name}`);
            return [];
        }

        console.log(`� DEBUG: Iniciando verificação rápida otimizada para ${mappingConfig.mappings.length} arquivos`);
        
        // ETAPA 1: Verificações locais (sem chamadas ao servidor)
        console.log(`� ETAPA 1: Verificações locais rápidas...`);
        
        const localChecks = await Promise.all(
            mappingConfig.mappings.map(async (mapping) => {
                const localFilePath = path.join(project.localPath, mapping.localPath);
                
                // Verifica se arquivo existe
                if (!await fs.pathExists(localFilePath)) {
                    return { mapping, reason: 'arquivo_removido', needsCheck: true };
                }
                
                // Verifica se está nos arquivos modificados
                const isModified = project.modifiedFiles.some(mf => 
                    path.normalize(mf.filePath) === path.normalize(localFilePath)
                );
                if (isModified) {
                    return { mapping, reason: 'modificado_localmente', needsCheck: true };
                }
                
                // Verifica data local vs download
                if (!mapping.localModifiedAtDownload) {
                    return { mapping, reason: 'sem_metadata_local', needsCheck: true };
                }
                
                const stats = await fs.stat(localFilePath);
                const localModified = stats.mtime;
                const savedLocalModified = new Date(mapping.localModifiedAtDownload);
                const localTimeDiff = Math.abs(localModified.getTime() - savedLocalModified.getTime());
                
                if (localTimeDiff > 1000) {
                    return { mapping, reason: 'modificado_localmente_data', needsCheck: true };
                }
                
                // Arquivo não foi modificado localmente
                return { mapping, reason: 'ok_local', needsCheck: false };
            })
        );
        
        // Filtra arquivos que precisam de verificação por problemas locais
        const localProblems = localChecks.filter(check => check.needsCheck);
        const localOkFiles = localChecks.filter(check => !check.needsCheck);
        
        console.log(`📊 Verificações locais:`);
        console.log(`   ❌ Problemas locais: ${localProblems.length}`);
        console.log(`   ✅ OK localmente: ${localOkFiles.length}`);
        
        // Adiciona arquivos com problemas locais à lista suspeita
        localProblems.forEach(problem => {
            console.log(`   - ${problem.mapping.localPath}: ${problem.reason}`);
            suspiciousFiles.push(problem.mapping.localPath);
        });
        
        // ETAPA 2: Verificação de servidor em lote (apenas para arquivos OK localmente)
        if (localOkFiles.length > 0) {
            console.log(`🌐 ETAPA 2: Verificando ${localOkFiles.length} arquivos no servidor...`);
            
            // Baixa TODA a estrutura do servidor de uma vez
            const serverFileMap = await getServerFileStructureFast(project.remotePath);
            console.log(`📡 Estrutura do servidor baixada: ${serverFileMap.size} itens`);
            
            // Compara datas do servidor em memória (super rápido)
            const serverChecks = localOkFiles
                .map(check => {
                    const mapping = check.mapping;
                    
                    if (!mapping.serverModified) {
                        return { mapping, reason: 'sem_metadata_servidor', needsCheck: true };
                    }
                    
                    // Encontra arquivo no servidor
                    const serverFile = serverFileMap.get(mapping.localPath);
                    if (!serverFile) {
                        return { mapping, reason: 'nao_existe_servidor', needsCheck: true };
                    }
                    
                    // Compara datas do servidor
                    const savedServerDate = new Date(mapping.serverModified);
                    const currentServerDate = serverFile.lastModified || new Date(0);
                    const serverTimeDiff = Math.abs(currentServerDate.getTime() - savedServerDate.getTime());
                    
                    if (serverTimeDiff > 1000) {
                        return { mapping, reason: 'modificado_servidor', needsCheck: true };
                    }
                    
                    return { mapping, reason: 'sincronizado', needsCheck: false };
                })
                .filter(check => check.needsCheck);
            
            console.log(`📊 Verificações de servidor:`);
            console.log(`   🌐 Mudanças no servidor: ${serverChecks.length}`);
            console.log(`   ✅ Sincronizados: ${localOkFiles.length - serverChecks.length}`);
            
            // Adiciona arquivos com mudanças no servidor
            serverChecks.forEach(problem => {
                console.log(`   - ${problem.mapping.localPath}: ${problem.reason}`);
                suspiciousFiles.push(problem.mapping.localPath);
            });
        }
        
        console.log(`🔍 Verificação rápida otimizada concluída:`);
        console.log(`   📊 Total de arquivos: ${mappingConfig.mappings.length}`);
        console.log(`   ⚠️ Precisam de verificação detalhada: ${suspiciousFiles.length}`);
        console.log(`   ✅ Presumivelmente iguais: ${mappingConfig.mappings.length - suspiciousFiles.length}`);
        
        return suspiciousFiles;
        
    } catch (error) {
        console.error('❌ Erro na verificação rápida:', error);
        return [];
    }
}
*/

/**
 * Realiza verificação super otimizada: baixa tudo silenciosamente e compara mappings
 */
async function performQuickIntegrityCheck(project: LocalProject): Promise<string[]> {
    const suspiciousFiles: string[] = [];
    
    try {
        // Carrega o mapping atual
        const currentMappingConfig = await PathMappingManager.loadMappingFile(project.localPath);
        if (!currentMappingConfig) {
            console.log(`⚠️ Nenhum arquivo de mapeamento encontrado para ${project.name}`);
            return [];
        }

        console.log(`🚀 Iniciando verificação super rápida para ${currentMappingConfig.mappings.length} arquivos`);
        console.log(`💡 Estratégia: Download silencioso + comparação de mappings`);
        
        const startTime = Date.now();
        
        // ETAPA 1: Download silencioso de todo o projeto
        console.log(`📡 Baixando projeto silenciosamente...`);
        const tempDownloadResult = await downloadProjectSilently(project.remotePath);
        
        if (!tempDownloadResult.success) {
            console.log(`❌ Erro no download silencioso, voltando para verificação detalhada de todos os arquivos`);
            return currentMappingConfig.mappings.map(m => m.localPath);
        }
        
        const downloadTime = Date.now() - startTime;
        console.log(`⚡ Download silencioso concluído em ${downloadTime}ms`);
        
        // ETAPA 2: Compara os mappings em memória (super rápido)
        console.log(`🔍 Comparando mappings...`);
        const compareStartTime = Date.now();
        
        const newMapping = tempDownloadResult.pathMapping!;
        const differences = compareMappings(currentMappingConfig.mappings, newMapping);
        
        const compareTime = Date.now() - compareStartTime;
        console.log(`⚡ Comparação concluída em ${compareTime}ms`);
        
        // ETAPA 3: Identifica arquivos que mudaram
        differences.forEach(diff => {
            console.log(`📝 Diferença encontrada: ${diff.relativePath} - ${diff.reason}`);
            suspiciousFiles.push(diff.relativePath);
        });
        
        // ETAPA 4: Salva os arquivos baixados para uso na verificação detalhada
        if (differences.length > 0) {
            tempDownloadCache.set(project.localPath, {
                tempFiles: tempDownloadResult.tempFiles!,
                newMapping: newMapping,
                downloadTime: downloadTime
            });
            console.log(`💾 Cache temporário salvo para ${differences.length} arquivos que precisam de verificação detalhada`);
        } else {
            // Se não há diferenças, pode apagar tudo
            await cleanupTempFiles(tempDownloadResult.tempFiles);
            console.log(`🗑️ Arquivos temporários removidos (projeto sincronizado)`);
        }
        
        const totalTime = Date.now() - startTime;
        console.log(`\n🎯 RESULTADO DA VERIFICAÇÃO RÁPIDA:`);
        console.log(`   ⏱️ Tempo total: ${totalTime}ms`);
        console.log(`   📊 Total de arquivos: ${currentMappingConfig.mappings.length}`);
        console.log(`   ⚠️ Precisam de verificação detalhada: ${suspiciousFiles.length}`);
        console.log(`   ✅ Sincronizados: ${currentMappingConfig.mappings.length - suspiciousFiles.length}`);
        
        return suspiciousFiles;
        
    } catch (error) {
        console.error('❌ Erro na verificação super rápida:', error);
        // Em caso de erro, marca todos os arquivos para verificação detalhada
        const currentMappingConfig = await PathMappingManager.loadMappingFile(project.localPath);
        return currentMappingConfig?.mappings.map(m => m.localPath) || [];
    }
}

/**
 * Realiza verificação detalhada usando arquivos já baixados no cache temporário
 */
async function performDetailedVerification(
    project: LocalProject, 
    suspiciousFiles: string[], 
    differences: ServerDifference[]
): Promise<void> {
    try {
        console.log(`🔍 Iniciando verificação detalhada de ${suspiciousFiles.length} arquivos...`);
        
        // Verifica se temos o cache temporário com os arquivos já baixados
        const tempCache = tempDownloadCache.get(project.localPath);
        
        if (tempCache) {
            console.log(`💾 Usando arquivos do cache temporário (download em ${tempCache.downloadTime}ms)`);
            
            // Usa os arquivos já baixados para verificação
            await performDetailedVerificationFromCache(project, suspiciousFiles, differences, tempCache);
            
            // Limpa o cache temporário
            await cleanupTempFiles(tempCache.tempFiles);
            tempDownloadCache.delete(project.localPath);
            console.log(`🗑️ Cache temporário removido`);
            
        } else {
            console.log(`⚠️ Cache temporário não encontrado, fazendo verificação detalhada tradicional`);
            await performDetailedVerificationTraditional(project, suspiciousFiles, differences);
        }
        
    } catch (error) {
        console.error('❌ Erro na verificação detalhada:', error);
        
        // Em caso de erro, limpa o cache se existir
        const tempCache = tempDownloadCache.get(project.localPath);
        if (tempCache) {
            await cleanupTempFiles(tempCache.tempFiles);
            tempDownloadCache.delete(project.localPath);
        }
    }
}

/**
 * Verificação detalhada usando arquivos do cache temporário (super rápida)
 */
async function performDetailedVerificationFromCache(
    project: LocalProject,
    suspiciousFiles: string[],
    differences: ServerDifference[],
    tempCache: { tempFiles: Map<string, string>; newMapping: any[]; downloadTime: number }
): Promise<void> {
    console.log(`⚡ Verificação detalhada usando cache: ${suspiciousFiles.length} arquivos`);
    
    for (const relativePath of suspiciousFiles) {
        try {
            const localFilePath = path.join(project.localPath, relativePath);
            const tempFilePath = tempCache.tempFiles.get(relativePath);
            
            console.log(`🔍 Verificando: ${relativePath}`);
            
            if (!tempFilePath || !await fs.pathExists(tempFilePath)) {
                console.log(`❌ Arquivo temporário não encontrado para: ${relativePath}`);
                differences.push({
                    path: localFilePath,
                    relativePath,
                    diffType: ServerDiffType.OnlyInLocal,
                    isDirectory: false,
                    localModified: await fs.pathExists(localFilePath) ? (await fs.stat(localFilePath)).mtime : new Date(),
                    description: 'Não existe no servidor'
                });
                continue;
            }
            
            // Verifica se arquivo local existe
            if (!await fs.pathExists(localFilePath)) {
                console.log(`📄 Arquivo novo no servidor: ${relativePath}`);
                differences.push({
                    path: localFilePath,
                    relativePath,
                    diffType: ServerDiffType.OnlyInServer,
                    isDirectory: false,
                    serverModified: (await fs.stat(tempFilePath)).mtime,
                    description: 'Novo no servidor'
                });
                continue;
            }
            
            // Carrega metadata do novo download
            const serverMapping = tempCache.newMapping.find(m => m.localPath === relativePath);
            
            // Compara os arquivos usando hash ou data
            const localStats = await fs.stat(localFilePath);
            const tempStats = await fs.stat(tempFilePath);
            
            // Se temos info binária/texto, usa estratégia apropriada
            if (serverMapping?.isBinary) {
                // Para arquivos binários, compara tamanho e timestamp
                if (localStats.size !== tempStats.size) {
                    console.log(`📝 Arquivo binário alterado (tamanho): ${relativePath}`);
                    differences.push({
                        path: localFilePath,
                        relativePath,
                        diffType: ServerDiffType.Different,
                        isDirectory: false,
                        localModified: localStats.mtime,
                        serverModified: tempStats.mtime,
                        description: `Arquivo binário modificado (local: ${localStats.size}b, servidor: ${tempStats.size}b)`
                    });
                    continue;
                }
            } else {
                // Para arquivos de texto, compara conteúdo
                const localContent = await fs.readFile(localFilePath, 'utf8');
                const serverContent = await fs.readFile(tempFilePath, 'utf8');
                
                if (localContent !== serverContent) {
                    console.log(`📝 Arquivo de texto alterado: ${relativePath}`);
                    differences.push({
                        path: localFilePath,
                        relativePath,
                        diffType: ServerDiffType.Different,
                        isDirectory: false,
                        localModified: localStats.mtime,
                        serverModified: tempStats.mtime,
                        description: 'Conteúdo modificado'
                    });
                    continue;
                }
            }
            
            console.log(`✅ Arquivo idêntico: ${relativePath}`);
            
        } catch (error) {
            console.error(`❌ Erro ao verificar ${relativePath}:`, error);
        }
    }
}

/**
 * Verificação detalhada tradicional (fallback)
 */
async function performDetailedVerificationTraditional(
    project: LocalProject,
    suspiciousFiles: string[],
    differences: ServerDifference[]
): Promise<void> {
    const currentSystem = configManager.CurrentSystem;
    if (!currentSystem) {
        throw new Error('Sistema não configurado');
    }
    
    for (const relativePath of suspiciousFiles) {
        try {
            const localFilePath = path.join(project.localPath, relativePath);
            
            // Obtém o caminho remoto através do mapeamento
            const remotePath = await PathMappingManager.getRemotePathFromMapping(localFilePath);
            if (!remotePath) {
                console.warn(`⚠️ Caminho remoto não encontrado para: ${relativePath}`);
                continue;
            }
            
            console.log(`🔍 DEBUG: Verificação detalhada: ${relativePath}`);
            console.log(`   - Local: ${localFilePath}`);
            console.log(`   - Remoto: ${remotePath}`);
            
            // Primeiro, obtém informações do arquivo no servidor (não o conteúdo)
            const serverDirPath = path.dirname(remotePath).replace(/\\/g, '/');
            const serverFileName = path.basename(remotePath);
            
            //console.log(`📁 DEBUG: Listando diretório: ${serverDirPath}`);
            const serverDirResponse = await listFilesService.call(currentSystem, serverDirPath);
            
            let serverFileInfo = null;
            if (serverDirResponse && !IsFatalResponse(serverDirResponse)) {
                const fileItems = serverDirResponse?.Rowsets?.Rowset?.Row || [];
                serverFileInfo = fileItems.find(item => item.ObjectName === serverFileName);
                console.log(`📄 DEBUG: Arquivo encontrado no servidor: ${!!serverFileInfo}`);
                if (serverFileInfo) {
                    console.log(`   - Modified: ${serverFileInfo.Modified}`);
                    console.log(`   - Size: ${serverFileInfo.Size}`);
                }
            }
            
            if (!serverFileInfo) {
                console.log(`❌ DEBUG: Arquivo não existe no servidor: ${relativePath}`);
                differences.push({
                    path: localFilePath,
                    relativePath,
                    diffType: ServerDiffType.OnlyInLocal,
                    isDirectory: false,
                    localModified: (await fs.stat(localFilePath)).mtime,
                    description: 'Existe apenas localmente'
                });
                continue;
            }
            
            // Carrega metadata local salva
            const mappingConfig = await PathMappingManager.loadMappingFile(project.localPath);
            const mapping = mappingConfig?.mappings.find(m => m.localPath === relativePath);
            console.log(`💾 DEBUG: Metadata local salva - serverModified: ${mapping?.serverModified}`);
            
            // COMPARAÇÃO DE DATAS DO SERVIDOR
            if (mapping?.serverModified && serverFileInfo.Modified) {
                const savedServerDate = new Date(mapping.serverModified);
                const currentServerDate = new Date(serverFileInfo.Modified);
                const serverTimeDiff = Math.abs(currentServerDate.getTime() - savedServerDate.getTime());
                
                console.log(`🕐 DEBUG: Comparação datas servidor:`);
                console.log(`   - Salva: ${savedServerDate.toISOString()}`);
                console.log(`   - Atual: ${currentServerDate.toISOString()}`);
                console.log(`   - Diferença: ${serverTimeDiff}ms`);
                
                if (serverTimeDiff <= 1000) {
                    console.log(`✅ DEBUG: Arquivo não mudou no servidor, ignorando: ${relativePath}`);
                    continue; // Não mudou no servidor, pula verificação de conteúdo
                } else {
                    console.log(`⚠️ DEBUG: Arquivo mudou no servidor! Verificando conteúdo...`);
                }
            } else {
                console.log(`⚠️ DEBUG: Sem data para comparar, verificando conteúdo...`);
            }
            
            // Agora baixa o conteúdo para comparar
            const serverResponse = await readFileService.call(currentSystem, remotePath);
            if (!serverResponse || IsFatalResponse(serverResponse)) {
                console.log(`❌ DEBUG: Erro ao baixar conteúdo do servidor: ${relativePath}`);
                continue;
            }
            
            const payload = serverResponse?.Rowsets?.Rowset?.Row?.find(row => row.Name === "Payload");
            if (!payload?.Value) {
                console.warn(`⚠️ DEBUG: Payload não encontrado para: ${relativePath}`);
                continue;
            }
            
            console.log(`📦 DEBUG: Payload encontrado, tamanho: ${payload.Value.length} chars`);
            
            // Detecta se é arquivo binário
            const extension = path.extname(localFilePath).toLowerCase();
            const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', 
                                     '.woff', '.woff2', '.ttf', '.otf', '.eot',
                                     '.pdf', '.zip', '.rar', '.7z', '.exe', '.dll',
                                     '.mp3', '.mp4', '.avi', '.mov', '.wav'];
            const isBinary = binaryExtensions.includes(extension);
            
            let contentsDifferent = false;
            
            if (isBinary) {
                // Compara arquivos binários
                const localBuffer = await fs.readFile(localFilePath);
                const serverBuffer = Buffer.from(payload.Value, 'base64');
                contentsDifferent = !localBuffer.equals(serverBuffer);
                
                console.log(`📊 ${relativePath} (BINÁRIO): ${contentsDifferent ? 'DIFERENTES' : 'IGUAIS'}`);
            } else {
                // Compara arquivos de texto
                const localContent = await fs.readFile(localFilePath, 'utf8');
                const serverContent = Buffer.from(payload.Value, 'base64').toString('utf8');
                contentsDifferent = localContent !== serverContent;
                
                console.log(`📊 ${relativePath} (TEXTO): ${contentsDifferent ? 'DIFERENTES' : 'IGUAIS'}`);
            }
            
            if (contentsDifferent) {
                differences.push({
                    path: localFilePath,
                    relativePath,
                    diffType: ServerDiffType.Different,
                    isDirectory: false,
                    localModified: (await fs.stat(localFilePath)).mtime,
                    description: 'Conteúdos diferentes'
                });
            }
            
        } catch (error) {
            console.error(`❌ Erro verificando ${relativePath}:`, error);
            differences.push({
                path: path.join(project.localPath, relativePath),
                relativePath,
                diffType: ServerDiffType.Different, // Como fallback para erro
                isDirectory: false,
                description: `Erro na verificação: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
            });
        }
    }
}

/**
 * Obtém estrutura de arquivos do servidor de forma otimizada (uma única varredura recursiva)
 */
async function getServerFileStructureFast(remotePath: string): Promise<Map<string, ServerFileInfo>> {
    const files = new Map<string, ServerFileInfo>();
    
    try {
        const currentSystem = configManager.CurrentSystem;
        if (!currentSystem) {
            throw new Error('Sistema não configurado');
        }
        
        console.log(`🚀 Fazendo varredura rápida do servidor: "${remotePath}"`);
        const startTime = Date.now();
        
        // Faz busca recursiva otimizada
        await scanServerDirectoryFast(currentSystem, remotePath, remotePath, files);
        
        const duration = Date.now() - startTime;
        console.log(`⚡ Varredura concluída em ${duration}ms. Total: ${files.size} itens`);
        
    } catch (error) {
        console.error('❌ Erro ao fazer varredura rápida do servidor:', error);
    }
    
    return files;
}

/**
 * Função recursiva otimizada para escanear diretórios do servidor
 */
async function scanServerDirectoryFast(
    system: any,
    currentPath: string,
    basePath: string,
    files: Map<string, ServerFileInfo>
): Promise<void> {
    try {
        // Faz as duas chamadas em paralelo para ser mais rápido
        const [serverFiles, serverFolders] = await Promise.all([
            listFilesService.call(system, currentPath),
            listFoldersService.call(system, currentPath)
        ]);
        
        // Processa arquivos
        if (serverFiles && !IsFatalResponse(serverFiles)) {
            const fileItems = serverFiles?.Rowsets?.Rowset?.Row || [];
            
            fileItems.forEach(item => {
                const fullPath = item.FilePath + "/" + item.ObjectName;
                let relativePath = fullPath.replace(basePath, '').replace(/^\/+/, '');
                relativePath = relativePath.replace(/\\/g, '/');
                
                if (relativePath) {
                    files.set(relativePath, {
                        path: fullPath,
                        relativePath,
                        isDirectory: false,
                        lastModified: item.Modified ? new Date(item.Modified) : undefined,
                        size: undefined // Size não está disponível no tipo File
                    });
                }
            });
        }
        
        // Processa pastas e faz chamadas recursivas em paralelo
        if (serverFolders && !IsFatalResponse(serverFolders)) {
            const folderItems = serverFolders?.Rowsets?.Rowset?.Row || [];
            
            // Adiciona pastas ao mapa
            folderItems.forEach(folder => {
                let relativePath = folder.Path.replace(basePath, '').replace(/^\/+/, '');
                relativePath = relativePath.replace(/\\/g, '/');
                
                if (relativePath) {
                    files.set(relativePath, {
                        path: folder.Path,
                        relativePath,
                        isDirectory: true,
                        lastModified: undefined,
                        size: undefined
                    });
                }
            });
            
            // Processa subpastas em paralelo (máximo 5 simultâneas para não sobrecarregar)
            const batchSize = 5;
            for (let i = 0; i < folderItems.length; i += batchSize) {
                const batch = folderItems.slice(i, i + batchSize);
                await Promise.all(
                    batch.map(folder => 
                        scanServerDirectoryFast(system, folder.Path, basePath, files)
                    )
                );
            }
        }
        
    } catch (error) {
        console.warn(`⚠️ Erro ao escanear ${currentPath}:`, error);
    }
}

/**
 * Obtém estrutura de arquivos do servidor recursivamente (versão antiga - mantida para compatibilidade)
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
        //console.log(`📁 Escaneando diretório do servidor: "${currentPath}"`);
        
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
            //console.log(`📁 Encontradas ${folderItems.length} pastas em "${currentPath}"`);
            
            for (const folder of folderItems) {
                const folderPath = folder.Path;
                // Calcula o caminho relativo da pasta
                let relativePath = folderPath.replace(basePath, '').replace(/^\/+/, '');
                relativePath = relativePath.replace(/\\/g, '/'); // Converte \ para /
                
                if (relativePath) {
                    //console.log(`📁 Pasta servidor: "${relativePath}" (full: ${folderPath})`);
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
                
                //console.log(`📁 Pasta local: ${relativePath}`);
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
        //console.log(`📋 Hash calculado para ${path.basename(filePath)}: ${hash.substring(0, 8)}...`);
        return hash;
    } catch (error) {
       // console.warn(`⚠️ Erro ao calcular hash de ${filePath}:`, error);
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

// Cache para arquivos temporários baixados
const tempDownloadCache = new Map<string, {
    tempFiles: Map<string, string>; // relativePath -> tempFilePath
    newMapping: any[];
    downloadTime: number;
}>();

/**
 * Baixa todo o projeto silenciosamente para um diretório temporário
 */
async function downloadProjectSilently(remotePath: string): Promise<{
    success: boolean;
    tempFiles?: Map<string, string>; // relativePath -> tempFilePath
    pathMapping?: any[];
    error?: string;
}> {
    try {
        console.log(`📡 Iniciando download silencioso de: ${remotePath}`);
        
        // Cria diretório temporário
        const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'miisync-verify-'));
       // console.log(`📁 Diretório temporário: ${tempDir}`);
        
        const currentSystem = configManager.CurrentSystem;
        const userConfig = configManager.SelfConfig;
        
        if (!currentSystem || !userConfig) {
            return { success: false, error: 'Sistema não configurado' };
        }
        
        // Usa a função de download existente
        const complexFolder = {
            folder: null,
            path: remotePath,
            isRemotePath: true,
            files: [],
            folders: []
        };
        
        // Função para gerar caminhos no diretório temporário
        const getPath = (item: any) => {
            const relativePath = item.FilePath ? 
                path.join(item.FilePath.replace(remotePath, ''), item.ObjectName) :
                item.Path.replace(remotePath, '');
            return path.join(tempDir, relativePath);
        };
        
        // Executa o download
        const downloadResult = await DownloadComplexLimited(
            complexFolder,
            getPath,
            userConfig,
            currentSystem
        );
        
        if (downloadResult.aborted) {
            await fs.remove(tempDir);
            return { success: false, error: 'Download abortado' };
        }
        
        // Carrega o mapping gerado
        const mappingFile = path.join(tempDir, '.miisync', 'path-mapping.json');
        let pathMapping: any[] = [];
        
        if (await fs.pathExists(mappingFile)) {
            const mappingData = await fs.readJson(mappingFile);
            pathMapping = mappingData.mappings || [];
        }
        
        // Cria mapa de arquivos temporários
        const tempFiles = new Map<string, string>();
        for (const mapping of pathMapping) {
            tempFiles.set(mapping.localPath, path.join(tempDir, mapping.localPath));
        }
        
        console.log(`✅ Download silencioso concluído: ${pathMapping.length} arquivos`);
        
        return {
            success: true,
            tempFiles,
            pathMapping
        };
        
    } catch (error) {
        console.error('❌ Erro no download silencioso:', error);
        return { success: false, error: error.toString() };
    }
}

/**
 * Compara dois arrays de mappings e retorna as diferenças
 */
function compareMappings(currentMappings: any[], newMappings: any[]): { relativePath: string; reason: string }[] {
    const differences: { relativePath: string; reason: string }[] = [];
    
    // Cria maps para comparação rápida
    const currentMap = new Map(currentMappings.map(m => [m.localPath, m]));
    const newMap = new Map(newMappings.map(m => [m.localPath, m]));
    
    // Verifica arquivos que existem no mapping atual
    for (const [relativePath, currentMapping] of currentMap) {
        const newMapping = newMap.get(relativePath);
        
        if (!newMapping) {
            differences.push({ relativePath, reason: 'removido_do_servidor' });
            continue;
        }
        
        // Compara datas do servidor
        if (currentMapping.serverModified && newMapping.serverModified) {
            const currentDate = new Date(currentMapping.serverModified);
            const newDate = new Date(newMapping.serverModified);
            
            if (Math.abs(newDate.getTime() - currentDate.getTime()) > 1000) {
                differences.push({ relativePath, reason: 'modificado_servidor' });
                continue;
            }
        } else if (!currentMapping.serverModified && newMapping.serverModified) {
            differences.push({ relativePath, reason: 'nova_metadata_servidor' });
            continue;
        }
        
        // Compara hash de conteúdo se disponível
        if (currentMapping.contentHash && newMapping.contentHash) {
            if (currentMapping.contentHash !== newMapping.contentHash) {
                differences.push({ relativePath, reason: 'conteudo_alterado' });
                continue;
            }
        }
    }
    
    // Verifica arquivos novos no servidor
    for (const [relativePath, newMapping] of newMap) {
        if (!currentMap.has(relativePath)) {
            differences.push({ relativePath, reason: 'novo_no_servidor' });
        }
    }
    
    return differences;
}

/**
 * Remove arquivos temporários
 */
async function cleanupTempFiles(tempFiles: Map<string, string>) {
    if (!tempFiles || tempFiles.size === 0) return;
    
    try {
        // Obtém o diretório base dos arquivos temporários
        const firstTempFile = tempFiles.values().next().value;
        if (firstTempFile) {
            const tempDir = path.dirname(firstTempFile);
            // Vai subindo até encontrar o diretório raiz temporário
            let currentDir = tempDir;
            while (path.basename(currentDir).startsWith('miisync-verify-') === false) {
                const parent = path.dirname(currentDir);
                if (parent === currentDir) break;
                currentDir = parent;
            }
            
            if (path.basename(currentDir).startsWith('miisync-verify-')) {
                await fs.remove(currentDir);
                console.log(`🗑️ Diretório temporário removido: ${currentDir}`);
            }
        }
    } catch (error) {
        console.warn('⚠️ Erro ao limpar arquivos temporários:', error);
    }
}
