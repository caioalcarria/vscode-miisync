import * as vscode from "vscode";
import { File, Folder } from "../../miiservice/abstract/responsetypes";
import { TreeDataProvider, TreeItem } from "./tree";
import { localProjectsTree } from "./localprojectstree";
import { remoteDirectoryDecorationProvider } from "../decorations/remotedirectorydecorations";

class RemoteDirectoryTree extends TreeDataProvider {
    private directory: (File | Folder)[];
    private refreshTimeout: NodeJS.Timeout | null = null;

    constructor() {
        super();
        // Escuta mudanças nos projetos locais para atualizar decorações
        this.setupProjectChangeListener();
    }

    /**
     * Força atualização imediata (uso público)
     */
    public forceRefresh(): void {
        //console.log('🔄 Force refresh do remote directory tree');
        this.refreshDecorationsAndTree();
    }

    /**
     * Configura listener para mudanças nos projetos locais
     */
    private setupProjectChangeListener(): void {
        // Escuta mudanças nos projetos locais
        localProjectsTree.onDidChangeTreeData(() => {
            //console.log('🔄 Projetos locais alterados - atualizando remote directory tree');
            this.refreshWithDelay();
        });
        
        // Escuta eventos específicos de projeto usando VS Code EventEmitter
        const { projectEvents } = require('../../events/projectevents');
        projectEvents.onProjectDownloaded(() => {
            //console.log('📥 Projeto baixado - atualizando remote directory tree');
            this.refreshWithDelay();
        });
    }
    
    /**
     * Refresh com delay para evitar múltiplas atualizações
     */
    private refreshWithDelay(delayMs: number = 500): void {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        
        this.refreshTimeout = setTimeout(() => {
            this.refreshDecorationsAndTree();
            this.refreshTimeout = null;
        }, delayMs);
    }
    
    /**
     * Atualiza decorações e tree
     */
    private refreshDecorationsAndTree(): void {
        remoteDirectoryDecorationProvider.refresh();
        this.refresh();
    }

    generateItems(directory: (File | Folder)[]) {
        const items: TreeItem[] = this.generate(directory, []);

        this.items = items;
        this.directory = directory;
        this.refresh();
    }

    generateItemsByFiles(files: File[]) {
        const folders: TreeItem[] = [];
        for (const file of files) {
            const folder = findFolder(file.FilePath);
            const item = new TreeItem(file.ObjectName);
            item.iconPath = vscode.ThemeIcon.File;
            item.data = { filePath: file.FilePath, name: file.ObjectName };
            
            // Verifica se este arquivo está em uma pasta já carregada localmente
            const localProjects = localProjectsTree.getProjects();
            const isFileInLoadedProject = localProjects.some(project => 
                file.FilePath.startsWith(project.remotePath) || 
                file.FilePath.startsWith(project.remotePath + '/') ||
                (project.remotePath + '/').startsWith(file.FilePath)
            );
            
            if (isFileInLoadedProject) {
                // Arquivo está em projeto carregado - não mostra botão de download
                item.contextValue = 'file-loaded';
                item.description = '✓ In loaded project';
            } else {
                // Arquivo não está em projeto carregado - mostra botão de download
                item.contextValue = file.ObjectName;
            }
            
            folder.children.push(item);
        }

        function findFolder(folderPath: string): TreeItem {
            for (const folder of folders) {
                if (folderPath == folder.data) {
                    return folder;
                }
            }

            const folderName = folderPath.substring(folderPath.lastIndexOf('/') + 1);
            let folder = new TreeItem(folderName, [])
            folder.iconPath = vscode.ThemeIcon.Folder;
            folder.data = folderPath;
            folder.contextValue = 'folder';
            
            // Verifica se esta pasta já está carregada localmente
            const localProjects = localProjectsTree.getProjects();
            const matchingProjects = localProjects.filter(project => 
                project.remotePath === folderPath || 
                project.remotePath === folderPath + '/' ||
                project.remotePath + '/' === folderPath
            );
            
            if (matchingProjects.length > 0) {
                // Pasta já está carregada localmente
                folder.contextValue = 'folder-loaded';
                folder.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
                folder.resourceUri = vscode.Uri.parse(`miisync-loaded:///${folderName}`);
                folder.description = `✓ Loaded (${matchingProjects.length} project${matchingProjects.length > 1 ? 's' : ''})`;
            }
            
            folders.push(folder);

            const originalFolder = folder;


            const parentFolders = folderPath.split('/');
            for (let index = parentFolders.length - 2; index > -1; index--) {
                const pfolderName = parentFolders[index];
                const path = folderPath.substring(0, folderPath.lastIndexOf(pfolderName) + pfolderName.length);
                const exists = folders.find((item) => item.data == path);
                if (!exists) {
                    const pFolder = new TreeItem(pfolderName, [folder]);
                    pFolder.data = path;
                    pFolder.iconPath = vscode.ThemeIcon.Folder;
                    pFolder.contextValue = 'folder';
                    folders.push(pFolder);
                    folder = pFolder;
                }
                else {
                    exists.children.push(folder);
                    break;
                }
            }


            return originalFolder;
        }

        let currentRoots: TreeItem[] = [];
        let currentDepth = 99;
        for (const folder of folders) {
            const depth = (folder.data?.match(new RegExp('/', "g")) || []).length;
            if (depth < currentDepth) {
                currentRoots = [folder];
                currentDepth = depth;
            }
            else if (depth == currentDepth) {
                currentRoots.push(folder);
            }
            folder.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

            folder.children.sort(function (a, b) {
                const isAFolder = a.children != null; const isBFolder = b.children != null;
                if (isAFolder == isBFolder) return a.label < b.label ? -1 : 1;
                if (!isAFolder && isBFolder) return 1;
                if (isAFolder && !isBFolder) return -1;
                return 0;
            });
        }

        this.items = currentRoots;
        this.refresh();
    }

    private generate(directory: (File | Folder)[], items: TreeItem[] = []): TreeItem[] {
        for (const item of directory) {
            if ('FolderName' in item) {
                const folder = new TreeItem(item.FolderName, []);
                if (item.children) {
                    folder.children = this.generate(item.children, folder.children)
                }
                items.push(folder);
            }
            else {
                const file = new TreeItem(item.ObjectName);
                items.push(file);
            }
        }
        return items;
    }
}



export const remoteDirectoryTree: RemoteDirectoryTree = new RemoteDirectoryTree();