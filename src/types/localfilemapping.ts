export interface LocalFileMapping {
  /** Caminho local absoluto do arquivo */
  localPath: string;

  /** Caminho remoto correspondente no servidor */
  remotePath: string;

  /** Data e hora da última modificação detectada */
  lastModified: Date;

  /** Flag indicando se o arquivo foi alterado localmente */
  hasLocalChanges: boolean;

  /** Hash do conteúdo original (para comparação) */
  originalHash?: string;

  /** Tipo de status do arquivo (modificado, novo, deletado) */
  status: "modified" | "added" | "deleted" | "unchanged";

  /** Data de criação do registro no mapeamento */
  createdAt: Date;

  /** Data da última verificação/atualização */
  lastChecked: Date;
}

export interface LocalFilesMappingData {
  /** Versão do formato do arquivo (para compatibilidade futura) */
  version: string;

  /** Data da última atualização do mapeamento */
  lastUpdated: Date;

  /** Mapeamento de arquivos locais */
  files: { [localPath: string]: LocalFileMapping };

  /** Configurações adicionais */
  settings?: {
    /** Automaticamente detectar mudanças */
    autoDetectChanges?: boolean;

    /** Intervalo de verificação em milissegundos */
    checkInterval?: number;
  };
}
