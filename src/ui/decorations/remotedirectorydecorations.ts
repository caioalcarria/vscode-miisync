import * as vscode from 'vscode';

/**
 * Provider de decorações para o Remote Directory Tree
 * Aplica cores e estilos especiais para pastas já carregadas localmente
 */
export class RemoteDirectoryDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        // Aplica decoração verde para pastas já carregadas
        if (uri.scheme === 'miisync-loaded') {
            return {
                color: new vscode.ThemeColor('charts.green'),
                badge: '✓',
                tooltip: 'This folder is already loaded as a local project'
            };
        }
        
        return undefined;
    }

    /**
     * Força atualização das decorações
     */
    refresh(): void {
        this._onDidChangeFileDecorations.fire(undefined);
    }
}

export const remoteDirectoryDecorationProvider = new RemoteDirectoryDecorationProvider();
