import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class MiiSyncConfigWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'miisyncconfig-settings';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'saveConfig':
                    this.saveConfiguration(data.config);
                    break;
                case 'loadConfig':
                    this.loadConfiguration();
                    break;
            }
        });

        // Carregar configuração inicial
        this.loadConfiguration();
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MiiSync Configurações</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #1e1e1e;
            color: #cccccc;
            font-size: 13px;
            line-height: 1.4;
        }

        .container {
            padding: 16px;
        }

        .section {
            margin-bottom: 20px;
            background-color: #252526;
            border-radius: 6px;
            border: 1px solid #3c3c3c;
            overflow: hidden;
        }

        .section-header {
            background: linear-gradient(135deg, #007acc 0%, #005a9e 100%);
            color: white;
            padding: 12px 16px;
            font-weight: 600;
            font-size: 14px;
            display: flex;
            align-items: center;
        }

        .section-header .icon {
            margin-right: 8px;
            font-size: 16px;
        }

        .section-content {
            padding: 16px;
        }

        .form-group {
            margin-bottom: 16px;
        }

        .form-group:last-child {
            margin-bottom: 0;
        }

        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            color: #e6e6e6;
        }

        input[type="text"], input[type="number"], input[type="password"], textarea, select {
            width: 100%;
            padding: 8px 12px;
            background-color: #3c3c3c;
            border: 1px solid #565656;
            border-radius: 4px;
            color: #cccccc;
            font-size: 13px;
            transition: border-color 0.2s ease;
        }

        input[type="text"]:focus, input[type="number"]:focus, input[type="password"]:focus, textarea:focus, select:focus {
            outline: none;
            border-color: #007acc;
            box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
        }

        textarea {
            resize: vertical;
            min-height: 80px;
            font-family: 'Consolas', 'Courier New', monospace;
        }

        .toggle-switch {
            position: relative;
            display: inline-block;
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
            background-color: #565656;
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
            background-color: white;
            transition: 0.3s;
            border-radius: 50%;
        }

        input:checked + .slider {
            background-color: #007acc;
        }

        input:checked + .slider:before {
            transform: translateX(24px);
        }

        .toggle-group {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .button {
            background: linear-gradient(135deg, #007acc 0%, #005a9e 100%);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .button:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 122, 204, 0.3);
        }

        .button:active {
            transform: translateY(0);
        }

        .save-button {
            width: 100%;
            margin-top: 20px;
            padding: 12px;
            font-size: 14px;
        }

        .description {
            font-size: 12px;
            color: #a6a6a6;
            margin-top: 4px;
            line-height: 1.3;
        }

        .system-section {
            background-color: #2d2d30;
            border: 1px solid #404040;
            border-radius: 4px;
            padding: 16px;
        }

        .form-row {
            display: flex;
            gap: 12px;
            align-items: end;
        }

        .form-row .form-group {
            flex: 1;
        }

        .severity-select {
            background-color: #3c3c3c;
            color: #cccccc;
        }

        .status-message {
            position: fixed;
            top: 16px;
            right: 16px;
            padding: 12px 16px;
            background-color: #28a745;
            color: white;
            border-radius: 4px;
            font-weight: 500;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
            z-index: 1000;
        }

        .status-message.show {
            opacity: 1;
            transform: translateX(0);
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
        }

        .checkbox-group input[type="checkbox"] {
            width: auto;
            margin-right: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="section">
            <div class="section-header">
                <span class="icon">⚙️</span>
                Configurações Gerais
            </div>
            <div class="section-content">
                <div class="form-group">
                    <div class="toggle-group">
                        <div>
                            <label>Upload ao Salvar</label>
                            <div class="description">Upload automático ao salvar arquivos</div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="upload-on-save">
                            <span class="slider"></span>
                        </label>
                    </div>
                </div>

                <div class="form-group">
                    <div class="toggle-group">
                        <div>
                            <label>Download ao Abrir</label>
                            <div class="description">Download automático ao abrir arquivos</div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" id="download-on-open">
                            <span class="slider"></span>
                        </label>
                    </div>
                </div>

                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="use-root-config">
                        <label for="use-root-config">Usar Configuração Raiz</label>
                    </div>
                    <input type="text" id="root-config" placeholder="Caminho para configuração raiz">
                    <div class="description">Caminho para arquivo de configuração raiz</div>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-header">
                <span class="icon">🖥️</span>
                Sistema Principal
            </div>
            <div class="section-content">
                <div class="system-section">
                    <div class="form-group">
                        <label for="system-name">Nome do Sistema</label>
                        <input type="text" id="system-name" placeholder="TE55QA">
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="system-host">Host/IP</label>
                            <input type="text" id="system-host" placeholder="192.168.1.100">
                        </div>
                        <div class="form-group">
                            <label for="system-port">Porta</label>
                            <input type="number" id="system-port" value="50040">
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="system-username">Usuário</label>
                            <input type="text" id="system-username" placeholder="usuario">
                        </div>
                        <div class="form-group">
                            <label for="system-password">Senha</label>
                            <input type="password" id="system-password" placeholder="senha">
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="system-severity">Severidade</label>
                        <select id="system-severity" class="severity-select">
                            <option value="1-low">1-low</option>
                            <option value="2-high">2-high</option>
                            <option value="3-critical">3-critical</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="remote-path">Caminho Remoto</label>
                        <input type="text" id="remote-path" placeholder="MES/" value="MES/">
                        <div class="description">Caminho base no servidor remoto</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-header">
                <span class="icon">🗂️</span>
                Filtros de Arquivos
            </div>
            <div class="section-content">
                <div class="form-group">
                    <label for="include-patterns">Padrões de Inclusão</label>
                    <textarea id="include-patterns" placeholder="**/*.js&#10;**/*.ts&#10;**/*.json"></textarea>
                    <div class="description">Padrões glob para incluir arquivos (um por linha)</div>
                </div>

                <div class="form-group">
                    <label for="ignore-patterns">Padrões de Exclusão (Ignore)</label>
                    <textarea id="ignore-patterns" placeholder="**/.git/**&#10;**/node_modules/**&#10;**/.vscode/**"></textarea>
                    <div class="description">Padrões glob para ignorar arquivos (um por linha)</div>
                </div>

                <div class="form-group">
                    <label for="remove-patterns">Remover do Caminho Local</label>
                    <textarea id="remove-patterns" placeholder="src/&#10;dist/"></textarea>
                    <div class="description">Partes do caminho local a serem removidas (um por linha)</div>
                </div>
            </div>
        </div>

        <button class="button save-button" onclick="saveConfiguration()">
            💾 Salvar Configurações
        </button>
    </div>

    <div id="status-message" class="status-message">
        Configurações salvas com sucesso!
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentConfig = {};

        function loadConfiguration() {
            vscode.postMessage({ type: 'loadConfig' });
        }

        function saveConfiguration() {
            const system = {
                name: document.getElementById('system-name').value || 'Sistema Principal',
                severity: document.getElementById('system-severity').value,
                isMain: true,
                host: document.getElementById('system-host').value,
                port: parseInt(document.getElementById('system-port').value) || 50040,
                username: document.getElementById('system-username').value,
                password: document.getElementById('system-password').value
            };

            const config = {
                uploadOnSave: document.getElementById('upload-on-save').checked,
                downloadOnOpen: document.getElementById('download-on-open').checked,
                systems: [system],
                removeFromLocalPath: document.getElementById('remove-patterns').value.split('\\n').filter(p => p.trim()),
                remotePath: document.getElementById('remote-path').value || 'MES/',
                ignore: document.getElementById('ignore-patterns').value.split('\\n').filter(p => p.trim()),
                include: document.getElementById('include-patterns').value.split('\\n').filter(p => p.trim()),
                useRootConfig: document.getElementById('use-root-config').checked,
                rootConfig: document.getElementById('root-config').value || ''
            };

            vscode.postMessage({ 
                type: 'saveConfig', 
                config: config 
            });

            showStatusMessage();
        }

        function showStatusMessage() {
            const message = document.getElementById('status-message');
            message.classList.add('show');
            
            setTimeout(() => {
                message.classList.remove('show');
            }, 3000);
        }

        function populateConfiguration(config) {
            currentConfig = config;
            
            // Configurações gerais
            document.getElementById('upload-on-save').checked = config.uploadOnSave || false;
            document.getElementById('download-on-open').checked = config.downloadOnOpen || false;
            document.getElementById('use-root-config').checked = config.useRootConfig || false;
            document.getElementById('root-config').value = config.rootConfig || '';
            
            // Sistema principal (primeiro da lista)
            if (config.systems && config.systems.length > 0) {
                const system = config.systems[0];
                document.getElementById('system-name').value = system.name || '';
                document.getElementById('system-host').value = system.host || '';
                document.getElementById('system-port').value = system.port || 50040;
                document.getElementById('system-username').value = system.username || '';
                document.getElementById('system-password').value = system.password || '';
                document.getElementById('system-severity').value = system.severity || '2-high';
            }
            
            // Caminhos e filtros
            document.getElementById('remote-path').value = config.remotePath || 'MES/';
            document.getElementById('include-patterns').value = (config.include || []).join('\\n');
            document.getElementById('ignore-patterns').value = (config.ignore || []).join('\\n');
            document.getElementById('remove-patterns').value = (config.removeFromLocalPath || []).join('\\n');
        }

        // Listener para mensagens do VS Code
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configLoaded':
                    populateConfiguration(message.config);
                    break;
                case 'configSaved':
                    showStatusMessage();
                    break;
            }
        });

        // Carregar configuração ao inicializar
        document.addEventListener('DOMContentLoaded', () => {
            loadConfiguration();
        });
    </script>
</body>
</html>`;
    }

    private async loadConfiguration() {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            const configPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'miisync.json');
            
            let config = {};
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf8');
                config = JSON.parse(configContent);
            }

            this._view?.webview.postMessage({
                type: 'configLoaded',
                config: config
            });
        } catch (error) {
            console.error('Erro ao carregar configuração:', error);
        }
    }

    private async saveConfiguration(config: any) {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Nenhum workspace aberto');
                return;
            }

            const configDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
            const configPath = path.join(configDir, 'miisync.json');

            // Criar diretório .vscode se não existir
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            // Salvar configuração
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            this._view?.webview.postMessage({
                type: 'configSaved'
            });

            vscode.window.showInformationMessage('Configuração salva com sucesso!');
        } catch (error) {
            console.error('Erro ao salvar configuração:', error);
            vscode.window.showErrorMessage('Erro ao salvar configuração');
        }
    }
}
