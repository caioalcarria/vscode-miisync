/**
 * Backup-antes-de-escrever no servidor. Baixa a versão atual de um arquivo e
 * salva uma cópia com sufixo _BKP_<timestamp> na mesma pasta do servidor.
 *
 * Usa injeção de dependência (BackupClient) para não acoplar ao miiClient
 * completo — o dispatch (Passo 6) injeta a implementação real.
 */

export interface BackupClient {
    /** Lê o conteúdo atual de um arquivo do servidor (texto ou base64). null se não existe. */
    readFile(remotePath: string): Promise<string | null>;
    /** Salva conteúdo num caminho do servidor. */
    saveFile(remotePath: string, content: string): Promise<boolean>;
}

export interface BackupResult {
    ok: boolean;
    backupPath?: string;
    skipped?: boolean; // alvo não existia → nada a fazer
    error?: string;
}

function timestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Gera o caminho de backup: mesma pasta, nome com _BKP_<timestamp> antes da extensão. */
export function buildBackupPath(remotePath: string): string {
    const norm = remotePath.replace(/\\/g, '/');
    const slash = norm.lastIndexOf('/');
    const dir = slash >= 0 ? norm.slice(0, slash + 1) : '';
    const file = slash >= 0 ? norm.slice(slash + 1) : norm;
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : '';
    return `${dir}${base}_BKP_${timestamp()}${ext}`;
}

export async function backupRemote(client: BackupClient, remotePath: string): Promise<BackupResult> {
    try {
        const current = await client.readFile(remotePath);
        if (current == null) {
            return { ok: true, skipped: true }; // não existe → nada a salvar
        }
        const backupPath = buildBackupPath(remotePath);
        const saved = await client.saveFile(backupPath, current);
        if (!saved) return { ok: false, error: 'Falha ao gravar o backup no servidor.' };
        return { ok: true, backupPath };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}
