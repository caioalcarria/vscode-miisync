import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';

export class MiiSyncConfigProvider implements vscode.TreeDataProvider<ConfigItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConfigItem | undefined | null | void> = new vscode.EventEmitter<ConfigItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConfigItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private config: any = {};

    constructor() {
        this.loadConfig();
    }

    refresh(): void {
        this.loadConfig();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConfigItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConfigItem): Thenable<ConfigItem[]> {
        if (!element) {
            // Root level - categorias principais
            return Promise.resolve([
                new ConfigItem('🌐 Conexão', 'connection', vscode.TreeItemCollapsibleState.Expanded),
                new ConfigItem('⚙️ Comportamento', 'behavior', vscode.TreeItemCollapsibleState.Collapsed),
                new ConfigItem('📁 Filtros', 'filters', vscode.TreeItemCollapsibleState.Collapsed),
                new ConfigItem('🔧 Avançado', 'advanced', vscode.TreeItemCollapsibleState.Collapsed),
                new ConfigItem('💾 Ações', 'actions', vscode.TreeItemCollapsibleState.Expanded)
            ]);
        } else {
            return Promise.resolve(this.getConfigItems(element.contextValue));
        }
    }

    private getConfigItems(category: string): ConfigItem[] {
        const items: ConfigItem[] = [];
        
        switch (category) {
            case 'connection':
                const system = this.config.systems?.[0] || {};
                items.push(
                    new ConfigItem(`📡 Sistema: ${system.name || 'Não configurado'}`, 'edit-system-name', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`🏠 Host: ${system.host || 'Não configurado'}`, 'edit-system-host', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`🚪 Porta: ${system.port || '8000'}`, 'edit-system-port', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`👤 Usuário: ${system.username || 'Não configurado'}`, 'edit-system-username', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`🔒 Senha: ${system.password ? '••••••••' : 'Não configurada'}`, 'edit-system-password', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`⚠️ Severidade: ${system.severity || '2-high'}`, 'edit-system-severity', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`⭐ Principal: ${system.isMain ? 'Sim' : 'Não'}`, 'toggle-main-system', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem('🔍 Testar Conexão', 'test-connection', vscode.TreeItemCollapsibleState.None)
                );
                break;
                
            case 'behavior':
                items.push(
                    new ConfigItem(`📤 Upload Auto: ${this.config.uploadOnSave ? 'Ativo' : 'Inativo'}`, 'toggle-upload-save', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`📥 Download Auto: ${this.config.downloadOnOpen ? 'Ativo' : 'Inativo'}`, 'toggle-download-open', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`📁 Caminho Remoto: ${this.config.remotePath || 'Não configurado'}`, 'edit-remote-path', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`🚫 Remover do Local: ${this.config.removeFromLocalPath?.join(', ') || 'Nenhum'}`, 'edit-remove-local', vscode.TreeItemCollapsibleState.None)
                );
                break;
                
            case 'filters':
                items.push(
                    new ConfigItem(`🚫 Ignorados: ${this.config.ignore?.length || 0} padrões`, 'edit-ignore-patterns', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`✅ Incluídos: ${this.config.include?.length || 0} padrões`, 'edit-include-patterns', vscode.TreeItemCollapsibleState.None)
                );
                break;
                
            case 'advanced':
                items.push(
                    new ConfigItem(`📄 Config Raiz: ${this.config.useRootConfig ? 'Ativo' : 'Inativo'}`, 'toggle-root-config', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem(`📁 Caminho Raiz: ${this.config.rootConfig || 'Não configurado'}`, 'edit-root-config-path', vscode.TreeItemCollapsibleState.None)
                );
                break;
                
            case 'actions':
                items.push(
                    new ConfigItem('💾 Salvar Configurações', 'save-config', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem('🔄 Restaurar Padrão', 'reset-config', vscode.TreeItemCollapsibleState.None),
                    new ConfigItem('⚙️ Abrir Editor Completo', 'open-full-editor', vscode.TreeItemCollapsibleState.None)
                );
                break;
        }
        
        return items;
    }

    private async loadConfig() {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                this.config = this.getDefaultConfig();
                return;
            }

            // Procura miisync.json
            for (const folder of workspaceFolders) {
                const vsCodeConfigPath = path.join(folder.uri.fsPath, '.vscode', 'miisync.json');
                if (await fs.pathExists(vsCodeConfigPath)) {
                    this.config = await fs.readJson(vsCodeConfigPath);
                    return;
                }
                
                const configPath = path.join(folder.uri.fsPath, 'miisync.json');
                if (await fs.pathExists(configPath)) {
                    this.config = await fs.readJson(configPath);
                    return;
                }
            }
            
            this.config = this.getDefaultConfig();
        } catch (error) {
            console.error('❌ Erro ao carregar configuração:', error);
            this.config = this.getDefaultConfig();
        }
    }

    private getDefaultConfig(): any {
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

    async handleItemClick(item: ConfigItem) {
        switch (item.contextValue) {
            case 'test-connection':
                vscode.window.showInformationMessage('🔍 Testando conexão... (Em desenvolvimento)');
                break;
                
            case 'save-config':
                await this.saveConfig();
                vscode.window.showInformationMessage('✅ Configurações salvas!');
                this.refresh();
                break;
                
            case 'reset-config':
                const confirm = await vscode.window.showWarningMessage(
                    '⚠️ Restaurar configurações padrão?',
                    'Sim', 'Cancelar'
                );
                if (confirm === 'Sim') {
                    await this.resetConfig();
                    vscode.window.showInformationMessage('🔄 Configurações restauradas!');
                    this.refresh();
                }
                break;
                
            case 'open-full-editor':
                vscode.commands.executeCommand('miisync.showsettings.full');
                break;
                
            // Edição de campos
            case 'edit-system-name':
                await this.editField('Sistema', 'systems.0.name', this.config.systems?.[0]?.name || '');
                break;
            case 'edit-system-host':
                await this.editField('Host/IP', 'systems.0.host', this.config.systems?.[0]?.host || '');
                break;
            case 'edit-system-port':
                await this.editField('Porta', 'systems.0.port', this.config.systems?.[0]?.port?.toString() || '8000');
                break;
            case 'edit-system-username':
                await this.editField('Usuário', 'systems.0.username', this.config.systems?.[0]?.username || '');
                break;
            case 'edit-system-password':
                await this.editField('Senha', 'systems.0.password', '', true);
                break;
            case 'edit-remote-path':
                await this.editField('Caminho Remoto', 'remotePath', this.config.remotePath || '');
                break;
                
            // Toggles
            case 'toggle-upload-save':
                await this.toggleField('uploadOnSave');
                break;
            case 'toggle-download-open':
                await this.toggleField('downloadOnOpen');
                break;
            case 'toggle-main-system':
                await this.toggleField('systems.0.isMain');
                break;
            case 'toggle-root-config':
                await this.toggleField('useRootConfig');
                break;
        }
    }

    private async editField(label: string, path: string, currentValue: string, isPassword: boolean = false) {
        const newValue = await vscode.window.showInputBox({
            prompt: `Digite o novo valor para ${label}`,
            value: isPassword ? '' : currentValue,
            password: isPassword
        });
        
        if (newValue !== undefined) {
            this.setValueByPath(this.config, path, newValue);
            await this.saveConfig();
            this.refresh();
        }
    }

    private async toggleField(path: string) {
        const currentValue = this.getValueByPath(this.config, path);
        this.setValueByPath(this.config, path, !currentValue);
        await this.saveConfig();
        this.refresh();
    }

    private getValueByPath(obj: any, path: string): any {
        return path.split('.').reduce((o, p) => o && o[p], obj);
    }

    private setValueByPath(obj: any, path: string, value: any) {
        const keys = path.split('.');
        const lastKey = keys.pop()!;
        const target = keys.reduce((o, k) => {
            if (!o[k]) o[k] = {};
            return o[k];
        }, obj);
        target[lastKey] = value;
    }

    private async saveConfig() {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;

            const vscodeDir = path.join(workspaceFolders[0].uri.fsPath, '.vscode');
            const configPath = path.join(vscodeDir, 'miisync.json');
            
            await fs.ensureDir(vscodeDir);
            await fs.writeJson(configPath, this.config, { spaces: 2 });
        } catch (error) {
            console.error('❌ Erro ao salvar:', error);
            vscode.window.showErrorMessage('Erro ao salvar configurações');
        }
    }

    private async resetConfig() {
        this.config = this.getDefaultConfig();
        await this.saveConfig();
    }
}

export class ConfigItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly contextValue: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        
        // Adiciona ícones baseados no contexto
        if (contextValue.startsWith('edit-')) {
            this.iconPath = new vscode.ThemeIcon('edit');
        } else if (contextValue.startsWith('toggle-')) {
            this.iconPath = new vscode.ThemeIcon('circle-filled');
        } else if (contextValue === 'test-connection') {
            this.iconPath = new vscode.ThemeIcon('debug-disconnect');
        } else if (contextValue === 'save-config') {
            this.iconPath = new vscode.ThemeIcon('save');
        } else if (contextValue === 'reset-config') {
            this.iconPath = new vscode.ThemeIcon('refresh');
        } else if (contextValue === 'open-full-editor') {
            this.iconPath = new vscode.ThemeIcon('settings-gear');
        }
        
        // Adiciona comando para cliques
        if (contextValue !== 'connection' && contextValue !== 'behavior' && 
            contextValue !== 'filters' && contextValue !== 'advanced' && contextValue !== 'actions') {
            this.command = {
                command: 'miisync.config.item.click',
                title: 'Editar',
                arguments: [this]
            };
        }
    }
}
