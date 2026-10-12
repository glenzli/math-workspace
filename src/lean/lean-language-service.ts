import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toPosix } from '@math-workspace/core';
import { leanProjects, type LeanProjectConfig } from './lean-index';
import { installedToolchainRoot, manifestDependencies, reviewHash, reviewPathInside, reviewSafePath, LeanReviewError } from './lean-evidence';
import { LeanLanguageConnection, LeanLanguageOperation } from './lean-language-protocol';
import type { LeanDefinitionLocation, LeanLanguageRequest, LeanLanguageResponse, LeanPosition, LeanRange, LeanSemanticToken,
    LeanSourceFile, LeanSourceOrigin } from './lean-language';

const nodeFs = require('node:fs/promises');
const { fileURLToPath } = require('node:url');
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_INVENTORY_FILES = 160000;
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_SESSIONS = 2;
const SOURCE_HASH = /^[0-9a-f]{64}$/;

interface SourceContext {
    root: string;
    project: LeanProjectConfig;
    projectRoot: string;
    sourceRoots: string[];
    dependencies: string[];
    dependencyError?: string;
    toolchain: string;
    toolchainRoot?: string;
    configHash: string;
}
interface OpenSource { context: SourceContext; absolute: string; source: LeanSourceFile }
interface Session extends OpenSource {
    id: string;
    connection: LeanLanguageConnection;
    environment: string;
    environmentPaths: string[];
    timer?: any;
    createdAt: number;
}
interface ActiveOperation { operation: LeanLanguageOperation; request: LeanLanguageRequest; sessionId?: string }

function boundedKey(value: unknown, label: string, max = 512): string {
    if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f]/.test(value)) throw new LeanReviewError(400, `Invalid ${label}.`);
    return value;
}
function lines(content: string): string[] { return content.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line); }
function sourceRange(content: string): LeanRange {
    const rows = lines(content); return { start: { line: 0, character: 0 }, end: { line: rows.length - 1, character: rows.at(-1)!.length } };
}
function validPosition(content: string, value: any): LeanPosition {
    const rows = lines(content);
    if (!value || !Number.isInteger(value.line) || !Number.isInteger(value.character) || value.line < 0 || value.line >= rows.length
        || value.character < 0 || value.character > rows[value.line].length) throw new LeanReviewError(400, 'Invalid UTF-16 Lean source position.');
    const row = rows[value.line];
    if (value.character > 0 && value.character < row.length && /[\uD800-\uDBFF]/.test(row[value.character - 1])
        && /[\uDC00-\uDFFF]/.test(row[value.character])) throw new LeanReviewError(400, 'A Lean position cannot split a UTF-16 surrogate pair.');
    return { line: value.line, character: value.character };
}
function validRange(content: string, value: any): LeanRange | undefined {
    try {
        const start = validPosition(content, value?.start), end = validPosition(content, value?.end);
        if (end.line < start.line || (end.line === start.line && end.character < start.character)) return undefined;
        return { start, end };
    } catch (_error) { return undefined; }
}

async function readBounded(file: string, max = MAX_FILE_BYTES): Promise<string> {
    let stat: any;
    try { stat = await fs.stat(file); }
    catch (error: any) { if (error?.code === 'ENOENT') throw new LeanReviewError(404, 'The local source or configuration file no longer exists.'); throw error; }
    if (!stat.isFile()) throw new LeanReviewError(400, 'Lean source must be a regular file.');
    if (stat.size > max) throw new LeanReviewError(413, 'Lean source exceeds the complete-file preview limit.');
    const data = await fs.readFile(file);
    if (data.length > max) throw new LeanReviewError(413, 'Lean source exceeds the complete-file preview limit.');
    const text = data.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(data)) throw new LeanReviewError(400, 'Lean source is not valid UTF-8.');
    return text;
}

async function contextFor(rootInput: string, keyInput: unknown): Promise<SourceContext> {
    const root = await fs.realpath(rootInput);
    const key = boundedKey(keyInput, 'Lean project key', 256);
    const raw = await readBounded((await reviewSafePath(root, '.math-workspace/config.json'))!, 256 * 1024);
    const projects = leanProjects(JSON.parse(raw));
    const matches = projects.filter(project => project.key === key);
    if (matches.length !== 1) throw new LeanReviewError(404, 'The Lean project is not uniquely configured in this Math Workspace.');
    const project = matches[0];
    if (project.sourceRoots.length > 64) throw new LeanReviewError(413, 'The Lean project exceeds its bounded source-root limit.');
    const projectRoot = (await reviewSafePath(root, project.root || '.'))!;
    const sourceRoots = await Promise.all(project.sourceRoots.map(source => reviewSafePath(projectRoot, source)));
    const toolchainPath = await reviewSafePath(projectRoot, 'lean-toolchain', true);
    const toolchain = toolchainPath ? (await readBounded(toolchainPath, 4096)).trim() : '';
    let dependencies: string[] = [], dependencyError: string | undefined;
    const manifestPath = await reviewSafePath(projectRoot, 'lake-manifest.json', true);
    try {
        if (manifestPath) {
            const manifest = JSON.parse(await readBounded(manifestPath, 1024 * 1024));
            if (Array.isArray(manifest.packages) && manifest.packages.length > 256) throw new LeanReviewError(413, 'The Lake manifest exceeds its bounded dependency limit.');
            const overrideRelative = toPosix(path.relative(root, path.resolve(projectRoot, typeof manifest.lakeDir === 'string' ? manifest.lakeDir : '.lake', 'package-overrides.json')));
            if (await reviewSafePath(root, overrideRelative, true)) throw new Error('Lake package overrides require deliberate external resolution and are not admitted by the read-only language service.');
        }
        dependencies = (await manifestDependencies(root, projectRoot)).map(item => item.directory);
    } catch (error) { dependencyError = (error as Error).message; }
    return { root, project, projectRoot, sourceRoots: sourceRoots.filter(Boolean) as string[], dependencies, dependencyError,
        toolchain, toolchainRoot: installedToolchainRoot(toolchain), configHash: reviewHash(raw) };
}

function sourceOrigin(context: SourceContext, absolute: string): LeanSourceOrigin | undefined {
    if (context.toolchainRoot && reviewPathInside(path.join(context.toolchainRoot, 'src', 'lean'), absolute)) return 'toolchain';
    const relative = toPosix(path.relative(context.root, absolute));
    if (relative.split('/').some(part => ['.git', 'node_modules', '.math-workspace'].includes(part))) return undefined;
    if (context.dependencies.some(directory => reviewPathInside(directory, absolute))) return 'dependency';
    // .lake artifacts and unrelated Lean files are not configured primary source roots.
    if (!relative.split('/').includes('.lake') && context.sourceRoots.some(directory => reviewPathInside(directory, absolute))) return 'project';
    return undefined;
}

async function openSource(context: SourceContext, pathInput: unknown, actualAbsolute = false): Promise<OpenSource> {
    const filePathInput = boundedKey(pathInput, 'Lean source path', 4096);
    let absolute: string;
    try {
        if (actualAbsolute) {
            absolute = await fs.realpath(filePathInput);
        } else if (filePathInput.startsWith('toolchain:')) {
            if (!context.toolchainRoot) throw new LeanReviewError(404, 'The configured installed Lean source is unavailable.');
            const stdlib = await fs.realpath(path.join(context.toolchainRoot, 'src', 'lean'));
            absolute = (await reviewSafePath(stdlib, filePathInput.slice('toolchain:'.length)))!;
        } else {
            absolute = (await reviewSafePath(context.root, filePathInput))!;
        }
    } catch (error: any) { if (error?.code === 'ENOENT') throw new LeanReviewError(404, 'The Lean source file no longer exists.'); throw error; }
    if (!absolute.endsWith('.lean')) throw new LeanReviewError(400, 'Only actual Lean source files may be opened.');
    const origin = sourceOrigin(context, absolute);
    if (!origin) throw new LeanReviewError(400, 'The Lean source is outside configured source roots, installed dependencies and the pinned standard library.');
    // Reject every source symlink segment, even if its final target is inside another admitted root.
    const sourceBoundary = origin === 'toolchain' ? path.join(context.toolchainRoot!, 'src', 'lean') : context.root;
    const relative = path.relative(sourceBoundary, absolute);
    if (!reviewPathInside(sourceBoundary, absolute)) throw new LeanReviewError(400, 'The Lean source escapes its admitted boundary.');
    if (!actualAbsolute) {
        const lexical = filePathInput.startsWith('toolchain:') ? filePathInput.slice('toolchain:'.length) : filePathInput;
        let candidate = sourceBoundary;
        for (const part of lexical.split(/[\\/]/).filter(part => part && part !== '.')) {
            candidate = path.join(candidate, part);
            if ((await nodeFs.lstat(candidate)).isSymbolicLink()) throw new LeanReviewError(400, 'Lean source symlinks are not admitted.');
        }
    }
    const content = await readBounded(absolute);
    const filePath = origin === 'toolchain' ? `toolchain:${toPosix(relative)}` : toPosix(path.relative(context.root, absolute));
    const projectToken = reviewHash(context.root);
    const source: LeanSourceFile = { projectToken, projectKey: context.project.key, filePath,
        sourceUri: `mw-lean:${projectToken}:${encodeURIComponent(context.project.key)}:${encodeURIComponent(filePath)}`,
        sourceHash: reviewHash(content), content, lineCount: lines(content).length, range: sourceRange(content), origin, readonly: true };
    return { context, absolute, source };
}

/** Metadata of every source/config and materialized semantic artifact, including the installed
 * toolchain. ctime/mtime/size/inode catch imported artifact replacement as well as source drift.
 * The active source additionally gets an exact byte hash before and after every request. */
async function environmentFingerprint(context: SourceContext, operation: LeanLanguageOperation, knownPaths?: string[]): Promise<{ fingerprint: string; paths: string[] }> {
    const started = Date.now(), records: any[] = [], visited = new Set<string>();
    let files = 0, sourceBytes = 0, directories = 0;
    const check = () => {
        operation.check();
        if (Date.now() - started > 20000) throw new LeanReviewError(503, 'Lean environment inspection exceeded its 20-second limit.');
    };
    const record = async (candidate: string, entry?: any) => {
        check();
        const stat = await nodeFs.lstat(candidate);
        if (++files > MAX_INVENTORY_FILES) throw new LeanReviewError(413, 'Lean environment exceeds its bounded file limit.');
        if (candidate.endsWith('.lean')) sourceBytes += stat.size;
        if (sourceBytes > MAX_SOURCE_BYTES) throw new LeanReviewError(413, 'Lean environment exceeds its bounded source-byte limit.');
        records.push([candidate, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.isSymbolicLink()]);
    };
    const visit = async (directory: string, toolchain = false): Promise<void> => {
        check();
        if (visited.has(directory)) return;
        visited.add(directory);
        await record(directory);
        if (++directories > MAX_INVENTORY_FILES) throw new LeanReviewError(413, 'Lean environment exceeds its bounded directory limit.');
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const selected: Array<{ candidate: string; entry: any }> = [];
        const descendants: string[] = [];
        const semanticFile = (name: string) => name.endsWith('.lean') || /\.(?:olean(?:\.private|\.server)?|ilean|ir|so|dylib|dll)$/.test(name)
            || ['lean-toolchain', 'lakefile.toml', 'lake-manifest.json', 'package-overrides.json'].includes(name);
        for (const entry of entries) {
            if (['.git', 'node_modules', '.math-workspace'].includes(entry.name)) continue;
            const candidate = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                // Lake packages commonly alias docs and benchmark scripts. They are not
                // semantic inputs. A directory link could hide source/artifact descendants,
                // so it still must pass the admitted toolchain boundary below.
                if (!semanticFile(entry.name)) {
                    let stat: any;
                    try { stat = await fs.stat(candidate); }
                    catch (error: any) { if (error?.code === 'ENOENT') continue; throw error; }
                    if (!stat.isDirectory()) continue;
                }
                const target = await fs.realpath(candidate);
                if (!toolchain || !reviewPathInside(context.toolchainRoot!, target)) throw new LeanReviewError(400, 'Lean environment symlinks are not admitted.');
                selected.push({ candidate, entry });
                selected.push({ candidate: target, entry: undefined });
            } else if (entry.isDirectory()) descendants.push(candidate);
            else if (entry.isFile() && semanticFile(entry.name)) selected.push({ candidate, entry });
        }
        for (let offset = 0; offset < selected.length; offset += 64) await Promise.all(selected.slice(offset, offset + 64).map(item => record(item.candidate, item.entry)));
        for (const child of descendants) await visit(child, toolchain);
    };
    if (knownPaths) {
        if (knownPaths.length > MAX_INVENTORY_FILES) throw new LeanReviewError(413, 'Lean environment exceeds its bounded file limit.');
        for (let offset = 0; offset < knownPaths.length; offset += 128) await Promise.all(knownPaths.slice(offset, offset + 128).map(candidate => record(candidate)));
    } else {
        await visit(context.projectRoot);
        for (const directory of context.dependencies) await visit(directory);
        if (context.toolchainRoot) {
            for (const file of ['lean', 'lake']) await record(path.join(context.toolchainRoot, 'bin', file));
            await visit(path.join(context.toolchainRoot, 'lib', 'lean'), true);
            await visit(path.join(context.toolchainRoot, 'src', 'lean'), true);
        }
    }
    records.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return { paths: records.map(record => record[0]), fingerprint: reviewHash(JSON.stringify({ config: context.configHash, project: context.project, toolchain: context.toolchain,
        dependencyError: context.dependencyError, records })) };
}

function decodeTokens(content: string, raw: any, legend: any): LeanSemanticToken[] {
    const data = raw?.data;
    if (!Array.isArray(data) || data.length % 5 !== 0 || data.length > 500000) throw new Error('Lean returned invalid or excessive semantic tokens.');
    const result: LeanSemanticToken[] = [];
    let line = 0, character = 0;
    for (let offset = 0; offset < data.length; offset += 5) {
        const tuple = data.slice(offset, offset + 5);
        if (!tuple.every((value: unknown) => Number.isInteger(value) && Number(value) >= 0)) throw new Error('Lean returned invalid semantic token coordinates.');
        const [deltaLine, deltaCharacter, length, type, modifiers] = tuple;
        line += deltaLine; character = deltaLine ? deltaCharacter : character + deltaCharacter;
        const range = validRange(content, { start: { line, character }, end: { line, character: character + length } });
        if (!range || !legend?.tokenTypes?.[type]) throw new Error('Lean semantic token does not match the current source or legend.');
        result.push({ range, type: legend.tokenTypes[type], modifiers: (legend.tokenModifiers || []).filter((_value: string, index: number) => (modifiers & (1 << index)) !== 0) });
    }
    return result;
}

/** Explicit source language sessions are independent of saved human review evidence. */
export class LeanLanguageService {
    private sessions = new Map<string, Session>();
    private operations = new Map<string, ActiveOperation>();
    private disposed = false;
    constructor(private readonly idleMs = 120000) {}

    async source(root: string, projectKey: unknown, filePath: unknown): Promise<LeanSourceFile> {
        return (await openSource(await contextFor(root, projectKey), filePath)).source;
    }
    private response(open: OpenSource, request: LeanLanguageRequest, state: LeanLanguageResponse['state'], session?: Session): LeanLanguageResponse {
        const { projectToken, projectKey, filePath, sourceUri, sourceHash } = open.source;
        return { projectToken, projectKey, filePath, sourceUri, sourceHash, action: request.action, requestId: request.requestId, state,
            ...(session ? { sessionId: session.id, sourceVersion: session.connection.version } : {}), toolchain: open.context.toolchain };
    }
    private touch(session: Session): void {
        clearTimeout(session.timer);
        const remaining = Math.min(this.idleMs, Math.max(1, 10 * 60 * 1000 - (Date.now() - session.createdAt)));
        session.timer = setTimeout(() => void this.retire(session), remaining);
        session.timer.unref?.();
    }
    private async retire(session: Session, currentOperation?: LeanLanguageOperation): Promise<void> {
        if (this.sessions.get(session.id) === session) this.sessions.delete(session.id);
        clearTimeout(session.timer);
        for (const active of this.operations.values()) if (active.sessionId === session.id && active.operation !== currentOperation) active.operation.cancel();
        await session.connection.close();
    }
    private key(root: string, requestId: string): string { return `${root}\0${requestId}`; }
    cancel(root: string, requestId: string): void { this.operations.get(this.key(root, requestId))?.operation.cancel(); }
    private cancelledResponse(root: string, request: LeanLanguageRequest): LeanLanguageResponse {
        const projectToken = reviewHash(root);
        return { projectToken, projectKey: request.projectKey, filePath: request.filePath, sourceHash: request.sourceHash,
            sourceUri: `mw-lean:${projectToken}:${encodeURIComponent(request.projectKey)}:${encodeURIComponent(request.filePath)}`,
            action: request.action, requestId: request.requestId, state: 'cancelled' };
    }

    async action(rootInput: string, raw: any): Promise<LeanLanguageResponse> {
        if (this.disposed) throw new LeanReviewError(409, 'The Lean language service is closed.');
        if (!raw || !['open', 'hover', 'definition', 'goals', 'tokens', 'diagnostics', 'close', 'cancel'].includes(raw.action)) throw new LeanReviewError(400, 'Unknown Lean language action.');
        const request = raw as LeanLanguageRequest;
        boundedKey(request.requestId, 'Lean request id', 128);
        boundedKey(request.projectKey, 'Lean project key', 256); boundedKey(request.filePath, 'Lean source path', 4096);
        if (!SOURCE_HASH.test(request.sourceHash || '')) throw new LeanReviewError(400, 'A displayed Lean source hash is required.');
        const key = this.key(rootInput, request.requestId);
        if (request.action === 'cancel') {
            const active = this.operations.get(key);
            if (active && (active.request.projectKey !== request.projectKey || active.request.filePath !== request.filePath || active.request.sourceHash !== request.sourceHash)) {
                throw new LeanReviewError(409, 'The cancelled request belongs to another source identity.');
            }
            active?.operation.cancel();
            return this.cancelledResponse(rootInput, request);
        }
        if (request.action === 'close') {
            boundedKey(request.sessionId, 'Lean session id', 32);
            const session = this.sessions.get(request.sessionId!);
            const canonicalRoot = await fs.realpath(rootInput);
            if (!session || session.context.root !== canonicalRoot || session.source.projectKey !== request.projectKey
                || session.source.filePath !== request.filePath || session.source.sourceHash !== request.sourceHash
                || (request.sourceVersion !== undefined && request.sourceVersion !== session.connection.version)) {
                throw new LeanReviewError(409, 'The closed session belongs to another source identity or is already closed.');
            }
            // Cleanup checks the stored identity, so edits/deletion cannot prevent releasing a process.
            await this.retire(session); return this.response(session, request, 'closed', session);
        }
        if (this.operations.has(key) || this.operations.size >= 16) throw new LeanReviewError(429, 'A Lean request with this identity is active, or the bounded request limit was reached.');
        const active: ActiveOperation = { operation: new LeanLanguageOperation(), request };
        this.operations.set(key, active);
        let session: Session | undefined, open: OpenSource | undefined;
        try {
            active.operation.check();
            const context = await contextFor(rootInput, request.projectKey);
            open = await openSource(context, request.filePath);
            active.operation.check();
            if (this.disposed) throw new LeanReviewError(499, 'The Lean language service closed while preparing this request.');
            if (open.source.sourceHash !== request.sourceHash) throw new LeanReviewError(409, 'The displayed Lean source changed. Reopen its complete source before requesting semantics.');
            if (request.action === 'open') {
                const unsupported = !/^leanprover\/lean4:v4\.(?:29|3\d|[4-9]\d|\d{3,})\.\d+$/.test(context.toolchain);
                if (unsupported || !context.toolchainRoot) return { ...this.response(open, request, 'unavailable'), reason: 'This configured Lean toolchain does not have a verified read-only language protocol. Use complete source preview or deliberately install a supported toolchain outside the Reader.' };
                if (context.dependencyError) return { ...this.response(open, request, 'unavailable'), reason: context.dependencyError };
                try { await fs.access(path.join(context.toolchainRoot, 'bin', 'lean')); await fs.access(path.join(context.toolchainRoot, 'bin', 'lake')); }
                catch (_error) { return { ...this.response(open, request, 'unavailable'), reason: 'The configured Lean toolchain is not installed locally. Complete source preview remains available.' }; }
                if (this.sessions.size >= MAX_SESSIONS) throw new LeanReviewError(429, 'Close another Lean source session before opening this source.');
                const inventory = await environmentFingerprint(context, active.operation);
                if (this.sessions.size >= MAX_SESSIONS) throw new LeanReviewError(429, 'Close another Lean source session before opening this source.');
                session = { ...open, id: require('node:crypto').randomBytes(16).toString('hex'), connection: new LeanLanguageConnection(open.absolute),
                    environment: inventory.fingerprint, environmentPaths: inventory.paths, createdAt: Date.now() };
                active.sessionId = session.id;
                this.sessions.set(session.id, session);
                try {
                    await session.connection.start(context.projectRoot, context.toolchainRoot, open.source.content, active.operation, context.dependencies);
                    await session.connection.waitForDiagnostics(active.operation);
                } catch (error) {
                    await this.retire(session, active.operation);
                    if (active.operation.cancelled) return this.response(open, request, 'cancelled');
                    return { ...this.response(open, request, 'unavailable'), reason: (error as Error).message };
                }
            } else {
                boundedKey(request.sessionId, 'Lean session id', 32);
                session = this.sessions.get(request.sessionId!);
                if (!session || session.connection.isClosed || session.context.root !== context.root || session.source.projectKey !== request.projectKey
                    || session.source.filePath !== open.source.filePath || session.source.sourceHash !== request.sourceHash
                    || (request.sourceVersion !== undefined && request.sourceVersion !== session.connection.version)) {
                    throw new LeanReviewError(409, 'This Lean session or source version is no longer current. Reopen the source language session.');
                }
                active.sessionId = session.id;
                if ((await environmentFingerprint(context, active.operation, session.environmentPaths)).fingerprint !== session.environment) {
                    await this.retire(session); throw new LeanReviewError(409, 'Lean source, imports, build artifacts, configuration or toolchain changed. Reopen the source language session.');
                }
            }
            this.touch(session!);
            const connection = session!.connection;
            const response = this.response(open, request, 'available', session);
            response.capabilities = { hover: !!connection.capabilities.hoverProvider, definition: !!connection.capabilities.definitionProvider,
                goals: true, diagnostics: true, semanticTokens: !!connection.capabilities.semanticTokensProvider?.full };
            const position = ['hover', 'definition', 'goals'].includes(request.action) ? validPosition(open.source.content, request.position) : undefined;
            const parameters = { textDocument: { uri: connection.uri }, ...(position ? { position } : {}) };
            if (request.action === 'hover') response.hover = await connection.request('textDocument/hover', parameters, active.operation);
            if (request.action === 'goals') {
                const [goals, term] = await Promise.all([connection.request('$/lean/plainGoal', parameters, active.operation), connection.request('$/lean/plainTermGoal', parameters, active.operation)]);
                response.goals = goals?.goals || null;
                if (goals?.rendered) response.renderedGoals = goals.rendered;
                response.termGoal = term?.goal || null;
                if (term?.range) response.termGoalRange = validRange(open.source.content, term.range);
            }
            if (request.action === 'definition') {
                const rawLocations = await connection.request('textDocument/definition', parameters, active.operation);
                const locations = rawLocations === null ? [] : Array.isArray(rawLocations) ? rawLocations : [rawLocations];
                if (locations.length > 64) throw new LeanReviewError(413, 'Lean definition response exceeds its bounded location limit.');
                response.definitions = [];
                response.omittedDefinitions = 0;
                for (const location of locations) {
                    try {
                        const uri = location.targetUri || location.uri;
                        const target = await openSource(context, fileURLToPath(uri), true);
                        const range = validRange(target.source.content, location.targetRange || location.range);
                        if (!range) throw new Error('Invalid Lean definition range.');
                        const { content, lineCount, readonly, ...identity } = target.source;
                        const projected: LeanDefinitionLocation = { ...identity, range,
                            ...(location.targetSelectionRange ? { selectionRange: validRange(target.source.content, location.targetSelectionRange) } : {}) };
                        response.definitions.push(projected);
                    } catch (_error) { response.omittedDefinitions!++; }
                }
            }
            if (['open', 'tokens', 'diagnostics'].includes(request.action)) {
                if (!connection.complete && request.action !== 'open') await connection.waitForDiagnostics(active.operation, 3000);
                if (response.capabilities.semanticTokens) {
                    const tokens = await connection.request('textDocument/semanticTokens/full', { textDocument: { uri: connection.uri } }, active.operation);
                    response.tokens = decodeTokens(open.source.content, tokens, connection.capabilities.semanticTokensProvider.legend);
                    connection.tokensChanged = false;
                }
                response.diagnostics = connection.diagnostics.map(item => ({ range: validRange(open.source.content, item.range),
                    message: String(item.message || '').length > 24000 ? `${String(item.message).slice(0, 24000)}\n[Diagnostic text exceeds the 24000-character display limit.]` : String(item.message || ''),
                    ...(item.severity !== undefined ? { severity: item.severity } : {}), ...(typeof item.source === 'string' ? { source: item.source } : {}),
                    ...(['string', 'number'].includes(typeof item.code) ? { code: item.code } : {}) })).filter(item => item.range);
            }
            response.complete = connection.complete;
            // Reject results that raced disk changes while Lean was processing.
            const freshContext = await contextFor(context.root, request.projectKey);
            const current = await openSource(freshContext, request.filePath);
            if (current.source.sourceHash !== request.sourceHash || (await environmentFingerprint(freshContext, active.operation, session!.environmentPaths)).fingerprint !== session!.environment) {
                await this.retire(session!); throw new LeanReviewError(409, 'Lean inputs changed while the language request was processing. Reopen the source.');
            }
            active.operation.check();
            if (Buffer.byteLength(JSON.stringify(response)) > 8 * 1024 * 1024) throw new LeanReviewError(413, 'Lean semantic response exceeds its bounded 8 MiB limit.');
            return response;
        } catch (error) {
            if (active.operation.cancelled && !(error instanceof LeanReviewError && error.status === 409)) return open ? this.response(open, request, 'cancelled', session) : this.cancelledResponse(rootInput, request);
            if (!(error instanceof LeanReviewError)) {
                if (session) await this.retire(session, active.operation);
                if (!open) throw error;
                return { ...this.response(open, request, 'unavailable'), reason: (error as Error).message };
            }
            throw error;
        } finally { this.operations.delete(key); }
    }

    async closeProject(root: string): Promise<void> {
        for (const [key, active] of this.operations) if (key.startsWith(`${root}\0`)) active.operation.cancel();
        await Promise.all([...this.sessions.values()].filter(session => session.context.root === root).map(session => this.retire(session)));
    }
    async close(): Promise<void> {
        this.disposed = true;
        for (const active of this.operations.values()) active.operation.cancel();
        await Promise.all([...this.sessions.values()].map(session => this.retire(session)));
    }
}
