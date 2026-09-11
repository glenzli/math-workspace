import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { findMathWorkspaceRoot } from '../project-root';
import { dispatchReaderLocation, type ReaderLocationDispatch, type ReaderSourceLocation } from '../reader/location-bridge';

const os = require('node:os');
const { spawn } = require('node:child_process');
const nodeFs = require('node:fs');

const CONFIG_BEGIN = '# >>> Math Workspace file handler >>>';
const CONFIG_END = '# <<< Math Workspace file handler <<<';

interface CodexFileInput {
    path?: unknown;
    location?: {
        line?: unknown;
        column?: unknown;
    } | null;
}

function codexConfigPath(): string {
    return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
}

function integerLocation(value: unknown): number | undefined {
    return Number.isInteger(value) && Number(value) >= 1 ? Number(value) : undefined;
}

function tomlString(value: string): string {
    return JSON.stringify(value);
}

async function handlerIconValue(packageRoot: string): Promise<string> {
    const candidates = [
        path.join(packageRoot, 'assets', 'file-handler-icon.png'),
        path.join(packageRoot, 'media', 'plugin', 'math-workspace-file-handler-icon.png'),
        path.join(packageRoot, 'assets', 'icon.png'),
        path.join(packageRoot, 'media', 'plugin', 'math-workspace-plugin-icon-source.png')
    ];
    for (const candidate of candidates) {
        try {
            const content = await fs.readFile(candidate);
            return `data:image/png;base64,${content.toString('base64')}`;
        } catch (_error) {
            // Try the next packaged layout.
        }
    }
    throw new Error('Math Workspace icon is missing from this installation.');
}

function removeManagedBlock(content: string): string {
    const start = content.indexOf(CONFIG_BEGIN);
    if (start < 0) return content;
    const end = content.indexOf(CONFIG_END, start);
    if (end < 0) throw new Error('The Math Workspace block in config.toml is incomplete; repair it before reinstalling.');
    const after = end + CONFIG_END.length;
    const before = content.slice(0, start).trimEnd();
    const remainder = content.slice(after).trimStart();
    return [before, remainder].filter(Boolean).join('\n\n');
}

async function writeCodexConfig(configPath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const temporaryPath = `${configPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    await nodeFs.promises.rename(temporaryPath, configPath);
}

async function installHandler(packageRoot: string, cliPath: string): Promise<void> {
    const configPath = codexConfigPath();
    let content = '';
    try {
        content = await fs.readFile(configPath, 'utf8');
    } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
    }

    const unmanagedTable = /^\s*\[desktop\.custom_file_handlers\.(?:math_workspace|"math_workspace")\]\s*$/m;
    if (!content.includes(CONFIG_BEGIN) && unmanagedTable.test(content)) {
        throw new Error('config.toml already defines desktop.custom_file_handlers.math_workspace outside the managed Math Workspace block.');
    }

    const icon = await handlerIconValue(packageRoot);
    const block = [
        CONFIG_BEGIN,
        '[desktop.custom_file_handlers.math_workspace]',
        'label = "Math Workspace"',
        `icon = ${tomlString(icon)}`,
        `command = ${tomlString(process.execPath)}`,
        `args = [${tomlString(cliPath)}, "codex-handler", "open"]`,
        'input = "json_argument"',
        CONFIG_END
    ].join('\n');
    const base = removeManagedBlock(content);
    const next = `${base}${base ? '\n\n' : ''}${block}\n`;
    await writeCodexConfig(configPath, next);
    console.log(`Installed Math Workspace file handler: ${configPath}`);
    console.log('Restart Codex Desktop, then choose Math Workspace from a file link\'s Open in menu.');
}

async function removeHandler(): Promise<void> {
    const configPath = codexConfigPath();
    let content: string;
    try {
        content = await fs.readFile(configPath, 'utf8');
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            console.log('Math Workspace file handler is not installed.');
            return;
        }
        throw error;
    }
    if (!content.includes(CONFIG_BEGIN)) {
        console.log('Math Workspace file handler is not installed.');
        return;
    }
    const next = removeManagedBlock(content);
    await writeCodexConfig(configPath, next ? `${next}\n` : '');
    console.log(`Removed Math Workspace file handler: ${configPath}`);
    console.log('Restart Codex Desktop to refresh the Open in menu.');
}

async function handlerStatus(): Promise<void> {
    const configPath = codexConfigPath();
    try {
        const content = await fs.readFile(configPath, 'utf8');
        console.log(content.includes(CONFIG_BEGIN)
            ? `Math Workspace file handler is installed: ${configPath}`
            : `Math Workspace file handler is not installed: ${configPath}`);
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            console.log(`Math Workspace file handler is not installed: ${configPath}`);
            return;
        }
        throw error;
    }
}

function openExternal(url: string): void {
    if (process.env.MATH_WORKSPACE_NO_OPEN === '1') return;
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function startReaderAndLocate(
    cliPath: string,
    rootPath: string,
    location: ReaderSourceLocation
): Promise<ReaderLocationDispatch> {
    const child = spawn(process.execPath, [cliPath, 'serve', rootPath, '--port', '0'], {
        cwd: rootPath,
        detached: true,
        stdio: 'ignore'
    });
    let startupError: Error | undefined;
    let exitCode: number | null | undefined;
    child.once('error', (error: Error) => { startupError = error; });
    child.once('exit', (code: number | null) => { exitCode = code; });
    child.unref();

    const deadline = Date.now() + 6000;
    try {
        while (Date.now() < deadline) {
            if (startupError) throw startupError;
            if (exitCode !== undefined) {
                throw new Error(`Math Workspace exited before startup with status ${exitCode ?? 'signal'}.`);
            }
            const dispatch = await dispatchReaderLocation(rootPath, location);
            if (dispatch) return dispatch;
            await delay(80);
        }
        throw new Error('Math Workspace did not start in time.');
    } catch (error) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        throw error;
    }
}

async function openInput(rawInput: string, cliPath: string): Promise<void> {
    let input: CodexFileInput;
    try {
        input = JSON.parse(rawInput);
    } catch (_error) {
        throw new Error('Codex file input must be one JSON argument.');
    }
    if (typeof input.path !== 'string' || !path.isAbsolute(input.path)) {
        throw new Error('Codex file input must contain an absolute path.');
    }
    if (path.extname(input.path).toLowerCase() !== '.md') {
        throw new Error('Math Workspace opens Markdown source locations only.');
    }
    let canonicalPath: string;
    try {
        canonicalPath = await nodeFs.promises.realpath(input.path);
    } catch (_error) {
        throw new Error('The selected Markdown file does not exist.');
    }
    const rootPath = await findMathWorkspaceRoot(canonicalPath);
    if (!rootPath) throw new Error('The selected file is not inside a prepared Math Workspace project.');
    const filePath = path.relative(rootPath, canonicalPath).replaceAll(path.sep, '/');
    if (!filePath || filePath.startsWith('../') || path.isAbsolute(filePath)) {
        throw new Error('The selected file is outside its Math Workspace project.');
    }
    const location: ReaderSourceLocation = {
        filePath,
        line: integerLocation(input.location?.line),
        column: integerLocation(input.location?.column)
    };
    const existing = await dispatchReaderLocation(rootPath, location);
    if (existing) {
        if (existing.delivered === 0) openExternal(existing.url);
        console.log(`${existing.delivered > 0 ? 'Located in' : 'Opened'} Math Workspace: ${existing.url}`);
        return;
    }
    const started = await startReaderAndLocate(cliPath, rootPath, location);
    if (started.delivered === 0) openExternal(started.url);
    console.log(`${started.delivered > 0 ? 'Located in' : 'Opened'} Math Workspace: ${started.url}`);
}

export async function runCodexFileHandler(args: string[], packageRoot: string, cliPath: string): Promise<void> {
    const [action, ...rest] = args;
    if (!action || action === 'help' || action === '--help') {
        console.log('Usage: math-workspace codex-handler install|remove|status|open <json-argument>');
        return;
    }
    if (action === 'install') return installHandler(packageRoot, cliPath);
    if (action === 'remove') return removeHandler();
    if (action === 'status') return handlerStatus();
    if (action === 'open') {
        if (rest.length !== 1) throw new Error('Usage: math-workspace codex-handler open <json-argument>');
        return openInput(rest[0], cliPath);
    }
    throw new Error(`Unknown Codex handler action: ${action}`);
}
