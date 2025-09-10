import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import { PathMappingManager } from '../../modules/pathmapping';
import { projectEvents } from '../../events/projectevents';

/**
 * Status de modificação do arquivo
 */
export enum FileStatus {
    Modified = 'M',  // Arquivo modificado
    Added = 'A',     // Arquivo novo (não estava no mapeamento)
    Deleted = 'D'    // Arquivo deletado (estava no mapeamento mas não existe mais)
}

/**
 * Status de verificação do servidor
 */
export enum ServerVerificationStatus {
    NotChecked = 'not-checked',     // Ainda não foi verificado
    Checking = 'checking',          // Verificação em andamento
    UpToDate = 'up-to-date',       // Sincronizado com servidor
    OutOfSync = 'out-of-sync',     // Diferenças encontradas
    Error = 'error'                 // Erro na verificação
}

/**
 * Tipo de diferença do servidor
 */
export enum ServerDiffType {
    LocalNewer = 'local-newer',      // Local mais recente que servidor
    ServerNewer = 'server-newer',    // Servidor mais recente que local
    OnlyInLocal = 'only-in-local',   // Existe apenas local
    OnlyInServer = 'only-in-server', // Existe apenas no servidor
    Different = 'different'          // Conteúdos diferentes
}

/**
 * Interface para representar um projeto local
 */
export interface LocalProject {
    name: string;
    localPath: string;
    remotePath: string;
    downloadedAt: Date;
    modifiedFiles: ModifiedFile[];
    serverVerification?: ServerVerification;
}

/**
 * Interface para verificação do servidor
 */
export interface ServerVerification {
    status: ServerVerificationStatus;
    lastChecked?: Date;
    differences: ServerDifference[];
    error?: string;
}

/**
 * Interface para diferenças do servidor
 */
export interface ServerDifference {
    path: string;
    relativePath: string;
    diffType: ServerDiffType;
    isDirectory: boolean;
    localModified?: Date;
    serverModified?: Date;
    description: string;
}

/**
 * Interface para representar um arquivo modificado
 */
export interface ModifiedFile {
    fileName: string;
    filePath: string;
    relativePath: string;
    lastModified: Date;
    hasLocalChanges: boolean;
    status: FileStatus;
    originalHash?: string;  // Hash do conteúdo original para comparação
}

/**
 * Item da árvore que pode ser um projeto, arquivo modificado ou diferença do servidor
 */
export class LocalProjectTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isProject: boolean = false,
        public readonly project?: LocalProject,
        public readonly modifiedFile?: ModifiedFile,
        public readonly serverDifference?: ServerDifference,
        public readonly isServerDiffSection: boolean = false
    ) {
        super(label, collapsibleState);
        
        if (isProject && project) {
            this.setupProjectItem(project);
        } else if (modifiedFile) {
            this.setupFileItem(modifiedFile);
        } else if (serverDifference) {
            this.setupServerDiffItem(serverDifference);
        } else if (isServerDiffSection) {
            this.setupServerDiffSection();
        }
    }

    private setupProjectItem(project: LocalProject): void {
        const modifiedCount = project.modifiedFiles.length;
        const serverStatus = project.serverVerification?.status || ServerVerificationStatus.NotChecked;
        const diffCount = project.serverVerification?.differences.length || 0;
        
        let description = `${modifiedCount} modificado(s)`;
        if (serverStatus !== ServerVerificationStatus.NotChecked) {
            if (serverStatus === ServerVerificationStatus.Checking) {
                description += ' • Verificando servidor...';
            } else if (serverStatus === ServerVerificationStatus.UpToDate) {
                description += ' • Sincronizado';
            } else if (serverStatus === ServerVerificationStatus.OutOfSync) {
                description += ` • ${diffCount} diferença(s) no servidor`;
            } else if (serverStatus === ServerVerificationStatus.Error) {
                description += ' • Erro na verificação';
            }
        }
        
        this.tooltip = `${project.name}\nServidor: ${project.remotePath}\nBaixado em: ${project.downloadedAt.toLocaleString()}\nArquivos modificados: ${modifiedCount}`;
        if (project.serverVerification?.lastChecked) {
            this.tooltip += `\nÚltima verificação: ${project.serverVerification.lastChecked.toLocaleString()}`;
        }
        
        this.description = description;
        this.iconPath = this.getProjectIcon(serverStatus);
        this.contextValue = 'localproject';
    }

    private getProjectIcon(serverStatus: ServerVerificationStatus): vscode.ThemeIcon {
        switch (serverStatus) {
            case ServerVerificationStatus.Checking:
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
            case ServerVerificationStatus.UpToDate:
                return new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.green'));
            case ServerVerificationStatus.OutOfSync:
                return new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.orange'));
            case ServerVerificationStatus.Error:
                return new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.red'));
            default:
                return new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
        }
    }

    private setupFileItem(file: ModifiedFile): void {
        const statusIcon = this.getStatusIcon(file.status);
        const statusText = this.getStatusText(file.status);
        
        this.tooltip = `${file.fileName} [${statusText}]\nCaminho: ${file.relativePath}\nModificado em: ${file.lastModified.toLocaleString()}`;
        this.description = `${file.relativePath} [${file.status}]`;
        this.iconPath = new vscode.ThemeIcon('file', this.getStatusColor(file.status));
        this.contextValue = 'modifiedfile';
        this.resourceUri = vscode.Uri.file(file.filePath);
        
        // Permite abertura do arquivo com diff se for modificado
        if (file.status === FileStatus.Modified) {
            this.command = {
                command: 'miisync.showfilediff',
                title: 'Mostrar diferenças',
                arguments: [this.resourceUri, file]
            };
        } else {
            this.command = {
                command: 'vscode.open',
                title: 'Abrir arquivo',
                arguments: [this.resourceUri]
            };
        }
    }

    private getStatusIcon(status: FileStatus): string {
        switch (status) {
            case FileStatus.Modified: return 'file-diff';
            case FileStatus.Added: return 'file-add';
            case FileStatus.Deleted: return 'file-remove';
            default: return 'file';
        }
    }

    private getStatusText(status: FileStatus): string {
        switch (status) {
            case FileStatus.Modified: return 'Modificado';
            case FileStatus.Added: return 'Novo';
            case FileStatus.Deleted: return 'Deletado';
            default: return 'Desconhecido';
        }
    }

    private getStatusColor(status: FileStatus): vscode.ThemeColor {
        switch (status) {
            case FileStatus.Modified: return new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
            case FileStatus.Added: return new vscode.ThemeColor('gitDecoration.addedResourceForeground');
            case FileStatus.Deleted: return new vscode.ThemeColor('gitDecoration.deletedResourceForeground');
            default: return new vscode.ThemeColor('foreground');
        }
    }

    private setupServerDiffSection(): void {
        this.tooltip = 'Diferenças encontradas entre local e servidor';
        this.iconPath = new vscode.ThemeIcon('cloud-upload', new vscode.ThemeColor('charts.orange'));
        this.contextValue = 'serverdiffsection';
    }

    private setupServerDiffItem(diff: ServerDifference): void {
        const icon = this.getServerDiffIcon(diff.diffType);
        const color = this.getServerDiffColor(diff.diffType);
        
        this.tooltip = `${diff.relativePath}\nTipo: ${this.getServerDiffText(diff.diffType)}\n${diff.description}`;
        this.description = `[${this.getServerDiffShortText(diff.diffType)}] ${diff.description}`;
        this.iconPath = new vscode.ThemeIcon(icon, color);
        this.contextValue = 'serverdifference';
        
        if (!diff.isDirectory) {
            this.resourceUri = vscode.Uri.file(diff.path);
        }
    }

    private getServerDiffIcon(diffType: ServerDiffType): string {
        switch (diffType) {
            case ServerDiffType.LocalNewer: return 'arrow-up';
            case ServerDiffType.ServerNewer: return 'arrow-down';
            case ServerDiffType.OnlyInLocal: return 'add';
            case ServerDiffType.OnlyInServer: return 'remove';
            case ServerDiffType.Different: return 'diff';
            default: return 'question';
        }
    }

    private getServerDiffColor(diffType: ServerDiffType): vscode.ThemeColor {
        switch (diffType) {
            case ServerDiffType.LocalNewer: return new vscode.ThemeColor('charts.green');
            case ServerDiffType.ServerNewer: return new vscode.ThemeColor('charts.red');
            case ServerDiffType.OnlyInLocal: return new vscode.ThemeColor('charts.blue');
            case ServerDiffType.OnlyInServer: return new vscode.ThemeColor('charts.orange');
            case ServerDiffType.Different: return new vscode.ThemeColor('charts.purple');
            default: return new vscode.ThemeColor('foreground');
        }
    }

    private getServerDiffText(diffType: ServerDiffType): string {
        switch (diffType) {
            case ServerDiffType.LocalNewer: return 'Local mais recente';
            case ServerDiffType.ServerNewer: return 'Servidor mais recente';
            case ServerDiffType.OnlyInLocal: return 'Existe apenas localmente';
            case ServerDiffType.OnlyInServer: return 'Existe apenas no servidor';
            case ServerDiffType.Different: return 'Conteúdos diferentes';
            default: return 'Diferença desconhecida';
        }
    }

    private getServerDiffShortText(diffType: ServerDiffType): string {
        switch (diffType) {
            case ServerDiffType.LocalNewer: return 'L>';
            case ServerDiffType.ServerNewer: return 'S>';
            case ServerDiffType.OnlyInLocal: return 'L+';
            case ServerDiffType.OnlyInServer: return 'S+';
            case ServerDiffType.Different: return '≠';
            default: return '?';
        }
    }
}

/**
 * Provider da árvore de projetos locais
 */
export class LocalProjectsTreeProvider implements vscode.TreeDataProvider<LocalProjectTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<LocalProjectTreeItem | undefined | null | void> = new vscode.EventEmitter<LocalProjectTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<LocalProjectTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private projects: LocalProject[] = [];
    private fileWatchers: vscode.FileSystemWatcher[] = [];
    private refreshTimeout: NodeJS.Timeout | null = null;

    constructor() {
        this.refresh();
        this.setupAutoRefresh();
    }

    /**
     * 🚀 SISTEMA DE AUTO-REFRESH INTELIGENTE
     */
    private setupAutoRefresh(): void {
        console.log('🔄 Configurando sistema de auto-refresh inteligente...');

        // 1. Monitor de arquivos salvos (modificações)
        vscode.workspace.onDidSaveTextDocument((document) => {
            console.log(`💾 Arquivo salvo: ${document.fileName}`);
            
            // Dispara evento específico se é em um projeto MiiSync
            this.checkIfFileIsInProject(document.fileName);
            
            this.scheduleRefresh('arquivo salvo');
        });

        // 2. Monitor de arquivos criados
        vscode.workspace.onDidCreateFiles((event) => {
            console.log(`📁 Arquivos criados: ${event.files.length}`);
            this.scheduleRefresh('arquivos criados');
        });

        // 3. Monitor de arquivos deletados
        vscode.workspace.onDidDeleteFiles((event) => {
            console.log(`🗑️ Arquivos deletados: ${event.files.length}`);
            this.scheduleRefresh('arquivos deletados');
        });

        // 4. Monitor de mudanças de workspace
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            console.log('📂 Workspace folders mudaram');
            this.scheduleRefresh('workspace mudou');
        });

        // 5. Monitor específico para arquivos .miisync (path-mapping.json)
        this.setupMiiSyncWatchers();

        // 6. Auto-refresh periódico (a cada 30 segundos)
        setInterval(() => {
            console.log('⏰ Auto-refresh periódico');
            this.scheduleRefresh('auto-refresh periódico');
        }, 30000);

        // 7. Monitor quando VS Code ganha foco (pode ter mudanças externas)
        vscode.window.onDidChangeWindowState((state) => {
            if (state.focused) {
                console.log('👁️ VS Code ganhou foco - verificando mudanças');
                this.scheduleRefresh('foco ganho');
            }
        });

        // 8. 🚀 NOVO: Monitor de eventos específicos de projetos
        projectEvents.onProjectDownloaded((event) => {
            console.log(`🎉 Projeto baixado detectado: ${event.localPath}`);
            this.scheduleRefresh('projeto baixado');
        });

        projectEvents.onProjectModified((event) => {
            console.log(`📝 Projeto modificado detectado: ${event.localPath}`);
            this.scheduleRefresh('projeto modificado');
        });

        projectEvents.onProjectDeleted((event) => {
            console.log(`🗑️ Projeto deletado detectado: ${event.localPath}`);
            this.scheduleRefresh('projeto deletado');
        });
    }

    /**
     * Configura watchers específicos para arquivos .miisync
     */
    private setupMiiSyncWatchers(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        // Remove watchers antigos
        this.fileWatchers.forEach(watcher => watcher.dispose());
        this.fileWatchers = [];

        for (const folder of workspaceFolders) {
            // Watcher para path-mapping.json
            const mappingPattern = new vscode.RelativePattern(folder, '**/.miisync/path-mapping.json');
            const mappingWatcher = vscode.workspace.createFileSystemWatcher(mappingPattern);
            
            mappingWatcher.onDidCreate(() => {
                console.log('📋 path-mapping.json criado');
                this.scheduleRefresh('mapping criado');
            });
            
            mappingWatcher.onDidChange(() => {
                console.log('📋 path-mapping.json modificado');
                this.scheduleRefresh('mapping modificado');
            });
            
            mappingWatcher.onDidDelete(() => {
                console.log('📋 path-mapping.json deletado');
                this.scheduleRefresh('mapping deletado');
            });

            this.fileWatchers.push(mappingWatcher);

            // Watcher para novos diretórios .miisync
            const miisyncPattern = new vscode.RelativePattern(folder, '**/.miisync');
            const miisyncWatcher = vscode.workspace.createFileSystemWatcher(miisyncPattern);
            
            miisyncWatcher.onDidCreate(() => {
                console.log('📁 Novo diretório .miisync criado - novo projeto!');
                this.scheduleRefresh('novo projeto detectado');
            });

            this.fileWatchers.push(miisyncWatcher);
        }
    }

    /**
     * Verifica se um arquivo pertence a um projeto MiiSync e dispara evento
     */
    private async checkIfFileIsInProject(filePath: string): Promise<void> {
        try {
            // Procura o diretório .miisync mais próximo
            let currentDir = path.dirname(filePath);
            let projectRoot: string | null = null;
            
            while (currentDir && currentDir !== path.parse(currentDir).root) {
                const miisyncPath = path.join(currentDir, '.miisync');
                if (await fs.pathExists(miisyncPath)) {
                    projectRoot = currentDir;
                    break;
                }
                currentDir = path.dirname(currentDir);
            }
            
            if (projectRoot) {
                const fileName = path.basename(filePath);
                console.log(`📝 Arquivo em projeto MiiSync: ${fileName} (projeto: ${projectRoot})`);
                projectEvents.fireProjectModified(projectRoot, fileName);
            }
        } catch (error) {
            console.error('❌ Erro ao verificar se arquivo está em projeto:', error);
        }
    }

    /**
     * Agenda um refresh com debounce para evitar muitos refreshes seguidos
     */
    private scheduleRefresh(reason: string): void {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }

        this.refreshTimeout = setTimeout(() => {
            console.log(`🔄 Executando refresh: ${reason}`);
            this.refresh();
            this.refreshTimeout = null;
        }, 500); // 500ms de debounce
    }

    refresh(): void {
        this.loadProjects();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: LocalProjectTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: LocalProjectTreeItem): Thenable<LocalProjectTreeItem[]> {
        if (!element) {
            // Retorna os projetos raiz
            return Promise.resolve(this.projects.map(project => {
                const hasContent = project.modifiedFiles.length > 0 || 
                                 (project.serverVerification?.differences.length || 0) > 0;
                
                return new LocalProjectTreeItem(
                    project.name,
                    hasContent ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
                    true,
                    project
                );
            }));
        } else if (element.isProject && element.project) {
            // Retorna os filhos do projeto: arquivos modificados + diferenças do servidor
            const children: LocalProjectTreeItem[] = [];
            
            // Adiciona arquivos modificados
            element.project.modifiedFiles.forEach(file => {
                children.push(new LocalProjectTreeItem(
                    file.fileName,
                    vscode.TreeItemCollapsibleState.None,
                    false,
                    undefined,
                    file
                ));
            });
            
            // Adiciona seção de diferenças do servidor (se houver)
            const serverVerification = element.project.serverVerification;
            if (serverVerification && serverVerification.differences.length > 0) {
                children.push(new LocalProjectTreeItem(
                    `📡 Diferenças do Servidor (${serverVerification.differences.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    false,
                    element.project,  // Passa o projeto para poder acessar as diferenças
                    undefined,
                    undefined,
                    true
                ));
            }
            
            return Promise.resolve(children);
        } else if (element.isServerDiffSection && element.project?.serverVerification) {
            // Retorna as diferenças do servidor
            return Promise.resolve(element.project.serverVerification.differences.map(diff =>
                new LocalProjectTreeItem(
                    path.basename(diff.relativePath),
                    vscode.TreeItemCollapsibleState.None,
                    false,
                    undefined,
                    undefined,
                    diff
                )
            ));
        }

        return Promise.resolve([]);
    }

    /**
     * Carrega os projetos locais analisando as pastas com path-mapping.json
     */
    private async loadProjects(): Promise<void> {
        const projects: LocalProject[] = [];

        try {
            // Encontra todas as pastas de workspace
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                this.projects = projects;
                return;
            }

            for (const folder of workspaceFolders) {
                await this.scanFolderForProjects(folder.uri.fsPath, projects);
            }

            this.projects = projects;
        } catch (error) {
            console.error('❌ Erro ao carregar projetos locais:', error);
            this.projects = [];
        }
    }

    /**
     * Escaneia uma pasta em busca de projetos (pastas com .miisync/path-mapping.json)
     */
    private async scanFolderForProjects(folderPath: string, projects: LocalProject[]): Promise<void> {
        try {
            const items = await fs.readdir(folderPath, { withFileTypes: true });

            for (const item of items) {
                if (item.isDirectory()) {
                    const itemPath = path.join(folderPath, item.name);
                    const mappingPath = path.join(itemPath, '.miisync', 'path-mapping.json');

                    // Verifica se é um projeto (tem mapeamento)
                    if (await fs.pathExists(mappingPath)) {
                        const project = await this.createProjectFromMapping(itemPath, mappingPath);
                        if (project) {
                            projects.push(project);
                        }
                    }

                    // Recursivamente escaneia subpastas (até 2 níveis)
                    if (folderPath === vscode.workspace.workspaceFolders?.[0]?.uri.fsPath) {
                        await this.scanFolderForProjects(itemPath, projects);
                    }
                }
            }
        } catch (error) {
            // Ignora erros de acesso a pastas
        }
    }

    /**
     * Cria um objeto LocalProject a partir do arquivo de mapeamento
     */
    private async createProjectFromMapping(projectPath: string, mappingPath: string): Promise<LocalProject | null> {
        try {
            const mappingData = await fs.readJson(mappingPath);
            const stats = await fs.stat(mappingPath);

            // Obtém o nome do projeto (nome da pasta)
            const projectName = path.basename(projectPath);

            // Obtém o caminho remoto do diretório raiz do projeto
            let remotePath = '/';
            
            if (mappingData.rootRemotePath) {
                // Usa o caminho raiz remoto diretamente do arquivo de mapeamento
                remotePath = mappingData.rootRemotePath.replace(/\\/g, '/');
            } else if (mappingData.mappings?.[0]) {
                // Fallback: remove o arquivo específico para obter o caminho da pasta
                const firstMapping = mappingData.mappings[0];
                const remoteDir = path.dirname(firstMapping.remotePath).replace(/\\/g, '/');
                remotePath = remoteDir;
            }

            // Encontra arquivos modificados
            const modifiedFiles = await this.findModifiedFiles(projectPath);

            return {
                name: projectName,
                localPath: projectPath,
                remotePath: remotePath,
                downloadedAt: stats.birthtime || stats.mtime,
                modifiedFiles: modifiedFiles
            };

        } catch (error) {
            console.error('❌ Erro ao criar projeto do mapeamento:', error);
            return null;
        }
    }

    /**
     * Encontra arquivos que foram modificados localmente e ainda não foram sincronizados
     */
    private async findModifiedFiles(projectPath: string): Promise<ModifiedFile[]> {
        const modifiedFiles: ModifiedFile[] = [];

        try {
            const mappingPath = path.join(projectPath, '.miisync', 'path-mapping.json');
            const mappingData = await fs.readJson(mappingPath);

            // Cria um mapa dos arquivos mapeados para verificação rápida
            const mappedFiles = new Map<string, any>();
            for (const mapping of mappingData.mappings || []) {
                mappedFiles.set(mapping.localPath.toLowerCase(), mapping);
            }

            // Verifica arquivos que existem no mapeamento
            for (const mapping of mappingData.mappings || []) {
                const fullPath = path.join(projectPath, mapping.localPath);
                
                if (await fs.pathExists(fullPath)) {
                    // Arquivo existe - verifica se foi modificado
                    const stats = await fs.stat(fullPath);
                    let wasModified = false;
                    let modificationReason = '';
                    
                    // ESTRATÉGIA DUPLA: Verifica TANTO data quanto hash para máxima precisão
                    
                    // 1. Verifica data de modificação vs data salva no download
                    let dateChanged = false;
                    if (mapping.localModifiedAtDownload) {
                        const downloadDate = new Date(mapping.localModifiedAtDownload);
                        const currentDate = stats.mtime;
                        const timeDiff = Math.abs(currentDate.getTime() - downloadDate.getTime());
                        
                        if (timeDiff > 1000) {
                            dateChanged = true;
                            modificationReason += `data (diff: ${timeDiff}ms) `;
                        }
                    }
                    
                    // 2. Verifica hash do conteúdo (sempre que possível)
                    let hashChanged = false;
                    if (mapping.contentHash) {
                        const currentHash = await this.calculateFileHash(fullPath);
                        if (currentHash !== mapping.contentHash) {
                            hashChanged = true;
                            modificationReason += `conteúdo `;
                        }
                    }
                    
                    // 3. Decisão final: arquivo só é considerado modificado se:
                    // - Data mudou E hash mudou (arquivo realmente alterado)
                    // - Ou só hash mudou (se não tem data salva)
                    // - Ou só data mudou (se não tem hash salvo)
                    if (mapping.contentHash && mapping.localModifiedAtDownload) {
                        // Tem ambos: só considera modificado se HASH mudou
                        wasModified = hashChanged;
                        if (hashChanged) {
                            console.log(`📝 Arquivo modificado (conteúdo): ${mapping.localPath}`);
                        } else if (dateChanged) {
                            console.log(`⏰ Data mudou mas conteúdo igual: ${mapping.localPath} - IGNORANDO`);
                        }
                    } else if (mapping.contentHash) {
                        // Só tem hash: verifica hash
                        wasModified = hashChanged;
                        if (hashChanged) {
                            console.log(`📝 Arquivo modificado por hash: ${mapping.localPath}`);
                        }
                    } else if (mapping.localModifiedAtDownload) {
                        // Só tem data: verifica data
                        wasModified = dateChanged;
                        if (dateChanged) {
                            console.log(`📝 Arquivo modificado por data: ${mapping.localPath}`);
                        }
                    } else {
                        // Não tem metadata: considera não modificado (evita falsos positivos)
                        wasModified = false;
                        console.log(`⚠️ Sem metadata para comparar: ${mapping.localPath} - ASSUMINDO NÃO MODIFICADO`);
                    }
                    
                    // Só adiciona se realmente foi modificado
                    if (wasModified) {
                        modifiedFiles.push({
                            fileName: path.basename(fullPath),
                            filePath: fullPath,
                            relativePath: mapping.localPath,
                            lastModified: stats.mtime,
                            hasLocalChanges: true,
                            status: FileStatus.Modified,
                            originalHash: mapping.contentHash
                        });
                    }
                } else {
                    // Arquivo foi deletado
                    modifiedFiles.push({
                        fileName: path.basename(mapping.localPath),
                        filePath: path.join(projectPath, mapping.localPath),
                        relativePath: mapping.localPath,
                        lastModified: new Date(),
                        hasLocalChanges: true,
                        status: FileStatus.Deleted,
                        originalHash: mapping.contentHash
                    });
                }
            }

            // Procura por novos arquivos que não estão no mapeamento
            await this.findUnmappedFiles(projectPath, mappedFiles, modifiedFiles);

        } catch (error) {
            console.error('❌ Erro ao encontrar arquivos modificados:', error);
        }

        return modifiedFiles;
    }

    /**
     * Calcula hash SHA-256 do conteúdo do arquivo (considerando se é binário)
     */
    private async calculateFileHash(filePath: string): Promise<string> {
        try {
            // Detecta se é arquivo binário baseado na extensão
            const extension = path.extname(filePath).toLowerCase();
            const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', 
                                     '.woff', '.woff2', '.ttf', '.otf', '.eot',
                                     '.pdf', '.zip', '.rar', '.7z', '.exe', '.dll',
                                     '.mp3', '.mp4', '.avi', '.mov', '.wav'];
            
            const isBinary = binaryExtensions.includes(extension);
            
            if (isBinary) {
                // Para arquivos binários, usa estatísticas do arquivo (size + mtime) como "hash"
                const stats = await fs.stat(filePath);
                const hashInput = `${stats.size}-${stats.mtime.getTime()}`;
                return crypto.createHash('sha256').update(hashInput).digest('hex');
            } else {
                // Para arquivos de texto, usa o conteúdo real
                const content = await fs.readFile(filePath, 'utf8');
                return crypto.createHash('sha256').update(content).digest('hex');
            }
        } catch (error) {
            console.error('❌ Erro ao calcular hash do arquivo:', error);
            return '';
        }
    }

    /**
     * Encontra arquivos novos que ainda não estão no mapeamento
     */
    private async findUnmappedFiles(projectPath: string, mappedFiles: Map<string, any>, modifiedFiles: ModifiedFile[]): Promise<void> {
        try {
            const allFiles = await this.getAllFiles(projectPath);

            for (const filePath of allFiles) {
                // Ignora arquivos do .miisync e outros arquivos especiais
                if (filePath.includes('.miisync') || filePath.includes('.git') || filePath.includes('node_modules')) {
                    continue;
                }

                const relativePath = path.relative(projectPath, filePath);

                // Se o arquivo não está mapeado, é considerado novo
                if (!mappedFiles.has(relativePath.toLowerCase())) {
                    const stats = await fs.stat(filePath);

                    modifiedFiles.push({
                        fileName: path.basename(filePath),
                        filePath: filePath,
                        relativePath: relativePath,
                        lastModified: stats.mtime,
                        hasLocalChanges: true,
                        status: FileStatus.Added
                    });
                }
            }
        } catch (error) {
            console.error('❌ Erro ao encontrar arquivos não mapeados:', error);
        }
    }

    /**
     * Obtém todos os arquivos de um diretório recursivamente
     */
    private async getAllFiles(dirPath: string): Promise<string[]> {
        const files: string[] = [];

        try {
            const items = await fs.readdir(dirPath, { withFileTypes: true });

            for (const item of items) {
                const fullPath = path.join(dirPath, item.name);

                if (item.isDirectory()) {
                    const subFiles = await this.getAllFiles(fullPath);
                    files.push(...subFiles);
                } else {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            // Ignora erros de acesso
        }

        return files;
    }

    /**
     * Limpa recursos quando a extensão é desativada
     */
    dispose(): void {
        console.log('🧹 Limpando watchers do LocalProjectsTree...');
        
        // Limpa timeout de refresh
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
            this.refreshTimeout = null;
        }

        // Limpa file watchers
        this.fileWatchers.forEach(watcher => {
            watcher.dispose();
        });
        this.fileWatchers = [];

        // Limpa event emitter
        this._onDidChangeTreeData.dispose();
    }
}

// Instância singleton do provider
export const localProjectsTree = new LocalProjectsTreeProvider();
