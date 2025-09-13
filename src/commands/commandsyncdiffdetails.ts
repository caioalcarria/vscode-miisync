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

    // Ícones SVG para uma identidade visual consistente
    function getIcon(type: string): string {
        const icons: { [key: string]: string } = {
            new: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M11 19V13H5V11H11V5H13V11H19V13H13V19H11Z"/></svg>`,
            modified: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M20.71 7.04C21.1 6.65 21.1 6.02 20.71 5.63L18.37 3.29C17.98 2.9 17.35 2.9 16.96 3.29L15.13 5.12L18.88 8.87M3 17.25V21H6.75L17.81 9.94L14.06 6.19L3 17.25Z"/></svg>`,
            removed: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19 13H5V11H19V13Z"/></svg>`,
            preview: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 12c-2.48 0-4.5-2.02-4.5-4.5S9.52 7.5 12 7.5s4.5 2.02 4.5 4.5-2.02 4.5-4.5 4.5zm0-7c-1.38 0-2.5 1.12-2.5 2.5S10.62 15 12 15s2.5-1.12 2.5-2.5S13.38 10 12 10z"/></svg>`,
            diff: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M5.05 13.65c.507-.024 1.012-.088 1.513-.213.384-.096.75-.24 1.103-.433.28-.152.544-.34.79-.564.24-.22.455-.47.63-.745.17-.27.304-.57.4-.888.09-.31.13-.64.13-.97s-.04-.66-.13-.97c-.096-.318-.23-.618-.4-.888a2.95 2.95 0 0 0-.63-.745 3.65 3.65 0 0 0-.79-.564 5.34 5.34 0 0 0-1.102-.433c-.502-.125-1.007-.189-1.514-.213C4.542.825 4.037.76 3.536.636 2.55.39 1.56.07 1.258 0L1 1.258c.07.292.39.88.636 1.382.125.502.189 1.007.213 1.514.024.507.088 1.012.213 1.513.096.384.24.75.433 1.103.152.28.34.544.564.79.22.24.47.455.745.63.27.17.57.304.888.4.31.09.64.13.97.13s.66-.04.97-.13c-.318-.096-.618-.23-.888-.4-.275-.175-.506-.39-.745-.63-.224-.244-.41-.508-.564-.79-.193-.352-.337-.72-.433-1.103-.125-.501-.189-1.006-.213-1.513C2.02 5.04 2.083 4.535 2.208 4.022c.096-.384.24-.75.433-1.102.152-.28.34-.544.564-.79.22-.24.47.455.745-.63.27-.17.57.304.888-.4.31-.09.64-.13.97-.13s.66.04.97.13c.318.096.618.23.888.4.275.175.506-.39.745-.63.224-.244.41-.508.564-.79.193-.352.337-.72.433-1.102.125-.501.189-1.006.213-1.513.024-.507-.04-1.012-.134-1.514-.24-.984-.56-1.972-.88-2.264L15 1.258c-.07.292-.39.88-.636 1.382-.125.502-.189 1.007-.213 1.514a6.5 6.5 0 0 1-.213 1.513c-.096.384-.24.75-.433 1.103-.152.28-.34.544-.564-.79-.22-.24-.47-.455-.745-.63-.27-.17-.57-.304-.888-.4-.31-.09-.64-.13-.97-.13s-.66-.04-.97-.13c-.318-.096-.618-.23-.888-.4a2.95 2.95 0 0 1-1.309-1.395c-.193-.352-.337-.72-.433-1.103a6.51 6.51 0 0 1-.213-1.513c-.024-.507.04-1.012.134-1.514.24-.984.56-1.972.88-2.264L10.95 0c.292.07.88.39 1.382.636.502.125 1.007.189 1.514.213.507.024 1.012.088 1.513.213.384.096.75.24 1.103.433.28.152.544.34.79.564.24.22.455.47.63.745.17.27.304.57.4.888.09.31.13.64.13.97s-.04.66-.13.97c-.096-.318-.23-.618-.4.888a2.95 2.95 0 0 1-.63.745 3.65 3.65 0 0 1-.79.564c-.352.193-.72.337-1.102.433-.502-.125-1.007-.189-1.514-.213-.507-.024-1.012-.088-1.513-.213A5.34 5.34 0 0 1 8.9 12a3.65 3.65 0 0 1-.79.564c-.24.22-.455.47-.63.745-.17.27-.304.57-.4.888-.09.31-.13.64-.13.97s.04.66.13.97c.096-.318.23.618.4.888.175.275.39.506.63.745.244.224.508.41.79.564.352.193.72.337 1.102.433.501.125 1.006.189 1.513.213.507.024 1.012-.04 1.514-.134.984-.24 1.972-.56 2.264-.88l1.258-1.258c-.07-.32-1.06-.64-2.04-.88-.502-.125-1.007-.189-1.514-.213z"/></svg>`,
            chevron: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8.295 16.535L12.83 12L8.295 7.465L9.71 6.05L15.66 12L9.71 17.95L8.295 16.535Z"></path></svg>`
        };
        return icons[type] || '';
    }

    function esc(s: string) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    }

    function renderAccordionItem(
      title: string,
      items: string[],
      type: "new" | "modified" | "removed"
    ): string {
      const total = items.length;
      return `<div class="accordion-item active" data-section="${type}">
          <button class="accordion-header active" aria-expanded="true">
              <span class="icon icon-${type}">${getIcon(type)}</span>
              <span class="header-title">${title}</span>
              <span class="badge">${total}</span>
              <span class="chevron">${getIcon('chevron')}</span>
          </button>
          <div class="accordion-content">
              <div class="content-wrapper">
                <div class="list" data-type="${type}"></div>
                <div class="pager" data-pager="${type}"></div>
              </div>
          </div>
      </div>`;
    }

    panel.webview.html = `<!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset='utf-8'>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Diferenças de Sincronização</title>
        <style>
            :root {
                --font-family: var(--vscode-font-family, system-ui, sans-serif);
                --color-bg: var(--vscode-editor-background, #1e1e1e);
                --color-surface: var(--vscode-sideBar-background, #252526);
                --color-text-primary: var(--vscode-editor-foreground, #cccccc);
                --color-text-secondary: var(--vscode-descriptionForeground, #8b8b8b);
                --color-accent: var(--vscode-button-background, #3794ff);
                --color-accent-foreground: var(--vscode-button-foreground, #ffffff);
                --color-border: var(--vscode-menu-separatorBackground, #333333);
                --shadow-color: rgba(0,0,0,0.2);
                
                --color-new: #3fb950;
                --color-modified: #f0b833;
                --color-removed: #f44747;

                --spacing: 8px;
                --border-radius: 10px;
                --transition: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            }

            *, *::before, *::after { box-sizing: border-box; }

            body {
                font-family: var(--font-family);
                background-color: var(--color-bg);
                color: var(--color-text-primary);
                padding: calc(var(--spacing) * 4);
                margin: 0;
            }

            .header { margin-bottom: calc(var(--spacing) * 4); }

            h1 {
                font-size: 28px;
                font-weight: 600;
                letter-spacing: -0.5px;
                margin: 0 0 4px 0;
            }
            .project-name { 
                color: var(--color-text-secondary);
                font-weight: 500;
                font-size: 16px;
            }

            .controls {
                display: flex;
                flex-wrap: wrap;
                gap: calc(var(--spacing) * 1.5);
                margin-top: calc(var(--spacing) * 3);
                align-items: center;
            }

            .input, .select, .btn {
                border-radius: var(--border-radius);
                font-size: 14px;
                padding: calc(var(--spacing) * 1.25) calc(var(--spacing) * 2);
                border: 1px solid var(--color-border);
                background-color: var(--color-surface);
                color: var(--color-text-primary);
                transition: all var(--transition);
            }
            .input { flex-grow: 1; }
            .input:focus-within, .input:focus {
                outline: none;
                border-color: var(--color-accent);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 25%, transparent);
            }
            
            .btn { cursor: pointer; font-weight: 500; }
            .btn-primary {
                background-color: var(--color-accent);
                color: var(--color-accent-foreground);
                border-color: var(--color-accent);
            }
            .btn-primary:hover { filter: brightness(1.15); }
            .btn-secondary:hover { 
                border-color: color-mix(in srgb, var(--color-text-secondary) 50%, transparent);
                color: var(--color-text-primary);
            }

            /* Accordion */
            .accordion-item {
                background-color: var(--color-surface);
                border-radius: var(--border-radius);
                margin-bottom: var(--spacing);
                transition: all var(--transition);
            }
            .accordion-header {
                display: flex;
                align-items: center;
                width: 100%;
                padding: calc(var(--spacing) * 2);
                background: none; border: none; color: inherit;
                cursor: pointer;
            }
            .header-title {
                font-size: 16px;
                font-weight: 500;
                margin: 0 calc(var(--spacing) * 1.5);
                flex-grow: 1;
                text-align: left;
            }
            .icon { display: inline-flex; }
            .icon-new { color: var(--color-new); }
            .icon-modified { color: var(--color-modified); }
            .icon-removed { color: var(--color-removed); }

            .badge {
                font-size: 12px;
                font-weight: 500;
                padding: 4px 10px;
                border-radius: var(--border-radius);
                background-color: var(--color-bg);
                color: var(--color-text-secondary);
            }
            .chevron {
                margin-left: auto;
                color: var(--color-text-secondary);
                transition: transform var(--transition);
            }
            .accordion-header.active .chevron { transform: rotate(90deg); }

            .accordion-content {
                max-height: 0;
                overflow: hidden;
                transition: max-height var(--transition);
            }
            .content-wrapper {
                border-top: 1px solid var(--color-border);
                padding: calc(var(--spacing) * 2);
            }
            
            /* List Items as Cards */
            .list {
                display: grid;
                grid-template-columns: 1fr;
                gap: var(--spacing);
            }
            .list-item {
                display: flex;
                align-items: center;
                gap: calc(var(--spacing) * 2);
                padding: calc(var(--spacing) * 1.5);
                background-color: var(--color-bg);
                border: 1px solid var(--color-border);
                border-radius: var(--border-radius);
                box-shadow: 0 1px 2px var(--shadow-color);
                transition: transform var(--transition), box-shadow var(--transition), border-color var(--transition);
            }
            .list-item:hover {
                transform: translateY(-2px);
                border-color: var(--color-accent);
                box-shadow: 0 4px 12px var(--shadow-color);
            }
            .path {
                font-family: var(--vscode-editor-font-family, monospace);
                font-size: 13px;
                flex-grow: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .meta {
                color: var(--color-text-secondary);
                font-size: 12px;
                flex-shrink: 0;
            }
            .actions { display: flex; gap: var(--spacing); }
            .icon-btn {
                background: none; border: none; padding: 4px; border-radius: 50%;
                color: var(--color-text-secondary); cursor: pointer;
                transition: background-color var(--transition), color var(--transition);
            }
            .icon-btn:hover {
                color: var(--color-text-primary);
            }

            .pager {
                margin-top: calc(var(--spacing) * 2);
                padding-top: var(--spacing);
                font-size: 12px;
                display: flex;
                justify-content: flex-end;
                align-items: center;
                color: var(--color-text-secondary);
            }
        </style>
    </head>
    <body>
        <header class="header">
            <h1>Relatório de Sincronização</h1>
            <div class="project-name">${esc(projectName)}</div>
            <div class="controls">
                <input id="search" type="text" class="input" placeholder="Filtrar arquivos..." />
                <select id="pageSize" class="select">
                    <option>25</option><option>50</option><option selected>100</option><option>200</option>
                </select>
                <button id="syncNow" class="btn btn-primary">Sincronizar Agora</button>
                <button id="close" class="btn btn-secondary">Fechar</button>
            </div>
        </header>

        <main>
            ${renderAccordionItem("Novos no Servidor", diffInfo.newRemote, "new")}
            ${renderAccordionItem("Modificados", diffInfo.modifiedRemote, "modified")}
            ${renderAccordionItem("Removidos", diffInfo.removedRemote, "removed")}
        </main>

        <script>
            const vscode = acquireVsCodeApi();
            const diffInfo = ${JSON.stringify(diffInfo)};
            const state = { filter: '', pageSize: 100, page: { new: 0, modified: 0, removed: 0 }};
            const types = ['new', 'modified', 'removed'];
            const icons = { preview: \`${getIcon('preview')}\`, diff: \`${getIcon('diff')}\` };

            function applyFilter(list) {
                if (!state.filter) return list;
                const f = state.filter.toLowerCase();
                return list.filter(p => p.toLowerCase().includes(f));
            }

            function metaStr(p) {
                const m = (diffInfo.remoteMeta || {})[p] || {};
                const sizeFmt = (n) => {
                    if (n == null || isNaN(n)) return '-';
                    if (n < 1024) return n + ' B';
                    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
                    return (n / (1024 * 1024)).toFixed(1) + ' MB';
                };
                return sizeFmt(m.size) + '  •  ' + (m.modified ? new Date(m.modified).toLocaleString() : '-');
            }

            function renderSection(type) {
                const section = document.querySelector('.accordion-item[data-section="' + type + '"]');
                if (!section) return;
                const container = section.querySelector('.list');
                const pagerEl = section.querySelector('.pager');

                const base = diffInfo[type + 'Remote'] || [];
                const list = applyFilter(base);
                const total = list.length;
                const ps = state.pageSize;
                const pages = Math.max(1, Math.ceil(total / ps));

                if (state.page[type] >= pages) state.page[type] = pages - 1;
                
                const start = state.page[type] * ps;
                const slice = list.slice(start, start + ps);

                container.innerHTML = slice.map(p => {
                    const safe = p.replace(/&/g, '&amp;').replace(/</g, '&lt;');
                    let acts = '';
                    if (type !== 'removed') acts += \`<button class="icon-btn" title="Visualizar" data-action="preview" data-path="\${safe}">\${icons.preview}</button>\`;
                    if (type === 'modified') acts += \`<button class="icon-btn" title="Comparar" data-action="diff" data-path="\${safe}">\${icons.diff}</button>\`;
                    return \`<div class="list-item">
                                <span class="path" title="\${safe}">\${safe}</span>
                                <span class="meta">\${metaStr(p)}</span>
                                <div class="actions">\${acts}</div>
                            </div>\`;
                }).join('') || '<div style="padding: 24px; text-align: center; color: var(--color-text-secondary);">Nenhum arquivo.</div>';

                const firstItem = total > 0 ? start + 1 : 0;
                const lastItem = Math.min(start + ps, total);
                pagerEl.innerHTML = (total > 0) ? \`
                    <span>\${firstItem}–\${lastItem} de \${total}</span>
                    <div class="pager-controls">
                        <button class="icon-btn" title="Anterior" data-pager-btn="prev" data-type="\${type}" \${state.page[type] == 0 ? 'disabled' : ''}>‹</button>
                        <button class="icon-btn" title="Próxima" data-pager-btn="next" data-type="\${type}" \${state.page[type] >= pages - 1 ? 'disabled' : ''}>›</button>
                    </div>\` : '';
            }

            function renderAll() { types.forEach(renderSection); }

            function setupAccordions() {
                // Abre todos os acordeões por padrão
                document.querySelectorAll('.accordion-item.active').forEach(item => {
                    const content = item.querySelector('.accordion-content');
                    if(content) content.style.maxHeight = content.scrollHeight + 'px';
                });

                document.querySelectorAll('.accordion-header').forEach(header => {
                    header.addEventListener('click', () => {
                        const item = header.parentElement;
                        const content = header.nextElementSibling;
                        header.classList.toggle('active');
                        item.classList.toggle('active');
                        
                        if (content.style.maxHeight) {
                            content.style.maxHeight = null;
                        } else {
                            content.style.maxHeight = content.scrollHeight + 'px';
                        }
                    });
                });
            }

            // --- INICIALIZAÇÃO ---
            renderAll();
            setupAccordions();

            // Event Listeners
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
                const t = ev.target.closest('button');
                if (!t) return;
                if (t.classList.contains('accordion-header')) return; 

                if (t.id === 'close') vscode.postMessage({ cmd: 'close' });
                if (t.id === 'syncNow') vscode.postMessage({ cmd: 'syncNow' });

                if (t.dataset.action) {
                    vscode.postMessage({ cmd: t.dataset.action, path: t.dataset.path });
                }
                if (t.dataset.pagerBtn) {
                    const type = t.dataset.type;
                    const btn = t.dataset.pagerBtn;
                    if (btn === 'prev') state.page[type] = Math.max(0, state.page[type] - 1);
                    else if (btn === 'next') state.page[type] +=1;
                    renderSection(type);
                }
            });
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