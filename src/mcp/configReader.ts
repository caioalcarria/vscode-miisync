import * as fs from 'fs';
import * as path from 'path';

export interface RawSystemConfig {
    name: string;
    host: string;
    port: number;
    protocol?: 'http' | 'https';
    username: string;
    password?: string;
    isMain?: boolean;
    severity?: string; // '0-low' | '1-medium' | '2-high' | '3-critical'
}

export interface RawMcpPolicy {
    mode?: 'readonly' | 'write' | 'full';
    allowDelete?: boolean;
    allowSqlWrite?: boolean;
    allowSqlDDL?: boolean;
    allowTrxRun?: boolean;
    allowSensitiveOperations?: boolean;
    protectedPaths?: string[];
    severityBlock?: string;
    git?: 'inherit' | 'always' | 'disabled';
    audit?: boolean;
}

export interface RawMcpConfig {
    enabled?: boolean;
    clients?: {
        claudeCode?: boolean;
        geminiCLI?: boolean;
        copilotCLI?: boolean;
        copilotVSCode?: boolean;
    };
    policy?: RawMcpPolicy;
}

export interface RawProjectConfig {
    systems?: RawSystemConfig[];
    remotePath?: string;
    gitCommitOnUpload?: 'disabled' | 'ask' | 'always';
    mcp?: RawMcpConfig;
}

export function readProjectConfig(): RawProjectConfig | null {
    // Priority: env var set by mcpWriter → process.cwd()
    const projectRoot = process.env.MIISYNC_PROJECT || process.cwd();
    const configPath = path.join(projectRoot, '.vscode', 'miisync.json');
    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
        return null;
    }
}

export function getMainSystem(config: RawProjectConfig): RawSystemConfig | null {
    const systems = config.systems || [];
    return systems.find(s => s.isMain) || systems[0] || null;
}
