import { ensureDir, pathExists, readFile, writeFile } from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";

/**
 * Interface para armazenar o mapeamento entre caminhos locais e remotos
 */
export interface PathMapping {
  /** Caminho local relativo ao diretório raiz baixado */
  localPath: string;
  /** Caminho remoto completo no servidor */
  remotePath: string;
  /** Timestamp da última atualização */
  lastUpdated: number;
  /** Hash SHA-256 do conteúdo do arquivo para detectar modificações */
  contentHash?: string;
  /** Data de modificação do arquivo no servidor quando foi baixado */
  serverModified?: string;
  /** Data de modificação local do arquivo quando foi baixado/salvo */
  localModifiedAtDownload?: string;
  /** Indica se é um arquivo binário */
  isBinary?: boolean;
}

/**
 * Interface para o arquivo de configuração de mapeamento
 */
export interface PathMappingConfig {
  /** Caminho remoto do diretório raiz */
  rootRemotePath: string;
  /** Caminho local do diretório raiz */
  rootLocalPath: string;
  /** Lista de mapeamentos de arquivos e pastas */
  mappings: PathMapping[];
  /** Versão do arquivo de configuração */
  version: string;
  /** Data de criação */
  createdAt: number;
}

const CONFIG_FOLDER_NAME = ".miisync";
const CONFIG_FILE_NAME = "path-mapping.json";
const CONFIG_VERSION = "1.0.0";

/**
 * Classe para gerenciar o mapeamento entre caminhos locais e remotos
 */
export class PathMappingManager {
  /**
   * Obtém o caminho da pasta de configuração oculta
   */
  private static getConfigFolderPath(rootLocalPath: string): string {
    return path.join(rootLocalPath, CONFIG_FOLDER_NAME);
  }

  /**
   * Obtém o caminho do arquivo de configuração
   */
  private static getConfigFilePath(rootLocalPath: string): string {
    return path.join(this.getConfigFolderPath(rootLocalPath), CONFIG_FILE_NAME);
  }

  /**
   * Verifica se existe um arquivo de mapeamento para o diretório
   */
  static async hasMappingFile(rootLocalPath: string): Promise<boolean> {
    const configPath = this.getConfigFilePath(rootLocalPath);
    return await pathExists(configPath);
  }

  /**
   * Cria um novo arquivo de mapeamento para um diretório baixado
   */
  static async createMappingFile(
    rootLocalPath: string,
    rootRemotePath: string,
    mappings: PathMapping[] = []
  ): Promise<void> {
    const configFolderPath = this.getConfigFolderPath(rootLocalPath);
    const configFilePath = this.getConfigFilePath(rootLocalPath);

    // Cria a pasta oculta se não existir
    await ensureDir(configFolderPath);

    const config: PathMappingConfig = {
      rootRemotePath,
      rootLocalPath,
      mappings,
      version: CONFIG_VERSION,
      createdAt: Date.now(),
    };

    await writeFile(configFilePath, JSON.stringify(config, null, 2), "utf8");
  }

  /**
   * Carrega o arquivo de mapeamento de um diretório
   */
  static async loadMappingFile(
    rootLocalPath: string
  ): Promise<PathMappingConfig | null> {
    const configFilePath = this.getConfigFilePath(rootLocalPath);

    if (!(await pathExists(configFilePath))) {
      return null;
    }

    try {
      const content = await readFile(configFilePath, "utf8");
      return JSON.parse(content) as PathMappingConfig;
    } catch (error) {
      console.error("Erro ao carregar arquivo de mapeamento:", error);
      return null;
    }
  }

  /**
   * Adiciona ou atualiza um mapeamento no arquivo
   */
  static async addMapping(
    rootLocalPath: string,
    localPath: string,
    remotePath: string,
    fileContent?: string
  ): Promise<void> {
    const config = await this.loadMappingFile(rootLocalPath);
    if (!config) {
      throw new Error("Arquivo de mapeamento não encontrado");
    }

    // Calcula hash do conteúdo se fornecido
    let contentHash: string | undefined;
    if (fileContent !== undefined) {
      contentHash = this.calculateContentHash(fileContent);
      
      // Cria backup do conteúdo original
      await this.createFileBackup(rootLocalPath, localPath, fileContent);
    }

    // Remove mapeamento existente se houver
    const existingIndex = config.mappings.findIndex(
      (m) => m.localPath === localPath
    );
    if (existingIndex !== -1) {
      config.mappings.splice(existingIndex, 1);
    }

    // Adiciona novo mapeamento
    config.mappings.push({
      localPath,
      remotePath,
      lastUpdated: Date.now(),
      contentHash
    });

    const configFilePath = this.getConfigFilePath(rootLocalPath);
    await writeFile(configFilePath, JSON.stringify(config, null, 2), "utf8");
  }

  /**
   * Calcula hash SHA-256 do conteúdo
   */
  static calculateContentHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Cria backup do conteúdo original do arquivo
   */
  static async createFileBackup(
    rootLocalPath: string,
    localPath: string,
    content: string
  ): Promise<void> {
    try {
      const backupDir = path.join(rootLocalPath, CONFIG_FOLDER_NAME, 'backup');
      const backupFilePath = path.join(backupDir, localPath);
      
      // Garante que o diretório existe
      await ensureDir(path.dirname(backupFilePath));
      
      // Salva conteúdo original
      await writeFile(backupFilePath, content, 'utf8');
    } catch (error) {
      console.error('❌ Erro ao criar backup do arquivo:', error);
      // Não falha o processo se backup falhar
    }
  }

  /**
   * Busca o caminho remoto para um arquivo/pasta local
   * Retorna exatamente o caminho salvo no mapeamento, sem modificações
   */
  static async getRemotePathFromMapping(
    localFilePath: string
  ): Promise<string | null> {
    // Procura por um arquivo de mapeamento subindo na hierarquia de diretórios
    let currentDir = path.dirname(localFilePath);
    let lastDir = "";

    while (currentDir !== lastDir) {
      if (await this.hasMappingFile(currentDir)) {
        const config = await this.loadMappingFile(currentDir);
        if (config) {
          // Calcula o caminho relativo do arquivo em relação ao diretório raiz
          const relativePath = path.relative(currentDir, localFilePath);

          // Busca por um mapeamento exato primeiro
          const mapping = config.mappings.find(
            (m) => m.localPath === relativePath
          );
          if (mapping) {
            // Retorna exatamente o caminho remoto salvo, sem modificações
            return mapping.remotePath;
          }

          // Se não encontrou mapeamento exato, verifica se é o próprio diretório raiz
          if (!relativePath || relativePath === ".") {
            return config.rootRemotePath;
          }

          // Para subpastas/arquivos não mapeados diretamente,
          // constrói baseado no caminho raiz remoto salvo
          const normalizedRelative = relativePath.replaceAll(path.sep, "/");
          return config.rootRemotePath + "/" + normalizedRelative;
        }
      }

      lastDir = currentDir;
      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  /**
   * Busca a configuração de mapeamento para um diretório ou seus pais
   */
  static async findMappingConfig(
    localPath: string
  ): Promise<{ config: PathMappingConfig; rootPath: string } | null> {
    let currentDir = path.isAbsolute(localPath)
      ? localPath
      : path.dirname(localPath);
    if (
      (await pathExists(localPath)) &&
      !(await require("fs-extra").lstat(localPath)).isDirectory()
    ) {
      currentDir = path.dirname(localPath);
    }

    let lastDir = "";

    while (currentDir !== lastDir) {
      if (await this.hasMappingFile(currentDir)) {
        const config = await this.loadMappingFile(currentDir);
        if (config) {
          return { config, rootPath: currentDir };
        }
      }

      lastDir = currentDir;
      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  /**
   * Adiciona múltiplos mapeamentos de uma só vez
   */
  static async addMultipleMappings(
    rootLocalPath: string,
    mappings: { localPath: string; remotePath: string }[]
  ): Promise<void> {
    const config = await this.loadMappingFile(rootLocalPath);
    if (!config) {
      throw new Error("Arquivo de mapeamento não encontrado");
    }

    // Adiciona novos mapeamentos
    for (const mapping of mappings) {
      // Remove mapeamento existente se houver
      const existingIndex = config.mappings.findIndex(
        (m) => m.localPath === mapping.localPath
      );
      if (existingIndex !== -1) {
        config.mappings.splice(existingIndex, 1);
      }

      config.mappings.push({
        localPath: mapping.localPath,
        remotePath: mapping.remotePath,
        lastUpdated: Date.now(),
      });
    }

    const configFilePath = this.getConfigFilePath(rootLocalPath);
    await writeFile(configFilePath, JSON.stringify(config, null, 2), "utf8");
  }

  /**
   * Salva o arquivo de mapeamento atualizado
   */
  static async saveUpdatedMapping(config: PathMappingConfig): Promise<void> {
    const configFilePath = this.getConfigFilePath(config.rootLocalPath);
    await writeFile(configFilePath, JSON.stringify(config, null, 2), "utf8");
  }
}
