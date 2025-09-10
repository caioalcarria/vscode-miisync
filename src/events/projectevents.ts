import * as vscode from 'vscode';

/**
 * Sistema de eventos globais para projetos
 */
class ProjectEvents {
    private _onProjectDownloaded = new vscode.EventEmitter<{ localPath: string; remotePath: string }>();
    private _onProjectModified = new vscode.EventEmitter<{ localPath: string; fileName?: string }>();
    private _onProjectDeleted = new vscode.EventEmitter<{ localPath: string }>();

    /**
     * Evento disparado quando um projeto é baixado
     */
    readonly onProjectDownloaded = this._onProjectDownloaded.event;

    /**
     * Evento disparado quando um projeto é modificado
     */
    readonly onProjectModified = this._onProjectModified.event;

    /**
     * Evento disparado quando um projeto é deletado
     */
    readonly onProjectDeleted = this._onProjectDeleted.event;

    /**
     * Dispara evento de projeto baixado
     */
    fireProjectDownloaded(localPath: string, remotePath: string): void {
        console.log(`🎉 Evento: Projeto baixado - ${localPath}`);
        this._onProjectDownloaded.fire({ localPath, remotePath });
    }

    /**
     * Dispara evento de projeto modificado
     */
    fireProjectModified(localPath: string, fileName?: string): void {
        console.log(`📝 Evento: Projeto modificado - ${localPath}${fileName ? ` (${fileName})` : ''}`);
        this._onProjectModified.fire({ localPath, fileName });
    }

    /**
     * Dispara evento de projeto deletado
     */
    fireProjectDeleted(localPath: string): void {
        console.log(`🗑️ Evento: Projeto deletado - ${localPath}`);
        this._onProjectDeleted.fire({ localPath });
    }

    /**
     * Limpa todos os event emitters
     */
    dispose(): void {
        this._onProjectDownloaded.dispose();
        this._onProjectModified.dispose();
        this._onProjectDeleted.dispose();
    }
}

// Instância singleton
export const projectEvents = new ProjectEvents();
