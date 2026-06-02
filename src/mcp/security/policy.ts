import { RawMcpPolicy, RawProjectConfig } from '../configReader';

export type McpMode = 'readonly' | 'write' | 'full';
export type McpGitMode = 'inherit' | 'always' | 'disabled';

/** Níveis de severity normalizados (0 = mais brando, 3 = mais crítico) */
export const SEVERITY_LEVEL: Record<string, number> = {
    '0-low': 0,
    '1-medium': 1,
    '2-high': 2,
    '3-critical': 3,
};

export function severityToLevel(severity?: string): number {
    if (!severity) return 1; // default medium
    return SEVERITY_LEVEL[severity] ?? 1;
}

export interface NormalizedPolicy {
    mode: McpMode;
    allowDelete: boolean;
    allowSqlWrite: boolean;
    allowSqlDDL: boolean;
    allowTrxRun: boolean;
    confirmToken: boolean;
    protectedPaths: string[];
    severityBlockLevel: number;       // bloqueia destrutivo a partir deste nível
    severityRequireTokenLevel: number; // exige token (EDIT/DELETE) a partir deste nível
    git: McpGitMode;
    audit: boolean;
}

/** Defaults seguros: tudo travado, só leitura. */
const DEFAULT_POLICY: NormalizedPolicy = {
    mode: 'readonly',
    allowDelete: false,
    allowSqlWrite: false,
    allowSqlDDL: false,
    allowTrxRun: true,           // execução de TRX liberada por decisão de projeto
    confirmToken: true,
    protectedPaths: [],
    severityBlockLevel: 3,       // critical bloqueia destrutivo
    severityRequireTokenLevel: 2, // high+ exige token p/ EDIT/DELETE
    git: 'inherit',
    audit: true,
};

export function normalizePolicy(raw?: RawMcpPolicy): NormalizedPolicy {
    if (!raw) return { ...DEFAULT_POLICY };
    return {
        mode: raw.mode ?? DEFAULT_POLICY.mode,
        allowDelete: raw.allowDelete ?? DEFAULT_POLICY.allowDelete,
        allowSqlWrite: raw.allowSqlWrite ?? DEFAULT_POLICY.allowSqlWrite,
        allowSqlDDL: raw.allowSqlDDL ?? DEFAULT_POLICY.allowSqlDDL,
        allowTrxRun: raw.allowTrxRun ?? DEFAULT_POLICY.allowTrxRun,
        confirmToken: raw.confirmToken ?? DEFAULT_POLICY.confirmToken,
        protectedPaths: Array.isArray(raw.protectedPaths) ? raw.protectedPaths : DEFAULT_POLICY.protectedPaths,
        severityBlockLevel: raw.severityBlock !== undefined
            ? severityToLevel(raw.severityBlock)
            : DEFAULT_POLICY.severityBlockLevel,
        severityRequireTokenLevel: raw.severityRequireToken !== undefined
            ? severityToLevel(raw.severityRequireToken)
            : DEFAULT_POLICY.severityRequireTokenLevel,
        git: raw.git ?? DEFAULT_POLICY.git,
        audit: raw.audit ?? DEFAULT_POLICY.audit,
    };
}

export function loadPolicy(config: RawProjectConfig | null): NormalizedPolicy {
    return normalizePolicy(config?.mcp?.policy);
}
