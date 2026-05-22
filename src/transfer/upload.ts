import { pathExists, readFile } from "fs-extra";
import * as path from "path";
import { Uri } from "vscode";
import { System, UserConfig } from "../extension/system";
import { saveMesFileService } from "../miiservice/mesfileservice";
import { saveFileService } from "../miiservice/savefileservice";
import {
  GetRemotePathWithMapping,
  PrepareUrisForService,
} from "../modules/file";
import { askGitUploadChoice, gitManager } from "../modules/gitmanager";
import { localFilesMappingManager } from "../modules/localfilesmapping";
import { PathMappingManager } from "../modules/pathmapping";
import {
  CheckSeverity,
  CheckSeverityFile,
  CheckSeverityFolder,
  SeverityOperation,
} from "../modules/severity";
import { localProjectsTree } from "../ui/treeview/localprojectstree";
import { ActionReturn, ActionType, StartAction } from "./action";
import { Validate } from "./gate";
import { UploadComplexLimited } from "./limited/uploadcomplex";

/**
 * Atualiza o path-mapping.json quando um novo arquivo é adicionado com sucesso
 */
async function updatePathMappingForNewFile(
  localFilePath: string,
  remotePath: string,
  fileContent?: string
): Promise<void> {
  try {
    // Busca por um arquivo de mapeamento na hierarquia de diretórios
    const mappingInfo = await PathMappingManager.findMappingConfig(
      localFilePath
    );

    if (mappingInfo) {
      const { rootPath } = mappingInfo;

      // Calcula o caminho relativo do novo arquivo em relação ao diretório raiz mapeado
      const relativePath = path.relative(rootPath, localFilePath);

      // Lê o conteúdo do arquivo se não foi fornecido
      let content = fileContent;
      if (!content && (await pathExists(localFilePath))) {
        content = await readFile(localFilePath, "utf8");
      }

      await PathMappingManager.addMapping(rootPath, relativePath, remotePath, content);
    }
  } catch (error) {
    console.error("❌ Erro ao atualizar path-mapping:", error);
  }
}


async function handleGitCommitOnUpload(
  localFilePath: string,
  serverName: string
): Promise<void> {
  if (!(await gitManager.isInstalled())) return;

  // Walk up to find the git repo root, falling back to the .miisync project root
  let projectPath = path.dirname(localFilePath);
  let hasGit = false;
  let miisyncRoot: string | null = null;
  while (projectPath && projectPath !== path.dirname(projectPath)) {
    if (await gitManager.isGitRepo(projectPath)) { hasGit = true; break; }
    if (!miisyncRoot && await pathExists(path.join(projectPath, '.miisync', 'path-mapping.json')))
      miisyncRoot = projectPath;
    projectPath = path.dirname(projectPath);
  }
  if (!hasGit && miisyncRoot) projectPath = miisyncRoot;

  const doCommit = await askGitUploadChoice(path.basename(localFilePath));
  if (!doCommit) return;

  if (!hasGit) await gitManager.initRepo(projectPath);
  await gitManager.commitFile(projectPath, localFilePath, serverName);
}

export async function UploadFile(
  uri: Uri,
  userConfig: UserConfig,
  system: System,
  content?: string
) {
  if (!(await Validate(userConfig, { system, localPath: uri.fsPath }))) {
    return false;
  }
  const fileName = path.basename(uri.fsPath);
  const upload = async () => {
    if (!content) {
      const exists = await pathExists(uri.fsPath);
      if (!exists) {
        return {
          aborted: true,
          error: true,
          message: fileName + " doesn't exist",
        };
      }
      content = (await readFile(uri.fsPath)).toString();
    }
    if (
      !(await CheckSeverityFile(
        uri,
        SeverityOperation.upload,
        userConfig,
        system
      ))
    )
      return { aborted: true };

    const sourcePath = await GetRemotePathWithMapping(uri.fsPath, userConfig);

    // Catalog files (no /WEB/ in path) use saveMesFileService (Mode=Save, no Class=Content).
    // Web content files use saveFileService (Mode=SaveBinary&Class=Content).
    const isCatalogFile = !sourcePath.includes('/WEB/');

    if (isCatalogFile) {
      const ok = await saveMesFileService.call(system, sourcePath, content || " ");
      if (!ok) {
        return { aborted: true, error: true, message: `Upload to catalog failed: ${sourcePath}` };
      }
    } else {
      const base64Content = encodeURIComponent(
        Buffer.from(content || " ").toString("base64")
      );
      const response = await saveFileService.call(
        { ...system, body: "Content=" + base64Content },
        sourcePath
      );
      if (response == null) {
        return { aborted: true };
      }
    }

    // Atualiza o mapeamento e reseta estado de modificação
    try {
      await updatePathMappingForNewFile(uri.fsPath, sourcePath, content);
      try {
        const mapped = localFilesMappingManager.getFile(uri.fsPath);
        if (mapped) {
          const newHash = Buffer.from(content).length
            ? require("crypto").createHash("md5").update(content).digest("hex")
            : mapped.originalHash;
          mapped.originalHash = newHash;
          mapped.hasLocalChanges = false;
          mapped.status = "unchanged";
          mapped.serverModified = new Date();
          await localFilesMappingManager.addOrUpdateFile(
            uri.fsPath,
            mapped.remotePath || sourcePath,
            false,
            "unchanged"
          );
        }
      } catch (e) {
        console.warn("⚠️ Falha ao resetar estado no mapping pós-upload:", e);
      }
      localProjectsTree.refresh();
    } catch (error) {
      console.error("Erro ao atualizar mapeamento:", error);
    }

    // Git commit pós-upload (respeitando configuração gitCommitOnUpload)
    await handleGitCommitOnUpload(uri.fsPath, system.name);

    return { aborted: false };
  };
  StartAction(
    ActionType.upload,
    { name: "Upload File", resource: fileName, system },
    { isSimple: true },
    upload
  );
}

/**
 * Uses Limited
 */
export async function UploadFolder(
  folderUri: Uri,
  userConfig: UserConfig,
  system: System
) {
  const folderPath = folderUri.fsPath;
  const folderName = path.basename(folderPath);
  if (!(await Validate(userConfig, { system, localPath: folderPath }))) {
    return null;
  }
  const upload = async () => {
    if (
      !(await CheckSeverityFolder(
        folderUri,
        SeverityOperation.upload,
        userConfig,
        system
      ))
    )
      return { aborted: true };

    const response = await UploadComplexLimited(
      { path: folderPath, files: [], folders: [] },
      userConfig,
      system
    );
    return { aborted: response.aborted };
  };
  StartAction(
    ActionType.upload,
    { name: "Upload Folder", resource: folderName, system },
    { isSimple: false },
    upload
  );
}

/**
 * Uses Limited
 */
export async function UploadUris(
  uris: Uri[],
  userConfig: UserConfig,
  system: System,
  processName: string
) {
  const upload = async (): Promise<ActionReturn> => {
    const folder = await PrepareUrisForService(uris);

    if (
      !(await CheckSeverity(
        folder,
        SeverityOperation.upload,
        userConfig,
        system
      ))
    )
      return { aborted: true };

    const response = await UploadComplexLimited(folder, userConfig, system);
    return { aborted: response.aborted };
  };

  StartAction(
    ActionType.upload,
    { name: processName, system },
    { isSimple: false },
    upload
  );
}
