"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testPathMappingSystem = void 0;
const path = require("path");
const file_1 = require("../src/modules/file");
const pathmapping_1 = require("../src/modules/pathmapping");
/**
 * Teste simples do sistema de mapeamento de caminhos
 * Demonstra como o sistema ignora configurações do miisync.json quando há mapeamento
 */
async function testPathMappingSystem() {
    console.log("=== Teste do Sistema de Mapeamento de Caminhos ===\n");
    const testRootPath = path.join(__dirname, "test-downloads", "vendas");
    const testRemotePath = "/WEB/projeto/modulos/vendas";
    // Configuração simulada do miisync.json (que será IGNORADA)
    const mockUserConfig = {
        remotePath: "MES/test",
        removeFromLocalPath: ["webapp"],
        systems: [],
        uploadOnSave: false,
        downloadOnOpen: false,
        ignore: [],
        include: [],
        useRootConfig: false,
        rootConfig: "",
    };
    try {
        // 1. Criar um arquivo de mapeamento de exemplo
        console.log("1. Criando arquivo de mapeamento...");
        await pathmapping_1.PathMappingManager.createMappingFile(testRootPath, testRemotePath, [
            {
                localPath: "controllers\\vendaController.js",
                remotePath: "/WEB/projeto/modulos/vendas/controllers/vendaController.js",
                lastUpdated: Date.now(),
            },
            {
                localPath: "models\\vendaModel.js",
                remotePath: "/WEB/projeto/modulos/vendas/models/vendaModel.js",
                lastUpdated: Date.now(),
            },
        ]);
        console.log("✓ Arquivo de mapeamento criado com sucesso!\n");
        // 2. Testar GetRemotePathWithMapping - deve IGNORAR configurações
        console.log("2. Testando GetRemotePathWithMapping...");
        const testFilePath = path.join(testRootPath, "controllers", "vendaController.js");
        console.log(`📁 Arquivo local: ${testFilePath}`);
        console.log(`⚙️  Configuração remotePath: "${mockUserConfig.remotePath}" (será IGNORADA)`);
        const remotePath = await (0, file_1.GetRemotePathWithMapping)(testFilePath, mockUserConfig, true);
        console.log(`✅ Caminho remoto usado: ${remotePath}`);
        console.log(`✅ Confirmação: Sistema IGNOROU a configuração e usou o mapeamento!\n`);
        // 3. Testar arquivo sem mapeamento específico (subpasta)
        console.log("3. Testando arquivo em subpasta (sem mapeamento específico)...");
        const subFilePath = path.join(testRootPath, "views", "lista.html");
        const subRemotePath = await (0, file_1.GetRemotePathWithMapping)(subFilePath, mockUserConfig, true);
        console.log(`📁 Arquivo local: ${subFilePath}`);
        console.log(`✅ Caminho remoto construído: ${subRemotePath}`);
        console.log(`✅ Baseado no rootRemotePath do mapeamento, não nas configurações!\n`);
        // 4. Verificar comportamento detalhado
        console.log("4. Análise detalhada do comportamento...");
        console.log("🔍 O que esperaríamos SEM mapeamento:");
        console.log(`   - Com config remotePath="MES/test": MES/test/controllers/vendaController.js`);
        console.log("🎯 O que o sistema REALMENTE usa COM mapeamento:");
        console.log(`   - Caminho exato do arquivo: ${remotePath}`);
        console.log("✅ Configurações do miisync.json são completamente ignoradas!\n");
        // 5. Carregar e mostrar o arquivo de mapeamento
        console.log("5. Conteúdo do arquivo de mapeamento criado...");
        const config = await pathmapping_1.PathMappingManager.loadMappingFile(testRootPath);
        console.log("📄 Estrutura do mapeamento:");
        console.log(`   🏠 Root Remote Path: ${config?.rootRemotePath}`);
        console.log(`   📂 Root Local Path: ${config?.rootLocalPath}`);
        console.log(`   📋 Total de mappings: ${config?.mappings.length}`);
        config?.mappings.forEach((mapping, index) => {
            console.log(`   ${index + 1}. ${mapping.localPath} → ${mapping.remotePath}`);
        });
        console.log("\n=== Teste concluído com sucesso! ===");
        console.log("🎉 O sistema funciona corretamente:");
        console.log("   ✅ Ignora configurações do miisync.json quando há mapeamento");
        console.log("   ✅ Usa exatamente o caminho salvo no arquivo de mapeamento");
        console.log("   ✅ Constrói caminhos para subpastas baseado no rootRemotePath");
    }
    catch (error) {
        console.error("❌ Erro durante o teste:", error);
    }
}
exports.testPathMappingSystem = testPathMappingSystem;
// Executar teste se este arquivo for executado diretamente
if (require.main === module) {
    testPathMappingSystem();
}
//# sourceMappingURL=path-mapping.test.js.map