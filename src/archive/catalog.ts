import * as path from 'node:path';
import { archiveFormats, projectArchiveRecord } from './formats';
import { canonical, digest, exists, MAX_ARCHIVE_BYTES, MAX_ARCHIVE_OBJECTS, parseJson, readFile, readObject, safePath, sha256, withLock, writeObject } from './io';
import { sameIdentity } from './sigstore';
import type { ArchiveExchange, ArchiveInputRecord, ArchivePointer, ArchivePolicy, ArchiveRecordView, ArchiveVerifier } from './types';
const fs = require('node:fs/promises');

export interface ArchiveImportIndex {
    schema: 'math-workspace.archive-import/v1';
    workId: string;
    records: ArchiveInputRecord[];
    objects: string[];
}
export interface Catalog {
    inputs: ArchiveInputRecord[];
    imports: string[];
    objects: Set<string>;
    head: ArchivePointer | null;
    sequence: number;
    orphans: string[];
}
export function inputId(input: ArchiveInputRecord): string { return sha256(canonical(input)); }
export function selectRecord<T extends { id: string; payload: string }>(records: T[], selector: string): T {
    digest(selector);
    const exact = records.find(record => record.id === selector);
    if (exact) return exact;
    const matches = records.filter(record => record.payload === selector);
    if (matches.length !== 1) throw new Error(matches.length ? 'The archive payload selector is ambiguous; use its record ID.' : 'Archive record not found.');
    return matches[0];
}
export function inputRecord(value: any): ArchiveInputRecord {
    if (!value || typeof value.format !== 'string' || !archiveFormats.has(value.format)) throw new Error('Unknown archive evidence format.');
    if (value.metadata !== undefined && (!value.metadata || typeof value.metadata !== 'object' || Array.isArray(value.metadata))) throw new Error('Archive metadata must be an object.');
    return { format: value.format, payload: digest(value.payload), bundle: digest(value.bundle), ...(value.metadata ? { metadata: value.metadata } : {}) };
}
export async function readHead(store: string): Promise<{ pointer: ArchivePointer; sequence: number } | null> {
    if (!await exists(path.join(store, 'HEAD.json'))) return null;
    const head = parseJson(await readFile(store, 'HEAD.json'), true);
    if (head.schema !== 'math-workspace.archive-head/v1' || !Number.isSafeInteger(head.sequence) || head.sequence < 1) throw new Error('Invalid archive head.');
    return { pointer: { record: digest(head.record), bundle: digest(head.bundle) }, sequence: head.sequence };
}
/** Local retirement retains an exact original branch; it does not rewrite signed history. */
export async function readRetainedHeads(store: string): Promise<Array<{ pointer: ArchivePointer; sequence: number }>> {
    if (!await exists(path.join(store, 'retained-heads.json'))) return [];
    const value = parseJson(await readFile(store, 'retained-heads.json'), true);
    if (value.schema !== 'math-workspace.archive-retained-heads/v1' || !Array.isArray(value.heads) || value.heads.length > 5000) throw new Error('Invalid retained archive heads.');
    return value.heads.map(head => {
        if (!Number.isSafeInteger(head.sequence) || head.sequence < 1) throw new Error('Invalid retained archive sequence.');
        return { pointer: { record: digest(head.record), bundle: digest(head.bundle) }, sequence: head.sequence };
    });
}
export async function readCatalog(store: string, policy: ArchivePolicy): Promise<Catalog> {
    const imports: string[] = [], inputs: ArchiveInputRecord[] = [], objects = new Set<string>();
    const importDir = await safePath(store, 'imports');
    if (await exists(importDir)) {
        const names = (await fs.readdir(importDir)).sort();
        if (names.length > 5000) throw new Error('Too many archive imports.');
        for (const name of names) {
            if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error('Unexpected archive import file.');
            const data = await readFile(store, `imports/${name}`), hash = digest(name.slice(0, -5));
            if (sha256(data) !== hash) throw new Error('An immutable archive import has changed.');
            const index = parseJson(data, true) as ArchiveImportIndex;
            if (index.schema !== 'math-workspace.archive-import/v1' || index.workId !== policy.workId
                || !Array.isArray(index.records) || !Array.isArray(index.objects) || index.objects.length > MAX_ARCHIVE_OBJECTS) throw new Error('Invalid archive import index.');
            imports.push(hash); objects.add(hash); index.objects.forEach(hash => objects.add(digest(hash)));
            inputs.push(...index.records.map(inputRecord));
        }
    }
    const head = await readHead(store);
    const retained = await readRetainedHeads(store);
    const seen = new Map<string, { bundle: string; sequence: number }>();
    const volumeInputs: ArchiveInputRecord[] = [];
    const walk = async (start: { pointer: ArchivePointer; sequence: number } | null) => {
        let pointer = start?.pointer || null, sequence = start?.sequence || 0;
        const chain = new Set<string>();
        while (pointer) {
            if (chain.has(pointer.record)) throw new Error('Archive chain contains a cycle.'); chain.add(pointer.record);
            if (seen.has(pointer.record)) {
                const old = seen.get(pointer.record)!;
                if (old.bundle !== pointer.bundle || old.sequence !== sequence) throw new Error('Retained archive predecessor bundle or sequence differs.');
                break;
            }
            const payload = await readFile(store, `entries/${pointer.record}/record.json`);
            const bundle = await readFile(store, `entries/${pointer.record}/record.bundle`);
            if (sha256(payload) !== pointer.record || sha256(bundle) !== pointer.bundle) throw new Error('Archive chain receipt has changed.');
            const record = parseJson(payload, true);
            if (!['math-workspace.archive-record/v1', 'math-workspace.archive-total/v1'].includes(record.schema)
                || record.workId !== policy.workId || record.sequence !== sequence) throw new Error('Archive chain sequence or work identity differs.');
            seen.set(pointer.record, { bundle: pointer.bundle, sequence });
            inputs.push({ format: record.schema, payload: pointer.record, bundle: pointer.bundle });
            objects.add(pointer.record); objects.add(pointer.bundle);
            Object.values(record.files || {}).forEach(hash => objects.add(digest(hash)));
            if (record.schema === 'math-workspace.archive-total/v1') {
                objects.add(digest(record.policy));
                if (!Array.isArray(record.volumes)) throw new Error('Invalid total volume bindings.');
                for (const item of record.volumes) {
                    const payload = digest(item.record), bundle = digest(item.bundle);
                    volumeInputs.push({ format: 'math-workspace.archive-volume/v1', payload, bundle });
                    objects.add(payload); objects.add(bundle);
                }
            }
            if (!Array.isArray(record.imports) || record.imports.some(hash => !imports.includes(digest(hash)))) throw new Error('An archive import bound by the chain is missing.');
            pointer = record.previous === null ? null : { record: digest(record.previous?.record), bundle: digest(record.previous?.bundle) };
            sequence--;
        }
        if (!pointer && sequence !== 0) throw new Error('Archive chain ended before its first entry.');
    };
    await walk(head);
    for (const old of retained) await walk(old);
    inputs.push(...volumeInputs);
    const entryDir = await safePath(store, 'entries');
    const orphans = await exists(entryDir) ? (await fs.readdir(entryDir)).filter(name => !seen.has(name)).map(digest) : [];
    const unique = new Map<string, ArchiveInputRecord>();
    for (const input of inputs) {
        const key = `${input.format}:${input.payload}:${input.bundle}`;
        const old = unique.get(key);
        if (old && inputId(old) !== inputId(input)) throw new Error('Duplicate signature has conflicting import metadata.');
        unique.set(key, input);
    }
    return { inputs: [...unique.values()], imports, objects, head: head?.pointer || null, sequence: head?.sequence || 0, orphans };
}
export async function projectInputs(inputs: ArchiveInputRecord[], object: (hash: string) => Promise<any>, policy: ArchivePolicy,
    verifier: ArchiveVerifier, verify = false, progress: (done: number, total: number) => void = () => {}): Promise<ArchiveRecordView[]> {
    const views: ArchiveRecordView[] = [];
    for (const [index, input] of inputs.entries()) {
        const payload = await object(input.payload), bundle = await object(input.bundle);
        const projection = await projectArchiveRecord({ input, payload, object });
        if (projection.workId !== policy.workId) throw new Error('Imported evidence belongs to another work.');
        const info = verify ? await verifier.verify(payload, bundle, policy.identities) : await verifier.inspect(bundle);
        if (info.digest !== input.payload) throw new Error('Archive payload and bundle do not match.');
        if (!policy.identities.some(identity => sameIdentity(identity, info.identity))) throw new Error('Archive signer is not accepted by the project policy.');
        if (projection.signer && !sameIdentity(projection.signer, info.identity)) throw new Error('The signed author identity differs from the signing certificate.');
        if (verify) for (const extra of projection.additionalSignatures || []) await verifier.verify(await object(extra.payload), await object(extra.bundle), policy.identities);
        views.push({ ...projection, id: inputId(input), format: input.format, payload: input.payload, bundle: input.bundle,
            identity: info.identity, loggedAt: info.loggedAt, timestampCount: info.timestampCount,
            verification: verify ? 'verified' : 'unchecked', contentComplete: projection.missing.length === 0 });
        progress(index + 1, inputs.length);
    }
    const byReceipt = new Map(views.map(view => [`${view.payload}:${view.bundle}`, view]));
    for (const view of views) {
        if (view.legacyArchive) {
            const index = parseJson(await object(view.legacyArchive), true);
            for (const row of index.records) if (!byReceipt.has(`${row.manifest_sha256}:${row.bundle_sha256}`)) throw new Error('The OET continuation is missing a bound legacy signature.');
        }
        for (const hash of view.imports || []) {
            const imported = parseJson(await object(hash), true);
            for (const input of imported.records) if (!byReceipt.has(`${input.payload}:${input.bundle}`)) throw new Error('A snapshot is missing a signature from its bound import.');
        }
        for (const receipt of view.volumes || []) {
            const volume = byReceipt.get(`${receipt.record}:${receipt.bundle}`);
            if (!volume || volume.format !== 'math-workspace.archive-volume/v1' || volume.volumeId !== receipt.id
                || volume.policyDigest !== view.policyDigest || !sameIdentity(volume.identity, view.identity)) throw new Error('A total is missing the exact original volume signature.');
        }
        if (!view.previous) continue;
        const previous = byReceipt.get(`${view.previous.record}:${view.previous.bundle}`);
        if (!previous || previous.sequence !== view.sequence! - 1 || !(previous.format === view.format || view.format === 'math-workspace.archive-total/v1' && previous.format === 'math-workspace.archive-record/v1')) throw new Error('Archive predecessor or original predecessor bundle is missing.');
    }
    return views.sort((a, b) => (b.loggedAt || '').localeCompare(a.loggedAt || '') || a.id.localeCompare(b.id));
}
export function cachedObjects(store: string): (hash: string) => Promise<any> {
    const cache = new Map<string, Promise<any>>();
    return hash => { digest(hash); if (!cache.has(hash)) cache.set(hash, readObject(store, hash)); return cache.get(hash)!; };
}
export async function importExchange(store: string, policy: ArchivePolicy, exchange: ArchiveExchange, verifier: ArchiveVerifier,
    progress?: (done: number, total: number) => void): Promise<{ imported: string; records: number; objects: number; alreadyPresent: boolean }> {
    if (exchange?.schema !== 'math-workspace.archive-exchange/v1' || exchange.workId !== policy.workId
        || !Array.isArray(exchange.records) || !exchange.records.length || exchange.records.length > 10000
        || !exchange.objects || typeof exchange.objects !== 'object' || Array.isArray(exchange.objects)) throw new Error('Invalid academic archive exchange document.');
    const hashes = Object.keys(exchange.objects);
    if (hashes.length > MAX_ARCHIVE_OBJECTS) throw new Error('Archive exchange has too many objects.');
    let totalBytes = 0;
    const bytes = new Map<string, any>();
    for (const hash of hashes) {
        digest(hash); const encoded = exchange.objects[hash];
        if (typeof encoded !== 'string') throw new Error('Archive objects must use base64.');
        const data = Buffer.from(encoded, 'base64');
        if (data.toString('base64') !== encoded || sha256(data) !== hash) throw new Error('Archive exchange object bytes do not match their full digest.');
        totalBytes += data.length; if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('Archive exchange exceeds its byte limit.');
        bytes.set(hash, data);
    }
    const object = async (hash: string) => {
        const data = bytes.get(digest(hash));
        if (!data) { const error: any = new Error(`Exchange is missing original evidence: ${hash}`); error.code = 'ENOENT'; throw error; }
        return data;
    };
    const records = exchange.records.map(inputRecord);
    await projectInputs(records, object, policy, verifier, true, progress);
    const index: ArchiveImportIndex = { schema: 'math-workspace.archive-import/v1', workId: policy.workId, records, objects: hashes.sort() };
    const data = canonical(index), imported = sha256(data);
    return withLock(store, async () => {
        const livePolicy = parseJson(await readFile(store, 'policy.json'));
        if (!canonical(livePolicy).equals(canonical(policy))) throw new Error('Archive policy changed during import.');
        const before = await readCatalog(store, policy);
        const allInputs = [...before.inputs, ...records];
        const combined = new Map<string, ArchiveInputRecord>();
        for (const input of allInputs) {
            const key = `${input.format}:${input.payload}:${input.bundle}`, existing = combined.get(key);
            if (existing && inputId(existing) !== inputId(input)) throw new Error('Import would alter metadata for an existing receipt.');
            combined.set(key, input);
        }
        await fs.mkdir(path.join(store, 'imports'), { recursive: true });
        const target = await safePath(store, `imports/${imported}.json`);
        const alreadyPresent = await exists(target);
        if (alreadyPresent) {
            if (!(await readFile(store, `imports/${imported}.json`)).equals(data)) throw new Error('Imported index was modified.');
            for (const hash of hashes) if (!(await readObject(store, hash)).equals(bytes.get(hash))) throw new Error('Imported object was modified.');
        } else {
            for (const value of bytes.values()) await writeObject(store, value);
            await writeObject(store, data);
            await fs.writeFile(target, data, { flag: 'wx' });
        }
        return { imported, records: records.length, objects: hashes.length, alreadyPresent };
    });
}
export async function exportExchange(store: string, policy: ArchivePolicy, recordId?: string): Promise<ArchiveExchange> {
    const catalog = await readCatalog(store, policy);
    let inputs = catalog.inputs, hashes = catalog.objects;
    if (recordId) {
        const selected = selectRecord(catalog.inputs.map(item => ({ ...item, id: inputId(item) })), recordId);
        const { id: _, ...input } = selected;
        if (input.format === 'math-workspace.archive-volume/v1') {
            const payload = await readObject(store, input.payload), object = cachedObjects(store);
            const projection = await projectArchiveRecord({ input, payload, object });
            inputs = [input];
            hashes = new Set([input.payload, input.bundle, projection.policyDigest!, ...Object.values(projection.files)]);
        }
    }
    const objects: Record<string, string> = {};
    let total = 0;
    for (const hash of [...hashes].sort()) {
        let data: any;
        try { data = await readObject(store, hash); }
        catch (error: any) { if (error.code !== 'ENOENT') throw error; continue; }
        total += data.length;
        if (total > MAX_ARCHIVE_BYTES) throw new Error('Archive export exceeds its byte limit.');
        objects[hash] = data.toString('base64');
    }
    // Original signature payloads/bundles remain mandatory, even when historical source bytes are absent.
    for (const input of inputs) if (!objects[input.payload] || !objects[input.bundle]) throw new Error('Archive export is missing original signature evidence.');
    return { schema: 'math-workspace.archive-exchange/v1', workId: policy.workId, records: inputs, objects };
}
