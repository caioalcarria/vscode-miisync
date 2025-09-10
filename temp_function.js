"use strict";
/**
 * Realiza verificação super otimizada: baixa tudo silenciosamente e compara mappings
 */
async function performQuickIntegrityCheck(project) {
    const suspiciousFiles = [];
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
        const newMapping = tempDownloadResult.pathMapping;
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
                tempFiles: tempDownloadResult.tempFiles,
                newMapping: newMapping,
                downloadTime: downloadTime
            });
            console.log(`💾 Cache temporário salvo para ${differences.length} arquivos que precisam de verificação detalhada`);
        }
        else {
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
    }
    catch (error) {
        console.error('❌ Erro na verificação super rápida:', error);
        // Em caso de erro, marca todos os arquivos para verificação detalhada
        const currentMappingConfig = await PathMappingManager.loadMappingFile(project.localPath);
        return currentMappingConfig?.mappings.map(m => m.localPath) || [];
    }
}
//# sourceMappingURL=temp_function.js.map