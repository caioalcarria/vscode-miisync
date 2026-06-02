import { loadTransaction, saveTransaction, runTransaction, fileExists, getJCOConnections, getJCOConnectionInfo, getBLSCredentials } from '../miiClient';
import {
    parseTrx, TrxData, TrxStep, TrxActionRef, TrxLink,
    addSequenceToRawTrx, deleteSequenceFromRawTrx, renameStepInRawTrx,
    addActionToRawTrx, deleteActionFromRawTrx, editActionPropsInRawTrx, editLinksInRawTrx,
    addVariableToRawTrx, editVariableInRawTrx, deleteVariableInRawTrx,
} from '../../ui/trxviewer/trxParser';
import { ToolCtx, ToolDef } from './types';
import { persistLocalAndCommit } from './writeHelpers';

/** Carrega o XML de trabalho: usa args.xml se fornecido, senão carrega do servidor pelo path. */
async function workingXml(args: any, ctx: ToolCtx): Promise<string | null> {
    if (typeof args?.xml === 'string' && args.xml.trim()) return args.xml;
    if (args?.path) return loadTransaction(ctx.session, (args.path as string).replace(/\/+$/, ''));
    return null;
}

function cleanPath(p: string): string {
    return (p || '').replace(/\/+$/, '');
}

function escXml(s: string): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Esqueleto mínimo de Transaction com uma ActionSequence vazia. */
function buildTrxSkeleton(description: string): string {
    const attr = (name: string, value: string) =>
        `<ContextItem><Name>${name}</Name><Description></Description><MinRange>0</MinRange><MaxRange>0</MaxRange><Value xsi:type="xsd:string">${escXml(value)}</Value><ReadOnly>false</ReadOnly></ContextItem>`;
    return `<?xml version="1.0" encoding="UTF-8"?><Transaction xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="15.0.3.5"><TransactionAttributes>${attr('Description', description)}${attr('Status', 'DEVELOPMENT')}</TransactionAttributes><Context/><Local/><Actions/><Steps><Step xsi:type="ActionSequence"><Name>Sequence</Name><Description></Description><Steps/><Actions/></Step></Steps><Layout/></Transaction>`;
}

/** Carrega o XML: usa args.xml se fornecido, senão carrega do servidor pelo path. */
async function loadXml(args: any, ctx: ToolCtx): Promise<string | null> {
    if (typeof args?.xml === 'string' && args.xml.trim()) return args.xml;
    if (args?.path) return loadTransaction(ctx.session, cleanPath(args.path));
    return null;
}

async function loadParsed(args: any, ctx: ToolCtx): Promise<TrxData | null> {
    const xml = await loadXml(args, ctx);
    if (!xml) return null;
    return parseTrx(xml);
}

/** Encontra uma action pelo nome percorrendo a árvore de steps. */
function findAction(steps: TrxStep[], name: string): TrxActionRef | null {
    for (const s of steps) {
        const a = s.actions.find((x) => x.name === name);
        if (a) return a;
        const nested = findAction(s.steps, name);
        if (nested) return nested;
    }
    return null;
}

function summarizeSteps(steps: TrxStep[]): any[] {
    return steps.map((s) => ({
        name: s.name,
        type: s.type,
        actions: s.actions.map((a) => a.name),
        steps: s.steps.length ? summarizeSteps(s.steps) : undefined,
    }));
}

const pathOrXmlSchema = {
    type: 'object',
    properties: {
        path: { type: 'string', description: 'Caminho da TRX no catálogo (carrega do servidor)' },
        xml: { type: 'string', description: 'XML da TRX (alternativa ao path)' },
    },
};

export const trxTools: ToolDef[] = [
    {
        name: 'trx_load',
        description: 'Carrega o XML completo de uma transação (.trx) do catálogo MII.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Caminho da TRX no catálogo' } },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path) }),
        handler: async (args, ctx) => {
            const xml = await loadTransaction(ctx.session, cleanPath(args.path));
            return xml || `Transação não encontrada: ${args.path}`;
        },
    },
    {
        name: 'trx_save',
        description: 'Salva/atualiza o XML de uma transação no catálogo. Criar é livre até high; editar exige token (high+) e backup.',
        category: 'write',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho da TRX no catálogo (sem extensão)' },
                xml: { type: 'string', description: 'XML completo da Transaction' },
                localPath: { type: 'string', description: 'Opcional: grava localmente e commita no git' },
                confirm_token: { type: 'string' },
            },
            required: ['path', 'xml'],
        },
        classify: async (args, ctx) => {
            const obj = cleanPath(args.path).replace(/\.trx$/i, '');
            const target = obj + '.trx';
            const exists = await fileExists(ctx.session, target);
            return { opClass: exists ? 'EDIT' : 'CREATE', target, preview: `${exists ? 'EDITAR' : 'CRIAR'} TRX ${obj}` };
        },
        handler: async (args, ctx) => {
            const obj = cleanPath(args.path).replace(/\.trx$/i, '');
            const r = await saveTransaction(ctx.session, obj, args.xml);
            if (!r.ok) return `❌ Falha ao salvar: ${r.error}`;
            const git = await persistLocalAndCommit(ctx, args.localPath, args.xml, `miisync(mcp): save trx ${obj}`);
            return `✅ Transação salva: ${obj}${git}`;
        },
    },
    {
        name: 'trx_create',
        description: 'Cria uma transação vazia (esqueleto ActionSequence) no catálogo. Use as tools trx_add_* depois para montá-la.',
        category: 'write',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho destino no catálogo (sem extensão)' },
                description: { type: 'string', description: 'Descrição da transação (opcional)' },
                confirm_token: { type: 'string' },
            },
            required: ['path'],
        },
        classify: async (args, ctx) => {
            const obj = cleanPath(args.path).replace(/\.trx$/i, '');
            const target = obj + '.trx';
            const exists = await fileExists(ctx.session, target);
            return { opClass: exists ? 'EDIT' : 'CREATE', target, preview: `${exists ? 'SOBRESCREVER' : 'CRIAR'} TRX ${obj}` };
        },
        handler: async (args, ctx) => {
            const obj = cleanPath(args.path).replace(/\.trx$/i, '');
            const xml = buildTrxSkeleton(args.description || '');
            const r = await saveTransaction(ctx.session, obj, xml);
            return r.ok ? `✅ Transação criada: ${obj} (esqueleto — use trx_add_* para montar)` : `❌ Falha: ${r.error}`;
        },
    },
    {
        name: 'trx_get_metadata',
        description: 'Retorna metadados da TRX: nome, versão e atributos (Status, Description, Author, etc.).',
        category: 'read',
        inputSchema: pathOrXmlSchema,
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path || '') }),
        handler: async (args, ctx) => {
            const trx = await loadParsed(args, ctx);
            if (!trx) return 'TRX não encontrada ou inválida.';
            return JSON.stringify({ name: trx.name, version: trx.version, attributes: trx.attributes }, null, 2);
        },
    },
    {
        name: 'trx_get_variables',
        description: 'Lista as variáveis de Context e Local da TRX (nome, tipo, readOnly).',
        category: 'read',
        inputSchema: pathOrXmlSchema,
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path || '') }),
        handler: async (args, ctx) => {
            const trx = await loadParsed(args, ctx);
            if (!trx) return 'TRX não encontrada ou inválida.';
            return JSON.stringify({ context: trx.context, local: trx.local }, null, 2);
        },
    },
    {
        name: 'trx_get_steps',
        description: 'Retorna a árvore de steps/sequences da TRX (com os nomes das actions de cada step).',
        category: 'read',
        inputSchema: pathOrXmlSchema,
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path || '') }),
        handler: async (args, ctx) => {
            const trx = await loadParsed(args, ctx);
            if (!trx) return 'TRX não encontrada ou inválida.';
            return JSON.stringify(summarizeSteps(trx.steps), null, 2);
        },
    },
    {
        name: 'trx_get_actions',
        description: 'Lista todas as actions da TRX com seus tipos (xsi:type) e propriedades.',
        category: 'read',
        inputSchema: pathOrXmlSchema,
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path || '') }),
        handler: async (args, ctx) => {
            const trx = await loadParsed(args, ctx);
            if (!trx) return 'TRX não encontrada ou inválida.';
            return JSON.stringify({ types: trx.actionDefs, props: trx.actionProps }, null, 2);
        },
    },
    {
        name: 'trx_get_action_config',
        description: 'Retorna as propriedades de configuração de uma action específica (o "objeto").',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                actionName: { type: 'string', description: 'Nome da action' },
                path: { type: 'string' }, xml: { type: 'string' },
            },
            required: ['actionName'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path || '') }),
        handler: async (args, ctx) => {
            const trx = await loadParsed(args, ctx);
            if (!trx) return 'TRX não encontrada ou inválida.';
            const type = trx.actionDefs[args.actionName];
            if (!type) return `Action não encontrada: ${args.actionName}`;
            return JSON.stringify({ name: args.actionName, type, props: trx.actionProps[args.actionName] || {} }, null, 2);
        },
    },
    {
        name: 'trx_get_action_links',
        description: 'Retorna os links de entrada (incoming) e saída (outgoing) de uma action.',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                actionName: { type: 'string', description: 'Nome da action' },
                path: { type: 'string' }, xml: { type: 'string' },
            },
            required: ['actionName'],
        },
        classify: (args) => ({ opClass: 'READ', target: cleanPath(args?.path || '') }),
        handler: async (args, ctx) => {
            const trx = await loadParsed(args, ctx);
            if (!trx) return 'TRX não encontrada ou inválida.';
            const action = findAction(trx.steps, args.actionName);
            if (!action) return `Action não encontrada na árvore: ${args.actionName}`;
            return JSON.stringify({ name: action.name, incoming: action.incoming, outgoing: action.outgoing }, null, 2);
        },
    },
    // ── Edição em memória (TRANSFORM — retornam o novo XML, NÃO gravam no servidor) ──
    {
        name: 'trx_add_sequence',
        description: 'Adiciona uma ActionSequence (abaixo de um step ou como pai dele). Retorna o novo XML — persista depois com trx_save.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string', description: 'XML atual da TRX (ou use path)' },
                path: { type: 'string', description: 'Caminho da TRX no catálogo (carrega o XML)' },
                parentPath: { type: 'array', items: { type: 'number' }, description: 'Índices do step alvo (ex: [0,1])' },
                position: { type: 'string', description: '"below" (irmã) ou "parent" (envolve)', enum: ['below', 'parent'] },
            },
            required: ['parentPath'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            return addSequenceToRawTrx(xml, args.parentPath, args.position === 'parent' ? 'parent' : 'below');
        },
    },
    {
        name: 'trx_delete_sequence',
        description: 'Remove uma sequence (e seu conteúdo) do XML. Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                stepPath: { type: 'array', items: { type: 'number' }, description: 'Índices do step a remover' },
            },
            required: ['stepPath'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            return deleteSequenceFromRawTrx(xml, args.stepPath);
        },
    },
    {
        name: 'trx_rename_step',
        description: 'Renomeia um step (sincroniza o Layout). Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                stepPath: { type: 'array', items: { type: 'number' } },
                newName: { type: 'string' },
            },
            required: ['stepPath', 'newName'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            return renameStepInRawTrx(xml, args.stepPath, args.newName);
        },
    },
    {
        name: 'trx_add_action',
        description: 'Insere uma action por tipo (Tracer, Assignment, ConditionalAction, IlluminatorSQLQueryObject, SAPJCOInterface, etc.) num step. Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                stepPath: { type: 'array', items: { type: 'number' } },
                actionType: { type: 'string', description: 'Tipo (xsi:type) da action' },
                label: { type: 'string', description: 'Nome base da action (opcional)' },
            },
            required: ['stepPath', 'actionType'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            return addActionToRawTrx(xml, args.stepPath, args.actionType, args.label || args.actionType);
        },
    },
    {
        name: 'trx_delete_action',
        description: 'Remove uma action de um step (e a definição global se ficar órfã). Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                stepPath: { type: 'array', items: { type: 'number' } },
                actionName: { type: 'string' },
            },
            required: ['stepPath', 'actionName'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            return deleteActionFromRawTrx(xml, args.stepPath, args.actionName);
        },
    },
    {
        name: 'trx_set_action_config',
        description: 'Edita as propriedades de configuração (o "objeto") de uma action. Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                actionName: { type: 'string' },
                props: { type: 'object', description: 'Propriedades a definir (ex: { Message, Level })' },
            },
            required: ['actionName', 'props'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            return editActionPropsInRawTrx(xml, args.actionName, args.props || {});
        },
    },
    {
        name: 'trx_set_action_links',
        description: 'Substitui completamente os links incoming/outgoing de uma action. Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                stepPath: { type: 'array', items: { type: 'number' } },
                actionName: { type: 'string' },
                incoming: { type: 'array', description: 'Lista de {from,to,type}' },
                outgoing: { type: 'array', description: 'Lista de {from,to,type}' },
            },
            required: ['stepPath', 'actionName'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            return editLinksInRawTrx(xml, args.stepPath, args.actionName, (args.incoming || []) as TrxLink[], (args.outgoing || []) as TrxLink[]);
        },
    },
    {
        name: 'trx_add_link',
        description: 'Adiciona um único link (from→to) a uma action. Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                stepPath: { type: 'array', items: { type: 'number' } },
                actionName: { type: 'string' },
                direction: { type: 'string', enum: ['incoming', 'outgoing'] },
                from: { type: 'string' }, to: { type: 'string' },
                type: { type: 'string', description: 'Assign (padrão) | AssignXml' },
            },
            required: ['stepPath', 'actionName', 'direction', 'from', 'to'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            const trx = parseTrx(xml);
            const action = trx ? findAction(trx.steps, args.actionName) : null;
            const incoming = action ? [...action.incoming] : [];
            const outgoing = action ? [...action.outgoing] : [];
            const link: TrxLink = { from: args.from, to: args.to, type: args.type || 'Assign' };
            if (args.direction === 'incoming') incoming.push(link); else outgoing.push(link);
            return editLinksInRawTrx(xml, args.stepPath, args.actionName, incoming, outgoing);
        },
    },
    {
        name: 'trx_delete_link',
        description: 'Remove um link específico (from→to) de uma action. Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                stepPath: { type: 'array', items: { type: 'number' } },
                actionName: { type: 'string' },
                direction: { type: 'string', enum: ['incoming', 'outgoing'] },
                from: { type: 'string' }, to: { type: 'string' },
            },
            required: ['stepPath', 'actionName', 'direction', 'from', 'to'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            const trx = parseTrx(xml);
            const action = trx ? findAction(trx.steps, args.actionName) : null;
            if (!action) return `Action não encontrada: ${args.actionName}`;
            const match = (l: TrxLink) => l.from === args.from && l.to === args.to;
            const incoming = args.direction === 'incoming' ? action.incoming.filter((l) => !match(l)) : action.incoming;
            const outgoing = args.direction === 'outgoing' ? action.outgoing.filter((l) => !match(l)) : action.outgoing;
            return editLinksInRawTrx(xml, args.stepPath, args.actionName, incoming, outgoing);
        },
    },
    {
        name: 'trx_add_variable',
        description: 'Adiciona uma variável de Context ou Local. Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                scope: { type: 'string', enum: ['context', 'local'] },
                name: { type: 'string' },
                type: { type: 'string', description: 'string (padrão), int, dateTime, boolean, double...' },
                description: { type: 'string' },
                readOnly: { type: 'boolean' },
            },
            required: ['scope', 'name'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            return addVariableToRawTrx(xml, args.scope, args.name, args.type, args.description, args.readOnly);
        },
    },
    {
        name: 'trx_edit_variable',
        description: 'Altera uma variável existente (nome, tipo, descrição, readOnly). Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                scope: { type: 'string', enum: ['context', 'local'] },
                name: { type: 'string' },
                newName: { type: 'string' }, type: { type: 'string' },
                description: { type: 'string' }, readOnly: { type: 'boolean' },
            },
            required: ['scope', 'name'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            return editVariableInRawTrx(xml, args.scope, args.name, {
                newName: args.newName, type: args.type, description: args.description, readOnly: args.readOnly,
            });
        },
    },
    {
        name: 'trx_delete_variable',
        description: 'Remove uma variável de Context ou Local. Retorna o novo XML.',
        category: 'transform',
        inputSchema: {
            type: 'object',
            properties: {
                xml: { type: 'string' }, path: { type: 'string' },
                scope: { type: 'string', enum: ['context', 'local'] },
                name: { type: 'string' },
            },
            required: ['scope', 'name'],
        },
        classify: () => ({ opClass: 'TRANSFORM', target: '' }),
        handler: async (args, ctx) => {
            const xml = await workingXml(args, ctx);
            if (!xml) return 'Forneça xml ou path.';
            return deleteVariableInRawTrx(xml, args.scope, args.name);
        },
    },
    {
        name: 'trx_run',
        description: 'Executa uma transação MII com parâmetros de entrada (Context.X) e retorna os outputs. Liberado sem token, mas registrado na auditoria.',
        category: 'execute',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Caminho da transação no catálogo' },
                params: { type: 'object', description: 'Parâmetros de entrada (Context.<nome>=<valor>)' },
            },
            required: ['path'],
        },
        classify: (args) => ({ opClass: 'EXECUTE_TRX', target: cleanPath(args?.path).replace(/\.trx$/i, '') }),
        handler: async (args, ctx) => {
            const path = cleanPath(args.path).replace(/\.trx$/i, '');
            const result = await runTransaction(ctx.session, path, args.params || {});
            if (!result.success) return `❌ Falha na execução: ${result.error}`;
            const outs = Object.entries(result.outputs);
            if (!outs.length) return '✅ Executada com sucesso (sem outputs).';
            return '✅ Executada com sucesso.\n\nOutputs:\n' + outs.map(([k, v]) => `• ${k} = ${v}`).join('\n');
        },
    },
    {
        name: 'trx_list_jco_connections',
        description: 'Lista as conexões JCO (SAP backend) disponíveis no servidor MII.',
        category: 'read',
        inputSchema: { type: 'object', properties: {} },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (_args, ctx) => {
            const conns = await getJCOConnections(ctx.session);
            return conns.length ? conns.map((c) => `• ${c}`).join('\n') : 'Nenhuma conexão JCO encontrada.';
        },
    },
    {
        name: 'trx_get_jco_connection_info',
        description: 'Retorna detalhes de uma conexão JCO (R3NAME, CLIENT, SERVER, LANGUAGE).',
        category: 'read',
        inputSchema: {
            type: 'object',
            properties: { connectionName: { type: 'string', description: 'Nome da conexão JCO' } },
            required: ['connectionName'],
        },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (args, ctx) => {
            const info = await getJCOConnectionInfo(ctx.session, args.connectionName);
            return info ? JSON.stringify(info, null, 2) : `Conexão não encontrada: ${args.connectionName}`;
        },
    },
    {
        name: 'trx_list_bls_credentials',
        description: 'Lista os nomes das credenciais BLS disponíveis no servidor MII.',
        category: 'read',
        inputSchema: { type: 'object', properties: {} },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (_args, ctx) => {
            const creds = await getBLSCredentials(ctx.session);
            return creds.length ? creds.map((c) => `• ${c}`).join('\n') : 'Nenhuma credencial BLS encontrada.';
        },
    },
];
