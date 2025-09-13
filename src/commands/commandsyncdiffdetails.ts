import * as vscode from "vscode";
import { System } from "../extension/system";
import { configManager } from "../modules/config";
// uso dinâmico para evitar problema de resolução
// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadRemotePreviewModule: any = () => require("../utils/remotepreview");

interface ShowSyncDifferencesArgs {
  projectPath: string;
  projectName: string;
  remotePath: string;
  diffInfo: {
    modifiedRemote: string[];
    newRemote: string[];
    removedRemote: string[];
    remoteMeta?: Record<string, { modified?: string; size?: number }>;
  };
}

export async function OnCommandShowSyncDifferences(
  args: ShowSyncDifferencesArgs
) {
  try {
    if (!args) return;
    const { projectName, diffInfo } = args;
    const panel = vscode.window.createWebviewPanel(
      "miisyncSyncDiffs",
      `Diferenças: ${projectName}`,
      vscode.ViewColumn.Active,
      { enableScripts: true }
    );

    // Ícones SVG para um visual mais limpo e profissional
    function getIcon(type: string): string {
        const icons: { [key: string]: string } = {
            new: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>`,
            modified: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM9.5 16.5l-3-3 1.06-1.06L9.5 14.38l6.94-6.94L17.5 8.5l-8 8z"/></svg>`,
            removed: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"/></svg>`,
            preview: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 12c-2.48 0-4.5-2.02-4.5-4.5S9.52 7.5 12 7.5s4.5 2.02 4.5 4.5-2.02 4.5-4.5 4.5zm0-7c-1.38 0-2.5 1.12-2.5 2.5S10.62 15 12 15s2.5-1.12 2.5-2.5S13.38 10 12 10z"/></svg>`,
            diff: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M18 13H6V11H18V13M18 7H6V9H18V7M3 21H21V19L12 15L3 19V21Z"/></svg>`
        };
        return icons[type] || '';
    }

    function esc(s: string) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    }

    function renderList(
      title: string,
      items: string[],
      type: "new" | "modified" | "removed"
    ): string {
      const total = items.length;
      return `<section class="card" data-section="${type}">
        <header class="card-header">
            <h3 class="card-title">
                <span class="icon icon-${type}">${getIcon(type)}</span>
                ${title}
                <span class="badge">${total}</span>
            </h3>
        </header>
        <div class="card-body">
            <div class="list" data-type="${type}"></div>
            <div class="pager" data-pager="${type}"></div>
        </div>
      </section>`;
    }

    panel.webview.html = `<!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset='utf-8'>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Diferenças de Sincronização</title>
        <style>
            :root {
                /* Cores baseadas no tema do VSCode */
                --font-family: var(--vscode-font-family, system-ui, sans-serif);
                --background-color: var(--vscode-editor-background, #1e1e1e);
                --foreground-color: var(--vscode-editor-foreground, #d4d4d4);
                --border-color: var(--vscode-sideBar-border, #333);
                --card-background: var(--vscode-sideBar-background, #252526);
                --input-background: var(--vscode-input-background, #3c3c3c);
                --input-foreground: var(--vscode-input-foreground, #ccc);
                --input-border: var(--vscode-input-border, #3c3c3c);
                --button-primary-background: var(--vscode-button-background, #0e639c);
                --button-primary-foreground: var(--vscode-button-foreground, #ffffff);
                --button-secondary-background: var(--vscode-button-secondaryBackground, #3a3d41);
                --button-secondary-foreground: var(--vscode-button-secondaryForeground, #ffffff);
                --list-item-hover: rgba(128, 128, 128, 0.1);
                
                /* Cores de status */
                --color-new: #3fb950;
                --color-modified: #d29922;
                --color-removed: #f85149;

                /* Layout */
                --spacing-unit: 8px;
                --border-radius: 6px;
            }

            *, *::before, *::after {
                box-sizing: border-box;
            }

            body {
                font-family: var(--font-family);
                background-color: var(--background-color);
                color: var(--foreground-color);
                padding: calc(var(--spacing-unit) * 2);
                margin: 0;
            }

            .container {
                max-width: 900px;
                margin: 0 auto;
            }

            h1 {
                font-size: 24px;
                font-weight: 600;
                margin-bottom: calc(var(--spacing-unit) * 3);
            }
            
            /* Toolbar */
            .toolbar {
                display: flex;
                gap: var(--spacing-unit);
                align-items: center;
                flex-wrap: wrap;
                margin-bottom: calc(var(--spacing-unit) * 3);
            }
            .search-wrapper {
                flex-grow: 1;
                display: flex;
                align-items: center;
                background-color: var(--input-background);
                border: 1px solid var(--input-border);
                border-radius: var(--border-radius);
            }
            .search-wrapper:focus-within {
                border-color: var(--vscode-focusBorder, #007fd4);
            }
            .search-wrapper input {
                flex-grow: 1;
                padding: var(--spacing-unit) calc(var(--spacing-unit) * 1.5);
                border: none;
                background: transparent;
                color: var(--input-foreground);
                outline: none;
                font-size: 14px;
            }
            .toolbar label {
                display: flex;
                align-items: center;
                gap: var(--spacing-unit);
            }
            select {
                padding: var(--spacing-unit);
                background-color: var(--input-background);
                color: var(--input-foreground);
                border: 1px solid var(--input-border);
                border-radius: var(--border-radius);
                font-family: var(--font-family);
            }

            /* Botões */
            .btn {
                padding: var(--spacing-unit) calc(var(--spacing-unit) * 2);
                border-radius: var(--border-radius);
                border: 1px solid transparent;
                cursor: pointer;
                font-weight: 600;
                font-size: 13px;
                transition: background-color 0.2s ease, opacity 0.2s ease;
            }
            .btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            .btn-primary {
                background-color: var(--button-primary-background);
                color: var(--button-primary-foreground);
            }
            .btn-primary:hover:not(:disabled) {
                background-color: color-mix(in srgb, var(--button-primary-background) 90%, black);
            }
            .btn-secondary {
                background-color: var(--button-secondary-background);
                color: var(--button-secondary-foreground);
            }
            .btn-secondary:hover:not(:disabled) {
                background-color: color-mix(in srgb, var(--button-secondary-background) 90%, black);
            }
            .icon-btn {
                background: none;
                border: none;
                padding: 4px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--foreground-color);
                opacity: 0.7;
            }
            .icon-btn:hover:not(:disabled) {
                background-color: var(--list-item-hover);
                opacity: 1;
            }
            
            /* Cards */
            .card {
                background-color: var(--card-background);
                border: 1px solid var(--border-color);
                border-radius: var(--border-radius);
                margin-bottom: calc(var(--spacing-unit) * 2);
                overflow: hidden;
            }
            .card-header {
                padding: calc(var(--spacing-unit) * 1.5) calc(var(--spacing-unit) * 2);
                border-bottom: 1px solid var(--border-color);
                background-color: rgba(128, 128, 128, 0.05);
            }
            .card-title {
                margin: 0;
                font-size: 14px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: var(--spacing-unit);
            }
            .icon { display: inline-flex; }
            .icon-new { color: var(--color-new); }
            .icon-modified { color: var(--color-modified); }
            .icon-removed { color: var(--color-removed); }
            .badge {
                font-size: 12px;
                font-weight: 400;
                padding: 2px 8px;
                border-radius: 10px;
                background-color: var(--input-background);
                color: var(--input-foreground);
            }

            /* Lista de Itens */
            .list-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: var(--spacing-unit) calc(var(--spacing-unit) * 2);
                font-size: 13px;
                border-bottom: 1px solid var(--border-color);
                transition: background-color 0.2s ease;
            }
            .list-item:last-child {
                border-bottom: none;
            }
            .list-item:hover {
                background-color: var(--list-item-hover);
            }
            .path {
                font-family: var(--vscode-editor-font-family, monospace);
                flex-grow: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .meta {
                color: color-mix(in srgb, var(--foreground-color) 70%, transparent);
                margin-left: calc(var(--spacing-unit) * 2);
                font-size: 12px;
                flex-shrink: 0;
            }
            .actions {
                flex-shrink: 0;
                display: flex;
                gap: var(--spacing-unit);
                margin-left: calc(var(--spacing-unit) * 2);
            }

            /* Paginação */
            .pager {
                padding: var(--spacing-unit) calc(var(--spacing-unit) * 2);
                font-size: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                color: color-mix(in srgb, var(--foreground-color) 70%, transparent);
                border-top: 1px solid var(--border-color);
            }
            .pager-controls button {
                margin-left: 4px;
            }

        </style>
    </head>
    <body>
        <main class="container">
            <h1>Diferenças Detectadas – ${esc(projectName)}</h1>
            <div class="toolbar">
                <div class="search-wrapper">
                    <input id="search" type="text" placeholder="Filtrar por nome/caminho..." />
                </div>
                <label>
                    Itens por pág:
                    <select id="pageSize">
                        <option>25</option>
                        <option>50</option>
                        <option selected>100</option>
                        <option>200</option>
                    </select>
                </label>
                <button id="syncNow" class="btn btn-primary">Sincronizar agora</button>
                <button id="close" class="btn btn-secondary">Fechar</button>
            </div>
            
            ${renderList("Novos no Servidor", diffInfo.newRemote, "new")}
            ${renderList("Modificados no Servidor", diffInfo.modifiedRemote, "modified")}
            ${renderList("Removidos no Servidor", diffInfo.removedRemote, "removed")}
        </main>

        <script>
            const vscode = acquireVsCodeApi();
            const diffInfo = ${JSON.stringify(diffInfo)};
            const state = {
                filter: '',
                pageSize: 100,
                page: { new: 0, modified: 0, removed: 0 }
            };
            const types = ['new', 'modified', 'removed'];
            
            const icons = {
                preview: \`${getIcon('preview')}\`,
                diff: \`${getIcon('diff')}\`
            };

            function applyFilter(list) {
                if (!state.filter) return list;
                const f = state.filter.toLowerCase();
                return list.filter(p => p.toLowerCase().includes(f));
            }

            function metaStr(p) {
                const m = (diffInfo.remoteMeta || {})[p] || {};
                const sizeFmt = (n) => {
                    if (n == null) return '-';
                    if (n < 1024) return n + ' B';
                    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
                    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
                    return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
                };
                return sizeFmt(m.size) + ' • ' + (m.modified ? new Date(m.modified).toLocaleString() : '-');
            }

            function renderSection(type) {
                const container = document.querySelector('section[data-section="' + type + '"] .list');
                const pagerEl = document.querySelector('[data-pager="' + type + '"]');
                if (!container || !pagerEl) return;

                const base = diffInfo[type + 'Remote'] || [];
                const list = applyFilter(base);
                const total = list.length;
                const ps = state.pageSize;
                const pages = Math.max(1, Math.ceil(total / ps));

                if (state.page[type] >= pages) state.page[type] = pages - 1;
                
                const start = state.page[type] * ps;
                const end = start + ps;
                const slice = list.slice(start, end);

                container.innerHTML = slice.map(p => {
                    const safe = p.replace(/&/g, '&amp;').replace(/</g, '&lt;');
                    let acts = '';
                    if (type === 'new' || type === 'modified') {
                        acts += '<button class="icon-btn" title="Visualizar" data-action="preview" data-path="' + safe + '">' + icons.preview + '</button>';
                    }
                    if (type === 'modified') {
                        acts += '<button class="icon-btn" title="Comparar" data-action="diff" data-path="' + safe + '">' + icons.diff + '</button>';
                    }
                    return \`<div class="list-item">
                                <span class="path" title="\${safe}">\${safe}</span>
                                <span class="meta">\${metaStr(p)}</span>
                                <div class="actions">\${acts}</div>
                            </div>\`;
                }).join('') || '<div class="list-item"><em>Nenhum arquivo.</em></div>';

                const firstItem = total > 0 ? start + 1 : 0;
                const lastItem = Math.min(end, total);
                
                pagerEl.innerHTML = \`
                    <span>\${firstItem}–\${lastItem} de \${total}</span>
                    <div class="pager-controls">
                        <button class="icon-btn" title="Primeira" data-pager-btn="first" data-type="\${type}" \${state.page[type] == 0 ? 'disabled' : ''}>«</button>
                        <button class="icon-btn" title="Anterior" data-pager-btn="prev" data-type="\${type}" \${state.page[type] == 0 ? 'disabled' : ''}>‹</button>
                        <button class="icon-btn" title="Próxima" data-pager-btn="next" data-type="\${type}" \${state.page[type] >= pages - 1 ? 'disabled' : ''}>›</button>
                        <button class="icon-btn" title="Última" data-pager-btn="last" data-type="\${type}" \${state.page[type] >= pages - 1 ? 'disabled' : ''}>»</button>
                    </div>\`;
            }

            function renderAll() {
                types.forEach(renderSection);
            }

            document.getElementById('search').addEventListener('input', e => {
                state.filter = e.target.value.trim();
                state.page = { new: 0, modified: 0, removed: 0 };
                renderAll();
            });

            document.getElementById('pageSize').addEventListener('change', e => {
                state.pageSize = parseInt(e.target.value, 10);
                state.page = { new: 0, modified: 0, removed: 0 };
                renderAll();
            });

            document.body.addEventListener('click', ev => {
                const t = ev.target.closest('button'); // Handle clicks on SVG inside buttons
                if (!t) return;

                if (t.id === 'close') { vscode.postMessage({ cmd: 'close' }); }
                if (t.id === 'syncNow') { vscode.postMessage({ cmd: 'syncNow' }); }

                if (t.dataset && t.dataset.action) {
                    vscode.postMessage({ cmd: t.dataset.action, path: t.dataset.path });
                }

                if (t.dataset && t.dataset.pagerBtn) {
                    const type = t.dataset.type;
                    const btn = t.dataset.pagerBtn;
                    const base = diffInfo[type + 'Remote'];
                    const total = applyFilter(base || []).length;
                    const pages = Math.max(1, Math.ceil(total / state.pageSize));

                    if (btn === 'first') state.page[type] = 0;
                    else if (btn === 'prev') state.page[type] = Math.max(0, state.page[type] - 1);
                    else if (btn === 'next') state.page[type] = Math.min(pages - 1, state.page[type] + 1);
                    else if (btn === 'last') state.page[type] = pages - 1;
                    renderSection(type);
                }
            });
            
            // Initial render
            renderAll();
        </script>
    </body>
    </html>`;

    panel.webview.onDidReceiveMessage(async (msg) => {
        const system = configManager.CurrentSystem as System;
        if (msg.cmd === "close") panel.dispose();
        if (msg.cmd === "syncNow") {
            panel.dispose();
            vscode.commands.executeCommand("miisync.syncproject", {
                fullPath: args.projectPath,
            });
            return;
        }
        if ((msg.cmd === "preview" || msg.cmd === "diff") && msg.path) {
            const remotePath = msg.path as string;
            const { loadSingleRemoteForPreview } = loadRemotePreviewModule();
            const data = await loadSingleRemoteForPreview(remotePath, system);
            if (!data) {
                vscode.window.showWarningMessage("Falha ao carregar conteúdo remoto.");
                return;
            }
            const doc = await vscode.workspace.openTextDocument({
                content: data.text,
                language: data.language,
            });
            if (msg.cmd === "preview") {
                await vscode.window.showTextDocument(doc, { preview: true });
            } else if (msg.cmd === "diff") {
                try {
                    const localUri = vscode.Uri.file(
                        require("path").join(
                            args.projectPath,
                            remotePath.substring(args.remotePath.length + 1)
                        )
                    );
                    const remoteUri = doc.uri;
                    vscode.commands.executeCommand("vscode.diff", localUri, remoteUri, "Local ↔ Remoto");
                } catch {
                    await vscode.window.showTextDocument(doc, { preview: true });
                }
            }
        }
    });
  } catch (err) {
    vscode.window.showErrorMessage("Erro ao exibir diferenças: " + err);
  }
}