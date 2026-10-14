import * as path from 'node:path';
import { ARCHIVE_DIRECTORY, atomicWrite, canonical, digest, exists, parseJson, readFile, readObject, relative, safePath, sha256, withLock } from './io';
import { cachedObjects, exportExchange, importExchange, projectInputs, readCatalog, readHead, readRetainedHeads, selectRecord } from './catalog';
import { validPolicy, partitionFiles } from './policy';
import { captureSource, hashFiles, equal, compareFiles } from './source';
export { validPolicy } from './policy';
export { captureSource, compareFiles } from './source';
import { defaultVerifier } from './sigstore';
import { prepareArchive, signArchive, volumeStatus } from './transaction';
import type { ArchiveSigner, ArchiveSignOptions } from './transaction';
import type { ArchiveAuthentication, ArchiveExchange, ArchivePointer, ArchivePolicy, ArchiveRecordView, ArchiveVerifier } from './types';
const fs = require('node:fs/promises');

/** Owns project storage and publication; the Reader and CLI use the same operations. */
export class AcademicArchive {
    readonly directory: string;
    constructor(readonly projectRoot: string, readonly verifier: ArchiveVerifier) {
        this.directory = path.join(projectRoot, ARCHIVE_DIRECTORY);
    }
    static async open(projectRoot: string, trustedRoot?: string): Promise<AcademicArchive> {
        return new AcademicArchive(path.resolve(projectRoot), await defaultVerifier(trustedRoot));
    }
    async configured(): Promise<boolean> {
        if (!await exists(this.directory)) return false;
        await safePath(this.projectRoot, ARCHIVE_DIRECTORY);
        return exists(path.join(this.directory, 'policy.json'));
    }
    async policy(): Promise<ArchivePolicy> {
        if (!await this.configured()) throw new Error('Academic archives are not configured for this project.');
        return validPolicy(parseJson(await readFile(this.directory, 'policy.json')));
    }
    async initialize(input: ArchivePolicy): Promise<ArchivePolicy> {
        const policy = validPolicy(input);
        partitionFiles(hashFiles(await captureSource(this.projectRoot, policy.scope)), policy);
        await safePath(this.projectRoot, ARCHIVE_DIRECTORY);
        await fs.mkdir(this.directory, { recursive: true });
        return withLock(this.directory, async () => {
            if (await this.configured()) {
                const old = await this.policy(); if (!equal(old, policy)) throw new Error('This project already has a different archive policy.'); return old;
            }
            await fs.writeFile(await safePath(this.directory, 'policy.json'), canonical(policy), { flag: 'wx' });
            await fs.writeFile(await safePath(this.directory, '.gitignore'), 'LOCK.json\npending/\n*.tmp-*\n', { flag: 'wx' });
            return policy;
        });
    }
    async updatePolicy(input: ArchivePolicy, expectedPolicy?: string): Promise<ArchivePolicy> {
        const policy = validPolicy(input);
        return withLock(this.directory, async () => {
            const old = await this.policy(), bytes = await readFile(this.directory, 'policy.json');
            if (expectedPolicy && sha256(canonical(old)) !== digest(expectedPolicy)) throw new Error('The archive policy changed before this update.');
            if (policy.workId !== old.workId) throw new Error('A policy update cannot change the stable work identity.');
            for (const identity of old.identities) if (!policy.identities.some(item => equal(item, identity))) throw new Error('A policy update must retain accepted historical identities.');
            partitionFiles(hashFiles(await captureSource(this.projectRoot, policy.scope)), policy);
            if (!(await readFile(this.directory, 'policy.json')).equals(bytes)) throw new Error('The archive policy changed during this update.');
            await atomicWrite(this.directory, 'policy.json', canonical(policy));
            return policy;
        });
    }
    private async hiddenIds(): Promise<string[]> {
        if (!await exists(path.join(this.directory, 'visibility.json'))) return [];
        const value = parseJson(await readFile(this.directory, 'visibility.json'), true);
        if (value.schema !== 'math-workspace.archive-visibility/v1' || !Array.isArray(value.hidden) || value.hidden.length > 10000) throw new Error('Invalid local archive visibility.');
        return [...new Set<string>(value.hidden.map(digest))];
    }
    async hide(id: string, retireHead = false) { return this.visibility(id, true, retireHead); }
    async restore(id: string) { return this.visibility(id, false, false); }
    private async visibility(id: string, hidden: boolean, retireHead: boolean) {
        digest(id);
        return withLock(this.directory, async () => {
            const state = await this.records(false, undefined, true), record = selectRecord(state.records, id);
            const ids = new Set(await this.hiddenIds()); hidden ? ids.add(record.id) : ids.delete(record.id);
            if (retireHead) {
                const head = await readHead(this.directory);
                const retained = await readRetainedHeads(this.directory);
                const alreadyRetained = retained.some(old => old.pointer.record === record.payload && old.pointer.bundle === record.bundle);
                const active = head?.pointer.record === record.payload && head?.pointer.bundle === record.bundle;
                if (!hidden || !active && !alreadyRetained) throw new Error('Only the active original head can be explicitly retired.');
                if (!active && (!equal(head?.pointer || null, record.previous || null) || (head?.sequence || 0) !== (record.sequence || 1) - 1)) throw new Error('The active head advanced after retirement; it will not be rolled back.');
                if (active) {
                    if (!alreadyRetained) retained.push(head!);
                    await atomicWrite(this.directory, 'retained-heads.json', canonical({ schema: 'math-workspace.archive-retained-heads/v1',
                        heads: retained.map(old => ({ sequence: old.sequence, ...old.pointer })) }));
                    if (record.previous) await atomicWrite(this.directory, 'HEAD.json', canonical({ schema: 'math-workspace.archive-head/v1', sequence: head!.sequence - 1, ...record.previous }));
                    else await fs.unlink(await safePath(this.directory, 'HEAD.json'));
                }
            }
            await atomicWrite(this.directory, 'visibility.json', canonical({ schema: 'math-workspace.archive-visibility/v1', hidden: [...ids].sort() }));
            return { record: record.id, payload: record.payload, hidden, retiredHead: retireHead, originalEvidencePreserved: true };
        });
    }
    async records(verify = false, progress?: (done: number, total: number) => void, includeHidden = false): Promise<{ records: ArchiveRecordView[]; hiddenRecords: ArchiveRecordView[]; head: ArchivePointer | null; imports: string[]; orphans: string[]; missingObjects: string[] }> {
        const policy = await this.policy();
        const catalog = await readCatalog(this.directory, policy), object = cachedObjects(this.directory);
        // Missing historical source bytes are separate from invalid or missing signature evidence.
        const missingObjects: string[] = [];
        if (verify) for (const hash of catalog.objects) {
            try { await object(hash); } catch (error: any) { if (error.code !== 'ENOENT') throw error; missingObjects.push(hash); }
        }
        const hidden = new Set(await this.hiddenIds());
        const all = (await projectInputs(catalog.inputs, object, policy, this.verifier, verify, progress)).map(row => ({ ...row, hidden: hidden.has(row.id) }));
        return { records: includeHidden ? all : all.filter(row => !row.hidden), hiddenRecords: all.filter(row => row.hidden), head: catalog.head, imports: catalog.imports, orphans: catalog.orphans, missingObjects };
    }
    async status() {
        if (!await this.configured()) return { configured: false, records: [], pending: [] };
        const policy = await this.policy(), state = await this.records();
        const files = hashFiles(await captureSource(this.projectRoot, policy.scope));
        const allRecords = [...state.records, ...state.hiddenRecords];
        const headRecord = allRecords.find(record => record.payload === state.head?.record && record.bundle === state.head?.bundle);
        const pendingRoot = await safePath(this.directory, 'pending');
        const pending = [];
        if (await exists(pendingRoot)) for (const name of (await fs.readdir(pendingRoot)).sort()) {
            if (!/^[a-f0-9]{64}$/.test(name)) continue;
            const plan = await exists(path.join(pendingRoot, name, 'plan.json'));
            if (await exists(path.join(pendingRoot, name, 'result.json'))) {
                const result = parseJson(await readFile(this.directory, `pending/${name}/result.json`), true);
                if (allRecords.some(row => row.payload === result.head?.record && row.bundle === result.head?.bundle)) continue;
            }
            const data = await readFile(this.directory, `pending/${name}/${plan ? 'plan' : 'record'}.json`);
            if (sha256(data) !== name) throw new Error('A pending archive record has changed.');
            const record = parseJson(data, true);
            let details = {};
            if (plan) {
                const signedPolicy = validPolicy(parseJson(await readObject(this.directory, record.policy), true)), partition = partitionFiles(record.files, signedPolicy);
                const receipts = await exists(path.join(pendingRoot, name, 'receipts.json')) ? parseJson(await readFile(this.directory, `pending/${name}/receipts.json`), true).volumes : [];
                details = { scheme: 'volume-total', outside: partition.outside, outsideFiles: Object.keys(partition.outside).length, totalSignaturePending: true,
                    volumes: partition.volumes.map(volume => {
                        const item = record.volumes.find(row => row.id === volume.id), receipt = receipts.find(row => row.id === volume.id && row.record === item?.record);
                        const previous = headRecord?.volumes?.find(row => row.id === volume.id);
                        const old = allRecords.find(row => row.payload === previous?.record && row.bundle === previous?.bundle);
                        return { id: volume.id, title: volume.title, files: Object.keys(volume.files).length, fileMap: volume.files,
                            changed: !item?.bundle, reused: !!item?.bundle, signed: !!item?.bundle || !!receipt,
                            record: item?.record, bundle: item?.bundle || receipt?.bundle, changes: compareFiles(old?.files || {}, volume.files) };
                    }) };
            }
            pending.push({ prepared: name, label: record.label, preparedAt: record.preparedAt,
                currentMatches: equal(record.files, files) && equal(record.previous, state.head) && (!plan || record.policy === sha256(canonical(policy))),
                files: Object.keys(record.files).length, scope: record.scope, changes: compareFiles(headRecord?.files || {}, record.files), ...details });
        }
        const partition = partitionFiles(files, policy);
        return { configured: true, policy, policyDigest: sha256(canonical(policy)), ...state, pending,
            current: { files: Object.keys(files).length, coveredByHead: !!headRecord && equal(headRecord.files, files), changes: compareFiles(headRecord?.files || {}, files),
                outside: partition.outside, outsideFiles: Object.keys(partition.outside).length,
                volumes: partition.volumes.map(volume => {
                    const receipt = headRecord?.volumes?.find(row => row.id === volume.id), old = allRecords.find(row => row.payload === receipt?.record && row.bundle === receipt?.bundle);
                    const changed = !old || old.policyDigest !== sha256(canonical(policy)) || !equal(old.files, volume.files);
                    return { id: volume.id, title: volume.title, files: Object.keys(volume.files).length, changed, reused: !changed, reuseRequiresVerification: true,
                        changes: compareFiles(old?.files || {}, volume.files), ...(receipt ? { record: receipt.record, bundle: receipt.bundle } : {}) };
                }) },
            cryptographicVerificationPerformed: false, mathematicalCorrectnessAssessed: false };
    }
    async verify(expectedHead?: string, progress?: (done: number, total: number) => void) {
        const state = await this.records(true, progress, true);
        if (expectedHead && state.head?.record !== digest(expectedHead)) throw new Error('The archive head differs from the independently known head.');
        if (state.orphans.length) throw new Error(`Completed records await publication; resume with archive sign --prepared ${state.orphans[0]}`);
        return { ...state, verified: true, contentComplete: state.records.every(record => record.contentComplete) && !state.missingObjects.length,
            missingReferences: state.records.reduce((sum, record) => sum + record.missing.length, 0),
            externalHeadChecked: !!expectedHead, currentWorkingTreeChecked: false, mathematicalCorrectnessAssessed: false };
    }
    async import(exchange: ArchiveExchange, progress?: (done: number, total: number) => void) {
        return importExchange(this.directory, await this.policy(), exchange, this.verifier, progress);
    }
    async export(record?: string): Promise<ArchiveExchange> { return exportExchange(this.directory, await this.policy(), record); }
    async prepare(label: string) { return prepareArchive(this, label); }
    async sign(prepared: string, signer?: ArchiveSigner, onAuthentication?: (value: ArchiveAuthentication) => void, options: ArchiveSignOptions = {}) {
        return signArchive(this, prepared, signer, onAuthentication, options);
    }
    async record(id: string, verify = false): Promise<ArchiveRecordView> {
        digest(id); const state = await this.records(verify, undefined, true);
        return selectRecord(state.records, id);
    }
    async source(id: string, name: string) {
        relative(name); const record = await this.record(id);
        if (!Object.hasOwn(record.files, name)) throw new Error('The file is not available in this archived snapshot.');
        const data = await readObject(this.directory, record.files[name]);
        if (data.length > 4 * 1024 * 1024 || data.includes(0)) throw new Error('This archived file is available through export, but is too large or binary for text preview.');
        const content = data.toString('utf8');
        if (!Buffer.from(content, 'utf8').equals(data)) throw new Error('This file is not UTF-8 text; use the original-byte export.');
        return { record, filePath: name, sha256: record.files[name], content, source: 'archived-original-bytes' };
    }
    async currentSource(name: string) {
        relative(name); const files = await captureSource(this.projectRoot, (await this.policy()).scope), data = files.get(name);
        if (!data) throw new Error('The file is not in the current declared archive scope.');
        const content = data.toString('utf8');
        if (data.length > 4 * 1024 * 1024 || data.includes(0) || !Buffer.from(content).equals(data)) throw new Error('This current file cannot be previewed as UTF-8 text.');
        return { filePath: name, sha256: sha256(data), content, source: 'current-working-tree' };
    }
    async compare(left: string, right: string) {
        const state = await this.records(false, undefined, true);
        const files = async (id: string) => {
            if (id === 'current') return hashFiles(await captureSource(this.projectRoot, (await this.policy()).scope));
            return selectRecord(state.records, id).files;
        };
        return { left, right, changes: compareFiles(await files(left), await files(right)) };
    }
    async history(query: { filePath?: string; formalId?: string }) {
        if (!query.filePath && !query.formalId) throw new Error('Specify a source path or stable formal identifier.');
        if (query.filePath) relative(query.filePath);
        if (query.formalId && !/^h-[a-f0-9]{16,32}$/.test(query.formalId)) throw new Error('Invalid stable formal identifier.');
        const { records } = await this.records(); const matches = [];
        const object = cachedObjects(this.directory);
        for (const record of records) for (const [name, hash] of Object.entries(record.files)) {
            if (!name.endsWith('.md') || (query.filePath && name !== query.filePath)) continue;
            let line: number | undefined;
            if (query.formalId) {
                const content = (await object(hash)).toString('utf8');
                const expression = new RegExp('(?:^|\\s)#' + query.formalId + '(?=\\W|$)', 'm');
                const found = expression.exec(content); if (!found) continue;
                line = content.slice(0, found.index).split('\n').length;
            }
            matches.push({ recordId: record.id, filePath: name, hash, loggedAt: record.loggedAt, verification: record.verification,
                contentComplete: record.contentComplete, ...(line ? { line } : {}) });
        }
        return { matches, interpretation: 'Earliest available archived occurrence is not a claim of original authorship or mathematical correctness.' };
    }
}
