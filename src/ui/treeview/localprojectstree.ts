import * as fs from "fs-extra";
import * as path from "path";
import * as vscode from "vscode";
import { projectEvents } from "../../events/projectevents";
import { gitManager } from "../../modules/gitmanager";

/**
 * Status de modificação do arquivo
 */
export enum FileStatus {
  Modified = "M", // Arquivo modificado
  Added = "A", // Arquivo novo (não estava no mapeamento)
  Deleted = "D", // Arquivo deletado (estava no mapeamento mas não existe mais)
}

/**
 * Status de verificação do servidor
 */
export enum ServerVerificationStatus {
  NotChecked = "not-checked", // Ainda não foi verificado
  Checking = "checking", // Verificação em andamento
  UpToDate = "up-to-date", // Sincronizado com servidor
  OutOfSync = "out-of-sync", // Diferenças encontradas
  Error = "error", // Erro na verificação
}

/**
 * Tipo de diferença do servidor
 */
export enum ServerDiffType {
  LocalNewer = "local-newer", // Local mais recente que servidor
  ServerNewer = "server-newer", // Servidor mais recente que local
  OnlyInLocal = "only-in-local", // Existe apenas local
  OnlyInServer = "only-in-server", // Existe apenas no servidor
  Different = "different", // Conteúdos diferentes
}

/**
 * Interface para representar um projeto local
 */
export interface LocalProject {
  name: string;
  localPath: string;
  remotePath: string;
  projectCategory: ProjectCategory;
  downloadedAt: Date;
  modifiedFiles: ModifiedFile[];
  serverVerification?: ServerVerification;
}

/**
 * Interface para verificação do servidor
 */
export interface ServerVerification {
  status: ServerVerificationStatus;
  lastChecked?: Date;
  differences: ServerDifference[];
  error?: string;
}

/**
 * Interface para diferenças do servidor
 */
export interface ServerDifference {
  path: string;
  relativePath: string;
  diffType: ServerDiffType;
  isDirectory: boolean;
  localModified?: Date;
  serverModified?: Date;
  description: string;
}

/**
 * Interface para representar um arquivo modificado
 */
export interface ModifiedFile {
  fileName: string;
  filePath: string;
  relativePath: string;
  lastModified: Date;
  hasLocalChanges: boolean;
  status: FileStatus;
  originalHash?: string; // Hash do conteúdo original para comparação
}

export type ProjectCategory = 'web' | 'catalog';

/** Detecta se um segmento de path é exatamente "WEB" (não "WEBAPP", "WEBSERVICE", etc.) */
function isWebRemotePath(remotePath: string): boolean {
  return /(?:^|\/)WEB(?:\/|$)/.test(remotePath);
}

/** Determina a categoria de um projeto a partir dos dados do mapping.
 *  Verifica rootRemotePath primeiro; se inconclusivo, examina os remotePaths
 *  dos arquivos individuais para detectar "/WEB/" em qualquer um deles. */
function detectProjectCategory(mappingData: any): ProjectCategory {
  if (isWebRemotePath(mappingData.rootRemotePath || '')) return 'web';
  const mappings: any[] = mappingData.mappings || [];
  if (mappings.some((m) => isWebRemotePath(m.remotePath || ''))) return 'web';
  return 'catalog';
}

/**
 * Item da árvore que pode ser uma categoria, projeto, arquivo modificado ou diferença do servidor
 */
export class LocalProjectTreeItem extends vscode.TreeItem {
  public categoryType?: ProjectCategory;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly isProject: boolean = false,
    public readonly project?: LocalProject,
    public readonly modifiedFile?: ModifiedFile,
    public readonly serverDifference?: ServerDifference,
    public readonly isServerDiffSection: boolean = false
  ) {
    super(label, collapsibleState);

    if (isProject && project) {
      this.setupProjectItem(project);
    } else if (modifiedFile) {
      this.setupFileItem(modifiedFile);
    } else if (serverDifference) {
      this.setupServerDiffItem(serverDifference);
    } else if (isServerDiffSection) {
      this.setupServerDiffSection();
    }
  }

  static forCategory(
    category: ProjectCategory,
    projectCount: number,
    modifiedCount: number
  ): LocalProjectTreeItem {
    const isWeb = category === 'web';
    const item = new LocalProjectTreeItem(
      isWeb ? 'Web' : 'Catalog — TRX & Queries',
      vscode.TreeItemCollapsibleState.Expanded
    );
    item.categoryType = category;
    item.description = modifiedCount > 0
      ? `${projectCount} projeto(s) · ${modifiedCount} modificação(s)`
      : `${projectCount} projeto(s)`;
    item.iconPath = new vscode.ThemeIcon(
      isWeb ? 'globe' : 'database',
      new vscode.ThemeColor(isWeb ? 'charts.blue' : 'charts.purple')
    );
    item.contextValue = 'project-category';
    return item;
  }

  private setupProjectItem(project: LocalProject): void {
    const modifiedCount = project.modifiedFiles.length;
    const serverStatus =
      project.serverVerification?.status || ServerVerificationStatus.NotChecked;
    const diffCount = project.serverVerification?.differences.length || 0;

    let description = `${modifiedCount} modificado(s)`;
    if (serverStatus !== ServerVerificationStatus.NotChecked) {
      if (serverStatus === ServerVerificationStatus.Checking) {
        description += " • Verificando servidor...";
      } else if (serverStatus === ServerVerificationStatus.UpToDate) {
        description += " • Sincronizado";
      } else if (serverStatus === ServerVerificationStatus.OutOfSync) {
        description += ` • ${diffCount} diferença(s) no servidor`;
      } else if (serverStatus === ServerVerificationStatus.Error) {
        description += " • Erro na verificação";
      }
    }

    this.tooltip = `${project.name}\nServidor: ${
      project.remotePath
    }\nBaixado em: ${project.downloadedAt.toLocaleString()}\nArquivos modificados: ${modifiedCount}`;
    if (project.serverVerification?.lastChecked) {
      this.tooltip += `\nÚltima verificação: ${project.serverVerification.lastChecked.toLocaleString()}`;
    }

    this.description = description;
    this.iconPath = this.getProjectIcon(serverStatus);
    this.contextValue = "localproject";
  }

  private getProjectIcon(
    serverStatus: ServerVerificationStatus
  ): vscode.ThemeIcon {
    switch (serverStatus) {
      case ServerVerificationStatus.Checking:
        return new vscode.ThemeIcon(
          "sync~spin",
          new vscode.ThemeColor("charts.blue")
        );
      case ServerVerificationStatus.UpToDate:
        return new vscode.ThemeIcon(
          "folder",
          new vscode.ThemeColor("charts.green")
        );
      case ServerVerificationStatus.OutOfSync:
        return new vscode.ThemeIcon(
          "folder",
          new vscode.ThemeColor("charts.orange")
        );
      case ServerVerificationStatus.Error:
        return new vscode.ThemeIcon(
          "folder",
          new vscode.ThemeColor("charts.red")
        );
      default:
        return new vscode.ThemeIcon(
          "folder",
          new vscode.ThemeColor("charts.blue")
        );
    }
  }

  private setupFileItem(file: ModifiedFile): void {
    const statusIcon = this.getStatusIcon(file.status);
    const statusText = this.getStatusText(file.status);

    this.tooltip = `${file.fileName} [${statusText}]\nCaminho: ${
      file.relativePath
    }\nModificado em: ${file.lastModified.toLocaleString()}`;
    this.description = `${file.relativePath} [${file.status}]`;
    this.iconPath = new vscode.ThemeIcon(
      "file",
      this.getStatusColor(file.status)
    );
    this.contextValue = "modifiedfile";
    this.resourceUri = vscode.Uri.file(file.filePath);

    // Permite abertura do arquivo com diff se for modificado
    if (file.status === FileStatus.Modified) {
      this.command = {
        command: "miisync.showfilediff",
        title: "Mostrar diferenças",
        arguments: [this.resourceUri, file],
      };
    } else {
      this.command = {
        command: "vscode.open",
        title: "Abrir arquivo",
        arguments: [this.resourceUri],
      };
    }
  }

  private getStatusIcon(status: FileStatus): string {
    switch (status) {
      case FileStatus.Modified:
        return "file-diff";
      case FileStatus.Added:
        return "file-add";
      case FileStatus.Deleted:
        return "file-remove";
      default:
        return "file";
    }
  }

  private getStatusText(status: FileStatus): string {
    switch (status) {
      case FileStatus.Modified:
        return "Modificado";
      case FileStatus.Added:
        return "Novo";
      case FileStatus.Deleted:
        return "Deletado";
      default:
        return "Desconhecido";
    }
  }

  private getStatusColor(status: FileStatus): vscode.ThemeColor {
    switch (status) {
      case FileStatus.Modified:
        return new vscode.ThemeColor(
          "gitDecoration.modifiedResourceForeground"
        );
      case FileStatus.Added:
        return new vscode.ThemeColor("gitDecoration.addedResourceForeground");
      case FileStatus.Deleted:
        return new vscode.ThemeColor("gitDecoration.deletedResourceForeground");
      default:
        return new vscode.ThemeColor("foreground");
    }
  }

  private setupServerDiffSection(): void {
    this.tooltip = "Diferenças encontradas entre local e servidor";
    this.iconPath = new vscode.ThemeIcon(
      "cloud-upload",
      new vscode.ThemeColor("charts.orange")
    );
    this.contextValue = "serverdiffsection";
  }

  private setupServerDiffItem(diff: ServerDifference): void {
    const icon = this.getServerDiffIcon(diff.diffType);
    const color = this.getServerDiffColor(diff.diffType);

    this.tooltip = `${diff.relativePath}\nTipo: ${this.getServerDiffText(
      diff.diffType
    )}\n${diff.description}`;
    this.description = `[${this.getServerDiffShortText(diff.diffType)}] ${
      diff.description
    }`;
    this.iconPath = new vscode.ThemeIcon(icon, color);
    this.contextValue = "serverdifference";

    if (!diff.isDirectory) {
      this.resourceUri = vscode.Uri.file(diff.path);
    }
  }

  private getServerDiffIcon(diffType: ServerDiffType): string {
    switch (diffType) {
      case ServerDiffType.LocalNewer:
        return "arrow-up";
      case ServerDiffType.ServerNewer:
        return "arrow-down";
      case ServerDiffType.OnlyInLocal:
        return "add";
      case ServerDiffType.OnlyInServer:
        return "remove";
      case ServerDiffType.Different:
        return "diff";
      default:
        return "question";
    }
  }

  private getServerDiffColor(diffType: ServerDiffType): vscode.ThemeColor {
    switch (diffType) {
      case ServerDiffType.LocalNewer:
        return new vscode.ThemeColor("charts.green");
      case ServerDiffType.ServerNewer:
        return new vscode.ThemeColor("charts.red");
      case ServerDiffType.OnlyInLocal:
        return new vscode.ThemeColor("charts.blue");
      case ServerDiffType.OnlyInServer:
        return new vscode.ThemeColor("charts.orange");
      case ServerDiffType.Different:
        return new vscode.ThemeColor("charts.purple");
      default:
        return new vscode.ThemeColor("foreground");
    }
  }

  private getServerDiffText(diffType: ServerDiffType): string {
    switch (diffType) {
      case ServerDiffType.LocalNewer:
        return "Local mais recente";
      case ServerDiffType.ServerNewer:
        return "Servidor mais recente";
      case ServerDiffType.OnlyInLocal:
        return "Existe apenas localmente";
      case ServerDiffType.OnlyInServer:
        return "Existe apenas no servidor";
      case ServerDiffType.Different:
        return "Conteúdos diferentes";
      default:
        return "Diferença desconhecida";
    }
  }

  private getServerDiffShortText(diffType: ServerDiffType): string {
    switch (diffType) {
      case ServerDiffType.LocalNewer:
        return "L>";
      case ServerDiffType.ServerNewer:
        return "S>";
      case ServerDiffType.OnlyInLocal:
        return "L+";
      case ServerDiffType.OnlyInServer:
        return "S+";
      case ServerDiffType.Different:
        return "≠";
      default:
        return "?";
    }
  }
}

/**
 * Provider da árvore de projetos locais
 */
export class LocalProjectsTreeProvider
  implements vscode.TreeDataProvider<LocalProjectTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    LocalProjectTreeItem | undefined | null | void
  > = new vscode.EventEmitter<LocalProjectTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    LocalProjectTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private projects: LocalProject[] = [];
  private fileWatchers: vscode.FileSystemWatcher[] = [];
  private refreshTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.refresh();
    this.setupAutoRefresh();
  }

  /**
   * Retorna os projetos carregados atualmente
   */
  public getProjects(): LocalProject[] {
    return [...this.projects]; // Retorna uma cópia para evitar modificações externas
  }

  /**
   * 🚀 SISTEMA DE AUTO-REFRESH INTELIGENTE
   */
  private setupAutoRefresh(): void {
    //console.log("🔄 Configurando sistema de auto-refresh inteligente...");

    // 1. Monitor de arquivos salvos (modificações)
    vscode.workspace.onDidSaveTextDocument((document) => {
      //console.log(`💾 Arquivo salvo: ${document.fileName}`);

      // Dispara evento específico se é em um projeto MiiSync
      this.checkIfFileIsInProject(document.fileName);

      this.scheduleRefresh("arquivo salvo");
    });

    // 2. Monitor de arquivos criados
    vscode.workspace.onDidCreateFiles((event) => {
      // console.log(`📁 Arquivos criados: ${event.files.length}`);
      this.scheduleRefresh("arquivos criados");
    });

    // 3. Monitor de arquivos deletados
    vscode.workspace.onDidDeleteFiles(() => {
      // console.log(`🗑️ Arquivos deletados: ${event.files.length}`);
      this.scheduleRefresh("arquivos deletados");
    });

    // 4. Monitor de mudanças de workspace
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // console.log("📂 Workspace folders mudaram");
      this.scheduleRefresh("workspace mudou");
    });

    // 5. Monitor específico para arquivos .miisync (path-mapping.json)
    this.setupMiiSyncWatchers();

    // 6. Auto-refresh periódico (a cada 30 segundos)
    setInterval(() => {
      // console.log("⏰ Auto-refresh periódico");
      this.scheduleRefresh("auto-refresh periódico");
    }, 30000);

    // 7. Monitor quando VS Code ganha foco (pode ter mudanças externas)
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        // console.log("👁️ VS Code ganhou foco - verificando mudanças");
        this.scheduleRefresh("foco ganho");
      }
    });

    // 8. 🚀 NOVO: Monitor de eventos específicos de projetos
    projectEvents.onProjectDownloaded((event) => {
      // console.log(`🎉 Projeto baixado detectado: ${event.localPath}`);
      this.scheduleRefresh("projeto baixado");
    });

    projectEvents.onProjectModified((event) => {
      // console.log(`📝 Projeto modificado detectado: ${event.localPath}`);
      this.scheduleRefresh("projeto modificado");
    });

    projectEvents.onProjectDeleted((event) => {
      // console.log(`🗑️ Projeto deletado detectado: ${event.localPath}`);
      this.scheduleRefresh("projeto deletado");
    });
  }

  /**
   * Configura watchers específicos para arquivos .miisync
   */
  private setupMiiSyncWatchers(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    // Remove watchers antigos
    this.fileWatchers.forEach((watcher) => watcher.dispose());
    this.fileWatchers = [];

    for (const folder of workspaceFolders) {
      // Watcher para path-mapping.json
      const mappingPattern = new vscode.RelativePattern(
        folder,
        "**/.miisync/path-mapping.json"
      );
      const mappingWatcher =
        vscode.workspace.createFileSystemWatcher(mappingPattern);

      mappingWatcher.onDidCreate(() => {
        console.log("📋 path-mapping.json criado");
        this.scheduleRefresh("mapping criado");
      });

      mappingWatcher.onDidChange(() => {
        console.log("📋 path-mapping.json modificado");
        this.scheduleRefresh("mapping modificado");
      });

      mappingWatcher.onDidDelete(() => {
        console.log("📋 path-mapping.json deletado");
        this.scheduleRefresh("mapping deletado");
      });

      this.fileWatchers.push(mappingWatcher);

      // Watcher para novos diretórios .miisync
      const miisyncPattern = new vscode.RelativePattern(folder, "**/.miisync");
      const miisyncWatcher =
        vscode.workspace.createFileSystemWatcher(miisyncPattern);

      miisyncWatcher.onDidCreate(() => {
        console.log("📁 Novo diretório .miisync criado - novo projeto!");
        this.scheduleRefresh("novo projeto detectado");
      });

      this.fileWatchers.push(miisyncWatcher);
    }
  }

  /**
   * Verifica se um arquivo pertence a um projeto MiiSync e dispara evento
   */
  private async checkIfFileIsInProject(filePath: string): Promise<void> {
    try {
      // Procura o diretório .miisync mais próximo
      let currentDir = path.dirname(filePath);
      let projectRoot: string | null = null;

      while (currentDir && currentDir !== path.parse(currentDir).root) {
        const miisyncPath = path.join(currentDir, ".miisync");
        if (await fs.pathExists(miisyncPath)) {
          projectRoot = currentDir;
          break;
        }
        currentDir = path.dirname(currentDir);
      }

      if (projectRoot) {
        const fileName = path.basename(filePath);
        console.log(
          `📝 Arquivo em projeto MiiSync: ${fileName} (projeto: ${projectRoot})`
        );
        projectEvents.fireProjectModified(projectRoot, fileName);
      }
    } catch (error) {
      console.error("❌ Erro ao verificar se arquivo está em projeto:", error);
    }
  }

  /**
   * Agenda um refresh com debounce para evitar muitos refreshes seguidos
   */
  private scheduleRefresh(reason: string): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = setTimeout(() => {
      //console.log(`🔄 Executando refresh: ${reason}`);
      this.refresh();
      this.refreshTimeout = null;
    }, 500); // 500ms de debounce
  }

  refresh(): void {
    this.loadProjects();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: LocalProjectTreeItem): vscode.TreeItem {
    return element;
  }

  private projectsForCategory(category: ProjectCategory): LocalProject[] {
    return this.projects.filter((p) => p.projectCategory === category);
  }

  private makeProjectItem(project: LocalProject): LocalProjectTreeItem {
    const hasContent =
      project.modifiedFiles.length > 0 ||
      (project.serverVerification?.differences.length || 0) > 0;
    return new LocalProjectTreeItem(
      project.name,
      hasContent
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
      true,
      project
    );
  }

  getChildren(
    element?: LocalProjectTreeItem
  ): Thenable<LocalProjectTreeItem[]> {
    if (!element) {
      const webProjects = this.projectsForCategory('web');
      const catalogProjects = this.projectsForCategory('catalog');
      const categories: LocalProjectTreeItem[] = [];

      if (webProjects.length > 0) {
        const mods = webProjects.reduce((t, p) => t + p.modifiedFiles.length, 0);
        categories.push(LocalProjectTreeItem.forCategory('web', webProjects.length, mods));
      }
      if (catalogProjects.length > 0) {
        const mods = catalogProjects.reduce((t, p) => t + p.modifiedFiles.length, 0);
        categories.push(LocalProjectTreeItem.forCategory('catalog', catalogProjects.length, mods));
      }
      return Promise.resolve(categories);

    } else if (element.categoryType) {
      return Promise.resolve(
        this.projectsForCategory(element.categoryType).map((p) => this.makeProjectItem(p))
      );

    } else if (element.isProject && element.project) {
      // Retorna os filhos do projeto: arquivos modificados + diferenças do servidor
      const children: LocalProjectTreeItem[] = [];

      // Adiciona arquivos modificados
      element.project.modifiedFiles.forEach((file) => {
        children.push(
          new LocalProjectTreeItem(
            file.fileName,
            vscode.TreeItemCollapsibleState.None,
            false,
            undefined,
            file
          )
        );
      });

      // Adiciona seção de diferenças do servidor (se houver)
      const serverVerification = element.project.serverVerification;
      if (serverVerification && serverVerification.differences.length > 0) {
        children.push(
          new LocalProjectTreeItem(
            `📡 Diferenças do Servidor (${serverVerification.differences.length})`,
            vscode.TreeItemCollapsibleState.Expanded,
            false,
            element.project, // Passa o projeto para poder acessar as diferenças
            undefined,
            undefined,
            true
          )
        );
      }

      return Promise.resolve(children);
    } else if (
      element.isServerDiffSection &&
      element.project?.serverVerification
    ) {
      // Retorna as diferenças do servidor
      return Promise.resolve(
        element.project.serverVerification.differences.map(
          (diff) =>
            new LocalProjectTreeItem(
              path.basename(diff.relativePath),
              vscode.TreeItemCollapsibleState.None,
              false,
              undefined,
              undefined,
              diff
            )
        )
      );
    }

    return Promise.resolve([]);
  }

  /**
   * Carrega os projetos locais analisando as pastas com path-mapping.json
   */
  private async loadProjects(): Promise<void> {
    const projects: LocalProject[] = [];

    try {
      // Encontra todas as pastas de workspace
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        this.projects = projects;
        return;
      }

      for (const folder of workspaceFolders) {
        await this.scanFolderForProjects(folder.uri.fsPath, projects);
      }

      this.projects = projects;
    } catch (error) {
      console.error("❌ Erro ao carregar projetos locais:", error);
      this.projects = [];
    }
  }

  /**
   * Escaneia uma pasta em busca de projetos (pastas com .miisync/path-mapping.json)
   */
  private async scanFolderForProjects(
    folderPath: string,
    projects: LocalProject[]
  ): Promise<void> {
    try {
      const items = await fs.readdir(folderPath, { withFileTypes: true });

      for (const item of items) {
        if (item.isDirectory()) {
          const itemPath = path.join(folderPath, item.name);
          const mappingPath = path.join(
            itemPath,
            ".miisync",
            "path-mapping.json"
          );

          // Verifica se é um projeto (tem mapeamento)
          if (await fs.pathExists(mappingPath)) {
            const project = await this.createProjectFromMapping(
              itemPath,
              mappingPath
            );
            if (project) {
              projects.push(project);
            }
          }

          // Recursivamente escaneia subpastas (até 2 níveis)
          if (
            folderPath === vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
          ) {
            await this.scanFolderForProjects(itemPath, projects);
          }
        }
      }
    } catch (error) {
      // Ignora erros de acesso a pastas
    }
  }

  /**
   * Cria um objeto LocalProject a partir do arquivo de mapeamento
   */
  private async createProjectFromMapping(
    projectPath: string,
    mappingPath: string
  ): Promise<LocalProject | null> {
    try {
      const mappingData = await fs.readJson(mappingPath);
      const stats = await fs.stat(mappingPath);

      // Obtém o nome do projeto (nome da pasta)
      const projectName = path.basename(projectPath);

      // Obtém o caminho remoto do diretório raiz do projeto
      let remotePath = "/";

      if (mappingData.rootRemotePath) {
        // Usa o caminho raiz remoto diretamente do arquivo de mapeamento
        remotePath = mappingData.rootRemotePath.replace(/\\/g, "/");
      } else if (mappingData.mappings?.[0]) {
        // Fallback: remove o arquivo específico para obter o caminho da pasta
        const firstMapping = mappingData.mappings[0];
        const remoteDir = path
          .dirname(firstMapping.remotePath)
          .replace(/\\/g, "/");
        remotePath = remoteDir;
      }

      // Encontra arquivos modificados
      const modifiedFiles = await this.findModifiedFiles(projectPath);

      return {
        name: projectName,
        localPath: projectPath,
        remotePath: remotePath,
        projectCategory: detectProjectCategory(mappingData),
        downloadedAt: stats.birthtime || stats.mtime,
        modifiedFiles: modifiedFiles,
      };
    } catch (error) {
      console.error("❌ Erro ao criar projeto do mapeamento:", error);
      return null;
    }
  }

  private async findModifiedFiles(projectPath: string): Promise<ModifiedFile[]> {
    if (!(await gitManager.isGitRepo(projectPath))) return [];
    return this.findModifiedFilesViaGit(projectPath);
  }

  private async findModifiedFilesViaGit(projectPath: string): Promise<ModifiedFile[]> {
    const gitFiles = await gitManager.getStatus(projectPath);
    const result: ModifiedFile[] = [];
    for (const gf of gitFiles) {
      let lastModified = new Date();
      try {
        if (gf.status !== 'deleted') {
          const st = await fs.stat(gf.filePath);
          lastModified = st.mtime;
        }
      } catch {}
      const relPath = path.relative(projectPath, gf.filePath);
      result.push({
        fileName: path.basename(gf.filePath),
        filePath: gf.filePath,
        relativePath: relPath,
        lastModified,
        hasLocalChanges: true,
        status: gf.status === 'added' ? FileStatus.Added
              : gf.status === 'deleted' ? FileStatus.Deleted
              : FileStatus.Modified,
      });
    }
    return result;
  }

  /**
   * Limpa recursos quando a extensão é desativada
   */
  dispose(): void {
    console.log("🧹 Limpando watchers do LocalProjectsTree...");

    // Limpa timeout de refresh
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }

    // Limpa file watchers
    this.fileWatchers.forEach((watcher) => {
      watcher.dispose();
    });
    this.fileWatchers = [];

    // Limpa event emitter
    this._onDidChangeTreeData.dispose();
  }
}

// Instância singleton do provider
export const localProjectsTree = new LocalProjectsTreeProvider();
