
import { configManager } from "../modules/config.js";
import { DownloadContextDirectory, DownloadRemoteFile, DownloadRemoteFolder, DownloadRemoteFolderAsProject } from "../transfer/download.js";
import { TreeItem } from "../ui/treeview/tree.js";


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

    console.log(`📁 Baixando pasta remota como projeto: ${treeItem.data}`);
    DownloadRemoteFolderAsProject(treeItem.data, userConfig, configManager.CurrentSystem);
}

