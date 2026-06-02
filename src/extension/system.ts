export enum Severity{
    low = "0-low",
    medium = "1-medium",
    high = "2-high",
    critical = "3-critical"
}

export interface MIIServer {
    host: string,
    port: number,
    protocol?: 'http' | 'https',
}

export interface SystemConfig extends MIIServer {
    name: string,
    isMain: boolean,
    severity: Severity
    username: string,
    password?: string,
}

export interface McpClients {
    claudeCode?: boolean,
    geminiCLI?: boolean,
    copilotCLI?: boolean,
    copilotVSCode?: boolean,
}

export type McpMode = 'readonly' | 'write' | 'full';
export type McpGitMode = 'inherit' | 'always' | 'disabled';

export interface McpPolicy {
    /** Linha de base: readonly (só leitura) | write (cria/edita) | full (tudo conforme flags) */
    mode?: McpMode,
    /** Habilita a classe DELETE */
    allowDelete?: boolean,
    /** Permite INSERT/UPDATE/DELETE no tqsq_run_adhoc */
    allowSqlWrite?: boolean,
    /** Permite DROP/ALTER/TRUNCATE/CREATE no tqsq_run_adhoc */
    allowSqlDDL?: boolean,
    /** Permite executar transações (trx_run) */
    allowTrxRun?: boolean,
    /** Exige confirm-token (2 etapas) nas operações gated */
    confirmToken?: boolean,
    /** Globs de caminhos protegidos — escrita/delete negada incondicionalmente */
    protectedPaths?: string[],
    /** Bloqueia operações destrutivas a partir deste severity (inclusive) */
    severityBlock?: Severity,
    /** Exige token para EDIT/DELETE a partir deste severity (inclusive) */
    severityRequireToken?: Severity,
    /** Commit no git ao subir: inherit (usa gitCommitOnUpload) | always | disabled */
    git?: McpGitMode,
    /** Liga o log de auditoria em .miisync/mcp-audit.log */
    audit?: boolean,
}

export interface McpConfig {
    enabled?: boolean,
    clients?: McpClients,
    /** Nome a usar no fallback enterprise do Claude Code (deve estar na allowlist). Vazio = automático. */
    claudeEnterpriseAlias?: string,
    /** Política de segurança aplicada pelo MCP server */
    policy?: McpPolicy,
}

export interface UserConfig {
    systems?: System[],
    removeFromLocalPath?: string[],
    remotePath?: string,
    uploadOnSave?: boolean,
    downloadOnOpen?: boolean,
    ignore?: string[],
    include?: string[],
    useRootConfig?: boolean,
    rootConfig?: string,
    mcp?: McpConfig,
}


export class System implements SystemConfig {
    name: string;
    severity: Severity;
    isMain: boolean;
    host: string;
    port: number;
    protocol?: 'http' | 'https'
    username: string;
    password?: string;

    static fromConfig(systemConfig: SystemConfig) {
        const system = new System();
        for (const key in systemConfig) {
            system[key] = systemConfig[key];
        }
        return system;
    }

    static fromConfigs(configs: SystemConfig[]) {
        return configs.map((config) => this.fromConfig(config));
    }

    private constructor() { }


    /**
     * 
     * @returns https://11.22:5000 or http://11.22:5000
     */
    toURL() {
        return this.host + (this.port ? ":" + this.port : "");
    }

    /**
     * @returns 11.22:5000 or 11.22
     */
    toHost(){
        return this.host + (this.port ? ":" + this.port : "");
    }

    /**
     * @returns name-11.22:5000 or name-11.22
     */
    toString() {
        return this.name + "-" + this.host + (this.port ? ":" + this.port : "");
    }

    /**
     * @returns base64 of toString
     */
    toBase64() {
        return Buffer.from(this.toString()).toString('base64');
    }

}
