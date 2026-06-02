import { randomUUID } from 'crypto';
import {
    getSQLServerList, getServerModes, getTableList, getColumnList, loadQueryTemplate,
    saveQuery, executeTestQuery, deleteFile, fileExists, parseQueryResults, QueryResult,
} from '../miiClient';
import { classifySql, sqlKindToOpClass } from '../security/sqlGuard';
import { ToolDef, ToolCtx, Classification } from './types';
import { persistLocalAndCommit } from './writeHelpers';

function cleanPath(p: string): string {
    return (p || '').replace(/\/+$/, '');
}

// ─── XML helpers ───────────────────────────────────────────────────────────--

function escAttr(s: string): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
}

/** Monta um SQLQuery XML completo (32 slots de param) — exigido pelo executor do MII. */
function buildTqsqXml(opts: { server: string; mode: string; query: string; rowCount?: number; params?: Record<number, string> }): string {
    let slots = '';
    for (let i = 1; i <= 32; i++) {
        const v = opts.params?.[i] ?? '';
        slots += ` Param.${i}="${escAttr(String(v))}" ParamDescription.${i}="" ParamType.${i}=""`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?><SQLQuery AllowBuffering="false" AllowFuture="true" AutoTypeParameters="false" CacheDuration="0" CacheDurationUnits="M" Columns="" Comment="" Connector="" DateColumn="" DateFormat="MM/dd/yyyy HH:mm:ss" Debug="false" Description="" DocType="SQLQuery" Duration="60" DurationUnits="M" EndDate="" FilterExpr="" FixedQuery="" Group="" GroupingExpr="" InlineTransform="" IntervalCount="1" IsCachable="false" JoinExpr="" Mask="" Method="" Mode="${escAttr(opts.mode)}" NumberFormat="0.00"${slots} Password="" Query="${escAttr(opts.query)}" QueryParams="" RestrictedPropertyOverride="false" RowCount="${opts.rowCount ?? 500}" Schedule="" SelectedColumns="" Server="${escAttr(opts.server)}" Service="" SortExpr="" StartDate="" Tables="" Time="" TimePeriod="" Trace="false" UseTypedParams="T" UserName="" Version="15.0.3.5"><Tasks/><ETCServers/><ETCObjects/></SQLQuery>`;
}

/** Extrai o atributo Query (SQL) de um XML .tqsq. */
function extractQuery(xml: string): string {
    const m = xml.match(/\bQuery="([^"]*)"/);
    if (!m) return '';
    return m[1]
        .replace(/&#9;/g, '\t').replace(/&#10;/g, '\n').replace(/&#13;/g, '\r')
        .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// ─── Execução (save → execute → delete) ──────────────────────────────────────

async function runAdHoc(ctx: ToolCtx, server: string, mode: string, sql: string, params?: Record<number, string>): Promise<QueryResult> {
    const t0 = Date.now();
    const tempDir = (ctx.remotePath || 'Default').replace(/\/+$/, '');
    const objPath = `${tempDir}/TMP${randomUUID()}`;
    const xml = buildTqsqXml({ server, mode, query: sql, params });
    const saved = await saveQuery(ctx.session, objPath, xml);
    if (!saved.ok) return { columns: [], rows: [], rowCount: 0, executionTimeMs: Date.now() - t0, error: saved.error || 'Falha ao salvar query temporária' };
    try {
        const resultXml = await executeTestQuery(ctx.session, objPath, params);
        return { ...parseQueryResults(resultXml || ''), executionTimeMs: Date.now() - t0 };
    } finally {
        await deleteFile(ctx.session, objPath + '.tqsq').catch(() => {});
    }
}

function formatResult(r: QueryResult): string {
    if (r.error) return `❌ Erro: ${r.error}`;
    if (!r.rowCount) return `(0 linhas — ${r.executionTimeMs}ms)`;
    const cols = r.columns;
    const head = cols.join(' | ');
    const sep = cols.map(() => '---').join(' | ');
    const limit = 100;
    const body = r.rows.slice(0, limit).map((row) => cols.map((c) => row[c] ?? '').join(' | ')).join('\n');
    let out = `${r.rowCount} linha(s) — ${r.executionTimeMs}ms\n\n${head}\n${sep}\n${body}`;
    if (r.rowCount > limit) out += `\n... (${r.rowCount - limit} linhas omitidas)`;
    return out;
}

/** Classifica o SQL → OpClass do guard (READ livre; WRITE/DDL gated; UNKNOWN tratado como DDL). */
function classifyAdHoc(sql: string): Classification {
    const c = classifySql(sql || '');
    const op = sqlKindToOpClass(c.kind) || 'SQL_DDL';
    return { opClass: op, target: (sql || '').slice(0, 60).replace(/\s+/g, ' '), preview: `executar SQL (${c.keyword || 'desconhecido'})` };
}

// ─── Tools ─────────────────────────────────────────────────────────────────--

export const tqsqTools: ToolDef[] = [
    // ── Introspecção de schema ──
    {
        name: 'tqsq_list_sql_servers',
        description: 'Lista os SQL servers (data sources) disponíveis no MII.',
        category: 'read',
        inputSchema: { type: 'object', properties: {} },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (_args, ctx) => {
            const servers = await getSQLServerList(ctx.session);
            if (!servers.length) return 'Nenhum SQL server retornado pelo endpoint (esta versão do MII pode exigir o nome do server diretamente).';
            return servers.map((s) => `• ${s.name}${s.description && s.description !== s.name ? ` — ${s.description}` : ''}`).join('\n');
        },
    },
    {
        name: 'tqsq_get_server_modes',
        description: 'Lista os modos de query de um SQL server (FixedQuery, Query, Command, etc.).',
        category: 'read',
        inputSchema: { type: 'object', properties: { server: { type: 'string' } }, required: ['server'] },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (args, ctx) => (await getServerModes(ctx.session, args.server)).join('\n') || 'Nenhum modo encontrado.',
    },
    {
        name: 'tqsq_list_tables',
        description: 'Lista as tabelas de um SQL server do MII.',
        category: 'read',
        inputSchema: { type: 'object', properties: { server: { type: 'string' } }, required: ['server'] },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (args, ctx) => {
            const t = await getTableList(ctx.session, args.server);
            return t.length ? `${t.length} tabela(s):\n` + t.map((x) => `• ${x}`).join('\n') : `Nenhuma tabela em ${args.server}.`;
        },
    },
    {
        name: 'tqsq_list_columns',
        description: 'Lista as colunas de uma tabela (via API de metadados do MII).',
        category: 'read',
        inputSchema: { type: 'object', properties: { server: { type: 'string' }, table: { type: 'string' } }, required: ['server', 'table'] },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (args, ctx) => {
            const c = await getColumnList(ctx.session, args.server, args.table);
            return c.length ? `Colunas de ${args.table}:\n` + c.map((x) => `• ${x}`).join('\n') : `Nenhuma coluna em ${args.table}.`;
        },
    },
    {
        name: 'tqsq_describe_table',
        description: 'Descreve uma tabela com tipos, nullable e tamanho (SQL embutido sobre INFORMATION_SCHEMA.COLUMNS).',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                server: { type: 'string', description: 'Nome do SQL server' },
                table: { type: 'string', description: 'Nome da tabela' },
                dialect: { type: 'string', description: 'sybase (padrão) | mssql' },
            },
            required: ['server', 'table'],
        },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (args, ctx) => {
            const t = String(args.table).replace(/'/g, "''");
            const dialect = (args.dialect || 'sybase').toLowerCase();
            const sql = dialect === 'mssql'
                ? `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${t}' ORDER BY ORDINAL_POSITION`
                : `SELECT c.name AS column_name, ty.name AS data_type, c.length AS length, (CASE WHEN c.status & 8 = 8 THEN 'YES' ELSE 'NO' END) AS nullable FROM syscolumns c, systypes ty WHERE c.id = object_id('${t}') AND c.usertype = ty.usertype ORDER BY c.colid`;
            return formatResult(await runAdHoc(ctx, args.server, 'FixedQuery', sql));
        },
    },
    {
        name: 'tqsq_list_stored_procedures',
        description: 'Lista stored procedures do SQL server (SQL embutido; default dialeto Sybase via sysobjects).',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                server: { type: 'string', description: 'Nome do SQL server' },
                filter: { type: 'string', description: 'Filtro opcional por nome (LIKE %filter%)' },
                dialect: { type: 'string', description: 'sybase (padrão) | mssql' },
            },
            required: ['server'],
        },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (args, ctx) => {
            const dialect = (args.dialect || 'sybase').toLowerCase();
            const filt = args.filter ? String(args.filter).replace(/'/g, "''") : '';
            let sql: string;
            if (dialect === 'mssql') {
                sql = `SELECT ROUTINE_SCHEMA, ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE = 'PROCEDURE'${filt ? ` AND ROUTINE_NAME LIKE '%${filt}%'` : ''} ORDER BY ROUTINE_NAME`;
            } else {
                sql = `SELECT name FROM sysobjects WHERE type = 'P'${filt ? ` AND name LIKE '%${filt}%'` : ''} ORDER BY name`;
            }
            return formatResult(await runAdHoc(ctx, args.server, 'FixedQuery', sql));
        },
    },
    {
        name: 'tqsq_get_stored_procedure',
        description: 'Retorna o código de uma stored procedure (SQL embutido; default Sybase via syscomments).',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                server: { type: 'string', description: 'Nome do SQL server' },
                procName: { type: 'string', description: 'Nome da stored procedure' },
                dialect: { type: 'string', description: 'sybase (padrão) | mssql' },
            },
            required: ['server', 'procName'],
        },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (args, ctx) => {
            const n = String(args.procName).replace(/'/g, "''");
            const dialect = (args.dialect || 'sybase').toLowerCase();
            if (dialect === 'mssql') {
                const r = await runAdHoc(ctx, args.server, 'FixedQuery', `SELECT ROUTINE_DEFINITION FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_NAME = '${n}'`);
                if (r.error) return `❌ Erro: ${r.error}`;
                if (!r.rowCount) return `Stored procedure não encontrada: ${args.procName}`;
                return r.rows[0]['ROUTINE_DEFINITION'] || '(definição vazia ou truncada)';
            }
            // Sybase: texto da proc fica em syscomments (em pedaços)
            const r = await runAdHoc(ctx, args.server, 'FixedQuery', `SELECT text FROM syscomments WHERE id = object_id('${n}') ORDER BY number, colid`);
            if (r.error) return `❌ Erro: ${r.error}`;
            if (!r.rowCount) return `Stored procedure não encontrada: ${args.procName}`;
            return r.rows.map((row) => row['text'] ?? '').join('');
        },
    },
    // ── Execução / Teste ──
    {
        name: 'tqsq_run_adhoc',
        description: 'Executa um SQL diretamente (query temporária, auto-limpa). SELECT é livre; INSERT/UPDATE/DELETE exige allowSqlWrite; DDL exige allowSqlDDL.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                server: { type: 'string', description: 'Nome do SQL server' },
                sql: { type: 'string', description: 'O comando SQL a executar' },
                mode: { type: 'string', description: 'Modo (padrão: FixedQuery)' },
                params: { type: 'object', description: 'Valores para [Param.N] (opcional)' },
                confirm_token: { type: 'string', description: 'Token de confirmação (quando exigido)' },
            },
            required: ['server', 'sql'],
        },
        classify: (args) => classifyAdHoc(args?.sql || ''),
        handler: async (args, ctx) => {
            const c = classifySql(args.sql || '');
            if (c.multiStatement) return '🚫 Múltiplos statements não são permitidos numa única chamada.';
            return formatResult(await runAdHoc(ctx, args.server, args.mode || 'FixedQuery', args.sql, args.params));
        },
    },
    {
        name: 'tqsq_test_template',
        description: 'Executa uma query (.tqsq) salva no catálogo com valores de teste.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho da query no catálogo' },
                params: { type: 'object', description: 'Valores para [Param.N]' },
                confirm_token: { type: 'string' },
            },
            required: ['path'],
        },
        classify: async (args, ctx) => {
            const xml = await loadQueryTemplate(ctx.session, cleanPath(args.path));
            const c = classifyAdHoc(xml ? extractQuery(xml) : '');
            return { ...c, target: cleanPath(args.path) };
        },
        handler: async (args, ctx) => {
            const t0 = Date.now();
            const resultXml = await executeTestQuery(ctx.session, cleanPath(args.path), args.params);
            const parsed = parseQueryResults(resultXml || '');
            return formatResult({ ...parsed, executionTimeMs: Date.now() - t0 });
        },
    },
    {
        name: 'tqsq_test_local',
        description: 'Executa um XML .tqsq fornecido localmente (salva como temporária e executa).',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string', description: 'Conteúdo XML da query (.tqsq)' },
                params: { type: 'object', description: 'Valores para [Param.N]' },
                confirm_token: { type: 'string' },
            },
            required: ['xml'],
        },
        classify: (args) => {
            const c = classifyAdHoc(extractQuery(args?.xml || ''));
            return { ...c, target: 'tqsq-local' };
        },
        handler: async (args, ctx) => {
            const t0 = Date.now();
            const tempDir = (ctx.remotePath || 'Default').replace(/\/+$/, '');
            const objPath = `${tempDir}/TMP${randomUUID()}`;
            const saved = await saveQuery(ctx.session, objPath, args.xml);
            if (!saved.ok) return `❌ Erro ao salvar: ${saved.error}`;
            try {
                const resultXml = await executeTestQuery(ctx.session, objPath, args.params);
                return formatResult({ ...parseQueryResults(resultXml || ''), executionTimeMs: Date.now() - t0 });
            } finally {
                await deleteFile(ctx.session, objPath + '.tqsq').catch(() => {});
            }
        },
    },
    // ── Escrita (CRUD) ──
    {
        name: 'tqsq_save',
        description: 'Salva/atualiza o XML de uma query (.tqsq) no catálogo. Criar é livre até high; editar exige token (high+) e backup.',
        category: 'write',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho da query no catálogo (sem extensão)' },
                xml: { type: 'string', description: 'XML completo da SQLQuery' },
                localPath: { type: 'string', description: 'Opcional: grava localmente e commita no git' },
                confirm_token: { type: 'string' },
            },
            required: ['path', 'xml'],
        },
        classify: async (args, ctx) => {
            const obj = cleanPath(args.path).replace(/\.tqsq$/i, '');
            const target = obj + '.tqsq';
            const exists = await fileExists(ctx.session, target);
            return { opClass: exists ? 'EDIT' : 'CREATE', target, preview: `${exists ? 'EDITAR' : 'CRIAR'} query ${obj}` };
        },
        handler: async (args, ctx) => {
            const obj = cleanPath(args.path).replace(/\.tqsq$/i, '');
            const r = await saveQuery(ctx.session, obj, args.xml);
            if (!r.ok) return `❌ Falha ao salvar: ${r.error}`;
            const git = await persistLocalAndCommit(ctx, args.localPath, args.xml, `miisync(mcp): save query ${obj}`);
            return `✅ Query salva: ${obj}${git}`;
        },
    },
    {
        name: 'tqsq_create',
        description: 'Cria uma query (.tqsq) a partir de campos (server, mode, query SQL, params) e salva no catálogo.',
        category: 'write',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho destino no catálogo (sem extensão)' },
                server: { type: 'string', description: 'Nome do SQL server' },
                query: { type: 'string', description: 'SQL da query' },
                mode: { type: 'string', description: 'Modo (padrão: FixedQuery)' },
                params: { type: 'object', description: 'Valores Param.N (opcional)' },
                localPath: { type: 'string' },
                confirm_token: { type: 'string' },
            },
            required: ['path', 'server', 'query'],
        },
        classify: async (args, ctx) => {
            const obj = cleanPath(args.path).replace(/\.tqsq$/i, '');
            const target = obj + '.tqsq';
            const exists = await fileExists(ctx.session, target);
            return { opClass: exists ? 'EDIT' : 'CREATE', target, preview: `${exists ? 'EDITAR' : 'CRIAR'} query ${obj}` };
        },
        handler: async (args, ctx) => {
            const obj = cleanPath(args.path).replace(/\.tqsq$/i, '');
            const xml = buildTqsqXml({ server: args.server, mode: args.mode || 'FixedQuery', query: args.query, params: args.params });
            const r = await saveQuery(ctx.session, obj, xml);
            if (!r.ok) return `❌ Falha ao criar: ${r.error}`;
            const git = await persistLocalAndCommit(ctx, args.localPath, xml, `miisync(mcp): create query ${obj}`);
            return `✅ Query criada: ${obj}${git}`;
        },
    },
    // ── CRUD (leitura) ──
    {
        name: 'tqsq_load',
        description: 'Carrega o XML de uma query (.tqsq) salva no catálogo MII.',
        category: 'read',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => (await loadQueryTemplate(ctx.session, cleanPath(args.path))) || `Query não encontrada: ${args.path}`,
    },
];
