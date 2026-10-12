import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { mergeConfig, scanFormalDocuments, shouldExcludeScanPath, toPosix } from '@math-workspace/core';
import { isLeanSourcePath, scanLeanWorkspace } from '../lean/lean-index';
import {
    collectionMayContainPath,
    documentCollectionForPath,
    documentStateRelativePath,
    isHardIgnoredDirectory,
    readDocumentState
} from './document-state';

const nodeFs = require('node:fs');
const REFRESH_DELAY_MS = 160;
const SOURCE_EVENT_MAX_ENTRIES = 4096;
const SOURCE_EVENT_MAX_BYTES = 8 * 1024 * 1024;
interface SourceEventBudget { entries: number }
function isLeanReviewMetadataPath(filePath: string): boolean {
    return /^\.math-workspace\/(?:lean-audits|lean-reviews|lean-review-evidence)\/h-[0-9a-f]{16,32}\.json$/i.test(toPosix(filePath));
}

export interface WorkspaceSnapshot {
    revision: number;
    refreshedAt: string;
    state: any;
    documents: Map<string, string>;
}

export interface WorkspaceChange {
    snapshot: WorkspaceSnapshot;
    changedPaths: string[];
}

function pathExists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true, () => false);
}

async function readConfig(rootPath: string): Promise<any> {
    const configPath = path.join(rootPath, '.math-workspace', 'config.json');
    if (!(await pathExists(configPath))) {
        throw new Error('Math Workspace requires .math-workspace/config.json in the project root. Run `math-workspace init` first.');
    }
    return mergeConfig(JSON.parse(await fs.readFile(configPath, 'utf8')));
}

async function collectMarkdownFiles(rootPath: string, config: any, directory = rootPath, files: string[] = [], budget?: SourceEventBudget): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (budget && --budget.entries < 0) throw new Error('Source watcher inspection limit reached.');
        const absolutePath = path.join(directory, entry.name);
        const relativePath = toPosix(path.relative(rootPath, absolutePath));
        if (entry.isDirectory()) {
            if (!shouldExcludeScanPath(relativePath, config)) {
                await collectMarkdownFiles(rootPath, config, absolutePath, files, budget);
            }
            continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !shouldExcludeScanPath(relativePath, config)) {
            files.push(absolutePath);
        }
    }
    return files.sort((left, right) => toPosix(path.relative(rootPath, left)).localeCompare(toPosix(path.relative(rootPath, right))));
}

/**
 * Draft collections are intentionally read outside the normal formal scan.
 * They remain visible in the Reader while contributing no labels, hashes,
 * dependencies, Lean anchors, or audit input.
 */
async function collectDraftMarkdownFiles(rootPath: string, config: any, directory = rootPath, files: string[] = [], budget?: SourceEventBudget): Promise<string[]> {
    const collections = Array.isArray(config?.documents?.collections) ? config.documents.collections : [];
    if (!collections.length) return files;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (budget && --budget.entries < 0) throw new Error('Source watcher inspection limit reached.');
        if (entry.isDirectory() && isHardIgnoredDirectory(entry.name)) continue;
        const absolutePath = path.join(directory, entry.name);
        const relativePath = toPosix(path.relative(rootPath, absolutePath));
        if (entry.isDirectory()) {
            const collectionCouldContain = collections.some((collection: any) => collectionMayContainPath(relativePath, collection));
            if (collectionCouldContain || !shouldExcludeScanPath(relativePath, config)) {
                await collectDraftMarkdownFiles(rootPath, config, absolutePath, files, budget);
            }
            continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && documentCollectionForPath(relativePath, config)) {
            files.push(absolutePath);
        }
    }
    return files.sort((left, right) => toPosix(path.relative(rootPath, left)).localeCompare(toPosix(path.relative(rootPath, right))));
}

function draftTitle(content: string, filePath: string): string {
    const heading = content.split(/\r?\n/).find(line => /^\s{0,3}#\s+/.test(line));
    if (heading) return heading.replace(/^\s{0,3}#\s+/, '').trim();
    return path.posix.basename(filePath).replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim() || filePath;
}

async function readIndex(rootPath: string, name: 'definitions' | 'symbols'): Promise<unknown> {
    try {
        return JSON.parse(await fs.readFile(path.join(rootPath, '.math-workspace', `${name}.json`), 'utf8'));
    } catch (error: any) {
        if (error?.code === 'ENOENT') return undefined;
        throw error;
    }
}

/** Produce the Reader/MCP scan without generating or modifying source documents. */
export async function loadWorkspaceSnapshot(rootPath: string, revision = 1): Promise<WorkspaceSnapshot> {
    const resolvedRoot = path.resolve(rootPath);
    const config = await readConfig(resolvedRoot);
    const [formalFiles, draftFiles] = await Promise.all([
        collectMarkdownFiles(resolvedRoot, config),
        collectDraftMarkdownFiles(resolvedRoot, config)
    ]);
    const formalDocuments = await Promise.all(formalFiles.map(async absolutePath => ({
        filePath: toPosix(path.relative(resolvedRoot, absolutePath)),
        content: await fs.readFile(absolutePath, 'utf8')
    })));
    const draftDocuments = await Promise.all(draftFiles.map(async absolutePath => ({
        filePath: toPosix(path.relative(resolvedRoot, absolutePath)),
        content: await fs.readFile(absolutePath, 'utf8')
    })));
    const documents = [...formalDocuments, ...draftDocuments]
        .sort((left, right) => left.filePath.localeCompare(right.filePath));
    const [definitions, symbols] = await Promise.all([
        readIndex(resolvedRoot, 'definitions'),
        readIndex(resolvedRoot, 'symbols')
    ]);
    const formalState = scanFormalDocuments(formalDocuments, config, symbols, definitions);
    formalState.pages.forEach(page => { page.documentMode = 'formal'; });
    const draftPages = draftDocuments.map((document, order) => {
        const collection = documentCollectionForPath(document.filePath, config);
        return {
            kind: 'draft',
            filePath: document.filePath,
            title: draftTitle(document.content, document.filePath),
            order,
            documentMode: 'draft' as const,
            documentCollectionId: collection?.id,
            documentCollectionTitle: collection?.title
        };
    });
    formalState.pages.push(...draftPages);
    formalState.pages.sort((left, right) => left.filePath.localeCompare(right.filePath));
    const leanIndex = await scanLeanWorkspace(resolvedRoot, config, formalState.labels, formalState.dependencyGraph);
    formalState.issues.push(...leanIndex.diagnostics.map(diagnostic => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        file: diagnostic.file,
        line: diagnostic.line,
        message: diagnostic.message
    })));
    return {
        revision,
        refreshedAt: new Date().toISOString(),
        state: {
            ...formalState,
            leanIndex,
            documentState: await readDocumentState(resolvedRoot, config, new Map(documents.map(document => [document.filePath, document.content])))
        },
        documents: new Map(documents.map(document => [document.filePath, document.content]))
    };
}

export class ReaderWorkspace {
    private snapshot: WorkspaceSnapshot | undefined;
    private watcher: any;
    private refreshTimer: any;
    private metadataTimer: any;
    private refreshing = false;
    private closed = false;
    private refreshQueued = false;
    private readonly listeners = new Set<(change: WorkspaceChange) => void>();
    private readonly pendingChangedPaths = new Set<string>();
    private readonly pendingMetadataPaths = new Set<string>();

    constructor(readonly rootPath: string) {}

    async start(): Promise<void> {
        this.closed = false;
        await this.refresh();
        this.watcher = nodeFs.watch(this.rootPath, { recursive: true }, (_event: string, fileName: any) => {
            const relativePath = typeof fileName === 'string' ? toPosix(fileName) : '';
            if (isLeanReviewMetadataPath(relativePath)) {
                if (this.pendingMetadataPaths.size < 256) this.pendingMetadataPaths.add(relativePath);
                if (this.metadataTimer) clearTimeout(this.metadataTimer);
                this.metadataTimer = setTimeout(() => {
                    this.metadataTimer = undefined;
                    const changedPaths = [...this.pendingMetadataPaths].sort(); this.pendingMetadataPaths.clear();
                    this.notifyMetadataChange(changedPaths);
                }, REFRESH_DELAY_MS);
                return;
            }
            const stateFile = documentStateRelativePath(this.snapshot?.state.config || mergeConfig({}));
            if (relativePath && relativePath === stateFile) {
                void this.refreshDocumentState(relativePath).catch(error => console.error(`[math-workspace] Document state refresh failed: ${error.message || error}`));
                return;
            }
            if (relativePath && !this.shouldRefresh(relativePath)) return;
            void this.sourcePathChanged(relativePath).then(changed => {
                if (changed && !this.closed) this.scheduleRefresh(relativePath);
            }).catch(() => { if (!this.closed) this.scheduleRefresh(relativePath); });
        });
        this.watcher.on?.('error', (error: Error) => {
            console.warn(`[math-workspace] Math Workspace watcher error: ${error.message}`);
        });
    }

    async close(): Promise<void> {
        this.closed = true;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        if (this.metadataTimer) clearTimeout(this.metadataTimer);
        this.refreshTimer = undefined;
        this.metadataTimer = undefined; this.pendingMetadataPaths.clear();
        this.watcher?.close?.();
        this.listeners.clear();
    }

    onChange(listener: (change: WorkspaceChange) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    current(): WorkspaceSnapshot {
        if (!this.snapshot) throw new Error('Math Workspace is not ready.');
        return this.snapshot;
    }

    async reload(): Promise<WorkspaceSnapshot> {
        await this.refresh();
        return this.current();
    }

    applyDocumentState(documentState: any, changedPaths: string[] = []): WorkspaceSnapshot {
        const current = this.current();
        const snapshot: WorkspaceSnapshot = {
            ...current,
            revision: current.revision + 1,
            refreshedAt: new Date().toISOString(),
            state: { ...current.state, documentState }
        };
        this.snapshot = snapshot;
        this.listeners.forEach(listener => listener({ snapshot, changedPaths }));
        return snapshot;
    }

    /** Human review metadata lives in its own store. Notify controllers to reload it while
     * retaining the scanned source, document maps and Lean index byte-for-byte. */
    notifyMetadataChange(changedPaths: string[]): WorkspaceSnapshot {
        const paths = [...new Set(changedPaths.filter(isLeanReviewMetadataPath))].slice(0, 256).sort();
        const current = this.current();
        if (!paths.length) return current;
        const snapshot: WorkspaceSnapshot = { ...current, revision: current.revision + 1, refreshedAt: new Date().toISOString() };
        this.snapshot = snapshot;
        this.listeners.forEach(listener => listener({ snapshot, changedPaths: paths }));
        return snapshot;
    }

    private async refreshDocumentState(filePath: string): Promise<void> {
        const current = this.current();
        const documentState = await readDocumentState(this.rootPath, current.state.config, current.documents);
        this.applyDocumentState(documentState, [filePath]);
    }

    private scheduleRefresh(filePath = ''): void {
        if (filePath) this.pendingChangedPaths.add(filePath.replace(/^\/+/, ''));
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refresh().catch(error => console.error(`[math-workspace] Math Workspace refresh failed: ${error.message || error}`));
        }, REFRESH_DELAY_MS);
    }

    /** FSEvents may deliver pre-watch source creation events together with a later metadata
     * write. Compare the affected inputs to the current snapshot before parsing them again.
     * Unknown, oversized and genuine source changes keep the conservative refresh path. */
    private async sourcePathChanged(filePath: string): Promise<boolean> {
        const normalized = toPosix(filePath).replace(/^\/+/, '');
        if (!normalized || !this.snapshot) return true;
        if (isLeanSourcePath(this.snapshot.state.config, normalized)) return true;
        const candidate = path.resolve(this.rootPath, normalized);
        if (normalized === '.math-workspace/config.json') {
            const stat = await fs.stat(candidate);
            if (stat.size > SOURCE_EVENT_MAX_BYTES) return true;
            const config = mergeConfig(JSON.parse(await fs.readFile(candidate, 'utf8')));
            return JSON.stringify(config) !== JSON.stringify(this.current().state.config);
        }
        if (this.snapshot.documents.has(normalized)) {
            const stat = await require('node:fs/promises').lstat(candidate);
            if (!stat.isFile() || stat.size > SOURCE_EVENT_MAX_BYTES) return true;
            const content = await fs.readFile(candidate, 'utf8');
            return content !== this.current().documents.get(normalized);
        }
        let stat: any, directory = candidate, prefix = normalized + '/';
        if (normalized === path.basename(this.rootPath)) {
            // A root-directory event uses the basename, and can coalesce actual top-level
            // additions/deletions. Establish that its Markdown tree is unchanged as well.
            // Lean projects retain a conservative scan since their text is not in documents.
            if (this.current().state.config?.lean?.projects?.length) return true;
            if (await this.sourcePathChanged('.math-workspace/config.json')) return true;
            directory = this.rootPath; prefix = '';
            stat = await require('node:fs/promises').lstat(directory);
        } else {
            try { stat = await require('node:fs/promises').lstat(candidate); }
            catch (_error) { return true; }
        }
        if (!stat.isDirectory() || isLeanSourcePath(this.snapshot.state.config, normalized + '/source.lean')) return true;
        const config = this.snapshot.state.config, budget = { entries: SOURCE_EVENT_MAX_ENTRIES };
        const files = [...new Set([
            ...await collectMarkdownFiles(this.rootPath, config, directory, [], budget),
            ...await collectDraftMarkdownFiles(this.rootPath, config, directory, [], budget)
        ])];
        const current = this.current();
        const expected = [...current.documents.keys()].filter(key => key.startsWith(prefix));
        if (files.length !== expected.length) return true;
        let bytes = 0;
        for (const file of files) {
            const relative = toPosix(path.relative(this.rootPath, file));
            if (!this.current().documents.has(relative)) return true;
            bytes += (await fs.stat(file)).size;
            if (bytes > SOURCE_EVENT_MAX_BYTES) return true;
            if (await fs.readFile(file, 'utf8') !== this.current().documents.get(relative)) return true;
        }
        return config !== this.current().state.config;
    }

    private shouldRefresh(filePath: string): boolean {
        const normalized = toPosix(filePath).replace(/^\/+/, '');
        if (!normalized) return true;
        if (normalized === '.math-workspace/config.json') return true;
        if (normalized === '.math-workspace/definitions.json') return true;
        if (normalized === '.math-workspace/symbols.json') return true;
        if (normalized === '.math-workspace/lean-build.json') return true;
        if (normalized === '.math-workspace/lean-contracts.json') return true;
        if (normalized === '.math-workspace/lean-dependency-graph.json') return true;
        if (normalized === documentStateRelativePath(this.snapshot?.state.config || mergeConfig({}))) return true;
        if (normalized === '.math-workspace' || normalized.startsWith('.math-workspace/')) return false;
        if (isLeanSourcePath(this.snapshot?.state.config || mergeConfig({}), normalized)) return true;
        return !shouldExcludeScanPath(normalized, this.snapshot?.state.config || mergeConfig({}));
    }

    private async refresh(): Promise<void> {
        if (this.refreshing) {
            this.refreshQueued = true;
            return;
        }
        this.refreshing = true;
        try {
            do {
                this.refreshQueued = false;
                const changedPaths = Array.from(this.pendingChangedPaths).sort();
                this.pendingChangedPaths.clear();
                const refreshed = await loadWorkspaceSnapshot(this.rootPath, (this.snapshot?.revision || 0) + 1);
                // A metadata-only notification may have advanced the revision during this scan.
                refreshed.revision = (this.snapshot?.revision || 0) + 1;
                this.snapshot = refreshed;
                this.listeners.forEach(listener => listener({ snapshot: this.snapshot as WorkspaceSnapshot, changedPaths }));
            } while (this.refreshQueued);
        } finally {
            this.refreshing = false;
        }
    }
}
