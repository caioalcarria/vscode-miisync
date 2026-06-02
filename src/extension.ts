import * as vscode from 'vscode';
import { OnDidChangeActiveTextEditor } from './events/changeactivettexteditor';
import { RegisterCommands, RegisterEvents, activateTree } from './extension/activation';
import { configManager } from './modules/config';
import { GetActiveTextEditor, SetContextValue } from './modules/vscode';
import { writeMcpClientConfigs } from './mcp/mcpWriter';
import { activateBar } from './ui/statusbar';
import { Session } from './user/session';
import { InitiliazeMainUserManager } from './user/usermanager';


export function activate(context: vscode.ExtensionContext) {
	activateBar(context);
	activateTree(context);
	RegisterCommands(context);
	RegisterEvents(context);

	SetContextValue("enabled", true);
	Session.Context = context;
	InitiliazeMainUserManager(context);

	const applyMcpConfig = (config: import('./extension/system').UserConfig) => {
		if (config?.mcp?.enabled) {
			const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (workspacePath) {
				writeMcpClientConfigs(workspacePath, config.mcp.clients || {}, context.extensionPath, config.mcp);
			}
		}
	};

	configManager.load().then(config => { if (config) applyMcpConfig(config); });
	configManager.onConfigChange.event(applyMcpConfig);

	Session.onLogStateChange.event((session) => {
		if (session.system.isMain && session.IsLoggedin)
			OnDidChangeActiveTextEditor(GetActiveTextEditor());
	})
	configManager.onSystemsChange.event(() => {
		OnDidChangeActiveTextEditor(GetActiveTextEditor());
	})
}


export function deactivate() {
	SetContextValue("enabled", false);
}

