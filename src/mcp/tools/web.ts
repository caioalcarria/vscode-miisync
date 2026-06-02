import * as fs from 'fs';
import * as path from 'path';
import {
    listRemoteFolder, readWebFile, saveWebFile, deleteFile, createFolder, fileExists, fileProperties, RemoteEntry,
} from '../miiClient';
import { ToolDef } from './types';
import { persistLocalAndCommit } from './writeHelpers';

const FILE_ICONS: Record<string, string> = {
    html: '🌐', htm: '🌐', js: '📜', ts: '📜', css: '🎨',
    xml: '📋', trx: '📋', tqsq: '📋', json: '📄',
    png: '🖼', jpg: '🖼', gif: '🖼', svg: '🖼', pdf: '📑', woff: '🔤', woff2: '🔤',
};
function fileIcon(name: string): string {
    return FILE_ICONS[name.split('.').pop()?.toLowerCase() || ''] || '📄';
}

function cleanPath(p: string): string {
    return (p || '').replace(/\/+$/, '');
}

/** Diff de linhas simples: retorna resumo das diferenças. */
function simpleDiff(serverContent: string, localContent: string): string {
    if (serverContent === localContent) return '✅ Idêntico (servidor == local).';
    const a = serverContent.split('\n');
    const b = localContent.split('\n');
    let firstDiff = -1;
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
        if (a[i] !== b[i]) { firstDiff = i; break; }
    }
    const lines = [
        '⚠️ Conteúdos diferentes.',
        `  Servidor: ${a.length} linha(s), ${serverContent.length} chars`,
        `  Local:    ${b.length} linha(s), ${localContent.length} chars`,
    ];
    if (firstDiff >= 0) {
        lines.push('', `Primeira diferença na linha ${firstDiff + 1}:`);
        lines.push(`  - servidor: ${JSON.stringify(a[firstDiff] ?? '(ausente)')}`);
        lines.push(`  + local:    ${JSON.stringify(b[firstDiff] ?? '(ausente)')}`);
    }
    return lines.join('\n');
}

async function downloadRecursive(session: any, remoteDir: string, localDir: string): Promise<number> {
    let count = 0;
    const entries: RemoteEntry[] = await listRemoteFolder(session, remoteDir);
    fs.mkdirSync(localDir, { recursive: true });
    for (const e of entries) {
        const remoteChild = `${remoteDir}/${e.name}`;
        if (e.isFolder) {
            count += await downloadRecursive(session, remoteChild, path.join(localDir, e.name));
        } else {
            const content = await readWebFile(session, remoteChild);
            if (content != null) {
                fs.writeFileSync(path.join(localDir, e.name), content, 'utf8');
                count++;
            }
        }
    }
    return count;
}

export const webTools: ToolDef[] = [
    {
        name: 'web_list_tree',
        description: 'Lista arquivos e pastas de um diretório WEB remoto do SAP MII. Sem caminho, usa o remotePath do projeto.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Caminho remoto (ex: Default/WEB). Opcional — padrão = remotePath.' } },
        },
        classify: (args, ctx) => ({ opClass: 'READ', target: cleanPath(args?.path || ctx.remotePath) }),
        handler: async (args, ctx) => {
            const p = cleanPath(args?.path || ctx.remotePath);
            if (!p) return 'Nenhum caminho informado e remotePath não definido.';
            const entries = await listRemoteFolder(ctx.session, p);
            if (!entries.length) return `Nenhum item encontrado em: ${p}`;
            const folders = entries.filter((e) => e.isFolder);
            const files = entries.filter((e) => !e.isFolder);
            const lines = [`📁 ${p}`, '─'.repeat(50)];
            for (const f of folders) lines.push(`  📂 ${f.name}/`);
            if (folders.length && files.length) lines.push('');
            for (const f of files) lines.push(`  ${fileIcon(f.name)} ${f.name}${f.modified ? `  (${f.modified})` : ''}`);
            lines.push('', `Total: ${folders.length} pasta(s), ${files.length} arquivo(s)`);
            return lines.join('\n');
        },
    },
    {
        name: 'web_read_file',
        description: 'Lê o conteúdo de um arquivo WEB remoto (decodifica base64 automaticamente).',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Caminho remoto do arquivo (ex: Default/WEB/index.html)' } },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => {
            const content = await readWebFile(ctx.session, cleanPath(args.path));
            if (content == null) return `Arquivo não encontrado ou vazio: ${args.path}`;
            return content;
        },
    },
    {
        name: 'web_download_file',
        description: 'Baixa um arquivo WEB remoto para o disco local.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho remoto do arquivo' },
                localPath: { type: 'string', description: 'Destino local (opcional; padrão = projeto/<nome>)' },
            },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => {
            const remote = cleanPath(args.path);
            const content = await readWebFile(ctx.session, remote);
            if (content == null) return `Arquivo não encontrado: ${remote}`;
            const dest = args.localPath || path.join(ctx.projectRoot, remote.split('/').pop() || 'download');
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content, 'utf8');
            return `✅ Baixado: ${remote} → ${dest} (${content.length} chars)`;
        },
    },
    {
        name: 'web_download_folder',
        description: 'Baixa recursivamente uma pasta WEB remota para o disco local.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho remoto da pasta' },
                localPath: { type: 'string', description: 'Destino local (opcional; padrão = projeto/<nome>)' },
            },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => {
            const remote = cleanPath(args.path);
            const dest = args.localPath || path.join(ctx.projectRoot, remote.split('/').pop() || 'download');
            const n = await downloadRecursive(ctx.session, remote, dest);
            return `✅ ${n} arquivo(s) baixado(s): ${remote} → ${dest}`;
        },
    },
    {
        name: 'web_file_exists',
        description: 'Verifica se um arquivo WEB remoto existe.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => {
            const exists = await fileExists(ctx.session, cleanPath(args.path));
            return exists ? `✅ Existe: ${args.path}` : `❌ Não existe: ${args.path}`;
        },
    },
    {
        name: 'web_file_properties',
        description: 'Retorna metadados de um arquivo WEB remoto (tipo, data de modificação).',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => {
            const props = await fileProperties(ctx.session, cleanPath(args.path));
            if (!props) return `Arquivo não encontrado: ${args.path}`;
            return JSON.stringify(props, null, 2);
        },
    },
    {
        name: 'web_get_diff',
        description: 'Compara um arquivo WEB remoto com um conteúdo local fornecido.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho remoto do arquivo' },
                localContent: { type: 'string', description: 'Conteúdo local a comparar' },
            },
            required: ['path', 'localContent'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => {
            const server = await readWebFile(ctx.session, cleanPath(args.path));
            if (server == null) return `Arquivo não existe no servidor: ${args.path}`;
            return simpleDiff(server, String(args.localContent ?? ''));
        },
    },
    {
        name: 'web_open_screen',
        description: 'Retorna a URL para abrir um iView/tela WEB no navegador.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Caminho do iView (ex: Default/WEB/tela.html)' } },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => {
            const sys = ctx.session.system;
            const base = `${sys.protocol || 'http'}://${sys.host}:${sys.port}`;
            return `${base}/XMII/CM/${cleanPath(args.path)}`;
        },
    },
    // ── Escrita ──
    {
        name: 'web_upload_file',
        description: 'Cria ou atualiza um arquivo WEB no servidor. Criar arquivo novo é liberado até high; editar existente exige token (high+) e faz backup. Opcionalmente grava localmente e commita no git.',
        category: 'write',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho remoto do arquivo (ex: Default/WEB/reserva.html)' },
                content: { type: 'string', description: 'Conteúdo do arquivo' },
                localPath: { type: 'string', description: 'Opcional: grava o conteúdo localmente e commita no git' },
                confirm_token: { type: 'string' },
            },
            required: ['path', 'content'],
        },
        classify: async (args, ctx) => {
            const target = cleanPath(args.path);
            const exists = await fileExists(ctx.session, target);
            return { opClass: exists ? 'EDIT' : 'CREATE', target, preview: `${exists ? 'EDITAR' : 'CRIAR'} ${target}` };
        },
        handler: async (args, ctx) => {
            const target = cleanPath(args.path);
            const r = await saveWebFile(ctx.session, target, args.content);
            if (!r.ok) return `❌ Falha ao salvar: ${r.error}`;
            const git = await persistLocalAndCommit(ctx, args.localPath, args.content, `miisync(mcp): upload ${target}`);
            return `✅ Salvo no servidor: ${target}${git}`;
        },
    },
    {
        name: 'web_create_folder',
        description: 'Cria uma pasta no diretório WEB do servidor. Liberado até high; token em critical.',
        category: 'write',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho da pasta a criar' },
                confirm_token: { type: 'string' },
            },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'CREATE', target: cleanPath(args.path), preview: `CRIAR pasta ${cleanPath(args.path)}` }),
        handler: async (args, ctx) => {
            const r = await createFolder(ctx.session, cleanPath(args.path));
            return r.ok ? `✅ Pasta criada: ${args.path}` : `❌ Falha: ${r.error}`;
        },
    },
    {
        name: 'web_delete',
        description: 'Apaga um arquivo/pasta WEB do servidor. Exige token + backup; bloqueado em critical e por allowDelete.',
        category: 'delete',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho remoto a apagar' },
                confirm_token: { type: 'string' },
            },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'DELETE', target: cleanPath(args.path), preview: `APAGAR ${cleanPath(args.path)}` }),
        handler: async (args, ctx) => {
            const r = await deleteFile(ctx.session, cleanPath(args.path));
            return r.ok ? `✅ Apagado: ${args.path} (backup salvo no servidor)` : `❌ Falha: ${r.error}`;
        },
    },
];
