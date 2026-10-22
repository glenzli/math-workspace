import { normalizeLatexSymbol } from '@math-workspace/core';
import type { WorkspaceSnapshot } from './workspace';
import {
    CodexSymbolAuditRunner,
    type CodexSymbolAuditActivity,
    type CodexSymbolAuditModel,
    type CodexSymbolAuditTokenUsage
} from './codex-symbol-audit';
import {
    createSymbolAuditExtraction,
    createSymbolAuditReport,
    sha256,
    symbolAuditExtractionCacheKey,
    symbolAuditReportCacheKey,
    SymbolAuditStore,
    type SymbolAuditExtraction,
    type SymbolAuditReport,
    type SymbolAuditBinding,
    type SymbolAuditScope,
    type SymbolAuditSettings,
    type SymbolAuditSource
} from './symbol-audit';

export interface SymbolAuditJobStatus {
    id: string;
    status: 'running' | 'complete' | 'failed' | 'cancelled';
    startedAt: string;
    completedAt?: string;
    totalFiles: number;
    completedFiles: number;
    scannedFiles: number;
    reusedFiles: number;
    /** Number of ephemeral Codex tasks invoked by this audit run. */
    modelCalls: number;
    /** Calls for which app-server supplied an exact usage record. */
    tokenUsageReportedCalls: number;
    /** Exact app-server usage accumulated for this run, when available. */
    tokenUsage?: CodexSymbolAuditTokenUsage;
    currentFilePath?: string;
    activity?: CodexSymbolAuditActivity | 'saving-result' | 'comparing-conflicts' | 'reviewing-candidates' | 'finalizing-report';
    activityAt?: string;
    error?: string;
}

export interface SymbolAuditStatus {
    settings: SymbolAuditSettings;
    cache: {
        totalFiles: number;
        reusableFiles: number;
        missingFiles: number;
    };
    scope: {
        selectedFilePaths: string[];
        pages: Array<{ filePath: string; title: string; groupId: string }>;
        groups: Array<{ id: string; label: string; filePaths: string[] }>;
        externalSpecialBindingCount: number;
    };
    reportState: 'none' | 'current' | 'stale';
    report?: SymbolAuditReport;
    job?: SymbolAuditJobStatus;
}

interface ActiveJob extends SymbolAuditJobStatus {
    rootPath: string;
    settings: SymbolAuditSettings;
    cancelled: boolean;
}

function cleanError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || 'Unknown audit error.');
    return message.replace(/\s+/g, ' ').trim().slice(0, 720);
}

function addTokenUsage(
    accumulated: CodexSymbolAuditTokenUsage | undefined,
    reported: CodexSymbolAuditTokenUsage | undefined
): CodexSymbolAuditTokenUsage | undefined {
    if (!reported) return accumulated;
    const base = accumulated || {
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0
    };
    return {
        totalTokens: base.totalTokens + reported.totalTokens,
        inputTokens: base.inputTokens + reported.inputTokens,
        cachedInputTokens: base.cachedInputTokens + reported.cachedInputTokens,
        cacheWriteInputTokens: base.cacheWriteInputTokens + reported.cacheWriteInputTokens,
        outputTokens: base.outputTokens + reported.outputTokens,
        reasoningOutputTokens: base.reasoningOutputTokens + reported.reasoningOutputTokens
    };
}

function sourceForFile(snapshot: WorkspaceSnapshot, filePath: string, content: string): SymbolAuditSource {
    const registeredSymbols = (snapshot.state.symbols || [])
        .filter((symbol: any) => symbol?.sourceFilePath === filePath)
        .map((symbol: any) => ({
            pattern: String(symbol.pattern || ''),
            display: String(symbol.display || ''),
            meaning: String(symbol.meaning || ''),
            scope: String(symbol.scope || 'book'),
            ...(Number.isInteger(symbol.sourceLine) ? { sourceLine: symbol.sourceLine } : {})
        }));
    return { filePath, content, registeredSymbols };
}

function allSourcesForSnapshot(snapshot: WorkspaceSnapshot): SymbolAuditSource[] {
    const publishedPages = new Set((snapshot.state.pages || [])
        .map((page: any) => String(page?.filePath || ''))
        .filter(Boolean));
    return Array.from(snapshot.documents.entries())
        .filter(([filePath]) => filePath.toLowerCase().endsWith('.md') && (!publishedPages.size || publishedPages.has(filePath)))
        .map(([filePath, content]) => sourceForFile(snapshot, filePath, content));
}

function commonPathSegmentCount(filePaths: string[]): number {
    if (!filePaths.length) return 0;
    const paths = filePaths.map(filePath => filePath.split('/'));
    let index = 0;
    while (paths.every(parts => parts[index] && parts[index] === paths[0][index])) index++;
    return Math.max(0, index);
}

function scopeCatalog(snapshot: WorkspaceSnapshot, sources: SymbolAuditSource[]): {
    pages: Array<{ filePath: string; title: string; groupId: string }>;
    groups: Array<{ id: string; label: string; filePaths: string[] }>;
} {
    const commonSegments = commonPathSegmentCount(sources.map(source => source.filePath));
    const pagesByPath = new Map<string, any>((snapshot.state.pages || []).map((page: any): [string, any] => [String(page.filePath || ''), page]));
    const pages = sources.map(source => {
        const parts = source.filePath.split('/');
        const groupId = parts.slice(0, Math.min(parts.length - 1, commonSegments + 1)).join('/') || parts.slice(0, -1).join('/') || source.filePath;
        const page = pagesByPath.get(source.filePath);
        return {
            filePath: source.filePath,
            title: String(page?.displayHeading || page?.title || source.filePath),
            groupId
        };
    }).sort((left, right) => left.filePath.localeCompare(right.filePath));
    const groups = Array.from(pages.reduce((result, page) => {
        const group = result.get(page.groupId) || { id: page.groupId, label: page.groupId.split('/').pop() || page.groupId, filePaths: [] };
        group.filePaths.push(page.filePath);
        result.set(page.groupId, group);
        return result;
    }, new Map<string, { id: string; label: string; filePaths: string[] }>() ).values())
        .map(group => ({ ...group, filePaths: group.filePaths.sort() }))
        .sort((left, right) => left.id.localeCompare(right.id));
    return { pages, groups };
}

function sourcesForScope(sources: SymbolAuditSource[], catalog: ReturnType<typeof scopeCatalog>, scope: SymbolAuditScope | undefined): SymbolAuditSource[] {
    if (!scope || scope.kind === 'all') return sources;
    if (scope.kind === 'volume') {
        const selected = new Set(catalog.groups.find(group => group.id === scope.groupId)?.filePaths || []);
        return sources.filter(source => selected.has(source.filePath));
    }
    const selected = new Set(scope.filePaths);
    return sources.filter(source => selected.has(source.filePath));
}

function externalRegisteredSpecialBindings(snapshot: WorkspaceSnapshot, selectedFilePaths: Set<string>): SymbolAuditBinding[] {
    const symbols = Array.isArray(snapshot.state.symbols) ? snapshot.state.symbols : [];
    return symbols.flatMap((symbol: any) => {
        const filePath = String(symbol?.sourceFilePath || '').trim();
        if (filePath && selectedFilePaths.has(filePath)) return [];
        const expression = String(symbol?.pattern || symbol?.display || '').replace(/^\$+|\$+$/g, '').trim();
        const normalizedExpression = expression ? normalizeLatexSymbol(expression) : '';
        const meaning = String(symbol?.meaning || '').trim();
        if (!normalizedExpression || !meaning) return [];
        const sourceLine = Number.isInteger(symbol?.sourceLine) && symbol.sourceLine > 0 ? symbol.sourceLine : 1;
        const sourcePath = filePath || '.math-workspace/symbols.json';
        const bindingKey = 'registered-special-' + sha256(`${normalizedExpression}:${meaning}`).slice(0, 24);
        return [{
            id: 'registered:' + sha256(`${sourcePath}:${sourceLine}:${bindingKey}`).slice(0, 24),
            filePath: sourcePath,
            startLine: sourceLine,
            endLine: sourceLine,
            expression,
            normalizedExpression,
            structure: { base: expression, modifiers: [] },
            kind: 'special' as const,
            scope: 'book' as const,
            bindingKey,
            semanticType: 'registered-special',
            meaning,
            evidence: 'Maintained special-symbol index.',
            confidence: 'high' as const
        }];
    });
}

function currentReportKey(sources: SymbolAuditSource[], settings: SymbolAuditSettings, comparisonBindings: SymbolAuditBinding[]): string {
    return symbolAuditReportCacheKey(sources.map(source => ({
        filePath: source.filePath,
        cacheKey: symbolAuditExtractionCacheKey(source.filePath, sha256(source.content), settings)
    })), settings, comparisonBindings);
}

/**
 * Owns an explicit, one-project-at-a-time audit job. Workspace refreshes only
 * change the cache eligibility reported to the user; they never start a model
 * turn on their own.
 */
export class SymbolAuditService {
    private readonly store: SymbolAuditStore;
    private readonly runner: CodexSymbolAuditRunner;
    private active: ActiveJob | undefined;
    private lastJob: ActiveJob | undefined;

    constructor(options: { store?: SymbolAuditStore; runner?: CodexSymbolAuditRunner } = {}) {
        this.store = options.store || new SymbolAuditStore();
        this.runner = options.runner || new CodexSymbolAuditRunner();
    }

    async status(rootPath: string, snapshot: WorkspaceSnapshot): Promise<SymbolAuditStatus> {
        const status = await readSymbolAuditStatus(rootPath, snapshot, this.store);
        const job = this.active?.rootPath === rootPath ? this.active : this.lastJob?.rootPath === rootPath ? this.lastJob : undefined;
        return {
            ...status,
            ...(job ? { job: this.publicJob(job) } : {})
        };
    }

    async updateSettings(rootPath: string, settings: SymbolAuditSettings): Promise<SymbolAuditSettings> {
        if (this.active?.rootPath === rootPath) throw new Error('Wait for the active symbol audit before changing its settings.');
        return this.store.updateSettings(rootPath, settings);
    }

    async models(): Promise<CodexSymbolAuditModel[]> {
        return this.runner.listModels();
    }

    async start(rootPath: string, snapshot: WorkspaceSnapshot, force = false): Promise<SymbolAuditJobStatus> {
        if (this.active) throw new Error('A symbol audit is already in progress.');
        const project = await this.store.project(rootPath);
        const allSources = allSourcesForSnapshot(snapshot);
        const catalog = scopeCatalog(snapshot, allSources);
        const sources = sourcesForScope(allSources, catalog, project.settings.scope);
        if (!sources.length) throw new Error('The selected symbol-audit scope does not contain a current Markdown page.');
        const externalSpecialBindings = externalRegisteredSpecialBindings(snapshot, new Set(sources.map(source => source.filePath)));
        const job: ActiveJob = {
            id: 'mwaudit_' + sha256(`${rootPath}:${Date.now()}:${Math.random()}`).slice(0, 16),
            rootPath,
            settings: project.settings,
            status: 'running',
            startedAt: new Date().toISOString(),
            totalFiles: sources.length,
            completedFiles: 0,
            scannedFiles: 0,
            reusedFiles: 0,
            modelCalls: 0,
            tokenUsageReportedCalls: 0,
            cancelled: false
        };
        this.active = job;
        this.lastJob = job;
        void this.run(job, sources, externalSpecialBindings, project.extractions, force, allSources);
        return this.publicJob(job);
    }

    async cancel(rootPath: string): Promise<SymbolAuditJobStatus | undefined> {
        const job = this.active;
        if (!job || job.rootPath !== rootPath) return undefined;
        job.cancelled = true;
        await this.runner.interrupt();
        return this.publicJob(job);
    }

    async close(): Promise<void> {
        await this.runner.close();
    }

    private async run(
        job: ActiveJob,
        sources: SymbolAuditSource[],
        externalSpecialBindings: SymbolAuditBinding[],
        cachedExtractions: Record<string, SymbolAuditExtraction>,
        force: boolean,
        contextSources: SymbolAuditSource[]
    ): Promise<void> {
        try {
            const noteActivity = (activity: SymbolAuditJobStatus['activity']) => {
                job.activity = activity;
                job.activityAt = new Date().toISOString();
            };
            const extractions: SymbolAuditExtraction[] = [];
            for (const source of sources) {
                if (job.cancelled) throw new Error('Symbol audit was cancelled.');
                job.currentFilePath = source.filePath;
                const sourceHash = sha256(source.content);
                const cacheKey = symbolAuditExtractionCacheKey(source.filePath, sourceHash, job.settings);
                const cached = !force ? cachedExtractions[cacheKey] : undefined;
                if (cached) {
                    extractions.push(cached);
                    job.reusedFiles++;
                    job.completedFiles++;
                    continue;
                }
                job.modelCalls++;
                const result = await this.runner.extract(job.rootPath, source, job.settings, noteActivity);
                if (result.tokenUsage) {
                    job.tokenUsage = addTokenUsage(job.tokenUsage, result.tokenUsage);
                    job.tokenUsageReportedCalls++;
                }
                if (job.cancelled) throw new Error('Symbol audit was cancelled.');
                noteActivity('saving-result');
                const extraction = createSymbolAuditExtraction(source, job.settings, result.bindings);
                await this.store.saveExtraction(job.rootPath, extraction);
                extractions.push(extraction);
                job.scannedFiles++;
                job.completedFiles++;
            }

            if (job.cancelled) throw new Error('Symbol audit was cancelled.');
            job.currentFilePath = undefined;
            noteActivity('comparing-conflicts');
            const reportKey = symbolAuditReportCacheKey(extractions, job.settings, externalSpecialBindings);
            const project = await this.store.project(job.rootPath);
            const cachedReport = !force ? project.reports[reportKey] : undefined;
            if (!cachedReport) {
                const preliminary = createSymbolAuditReport(extractions, job.settings, job.scannedFiles, job.reusedFiles, [], externalSpecialBindings);
                if (preliminary.candidates.length) {
                    noteActivity('reviewing-candidates');
                    job.modelCalls++;
                }
                const reconciliationResult = await this.runner.reconcileCandidates(job.rootPath, preliminary.candidates, job.settings, noteActivity, contextSources);
                if (reconciliationResult.tokenUsage) {
                    job.tokenUsage = addTokenUsage(job.tokenUsage, reconciliationResult.tokenUsage);
                    job.tokenUsageReportedCalls++;
                }
                if (job.cancelled) throw new Error('Symbol audit was cancelled.');
                noteActivity('finalizing-report');
                const report = createSymbolAuditReport(extractions, job.settings, job.scannedFiles, job.reusedFiles, reconciliationResult.reconciliations, externalSpecialBindings);
                await this.store.saveReport(job.rootPath, report);
            } else {
                noteActivity('finalizing-report');
            }
            job.status = 'complete';
            job.completedAt = new Date().toISOString();
        } catch (error) {
            job.status = job.cancelled ? 'cancelled' : 'failed';
            job.error = cleanError(error);
            job.completedAt = new Date().toISOString();
        } finally {
            job.currentFilePath = undefined;
            if (this.active === job) this.active = undefined;
        }
    }

    private publicJob(job: ActiveJob): SymbolAuditJobStatus {
        const { rootPath: _rootPath, settings: _settings, cancelled: _cancelled, ...status } = job;
        return status;
    }
}

/** Read cached audit state without creating a Codex bridge or starting model work. */
export async function readSymbolAuditStatus(
    rootPath: string,
    snapshot: WorkspaceSnapshot,
    store = new SymbolAuditStore()
): Promise<SymbolAuditStatus> {
    const project = await store.project(rootPath);
    const allSources = allSourcesForSnapshot(snapshot);
    const catalog = scopeCatalog(snapshot, allSources);
    const sources = sourcesForScope(allSources, catalog, project.settings.scope);
    const externalSpecialBindings = externalRegisteredSpecialBindings(snapshot, new Set(sources.map(source => source.filePath)));
    const reusableFiles = sources.filter(source => (
        !!project.extractions[symbolAuditExtractionCacheKey(source.filePath, sha256(source.content), project.settings)]
    )).length;
    const key = currentReportKey(sources, project.settings, externalSpecialBindings);
    const report = project.reports[key] || (project.latestReportKey ? project.reports[project.latestReportKey] : undefined);
    const reportState: SymbolAuditStatus['reportState'] = !report
        ? 'none'
        : project.reports[key] ? 'current' : 'stale';
    return {
        settings: project.settings,
        cache: {
            totalFiles: sources.length,
            reusableFiles,
            missingFiles: sources.length - reusableFiles
        },
        scope: {
            selectedFilePaths: sources.map(source => source.filePath),
            pages: catalog.pages,
            groups: catalog.groups,
            externalSpecialBindingCount: externalSpecialBindings.length
        },
        reportState,
        ...(report ? { report } : {})
    };
}
