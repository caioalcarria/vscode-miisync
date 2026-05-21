import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type ProjectCategory = 'web' | 'catalog';

export class ProjectItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly projectPath: string | null,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string = 'project',
        public readonly category: ProjectCategory = 'web',
        public readonly isCategory: boolean = false
    ) {
        super(label, collapsibleState);

        if (isCategory) {
            const isWeb = category === 'web';
            this.iconPath = new vscode.ThemeIcon(
                isWeb ? 'globe' : 'database',
                new vscode.ThemeColor(isWeb ? 'charts.blue' : 'charts.purple')
            );
            this.contextValue = 'project-category';
            return;
        }

        this.tooltip = projectPath;
        this.description = path.basename(path.dirname(projectPath));
        this.resourceUri = vscode.Uri.file(projectPath);
        this.iconPath = new vscode.ThemeIcon(
            'folder',
            new vscode.ThemeColor(category === 'web' ? 'charts.blue' : 'charts.purple')
        );
        this.command = {
            command: 'miisync.openproject',
            title: 'Abrir Projeto',
            arguments: [projectPath]
        };
    }

    static forCategory(category: ProjectCategory, projectCount: number): ProjectItem {
        const isWeb = category === 'web';
        const item = new ProjectItem(
            isWeb ? 'Web' : 'Catalog — TRX & Queries',
            null,
            vscode.TreeItemCollapsibleState.Expanded,
            'project-category',
            category,
            true
        );
        item.description = `${projectCount} projeto(s)`;
        return item;
    }
}

export class ProjectsTreeProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectItem | undefined | null | void> = new vscode.EventEmitter<ProjectItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private projects: ProjectItem[] = [];

    constructor() {
        this.refresh();
        
        // Sincronizar com mudanças do localProjectsTree
        this.setupSyncWithLocalProjects();
    }

    private setupSyncWithLocalProjects(): void {
        try {
            // Importar dinamicamente para evitar dependência circular
            const localProjectsTreeModule = require('./localprojectstree');
            if (localProjectsTreeModule.localProjectsTree) {
                // Escutar mudanças no localProjectsTree
                localProjectsTreeModule.localProjectsTree.onDidChangeTreeData(() => {
                    // Atualizar automaticamente quando Local Changes muda
                    this.refresh();
                });
            }
        } catch (error) {
            console.log('Não foi possível sincronizar com localProjectsTree:', error);
        }
    }

    refresh(): void {
        this.loadProjects();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ProjectItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ProjectItem): Thenable<ProjectItem[]> {
        if (!element) {
            const webProjects = this.projects.filter(p => p.category === 'web');
            const catalogProjects = this.projects.filter(p => p.category === 'catalog');
            const categories: ProjectItem[] = [];
            if (webProjects.length > 0)
                categories.push(ProjectItem.forCategory('web', webProjects.length));
            if (catalogProjects.length > 0)
                categories.push(ProjectItem.forCategory('catalog', catalogProjects.length));
            return Promise.resolve(categories);
        }
        if (element.isCategory) {
            return Promise.resolve(this.projects.filter(p => p.category === element.category));
        }
        return Promise.resolve([]);
    }

    private loadProjects(): void {
        this.projects = [];
        
        // APENAS buscar projetos no workspace atual
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        // Escanear APENAS as pastas do workspace atual
        workspaceFolders.forEach(folder => {
            this.scanWorkspaceForProjects(folder.uri.fsPath);
        });
    }

    private isWebSegment(p: string): boolean {
        return /(?:^|\/)WEB(?:\/|$)/.test(p);
    }

    private getProjectCategory(folderPath: string): ProjectCategory {
        try {
            const mappingFile = path.join(folderPath, '.miisync', 'path-mapping.json');
            if (fs.existsSync(mappingFile)) {
                const mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
                if (this.isWebSegment(mapping.rootRemotePath || '')) return 'web';
                const mappings: any[] = mapping.mappings || [];
                if (mappings.some((m) => this.isWebSegment(m.remotePath || ''))) return 'web';
                return 'catalog';
            }
        } catch {}
        return 'catalog';
    }

    private scanWorkspaceForProjects(workspacePath: string): void {
        try {
            const items = fs.readdirSync(workspacePath, { withFileTypes: true });
            items.forEach(item => {
                if (item.isDirectory()) {
                    const projectPath = path.join(workspacePath, item.name);
                    if (this.isMiiSyncProject(projectPath)) {
                        const category = this.getProjectCategory(projectPath);
                        this.projects.push(new ProjectItem(
                            item.name,
                            projectPath,
                            vscode.TreeItemCollapsibleState.None,
                            'project',
                            category
                        ));
                    }
                }
            });
        } catch (error) {
            // Ignorar erros de acesso
        }
    }

    private isMiiSyncProject(folderPath: string): boolean {
        try {
            // Verifica se é uma pasta
            const stat = fs.statSync(folderPath);
            if (!stat.isDirectory()) {
                return false;
            }

            // EXATAMENTE a mesma lógica do projectfolderdecorations.ts
            // Método 1: Verifica se existe .miisync/path-mapping.json
            const pathMappingFile = path.join(folderPath, '.miisync', 'path-mapping.json');
            if (fs.existsSync(pathMappingFile)) {
                return true;
            }

            // Método 2: Verifica se a pasta está na lista de projetos carregados
            // Importar dinamicamente para evitar dependência circular
            try {
                const localProjectsTreeModule = require('./localprojectstree');
                const projects = localProjectsTreeModule.localProjectsTree.getProjects();
                const normalizedFolderPath = path.normalize(folderPath).toLowerCase();
                
                return projects.some((project: any) => {
                    const normalizedProjectPath = path.normalize(project.localPath).toLowerCase();
                    return normalizedProjectPath === normalizedFolderPath;
                });
            } catch (importError) {
                // Se falhar a importação, usar apenas o método 1
                return false;
            }

        } catch (error) {
            return false;
        }
    }

    public getProjects(): ProjectItem[] {
        return this.projects;
    }

    public addProject(projectPath: string): void {
        const projectName = path.basename(projectPath);
        const projectItem = new ProjectItem(
            projectName,
            projectPath,
            vscode.TreeItemCollapsibleState.None
        );
        
        // Verificar se já existe
        const exists = this.projects.some(p => p.projectPath === projectPath);
        if (!exists) {
            this.projects.push(projectItem);
            this._onDidChangeTreeData.fire();
        }
    }

    public removeProject(projectPath: string): void {
        const index = this.projects.findIndex(p => p.projectPath === projectPath);
        if (index !== -1) {
            this.projects.splice(index, 1);
            this._onDidChangeTreeData.fire();
        }
    }
}

export const projectsTree = new ProjectsTreeProvider();
