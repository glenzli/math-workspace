import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { buildRuntimeDefinitions, formatDisplayNumber, type LabelData, type PageData } from '@math-workspace/core';
import { findMathWorkspaceRoot } from '../project-root';
import { readLeanBuild } from '../lean/lean-state';
import { readLeanDependencyArtifact } from '../lean/lean-dependencies';
import { ReaderDiscussionMarkStore } from '../reader/discussion-marks';
import { loadWorkspaceSnapshot, type WorkspaceSnapshot } from '../reader/workspace';
import { readSymbolAuditStatus } from '../reader/symbol-audit-service';
import { SymbolAuditStore, type SymbolAuditBinding } from '../reader/symbol-audit';

const VERIFY_BLOCKING_WARNING_CODES = new Set([
    'non-hash-id',
    'formal-marker-outside-numbered-file',
    'duplicate-special-page',
    'definition-content-missing',
    'definition-content-stale'
]);
const MAX_SOURCE_CHARS = 14_000;
const MAX_GRAPH_NODES = 72;

export interface WorkspaceQueryOptions {
    rootPath?: string;
    discussionMarksPath?: string;
    symbolAuditStatePath?: string;
}

function normalizeFormalId(value: string): string {
    return value.trim().replace(/^[@#]/, '');
}

function excerpt(value: string | undefined): { value: string; truncated: boolean } {
    const source = String(value || '');
    return source.length <= MAX_SOURCE_CHARS
        ? { value: source, truncated: false }
        : { value: `${source.slice(0, MAX_SOURCE_CHARS)}\n\n… [truncated by Math Workspace]`, truncated: true };
}

function sourceHash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function display(label: LabelData): string {
    const number = formatDisplayNumber(label);
    return number ? `${label.type} ${number}` : label.type;
}

function pageFor(snapshot: WorkspaceSnapshot, filePath: string): PageData | undefined {
    return (snapshot.state.pages || []).find((page: PageData) => page.filePath === filePath);
}

function nodeSummary(snapshot: WorkspaceSnapshot, id: string): Record<string, unknown> {
    const graphNode = (snapshot.state.dependencyGraph?.nodes || []).find((node: any) => node.id === id);
    const label = snapshot.state.labels?.[id] as LabelData | undefined;
    if (graphNode) return {
        id,
        display: graphNode.display,
        type: graphNode.kind,
        title: graphNode.title,
        filePath: graphNode.path,
        line: graphNode.line
    };
    if (label) return {
        id,
        display: display(label),
        type: label.type,
        title: label.title,
        filePath: label.filePath,
        line: (label.startLine || 0) + 1
    };
    return { id };
}

function normalizedSearch(value: unknown): string {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function preview(value: unknown, maximum = 480): string {
    const compact = String(value || '').replace(/\s+/g, ' ').trim();
    return compact.length <= maximum ? compact : compact.slice(0, maximum) + '…';
}

function matchScore(query: string, primary: unknown[], secondary: unknown[] = []): number | undefined {
    const primaryValues = primary.map(normalizedSearch).filter(Boolean);
    const secondaryValues = secondary.map(normalizedSearch).filter(Boolean);
    if (primaryValues.some(value => value === query)) return 0;
    if (primaryValues.some(value => value.startsWith(query))) return 1;
    if (primaryValues.some(value => value.includes(query))) return 2;
    if (secondaryValues.some(value => value.includes(query))) return 3;
    return undefined;
}

function auditBinding(binding: SymbolAuditBinding): Record<string, unknown> {
    return {
        expression: binding.expression,
        kind: binding.kind,
        scope: binding.scope,
        meaning: binding.meaning,
        evidence: binding.evidence,
        confidence: binding.confidence,
        filePath: binding.filePath,
        startLine: binding.startLine,
        endLine: binding.endLine
    };
}

export class WorkspaceQueries {
    private readonly discussionMarks: ReaderDiscussionMarkStore;
    private readonly symbolAudit: SymbolAuditStore;

    constructor(private readonly options: WorkspaceQueryOptions = {}) {
        this.discussionMarks = new ReaderDiscussionMarkStore({ stateFilePath: options.discussionMarksPath });
        this.symbolAudit = new SymbolAuditStore({ stateFilePath: options.symbolAuditStatePath });
    }

    async discussionMarksGet(projectRoot?: string): Promise<Record<string, unknown>> {
        const rootPath = await this.resolveRoot(projectRoot);
        const snapshot = await loadWorkspaceSnapshot(rootPath);
        const marks = await this.discussionMarks.list(rootPath);
        return {
            project: { rootPath, rootName: path.basename(rootPath), revision: snapshot.revision },
            marks: marks.map(mark => {
                const source = snapshot.documents.get(mark.filePath);
                const currentLines = source?.split(/\r?\n/).slice(mark.startLine - 1, mark.endLine).join('\n');
                return {
                    id: mark.id,
                    order: mark.order,
                    createdAt: mark.createdAt,
                    kind: mark.kind,
                    filePath: mark.filePath,
                    title: mark.title,
                    startLine: mark.startLine,
                    endLine: mark.endLine,
                    ...(mark.formalId ? { formalId: mark.formalId } : {}),
                    ...(mark.formulaId ? { formulaId: mark.formulaId } : {}),
                    ...(Number.isInteger(mark.startTextOffset) ? { startTextOffset: mark.startTextOffset } : {}),
                    ...(Number.isInteger(mark.endTextOffset) ? { endTextOffset: mark.endTextOffset } : {}),
                    status: currentLines && sourceHash(currentLines) === mark.sourceHash ? 'current' : 'changed'
                };
            }),
            guidance: marks.length
                ? 'Read the listed Markdown ranges from the local project before answering. Do not treat this locator response as source content.'
                : 'No discussion marks are active for this project.'
        };
    }

    async formalLookup(idInput: string, projectRoot?: string): Promise<Record<string, unknown>> {
        const rootPath = await this.resolveRoot(projectRoot);
        const snapshot = await loadWorkspaceSnapshot(rootPath);
        const id = normalizeFormalId(idInput);
        const label = snapshot.state.labels?.[id] as LabelData | undefined;
        if (!label) throw new Error(`No formal object with id ${idInput} exists in this Math Workspace project.`);
        const content = excerpt(label.content);
        const page = pageFor(snapshot, label.filePath);
        return {
            id,
            display: display(label),
            type: label.type,
            title: label.title,
            filePath: label.filePath,
            line: (label.startLine || 0) + 1,
            endLine: label.endLine,
            pageTitle: page?.title,
            content: content.value,
            truncated: content.truncated,
            leanAnchor: snapshot.state.leanIndex?.anchors?.[id] ? {
                declarations: snapshot.state.leanIndex.anchors[id].declarations?.length || 0,
                status: snapshot.state.leanIndex.anchors[id].status
            } : undefined
        };
    }

    async dependencySlice(idInput: string, direction: 'upstream' | 'downstream' | 'both' = 'both', depth = 1, projectRoot?: string): Promise<Record<string, unknown>> {
        const rootPath = await this.resolveRoot(projectRoot);
        const snapshot = await loadWorkspaceSnapshot(rootPath);
        const id = normalizeFormalId(idInput);
        const graph = snapshot.state.dependencyGraph || {};
        const nodes = new Map<string, any>((graph.nodes || []).map((node: any) => [node.id, node]));
        if (!nodes.has(id)) throw new Error(`No dependency-graph node with id ${idInput} exists in this project.`);
        const boundedDepth = Math.max(1, Math.min(4, Number.isInteger(depth) ? depth : 1));
        const edges = (graph.edges || []).filter((edge: any) => edge.relation === 'strict');
        const selectedIds = new Set<string>([id]);
        const selectedEdges = new Map<string, any>();

        const walk = (mode: 'upstream' | 'downstream') => {
            let frontier = new Set<string>([id]);
            for (let level = 0; level < boundedDepth && frontier.size > 0 && selectedIds.size < MAX_GRAPH_NODES; level++) {
                const next = new Set<string>();
                for (const current of frontier) {
                    const matches = edges.filter((edge: any) => mode === 'upstream' ? edge.from === current : edge.to === current);
                    for (const edge of matches) {
                        const target = mode === 'upstream' ? edge.to : edge.from;
                        selectedEdges.set(`${edge.from}:${edge.to}:${edge.path}:${edge.line}:${edge.where}`, edge);
                        if (!selectedIds.has(target) && selectedIds.size < MAX_GRAPH_NODES) {
                            selectedIds.add(target);
                            next.add(target);
                        }
                    }
                }
                frontier = next;
            }
        };
        if (direction === 'upstream' || direction === 'both') walk('upstream');
        if (direction === 'downstream' || direction === 'both') walk('downstream');
        return {
            id,
            direction,
            depth: boundedDepth,
            strictOnly: true,
            truncated: selectedIds.size >= MAX_GRAPH_NODES,
            nodes: Array.from(selectedIds).map(candidate => nodeSummary(snapshot, candidate)),
            edges: Array.from(selectedEdges.values()).map((edge: any) => ({
                from: edge.from,
                to: edge.to,
                where: edge.where,
                filePath: edge.path,
                line: edge.line
            }))
        };
    }

    async leanAlignment(idInput: string, projectRoot?: string): Promise<Record<string, unknown>> {
        const rootPath = await this.resolveRoot(projectRoot);
        const snapshot = await loadWorkspaceSnapshot(rootPath);
        const id = normalizeFormalId(idInput);
        const anchor = snapshot.state.leanIndex?.anchors?.[id];
        if (!anchor) return { id, anchored: false, formal: nodeSummary(snapshot, id) };
        const projectKeys = [...new Set<string>((anchor.declarations || []).map((item: any) => item.projectKey).filter(Boolean))];
        const [build, dependencies] = await Promise.all([readLeanBuild(rootPath), readLeanDependencyArtifact(rootPath)]);
        const builds = Object.fromEntries(projectKeys.map(key => [key, build?.projects?.[key]]).filter(([, value]) => !!value));
        return {
            id,
            anchored: true,
            formal: anchor.formal,
            declarations: anchor.declarations,
            status: anchor.status,
            ...(Object.keys(builds).length ? { builds } : {}),
            ...(dependencies?.comparisons?.[id] ? { dependencyComparison: dependencies.comparisons[id] } : {})
        };
    }

    async knowledgeLookup(queryInput: string, limit = 12, projectRoot?: string): Promise<Record<string, unknown>> {
        const rootPath = await this.resolveRoot(projectRoot);
        const snapshot = await loadWorkspaceSnapshot(rootPath);
        const query = normalizedSearch(queryInput);
        if (!query) throw new Error('A non-empty project-knowledge query is required.');
        const boundedLimit = Math.max(1, Math.min(40, Number.isInteger(limit) ? limit : 12));
        const matches: Array<Record<string, unknown> & { score: number; sortKey: string }> = [];

        for (const definition of buildRuntimeDefinitions(snapshot.state.definitions || [])) {
            const score = matchScore(query, [definition.title, ...(definition.aliases || [])], [definition.content]);
            if (score === undefined) continue;
            matches.push({
                score,
                sortKey: `definition:${definition.title}:${definition.filePath}:${definition.line}`,
                kind: 'definition',
                title: definition.title,
                ...(definition.aliases?.length ? { aliases: definition.aliases } : {}),
                origin: definition.origin,
                filePath: definition.filePath,
                line: definition.line,
                preview: preview(definition.content)
            });
        }
        for (const symbol of snapshot.state.symbols || []) {
            const score = matchScore(query, [symbol.pattern, symbol.display], [symbol.meaning]);
            if (score === undefined) continue;
            matches.push({
                score,
                sortKey: `symbol:${symbol.pattern}:${symbol.sourceFilePath || ''}:${symbol.sourceLine || 0}`,
                kind: 'symbol',
                pattern: symbol.pattern,
                display: symbol.display,
                meaning: symbol.meaning,
                scope: symbol.scope,
                ...(symbol.sourceFilePath ? { filePath: symbol.sourceFilePath } : {}),
                ...(Number.isInteger(symbol.sourceLine) ? { line: symbol.sourceLine } : {})
            });
        }
        for (const source of snapshot.state.projectAnalysis?.sources || []) {
            const score = matchScore(query, [source.title, source.kind, source.filePath]);
            if (score === undefined) continue;
            matches.push({
                score,
                sortKey: `source:${source.filePath}`,
                kind: 'project-source',
                sourceKind: source.kind,
                title: source.title,
                filePath: source.filePath,
                confidence: source.confidence,
                extractedDefinitions: source.extractedDefinitions
            });
        }
        matches.sort((left, right) => left.score - right.score || left.sortKey.localeCompare(right.sortKey));
        const projected = matches.slice(0, boundedLimit).map(({ score: _score, sortKey: _sortKey, ...match }) => match);
        return {
            query: queryInput.trim(),
            total: matches.length,
            returned: projected.length,
            truncated: matches.length > projected.length,
            matches: projected
        };
    }

    async symbolAuditReport(limit = 40, projectRoot?: string): Promise<Record<string, unknown>> {
        const rootPath = await this.resolveRoot(projectRoot);
        const snapshot = await loadWorkspaceSnapshot(rootPath);
        const status = await readSymbolAuditStatus(rootPath, snapshot, this.symbolAudit);
        const report = status.report;
        if (!report) {
            return {
                reportState: status.reportState,
                settings: status.settings,
                cache: status.cache,
                scope: status.scope,
                guidance: 'No cached symbol-audit report is available. Start an audit explicitly in Math Workspace if the user wants one.'
            };
        }
        const boundedLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 40));
        const candidates = new Map(report.candidates.map(candidate => [candidate.expression, candidate]));
        const findings = [
            ...report.hardConflicts.map(conflict => ({
                expression: conflict.expression,
                severity: conflict.severity,
                reason: conflict.reason,
                bindings: conflict.bindings.map(auditBinding)
            })),
            ...report.advisories.map(advisory => {
                const bindingKeys = new Set(advisory.bindingKeys || []);
                const bindings = (candidates.get(advisory.expression)?.bindings || [])
                    .filter(binding => !bindingKeys.size || bindingKeys.has(binding.bindingKey));
                return {
                    expression: advisory.expression,
                    severity: advisory.severity,
                    reason: advisory.reason,
                    bindings: bindings.map(auditBinding)
                };
            })
        ];
        return {
            reportState: status.reportState,
            settings: status.settings,
            cache: status.cache,
            scope: status.scope,
            report: {
                createdAt: report.createdAt,
                model: report.model,
                effort: report.effort,
                bindingCount: report.bindingCount,
                externalSpecialBindingCount: report.externalSpecialBindingCount,
                scannedFiles: report.scannedFiles,
                reusedFiles: report.reusedFiles,
                hardConflictCount: report.hardConflicts.length,
                advisoryCount: report.advisories.length,
                reconciledCount: report.reconciliations.length,
                findings: findings.slice(0, boundedLimit),
                truncated: findings.length > boundedLimit
            }
        };
    }

    async verify(strictChapters = false, projectRoot?: string): Promise<Record<string, unknown>> {
        const rootPath = await this.resolveRoot(projectRoot);
        const snapshot = await loadWorkspaceSnapshot(rootPath);
        const allIssues = snapshot.state.issues || [];
        const blockingIssues = allIssues.filter((issue: any) => issue.severity === 'error'
            || VERIFY_BLOCKING_WARNING_CODES.has(issue.code)
            || (strictChapters && issue.code === 'chapter-gap'));
        return {
            readOnly: true,
            strictChapters,
            ok: blockingIssues.length === 0,
            summary: {
                errors: allIssues.filter((issue: any) => issue.severity === 'error').length,
                warnings: allIssues.filter((issue: any) => issue.severity === 'warn').length,
                blocking: blockingIssues.length,
                lean: snapshot.state.leanIndex?.summary || {}
            },
            blockingIssues: blockingIssues.slice(0, 80),
            ...(blockingIssues.length > 80 ? { truncated: true } : {})
        };
    }

    private async resolveRoot(projectRoot?: string): Promise<string> {
        const rootPath = await findMathWorkspaceRoot(path.resolve(projectRoot || this.options.rootPath || process.cwd()));
        if (rootPath) return rootPath;
        throw new Error('No Math Workspace project was found at or above that path. Run `math-workspace init` first.');
    }
}
