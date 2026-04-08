import * as os from 'os';
import * as path from 'path';
import { outputFile } from 'fs-extra';

interface TrxTempEntry {
    /** Full remote path, e.g. MES/Transactions/Folder/File.trx */
    remotePath: string;
}

class TrxTempFilesManager {
    private readonly tempDir: string;
    private readonly entries = new Map<string, TrxTempEntry>();

    constructor() {
        this.tempDir = path.join(os.tmpdir(), 'miisync-trx');
    }

    /**
     * Builds the local temp path that mirrors the remote path structure.
     * e.g. MES/Transactions/Folder/File.trx
     *   → <tmpdir>/miisync-trx/MES/Transactions/Folder/File.trx
     */
    private buildTempPath(remotePath: string): string {
        const parts = remotePath.split('/');
        return path.join(this.tempDir, ...parts);
    }

    /**
     * Writes content to a temp file and registers the mapping.
     * Returns the local temp file path.
     */
    async write(remotePath: string, content: string): Promise<string> {
        const tempPath = this.buildTempPath(remotePath);
        await outputFile(tempPath, content, 'utf8');
        this.entries.set(tempPath, { remotePath });
        return tempPath;
    }

    getEntry(localPath: string): TrxTempEntry | undefined {
        return this.entries.get(localPath);
    }

    isTrxTempFile(localPath: string): boolean {
        return this.entries.has(localPath);
    }
}

export const trxTempFiles = new TrxTempFilesManager();
