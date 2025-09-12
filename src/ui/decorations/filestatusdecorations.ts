import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { localFilesMappingManager } from "../../modules/localfilesmapping";

class FileStatusDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations: vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  > = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations: vscode.Event<
    vscode.Uri | vscode.Uri[] | undefined
  > = this._onDidChangeFileDecorations.event;

  // Mantemos estes para compatibilidade temporária e casos edge
  private modifiedFiles = new Set<string>();
  private newFiles = new Set<string>();
  private originalFileHashes = new Map<string, string>();
  private fileWatchers = new Map<string, vscode.FileSystemWatcher>();

  constructor() {
    // Monitora mudanças no workspace
    this.setupFileWatchers();

    // Monitora mudanças no sistema de mapeamento
    this.setupMappingIntegration();

    // Carrega hashes iniciais dos arquivos existentes (para compatibilidade)
    this.loadInitialFileHashes();
  }

  private setupMappingIntegration(): void {
    // Monitora mudanças no sistema de mapeamento de arquivos
    localFilesMappingManager.onDidChangeMappings((changedFiles) => {
      console.log(
        `🔄 Mapeamento atualizado para ${changedFiles.length} arquivo(s)`
      );

      // Atualiza decorações para os arquivos alterados
      const uris = changedFiles.map((filePath) => vscode.Uri.file(filePath));
      this._onDidChangeFileDecorations.fire(uris);
    });
  }

  private async loadInitialFileHashes(): Promise<void> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) return;

      for (const folder of workspaceFolders) {
        await this.scanFolderForHashes(folder.uri.fsPath);
      }
    } catch (error) {
      console.error("Erro ao carregar hashes iniciais:", error);
    }
  }

  private async scanFolderForHashes(folderPath: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(folderPath, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        const fullPath = path.join(folderPath, entry.name);

        if (entry.isDirectory()) {
          // Ignora algumas pastas
          if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
            await this.scanFolderForHashes(fullPath);
          }
        } else if (entry.isFile()) {
          // Calcula hash inicial do arquivo
          const hash = await this.calculateFileHash(fullPath);
          if (hash) {
            this.originalFileHashes.set(fullPath, hash);
          }
        }
      }
    } catch (error) {
      // Ignora erros de pastas inacessíveis
    }
  }

  private async calculateFileHash(filePath: string): Promise<string | null> {
    try {
      // Verifica se é arquivo de texto ou binário
      const content = await fs.promises.readFile(filePath);

      // Para arquivos pequenos, usa o conteúdo completo
      if (content.length < 1024 * 1024) {
        // 1MB
        return crypto.createHash("md5").update(content).digest("hex");
      } else {
        // Para arquivos grandes, usa tamanho + data de modificação
        const stat = await fs.promises.stat(filePath);
        return crypto
          .createHash("md5")
          .update(`${stat.size}-${stat.mtime.getTime()}`)
          .digest("hex");
      }
    } catch (error) {
      return null;
    }
  }

  private setupFileWatchers(): void {
    // Monitora salvamento de arquivos
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await this.handleFileSaved(document.uri);
    });

    // Monitora criação de arquivos
    vscode.workspace.onDidCreateFiles(async (event) => {
      for (const uri of event.files) {
        await this.handleFileCreated(uri);
      }
    });

    // Monitora mudanças de arquivos em tempo real
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      if (event.document.isDirty) {
        await this.handleFileModified(event.document.uri);
      }
    });

    // Monitora abertura de arquivos para carregar hash inicial se necessário
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      const filePath = document.uri.fsPath;
      if (!this.originalFileHashes.has(filePath)) {
        const hash = await this.calculateFileHash(filePath);
        if (hash) {
          this.originalFileHashes.set(filePath, hash);
        }
      }
    });
  }

  private async handleFileSaved(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;

    // Calcula hash atual do arquivo
    const currentHash = await this.calculateFileHash(filePath);
    if (!currentHash) return;

    // 🚀 NOVO: Verifica se existe no mapeamento JSON
    const mappedFile = localFilesMappingManager.getFile(filePath);
    if (mappedFile) {
      // Verifica se foi realmente modificado
      const isModified = await localFilesMappingManager.checkIfFileModified(
        filePath
      );
      console.log(
        `📁 Arquivo salvo (mapeado): ${path.basename(
          filePath
        )} - Modificado: ${isModified}`
      );
      return; // O evento será disparado pelo sistema de mapeamento
    }

    // 🔄 SISTEMA LEGADO para arquivos não mapeados
    // Se é um arquivo novo que foi salvo
    if (this.newFiles.has(filePath)) {
      // Arquivo novo salvo, agora temos o hash original
      this.originalFileHashes.set(filePath, currentHash);
      this.newFiles.delete(filePath);
      this._onDidChangeFileDecorations.fire(uri);
      return;
    }

    // Verifica se realmente foi modificado comparando com hash original
    const originalHash = this.originalFileHashes.get(filePath);
    if (originalHash) {
      if (currentHash !== originalHash) {
        // Arquivo foi modificado
        this.modifiedFiles.add(filePath);
      } else {
        // Arquivo voltou ao estado original
        this.modifiedFiles.delete(filePath);
      }
    } else {
      // Primeiro save, considera como hash original
      this.originalFileHashes.set(filePath, currentHash);
    }

    this._onDidChangeFileDecorations.fire(uri);
  }

  private async handleFileCreated(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;

    // 🚀 NOVO: Verifica se é um arquivo em um projeto mapeado
    const mappedFile = localFilesMappingManager.getFile(filePath);
    if (mappedFile) {
      // Arquivo criado em projeto mapeado - atualiza para "added"
      await localFilesMappingManager.addOrUpdateFile(
        filePath,
        mappedFile.remotePath,
        true,
        "added"
      );
      console.log(`📁 Arquivo criado (mapeado): ${path.basename(filePath)}`);
      return; // O evento será disparado pelo sistema de mapeamento
    }

    // 🔄 SISTEMA LEGADO para arquivos não mapeados
    this.newFiles.add(filePath);
    // Não tem hash original ainda, será definido no primeiro save
    this._onDidChangeFileDecorations.fire(uri);
  }

  private async handleFileModified(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;

    // Se é um arquivo novo, não marca como modificado
    if (this.newFiles.has(filePath)) {
      return;
    }

    // Para arquivos em edição, verifica se o conteúdo atual é diferente do original
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const currentContent = document.getText();
      const currentHash = crypto
        .createHash("md5")
        .update(currentContent)
        .digest("hex");

      const originalHash = this.originalFileHashes.get(filePath);
      if (originalHash) {
        if (currentHash !== originalHash) {
          this.modifiedFiles.add(filePath);
        } else {
          this.modifiedFiles.delete(filePath);
        }
        this._onDidChangeFileDecorations.fire(uri);
      }
    } catch (error) {
      // Em caso de erro, mantém como modificado se já estava
    }
  }

  provideFileDecoration(
    uri: vscode.Uri
  ): vscode.ProviderResult<vscode.FileDecoration> {
    const filePath = uri.fsPath;

    // Verifica se é um arquivo (não pasta)
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return undefined;
      }
    } catch (error) {
      return undefined;
    }

    // 🚀 NOVO: Verifica primeiro no sistema de mapeamento JSON
    const mappedFile = localFilesMappingManager.getFile(filePath);
    if (mappedFile && mappedFile.hasLocalChanges) {
      switch (mappedFile.status) {
        case "added":
          return {
            badge: "N",
            tooltip: `Arquivo Novo\nRemoto: ${
              mappedFile.remotePath
            }\nModificado: ${mappedFile.lastModified.toLocaleString()}`,
            color: new vscode.ThemeColor(
              "gitDecoration.untrackedResourceForeground"
            ),
            propagate: false,
          };

        case "modified":
          return {
            badge: "M",
            tooltip: `Arquivo Modificado\nRemoto: ${
              mappedFile.remotePath
            }\nModificado: ${mappedFile.lastModified.toLocaleString()}`,
            color: new vscode.ThemeColor(
              "gitDecoration.modifiedResourceForeground"
            ),
            propagate: false,
          };

        case "deleted":
          return {
            badge: "D",
            tooltip: `Arquivo Deletado\nRemoto: ${
              mappedFile.remotePath
            }\nDeletado: ${mappedFile.lastModified.toLocaleString()}`,
            color: new vscode.ThemeColor(
              "gitDecoration.deletedResourceForeground"
            ),
            propagate: false,
          };
      }
    }

    // 🔄 FALLBACK: Sistema antigo para compatibilidade
    // Arquivo novo (verde)
    if (this.newFiles.has(filePath)) {
      return {
        badge: "N",
        tooltip: "Arquivo Novo (Sistema Legado)",
        color: new vscode.ThemeColor(
          "gitDecoration.untrackedResourceForeground"
        ),
        propagate: false,
      };
    }

    // Arquivo modificado (laranja)
    if (this.modifiedFiles.has(filePath)) {
      return {
        badge: "M",
        tooltip: "Arquivo Modificado (Sistema Legado)",
        color: new vscode.ThemeColor(
          "gitDecoration.modifiedResourceForeground"
        ),
        propagate: false,
      };
    }

    return undefined;
  }

  public refresh(): void {
    this._onDidChangeFileDecorations.fire(undefined);
  }

  public dispose(): void {
    // Cleanup se necessário
  }
}

export const fileStatusDecorationProvider = new FileStatusDecorationProvider();
