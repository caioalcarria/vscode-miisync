import * as fs from 'fs';
import * as path from 'path';

/**
 * Log de auditoria append-only em .miisync/mcp-audit.log dentro do projeto.
 * Best-effort: nunca lança (auditoria não pode quebrar a operação).
 */
export function audit(
    projectRoot: string,
    entry: {
        op: string;          // READ | CREATE | EDIT | DELETE | EXECUTE | ...
        tool: string;
        target: string;      // path / sql / transaction
        result: 'ok' | 'denied' | 'error';
        severity?: string;
        token?: string;
        detail?: string;
    }
): void {
    try {
        const dir = path.join(projectRoot, '.miisync');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const line = [
            new Date().toISOString(),
            entry.op,
            entry.tool,
            entry.target,
            entry.result,
            entry.severity ? `sev=${entry.severity}` : '',
            entry.token ? `token=${entry.token}` : '',
            entry.detail ? `(${entry.detail})` : '',
        ].filter(Boolean).join('  ');
        fs.appendFileSync(path.join(dir, 'mcp-audit.log'), line + '\n', 'utf-8');
    } catch {
        // auditoria é best-effort
    }
}
