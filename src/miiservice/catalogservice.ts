import { MIIServer } from '../extension/system';
import { Request, Service } from './abstract/miiservice';

class CatalogService extends Service {
    readonly name = "Load Catalog";
    readonly mode = "XMII/Catalog";

    async call(request: Request): Promise<string | null> {
        const url = new URL(this.generateURL(request));
        const body = "Mode=Load&Class=ComponentCatalog&ObjectName=Main.CAT&TemporaryFile=false&Content-Type=text/xml";
        const { value, isError } = await this.fetch(url, { body });
        return isError ? null : (value as string);
    }

    get(server: MIIServer) {
        return this.generateURL(server);
    }

    protected generateParams(): string {
        return '';
    }
}

export const catalogService = new CatalogService();
