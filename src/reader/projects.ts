import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defaultProjectStateFilePath } from './local-state';

const os = require('node:os');
const nodeFs = require('node:fs');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const MAX_RECENT_PROJECTS = 12;
const pendingUpdates = new Map<string, Promise<void>>();

export interface ReaderProjectRecord {
    rootPath: string;
    rootName: string;
    openedAt: string;
}

export interface ReaderProjectRegistryOptions {
    stateFilePath?: string;
    chooseDirectory?: () => Promise<string | undefined>;
}

function chooseWith(command: string, args: string[]): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: unknown) => { stdout += String(chunk); });
        child.stderr.on('data', (chunk: unknown) => { stderr += String(chunk); });
        child.once('error', reject);
        child.once('close', (code: number) => {
            const selected = stdout.trim();
            if (selected) {
                resolve(selected);
                return;
            }
            if (code === 0 || code === 1 || code === 130) {
                resolve(undefined);
                return;
            }
            reject(new Error(stderr.trim() || `Project chooser exited with status ${code}.`));
        });
    });
}

async function chooseProjectDirectory(): Promise<string | undefined> {
    if (process.platform === 'darwin') {
        return chooseWith('osascript', ['-e', [
            'try',
            'POSIX path of (choose folder with prompt "Choose a Math Workspace project")',
            'on error number -128',
            'return ""',
            'end try'
        ].join('\n')]);
    }
    if (process.platform === 'win32') {
        return chooseWith('powershell', ['-NoProfile', '-Command', [
            'Add-Type -AssemblyName System.Windows.Forms;',
            '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
            '$dialog.Description = "Choose a Math Workspace project";',
            'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }'
        ].join(' ')]);
    }
    return chooseWith('zenity', ['--file-selection', '--directory', '--title=Choose a Math Workspace project']);
}

export class ReaderProjectRegistry {
    private readonly stateFilePath: string;
    private readonly chooseDirectory: () => Promise<string | undefined>;

    constructor(options: ReaderProjectRegistryOptions = {}) {
        this.stateFilePath = path.resolve(options.stateFilePath || process.env.MATH_WORKSPACE_STATE || defaultProjectStateFilePath());
        this.chooseDirectory = options.chooseDirectory || chooseProjectDirectory;
    }

    async list(): Promise<ReaderProjectRecord[]> {
        const stored = await this.readStored();
        const projects = await Promise.all(stored.map(async project => ({
            project,
            valid: await this.isFormalProject(project.rootPath)
        })));
        return projects
            .filter(({ valid }) => valid)
            .map(({ project }) => ({
                ...project,
                rootName: path.basename(project.rootPath)
            }));
    }

    async choose(): Promise<string | undefined> {
        return this.chooseDirectory();
    }

    async remember(rootPath: string): Promise<ReaderProjectRecord> {
        const resolvedPath = path.resolve(rootPath);
        if (!(await this.isFormalProject(resolvedPath))) {
            throw new Error('Selected directory needs .math-workspace/config.json. Run `math-workspace init` in the project first.');
        }
        const canonicalPath = await nodeFs.promises.realpath(resolvedPath);
        const record: ReaderProjectRecord = {
            rootPath: canonicalPath,
            rootName: path.basename(canonicalPath),
            openedAt: new Date().toISOString()
        };
        try {
            await this.updateStored(previous => [record, ...previous.filter(item => item.rootPath !== canonicalPath)].slice(0, MAX_RECENT_PROJECTS));
        } catch (error) {
            console.warn(`[math-workspace] Could not save Math Workspace recent projects: ${error instanceof Error ? error.message : String(error)}`);
        }
        return record;
    }

    async forget(rootPath: string): Promise<void> {
        const resolvedPath = await nodeFs.promises.realpath(path.resolve(rootPath)).catch(() => path.resolve(rootPath));
        await this.updateStored(previous => previous.filter(item => path.resolve(item.rootPath) !== resolvedPath));
    }

    private async updateStored(update: (previous: ReaderProjectRecord[]) => ReaderProjectRecord[]): Promise<void> {
        const next = (pendingUpdates.get(this.stateFilePath) || Promise.resolve()).then(async () => {
            const projects = update(await this.readStored());
            await fs.mkdir(path.dirname(this.stateFilePath), { recursive: true });
            const temporary = `${this.stateFilePath}.${randomBytes(8).toString('hex')}.tmp`;
            try {
                await fs.writeFile(temporary, JSON.stringify({ version: 1, projects }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
                await nodeFs.promises.rename(temporary, this.stateFilePath);
            } finally { await fs.rm(temporary, { force: true }); }
        });
        const settled = next.then(() => {}, () => {});
        pendingUpdates.set(this.stateFilePath, settled);
        void settled.then(() => { if (pendingUpdates.get(this.stateFilePath) === settled) pendingUpdates.delete(this.stateFilePath); });
        return next;
    }

    private async isFormalProject(rootPath: string): Promise<boolean> {
        try {
            return (await fs.stat(path.join(rootPath, '.math-workspace', 'config.json'))).isFile();
        } catch (_error) {
            return false;
        }
    }

    private async readStored(): Promise<ReaderProjectRecord[]> {
        try {
            const value = JSON.parse(await fs.readFile(this.stateFilePath, 'utf8'));
            if (!Array.isArray(value?.projects)) return [];
            return value.projects.filter((item: any) => (
                typeof item?.rootPath === 'string'
                && typeof item?.openedAt === 'string'
            )).map((item: any) => ({
                rootPath: item.rootPath,
                rootName: typeof item.rootName === 'string' ? item.rootName : path.basename(item.rootPath),
                openedAt: item.openedAt
            }));
        } catch (error: any) {
            if (error?.code === 'ENOENT') return [];
            return [];
        }
    }
}
