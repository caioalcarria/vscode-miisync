import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { localProjectsTree } from '../treeview/localprojectstree';

class ProjectFolderDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> = this._onDidChangeFileDecorations.event;

    constructor() {
        // Atualiza decorações quando projetos mudam
        localProjectsTree.onDidChangeTreeData(() => {
            this._onDidChangeFileDecorations.fire(undefined);
            
            // Também notificar a aba Projects
            this.notifyProjectsTree();
        });
    }

    private notifyProjectsTree(): void {
        try {
            // Importar dinamicamente para evitar dependência circular
            const projectsTreeModule = require('../treeview/projectsTree');
            if (projectsTreeModule.projectsTree) {
                projectsTreeModule.projectsTree.refresh();
            }
        } catch (error) {
            // Ignorar erro se não conseguir importar
        }
    }

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        if (this.isMiiSyncProject(uri.fsPath)) {
            return {
                badge: '●',
                tooltip: 'Projeto MiiSync Sincronizado',
                color: new vscode.ThemeColor('charts.blue')
            };
        }
        return undefined;
    }

    private isMiiSyncProject(folderPath: string): boolean {
        try {
            // Verifica se é uma pasta
            const stat = fs.statSync(folderPath);
            if (!stat.isDirectory()) {
                return false;
            }

            // Método 1: Verifica se existe .miisync/path-mapping.json
            const pathMappingFile = path.join(folderPath, '.miisync', 'path-mapping.json');
            if (fs.existsSync(pathMappingFile)) {
                return true;
            }

            // Método 2: Verifica se a pasta está na lista de projetos carregados
            const projects = localProjectsTree.getProjects();
            const normalizedFolderPath = path.normalize(folderPath).toLowerCase();
            
            return projects.some(project => {
                const normalizedProjectPath = path.normalize(project.localPath).toLowerCase();
                return normalizedProjectPath === normalizedFolderPath;
            });

        } catch (error) {
            return false;
        }
    }

    public refresh(): void {
        this._onDidChangeFileDecorations.fire(undefined);
    }
}

export const projectFolderDecorationProvider = new ProjectFolderDecorationProvider();
