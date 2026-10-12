import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { formalReviewId, LeanReviewError, reviewHash, reviewSafePath } from './lean-evidence';
import { auditHash, auditId, auditText, AUDIT_CATEGORIES } from './lean-audit-store';
import type { LeanAssistanceBinding, LeanAssistanceItemInput, LeanAssistanceRecord, LeanAssistanceTask } from './lean-assistance';
const nodeFs = require('node:fs/promises');
const MAX_BYTES = 1024 * 1024;
export function assistanceTask(value: unknown): LeanAssistanceTask {
    if (!['assumptions', 'statement', 'proof', 'changes'].includes(value as string)) throw new LeanReviewError(400, 'Choose assumptions, statement, proof, or changes.');
    return value as LeanAssistanceTask;
}
function revision(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new LeanReviewError(400, 'Every expected revision is required.');
    return value as number;
}
export function assistanceBinding(value: any): LeanAssistanceBinding {
    return { projectToken: auditHash(value?.projectToken), id: formalReviewId(value?.id), evidenceFingerprint: auditHash(value?.evidenceFingerprint),
        reviewRevision: revision(value?.reviewRevision), auditRevision: revision(value?.auditRevision), candidateRevision: revision(value?.candidateRevision) };
}
export function assistanceItem(value: any): LeanAssistanceItemInput {
    if (!value || Object.keys(value).some(key => !['category', 'title', 'note', 'declarationKeys'].includes(key))) {
        throw new LeanReviewError(400, 'Candidates accept only category, title, note, and declarationKeys; no verdict or human decision.');
    }
    if (!AUDIT_CATEGORIES.includes(value.category)) throw new LeanReviewError(400, 'Choose a candidate category.');
    if (!Array.isArray(value.declarationKeys) || value.declarationKeys.length > 12) throw new LeanReviewError(400, 'Provide at most 12 declaration keys.');
    return { category: value.category, title: auditText(value.title, 'Candidate title', 500, true), note: auditText(value.note, 'Candidate explanation', 4000, true),
        declarationKeys: [...new Set<string>(value.declarationKeys.map((key: unknown) => auditText(key, 'Declaration key', 500, true)))] };
}
async function directory(root: string, create = false): Promise<string | undefined> {
    const metadata = (await reviewSafePath(root, '.math-workspace'))!, dir = path.join(metadata, 'lean-assistance');
    // A candidate directory is never allowed to redirect writes into source or human metadata.
    try { if ((await nodeFs.lstat(dir)).isSymbolicLink()) throw new LeanReviewError(400, 'Candidate metadata must not be a symlink.'); }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    if (create) await fs.mkdir(dir, { recursive: true });
    return reviewSafePath(root, path.relative(root, dir), true);
}
export async function readAssistanceRecord(root: string, idInput: unknown): Promise<LeanAssistanceRecord | undefined> {
    const id = formalReviewId(idInput), dir = await directory(root); if (!dir) return undefined;
    const file = path.join(dir, id + '.json');
    let stat: any;
    try { stat = await nodeFs.lstat(file); } catch (error: any) { if (error?.code === 'ENOENT') return undefined; throw error; }
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new LeanReviewError(409, 'Candidate metadata is not a bounded regular file; its bytes were preserved.');
    let record: LeanAssistanceRecord;
    try {
        record = JSON.parse(await fs.readFile(file, 'utf8'));
        if (record.schemaVersion !== 1 || record.projectToken !== reviewHash(root) || record.formalId !== id || revision(record.revision) < 1
            || !Array.isArray(record.candidates) || record.candidates.length > 80 || revision(record.dropped) < 0) throw new Error();
        const ids = new Set();
        for (const item of record.candidates) {
            auditId(item.id); if (ids.has(item.id)) throw new Error(); ids.add(item.id);
            const binding = assistanceBinding(item.binding);
            if (binding.id !== id || binding.projectToken !== record.projectToken || binding.candidateRevision >= record.revision) throw new Error();
            assistanceTask(item.task); assistanceItem({ category: item.category, title: item.title, note: item.note, declarationKeys: item.declarationKeys });
            if (!['pending', 'ignored'].includes(item.status) || !Number.isFinite(Date.parse(item.createdAt))) throw new Error();
        }
    } catch (_error) { throw new LeanReviewError(409, 'Candidate metadata is malformed or belongs to another object/project; its bytes were preserved.'); }
    return record;
}
/** Independent candidate CAS lock and atomic file; never opens human review/audit files for writes. */
export async function updateAssistanceRecord(root: string, binding: LeanAssistanceBinding,
    mutate: (record: LeanAssistanceRecord) => Promise<void>): Promise<LeanAssistanceRecord> {
    const dir = (await directory(root, true))!, lockPath = path.join(dir, binding.id + '.lock'); let lock: any;
    try { lock = await nodeFs.open(lockPath, 'wx', 0o600); }
    catch (error: any) { if (error?.code === 'EEXIST') throw new LeanReviewError(409, 'Another candidate save owns this object. Reload before retrying.'); throw error; }
    let temporary = '';
    try {
        const previous = await readAssistanceRecord(root, binding.id);
        if ((previous?.revision || 0) !== binding.candidateRevision) throw new LeanReviewError(409, 'Candidates changed in another window. Read current context before retrying.');
        const record: LeanAssistanceRecord = previous || { schemaVersion: 1, formalId: binding.id, projectToken: reviewHash(root), revision: 0, candidates: [], dropped: 0 };
        await mutate(record); record.revision++;
        while (record.candidates.length > 80 || Buffer.byteLength(JSON.stringify(record, null, 2)) > MAX_BYTES - 8192) { record.candidates.shift(); record.dropped++; }
        temporary = path.join(dir, `.${binding.id}-${crypto.randomBytes(8).toString('hex')}.tmp`);
        const file = await nodeFs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(record, null, 2) + '\n', 'utf8'); await file.sync(); } finally { await file.close(); }
        await nodeFs.rename(temporary, path.join(dir, binding.id + '.json')); return record;
    } finally { if (temporary) await fs.rm(temporary, { force: true }); await lock.close(); await fs.rm(lockPath, { force: true }); }
}
