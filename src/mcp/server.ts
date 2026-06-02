import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getMainSystem, readProjectConfig } from './configReader';
import { login, MiiSession, readFile as clientReadFile, saveFile as clientSaveFile } from './miiClient';
import { loadPolicy, NormalizedPolicy, severityToLevel } from './security/policy';
import { decide, OpClass } from './security/guard';
import { validateToken, confirmationResponse } from './security/token';
import { backupRemote } from './security/backup';
import { audit } from './security/audit';
import { ToolCtx, ToolDef, ok, err } from './tools/types';
import { configTools } from './tools/config';
import { webTools } from './tools/web';
import { catalogTools } from './tools/catalog';
import { tqsqTools } from './tools/tqsq';
import { trxTools } from './tools/trx';

// ─── Registry ─────────────────────────────────────────────────────────────────

const REGISTRY: ToolDef[] = [
    ...configTools,
    ...webTools,
    ...catalogTools,
    ...tqsqTools,
    ...trxTools,
];

// ─── Contexto (config + sessão) ─────────────────────────────────────────────--

let _session: MiiSession | null = null;
let _ctx: Omit<ToolCtx, 'session'> | null = null;

function loadStaticCtx(): Omit<ToolCtx, 'session'> {
    if (_ctx) return _ctx;
    const config = readProjectConfig();
    const policy: NormalizedPolicy = loadPolicy(config);
    const system = config ? getMainSystem(config) : null;
    _ctx = {
        policy,
        severityLevel: severityToLevel(system?.severity),
        severityLabel: system?.severity || '1-medium',
        remotePath: (config?.remotePath || '').replace(/\/+$/, ''),
        projectRoot: process.env.MIISYNC_PROJECT || process.cwd(),
        gitCommitOnUpload: config?.gitCommitOnUpload,
    };
    return _ctx;
}

async function getSession(): Promise<MiiSession> {
    if (_session) return _session;
    const config = readProjectConfig();
    if (!config) throw new Error('miisync.json não encontrado. Execute o agente dentro de uma pasta de projeto MiiSync.');
    const system = getMainSystem(config);
    if (!system) throw new Error('Nenhum sistema configurado em miisync.json.');
    process.stderr.write(`[miisync-mcp] Conectando em ${system.host}:${system.port}...\n`);
    _session = await login(system);
    if (!_session) throw new Error(`Falha ao autenticar no MII (${system.host}:${system.port}). Verifique usuário e senha.`);
    process.stderr.write(`[miisync-mcp] Autenticado como ${system.username} (severity=${loadStaticCtx().severityLabel})\n`);
    return _session;
}

// ─── Visibilidade conforme o mode ─────────────────────────────────────────────

function isToolVisible(tool: ToolDef, policy: NormalizedPolicy): boolean {
    if (policy.mode === 'readonly') {
        return tool.category === 'read' || tool.category === 'transform';
    }
    // write / full
    if (tool.category === 'delete') return policy.allowDelete;
    return true;
}

// ─── Dispatch guardado ─────────────────────────────────────────────────────---

async function dispatch(tool: ToolDef, args: any): Promise<{ content: any[]; isError: boolean }> {
    const staticCtx = loadStaticCtx();

    // Sessão (lazy)
    let session: MiiSession;
    try {
        session = await getSession();
    } catch (e: any) {
        return err(`Erro de conexão: ${e?.message || e}`);
    }
    const ctx: ToolCtx = { session, ...staticCtx };

    // 1. Classifica a operação
    let opClass: OpClass, target: string, preview: string | undefined;
    try {
        const c = await tool.classify(args, ctx);
        opClass = c.opClass; target = c.target; preview = c.preview;
    } catch (e: any) {
        return err(`Erro ao classificar operação: ${e?.message || e}`);
    }

    // 2. Decisão do guard
    const decision = decide({
        opClass,
        policy: ctx.policy,
        severityLevel: ctx.severityLevel,
        path: target || undefined,
        remotePath: ctx.remotePath,
    });

    if (decision.deny) {
        audit(ctx.projectRoot, { op: opClass, tool: tool.name, target, result: 'denied', severity: ctx.severityLabel, detail: decision.reason });
        return err(`🚫 Operação negada: ${decision.reason}`);
    }

    // 3. Confirm-token (2 etapas)
    if (decision.requireToken) {
        const provided = args?.confirm_token as string | undefined;
        if (!validateToken(tool.name, target, provided)) {
            audit(ctx.projectRoot, { op: opClass, tool: tool.name, target, result: 'denied', severity: ctx.severityLabel, detail: 'aguardando confirm_token' });
            return err(confirmationResponse(tool.name, target, preview || `${opClass} ${target}`));
        }
    }

    // 4. Backup antes de escrever/apagar
    if (decision.needBackup) {
        const backupClient = {
            readFile: (p: string) => clientReadFile(session, p),
            saveFile: (p: string, c: string) => clientSaveFile(session, p, c).then((r) => r.ok),
        };
        const b = await backupRemote(backupClient, target);
        if (!b.ok) {
            audit(ctx.projectRoot, { op: opClass, tool: tool.name, target, result: 'error', severity: ctx.severityLabel, detail: `backup falhou: ${b.error}` });
            return err(`Falha ao criar backup antes da operação: ${b.error}`);
        }
    }

    // 5. Executa
    try {
        const text = await tool.handler(args, ctx);
        audit(ctx.projectRoot, { op: opClass, tool: tool.name, target, result: 'ok', severity: ctx.severityLabel });
        return ok(text);
    } catch (e: any) {
        audit(ctx.projectRoot, { op: opClass, tool: tool.name, target, result: 'error', severity: ctx.severityLabel, detail: e?.message });
        return err(`Erro: ${e?.message || e}`);
    }
}

// ─── MCP server ────────────────────────────────────────────────────────────---

const server = new Server({ name: 'miisync', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { policy } = loadStaticCtx();
    const tools = REGISTRY.filter((t) => isToolVisible(t, policy)).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
    }));
    return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = REGISTRY.find((t) => t.name === name);
    if (!tool) return err(`Tool desconhecida: ${name}`);
    if (!isToolVisible(tool, loadStaticCtx().policy)) {
        return err(`Tool "${name}" indisponível com a policy atual (mode=${loadStaticCtx().policy.mode}).`);
    }
    return dispatch(tool, args ?? {});
});

async function main() {
    await server.connect(new StdioServerTransport());
}

main().catch((e) => {
    process.stderr.write(`[miisync-mcp] Erro fatal: ${e?.message || e}\n`);
    process.exit(1);
});
