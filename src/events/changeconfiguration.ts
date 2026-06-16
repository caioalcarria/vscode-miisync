import * as vscode from "vscode";
import { settingsManager } from "../extension/settings";
import { configManager } from "../modules/config";
import { EXTENSION_SETTINGS } from "../constants";

const SENSITIVE_KEY = `${EXTENSION_SETTINGS}.allowSensitiveOperations`;

export function onDidChangeConfiguration(configEvent: vscode.ConfigurationChangeEvent) {
    if (configEvent.affectsConfiguration(SENSITIVE_KEY)) {
        handleSensitiveOperationsChange();
        return;
    }
    settingsManager.updateSettings(configEvent);
}

async function handleSensitiveOperationsChange() {
    const newValue = vscode.workspace
        .getConfiguration(EXTENSION_SETTINGS)
        .get<boolean>('allowSensitiveOperations', false);

    if (newValue) {
        const config = configManager.Config;
        const system = config?.systems?.find(s => s.isMain) ?? config?.systems?.[0];
        const severity = system?.severity ?? '1-medium';

        const severityLabels: Record<string, string> = {
            '0-low': 'baixo',
            '1-medium': 'médio',
            '2-high': '⚠️ alto',
            '3-critical': '🚨 crítico',
        };
        const severityLabel = severityLabels[severity] ?? severity;

        const confirm = await vscode.window.showWarningMessage(
            `Permitir operações sensíveis no MCP?`,
            {
                modal: true,
                detail:
                    `O agente de IA poderá CRIAR, EDITAR e APAGAR arquivos no servidor MII,` +
                    ` além de executar SQL de escrita (INSERT/UPDATE/DELETE/DDL).\n\n` +
                    `Sistema ativo: ${system?.name ?? 'desconhecido'} — severidade ${severityLabel}.\n\n` +
                    `Esta configuração é salva no miisync.json do projeto.`,
            },
            'Entendo, habilitar',
            'Cancelar',
        );

        if (confirm !== 'Entendo, habilitar') {
            // Revert the VS Code setting without triggering this handler again
            await vscode.workspace
                .getConfiguration(EXTENSION_SETTINGS)
                .update('allowSensitiveOperations', false, vscode.ConfigurationTarget.Workspace);
            return;
        }
    }

    // Persist to miisync.json so the MCP server process picks it up via fs.watch
    const config = configManager.Config;
    if (config) {
        config.mcp = config.mcp ?? {};
        config.mcp.policy = config.mcp.policy ?? {};
        config.mcp.policy.allowSensitiveOperations = newValue;
        await configManager.update(config);
    }

    settingsManager.updateSettings({ affectsConfiguration: () => true } as any);
}
