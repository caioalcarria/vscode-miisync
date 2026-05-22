import { MIIServer } from '../extension/system';
import { Request, Service } from './abstract/miiservice';

class MiiCatalogService extends Service {
    readonly name = 'MII Catalog';
    readonly mode = 'XMII/Catalog';

    async loadTransaction(system: MIIServer, objectName: string): Promise<string | null> {
        const url = new URL(this.generateURL(system));
        const body = `Mode=Load&Class=Transaction&ObjectName=${encodeURIComponent(objectName)}&TemporaryFile=false&Content-Type=text%2Fxml`;
        const { value, isError } = await this.fetch(url, { body });
        return isError ? null : (value as string) || null;
    }

    async saveTransaction(system: MIIServer, objectName: string, content: string): Promise<{ ok: boolean; error?: string }> {
        const url = new URL(this.generateURL(system));
        const body = `Mode=Save&Class=Transaction&ObjectName=${encodeURIComponent(objectName)}&Content=${encodeURIComponent(content)}`;
        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return { ok: false, error: 'Network error' };
        const parsed = this.parseXML(value as string);
        const fatal = parsed?.Rowsets?.FatalError;
        return fatal ? { ok: false, error: String(fatal) } : { ok: true };
    }

    async loadQueryTemplate(system: MIIServer, objectName: string): Promise<string | null> {
        const url = new URL(this.generateURL(system));
        const body = `Mode=Load&Class=Template&Content-Type=text%2Fxml&TemporaryFile=false&ObjectName=${encodeURIComponent(objectName)}`;
        const { value, isError } = await this.fetch(url, { body });
        return isError ? null : (value as string) || null;
    }

    async saveQuery(system: MIIServer, objectName: string, content: string): Promise<{ ok: boolean; error?: string }> {
        const url = new URL(this.generateURL(system));
        const body = `Mode=Save&Class=SQLQuery&ObjectName=${encodeURIComponent(objectName)}&Content=${encodeURIComponent(content)}`;
        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return { ok: false, error: 'Network error' };
        const parsed = this.parseXML(value as string);
        const fatal = parsed?.Rowsets?.FatalError;
        return fatal ? { ok: false, error: String(fatal) } : { ok: true };
    }

    async saveTempQuery(system: MIIServer, tmpName: string, content: string): Promise<{ ok: boolean; path: string; error?: string }> {
        const url = new URL(this.generateURL(system));
        const body = [
            'Mode=Save',
            'Class=SQLQuery',
            `ObjectName=${encodeURIComponent(tmpName)}`,
            'TemporaryFile=true',
            `TempFileName=${encodeURIComponent(tmpName)}`,
            `Content=${encodeURIComponent(content)}`,
        ].join('&');
        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return { ok: false, path: tmpName, error: 'Network error' };
        const str = value as string;
        const parsed = this.parseXML(str);
        const fatal = parsed?.Rowsets?.FatalError;
        if (fatal) return { ok: false, path: tmpName, error: String(fatal) };
        // Extract the actual stored path from the response
        const rows = parsed?.Rowsets?.Rowset?.Row;
        const row = Array.isArray(rows) ? rows[0] : rows;
        const tempPath = row?.TempFileName ?? row?.ObjectName ?? row?.Path ?? tmpName;
        return { ok: true, path: String(tempPath) };
    }

    async call(_request: Request): Promise<any> { return null; }
    get(server: MIIServer): string { return this.generateURL(server); }
    protected generateParams(): string { return ''; }
}

export const miiCatalogService = new MiiCatalogService();
