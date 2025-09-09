import { mkdir, outputFile } from "fs-extra";
import * as path from "path";
import { System, UserConfig } from "../../extension/system";
import { IsFatalResponse } from "../../miiservice/abstract/filters";
import { File, Folder } from "../../miiservice/abstract/responsetypes";
import { listFilesService } from "../../miiservice/listfilesservice";
import { listFoldersService } from "../../miiservice/listfoldersservice";
import { readFileService } from "../../miiservice/readfileservice";
import { GetRemotePath } from "../../modules/file";
import { PathMappingManager } from "../../modules/pathmapping";
import { ComplexFolder } from "../../types/miisync";
import logger from "../../ui/logger";
import { DoesFolderExist } from "../gate";
import limitManager, { LimitedReturn } from "./limited";

/**
 * @description if the folder has empty files and folders properties, it means download everything inside rather than download the folder only
 */
export async function DownloadComplexLimited(
  folder: ComplexFolder,
  getPath: (item: File | Folder) => string,
  userConfig: UserConfig,
  system: System
): Promise<LimitedReturn<null>> {
  if (limitManager.IsActive) {
    logger.error("There is an already existing transfer ongoing.");
    return {
      aborted: true,
    };
  }

  let aborted = false;

  const remotePathRoot = folder.isRemotePath
    ? folder.path
    : GetRemotePath(folder.path, userConfig);
  const folderExists = await DoesFolderExist(remotePathRoot, system);
  if (!folderExists) {
    logger.error("Folder doesn't exist.");
    return { aborted: true };
  }

  let fileCount = 0;
  let promises: Promise<any>[] = [];

  // Estrutura para coletar mapeamentos de caminhos
  const pathMappings: { localPath: string; remotePath: string }[] = [];
  let rootLocalPath: string | null = null;
  let rootRemotePath: string | null = null;

  try {
    limitManager.startProgress();
    limitManager.createWindow("Preparing Download", () => (aborted = true));

    await getChildren(folder);
    do {
      await Promise.all(promises);
    } while (limitManager.OngoingCount != 0);

    if (aborted) {
      limitManager.endProgress();
      return { aborted };
    }
    limitManager.createWindow("Downloading", () => (aborted = true));
    limitManager.MaxQueue = 0;
    limitManager.Finished = 0;
    promises = [];

    await downloadFiles(folder);
    do {
      await Promise.all(promises);
    } while (limitManager.OngoingCount != 0);

    // Cria o arquivo de mapeamento se é um download de diretório remoto e há mapeamentos coletados
    if (
      folder.isRemotePath &&
      rootLocalPath &&
      rootRemotePath &&
      pathMappings.length > 0
    ) {
      try {
        // Cria mapeamentos com hash do conteúdo
        const mappingsWithHash = await Promise.all(
          pathMappings.map(async (m: any) => {
            let contentHash: string | undefined;
            
            // Se temos o conteúdo, cria backup e calcula hash
            if (m.fileContent) {
              try {
                await PathMappingManager.createFileBackup(rootLocalPath, m.localPath, m.fileContent);
                contentHash = PathMappingManager.calculateContentHash(m.fileContent);
              } catch (error) {
                console.error('❌ Erro ao processar arquivo para mapeamento:', error);
              }
            }

            return {
              localPath: m.localPath,
              remotePath: m.remotePath,
              lastUpdated: Date.now(),
              contentHash
            };
          })
        );

        await PathMappingManager.createMappingFile(
          rootLocalPath,
          rootRemotePath,
          mappingsWithHash
        );
        
        logger.info(
          `Arquivo de mapeamento criado em: ${rootLocalPath}/.miisync/path-mapping.json`
        );
      } catch (error) {
        logger.error(`Erro ao criar arquivo de mapeamento: ${error}`);
      }
    }

    limitManager.endProgress();

    return { aborted };
  } catch (error: any) {
    limitManager.endProgress();
    throw Error(error);
  }

  async function getChildren(mainFolder: ComplexFolder) {
    if (aborted) return;
    if (!mainFolder.folder) {
      const sourcePath = mainFolder.isRemotePath
        ? mainFolder.path
        : GetRemotePath(mainFolder.path, userConfig);
      const parentPath =
        path.dirname(sourcePath) == "." ? "" : path.dirname(sourcePath);
      const parentFolder = await listFoldersService.call(system, parentPath);
      if (!parentFolder || IsFatalResponse(parentFolder)) return;
      const folder = parentFolder?.Rowsets?.Rowset?.Row?.find(
        (folder: Folder) => folder.Path == sourcePath
      );
      mainFolder.folder = folder;
    }
    if (mainFolder.files.length == 0 && mainFolder.folders.length == 0) {
      if (mainFolder.folder.ChildFileCount != 0) {
        fileCount += mainFolder.folder.ChildFileCount;
        const filePromise = limitManager.newRemote(async () => {
          if (aborted) return;
          const files = await listFilesService.call(
            system,
            mainFolder.folder.Path
          );
          if (aborted) return;
          if (!files || IsFatalResponse(files)) return;
          mainFolder.files =
            files?.Rowsets?.Rowset?.Row?.map((cFile) => {
              return { file: cFile, path: null };
            }) || [];
        });
        promises.push(filePromise);
      }
      if (mainFolder.folder.ChildFolderCount != 0) {
        const folderPromise = limitManager.newRemote(async () => {
          if (aborted) return;
          const folders = await listFoldersService.call(
            system,
            mainFolder.folder.Path
          );
          if (aborted) return;
          if (!folders || IsFatalResponse(folders)) return;
          mainFolder.folders =
            folders?.Rowsets?.Rowset?.Row?.filter(
              (cFolder) => cFolder.IsWebDir
            ).map((cFolder) => {
              return { folder: cFolder, path: null, files: [], folders: [] };
            }) || [];

          for (const folder of mainFolder.folders) {
            promises.push(limitManager.newRemote(() => getChildren(folder)));
          }
        });
        promises.push(folderPromise);
      }
    } else {
      fileCount += mainFolder.files.length;
      for (const folder of mainFolder.folders) {
        promises.push(limitManager.newRemote(() => getChildren(folder)));
      }
    }
  }

  async function downloadFiles(mainFolder: ComplexFolder) {
    if (aborted) return;
    if (
      mainFolder.folder.ChildFileCount == 0 &&
      mainFolder.folder.ChildFolderCount == 0
    ) {
      const folderPath =
        !mainFolder.isRemotePath && mainFolder.path
          ? mainFolder.path
          : getPath(mainFolder.folder);
      mkdir(folderPath, { recursive: true });

      // Coleta mapeamento para pastas vazias em download de diretório remoto
      if (folder.isRemotePath && mainFolder.folder) {
        if (!rootLocalPath) {
          rootLocalPath = path.dirname(folderPath);
          while (await PathMappingManager.hasMappingFile(rootLocalPath)) {
            const parent = path.dirname(rootLocalPath);
            if (parent === rootLocalPath) break;
            rootLocalPath = parent;
          }
          rootRemotePath = remotePathRoot;
        }

        const relativePath = path.relative(rootLocalPath, folderPath);
        if (relativePath && !relativePath.startsWith("..")) {
          pathMappings.push({
            localPath: relativePath,
            remotePath: mainFolder.folder.Path,
          });
        }
      }
      return;
    }

    for (const file of mainFolder.files) {
      promises.push(
        limitManager.newRemote(() => {
          if (aborted) return;
          return downloadFile(file);
        })
      );
    }
    for (const folder of mainFolder.folders) {
      downloadFiles(folder);
    }
  }

  async function downloadFile({
    file,
    path: filePath,
  }: {
    path: string;
    file?: File;
  }) {
    const localFilePath = filePath || getPath(file);
    const remotePath = file
      ? file.FilePath + "/" + file.ObjectName
      : GetRemotePath(filePath, userConfig);

    // Coleta mapeamento para download de diretório remoto
    if (folder.isRemotePath && file) {
      // Define o caminho raiz na primeira vez
      if (!rootLocalPath) {
        rootLocalPath = path.dirname(localFilePath);
        // Busca pelo diretório pai até encontrar o diretório onde não há mapeamento
        while (await PathMappingManager.hasMappingFile(rootLocalPath)) {
          const parent = path.dirname(rootLocalPath);
          if (parent === rootLocalPath) break;
          rootLocalPath = parent;
        }
        rootRemotePath = remotePathRoot;
      }

      // Adiciona mapeamento para este arquivo
      const relativePath = path.relative(rootLocalPath, localFilePath);
      if (relativePath && !relativePath.startsWith("..")) {
        pathMappings.push({
          localPath: relativePath,
          remotePath: remotePath,
        });
      }
    }

    const response = await readFileService.call(system, remotePath);
    if (aborted) return;
    if (response && !IsFatalResponse(response)) {
      const payload = response?.Rowsets?.Rowset?.Row.find(
        (row) => row.Name == "Payload"
      );
      if (payload) {
        const fileContent = Buffer.from(payload.Value, "base64").toString('utf8');
        
        // Salva o arquivo como UTF-8 para manter consistência
        outputFile(localFilePath, fileContent, {
          encoding: "utf8",
        }).catch((error) => logger.error(error));

        // Se estamos coletando mapeamentos, atualiza o mapeamento com o conteúdo
        if (folder.isRemotePath && file && rootLocalPath) {
          const relativePath = path.relative(rootLocalPath, localFilePath);
          if (relativePath && !relativePath.startsWith("..")) {
            // Encontra o mapeamento correspondente e adiciona hash
            const mappingIndex = pathMappings.findIndex(m => m.localPath === relativePath);
            if (mappingIndex !== -1) {
              // Adiciona o conteúdo para gerar hash depois
              (pathMappings[mappingIndex] as any).fileContent = fileContent;
            }
          }
        }
      }
    }
    return;
  }
}
