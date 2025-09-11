import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';

/**
 * 🎨 EDITOR COMPLETO DE CONFIGURAÇÕES
 * Abre o editor completo em WebView para configurações avançadas
 */
export async function OnCommandShowSettings(): Promise<void> {
    // Cria painel de configurações como sidebar
    const panel = vscode.window.createWebviewPanel(
        'miisyncSettingsSidebar',
        '⚙️ Configurações MiiSync',
        vscode.ViewColumn.Beside, // Abre na lateral
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: []
        }
    );

    // Carrega configurações atuais
    const currentConfig = await loadCurrentConfig();
    
    // Gera HTML da sidebar
    panel.webview.html = getSettingsSidebarHTML(currentConfig);

    // Manipula mensagens do WebView
    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'saveSettings':
                    await saveSettings(message.config);
                    vscode.window.showInformationMessage('✅ Configurações salvas com sucesso!');
                    // Refresh da tree view se existir
                    vscode.commands.executeCommand('miisync.config.refresh');
                    break;
                case 'resetSettings':
                    const confirm = await vscode.window.showWarningMessage(
                        '⚠️ Tem certeza que deseja restaurar as configurações padrão?',
                        'Sim, restaurar',
                        'Cancelar'
                    );
                    if (confirm === 'Sim, restaurar') {
                        await resetToDefaults();
                        panel.webview.html = getSettingsSidebarHTML(await loadCurrentConfig());
                        vscode.window.showInformationMessage('🔄 Configurações restauradas para o padrão');
                        // Refresh da tree view se existir
                        vscode.commands.executeCommand('miisync.config.refresh');
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
 * 🎨 SIDEBAR MODERNA COM DESIGN ESCURO E NEUTRO
 */
function getSettingsSidebarHTML(config: any): string {
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
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
                background: #1e1e1e;
                color: #e4e4e4;
                height: 100vh;
                overflow-y: auto;
                line-height: 1.5;
            }

            .sidebar {
                width: 100%;
                height: 100vh;
                background: linear-gradient(180deg, #252526 0%, #1e1e1e 100%);
                display: flex;
                flex-direction: column;
            }

            .sidebar-header {
                padding: 20px;
                background: #2d2d30;
                border-bottom: 1px solid #3c3c3c;
                position: sticky;
                top: 0;
                z-index: 100;
            }

            .sidebar-title {
                font-size: 1.4rem;
                font-weight: 600;
                color: #e4e4e4;
                margin-bottom: 8px;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .sidebar-subtitle {
                font-size: 0.9rem;
                color: #9d9d9d;
                opacity: 0.8;
            }

            .sidebar-content {
                flex: 1;
                padding: 0;
                overflow-y: auto;
            }

            .section {
                border-bottom: 1px solid #3c3c3c;
            }

            .section-header {
                padding: 16px 20px;
                background: #323233;
                cursor: pointer;
                user-select: none;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-left: 3px solid transparent;
            }

            .section-header:hover {
                background: #383839;
                border-left-color: #0e639c;
            }

            .section-header.active {
                background: #383839;
                border-left-color: #007acc;
            }

            .section-title {
                font-weight: 600;
                color: #e4e4e4;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .section-icon {
                font-size: 1.1rem;
                opacity: 0.8;
            }

            .chevron {
                font-size: 0.8rem;
                color: #9d9d9d;
                transition: transform 0.2s ease;
            }

            .section-header.active .chevron {
                transform: rotate(90deg);
            }

            .section-content {
                max-height: 0;
                overflow: hidden;
                transition: max-height 0.3s ease;
                background: #1e1e1e;
            }

            .section-content.active {
                max-height: 1000px;
            }

            .section-body {
                padding: 20px;
            }

            .form-group {
                margin-bottom: 20px;
            }

            .form-label {
                display: block;
                font-size: 0.85rem;
                font-weight: 500;
                color: #cccccc;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .form-input {
                width: 100%;
                padding: 12px 16px;
                background: #3c3c3c;
                border: 1px solid #5a5a5a;
                border-radius: 6px;
                color: #e4e4e4;
                font-size: 0.9rem;
                transition: all 0.2s ease;
            }

            .form-input:focus {
                outline: none;
                border-color: #007acc;
                background: #404040;
                box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
            }

            .form-input::placeholder {
                color: #858585;
            }

            .form-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }

            .form-textarea {
                min-height: 100px;
                resize: vertical;
                font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
                font-size: 0.85rem;
                line-height: 1.4;
            }

            .toggle-container {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px;
                background: #2d2d30;
                border-radius: 8px;
                border: 1px solid #3c3c3c;
                margin-bottom: 12px;
                transition: all 0.2s ease;
            }

            .toggle-container:hover {
                background: #323233;
                border-color: #5a5a5a;
            }

            .toggle-info {
                flex: 1;
            }

            .toggle-title {
                font-weight: 500;
                color: #e4e4e4;
                margin-bottom: 4px;
            }

            .toggle-desc {
                font-size: 0.8rem;
                color: #9d9d9d;
                line-height: 1.3;
            }

            .toggle-switch {
                position: relative;
                width: 48px;
                height: 24px;
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
                background: #5a5a5a;
                transition: 0.3s;
                border-radius: 24px;
            }

            .slider:before {
                position: absolute;
                content: "";
                height: 18px;
                width: 18px;
                left: 3px;
                bottom: 3px;
                background: #e4e4e4;
                transition: 0.3s;
                border-radius: 50%;
            }

            input:checked + .slider {
                background: #007acc;
            }

            input:checked + .slider:before {
                transform: translateX(24px);
            }

            .form-select {
                appearance: none;
                background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23858585' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
                background-position: right 12px center;
                background-repeat: no-repeat;
                background-size: 16px;
                padding-right: 40px;
            }

            .test-connection {
                background: #264f78;
                border: 1px solid #4a90e2;
                border-radius: 8px;
                padding: 16px;
                margin-top: 16px;
            }

            .test-btn {
                background: #0e639c;
                color: #ffffff;
                border: none;
                padding: 10px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.9rem;
                font-weight: 500;
                transition: all 0.2s ease;
            }

            .test-btn:hover {
                background: #1177bb;
                transform: translateY(-1px);
            }

            .sidebar-actions {
                padding: 20px;
                background: #2d2d30;
                border-top: 1px solid #3c3c3c;
                display: flex;
                gap: 12px;
                flex-direction: column;
            }

            .btn {
                padding: 12px 20px;
                border: none;
                border-radius: 6px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 0.9rem;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }

            .btn-primary {
                background: #0e639c;
                color: #ffffff;
            }

            .btn-primary:hover {
                background: #1177bb;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(14, 99, 156, 0.3);
            }

            .btn-secondary {
                background: #3c3c3c;
                color: #e4e4e4;
                border: 1px solid #5a5a5a;
            }

            .btn-secondary:hover {
                background: #484848;
                border-color: #6a6a6a;
            }

            .connection-status {
                display: inline-block;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                margin-left: 8px;
                background: #858585;
            }

            .status-online { background: #4caf50; }
            .status-offline { background: #f44336; }
            .status-testing { 
                background: #ff9800; 
                animation: pulse 1s infinite;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }

            /* Scrollbar personalizada */
            ::-webkit-scrollbar {
                width: 8px;
            }

            ::-webkit-scrollbar-track {
                background: #1e1e1e;
            }

            ::-webkit-scrollbar-thumb {
                background: #5a5a5a;
                border-radius: 4px;
            }

            ::-webkit-scrollbar-thumb:hover {
                background: #6a6a6a;
            }
        </style>
    </head>
    <body>
        <div class="sidebar">
            <div class="sidebar-header">
                <div class="sidebar-title">
                    <span>⚙️</span>
                    Configurações
                </div>
                <div class="sidebar-subtitle">
                    MiiSync Extension Settings
                </div>
            </div>

            <div class="sidebar-content">
                <form id="settingsForm">
                    <!-- SEÇÃO CONEXÃO -->
                    <div class="section">
                        <div class="section-header active" onclick="toggleSection(this)">
                            <div class="section-title">
                                <span class="section-icon">🌐</span>
                                Conexão
                            </div>
                            <span class="chevron">▶</span>
                        </div>
                        <div class="section-content active">
                            <div class="section-body">
                                <div class="form-group">
                                    <label class="form-label">Nome do Sistema</label>
                                    <input type="text" class="form-input" id="systemName" 
                                           value="${config.systems && config.systems[0] ? config.systems[0].name : ''}" 
                                           placeholder="Ex: ssdc_QA">
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
                                               placeholder="8000">
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

                                <div class="form-group">
                                    <label class="form-label">Severidade</label>
                                    <select class="form-input form-select" id="systemSeverity">
                                        <option value="1-low" ${config.systems && config.systems[0] && config.systems[0].severity === '1-low' ? 'selected' : ''}>Baixa (Development)</option>
                                        <option value="2-high" ${config.systems && config.systems[0] && config.systems[0].severity === '2-high' ? 'selected' : ''}>Alta (QA/Test)</option>
                                        <option value="3-critical" ${config.systems && config.systems[0] && config.systems[0].severity === '3-critical' ? 'selected' : ''}>Crítica (Production)</option>
                                    </select>
                                </div>

                                <div class="toggle-container">
                                    <div class="toggle-info">
                                        <div class="toggle-title">Sistema Principal</div>
                                        <div class="toggle-desc">Definir como sistema padrão</div>
                                    </div>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="isMainSystem" ${config.systems && config.systems[0] && config.systems[0].isMain ? 'checked' : ''}>
                                        <span class="slider"></span>
                                    </label>
                                </div>

                                <div class="test-connection">
                                    <h4>🔍 Teste de Conexão</h4>
                                    <p style="color: #9d9d9d; font-size: 0.9rem; margin: 8px 0;">Verificar dados de conexão</p>
                                    <button type="button" class="test-btn" onclick="testConnection()">
                                        Testar Conexão
                                        <span class="connection-status" id="connectionStatus"></span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- SEÇÃO COMPORTAMENTO -->
                    <div class="section">
                        <div class="section-header" onclick="toggleSection(this)">
                            <div class="section-title">
                                <span class="section-icon">⚙️</span>
                                Comportamento
                            </div>
                            <span class="chevron">▶</span>
                        </div>
                        <div class="section-content">
                            <div class="section-body">
                                <div class="toggle-container">
                                    <div class="toggle-info">
                                        <div class="toggle-title">Upload Automático</div>
                                        <div class="toggle-desc">Enviar arquivos automaticamente ao salvar</div>
                                    </div>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="uploadOnSave" ${config.uploadOnSave ? 'checked' : ''}>
                                        <span class="slider"></span>
                                    </label>
                                </div>

                                <div class="toggle-container">
                                    <div class="toggle-info">
                                        <div class="toggle-title">Download Automático</div>
                                        <div class="toggle-desc">Baixar arquivos automaticamente ao abrir</div>
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
                    </div>

                    <!-- SEÇÃO FILTROS -->
                    <div class="section">
                        <div class="section-header" onclick="toggleSection(this)">
                            <div class="section-title">
                                <span class="section-icon">📁</span>
                                Filtros
                            </div>
                            <span class="chevron">▶</span>
                        </div>
                        <div class="section-content">
                            <div class="section-body">
                                <div class="form-group">
                                    <label class="form-label">Arquivos Ignorados</label>
                                    <textarea class="form-input form-textarea" id="ignorePatterns" 
                                              placeholder="**/.git/**
**/.svn/**
**/.vscode/**
**/node_modules/**">${config.ignore ? config.ignore.join('\\n') : ''}</textarea>
                                </div>

                                <div class="form-group">
                                    <label class="form-label">Arquivos Incluídos</label>
                                    <textarea class="form-input form-textarea" id="includePatterns" 
                                              placeholder="**/*.js
**/*.html
**/*.css">${config.include ? config.include.join('\\n') : ''}</textarea>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- SEÇÃO AVANÇADO -->
                    <div class="section">
                        <div class="section-header" onclick="toggleSection(this)">
                            <div class="section-title">
                                <span class="section-icon">🔧</span>
                                Avançado
                            </div>
                            <span class="chevron">▶</span>
                        </div>
                        <div class="section-content">
                            <div class="section-body">
                                <div class="toggle-container">
                                    <div class="toggle-info">
                                        <div class="toggle-title">Configuração Raiz</div>
                                        <div class="toggle-desc">Herdar configurações de arquivo raiz</div>
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
                    </div>
                </form>
            </div>

            <div class="sidebar-actions">
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

            function toggleSection(header) {
                const content = header.nextElementSibling;
                const chevron = header.querySelector('.chevron');
                
                // Toggle active state
                header.classList.toggle('active');
                content.classList.toggle('active');
                
                // Rotate chevron
                if (header.classList.contains('active')) {
                    chevron.style.transform = 'rotate(90deg)';
                } else {
                    chevron.style.transform = 'rotate(0deg)';
                }
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
                const statusIndicator = document.getElementById('connectionStatus');
                statusIndicator.className = 'connection-status status-testing';
                
                vscode.postMessage({
                    command: 'testConnection'
                });

                // Simular resultado do teste (remove quando implementar de verdade)
                setTimeout(() => {
                    statusIndicator.className = 'connection-status status-online';
                }, 2000);
            }
        </script>
    </body>
    </html>`;
}
