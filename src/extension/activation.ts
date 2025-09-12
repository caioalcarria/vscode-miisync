import * as vscode from "vscode";
import { OnCommandCreateConfig } from "../commands/commandconfig";
import { OnCommandCopyServerPath } from "../commands/commandcopyserverpath";
import { OnCommandDeleteBroad } from "../commands/commanddeletebroad";
import { OnCommandDeleteProject } from "../commands/commanddeleteproject";
import { OnCommandDeleteWorkspace } from "../commands/commanddeleteworkspace";
import { OnCommandDownloadBroad } from "../commands/commanddownloadbroad";
import {
  OnCommandDownloadRemoteDirectory,
  OnCommandDownloadRemoteFile,
  OnCommandDownloadRemoteFolder,
  OnCommandDownloadRemoteFolderAsProject,
  OnCommandDownloadRemoteFolderWithOptionsWrapper,
  OnCommandVerifyRemoteFolderIntegrityWrapper,
} from "../commands/commanddownloaddirectory";
import { OnCommandDownloadFileProperties } from "../commands/commanddownloadfile";
import { OnCommandDownloadProject } from "../commands/commanddownloadproject";
import { OnCommandDownloadTransactionProperties } from "../commands/commanddownloadtransaction";
import { OnCommandDownloadWorkspace } from "../commands/commanddownloadworkspace";
import { OnCommandUploadGitChanges } from "../commands/commandgitchanges";
import { OnCommandOpenRootConfig } from "../commands/commandopenrootconfig";
import { OnCommandOpenScreen } from "../commands/commandopenscreen";
import { OnCommandOpenProject } from "../commands/commandprojects";
import { OnCommandRefreshLocalProjects } from "../commands/commandrefreshlocalprojects";
import { OnCommandSearchByServerPath } from "../commands/commandsearchbyserverpath";
import { OnCommandSearchInProject } from "../commands/commandsearchinproject";
import {
  OnCommandLogin,
  OnCommandLogout,
  OnCommandSwitchSystem,
} from "../commands/commandsession";
import { OnCommandShowFileDiff } from "../commands/commandshowfilediff";
import { OnCommandShowServerDifferences } from "../commands/commandshowserverdifferences";
import { OnCommandSyncProject } from "../commands/commandsyncproject";
import {
  OnCommandDisableDownloadOnOpen,
  OnCommandDisableSyncSave,
  OnCommandEnableDownloadOnOpen,
  OnCommandEnableSyncSave,
} from "../commands/commandtogglesync";
import { OnCommandTransferBroad } from "../commands/commandtransferbroad";
import { OnCommandTransferWorkspace } from "../commands/commandtransferworkspace";
import { OnCommandUploadBroad } from "../commands/commanduploadbroad";
import { OnCommandUploadModifiedFile } from "../commands/commanduploadmodifiedfile";
import { commandUploadWithBkp } from "../commands/commanduploadwithbkp";
import { OnCommandUploadWithPath } from "../commands/commanduploadwithpath";
import { OnCommandUploadWorkspace } from "../commands/commanduploadworkspace";
import { OnCommandVerifyServer } from "../commands/commandverifyserver";
import { OnDidChangeActiveTextEditor } from "../events/changeactivettexteditor";
import { onDidChangeConfiguration } from "../events/changeconfiguration";
import { OnDidOpenTextDocument } from "../events/opentextdocument";
import { OnDidSaveTextDocument } from "../events/savetextdocument";
import { fileStatusDecorationProvider } from "../ui/decorations/filestatusdecorations";
import { projectFolderDecorationProvider } from "../ui/decorations/projectfolderdecorations";
import { remoteDirectoryDecorationProvider } from "../ui/decorations/remotedirectorydecorations";
import { localProjectsTree } from "../ui/treeview/localprojectstree";
import { projectsTree } from "../ui/treeview/projectsTree";
import { remoteDirectoryTree } from "../ui/treeview/remotedirectorytree";
import transactionPropertiesVirtualDoc from "../ui/virtualdocument/transactionproperties";
import { MiiSyncConfigWebViewProvider } from "../ui/webview/miisyncConfigWebViewProvider";

export function RegisterEvents({ subscriptions }: vscode.ExtensionContext) {
  subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(OnDidSaveTextDocument)
  );
  subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(OnDidOpenTextDocument)
  );
  subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(OnDidChangeActiveTextEditor)
  );
  subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration)
  );
}

export function RegisterCommands(context: vscode.ExtensionContext) {
  //Extension Commands
  RegisterCommand("miisync.createconfig", OnCommandCreateConfig, context);
  RegisterCommand(
    "miisync.disableuploadonsave",
    OnCommandDisableSyncSave,
    context
  );
  RegisterCommand(
    "miisync.enableuploadonsave",
    OnCommandEnableSyncSave,
    context
  );
  RegisterCommand("miisync.login", OnCommandLogin, context);
  RegisterCommand("miisync.logout", OnCommandLogout, context);
  RegisterCommand("miisync.switchsystem", OnCommandSwitchSystem, context);
  RegisterCommand(
    "miisync.disabledownloadonopen",
    OnCommandDisableDownloadOnOpen,
    context
  );
  RegisterCommand(
    "miisync.enabledownloadonopen",
    OnCommandEnableDownloadOnOpen,
    context
  );
  RegisterCommand("miisync.openrootconfig", OnCommandOpenRootConfig, context);

  RegisterCommand("miisync.downloadproject", OnCommandDownloadProject, context);
  RegisterCommand(
    "miisync.downloadremotefolder",
    OnCommandDownloadRemoteFolder,
    context
  );
  RegisterCommand(
    "miisync.downloadremotefolderasproject",
    OnCommandDownloadRemoteFolderAsProject,
    context
  );
  RegisterCommand(
    "miisync.verifyremotefolderintegrity",
    OnCommandVerifyRemoteFolderIntegrityWrapper,
    context
  );
  RegisterCommand(
    "miisync.downloadremotefolderwithoptions",
    OnCommandDownloadRemoteFolderWithOptionsWrapper,
    context
  );
  RegisterCommand(
    "miisync.downloadremotefile",
    OnCommandDownloadRemoteFile,
    context
  );
  RegisterCommand(
    "miisync.downloadremotedirectory",
    OnCommandDownloadRemoteDirectory,
    context
  );
  RegisterCommand(
    "miisync.downloadfileproperties",
    OnCommandDownloadFileProperties,
    context
  );
  RegisterCommand(
    "miisync.uploadgitchanges",
    OnCommandUploadGitChanges,
    context
  );
  RegisterCommand(
    "miisync.downloadtransactionproperties",
    OnCommandDownloadTransactionProperties,
    context
  );
  RegisterCommand("miisync.openscreen", OnCommandOpenScreen, context);

  //Actions
  RegisterCommand("miisync.uploadbroad", OnCommandUploadBroad, context);
  RegisterCommand("miisync.uploadwithpath", OnCommandUploadWithPath, context);
  RegisterCommand("miisync.uploadwithbkp", commandUploadWithBkp, context);
  RegisterCommand("miisync.copyserverpath", OnCommandCopyServerPath, context);
  RegisterCommand("miisync.downloadbroad", OnCommandDownloadBroad, context);
  RegisterCommand("miisync.transferbroad", OnCommandTransferBroad, context);
  RegisterCommand("miisync.deletebroad", OnCommandDeleteBroad, context);

  RegisterCommand("miisync.uploadworkspace", OnCommandUploadWorkspace, context);
  RegisterCommand(
    "miisync.downloadworkspace",
    OnCommandDownloadWorkspace,
    context
  );
  RegisterCommand(
    "miisync.transferworkspace",
    OnCommandTransferWorkspace,
    context
  );
  RegisterCommand("miisync.deleteworkspace", OnCommandDeleteWorkspace, context);

  // Local Projects Commands
  RegisterCommand(
    "miisync.refreshlocalprojects",
    OnCommandRefreshLocalProjects,
    context
  );
  RegisterCommand(
    "miisync.uploadmodifiedfile",
    OnCommandUploadModifiedFile,
    context
  );
  RegisterCommand("miisync.showfilediff", OnCommandShowFileDiff, context);
  RegisterCommand("miisync.verifyserver", OnCommandVerifyServer, context);
  RegisterCommand(
    "miisync.showserverdifferences",
    OnCommandShowServerDifferences,
    context
  );
  RegisterCommand("miisync.searchinproject", OnCommandSearchInProject, context);

  // Projects Commands
  RegisterCommand("miisync.openproject", OnCommandOpenProject, context);
  RegisterCommand(
    "miisync.refreshprojects",
    () => {
      projectsTree.refresh();
    },
    context
  );
  RegisterCommand(
    "miisync.searchbyserverpath",
    OnCommandSearchByServerPath,
    context
  );
  RegisterCommand("miisync.deleteproject", OnCommandDeleteProject, context);
  RegisterCommand("miisync.syncproject", OnCommandSyncProject, context);
}

// Variável global para o provider de configurações
let configWebViewProvider: MiiSyncConfigWebViewProvider;

export function activateTree(context: vscode.ExtensionContext) {
  // Registra os tree data providers
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "remotedirectory",
      remoteDirectoryTree
    )
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("projects", projectsTree)
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("localprojects", localProjectsTree)
  );

  // Registra o WebView provider para configurações
  configWebViewProvider = new MiiSyncConfigWebViewProvider(
    context.extensionUri
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "miisyncconfig-settings",
      configWebViewProvider
    )
  );

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "transactionproperties",
      transactionPropertiesVirtualDoc
    )
  );
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(
      remoteDirectoryDecorationProvider
    )
  );
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(
      projectFolderDecorationProvider
    )
  );
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileStatusDecorationProvider)
  );

  // Cria a TreeView para Local Projects e configura o badge
  const localProjectsTreeView = vscode.window.createTreeView("localprojects", {
    treeDataProvider: localProjectsTree,
    showCollapseAll: true,
  });
  context.subscriptions.push(localProjectsTreeView);

  // Configura o sistema de badge para mostrar total de mudanças
  const updateBadge = () => {
    const projects = localProjectsTree.getProjects();
    const totalModifiedFiles = projects.reduce(
      (total, project) => total + project.modifiedFiles.length,
      0
    );

    if (totalModifiedFiles > 0) {
      localProjectsTreeView.badge = {
        value: totalModifiedFiles,
        tooltip: `${totalModifiedFiles} arquivo(s) modificado(s)`,
      };
    } else {
      localProjectsTreeView.badge = undefined;
    }
  };

  // Atualiza o badge sempre que a tree de projetos locais muda
  localProjectsTree.onDidChangeTreeData(() => {
    updateBadge();
  });

  // Atualização inicial do badge
  updateBadge();
}

function RegisterCommand(
  command: string,
  callback: (...args: any[]) => any,
  { subscriptions }: vscode.ExtensionContext
) {
  subscriptions.push(vscode.commands.registerCommand(command, callback));
}
