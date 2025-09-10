
import { configManager } from "../modules/config.js";
import { DownloadContextDirectory, DownloadRemoteFile, DownloadRemoteFolder, DownloadRemoteFolderAsProject } from "../transfer/download.js";
import { TreeItem } from "../ui/treeview/tree.js";
import { OnCommandVerifyRemoteFolderIntegrity } from "./commandverifyremotefolderintegrity.js";
import { OnCommandDownloadRemoteFolderWithOptions } from "./commanddownloadremotefolderwithoptions.js";
import { localProjectsTree } from "../ui/treeview/localprojectstree.js";
import * as path from 'path';


export async function OnCommandDownloadRemoteDirectory() {
    const userConfig = await configManager.load();
    if (!userConfig) return;
    DownloadContextDirectory(userConfig, configManager.CurrentSystem);
}

export async function OnCommandDownloadRemoteFolder(treeItem: TreeItem) {
    const userConfig = await configManager.load();
    if (!userConfig) return;

    DownloadRemoteFolder(treeItem.data, userConfig, configManager.CurrentSystem);
}

export async function OnCommandDownloadRemoteFile(treeItem: TreeItem) {
    const userConfig = await configManager.load();
    if (!userConfig) return;

    DownloadRemoteFile(treeItem.data, userConfig, configManager.CurrentSystem);
}

/**
 * 🚀 NOVO: Comando para baixar pasta remota diretamente como projeto
 */
export async function OnCommandDownloadRemoteFolderAsProject(treeItem: TreeItem) {
    const userConfig = await configManager.load();
    if (!userConfig) return;

    const remotePath = treeItem.data;
    const folderName = path.basename(remotePath);
    
    console.log(`📁 Baixando pasta remota como projeto: ${remotePath}`);
    
    // Verifica se a pasta já está carregada localmente
    const projects = localProjectsTree.getProjects();
    const matchingProjects = projects.filter(project => 
        project.remotePath === remotePath || 
        project.remotePath === remotePath + '/' ||
        project.remotePath + '/' === remotePath
    );

    if (matchingProjects.length > 0) {
        // Pasta já carregada - usa comando com opções
        await OnCommandDownloadRemoteFolderWithOptions(remotePath, folderName);
    } else {
        // Pasta não carregada - download direto
        await DownloadRemoteFolderAsProject(remotePath, userConfig, configManager.CurrentSystem);
    }
}

/**
 * 🔍 NOVO: Comando para verificar integridade de pasta remota
 */
export async function OnCommandVerifyRemoteFolderIntegrityWrapper(treeItem: TreeItem) {
    await OnCommandVerifyRemoteFolderIntegrity(treeItem.data);
}

/**
 * ⚙️ NOVO: Comando para download com opções
 */
export async function OnCommandDownloadRemoteFolderWithOptionsWrapper(treeItem: TreeItem) {
    const remotePath = treeItem.data;
    const folderName = path.basename(remotePath);
    await OnCommandDownloadRemoteFolderWithOptions(remotePath, folderName);
}

