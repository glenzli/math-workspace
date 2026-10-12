import { LeanReviewError } from './lean-evidence';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const MESSAGE_LIMIT = 8 * 1024 * 1024;
const SESSION_OUTPUT_LIMIT = 96 * 1024 * 1024;
// Both Lake and elaborated project code inherit this native read-only/offline boundary. In
// particular, --no-build alone does not stop Lake recompiling a stale lakefile.lean cache.
// Git's read-only queries open /dev/null with O_RDWR. Permit this non-persistent sink;
// refusing it makes Lake misread an unavailable Git query as a changed dependency URL.
const READONLY_PROFILE = '(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write-data (literal "/dev/null"))';
function readonlySpawn(command: string, args: string[], options: any): any {
    if (process.platform !== 'darwin') throw new Error('A native read-only/offline Lean process boundary is unavailable on this platform.');
    return spawn('/usr/bin/sandbox-exec', ['-p', READONLY_PROFILE, command, ...args], options);
}

export class LeanLanguageOperation {
    private listeners = new Set<() => void>();
    cancelled = false;
    onCancel(listener: () => void): () => void {
        if (this.cancelled) listener(); else this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    cancel(): void {
        if (this.cancelled) return;
        this.cancelled = true;
        for (const listener of [...this.listeners]) listener();
        this.listeners.clear();
    }
    check(): void { if (this.cancelled) throw new LeanReviewError(499, 'Lean language request cancelled.'); }
}

/** Pinned environment; never call elan or accept ambient compiler/search-path overrides. */
function leanEnvironment(toolchainRoot: string): Record<string, string | undefined> {
    const bin = path.join(toolchainRoot, 'bin');
    return { ...process.env, ELAN_TOOLCHAIN: undefined, LEAN: path.join(bin, 'lean'), LAKE: path.join(bin, 'lake'),
        LEAN_SYSROOT: toolchainRoot, LEAN_PATH: undefined, LEAN_SRC_PATH: undefined, LAKE_HOME: undefined,
        LEAN_GITHASH: undefined, LAKE_INVALID_CONFIG: undefined, LEAN_ABORT_ON_PANIC: undefined,
        PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH || ''}`,
        LAKE_NO_CACHE: 'true', LAKE_ARTIFACT_CACHE: 'false', LAKE_RESTORE_ARTIFACTS: 'false' };
}

interface OwnedProcess { parent: number; identity: string }
async function processSnapshot(): Promise<Map<number, OwnedProcess>> {
    const snapshot = await new Promise<string>(resolve => {
            const ps = spawn('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], { stdio: ['ignore', 'pipe', 'ignore'] });
            let output = '';
            const timer = setTimeout(() => { ps.kill('SIGKILL'); resolve(output); }, 1000);
            ps.stdout.on('data', (chunk: any) => { if (output.length < 1024 * 1024) output += String(chunk); });
            ps.once('error', () => { clearTimeout(timer); resolve(''); });
            ps.once('close', () => { clearTimeout(timer); resolve(output); });
    });
    const result = new Map<number, OwnedProcess>();
    for (const line of snapshot.split('\n')) {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
        if (match) result.set(Number(match[1]), { parent: Number(match[2]), identity: match[3].trim() });
    }
    return result;
}
function rememberDescendants(snapshot: Map<number, OwnedProcess>, roots: Set<number>, remembered: Map<number, string>): Set<number> {
    const owned = new Set<number>(roots);
        for (let depth = 0; depth < 16; depth++) {
            const before = owned.size;
            for (const [pid, info] of snapshot) if (owned.has(info.parent) && pid !== process.pid) owned.add(pid);
            if (owned.size === before) break;
        }
    for (const pid of owned) if (snapshot.has(pid)) remembered.set(pid, snapshot.get(pid)!.identity);
    return owned;
}
async function killProcessTree(child: any, remembered = new Map<number, string>()): Promise<void> {
    if (!child?.pid) return;
    // Workers create separate process groups and may survive an unexpected watchdog exit.
    // Retained PID+start-time identities let us kill those owned workers after reparenting,
    // while excluding any unrelated process that subsequently reused a PID.
    if (process.platform !== 'win32') {
        const snapshot = await processSnapshot();
        const roots = new Set<number>();
        for (const [pid, identity] of remembered) if (snapshot.get(pid)?.identity === identity) roots.add(pid);
        if (child.exitCode === null && snapshot.has(child.pid)) {
            if (!remembered.has(child.pid) || remembered.get(child.pid) === snapshot.get(child.pid)!.identity) roots.add(child.pid);
        }
        const owned = rememberDescendants(snapshot, roots, remembered);
        for (const pid of [...owned].reverse()) {
            try { process.kill(-pid, 'SIGKILL'); } catch (_error) { try { process.kill(pid, 'SIGKILL'); } catch (_error2) { /* already gone */ } }
        }
    } else { try { child.kill('SIGKILL'); } catch (_error) { /* already gone */ } }
}

async function lakeEnvironment(cwd: string, toolchainRoot: string, boundaries: string[], operation: LeanLanguageOperation): Promise<Record<string, string | undefined>> {
    operation.check();
    const base = leanEnvironment(toolchainRoot);
    // Request only non-secret Lean search paths. Lake's stdout is never exposed as an environment dump.
    const query = 'process.stdout.write(JSON.stringify({LEAN_PATH:process.env.LEAN_PATH,LEAN_SRC_PATH:process.env.LEAN_SRC_PATH}))';
    const result = await new Promise<string>((resolve, reject) => {
        const child = readonlySpawn(path.join(toolchainRoot, 'bin', 'lake'), ['--offline', '--no-build', '--no-cache', 'env', process.execPath, '-e', query],
            { cwd, env: base, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
        let output = '', errorOutput = '', size = 0, failure: Error | undefined;
        const stop = (reason: Error) => { failure = reason; void killProcessTree(child); };
        const timer = setTimeout(() => stop(new Error('Offline Lake environment setup exceeded 20 seconds.')), 20000);
        const unsubscribe = operation.onCancel(() => stop(new LeanReviewError(499, 'Lean language request cancelled.')));
        const receive = (chunk: any, stderr: boolean) => {
            size += chunk.length;
            if (size > 1024 * 1024) { stop(new Error('Offline Lake environment setup exceeded 1 MiB.')); return; }
            if (stderr) errorOutput += String(chunk); else output += String(chunk);
        };
        child.stdout.on('data', (chunk: any) => receive(chunk, false));
        child.stderr.on('data', (chunk: any) => receive(chunk, true));
        child.once('error', (error: Error) => { clearTimeout(timer); unsubscribe(); reject(error); });
        child.once('close', (code: number) => {
            clearTimeout(timer); unsubscribe();
            if (failure) reject(failure);
            else if (code !== 0) reject(new Error(`Offline Lake environment is unavailable: ${errorOutput.slice(0, 12000)}`));
            else resolve(output);
        });
    });
    const selected = JSON.parse(result);
    for (const name of ['LEAN_PATH', 'LEAN_SRC_PATH']) {
        if (selected[name] !== undefined && typeof selected[name] !== 'string') throw new Error('Lake returned an invalid search path.');
        const entries = String(selected[name] || '').split(path.delimiter).filter(Boolean);
        if (entries.length > 256) throw new Error('Lake search paths exceed their bounded package limit.');
        for (const entry of entries) {
            let candidate = path.resolve(cwd, entry), resolved: string | undefined;
            // Missing build directories are permitted, but existing ancestors must not redirect
            // an admitted lexical path to an untracked external package via a symlink.
            for (let depth = 0; depth < 128; depth++) {
                try { resolved = await fs.realpath(candidate); break; }
                catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
                const parent = path.dirname(candidate); if (parent === candidate) break; candidate = parent;
            }
            const absolute = path.resolve(cwd, entry);
            const inside = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
            if (!resolved || !boundaries.some(root => inside(root, absolute) && inside(root, resolved))) {
                throw new Error('Lake selected an untracked external source or compiled module search path.');
            }
        }
    }
    return { ...base, ...selected };
}

interface PendingRequest { resolve(value: any): void; reject(error: Error): void; timer: any; unsubscribe(): void }

/** Framed stdio transport and its complete process/temp-file lifetime. No semantic inference. */
export class LeanLanguageConnection {
    private child: any;
    private temporary?: string;
    private buffer = Buffer.alloc(0);
    private pending = new Map<number, PendingRequest>();
    private nextId = 1;
    private outputBytes = 0;
    private stderr = '';
    private closed = false;
    private closing?: Promise<void>;
    private processClosed: Promise<void> = Promise.resolve();
    private ownedProcesses = new Map<number, string>();
    private processWatch?: any;
    capabilities: any = {};
    diagnostics: any[] = [];
    complete = false;
    tokensChanged = true;
    readonly uri: string;
    readonly version = 1;
    get isClosed(): boolean { return this.closed; }

    constructor(readonly filePath: string) { this.uri = pathToFileURL(filePath).href; }

    async start(cwd: string, toolchainRoot: string, content: string, operation: LeanLanguageOperation, dependencies: string[] = []): Promise<void> {
        if (process.platform === 'win32') throw new Error('Read-only offline Lean language sessions are unavailable on this platform.');
        const environment = await lakeEnvironment(cwd, toolchainRoot, [cwd, toolchainRoot, ...dependencies], operation);
        operation.check();
        this.temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-lean-language-'));
        const launcher = path.join(this.temporary, 'lake');
        const entry = path.join(this.temporary, 'lake.cjs');
        const script = `const {spawnSync}=require('node:child_process');\nconst r=spawnSync(${JSON.stringify(path.join(toolchainRoot, 'bin', 'lake'))},['--offline','--no-build','--no-cache',...process.argv.slice(2)],{stdio:'inherit',env:process.env});\nprocess.exit(r.status ?? 1);\n`;
        await fs.writeFile(entry, script, { mode: 0o600 });
        // Literal paths are shell-quoted once; Lean-supplied arguments are forwarded with "$@".
        const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
        await fs.writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`, { mode: 0o700 });
        this.child = readonlySpawn(path.join(toolchainRoot, 'bin', 'lean'), ['--server', '-M4096'], { cwd,
            env: { ...environment, LAKE: launcher }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
        this.processClosed = new Promise(resolve => this.child.once('close', resolve));
        const remember = async () => {
            const snapshot = await processSnapshot();
            if (this.child.exitCode === null && snapshot.has(this.child.pid)) rememberDescendants(snapshot, new Set([this.child.pid]), this.ownedProcesses);
            if (!this.closed) { this.processWatch = setTimeout(() => void remember(), 500); this.processWatch.unref?.(); }
        };
        await remember();
        this.child.stdout.on('data', (chunk: any) => this.receive(chunk));
        this.child.stderr.on('data', (chunk: any) => {
            this.outputBytes += chunk.length;
            if (this.stderr.length < 16000) this.stderr += String(chunk);
            if (this.outputBytes > SESSION_OUTPUT_LIMIT) this.fail(new Error('Lean session exceeded its bounded output limit.'));
        });
        this.child.once('error', (error: Error) => this.fail(error));
        this.child.once('close', (code: number) => this.fail(new Error(`Lean language server closed (${code}). ${this.stderr.slice(0, 16000)}`)));
        const initialized = await this.request('initialize', { processId: process.pid, rootUri: pathToFileURL(cwd).href,
            capabilities: { workspace: { semanticTokens: { refreshSupport: true } }, textDocument: {
                hover: { contentFormat: ['markdown', 'plaintext'] }, definition: { linkSupport: true },
                semanticTokens: { requests: { full: true }, tokenTypes: [], tokenModifiers: [], formats: ['relative'] }
            }, lean: { incrementalDiagnosticSupport: false, silentDiagnosticSupport: false } },
            initializationOptions: { hasWidgets: false }, clientInfo: { name: 'Math Workspace read-only source', version: '1' } }, operation, 15000);
        this.capabilities = initialized?.capabilities || {};
        this.notify('initialized', {});
        this.notify('textDocument/didOpen', { textDocument: { uri: this.uri, languageId: 'lean', version: this.version, text: content },
            dependencyBuildMode: 'never' });
    }

    notify(method: string, params: any): void { this.write({ jsonrpc: '2.0', method, params }); }
    private write(value: any): void {
        if (this.closed || !this.child?.stdin?.writable) throw new Error('Lean language session is closed.');
        const body = Buffer.from(JSON.stringify(value), 'utf8');
        if (body.length > MESSAGE_LIMIT) throw new LeanReviewError(413, 'Lean request exceeds its bounded message size.');
        this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
    }

    request(method: string, params: any, operation = new LeanLanguageOperation(), timeout = 20000): Promise<any> {
        operation.check();
        if (this.pending.size >= 16) throw new LeanReviewError(429, 'Too many simultaneous Lean language requests.');
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const abandon = (error: Error) => {
                const pending = this.pending.get(id);
                if (!pending) return;
                this.pending.delete(id); clearTimeout(pending.timer); pending.unsubscribe();
                try { this.notify('$/cancelRequest', { id }); } catch (_error) { /* session already closed */ }
                reject(error);
            };
            const pending: PendingRequest = { resolve, reject,
                timer: setTimeout(() => abandon(new Error(`Lean ${method} exceeded its ${timeout / 1000}-second limit.`)), timeout), unsubscribe: () => {} };
            this.pending.set(id, pending);
            pending.unsubscribe = operation.onCancel(() => abandon(new LeanReviewError(499, 'Lean language request cancelled.')));
            if (!this.pending.has(id)) return;
            try { this.write({ jsonrpc: '2.0', id, method, params }); } catch (error) { abandon(error as Error); }
        });
    }

    async waitForDiagnostics(operation: LeanLanguageOperation, timeout = 20000): Promise<boolean> {
        try {
            await this.request('textDocument/waitForDiagnostics', { uri: this.uri, version: this.version }, operation, timeout);
            this.complete = true;
        } catch (error) {
            if (operation.cancelled || this.closed) throw error;
            // Older/slow servers can still provide hover and partial tokens; never label them final.
            this.complete = false;
        }
        return this.complete;
    }

    private receive(chunk: any): void {
        if (this.closed) return;
        this.outputBytes += chunk.length;
        if (this.outputBytes > SESSION_OUTPUT_LIMIT || this.buffer.length + chunk.length > MESSAGE_LIMIT + 8192) {
            this.fail(new Error('Lean language server exceeded its bounded output size.')); return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        try {
            while (this.buffer.length) {
                const headerEnd = this.buffer.indexOf('\r\n\r\n');
                if (headerEnd < 0) { if (this.buffer.length > 8192) throw new Error('Malformed Lean LSP header.'); return; }
                const header = this.buffer.subarray(0, headerEnd).toString('ascii');
                const length = header.match(/^Content-Length:\s*(\d+)\s*$/mi);
                if (!length || Number(length[1]) > MESSAGE_LIMIT) throw new Error('Invalid Lean LSP content length.');
                const size = Number(length[1]);
                if (this.buffer.length < headerEnd + 4 + size) return;
                const message = JSON.parse(this.buffer.subarray(headerEnd + 4, headerEnd + 4 + size).toString('utf8'));
                this.buffer = this.buffer.subarray(headerEnd + 4 + size);
                this.handle(message);
            }
        } catch (error) { this.fail(error as Error); }
    }

    private handle(message: any): void {
        if (message.method) {
            if (message.method === 'textDocument/publishDiagnostics' && message.params?.uri === this.uri
                && (message.params.version === undefined || message.params.version === this.version)) {
                if (!Array.isArray(message.params.diagnostics) || message.params.diagnostics.length > 1000) throw new Error('Lean diagnostics exceed their bounded message limit.');
                this.diagnostics = message.params.diagnostics;
            }
            if (message.method === '$/lean/fileProgress' && message.params?.textDocument?.uri === this.uri) {
                if (Array.isArray(message.params.processing)) this.complete = message.params.processing.length === 0;
            }
            if (message.method === 'workspace/semanticTokens/refresh') this.tokensChanged = true;
            if (message.id !== undefined) {
                const result = message.method === 'workspace/configuration' ? (message.params?.items || []).map(() => null) : null;
                // Acknowledge refresh and all non-mutating requests; refuse any server-side edit.
                this.write({ jsonrpc: '2.0', id: message.id, result: message.method === 'workspace/applyEdit' ? { applied: false } : result });
            }
            return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer); pending.unsubscribe();
        if (message.error) {
            const error: any = new Error(String(message.error.message || 'Lean language request failed.'));
            error.code = message.error.code; pending.reject(error);
        } else pending.resolve(message.result);
    }

    private fail(error: Error): void {
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.unsubscribe(); pending.reject(error); }
        this.pending.clear();
        if (!this.closed) { this.closed = true; clearTimeout(this.processWatch); void killProcessTree(this.child, this.ownedProcesses); }
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        this.closing = (async () => {
            if (!this.closed && this.child) {
                try { this.notify('textDocument/didClose', { textDocument: { uri: this.uri } }); } catch (_error) { /* exited */ }
                try { await this.request('shutdown', null, undefined, 700); } catch (_error) { /* force shutdown below */ }
                try { this.notify('exit', null); } catch (_error) { /* exited */ }
                await Promise.race([this.processClosed, new Promise(resolve => setTimeout(resolve, 700))]);
            }
            await killProcessTree(this.child, this.ownedProcesses);
            this.fail(new Error('Lean language session closed.'));
            if (this.temporary) await fs.rm(this.temporary, { recursive: true, force: true });
        })();
        return this.closing;
    }
}
