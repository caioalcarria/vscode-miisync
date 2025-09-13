import * as crypto from "crypto";
import * as fs from "fs-extra";
import * as path from "path";
import * as vscode from "vscode";

/**
 * 🚀 SISTEMA CENTRALIZADO DE DETECÇÃO DE MUDANÇAS
 *
 * Este é o ponto central que:
 * 1. Detecta mudanças de arquivos
 * 2. Persiste estado em .miisync/changes.json
 * 3. Notifica todos os sistemas (decorações, tree view, badge)
 * 4. Carrega estado inicial ao abrir projeto
 */

export interface FileChange {
  path: string;
  status: "modified" | "added" | "deleted";
  hash: string;
  timestamp: number;
  originalHash?: string; // Hash original do arquivo quando foi baixado
}

export interface ProjectChanges {
  projectPath: string;
  files: Map<string, FileChange>;
  lastScan: number;
}

export class CentralizedChangeManager {
  private static instance: CentralizedChangeManager;
  private changesFile: string = "";
  private projectChanges = new Map<string, ProjectChanges>();
  private initializedProjects = new Set<string>(); // Evita inicialização múltipla

  // Eventos para notificar sistemas
  private _onChangesUpdated = new vscode.EventEmitter<string>(); // projectPath
  public readonly onChangesUpdated = this._onChangesUpdated.event;

  // Cache de hashes para performance
  private fileHashCache = new Map<string, { hash: string; mtime: number }>();

  // Debounce para evitar múltiplas atualizações
  private updateTimeouts = new Map<string, NodeJS.Timeout>();
  private notificationDebounce: NodeJS.Timeout | null = null;

  public static getInstance(): CentralizedChangeManager {
    if (!CentralizedChangeManager.instance) {
      CentralizedChangeManager.instance = new CentralizedChangeManager();
    }
    return CentralizedChangeManager.instance;
  }

  /**
   * Inicializa o sistema para um projeto específico
   */
  public async initializeProject(projectPath: string): Promise<void> {
    // Evita inicialização múltipla do mesmo projeto
    if (this.initializedProjects.has(projectPath)) {
      console.log(`⚠️ Projeto já inicializado: ${projectPath}`);
      return;
    }

    this.initializedProjects.add(projectPath);
    console.log(`🚀 Inicializando detecção de mudanças para: ${projectPath}`);

    this.changesFile = path.join(projectPath, ".miisync", "changes.json");

    // Garante que a pasta .miisync existe
    await fs.ensureDir(path.dirname(this.changesFile));

    // Carrega estado salvo
    await this.loadPersistedChanges(projectPath);

    // Escaneia arquivos pela primeira vez
    await this.performInitialScan(projectPath);

    // Configura watchers
    this.setupFileWatchers(projectPath);
  }

  /**
   * Carrega mudanças persistidas do disco
   */
  private async loadPersistedChanges(projectPath: string): Promise<void> {
    try {
      if (await fs.pathExists(this.changesFile)) {
        const data = await fs.readJson(this.changesFile);
        const changes: ProjectChanges = {
          projectPath,
          files: new Map(Object.entries(data.files || {})),
          lastScan: data.lastScan || 0,
        };
        this.projectChanges.set(projectPath, changes);
        console.log(`✅ Carregadas ${changes.files.size} mudanças persistidas`);
      }
    } catch (error) {
      console.warn("⚠️ Erro ao carregar mudanças persistidas:", error);
    }
  }

  /**
   * Persiste mudanças no disco
   */
  private async persistChanges(projectPath: string): Promise<void> {
    const changes = this.projectChanges.get(projectPath);
    if (!changes) return;

    try {
      const data = {
        projectPath,
        files: Object.fromEntries(changes.files),
        lastScan: changes.lastScan,
      };
      await fs.writeJson(this.changesFile, data, { spaces: 2 });
    } catch (error) {
      console.error("❌ Erro ao persistir mudanças:", error);
    }
  }

  /**
   * Escaneia todos os arquivos do projeto pela primeira vez
   */
  private async performInitialScan(projectPath: string): Promise<void> {
    console.log("🔍 Realizando scan inicial...");

    const changes: ProjectChanges = {
      projectPath,
      files: new Map(),
      lastScan: Date.now(),
    };

    await this.scanDirectory(projectPath, changes);

    this.projectChanges.set(projectPath, changes);
    await this.persistChanges(projectPath);

    console.log(
      `✅ Scan inicial concluído: ${changes.files.size} arquivos modificados`
    );
  }

  /**
   * Escaneia um diretório recursivamente (apenas projetos MiiSync)
   */
  private async scanDirectory(
    dirPath: string,
    changes: ProjectChanges
  ): Promise<void> {
    try {
      // Verifica se é um projeto MiiSync
      const miisyncFile = path.join(dirPath, ".miisync", "path-mapping.json");
      if (!(await fs.pathExists(miisyncFile))) {
        console.log(`⚠️ Pasta ${dirPath} não é um projeto MiiSync - ignorando`);
        return;
      }

      //console.log(`📁 Escaneando projeto MiiSync: ${dirPath}`);

      // Escaneia apenas os arquivos que estão no mapeamento
      const mapping = await fs.readJson(miisyncFile);
      if (mapping.mappings && Array.isArray(mapping.mappings)) {
        for (const fileMapping of mapping.mappings) {
          const fullPath = path.join(dirPath, fileMapping.localPath);
          if (await fs.pathExists(fullPath)) {
            await this.checkFileForChanges(fullPath, changes);
          } else {
            // Arquivo estava no mapeamento mas foi deletado
            console.log(
              `🗑️ Arquivo deletado detectado: ${fileMapping.localPath}`
            );
            changes.files.set(fullPath, {
              path: fullPath,
              status: "deleted",
              hash: "",
              timestamp: Date.now(),
              originalHash: fileMapping.contentHash,
            });
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️ Erro ao escanear projeto MiiSync ${dirPath}:`, error);
    }
  }

  /**
   * Verifica se um arquivo foi modificado
   */
  private async checkFileForChanges(
    filePath: string,
    changes: ProjectChanges
  ): Promise<void> {
    try {
      // Verifica se deve ignorar o arquivo
      if (this.shouldIgnoreFile(filePath)) return;

      // Só processa arquivos dentro de projetos MiiSync
      if (!(await this.isInMiiSyncProject(filePath))) return;

      const currentHash = await this.getFileHash(filePath);
      if (!currentHash) return;

      const originalHash = await this.getOriginalFileHash(filePath);

      // Se não tem hash original, verifica se é projeto MiiSync
      if (!originalHash) {
        // Se está em projeto MiiSync mas não tem mapeamento = arquivo novo
        if (await this.isInMiiSyncProject(filePath)) {
          console.log(`➕ Arquivo novo detectado: ${path.basename(filePath)}`);
          changes.files.set(filePath, {
            path: filePath,
            status: "added",
            hash: currentHash,
            timestamp: Date.now(),
          });
        }
        return;
      }

      // Compara hashes
      if (currentHash !== originalHash) {
        console.log(
          `✏️ Arquivo modificado detectado: ${path.basename(filePath)}`
        );
        changes.files.set(filePath, {
          path: filePath,
          status: "modified",
          hash: currentHash,
          timestamp: Date.now(),
          originalHash,
        });
      } else {
        // Arquivo existe e tem mesmo hash = sem mudanças, remove da lista se estiver
        changes.files.delete(filePath);
      }
    } catch (error) {
      // Ignora erros
    }
  }

  /**
   * Verifica se o arquivo está dentro de um projeto MiiSync
   */
  private async isInMiiSyncProject(filePath: string): Promise<boolean> {
    let currentDir = path.dirname(filePath);

    while (currentDir !== path.dirname(currentDir)) {
      const miisyncFile = path.join(
        currentDir,
        ".miisync",
        "path-mapping.json"
      );
      if (await fs.pathExists(miisyncFile)) {
        return true;
      }
      currentDir = path.dirname(currentDir);
    }

    return false;
  }

  /**
   * Calcula hash do arquivo com cache
   */
  private async getFileHash(filePath: string): Promise<string | null> {
    try {
      const stat = await fs.stat(filePath);
      const mtime = stat.mtime.getTime();

      // Verifica cache
      const cached = this.fileHashCache.get(filePath);
      if (cached && cached.mtime === mtime) {
        return cached.hash;
      }

      // Calcula novo hash
      const content = await fs.readFile(filePath);
      const hash = crypto.createHash("sha256").update(content).digest("hex");

      // Salva no cache
      this.fileHashCache.set(filePath, { hash, mtime });

      return hash;
    } catch (error) {
      return null;
    }
  }

  /**
   * Obtém hash original do arquivo (do mapeamento .miisync/path-mapping.json)
   */
  private async getOriginalFileHash(filePath: string): Promise<string | null> {
    try {
      // Procura por arquivo .miisync/path-mapping.json na pasta do projeto ou pais
      let currentDir = path.dirname(filePath);

      while (currentDir !== path.dirname(currentDir)) {
        const miisyncFile = path.join(
          currentDir,
          ".miisync",
          "path-mapping.json"
        );

        if (await fs.pathExists(miisyncFile)) {
          const mapping = await fs.readJson(miisyncFile);

          // Procura o arquivo nos mapeamentos
          const relativePath = path
            .relative(currentDir, filePath)
            .replace(/\\/g, "/");

          // Busca nos mappings array
          if (mapping.mappings && Array.isArray(mapping.mappings)) {
            for (const fileMapping of mapping.mappings) {
              if (
                fileMapping.localPath === relativePath &&
                fileMapping.contentHash
              ) {
                console.log(
                  `📋 Hash encontrado para ${relativePath}: ${fileMapping.contentHash.substring(
                    0,
                    8
                  )}...`
                );
                return fileMapping.contentHash;
              }
            }
          }

          // Se chegou aqui, é um projeto MiiSync mas arquivo não está no mapeamento
          console.log(
            `📂 Projeto MiiSync encontrado, mas arquivo ${relativePath} não está no mapeamento (arquivo novo)`
          );
          return null;
        }

        currentDir = path.dirname(currentDir);
      }

      // Não é um projeto MiiSync - ignora
      return null;
    } catch (error) {
      console.warn(`⚠️ Erro ao obter hash original para ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Configura watchers de arquivo
   */
  private setupFileWatchers(projectPath: string): void {
    // Watcher para saves
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.uri.fsPath.startsWith(projectPath)) {
        await this.handleFileChanged(document.uri.fsPath, projectPath);
      }
    });

    // Watcher para criação
    vscode.workspace.onDidCreateFiles((event) => {
      for (const uri of event.files) {
        if (uri.fsPath.startsWith(projectPath)) {
          this.handleFileChanged(uri.fsPath, projectPath);
        }
      }
    });

    // Watcher para deleção
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const uri of event.files) {
        if (uri.fsPath.startsWith(projectPath)) {
          this.handleFileDeleted(uri.fsPath, projectPath);
        }
      }
    });
  }

  /**
   * Notifica mudanças com debounce para evitar spam
   */
  private notifyChangesWithDebounce(projectPath: string): void {
    if (this.notificationDebounce) {
      clearTimeout(this.notificationDebounce);
    }

    this.notificationDebounce = setTimeout(() => {
      this._onChangesUpdated.fire(projectPath);
      this.notificationDebounce = null;
    }, 200); // 200ms de debounce
  }

  /**
   * Processa mudança em arquivo
   */
  private async handleFileChanged(
    filePath: string,
    projectPath: string
  ): Promise<void> {
    // Só processa se for arquivo em projeto MiiSync
    if (!(await this.isInMiiSyncProject(filePath))) {
      return;
    }

    // Debounce para evitar múltiplas chamadas
    const timeoutKey = filePath;
    if (this.updateTimeouts.has(timeoutKey)) {
      clearTimeout(this.updateTimeouts.get(timeoutKey)!);
    }

    this.updateTimeouts.set(
      timeoutKey,
      setTimeout(async () => {
        await this.processFileChange(filePath, projectPath);
        this.updateTimeouts.delete(timeoutKey);
      }, 100)
    ); // 100ms de debounce
  }

  /**
   * Processa deleção de arquivo
   */
  private async handleFileDeleted(
    filePath: string,
    projectPath: string
  ): Promise<void> {
    const changes = this.projectChanges.get(projectPath);
    if (!changes) return;

    const originalHash = await this.getOriginalFileHash(filePath);
    if (originalHash) {
      changes.files.set(filePath, {
        path: filePath,
        status: "deleted",
        hash: "",
        timestamp: Date.now(),
        originalHash,
      });
    } else {
      // Se não tinha hash original, apenas remove da lista
      changes.files.delete(filePath);
    }

    await this.persistChanges(projectPath);
    this.notifyChangesWithDebounce(projectPath);
  }

  /**
   * Processa uma mudança de arquivo
   */
  private async processFileChange(
    filePath: string,
    projectPath: string
  ): Promise<void> {
    const changes = this.projectChanges.get(projectPath);
    if (!changes) return;

    await this.checkFileForChanges(filePath, changes);
    await this.persistChanges(projectPath);

    // Notifica todos os sistemas
    this.notifyChangesWithDebounce(projectPath);
  }

  /**
   * Retorna mudanças de um projeto
   */
  public getProjectChanges(projectPath: string): FileChange[] {
    const changes = this.projectChanges.get(projectPath);
    return changes ? Array.from(changes.files.values()) : [];
  }

  /**
   * Retorna total de arquivos modificados
   */
  public getTotalModifiedFiles(projectPath: string): number {
    return this.getProjectChanges(projectPath).length;
  }

  /**
   * Marca arquivo como sincronizado (remove da lista)
   */
  public async markFileSynchronized(
    filePath: string,
    projectPath: string
  ): Promise<void> {
    const changes = this.projectChanges.get(projectPath);
    if (!changes) return;

    changes.files.delete(filePath);
    await this.persistChanges(projectPath);
    this.notifyChangesWithDebounce(projectPath);
  }

  /**
   * Verifica se deve ignorar diretório
   */
  private shouldIgnoreDirectory(dirName: string): boolean {
    const ignoredDirs = [
      ".git",
      ".svn",
      ".hg",
      "node_modules",
      ".vscode",
      "dist",
      "build",
      "out",
      "__pycache__",
      ".pytest_cache",
      ".idea",
      ".vs",
    ];
    return ignoredDirs.includes(dirName) || dirName.startsWith(".");
  }

  /**
   * Verifica se deve ignorar arquivo
   */
  private shouldIgnoreFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();

    // Extensões ignoradas
    const ignoredExts = [
      ".exe",
      ".dll",
      ".so",
      ".dylib",
      ".zip",
      ".rar",
      ".7z",
      ".tar",
      ".gz",
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".bmp",
      ".mp3",
      ".mp4",
      ".avi",
      ".mov",
      ".pdf",
      ".doc",
      ".docx",
    ];

    // Arquivos ignorados
    const ignoredFiles = [".DS_Store", "Thumbs.db", "desktop.ini", ".gitkeep"];

    return (
      ignoredExts.includes(ext) ||
      ignoredFiles.includes(fileName) ||
      fileName.startsWith(".tmp") ||
      fileName.endsWith(".tmp")
    );
  }

  /**
   * Limpa o estado de mudanças de um projeto (útil para reset)
   */
  public async clearProjectChanges(projectPath: string): Promise<void> {
    this.projectChanges.delete(projectPath);
    this.initializedProjects.delete(projectPath);

    // Remove arquivo de mudanças persistidas
    const changesFile = path.join(projectPath, ".miisync", "changes.json");
    try {
      if (await fs.pathExists(changesFile)) {
        await fs.remove(changesFile);
        console.log(`🗑️ Estado de mudanças limpo para: ${projectPath}`);
      }
    } catch (error) {
      console.warn("⚠️ Erro ao limpar arquivo de mudanças:", error);
    }

    this.notifyChangesWithDebounce(projectPath);
  }

  /**
   * Limpa cache e resources
   */
  public dispose(): void {
    this.updateTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.updateTimeouts.clear();
    this.fileHashCache.clear();
    this._onChangesUpdated.dispose();
  }
}

// Singleton instance
export const changeManager = CentralizedChangeManager.getInstance();
