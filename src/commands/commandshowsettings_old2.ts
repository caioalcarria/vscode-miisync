import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';

/**
 * 🎨 TELA DE CONFIGURAÇÕES MIISYNC - DESIGN MODERNO
 * Interface moderna, limpa e intuitiva para configurar a extensão
 */
export async function OnCommandShowSettings(): Promise<void> {
    // Cria painel de configurações
    const panel = vscode.window.createWebviewPanel(
        'miisyncSettingsPanel',
        '⚙️ Configurações MiiSync',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: []
        }
    );

    // Carrega configurações atuais
    const currentConfig = await loadCurrentConfig();
    
    // Gera HTML da interface
    panel.webview.html = getSettingsHTML(currentConfig);

    // Manipula mensagens do WebView
    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'saveSettings':
                    await saveSettings(message.config);
                    vscode.window.showInformationMessage('✅ Configurações salvas com sucesso!');
                    break;
                case 'resetSettings':
                    const confirm = await vscode.window.showWarningMessage(
                        '⚠️ Tem certeza que deseja restaurar as configurações padrão?',
                        'Sim, restaurar',
                        'Cancelar'
                    );
                    if (confirm === 'Sim, restaurar') {
                        await resetToDefaults();
                        panel.webview.html = getSettingsHTML(await loadCurrentConfig());
                        vscode.window.showInformationMessage('🔄 Configurações restauradas para o padrão');
                    }
                    break;
                case 'testConnection':
                    vscode.window.showInformationMessage('🔍 Testando conexão... (Funcionalidade em desenvolvimento)');
                    break;
            }
        },
        undefined
    );
}

/**
 * 📖 Carrega configuração atual do miisync.json
 */
async function loadCurrentConfig(): Promise<any> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return getDefaultConfig();

        // Procura miisync.json em todas as pastas da workspace
        for (const folder of workspaceFolders) {
            // Tenta primeiro em .vscode/miisync.json
            const vsCodeConfigPath = path.join(folder.uri.fsPath, '.vscode', 'miisync.json');
            if (await fs.pathExists(vsCodeConfigPath)) {
                console.log(`📖 Carregando configuração de: ${vsCodeConfigPath}`);
                const config = await fs.readJson(vsCodeConfigPath);
                
                // Mescla com configuração padrão para garantir que todos os campos existam
                const fullConfig = { ...getDefaultConfig(), ...config };
                console.log('✅ Configuração carregada:', Object.keys(fullConfig));
                return fullConfig;
            }
            
            // Se não encontrar, tenta na raiz
            const configPath = path.join(folder.uri.fsPath, 'miisync.json');
            if (await fs.pathExists(configPath)) {
                console.log(`📖 Carregando configuração de: ${configPath}`);
                const config = await fs.readJson(configPath);
                
                // Mescla com configuração padrão para garantir que todos os campos existam
                const fullConfig = { ...getDefaultConfig(), ...config };
                console.log('✅ Configuração carregada:', Object.keys(fullConfig));
                return fullConfig;
            }
        }
        
        console.log('⚠️ miisync.json não encontrado, usando configuração padrão');
        return getDefaultConfig();
    } catch (error) {
        console.error('❌ Erro ao carregar configuração:', error);
        vscode.window.showWarningMessage(`⚠️ Erro ao carregar miisync.json: ${error}`);
        return getDefaultConfig();
    }
}

/**
 * 📋 Configuração padrão baseada no formato real do miisync.json
 */
function getDefaultConfig(): any {
    return {
        uploadOnSave: false,
        downloadOnOpen: true,
        systems: [
            {
                name: "",
                severity: "2-high",
                isMain: true,
                host: "",
                port: 8000,
                username: "",
                password: ""
            }
        ],
        removeFromLocalPath: ["webapp"],
        remotePath: "MES/",
        ignore: [
            "**/.git/**",
            "**/.svn/**",
            "**/.vscode/**",
            "**/node_modules/**",
            "**/.DS_Store",
            "**/Thumbs.db",
            "**/*.tmp",
            "**/*.temp"
        ],
        include: [],
        useRootConfig: false,
        rootConfig: ""
    };
}

/**
 * 💾 Salva configurações no miisync.json
 */
async function saveSettings(config: any): Promise<void> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('Nenhuma workspace aberta. Abra uma pasta primeiro.');
        }

        // Salva na primeira workspace folder, preferencialmente em .vscode
        const vscodeDir = path.join(workspaceFolders[0].uri.fsPath, '.vscode');
        const configPath = path.join(vscodeDir, 'miisync.json');
        
        console.log(`💾 Salvando configuração em: ${configPath}`);
        
        // Garante que a pasta .vscode existe
        await fs.ensureDir(vscodeDir);
        
        // Carrega configuração existente para preservar outros campos
        let existingConfig: any = {};
        if (await fs.pathExists(configPath)) {
            existingConfig = await fs.readJson(configPath);
        }
        
        // Mescla a nova configuração com a existente
        const finalConfig = { ...existingConfig, ...config };
        
        // Salva com formatação bonita
        await fs.writeJson(configPath, finalConfig, { spaces: 2 });
        
        console.log('✅ Configuração salva com sucesso');
        console.log('📄 Campos salvos:', Object.keys(config));
        
    } catch (error) {
        console.error('❌ Erro ao salvar configuração:', error);
        throw error;
    }
}

/**
 * 🔄 Restaura configurações padrão
 */
async function resetToDefaults(): Promise<void> {
    await saveSettings(getDefaultConfig());
}

/**
 * 🎨 INTERFACE MODERNA E INTUITIVA
 */
function getSettingsHTML(config: any): string {
    return `<!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Configurações MiiSync</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
                color: #333;
            }

            .container {
                max-width: 900px;
                margin: 0 auto;
                background: white;
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.1);
                overflow: hidden;
            }

            .header {
                background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
                padding: 40px;
                text-align: center;
                color: white;
            }

            .header h1 {
                font-size: 2.5rem;
                font-weight: 300;
                margin-bottom: 10px;
            }

            .header p {
                opacity: 0.9;
                font-size: 1.1rem;
            }

            .content {
                padding: 40px;
            }

            .tabs {
                display: flex;
                background: #f8f9fa;
                border-radius: 12px;
                padding: 6px;
                margin-bottom: 30px;
                gap: 6px;
            }

            .tab {
                flex: 1;
                padding: 12px 20px;
                border: none;
                background: transparent;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 500;
                transition: all 0.3s ease;
                color: #6c757d;
            }

            .tab.active {
                background: white;
                color: #4facfe;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }

            .tab-content {
                display: none;
            }

            .tab-content.active {
                display: block;
                animation: fadeIn 0.3s ease;
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }

            .form-grid {
                display: grid;
                gap: 25px;
            }

            .form-group {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .form-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
            }

            .form-label {
                font-weight: 600;
                color: #2c3e50;
                font-size: 0.9rem;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .form-input {
                padding: 16px;
                border: 2px solid #e9ecef;
                border-radius: 12px;
                font-size: 1rem;
                transition: all 0.3s ease;
                background: #f8f9fa;
            }

            .form-input:focus {
                outline: none;
                border-color: #4facfe;
                background: white;
                box-shadow: 0 0 0 3px rgba(79, 172, 254, 0.1);
            }

            .form-textarea {
                resize: vertical;
                min-height: 120px;
                font-family: 'Monaco', 'Menlo', monospace;
                font-size: 0.9rem;
                line-height: 1.5;
            }

            .toggle-switch {
                position: relative;
                display: inline-block;
                width: 60px;
                height: 30px;
            }

            .toggle-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }

            .slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: #ccc;
                transition: 0.3s;
                border-radius: 30px;
            }

            .slider:before {
                position: absolute;
                content: "";
                height: 22px;
                width: 22px;
                left: 4px;
                bottom: 4px;
                background-color: white;
                transition: 0.3s;
                border-radius: 50%;
            }

            input:checked + .slider {
                background-color: #4facfe;
            }

            input:checked + .slider:before {
                transform: translateX(30px);
            }

            .toggle-group {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 20px;
                background: #f8f9fa;
                border-radius: 12px;
                border-left: 4px solid #4facfe;
            }

            .toggle-info {
                flex: 1;
            }

            .toggle-title {
                font-weight: 600;
                color: #2c3e50;
                margin-bottom: 4px;
            }

            .toggle-desc {
                color: #6c757d;
                font-size: 0.9rem;
            }

            .select-group {
                position: relative;
            }

            .form-select {
                appearance: none;
                background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
                background-position: right 12px center;
                background-repeat: no-repeat;
                background-size: 16px;
                padding-right: 40px;
            }

            .actions {
                display: flex;
                gap: 15px;
                justify-content: center;
                padding: 30px 40px;
                background: #f8f9fa;
                border-top: 1px solid #e9ecef;
            }

            .btn {
                padding: 14px 30px;
                border: none;
                border-radius: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                font-size: 1rem;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .btn-primary {
                background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
                color: white;
                box-shadow: 0 4px 15px rgba(79, 172, 254, 0.3);
            }

            .btn-primary:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(79, 172, 254, 0.4);
            }

            .btn-secondary {
                background: white;
                color: #6c757d;
                border: 2px solid #e9ecef;
            }

            .btn-secondary:hover {
                background: #f8f9fa;
                border-color: #4facfe;
                color: #4facfe;
            }

            .connection-test {
                background: #e3f2fd;
                border: 1px solid #90caf9;
                border-radius: 12px;
                padding: 20px;
                margin-top: 15px;
            }

            .test-btn {
                background: #2196f3;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.3s ease;
            }

            .test-btn:hover {
                background: #1976d2;
            }

            @media (max-width: 768px) {
                .form-row {
                    grid-template-columns: 1fr;
                }
                
                .tabs {
                    flex-direction: column;
                }
                
                .actions {
                    flex-direction: column;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⚙️ Configurações</h1>
                <p>Configure sua extensão MiiSync de forma simples e rápida</p>
            </div>

            <div class="content">
                <div class="tabs">
                    <button class="tab active" onclick="showTab('connection')">
                        🌐 Conexão
                    </button>
                    <button class="tab" onclick="showTab('behavior')">
                        ⚙️ Comportamento
                    </button>
                    <button class="tab" onclick="showTab('filters')">
                        📁 Filtros
                    </button>
                    <button class="tab" onclick="showTab('advanced')">
                        🔧 Avançado
                    </button>
                </div>

                <form id="settingsForm">
                    <!-- ABA CONEXÃO -->
                    <div id="connection" class="tab-content active">
                        <div class="form-grid">
                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label">Nome do Sistema</label>
                                    <input type="text" class="form-input" id="systemName" 
                                           value="${config.systems && config.systems[0] ? config.systems[0].name : ''}" 
                                           placeholder="Ex: ssdc_QA, prod_server">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Severidade</label>
                                    <div class="select-group">
                                        <select class="form-input form-select" id="systemSeverity">
                                            <option value="1-low" ${config.systems && config.systems[0] && config.systems[0].severity === '1-low' ? 'selected' : ''}>Baixa (Development)</option>
                                            <option value="2-high" ${config.systems && config.systems[0] && config.systems[0].severity === '2-high' ? 'selected' : ''}>Alta (QA/Test)</option>
                                            <option value="3-critical" ${config.systems && config.systems[0] && config.systems[0].severity === '3-critical' ? 'selected' : ''}>Crítica (Production)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label">Host / IP</label>
                                    <input type="text" class="form-input" id="systemHost" 
                                           value="${config.systems && config.systems[0] ? config.systems[0].host : ''}" 
                                           placeholder="192.168.1.100">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Porta</label>
                                    <input type="number" class="form-input" id="systemPort" 
                                           value="${config.systems && config.systems[0] ? config.systems[0].port : 8000}" 
                                           placeholder="8000" min="1" max="65535">
                                </div>
                            </div>

                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label">Usuário</label>
                                    <input type="text" class="form-input" id="systemUsername" 
                                           value="${config.systems && config.systems[0] ? config.systems[0].username : ''}" 
                                           placeholder="seu.usuario">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Senha</label>
                                    <input type="password" class="form-input" id="systemPassword" 
                                           value="${config.systems && config.systems[0] ? config.systems[0].password : ''}" 
                                           placeholder="••••••••">
                                </div>
                            </div>

                            <div class="toggle-group">
                                <div class="toggle-info">
                                    <div class="toggle-title">Sistema Principal</div>
                                    <div class="toggle-desc">Definir como sistema padrão para operações</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="isMainSystem" ${config.systems && config.systems[0] && config.systems[0].isMain ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                            </div>

                            <div class="connection-test">
                                <h4>🔍 Teste de Conexão</h4>
                                <p>Verifique se os dados estão corretos</p>
                                <button type="button" class="test-btn" onclick="testConnection()">
                                    Testar Conexão
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- ABA COMPORTAMENTO -->
                    <div id="behavior" class="tab-content">
                        <div class="form-grid">
                            <div class="toggle-group">
                                <div class="toggle-info">
                                    <div class="toggle-title">📤 Upload Automático</div>
                                    <div class="toggle-desc">Enviar arquivos automaticamente quando salvos</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="uploadOnSave" ${config.uploadOnSave ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                            </div>

                            <div class="toggle-group">
                                <div class="toggle-info">
                                    <div class="toggle-title">📥 Download Automático</div>
                                    <div class="toggle-desc">Baixar arquivos automaticamente quando abertos</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="downloadOnOpen" ${config.downloadOnOpen ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                            </div>

                            <div class="form-group">
                                <label class="form-label">Caminho Remoto</label>
                                <input type="text" class="form-input" id="remotePath" 
                                       value="${config.remotePath || ''}" 
                                       placeholder="MES/">
                            </div>

                            <div class="form-group">
                                <label class="form-label">Remover do Caminho Local</label>
                                <input type="text" class="form-input" id="removeFromLocalPath" 
                                       value="${config.removeFromLocalPath ? config.removeFromLocalPath.join(', ') : ''}" 
                                       placeholder="webapp, src">
                            </div>
                        </div>
                    </div>

                    <!-- ABA FILTROS -->
                    <div id="filters" class="tab-content">
                        <div class="form-grid">
                            <div class="form-group">
                                <label class="form-label">🚫 Arquivos Ignorados</label>
                                <textarea class="form-input form-textarea" id="ignorePatterns" 
                                          placeholder="**/.git/**
**/.svn/**
**/.vscode/**
**/node_modules/**">${config.ignore ? config.ignore.join('\\n') : ''}</textarea>
                            </div>

                            <div class="form-group">
                                <label class="form-label">✅ Arquivos Incluídos (Opcional)</label>
                                <textarea class="form-input form-textarea" id="includePatterns" 
                                          placeholder="**/*.js
**/*.html
**/*.css">${config.include ? config.include.join('\\n') : ''}</textarea>
                            </div>
                        </div>
                    </div>

                    <!-- ABA AVANÇADO -->
                    <div id="advanced" class="tab-content">
                        <div class="form-grid">
                            <div class="toggle-group">
                                <div class="toggle-info">
                                    <div class="toggle-title">📄 Usar Configuração Raiz</div>
                                    <div class="toggle-desc">Herdar configurações de um arquivo raiz</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="useRootConfig" ${config.useRootConfig ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                            </div>

                            <div class="form-group">
                                <label class="form-label">Caminho da Configuração Raiz</label>
                                <input type="text" class="form-input" id="rootConfig" 
                                       value="${config.rootConfig || ''}" 
                                       placeholder="../miisync.json">
                            </div>
                        </div>
                    </div>
                </form>
            </div>

            <div class="actions">
                <button type="button" class="btn btn-primary" onclick="saveSettings()">
                    💾 Salvar Configurações
                </button>
                <button type="button" class="btn btn-secondary" onclick="resetSettings()">
                    🔄 Restaurar Padrão
                </button>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();

            function showTab(tabName) {
                // Remove active da tab atual
                document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                
                // Ativa nova tab
                event.target.classList.add('active');
                document.getElementById(tabName).classList.add('active');
            }

            function saveSettings() {
                const config = {
                    uploadOnSave: document.getElementById('uploadOnSave').checked,
                    downloadOnOpen: document.getElementById('downloadOnOpen').checked,
                    systems: [
                        {
                            name: document.getElementById('systemName').value,
                            severity: document.getElementById('systemSeverity').value,
                            isMain: document.getElementById('isMainSystem').checked,
                            host: document.getElementById('systemHost').value,
                            port: parseInt(document.getElementById('systemPort').value) || 8000,
                            username: document.getElementById('systemUsername').value,
                            password: document.getElementById('systemPassword').value
                        }
                    ],
                    removeFromLocalPath: document.getElementById('removeFromLocalPath').value
                        .split(',').map(s => s.trim()).filter(s => s.length > 0),
                    remotePath: document.getElementById('remotePath').value,
                    ignore: document.getElementById('ignorePatterns').value
                        .split('\\n').map(s => s.trim()).filter(s => s.length > 0),
                    include: document.getElementById('includePatterns').value
                        .split('\\n').map(s => s.trim()).filter(s => s.length > 0),
                    useRootConfig: document.getElementById('useRootConfig').checked,
                    rootConfig: document.getElementById('rootConfig').value
                };

                vscode.postMessage({
                    command: 'saveSettings',
                    config: config
                });
            }

            function resetSettings() {
                vscode.postMessage({
                    command: 'resetSettings'
                });
            }

            function testConnection() {
                vscode.postMessage({
                    command: 'testConnection'
                });
            }

            function closePanel() {
                window.close();
            }
        </script>
    </body>
    </html>`;
}
