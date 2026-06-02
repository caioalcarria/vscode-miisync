import { getMainSystem, readProjectConfig } from '../configReader';
import { ToolDef } from './types';

function maskSystem(s: any) {
    return {
        name: s.name,
        host: s.host,
        port: s.port,
        protocol: s.protocol || 'http',
        username: s.username,
        password: s.password ? '••••••••' : undefined,
        severity: s.severity || '1-medium',
        isMain: !!s.isMain,
    };
}

export const configTools: ToolDef[] = [
    {
        name: 'config_get',
        description: 'Retorna a configuração do projeto MiiSync (remotePath, sistema ativo, policy do MCP). Credenciais são mascaradas.',
        category: 'read',
        inputSchema: { type: 'object', properties: {} },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (_args, ctx) => {
            const config = readProjectConfig();
            if (!config) return 'miisync.json não encontrado.';
            const active = getMainSystem(config);
            const out = {
                remotePath: config.remotePath || '',
                activeSystem: active ? maskSystem(active) : null,
                mcpPolicy: {
                    mode: ctx.policy.mode,
                    allowDelete: ctx.policy.allowDelete,
                    allowSqlWrite: ctx.policy.allowSqlWrite,
                    allowSqlDDL: ctx.policy.allowSqlDDL,
                    allowTrxRun: ctx.policy.allowTrxRun,
                    protectedPaths: ctx.policy.protectedPaths,
                },
                severity: ctx.severityLabel,
            };
            return JSON.stringify(out, null, 2);
        },
    },
    {
        name: 'config_list_systems',
        description: 'Lista todos os sistemas MII configurados no projeto (credenciais mascaradas).',
        category: 'read',
        inputSchema: { type: 'object', properties: {} },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async () => {
            const config = readProjectConfig();
            const systems = config?.systems || [];
            if (!systems.length) return 'Nenhum sistema configurado.';
            return JSON.stringify(systems.map(maskSystem), null, 2);
        },
    },
    {
        name: 'auth_status',
        description: 'Mostra o estado da conexão com o servidor MII (sistema, usuário, severity).',
        category: 'read',
        inputSchema: { type: 'object', properties: {} },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (_args, ctx) => {
            const sys = ctx.session.system;
            return JSON.stringify({
                connected: true,
                system: sys.name,
                host: `${sys.host}:${sys.port}`,
                user: sys.username,
                severity: ctx.severityLabel,
            }, null, 2);
        },
    },
    {
        name: 'auth_current_user',
        description: 'Retorna o usuário autenticado no servidor MII.',
        category: 'read',
        inputSchema: { type: 'object', properties: {} },
        classify: () => ({ opClass: 'READ', target: '' }),
        handler: async (_args, ctx) => {
            const sys = ctx.session.system;
            return `Usuário: ${sys.username}\nServidor: ${sys.host}:${sys.port}\nSistema: ${sys.name} (${ctx.severityLabel})`;
        },
    },
];
