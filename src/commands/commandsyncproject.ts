import * as crypto from "crypto";
import * as fs from "fs-extra";
import * as path from "path";
import * as vscode from "vscode";
import { System, UserConfig } from "../extension/system";
import { File, Folder } from "../miiservice/abstract/responsetypes";
import { loadFilesInsideService } from "../miiservice/loadfilesinsideservice";
import { configManager } from "../modules/config";
import { localFilesMappingManager } from "../modules/localfilesmapping";
import { CheckSeverity, SeverityOperation } from "../modules/severity";
import { Validate } from "../transfer/gate";
import { DownloadComplexLimited } from "../transfer/limited/downloadcomplex";
import { localProjectsTree } from "../ui/treeview/localprojectstree";

interface SyncProjectItem {
  fullPath: string; // caminho local do projeto
  project?: { remotePath: string; localPath: string; name: string };
}

async function resolveRemotePath(
  projectPath: string,
  projectItem: any
): Promise<string | null> {
  // 1. Se já veio no item
  if (projectItem?.project?.remotePath) return projectItem.project.remotePath;
  if (projectItem?.remotePath) return projectItem.remotePath;

  // 2. Tentar via localProjectsTree (possui remotePath armazenado)
  const proj = localProjectsTree
    .getProjects()
    .find((p) => p.localPath === projectPath);
  if (proj?.remotePath) return proj.remotePath;

  // 3. Ler mapping .miisync/path-mapping.json
  try {
    const mappingFile = path.join(projectPath, ".miisync", "path-mapping.json");
    if (await fs.pathExists(mappingFile)) {
      const data = await fs.readJson(mappingFile);
      if (data.rootRemotePath) return data.rootRemotePath;
      if (data.mappings && data.mappings[0]?.remotePath) {
        // Usa pasta do primeiro mapping
        return path.posix.dirname(
          data.mappings[0].remotePath.replace(/\\/g, "/")
        );
      }
    }
  } catch (_) {
    // ignorar
  }

  return null;
}

async function hasLocalModifications(projectPath: string): Promise<boolean> {
  // Usa localProjectsTree para detectar modificações do projeto
  const projects = localProjectsTree.getProjects();
  const proj = projects.find((p) => p.localPath === projectPath);
  if (!proj) return false;
  return proj.modifiedFiles.length > 0; // simples por enquanto
}

export async function OnCommandSyncProject(projectItem: any) {
  try {
    const projectPath: string =
      projectItem.fullPath ||
      projectItem.projectPath ||
      projectItem.localPath ||
      projectItem;
    if (!projectPath || typeof projectPath !== "string") {
      vscode.window.showErrorMessage(
        "Caminho do projeto inválido para sincronização."
      );
      return;
    }

    const projectName = path.basename(projectPath);

    const userConfig = await configManager.load();
    if (!userConfig) {
      vscode.window.showErrorMessage("Configuração do usuário não encontrada.");
      return;
    }
    const system = configManager.CurrentSystem as System;

    // Resolve caminho remoto corretamente
    const remotePath = await resolveRemotePath(projectPath, projectItem);
    if (!remotePath || remotePath === "/") {
      vscode.window.showErrorMessage(
        "Não foi possível determinar o caminho remoto do projeto para sincronização."
      );
      return;
    }

    // Limpa entradas órfãs (arquivos que não existem mais localmente) para evitar falsos "modified"
    await pruneMissingLocalEntries(projectPath);

    // Coleta metadados remotos (lista de arquivos) para contagem de divergências
    const diffInfo = await collectRemoteDifferences(remotePath, projectPath);

    const popupDetailLines: string[] = [
      `Caminho remoto: ${remotePath}`,
      `Total arquivos remotos: ${diffInfo.totalRemoteFiles}`,
      `Modificados remotamente: ${diffInfo.modifiedRemote.length}`,
      `Novos no remoto: ${diffInfo.newRemote.length}`,
      `Removidos no remoto: ${diffInfo.removedRemote.length}`,
    ];
    // Coleta arquivos locais modificados (mapping manager)
    const localModified = localFilesMappingManager
      .getFilesWithLocalChanges()
      .filter((f) => f.localPath.startsWith(projectPath + path.sep));
    const localModifiedRemotePaths = new Set(
      localModified
        .filter((f) => f.remotePath)
        .map((f) => normalizeRemote(f.remotePath))
    );
    // Conflitos: arquivo modificado remotamente E localmente
    const conflicts = diffInfo.modifiedRemote.filter((r) =>
      localModifiedRemotePaths.has(r)
    );

    let confirmation: string | undefined;
    if (conflicts.length === 0) {
      // Fluxo antigo porém sem bloquear por modificações locais: oferecemos incremental direta / completa
      confirmation = await vscode.window.showInformationMessage(
        `Sincronizar projeto "${projectName}"?`,
        {
          modal: true,
          detail:
            popupDetailLines.join("\n") +
            `\n\nModificações locais: ${localModified.length}\nNenhum conflito detectado.`,
        },
        "Incremental",
        "Completa",
        "Detalhes",
        "Cancelar"
      );
    } else {
      confirmation = await vscode.window.showInformationMessage(
        `Conflitos encontrados em ${conflicts.length} arquivo(s)`,
        {
          modal: true,
          detail:
            popupDetailLines.join("\n") +
            `\n\nModificações locais: ${localModified.length}` +
            `\nConflitos: ${conflicts.length}` +
            `\n\nEscolha:` +
            `\nA) Parcial (preserva locais conflitantes)` +
            `\nB) Sobrescrever (usa remoto nos conflitantes)` +
            `\nDetalhes para inspeção individual.`,
        },
        "Parcial",
        "Sobrescrever",
        "Detalhes",
        "Cancelar"
      );
    }
    if (!confirmation || confirmation === "Cancelar") return;
    if (confirmation === "Detalhes") {
      vscode.commands.executeCommand("miisync.showSyncDifferences", {
        projectPath,
        projectName,
        remotePath,
        diffInfo,
      });
      return;
    }

    // Tratamento de opções com/sem conflitos
    const isConflictScenario = conflicts.length > 0;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("Workspace não encontrado.");
      return;
    }

    const tempFolder = path.join(
      workspaceFolder,
      `.__miisync_sync_temp_${Date.now()}_${projectName}`
    );

    // Função auxiliar de download seguro (similar a DownloadRemoteFolderAsProject mas custom destino)
    async function downloadToTemporaryFolder(): Promise<boolean> {
      try {
        if (!(await Validate(userConfig as UserConfig, { system })))
          return false;

        const sourcePath = remotePath;
        const folder = {
          files: [],
          folders: [],
          path: sourcePath,
          isRemotePath: true,
        } as any;
        if (
          !(await CheckSeverity(
            folder,
            SeverityOperation.download,
            userConfig as UserConfig,
            system
          ))
        )
          return false;

        function getPath(item: File | Folder) {
          if ("FolderName" in item) {
            return (
              tempFolder +
              path.sep +
              (path.relative(sourcePath, item.Path) !== ""
                ? path.relative(sourcePath, item.Path)
                : "")
            );
          } else {
            return (
              tempFolder +
              path.sep +
              (path.relative(sourcePath, item.FilePath) !== ""
                ? path.relative(sourcePath, item.FilePath) + path.sep
                : "") +
              item.ObjectName
            );
          }
        }

        const response = await DownloadComplexLimited(
          folder,
          getPath,
          userConfig as UserConfig,
          system
        );
        return !response.aborted;
      } catch (err) {
        console.error("Erro download temporário:", err);
        return false;
      }
    }

    if (confirmation === "Completa" || confirmation === "Sobrescrever") {
      let downloadOk = false;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Baixando versão remota de "${projectName}"...`,
          cancellable: false,
        },
        async () => {
          downloadOk = await downloadToTemporaryFolder();
        }
      );
      if (!downloadOk) {
        vscode.window.showErrorMessage(
          `Falha ao baixar versão remota do projeto "${projectName}".`
        );
        return;
      }
      try {
        if (fs.existsSync(projectPath)) await fs.remove(projectPath);
        await fs.move(tempFolder, projectPath, { overwrite: true });
      } catch (err) {
        vscode.window.showErrorMessage(`Falha ao substituir projeto: ${err}`);
        if (fs.existsSync(tempFolder))
          await fs.remove(tempFolder).catch(() => {});
        return;
      }
      // Reconstroi baseline (hash + status limpo) para todos os arquivos do projeto recém baixado
      await rebuildProjectBaseline(projectPath, remotePath);
      // Atualiza metadados de serverModified após baseline de conteúdo
      await updateServerModifiedBaseline(remotePath);
      vscode.window.showInformationMessage(
        `Projeto "${projectName}" sincronizado (completo).`
      );
      vscode.commands.executeCommand("miisync.refreshprojects");
      vscode.commands.executeCommand("miisync.refreshlocalprojects");
      return;
    } else if (confirmation === "Incremental" || confirmation === "Parcial") {
      // Se for parcial e havia conflitos, precisamos filtrar diffInfo para NÃO incluir os conflitos em modifiedRemote
      let effectiveDiff = diffInfo;
      let conflictsList: string[] = [];
      if (confirmation === "Parcial") {
        const localModified = localFilesMappingManager
          .getFilesWithLocalChanges()
          .filter(
            (f) =>
              f.localPath.startsWith(projectPath + path.sep) && f.remotePath
          );
        const localSet = new Set(
          localModified.map((f) => normalizeRemote(f.remotePath || ""))
        );
        conflictsList = diffInfo.modifiedRemote.filter((r) => localSet.has(r));
        effectiveDiff = {
          ...diffInfo,
          modifiedRemote: diffInfo.modifiedRemote.filter(
            (r) => !localSet.has(r)
          ),
        };
      }
      await applyIncrementalSync({
        projectPath,
        projectName,
        remotePath,
        diffInfo: effectiveDiff,
        conflicts: conflictsList,
      });
      return;
    }
  } catch (error) {
    console.error("Erro na sincronização do projeto:", error);
    vscode.window.showErrorMessage(`Erro ao sincronizar projeto: ${error}`);
  }
}

interface RemoteDiffInfo {
  totalRemoteFiles: number;
  modifiedRemoteCount: number;
  unmappedRemoteCount: number;
  mappingFilesWithoutRemote: number;
  modifiedRemote: string[];
  newRemote: string[];
  removedRemote: string[];
  remoteMeta?: Record<string, { modified?: string; size?: number }>;
}

function normalizeRemote(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/g, "").trim();
}

function belongsToRoot(remotePath: string, root: string): boolean {
  return remotePath === root || remotePath.startsWith(root + "/");
}

async function collectRemoteDifferences(
  remoteRoot: string,
  _localProjectPath: string
): Promise<RemoteDiffInfo> {
  const result: RemoteDiffInfo = {
    totalRemoteFiles: 0,
    modifiedRemoteCount: 0,
    unmappedRemoteCount: 0,
    mappingFilesWithoutRemote: 0,
    modifiedRemote: [],
    newRemote: [],
    removedRemote: [],
    remoteMeta: {},
  };
  try {
    const system = configManager.CurrentSystem as System;
    const userConfig = await configManager.load();
    if (!userConfig) return result;

    const normRoot = normalizeRemote(remoteRoot);
    console.log("[sync][debug] remoteRoot (raw):", remoteRoot);
    console.log("[sync][debug] remoteRoot (norm):", normRoot);

    const data = await loadFilesInsideService.call(system, remoteRoot);
    if (!data || !("Rowsets" in data) || !(data as any).Rowsets.Rowset)
      return result;
    const rows = (data as any).Rowsets.Rowset.Row || [];

    // Cada linha representa um arquivo onde FilePath é a pasta e ObjectName o nome do arquivo.
    // Antes estávamos usando apenas FilePath (pasta), gerando falsos "arquivos" e duplicações.
    const remoteFileRows: File[] = rows
      .filter((r: any) => r.FilePath && r.ObjectName) // garante que é linha de arquivo
      .map((r: any) => r as File);

    const remoteEntries = remoteFileRows.map((r) => ({
      raw: r,
      norm: normalizeRemote(r.FilePath + "/" + r.ObjectName),
    }));

    // Filtra pelo root e ignora .miisync
    const filteredRemote = remoteEntries
      .filter((r) => belongsToRoot(r.norm, normRoot))
      .filter((r) => !r.norm.includes("/.miisync/"));

    // Deduplicar (alguns serviços podem repetir linhas)
    const uniqueRemoteMap = new Map<string, (typeof filteredRemote)[number]>();
    for (const r of filteredRemote) {
      if (!uniqueRemoteMap.has(r.norm)) uniqueRemoteMap.set(r.norm, r);
    }
    const uniqueRemote = Array.from(uniqueRemoteMap.values());

    result.totalRemoteFiles = uniqueRemote.length;

    console.log(
      "[sync][debug] total raw remote rows (com ObjectName):",
      remoteFileRows.length
    );
    console.log(
      "[sync][debug] filtered remote (root + excl .miisync):",
      filteredRemote.length
    );
    console.log("[sync][debug] unique remote files:", uniqueRemote.length);
    console.log(
      "[sync][debug] sample remote unique:",
      uniqueRemote.slice(0, 5).map((r) => r.norm)
    );

    const allMapping = localFilesMappingManager.getAllFiles() || [];
    const projectMapping = allMapping
      .filter((m) => m.remotePath)
      .map((m) => ({ raw: m, norm: normalizeRemote(m.remotePath) }))
      .filter((m) => belongsToRoot(m.norm, normRoot))
      .filter((m) => !m.norm.includes("/.miisync/"));

    // Deduplicar mapping por caminho remoto
    const uniqueMappingMap = new Map<
      string,
      (typeof projectMapping)[number]["raw"]
    >();
    for (const m of projectMapping) {
      if (!uniqueMappingMap.has(m.norm)) uniqueMappingMap.set(m.norm, m.raw);
    }
    const uniqueProjectMapping = Array.from(uniqueMappingMap.entries()).map(
      ([norm, raw]) => ({ norm, raw })
    );

    console.log("[sync][debug] mapping total:", allMapping.length);
    console.log(
      "[sync][debug] mapping filtered (project, excl .miisync):",
      projectMapping.length
    );
    console.log("[sync][debug] mapping unique:", uniqueProjectMapping.length);
    console.log(
      "[sync][debug] sample mapping filtered:",
      uniqueProjectMapping.slice(0, 5).map((m) => m.norm)
    );

    const mappingByRemote = new Map<
      string,
      (typeof uniqueProjectMapping)[number]["raw"]
    >();
    for (const m of uniqueProjectMapping) mappingByRemote.set(m.norm, m.raw);

    const seenRemote = new Set<string>();
    const toleranceMs = 2000; // tolerância de 2s devido possíveis arredondamentos
    for (const rf of uniqueRemote) {
      // Captura metadados (Modified e Size se existir no objeto)
      try {
        (result.remoteMeta as any)[rf.norm] = {
          modified: rf.raw.Modified || undefined,
          size: (rf.raw as any).Size ? Number((rf.raw as any).Size) : undefined,
        };
      } catch {
        /* ignore */
      }
      seenRemote.add(rf.norm);
      const mapped = mappingByRemote.get(rf.norm);
      if (!mapped) {
        result.unmappedRemoteCount++;
        result.newRemote.push(rf.norm);
        console.log("[sync][debug] unmapped remote file:", rf.norm);
        continue;
      }
      // Usar serverModified se existir no mapping, fallback para lastModified
      try {
        const remoteModified = rf.raw.Modified
          ? new Date(rf.raw.Modified).getTime()
          : null;
        const mappedServer = (mapped as any).serverModified
          ? new Date((mapped as any).serverModified).getTime()
          : null;
        const mappedLocalLast = mapped.lastModified
          ? mapped.lastModified.getTime()
          : null;
        // baseline: prioriza serverModified; se não existir, usa lastModified local para primeira comparação
        const baseline = mappedServer != null ? mappedServer : mappedLocalLast;
        if (remoteModified && baseline != null) {
          if (remoteModified - baseline > toleranceMs) {
            result.modifiedRemoteCount++;
            result.modifiedRemote.push(rf.norm);
            console.log(
              "[sync][debug] modified remote NEWER:",
              rf.norm,
              "remote=",
              remoteModified,
              "baseline=",
              baseline
            );
          } else if (baseline - remoteModified > toleranceMs) {
            // Remoto mais antigo -> geralmente não considerar como modificado (pode ser rollback), mas ainda logar
            console.log(
              "[sync][debug] remote older (ignoring diff):",
              rf.norm,
              "remote=",
              remoteModified,
              "baseline=",
              baseline
            );
          }
        } else if (remoteModified && baseline == null) {
          console.log(
            "[sync][debug] no baseline (both serverModified/lastModified missing) for",
            rf.norm,
            "remote=",
            remoteModified
          );
        }
      } catch {
        /* ignore */
      }
    }

    for (const m of uniqueProjectMapping) {
      if (!seenRemote.has(m.norm)) {
        // Verifica se o arquivo local ainda existe; se não existe, pode ser resíduo de mapping antigo
        const localPath = m.raw.localPath;
        let localExists = false;
        try {
          localExists = await fs.pathExists(localPath);
        } catch {
          /* ignore */
        }
        if (!localExists) {
          // Limpa silenciosamente do mapping para evitar falsos positivos
          await localFilesMappingManager.removeFile(localPath);
          continue;
        }
        result.mappingFilesWithoutRemote++;
        result.removedRemote.push(m.norm);
        console.log("[sync][debug] mapping file missing remotely:", m.norm);
      }
    }
  } catch (err) {
    console.error("Erro ao coletar metadados remotos para diff:", err);
  }
  console.log("[sync][debug] summary:", result);
  return result;
}

// Atualiza serverModified no mapping para arquivos do projeto após sync
async function updateServerModifiedBaseline(
  remoteRoot: string,
  ignoreRemotePaths: string[] = []
) {
  try {
    const system = configManager.CurrentSystem as System;
    const userConfig = await configManager.load();
    if (!userConfig) return;
    const normRoot = normalizeRemote(remoteRoot);
    const data = await loadFilesInsideService.call(system, remoteRoot);
    if (!data || !("Rowsets" in data) || !(data as any).Rowsets.Rowset) return;
    const rows = (data as any).Rowsets.Rowset.Row || [];
    const files: File[] = rows
      .filter((r: any) => r.FilePath && r.ObjectName)
      .map((r: any) => r as File);
    // Construir mapa remotePath -> Modified time
    const remoteMap = new Map<string, number>();
    for (const f of files) {
      const full = normalizeRemote(f.FilePath + "/" + f.ObjectName);
      if (
        !full.includes("/.miisync/") &&
        (full === normRoot || full.startsWith(normRoot + "/"))
      ) {
        const ts = f.Modified ? new Date(f.Modified).getTime() : undefined;
        if (ts) remoteMap.set(full, ts);
      }
    }
    // Atualizar mapping existente
    let updates = 0;
    const ignoreSet = new Set(ignoreRemotePaths.map((r) => normalizeRemote(r)));
    for (const file of localFilesMappingManager.getAllFiles()) {
      if (!file.remotePath) continue;
      const rNorm = normalizeRemote(file.remotePath);
      if (rNorm === normRoot || rNorm.startsWith(normRoot + "/")) {
        if (ignoreSet.has(rNorm)) continue; // preserva baseline local de conflitos
        const ts = remoteMap.get(rNorm);
        if (ts) {
          (file as any).serverModified = new Date(ts);
          updates++;
        }
      }
    }
    if (updates > 0) {
      // Força salvar via addOrUpdateFile minimal (ou salvar direto): salvar mapeamento chamando método privado não exposto -> hack: re-adiciona entries
      // Simplesmente tocar lastChecked para disparar save
      for (const file of localFilesMappingManager.getAllFiles()) {
        (file as any).lastChecked = new Date();
      }
      // Não temos método público para salvar tudo; reutilizamos updateLocalChangesFlag para alguns
      // Melhor: acessar internals via casting
      try {
        // @ts-ignore acessar método privado para persistir
        await localFilesMappingManager.saveMapping?.();
      } catch {
        /* ignore */
      }
      console.log(
        "[sync][debug] baseline serverModified atualizado para",
        updates,
        "arquivos."
      );
    }
  } catch (err) {
    console.warn(
      "[sync][debug] falha ao atualizar baseline serverModified:",
      err
    );
  }
}

interface IncrementalSyncParams {
  projectPath: string;
  projectName: string;
  remotePath: string;
  diffInfo: RemoteDiffInfo;
  conflicts?: string[]; // remote paths em conflito para preservar metadados locais
}

async function applyIncrementalSync({
  projectPath,
  projectName,
  remotePath,
  diffInfo,
  conflicts = [],
}: IncrementalSyncParams) {
  const system = configManager.CurrentSystem as System;
  const userConfig = await configManager.load();
  if (!userConfig) {
    vscode.window.showErrorMessage(
      "Configuração não encontrada para sync incremental."
    );
    return;
  }

  const normRoot = normalizeRemote(remotePath);
  const workspaceRoot = projectPath; // já é o path local do projeto

  // Helper para converter remote path -> local path
  function remoteToLocal(r: string): string {
    const rel = r === normRoot ? "" : r.substring(normRoot.length + 1);
    return path.join(workspaceRoot, rel.split("/").join(path.sep));
  }

  // Operações planejadas
  const conflictSet = new Set(conflicts);
  const toAdd = diffInfo.newRemote.slice();
  // Em modo parcial já removemos conflitos de modifiedRemote antes de entrar aqui, mas garantimos filtragem defensiva.
  const toUpdate = diffInfo.modifiedRemote.filter((r) => !conflictSet.has(r));
  const toRemove = diffInfo.removedRemote.slice();

  console.log("[sync][incremental] planejamento:", {
    add: toAdd.length,
    update: toUpdate.length,
    remove: toRemove.length,
  });

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Sincronizando incrementalmente "${projectName}"...`,
      cancellable: false,
    },
    async (progress) => {
      const total = toAdd.length + toUpdate.length + toRemove.length;
      let done = 0;
      function step(msg: string) {
        done++;
        progress.report({ message: `${done}/${total} ${msg}` });
      }

      // Download de arquivos novos e modificados
      const toFetch = [...new Set([...toAdd, ...toUpdate])];
      for (const remoteFile of toFetch) {
        try {
          const data = await loadSingleRemote(remoteFile, system);
          if (!data) {
            step("falha download");
            continue;
          }
          const localPath = remoteToLocal(remoteFile);
          await fs.ensureDir(path.dirname(localPath));
          await fs.writeFile(
            localPath,
            data.content,
            data.isBinary ? undefined : ({ encoding: "utf8" } as any)
          );
          // Atualiza mapping garantindo estado limpo (unchanged)
          // Se não é conflito (garantia), atualiza baseline
          await localFilesMappingManager.addOrUpdateFile(
            localPath,
            remoteFile,
            false,
            "unchanged"
          );
          const fileEntry = localFilesMappingManager.getFile(localPath);
          if (fileEntry) {
            (fileEntry as any).serverModified = data.modified;
            fileEntry.lastModified = new Date();
            fileEntry.hasLocalChanges = false;
            fileEntry.status = "unchanged";
          }
          step("arquivo atualizado");
        } catch (err) {
          console.warn(
            "[sync][incremental] erro ao atualizar",
            remoteFile,
            err
          );
        }
      }

      // Remoção de arquivos ausentes remotamente
      for (const remoteFile of toRemove) {
        try {
          const localPath = remoteToLocal(remoteFile);
          if (await fs.pathExists(localPath)) {
            await fs.remove(localPath);
          }
          // Remover do mapping (se existir)
          const entry = localFilesMappingManager.getFile(localPath);
          if (entry) await localFilesMappingManager.removeFile(localPath);
          step("arquivo removido");
        } catch (err) {
          console.warn("[sync][incremental] erro ao remover", remoteFile, err);
        }
      }
    }
  );

  // Atualiza baseline final
  // Atualiza baseline ignorando conflitos
  updateServerModifiedBaseline(remotePath, conflicts).catch(() => {});
  try {
    await updateLegacyPathMapping(projectPath, remotePath, diffInfo);
  } catch (err) {
    console.warn(
      "[sync][incremental] falha ao atualizar path-mapping legado",
      err
    );
  }
  vscode.window.showInformationMessage(
    `Projeto "${projectName}" sincronizado incrementalmente.`
  );
  vscode.commands.executeCommand("miisync.refreshprojects");
  vscode.commands.executeCommand("miisync.refreshlocalprojects");
}

// Carrega conteúdo de um arquivo remoto individual
async function loadSingleRemote(
  remotePath: string,
  system: System
): Promise<{
  content: Buffer | string;
  isBinary: boolean;
  modified: Date;
} | null> {
  try {
    // Serviço de binary exige caminho WEB completo; assumindo remotePath já nesse formato
    const response = await (
      await import("../miiservice/readfileservice")
    ).readFileService.call(system, remotePath);
    if (!response || (response as any).Rowsets?.FatalError) return null;
    const rows = (response as any).Rowsets?.Rowset?.Row || [];
    const payload = rows.find((r: any) => r.Name === "Payload");
    const modifiedRow = rows.find((r: any) => r.Name === "Modified");
    if (!payload) return null;
    const value = Buffer.from(payload.Value, "base64");
    const isBinary = !value
      .toString("utf8")
      .match(/^[\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]*$/); // heurística simples
    return {
      content: isBinary ? value : value.toString("utf8"),
      isBinary,
      modified: modifiedRow ? new Date(modifiedRow.Value) : new Date(),
    };
  } catch (err) {
    console.warn("[sync][incremental] falha loadSingleRemote", remotePath, err);
    return null;
  }
}

// Atualiza o arquivo legado .miisync/path-mapping.json refletindo mudanças incrementais
async function updateLegacyPathMapping(
  projectPath: string,
  remoteRoot: string,
  diffInfo: RemoteDiffInfo
) {
  try {
    const mappingFile = path.join(projectPath, ".miisync", "path-mapping.json");
    if (!(await fs.pathExists(mappingFile))) return; // nada a fazer se legado não existe

    const data = await fs.readJson(mappingFile);
    if (!data.mappings) data.mappings = [];

    // Índice rápido por remotePath
    const byRemote = new Map<string, any>();
    for (const m of data.mappings) {
      if (m.remotePath) byRemote.set(m.remotePath.replace(/\\/g, "/"), m);
    }

    // Função util para normalizar
    const normRoot = normalizeRemote(remoteRoot);
    function toRel(remoteFile: string): string {
      const rel =
        remoteFile === normRoot
          ? ""
          : remoteFile.substring(normRoot.length + 1);
      return rel.split("/").join(path.sep);
    }

    // Util para obter infos locais atuais (hash + mtime)
    async function captureLocalMeta(remotePathFull: string) {
      const rel = toRel(remotePathFull);
      const localAbs = path.join(projectPath, rel);
      try {
        const exists = await fs.pathExists(localAbs);
        if (!exists) return null;
        const stats = await fs.stat(localAbs);
        const content = await fs.readFile(localAbs);
        const hash = require("crypto")
          .createHash("sha256")
          .update(content)
          .digest("hex");
        return { hash, mtime: stats.mtime.toISOString(), isBinary: false };
      } catch {
        return null;
      }
    }

    const nowIso = new Date().toISOString();

    // ADICIONADOS (novos no remoto) => inserir com baseline limpa
    for (const remoteFile of diffInfo.newRemote) {
      if (byRemote.has(remoteFile)) continue;
      const meta = await captureLocalMeta(remoteFile);
      data.mappings.push({
        localPath: toRel(remoteFile),
        remotePath: remoteFile,
        lastUpdated: Date.now(),
        contentHash: meta?.hash,
        serverModified: nowIso,
        localModifiedAtDownload: meta?.mtime,
      });
    }

    // MODIFICADOS (remoto mais novo) => atualizar baseline para novo conteúdo para que apareçam como não modificados
    for (const remoteFile of diffInfo.modifiedRemote) {
      const existing = byRemote.get(remoteFile);
      if (existing) {
        const meta = await captureLocalMeta(remoteFile);
        existing.lastUpdated = Date.now();
        if (meta?.hash) existing.contentHash = meta.hash;
        if (meta?.mtime) existing.localModifiedAtDownload = meta.mtime;
        existing.serverModified = nowIso;
      }
    }

    // REMOVIDOS (retirar do mapping legado)
    if (diffInfo.removedRemote.length > 0) {
      const removedSet = new Set(diffInfo.removedRemote);
      data.mappings = data.mappings.filter(
        (m: any) => !removedSet.has(m.remotePath)
      );
    }

    // Atualiza rootRemotePath se estiver vazio
    if (!data.rootRemotePath) data.rootRemotePath = remoteRoot;
    if (!data.rootLocalPath) data.rootLocalPath = projectPath;

    // Criar backup anterior
    try {
      const backupDir = path.join(projectPath, ".miisync", "backup-mapping");
      await fs.ensureDir(backupDir);
      const backupName = "path-mapping." + Date.now() + ".json";
      if (await fs.pathExists(mappingFile)) {
        await fs.copy(mappingFile, path.join(backupDir, backupName));
      }
    } catch (bkErr) {
      console.warn(
        "[sync][incremental] não foi possível criar backup mapping legado",
        bkErr
      );
    }

    await fs.writeJson(mappingFile, data, { spaces: 2 });
  } catch (err) {
    console.warn("[sync][incremental] erro ao atualizar mapping legado", err);
  }
}

// Remove entradas do mapping cujos arquivos não existem mais localmente (exclusão manual da pasta / limpeza fora do VS Code)
async function pruneMissingLocalEntries(projectPath: string) {
  try {
    const all = localFilesMappingManager.getAllFiles();
    const toRemove: string[] = [];
    for (const f of all) {
      if (f.localPath.startsWith(projectPath + path.sep)) {
        try {
          if (!(await fs.pathExists(f.localPath))) {
            toRemove.push(f.localPath);
          }
        } catch {
          toRemove.push(f.localPath);
        }
      }
    }
    for (const p of toRemove) {
      await localFilesMappingManager.removeFile(p);
    }
    if (toRemove.length) {
      console.log(
        "[sync][baseline] Entradas órfãs removidas:",
        toRemove.length
      );
    }
  } catch (err) {
    console.warn("[sync][baseline] Falha pruneMissingLocalEntries", err);
  }
}

// Recria baseline para todos os arquivos existentes no projeto recém baixado
async function rebuildProjectBaseline(projectPath: string, remoteRoot: string) {
  try {
    const exists = await fs.pathExists(projectPath);
    if (!exists) return;
    const normRoot = normalizeRemote(remoteRoot);

    async function walk(dir: string): Promise<string[]> {
      const out: string[] = [];
      const entries = await fs.readdir(dir);
      for (const e of entries) {
        if (e === ".miisync") continue; // ignora metadados
        const full = path.join(dir, e);
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          out.push(...(await walk(full)));
        } else if (stat.isFile()) {
          out.push(full);
        }
      }
      return out;
    }

    const files = await walk(projectPath);
    for (const localAbs of files) {
      // detectar remote path relativo
      const rel = path
        .relative(projectPath, localAbs)
        .split(path.sep)
        .join("/");
      const remotePathFull = rel ? normRoot + "/" + rel : normRoot;
      // hash
      let contentHash: string | undefined;
      try {
        const buf = await fs.readFile(localAbs);
        contentHash = crypto.createHash("md5").update(buf).digest("hex");
      } catch {}
      await localFilesMappingManager.addOrUpdateFile(
        localAbs,
        remotePathFull,
        false,
        "unchanged"
      );
      const entry = localFilesMappingManager.getFile(localAbs);
      if (entry) {
        entry.hasLocalChanges = false;
        entry.status = "unchanged";
        if (contentHash) entry.originalHash = contentHash;
      }
    }
    console.log(
      "[sync][baseline] Baseline reconstruída para",
      files.length,
      "arquivos."
    );
  } catch (err) {
    console.warn("[sync][baseline] Falha rebuildProjectBaseline", err);
  }
}
