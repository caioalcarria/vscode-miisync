import { exec } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';

export interface GitFileStatus {
    filePath: string;
    status: 'modified' | 'added' | 'deleted';
}

/** Quote a single argument for CMD/shell: wrap in double-quotes, escape inner quotes. */
function quoteArg(arg: string): string {
    if (/[\s",;=&|<>^()]/.test(arg) || arg === '') {
        return '"' + arg.replace(/"/g, '""') + '"';
    }
    return arg;
}

/** Runs a git command via the system shell so git is found in PATH on Windows. */
function run(cwd: string, ...args: string[]): Promise<string> {
    const cmd = 'git ' + args.map(quoteArg).join(' ');
    return new Promise((resolve, reject) => {
        exec(cmd, { cwd, windowsHide: true }, (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout);
        });
    });
}

/** Returns a timestamp string safe for use in git commit messages (no commas or slashes). */
function gitTs(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Prefix used for sync temp folders — git init should never run inside them
const SYNC_TEMP_PREFIX = '.__miisync_sync_temp_';

export class GitManager {
    private _installed: boolean | null = null;

    async isInstalled(): Promise<boolean> {
        if (this._installed !== null) return this._installed;
        try {
            await run(process.cwd(), '--version');
            this._installed = true;
        } catch {
            this._installed = false;
        }
        return this._installed;
    }

    async isGitRepo(folderPath: string): Promise<boolean> {
        try {
            await run(folderPath, 'rev-parse', '--git-dir');
            return true;
        } catch {
            return false;
        }
    }

    isSyncTempPath(folderPath: string): boolean {
        return path.basename(folderPath).startsWith(SYNC_TEMP_PREFIX);
    }

    /**
     * Initializes a git repo for a downloaded MiiSync project.
     * Shows a VS Code progress notification during the (potentially slow) initial commit.
     * No-op if: git not installed, repo already exists, or path is a sync temp folder.
     */
    async initRepo(folderPath: string): Promise<boolean> {
        if (this.isSyncTempPath(folderPath)) return false;
        if (!(await this.isInstalled())) return false;
        if (await this.isGitRepo(folderPath)) return true;

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Git: inicializando "${path.basename(folderPath)}"...`,
                cancellable: false,
            },
            async (progress) => {
                try {
                    const gitignorePath = path.join(folderPath, '.gitignore');
                    if (!(await fs.pathExists(gitignorePath))) {
                        await fs.writeFile(gitignorePath, [
                            '# MiiSync metadata',
                            '.miisync/',
                            '',
                            '# OS / editor',
                            'Thumbs.db',
                            'desktop.ini',
                            '.DS_Store',
                            '.vscode/',
                            '',
                            '# Logs & temp',
                            '*.log',
                            '*.tmp',
                            '*.bak',
                            '*_BKP_*',
                            '',
                            '# Node (se presente)',
                            'node_modules/',
                            'npm-debug.log*',
                        ].join('\n') + '\n');
                    }

                    progress.report({ message: 'git init...' });
                    await run(folderPath, 'init');
                    await run(folderPath, 'config', 'user.email', 'miisync@mii.sync');
                    await run(folderPath, 'config', 'user.name', 'MiiSync');

                    progress.report({ message: 'Adicionando arquivos ao índice...' });
                    await run(folderPath, 'add', '-A');

                    progress.report({ message: 'Criando commit baseline...' });
                    const ts = gitTs();
                    await run(folderPath, 'commit', '-m', `sync: download inicial — ${ts}`);
                    return true;
                } catch (e) {
                    console.error('[GitManager] initRepo failed:', e);
                    return false;
                }
            }
        );
    }

    async getStatus(folderPath: string): Promise<GitFileStatus[]> {
        if (!(await this.isInstalled())) return [];
        if (!(await this.isGitRepo(folderPath))) return [];
        try {
            const stdout = await run(folderPath, 'status', '--porcelain', '-uall');
            return this.parseStatus(stdout, folderPath);
        } catch {
            return [];
        }
    }

    private parseStatus(output: string, folderPath: string): GitFileStatus[] {
        const result: GitFileStatus[] = [];
        for (const line of output.split('\n')) {
            if (line.length < 3) continue;
            const x = line[0];
            const y = line[1];
            const rawFile = line.substring(3).split(' -> ').pop().trim()
                .replace(/^"(.+)"$/, '$1');
            if (rawFile.startsWith('.miisync/') || rawFile.startsWith('.miisync\\')) continue;
            const filePath = path.join(folderPath, rawFile.split('/').join(path.sep));
            let status: GitFileStatus['status'];
            if (x === '?' && y === '?') status = 'added';
            else if (x === 'D' || y === 'D') status = 'deleted';
            else if (x === 'A' || y === 'A') status = 'added';
            else status = 'modified';
            result.push({ filePath, status });
        }
        return result;
    }

    async addAndCommit(folderPath: string, message: string, files?: string[]): Promise<boolean> {
        if (!(await this.isInstalled())) return false;
        if (!(await this.isGitRepo(folderPath))) return false;
        try {
            if (files && files.length > 0) {
                await run(folderPath, 'add', '--', ...files);
            } else {
                await run(folderPath, 'add', '-A');
            }
            await run(folderPath, 'commit', '-m', message, '--allow-empty');
            return true;
        } catch (e) {
            const msg = String(e);
            if (msg.includes('nothing to commit') || msg.includes('nothing added')) return true;
            console.error('[GitManager] addAndCommit failed:', e);
            return false;
        }
    }

    async commitFile(projectPath: string, filePath: string, serverName: string): Promise<boolean> {
        const ts = gitTs();
        const rel = path.relative(projectPath, filePath);
        return vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Git: registrando upload...', cancellable: false },
            () => this.addAndCommit(projectPath, `upload: ${rel.replace(/\\/g, '/')} → ${serverName} — ${ts}`, [filePath])
        );
    }

    async commitSync(projectPath: string): Promise<boolean> {
        const ts = gitTs();
        return vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Git: criando commit de sync...', cancellable: false },
            () => this.addAndCommit(projectPath, `sync: servidor → local — ${ts}`)
        );
    }
}

export const gitManager = new GitManager();

// ─── Git preference dialogs with persistent memory ───────────────────────────
//
// The user's choice is saved via the gitCommitOnUpload/gitCommitOnSync settings.
// 'ask' means "ask every time (no remembered answer yet)".
// 'always'/'disabled' mean "user locked in a preference".
// A middle ground: we store the LAST ad-hoc answer in workspace state via
// vscode.workspace.getConfiguration so the next "ask" pre-selects it.

function cfg() {
    return vscode.workspace.getConfiguration('miisync.settings');
}

function offerOpenSettings(msg: string) {
    vscode.window.showInformationMessage(msg, 'Abrir Configurações').then(choice => {
        if (choice === 'Abrir Configurações')
            vscode.commands.executeCommand('workbench.action.openSettings', 'miisync.settings.gitCommitOnUpload');
    });
}


/**
 * Shows a "Sync with git?" dialog.
 * - Remembers the last choice (shown first next time).
 * - Clicking "Sempre" sets gitCommitOnUpload to 'always' (no more dialog).
 * - Clicking "Nunca mais" sets it to 'disabled'.
 */
export async function askGitSyncChoice(): Promise<boolean> {
    const mode = cfg().get<string>('gitCommitOnUpload', 'ask');
    if (mode === 'always') return true;
    if (mode === 'disabled') return false;

    // Read last ad-hoc answer (stored as 'lastSyncGit' in workspace config)
    const last = cfg().get<boolean | undefined>('lastSyncGitChoice', undefined);
    const yesLabel = last === true  ? '✓ Sim (lembrado)' : 'Sim';
    const noLabel  = last === false ? '✓ Não (lembrado)' : 'Não';
    const buttons = last === false
        ? [noLabel, yesLabel, 'Sempre', 'Nunca mais']
        : [yesLabel, noLabel, 'Sempre', 'Nunca mais'];

    const pick = await vscode.window.showInformationMessage(
        'Criar commit de sync no git?',
        { modal: false },
        ...buttons
    );
    if (!pick) return last ?? false;

    if (pick === 'Sempre')    { cfg().update('gitCommitOnUpload', 'always',  vscode.ConfigurationTarget.Global); offerOpenSettings('Modo: sempre commitar. Para alterar:'); return true; }
    if (pick === 'Nunca mais'){ cfg().update('gitCommitOnUpload', 'disabled', vscode.ConfigurationTarget.Global); offerOpenSettings('Modo: nunca commitar. Para alterar:'); return false; }

    const chose = pick.includes('Sim') || pick.includes('lembrado') && last === true;
    cfg().update('lastSyncGitChoice', chose, vscode.ConfigurationTarget.Global);
    return chose;
}

/**
 * Shows an "Upload: register in git?" dialog that remembers the user's last choice.
 */
export async function askGitUploadChoice(fileName: string): Promise<boolean> {
    const mode = cfg().get<string>('gitCommitOnUpload', 'ask');
    if (mode === 'always') return true;
    if (mode === 'disabled') return false;

    const last = cfg().get<boolean | undefined>('lastUploadGitChoice', undefined);
    const yesLabel = last === true  ? '✓ Registrar (lembrado)' : 'Registrar no git';
    const noLabel  = last === false ? '✓ Não (lembrado)'       : 'Não';
    const buttons = last === false
        ? [noLabel, yesLabel, 'Sempre', 'Nunca mais']
        : [yesLabel, noLabel, 'Sempre', 'Nunca mais'];

    const pick = await vscode.window.showInformationMessage(
        `Upload concluído: ${fileName}`,
        { modal: false },
        ...buttons
    );
    if (!pick) return last ?? false;

    if (pick === 'Sempre')    { cfg().update('gitCommitOnUpload', 'always',  vscode.ConfigurationTarget.Global); offerOpenSettings('Modo: sempre commitar. Para alterar:'); return true; }
    if (pick === 'Nunca mais'){ cfg().update('gitCommitOnUpload', 'disabled', vscode.ConfigurationTarget.Global); offerOpenSettings('Modo: nunca commitar. Para alterar:'); return false; }

    const chose = pick.includes('Registrar') || (pick.includes('lembrado') && last === true);
    cfg().update('lastUploadGitChoice', chose, vscode.ConfigurationTarget.Global);
    return chose;
}
