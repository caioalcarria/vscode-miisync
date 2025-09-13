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

    function iconFor(type: string): string {
      switch (type) {
        case "new":
          return "🟢";
        case "modified":
          return "🟡";
        case "removed":
          return "🔴";
        default:
          return "•";
      }
    }
    function sizeFmt(n?: number) {
      if (n == null || isNaN(n)) return "-";
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
      if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
      return (n / 1024 / 1024 / 1024).toFixed(1) + " GB";
    }
    function esc(s: string) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    }
    function renderList(
      title: string,
      items: string[],
      type: "new" | "modified" | "removed"
    ): string {
      const meta = diffInfo.remoteMeta || {};
      const total = items.length;
      return `<section data-section="${type}">
        <h3>${iconFor(type)} ${title} <small>(${total})</small></h3>
        <div class="list" data-type="${type}"></div>
        <div class="pager" data-pager="${type}"></div>
      </section>`;
    }

    panel.webview.html = `<!DOCTYPE html><html><head><meta charset='utf-8'>
    <style>
      :root { --sec-pad:8px; }
      body { font-family: var(--vscode-font-family); padding: 12px; }
      h2 { margin-top:0; }
      section { border:1px solid var(--vscode-editorWidget-border,#444); padding: var(--sec-pad); margin-bottom:12px; border-radius:4px; }
      h3 { margin:0 0 6px 0; font-size:13px; display:flex; align-items:center; gap:6px; }
      .toolbar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
      input[type=text]{ flex:1; padding:4px 6px; }
      .list-item { display:flex; align-items:center; justify-content:space-between; padding:4px 6px; border-radius:3px; font-size:12px; }
      .list-item:nth-child(odd){ background: var(--vscode-editor-inactiveSelectionBackground,#222); }
      .path { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:monospace; }
      .meta { opacity:0.7; margin-left:8px; font-size:11px; }
      button { margin-left:4px; }
      .actions { flex-shrink:0; display:flex; gap:4px; }
      .pager { margin-top:6px; font-size:11px; display:flex; gap:8px; align-items:center; }
      .pager button { margin:0; }
      .badge { background:#444; padding:2px 6px; border-radius:10px; font-size:11px; }
      .new .badge { background:#0a630a; }
      .modified .badge { background:#8a6a00; }
      .removed .badge { background:#7d2020; }
      #syncNow { background:#0b5c9c; color:#fff; }
    </style>
    </head><body>
      <h2>Diferenças Detectadas – ${esc(projectName)}</h2>
      <div class="toolbar">
        <input id="search" type="text" placeholder="Filtrar por nome/caminho..." />
        <label>Tamanho página: <select id="pageSize"><option>25</option><option>50</option><option selected>100</option><option>200</option></select></label>
        <button id="syncNow">Sincronizar agora</button>
        <button id="close">Fechar</button>
      </div>
      ${renderList("Novos", diffInfo.newRemote, "new")}
      ${renderList("Modificados", diffInfo.modifiedRemote, "modified")}
      ${renderList("Removidos", diffInfo.removedRemote, "removed")}
      <script>
        const vscode = acquireVsCodeApi();
        const diffInfo = ${JSON.stringify(diffInfo)};
        const state = {
          filter:'',
          pageSize:100,
          page:{ new:0, modified:0, removed:0 }
        };
        const types = ['new','modified','removed'];
        function applyFilter(list, type){
          if(!state.filter) return list;
          const f = state.filter.toLowerCase();
            return list.filter(p=>p.toLowerCase().includes(f));
        }
        function metaStr(p){ const m = (diffInfo.remoteMeta||{})[p]||{}; const sizeFmt=(n)=>{if(n==null) return '-'; if(n<1024) return n+'B'; if(n<1024*1024) return (n/1024).toFixed(1)+'KB'; if(n<1024*1024*1024) return (n/1024/1024).toFixed(1)+'MB'; return (n/1024/1024/1024).toFixed(1)+'GB';}; return sizeFmt(m.size)+ ' • ' + (m.modified? new Date(m.modified).toLocaleString(): '-'); }
        function renderSection(type){
          const container = document.querySelector('section[data-section="'+type+'"] .list');
          const pagerEl = document.querySelector('[data-pager="'+type+'"]');
          if(!container||!pagerEl) return;
          const base = diffInfo[type+'Remote'] || [];
          const list = applyFilter(base||[], type);
          const total = list.length;
          const ps = state.pageSize;
          const pages = Math.max(1, Math.ceil(total/ps));
          if(state.page[type] >= pages) state.page[type] = pages-1;
          const start = state.page[type]*ps;
          const slice = list.slice(start, start+ps);
          container.innerHTML = slice.map(p=>{
            const safe = p.replace(/&/g,'&amp;').replace(/</g,'&lt;');
            let acts='';
            if(type==='new'||type==='modified') acts += '<button data-action="preview" data-path="'+safe+'">👁</button>';
            if(type==='modified') acts += '<button data-action="diff" data-path="'+safe+'">≠</button>';
            return '<div class="list-item '+type+'"><span class="path" title="'+safe+'">'+safe+'</span><span class="meta">'+metaStr(p)+'</span><span class="actions">'+acts+'</span></div>';
          }).join('') || '<em>Nenhum.</em>';
          pagerEl.innerHTML = 'Página '+(state.page[type]+1)+'/'+pages+' ('+total+' itens) <div'
            +'><button data-pager-btn="first" data-type="'+type+'" '+(state.page[type]==0?'disabled':'')+' >«</button>'
            +'<button data-pager-btn="prev" data-type="'+type+'" '+(state.page[type]==0?'disabled':'')+' >‹</button>'
            +'<button data-pager-btn="next" data-type="'+type+'" '+(state.page[type]>=pages-1?'disabled':'')+' >›</button>'
            +'<button data-pager-btn="last" data-type="'+type+'" '+(state.page[type]>=pages-1?'disabled':'')+' >»</button></div>';
        }
        function renderAll(){ types.forEach(renderSection); }
        renderAll();
        document.getElementById('search').addEventListener('input', e=>{ state.filter=e.target.value.trim(); state.page={new:0,modified:0,removed:0}; renderAll(); });
        document.getElementById('pageSize').addEventListener('change', e=>{ state.pageSize=parseInt(e.target.value,10); state.page={new:0,modified:0,removed:0}; renderAll(); });
        document.body.addEventListener('click', ev=>{
          const t = ev.target; if(!(t instanceof HTMLElement)) return;
          if(t.id==='close'){ vscode.postMessage({cmd:'close'}); }
          if(t.id==='syncNow'){ vscode.postMessage({cmd:'syncNow'}); }
          if(t.dataset && t.dataset.action){ vscode.postMessage({cmd:t.dataset.action, path:t.dataset.path}); }
          if(t.dataset && t.dataset.pagerBtn){ const type=t.dataset.type; const btn=t.dataset.pagerBtn; const base=diffInfo[type+'Remote']; const total=applyFilter(base||[], type).length; const pages=Math.max(1, Math.ceil(total/state.pageSize)); if(btn==='first') state.page[type]=0; else if(btn==='prev') state.page[type]=Math.max(0,state.page[type]-1); else if(btn==='next') state.page[type]=Math.min(pages-1,state.page[type]+1); else if(btn==='last') state.page[type]=pages-1; renderSection(type);} }
        );
      </script>
    </body></html>`;

    panel.webview.onDidReceiveMessage(async (msg) => {
      const system = configManager.CurrentSystem as System;
      if (msg.cmd === "close") panel.dispose();
      if (msg.cmd === "syncNow") {
        panel.dispose();
        // Reaproveita lógica do sync: chama diretamente comando principal
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
          vscode.window.showWarningMessage(
            "Falha ao carregar conteúdo remoto."
          );
          return;
        }
        const doc = await vscode.workspace.openTextDocument({
          content: data.text,
          language: data.language,
        });
        if (msg.cmd === "preview") {
          await vscode.window.showTextDocument(doc, { preview: true });
        } else if (msg.cmd === "diff") {
          // Abrir diff remoto vs local (caso exista)
          try {
            const localUri = vscode.Uri.file(
              require("path").join(
                args.projectPath,
                remotePath.substring(args.remotePath.length + 1)
              )
            );
            const remoteUri = doc.uri; // in-memory
            vscode.commands.executeCommand(
              "vscode.diff",
              localUri,
              remoteUri,
              "Local ↔ Remoto"
            );
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
