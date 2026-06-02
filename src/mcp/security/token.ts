import { createHash, randomBytes } from 'crypto';

/**
 * Confirm-token em 2 etapas. Como o MCP roda headless (sem diálogo),
 * operações gated devolvem um token na 1ª chamada e só executam na 2ª.
 */

interface PendingToken {
    token: string;
    fingerprint: string; // tool+target — garante que o token vale só p/ aquela ação
    expiresAt: number;
}

const TTL_MS = 60_000; // 60s
const pending = new Map<string, PendingToken>();

function fingerprint(tool: string, target: string): string {
    return createHash('sha256').update(`${tool}::${target}`).digest('hex');
}

/** Emite um token para (tool, target). Retorna a string a ser devolvida ao agente. */
export function issueToken(tool: string, target: string): string {
    const token = randomBytes(4).toString('hex'); // ex: a8f3e1b2
    const fp = fingerprint(tool, target);
    pending.set(fp, { token, fingerprint: fp, expiresAt: Date.now() + TTL_MS });
    return token;
}

/** Valida e consome o token. true = válido (e remove); false = inválido/expirado. */
export function validateToken(tool: string, target: string, token?: string): boolean {
    if (!token) return false;
    const fp = fingerprint(tool, target);
    const entry = pending.get(fp);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
        pending.delete(fp);
        return false;
    }
    const ok = entry.token === token;
    if (ok) pending.delete(fp); // consome (uso único)
    return ok;
}

/** Monta a resposta padrão de "confirmação necessária". */
export function confirmationResponse(tool: string, target: string, preview: string): string {
    const token = issueToken(tool, target);
    return [
        `⚠️ Confirmação necessária para: ${preview}`,
        ``,
        `Para confirmar, chame "${tool}" de novo com o mesmo alvo e:`,
        `  confirm_token: "${token}"`,
        ``,
        `(válido por 60 segundos)`,
    ].join('\n');
}
