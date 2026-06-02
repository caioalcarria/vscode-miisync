import { NormalizedPolicy } from './policy';

/** Classes de operação (ver seção 3.2 do plano) */
export type OpClass =
    | 'READ'
    | 'TRANSFORM'
    | 'CREATE'
    | 'EDIT'
    | 'DELETE'
    | 'EXECUTE_TRX'
    | 'SQL_READ'
    | 'SQL_WRITE'
    | 'SQL_DDL';

export interface GuardDecision {
    allow: boolean;        // pode prosseguir (talvez exigindo token)
    deny: boolean;         // negado incondicionalmente
    requireToken: boolean; // precisa de confirm-token (2 etapas)
    needBackup: boolean;   // fazer backup no servidor antes
    reason?: string;       // motivo (para deny ou aviso)
}

export interface GuardInput {
    opClass: OpClass;
    policy: NormalizedPolicy;
    severityLevel: number;   // 0..3
    path?: string;           // alvo (quando aplicável)
    remotePath?: string;     // remotePath do projeto, p/ confinamento
}

// ─── Glob / scope helpers ────────────────────────────────────────────────────

function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Converte um glob (*, **) em RegExp. */
function globToRegExp(glob: string): RegExp {
    const g = normalizePath(glob);
    let re = '';
    for (let i = 0; i < g.length; i++) {
        const c = g[i];
        if (c === '*') {
            if (g[i + 1] === '*') {
                re += '.*';      // ** = qualquer coisa, inclusive /
                i++;
                if (g[i + 1] === '/') i++; // consome a barra após **
            } else {
                re += '[^/]*';   // * = qualquer coisa menos /
            }
        } else if ('.+?^${}()|[]\\'.includes(c)) {
            re += '\\' + c;
        } else {
            re += c;
        }
    }
    return new RegExp('^' + re + '$', 'i');
}

export function matchProtectedPath(targetPath: string, globs: string[]): boolean {
    if (!targetPath || !globs?.length) return false;
    const t = normalizePath(targetPath);
    return globs.some((g) => globToRegExp(g).test(t));
}

/** Verifica se targetPath está dentro do remotePath (subárvore). */
export function isInScope(targetPath: string, remotePath?: string): boolean {
    if (!remotePath) return true; // sem remotePath definido → sem confinamento
    const root = normalizePath(remotePath);
    if (!root) return true;
    const t = normalizePath(targetPath);
    return t === root || t.startsWith(root + '/');
}

// ─── Decisão central ─────────────────────────────────────────────────────────

const ALLOW = (over: Partial<GuardDecision> = {}): GuardDecision =>
    ({ allow: true, deny: false, requireToken: false, needBackup: false, ...over });
const DENY = (reason: string): GuardDecision =>
    ({ allow: false, deny: true, requireToken: false, needBackup: false, reason });

export function decide(input: GuardInput): GuardDecision {
    const { opClass, policy, severityLevel, path, remotePath } = input;

    const isPathOp = opClass === 'CREATE' || opClass === 'EDIT' || opClass === 'DELETE';

    // 1. Confinamento de escopo (operações com path)
    if (path && (isPathOp || opClass === 'READ')) {
        if (!isInScope(path, remotePath)) {
            return DENY(`Caminho fora do escopo do projeto (remotePath="${remotePath}"): ${path}`);
        }
    }

    // 2. Protected-paths (só barra escrita/delete; leitura é permitida)
    if (path && isPathOp && matchProtectedPath(path, policy.protectedPaths)) {
        return DENY(`Caminho protegido por policy: ${path}`);
    }

    // 3. Sempre livres
    if (opClass === 'READ' || opClass === 'TRANSFORM' || opClass === 'SQL_READ') {
        return ALLOW();
    }

    // 4. Mode gate (readonly bloqueia tudo que não é leitura/transform)
    if (policy.mode === 'readonly') {
        return DENY('Modo readonly: operações de escrita/execução desabilitadas.');
    }

    const tokenBySeverity = policy.confirmToken && severityLevel >= policy.severityRequireTokenLevel;

    // 5. Lógica por classe
    switch (opClass) {
        case 'CREATE':
            // Criar item novo: livre até high; token em critical (>= severityBlock)
            if (severityLevel >= policy.severityBlockLevel) {
                return ALLOW({ requireToken: policy.confirmToken });
            }
            return ALLOW();

        case 'EDIT':
            // Sobrescrever existente: backup sempre; token a partir de severityRequireToken
            return ALLOW({ needBackup: true, requireToken: tokenBySeverity });

        case 'DELETE':
            if (!policy.allowDelete) return DENY('DELETE desabilitado pela policy (allowDelete=false).');
            if (severityLevel >= policy.severityBlockLevel) {
                return DENY('DELETE bloqueado em sistema critical.');
            }
            // Delete sempre exige token + backup (quando permitido)
            return ALLOW({ needBackup: true, requireToken: policy.confirmToken });

        case 'EXECUTE_TRX':
            if (!policy.allowTrxRun) return DENY('Execução de TRX desabilitada (allowTrxRun=false).');
            return ALLOW(); // sem token por decisão de projeto

        case 'SQL_WRITE':
            if (!policy.allowSqlWrite) return DENY('SQL write desabilitado (allowSqlWrite=false).');
            if (severityLevel >= policy.severityBlockLevel) {
                return DENY('SQL write bloqueado em sistema critical.');
            }
            return ALLOW({ requireToken: tokenBySeverity });

        case 'SQL_DDL':
            if (!policy.allowSqlDDL) return DENY('SQL DDL desabilitado (allowSqlDDL=false).');
            if (severityLevel >= policy.severityBlockLevel) {
                return DENY('SQL DDL bloqueado em sistema critical.');
            }
            return ALLOW({ requireToken: policy.confirmToken });

        default:
            return DENY(`Classe de operação desconhecida: ${opClass}`);
    }
}
