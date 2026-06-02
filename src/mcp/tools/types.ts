import { MiiSession } from '../miiClient';
import { NormalizedPolicy } from '../security/policy';
import { OpClass } from '../security/guard';

/** Categoria estática da tool — usada para decidir visibilidade conforme o mode. */
export type ToolCategory = 'read' | 'transform' | 'write' | 'delete' | 'execute';

export interface ToolCtx {
    session: MiiSession;
    policy: NormalizedPolicy;
    severityLevel: number;
    severityLabel: string;
    remotePath: string;
    projectRoot: string;
    gitCommitOnUpload?: 'disabled' | 'ask' | 'always';
}

export interface Classification {
    opClass: OpClass;
    /** Alvo da operação (path / transaction / sql) — usado p/ scope, protected-paths e token. */
    target: string;
    /** Texto curto exibido na confirmação (quando requer token). */
    preview?: string;
}

export interface ToolDef {
    name: string;
    description: string;
    category: ToolCategory;
    inputSchema: Record<string, any>;
    /** Classifica a chamada (pode ser dinâmico: ex. CREATE vs EDIT por existência). */
    classify: (args: any, ctx: ToolCtx) => Promise<Classification> | Classification;
    /** Executa a operação e retorna texto. */
    handler: (args: any, ctx: ToolCtx) => Promise<string>;
}

export function ok(text: string) {
    return { content: [{ type: 'text', text }], isError: false };
}

export function err(text: string) {
    return { content: [{ type: 'text', text }], isError: true };
}
