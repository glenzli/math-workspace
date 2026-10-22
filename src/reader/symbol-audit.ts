import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { normalizeLatexSymbol } from '@math-workspace/core';
import { mathWorkspaceStatePath } from './local-state';

const nodeFs = require('node:fs');

export const SYMBOL_AUDIT_PROMPT_VERSION = 'symbol-audit-v2';
export const SYMBOL_AUDIT_REVIEW_VERSION = 'symbol-audit-reconciliation-v2';
const MAX_EXTRACTION_CACHE_ENTRIES = 640;
const MAX_REPORT_CACHE_ENTRIES = 160;

export type SymbolAuditBindingKind = 'special' | 'temporary';

export type SymbolAuditScope =
    | { kind: 'all' }
    | { kind: 'volume'; groupId: string }
    | { kind: 'chapters'; filePaths: string[] };

export interface SymbolAuditSettings {
    /** Undefined means follow the current Codex default. */
    model?: string;
    /** Undefined means use the selected model's default effort. */
    effort?: string;
    /** Undefined is equivalent to the full workspace. */
    scope?: SymbolAuditScope;
}

export interface SymbolAuditSource {
    filePath: string;
    content: string;
    registeredSymbols: Array<{
        pattern: string;
        display: string;
        meaning: string;
        scope: string;
        sourceLine?: number;
    }>;
}

export interface SymbolAuditBinding {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    expression: string;
    normalizedExpression: string;
    structure: {
        base: string;
        modifiers: string[];
    };
    kind: SymbolAuditBindingKind;
    scope: 'book' | 'chapter' | 'section' | 'local';
    /** A model-proposed semantic hint; it is not a canonical cross-file identity. */
    bindingKey: string;
    semanticType: string;
    meaning: string;
    evidence: string;
    confidence: 'high' | 'medium' | 'low';
}

export interface SymbolAuditExtraction {
    cacheKey: string;
    filePath: string;
    sourceHash: string;
    promptVersion: string;
    model?: string;
    effort?: string;
    extractedAt: string;
    bindings: SymbolAuditBinding[];
}

export interface SymbolAuditConflict {
    expression: string;
    severity: 'hard';
    reason: string;
    bindings: SymbolAuditBinding[];
}

export type SymbolAuditRelation = 'same-binding' | 'specialization' | 'compatible-reuse' | 'conflict' | 'notation-reuse' | 'distinct-bindings' | 'uncertain';

/** Model-assisted assessment of a candidate, never a source-edit instruction. */
export interface SymbolAuditReconciliation {
    /** Absent only in legacy reports. */
    candidateId?: string;
    expression: string;
    relation: SymbolAuditRelation;
    confidence: 'high' | 'medium' | 'low';
    readerRisk: boolean;
    reason: string;
    bindingKeys: string[];
    bindingIds?: string[];
}

export interface SymbolAuditCandidate {
    id: string;
    kind: 'collision' | 'notation-choice';
    expression: string;
    bindings: SymbolAuditBinding[];
}

export interface SymbolAuditAdvisory {
    candidateId?: string;
    expression: string;
    severity: 'notice' | 'review';
    reason: string;
    bindingKeys: string[];
    bindingIds?: string[];
}

export interface SymbolAuditReport {
    cacheKey: string;
    createdAt: string;
    inputHash: string;
    promptVersion: string;
    reviewVersion: string;
    model?: string;
    effort?: string;
    bindingCount: number;
    /** Registered special symbols outside the chosen scope used for comparison. */
    externalSpecialBindingCount: number;
    scannedFiles: number;
    reusedFiles: number;
    hardConflicts: SymbolAuditConflict[];
    candidates: SymbolAuditCandidate[];
    reconciliations: SymbolAuditReconciliation[];
    advisories: SymbolAuditAdvisory[];
}

export interface SymbolAuditAnalysis {
    candidates: SymbolAuditCandidate[];
}

interface SymbolAuditProjectState {
    settings: SymbolAuditSettings;
    extractions: Record<string, SymbolAuditExtraction>;
    reports: Record<string, SymbolAuditReport>;
    latestReportKey?: string;
}

interface SymbolAuditStateFile {
    version: 1;
    projects: Record<string, SymbolAuditProjectState>;
}

export interface SymbolAuditStoreOptions {
    stateFilePath?: string;
}

function emptyProjectState(): SymbolAuditProjectState {
    return { settings: {}, extractions: {}, reports: {} };
}

function emptyState(): SymbolAuditStateFile {
    return { version: 1, projects: {} };
}

function stringValue(value: unknown, maximum = 300): string {
    return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function positiveLine(value: unknown, fallback: number): number {
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function normalizedBindingKey(value: string): string {
    return value.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 96);
}

export function sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export function symbolAuditExtractionCacheKey(
    filePath: string,
    sourceHash: string,
    settings: SymbolAuditSettings
): string {
    return sha256(JSON.stringify({
        filePath,
        sourceHash,
        promptVersion: SYMBOL_AUDIT_PROMPT_VERSION,
        model: settings.model || '',
        effort: settings.effort || ''
    }));
}

export function symbolAuditReportCacheKey(
    sources: Array<Pick<SymbolAuditExtraction, 'cacheKey' | 'filePath'>>,
    settings: SymbolAuditSettings,
    comparisonBindings: SymbolAuditBinding[] = []
): string {
    return sha256(JSON.stringify({
        sources: sources.map(source => [source.filePath, source.cacheKey]).sort((left, right) => left[0].localeCompare(right[0])),
        comparisonBindings: comparisonBindings.map(binding => [binding.id, binding.bindingKey, binding.normalizedExpression]).sort((left, right) => left[0].localeCompare(right[0])),
        promptVersion: SYMBOL_AUDIT_PROMPT_VERSION,
        reviewVersion: SYMBOL_AUDIT_REVIEW_VERSION,
        model: settings.model || '',
        effort: settings.effort || ''
    }));
}

/**
 * Treat model output as untrusted. This preserves a small, stable local data
 * contract even when a model adds prose or uses a non-canonical shape.
 */
export function normalizeSymbolAuditBindings(
    rawBindings: unknown,
    source: Pick<SymbolAuditSource, 'filePath' | 'content'>
): SymbolAuditBinding[] {
    const raw = Array.isArray(rawBindings) ? rawBindings : [];
    const lineCount = Math.max(1, source.content.split(/\r?\n/).length);
    const seen = new Set<string>();
    const bindings: SymbolAuditBinding[] = [];

    raw.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        const value = item as Record<string, unknown>;
        const expression = stringValue(value.expression, 160).replace(/^\$+|\$+$/g, '');
        const normalizedExpression = expression ? normalizeLatexSymbol(expression) : '';
        const meaning = stringValue(value.meaning, 480);
        const bindingKey = normalizedBindingKey(stringValue(value.bindingKey, 120));
        const semanticType = normalizedBindingKey(stringValue(value.semanticType, 80));
        if (!expression || !normalizedExpression || !meaning || !bindingKey || !semanticType) return;

        const startLine = Math.min(lineCount, positiveLine(value.startLine, 1));
        const endLine = Math.max(startLine, Math.min(lineCount, positiveLine(value.endLine, startLine)));
        const structureValue = value.structure && typeof value.structure === 'object' ? value.structure as Record<string, unknown> : {};
        const base = stringValue(structureValue.base, 80) || expression;
        const modifiers = Array.isArray(structureValue.modifiers)
            ? structureValue.modifiers.map(item => stringValue(item, 80)).filter(Boolean).slice(0, 8)
            : [];
        const kind = enumValue(value.kind, ['special', 'temporary'] as const, 'temporary');
        const scope = enumValue(value.scope, ['book', 'chapter', 'section', 'local'] as const, kind === 'special' ? 'book' : 'local');
        const identity = [source.filePath, startLine, endLine, normalizedExpression, bindingKey, kind].join(':');
        if (seen.has(identity)) return;
        seen.add(identity);
        bindings.push({
            id: 'mwsym_' + sha256(identity).slice(0, 16),
            filePath: source.filePath,
            startLine,
            endLine,
            expression,
            normalizedExpression,
            structure: { base, modifiers },
            kind,
            scope,
            bindingKey,
            semanticType,
            meaning,
            evidence: stringValue(value.evidence, 420),
            confidence: enumValue(value.confidence, ['high', 'medium', 'low'] as const, 'medium')
        });
    });

    return bindings.sort((left, right) => (
        left.filePath.localeCompare(right.filePath)
        || left.startLine - right.startLine
        || left.normalizedExpression.localeCompare(right.normalizedExpression)
        || left.bindingKey.localeCompare(right.bindingKey)
    ));
}

function uniqueBindings(bindings: SymbolAuditBinding[]): SymbolAuditBinding[] {
    return Array.from(new Map(bindings.map(binding => [binding.id, binding] as const)).values());
}

function bindingSummary(binding: SymbolAuditBinding): string {
    return `${binding.filePath}:${binding.startLine} assigns ${binding.expression} to ${binding.bindingKey} (${binding.semanticType}).`;
}

/**
 * Deterministic discovery only. A binding key is an extraction hint generated
 * independently per file, not a canonical semantic identity. Matching meaning,
 * key or base hints likewise only nominate a notation choice for contextual review.
 */
export function analyzeSymbolAuditBindings(bindings: SymbolAuditBinding[]): SymbolAuditAnalysis {
    const meaningHint = (binding: SymbolAuditBinding) => binding.meaning.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    const byExpression = new Map<string, SymbolAuditBinding[]>();
    bindings.forEach(binding => {
        const group = byExpression.get(binding.normalizedExpression) || [];
        group.push(binding);
        byExpression.set(binding.normalizedExpression, group);
    });

    const candidates: SymbolAuditCandidate[] = [];
    const seen = new Set<string>();
    const addCandidate = (kind: SymbolAuditCandidate['kind'], group: SymbolAuditBinding[]) => {
        const unique = uniqueBindings(group).sort((left, right) => left.id.localeCompare(right.id));
        const expressions = Array.from(new Map(unique.map(binding => [binding.normalizedExpression, binding.expression])).values()).sort();
        if (kind === 'notation-choice' && expressions.length < 2) return;
        const id = 'mwsymcand_' + sha256(JSON.stringify([kind, unique.map(binding => binding.id)])).slice(0, 20);
        if (seen.has(id)) return;
        seen.add(id);
        candidates.push({
            id,
            kind,
            expression: kind === 'collision' ? unique[0].expression : expressions.slice(0, 3).join(' \\; / \\; ') + (expressions.length > 3 ? ' \\; / \\; \\dots' : ''),
            bindings: unique
        });
    };
    byExpression.forEach(group => {
        const unique = uniqueBindings(group);
        const semanticHints = new Set(unique.map(binding => JSON.stringify([binding.bindingKey, binding.semanticType, meaningHint(binding)])));
        if (semanticHints.size < 2) return;
        addCandidate('collision', unique);
    });

    const byHint = new Map<string, SymbolAuditBinding[]>();
    for (const binding of uniqueBindings(bindings)) {
        const meaning = meaningHint(binding);
        const base = normalizeLatexSymbol(binding.structure?.base || '');
        const hints = [`key:${binding.bindingKey}`, ...(meaning ? [`meaning:${meaning}`] : []), ...(base ? [`base:${base}`] : [])];
        for (const hint of hints) {
            const group = byHint.get(hint) || [];
            group.push(binding);
            byHint.set(hint, group);
        }
    }
    byHint.forEach(group => addCandidate('notation-choice', group));
    return { candidates: candidates.sort((left, right) => left.expression.localeCompare(right.expression) || left.id.localeCompare(right.id)) };
}

export function symbolAuditInputHash(extractions: SymbolAuditExtraction[], comparisonBindings: SymbolAuditBinding[] = []): string {
    return sha256(JSON.stringify({ reviewVersion: SYMBOL_AUDIT_REVIEW_VERSION, extractions: extractions.map(extraction => ({
        filePath: extraction.filePath,
        cacheKey: extraction.cacheKey,
        bindings: extraction.bindings.map(binding => [binding.id, binding.bindingKey, binding.normalizedExpression])
    })).sort((left, right) => left.filePath.localeCompare(right.filePath)), comparisonBindings: comparisonBindings.map(binding => [binding.id, binding.bindingKey, binding.normalizedExpression]).sort((left, right) => left[0].localeCompare(right[0])) }));
}

export function normalizeSymbolAuditReconciliations(
    rawReconciliations: unknown,
    candidates: SymbolAuditCandidate[]
): SymbolAuditReconciliation[] {
    const raw = Array.isArray(rawReconciliations) ? rawReconciliations : [];
    const candidatesById = new Map(candidates.map(candidate => [candidate.id, candidate] as const));
    const candidatesByExpression = new Map(candidates.filter(candidate => candidate.kind === 'collision')
        .map(candidate => [normalizeLatexSymbol(candidate.expression), candidate] as const));
    const reconciled = new Map<string, SymbolAuditReconciliation>();
    raw.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const value = item as Record<string, unknown>;
        const expression = stringValue(value.expression, 160).replace(/^\$+|\$+$/g, '');
        const candidateId = stringValue(value.candidateId, 80);
        const candidate = candidateId ? candidatesById.get(candidateId) : candidatesByExpression.get(normalizeLatexSymbol(expression));
        if (!candidate || reconciled.has(candidate.id)) return;
        let relation: SymbolAuditRelation = candidate.kind === 'notation-choice'
            ? enumValue(value.relation, ['notation-reuse', 'distinct-bindings', 'uncertain'] as const, 'uncertain')
            : enumValue(value.relation, ['same-binding', 'specialization', 'compatible-reuse', 'conflict', 'uncertain'] as const, 'uncertain');
        const confidence = enumValue(value.confidence, ['high', 'medium', 'low'] as const, 'low');
        if (candidate.kind === 'notation-choice' && confidence === 'low') relation = 'uncertain';
        const reason = stringValue(value.reason, 720) || 'The review pass did not explain this notation candidate.';
        const allowedKeys = new Set(candidate.bindings.map(binding => binding.bindingKey));
        const bindingKeys = Array.isArray(value.bindingKeys)
            ? Array.from(new Set(value.bindingKeys.map(key => stringValue(key, 120)).filter(key => allowedKeys.has(key))))
            : [];
        const allowedIds = new Set(candidate.bindings.map(binding => binding.id));
        const requestedIds = Array.isArray(value.bindingIds)
            ? new Set(value.bindingIds.map(id => stringValue(id, 80)).filter(id => allowedIds.has(id)))
            : undefined;
        let selected = candidate.bindings.filter(binding => requestedIds
            ? requestedIds.has(binding.id)
            : !bindingKeys.length || bindingKeys.includes(binding.bindingKey));
        if (!selected.length) {
            relation = 'uncertain';
            selected = candidate.bindings;
        }
        if (relation === 'notation-reuse'
            && (!requestedIds || new Set(selected.map(binding => binding.normalizedExpression)).size < 2)) relation = 'uncertain';
        if (relation === 'conflict' && selected.length < 2) relation = 'uncertain';
        reconciled.set(candidate.id, {
            candidateId: candidate.id,
            expression: candidate.expression,
            relation,
            confidence,
            readerRisk: value.readerRisk === true,
            reason,
            bindingKeys: Array.from(new Set(selected.map(binding => binding.bindingKey))),
            bindingIds: selected.map(binding => binding.id)
        });
    });
    candidates.forEach(candidate => {
        if (reconciled.has(candidate.id)) return;
        reconciled.set(candidate.id, {
            candidateId: candidate.id,
            expression: candidate.expression,
            relation: 'uncertain',
            confidence: 'low',
            readerRisk: true,
            reason: 'The review pass did not return an assessment for this notation candidate.',
            bindingKeys: Array.from(new Set(candidate.bindings.map(binding => binding.bindingKey))),
            bindingIds: candidate.bindings.map(binding => binding.id)
        });
    });
    return Array.from(reconciled.values()).sort((left, right) => left.expression.localeCompare(right.expression) || String(left.candidateId).localeCompare(String(right.candidateId)));
}

function validSettings(value: unknown): SymbolAuditSettings {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const model = stringValue(record.model, 160);
    const effort = stringValue(record.effort, 80);
    const scopeRecord = record.scope && typeof record.scope === 'object' ? record.scope as Record<string, unknown> : undefined;
    const scopeKind = scopeRecord ? stringValue(scopeRecord.kind, 24) : '';
    const scope = scopeKind === 'all'
        ? { kind: 'all' as const }
        : scopeKind === 'volume' && stringValue(scopeRecord?.groupId, 320)
            ? { kind: 'volume' as const, groupId: stringValue(scopeRecord?.groupId, 320) }
            : scopeKind === 'chapters'
                ? { kind: 'chapters' as const, filePaths: Array.from(new Set(
                    (Array.isArray(scopeRecord?.filePaths) ? scopeRecord.filePaths : [])
                        .map(item => stringValue(item, 480))
                        .filter(filePath => filePath && !filePath.startsWith('/') && !filePath.includes('..'))
                )).sort().slice(0, 160) }
                : undefined;
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(scope ? { scope } : {}) };
}

function validBinding(value: unknown): value is SymbolAuditBinding {
    const binding = value as Partial<SymbolAuditBinding> | undefined;
    return !!binding
        && typeof binding.id === 'string'
        && typeof binding.filePath === 'string'
        && Number.isInteger(binding.startLine)
        && Number.isInteger(binding.endLine)
        && typeof binding.expression === 'string'
        && typeof binding.normalizedExpression === 'string'
        && typeof binding.bindingKey === 'string'
        && typeof binding.semanticType === 'string'
        && typeof binding.meaning === 'string'
        && (binding.kind === 'special' || binding.kind === 'temporary');
}

function validExtraction(value: unknown): value is SymbolAuditExtraction {
    const extraction = value as Partial<SymbolAuditExtraction> | undefined;
    return !!extraction
        && typeof extraction.cacheKey === 'string'
        && typeof extraction.filePath === 'string'
        && typeof extraction.sourceHash === 'string'
        && typeof extraction.promptVersion === 'string'
        && typeof extraction.extractedAt === 'string'
        && Array.isArray(extraction.bindings)
        && extraction.bindings.every(validBinding);
}

function validProjectState(value: unknown): SymbolAuditProjectState {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const extractions = Object.fromEntries(Object.entries(record.extractions || {}).filter(([, extraction]) => validExtraction(extraction))) as Record<string, SymbolAuditExtraction>;
    const reports = record.reports && typeof record.reports === 'object' ? record.reports as Record<string, SymbolAuditReport> : {};
    return {
        settings: validSettings(record.settings),
        extractions,
        reports,
        ...(typeof record.latestReportKey === 'string' ? { latestReportKey: record.latestReportKey } : {})
    };
}

function pruneByDate<T extends { createdAt?: string; extractedAt?: string }>(entries: Record<string, T>, maximum: number): Record<string, T> {
    const ordered = Object.entries(entries).sort((left, right) => (
        String(right[1].createdAt || right[1].extractedAt || '').localeCompare(String(left[1].createdAt || left[1].extractedAt || ''))
    ));
    return Object.fromEntries(ordered.slice(0, maximum));
}

/** Local-only state for explicit audit settings and cache entries. */
export class SymbolAuditStore {
    private readonly stateFilePath: string;
    private sequence: Promise<void> = Promise.resolve();

    constructor(options: SymbolAuditStoreOptions = {}) {
        this.stateFilePath = options.stateFilePath || process.env.MATH_WORKSPACE_SYMBOL_AUDIT_STATE || mathWorkspaceStatePath('symbol-audit.json');
    }

    async project(rootPath: string): Promise<SymbolAuditProjectState> {
        await this.sequence;
        const state = await this.read();
        return validProjectState(state.projects[rootPath]);
    }

    async updateSettings(rootPath: string, settings: SymbolAuditSettings): Promise<SymbolAuditSettings> {
        return this.mutate(rootPath, project => {
            project.settings = validSettings(settings);
            return project.settings;
        });
    }

    async saveExtraction(rootPath: string, extraction: SymbolAuditExtraction): Promise<void> {
        await this.mutate(rootPath, project => {
            project.extractions[extraction.cacheKey] = extraction;
            project.extractions = pruneByDate(project.extractions, MAX_EXTRACTION_CACHE_ENTRIES);
        });
    }

    async saveReport(rootPath: string, report: SymbolAuditReport): Promise<void> {
        await this.mutate(rootPath, project => {
            project.reports[report.cacheKey] = report;
            project.reports = pruneByDate(project.reports, MAX_REPORT_CACHE_ENTRIES);
            project.latestReportKey = report.cacheKey;
        });
    }

    private async mutate<T>(rootPath: string, operation: (project: SymbolAuditProjectState) => T): Promise<T> {
        let resolveResult: (value: T | PromiseLike<T>) => void;
        let rejectResult: (reason?: unknown) => void;
        const result = new Promise<T>((resolve, reject) => {
            resolveResult = resolve;
            rejectResult = reject;
        });
        this.sequence = this.sequence.then(async () => {
            try {
                const state = await this.read();
                const project = validProjectState(state.projects[rootPath]);
                const value = operation(project);
                state.projects[rootPath] = project;
                await this.write(state);
                resolveResult(value);
            } catch (error) {
                rejectResult(error);
            }
        });
        await this.sequence;
        return result;
    }

    private async read(): Promise<SymbolAuditStateFile> {
        try {
            const parsed = JSON.parse(await fs.readFile(this.stateFilePath, 'utf8')) as Partial<SymbolAuditStateFile>;
            const projects = parsed?.projects && typeof parsed.projects === 'object'
                ? Object.fromEntries(Object.entries(parsed.projects).map(([rootPath, project]) => [rootPath, validProjectState(project)]))
                : {};
            return { version: 1, projects };
        } catch (error: any) {
            if (error?.code === 'ENOENT') return emptyState();
            return emptyState();
        }
    }

    private async write(state: SymbolAuditStateFile): Promise<void> {
        await fs.mkdir(path.dirname(this.stateFilePath), { recursive: true });
        const temporaryPath = `${this.stateFilePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        try {
            await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
            await nodeFs.promises.rename(temporaryPath, this.stateFilePath);
        } catch (error) {
            await nodeFs.promises.unlink(temporaryPath).catch(() => undefined);
            throw error;
        }
    }
}

export function createSymbolAuditExtraction(
    source: Pick<SymbolAuditSource, 'filePath' | 'content'>,
    settings: SymbolAuditSettings,
    rawBindings: unknown
): SymbolAuditExtraction {
    const sourceHash = sha256(source.content);
    return {
        cacheKey: symbolAuditExtractionCacheKey(source.filePath, sourceHash, settings),
        filePath: source.filePath,
        sourceHash,
        promptVersion: SYMBOL_AUDIT_PROMPT_VERSION,
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { effort: settings.effort } : {}),
        extractedAt: new Date().toISOString(),
        bindings: normalizeSymbolAuditBindings(rawBindings, source)
    };
}

export function createSymbolAuditReport(
    extractions: SymbolAuditExtraction[],
    settings: SymbolAuditSettings,
    scannedFiles: number,
    reusedFiles: number,
    reconciliations: SymbolAuditReconciliation[] = [],
    comparisonBindings: SymbolAuditBinding[] = []
): SymbolAuditReport {
    const bindings = extractions.flatMap(extraction => extraction.bindings);
    const selectedIds = new Set(bindings.map(binding => binding.id));
    const analysis = analyzeSymbolAuditBindings([...bindings, ...comparisonBindings]);
    analysis.candidates = analysis.candidates.filter(candidate => candidate.bindings.some(binding => selectedIds.has(binding.id)));
    const candidateById = new Map(analysis.candidates.map(candidate => [candidate.id, candidate] as const));
    const reviewed = normalizeSymbolAuditReconciliations(reconciliations, analysis.candidates);
    const hardConflicts = reviewed.flatMap((reconciliation): SymbolAuditConflict[] => {
        const candidate = candidateById.get(reconciliation.candidateId || '');
        const assessed = candidate?.bindings.filter(binding => reconciliation.bindingIds?.includes(binding.id)) || [];
        if (!candidate
            || candidate.kind !== 'collision'
            || reconciliation.relation !== 'conflict'
            || reconciliation.confidence !== 'high'
            || !assessed.some(binding => selectedIds.has(binding.id))
            || !assessed.some(binding => binding.kind === 'special')) return [];
        return [{
            expression: candidate.expression,
            severity: 'hard',
            reason: reconciliation.reason,
            bindings: assessed
        }];
    });
    const advisories = reviewed.flatMap((reconciliation): SymbolAuditAdvisory[] => {
        const candidate = candidateById.get(reconciliation.candidateId || '');
        if (!candidate) return [];
        const assessed = candidate.bindings.filter(binding => reconciliation.bindingIds?.includes(binding.id));
        if (!assessed.some(binding => selectedIds.has(binding.id))) return [];
        const isHighSpecialConflict = reconciliation.relation === 'conflict'
            && reconciliation.confidence === 'high'
            && assessed.some(binding => binding.kind === 'special');
        if (isHighSpecialConflict) return [];
        const severity = reconciliation.relation === 'conflict' || reconciliation.relation === 'uncertain'
            ? 'review' as const
            : reconciliation.relation === 'notation-reuse' || (reconciliation.relation === 'compatible-reuse' && reconciliation.readerRisk)
                ? 'notice' as const
                : undefined;
        return severity ? [{
            candidateId: candidate.id,
            expression: candidate.expression,
            severity,
            reason: reconciliation.reason,
            bindingKeys: reconciliation.bindingKeys,
            bindingIds: reconciliation.bindingIds
        }] : [];
    });
    return {
        cacheKey: symbolAuditReportCacheKey(extractions, settings, comparisonBindings),
        createdAt: new Date().toISOString(),
        inputHash: symbolAuditInputHash(extractions, comparisonBindings),
        promptVersion: SYMBOL_AUDIT_PROMPT_VERSION,
        reviewVersion: SYMBOL_AUDIT_REVIEW_VERSION,
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { effort: settings.effort } : {}),
        bindingCount: bindings.length,
        externalSpecialBindingCount: comparisonBindings.length,
        scannedFiles,
        reusedFiles,
        hardConflicts,
        candidates: analysis.candidates,
        reconciliations: reviewed,
        advisories
    };
}

export function bindingSummaryForPrompt(binding: SymbolAuditBinding): string {
    return bindingSummary(binding);
}
