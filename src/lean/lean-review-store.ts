import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { LeanReviewError, formalReviewId, reviewPathInside, reviewSafePath } from './lean-evidence';
import type { LeanReviewEvidence, LeanReviewSaveInput, ReviewDecision, ReviewRecord, ReviewSubclaim, ReviewVerdict } from './lean-review';

const fileSystem = require('node:fs/promises');
const VERDICTS: ReviewVerdict[] = ['aligned', 'partial', 'difference', 'undecided'];
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

async function metadataDirectory(root: string, name: string, create = false): Promise<string | undefined> {
    const parent = (await reviewSafePath(root, '.math-workspace'))!;
    const directory = path.join(parent, name);
    if (create) await fs.mkdir(directory, { recursive: true });
    const resolved = await reviewSafePath(root, path.relative(root, directory), true);
    if (resolved && !reviewPathInside(parent, resolved)) throw new LeanReviewError(400, 'Lean review metadata cannot escape .math-workspace.');
    return resolved;
}

async function readJson(root: string, directoryName: string, id: string): Promise<any | undefined> {
    const directory = await metadataDirectory(root, directoryName);
    if (!directory) return undefined;
    const file = await reviewSafePath(root, path.relative(root, path.join(directory, `${formalReviewId(id)}.json`)), true);
    if (!file) return undefined;
    const stat = await fs.stat(file);
    if (stat.size > MAX_SNAPSHOT_BYTES) throw new LeanReviewError(413, 'Lean review metadata exceeds its bounded size.');
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (_error) { throw new LeanReviewError(409, 'Lean review metadata is unreadable; preserve it and repair it before saving.'); }
}

async function atomicJson(directory: string, id: string, value: unknown): Promise<void> {
    const content = JSON.stringify(value, null, 2) + '\n';
    if (Buffer.byteLength(content) > MAX_SNAPSHOT_BYTES) throw new LeanReviewError(413, 'This review snapshot exceeds 4 MiB.');
    const temporary = path.join(directory, `.${id}-${crypto.randomBytes(8).toString('hex')}.tmp`);
    try {
        const file = await fileSystem.open(temporary, 'wx', 0o600);
        try { await file.writeFile(content, 'utf8'); await file.sync(); }
        finally { await file.close(); }
        await fileSystem.rename(temporary, path.join(directory, `${id}.json`));
    } finally { await fs.rm(temporary, { force: true }); }
}

export async function readReviewRecord(root: string, id: string): Promise<ReviewRecord | undefined> {
    const value = await readJson(root, 'lean-reviews', id);
    if (value === undefined) return undefined;
    if (value.schemaVersion !== 1 || value.formalId !== formalReviewId(id) || !Number.isInteger(value.revision)
        || value.revision < 1 || !reviewEvidenceShape(value.snapshot) || !decisionShape(value) || value.evidenceFingerprint !== value.snapshot.fingerprint
        || (value.history !== undefined && (!Array.isArray(value.history) || value.history.length > 50
            || value.history.length === 0
            || value.history.some((item: any, index: number) => !decisionShape(item) || item.revision > value.revision
                || (index > 0 && item.revision <= value.history[index - 1].revision))
            || JSON.stringify(decision(value.history[value.history.length - 1])) !== JSON.stringify(decision(value))))
        || (value.historyDropped !== undefined && (!Number.isSafeInteger(value.historyDropped) || value.historyDropped < 0))) {
        throw new LeanReviewError(409, 'Lean review record has an unsupported format; it was preserved.');
    }
    return value;
}

function decisionShape(value: any): boolean {
    const claims = value?.subclaims;
    return !!value && Number.isSafeInteger(value.revision) && value.revision > 0 && VERDICTS.includes(value.verdict)
        && typeof value.scope === 'string' && !!value.scope.trim() && value.scope.length <= 8000 && typeof value.note === 'string' && value.note.length <= 16000
        && typeof value.reviewer === 'string' && value.reviewer.length <= 300 && typeof value.reviewedAt === 'string'
        && Number.isFinite(Date.parse(value.reviewedAt)) && /^[0-9a-f]{64}$/.test(value.evidenceFingerprint)
        && Array.isArray(claims) && claims.length <= 80 && new Set(claims.map((claim: any) => claim?.id)).size === claims.length
        && claims.every((claim: any) => !!claim && typeof claim.id === 'string' && !!claim.id.trim() && claim.id.length <= 100
            && typeof claim.text === 'string' && !!claim.text.trim() && claim.text.length <= 8000
            && typeof claim.note === 'string' && claim.note.length <= 8000 && VERDICTS.includes(claim.verdict)
            && Array.isArray(claim.declarationKeys) && claim.declarationKeys.length <= 100
            && claim.declarationKeys.every((key: any) => typeof key === 'string' && key.length <= 500));
}

function decision(record: ReviewRecord): ReviewDecision {
    return { revision: record.revision, verdict: record.verdict, scope: record.scope, note: record.note,
        reviewer: record.reviewer, reviewedAt: record.reviewedAt, subclaims: record.subclaims, evidenceFingerprint: record.evidenceFingerprint };
}

function appendDecision(record: ReviewRecord, previous?: ReviewRecord): void {
    const history = [...(previous?.history || (previous ? [decision(previous)] : [])), decision(record)];
    let dropped = previous?.historyDropped || 0;
    // Retain at most 50 decisions and 1.5 MiB, while retaining the newest deliberate decision.
    while (history.length > 1 && (history.length > 50 || Buffer.byteLength(JSON.stringify(history)) > 1572864)) {
        history.shift(); dropped++;
    }
    record.history = history; record.historyDropped = dropped;
}

function reviewEvidenceShape(value: any): boolean {
    return !!value && typeof value.fingerprint === 'string' && !!value.statement && typeof value.statement.content === 'string'
        && Array.isArray(value.proofs) && Array.isArray(value.contexts) && Array.isArray(value.projects)
        && Array.isArray(value.declarations) && Array.isArray(value.definitions) && Array.isArray(value.diagnostics);
}

export async function readReviewEvidenceCache(root: string, id: string): Promise<LeanReviewEvidence | undefined> {
    const value = await readJson(root, 'lean-review-evidence', id);
    if (value === undefined) return undefined;
    if (value.schemaVersion !== 1 || value.formalId !== formalReviewId(id) || !reviewEvidenceShape(value.evidence)) {
        throw new LeanReviewError(409, 'Lean evidence cache has an unsupported format; refresh it deliberately.');
    }
    return value.evidence;
}

export async function writeReviewEvidenceCache(root: string, id: string, evidence: LeanReviewEvidence): Promise<void> {
    const directory = (await metadataDirectory(root, 'lean-review-evidence', true))!;
    await atomicJson(directory, formalReviewId(id), { schemaVersion: 1, formalId: formalReviewId(id), evidence });
}

function text(value: unknown, label: string, maximum: number, required = false): string {
    if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
        throw new LeanReviewError(400, `${label} must be ${required ? 'non-empty ' : ''}text of at most ${maximum} characters.`);
    }
    return value;
}

export function reviewSaveInput(value: any): LeanReviewSaveInput {
    const id = formalReviewId(value?.id);
    if (!Number.isInteger(value?.expectedRevision) || value.expectedRevision < 0) throw new LeanReviewError(400, 'An expected review revision is required.');
    if (typeof value?.evidenceFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(value.evidenceFingerprint)) throw new LeanReviewError(400, 'The displayed evidence fingerprint is required.');
    if (!VERDICTS.includes(value?.verdict)) throw new LeanReviewError(400, 'Choose a valid human verdict.');
    if (!Array.isArray(value?.subclaims) || value.subclaims.length > 80) throw new LeanReviewError(400, 'Provide at most 80 human-defined subclaims.');
    const ids = new Set<string>();
    const subclaims: ReviewSubclaim[] = value.subclaims.map((claim: any) => {
        const claimId = text(claim?.id, 'Subclaim ID', 100, true);
        if (ids.has(claimId)) throw new LeanReviewError(400, 'Subclaim IDs must be unique within an object.');
        ids.add(claimId);
        if (!VERDICTS.includes(claim?.verdict) || !Array.isArray(claim?.declarationKeys) || claim.declarationKeys.length > 100
            || claim.declarationKeys.some((key: unknown) => typeof key !== 'string' || key.length > 500)) throw new LeanReviewError(400, 'A subclaim needs a verdict and bounded declaration mappings.');
        return { id: claimId, text: text(claim.text, 'Subclaim text', 8000, true),
            declarationKeys: [...new Set<string>(claim.declarationKeys)], verdict: claim.verdict,
            note: text(claim.note ?? '', 'Subclaim note', 8000) };
    });
    return { id, expectedRevision: value.expectedRevision, evidenceFingerprint: value.evidenceFingerprint,
        verdict: value.verdict, scope: text(value.scope, 'Review scope', 8000, true),
        note: text(value.note ?? '', 'Review note', 16000), reviewer: text(value.reviewer ?? '', 'Reviewer', 300), subclaims };
}

/** Cross-process per-object lock plus revision and fresh-evidence CAS; source files are never written. */
export async function saveReviewRecord(root: string, input: LeanReviewSaveInput,
    freshEvidence: () => Promise<LeanReviewEvidence>): Promise<ReviewRecord> {
    const directory = (await metadataDirectory(root, 'lean-reviews', true))!;
    const lockPath = path.join(directory, `${input.id}.lock`);
    let lock: any;
    try { lock = await fileSystem.open(lockPath, 'wx', 0o600); }
    catch (error: any) {
        if (error?.code === 'EEXIST') throw new LeanReviewError(409, 'Another save owns this object. Reload before retrying; a crashed save may leave a local .lock file.');
        throw error;
    }
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        const previous = await readReviewRecord(root, input.id);
        if ((previous?.revision || 0) !== input.expectedRevision) throw new LeanReviewError(409, 'The review changed in another window. Reload it before saving.');
        // This callback must read current disk sources inside the save lock, never a debounced watcher snapshot.
        const evidence = await freshEvidence();
        if (evidence.fingerprint !== input.evidenceFingerprint) throw new LeanReviewError(409, 'The displayed evidence changed. Reload and review the current source before saving.');
        const declarations = new Set(evidence.declarations.map(declaration => declaration.key));
        for (const claim of input.subclaims) for (const key of claim.declarationKeys) {
            if (!declarations.has(key)) throw new LeanReviewError(400, 'Subclaim mapping references a declaration outside this formal object.');
        }
        const record: ReviewRecord = { schemaVersion: 1, formalId: input.id, revision: (previous?.revision || 0) + 1,
            verdict: input.verdict, scope: input.scope, note: input.note, reviewer: input.reviewer,
            reviewedAt: new Date().toISOString(), subclaims: input.subclaims, evidenceFingerprint: evidence.fingerprint,
            snapshot: evidence };
        appendDecision(record, previous);
        await atomicJson(directory, input.id, record);
        return record;
    } finally { await lock.close(); await fs.rm(lockPath, { force: true }); }
}
