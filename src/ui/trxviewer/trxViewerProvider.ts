import * as vscode from 'vscode';
import { CatalogCategory } from '../../modules/actioncatalog';
import { actionCatalog } from '../../modules/actioncatalog';
import { configManager } from '../../modules/config';
import { illuminatorService } from '../../miiservice/illuminatorService';
import { runnerService } from '../../miiservice/runnerService';
import { parseTrx, TrxData, addSequenceToRawTrx, addActionToRawTrx, deleteActionFromRawTrx, deleteSequenceFromRawTrx, editLinksInRawTrx, editActionPropsInRawTrx, renameStepInRawTrx, TrxLink } from './trxParser';

// Track active panels for catalog updates
const activePanels = new Set<{ panel: vscode.WebviewPanel; uri: vscode.Uri }>();

export class TrxViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'miisync.trxViewer';

    public static register(_context: vscode.ExtensionContext): vscode.Disposable {
        const disposables: vscode.Disposable[] = [];

        disposables.push(
            vscode.window.registerCustomEditorProvider(
                TrxViewerProvider.viewType,
                new TrxViewerProvider(),
                {
                    webviewOptions: { retainContextWhenHidden: true },
                    supportsMultipleEditorsPerDocument: false,
                }
            )
        );

        // Broadcast catalog updates to all open TRX viewers
        disposables.push(
            actionCatalog.onDidUpdate((categories) => {
                for (const entry of activePanels) {
                    entry.panel.webview.postMessage({ type: 'catalogUpdate', categories });
                }
            })
        );

        return vscode.Disposable.from(...disposables);
    }

    async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        try {
            webviewPanel.webview.options = { enableScripts: true };

            const entry = { panel: webviewPanel, uri: document.uri };
            activePanels.add(entry);
            webviewPanel.onDidDispose(() => activePanels.delete(entry));

            // Message handling for edits
            webviewPanel.webview.onDidReceiveMessage(async (msg) => {
                try {
                    switch (msg.type) {
                        case 'addSequence':
                        case 'addAction':
                        case 'deleteAction':
                        case 'deleteSequence': {
                            const bytes = await vscode.workspace.fs.readFile(document.uri);
                            const xml = new TextDecoder('utf-8').decode(bytes);
                            let newXml: string | null = null;
                            if (msg.type === 'addSequence') newXml = addSequenceToRawTrx(xml, msg.path, msg.position);
                            else if (msg.type === 'addAction') newXml = addActionToRawTrx(xml, msg.path, msg.actionType, msg.actionLabel);
                            else if (msg.type === 'deleteAction') newXml = deleteActionFromRawTrx(xml, msg.path, msg.actionName);
                            else if (msg.type === 'deleteSequence') newXml = deleteSequenceFromRawTrx(xml, msg.path);
                            if (newXml && newXml !== xml) {
                                await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(newXml));
                                const data = parseTrx(newXml);
                                webviewPanel.webview.postMessage({ type: 'refresh', data });
                            }
                            break;
                        }
                        case 'runTransaction': {
                            const system = configManager.CurrentSystem;
                            if (!system) {
                                webviewPanel.webview.postMessage({ type: 'runResult', ok: false, error: 'Não conectado ao servidor MII' });
                                break;
                            }
                            const result = await runnerService.execute(system, msg.transactionPath, msg.params ?? {});
                            webviewPanel.webview.postMessage({ type: 'runResult', ok: result.success, outputs: result.outputs, error: result.error, rawXml: result.rawXml });
                            break;
                        }
                        case 'loadJCOConnections': {
                            const system = configManager.CurrentSystem;
                            if (!system) { webviewPanel.webview.postMessage({ type: 'jcoConnections', connections: [] }); break; }
                            const connections = await illuminatorService.getJCOConnections(system).catch(() => []);
                            webviewPanel.webview.postMessage({ type: 'jcoConnections', connections });
                            break;
                        }
                        case 'loadBLSCredentials': {
                            const system = configManager.CurrentSystem;
                            if (!system) { webviewPanel.webview.postMessage({ type: 'blsCredentials', credentials: [] }); break; }
                            const credentials = await illuminatorService.getBLSCredentials(system).catch(() => []);
                            webviewPanel.webview.postMessage({ type: 'blsCredentials', credentials });
                            break;
                        }
                        case 'editLinks': {
                            const bytes = await vscode.workspace.fs.readFile(document.uri);
                            const xml = new TextDecoder('utf-8').decode(bytes);
                            const newXml = editLinksInRawTrx(xml, msg.path, msg.actionName, msg.incoming as TrxLink[], msg.outgoing as TrxLink[]);
                            if (newXml !== xml) {
                                await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(newXml));
                                webviewPanel.webview.postMessage({ type: 'refresh', data: parseTrx(newXml) });
                            }
                            break;
                        }
                        case 'editActionProps': {
                            const bytes = await vscode.workspace.fs.readFile(document.uri);
                            const xml = new TextDecoder('utf-8').decode(bytes);
                            const newXml = editActionPropsInRawTrx(xml, msg.actionName, msg.props);
                            if (newXml !== xml) {
                                await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(newXml));
                                webviewPanel.webview.postMessage({ type: 'refresh', data: parseTrx(newXml) });
                            }
                            break;
                        }
                        case 'renameStep': {
                            const bytes = await vscode.workspace.fs.readFile(document.uri);
                            const xml = new TextDecoder('utf-8').decode(bytes);
                            const newXml = renameStepInRawTrx(xml, msg.path, msg.newName);
                            if (newXml !== xml) {
                                await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(newXml));
                                webviewPanel.webview.postMessage({ type: 'refresh', data: parseTrx(newXml) });
                            }
                            break;
                        }
                    }
                } catch (e: any) {
                    vscode.window.showErrorMessage('TRX edit failed: ' + e.message);
                }
            });

            // Try loading catalog if not loaded yet
            let categories = actionCatalog.getCategories();
            if (categories.length === 0) {
                const system = configManager.CurrentSystem;
                if (system) {
                    await actionCatalog.loadFromServer(system);
                    categories = actionCatalog.getCategories();
                }
            }

            // Initial render
            const bytes = await vscode.workspace.fs.readFile(document.uri);
            const xml = new TextDecoder('utf-8').decode(bytes);
            const data = parseTrx(xml);
            webviewPanel.webview.html = buildHtml(data, document.uri.fsPath, categories);
        } catch (e: any) {
            console.error('TrxViewer resolveCustomEditor error:', e);
            webviewPanel.webview.html = `<html><body style="padding:20px;color:#f88;font-family:monospace;background:#1e1e1e"><h3>TRX Viewer Error</h3><pre>${e.message}\n${e.stack}</pre></body></html>`;
        }
    }
}

// ─── HTML Builder ────────────────────────────────────────────────────────────

function buildHtml(data: TrxData | null, filePath: string, categories: CatalogCategory[]): string {
    const safeJson = JSON.stringify(data ?? null).replace(/</g, '\\u003C').replace(/>/g, '\\u003E');
    const safeCatalog = JSON.stringify(categories).replace(/</g, '\\u003C').replace(/>/g, '\\u003E');
    const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
    // remotePath hint: strip workspace prefix so TRX has its catalog path (used by Run Transaction)
    const trxRemotePath = filePath.replace(/\\/g, '/').replace(/.*?(?=Default\/)/, '').replace(/\.trx$/i, '');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
${CSS_CONTENT}
</style>
</head>
<body>
<div id="app"><div style="padding:20px;color:#888">Carregando...</div></div>
<div class="links-popup" id="links-popup">
  <div class="links-popup-title" id="links-title"></div>
  <div id="links-body"></div>
</div>

<script>
window.onerror = function(msg, url, line, col, err) {
  document.getElementById('app').innerHTML = '<div style="padding:20px;color:#f88;font-family:monospace;white-space:pre-wrap">Erro: ' + msg + '\\nLine: ' + line + '\\n' + (err && err.stack || '') + '</div>';
  return true;
};
</script>
<script>
const vscode = acquireVsCodeApi();
const DATA = ${safeJson};
const FILE_NAME = ${JSON.stringify(fileName)};
const TRX_REMOTE_PATH = ${JSON.stringify(trxRemotePath)};
let CATALOG = ${safeCatalog};

${JS_CONTENT}
</script>
</body>
</html>`;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS_CONTENT = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
  font-size: 13px;
  background: var(--vscode-editor-background, #1e1e1e);
  color: var(--vscode-editor-foreground, #d4d4d4);
  height: 100vh;
  overflow: hidden;
}
#app {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ── Sidebar ── */
.sidebar {
  width: 250px;
  min-width: 250px;
  background: var(--vscode-sideBar-background, #252526);
  border-right: 1px solid var(--vscode-panel-border, #444);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.15s, min-width 0.15s;
}
.sidebar.collapsed { width: 0; min-width: 0; border-right: none; }
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
  border-bottom: 1px solid var(--vscode-panel-border, #444);
  flex-shrink: 0;
}
.sidebar-toggle {
  background: none; border: none; color: #888; cursor: pointer; font-size: 12px; padding: 2px 4px;
}
.sidebar-toggle:hover { color: #ccc; }
.sidebar-search {
  padding: 6px 8px;
  flex-shrink: 0;
}
.sidebar-search input {
  width: 100%;
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: 3px;
  padding: 4px 8px;
  font-size: 12px;
  outline: none;
}
.sidebar-search input:focus { border-color: var(--vscode-focusBorder, #007acc); }
.sidebar-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
.sidebar-empty {
  padding: 12px;
  color: #666;
  font-size: 11px;
  font-style: italic;
}
.cat-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  color: #aaa;
  user-select: none;
}
.cat-header:hover { background: rgba(255,255,255,0.04); color: #ccc; }
.cat-chevron {
  font-size: 9px;
  transition: transform 0.15s;
  display: inline-block;
  width: 12px;
  text-align: center;
}
.cat-chevron.open { transform: rotate(90deg); }
.cat-items { display: none; padding-left: 8px; }
.cat-items.open { display: block; }
.action-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 12px;
  cursor: pointer;
  font-size: 11px;
  color: #bbb;
  border-radius: 3px;
  margin: 1px 4px;
}
.action-item:hover { background: rgba(255,255,255,0.06); color: #fff; }
.action-item-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.action-item-icon svg { width: 18px; height: 18px; }

/* ── Main Content ── */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* ── Header ── */
.header {
  background: var(--vscode-titleBar-activeBackground, #3c3c3c);
  border-bottom: 1px solid var(--vscode-panel-border, #444);
  padding: 8px 16px;
  flex-shrink: 0;
}
.header-title { font-size: 13px; font-weight: 600; }
.header-meta { display: flex; gap: 14px; margin-top: 5px; flex-wrap: wrap; }
.meta-item { font-size: 11px; color: #888; }
.meta-item strong { color: #ccc; }
.status-badge {
  display: inline-block; padding: 1px 8px; border-radius: 10px;
  font-size: 10px; font-weight: 700; text-transform: uppercase;
}
.status-DEVELOPMENT { background: #2d4a1e; color: #7ac258; border: 1px solid #4a7a30; }
.status-PRODUCTION  { background: #1e3a5a; color: #5ab8e2; border: 1px solid #2a5a80; }
.status-other       { background: #333; color: #aaa; border: 1px solid #555; }

/* ── Tabs ── */
.tabs {
  display: flex;
  background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
  border-bottom: 1px solid var(--vscode-panel-border, #444);
  flex-shrink: 0;
}
.tab {
  padding: 7px 16px; cursor: pointer; font-size: 12px;
  color: #888; border-bottom: 2px solid transparent; user-select: none;
}
.tab:hover { color: #ccc; }
.tab.active { color: #fff; border-bottom-color: var(--vscode-focusBorder, #007acc); }

/* ── Toolbar ── */
.toolbar {
  display: flex;
  gap: 6px;
  padding: 6px 12px;
  background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
  border-bottom: 1px solid var(--vscode-panel-border, #444);
  flex-shrink: 0;
  align-items: center;
}
.toolbar-btn {
  padding: 3px 10px;
  font-size: 11px;
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #ccc);
  border: 1px solid var(--vscode-button-border, #555);
  border-radius: 3px;
  cursor: pointer;
}
.toolbar-btn:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, #505357); }
.toolbar-btn:disabled { opacity: 0.4; cursor: default; }
.toolbar-sep { width: 1px; height: 18px; background: #444; margin: 0 4px; }
.toolbar-label { font-size: 11px; color: #888; }
.selected-label { font-size: 11px; color: #4ec9b0; font-weight: 600; }
.sidebar-open-btn {
  background: none; border: 1px solid #555; color: #888; cursor: pointer;
  padding: 3px 8px; border-radius: 3px; font-size: 11px;
}
.sidebar-open-btn:hover { color: #ccc; border-color: #888; }

/* ── Panels ── */
.panel { display: none; flex: 1; overflow: hidden; }
.panel.active { display: flex; flex-direction: column; }

/* ── Diagram ── */
.diagram-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
}
.diagram-canvas {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 30px 60px 60px 60px;
  min-width: 100%;
  min-height: 100%;
  gap: 0;
}
.conn-svg {
  position: absolute;
  top: 0; left: 0;
  pointer-events: none;
  overflow: visible;
  z-index: 0;
}

/* ── Step nodes ── */
.step-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 1;
}
.step-box {
  border: 2px dashed #555;
  border-radius: 3px;
  padding: 6px 8px;
  background: var(--vscode-editor-background, #1e1e1e);
  min-width: 120px;
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.step-box:hover { box-shadow: 0 0 0 1px rgba(255,255,255,0.15); }
.step-box.selected { box-shadow: 0 0 0 2px var(--vscode-focusBorder, #007acc) !important; }
.step-box.ActionSequence { border-color: #3a6abf; }
.step-box.Conditional    { border-color: #c03030; }
.step-box.ForNextRepeater,
.step-box.WhileRepeater,
.step-box.Iterator       { border-color: #8833cc; }
.step-box.Catch          { border-color: #cc5500; }

.step-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid #333;
}
.step-type-pill {
  font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px;
  text-transform: uppercase; letter-spacing: 0.3px; flex-shrink: 0;
}
.pill-ActionSequence  { background: #1a3560; color: #6090e0; }
.pill-Conditional     { background: #500; color: #f08080; }
.pill-ForNextRepeater,
.pill-WhileRepeater,
.pill-Iterator        { background: #3a1a5a; color: #c080ff; }
.pill-Catch           { background: #4a1e00; color: #ff8040; }
.pill-default         { background: #2a2a3a; color: #aaa; }

.step-name { font-size: 11px; font-weight: 600; color: #ccc; white-space: nowrap; }
.step-collapse {
  margin-left: auto; cursor: pointer; font-size: 10px; color: #666;
  padding: 0 4px; border-radius: 2px; flex-shrink: 0;
}
.step-collapse:hover { color: #ccc; background: rgba(255,255,255,0.08); }
.step-delete {
  cursor: pointer; font-size: 10px; color: transparent;
  padding: 0 3px; border-radius: 2px; flex-shrink: 0; transition: color 0.1s;
}
.step-box:hover .step-delete { color: #c05050; }
.step-delete:hover { color: #ff5555 !important; background: rgba(200,0,0,0.12); }

/* ── Action delete button ── */
.action-delete-btn {
  position: absolute; top: 2px; right: 2px;
  font-size: 9px; color: transparent; cursor: pointer;
  padding: 0 3px; border-radius: 2px; line-height: 14px;
  transition: color 0.1s;
}
.action-card:hover .action-delete-btn { color: #c05050; }
.action-delete-btn:hover { color: #ff5555 !important; background: rgba(200,0,0,0.15); }

/* ── Actions row ── */
.actions-row {
  display: flex; flex-direction: row; gap: 8px; flex-wrap: wrap; justify-content: center;
}

/* ── Action card ── */
.action-card {
  display: flex; flex-direction: column; align-items: center;
  width: 84px; cursor: pointer; border-radius: 3px; padding: 4px 2px;
  transition: background 0.1s; position: relative;
}
.action-card:hover { background: rgba(255,255,255,0.06); }
.action-arrows {
  display: flex; justify-content: space-between; width: 100%;
  padding: 0 6px; margin-bottom: 2px; font-size: 13px; color: #666;
}
.action-icon-wrap {
  width: 52px; height: 52px; display: flex; align-items: center; justify-content: center;
}
.action-icon-wrap svg { width: 52px; height: 52px; }
.action-card-name {
  font-size: 10px; text-align: center; color: #bbb;
  word-break: break-word; line-height: 1.3; margin-top: 3px; max-width: 80px;
}

/* ── Links popup ── */
.links-popup {
  position: fixed; background: #252540; border: 1px solid #4a4a80;
  border-radius: 4px; padding: 10px 14px; font-size: 11px;
  max-width: 480px; min-width: 200px; z-index: 9999;
  box-shadow: 0 4px 20px rgba(0,0,0,0.6); display: none;
}
.links-popup.visible { display: block; }
.links-popup-title {
  font-weight: 700; color: #9090ff; margin-bottom: 8px; font-size: 12px;
  border-bottom: 1px solid #3a3a60; padding-bottom: 4px;
}
.link-group { margin-bottom: 8px; }
.link-group-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 3px; }
.link-row { display: flex; gap: 5px; align-items: flex-start; padding: 2px 0; font-size: 10px; line-height: 1.4; }
.link-expr { font-family: monospace; color: #9cdcfe; word-break: break-all; }
.link-arrow { color: #4ec9b0; flex-shrink: 0; margin-top: 1px; }
.link-dest  { font-family: monospace; color: #4ec9b0; word-break: break-all; }
.links-close { float: right; cursor: pointer; color: #888; font-size: 14px; line-height: 1; }
.links-close:hover { color: #ccc; }

/* ── Children layouts ── */
.step-children-h {
  display: flex; flex-direction: row; align-items: flex-start;
  gap: 50px; padding-top: 50px;
}
.step-children-h.hidden { display: none; }

/* ── Branch labels ── */
.branch-label {
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.5px; padding: 1px 6px; border-radius: 3px;
  position: absolute; top: -18px; left: 50%; transform: translateX(-50%);
  white-space: nowrap;
}
.branch-true  { background: #1a3a1a; color: #5ab85a; }
.branch-false { background: #3a1a1a; color: #cc5555; }

/* ── Variables tab ── */
.vars-scroll { flex: 1; overflow: auto; padding: 14px 18px; }
.vars-section { margin-bottom: 20px; }
.vars-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.6px; color: #888; margin-bottom: 8px;
  padding-bottom: 4px; border-bottom: 1px solid #333;
}
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th {
  text-align: left; padding: 5px 10px; font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.4px; color: #888;
  background: #252526; border-bottom: 1px solid #333;
}
td { padding: 5px 10px; border-bottom: 1px solid #2a2a2a; vertical-align: top; }
tr:hover td { background: #2a2d2e; }
.type-pill-sm { font-size: 9px; padding: 1px 5px; border-radius: 3px; background: #1e3a4a; color: #58a8c2; }

/* ── Info tab ── */
.info-scroll { flex: 1; overflow: auto; padding: 14px 18px; }
.info-grid { display: grid; grid-template-columns: 160px 1fr; }
.info-key { padding: 5px 10px; font-size: 11px; font-weight: 600; color: #888; border-bottom: 1px solid #2a2a2a; }
.info-val { padding: 5px 10px; font-size: 12px; border-bottom: 1px solid #2a2a2a; word-break: break-all; }

.empty-msg { color: #666; font-style: italic; font-size: 12px; padding: 8px 0; }

/* ── Properties sidebar ── */
/* ── Action gear button ── */
.action-gear-btn {
  position: absolute; top: 2px; left: 2px;
  font-size: 10px; color: transparent; cursor: pointer;
  padding: 0 3px; border-radius: 2px; line-height: 14px;
  transition: color 0.1s;
}
.action-card:hover .action-gear-btn { color: #888; }
.action-gear-btn:hover { color: #fff !important; background: rgba(100,100,255,0.2); }

/* ── Rename inline input ── */
.rename-input {
  background: var(--vscode-input-background,#3c3c3c);
  color: var(--vscode-input-foreground,#ccc);
  border: 1px solid var(--vscode-focusBorder,#007acc);
  border-radius: 2px; padding: 0 4px; font-size: 11px;
  font-weight: 600; outline: none; min-width: 60px; max-width: 120px;
}

/* ── Properties / Link-editor sidebar ── */
.props-sidebar {
  width: 380px; min-width: 380px;
  background: var(--vscode-sideBar-background, #252526);
  border-left: 1px solid var(--vscode-panel-border, #444);
  display: flex; flex-direction: column; overflow: hidden;
  transition: width 0.15s, min-width 0.15s;
}
.props-sidebar.collapsed { width: 0; min-width: 0; border-left: none; }
.props-header {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 7px 10px; border-bottom: 1px solid var(--vscode-panel-border, #444); flex-shrink: 0;
}
.props-action-name { font-size: 12px; font-weight: 700; color: #ccc; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.props-type-pill { display: inline-block; font-size: 9px; padding: 1px 6px; border-radius: 3px; background: #1e3a4a; color: #5ab8e2; flex-shrink: 0; }
.props-close { background: none; border: none; color: #888; cursor: pointer; font-size: 12px; padding: 2px 4px; margin-left: auto; flex-shrink: 0; }
.props-close:hover { color: #ccc; }

/* ── Props panel tabs ── */
.props-tabs { display: flex; border-bottom: 1px solid #444; flex-shrink: 0; background: #1e1e2a; }
.props-tab { padding: 6px 14px; font-size: 11px; font-weight: 600; color: #888; cursor: pointer; border-bottom: 2px solid transparent; user-select: none; }
.props-tab:hover { color: #ccc; }
.props-tab.active { color: #5ab8e2; border-bottom-color: #5ab8e2; }

/* ── Link editor layout ── */
.link-ed-wrap { display: flex; flex: 1; overflow: hidden; min-height: 0; flex-direction: column; }
.link-dir-tabs { display: flex; gap: 0; padding: 6px 8px 0; flex-shrink: 0; }
.link-dir-btn { padding: 4px 12px; font-size: 11px; border: 1px solid #444; background: none; color: #888; cursor: pointer; border-radius: 3px 3px 0 0; margin-right: 2px; }
.link-dir-btn.active { background: #1e2a3a; color: #5ab8e2; border-color: #5ab8e2; border-bottom-color: #1e2a3a; }

.link-split { display: flex; flex: 1; overflow: hidden; min-height: 0; }

/* Source tree (left) */
.src-tree { width: 140px; min-width: 140px; border-right: 1px solid #333; overflow-y: auto; padding: 6px 0; flex-shrink: 0; background: #1a1a22; }
.src-node { font-size: 10px; cursor: pointer; user-select: none; }
.src-node-hdr { display: flex; align-items: center; gap: 3px; padding: 3px 8px; color: #888; }
.src-node-hdr:hover { background: rgba(255,255,255,0.05); color: #ccc; }
.src-node-hdr .chev { font-size: 8px; color: #555; width: 10px; flex-shrink: 0; }
.src-node-hdr .src-lbl { color: #9cdcfe; font-weight: 600; }
.src-node-children { padding-left: 12px; display: none; }
.src-node-children.open { display: block; }
.src-leaf { padding: 2px 8px 2px 16px; font-size: 10px; color: #aaa; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace; }
.src-leaf:hover { background: rgba(90,184,226,0.12); color: #5ab8e2; }

/* Link list (right top) */
.link-ed-right { display: flex; flex-direction: column; flex: 1; overflow: hidden; min-width: 0; }
.link-list { flex: 1; overflow-y: auto; min-height: 0; }
.link-row-item { display: flex; flex-direction: column; padding: 5px 8px; border-bottom: 1px solid #2a2a2a; cursor: pointer; font-size: 10px; }
.link-row-item:hover { background: rgba(255,255,255,0.04); }
.link-row-item.selected { background: rgba(90,184,226,0.12); }
.lri-from { color: #9cdcfe; font-family: monospace; word-break: break-all; }
.lri-arrow { color: #555; font-size: 9px; margin: 1px 0; }
.lri-to { color: #4ec9b0; font-family: monospace; word-break: break-all; }
.link-empty { padding: 12px 8px; color: #555; font-size: 11px; font-style: italic; }

/* Link form (bottom) */
.link-form { border-top: 1px solid #333; padding: 8px; flex-shrink: 0; background: #1a1a2a; }
.lf-row { margin-bottom: 6px; }
.lf-label { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px; }
.lf-input { width: 100%; background: #1e1e2e; color: #ccc; border: 1px solid #444; border-radius: 2px; padding: 4px 6px; font-size: 11px; font-family: monospace; outline: none; resize: vertical; min-height: 36px; }
.lf-input:focus { border-color: var(--vscode-focusBorder,#007acc); }
.lf-select { width: 100%; background: #1e1e2e; color: #ccc; border: 1px solid #444; border-radius: 2px; padding: 4px 6px; font-size: 11px; outline: none; }
.lf-select:focus { border-color: var(--vscode-focusBorder,#007acc); }
.lf-radios { display: flex; gap: 12px; }
.lf-radio { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #aaa; cursor: pointer; }
.lf-radio input { cursor: pointer; accent-color: #5ab8e2; }
.link-form-btns { display: flex; gap: 6px; margin-top: 6px; }
.lf-btn { padding: 4px 10px; font-size: 11px; border-radius: 3px; cursor: pointer; border: 1px solid #555; }
.lf-btn-save { background: #1a3a5a; color: #5ab8e2; border-color: #2a5a80; }
.lf-btn-save:hover { background: #1e4a6a; }
.lf-btn-del { background: #3a1a1a; color: #cc5555; border-color: #552222; }
.lf-btn-del:hover { background: #4a1a1a; }
.lf-btn-new { background: #1a3a1a; color: #5ab85a; border-color: #2a5a2a; }
.lf-btn-new:hover { background: #1e4a1e; }

/* ── Objeto (object props) tab ── */
.obj-props-wrap { flex: 1; overflow-y: auto; padding: 10px; }
.obj-prop-row { margin-bottom: 10px; }
.obj-prop-label { font-size: 10px; color: #888; margin-bottom: 3px; }
.obj-prop-input { width: 100%; background: #1e1e2e; color: #ccc; border: 1px solid #444; border-radius: 2px; padding: 5px 7px; font-size: 11px; font-family: monospace; outline: none; }
.obj-prop-input:focus { border-color: var(--vscode-focusBorder,#007acc); }
.obj-prop-select { width: 100%; background: #1e1e2e; color: #ccc; border: 1px solid #444; border-radius: 2px; padding: 5px 7px; font-size: 11px; outline: none; }
.obj-save-btn { width: 100%; padding: 7px; background: #1a3a5a; color: #5ab8e2; border: 1px solid #2a5a80; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: 600; margin-top: 4px; }
.obj-save-btn:hover { background: #1e4a6a; }
.obj-note { color: #666; font-size: 11px; font-style: italic; padding: 8px 0; }

/* ── Run modal ── */
.run-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  z-index: 99999; display: flex; align-items: center; justify-content: center;
}
.run-modal {
  background: #252526; border: 1px solid #555; border-radius: 6px;
  width: 520px; max-width: 95vw; max-height: 85vh;
  display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.7);
}
.run-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #444; flex-shrink: 0;
}
.run-modal-title { font-size: 13px; font-weight: 700; color: #ccc; }
.run-modal-close { background: none; border: none; color: #888; cursor: pointer; font-size: 16px; }
.run-modal-close:hover { color: #ccc; }
.run-modal-body { flex: 1; overflow-y: auto; padding: 14px 16px; }
.run-params-section { margin-bottom: 14px; }
.run-params-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 8px; }
.run-param-row { display: grid; grid-template-columns: 130px 1fr; gap: 8px; align-items: center; margin-bottom: 7px; }
.run-param-label { font-size: 11px; color: #ccc; text-align: right; padding-right: 4px; }
.run-param-input { background: var(--vscode-input-background,#3c3c3c); color: var(--vscode-input-foreground,#ccc); border: 1px solid var(--vscode-input-border,#555); border-radius: 3px; padding: 4px 8px; font-size: 12px; outline: none; width: 100%; }
.run-param-input:focus { border-color: var(--vscode-focusBorder,#007acc); }
.run-modal-footer { padding: 10px 16px; border-top: 1px solid #444; display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.run-btn-execute { padding: 7px 20px; background: #1a7a1a; color: #7df07d; border: 1px solid #2da02d; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: 700; }
.run-btn-execute:disabled { opacity: 0.5; cursor: default; }
.run-btn-execute:hover:not(:disabled) { background: #1f8f1f; }
.run-btn-cancel { padding: 7px 14px; background: #3a3d41; color: #ccc; border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px; }
.run-btn-cancel:hover { background: #505357; }
.run-status { font-size: 11px; color: #888; font-style: italic; }
.run-result-section { margin-top: 12px; }
.run-result-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 6px; }
.run-result-success { color: #4ec9b0; font-size: 12px; margin-bottom: 8px; }
.run-result-error { color: #f48771; font-size: 12px; margin-bottom: 8px; }
.run-output-row { display: grid; grid-template-columns: 140px 1fr; gap: 6px; margin-bottom: 5px; font-size: 11px; border-bottom: 1px solid #2a2a2a; padding-bottom: 4px; }
.run-output-key { color: #9cdcfe; font-weight: 600; word-break: break-all; }
.run-output-val { color: #ccc; font-family: monospace; word-break: break-all; max-height: 60px; overflow: auto; }
.run-xml-btn { font-size: 10px; color: #888; background: none; border: 1px solid #444; border-radius: 2px; cursor: pointer; padding: 2px 6px; margin-top: 6px; }
.run-xml-btn:hover { color: #ccc; border-color: #666; }
.run-xml-pre { background: #1a1a2a; border: 1px solid #333; border-radius: 3px; padding: 8px; font-size: 10px; font-family: monospace; white-space: pre-wrap; word-break: break-all; max-height: 150px; overflow-y: auto; color: #9cdcfe; margin-top: 6px; }

/* ── Confirm modal ── */
.confirm-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  z-index: 99999; display: flex; align-items: center; justify-content: center;
}
.confirm-box {
  background: #252526; border: 1px solid #555; border-radius: 6px;
  padding: 20px 24px; max-width: 380px; width: 90%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}
.confirm-msg { color: #ccc; font-size: 13px; margin-bottom: 16px; line-height: 1.5; word-break: break-word; }
.confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
.confirm-btn-cancel {
  padding: 6px 14px; background: #3a3d41; border: 1px solid #555;
  color: #ccc; border-radius: 3px; cursor: pointer; font-size: 12px;
}
.confirm-btn-cancel:hover { background: #505357; }
.confirm-btn-ok {
  padding: 6px 14px; background: #8b2020; border: 1px solid #aa2222;
  color: #fff; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: 600;
}
.confirm-btn-ok:hover { background: #c03030; }
`;

// ─── JavaScript ──────────────────────────────────────────────────────────────

const JS_CONTENT = `
// ─── Action icon SVGs ──────────────────────────────────────────────────────

const ACTION_SVGS = {
  SAPJCOInterface: '<svg viewBox="0 0 52 52"><rect x="1" y="1" width="50" height="50" rx="3" fill="#222"/><rect x="1" y="1" width="50" height="26" rx="3" fill="#003399"/><rect x="1" y="24" width="50" height="28" rx="3" fill="#ccc"/><rect x="1" y="24" width="50" height="6" fill="#001a66"/><text x="26" y="20" fill="white" text-anchor="middle" font-weight="bold" font-size="13" font-family="Arial">SAP</text><text x="26" y="44" fill="#333" text-anchor="middle" font-weight="bold" font-size="11" font-family="Arial">JCO</text></svg>',
  SAPJCOStartSession: '<svg viewBox="0 0 52 52"><rect x="1" y="1" width="50" height="50" rx="3" fill="#003399"/><text x="26" y="22" fill="white" text-anchor="middle" font-weight="bold" font-size="9" font-family="Arial">JCO</text><text x="26" y="38" fill="#8bc" text-anchor="middle" font-size="8" font-family="Arial">START</text></svg>',
  SAPJCOEndSession: '<svg viewBox="0 0 52 52"><rect x="1" y="1" width="50" height="50" rx="3" fill="#003399"/><text x="26" y="22" fill="white" text-anchor="middle" font-weight="bold" font-size="9" font-family="Arial">JCO</text><text x="26" y="38" fill="#c88" text-anchor="middle" font-size="8" font-family="Arial">END</text></svg>',
  SAPJCOFunction: '<svg viewBox="0 0 52 52"><rect x="1" y="1" width="50" height="50" rx="3" fill="#003399"/><text x="26" y="22" fill="white" text-anchor="middle" font-weight="bold" font-size="9" font-family="Arial">JCO</text><text x="26" y="38" fill="#8b8" text-anchor="middle" font-size="8" font-family="Arial">FUNC</text></svg>',
  SAPJCOCommit: '<svg viewBox="0 0 52 52"><rect x="1" y="1" width="50" height="50" rx="3" fill="#003399"/><text x="26" y="22" fill="white" text-anchor="middle" font-weight="bold" font-size="9" font-family="Arial">JCO</text><text x="26" y="38" fill="#8b8" text-anchor="middle" font-size="7" font-family="Arial">COMMIT</text></svg>',
  SAPJCORollback: '<svg viewBox="0 0 52 52"><rect x="1" y="1" width="50" height="50" rx="3" fill="#003399"/><text x="26" y="22" fill="white" text-anchor="middle" font-weight="bold" font-size="9" font-family="Arial">JCO</text><text x="26" y="38" fill="#c88" text-anchor="middle" font-size="7" font-family="Arial">ROLLBK</text></svg>',
  ConditionalAction: '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="#d0d0d0" stroke="#999" stroke-width="2"/><circle cx="26" cy="26" r="18" fill="#e8e8e8"/><text x="26" y="36" fill="#228B22" text-anchor="middle" font-size="28" font-weight="bold" font-family="Arial">?</text></svg>',
  Throw: '<svg viewBox="0 0 52 52"><path d="M26,4 C26,4 40,20 35,32 C41,26 47,33 42,43 C37,51 21,51 16,43 C11,33 17,26 23,32 C18,20 26,4 26,4 Z" fill="#FF6600"/><path d="M26,18 C26,18 33,28 30,35 C33,31 37,35 34,41 C31,46 22,46 19,41 C16,35 20,31 23,35 C20,28 26,18 26,18 Z" fill="#FFD700"/></svg>',
  Tracer: '<svg viewBox="0 0 52 52"><rect x="2" y="2" width="48" height="48" rx="3" fill="#0d0d0d"/><rect x="2" y="2" width="48" height="10" rx="3" fill="#1a1a1a"/><circle cx="10" cy="7" r="2" fill="#f55"/><circle cx="17" cy="7" r="2" fill="#fa0"/><circle cx="24" cy="7" r="2" fill="#5a5"/><text x="10" y="26" fill="#3f3" font-family="monospace" font-size="12">$ &#9646;</text><rect x="9" y="32" width="18" height="2" fill="#3f3" opacity="0.7"/><rect x="9" y="38" width="12" height="2" fill="#3f3" opacity="0.5"/></svg>',
  XmlTracer: '<svg viewBox="0 0 52 52"><rect x="2" y="2" width="48" height="48" rx="3" fill="#0d0d0d"/><rect x="2" y="2" width="48" height="10" rx="3" fill="#1a1a1a"/><circle cx="10" cy="7" r="2" fill="#f55"/><circle cx="17" cy="7" r="2" fill="#fa0"/><circle cx="24" cy="7" r="2" fill="#5a5"/><text x="8" y="28" fill="#3f9" font-family="monospace" font-size="9">&lt;xml&gt;</text><text x="8" y="40" fill="#3f9" font-family="monospace" font-size="9">_</text></svg>',
  Assignment: '<svg viewBox="0 0 52 52"><rect x="2" y="2" width="48" height="48" rx="4" fill="#2a1040"/><text x="26" y="34" fill="#c088ff" text-anchor="middle" font-size="22" font-weight="bold" font-family="Arial">:=</text></svg>',
  TransactionCall: '<svg viewBox="0 0 52 52"><rect x="4" y="8" width="20" height="14" rx="2" fill="#005577"/><rect x="28" y="30" width="20" height="14" rx="2" fill="#005577"/><line x1="14" y1="22" x2="14" y2="37" stroke="#3ac" stroke-width="2"/><line x1="14" y1="37" x2="38" y2="37" stroke="#3ac" stroke-width="2"/><line x1="38" y1="37" x2="38" y2="30" stroke="#3ac" stroke-width="2"/><polygon points="34,28 38,30 42,28" fill="#3ac"/></svg>',
  DynamicTransactionCall: '<svg viewBox="0 0 52 52"><rect x="4" y="8" width="20" height="14" rx="2" fill="#004466"/><rect x="28" y="30" width="20" height="14" rx="2" fill="#004466"/><line x1="14" y1="22" x2="14" y2="37" stroke="#4bd" stroke-width="2" stroke-dasharray="3,2"/><line x1="14" y1="37" x2="38" y2="37" stroke="#4bd" stroke-width="2" stroke-dasharray="3,2"/><line x1="38" y1="37" x2="38" y2="30" stroke="#4bd" stroke-width="2" stroke-dasharray="3,2"/><polygon points="34,28 38,30 42,28" fill="#4bd"/></svg>',
  TerminateTransaction: '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="#8B0000" stroke="#600" stroke-width="2"/><rect x="13" y="22" width="26" height="8" rx="1" fill="white"/></svg>',
  ForNextRepeaterAction: '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="#95c" stroke-width="4"/><path d="M26,8 L32,16 L20,16 Z" fill="#95c"/><text x="26" y="32" fill="#c8f" text-anchor="middle" font-size="11" font-weight="bold" font-family="Arial">FOR</text></svg>',
  RepeaterAction: '<svg viewBox="0 0 52 52"><path d="M26,6 A20,20 0 1,1 6,26" fill="none" stroke="#95c" stroke-width="4"/><polygon points="6,16 6,28 16,22" fill="#95c"/></svg>',
  WhileRepeaterAction: '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="#73b" stroke-width="4"/><path d="M26,8 L32,16 L20,16 Z" fill="#73b"/><text x="26" y="32" fill="#b8f" text-anchor="middle" font-size="9" font-weight="bold" font-family="Arial">WHILE</text></svg>',
  IteratorAction: '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="#62a" stroke-width="4"/><path d="M26,8 L32,16 L20,16 Z" fill="#62a"/><text x="26" y="32" fill="#a6f" text-anchor="middle" font-size="9" font-weight="bold" font-family="Arial">ITER</text></svg>',
  CatchAction: '<svg viewBox="0 0 52 52"><path d="M26,4 L48,44 L4,44 Z" fill="#c40" stroke="#f62" stroke-width="2"/><text x="26" y="40" fill="white" text-anchor="middle" font-size="18" font-weight="bold" font-family="Arial">!</text></svg>',
  ExceptionEnabler: '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="#441a00" stroke="#c50" stroke-width="2"/><text x="26" y="34" fill="#f84" text-anchor="middle" font-size="24" font-weight="bold" font-family="Arial">!</text></svg>',
  EventLogger: '<svg viewBox="0 0 52 52"><rect x="6" y="4" width="40" height="44" rx="3" fill="#1a2a1a" stroke="#3a7a3a" stroke-width="2"/><rect x="12" y="14" width="28" height="2" fill="#5a5"/><rect x="12" y="20" width="20" height="2" fill="#5a5"/><rect x="12" y="26" width="24" height="2" fill="#5a5"/><rect x="12" y="32" width="16" height="2" fill="#5a5"/></svg>',
  Pause: '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="#2a2a40" stroke="#556" stroke-width="2"/><rect x="17" y="14" width="6" height="24" rx="1" fill="#88a"/><rect x="29" y="14" width="6" height="24" rx="1" fill="#88a"/></svg>',
  SwitcherAction: '<svg viewBox="0 0 52 52"><rect x="4" y="4" width="44" height="44" rx="4" fill="#2a3040"/><path d="M12,20 L26,12 L40,20 L26,28 Z" fill="#5588cc" stroke="#77aadd" stroke-width="1"/><text x="26" y="42" fill="#88aacc" text-anchor="middle" font-size="8" font-weight="bold" font-family="Arial">SWITCH</text></svg>',
  IlluminatorSQLQueryObject: '<svg viewBox="0 0 52 52"><rect x="4" y="4" width="44" height="44" rx="4" fill="#1a2a40"/><text x="26" y="30" fill="#5599dd" text-anchor="middle" font-size="10" font-weight="bold" font-family="Arial">SQL</text><text x="26" y="42" fill="#558" text-anchor="middle" font-size="8" font-family="Arial">Query</text></svg>',
  Calculation: '<svg viewBox="0 0 52 52"><rect x="4" y="4" width="44" height="44" rx="4" fill="#2a2a1a"/><text x="26" y="34" fill="#cca" text-anchor="middle" font-size="16" font-weight="bold" font-family="Arial">f(x)</text></svg>',
};

const ACTION_INFO = {
  SAPJCOInterface: { label: 'SAP JCO' },
  SAPJCOStartSession: { label: 'JCO Start' },
  SAPJCOEndSession: { label: 'JCO End' },
  SAPJCOFunction: { label: 'JCO Func' },
  SAPJCOCommit: { label: 'JCO Commit' },
  SAPJCORollback: { label: 'JCO Rollback' },
  Tracer: { label: 'Tracer' },
  XmlTracer: { label: 'XML Tracer' },
  EventLogger: { label: 'Event Logger' },
  ConditionalAction: { label: 'Conditional' },
  Throw: { label: 'Throw' },
  CatchAction: { label: 'Catch' },
  Assignment: { label: 'Assignment' },
  TransactionCall: { label: 'Trx Call' },
  DynamicTransactionCall: { label: 'Dyn Trx Call' },
  TerminateTransaction: { label: 'Terminate' },
  ForNextRepeaterAction: { label: 'For Loop' },
  RepeaterAction: { label: 'Repeater' },
  WhileRepeaterAction: { label: 'While Loop' },
  IteratorAction: { label: 'Iterator' },
  ExceptionEnabler: { label: 'Exc. Enabler' },
  Pause: { label: 'Pause' },
  SwitcherAction: { label: 'Switch' },
  Calculation: { label: 'Calculation' },
  WebServiceAction: { label: 'Web Service' },
  EnterpriseServiceAction: { label: 'Ent. Service' },
  IlluminatorSQLQueryObject: { label: 'SQL Query' },
  IlluminatorTagQueryObject: { label: 'Tag Query' },
  IlluminatorXMLQueryObject: { label: 'XML Query' },
  IlluminatorMDOQueryObject: { label: 'MDO Query' },
  IlluminatorPCoQueryObject: { label: 'PCo Query' },
  IlluminatorAlarmQueryObject: { label: 'Alarm Query' },
  IlluminatorOLAPQueryObject: { label: 'OLAP Query' },
  IlluminatorAggregateQueryObject: { label: 'Agg Query' },
  IlluminatorCatalogQueryObject: { label: 'Cat Query' },
  IlluminatorKPIQueryObject: { label: 'KPI Query' },
  SendMail: { label: 'Send Mail' },
  ReadMail: { label: 'Read Mail' },
  Post: { label: 'HTTP Post' },
  XmlLoader: { label: 'XML Loader' },
  XmlSaver: { label: 'XML Saver' },
  TextLoader: { label: 'Text Loader' },
  TextSaver: { label: 'Text Saver' },
  HTMLLoader: { label: 'HTML Loader' },
  HTMLSaver: { label: 'HTML Saver' },
  ImageLoader: { label: 'Image Loader' },
  ImageSaver: { label: 'Image Saver' },
  XSLTransform: { label: 'XSL Transform' },
  GenericSortFilter: { label: 'Sort/Filter' },
  Joiner: { label: 'Joiner' },
  Union: { label: 'Union' },
  Aggregator: { label: 'Aggregator' },
  WriteFile: { label: 'Write File' },
  GetFileList: { label: 'Get File List' },
  DeleteFile: { label: 'Delete File' },
  FlatFileParser: { label: 'Flat File Parser' },
  StringToXmlConverter: { label: 'Str→XML' },
  ColumnAlias: { label: 'Col Alias' },
  ColumnStripper: { label: 'Col Stripper' },
  Normalize: { label: 'Normalize' },
  CalculatedColumns: { label: 'Calc Cols' },
  Crosstab: { label: 'Crosstab' },
  Distinct: { label: 'Distinct' },
  Totalizer: { label: 'Totalizer' },
  IlluminatorDocument: { label: 'Document' },
  IlluminatorRowset: { label: 'Rowset' },
  IlluminatorColumn: { label: 'Column' },
  IlluminatorRow: { label: 'Row' },
  IlluminatorDataItem: { label: 'Data Item' },
  IlluminatorFatalError: { label: 'Fatal Error' },
  IlluminatorMessage: { label: 'Message' },
  IlluminatorChart: { label: 'Chart' },
  SAPInterface: { label: 'SAP BC' },
  SAPWASInterface: { label: 'SAP WebAS' },
  SAPBCStartSession: { label: 'BC Start' },
  SAPBCCommit: { label: 'BC Commit' },
  SAPBCRollback: { label: 'BC Rollback' },
  SAPInterfaceRepository: { label: 'SAP IFR' },
  RaiseAlert: { label: 'Raise Alert' },
  DeleteAlert: { label: 'Delete Alert' },
};

const STEP_LABELS = {
  ActionSequence: 'Sequence',
  Conditional: 'Conditional',
  ForNextRepeater: 'For Loop',
  WhileRepeater: 'While Loop',
  Iterator: 'Iterator',
  Catch: 'Catch',
};

// ─── State ─────────────────────────────────────────────────────────────────

let selectedPath = null;  // Array of indices, e.g. [0, 2, 1]
let stepIdCounter = 0;
const idToPath = {};  // elementId → path array
const pathToId = {};  // 'path string' → elementId
let collapsedPaths = new Set(); // paths collapsed by user — persists across refreshes
// Link editor state
let linkEdState = { action: null, stepPath: null, tab: 'links', dir: 'incoming', selIdx: -1, from: '', to: '', type: 'Assign' };

// ─── Utilities ─────────────────────────────────────────────────────────────

function getStepLabel(t) { return STEP_LABELS[t] || t; }
function getStepPillClass(t) { return 'step-type-pill pill-' + (STEP_LABELS[t] ? t : 'default'); }

function getActionSvg(type) {
  if (ACTION_SVGS[type]) return ACTION_SVGS[type];
  const info = ACTION_INFO[type] || { label: type.replace(/Action$/, '') };
  const label = (info.label || type).substring(0, 8);
  return '<svg viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="48" height="48" rx="4" fill="#1e3050"/><text x="26" y="30" fill="#88aaff" text-anchor="middle" font-size="9" font-weight="bold" font-family="Arial">' + esc(label) + '</text></svg>';
}

function getActionSvgSmall(type) {
  if (ACTION_SVGS[type]) return ACTION_SVGS[type];
  const info = ACTION_INFO[type] || { label: type.replace(/Action$/, '') };
  const label = (info.label || type).substring(0, 5);
  return '<svg viewBox="0 0 52 52"><rect x="2" y="2" width="48" height="48" rx="4" fill="#1e3050"/><text x="26" y="30" fill="#88aaff" text-anchor="middle" font-size="12" font-weight="bold" font-family="Arial">' + esc(label) + '</text></svg>';
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Custom confirmation dialog (confirm() is blocked in VS Code webviews)
function confirmDialog(message, onConfirm) {
  var overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    '<div class="confirm-box">' +
      '<div class="confirm-msg">' + esc(message) + '</div>' +
      '<div class="confirm-actions">' +
        '<button class="confirm-btn-cancel">Cancelar</button>' +
        '<button class="confirm-btn-ok">Apagar</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  function close() { document.body.removeChild(overlay); }

  overlay.querySelector('.confirm-btn-cancel').addEventListener('click', close);
  overlay.querySelector('.confirm-btn-ok').addEventListener('click', function() {
    close();
    onConfirm();
  });
  // Click outside to cancel
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) close();
  });
}

function pathStr(p) { return p.join('.'); }

// ─── DOM Builders ──────────────────────────────────────────────────────────

function createActionCard(actionRef, actionDefs, stepPath) {
  const type = actionDefs?.[actionRef.name] || 'Unknown';
  const hasIn = actionRef.incoming.length > 0;
  const hasOut = actionRef.outgoing.length > 0;

  const card = document.createElement('div');
  card.className = 'action-card';
  card.title = type + ': ' + actionRef.name;

  const arrows = document.createElement('div');
  arrows.className = 'action-arrows';
  arrows.innerHTML =
    '<span style="color:' + (hasIn ? '#5a9fd4' : 'transparent') + '">&#8595;</span>' +
    '<span style="color:' + (hasOut ? '#4ec9b0' : 'transparent') + '">&#8593;</span>';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'action-icon-wrap';
  iconWrap.innerHTML = getActionSvg(type);

  const name = document.createElement('div');
  name.className = 'action-card-name';
  name.textContent = actionRef.name;

  // Delete button (visible on hover)
  const delBtn = document.createElement('div');
  delBtn.className = 'action-delete-btn';
  delBtn.textContent = '✕';
  delBtn.title = 'Apagar action: ' + actionRef.name;
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmDialog('Apagar a action "' + actionRef.name + '" da sequência?', function() {
      vscode.postMessage({ type: 'deleteAction', path: stepPath, actionName: actionRef.name });
    });
  });

  // Gear button — opens link editor focused on Objeto tab
  const gearBtn = document.createElement('div');
  gearBtn.className = 'action-gear-btn';
  gearBtn.textContent = '⚙';
  gearBtn.title = 'Configurar objeto: ' + actionRef.name;
  gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openLinkEditor(actionRef, stepPath, 'objeto');
  });

  card.appendChild(gearBtn);
  card.appendChild(arrows);
  card.appendChild(iconWrap);
  card.appendChild(name);
  card.appendChild(delBtn);

  card.addEventListener('click', (e) => {
    e.stopPropagation();
    openLinkEditor(actionRef, stepPath, 'links');
  });
  return card;
}

function createStepElement(step, actionDefs, path, branchType) {
  const id = 'sn-' + (stepIdCounter++);
  const ps = pathStr(path);
  idToPath[id] = path;
  pathToId[ps] = id;

  const wrapper = document.createElement('div');
  wrapper.className = 'step-node';
  wrapper.id = id;
  wrapper.dataset.path = ps;
  wrapper.dataset.branchType = branchType || '';

  const box = document.createElement('div');
  box.className = 'step-box ' + step.type;
  box.addEventListener('click', (e) => {
    e.stopPropagation();
    selectStep(path);
  });

  const header = document.createElement('div');
  header.className = 'step-header';

  const pill = document.createElement('span');
  pill.className = getStepPillClass(step.type);
  pill.textContent = getStepLabel(step.type);

  const nameEl = document.createElement('span');
  nameEl.className = 'step-name';
  nameEl.textContent = step.name;

  header.appendChild(pill);
  header.appendChild(nameEl);

  // Collapse toggle if has children
  if (step.steps.length > 0) {
    const isCollapsed = collapsedPaths.has(ps);
    const collapseBtn = document.createElement('span');
    collapseBtn.className = 'step-collapse';
    collapseBtn.textContent = isCollapsed ? '▶' : '▼';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const childContainer = wrapper.querySelector('.step-children-h');
      if (childContainer) {
        const hidden = childContainer.classList.toggle('hidden');
        collapseBtn.textContent = hidden ? '▶' : '▼';
        if (hidden) collapsedPaths.add(ps); else collapsedPaths.delete(ps);
        scheduleDrawConnections();
      }
    });
    header.appendChild(collapseBtn);
  }

  // Double-click on name to rename
  nameEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const inp = document.createElement('input');
    inp.className = 'rename-input';
    inp.value = step.name;
    nameEl.replaceWith(inp);
    inp.focus(); inp.select();
    const commit = () => {
      const v = inp.value.trim();
      if (v && v !== step.name) vscode.postMessage({ type: 'renameStep', path, newName: v });
      inp.replaceWith(nameEl);
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e2 => { if (e2.key === 'Enter') inp.blur(); if (e2.key === 'Escape') { inp.value = step.name; inp.blur(); } });
  });

  // Delete sequence button
  const delSeqBtn = document.createElement('span');
  delSeqBtn.className = 'step-delete';
  delSeqBtn.textContent = '✕';
  delSeqBtn.title = 'Apagar sequência: ' + step.name;
  delSeqBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmDialog('Apagar a sequência "' + step.name + '" e todo seu conteúdo?', function() {
      vscode.postMessage({ type: 'deleteSequence', path });
    });
  });
  header.appendChild(delSeqBtn);

  box.appendChild(header);

  if (step.actions.length > 0) {
    const actRow = document.createElement('div');
    actRow.className = 'actions-row';
    step.actions.forEach(a => actRow.appendChild(createActionCard(a, actionDefs, path)));
    box.appendChild(actRow);
  }

  wrapper.appendChild(box);

  // Branch label for conditional children
  if (branchType === 'true' || branchType === 'false') {
    const label = document.createElement('div');
    label.className = 'branch-label branch-' + branchType;
    label.textContent = branchType === 'true' ? 'TRUE' : 'FALSE';
    box.style.position = 'relative';
    box.appendChild(label);
  }

  if (step.steps.length > 0) {
    const isConditional = step.type === 'Conditional';
    const childContainer = document.createElement('div');
    childContainer.className = 'step-children-h' + (collapsedPaths.has(ps) ? ' hidden' : '');
    step.steps.forEach((child, i) => {
      const bt = isConditional ? (i === 0 ? 'true' : 'false') : 'sequential';
      const childPath = [...path, i];
      childContainer.appendChild(createStepElement(child, actionDefs, childPath, bt));
    });
    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

// ─── Step Selection ────────────────────────────────────────────────────────

function selectStep(path) {
  // Deselect previous
  document.querySelectorAll('.step-box.selected').forEach(el => el.classList.remove('selected'));

  if (selectedPath && pathStr(selectedPath) === pathStr(path)) {
    selectedPath = null;
  } else {
    selectedPath = path;
    const id = pathToId[pathStr(path)];
    if (id) {
      const el = document.getElementById(id);
      if (el) el.querySelector('.step-box').classList.add('selected');
    }
  }
  updateToolbar();
}

function updateToolbar() {
  const btnBelow = document.getElementById('btn-add-seq-below');
  const btnParent = document.getElementById('btn-add-seq-parent');
  const selLabel = document.getElementById('selected-label');

  if (selectedPath) {
    btnBelow.disabled = false;
    btnParent.disabled = false;
    // Find step name
    let step = DATA;
    let current = DATA.steps;
    let name = '';
    for (let i = 0; i < selectedPath.length; i++) {
      if (current[selectedPath[i]]) {
        name = current[selectedPath[i]].name;
        if (i < selectedPath.length - 1) {
          current = current[selectedPath[i]].steps;
        }
      }
    }
    selLabel.textContent = name || 'Selected';
  } else {
    btnBelow.disabled = true;
    btnParent.disabled = true;
    selLabel.textContent = 'None';
  }
}

// ─── SVG Connections ───────────────────────────────────────────────────────

let _drawRafId = null;
function scheduleDrawConnections() {
  if (_drawRafId) cancelAnimationFrame(_drawRafId);
  _drawRafId = requestAnimationFrame(() => {
    _drawRafId = null;
    drawConnections();
  });
}

function drawConnections() {
  const svg = document.getElementById('conn-svg');
  const canvas = document.getElementById('diagram-canvas');
  if (!svg || !canvas) return;

  svg.innerHTML = '';
  const canvasRect = canvas.getBoundingClientRect();
  const scrollEl = canvas.parentElement;

  svg.setAttribute('width', canvas.scrollWidth);
  svg.setAttribute('height', canvas.scrollHeight);

  // Build parent→children map from DOM
  document.querySelectorAll('.step-node').forEach(child => {
    const childPath = child.dataset.path;
    if (!childPath || !childPath.includes('.')) return; // root steps have no parent connection

    const parts = childPath.split('.');
    const parentPath = parts.slice(0, -1).join('.');
    const parentId = pathToId[parentPath];
    if (!parentId) return;

    const parentEl = document.getElementById(parentId);
    if (!parentEl) return;

    const parentBox = parentEl.querySelector(':scope > .step-box');
    const childBox = child.querySelector(':scope > .step-box');
    if (!parentBox || !childBox) return;

    // Check if child container is hidden (collapsed)
    const childContainer = child.parentElement;
    if (childContainer && childContainer.classList.contains('hidden')) return;

    const pr = parentBox.getBoundingClientRect();
    const cr = childBox.getBoundingClientRect();

    const x1 = pr.left - canvasRect.left + scrollEl.scrollLeft + pr.width / 2;
    const y1 = pr.top  - canvasRect.top  + scrollEl.scrollTop  + pr.height;
    const x2 = cr.left - canvasRect.left + scrollEl.scrollLeft + cr.width / 2;
    const y2 = cr.top  - canvasRect.top  + scrollEl.scrollTop;

    const branchType = child.dataset.branchType;
    const color = branchType === 'true' ? '#2a8a3a'
               : branchType === 'false' ? '#aa2222'
               : '#555';

    // Bezier path
    const my = (y1 + y2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + my + ' ' + x2 + ',' + my + ' ' + x2 + ',' + y2);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);

    // Arrow at child
    const arr = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arr.setAttribute('d', 'M' + (x2-5) + ',' + (y2-8) + ' L' + x2 + ',' + y2 + ' L' + (x2+5) + ',' + (y2-8));
    arr.setAttribute('stroke', color);
    arr.setAttribute('stroke-width', '2');
    arr.setAttribute('fill', 'none');
    svg.appendChild(arr);
  });
}

// ─── Links popup ───────────────────────────────────────────────────────────

function showLinks(actionRef, type, cardEl) {
  const popup = document.getElementById('links-popup');
  const title = document.getElementById('links-title');
  const body  = document.getElementById('links-body');

  title.textContent = actionRef.name + ' (' + type + ')';
  let html = '';

  if (actionRef.incoming.length > 0) {
    html += '<div class="link-group"><div class="link-group-label">Incoming Links</div>';
    html += actionRef.incoming.map(l =>
      '<div class="link-row"><span class="link-expr">' + esc(l.from) + '</span><span class="link-arrow">&#8594;</span><span class="link-dest">' + esc(l.to) + '</span></div>'
    ).join('');
    html += '</div>';
  }
  if (actionRef.outgoing.length > 0) {
    html += '<div class="link-group"><div class="link-group-label">Outgoing Links</div>';
    html += actionRef.outgoing.map(l =>
      '<div class="link-row"><span class="link-dest">' + esc(l.from) + '</span><span class="link-arrow">&#8594;</span><span class="link-expr">' + esc(l.to) + '</span></div>'
    ).join('');
    html += '</div>';
  }
  body.innerHTML = html;

  const rect = cardEl.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 6) + 'px';
  popup.style.left = Math.min(rect.left, window.innerWidth - 500) + 'px';
  popup.classList.add('visible');
}

function closeLinks() {
  document.getElementById('links-popup').classList.remove('visible');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.action-card') && !e.target.closest('.links-popup')) closeLinks();
});

// ─── Sidebar ───────────────────────────────────────────────────────────────

function renderSidebar() {
  const body = document.getElementById('sidebar-body');
  if (!body) return;

  if (!CATALOG || CATALOG.length === 0) {
    body.innerHTML = '<div class="sidebar-empty">Faça login no MII para carregar as actions disponíveis.</div>';
    return;
  }

  body.innerHTML = '';
  CATALOG.forEach((cat, ci) => {
    const catDiv = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'cat-header';
    header.innerHTML = '<span class="cat-chevron" id="chev-' + ci + '">&#9654;</span> ' + esc(cat.label || cat.name);
    header.addEventListener('click', () => {
      const items = document.getElementById('cat-items-' + ci);
      const chev = document.getElementById('chev-' + ci);
      if (items) {
        items.classList.toggle('open');
        chev.classList.toggle('open');
      }
    });

    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'cat-items';
    itemsDiv.id = 'cat-items-' + ci;

    (cat.components || []).forEach(comp => {
      const item = document.createElement('div');
      item.className = 'action-item';
      item.dataset.name = comp.name;
      item.dataset.label = comp.label;
      item.title = comp.description || comp.name;

      const iconWrap = document.createElement('div');
      iconWrap.className = 'action-item-icon';
      iconWrap.innerHTML = getActionSvgSmall(comp.name);

      const label = document.createElement('span');
      label.textContent = comp.label || comp.name;

      item.appendChild(iconWrap);
      item.appendChild(label);

      item.addEventListener('click', () => {
        if (!selectedPath) {
          showNotification('Selecione uma sequência primeiro');
          return;
        }
        vscode.postMessage({
          type: 'addAction',
          path: selectedPath,
          actionType: comp.name,
          actionLabel: comp.label || comp.name,
        });
      });

      itemsDiv.appendChild(item);
    });

    catDiv.appendChild(header);
    catDiv.appendChild(itemsDiv);
    body.appendChild(catDiv);
  });
}

function filterActions(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.action-item').forEach(item => {
    const name = (item.dataset.name || '').toLowerCase();
    const label = (item.dataset.label || '').toLowerCase();
    const match = !q || name.includes(q) || label.includes(q);
    item.style.display = match ? '' : 'none';
  });
  // Open categories that have visible items
  document.querySelectorAll('.cat-items').forEach(items => {
    if (q) {
      const hasVisible = items.querySelector('.action-item:not([style*="display: none"])');
      if (hasVisible) {
        items.classList.add('open');
        const chev = items.previousElementSibling?.querySelector('.cat-chevron');
        if (chev) chev.classList.add('open');
      }
    }
  });
}

let notifTimeout;
function showNotification(msg) {
  let notif = document.getElementById('notif');
  if (!notif) {
    notif = document.createElement('div');
    notif.id = 'notif';
    notif.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#4a4a80;color:#fff;padding:8px 16px;border-radius:4px;font-size:12px;z-index:9999;box-shadow:0 2px 10px rgba(0,0,0,0.4);transition:opacity 0.3s';
    document.body.appendChild(notif);
  }
  notif.textContent = msg;
  notif.style.opacity = '1';
  clearTimeout(notifTimeout);
  notifTimeout = setTimeout(() => { notif.style.opacity = '0'; }, 2500);
}

// ─── Toolbar Actions ───────────────────────────────────────────────────────

function addSequenceBelow() {
  if (!selectedPath) return;
  vscode.postMessage({ type: 'addSequence', path: selectedPath, position: 'below' });
}

function addSequenceAsParent() {
  if (!selectedPath) return;
  vscode.postMessage({ type: 'addSequence', path: selectedPath, position: 'parent' });
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('collapsed');
  const btn = sb.querySelector('.sidebar-toggle');
  if (btn) btn.textContent = sb.classList.contains('collapsed') ? '▶' : '◀';
  requestAnimationFrame(drawConnections);
}

// ─── Tabs ──────────────────────────────────────────────────────────────────

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'diagram') requestAnimationFrame(() => requestAnimationFrame(drawConnections));
}

// ─── Messages from extension ───────────────────────────────────────────────

window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'refresh':
      if (msg.data) applyRefresh(msg.data);
      break;
    case 'catalogUpdate':
      CATALOG = msg.categories;
      renderSidebar();
      break;
  }
});

// ─── applyRefresh — update data without full re-render ────────────────────

function applyRefresh(newData) {
  Object.assign(DATA, newData);

  // Update vars and info tabs in place
  const vp = document.getElementById('panel-vars');
  if (vp) vp.innerHTML = '<div class="vars-scroll">' + buildVarsHtml() + '</div>';
  const ip = document.getElementById('panel-info');
  if (ip) ip.innerHTML = '<div class="info-scroll">' + buildInfoHtml() + '</div>';

  // Preserve scroll
  const scrollEl = document.getElementById('diagram-scroll');
  const sx = scrollEl ? scrollEl.scrollLeft : 0;
  const sy = scrollEl ? scrollEl.scrollTop : 0;

  renderDiagram();

  if (scrollEl) { requestAnimationFrame(() => { scrollEl.scrollLeft = sx; scrollEl.scrollTop = sy; }); }

  // Update link editor if a specific action is open
  if (linkEdState.action) {
    const updName = linkEdState.action.name;
    // Find the updated actionRef in the new steps
    function findRef(steps) {
      for (const s of steps) {
        const a = (s.actions||[]).find(r => r.name === updName);
        if (a) return a;
        const found = findRef(s.steps||[]);
        if (found) return found;
      }
      return null;
    }
    const updated = findRef(DATA.steps || []);
    if (updated) {
      linkEdState.action = updated;
      renderPropsPanel();
    }
  }
}

// ─── Render ────────────────────────────────────────────────────────────────

function buildVarsHtml() {
  const mkTable = (vars) => {
    if (!vars.length) return '<p class="empty-msg">Nenhuma variável.</p>';
    return '<table><tr><th>Nome</th><th>Tipo</th><th>Descrição</th></tr>'
      + vars.map(v =>
          '<tr><td><strong>' + esc(v.name) + '</strong></td>'
        + '<td><span class="type-pill-sm">' + esc(v.type) + '</span></td>'
        + '<td>' + esc(v.description) + '</td></tr>'
        ).join('')
      + '</table>';
  };
  return '<div class="vars-section"><div class="vars-title">Context (Entrada / Saída)</div>' + mkTable(DATA.context) + '</div>'
       + '<div class="vars-section"><div class="vars-title">Local</div>' + mkTable(DATA.local) + '</div>';
}

function buildInfoHtml() {
  const keys = ['Description','Comments','Status','Category','CreatedBy','CreationDate','LastEditedBy','LastEditedDate','ThrowOnActionError','ThrowOnLinkError','LegacyProcessingMode'];
  let rows = DATA.name ? '<div class="info-key">Path</div><div class="info-val">' + esc(DATA.name) + '</div>' : '';
  rows += keys.filter(k => DATA.attributes[k]).map(k =>
    '<div class="info-key">' + esc(k) + '</div><div class="info-val">' + esc(DATA.attributes[k]) + '</div>'
  ).join('');
  return '<div class="info-grid">' + rows + '</div>';
}

function renderDiagram() {
  stepIdCounter = 0;
  for (const k in idToPath) delete idToPath[k];
  for (const k in pathToId) delete pathToId[k];

  const canvas = document.getElementById('diagram-canvas');
  if (!canvas) return;

  // Keep only the SVG, remove step nodes
  const svg = document.getElementById('conn-svg');
  canvas.innerHTML = '';
  canvas.appendChild(svg);

  if (DATA.steps.length === 0) {
    canvas.innerHTML += '<div class="empty-msg" style="padding:20px">Nenhum step encontrado.</div>';
  } else {
    DATA.steps.forEach((step, i) => {
      canvas.appendChild(createStepElement(step, DATA.actionDefs, [i], null));
    });
  }

  updateToolbar();

  scheduleDrawConnections();
}

function render() {
  const app = document.getElementById('app');
  if (!DATA) {
    app.innerHTML = '<div style="padding:20px;color:#f88">Erro ao analisar o arquivo TRX.</div>';
    return;
  }

  const status = DATA.attributes['Status'] || '';
  const statusCls = ['DEVELOPMENT','PRODUCTION'].includes(status) ? 'status-' + status : 'status-other';
  const txName = DATA.name || FILE_NAME;
  const shortName = txName.split('/').pop() || txName;

  app.innerHTML =
    '<div id="props-sidebar" class="props-sidebar collapsed"></div>' +
    '<div class="sidebar" id="sidebar">' +
      '<div class="sidebar-header">' +
        '<span>Actions</span>' +
        '<button class="sidebar-toggle" id="btn-sidebar-toggle">◀</button>' +
      '</div>' +
      '<div class="sidebar-search"><input type="text" id="sidebar-search-input" placeholder="Buscar actions..."></div>' +
      '<div class="sidebar-body" id="sidebar-body"></div>' +
    '</div>' +
    '<div class="main-content">' +
      '<div class="header">' +
        '<div class="header-title" title="' + esc(txName) + '">' + esc(shortName) + '</div>' +
        '<div class="header-meta">' +
          '<div class="meta-item">Versão <strong>' + esc(DATA.version) + '</strong></div>' +
          (status ? '<div class="meta-item"><span class="status-badge ' + statusCls + '">' + esc(status) + '</span></div>' : '') +
          (DATA.attributes['CreatedBy'] ? '<div class="meta-item">Criado por <strong>' + esc(DATA.attributes['CreatedBy']) + '</strong></div>' : '') +
          (DATA.attributes['LastEditedDate'] ? '<div class="meta-item">Editado em <strong>' + esc((DATA.attributes['LastEditedDate']||'').substring(0,10)) + '</strong></div>' : '') +
          '<div class="meta-item">Steps: <strong>' + DATA.steps.length + '</strong></div>' +
          '<div class="meta-item">Variáveis: <strong>' + (DATA.context.length + DATA.local.length) + '</strong></div>' +
        '</div>' +
      '</div>' +
      '<div class="tabs">' +
        '<div class="tab active" data-tab="diagram">Diagrama</div>' +
        '<div class="tab" data-tab="vars">Variáveis (' + (DATA.context.length + DATA.local.length) + ')</div>' +
        '<div class="tab" data-tab="info">Informações</div>' +
      '</div>' +
      '<div class="toolbar">' +
        '<button class="sidebar-open-btn" id="btn-sidebar-open" style="display:none">Actions ▶</button>' +
        '<span class="toolbar-label">Selecionado:</span> <span class="selected-label" id="selected-label">None</span>' +
        '<div class="toolbar-sep"></div>' +
        '<button class="toolbar-btn" id="btn-add-seq-below" disabled>+ Seq Abaixo</button>' +
        '<button class="toolbar-btn" id="btn-add-seq-parent" disabled>+ Seq Pai</button>' +
        '<div class="toolbar-sep"></div>' +
        '<button class="toolbar-btn" id="btn-run-trx" style="background:#1a4a1a;color:#6dbf6d;border-color:#2d7a2d">▶ Executar</button>' +
      '</div>' +
      '<div class="panel active" id="panel-diagram">' +
        '<div class="diagram-scroll" id="diagram-scroll">' +
          '<div class="diagram-canvas" id="diagram-canvas">' +
            '<svg class="conn-svg" id="conn-svg"></svg>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="panel" id="panel-vars"><div class="vars-scroll">' + buildVarsHtml() + '</div></div>' +
      '<div class="panel" id="panel-info"><div class="info-scroll">' + buildInfoHtml() + '</div></div>' +
    '</div>';

  // Sidebar open button visibility
  const sidebar = document.getElementById('sidebar');
  const openBtn = document.getElementById('btn-sidebar-open');
  if (sidebar && openBtn) {
    new MutationObserver(() => {
      openBtn.style.display = sidebar.classList.contains('collapsed') ? '' : 'none';
    }).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  }

  // Render diagram
  renderDiagram();
  renderSidebar();

  // ResizeObserver + scroll listener for connection redraw
  const canvas = document.getElementById('diagram-canvas');
  if (canvas) {
    new ResizeObserver(scheduleDrawConnections).observe(canvas);
  }

  // Deselect on canvas click
  const scrollEl = document.getElementById('diagram-scroll');
  if (scrollEl) {
    scrollEl.addEventListener('click', (e) => {
      if (e.target === scrollEl || e.target.id === 'diagram-canvas') {
        selectStep(selectedPath); // toggle off
      }
    });
    scrollEl.addEventListener('scroll', scheduleDrawConnections, { passive: true });
  }

  // Bind event listeners (avoid inline onclick in template literals)
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() { showTab(tab.dataset.tab); });
  });
  var sidebarToggle = document.getElementById('btn-sidebar-toggle');
  if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);
  var sidebarOpen = document.getElementById('btn-sidebar-open');
  if (sidebarOpen) sidebarOpen.addEventListener('click', toggleSidebar);
  var btnSeqBelow = document.getElementById('btn-add-seq-below');
  if (btnSeqBelow) btnSeqBelow.addEventListener('click', addSequenceBelow);
  var btnSeqParent = document.getElementById('btn-add-seq-parent');
  if (btnSeqParent) btnSeqParent.addEventListener('click', addSequenceAsParent);
  var searchInput = document.getElementById('sidebar-search-input');
  if (searchInput) searchInput.addEventListener('input', function() { filterActions(this.value); });
  var btnRunTrx = document.getElementById('btn-run-trx');
  if (btnRunTrx) btnRunTrx.addEventListener('click', openRunModal);
}

// ─── Link Editor Panel ─────────────────────────────────────────────────────

function openLinkEditor(actionRef, stepPath, tab) {
  linkEdState.action = actionRef;
  linkEdState.stepPath = stepPath;
  linkEdState.tab = tab || 'links';
  linkEdState.dir = 'incoming';
  linkEdState.selIdx = -1;
  linkEdState.from = ''; linkEdState.to = ''; linkEdState.type = 'Assign';
  const sidebar = document.getElementById('props-sidebar');
  if (sidebar) { sidebar.classList.remove('collapsed'); renderPropsPanel(); }
}

function closePropsPanel() {
  linkEdState.action = null;
  const sidebar = document.getElementById('props-sidebar');
  if (sidebar) sidebar.classList.add('collapsed');
}

function renderPropsPanel() {
  const sidebar = document.getElementById('props-sidebar');
  if (!sidebar || !linkEdState.action) return;
  const { action, tab } = linkEdState;
  const type = (DATA && DATA.actionDefs) ? (DATA.actionDefs[action.name] || 'Unknown') : 'Unknown';
  const props = (DATA && DATA.actionProps) ? (DATA.actionProps[action.name] || {}) : {};

  sidebar.innerHTML =
    \`<div class="props-header">
       <span class="props-action-name" title="\${esc(action.name)}">\${esc(action.name)}</span>
       <span class="props-type-pill">\${esc(type)}</span>
       <button class="props-close" id="btn-props-close">✕</button>
     </div>
     <div class="props-tabs">
       <div class="props-tab\${tab==='links'?' active':''}" data-ptab="links">Links</div>
       <div class="props-tab\${tab==='objeto'?' active':''}" data-ptab="objeto">Objeto</div>
     </div>
     <div id="props-tab-content" style="display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0"></div>\`;

  sidebar.querySelectorAll('.props-tab').forEach(t => {
    t.addEventListener('click', () => { linkEdState.tab = t.dataset.ptab; renderPropsTabContent(); });
  });
  document.getElementById('btn-props-close')?.addEventListener('click', closePropsPanel);
  renderPropsTabContent();
}

function renderPropsTabContent() {
  const cont = document.getElementById('props-tab-content');
  if (!cont || !linkEdState.action) return;
  const { action, tab } = linkEdState;
  const type = (DATA && DATA.actionDefs) ? (DATA.actionDefs[action.name] || 'Unknown') : 'Unknown';
  const props = (DATA && DATA.actionProps) ? (DATA.actionProps[action.name] || {}) : {};

  // Update tab active class
  document.querySelectorAll('.props-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.ptab === tab);
  });

  if (tab === 'links') renderLinkEditorContent(cont, action);
  else renderObjPropsContent(cont, action.name, type, props);
}

// ─── Link Editor — Links tab ──────────────────────────────────────────────

function renderLinkEditorContent(cont, action) {
  const dir = linkEdState.dir;
  const links = dir === 'incoming' ? action.incoming : action.outgoing;

  cont.innerHTML =
    \`<div class="link-ed-wrap">
       <div class="link-dir-tabs">
         <button class="link-dir-btn\${dir==='incoming'?' active':''}" data-dir="incoming">
           ↓ Incoming (\${action.incoming.length})
         </button>
         <button class="link-dir-btn\${dir==='outgoing'?' active':''}" data-dir="outgoing">
           ↑ Outgoing (\${action.outgoing.length})
         </button>
       </div>
       <div class="link-split">
         <div class="src-tree" id="src-tree"></div>
         <div class="link-ed-right">
           <div class="link-list" id="link-list">
             \${links.length === 0 ? '<div class="link-empty">Nenhum link ' + (dir==='incoming'?'incoming':'outgoing') + '.</div>' :
               links.map((l,i) => \`<div class="link-row-item\${i===linkEdState.selIdx?' selected':''}" data-li="\${i}">
                 <span class="lri-from">\${esc(l.from)}</span>
                 <span class="lri-arrow">→</span>
                 <span class="lri-to">\${esc(l.to)}</span>
               </div>\`).join('')}
           </div>
           <div class="link-form" id="link-form">
             <div class="lf-row">
               <div class="lf-label">De (From)</div>
               <textarea class="lf-input" id="lf-from" rows="2" placeholder="Transaction.campo, Local.var, ActionName.Results{xpath}, expressão...">\${esc(linkEdState.from)}</textarea>
             </div>
             <div class="lf-row">
               <div class="lf-label">Para (To)</div>
               <select class="lf-select" id="lf-to">
                 <option value="">-- selecione --</option>
                 \${getTargetsForAction(action.name, dir).map(t =>
                   \`<option value="\${esc(t)}" \${t===linkEdState.to?'selected':''}>\${esc(t)}</option>\`
                 ).join('')}
               </select>
             </div>
             <div class="lf-row">
               <div class="lf-label">Tipo</div>
               <div class="lf-radios">
                 <label class="lf-radio"><input type="radio" name="lftype" value="Assign" \${linkEdState.type!=='AssignXml'?'checked':''}>Assign Value</label>
                 <label class="lf-radio"><input type="radio" name="lftype" value="AssignXml" \${linkEdState.type==='AssignXml'?'checked':''}>Assign XML</label>
               </div>
             </div>
             <div class="link-form-btns">
               <button class="lf-btn lf-btn-new" id="lf-btn-new">+ Novo</button>
               <button class="lf-btn lf-btn-save" id="lf-btn-save">💾 Salvar</button>
               <button class="lf-btn lf-btn-del" id="lf-btn-del" \${linkEdState.selIdx<0?'disabled':''}>✕ Remover</button>
             </div>
           </div>
         </div>
       </div>
     </div>\`;

  // Build source tree
  buildSourceTree(document.getElementById('src-tree'));

  // Link list click — select & load into form
  cont.querySelectorAll('.link-row-item').forEach(row => {
    row.addEventListener('click', () => {
      const i = parseInt(row.dataset.li);
      linkEdState.selIdx = i;
      const l = links[i];
      linkEdState.from = l.from; linkEdState.to = l.to; linkEdState.type = l.type || 'Assign';
      renderPropsTabContent();
    });
  });

  // Dir tab buttons
  cont.querySelectorAll('.link-dir-btn').forEach(b => {
    b.addEventListener('click', () => { linkEdState.dir = b.dataset.dir; linkEdState.selIdx = -1; linkEdState.from=''; linkEdState.to=''; renderPropsTabContent(); });
  });

  // Form inputs live-update state
  document.getElementById('lf-from')?.addEventListener('input', function() { linkEdState.from = this.value; });
  document.getElementById('lf-to')?.addEventListener('change', function() { linkEdState.to = this.value; });
  cont.querySelectorAll('input[name="lftype"]').forEach(r => r.addEventListener('change', function() { if(this.checked) linkEdState.type = this.value; }));

  // New link
  document.getElementById('lf-btn-new')?.addEventListener('click', () => {
    linkEdState.selIdx = -1; linkEdState.from=''; linkEdState.to=''; linkEdState.type='Assign';
    renderPropsTabContent();
  });

  // Save link
  document.getElementById('lf-btn-save')?.addEventListener('click', () => {
    const action = linkEdState.action;
    const inLinks = [...action.incoming]; const outLinks = [...action.outgoing];
    const targetList = dir === 'incoming' ? inLinks : outLinks;
    const newLink = { from: linkEdState.from.trim(), to: linkEdState.to.trim(), type: linkEdState.type };
    if (!newLink.from || !newLink.to) { alert('Preencha De e Para.'); return; }
    if (linkEdState.selIdx >= 0 && linkEdState.selIdx < targetList.length) {
      targetList[linkEdState.selIdx] = newLink;
    } else {
      targetList.push(newLink);
      linkEdState.selIdx = targetList.length - 1;
    }
    vscode.postMessage({ type: 'editLinks', path: linkEdState.stepPath, actionName: action.name,
      incoming: dir==='incoming'?inLinks:action.incoming,
      outgoing: dir==='outgoing'?outLinks:action.outgoing });
  });

  // Delete link
  document.getElementById('lf-btn-del')?.addEventListener('click', () => {
    const action = linkEdState.action;
    const inLinks = [...action.incoming]; const outLinks = [...action.outgoing];
    const targetList = dir === 'incoming' ? inLinks : outLinks;
    if (linkEdState.selIdx < 0 || linkEdState.selIdx >= targetList.length) return;
    targetList.splice(linkEdState.selIdx, 1);
    linkEdState.selIdx = -1; linkEdState.from=''; linkEdState.to='';
    vscode.postMessage({ type: 'editLinks', path: linkEdState.stepPath, actionName: action.name,
      incoming: dir==='incoming'?inLinks:action.incoming,
      outgoing: dir==='outgoing'?outLinks:action.outgoing });
  });
}

// ─── Source tree ──────────────────────────────────────────────────────────

function buildSourceTree(el) {
  if (!el || !DATA) return;
  const insertFrom = (val) => {
    const inp = document.getElementById('lf-from');
    if (inp) { inp.value = val; linkEdState.from = val; }
  };
  const mkLeaf = (val) => {
    const d = document.createElement('div');
    d.className = 'src-leaf'; d.textContent = val; d.title = 'Inserir: ' + val;
    d.addEventListener('click', () => insertFrom(val));
    return d;
  };
  const mkGroup = (label, children) => {
    const node = document.createElement('div'); node.className = 'src-node';
    const hdr = document.createElement('div'); hdr.className = 'src-node-hdr';
    const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '▶';
    const lbl = document.createElement('span'); lbl.className = 'src-lbl'; lbl.textContent = label;
    hdr.appendChild(chev); hdr.appendChild(lbl); node.appendChild(hdr);
    const ch = document.createElement('div'); ch.className = 'src-node-children';
    children.forEach(c => ch.appendChild(c)); node.appendChild(ch);
    hdr.addEventListener('click', () => { const o = ch.classList.toggle('open'); chev.textContent = o ? '▼' : '▶'; });
    return node;
  };

  el.innerHTML = '';

  // Transaction vars
  if (DATA.context.length) {
    el.appendChild(mkGroup('Transaction', DATA.context.map(v => mkLeaf('Transaction.' + v.name))));
  }
  // Local vars
  if (DATA.local.length) {
    el.appendChild(mkGroup('Local', DATA.local.map(v => mkLeaf('Local.' + v.name))));
  }
  // Actions
  for (const [name, type] of Object.entries(DATA.actionDefs || {})) {
    const children = [];
    if (type === 'IlluminatorSQLQueryObject' || type.startsWith('Illuminator')) {
      children.push(mkLeaf(name + '.Results'));
      // Common columns from Results
      ['Results{/Rowsets/Rowset/Row/col1}'].forEach(v => children.push(mkLeaf(name + '.' + v)));
    }
    children.push(mkLeaf(name + '.Output'));
    el.appendChild(mkGroup(name + ' (' + (ACTION_INFO[type]?.label || type) + ')', children));
  }
}

// ─── Get targets for action type ──────────────────────────────────────────

function getTargetsForAction(actionName, dir) {
  if (!DATA) return [];
  const type = DATA.actionDefs?.[actionName] || 'Unknown';
  const targets = [];

  if (dir === 'incoming') {
    if (type === 'IlluminatorSQLQueryObject') {
      for (let i=1;i<=32;i++) targets.push(actionName + '.Param.' + i);
      targets.push(actionName + '.QueryTemplate', actionName + '.Server', actionName + '.Mode', actionName + '.RowCount');
    } else if (type === 'SAPJCOInterface') {
      targets.push(actionName + '.ConnPropAlias', actionName + '.CredentialAlias', actionName + '.FunctionName', actionName + '.AutoCommit');
    } else if (type === 'TransactionCall') {
      targets.push(actionName + '.TransactionPath');
      (DATA.context||[]).forEach(v => targets.push(actionName + '.' + v.name));
    } else if (type === 'ConditionalAction') {
      targets.push(actionName + '.Input1', actionName + '.Input2', actionName + '.Input3');
    } else if (type === 'Assignment') {
      (DATA.local||[]).forEach(v => targets.push('Local.' + v.name));
      (DATA.context||[]).forEach(v => targets.push('Transaction.' + v.name));
    } else if (type === 'Tracer' || type === 'XmlTracer' || type === 'EventLogger') {
      targets.push(actionName + '.Message', actionName + '.Level');
    } else {
      targets.push(actionName + '.Input', actionName + '.Input1', actionName + '.Input2');
    }
  } else {
    // outgoing — destination is usually Local or Transaction vars
    (DATA.local||[]).forEach(v => targets.push('Local.' + v.name));
    (DATA.context||[]).forEach(v => targets.push('Transaction.' + v.name));
    targets.push(actionName + '.Output');
  }
  return targets;
}

// ─── Objeto tab — action props editor ────────────────────────────────────

function renderObjPropsContent(cont, actionName, type, props) {
  let rows = '';
  const field = (label, id, val, multiline) =>
    \`<div class="obj-prop-row">
       <div class="obj-prop-label">\${esc(label)}</div>
       \${multiline
         ? \`<textarea class="obj-prop-input" id="\${id}" rows="2">\${esc(val||'')}</textarea>\`
         : \`<input class="obj-prop-input" id="\${id}" value="\${esc(val||'')}"/>\`}
     </div>\`;
  const sel = (label, id, val, opts) =>
    \`<div class="obj-prop-row">
       <div class="obj-prop-label">\${esc(label)}</div>
       <select class="obj-prop-select" id="\${id}">\${opts.map(o=>\`<option value="\${esc(o)}" \${o===val?'selected':''}>\${esc(o)}</option>\`).join('')}</select>
     </div>\`;

  const SERVERS = (window._sqlServers || []);
  const MODES = ['FixedQuery','FixedQueryWithOutput','Query','Command'];

  if (type === 'IlluminatorSQLQueryObject') {
    rows += field('QueryTemplate (caminho catálogo)', 'op-qt', props.QueryTemplate, false);
    rows += sel('Server', 'op-srv', props.Server||'', SERVERS.length ? SERVERS : [props.Server||'']);
    rows += sel('Mode', 'op-mode', props.Mode||props['@_Mode']||'FixedQuery', MODES);
    rows += field('RowCount', 'op-rc', props.RowCount||'500', false);
    rows += field('Timeout (s)', 'op-to', props.Timeout||'60', false);
  } else if (type === 'SAPJCOInterface') {
    rows += field('ConnPropAlias', 'op-cpa', props.ConnPropAlias, false);
    rows += field('CredentialAlias', 'op-cra', props.CredentialAlias, false);
    rows += field('FunctionName', 'op-fn', props.FunctionName, false);
    rows += \`<div class="obj-prop-row"><div class="obj-prop-label">AutoCommit</div>
      <select class="obj-prop-select" id="op-ac"><option value="true" \${props.AutoCommit==='true'?'selected':''}>true</option><option value="false" \${props.AutoCommit!=='true'?'selected':''}>false</option></select></div>\`;
  } else if (type === 'TransactionCall' || type === 'DynamicTransactionCall') {
    rows += field('TransactionPath', 'op-tp', props.TransactionPath, false);
  } else if (type === 'ConditionalAction') {
    rows += field('Input1 (expressão)', 'op-i1', props.Input1, true);
    rows += field('Input2', 'op-i2', props.Input2, true);
    rows += \`<div class="obj-prop-row"><div class="obj-prop-label">LogicalAnd</div>
      <select class="obj-prop-select" id="op-la"><option value="false" \${props.LogicalAnd!=='true'?'selected':''}>false (OR)</option><option value="true" \${props.LogicalAnd==='true'?'selected':''}>true (AND)</option></select></div>\`;
  } else if (type === 'Tracer' || type === 'XmlTracer' || type === 'EventLogger') {
    rows += field('Message', 'op-msg', props.Message, true);
    rows += sel('Level', 'op-lvl', props.Level||'INFO', ['INFO','WARNING','ERROR','DEBUG']);
  } else if (type === 'Assignment') {
    rows = \`<div class="obj-note">Assignment não tem propriedades próprias — configure usando a aba Links.</div>\`;
  } else if (type === 'Pause') {
    rows += field('Delay (ms)', 'op-delay', props.Delay||'1000', false);
  } else {
    const keys = Object.keys(props).filter(k => !k.startsWith('@'));
    if (keys.length) {
      rows += keys.map(k => field(k, 'op-gen-'+k, String(props[k]||''), false)).join('');
    } else {
      rows = \`<div class="obj-note">Sem propriedades configuráveis para \${esc(type)}.</div>\`;
    }
  }

  cont.innerHTML = \`<div class="obj-props-wrap">
    \${rows}
    \${type !== 'Assignment' ? '<button class="obj-save-btn" id="btn-obj-save">💾 Salvar Objeto</button>' : ''}
  </div>\`;

  document.getElementById('btn-obj-save')?.addEventListener('click', () => {
    const newProps = { ...props };
    // Collect values from inputs
    cont.querySelectorAll('.obj-prop-input, .obj-prop-select').forEach(inp => {
      const key = inp.id.replace('op-', '').replace('gen-','');
      const realKey = {qt:'QueryTemplate',srv:'Server',mode:'Mode',rc:'RowCount',to:'Timeout',
        cpa:'ConnPropAlias',cra:'CredentialAlias',fn:'FunctionName',ac:'AutoCommit',
        tp:'TransactionPath',i1:'Input1',i2:'Input2',la:'LogicalAnd',msg:'Message',lvl:'Level',
        delay:'Delay'}[key] || key;
      newProps[realKey] = inp.value;
    });
    vscode.postMessage({ type: 'editActionProps', actionName, props: newProps });
  });
}

// ─── Run Transaction modal ──────────────────────────────────────────────────

let runModalOpen = false;
let runRunning = false;
let runResult = null;
let runShowXml = false;

function openRunModal() {
  runModalOpen = true;
  runRunning = false;
  runResult = null;
  runShowXml = false;
  renderRunModal();
}

function renderRunModal() {
  // Remove existing
  const existing = document.getElementById('run-modal-overlay');
  if (existing) existing.remove();
  if (!runModalOpen) return;

  const overlay = document.createElement('div');
  overlay.className = 'run-modal-overlay';
  overlay.id = 'run-modal-overlay';

  const ctxVars = (DATA && DATA.context) ? DATA.context : [];
  const trxName = TRX_REMOTE_PATH ? TRX_REMOTE_PATH.split('/').pop() : FILE_NAME;

  const paramsHtml = ctxVars.length
    ? ctxVars.map(v => \`<div class="run-param-row">
        <label class="run-param-label" for="rp-\${esc(v.name)}">\${esc(v.name)}
          <span style="font-size:9px;color:#666"> (\${esc(v.type||'string')})</span>
        </label>
        <input class="run-param-input" id="rp-\${esc(v.name)}" placeholder="" data-name="\${esc(v.name)}">
      </div>\`).join('')
    : '<div style="color:#666;font-size:11px;font-style:italic">Esta transaction não tem parâmetros de entrada.</div>';

  let resultHtml = '';
  if (runRunning) {
    resultHtml = '<div class="run-status"><span class="spinner"></span> Executando...</div>';
  } else if (runResult) {
    if (runResult.ok) {
      const outputs = runResult.outputs || {};
      const keys = Object.keys(outputs);
      resultHtml = \`<div class="run-result-section">
        <div class="run-result-success">✔ Execução concluída</div>
        \${keys.length ? \`<div class="run-result-title">Saída (\${keys.length} variáveis)</div>
        \${keys.map(k=>\`<div class="run-output-row">
          <div class="run-output-key">\${esc(k)}</div>
          <div class="run-output-val">\${esc(String(outputs[k]||''))}</div>
        </div>\`).join('')}\` : '<div style="color:#666;font-size:11px">Nenhuma variável de saída retornada.</div>'}
        \${runResult.rawXml ? \`<button class="run-xml-btn" id="btn-toggle-xml">\${runShowXml?'Ocultar XML':'Ver XML completo'}</button>
        \${runShowXml ? \`<pre class="run-xml-pre">\${esc(runResult.rawXml)}</pre>\` : ''}\` : ''}
      </div>\`;
    } else {
      resultHtml = \`<div class="run-result-section"><div class="run-result-error">✘ \${esc(runResult.error||'Erro na execução')}</div></div>\`;
    }
  }

  overlay.innerHTML = \`<div class="run-modal">
    <div class="run-modal-header">
      <span class="run-modal-title">▶ Executar: \${esc(trxName)}</span>
      <button class="run-modal-close" id="btn-run-close">✕</button>
    </div>
    <div class="run-modal-body">
      <div class="run-params-section">
        <div class="run-params-title">Parâmetros de Entrada (Context)</div>
        \${paramsHtml}
      </div>
      \${resultHtml}
    </div>
    <div class="run-modal-footer">
      <button class="run-btn-execute" id="btn-run-execute" \${runRunning?'disabled':''}>▶ Executar</button>
      <button class="run-btn-cancel" id="btn-run-cancel">Fechar</button>
      <span class="run-status" id="run-status-msg"></span>
    </div>
  </div>\`;

  document.body.appendChild(overlay);

  document.getElementById('btn-run-close')?.addEventListener('click', () => { runModalOpen=false; overlay.remove(); });
  document.getElementById('btn-run-cancel')?.addEventListener('click', () => { runModalOpen=false; overlay.remove(); });
  overlay.addEventListener('click', e => { if(e.target===overlay){ runModalOpen=false; overlay.remove(); } });

  document.getElementById('btn-toggle-xml')?.addEventListener('click', () => { runShowXml = !runShowXml; renderRunModal(); });

  document.getElementById('btn-run-execute')?.addEventListener('click', () => {
    const params = {};
    overlay.querySelectorAll('.run-param-input[data-name]').forEach(inp => {
      params[inp.dataset.name] = inp.value;
    });
    runRunning = true;
    runResult = null;
    renderRunModal();
    vscode.postMessage({ type: 'runTransaction', transactionPath: TRX_REMOTE_PATH, params });
  });
}

// ─── Messages from extension (extend existing handler) ─────────────────────

const _origHandler = window.onmessage;
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'runResult') {
    runRunning = false;
    runResult = msg;
    renderRunModal();
  }
  if (msg.type === 'jcoConnections') {
    // Could update properties panel if action is JCO type
  }
});

render();
`;
