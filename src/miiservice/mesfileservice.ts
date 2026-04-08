import { MIIServer } from '../extension/system';
import { Request, Service } from './abstract/miiservice';

/**
 * Loads a MES file (transaction, query template, etc.) as raw text.
 * Uses Mode=Load which returns the file content directly — NOT LoadBinary/Class=Content
 * which is designed for WEB-directory content files only.
 */
class LoadMesFileService extends Service {
    readonly name = 'Load MES File';
    readonly mode = 'XMII/Catalog?Mode=Load&Content-Type=text/xml';

    async call(request: Request, filePath: string): Promise<string | null> {
        const url = this.get(request, filePath);
        const { value, isError } = await this.fetch(new URL(url));
        return isError ? null : (value as string) || null;
    }

    get(server: MIIServer, filePath: string): string {
        return this.generateURL(server) + `&${this.generateParams(filePath)}&__=${Date.now()}`;
    }

    protected generateParams(file: string): string {
        return 'ObjectName=' + file;
    }
}

/**
 * Saves a MES file (transaction, query template, etc.) as raw text content.
 * Uses Mode=SaveBinary without Class=Content — the Class=Content variant is
 * reserved for WEB-directory files.
 */
class SaveMesFileService extends Service {
    readonly name = 'Save MES File';
    readonly mode = 'XMII/Catalog?Mode=SaveBinary';

    async call(request: Request, filePath: string, content: string): Promise<boolean> {
        const url = this.get(request, filePath);
        const base64 = encodeURIComponent(Buffer.from(content).toString('base64'));
        const body = 'Content=' + base64;
        const { value, isError } = await this.fetch(new URL(url), { body });
        if (isError || !value) return false;
        try {
            const parsed = this.parseXML(value as string);
            return parsed && !('FatalError' in (parsed?.Rowsets ?? {}));
        } catch {
            return false;
        }
    }

    get(server: MIIServer, filePath: string): string {
        return this.generateURL(server) + `&${this.generateParams(filePath)}&__=${Date.now()}`;
    }

    protected generateParams(file: string): string {
        return 'ObjectName=' + file;
    }
}

export const loadMesFileService = new LoadMesFileService();
export const saveMesFileService = new SaveMesFileService();
