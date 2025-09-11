import * as vscode from "vscode";
import { changeManager, FileChange } from "../../modules/changemanager";

/**
 * 🎨 PROVIDER DE DECORAÇÕES OTIMIZADO
 *
 * Agora usa o sistema centralizado de mudanças
 * - Zero delay entre detecção e exibição
 * - Sincronizado com todos os outros sistemas
 * - Cache otimizado
 */
export class FileStatusDecorationProvider
  implements vscode.FileDecorationProvider
{
  private _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private projectPath: string = "";
  private changesCache = new Map<string, FileChange>();

  constructor() {
    this.setupChangeListener();
  }

  /**
   * Inicializa para um projeto específico
   */
  public async initialize(projectPath: string): Promise<void> {
    this.projectPath = projectPath;
    await changeManager.initializeProject(projectPath);
    this.updateCache();
  }

  /**
   * Escuta mudanças do gerenciador centralizado
   */
  private setupChangeListener(): void {
    changeManager.onChangesUpdated((updatedProjectPath) => {
      if (updatedProjectPath === this.projectPath) {
        this.updateCache();
        this.refresh();
      }
    });
  }

  /**
   * Atualiza cache local das mudanças
   */
  private updateCache(): void {
    const changes = changeManager.getProjectChanges(this.projectPath);
    this.changesCache.clear();

    for (const change of changes) {
      this.changesCache.set(change.path, change);
    }
  }

  /**
   * Fornece decoração para um arquivo
   */
  public provideFileDecoration(
    uri: vscode.Uri
  ): vscode.ProviderResult<vscode.FileDecoration> {
    const filePath = uri.fsPath;
    const change = this.changesCache.get(filePath);

    if (!change) return undefined;

    switch (change.status) {
      case "modified":
        return {
          badge: "M",
          tooltip: "Arquivo Modificado",
          color: new vscode.ThemeColor(
            "gitDecoration.modifiedResourceForeground"
          ),
          propagate: false,
        };

      case "added":
        return {
          badge: "A",
          tooltip: "Arquivo Novo",
          color: new vscode.ThemeColor(
            "gitDecoration.untrackedResourceForeground"
          ),
          propagate: false,
        };

      case "deleted":
        return {
          badge: "D",
          tooltip: "Arquivo Deletado",
          color: new vscode.ThemeColor(
            "gitDecoration.deletedResourceForeground"
          ),
          propagate: false,
        };

      default:
        return undefined;
    }
  }

  /**
   * Força refresh das decorações
   */
  public refresh(): void {
    this._onDidChangeFileDecorations.fire(undefined);
  }

  /**
   * Retorna total de arquivos modificados (para badge)
   */
  public getTotalModifiedFiles(): number {
    return this.changesCache.size;
  }

  /**
   * Marca arquivo como sincronizado
   */
  public async markFileSynchronized(filePath: string): Promise<void> {
    await changeManager.markFileSynchronized(filePath, this.projectPath);
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    this._onDidChangeFileDecorations.dispose();
  }
}

export const fileStatusDecorationProvider = new FileStatusDecorationProvider();
