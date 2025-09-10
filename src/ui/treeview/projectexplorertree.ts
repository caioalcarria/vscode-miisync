import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { localProjectsTree, LocalProject } from './localprojectstree';

/**
 * Item da árvore do Project Explorer
 */
export class ProjectExplorerItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: 'project' | 'folder' | 'file',
        public readonly fullPath: string,
        public readonly project?: LocalProject
    ) {
        super(label, collapsibleState);
        
        this.tooltip = this.fullPath;
        this.contextValue = itemType;
        
        // Define ícones baseados no tipo
        switch (itemType) {
            case 'project':
                this.iconPath = new vscode.ThemeIcon('folder-opened');
                this.description = project?.remotePath ? `${project.remotePath}` : '';
                break;
            case 'folder':
                this.iconPath = vscode.ThemeIcon.Folder;
                break;
            case 'file':
                this.iconPath = vscode.ThemeIcon.File;
                this.command = {
                    command: 'vscode.open',
                    title: 'Open File',
                    arguments: [vscode.Uri.file(fullPath)]
                };
                break;
        }
    }
}

/**
 * Provider da árvore do Project Explorer
 */
export class ProjectExplorerTreeProvider implements vscode.TreeDataProvider<ProjectExplorerItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectExplorerItem | undefined | null | void> = new vscode.EventEmitter<ProjectExplorerItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectExplorerItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor() {
        this.refresh();
        this.setupAutoRefresh();
    }

    /**
     * Atualiza a árvore
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Configura auto-refresh quando projetos mudam
     */
    private setupAutoRefresh(): void {
        localProjectsTree.onDidChangeTreeData(() => {
            this.refresh();
        });
    }

    getTreeItem(element: ProjectExplorerItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ProjectExplorerItem): Promise<ProjectExplorerItem[]> {
        if (!element) {
            // Root level - mostra projetos
            return this.getProjects();
        }

        if (element.itemType === 'project' || element.itemType === 'folder') {
            // Mostra conteúdo da pasta
            return this.getFolderContents(element.fullPath, element.project);
        }

        return [];
    }

    /**
     * Obtém lista de projetos
     */
    private async getProjects(): Promise<ProjectExplorerItem[]> {
        const projects = localProjectsTree.getProjects();
        const items: ProjectExplorerItem[] = [];

        for (const project of projects) {
            if (await fs.pathExists(project.localPath)) {
                const item = new ProjectExplorerItem(
                    project.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'project',
                    project.localPath,
                    project
                );
                items.push(item);
            }
        }

        return items.sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * Obtém conteúdo de uma pasta
     */
    private async getFolderContents(folderPath: string, project?: LocalProject): Promise<ProjectExplorerItem[]> {
        const items: ProjectExplorerItem[] = [];

        try {
            const entries = await fs.readdir(folderPath, { withFileTypes: true });

            for (const entry of entries) {
                // Ignora pastas especiais
                if (entry.name.startsWith('.') && entry.name !== '.vscode') {
                    continue;
                }

                const fullPath = path.join(folderPath, entry.name);

                if (entry.isDirectory()) {
                    const item = new ProjectExplorerItem(
                        entry.name,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'folder',
                        fullPath,
                        project
                    );
                    items.push(item);
                } else {
                    const item = new ProjectExplorerItem(
                        entry.name,
                        vscode.TreeItemCollapsibleState.None,
                        'file',
                        fullPath,
                        project
                    );
                    items.push(item);
                }
            }
        } catch (error) {
            console.error(`❌ Erro ao ler pasta ${folderPath}:`, error);
        }

        // Ordena: pastas primeiro, depois arquivos
        return items.sort((a, b) => {
            if (a.itemType === 'folder' && b.itemType === 'file') return -1;
            if (a.itemType === 'file' && b.itemType === 'folder') return 1;
            return a.label.localeCompare(b.label);
        });
    }
}

export const projectExplorerTree = new ProjectExplorerTreeProvider();
