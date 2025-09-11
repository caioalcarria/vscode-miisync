import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';

/**
 * 🎨 TELA DE CONFIGURAÇÕES MIISYNC
 * Interface completa e intuitiva para configurar a extensão
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
 * 🎨 Gera HTML da interface de configurações
 */
function getSettingsHTML(config: any): string {
    return `
    <!DOCTYPE html>
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
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 20px;
                line-height: 1.6;
            }

            .header {
                text-align: center;
                margin-bottom: 40px;
                padding: 30px;
                border-radius: 12px;
                background: linear-gradient(135deg, var(--vscode-button-background), var(--vscode-button-hoverBackground));
                box-shadow: 0 4px 16px rgba(0,0,0,0.1);
            }

            .header h1 {
                font-size: 2.5em;
                margin-bottom: 15px;
                color: var(--vscode-button-foreground);
                text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            }

            .header p {
                color: var(--vscode-button-foreground);
                opacity: 0.95;
                font-size: 1.2em;
            }

            .form-container {
                max-width: 800px;
                margin: 0 auto;
            }

            .section {
                margin-bottom: 40px;
                padding: 25px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 8px;
                background-color: var(--vscode-panel-background);
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }

            .section-title {
                font-size: 1.4em;
                font-weight: bold;
                margin-bottom: 20px;
                color: var(--vscode-textLink-foreground);
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .section-description {
                margin-bottom: 25px;
                color: var(--vscode-descriptionForeground);
                font-style: italic;
                line-height: 1.5;
            }

            .form-group {
                margin-bottom: 25px;
            }

            .form-label {
                display: block;
                font-weight: bold;
                margin-bottom: 8px;
                color: var(--vscode-input-foreground);
            }

            .form-description {
                font-size: 0.9em;
                color: var(--vscode-descriptionForeground);
                margin-bottom: 10px;
                padding: 10px;
                background-color: var(--vscode-textCodeBlock-background);
                border-radius: 4px;
                border-left: 3px solid var(--vscode-textLink-foreground);
            }

            .form-input {
                width: 100%;
                padding: 12px;
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                font-family: inherit;
                font-size: inherit;
                transition: border-color 0.2s;
            }

            .form-input:focus {
                outline: none;
                border-color: var(--vscode-focusBorder);
                box-shadow: 0 0 0 1px var(--vscode-focusBorder);
            }

            .form-checkbox {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-top: 10px;
            }

            .form-checkbox input[type="checkbox"] {
                width: 18px;
                height: 18px;
                accent-color: var(--vscode-button-background);
            }

            .form-checkbox label {
                font-weight: normal;
                cursor: pointer;
            }

            .buttons {
                text-align: center;
                margin-top: 40px;
                padding: 20px;
                border-top: 1px solid var(--vscode-panel-border);
            }

            .btn {
                padding: 12px 24px;
                border: none;
                border-radius: 4px;
                font-size: 1em;
                font-weight: bold;
                cursor: pointer;
                margin: 0 10px;
                transition: all 0.2s;
                min-width: 120px;
            }

            .btn-primary {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }

            .btn-primary:hover {
                background-color: var(--vscode-button-hoverBackground);
            }

            .btn-secondary {
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }

            .btn-secondary:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }

            .btn-danger {
                background-color: var(--vscode-errorForeground);
                color: white;
            }

            .btn-danger:hover {
                opacity: 0.9;
            }

            .input-group {
                display: flex;
                gap: 10px;
                align-items: flex-end;
            }

            .input-group .form-input {
                flex: 1;
            }

            .status-indicator {
                display: inline-block;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                margin-left: 10px;
            }

            .status-ok { background-color: #4CAF50; }
            .status-warning { background-color: #FF9800; }
            .status-error { background-color: #F44336; }

            @media (max-width: 600px) {
                .buttons {
                    flex-direction: column;
                }
                
                .btn {
                    margin: 5px 0;
                    width: 100%;
                }
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>⚙️ Configurações MiiSync</h1>
            <p>Configure sua extensão de forma fácil e intuitiva</p>
        </div>

        <div class="form-container">
            <form id="settingsForm">
                
                <!-- Seção: Comportamento Geral -->
                <div class="section">
                    <div class="section-title">⚙️ Comportamento Geral</div>
                    <div class="section-description">
                        Configure como a extensão deve se comportar durante o uso diário.
                    </div>

                    <div class="form-group">
                        <div class="form-checkbox">
                            <input type="checkbox" id="uploadOnSave" ${config.uploadOnSave ? 'checked' : ''}>
                            <label for="uploadOnSave">📤 Upload Automático ao Salvar</label>
                        </div>
                        <div class="form-description">
                            <strong>Envia arquivos para o servidor automaticamente quando salvos</strong><br>
                            Mantém arquivos sincronizados em tempo real.
                        </div>
                    </div>

                    <div class="form-group">
                        <div class="form-checkbox">
                            <input type="checkbox" id="downloadOnOpen" ${config.downloadOnOpen ? 'checked' : ''}>
                            <label for="downloadOnOpen">📥 Download Automático ao Abrir</label>
                        </div>
                        <div class="form-description">
                            <strong>Baixa arquivos automaticamente quando abertos no editor</strong><br>
                            Quando ativado, arquivos remotos serão baixados automaticamente.
                        </div>
                    </div>
                </div>

                <!-- Seção: Sistema Principal -->
                <div class="section">
                    <div class="section-title">🌐 Sistema Principal</div>
                    <div class="section-description">
                        Configure as informações de conexão com o sistema remoto.
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Nome do Sistema</label>
                        <div class="form-description">
                            <strong>� Identificação do sistema</strong><br>
                            Nome para identificar este sistema (ex: ssdc_QA, prod_server)
                        </div>
                        <input type="text" class="form-input" id="systemName" value="${config.systems && config.systems[0] ? config.systems[0].name : ''}" placeholder="ssdc_QA">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Host/IP</label>
                        <div class="form-description">
                            <strong>� Endereço do servidor</strong><br>
                            IP ou hostname do servidor remoto
                        </div>
                        <input type="text" class="form-input" id="systemHost" value="${config.systems && config.systems[0] ? config.systems[0].host : ''}" placeholder="192.168.1.100">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Porta</label>
                        <div class="form-description">
                            <strong>🚪 Porta de conexão</strong><br>
                            Porta TCP para estabelecer a conexão
                        </div>
                        <input type="number" class="form-input" id="systemPort" value="${config.systems && config.systems[0] ? config.systems[0].port : 8000}" min="1" max="65535" placeholder="8000">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Usuário</label>
                        <div class="form-description">
                            <strong>👤 Nome de usuário para autenticação</strong><br>
                            Use suas credenciais do sistema remoto
                        </div>
                        <input type="text" class="form-input" id="systemUsername" value="${config.systems && config.systems[0] ? config.systems[0].username : ''}" placeholder="usuario.sistema">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Senha</label>
                        <div class="form-description">
                            <strong>🔒 Senha de acesso</strong><br>
                            Senha para autenticação no sistema remoto
                        </div>
                        <input type="password" class="form-input" id="systemPassword" value="${config.systems && config.systems[0] ? config.systems[0].password : ''}" placeholder="••••••••">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Severidade</label>
                        <div class="form-description">
                            <strong>⚠️ Nível de severidade do sistema</strong><br>
                            Define a criticidade/ambiente do sistema
                        </div>
                        <select class="form-input" id="systemSeverity">
                            <option value="1-low" ${config.systems && config.systems[0] && config.systems[0].severity === '1-low' ? 'selected' : ''}>1-low (Baixa)</option>
                            <option value="2-high" ${config.systems && config.systems[0] && config.systems[0].severity === '2-high' ? 'selected' : ''}>2-high (Alta)</option>
                            <option value="3-critical" ${config.systems && config.systems[0] && config.systems[0].severity === '3-critical' ? 'selected' : ''}>3-critical (Crítica)</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <div class="form-checkbox">
                            <input type="checkbox" id="isMainSystem" ${config.systems && config.systems[0] && config.systems[0].isMain ? 'checked' : ''}>
                            <label for="isMainSystem">⭐ Sistema Principal</label>
                        </div>
                        <div class="form-description">
                            <strong>Marcar como sistema principal</strong><br>
                            Define este como o sistema padrão para operações
                        </div>
                    </div>
                </div>

                <!-- Seção: Caminhos -->
                <div class="section">
                    <div class="section-title">📁 Configuração de Caminhos</div>
                    <div class="section-description">
                        Configure os caminhos locais e remotos para sincronização.
                    </div>

                    <div class="form-group">
                        <label class="form-label">Caminho Remoto</label>
                        <div class="form-description">
                            <strong>🌐 Diretório base no servidor remoto</strong><br>
                            Caminho raiz onde os arquivos serão enviados/baixados
                        </div>
                        <input type="text" class="form-input" id="remotePath" value="${config.remotePath || ''}" placeholder="MES/">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Remover do Caminho Local</label>
                        <div class="form-description">
                            <strong>🚫 Pastas a remover do caminho local</strong><br>
                            Lista de diretórios que serão removidos do caminho ao fazer upload (separados por vírgula)
                        </div>
                        <input type="text" class="form-input" id="removeFromLocalPath" value="${config.removeFromLocalPath ? config.removeFromLocalPath.join(', ') : ''}" placeholder="webapp, src">
                    </div>
                </div>

                <!-- Seção: Arquivos e Filtros -->
                <div class="section">
                    <div class="section-title">📋 Filtros de Arquivos</div>
                    <div class="section-description">
                        Configure quais arquivos devem ser ignorados ou incluídos durante a sincronização.
                    </div>

                    <div class="form-group">
                        <label class="form-label">Arquivos Ignorados</label>
                        <div class="form-description">
                            <strong>🚫 Padrões de arquivos a ignorar</strong><br>
                            Use padrões glob para especificar arquivos que nunca devem ser sincronizados (um por linha)
                        </div>
                        <textarea class="form-input" id="ignorePatterns" rows="8" placeholder="**/.git/**
**/.svn/**
**/.vscode/**
**/node_modules/**">${config.ignore ? config.ignore.join('\\n') : ''}</textarea>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Arquivos Incluídos (Opcional)</label>
                        <div class="form-description">
                            <strong>✅ Padrões específicos a incluir</strong><br>
                            Se especificado, apenas arquivos que correspondem a estes padrões serão sincronizados (um por linha)
                        </div>
                        <textarea class="form-input" id="includePatterns" rows="4" placeholder="**/*.js
**/*.html
**/*.css">${config.include ? config.include.join('\\n') : ''}</textarea>
                    </div>
                </div>

                <!-- Seção: Configuração Raiz -->
                <div class="section">
                    <div class="section-title">🏠 Configuração Raiz</div>
                    <div class="section-description">
                        Configure se deve usar um arquivo de configuração raiz compartilhado.
                    </div>

                    <div class="form-group">
                        <div class="form-checkbox">
                            <input type="checkbox" id="useRootConfig" ${config.useRootConfig ? 'checked' : ''}>
                            <label for="useRootConfig">📄 Usar Configuração Raiz</label>
                        </div>
                        <div class="form-description">
                            <strong>Herdar configurações de um arquivo raiz</strong><br>
                            Quando ativado, algumas configurações serão herdadas do arquivo especificado abaixo
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Caminho da Configuração Raiz</label>
                        <div class="form-description">
                            <strong>📁 Caminho para o arquivo de configuração raiz</strong><br>
                            Especifique o caminho para o arquivo miisync.json raiz (apenas se "Usar Configuração Raiz" estiver ativado)
                        </div>
                        <input type="text" class="form-input" id="rootConfig" value="${config.rootConfig || ''}" placeholder="../miisync.json">
                    </div>
                </div>

                <!-- Seção: Performance -->
                <div class="section">
                    <div class="section-title">🚀 Performance e Rede</div>
                    <div class="section-description">
                        Ajuste configurações técnicas para otimizar a performance da extensão de acordo com sua conexão e necessidades.
                    </div>

                    <div class="form-group">
                        <label class="form-label">Intervalo de Atualização (segundos)</label>
                        <div class="form-description">
                            <strong>⏰ Frequência de verificação de mudanças</strong><br>
                            Define com que frequência a extensão verifica por mudanças nos arquivos. Valores menores detectam mudanças mais rápido mas consomem mais recursos.
                        </div>
                        <input type="number" class="form-input" id="autoRefreshInterval" value="${config.autoRefreshInterval}" min="5" max="300" placeholder="30">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Timeout de Rede (milissegundos)</label>
                        <div class="form-description">
                            <strong>⏱️ Tempo limite para operações de rede</strong><br>
                            Máximo de tempo que a extensão aguarda uma resposta do servidor. Aumente se sua conexão for lenta.
                        </div>
                        <input type="number" class="form-input" id="timeout" value="${config.timeout}" min="5000" max="120000" placeholder="30000">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Máximo de Tentativas</label>
                        <div class="form-description">
                            <strong>🔄 Número de tentativas em caso de falha</strong><br>
                            Quantas vezes a extensão tentará uma operação antes de desistir. Útil para conexões instáveis.
                        </div>
                        <input type="number" class="form-input" id="maxRetries" value="${config.maxRetries}" min="1" max="10" placeholder="3">
                    </div>
                </div>

                <!-- Seção: Desenvolvimento -->
                <div class="section">
                    <div class="section-title">🔧 Desenvolvimento e Debug</div>
                    <div class="section-description">
                        Configurações avançadas para desenvolvedores e resolução de problemas. Ative apenas se necessário para diagnósticos.
                    </div>

                    <div class="form-group">
                        <div class="form-checkbox">
                            <input type="checkbox" id="debugMode" ${config.debugMode ? 'checked' : ''}>
                            <label for="debugMode">🐛 Modo Debug</label>
                        </div>
                        <div class="form-description">
                            <strong>Ativa logs detalhados no console</strong><br>
                            Mostra informações técnicas detalhadas sobre o funcionamento da extensão. Útil para diagnóstico de problemas, mas pode impactar a performance.
                        </div>
                    </div>
                </div>

            </form>

            <div class="buttons">
                <button type="button" class="btn btn-primary" onclick="saveSettings()">💾 Salvar Configurações</button>
                <button type="button" class="btn btn-secondary" onclick="resetSettings()">🔄 Restaurar Padrão</button>
                <button type="button" class="btn btn-danger" onclick="closePanel()">❌ Fechar</button>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();

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
                vscode.postMessage({
                    command: 'close'
                });
            }

            // Validação em tempo real
            document.getElementById('sessionDuration').addEventListener('input', function() {
                const value = parseInt(this.value);
                if (value < 1) this.value = 1;
                if (value > 1440) this.value = 1440;
            });

            document.getElementById('timeout').addEventListener('input', function() {
                const value = parseInt(this.value);
                if (value < 5000) this.value = 5000;
                if (value > 120000) this.value = 120000;
            });

            document.getElementById('maxRetries').addEventListener('input', function() {
                const value = parseInt(this.value);
                if (value < 1) this.value = 1;
                if (value > 10) this.value = 10;
            });

            document.getElementById('autoRefreshInterval').addEventListener('input', function() {
                const value = parseInt(this.value);
                if (value < 5) this.value = 5;
                if (value > 300) this.value = 300;
            });
        </script>
    </body>
    </html>
    `;
}
