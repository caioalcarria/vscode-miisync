import * as path from 'path';
import * as vscode from 'vscode';
import { configManager } from '../../modules/config';
import { GetRemotePath } from '../../modules/file';
import { illuminatorService } from '../../miiservice/illuminatorService';
import { miiCatalogService } from '../../miiservice/miiCatalogService';
import { runQueryTest, runAdHocQuery, QueryTestResult } from '../../modules/queryrunner';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface SQLQuery {
    id: string;
    pathId: string;
    server: string;
    mode: string;
    saveDate: string;
    version: string;
    readerRoles: string;
    writerRoles: string;
    rowCount: number;
    query: string;
    params: QueryParam[];
    _rawAttrs?: Record<string, string>;
    _rawChildren?: string;
}

export interface QueryParam {
    index: number;
    value: string;
    description: string;
    type: string;
}

// ─── TqsqDocument ─────────────────────────────────────────────────────────────

class TqsqDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    private _content: string;

    private readonly _onDidDispose = new vscode.EventEmitter<void>();
    readonly onDidDispose = this._onDidDispose.event;

    constructor(uri: vscode.Uri, content: string) {
        this.uri = uri;
        this._content = content;
    }

    get content() { return this._content; }

    updateContent(content: string) { this._content = content; }

    dispose() {
        this._onDidDispose.fire();
        this._onDidDispose.dispose();
    }
}

// ─── Parse / Serialize ────────────────────────────────────────────────────────

function unescapeXmlAttr(s: string): string {
    return s
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function escXmlAttr(s: string): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\t/g, '&#9;')
        .replace(/\n/g, '&#10;')
        .replace(/\r/g, '&#13;');
}

function parseXmlAttr(attrs: string): Record<string, string> {
    const result: Record<string, string> = {};
    const re = /([\w.]+)\s*=\s*"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrs)) !== null) result[m[1]] = unescapeXmlAttr(m[2]);
    return result;
}

export function parseTqsq(xml: string): SQLQuery | null {
    try {
        const openTagMatch = xml.match(/<SQLQuery\s+([^>]+)>/);
        if (openTagMatch) {
            const a = parseXmlAttr(openTagMatch[1]);
            const query = a['Query'] ?? a['FixedQuery'] ?? '';
            const usedInSql = new Set<number>();
            const paramRef = /\[Param\.(\d+)\]/g;
            let m: RegExpExecArray | null;
            while ((m = paramRef.exec(query)) !== null) usedInSql.add(parseInt(m[1]));
            const params: QueryParam[] = [];
            for (let i = 1; i <= 32; i++) {
                const value = a[`Param.${i}`] ?? '';
                const description = a[`ParamDescription.${i}`] ?? '';
                const type = a[`ParamType.${i}`] || 'String';
                if (usedInSql.has(i) || value !== '' || description !== '') {
                    params.push({ index: i, value, description, type });
                }
            }
            const childrenMatch = xml.match(/<SQLQuery[^>]*>([\s\S]*)<\/SQLQuery>/);
            const rawChildren = childrenMatch ? childrenMatch[1] : '<Tasks/><ETCServers/><ETCObjects/>';
            return {
                id: a['ID'] ?? '', pathId: a['PathID'] ?? '',
                server: a['Server'] ?? a['server'] ?? '',
                mode: a['Mode'] ?? a['mode'] ?? 'FixedQuery',
                saveDate: a['SaveDate'] ?? '', version: a['Version'] ?? a['version'] ?? '',
                readerRoles: a['ReaderRoles'] ?? a['readerRoles'] ?? '',
                writerRoles: a['WriterRoles'] ?? a['writerRoles'] ?? '',
                rowCount: parseInt(a['RowCount'] ?? a['rowCount'] ?? '500') || 500,
                query, params, _rawAttrs: a, _rawChildren: rawChildren,
            };
        }
        console.error('[MiiSync] parseTqsq: no SQLQuery root element:', xml.substring(0, 200));
        return null;
    } catch (e: any) {
        console.error('[MiiSync] parseTqsq exception:', e);
        return null;
    }
}

export function serializeTqsq(q: SQLQuery): string {
    const attrs: Record<string, string> = { ...(q._rawAttrs || {}) };
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateStr = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    attrs['Server'] = q.server; attrs['Mode'] = q.mode;
    attrs['RowCount'] = String(q.rowCount); attrs['Query'] = q.query;
    attrs['SaveDate'] = dateStr; attrs['ReaderRoles'] = q.readerRoles;
    attrs['WriterRoles'] = q.writerRoles;
    if (q.version) attrs['Version'] = q.version;
    for (let i = 1; i <= 32; i++) {
        const p = q.params.find(p => p.index === i);
        attrs[`Param.${i}`] = p?.value ?? '';
        attrs[`ParamDescription.${i}`] = p?.description ?? '';
        attrs[`ParamType.${i}`] = p?.type ?? '';
    }
    if (!q._rawAttrs) {
        attrs['DocType'] = 'SQLQuery'; attrs['ID'] = ''; attrs['PathID'] = ''; attrs['FixedQuery'] = '';
    }
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${escXmlAttr(v)}"`).join(' ');
    const children = q._rawChildren ?? '<Tasks/><ETCServers/><ETCObjects/>';
    return `<?xml version="1.0" encoding="UTF-8"?><SQLQuery ${attrStr}>${children}</SQLQuery>`;
}

export function defaultTqsqXml(): string {
    return serializeTqsq({
        id: '', pathId: '', server: '', mode: 'FixedQuery', saveDate: '',
        version: '', readerRoles: '', writerRoles: '', rowCount: 500, query: '', params: [],
        _rawAttrs: { DocType: 'SQLQuery', ID: '', PathID: '', Version: '', ReaderRoles: '', WriterRoles: '' },
        _rawChildren: '<Tasks/><ETCServers/><ETCObjects/>',
    });
}

const DEFAULT_HIDDEN_PREFIXES = ['BC_','CMST_','CR_','EP_','IDP_','ITSAM_','J2EE_','JPL_','MPM_','SAML2_','SEC_','SMET_','SR_','TC_','UME_','XI_','XMII_'];

// ─── Provider ─────────────────────────────────────────────────────────────────

export class TqsqEditorProvider implements vscode.CustomEditorProvider<TqsqDocument> {
    public static readonly viewType = 'miisync.tqsqEditor';

    private readonly _panels = new Map<string, vscode.WebviewPanel>();
    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<TqsqDocument>>();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    public static register(_context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            TqsqEditorProvider.viewType,
            new TqsqEditorProvider(),
            { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
        );
    }

    async openCustomDocument(uri: vscode.Uri, _openContext: vscode.CustomDocumentOpenContext, _token: vscode.CancellationToken): Promise<TqsqDocument> {
        if (uri.scheme === 'untitled') {
            return new TqsqDocument(uri, defaultTqsqXml());
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        return new TqsqDocument(uri, new TextDecoder('utf-8').decode(bytes));
    }

    async resolveCustomEditor(document: TqsqDocument, panel: vscode.WebviewPanel, _token: vscode.CancellationToken): Promise<void> {
        panel.webview.options = { enableScripts: true };
        const uriKey = document.uri.toString();
        this._panels.set(uriKey, panel);
        panel.onDidDispose(() => this._panels.delete(uriKey));

        const init = async (xml?: string) => {
            try {
                const content = xml ?? document.content;
                const data = parseTqsq(content);
                const fileName = path.basename(document.uri.fsPath);
                let servers: string[] = [];
                const system = configManager.CurrentSystem;
                if (system) {
                    const list = await illuminatorService.getSQLServerList(system).catch(() => []);
                    servers = list.map(s => s.name);
                }
                const hiddenPrefixes = vscode.workspace.getConfiguration('miisync').get<string[]>('tqsqHiddenTablePrefixes', DEFAULT_HIDDEN_PREFIXES);
                panel.webview.html = buildHtml(data, fileName, servers, document.uri.scheme === 'untitled', hiddenPrefixes);
            } catch (e: any) {
                panel.webview.html = `<!DOCTYPE html><html><body style="padding:20px;color:#f48771;font-family:monospace;background:#1e1e1e"><h3>Erro</h3><pre>${String(e?.message ?? e)}</pre></body></html>`;
            }
        };

        panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'edit': {
                    document.updateContent(serializeTqsq(msg.data as SQLQuery));
                    this._onDidChangeCustomDocument.fire({ document });
                    break;
                }
                case 'save': {
                    document.updateContent(serializeTqsq(msg.data as SQLQuery));
                    await vscode.commands.executeCommand('workbench.action.files.save');
                    break;
                }
                case 'upload': {
                    const xml = serializeTqsq(msg.data as SQLQuery);
                    document.updateContent(xml);
                    await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(xml));
                    const system = configManager.CurrentSystem;
                    if (!system) { panel.webview.postMessage({ type: 'uploadResult', ok: false, error: 'Não conectado' }); break; }
                    let remotePath = GetRemotePath(document.uri.fsPath, configManager.Config, false).replace(/\.tqsq$/i, '');
                    const result = await miiCatalogService.saveQuery(system, remotePath, xml);
                    panel.webview.postMessage({ type: 'uploadResult', ok: result.ok, error: result.error });
                    break;
                }
                case 'testQuery': {
                    const system = configManager.CurrentSystem;
                    if (!system) { panel.webview.postMessage({ type: 'testResult', ok: false, error: 'Não conectado' }); break; }
                    const q = msg.data as SQLQuery;
                    const testValues: Record<number, string> = {};
                    for (const p of q.params) testValues[p.index] = p.value;
                    let result: QueryTestResult;
                    if (document.uri.scheme === 'untitled') {
                        result = await runAdHocQuery(system, serializeTqsq(q), testValues);
                    } else {
                        const remotePath = GetRemotePath(document.uri.fsPath, configManager.Config, false).replace(/\.tqsq$/i, '');
                        if (!remotePath) { panel.webview.postMessage({ type: 'testResult', ok: false, error: 'Caminho remoto não encontrado' }); break; }
                        result = await runQueryTest(system, remotePath, serializeTqsq(q), testValues);
                    }
                    panel.webview.postMessage({ type: 'testResult', ok: !result.error, ...result });
                    break;
                }
                case 'loadServers': {
                    const system = configManager.CurrentSystem;
                    if (!system) { panel.webview.postMessage({ type: 'servers', servers: [] }); break; }
                    const list = await illuminatorService.getSQLServerList(system).catch(() => []);
                    panel.webview.postMessage({ type: 'servers', servers: list.map(s => s.name) });
                    break;
                }
                case 'loadModes': {
                    const system = configManager.CurrentSystem;
                    if (!system || !msg.server) { panel.webview.postMessage({ type: 'modes', modes: [] }); break; }
                    const modes = await illuminatorService.getServerModes(system, msg.server).catch(() => []);
                    panel.webview.postMessage({ type: 'modes', modes });
                    break;
                }
                case 'loadTables': {
                    const system = configManager.CurrentSystem;
                    if (!system || !msg.server) { panel.webview.postMessage({ type: 'tables', tables: [] }); break; }
                    const tables = await illuminatorService.getTableList(system, msg.server).catch(() => []);
                    panel.webview.postMessage({ type: 'tables', tables });
                    break;
                }
                case 'loadColumns': {
                    const system = configManager.CurrentSystem;
                    if (!system || !msg.server || !msg.table) { panel.webview.postMessage({ type: 'columns', columns: [], table: msg.table }); break; }
                    const columns = await illuminatorService.getColumnList(system, msg.server, msg.table).catch(() => []);
                    panel.webview.postMessage({ type: 'columns', columns, table: msg.table });
                    break;
                }
                case 'saveHiddenPrefixes': {
                    await vscode.workspace.getConfiguration('miisync').update('tqsqHiddenTablePrefixes', msg.prefixes, vscode.ConfigurationTarget.Global);
                    break;
                }
            }
        });

        await init();
    }

    async saveCustomDocument(document: TqsqDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(document.content));
        this._panels.get(document.uri.toString())?.webview.postMessage({ type: 'saveResult', ok: true });
    }

    async saveCustomDocumentAs(document: TqsqDocument, destination: vscode.Uri, _cancellation: vscode.CancellationToken): Promise<void> {
        await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(document.content));
    }

    async revertCustomDocument(document: TqsqDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        try {
            const bytes = await vscode.workspace.fs.readFile(document.uri);
            const content = new TextDecoder('utf-8').decode(bytes);
            document.updateContent(content);
            const panel = this._panels.get(document.uri.toString());
            if (panel) panel.webview.postMessage({ type: 'reload', data: parseTqsq(content) });
        } catch {}
    }

    async backupCustomDocument(document: TqsqDocument, context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        await vscode.workspace.fs.writeFile(context.destination, new TextEncoder().encode(document.content));
        return { id: context.destination.toString(), delete: async () => { try { await vscode.workspace.fs.delete(context.destination); } catch {} } };
    }
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildHtml(data: SQLQuery | null, fileName: string, servers: string[], isUntitled = false, hiddenPrefixes: string[] = DEFAULT_HIDDEN_PREFIXES): string {
    const safeData = JSON.stringify(data ?? null).replace(/</g, '\\u003C').replace(/>/g, '\\u003E');
    const safeServers = JSON.stringify(servers).replace(/</g, '\\u003C').replace(/>/g, '\\u003E');
    const safeHidden = JSON.stringify(hiddenPrefixes).replace(/</g, '\\u003C').replace(/>/g, '\\u003E');
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>${CSS}</style>
</head>
<body>
<div id="app"><div style="padding:20px;color:#888;font-family:monospace">Carregando...</div></div>
<script>
window.onerror=function(msg,url,line,col,err){document.getElementById('app').innerHTML='<div style="padding:20px;color:#f48771;font-family:monospace;white-space:pre-wrap"><b>Erro JS:</b><br>'+msg+'<br>Linha: '+line+'<br>'+(err&&err.stack||'')+'</div>';return true;};
</script>
<script>
const vscode=acquireVsCodeApi();
let DATA=${safeData};
let SERVERS=${safeServers};
const FILE_NAME=${JSON.stringify(fileName)};
const IS_UNTITLED=${JSON.stringify(isUntitled)};
const HIDDEN_PREFIXES=${safeHidden};
${JS}
</script>
</body>
</html>`;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family,'Segoe UI',sans-serif);font-size:13px;background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-editor-foreground,#d4d4d4);display:flex;flex-direction:column;height:100vh;overflow:hidden}
#app{display:flex;flex-direction:column;height:100%;overflow:hidden}

.header{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:var(--vscode-titleBar-activeBackground,#3c3c3c);border-bottom:1px solid var(--vscode-panel-border,#444);flex-shrink:0;flex-wrap:wrap;gap:6px}
.header-title{font-size:13px;font-weight:700;color:var(--vscode-titleBar-activeForeground,#ccc)}
.header-title.dirty{color:#e9d89e}
.header-actions{display:flex;gap:6px;align-items:center}

.settings-bar{display:flex;gap:12px;padding:7px 14px;background:var(--vscode-editorGroupHeader-tabsBackground,#252526);border-bottom:1px solid var(--vscode-panel-border,#444);flex-shrink:0;align-items:center;flex-wrap:wrap}
.settings-bar label{display:flex;align-items:center;gap:6px;font-size:11px;color:#888}
.settings-bar select,.settings-bar input{background:var(--vscode-input-background,#3c3c3c);color:var(--vscode-input-foreground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:3px;padding:3px 7px;font-size:12px;outline:none}
.settings-bar select:focus,.settings-bar input:focus{border-color:var(--vscode-focusBorder,#007acc)}
.settings-bar input[type=number]{width:70px}
.status-dot{width:8px;height:8px;border-radius:50%;background:#555;flex-shrink:0}
.status-dot.online{background:#4caf50}

.content-wrap{display:flex;flex:1;overflow:hidden;min-height:0}
.editor-body{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}

/* ── SQL Editor ─────────────────────────────── */
.sql-section{display:flex;flex-direction:column;flex:1 1 200px;min-height:120px;border-bottom:1px solid var(--vscode-panel-border,#444)}
.section-header{display:flex;align-items:center;justify-content:space-between;padding:5px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#888;background:var(--vscode-editorGroupHeader-tabsBackground,#252526);flex-shrink:0;border-bottom:1px solid #333}
.sql-editor-wrap{display:flex;flex:1;overflow:hidden;min-height:0}
.line-nums{background:#1a1a1a;color:#4a5568;padding:10px 8px 10px 10px;text-align:right;font-family:var(--vscode-editor-font-family,'Consolas',monospace);font-size:13px;line-height:1.5;user-select:none;min-width:44px;border-right:1px solid #2d2d2d;overflow:hidden;flex-shrink:0}
.line-nums div{height:19.5px;line-height:19.5px;font-size:12px;white-space:nowrap}
.sql-inner{position:relative;flex:1;overflow:hidden}
.sql-highlight,.sql-textarea{position:absolute;top:0;left:0;right:0;bottom:0;padding:10px 14px;font-family:var(--vscode-editor-font-family,'Consolas',monospace);font-size:13px;line-height:1.5;tab-size:4;-moz-tab-size:4;white-space:pre;word-wrap:normal;overflow:auto;box-sizing:border-box;margin:0;border:none}
.sql-highlight{color:var(--vscode-editor-foreground,#d4d4d4);pointer-events:none;z-index:0;overflow:hidden}
.sql-textarea{background:transparent;color:transparent;caret-color:var(--vscode-editor-foreground,#d4d4d4);resize:none;outline:none;z-index:1;-webkit-text-fill-color:transparent}
.sql-kw{color:#569cd6}
.sql-str{color:#ce9178}
.sql-comment{color:#6a9955;font-style:italic}
.sql-num{color:#b5cea8}
.sql-param{color:#d7ba7d}
.sql-fn{color:#dcdcaa}
.sql-bi{color:#c586c0}

/* ── Params ──────────────────────────────────── */
.params-section{flex:0 0 auto;max-height:220px;overflow-y:auto;border-bottom:1px solid var(--vscode-panel-border,#444)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:4px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#888;background:#252526;border-bottom:1px solid #333;position:sticky;top:0;z-index:1}
td{padding:4px 8px;border-bottom:1px solid #2a2a2a;vertical-align:middle}
tr:hover td{background:#2a2d2e}
.param-input{background:var(--vscode-input-background,#3c3c3c);color:var(--vscode-input-foreground,#ccc);border:1px solid transparent;border-radius:2px;padding:2px 6px;font-size:12px;outline:none;width:100%;font-family:inherit}
.param-input:focus{border-color:var(--vscode-focusBorder,#007acc)}
.param-idx{font-size:11px;color:#666;text-align:center;width:28px}
.type-sel{background:var(--vscode-input-background,#3c3c3c);color:var(--vscode-input-foreground,#ccc);border:1px solid transparent;border-radius:2px;padding:2px 4px;font-size:11px;outline:none}
.btn-del-param{background:none;border:none;color:#c05050;cursor:pointer;font-size:13px;line-height:1;padding:0 4px;border-radius:2px}
.btn-del-param:hover{background:rgba(200,0,0,0.12);color:#ff5555}
.empty-params{padding:12px 14px;color:#666;font-style:italic;font-size:12px}
.param-ref{font-family:monospace;font-size:10px;color:#569cd6;background:#1e2a3a;padding:1px 4px;border-radius:2px;white-space:nowrap}

/* ── Actions ─────────────────────────────────── */
.actions-bar{display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--vscode-editorGroupHeader-tabsBackground,#252526);border-bottom:1px solid var(--vscode-panel-border,#444);flex-shrink:0;flex-wrap:wrap}
.btn{padding:5px 14px;border-radius:3px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid;transition:background 0.12s}
.btn:disabled{opacity:0.4;cursor:default}
.btn-primary{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border-color:var(--vscode-button-background,#0e639c)}
.btn-primary:hover:not(:disabled){background:var(--vscode-button-hoverBackground,#1177bb)}
.btn-secondary{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border-color:#555}
.btn-secondary:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground,#505357)}
.btn-run{background:#1a4a1a;color:#6dbf6d;border-color:#2d7a2d;padding:5px 18px}
.btn-run:hover:not(:disabled){background:#1e5c1e}
.btn-sm{padding:3px 10px;font-size:11px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:#ccc;border:1px solid #555;border-radius:3px;cursor:pointer}
.btn-sm:hover{background:#505357}
.action-sep{flex:1}
.status-msg{font-size:11px;color:#888;font-style:italic}
.status-msg.ok{color:#4ec9b0}
.status-msg.err{color:#f48771}

/* ── Results ─────────────────────────────────── */
.results-section{flex:0 0 auto;display:flex;flex-direction:column;max-height:320px;min-height:120px;overflow:hidden}
.results-header{display:flex;align-items:center;gap:8px;padding:5px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#888;background:#252526;border-bottom:1px solid #333;flex-shrink:0;flex-wrap:wrap}
.results-count{background:#1a3a50;color:#5ab8e2;padding:1px 8px;border-radius:10px;font-size:10px}
.results-time{color:#777;font-size:10px}
.results-filter{background:var(--vscode-input-background,#3c3c3c);color:var(--vscode-input-foreground,#ccc);border:1px solid #555;border-radius:3px;padding:2px 8px;font-size:11px;outline:none;width:150px;margin-left:auto}
.results-filter:focus{border-color:var(--vscode-focusBorder,#007acc)}
.results-wrap{flex:1;overflow:auto}
.results-table{width:max-content;min-width:100%;border-collapse:collapse;font-size:12px}
.results-table th{padding:4px 10px;font-size:10px;font-weight:700;text-transform:uppercase;color:#888;background:#252526;border-bottom:1px solid #333;position:sticky;top:0;white-space:nowrap}
.results-table td{padding:3px 10px;border-bottom:1px solid #222;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis;font-family:monospace;font-size:11px}
.results-table tr:hover td{background:#2a2d2e}
.results-table td:first-child{color:#888;background:#1e1e20;min-width:40px;text-align:right}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid #444;border-top-color:#5ab8e2;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.error-box{padding:10px 14px;color:#f48771;font-size:12px;font-family:monospace}

/* ── Schema ── Two side-by-side panels ──────── */
.schema-tables-panel,.schema-cols-panel{display:flex;flex-direction:column;border-left:1px solid var(--vscode-panel-border,#444);background:var(--vscode-sideBar-background,#252526);flex-shrink:0;overflow:hidden}
.schema-tables-panel{width:190px}
.schema-cols-panel{width:165px;background:var(--vscode-editor-background,#1e1e1e)}
.schema-panel-hdr{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#888;border-bottom:1px solid #333;flex-shrink:0}
.schema-search-wrap{padding:6px 8px;border-bottom:1px solid #2a2a2a;flex-shrink:0}
.schema-search{width:100%;background:var(--vscode-input-background,#3c3c3c);color:var(--vscode-input-foreground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:3px;padding:4px 7px;font-size:11px;outline:none;box-sizing:border-box}
.schema-search:focus{border-color:var(--vscode-focusBorder,#007acc)}
.schema-body{flex:1;overflow-y:auto}
.schema-item{padding:3px 10px;font-size:11px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--vscode-editor-font-family,'Consolas',monospace);line-height:1.7}
.schema-item:hover{background:rgba(255,255,255,0.07)}
.schema-item.tbl{color:#9cdcfe;display:flex;align-items:center;overflow:visible}
.schema-item.tbl.sel{background:rgba(0,122,204,0.2);color:#5ab8e2}
.schema-item.col{color:#ce9178}
.tbl-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn-quick-select{background:none;border:none;color:#4ec9b0;cursor:pointer;font-size:11px;padding:0 4px;border-radius:2px;opacity:0;transition:opacity 0.12s;flex-shrink:0;line-height:1}
.schema-item.tbl:hover .btn-quick-select{opacity:1}
.schema-item[draggable="true"]{cursor:grab}
.schema-item[draggable="true"]:active{cursor:grabbing}
.schema-loading{padding:10px;color:#555;font-size:11px;text-align:center;font-style:italic}
.btn-schema-on{background:rgba(0,122,204,0.25)!important;border-color:#007acc!important;color:#5ab8e2!important}
.sort-hdr{cursor:pointer;user-select:none;white-space:nowrap}
.sort-hdr:hover{background:#2a2d2e;color:#ccc}
.prefix-filter-panel{border-bottom:1px solid #2a2a2a;padding:5px 8px;background:#1a1a1a;flex-shrink:0}
.prefix-filter-title{font-size:10px;color:#666;display:block;margin-bottom:4px}
.prefix-filter-body{display:flex;flex-wrap:wrap;gap:3px 8px;max-height:110px;overflow-y:auto}
.pfx-item{display:flex;align-items:center;gap:3px;font-size:10px;cursor:pointer;color:#9cdcfe;white-space:nowrap;padding:1px 0}
.pfx-item input[type=checkbox]{margin:0;cursor:pointer;accent-color:#c586c0;width:11px;height:11px}
`;

// ─── JavaScript ──────────────────────────────────────────────────────────────

const JS = `
const PARAM_TYPES=['String','Integer','Float','DateTime','Boolean'];
const MODES=['FixedQuery','FixedQueryWithOutput','Query','Command'];

let state=DATA?{...DATA,params:(DATA.params||[]).map(p=>({...p}))}:{id:'',pathId:'',server:'',mode:'FixedQuery',saveDate:'',version:'',readerRoles:'',writerRoles:'',rowCount:500,query:'',params:[]};
let servers=SERVERS||[];
let statusMsg='',statusType='';
let testRunning=false,showResults=false,lastResult=null;
let isDirty=false,editDebounce=null;
let resultsFilter='';
let sortCol=null,sortAsc=true;
let undoStack=[],redoStack=[],undoTimer=null;

function snapshotUndo(){
  const el=document.getElementById('sql-editor');
  const v=el?el.value:(state.query||'');
  if(!undoStack.length||undoStack[undoStack.length-1]!==v){
    undoStack.push(v);if(undoStack.length>200)undoStack.shift();redoStack=[];
  }
}

// Schema state
let schemaOpen=false,allTables=[],tableFilter='',selectedTable='',columnCache={},tablesLoading=false,columnsLoading=false;
let hiddenPrefixes=(HIDDEN_PREFIXES&&HIDDEN_PREFIXES.length)?[...HIDDEN_PREFIXES]:['BC_','CMST_','CR_','EP_','IDP_','ITSAM_','J2EE_','JPL_','MPM_','SAML2_','SEC_','SMET_','SR_','TC_','UME_','XI_','XMII_'];
let prefixFilterOpen=false;

function syncServerFromList(){if(!state.server&&servers.length>0)state.server=servers[0];}

function isTableVisible(t){return !hiddenPrefixes.some(p=>p&&t.toUpperCase().startsWith(p.toUpperCase()));}

function allPrefixes(){
  const s=new Set(['BC_','CMST_','CR_','EP_','IDP_','ITSAM_','J2EE_','JPL_','MPM_','SAML2_','SEC_','SMET_','SR_','TC_','UME_','XI_','XMII_'].map(p=>p.toUpperCase()));
  for(const t of allTables){const m=t.match(/^([A-Za-z0-9]+_)/);if(m)s.add(m[1].toUpperCase());}
  return [...s].sort();
}

function renderPrefixFilter(){
  const prefixes=allPrefixes();
  return\`<div class="prefix-filter-panel">
  <span class="prefix-filter-title">Prefixos ocultos (✓ = oculto)</span>
  <div class="prefix-filter-body">\${prefixes.map(p=>\`<label class="pfx-item"><input type="checkbox" class="pfx-cb" data-prefix="\${esc(p)}" \${hiddenPrefixes.some(h=>h.toUpperCase()===p)?'checked':''}><span>\${esc(p)}</span></label>\`).join('')}</div>
</div>\`;
}

function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// ─── SQL Tokenizer ──────────────────────────────────────────────────────────
const SQL_KWDS=new Set('SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|AND|OR|NOT|IN|EXISTS|GROUP|ORDER|BY|HAVING|INSERT|UPDATE|DELETE|SET|INTO|VALUES|UNION|ALL|AS|DISTINCT|TOP|LIMIT|OFFSET|WITH|CASE|WHEN|THEN|ELSE|END|NULL|IS|LIKE|BETWEEN|CREATE|DROP|ALTER|TABLE|INDEX|VIEW|DECLARE|BEGIN|COMMIT|ROLLBACK|NOCOUNT|EXEC|EXECUTE|RETURN|OUTPUT|RETURNS|VARCHAR|INT|INTEGER|FLOAT|DECIMAL|DATE|DATETIME|BIT|CHAR|NVARCHAR|TEXT|BIGINT|SMALLINT|TINYINT|NCHAR|NUMERIC|MONEY|REAL|COLUMNS|PATH|PASSING|XMLTABLE|OVER|PARTITION|ROWS|RANGE|PIVOT|UNPIVOT|APPLY|PROCEDURE|FUNCTION|PRINT|IF|ELSE|WHILE|BREAK|CONTINUE|GOTO|THROW|TRY|CATCH'.split('|'));
const SQL_FUNS=new Set('COUNT|SUM|AVG|MIN|MAX|ISNULL|COALESCE|NULLIF|DATEADD|DATEDIFF|GETDATE|GETUTCDATE|CAST|CONVERT|SUBSTRING|CHARINDEX|LEN|LTRIM|RTRIM|TRIM|UPPER|LOWER|REPLACE|CONCAT|STUFF|FORMAT|ROUND|ABS|FLOOR|CEILING|ISDATE|ISNUMERIC|ROW_NUMBER|RANK|DENSE_RANK|NTILE|LAG|LEAD|FIRST_VALUE|LAST_VALUE|PATINDEX|YEAR|MONTH|DAY|DATEPART|DATENAME|EOMONTH|NEWID|CHECKSUM'.split('|'));
const SQL_BI=new Set('PROCEDURE|FUNCTION|TRIGGER|VIEW|IF|ELSE|WHILE|BREAK|CONTINUE|GOTO|THROW|TRY|CATCH|RAISERROR|PRINT'.split('|'));

function tokenizeSQL(code){
  const toks=[];let i=0;
  while(i<code.length){
    const ch=code[i];
    if(ch==="'"){
      let j=i+1,s="'";
      while(j<code.length){
        if(code[j]==="'"&&code[j+1]==="'"){s+="''";j+=2;}
        else if(code[j]==="'"){s+="'";j++;break;}
        else{s+=code[j++];}
      }
      toks.push({t:'str',v:s});i=j;continue;
    }
    if(ch==='-'&&code[i+1]==='-'){
      let j=i,s='';
      while(j<code.length&&code[j]!=='\\n')s+=code[j++];
      toks.push({t:'comment',v:s});i=j;continue;
    }
    if(ch==='/'&&code[i+1]==='*'){
      let j=i+2,s='/*';
      while(j<code.length){if(code[j]==='*'&&code[j+1]==='/'){s+='*/';j+=2;break;}s+=code[j++];}
      toks.push({t:'comment',v:s});i=j;continue;
    }
    if(ch==='['){
      const pm=code.slice(i).match(/^\\[Param\\.\\d+\\]/i);
      if(pm){toks.push({t:'param',v:pm[0]});i+=pm[0].length;continue;}
      let j=i+1,s='[';
      while(j<code.length&&code[j]!==']')s+=code[j++];
      if(j<code.length){s+=']';j++;}
      toks.push({t:'qi',v:s});i=j;continue;
    }
    if(/[a-zA-Z_@#]/.test(ch)){
      let j=i,s='';
      while(j<code.length&&/[\\w@#$]/.test(code[j]))s+=code[j++];
      const up=s.toUpperCase();
      const t=SQL_FUNS.has(up)?'fn':SQL_BI.has(up)?'bi':SQL_KWDS.has(up)?'kw':'id';
      toks.push({t,v:s});i=j;continue;
    }
    if(/\\d/.test(ch)||(ch==='.'&&/\\d/.test(code[i+1]||''))){
      let j=i,s='';
      while(j<code.length&&/[\\d.]/.test(code[j]))s+=code[j++];
      toks.push({t:'num',v:s});i=j;continue;
    }
    toks.push({t:'other',v:ch});i++;
  }
  return toks;
}

function highlightSQL(code){
  const e=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return tokenizeSQL(code).map(tok=>{
    const v=e(tok.v);
    switch(tok.t){
      case 'kw':return\`<span class="sql-kw">\${v}</span>\`;
      case 'fn':return\`<span class="sql-fn">\${v}</span>\`;
      case 'bi':return\`<span class="sql-bi">\${v}</span>\`;
      case 'str':return\`<span class="sql-str">\${v}</span>\`;
      case 'comment':return\`<span class="sql-comment">\${v}</span>\`;
      case 'num':return\`<span class="sql-num">\${v}</span>\`;
      case 'param':return\`<span class="sql-param">\${v}</span>\`;
      default:return v;
    }
  }).join('')+'\\n';
}

// ─── Editor helpers ─────────────────────────────────────────────────────────
let _lastLineCount=0;
function updateEditor(){
  const el=document.getElementById('sql-editor');
  const pre=document.getElementById('sql-highlight');
  const nums=document.getElementById('line-nums');
  if(!el)return;
  const code=el.value;
  if(pre)pre.innerHTML=highlightSQL(code);
  const lines=code.split('\\n').length;
  if(nums&&lines!==_lastLineCount){
    _lastLineCount=lines;
    nums.innerHTML=Array.from({length:lines},(_,i)=>\`<div>\${i+1}</div>\`).join('');
  }
}

// ─── Dirty tracking ─────────────────────────────────────────────────────────
function markDirty(){
  if(!isDirty){
    isDirty=true;
    const t=document.querySelector('.header-title');
    if(t&&!t.classList.contains('dirty'))t.classList.add('dirty');
    collectState();
    vscode.postMessage({type:'edit',data:{...state}});
  }
  clearTimeout(editDebounce);
  editDebounce=setTimeout(()=>{
    collectState();
    vscode.postMessage({type:'edit',data:{...state}});
  },800);
}

function clearDirty(){
  isDirty=false;
  clearTimeout(editDebounce);
  const t=document.querySelector('.header-title');
  if(t)t.classList.remove('dirty');
}

// ─── Render ──────────────────────────────────────────────────────────────────
function render(){
  const app=document.getElementById('app');
  const isOnline=!!(servers.length>0||state.server);
  const serverOpts=[...new Set([...servers,state.server].filter(Boolean))];

  app.innerHTML=\`
<div class="header">
  <div class="header-title\${isDirty?' dirty':''}" title="\${esc(FILE_NAME)}">\${esc(FILE_NAME)}</div>
  <div class="header-actions">
    \${statusMsg?\`<span class="status-msg \${statusType}">\${esc(statusMsg)}</span>\`:''}
    <button class="btn btn-secondary\${schemaOpen?' btn-schema-on':''}" id="btn-schema">📋 Schema</button>
    <button class="btn btn-secondary" id="btn-save">💾 Salvar</button>
    <button class="btn btn-secondary" id="btn-upload">☁ Upload</button>
  </div>
</div>
<div class="settings-bar">
  <div class="status-dot \${isOnline?'online':''}" title="\${isOnline?'Conectado':'Sem conexão'}"></div>
  <label>Servidor
    <select id="sel-server">
      \${serverOpts.map(s=>\`<option value="\${esc(s)}" \${s===state.server?'selected':''}>\${esc(s)}</option>\`).join('')}
      \${!serverOpts.includes(state.server)&&state.server?\`<option value="\${esc(state.server)}" selected>\${esc(state.server)}</option>\`:''}
    </select>
  </label>
  <label>Modo
    <select id="sel-mode">\${['FixedQuery','FixedQueryWithOutput','Query','Command'].map(m=>\`<option value="\${m}" \${m===state.mode?'selected':''}>\${m}</option>\`).join('')}</select>
  </label>
  <label>Linhas
    <input type="number" id="inp-rows" value="\${state.rowCount}" min="1" max="50000">
  </label>
  <button class="btn-sm" id="btn-reload-servers" title="Recarregar servidores">⟳</button>
</div>
<div class="content-wrap">
  <div class="editor-body">
    <div class="sql-section">
      <div class="section-header">
        <span>SQL</span>
        <span style="color:#666;font-size:10px;font-weight:400">Use [Param.N] para parâmetros</span>
      </div>
      <div class="sql-editor-wrap">
        <div class="line-nums" id="line-nums"></div>
        <div class="sql-inner">
          <pre class="sql-highlight" id="sql-highlight"></pre>
          <textarea class="sql-textarea" id="sql-editor" spellcheck="false" wrap="off">\${esc(state.query)}</textarea>
        </div>
      </div>
    </div>
    <div class="params-section">
      <div class="section-header">
        <span>Parâmetros (\${state.params.length})</span>
        <button class="btn-sm" id="btn-add-param">+ Adicionar</button>
      </div>
      \${renderParamsTable()}
    </div>
    <div class="actions-bar">
      <button class="btn btn-run" id="btn-test" \${testRunning?'disabled':''}>
        \${testRunning?'<span class="spinner"></span>Executando...':'▶ Salvar e Testar'}
      </button>
      <span class="action-sep"></span>
      <span style="font-size:10px;color:#666">v\${esc(state.version||'?')}</span>
    </div>
    \${showResults&&lastResult?renderResults():''}
  </div>
  \${schemaOpen?renderSchemaTablesPanel():''}
  \${schemaOpen&&selectedTable?renderSchemaColsPanel():''}
</div>\`;

  bindEvents();
  updateEditor();
}

function renderParamsTable(){
  if(!state.params.length)return\`<div class="empty-params">Nenhum parâmetro. Adicione ou use [Param.1] no SQL.</div>\`;
  return\`<table><thead><tr><th class="param-idx">#</th><th>Valor de Teste</th><th>Descrição</th><th>Tipo</th><th></th></tr></thead>
  <tbody>\${state.params.map(p=>\`<tr data-idx="\${p.index}">
    <td class="param-idx"><span class="param-ref">[Param.\${p.index}]</span></td>
    <td><input class="param-input" data-field="value" value="\${esc(p.value)}" placeholder="valor de teste..."></td>
    <td><input class="param-input" data-field="description" value="\${esc(p.description)}" placeholder="descrição..."></td>
    <td><select class="type-sel" data-field="type">\${PARAM_TYPES.map(t=>\`<option \${t===p.type?'selected':''}>\${t}</option>\`).join('')}</select></td>
    <td><button class="btn-del-param" data-idx="\${p.index}">✕</button></td>
  </tr>\`).join('')}</tbody></table>\`;
}

function renderResults(){
  if(lastResult.error)return\`<div class="results-section"><div class="error-box">❌ \${esc(lastResult.error)}</div></div>\`;
  const cols=lastResult.columns||[],rows=lastResult.rows||[];
  let filtered=resultsFilter?rows.filter(r=>cols.some(c=>String(r[c]??'').toLowerCase().includes(resultsFilter.toLowerCase()))):rows;
  if(sortCol){
    filtered=[...filtered].sort((a,b)=>{
      const va=String(a[sortCol]??''),vb=String(b[sortCol]??'');
      const na=parseFloat(va),nb=parseFloat(vb);
      const cmp=(!isNaN(na)&&!isNaN(nb))?(na-nb):va.localeCompare(vb);
      return sortAsc?cmp:-cmp;
    });
  }
  const count=lastResult.rowCount||rows.length,ms=lastResult.executionTimeMs||0;
  return\`<div class="results-section">
    <div class="results-header">
      <span>Resultado</span>
      <span class="results-count">\${filtered.length}\${filtered.length!==count?' filtrado de '+count:' linhas'}</span>
      <span class="results-time">\${ms}ms</span>
      <button class="btn-sm" id="btn-export">⬇ CSV</button>
      <input class="results-filter" id="results-filter" placeholder="Filtrar resultados..." value="\${esc(resultsFilter)}">
    </div>
    <div class="results-wrap">
      <table class="results-table">
        <thead><tr><th>#</th>\${cols.map(c=>\`<th class="sort-hdr" data-col="\${esc(c)}">\${esc(c)}\${sortCol===c?(sortAsc?' ↑':' ↓'):''}</th>\`).join('')}</tr></thead>
        <tbody>\${filtered.slice(0,1000).map((r,i)=>\`<tr><td>\${i+1}</td>\${cols.map(c=>\`<td title="\${esc(String(r[c]??''))}">\${esc(String(r[c]??''))}</td>\`).join('')}</tr>\`).join('')}</tbody>
      </table>
      \${filtered.length>1000?\`<div style="padding:6px 14px;color:#888;font-size:11px">Exibindo 1000 de \${filtered.length} linhas</div>\`:''}
    </div>
  </div>\`;
}

function renderSchemaTablesPanel(){
  const searched=tableFilter?allTables.filter(t=>t.toLowerCase().includes(tableFilter.toLowerCase())):allTables;
  const filt=searched.filter(t=>isTableVisible(t));
  const hiddenCount=allTables.length-allTables.filter(t=>isTableVisible(t)).length;
  let body='';
  if(tablesLoading)body='<div class="schema-loading">Carregando tabelas...</div>';
  else if(!state.server)body='<div class="schema-loading">Selecione um servidor</div>';
  else if(filt.length===0)body=\`<div class="schema-loading">\${allTables.length===0?'Clique ⟳ para carregar':'Sem resultados'}</div>\`;
  else body=filt.map(t=>\`<div class="schema-item tbl \${t===selectedTable?'sel':''}" data-table="\${esc(t)}" draggable="true" title="\${esc(t)} — clique: colunas | arrastar: inserir"><span class="tbl-name">\${esc(t)}</span><button class="btn-quick-select" data-table="\${esc(t)}" title="SELECT * FROM \${esc(t)}">▶</button></div>\`).join('');
  return\`<div class="schema-tables-panel">
  <div class="schema-panel-hdr">
    <span>Tabelas (\${filt.length}\${hiddenCount>0?\` <span style="color:#666;font-size:9px">+\${hiddenCount} ocultas</span>\`:''}</span>
    <div style="display:flex;gap:4px">
      <button class="btn-sm\${prefixFilterOpen?' btn-schema-on':''}" id="btn-prefix-filter" title="Ocultar por prefixo">⊟</button>
      <button class="btn-sm" id="btn-reload-tables" title="Recarregar">⟳</button>
      <button class="btn-sm" id="btn-close-schema">✕</button>
    </div>
  </div>
  <div class="schema-search-wrap">
    <input class="schema-search" id="schema-search" placeholder="Filtrar tabelas..." value="\${esc(tableFilter)}">
  </div>
  \${prefixFilterOpen?renderPrefixFilter():''}
  <div class="schema-body">\${body}</div>
</div>\`;
}

function renderSchemaColsPanel(){
  const cols=columnCache[selectedTable]||[];
  let body='';
  if(columnsLoading)body='<div class="schema-loading">Carregando...</div>';
  else if(cols.length===0)body='<div class="schema-loading">Sem colunas</div>';
  else body=cols.map(c=>\`<div class="schema-item col" data-col="\${esc(c)}" draggable="true" title="\${esc(c)} — clique ou arrastar: inserir \${esc(selectedTable)}.\${esc(c)}">\${esc(c)}</div>\`).join('');
  return\`<div class="schema-cols-panel">
  <div class="schema-panel-hdr">
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px" title="\${esc(selectedTable)}">\${esc(selectedTable)}</span>
    <button class="btn-sm" id="btn-close-cols" title="Fechar colunas">✕</button>
  </div>
  <div class="schema-body">\${body}</div>
</div>\`;
}

// ─── State collection ────────────────────────────────────────────────────────
function collectState(){
  const el=id=>document.getElementById(id);
  if(el('sql-editor'))state.query=el('sql-editor').value;
  if(el('sel-server'))state.server=el('sel-server').value;
  if(el('sel-mode'))state.mode=el('sel-mode').value;
  if(el('inp-rows'))state.rowCount=parseInt(el('inp-rows').value)||500;
  document.querySelectorAll('#app tbody tr[data-idx]').forEach(row=>{
    const idx=parseInt(row.dataset.idx);
    const p=state.params.find(p=>p.index===idx);
    if(!p)return;
    row.querySelectorAll('[data-field]').forEach(el2=>{p[el2.dataset.field]=el2.value;});
  });
}

function insertAtCursor(text){
  const el=document.getElementById('sql-editor');
  if(!el)return;
  snapshotUndo();
  el.focus();
  document.execCommand('insertText',false,text);
  state.query=el.value;
  updateEditor();
  markDirty();
}

// ─── Event binding ───────────────────────────────────────────────────────────
function bindEvents(){
  const g=id=>document.getElementById(id);

  g('btn-save')?.addEventListener('click',()=>{
    collectState();
    vscode.postMessage({type:'save',data:{...state}});
    setStatus('Salvando...','');
  });

  g('btn-upload')?.addEventListener('click',()=>{
    collectState();
    vscode.postMessage({type:'upload',data:{...state}});
    setStatus('Enviando...','');
  });

  g('btn-test')?.addEventListener('click',()=>{
    collectState();
    testRunning=true;render();
    vscode.postMessage({type:'testQuery',data:{...state}});
  });
  g('btn-reload-servers')?.addEventListener('click',()=>vscode.postMessage({type:'loadServers'}));

  g('btn-add-param')?.addEventListener('click',()=>{
    collectState();
    const next=state.params.length>0?Math.max(...state.params.map(p=>p.index))+1:1;
    state.params.push({index:next,value:'',description:'',type:'String'});
    render();
  });

  g('btn-export')?.addEventListener('click',()=>{
    if(!lastResult?.columns?.length)return;
    const cols=lastResult.columns;
    const rows=lastResult.rows;
    let csv=cols.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')+'\\n';
    csv+=rows.map(r=>cols.map(c=>'"'+String(r[c]??'').replace(/"/g,'""')+'"').join(',')).join('\\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download='query_result.csv';a.click();
  });

  g('results-filter')?.addEventListener('input',function(){
    resultsFilter=this.value;
    const pos=this.selectionStart;
    const rs=document.querySelector('.results-section');
    if(rs){rs.outerHTML=renderResults();bindSortHeaders();}
    bindResultsFilter(pos);
  });
  bindSortHeaders();

  document.querySelectorAll('.btn-del-param').forEach(btn=>{
    btn.addEventListener('click',()=>{
      collectState();
      state.params=state.params.filter(p=>p.index!==parseInt(btn.dataset.idx));
      render();
    });
  });

  // SQL textarea
  const sqEl=g('sql-editor');
  if(sqEl){
    sqEl.addEventListener('input',()=>{
      state.query=sqEl.value;updateEditor();markDirty();
      clearTimeout(undoTimer);
      undoTimer=setTimeout(()=>{
        const v=sqEl.value;
        if(!undoStack.length||undoStack[undoStack.length-1]!==v){
          undoStack.push(v);if(undoStack.length>200)undoStack.shift();redoStack=[];
        }
      },500);
    });
    sqEl.addEventListener('scroll',()=>{
      const pre=g('sql-highlight'),nums=g('line-nums');
      if(pre){pre.scrollTop=sqEl.scrollTop;pre.scrollLeft=sqEl.scrollLeft;}
      if(nums)nums.scrollTop=sqEl.scrollTop;
    });
    sqEl.addEventListener('keydown',e=>{
      const ctrl=e.ctrlKey||e.metaKey;
      if(ctrl&&!e.shiftKey&&e.key.toLowerCase()==='z'){
        e.preventDefault();e.stopPropagation();
        clearTimeout(undoTimer);
        const cur=sqEl.value;
        if(undoStack.length&&undoStack[undoStack.length-1]!==cur){
          redoStack.push(cur);
        } else if(undoStack.length>1){
          redoStack.push(undoStack.pop());
        }
        if(undoStack.length){
          sqEl.value=undoStack[undoStack.length-1];
          state.query=sqEl.value;updateEditor();
        }
        return;
      }
      if(ctrl&&(e.key.toLowerCase()==='y'||(e.shiftKey&&e.key.toLowerCase()==='z'))){
        e.preventDefault();e.stopPropagation();
        if(redoStack.length){
          clearTimeout(undoTimer);
          const cur=sqEl.value;
          if(!undoStack.length||undoStack[undoStack.length-1]!==cur){
            undoStack.push(cur);if(undoStack.length>200)undoStack.shift();
          }
          sqEl.value=redoStack.pop();
          state.query=sqEl.value;updateEditor();
        }
        return;
      }
      if(e.key==='Tab'){
        e.preventDefault();
        snapshotUndo();
        document.execCommand('insertText',false,'\\t');
        state.query=sqEl.value;updateEditor();markDirty();
      }
    });
    sqEl.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
    sqEl.addEventListener('drop',e=>{
      e.preventDefault();
      const text=e.dataTransfer.getData('text/plain');
      if(!text)return;
      snapshotUndo();
      sqEl.focus();
      document.execCommand('insertText',false,text);
      state.query=sqEl.value;
      updateEditor();markDirty();
    });
  }

  document.querySelectorAll('.param-input,.type-sel').forEach(el=>{
    el.addEventListener('change',()=>markDirty());
  });

  g('sel-server')?.addEventListener('change',function(){
    state.server=this.value;
    allTables=[];columnCache={};selectedTable='';
    if(schemaOpen){tablesLoading=true;vscode.postMessage({type:'loadTables',server:this.value});}
    vscode.postMessage({type:'loadModes',server:this.value});
    render();
  });
  g('sel-mode')?.addEventListener('change',function(){state.mode=this.value;markDirty();});
  g('inp-rows')?.addEventListener('change',function(){state.rowCount=parseInt(this.value)||500;markDirty();});

  // Schema events
  g('btn-schema')?.addEventListener('click',()=>{
    schemaOpen=!schemaOpen;
    if(schemaOpen&&allTables.length===0&&state.server){tablesLoading=true;vscode.postMessage({type:'loadTables',server:state.server});}
    render();
  });
  g('btn-close-schema')?.addEventListener('click',()=>{schemaOpen=false;selectedTable='';render();});
  g('btn-close-cols')?.addEventListener('click',()=>{selectedTable='';render();});
  g('btn-reload-tables')?.addEventListener('click',()=>{
    allTables=[];columnCache={};selectedTable='';tablesLoading=true;
    vscode.postMessage({type:'loadTables',server:state.server});render();
  });
  g('btn-prefix-filter')?.addEventListener('click',()=>{prefixFilterOpen=!prefixFilterOpen;render();});
  document.querySelectorAll('.pfx-cb').forEach(cb=>{
    cb.addEventListener('change',()=>{
      const p=cb.dataset.prefix.toUpperCase();
      if(cb.checked){if(!hiddenPrefixes.some(h=>h.toUpperCase()===p))hiddenPrefixes.push(cb.dataset.prefix);}
      else{hiddenPrefixes=hiddenPrefixes.filter(h=>h.toUpperCase()!==p);}
      vscode.postMessage({type:'saveHiddenPrefixes',prefixes:hiddenPrefixes});
      render();
    });
  });
  g('schema-search')?.addEventListener('input',function(){
    tableFilter=this.value;
    const cur=this.selectionStart;
    render();
    const el2=document.getElementById('schema-search');
    if(el2){el2.focus();el2.selectionStart=el2.selectionEnd=cur;}
  });
  document.querySelectorAll('.schema-item.tbl').forEach(el=>{
    el.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('text/plain',el.dataset.table);
      e.dataTransfer.effectAllowed='copy';
    });
    el.addEventListener('click',e=>{
      if(e.target.closest('.btn-quick-select'))return;
      const t=el.dataset.table;
      selectedTable=t;
      if(!columnCache[t]){columnsLoading=true;vscode.postMessage({type:'loadColumns',server:state.server,table:t});}
      else{columnsLoading=false;}
      render();
    });
    el.addEventListener('dblclick',e=>{
      if(e.target.closest('.btn-quick-select'))return;
      insertAtCursor(el.dataset.table);
    });
  });
  document.querySelectorAll('.btn-quick-select').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const tbl=btn.dataset.table;
      testRunning=true;showResults=true;render();
      vscode.postMessage({type:'testQuery',data:{...state,query:'SELECT TOP 100 * FROM '+tbl,params:[]}});
    });
  });
  document.querySelectorAll('.schema-item.col').forEach(el=>{
    el.addEventListener('dragstart',e=>{
      const colRef=selectedTable?selectedTable+'.'+el.dataset.col:el.dataset.col;
      e.dataTransfer.setData('text/plain',colRef);
      e.dataTransfer.effectAllowed='copy';
    });
    el.addEventListener('click',()=>{
      const colRef=selectedTable?selectedTable+'.'+el.dataset.col:el.dataset.col;
      insertAtCursor(colRef);
    });
  });
}

function bindSortHeaders(){
  document.querySelectorAll('.sort-hdr').forEach(th=>{
    th.addEventListener('click',()=>{
      const col=th.dataset.col;
      if(sortCol===col)sortAsc=!sortAsc;
      else{sortCol=col;sortAsc=true;}
      const rs=document.querySelector('.results-section');
      if(rs){rs.outerHTML=renderResults();bindResultsFilter(0);bindSortHeaders();}
    });
  });
}

function bindResultsFilter(pos){
  const el=document.getElementById('results-filter');
  if(el){el.focus();el.selectionStart=el.selectionEnd=pos||0;}
}

function setStatus(msg,type){
  statusMsg=msg;statusType=type;
  const el=document.querySelector('.status-msg');
  if(el){el.textContent=msg;el.className='status-msg '+(type||'');}
  else render();
  if(msg)setTimeout(()=>{statusMsg='';statusType='';const e2=document.querySelector('.status-msg');if(e2)e2.textContent='';},4000);
}

// ─── Extension messages ──────────────────────────────────────────────────────
window.addEventListener('message',e=>{
  const msg=e.data;
  switch(msg.type){
    case 'saveResult':
      clearDirty();
      setStatus(msg.ok?'✔ Salvo':'✘ Erro ao salvar',msg.ok?'ok':'err');
      break;
    case 'uploadResult':
      setStatus(msg.ok?'✔ Enviado':'✘ Erro: '+(msg.error||''),msg.ok?'ok':'err');
      break;
    case 'testResult':
      testRunning=false;showResults=true;lastResult=msg;
      if(msg.error)setStatus('✘ '+msg.error,'err');
      else setStatus('','');
      render();break;
    case 'servers':
      servers=msg.servers||[];syncServerFromList();render();break;
    case 'modes':
      if(msg.modes?.length){
        const sel=document.getElementById('sel-mode');
        if(sel)sel.innerHTML=msg.modes.map(m=>\`<option value="\${esc(m)}" \${m===state.mode?'selected':''}>\${m}</option>\`).join('');
      }
      break;
    case 'tables':
      allTables=msg.tables||[];tablesLoading=false;render();break;
    case 'columns':
      if(msg.table){columnCache[msg.table]=msg.columns||[];}
      columnsLoading=false;render();break;
    case 'reload':
      if(msg.data){
        state={...msg.data,params:(msg.data.params||[]).map(p=>({...p}))};
        isDirty=false;showResults=false;lastResult=null;
        undoStack=[state.query||''];redoStack=[];
        render();
      }
      break;
  }
});

syncServerFromList();
undoStack=[state.query||''];
render();
`;
