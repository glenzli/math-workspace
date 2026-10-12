import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sendInteractiveFigure } from '../figures/server';
import {
    buildRuntimeDefinitions,
    findSymbolsInMarkdown,
    formatDisplayNumber,
    formatPageHeading,
    formatPageReference,
    toPosix,
    typeName,
    type LabelData,
    type PageData,
    type RuntimeDefinitionData
} from '@math-workspace/core';
import { projectReaderDependencyMarkers } from './dependency-markers';
import { ReaderProjectRegistry } from './projects';
import { ReaderWorkspace, type WorkspaceSnapshot } from './workspace';
import { updateDocumentState, type DocumentLifecycleUpdate } from './document-state';
import { ArchiveReaderApi } from '../archive/reader-api';
import { readLeanBuild } from '../lean/lean-state';
import { readLeanDependencyArtifact } from '../lean/lean-dependencies';
import { LeanReviewService } from '../lean/lean-review-service';
import { LeanReviewError } from '../lean/lean-evidence';
import { LeanLanguageService } from '../lean/lean-language-service';
import { LeanAuditService } from '../lean/lean-audit-service';
import { handleLeanAuditRoute } from '../lean/lean-audit-routes';
import { LeanAssistanceService } from '../lean/lean-assistance-service';
import { handleLeanAssistanceRoute } from '../lean/lean-assistance-routes';
import { SymbolAuditService } from './symbol-audit-service';
import type { SymbolAuditScope, SymbolAuditSettings } from './symbol-audit';
import { registerReaderInstance, unregisterReaderInstance } from './location-bridge';

const http = require('node:http');
const { URL } = require('node:url');
const { createHash, randomBytes } = require('node:crypto');

const STATIC_CACHE_CONTROL = 'no-cache';
const API_CACHE_CONTROL = 'no-store';
const READER_CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: https:",
    "style-src 'self'",
    // KaTeX positions scripts and extensible glyphs with generated style attributes.
    "style-src-attr 'unsafe-inline'",
    "script-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'self'"
].join('; ');
const MIME_TYPES: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

export interface FormalReaderServerOptions {
    rootPath?: string;
    port?: number;
    staticRoot?: string;
    recentProjectsPath?: string;
    locationRegistryPath?: string;
    chooseProjectDirectory?: () => Promise<string | undefined>;
}

export interface FormalReaderServer {
    rootPath?: string;
    port: number;
    url: string;
    close(): Promise<void>;
}

function pathExists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true, () => false);
}

function pathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function stripUndefinedFields<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function displayLabel(label: LabelData, config: any, pagesByPath: Map<string, PageData>): string {
    const page = pagesByPath.get(label.filePath);
    if (page && ['chapter', 'appendix', 'intro', 'summary'].includes(label.type)) {
        return formatPageReference(page, config);
    }
    const number = formatDisplayNumber(label);
    const name = typeName(config, label.type);
    if (label.type === 'solution') return config.language === 'en' ? `Solution to Exercise ${number}` : `习题 ${number} 的解答`;
    return number ? name + ' ' + number : name;
}

function decoratePage(page: PageData, config: any, lifecycle?: unknown): Record<string, unknown> {
    return {
        ...page,
        ...(lifecycle ? { lifecycle } : {}),
        displayHeading: formatPageHeading(page, config),
        displayReference: formatPageReference(page, config)
    };
}

function labelSummary(label: LabelData, config: any, pagesByPath: Map<string, PageData>): Record<string, unknown> {
    const { content: _content, proofContent: _proof, supportContent: _support, ...summary } = label;
    return { ...summary, display: displayLabel(label, config, pagesByPath) };
}

function labelsForContent(snapshot: WorkspaceSnapshot, content: string): Record<string, unknown> {
    const pagesByPath = new Map<string, PageData>((snapshot.state.pages || []).map((page: PageData) => [page.filePath, page]));
    const ids = new Set<string>();
    const marker = /(?:@|#)([A-Za-z0-9_-]+)\b/g;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(content))) {
        if (snapshot.state.labels?.[match[1]]) ids.add(match[1]);
    }
    for (const id of [...ids]) {
        const label = snapshot.state.labels[id];
        for (const related of [...(label.solutions || []), ...(label.solutionOf ? [label.solutionOf] : [])]) {
            if (snapshot.state.labels[related]) ids.add(related);
        }
    }
    return Object.fromEntries(Array.from(ids, id => [id, labelSummary(snapshot.state.labels[id], snapshot.state.config, pagesByPath)]));
}

/** `LabelData.startLine` is zero-based, matching the formal scanner. */
function sectionRecallPreview(content: string, startLine: number): string {
    const lines = content.split(/\r?\n/);
    const start = Math.max(0, Math.min(lines.length - 1, startLine));
    const heading = lines[start]?.match(/^\s{0,3}(#{1,6})\s+/);
    if (!heading) return '';

    const level = heading[1].length;
    const preview: string[] = [lines[start]];
    let chars = preview[0].length;
    let inDisplayMath = false;
    for (let index = start + 1; index < lines.length; index++) {
        const line = lines[index];
        const nextHeading = line.match(/^\s{0,3}(#{1,6})\s+/);
        if (nextHeading && nextHeading[1].length <= level) break;
        preview.push(line);
        chars += line.length + 1;

        const trimmed = line.trim();
        if (trimmed === '$$' || trimmed === '\\[' || trimmed === '\\]') inDisplayMath = !inDisplayMath;
        if (chars >= 1200 && !inDisplayMath && !trimmed) break;
        if (chars >= 1800 && !inDisplayMath) break;
    }
    return preview.join('\n').trim();
}

function definitionSummary(definition: RuntimeDefinitionData, index: number): Record<string, unknown> {
    const { content: _content, ...summary } = definition;
    return { ...summary, index };
}

function mimeType(filePath: string): string {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function parsePort(value: string | undefined): number {
    if (value === undefined || value === '') return 0;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid workspace port: ${value}`);
    }
    return port;
}

function sendJson(response: any, status: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.writeHead(status, {
        'cache-control': API_CACHE_CONTROL,
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body)
    });
    response.end(body);
}

function sendText(response: any, status: number, body: string): void {
    response.writeHead(status, {
        'cache-control': API_CACHE_CONTROL,
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(body)
    });
    response.end(body);
}

function stateProjection(snapshot: WorkspaceSnapshot, rootPath: string): Record<string, unknown> {
    const definitions = buildRuntimeDefinitions(snapshot.state.definitions || []);
    const pages = snapshot.state.pages || [];
    return {
        revision: snapshot.revision,
        refreshedAt: snapshot.refreshedAt,
        rootName: path.basename(rootPath),
        projectId: createHash('sha256').update(rootPath).digest('hex'),
        language: snapshot.state.config?.language || 'zh',
        pages: pages.map((page: PageData) => decoratePage(page, snapshot.state.config, snapshot.state.documentState?.lifecycles?.[page.filePath])),
        definitions: definitions.map(definitionSummary),
        issues: snapshot.state.issues || [],
        dependencySummary: snapshot.state.dependencyGraph?.summary || {},
        leanSummary: snapshot.state.leanIndex?.summary || {},
        documentState: { orphaned: snapshot.state.documentState?.orphaned || [] },
        projectAnalysis: snapshot.state.projectAnalysis || { schemaVersion: 1, sources: [], summary: {} }
    };
}

async function readerStateProjection(
    workspace: ReaderWorkspace | undefined,
    rootPath: string | undefined,
    projects: ReaderProjectRegistry,
    requestToken: string
): Promise<Record<string, unknown>> {
    if (workspace && rootPath) {
        return {
            available: true,
            requestToken,
            ...stateProjection(workspace.current(), rootPath)
        };
    }
    const recentProjects = await projects.list();
    return {
        available: false,
        revision: 0,
        refreshedAt: '',
        rootName: '',
        language: 'zh',
        pages: [],
        definitions: [],
        issues: [],
        dependencySummary: {},
        projectAnalysis: { schemaVersion: 1, sources: [], summary: {} },
        requestToken,
        recentProjects: recentProjects.map((project, index) => ({
            index,
            rootName: project.rootName,
            openedAt: project.openedAt
        }))
    };
}

async function readJsonRequest(request: any, maximumBytes = 4096): Promise<any> {
    return new Promise((resolve, reject) => {
        let body = '';
        let received = 0;
        request.on('data', (chunk: unknown) => {
            received += Buffer.byteLength(String(chunk));
            if (received > maximumBytes) {
                reject(new Error('Request body is too large.'));
                request.destroy();
                return;
            }
            body += String(chunk);
        });
        request.once('error', reject);
        request.once('end', () => {
            if (!body.trim()) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch (_error) {
                reject(new Error('Request body must be JSON.'));
            }
        });
    });
}

function requireRequestToken(request: any, response: any, requestToken: string): boolean {
    if (request.headers?.['x-math-workspace-token'] === requestToken) return true;
    sendText(response, 403, 'A local Math Workspace request token is required.');
    return false;
}

function symbolAuditSettingsInput(value: unknown): SymbolAuditSettings {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const read = (key: 'model' | 'effort', maximum: number): string | undefined => {
        const item = record[key];
        if (item === undefined || item === null || item === '') return undefined;
        if (typeof item !== 'string') throw new Error(`Symbol audit ${key} must be a string.`);
        const normalized = item.trim();
        if (normalized.length > maximum) throw new Error(`Symbol audit ${key} is too long.`);
        return normalized || undefined;
    };
    const model = read('model', 160);
    const effort = read('effort', 80);
    const rawScope = record.scope;
    let scope: SymbolAuditScope | undefined;
    if (rawScope !== undefined && rawScope !== null) {
        if (!rawScope || typeof rawScope !== 'object' || Array.isArray(rawScope)) throw new Error('Symbol audit scope must be an object.');
        const scopeRecord = rawScope as Record<string, unknown>;
        const kind = scopeRecord.kind;
        if (kind === 'all') scope = { kind: 'all' };
        else if (kind === 'volume') {
            const groupId = typeof scopeRecord.groupId === 'string' ? scopeRecord.groupId.trim() : '';
            if (!groupId || groupId.length > 320 || groupId.startsWith('/') || groupId.includes('..')) throw new Error('Symbol audit volume scope is invalid.');
            scope = { kind: 'volume', groupId };
        } else if (kind === 'chapters') {
            if (!Array.isArray(scopeRecord.filePaths) || scopeRecord.filePaths.length > 160) throw new Error('Symbol audit chapter scope is invalid.');
            const filePaths = Array.from(new Set(scopeRecord.filePaths.map(item => typeof item === 'string' ? item.trim() : '')))
                .filter(filePath => filePath && filePath.length <= 480 && !filePath.startsWith('/') && !filePath.includes('..'))
                .sort();
            scope = { kind: 'chapters', filePaths };
        } else throw new Error('Symbol audit scope kind is invalid.');
    }
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(scope ? { scope } : {}) };
}

function documentStateInput(value: unknown): DocumentLifecycleUpdate {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const filePath = typeof record.filePath === 'string' ? toPosix(record.filePath).replace(/^\/+/, '') : '';
    if (!filePath || filePath.startsWith('../') || filePath.includes('/../')) throw new Error('Document path is invalid.');
    const stage = record.stage;
    if (stage !== undefined && !['draft', 'revising', 'stable'].includes(stage as string)) throw new Error('Document stage is invalid.');
    const checkpointLabel = record.checkpointLabel;
    if (checkpointLabel !== undefined && typeof checkpointLabel !== 'string') throw new Error('Version label is invalid.');
    const clearCheckpoint = record.clearCheckpoint;
    if (clearCheckpoint !== undefined && typeof clearCheckpoint !== 'boolean') throw new Error('Checkpoint operation is invalid.');
    return {
        filePath,
        ...(stage !== undefined ? { stage: stage as DocumentLifecycleUpdate['stage'] } : {}),
        ...(checkpointLabel !== undefined ? { checkpointLabel: checkpointLabel as string } : {}),
        ...(clearCheckpoint === true ? { clearCheckpoint: true } : {})
    };
}

function resolveWorkspacePath(rootPath: string, relativePath: string): string | undefined {
    const normalized = toPosix(relativePath || '').replace(/^\/+/, '');
    if (!normalized) return undefined;
    const absolutePath = path.resolve(rootPath, normalized);
    return pathInside(rootPath, absolutePath) ? absolutePath : undefined;
}

async function sendStaticFile(response: any, staticRoot: string, requestPath: string): Promise<void> {
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const absolutePath = resolveWorkspacePath(staticRoot, relativePath);
    if (!absolutePath || !(await pathExists(absolutePath))) {
        sendText(response, 404, 'Math Workspace asset not found.');
        return;
    }
    let body = await fs.readFile(absolutePath);
    let policy = READER_CONTENT_SECURITY_POLICY;
    if (absolutePath === path.resolve(staticRoot, 'index.html')) {
        const styleNonce = randomBytes(24).toString('base64url');
        body = Buffer.from(body.toString('utf8').replace(/<head(?:\s[^>]*)?>/i,
            (head: string) => `${head}\n<meta name="math-workspace-style-nonce" content="${styleNonce}">`), 'utf8');
        policy = policy.replace("style-src 'self'", `style-src 'self' 'nonce-${styleNonce}'`);
    }
    response.writeHead(200, {
        'cache-control': STATIC_CACHE_CONTROL,
        'content-type': mimeType(absolutePath),
        'content-length': body.length,
        'content-security-policy': policy
    });
    response.end(body);
}

async function sendWorkspaceAsset(response: any, workspace: ReaderWorkspace, requestedPath: string): Promise<void> {
    const absolutePath = resolveWorkspacePath(workspace.rootPath, requestedPath);
    if (!absolutePath || !(await pathExists(absolutePath))) {
        sendText(response, 404, 'Workspace asset not found.');
        return;
    }
    const extension = path.extname(absolutePath).toLowerCase();
    if (!['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'].includes(extension)) {
        sendText(response, 403, 'Only local image assets are available to Math Workspace.');
        return;
    }
    const body = await fs.readFile(absolutePath);
    response.writeHead(200, {
        'cache-control': STATIC_CACHE_CONTROL,
        'content-type': mimeType(absolutePath),
        'content-length': body.length
    });
    response.end(body);
}

export async function startReaderServer(options: FormalReaderServerOptions): Promise<FormalReaderServer> {
    const staticRoot = options.staticRoot || path.resolve(__dirname, '..', 'reader');
    if (!(await pathExists(staticRoot))) {
        throw new Error(`Math Workspace UI bundle is missing at ${staticRoot}. Run npm run build:reader.`);
    }

    const projects = new ReaderProjectRegistry({
        stateFilePath: options.recentProjectsPath,
        chooseDirectory: options.chooseProjectDirectory
    });
    const symbolAudit = new SymbolAuditService();
    // This token only authorizes same-origin mutations from the current Math Workspace page.
    const requestToken = randomBytes(24).toString('hex');
    const archiveApi = new ArchiveReaderApi();
    let rootPath: string | undefined;
    let workspace: ReaderWorkspace | undefined;
    let unsubscribe = () => {};
    const eventResponses = new Set<any>();
    const bridgeToken = randomBytes(24).toString('hex');
    let serverUrl = '';
    let projectChanging = false;

    const broadcastEvent = (name: string, value: unknown): number => {
        const event = `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
        eventResponses.forEach(response => response.write(event));
        return eventResponses.size;
    };

    const broadcast = (snapshot: WorkspaceSnapshot | undefined, changedPaths: string[], projectChanged = false): void => {
        broadcastEvent('workspace-update', {
            projectId: rootPath ? createHash('sha256').update(rootPath).digest('hex') : undefined,
            revision: snapshot?.revision || 0,
            refreshedAt: snapshot?.refreshedAt || '',
            changedPaths,
            projectChanged
        });
    };

    const leanReview = new LeanReviewService((projectRoot, formalId) => {
        if (rootPath === projectRoot) workspace?.notifyMetadataChange([`.math-workspace/lean-reviews/${formalId}.json`]);
    });
    const leanLanguage = new LeanLanguageService();
    const leanAudit = new LeanAuditService(leanReview, (projectRoot, formalId) => {
        if (rootPath === projectRoot) workspace?.notifyMetadataChange([`.math-workspace/lean-audits/${formalId}.json`]);
    });
    const leanAssistance = new LeanAssistanceService(leanReview, (projectRoot, formalId) => {
        if (rootPath === projectRoot) workspace?.notifyMetadataChange([`.math-workspace/lean-assistance/${formalId}.json`]);
    });

    const syncReaderInstance = async (previousRoot?: string): Promise<void> => {
        if (!serverUrl) return;
        try {
            if (previousRoot && previousRoot !== rootPath) {
                await unregisterReaderInstance(serverUrl, options.locationRegistryPath);
            }
            if (rootPath) {
                await registerReaderInstance({ rootPath, url: serverUrl, token: bridgeToken }, options.locationRegistryPath);
            }
        } catch (error) {
            console.warn(`[math-workspace] Could not publish Reader location bridge: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const activateProject = async (inputPath: string): Promise<void> => {
        projectChanging = true;
        try {
            const previousRoot = rootPath;
            if (rootPath) await symbolAudit.cancel(rootPath);
            if (rootPath) await leanLanguage.closeProject(rootPath);
            const project = await projects.remember(inputPath);
            const nextWorkspace = new ReaderWorkspace(project.rootPath);
            await nextWorkspace.start();
            const previousWorkspace = workspace;
            const previousUnsubscribe = unsubscribe;
            workspace = nextWorkspace;
            rootPath = project.rootPath;
            unsubscribe = nextWorkspace.onChange(({ snapshot, changedPaths }) => broadcast(snapshot, changedPaths));
            previousUnsubscribe();
            await previousWorkspace?.close();
            await syncReaderInstance(previousRoot);
            broadcast(nextWorkspace.current(), [], true);
        } finally { projectChanging = false; }
    };

    if (options.rootPath) await activateProject(options.rootPath);

    const server = http.createServer(async (request: any, response: any) => {
        try {
            const url = new URL(request.url || '/', 'http://127.0.0.1');

            if (url.pathname.startsWith('/api/lean-')) {
                if (projectChanging) { sendText(response, 409, 'The Reader is changing its bound Lean project. Retry after it finishes.'); return; }
                const origin = request.headers?.origin;
                if (request.headers?.host !== new URL(serverUrl).host || (origin !== undefined && origin !== serverUrl)
                    || request.headers?.['sec-fetch-site'] === 'cross-site') {
                    sendText(response, 403, 'Lean review requires the bound local Reader origin.'); return;
                }
            }

            if (request.method === 'POST' && url.pathname === '/api/projects/pick') {
                const selectedPath = await projects.choose();
                if (selectedPath) await activateProject(selectedPath);
                sendJson(response, 200, await readerStateProjection(workspace, rootPath, projects, requestToken));
                return;
            }

            if (request.method === 'POST' && url.pathname === '/api/projects/recent') {
                const body = await readJsonRequest(request);
                const index = Number(body?.index);
                if (!Number.isInteger(index) || index < 0) {
                    sendText(response, 400, 'Recent project index must be a non-negative integer.');
                    return;
                }
                const recentProjects = await projects.list();
                const selectedProject = recentProjects[index];
                if (!selectedProject) {
                    sendText(response, 404, 'Recent project not found.');
                    return;
                }
                await activateProject(selectedProject.rootPath);
                sendJson(response, 200, await readerStateProjection(workspace, rootPath, projects, requestToken));
                return;
            }

            if (url.pathname === '/api/state') {
                if (request.method !== 'GET') {
                    sendText(response, 405, 'Math Workspace is read-only.');
                    return;
                }
                sendJson(response, 200, await readerStateProjection(workspace, rootPath, projects, requestToken));
                return;
            }

            if (url.pathname === '/api/events') {
                if (request.method !== 'GET') {
                    sendText(response, 405, 'Math Workspace is read-only.');
                    return;
                }
                const snapshot = workspace?.current();
                response.writeHead(200, {
                    'cache-control': 'no-cache',
                    connection: 'keep-alive',
                    'content-type': 'text/event-stream'
                });
                response.write(`event: workspace-update\ndata: ${JSON.stringify({
                    revision: snapshot?.revision || 0,
                    refreshedAt: snapshot?.refreshedAt || '',
                    changedPaths: [],
                    initial: true,
                    projectChanged: !!workspace
                })}\n\n`);
                eventResponses.add(response);
                request.on('close', () => eventResponses.delete(response));
                return;
            }

            if (url.pathname === '/api/open-location') {
                if (request.method !== 'POST') {
                    sendText(response, 405, 'Reader source locations support POST only.');
                    return;
                }
                if (request.headers?.['x-math-workspace-bridge-token'] !== bridgeToken) {
                    sendText(response, 403, 'Reader location bridge token is missing or invalid.');
                    return;
                }
                if (!workspace || !rootPath) {
                    sendText(response, 409, 'Choose a Math Workspace project first.');
                    return;
                }
                const body = await readJsonRequest(request, 8 * 1024);
                const filePath = toPosix(typeof body?.filePath === 'string' ? body.filePath : '').replace(/^\/+/, '');
                const line = body?.line === undefined ? undefined : Number(body.line);
                const column = body?.column === undefined ? undefined : Number(body.column);
                if (!workspace.current().state.pages.some((page: PageData) => page.filePath === filePath)) {
                    sendText(response, 404, 'Markdown page not found in the bound project.');
                    return;
                }
                if ((line !== undefined && (!Number.isInteger(line) || line < 1))
                    || (column !== undefined && (!Number.isInteger(column) || column < 1))) {
                    sendText(response, 400, 'Reader source line and column must be positive integers.');
                    return;
                }
                const delivered = broadcastEvent('reader-navigate', { filePath, line, column });
                sendJson(response, 200, { delivered });
                return;
            }

            if (!workspace || !rootPath) {
                if (url.pathname.startsWith('/api/')) {
                    sendText(response, 409, 'Choose a Math Workspace project first.');
                    return;
                }
                await sendStaticFile(response, staticRoot, url.pathname);
                return;
            }
            const snapshot = workspace.current();

            if (url.pathname === '/api/lean-language/source' || url.pathname === '/api/lean-language/action'
                || url.pathname === '/api/lean-audit' || url.pathname.startsWith('/api/lean-audit/')
                || url.pathname === '/api/lean-assistance' || url.pathname.startsWith('/api/lean-assistance/')) {
                if (!requireRequestToken(request, response, requestToken)) return;
                const boundRoot = rootPath;
                const boundProject = createHash('sha256').update(boundRoot).digest('hex');
                if (request.headers?.['x-math-workspace-project'] !== boundProject) {
                    sendText(response, 409, 'The Lean project changed. Refresh the Reader before retrying.'); return;
                }
                let body: any;
                if (request.method === 'POST') body = await readJsonRequest(request, 128 * 1024);
                if (rootPath !== boundRoot) { sendText(response, 409, 'The Lean project changed while reading the request.'); return; }
                if (url.pathname === '/api/lean-language/source' && request.method === 'GET') {
                    const result = await leanLanguage.source(boundRoot, url.searchParams.get('projectKey'), url.searchParams.get('filePath'));
                    if (rootPath !== boundRoot) { sendText(response, 409, 'The Lean project changed while reading source.'); return; }
                    sendJson(response, 200, result);
                } else if (url.pathname === '/api/lean-language/action' && request.method === 'POST') {
                    const cancel = () => { if (!response.writableEnded && typeof body?.requestId === 'string') leanLanguage.cancel(boundRoot, body.requestId); };
                    request.once('aborted', cancel); response.once('close', cancel);
                    try {
                        const result = await leanLanguage.action(boundRoot, body);
                        if (rootPath !== boundRoot) { sendText(response, 409, 'The Lean project changed while Lean was processing.'); return; }
                        sendJson(response, 200, result);
                    } finally { request.removeListener('aborted', cancel); response.removeListener('close', cancel); }
                } else if (url.pathname === '/api/lean-audit' || url.pathname.startsWith('/api/lean-audit/')) {
                    const result = await handleLeanAuditRoute(leanAudit, boundRoot, request.method, url.pathname, url.searchParams, body);
                    if (rootPath !== boundRoot) { sendText(response, 409, 'The Lean project changed while reading audit data.'); return; }
                    sendJson(response, result.status, result.value);
                } else if (url.pathname === '/api/lean-assistance' || url.pathname.startsWith('/api/lean-assistance/')) {
                    const result = await handleLeanAssistanceRoute(leanAssistance, boundRoot, request.method, url.pathname, url.searchParams, body);
                    if (rootPath !== boundRoot) { sendText(response, 409, 'The Lean project changed while reading assistance data.'); return; }
                    sendJson(response, result.status, result.value);
                } else sendText(response, 405, 'Lean complete source reads use GET; language actions use POST.');
                return;
            }

            if (url.pathname === '/api/lean-review' || url.pathname.startsWith('/api/lean-review/')) {
                if (!requireRequestToken(request, response, requestToken)) return;
                const reviewRoot = rootPath;
                const reviewProject = createHash('sha256').update(reviewRoot).digest('hex');
                const suppliedProject = request.headers?.['x-math-workspace-project'];
                if (suppliedProject !== undefined && suppliedProject !== reviewProject) {
                    sendText(response, 409, 'The review project changed. Refresh the Reader before retrying.');
                    return;
                }
                if (request.method === 'GET') {
                    if (url.pathname === '/api/lean-review') sendJson(response, 200, await leanReview.get(reviewRoot, url.searchParams.get('id')));
                    else if (url.pathname === '/api/lean-review/queue') sendJson(response, 200, await leanReview.queue(reviewRoot, url.searchParams.get('filePath') || ''));
                    else if (url.pathname === '/api/lean-review/definition') sendJson(response, 200, await leanReview.definition(reviewRoot,
                        url.searchParams.get('id'), url.searchParams.get('projectKey') || '', url.searchParams.get('name') || ''));
                    else if (url.pathname === '/api/lean-review/job') sendJson(response, 200, await leanReview.job(reviewRoot, url.searchParams.get('jobId') || ''));
                    else sendText(response, 404, 'Lean review route not found.');
                } else if (request.method === 'POST' && url.pathname === '/api/lean-review/action') {
                    if (suppliedProject !== reviewProject) {
                        sendText(response, 409, 'The review project changed. Refresh the Reader before retrying.');
                        return;
                    }
                    const body = await readJsonRequest(request, 128 * 1024);
                    const result = await leanReview.action(reviewRoot, body);
                    sendJson(response, result.status, result.value);
                } else sendText(response, 405, 'Lean review reads use GET; explicit review actions use POST.');
                return;
            }

            if (url.pathname === '/api/archive' || url.pathname.startsWith('/api/archive/')) {
                if (!requireRequestToken(request, response, requestToken)) return;
                const archiveRoot = rootPath;
                if (request.headers?.['x-math-workspace-project'] !== createHash('sha256').update(archiveRoot).digest('hex')) {
                    sendText(response, 409, 'The bound archive project changed. Refresh the Reader before retrying.');
                    return;
                }
                if (request.method === 'GET') {
                    sendJson(response, 200, await archiveApi.get(archiveRoot, url.pathname, url.searchParams));
                } else if (request.method === 'POST' && url.pathname === '/api/archive/action') {
                    const body = await readJsonRequest(request, 32 * 1024);
                    sendJson(response, 202, await archiveApi.start(archiveRoot, body));
                } else sendText(response, 405, 'Archive reads use GET; explicit actions use POST.');
                return;
            }

            if (url.pathname === '/api/document-state') {
                if (!requireRequestToken(request, response, requestToken)) return;
                if (request.method === 'GET') {
                    sendJson(response, 200, snapshot.state.documentState || { schemaVersion: 1, records: {}, lifecycles: {}, orphaned: [] });
                    return;
                }
                if (request.method === 'POST') {
                    const body = await readJsonRequest(request, 8 * 1024);
                    const documentState = await updateDocumentState(rootPath, snapshot.state.config, snapshot.documents, documentStateInput(body));
                    const refreshed = workspace.applyDocumentState(documentState, [documentState.stateFile]);
                    sendJson(response, 200, { documentState, state: stateProjection(refreshed, rootPath) });
                    return;
                }
                sendText(response, 405, 'Document state supports GET and POST.');
                return;
            }

            if (url.pathname === '/api/symbol-audit' || url.pathname === '/api/symbol-audit/models') {
                if (!requireRequestToken(request, response, requestToken)) return;
                if (url.pathname === '/api/symbol-audit/models') {
                    if (request.method !== 'GET') {
                        sendText(response, 405, 'Symbol audit models support GET only.');
                        return;
                    }
                    sendJson(response, 200, { models: await symbolAudit.models() });
                    return;
                }
                if (request.method === 'GET') {
                    sendJson(response, 200, await symbolAudit.status(rootPath, snapshot));
                    return;
                }
                if (request.method === 'POST') {
                    const body = await readJsonRequest(request, 16 * 1024);
                    const action = typeof body?.action === 'string' ? body.action : '';
                    if (action === 'settings') {
                        const settings = await symbolAudit.updateSettings(rootPath, symbolAuditSettingsInput(body?.settings));
                        sendJson(response, 200, { settings, status: await symbolAudit.status(rootPath, snapshot) });
                        return;
                    }
                    if (action === 'run') {
                        const job = await symbolAudit.start(rootPath, snapshot, body?.force === true);
                        sendJson(response, 202, { job, status: await symbolAudit.status(rootPath, snapshot) });
                        return;
                    }
                    if (action === 'cancel') {
                        const job = await symbolAudit.cancel(rootPath);
                        sendJson(response, 200, { job, status: await symbolAudit.status(rootPath, snapshot) });
                        return;
                    }
                    sendText(response, 400, 'Symbol audit POST needs settings, run, or cancel action.');
                    return;
                }
                sendText(response, 405, 'Symbol audit supports GET and POST.');
                return;
            }

            if (request.method !== 'GET') {
                sendText(response, 405, 'Math Workspace is read-only.');
                return;
            }

            if (url.pathname === '/api/page') {
                const filePath = toPosix(url.searchParams.get('path') || '').replace(/^\/+/, '');
                const content = snapshot.documents.get(filePath);
                if (content === undefined) {
                    sendText(response, 404, 'Markdown page not found in the bound project.');
                    return;
                }
                const rawPage = (snapshot.state.pages || []).find((item: any) => item.filePath === filePath);
                const symbols = findSymbolsInMarkdown(content, snapshot.state.symbols || []).map(match => ({ ...match.symbol, index: match.index }));
                sendJson(response, 200, stripUndefinedFields({
                    revision: snapshot.revision,
                    filePath,
                    page: rawPage ? decoratePage(rawPage, snapshot.state.config, snapshot.state.documentState?.lifecycles?.[filePath]) : undefined,
                    content,
                    labels: labelsForContent(snapshot, [content, ...symbols.map(symbol => symbol.meaning)].join('\n')),
                    dependencyMarkers: projectReaderDependencyMarkers(snapshot.state.dependencyGraph, filePath, snapshot.state.leanIndex),
                    symbols
                }));
                return;
            }

            if (url.pathname === '/api/recall') {
                const id = url.searchParams.get('id') || '';
                const label = snapshot.state.labels?.[id];
                const document = label ? snapshot.documents.get(label.filePath) : undefined;
                const content = label?.content || (label?.type === 'section' && document && label.startLine
                    ? sectionRecallPreview(document, label.startLine)
                    : '');
                if (!label || !content) {
                    sendText(response, 404, 'Recall content not found.');
                    return;
                }
                const pagesByPath = new Map<string, PageData>((snapshot.state.pages || []).map((page: PageData) => [page.filePath, page]));
                sendJson(response, 200, {
                    id,
                    ...label,
                    content,
                    display: displayLabel(label, snapshot.state.config, pagesByPath),
                    labels: labelsForContent(snapshot, content)
                });
                return;
            }

            if (url.pathname === '/api/definition') {
                const definitions = buildRuntimeDefinitions(snapshot.state.definitions || []);
                const index = Number(url.searchParams.get('index'));
                const definition = definitions[index];
                if (!Number.isInteger(index) || !definition) {
                    sendText(response, 404, 'Definition not found.');
                    return;
                }
                sendJson(response, 200, { index, ...definition, labels: labelsForContent(snapshot, definition.content || '') });
                return;
            }

            if (url.pathname === '/api/project-analysis') {
                sendJson(response, 200, snapshot.state.projectAnalysis || { schemaVersion: 1, sources: [], summary: {} });
                return;
            }

            if (url.pathname === '/api/graph') {
                sendJson(response, 200, snapshot.state.dependencyGraph || {});
                return;
            }

            if (url.pathname === '/api/lean') {
                const id = url.searchParams.get('id') || '';
                const anchor = snapshot.state.leanIndex?.anchors?.[id];
                if (!anchor) {
                    sendText(response, 404, 'Lean anchor not found.');
                    return;
                }
                const projectKeys = [...new Set<string>((anchor.declarations || [])
                    .map((declaration: any) => declaration.projectKey)
                    .filter((key: unknown): key is string => typeof key === 'string' && key.length > 0))];
                const [build, dependencies] = await Promise.all([
                    readLeanBuild(rootPath),
                    readLeanDependencyArtifact(rootPath)
                ]);
                const builds = Object.fromEntries(projectKeys
                    .map(key => [key, build?.projects?.[key]])
                    .filter(([, result]) => !!result));
                sendJson(response, 200, stripUndefinedFields({
                    id,
                    formal: anchor.formal,
                    declarations: anchor.declarations,
                    status: anchor.status,
                    ...(Object.keys(builds).length > 0 ? { builds } : {}),
                    ...(dependencies?.comparisons?.[id] ? { comparison: dependencies.comparisons[id] } : {})
                }));
                return;
            }

            if (url.pathname === '/api/figure') {
                await sendInteractiveFigure(response, workspace.rootPath, url.searchParams.get('path') || '', url.searchParams.get('mode') || 'interactive');
                return;
            }

            if (url.pathname === '/api/asset') {
                await sendWorkspaceAsset(response, workspace, url.searchParams.get('path') || '');
                return;
            }

            await sendStaticFile(response, staticRoot, url.pathname);
        } catch (error: any) {
            sendText(response, error instanceof LeanReviewError ? error.status : 500, error instanceof Error ? error.message : String(error));
        }
    });

    const requestedPort = parsePort(options.port === undefined ? undefined : String(options.port));
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(requestedPort, '127.0.0.1', () => {
            server.off?.('error', reject);
            resolve();
        });
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : requestedPort;
    const url = `http://127.0.0.1:${port}`;
    serverUrl = url;
    await syncReaderInstance();

    return {
        get rootPath() {
            return rootPath;
        },
        port,
        url,
        async close() {
            try {
                await unregisterReaderInstance(url, options.locationRegistryPath);
            } catch (_error) {
                // A stale local bridge entry is pruned the next time a location is opened.
            }
            unsubscribe();
            eventResponses.forEach(response => response.end());
            eventResponses.clear();
            await symbolAudit.close();
            await leanLanguage.close();
            await leanReview.close();
            await workspace?.close();
            await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
        }
    };
}
