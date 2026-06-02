import * as fs from 'fs';
import * as path from 'path';
import { commitAfterUpload } from '../security/git';
import { ToolCtx } from './types';

/**
 * Após um upload bem-sucedido, opcionalmente grava o conteúdo num arquivo local
 * e faz commit no git do projeto (conforme a policy + gitCommitOnUpload).
 * Retorna um sufixo de status para anexar à mensagem ao agente.
 */
export async function persistLocalAndCommit(
    ctx: ToolCtx,
    localPath: string | undefined,
    content: string,
    commitMsg: string
): Promise<string> {
    if (!localPath) return '';
    try {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, content, 'utf8');
    } catch (e: any) {
        return ` (local: falha ao gravar — ${e?.message || e})`;
    }
    const git = await commitAfterUpload(localPath, commitMsg, ctx.policy.git, ctx.gitCommitOnUpload);
    if (git.committed) return ' (git: commitado)';
    if (git.skipped) return '';
    return ` (git: ${git.error || 'sem commit'})`;
}
