import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { DEFAULT_LEAN_COVERAGE_TYPES, HASH_ID_RE } from '@math-workspace/core';
import { loadWorkspaceSnapshot } from '../reader/workspace';
import { declarationReviewKey, evidenceFingerprint, formalReviewId, LeanReviewError, readReviewContext,
    refreshReviewEvidence, reviewSafePath, reviewHash, validateReviewWorkspace, type ReviewContext } from './lean-evidence';
import { readReviewEvidenceCache, readReviewRecord, reviewSaveInput, saveReviewRecord, writeReviewEvidenceCache } from './lean-review-store';
import type { DeclarationEvidence, LeanDefinitionResponse, LeanReviewEvidence, LeanReviewQueueItem,
    LeanReviewResponse, ReviewChange, ReviewJob, ReviewRecord, SourceSnippet } from './lean-review';

const fileSystem = require('node:fs/promises');

/** Project input freshness is conservative: any tracked Lean/environment input invalidates types. */
function projectCurrent(context: ReviewContext, cached: LeanReviewEvidence, projectKey: string): boolean {
    const current = context.evidence.projects.find(item => item.projectKey === projectKey);
    const previous = cached.projects.find(item => item.projectKey === projectKey);
    return !!current && !!previous && current.inputFingerprint === previous.inputFingerprint;
}

export function projectReviewEvidence(context: ReviewContext, cached?: LeanReviewEvidence): LeanReviewEvidence {
    if (!cached) return context.evidence;
    const evidence: LeanReviewEvidence = { ...context.evidence, generatedAt: cached.generatedAt,
        diagnostics: [...new Set([...context.evidence.diagnostics, ...cached.diagnostics])], definitions: cached.definitions.map(item => ({ ...item,
            evidenceState: projectCurrent(context, cached, item.projectKey) ? item.evidenceState : 'stale' as const })) };
    evidence.projects = context.evidence.projects.map(current => {
        const previous = cached.projects.find(item => item.projectKey === current.projectKey);
        if (!previous) return current;
        const fresh = projectCurrent(context, cached, current.projectKey);
        return { ...current, diagnostic: current.diagnostic || previous.diagnostic, build: { ...previous.build,
            state: fresh ? previous.build.state : 'stale' as const } };
    });
    evidence.declarations = context.evidence.declarations.map(current => {
        const previous = cached.declarations.find(item => item.key === current.key);
        if (!previous) return current;
        const fresh = projectCurrent(context, cached, current.projectKey);
        return { ...previous, source: fresh && previous.source?.filePath === current.source?.filePath ? previous.source : current.source,
            evidenceState: fresh ? previous.evidenceState : 'stale' as const,
            diagnostic: fresh ? previous.diagnostic : 'Project Lean or build-environment inputs changed since this evidence was collected.' };
    });
    const available = evidence.declarations.filter(item => item.evidenceState === 'available').length;
    const stale = evidence.declarations.some(item => item.evidenceState === 'stale');
    evidence.state = stale ? 'stale' : available === evidence.declarations.length && available > 0 ? 'current'
        : available > 0 ? 'partial' : 'unavailable';
    evidence.fingerprint = evidenceFingerprint(evidence);
    return evidence;
}

function change(kind: ReviewChange['kind'], key: string, label: string, previous?: string, current?: string): ReviewChange {
    const maximum = 24000;
    return { kind, key, label, previous: previous?.slice(0, maximum), current: current?.slice(0, maximum),
        ...((previous?.length || 0) > maximum || (current?.length || 0) > maximum ? { truncated: true } : {}) };
}

export function reviewChanges(previous: LeanReviewEvidence, current: LeanReviewEvidence): ReviewChange[] {
    const changes: ReviewChange[] = [];
    const snippets = (kind: 'statement' | 'proof' | 'context', before: SourceSnippet[], after: SourceSnippet[]) => {
        if (JSON.stringify(before.map(item => [item.filePath, item.fingerprint])) !== JSON.stringify(after.map(item => [item.filePath, item.fingerprint]))) {
            changes.push(change(kind, kind, `${kind} source`, before.map(item => `${item.filePath}:${item.startLine}\n${item.content}`).join('\n\n'),
                after.map(item => `${item.filePath}:${item.startLine}\n${item.content}`).join('\n\n')));
        }
    };
    snippets('statement', [previous.statement], [current.statement]);
    snippets('proof', previous.proofs, current.proofs);
    snippets('context', previous.contexts || [], current.contexts || []);
    if (previous.contextInputFingerprint !== current.contextInputFingerprint) changes.push(change('context', 'markdown-context',
        'Conservative workspace Markdown context', previous.contextInputFingerprint, current.contextInputFingerprint));
    const declarations = (kind: 'declaration' | 'definition', before: DeclarationEvidence[], after: DeclarationEvidence[]) => {
        const keys = new Set([...before.map(item => item.key), ...after.map(item => item.key)]);
        for (const key of keys) {
            const a = before.find(item => item.key === key); const b = after.find(item => item.key === key);
            if (!a || !b || a.source?.fingerprint !== b.source?.fingerprint) changes.push(change(kind, key, key, a?.source?.content, b?.source?.content));
            if (a?.elaboratedType !== b?.elaboratedType) changes.push(change(kind === 'definition' ? 'definition' : 'type', `${key}:type`, `${key} elaborated type`, a?.elaboratedType, b?.elaboratedType));
            if (a?.value !== b?.value) changes.push(change(kind, `${key}:value`, `${key} elaborated value`, a?.value, b?.value));
            if (JSON.stringify(a?.compiledSource) !== JSON.stringify(b?.compiledSource)) changes.push(change('environment', `${key}:compiled`, `${key} compiled module`,
                a?.compiledSource?.currentFingerprint || a?.compiledSource?.fingerprint, b?.compiledSource?.currentFingerprint || b?.compiledSource?.fingerprint));
        }
    };
    declarations('declaration', previous.declarations, current.declarations);
    declarations('definition', previous.definitions || [], current.definitions || []);
    for (const project of current.projects) {
        const before = previous.projects.find(item => item.projectKey === project.projectKey);
        if (before?.inputFingerprint !== project.inputFingerprint) changes.push(change('environment', project.projectKey,
            `${project.projectKey}: conservative project input invalidation`, before?.inputFingerprint, project.inputFingerprint));
    }
    if (!changes.length && previous.fingerprint !== current.fingerprint) changes.push(change('evidence', 'evidence', 'Evidence collection or freshness changed', previous.fingerprint, current.fingerprint));
    return changes;
}

export function reviewProjection(record: ReviewRecord | undefined, evidence: LeanReviewEvidence): LeanReviewResponse['review'] {
    return { ...(record ? { record } : {}), freshness: !record ? 'unreviewed' : record.evidenceFingerprint === evidence.fingerprint ? 'current' : 'stale',
        expectedRevision: record?.revision || 0, changes: record && record.evidenceFingerprint !== evidence.fingerprint ? reviewChanges(record.snapshot, evidence) : [] };
}

interface ActiveJob { root: string; job: ReviewJob; child?: any; cancelled: boolean; promise?: Promise<void> }

export class LeanReviewService {
    private readonly jobs = new Map<string, ActiveJob>();
    private closed = false;
    constructor(private readonly onChange?: (root: string, formalId: string) => void) {}

    async get(root: string, id: unknown): Promise<LeanReviewResponse> {
        const context = await readReviewContext(root, id);
        return this.response(context);
    }

    private async response(context: ReviewContext, compiledInputs?: Map<string, Promise<string | undefined>>): Promise<LeanReviewResponse> {
        const [evidence, record] = await Promise.all([this.currentEvidence(context, compiledInputs), readReviewRecord(context.root, context.id)]);
        const active = [...this.jobs.values()].reverse().find(item => item.root === context.root && item.job.formalId === context.id);
        return { id: context.id, projectToken: reviewHash(context.root), formal: context.formal, evidence,
            review: reviewProjection(record, evidence), ...(active ? { job: { ...active.job } } : {}) };
    }

    private async currentEvidence(context: ReviewContext, compiledInputs = new Map<string, Promise<string | undefined>>()): Promise<LeanReviewEvidence> {
        const evidence = projectReviewEvidence(context, await readReviewEvidenceCache(context.root, context.id));
        for (const declaration of [...evidence.declarations, ...evidence.definitions]) {
            if (!declaration.compiledSource) continue;
            const compiled = declaration.compiledSource;
            if (!compiledInputs.has(compiled.filePath)) compiledInputs.set(compiled.filePath, (async () => {
                const file = await reviewSafePath(context.root, compiled.filePath, true);
                return file ? reviewHash(await fs.readFile(file)) : undefined;
            })());
            const current = await compiledInputs.get(compiled.filePath)!;
            if (current !== compiled.fingerprint) {
                declaration.evidenceState = 'stale';
                declaration.diagnostic = 'The compiled defining module changed since this evidence was collected.';
                declaration.compiledSource = { ...compiled, currentFingerprint: current || 'missing' };
                const project = evidence.projects.find(item => item.projectKey === declaration.projectKey);
                if (project) project.build.state = 'stale';
            }
        }
        // Definition source text is useful even while its elaborated type is stale. Locate it in
        // current disk bytes; a recorded range after an edit is clearly labelled as context.
        for (const definition of evidence.definitions) {
            if (!definition.source) continue;
            const sourceFile = await reviewSafePath(context.root, definition.source.filePath, true);
            if (!sourceFile) {
                definition.evidenceState = 'stale';
                definition.diagnostic = 'The previously located definition source is no longer available.';
                continue;
            }
            const lines = (await fs.readFile(sourceFile, 'utf8')).split(/\r?\n/);
            const previous = definition.source;
            const content = lines.slice(previous.startLine - 1, previous.endLine).join('\n');
            const fingerprint = reviewHash(content);
            definition.source = { ...previous, content: content.slice(0, 24000), fingerprint,
                ...(content.length > 24000 ? { truncated: true } : {}),
                ...(fingerprint !== previous.fingerprint ? { rangeKind: 'context' as const } : {}) };
        }
        if ([...evidence.declarations, ...evidence.definitions].some(item => item.evidenceState === 'stale')) evidence.state = 'stale';
        evidence.fingerprint = evidenceFingerprint(evidence);
        return evidence;
    }

    async queue(rootInput: string, filePath: string, wholeProject = false): Promise<{ projectToken: string; items: LeanReviewQueueItem[]; counts: Record<string, number> }> {
        const root = await validateReviewWorkspace(rootInput);
        const snapshot = await loadWorkspaceSnapshot(root);
        if (!wholeProject && !snapshot.state.pages.some((page: any) => page.filePath === filePath)) throw new LeanReviewError(404, 'Review queue requires a current Markdown page.');
        const page = snapshot.state.pages.find((item: any) => item.filePath === filePath);
        // A page already represents its chapter's reading unit; include split pages of that chapter.
        const paths = new Set(snapshot.state.pages.filter((item: any) => wholeProject || item.filePath === filePath ||
            (page.unitKey && item.bookKey === page.bookKey && item.volumeKey === page.volumeKey && item.unitKey === page.unitKey)).map((item: any) => item.filePath));
        const coverageTypes = new Set(snapshot.state.config?.lean?.coverageTypes || DEFAULT_LEAN_COVERAGE_TYPES);
        const ids = Object.entries<any>(snapshot.state.labels || {}).filter(([id, label]) => HASH_ID_RE.test(id) && paths.has(label.filePath)
            && (coverageTypes.has(label.type) || !!snapshot.state.leanIndex?.anchors?.[id]))
            .sort(([, a], [, b]) => a.filePath.localeCompare(b.filePath) || (a.startLine || 0) - (b.startLine || 0)).map(([id]) => id);
        if (ids.length > (wholeProject ? 3000 : 1000)) throw new LeanReviewError(413, wholeProject
            ? 'Project review overview is limited to 3000 objects; no partial completeness is claimed.' : 'Review queue is limited to 1000 objects in a chapter.');
        const projectInputs = new Map();
        const compiledInputs = new Map();
        const items: LeanReviewQueueItem[] = [];
        for (const id of ids) {
            const context = await readReviewContext(root, id, snapshot, projectInputs, true);
            const object = await this.response(context, compiledInputs);
            const record = object.review.record;
            items.push({ ...context.formal, anchored: context.evidence.declarations.length > 0,
                declarationCount: context.evidence.declarations.length, reviewFreshness: object.review.freshness, evidenceFingerprint: object.evidence.fingerprint,
                ...(record ? { verdict: record.verdict, reviewer: record.reviewer, reviewedAt: record.reviewedAt } : {}) });
        }
        const counts = { total: items.length, unreviewed: 0, current: 0, stale: 0, unanchored: 0 };
        for (const item of items) { counts[item.reviewFreshness]++; if (!item.anchored) counts.unanchored++; }
        return { projectToken: reviewHash(root), items, counts };
    }

    async definition(root: string, id: unknown, projectKey: string, name: string): Promise<LeanDefinitionResponse> {
        const response = await this.get(root, id);
        const key = declarationReviewKey(projectKey, name);
        const definition = [...response.evidence.declarations, ...response.evidence.definitions].find(item => item.key === key);
        return definition ? { definition, state: definition.evidenceState, diagnostic: definition.diagnostic }
            : { state: 'unavailable', diagnostic: 'This definition has no cached elaborated evidence. Expand it explicitly after refreshing the object.' };
    }

    async job(rootInput: string, id: string): Promise<{ job: ReviewJob }> {
        const active = this.jobs.get(id);
        if (!active || await fs.realpath(rootInput) !== active.root) throw new LeanReviewError(404, 'Lean review job not found in this project.');
        return { job: { ...active.job } };
    }

    async action(rootInput: string, body: any): Promise<{ status: number; value: unknown }> {
        const root = await validateReviewWorkspace(rootInput);
        if (body?.action === 'save') {
            const input = reviewSaveInput(body);
            const running = [...this.jobs.values()].some(item => item.root === root && item.job.formalId === input.id && ['queued', 'running'].includes(item.job.status));
            if (running) throw new LeanReviewError(409, 'Evidence is refreshing. Wait and review the refreshed evidence before saving.');
            await saveReviewRecord(root, input, async () => {
                const context = await readReviewContext(root, input.id);
                return this.currentEvidence(context);
            });
            this.onChange?.(root, input.id);
            return { status: 200, value: await this.get(root, input.id) };
        }
        if (body?.action === 'cancel') {
            const active = this.jobs.get(body.jobId);
            if (!active || active.root !== root) throw new LeanReviewError(404, 'Lean review job not found in this project.');
            if (['queued', 'running'].includes(active.job.status)) {
                active.cancelled = true;
                this.kill(active.child);
            }
            return { status: 200, value: { job: { ...active.job } } };
        }
        if (!['refresh', 'expand'].includes(body?.action)) throw new LeanReviewError(400, 'Lean review action must be refresh, expand, cancel, or save.');
        if (this.closed) throw new LeanReviewError(409, 'The Reader is closing.');
        const context = await readReviewContext(root, body.id);
        let previous: LeanReviewEvidence | undefined;
        try { previous = await readReviewEvidenceCache(root, context.id); }
        catch (error) {
            if (body.action !== 'refresh') throw error;
            // Explicit refresh can recover deterministic cache metadata. Preserve the bad bytes
            // before replacement; never apply this recovery rule to human review records.
            const directory = await reviewSafePath(root, '.math-workspace/lean-review-evidence', true);
            const bad = directory && await reviewSafePath(root, path.relative(root, path.join(directory, `${context.id}.json`)), true);
            if (bad) await fs.copyFile(bad, path.join(directory!, `.${context.id}-invalid-${crypto.randomBytes(8).toString('hex')}.json`));
        }
        let expansion: { projectKey: string; name: string } | undefined;
        if (body.action === 'expand') {
            if (typeof body.projectKey !== 'string' || typeof body.name !== 'string') throw new LeanReviewError(400, 'Definition expansion requires a project key and declaration name.');
            const current = projectReviewEvidence(context, previous);
            const allowed = current.declarations.concat(current.definitions).filter(item => item.projectKey === body.projectKey)
                .flatMap(item => [item.qualifiedName, ...item.typeDependencies, ...item.proofDependencies]);
            if (!allowed.includes(body.name) || current.state === 'stale') throw new LeanReviewError(400, 'Refresh the object and choose a declaration from its actual dependency evidence.');
            expansion = { projectKey: body.projectKey, name: body.name };
        }
        const running = [...this.jobs.values()].find(item => item.root === root && ['queued', 'running'].includes(item.job.status));
        if (running) throw new LeanReviewError(409, 'Another Lean evidence job is running in this project.');
        if (this.jobs.size >= 32) {
            const old = [...this.jobs.entries()].find(([, item]) => !['queued', 'running'].includes(item.job.status));
            if (old) this.jobs.delete(old[0]);
            else throw new LeanReviewError(409, 'Too many Lean review jobs are active.');
        }
        const job: ReviewJob = { id: crypto.randomBytes(16).toString('hex'), formalId: context.id,
            status: 'queued', phase: 'Preparing local Lean evidence', startedAt: new Date().toISOString() };
        const active: ActiveJob = { root, job, cancelled: false };
        this.jobs.set(job.id, active);
        // Defer all long tooling until after the 202 response is available.
        active.promise = new Promise<void>(resolve => setTimeout(() => { void this.run(active, context, previous, expansion).finally(resolve); }, 0));
        return { status: 202, value: { job: { ...job } } };
    }

    private async run(active: ActiveJob, context: ReviewContext, previous?: LeanReviewEvidence, expansion?: { projectKey: string; name: string }): Promise<void> {
        let lock: any;
        const lockPath = path.join(context.root, '.math-workspace', 'lean-review-refresh.lock');
        try {
            lock = await fileSystem.open(lockPath, 'wx', 0o600);
            await lock.writeFile(JSON.stringify({ pid: process.pid, jobId: active.job.id }));
            if (active.cancelled) throw new Error('Review evidence refresh cancelled.');
            active.job.status = 'running';
            const evidence = await refreshReviewEvidence(context, {
                cancelled: () => active.cancelled, onProcess: child => { active.child = child; }, phase: phase => { active.job.phase = phase; }
            }, expansion);
            if (expansion && previous) {
                for (const project of evidence.projects.filter(item => item.projectKey !== expansion.projectKey)) {
                    const saved = previous.projects.find(item => item.projectKey === project.projectKey);
                    if (saved && projectCurrent(context, previous, project.projectKey)) Object.assign(project, saved);
                }
                for (const declaration of evidence.declarations.filter(item => item.projectKey !== expansion.projectKey)) {
                    const saved = previous.declarations.find(item => item.key === declaration.key);
                    if (saved && projectCurrent(context, previous, declaration.projectKey)) Object.assign(declaration, saved);
                }
                evidence.definitions = [...new Map([...previous.definitions, ...evidence.definitions].map(item => [item.key, item])).values()];
                const available = evidence.declarations.filter(item => item.evidenceState === 'available').length;
                evidence.state = evidence.declarations.some(item => item.evidenceState === 'stale') ? 'stale'
                    : available > 0 && available === evidence.declarations.length ? 'current'
                        : available > 0 ? 'partial' : 'unavailable';
                evidence.fingerprint = evidenceFingerprint(evidence);
            }
            if (active.cancelled) throw new Error('Review evidence refresh cancelled.');
            await writeReviewEvidenceCache(context.root, context.id, evidence);
            active.job.status = evidence.state === 'current' ? 'completed' : 'failed';
            active.job.phase = evidence.state === 'current' ? 'Evidence ready for human review' : 'Evidence incomplete';
            if (active.job.status === 'failed') active.job.error = evidence.diagnostics.join('\n') || 'No complete elaborated evidence was obtained.';
            this.onChange?.(context.root, context.id);
        } catch (error: any) {
            active.job.status = active.cancelled ? 'cancelled' : 'failed';
            active.job.phase = active.cancelled ? 'Cancelled' : 'Evidence refresh failed';
            active.job.error = error?.code === 'EEXIST' ? 'Another Reader owns the local evidence refresh lock; wait for it, or inspect a lock left by a crashed process.' : error.message || String(error);
        } finally {
            active.job.finishedAt = new Date().toISOString();
            active.child = undefined;
            if (lock) { await lock.close(); await fs.rm(lockPath, { force: true }); }
        }
    }

    private kill(child: any): void {
        if (!child) return;
        try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
        catch (_error) { child.kill('SIGKILL'); }
    }

    async close(): Promise<void> {
        this.closed = true;
        for (const active of this.jobs.values()) if (['queued', 'running'].includes(active.job.status)) { active.cancelled = true; this.kill(active.child); }
        await Promise.all([...this.jobs.values()].map(active => active.promise));
    }
}
