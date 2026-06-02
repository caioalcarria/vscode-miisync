import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type GitMode = 'inherit' | 'always' | 'disabled';
export type GitCommitOnUpload = 'disabled' | 'ask' | 'always';

export interface GitResult {
    committed: boolean;
    skipped?: boolean;
    error?: string;
}

/**
 * Resolve o comportamento efetivo a partir do mode do MCP e do gitCommitOnUpload
 * da extensão. Como o MCP é headless, 'ask' é tratado como 'always'.
 */
function shouldCommit(mode: GitMode, inherit?: GitCommitOnUpload): boolean {
    if (mode === 'disabled') return false;
    if (mode === 'always') return true;
    // inherit
    const eff = inherit ?? 'ask';
    return eff === 'always' || eff === 'ask';
}

async function git(repoDir: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: repoDir });
    return stdout.trim();
}

/**
 * Commita um arquivo no git do projeto após upload. Best-effort: nunca lança.
 * Procura o repo a partir da pasta do próprio arquivo (suporta repos nas
 * ramificações, não na raiz do workspace).
 */
export async function commitAfterUpload(
    localFilePath: string,
    message: string,
    mode: GitMode,
    inherit?: GitCommitOnUpload
): Promise<GitResult> {
    if (!shouldCommit(mode, inherit)) {
        return { committed: false, skipped: true };
    }
    try {
        const fileDir = path.dirname(localFilePath);
        // Descobre a raiz do repositório que contém o arquivo
        let repoRoot: string;
        try {
            repoRoot = await git(fileDir, ['rev-parse', '--show-toplevel']);
        } catch {
            return { committed: false, skipped: true, error: 'Arquivo não está em um repositório git.' };
        }

        const rel = path.relative(repoRoot, localFilePath).replace(/\\/g, '/');
        await git(repoRoot, ['add', '--', rel]);

        // Só commita se houver algo staged para este arquivo
        try {
            await git(repoRoot, ['diff', '--cached', '--quiet', '--', rel]);
            return { committed: false, skipped: true }; // sem mudanças
        } catch {
            // diff --quiet sai com código 1 quando HÁ mudanças → segue o commit
        }

        await git(repoRoot, ['commit', '-m', message, '--', rel]);
        return { committed: true };
    } catch (e: any) {
        return { committed: false, error: e?.message || String(e) };
    }
}
