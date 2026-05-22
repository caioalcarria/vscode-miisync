import { MIIServer } from '../extension/system';
import { Request, Service } from './abstract/miiservice';

export interface TransactionRunResult {
    success: boolean;
    outputs: Record<string, string>;
    error?: string;
    rawXml?: string;
}

class RunnerService extends Service {
    readonly name = 'MII Runner';
    readonly mode = 'XMII/Runner';

    async execute(
        system: MIIServer,
        transactionPath: string,
        inputParams: Record<string, string> = {}
    ): Promise<TransactionRunResult> {
        const url = new URL(this.generateURL(system));
        const parts = [`Transaction=${encodeURIComponent(transactionPath)}`, 'OutputParameter=XML'];
        for (const [key, val] of Object.entries(inputParams)) {
            parts.push(`Context.${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
        }
        const body = parts.join('&');

        const { value, isError } = await this.fetch(url, { body });
        if (isError || !value) return { success: false, outputs: {}, error: 'Network error' };

        const rawXml = value as string;
        try {
            const parsed = this.parseXML(rawXml, {
                ignoreAttributes: false,
                isArray: () => false,
            });
            const fatal = parsed?.Rowsets?.FatalError;
            if (fatal) return { success: false, outputs: {}, error: String(fatal), rawXml };

            // Extract output context variables from the Response
            const outputs: Record<string, string> = {};
            const rowset = parsed?.Rowsets?.Rowset;
            const row = Array.isArray(rowset) ? rowset[0]?.Row : rowset?.Row;
            if (row && typeof row === 'object') {
                for (const [k, v] of Object.entries(row as Record<string, any>)) {
                    if (!k.startsWith('@')) outputs[k] = String(v ?? '');
                }
            }
            return { success: true, outputs, rawXml };
        } catch (e: any) {
            return { success: false, outputs: {}, error: e.message, rawXml };
        }
    }

    async call(_request: Request): Promise<any> { return null; }
    get(server: MIIServer): string { return this.generateURL(server); }
    protected generateParams(): string { return ''; }
}

export const runnerService = new RunnerService();
