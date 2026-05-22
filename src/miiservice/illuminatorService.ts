import { MIIServer } from '../extension/system';
import { Request, Service } from './abstract/miiservice';

export interface SQLServer {
    name: string;
    description: string;
}

export interface JCOConnectionInfo {
    name: string;
    r3name?: string;
    client?: string;
    server?: string;
    language?: string;
}

class IlluminatorService extends Service {
    readonly name = 'MII Illuminator';
    readonly mode = 'XMII/Illuminator';

    async getSQLServerList(system: MIIServer): Promise<SQLServer[]> {
        const url = new URL(this.generateURL(system));
        const body = 'Content-Type=text%2Fxml&Service=SystemInfo&Method=SQL&RowCount=250&Mode=ServerList';
        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return [];
        try {
            const parsed = this.parseXML(value as string);
            const rows = parsed?.Rowsets?.Rowset?.Row || [];
            const arr = Array.isArray(rows) ? rows : [rows];
            return arr.map((r: any) => ({
                name: String(r.Name ?? r.ServerName ?? ''),
                description: String(r.Description ?? r.ServerDescription ?? r.Name ?? ''),
            })).filter(s => s.name);
        } catch { return []; }
    }

    async getServerModes(system: MIIServer, serverName: string): Promise<string[]> {
        const url = new URL(this.generateURL(system));
        const body = `Content-Type=text%2Fxml&Server=${encodeURIComponent(serverName)}&Mode=ModeList`;
        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return ['FixedQuery', 'FixedQueryWithOutput', 'Query', 'Command'];
        try {
            const parsed = this.parseXML(value as string);
            const rows = parsed?.Rowsets?.Rowset?.Row || [];
            const arr = Array.isArray(rows) ? rows : [rows];
            return arr.map((r: any) => String(r.Mode ?? r.Name ?? '')).filter(Boolean);
        } catch { return []; }
    }

    async getJCOConnections(system: MIIServer): Promise<string[]> {
        const url = new URL(this.generateURL(system));
        const body = 'Type=JCO&Mode=ConnectionList&Service=SystemInfo&Content-Type=raw%2Fxmii';
        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return [];
        try {
            const parsed = this.parseXML(value as string, { ignoreAttributes: false });
            const rows = parsed?.Rowsets?.Rowset?.Row || [];
            const arr = Array.isArray(rows) ? rows : [rows];
            return arr.map((r: any) => String(r.Name ?? r.ConnectionName ?? '')).filter(Boolean);
        } catch { return []; }
    }

    async getJCOConnectionInfo(system: MIIServer, connectionName: string): Promise<JCOConnectionInfo | null> {
        const url = new URL(this.generateURL(system));
        const body = `Type=JCO&Mode=ConnectionInfo&Service=SystemInfo&Name=${encodeURIComponent(connectionName)}&Content-Type=raw%2Fxmii`;
        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return null;
        try {
            const parsed = this.parseXML(value as string, { ignoreAttributes: false });
            const row = parsed?.Rowsets?.Rowset?.Row?.[0] ?? parsed?.Rowsets?.Rowset?.Row;
            if (!row) return null;
            return {
                name: connectionName,
                r3name: row.R3NAME ?? row.SystemID,
                client: row.CLIENT,
                server: row.SERVER ?? row.AppServerHost,
                language: row.LANGUAGE ?? row.Language,
            };
        } catch { return null; }
    }

    async getBLSCredentials(system: MIIServer): Promise<string[]> {
        const url = new URL(this.generateURL(system));
        const body = 'Type=BLS&Mode=CredentialList&Service=SystemInfo&Content-Type=raw%2Fxmii';
        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return [];
        try {
            const parsed = this.parseXML(value as string, { ignoreAttributes: false });
            const rows = parsed?.Rowsets?.Rowset?.Row || [];
            const arr = Array.isArray(rows) ? rows : [rows];
            return arr.map((r: any) => String(r.Name ?? '')).filter(Boolean);
        } catch { return []; }
    }

    // queryTemplatePath is the server-side path of a saved (temp) query template file.
    // testValues maps param index to value; these replace [Param.N] in the SQL on the server.
    async executeTestQuery(system: MIIServer, queryTemplatePath: string, testValues?: Record<number, string>): Promise<string | null> {
        const url = new URL(this.generateURL(system));
        const qt = encodeURIComponent(queryTemplatePath);
        let body = `IsTesting=T&QueryTemplate=${qt}&Content-Type=text%2Fxml&QueryTemplate=${qt}`;
        if (testValues) {
            for (const [idx, val] of Object.entries(testValues)) {
                body += `&Param.${idx}=${encodeURIComponent(String(val ?? ''))}`;
            }
        }
        const { value, isError } = await this.fetch(url, { body });
        return isError ? null : (value as string) || null;
    }

    async getTableList(system: MIIServer, serverName: string): Promise<string[]> {
        const url = new URL(this.generateURL(system));
        const body = `Content-Type=text%2Fxml&Server=${encodeURIComponent(serverName)}&Mode=TableList`;
        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return [];
        try {
            const parsed = this.parseXML(value as string);
            const rows = parsed?.Rowsets?.Rowset?.Row ?? [];
            const arr = Array.isArray(rows) ? rows : [rows];
            return arr.map((r: any) => String(r.TableName ?? '')).filter(Boolean);
        } catch { return []; }
    }

    async getColumnList(system: MIIServer, serverName: string, tableName: string): Promise<string[]> {
        const url = new URL(this.generateURL(system));
        const body = `Content-Type=text%2Fxml&Mode=ColumnList&Server=${encodeURIComponent(serverName)}&Group=${encodeURIComponent(tableName)}`;
        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return [];
        try {
            const parsed = this.parseXML(value as string);
            const rows = parsed?.Rowsets?.Rowset?.Row ?? [];
            const arr = Array.isArray(rows) ? rows : [rows];
            return arr.map((r: any) => String(r.ColumnName ?? '')).filter(Boolean);
        } catch { return []; }
    }

    async call(_request: Request): Promise<any> { return null; }
    get(server: MIIServer): string { return this.generateURL(server); }
    protected generateParams(): string { return ''; }
}

export const illuminatorService = new IlluminatorService();
