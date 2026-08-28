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

async function collectMarkdownFiles(rootPath: string, config: any, directory = rootPath, files: string[] = []): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        const relativePath = toPosix(path.relative(rootPath, absolutePath));
        if (entry.isDirectory()) {
            if (!shouldExcludeScanPath(relativePath, config)) {
                await collectMarkdownFiles(rootPath, config, absolutePath, files);
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
async function collectDraftMarkdownFiles(rootPath: string, config: any, directory = rootPath, files: string[] = []): Promise<string[]> {
    const collections = Array.isArray(config?.documents?.collections) ? config.documents.collections : [];
    if (!collections.length) return files;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory() && isHardIgnoredDirectory(entry.name)) continue;
        const absolutePath = path.join(directory, entry.name);
        const relativePath = toPosix(path.relative(rootPath, absolutePath));
        if (entry.isDirectory()) {
            const collectionCouldContain = collections.some((collection: any) => collectionMayContainPath(relativePath, collection));
            if (collectionCouldContain || !shouldExcludeScanPath(relativePath, config)) {
                await collectDraftMarkdownFiles(rootPath, config, absolutePath, files);
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
    private refreshing = false;
    private refreshQueued = false;
    private readonly listeners = new Set<(change: WorkspaceChange) => void>();
    private readonly pendingChangedPaths = new Set<string>();

    constructor(readonly rootPath: string) {}

    async start(): Promise<void> {
        await this.refresh();
        this.watcher = nodeFs.watch(this.rootPath, { recursive: true }, (_event: string, fileName: any) => {
            const relativePath = typeof fileName === 'string' ? toPosix(fileName) : '';
            const stateFile = documentStateRelativePath(this.snapshot?.state.config || mergeConfig({}));
            if (relativePath && relativePath === stateFile) {
                void this.refreshDocumentState(relativePath).catch(error => console.error(`[math-workspace] Document state refresh failed: ${error.message || error}`));
                return;
            }
            if (relativePath && !this.shouldRefresh(relativePath)) return;
            this.scheduleRefresh(relativePath);
        });
        this.watcher.on?.('error', (error: Error) => {
            console.warn(`[math-workspace] Math Workspace watcher error: ${error.message}`);
        });
    }

    async close(): Promise<void> {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
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
        if (normalized.startsWith('.math-workspace/')) return false;
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
                this.snapshot = await loadWorkspaceSnapshot(this.rootPath, (this.snapshot?.revision || 0) + 1);
                this.listeners.forEach(listener => listener({ snapshot: this.snapshot as WorkspaceSnapshot, changedPaths }));
            } while (this.refreshQueued);
        } finally {
            this.refreshing = false;
        }
    }
}
