import * as crypto from "crypto";
import * as fs from "fs-extra";
import * as path from "path";
import * as vscode from "vscode";
import {
  LocalFileMapping,
  LocalFilesMappingData,
} from "../types/localfilemapping";

/**
 * Gerenciador do arquivo de mapeamento de arquivos locais modificados
 */
export class LocalFilesMappingManager {
  private static instance: LocalFilesMappingManager;
  private mappingData: LocalFilesMappingData;
  private mappingFilePath: string;
  private _onDidChangeMappings: vscode.EventEmitter<string[]> =
    new vscode.EventEmitter<string[]>();

  /** Evento disparado quando o mapeamento de arquivos muda */
  readonly onDidChangeMappings: vscode.Event<string[]> =
    this._onDidChangeMappings.event;

  private constructor() {
    this.mappingFilePath = this.getMappingFilePath();
    this.mappingData = this.initializeEmptyMapping();
    this.loadMapping();
  }

  public static getInstance(): LocalFilesMappingManager {
    if (!LocalFilesMappingManager.instance) {
      LocalFilesMappingManager.instance = new LocalFilesMappingManager();
    }
    return LocalFilesMappingManager.instance;
  }

  /**
   * Obtém o caminho do arquivo de mapeamento
   */
  private getMappingFilePath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      // Fallback para uma pasta temporária se não houver workspace
      const tempDir = path.join(require("os").homedir(), ".miisync");
      return path.join(tempDir, "local-files-mapping.json");
    }

    const miisyncDir = path.join(workspaceFolder.uri.fsPath, ".miisync");
    return path.join(miisyncDir, "local-files-mapping.json");
  }

  /**
   * Inicializa um mapeamento vazio
   */
  private initializeEmptyMapping(): LocalFilesMappingData {
    return {
      version: "1.0.0",
      lastUpdated: new Date(),
      files: {},
      settings: {
        autoDetectChanges: true,
        checkInterval: 5000,
      },
    };
  }

  /**
   * Carrega o mapeamento do arquivo JSON
   */
  private async loadMapping(): Promise<void> {
    try {
      if (await fs.pathExists(this.mappingFilePath)) {
        const content = await fs.readJson(this.mappingFilePath);

        // Converte strings de data de volta para objetos Date
        this.mappingData = {
          ...content,
          lastUpdated: new Date(content.lastUpdated),
          files: {},
        };

        // Converte as datas dos arquivos
        for (const [filePath, fileData] of Object.entries(
          content.files || {}
        )) {
          this.mappingData.files[filePath] = {
            ...(fileData as any),
            lastModified: new Date((fileData as any).lastModified),
            createdAt: new Date((fileData as any).createdAt),
            lastChecked: new Date((fileData as any).lastChecked),
          };
        }

        console.log(
          `📋 Mapeamento de arquivos carregado: ${
            Object.keys(this.mappingData.files).length
          } arquivos`
        );
      } else {
        console.log("📋 Arquivo de mapeamento não encontrado, criando novo...");
        await this.saveMapping();
      }
    } catch (error) {
      console.error("❌ Erro ao carregar mapeamento de arquivos:", error);
      this.mappingData = this.initializeEmptyMapping();
    }
  }

  /**
   * Salva o mapeamento no arquivo JSON
   */
  private async saveMapping(): Promise<void> {
    try {
      // Garantir que o diretório existe
      const dir = path.dirname(this.mappingFilePath);
      await fs.ensureDir(dir);

      // Atualizar timestamp
      this.mappingData.lastUpdated = new Date();

      // Salvar arquivo
      await fs.writeJson(this.mappingFilePath, this.mappingData, { spaces: 2 });

      console.log(
        `💾 Mapeamento salvo: ${
          Object.keys(this.mappingData.files).length
        } arquivos`
      );
    } catch (error) {
      console.error("❌ Erro ao salvar mapeamento de arquivos:", error);
    }
  }

  /**
   * Adiciona ou atualiza um arquivo no mapeamento
   */
  public async addOrUpdateFile(
    localPath: string,
    remotePath: string,
    hasLocalChanges: boolean = false,
    status: "modified" | "added" | "deleted" | "unchanged" = "unchanged"
  ): Promise<void> {
    const now = new Date();
    const absolutePath = path.resolve(localPath);

    // Calcular hash do arquivo se existir
    let originalHash: string | undefined;
    try {
      if ((await fs.pathExists(absolutePath)) && status !== "deleted") {
        originalHash = await this.calculateFileHash(absolutePath);
      }
    } catch (error) {
      console.warn(
        `⚠️ Erro ao calcular hash do arquivo ${absolutePath}:`,
        error
      );
    }

    const existingFile = this.mappingData.files[absolutePath];

    this.mappingData.files[absolutePath] = {
      localPath: absolutePath,
      remotePath,
      lastModified: now,
      hasLocalChanges,
      originalHash,
      status,
      createdAt: existingFile?.createdAt || now,
      lastChecked: now,
    };

    await this.saveMapping();
    this._onDidChangeMappings.fire([absolutePath]);
  }

  /**
   * Remove um arquivo do mapeamento
   */
  public async removeFile(localPath: string): Promise<void> {
    const absolutePath = path.resolve(localPath);

    if (this.mappingData.files[absolutePath]) {
      delete this.mappingData.files[absolutePath];
      await this.saveMapping();
      this._onDidChangeMappings.fire([absolutePath]);
    }
  }

  /**
   * Obtém informações de um arquivo específico
   */
  public getFile(localPath: string): LocalFileMapping | undefined {
    const absolutePath = path.resolve(localPath);
    return this.mappingData.files[absolutePath];
  }

  /**
   * Obtém todos os arquivos com alterações locais
   */
  public getFilesWithLocalChanges(): LocalFileMapping[] {
    return Object.values(this.mappingData.files).filter(
      (file) => file.hasLocalChanges
    );
  }

  /**
   * Obtém todos os arquivos por status
   */
  public getFilesByStatus(
    status: "modified" | "added" | "deleted" | "unchanged"
  ): LocalFileMapping[] {
    return Object.values(this.mappingData.files).filter(
      (file) => file.status === status
    );
  }

  /**
   * Verifica se um arquivo tem alterações locais
   */
  public hasLocalChanges(localPath: string): boolean {
    const file = this.getFile(localPath);
    return file?.hasLocalChanges || false;
  }

  /**
   * Atualiza a flag de alterações locais de um arquivo
   */
  public async updateLocalChangesFlag(
    localPath: string,
    hasChanges: boolean
  ): Promise<void> {
    const absolutePath = path.resolve(localPath);
    const file = this.mappingData.files[absolutePath];

    if (file) {
      file.hasLocalChanges = hasChanges;
      file.lastChecked = new Date();

      // Atualizar status baseado na flag
      if (hasChanges) {
        if (file.status === "unchanged") {
          file.status = "modified";
        }
      } else {
        file.status = "unchanged";
      }

      await this.saveMapping();
      this._onDidChangeMappings.fire([absolutePath]);
    }
  }

  /**
   * Calcula hash MD5 de um arquivo
   */
  private async calculateFileHash(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath);

      // Para arquivos pequenos, usa o conteúdo completo
      if (content.length < 1024 * 1024) {
        // 1MB
        return crypto.createHash("md5").update(content).digest("hex");
      } else {
        // Para arquivos grandes, usa tamanho + data de modificação
        const stat = await fs.stat(filePath);
        return crypto
          .createHash("md5")
          .update(`${stat.size}-${stat.mtime.getTime()}`)
          .digest("hex");
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * Verifica se um arquivo foi realmente modificado comparando com o hash original
   */
  public async checkIfFileModified(localPath: string): Promise<boolean> {
    const absolutePath = path.resolve(localPath);
    const file = this.mappingData.files[absolutePath];

    if (!file || !file.originalHash) {
      return false;
    }

    try {
      if (!(await fs.pathExists(absolutePath))) {
        // Arquivo foi deletado
        await this.updateFileStatus(absolutePath, "deleted", true);
        return true;
      }

      const currentHash = await this.calculateFileHash(absolutePath);
      const isModified = currentHash !== file.originalHash;

      if (isModified) {
        await this.updateFileStatus(absolutePath, "modified", true);
      } else {
        await this.updateFileStatus(absolutePath, "unchanged", false);
      }

      return isModified;
    } catch (error) {
      console.error(
        `❌ Erro ao verificar modificação do arquivo ${absolutePath}:`,
        error
      );
      return false;
    }
  }

  /**
   * Atualiza o status de um arquivo
   */
  private async updateFileStatus(
    localPath: string,
    status: "modified" | "added" | "deleted" | "unchanged",
    hasLocalChanges: boolean
  ): Promise<void> {
    const file = this.mappingData.files[localPath];
    if (file) {
      file.status = status;
      file.hasLocalChanges = hasLocalChanges;
      file.lastChecked = new Date();
      await this.saveMapping();
      this._onDidChangeMappings.fire([localPath]);
    }
  }

  /**
   * Obtém todos os arquivos mapeados
   */
  public getAllFiles(): LocalFileMapping[] {
    return Object.values(this.mappingData.files);
  }

  /**
   * Limpa todos os mapeamentos
   */
  public async clearAll(): Promise<void> {
    const changedFiles = Object.keys(this.mappingData.files);
    this.mappingData = this.initializeEmptyMapping();
    await this.saveMapping();
    this._onDidChangeMappings.fire(changedFiles);
  }

  /**
   * Força uma verificação completa de todos os arquivos mapeados
   */
  public async checkAllFiles(): Promise<void> {
    const changedFiles: string[] = [];

    for (const [filePath, file] of Object.entries(this.mappingData.files)) {
      const wasModified = await this.checkIfFileModified(filePath);
      if (wasModified !== file.hasLocalChanges) {
        changedFiles.push(filePath);
      }
    }

    if (changedFiles.length > 0) {
      this._onDidChangeMappings.fire(changedFiles);
    }
  }

  /**
   * Dispose dos recursos
   */
  public dispose(): void {
    this._onDidChangeMappings.dispose();
  }
}

// Instância singleton
export const localFilesMappingManager = LocalFilesMappingManager.getInstance();
