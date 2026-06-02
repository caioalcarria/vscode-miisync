import * as http from 'http';
import * as https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { RawSystemConfig } from './configReader';

export interface MiiSession {
    auth: string;       // 'Basic base64(user:pass)'
    cookies: string;
    system: RawSystemConfig;
}

export interface RemoteEntry {
    name: string;
    path: string;
    type: string;
    modified: string;
    isFolder: boolean;
}

export interface SaveResult {
    ok: boolean;
    error?: string;
}

export interface QueryResult {
    columns: string[];
    rows: Record<string, string>[];
    rowCount: number;
    executionTimeMs: number;
    error?: string;
}

export interface TrxRunResult {
    success: boolean;
    outputs: Record<string, string>;
    error?: string;
    rawXml?: string;
}

interface HttpResponse {
    status: number;
    headers: Record<string, string | string[]>;
    body: string;
}

// ─── HTTP base ───────────────────────────────────────────────────────────────

function httpRequest(
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const mod = parsedUrl.protocol === 'https:' ? https : http;
        const headers = { ...(options.headers || {}) };
        // Content-Length explícito: o servlet do MII não lê body com chunked transfer-encoding
        if (options.body != null) {
            headers['Content-Length'] = String(Buffer.byteLength(options.body));
        }
        const req = mod.request(
            url,
            { method: options.method || 'GET', headers },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers as Record<string, string | string[]>,
                        body: data,
                    })
                );
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function extractCookies(setCookie: string | string[] | undefined): string[] {
    if (!setCookie) return [];
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    return arr.map((c) => c.split(';')[0]).filter(Boolean);
}

function isXmlResponse(body: string): boolean {
    return body.trimStart().startsWith('<?xml') || body.includes('<Rowsets');
}

// ─── Helpers de sessão / requisição ──────────────────────────────────────────

function baseUrl(s: MiiSession): string {
    const sys = s.system;
    return `${sys.protocol || 'http'}://${sys.host}:${sys.port}`;
}

/** GET no catálogo (Basic Auth + cookies). Mantém barras no path, escapa espaços. */
async function catGet(session: MiiSession, querySuffix: string): Promise<string> {
    const url = `${baseUrl(session)}/XMII/${querySuffix}`.replace(/ /g, '%20');
    const res = await httpRequest(url, { headers: { Authorization: session.auth, Cookie: session.cookies } });
    return res.body;
}

/** POST form-urlencoded (Basic Auth + cookies). */
async function post(session: MiiSession, pathSuffix: string, body: string): Promise<string> {
    const url = `${baseUrl(session)}/XMII/${pathSuffix}`;
    const res = await httpRequest(url, {
        method: 'POST',
        headers: {
            Authorization: session.auth,
            Cookie: session.cookies,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    return res.body;
}

function parse(xml: string, columnArray = false) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        isArray: (n) => n === 'Row' || (columnArray && n === 'Column'),
        processEntities: { maxTotalExpansions: 10000 },
    });
    return parser.parse(xml);
}

function fatalOf(parsed: any): string | null {
    const f = parsed?.Rowsets?.FatalError;
    return f ? String(f) : null;
}

export function isWebPath(p: string): boolean {
    return /\/WEB\//i.test(p) || /^WEB\//i.test(p);
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function login(system: RawSystemConfig): Promise<MiiSession | null> {
    const base = `${system.protocol || 'http'}://${system.host}:${system.port}`;
    const auth = 'Basic ' + Buffer.from(`${system.username}:${system.password || ''}`).toString('base64');
    const personalization = `${base}/XMII/Illuminator?service=Personalization`;
    try {
        // Passo 1: POST sem auth nem cookies → obtém o cookie bootstrap de sessão
        const s1 = await httpRequest(personalization, { method: 'POST' });
        let cookies = extractCookies(s1.headers['set-cookie'] as string | string[]);

        // Passo 2: POST com Session=true + credenciais na URL, Basic + cookie, redirect manual
        const loginUrl = `${personalization}&Session=true&IllumLoginName=${encodeURIComponent(system.username)}&IllumLoginPassword=${encodeURIComponent(system.password || '')}`;
        const s2 = await httpRequest(loginUrl, {
            method: 'POST',
            headers: { Authorization: auth, Cookie: cookies.join('; ') },
        });
        const location = (Array.isArray(s2.headers['location']) ? s2.headers['location'][0] : s2.headers['location']) || '';

        // Sessão válida = 302 → goService.jsp (igual à extensão)
        const sessionOk = s2.status === 302 && location.endsWith('goService.jsp');
        cookies = [...new Set([...cookies, ...extractCookies(s2.headers['set-cookie'] as string | string[])])];

        if (sessionOk) {
            return { auth, cookies: cookies.join('; '), system };
        }

        // Fallback: valida ao menos leitura via Basic (alguns ambientes não dão 302)
        const test = await httpRequest(`${base}/XMII/Catalog?Mode=ListFolders&Content-Type=text/xml&Folder=`, {
            headers: { Authorization: auth, Cookie: cookies.join('; ') },
        });
        if (test.status === 200 && isXmlResponse(test.body)) {
            cookies = [...new Set([...cookies, ...extractCookies(test.headers['set-cookie'] as string | string[])])];
            return { auth, cookies: cookies.join('; '), system };
        }
        return null;
    } catch {
        return null;
    }
}

// ─── Listagem ──────────────────────────────────────────────────────────────--

export async function listFolders(session: MiiSession, folderPath: string): Promise<RemoteEntry[]> {
    const body = await catGet(session, `Catalog?Mode=ListFolders&DoStateCheck=true&Content-Type=text/xml&Folder=${folderPath}&__=${Date.now()}`);
    const rows: any[] = parse(body)?.Rowsets?.Rowset?.Row || [];
    return rows.map((r) => ({
        name: String(r.FolderName ?? ''),
        path: String(r.Path ?? ''),
        type: 'folder',
        modified: String(r.Modified ?? ''),
        isFolder: true,
    }));
}

export async function listFiles(session: MiiSession, folderPath: string): Promise<RemoteEntry[]> {
    const body = await catGet(session, `Catalog?Mode=List&DoStateCheck=true&Content-Type=text/xml&Folder=${folderPath}&__=${Date.now()}`);
    const rows: any[] = parse(body)?.Rowsets?.Rowset?.Row || [];
    return rows.map((r) => ({
        name: String(r.ObjectName ?? ''),
        path: String(r.FilePath ?? ''),
        type: String(r.Type ?? 'file'),
        modified: String(r.Modified ?? ''),
        isFolder: false,
    }));
}

export async function listRemoteFolder(session: MiiSession, folderPath: string): Promise<RemoteEntry[]> {
    const [folders, files] = await Promise.all([
        listFolders(session, folderPath).catch(() => []),
        listFiles(session, folderPath).catch(() => []),
    ]);
    return [...folders, ...files];
}

function splitParent(p: string): { parent: string; name: string } {
    const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
    const i = norm.lastIndexOf('/');
    return i >= 0 ? { parent: norm.slice(0, i), name: norm.slice(i + 1) } : { parent: '', name: norm };
}

export async function fileExists(session: MiiSession, path: string): Promise<boolean> {
    const { parent, name } = splitParent(path);
    const files = await listFiles(session, parent).catch(() => []);
    return files.some((f) => f.name === name || f.path.replace(/\\/g, '/').endsWith('/' + name));
}

export async function folderExists(session: MiiSession, path: string): Promise<boolean> {
    const { parent, name } = splitParent(path);
    const folders = await listFolders(session, parent).catch(() => []);
    return folders.some((f) => f.name === name);
}

/** Propriedades de um arquivo (a partir da listagem do pai). null se não existe. */
export async function fileProperties(session: MiiSession, path: string): Promise<RemoteEntry | null> {
    const { parent, name } = splitParent(path);
    const files = await listFiles(session, parent).catch(() => []);
    return files.find((f) => f.name === name || f.path.replace(/\\/g, '/').endsWith('/' + name)) || null;
}

// ─── Leitura de conteúdo ─────────────────────────────────────────────────────

/** Lê arquivo WEB (base64 → utf8). */
export async function readWebFile(session: MiiSession, path: string): Promise<string | null> {
    const body = await catGet(session, `Catalog?Mode=LoadBinary&Class=Content&TemporaryFile=false&Content-Type=text/xml&ObjectName=${path}&__=${Date.now()}`);
    if (!isXmlResponse(body)) return null;
    const parsed = parse(body.replaceAll('&#13;', ''));
    const rows: any[] = parsed?.Rowsets?.Rowset?.Row || [];
    const payload = rows.find((r) => String(r.Name) === 'Payload') || rows[0];
    if (!payload?.Value) return null;
    try {
        return Buffer.from(String(payload.Value), 'base64').toString('utf8');
    } catch {
        return String(payload.Value);
    }
}

/** Lê arquivo de catálogo (texto cru). */
export async function loadMesFile(session: MiiSession, path: string): Promise<string | null> {
    const body = await catGet(session, `Catalog?Mode=Load&Content-Type=text/xml&ObjectName=${path}&__=${Date.now()}`);
    return body || null;
}

/** Lê qualquer arquivo: WEB (base64) ou catálogo (texto). */
export async function readFile(session: MiiSession, path: string): Promise<string | null> {
    return isWebPath(path) ? readWebFile(session, path) : loadMesFile(session, path);
}

// ─── Escrita de conteúdo ─────────────────────────────────────────────────────

/** Salva arquivo WEB (conteúdo → base64 no body). */
export async function saveWebFile(session: MiiSession, path: string, content: string): Promise<SaveResult> {
    const b64 = Buffer.from(content, 'utf8').toString('base64');
    const url = `Catalog?Mode=SaveBinary&Class=Content&ObjectName=${path}&__=${Date.now()}`.replace(/ /g, '%20');
    const body = `Content=${encodeURIComponent(b64)}`;
    const res = await post(session, url, body);
    const fatal = isXmlResponse(res) ? fatalOf(parse(res)) : null;
    return fatal ? { ok: false, error: fatal } : { ok: true };
}

/** Salva arquivo de catálogo (texto). */
export async function saveMesFile(session: MiiSession, path: string, content: string): Promise<SaveResult> {
    const body = [
        'Mode=Save',
        `ObjectName=${encodeURIComponent(path)}`,
        `Content=${encodeURIComponent(content)}`,
        'Content-Type=text/xml',
        'TemporaryFile=false',
    ].join('&');
    const res = await post(session, 'Catalog', body);
    if (!res) return { ok: false, error: 'Resposta vazia' };
    const fatal = fatalOf(parse(res));
    return fatal ? { ok: false, error: fatal } : { ok: true };
}

/** Salva qualquer arquivo: WEB (base64) ou catálogo (texto). */
export async function saveFile(session: MiiSession, path: string, content: string): Promise<SaveResult> {
    return isWebPath(path) ? saveWebFile(session, path, content) : saveMesFile(session, path, content);
}

// ─── Delete / pasta ──────────────────────────────────────────────────────────

export async function deleteFile(session: MiiSession, path: string): Promise<SaveResult> {
    const res = await catGet(session, `Catalog?Mode=BatchDelete&Class=Content&Content-Type=text/xml&TemporaryFile=false&Notify=true&ObjectName=${path}&__=${Date.now()}`);
    const fatal = isXmlResponse(res) ? fatalOf(parse(res)) : null;
    return fatal ? { ok: false, error: fatal } : { ok: true };
}

export async function createFolder(session: MiiSession, path: string): Promise<SaveResult> {
    const res = await catGet(session, `Catalog?Mode=CreateFolder&Notify=true&Folder=${path}&__=${Date.now()}`);
    const fatal = isXmlResponse(res) ? fatalOf(parse(res)) : null;
    return fatal ? { ok: false, error: fatal } : { ok: true };
}

// ─── Catálogo: transactions & queries ────────────────────────────────────────

export async function loadTransaction(session: MiiSession, objectName: string): Promise<string | null> {
    // Tenta Class=Transaction (funciona em versões mais novas do MII)
    const body = `Mode=Load&Class=Transaction&ObjectName=${encodeURIComponent(objectName)}&TemporaryFile=false&Content-Type=text%2Fxml`;
    const res = await post(session, 'Catalog', body);
    if (res && res.includes('<Transaction') && !fatalOf(parse(res))) return res;

    // Fallback: Mode=Load simples com extensão .trx (MII 15.0 SP3)
    const withExt = objectName.endsWith('.trx') ? objectName : objectName + '.trx';
    const alt = await loadMesFile(session, withExt);
    if (alt && alt.includes('<Transaction')) return alt;

    return res && res.includes('<Transaction') ? res : null;
}

export async function saveTransaction(session: MiiSession, objectName: string, content: string): Promise<SaveResult> {
    // Tenta Class=Transaction (versões mais novas)
    const body = `Mode=Save&Class=Transaction&ObjectName=${encodeURIComponent(objectName)}&Content=${encodeURIComponent(content)}`;
    const res = await post(session, 'Catalog', body);
    if (res) {
        const fatal = fatalOf(parse(res));
        if (!fatal) return { ok: true };
    }
    // Fallback: Mode=Save simples com extensão .trx (MII 15.0 SP3)
    const withExt = objectName.endsWith('.trx') ? objectName : objectName + '.trx';
    return saveMesFile(session, withExt, content);
}

export async function loadComponentCatalog(session: MiiSession): Promise<string | null> {
    const body = 'Mode=Load&Class=ComponentCatalog&ObjectName=Main.CAT&TemporaryFile=false&Content-Type=text%2Fxml';
    const res = await post(session, 'Catalog', body);
    return res || null;
}

export async function loadQueryTemplate(session: MiiSession, objectName: string): Promise<string | null> {
    // Tenta Class=Template (versões mais novas)
    const body = `Mode=Load&Class=Template&Content-Type=text%2Fxml&TemporaryFile=false&ObjectName=${encodeURIComponent(objectName)}`;
    const res = await post(session, 'Catalog', body);
    if (res && res.includes('<SQLQuery') && !fatalOf(parse(res))) return res;

    // Fallback: Mode=Load simples com extensão .tqsq (MII 15.0 SP3)
    const withExt = objectName.endsWith('.tqsq') ? objectName : objectName + '.tqsq';
    const alt = await loadMesFile(session, withExt);
    if (alt && alt.includes('<SQLQuery')) return alt;

    return res && res.includes('<SQLQuery') ? res : null;
}

export async function saveQuery(session: MiiSession, objectName: string, content: string): Promise<SaveResult> {
    const body = `Mode=Save&Class=SQLQuery&ObjectName=${encodeURIComponent(objectName)}&Content=${encodeURIComponent(content)}`;
    const res = await post(session, 'Catalog', body);
    if (!res) return { ok: false, error: 'Resposta vazia' };
    const fatal = fatalOf(parse(res));
    return fatal ? { ok: false, error: fatal } : { ok: true };
}

export async function saveTempQuery(session: MiiSession, tmpName: string, content: string): Promise<{ ok: boolean; path: string; error?: string }> {
    const body = [
        'Mode=Save',
        'Class=SQLQuery',
        `ObjectName=${encodeURIComponent(tmpName)}`,
        'TemporaryFile=true',
        `TempFileName=${encodeURIComponent(tmpName)}`,
        `Content=${encodeURIComponent(content)}`,
    ].join('&');
    const res = await post(session, 'Catalog', body);
    if (!res) return { ok: false, path: tmpName, error: 'Resposta vazia' };
    const parsed = parse(res);
    const fatal = fatalOf(parsed);
    if (fatal) return { ok: false, path: tmpName, error: fatal };
    const rows = parsed?.Rowsets?.Rowset?.Row;
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { ok: true, path: String(row?.TempFileName ?? row?.ObjectName ?? row?.Path ?? tmpName) };
}

// ─── Illuminator (schema / metadados) ────────────────────────────────────────

function illumRows(xml: string): any[] {
    const rows = parse(xml)?.Rowsets?.Rowset?.Row;
    return Array.isArray(rows) ? rows : rows ? [rows] : [];
}

export async function getSQLServerList(session: MiiSession): Promise<{ name: string; description: string }[]> {
    const res = await post(session, 'Illuminator', 'Content-Type=text%2Fxml&Service=SystemInfo&Method=SQL&RowCount=250&Mode=ServerList');
    return illumRows(res)
        .map((r) => ({ name: String(r.Name ?? r.ServerName ?? ''), description: String(r.Description ?? r.ServerDescription ?? r.Name ?? '') }))
        .filter((s) => s.name);
}

export async function getServerModes(session: MiiSession, serverName: string): Promise<string[]> {
    const res = await post(session, 'Illuminator', `Content-Type=text%2Fxml&Server=${encodeURIComponent(serverName)}&Mode=ModeList`);
    const modes = illumRows(res).map((r) => String(r.Mode ?? r.Name ?? '')).filter(Boolean);
    return modes.length ? modes : ['FixedQuery', 'FixedQueryWithOutput', 'Query', 'Command'];
}

export async function getTableList(session: MiiSession, serverName: string): Promise<string[]> {
    const res = await post(session, 'Illuminator', `Content-Type=text%2Fxml&Server=${encodeURIComponent(serverName)}&Mode=TableList`);
    return illumRows(res).map((r) => String(r.TableName ?? '')).filter(Boolean);
}

export async function getColumnList(session: MiiSession, serverName: string, tableName: string): Promise<string[]> {
    const res = await post(session, 'Illuminator', `Content-Type=text%2Fxml&Mode=ColumnList&Server=${encodeURIComponent(serverName)}&Group=${encodeURIComponent(tableName)}`);
    return illumRows(res).map((r) => String(r.ColumnName ?? '')).filter(Boolean);
}

export async function getJCOConnections(session: MiiSession): Promise<string[]> {
    const res = await post(session, 'Illuminator', 'Type=JCO&Mode=ConnectionList&Service=SystemInfo&Content-Type=raw%2Fxmii');
    return illumRows(res).map((r) => String(r.Name ?? r.ConnectionName ?? '')).filter(Boolean);
}

export async function getBLSCredentials(session: MiiSession): Promise<string[]> {
    const res = await post(session, 'Illuminator', 'Type=BLS&Mode=CredentialList&Service=SystemInfo&Content-Type=raw%2Fxmii');
    return illumRows(res).map((r) => String(r.Name ?? '')).filter(Boolean);
}

export async function getJCOConnectionInfo(session: MiiSession, connectionName: string): Promise<Record<string, string> | null> {
    const res = await post(session, 'Illuminator', `Type=JCO&Mode=ConnectionInfo&Service=SystemInfo&Name=${encodeURIComponent(connectionName)}&Content-Type=raw%2Fxmii`);
    const rows = illumRows(res);
    const row = rows[0];
    if (!row) return null;
    return {
        name: connectionName,
        r3name: String(row.R3NAME ?? row.SystemID ?? ''),
        client: String(row.CLIENT ?? ''),
        server: String(row.SERVER ?? row.AppServerHost ?? ''),
        language: String(row.LANGUAGE ?? row.Language ?? ''),
    };
}

export async function executeTestQuery(session: MiiSession, queryTemplatePath: string, testValues?: Record<number, string>): Promise<string | null> {
    const qt = encodeURIComponent(queryTemplatePath);
    let body = `IsTesting=T&QueryTemplate=${qt}&Content-Type=text%2Fxml`;
    if (testValues) {
        for (const [idx, val] of Object.entries(testValues)) {
            body += `&Param.${idx}=${encodeURIComponent(String(val ?? ''))}`;
        }
    }
    const res = await post(session, 'Illuminator', body);
    return res || null;
}

// ─── Runner (executar transação) ─────────────────────────────────────────────

export async function runTransaction(session: MiiSession, transactionPath: string, params: Record<string, string> = {}): Promise<TrxRunResult> {
    const parts = [`Transaction=${encodeURIComponent(transactionPath)}`, 'OutputParameter=XML'];
    for (const [k, v] of Object.entries(params)) {
        parts.push(`Context.${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    const rawXml = await post(session, 'Runner', parts.join('&'));
    if (!rawXml) return { success: false, outputs: {}, error: 'Resposta vazia' };
    try {
        const parsed = new XMLParser({ ignoreAttributes: false, isArray: () => false }).parse(rawXml);
        const fatal = parsed?.Rowsets?.FatalError;
        if (fatal) return { success: false, outputs: {}, error: String(fatal), rawXml };
        const rowset = parsed?.Rowsets?.Rowset;
        const row = Array.isArray(rowset) ? rowset[0]?.Row : rowset?.Row;
        const outputs: Record<string, string> = {};
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

// ─── Resultado de query (parse de SELECT) ────────────────────────────────────

export function parseQueryResults(xml: string): Omit<QueryResult, 'executionTimeMs'> {
    if (!xml) return { columns: [], rows: [], rowCount: 0, error: 'Resposta vazia' };
    try {
        const doc = parse(xml, true);
        const fatal = fatalOf(doc);
        if (fatal) return { columns: [], rows: [], rowCount: 0, error: fatal };
        const rowset = doc?.Rowsets?.Rowset;
        const rs = Array.isArray(rowset) ? rowset[0] : rowset;
        const colDefs: any[] = rs?.Columns?.Column ?? [];
        const columns = colDefs.map((c: any) => String(c?.['@_Name'] ?? c?.Name ?? '')).filter(Boolean);
        const rawRows: any[] = rs?.Row ?? [];
        const rows = rawRows.map((r: any) => {
            const obj: Record<string, string> = {};
            for (const col of columns) obj[col] = r[col] != null ? String(r[col]) : '';
            return obj;
        });
        const effectiveCols = columns.length ? columns : rows.length ? Object.keys(rows[0]) : [];
        return { columns: effectiveCols, rows, rowCount: rows.length };
    } catch (e: any) {
        return { columns: [], rows: [], rowCount: 0, error: e.message };
    }
}
