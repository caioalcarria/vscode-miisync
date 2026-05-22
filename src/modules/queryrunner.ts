import { randomUUID } from 'crypto';
import { MIIServer } from '../extension/system';
import { miiCatalogService } from '../miiservice/miiCatalogService';
import { illuminatorService } from '../miiservice/illuminatorService';
import { XMLParser } from 'fast-xml-parser';

export interface QueryTestResult {
    columns: string[];
    rows: Record<string, string>[];
    rowCount: number;
    executionTimeMs: number;
    error?: string;
}

function parseQueryResults(xml: string): Omit<QueryTestResult, 'executionTimeMs'> {
    if (!xml) return { columns: [], rows: [], rowCount: 0, error: 'Empty response' };
    try {
        const parser = new XMLParser({
            ignoreAttributes: false,
            isArray: (name) => name === 'Row' || name === 'Column',
        });
        const doc = parser.parse(xml);
        const fatal = doc?.Rowsets?.FatalError;
        if (fatal) return { columns: [], rows: [], rowCount: 0, error: String(fatal) };

        const rowset = doc?.Rowsets?.Rowset;
        const rs = Array.isArray(rowset) ? rowset[0] : rowset;

        const colDefs: any[] = rs?.Columns?.Column ?? [];
        const columns = colDefs.map((c: any) => String(c?.['@_Name'] ?? c?.Name ?? '')).filter(Boolean);

        const rawRows: any[] = rs?.Row ?? [];
        const rows = rawRows.map((r: any) => {
            const obj: Record<string, string> = {};
            for (const col of columns) {
                obj[col] = r[col] != null ? String(r[col]) : '';
            }
            return obj;
        });

        const effectiveCols = columns.length > 0
            ? columns
            : rows.length > 0 ? Object.keys(rows[0]) : [];

        return { columns: effectiveCols, rows, rowCount: rows.length };
    } catch (e: any) {
        return { columns: [], rows: [], rowCount: 0, error: e.message };
    }
}

/**
 * Saves the query to the actual remote path on the MII server, then executes
 * via the Illuminator — matching the exact flow used by the MII Workbench.
 *
 * @param remotePath  Catalog object path without extension, e.g.
 *                    "Default/AberturaTurno/Queries/NotasQM2"
 */
export async function runQueryTest(
    system: MIIServer,
    remotePath: string,
    tqsqXml: string,
    testValues: Record<number, string>
): Promise<QueryTestResult> {
    const t0 = Date.now();
    try {
        // Save current state to the real server path (same as MII Workbench behavior)
        const saveResult = await miiCatalogService.saveQuery(system, remotePath, tqsqXml);
        if (!saveResult.ok) {
            return { columns: [], rows: [], rowCount: 0, executionTimeMs: Date.now() - t0, error: saveResult.error || 'Erro ao salvar no servidor' };
        }

        // Execute via Illuminator with the actual path + param values
        const resultXml = await illuminatorService.executeTestQuery(system, remotePath, testValues);
        const executionTimeMs = Date.now() - t0;
        if (!resultXml) {
            return { columns: [], rows: [], rowCount: 0, executionTimeMs, error: 'No response from server' };
        }
        const parsed = parseQueryResults(resultXml);
        return { ...parsed, executionTimeMs };
    } catch (e: any) {
        return { columns: [], rows: [], rowCount: 0, executionTimeMs: Date.now() - t0, error: e.message };
    }
}

/**
 * Runs an ad-hoc query without a saved catalog path — mirrors what MII Workbench
 * does internally: saves to a TemporaryFile (TMP<UUID>) and executes via Illuminator.
 */
/**
 * Mirrors the MII Workbench "test without saving" flow:
 * saves the query as TMP<UUID> at catalog root (no folder prefix),
 * executes it via the Illuminator, then lets MII auto-clean the TMP entry.
 */
export async function runAdHocQuery(
    system: MIIServer,
    tqsqXml: string,
    testValues: Record<number, string>
): Promise<QueryTestResult> {
    const t0 = Date.now();
    try {
        const tmpName = 'TMP' + randomUUID();
        const saveResult = await miiCatalogService.saveTempQuery(system, tmpName, tqsqXml);
        if (!saveResult.ok) {
            return { columns: [], rows: [], rowCount: 0, executionTimeMs: Date.now() - t0, error: saveResult.error || 'Erro ao salvar query temporária no servidor' };
        }
        const resultXml = await illuminatorService.executeTestQuery(system, saveResult.path, testValues);
        const executionTimeMs = Date.now() - t0;
        if (!resultXml) {
            return { columns: [], rows: [], rowCount: 0, executionTimeMs, error: 'No response from server' };
        }
        const parsed = parseQueryResults(resultXml);
        return { ...parsed, executionTimeMs };
    } catch (e: any) {
        return { columns: [], rows: [], rowCount: 0, executionTimeMs: Date.now() - t0, error: e.message };
    }
}
