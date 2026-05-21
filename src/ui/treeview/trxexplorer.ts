import * as vscode from "vscode";
import { IsFatalResponse } from "../../miiservice/abstract/filters";
import { File, Folder } from "../../miiservice/abstract/responsetypes";
import { listFilesService } from "../../miiservice/listfilesservice";
import { listFoldersService } from "../../miiservice/listfoldersservice";
import { configManager } from "../../modules/config";

export class TrxItem extends vscode.TreeItem {
    readonly remotePath: string;
    readonly isFolder: boolean;
    readonly fileData?: { filePath: string; name: string };

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        remotePath: string,
        isFolder: boolean,
        contextValue: string,
        fileData?: { filePath: string; name: string }
    ) {
        super(label, collapsibleState);
        this.remotePath = remotePath;
        this.isFolder = isFolder;
        this.contextValue = contextValue;
        this.fileData = fileData;
    }

    static fromFolder(folder: Folder): TrxItem {
        const item = new TrxItem(
            folder.FolderName,
            vscode.TreeItemCollapsibleState.Collapsed,
            folder.Path,
            true,
            'trx-folder'
        );
        item.iconPath = vscode.ThemeIcon.Folder;
        item.tooltip = folder.Path;
        return item;
    }

    static fromFile(file: File): TrxItem {
        const ext = file.ObjectName.split('.').pop()?.toLowerCase() || '';
        const contextValue = ext === 'trx' ? 'trx-file-trx' : 'trx-file';
        // DcSpecificPath is the actual catalog path (e.g. MES/Folder/File.trx).
        // FilePath may contain a web-accessible path which would upload to the wrong place.
        const remotePath = file.DcSpecificPath || (file.FilePath + '/' + file.ObjectName);
        const item = new TrxItem(
            file.ObjectName,
            vscode.TreeItemCollapsibleState.None,
            remotePath,
            false,
            contextValue,
            { filePath: file.FilePath, name: file.ObjectName }
        );
        item.iconPath = vscode.ThemeIcon.File;
        item.description = file.Modified
            ? new Date(file.Modified).toLocaleDateString('pt-BR')
            : undefined;
        item.tooltip = `${remotePath}\nModificado: ${file.Modified || 'N/A'}`;
        return item;
    }
}

class TrxDirectoryTree implements vscode.TreeDataProvider<TrxItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TrxItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private rootPath = 'MES';
    private cache = new Map<string, TrxItem[]>();

    setRootPath(newPath: string): void {
        this.rootPath = newPath.replace(/\/$/, '');
        this.cache.clear();
        this._onDidChangeTreeData.fire();
    }

    getRootPath(): string {
        return this.rootPath;
    }

    refresh(): void {
        this.cache.clear();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TrxItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TrxItem): Promise<TrxItem[]> {
        const system = configManager.CurrentSystem;
        if (!system) return [];

        const folderPath = element ? element.remotePath : this.rootPath;
        if (this.cache.has(folderPath)) return this.cache.get(folderPath)!;

        const [filesResult, foldersResult] = await Promise.all([
            listFilesService.call(system, folderPath),
            listFoldersService.call(system, folderPath)
        ]);

        const items: TrxItem[] = [];

        if (foldersResult && !IsFatalResponse(foldersResult)) {
            for (const folder of (foldersResult?.Rowsets?.Rowset?.Row || [])) {
                items.push(TrxItem.fromFolder(folder));
            }
        }

        if (filesResult && !IsFatalResponse(filesResult)) {
            for (const file of (filesResult?.Rowsets?.Rowset?.Row || [])) {
                items.push(TrxItem.fromFile(file));
            }
        }

        items.sort((a, b) => {
            if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
            return (a.label as string).localeCompare(b.label as string);
        });

        this.cache.set(folderPath, items);
        return items;
    }
}

export const trxDirectoryTree = new TrxDirectoryTree();
