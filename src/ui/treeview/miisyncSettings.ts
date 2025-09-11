import * as vscode from "vscode";

/**
 * 🎨 ÁRVORE DE CONFIGURAÇÕES MIISYNC (SIMPLIFICADA)
 *
 * Agora apenas mostra um item que abre a tela completa de configurações
 */

export class SettingsTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    command?: vscode.Command
  ) {
    super(label, collapsibleState);
    this.command = command;
  }
}

export class MiiSyncSettingsProvider
  implements vscode.TreeDataProvider<SettingsTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    SettingsTreeItem | undefined | null | void
  > = new vscode.EventEmitter<SettingsTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    SettingsTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor() {
    // Construtor simples
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SettingsTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SettingsTreeItem): Thenable<SettingsTreeItem[]> {
    if (!element) {
      // Retorna apenas um item que abre a tela de configurações
      return Promise.resolve([
        new SettingsTreeItem(
          "⚙️ Abrir Configurações",
          vscode.TreeItemCollapsibleState.None,
          {
            command: "miisync.showsettings",
            title: "Abrir Configurações",
            arguments: [],
          }
        ),
      ]);
    }

    return Promise.resolve([]);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

// Instância singleton
export const miiSyncSettingsProvider = new MiiSyncSettingsProvider();
