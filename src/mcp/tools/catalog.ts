import * as fs from 'fs';
import * as path from 'path';
import {
    listRemoteFolder, loadMesFile, loadComponentCatalog, saveMesFile, deleteFile, createFolder, fileExists, fileProperties,
} from '../miiClient';
import { ToolDef } from './types';
import { persistLocalAndCommit } from './writeHelpers';

function cleanPath(p: string): string {
    return (p || '').replace(/\/+$/, '');
}

export const catalogTools: ToolDef[] = [
    {
        name: 'catalog_list_tree',
        description: 'Lista pastas e arquivos de um diretório do catálogo MII (transactions, queries, templates).',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Caminho no catálogo (ex: Default/MeuProjeto). Opcional — padrão = remotePath.' } },
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
            for (const f of files) lines.push(`  📄 ${f.name}${f.type ? ` [${f.type}]` : ''}${f.modified ? `  (${f.modified})` : ''}`);
            lines.push('', `Total: ${folders.length} pasta(s), ${files.length} arquivo(s)`);
            return lines.join('\n');
        },
    },
    {
        name: 'catalog_load_main',
        description: 'Carrega o catálogo de componentes principal (Main.CAT) do servidor MII.',
        category: 'read',
        inputSchema: { type: 'object', properties: {} },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (_args, ctx) => {
            const xml = await loadComponentCatalog(ctx.session);
            return xml || 'Não foi possível carregar o Main.CAT.';
        },
    },
    {
        name: 'catalog_read_file',
        description: 'Lê o conteúdo (texto) de um arquivo de catálogo (transaction, query, template).',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Caminho do arquivo no catálogo' } },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => {
            const content = await loadMesFile(ctx.session, cleanPath(args.path));
            return content || `Arquivo não encontrado ou vazio: ${args.path}`;
        },
    },
    {
        name: 'catalog_download_file',
        description: 'Baixa um arquivo de catálogo para o disco local.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do arquivo no catálogo' },
                localPath: { type: 'string', description: 'Destino local (opcional)' },
            },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => {
            const remote = cleanPath(args.path);
            const content = await loadMesFile(ctx.session, remote);
            if (content == null) return `Arquivo não encontrado: ${remote}`;
            const dest = args.localPath || path.join(ctx.projectRoot, remote.split('/').pop() || 'download');
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content, 'utf8');
            return `✅ Baixado: ${remote} → ${dest} (${content.length} chars)`;
        },
    },
    {
        name: 'catalog_file_exists',
        description: 'Verifica se um arquivo de catálogo existe.',
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
        name: 'catalog_file_properties',
        description: 'Retorna metadados de um arquivo de catálogo.',
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
    // ── Escrita ──
    {
        name: 'catalog_save_file',
        description: 'Cria ou atualiza um arquivo de catálogo (texto). Criar é livre até high; editar exige token (high+) e faz backup.',
        category: 'write',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do arquivo no catálogo' },
                content: { type: 'string', description: 'Conteúdo (texto/XML)' },
                localPath: { type: 'string', description: 'Opcional: grava localmente e commita no git' },
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
            const r = await saveMesFile(ctx.session, target, args.content);
            if (!r.ok) return `❌ Falha ao salvar: ${r.error}`;
            const git = await persistLocalAndCommit(ctx, args.localPath, args.content, `miisync(mcp): save ${target}`);
            return `✅ Salvo no catálogo: ${target}${git}`;
        },
    },
    {
        name: 'catalog_create_folder',
        description: 'Cria uma pasta no catálogo. Liberado até high; token em critical.',
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
        name: 'catalog_delete',
        description: 'Apaga um arquivo de catálogo. Exige token + backup; bloqueado em critical e por allowDelete.',
        category: 'delete',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho do arquivo a apagar' },
                confirm_token: { type: 'string' },
            },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'DELETE', target: cleanPath(args.path), preview: `APAGAR ${cleanPath(args.path)}` }),
        handler: async (args, ctx) => {
            const r = await deleteFile(ctx.session, cleanPath(args.path));
            return r.ok ? `✅ Apagado: ${args.path} (backup no servidor)` : `❌ Falha: ${r.error}`;
        },
    },
];
