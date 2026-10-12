import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { formalReviewId, LeanReviewError, reviewHash, reviewPathInside, reviewSafePath } from './lean-evidence';
import type { AuditAnchor, AuditCorrespondence, AuditEvent, AuditIssue, AuditLink, AuditRange, LeanAuditRecord } from './lean-audit';

const nodeFs = require('node:fs/promises');
const MAX_BYTES = 2 * 1024 * 1024;
export const AUDIT_CATEGORIES = ['assumption', 'symbol', 'scope', 'statement', 'proof', 'trust', 'other'] as const;
export const AUDIT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export const AUDIT_VERDICTS = ['aligned', 'partial', 'difference', 'undecided'] as const;
const ACTIONS = ['create-link', 'edit-link', 'recheck-link', 'create-issue', 'update-issue', 'recheck-issue'];
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export function auditText(value: unknown, label: string, maximum: number, required = false): string {
    if (typeof value !== 'string' || value.length > maximum || value.includes('\0') || (required && !value.trim())) {
        throw new LeanReviewError(400, `${label} must be ${required ? 'non-empty ' : ''}text of at most ${maximum} characters.`);
    }
    return value;
}
export function auditId(value: unknown): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new LeanReviewError(400, 'Choose a bounded audit artifact ID.');
    return value;
}
export function auditPath(value: unknown): string {
    const text = auditText(value, 'Audit path', 1000, true);
    if (path.isAbsolute(text) || text.includes('\\') || text.split('/').some(part => part === '..' || part === '.' || !part)) {
        throw new LeanReviewError(400, 'Audit paths must be canonical project-relative paths.');
    }
    return text;
}
export function auditRange(value: any): AuditRange {
    const valid = (position: any) => !!position && Number.isSafeInteger(position.line) && position.line >= 0 && position.line <= 1000000
        && Number.isSafeInteger(position.character) && position.character >= 0 && position.character <= 1000000;
    if (!valid(value?.start) || !valid(value?.end) || value.end.line < value.start.line
        || (value.end.line === value.start.line && value.end.character <= value.start.character)) {
        throw new LeanReviewError(400, 'Choose a non-empty source range with zero-based UTF-16 positions.');
    }
    return { start: { ...value.start }, end: { ...value.end } };
}
export function auditHash(value: unknown): string {
    if (typeof value !== 'string' || !HASH.test(value)) throw new LeanReviewError(400, 'The displayed source/evidence hash is required.');
    return value;
}
export function auditCorrespondences(value: any): AuditCorrespondence[] {
    if (!Array.isArray(value) || value.length > 40) throw new LeanReviewError(400, 'Provide at most 40 explicit assumption/symbol correspondences.');
    return value.map(item => {
        if (!['assumption', 'symbol'].includes(item?.kind)) throw new LeanReviewError(400, 'Correspondence kind must be assumption or symbol.');
        return { kind: item.kind, prose: auditText(item.prose, 'Prose assumption/symbol', 1000, true),
            lean: auditText(item.lean, 'Lean assumption/symbol', 1000, true), note: auditText(item.note ?? '', 'Correspondence note', 4000) };
    });
}

async function directory(root: string, create = false): Promise<string | undefined> {
    const metadata = (await reviewSafePath(root, '.math-workspace'))!;
    const candidate = path.join(metadata, 'lean-audits');
    if (create) await fs.mkdir(candidate, { recursive: true });
    const resolved = await reviewSafePath(root, path.relative(root, candidate), true);
    if (resolved && !reviewPathInside(metadata, resolved)) throw new LeanReviewError(400, 'Audit metadata cannot escape .math-workspace.');
    return resolved;
}
function validAnchor(value: any, side: 'prose' | 'lean'): value is AuditAnchor {
    try {
        if (!value || value.side !== side) return false;
        auditPath(value.filePath); auditRange(value.range); auditHash(value.fileHash); auditHash(value.textHash);
        auditText(value.quote, 'Anchor quote', 6000, true);
        if (reviewHash(value.quote) !== value.textHash) return false;
        if (side === 'prose') auditText(value.snippetKey, 'Prose source identity', 1600, true);
        else { auditText(value.declarationKey, 'Lean declaration identity', 500, true); auditText(value.projectKey, 'Lean project identity', 100, true); }
        if (value.subclaimId !== undefined) { auditText(value.subclaimId, 'Subclaim identity', 100, true); auditHash(value.subclaimHash); }
        return true;
    } catch (_error) { return false; }
}
function validLink(value: any): value is AuditLink {
    try {
        auditId(value?.id);
        if (!validAnchor(value.prose, 'prose') || !validAnchor(value.lean, 'lean') || !AUDIT_VERDICTS.includes(value.verdict)) return false;
        auditText(value.note, 'Link note', 8000); auditText(value.reviewer, 'Reviewer', 300); auditCorrespondences(value.correspondences);
        auditHash(value.checkedEvidenceFingerprint);
        return validDate(value.createdAt) && validDate(value.checkedAt);
    } catch (_error) { return false; }
}
function validIssue(value: any): value is AuditIssue {
    try {
        auditId(value?.id); auditId(value.linkId);
        if (!AUDIT_CATEGORIES.includes(value.category) || !AUDIT_STATUSES.includes(value.status)) return false;
        auditText(value.title, 'Issue title', 500, true); auditText(value.note, 'Issue note', 8000);
        auditText(value.reviewer, 'Reviewer', 300); auditText(value.resolution, 'Issue resolution', 8000);
        if (value.status !== 'open' && !value.resolution.trim()) return false;
        auditHash(value.checkedEvidenceFingerprint);
        auditHash(value.checkedLinkFingerprint);
        return validDate(value.createdAt) && validDate(value.updatedAt);
    } catch (_error) { return false; }
}
function validDate(value: any): boolean { return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)); }
function validTarget(value: any): boolean { return validLink(value) || validIssue(value); }

/** Reject malformed artifacts and preserve bytes. Never recover human decisions by overwriting them. */
export function validateAuditRecord(value: any, root: string, id: string): LeanAuditRecord {
    const unique = (items: any[]) => new Set(items.map(item => item.id)).size === items.length;
    if (!value || value.schemaVersion !== 1 || value.formalId !== formalReviewId(id) || value.projectToken !== reviewHash(root)
        || !Number.isSafeInteger(value.revision) || value.revision < 1 || !validDate(value.updatedAt)
        || !Array.isArray(value.links) || value.links.length > 80 || !value.links.every(validLink) || !unique(value.links)
        || !Array.isArray(value.issues) || value.issues.length > 120 || !value.issues.every(validIssue) || !unique(value.issues)
        || value.issues.some((issue: AuditIssue) => !value.links.some((link: AuditLink) => link.id === issue.linkId))
        || !Array.isArray(value.history) || value.history.length > 120 || !Number.isSafeInteger(value.historyDropped) || value.historyDropped < 0
        || value.history.some((event: any, index: number) => !ACTIONS.includes(event?.action) || !ID.test(event.targetId)
            || !Number.isSafeInteger(event.revision) || event.revision < 1 || event.revision > value.revision
            || (index > 0 && event.revision <= value.history[index - 1].revision) || !validDate(event.at)
            || typeof event.reviewer !== 'string' || event.reviewer.length > 300 || !validTarget(event.after)
            || event.after.id !== event.targetId || (event.before !== undefined && (!validTarget(event.before) || event.before.id !== event.targetId)))) {
        throw new LeanReviewError(409, 'Lean audit record is malformed or belongs to another object/project; its bytes were preserved.');
    }
    return value;
}

export async function readAuditRecord(root: string, idInput: unknown): Promise<LeanAuditRecord | undefined> {
    const id = formalReviewId(idInput), dir = await directory(root);
    if (!dir) return undefined;
    const file = await reviewSafePath(root, path.relative(root, path.join(dir, `${id}.json`)), true);
    if (!file) return undefined;
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new LeanReviewError(413, 'Audit record exceeds the bounded 2 MiB size.');
    let value: any;
    try { value = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (_error) { throw new LeanReviewError(409, 'Lean audit metadata is unreadable; its bytes were preserved.'); }
    return validateAuditRecord(value, root, id);
}
export async function readAllAuditRecords(root: string): Promise<LeanAuditRecord[]> {
    const dir = await directory(root);
    if (!dir) return [];
    const ids = (await fs.readdir(dir)).filter(name => /^h-[0-9a-f]+\.json$/.test(name)).map(name => name.slice(0, -5));
    if (ids.length > 500) throw new LeanReviewError(413, 'Project audit reports are limited to 500 recorded objects; no incomplete report is exported.');
    const records: LeanAuditRecord[] = [];
    for (const id of ids.sort()) records.push((await readAuditRecord(root, id))!);
    return records;
}
export function auditEvent(record: LeanAuditRecord, action: AuditEvent['action'], after: AuditLink | AuditIssue,
    before?: AuditLink | AuditIssue): void {
    record.history.push({ revision: record.revision, action, targetId: after.id, at: record.updatedAt,
        reviewer: after.reviewer, ...(before ? { before } : {}), after });
    while (record.history.length > 1 && (record.history.length > 120 || Buffer.byteLength(JSON.stringify(record.history)) > 1024 * 1024)) {
        record.history.shift(); record.historyDropped++;
    }
}
export function newAuditId(prefix: 'link' | 'issue'): string { return prefix + '-' + crypto.randomBytes(12).toString('hex'); }

/** One file, one cross-process lock, one atomic rename, with all admission checks inside the lock. */
export async function updateAuditRecord(root: string, idInput: unknown, expectedRevision: unknown,
    mutate: (record: LeanAuditRecord) => Promise<void>): Promise<LeanAuditRecord> {
    const id = formalReviewId(idInput);
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw new LeanReviewError(400, 'An expected audit revision is required.');
    const dir = (await directory(root, true))!, lockPath = path.join(dir, `${id}.lock`);
    let lock: any;
    try { lock = await nodeFs.open(lockPath, 'wx', 0o600); }
    catch (error: any) {
        if (error?.code === 'EEXIST') throw new LeanReviewError(409, 'Another audit save owns this object. Reload before retrying; a crashed save may leave a .lock file.');
        throw error;
    }
    let temporary = '';
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        const previous = await readAuditRecord(root, id);
        if ((previous?.revision || 0) !== expectedRevision) throw new LeanReviewError(409, 'Audit changed in another window. Reload before saving.');
        const record: LeanAuditRecord = previous ? JSON.parse(JSON.stringify(previous)) : { schemaVersion: 1, formalId: id,
            projectToken: reviewHash(root), revision: 0, links: [], issues: [], history: [], historyDropped: 0, updatedAt: '' };
        record.revision++; record.updatedAt = new Date().toISOString();
        await mutate(record);
        validateAuditRecord(record, root, id);
        const content = JSON.stringify(record, null, 2) + '\n';
        if (Buffer.byteLength(content) > MAX_BYTES) throw new LeanReviewError(413, 'This audit artifact exceeds 2 MiB; narrow the excerpts or notes.');
        temporary = path.join(dir, `.${id}-${crypto.randomBytes(8).toString('hex')}.tmp`);
        const file = await nodeFs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
        await nodeFs.rename(temporary, path.join(dir, `${id}.json`));
        return record;
    } finally {
        if (temporary) await fs.rm(temporary, { force: true });
        await lock.close(); await fs.rm(lockPath, { force: true });
    }
}
