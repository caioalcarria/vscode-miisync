/**
 * Classifica statements SQL para o gating do tqsq_run_adhoc.
 * SELECT → leitura livre; INSERT/UPDATE/DELETE → write; DDL → DROP/ALTER/etc.
 */

export type SqlKind = 'READ' | 'WRITE' | 'DDL' | 'UNKNOWN';

export interface SqlClassification {
    kind: SqlKind;
    keyword: string;
    multiStatement: boolean;
    reason?: string;
}

const WRITE_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'UPSERT'];
const DDL_KEYWORDS = ['DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'RENAME', 'GRANT', 'REVOKE'];
const READ_KEYWORDS = ['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'];

/** Remove comentários e literais de string para análise segura. */
function stripNoise(sql: string): string {
    return sql
        .replace(/--[^\n]*/g, ' ')          // comentários de linha
        .replace(/\/\*[\s\S]*?\*\//g, ' ')  // comentários de bloco
        .replace(/'(?:[^']|'')*'/g, "''")   // string literals
        .replace(/"(?:[^"]|"")*"/g, '""')   // identificadores aspas
        .trim();
}

/** Detecta múltiplos statements (; seguido de mais conteúdo). */
function hasMultipleStatements(cleaned: string): boolean {
    const trimmed = cleaned.replace(/;\s*$/, ''); // ignora ; final único
    return /;/.test(trimmed);
}

export function classifySql(rawSql: string): SqlClassification {
    const cleaned = stripNoise(rawSql);
    if (!cleaned) {
        return { kind: 'UNKNOWN', keyword: '', multiStatement: false, reason: 'SQL vazio' };
    }

    const multi = hasMultipleStatements(cleaned);
    const firstWord = (cleaned.match(/^\s*([A-Za-z]+)/)?.[1] || '').toUpperCase();

    let kind: SqlKind = 'UNKNOWN';
    if (READ_KEYWORDS.includes(firstWord)) kind = 'READ';
    else if (WRITE_KEYWORDS.includes(firstWord)) kind = 'WRITE';
    else if (DDL_KEYWORDS.includes(firstWord)) kind = 'DDL';

    return {
        kind,
        keyword: firstWord,
        multiStatement: multi,
        reason: kind === 'UNKNOWN' ? `Statement não reconhecido: ${firstWord}` : undefined,
    };
}

/** Mapeia a classificação SQL para a OpClass do guard. */
export function sqlKindToOpClass(kind: SqlKind): 'SQL_READ' | 'SQL_WRITE' | 'SQL_DDL' | null {
    switch (kind) {
        case 'READ': return 'SQL_READ';
        case 'WRITE': return 'SQL_WRITE';
        case 'DDL': return 'SQL_DDL';
        default: return null;
    }
}
