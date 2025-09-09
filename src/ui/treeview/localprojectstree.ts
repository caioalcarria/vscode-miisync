import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import { PathMappingManager } from '../../modules/pathmapping';

/**
 * Status de modificação do arquivo
 */
export enum FileStatus {
    Modified = 'M',  // Arquivo modificado
    Added = 'A',     // Arquivo novo (não estava no mapeamento)
    Deleted = 'D'    // Arquivo deletado (estava no mapeamento mas não existe mais)
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
 * Item da árvore que pode ser um projeto ou um arquivo
 */
export class LocalProjectTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isProject: boolean = false,
        public readonly project?: LocalProject,
        public readonly modifiedFile?: ModifiedFile
    ) {
        super(label, collapsibleState);
        
        if (isProject && project) {
            this.setupProjectItem(project);
        } else if (modifiedFile) {
            this.setupFileItem(modifiedFile);
        }
    }

    private setupProjectItem(project: LocalProject): void {
        this.tooltip = `${project.name}\nServidor: ${project.remotePath}\nBaixado em: ${project.downloadedAt.toLocaleString()}\nArquivos modificados: ${project.modifiedFiles.length}`;
        this.description = `${project.modifiedFiles.length} arquivo(s) modificado(s)`;
        this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
        this.contextValue = 'localproject';
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
}

/**
 * Provider da árvore de projetos locais
 */
export class LocalProjectsTreeProvider implements vscode.TreeDataProvider<LocalProjectTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<LocalProjectTreeItem | undefined | null | void> = new vscode.EventEmitter<LocalProjectTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<LocalProjectTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private projects: LocalProject[] = [];

    constructor() {
        this.refresh();
        
        // Atualiza a árvore quando arquivos são salvos
        vscode.workspace.onDidSaveTextDocument(() => {
            this.refresh();
        });

        // Atualiza quando arquivos são criados/deletados
        vscode.workspace.onDidCreateFiles(() => {
            setTimeout(() => this.refresh(), 1000);
        });

        vscode.workspace.onDidDeleteFiles(() => {
            setTimeout(() => this.refresh(), 1000);
        });
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
            return Promise.resolve(this.projects.map(project => 
                new LocalProjectTreeItem(
                    project.name,
                    project.modifiedFiles.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
                    true,
                    project
                )
            ));
        } else if (element.isProject && element.project) {
            // Retorna os arquivos modificados do projeto
            return Promise.resolve(element.project.modifiedFiles.map(file =>
                new LocalProjectTreeItem(
                    file.fileName,
                    vscode.TreeItemCollapsibleState.None,
                    false,
                    undefined,
                    file
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

            // Obtém o caminho remoto do primeiro mapeamento
            const firstMapping = mappingData.mappings?.[0];
            let remotePath = '/';
            
            if (firstMapping) {
                // Remove o arquivo específico para obter o caminho da pasta
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
                    const currentHash = await this.calculateFileHash(fullPath);
                    const originalHash = mapping.contentHash;

                    if (!originalHash || currentHash !== originalHash) {
                        const stats = await fs.stat(fullPath);
                        modifiedFiles.push({
                            fileName: path.basename(fullPath),
                            filePath: fullPath,
                            relativePath: mapping.localPath,
                            lastModified: stats.mtime,
                            hasLocalChanges: true,
                            status: FileStatus.Modified,
                            originalHash: originalHash
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
     * Calcula hash SHA-256 do conteúdo do arquivo
     */
    private async calculateFileHash(filePath: string): Promise<string> {
        try {
            const content = await fs.readFile(filePath);
            return crypto.createHash('sha256').update(content).digest('hex');
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
}

// Instância singleton do provider
export const localProjectsTree = new LocalProjectsTreeProvider();
