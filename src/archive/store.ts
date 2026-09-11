import * as path from 'node:path';
import { ARCHIVE_DIRECTORY, atomicWrite, canonical, digest, exists, MAX_SOURCE_BYTES, parseJson, readFile, readObject, relative, safePath, sha256, withLock, writeObject } from './io';
import { cachedObjects, exportExchange, importExchange, inputId, projectInputs, readCatalog, readHead } from './catalog';
import { projectArchiveRecord, validScope } from './formats';
import { defaultVerifier, runProcess, sameIdentity, SigstoreVerifier, validIdentity } from './sigstore';
import type { ArchiveExchange, ArchiveNativeRecord, ArchivePointer, ArchivePolicy, ArchiveRecordView, ArchiveScope, ArchiveVerifier } from './types';
const fs = require('node:fs/promises');

export function validPolicy(value: any): ArchivePolicy {
    if (value?.schema !== 'math-workspace.archive-policy/v1' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.workId || '')
        || typeof value.title !== 'string' || !value.title || value.title.length > 300
        || !Array.isArray(value.identities) || !value.identities.length || value.identities.length > 32) throw new Error('Invalid academic archive policy.');
    const identities = value.identities.map(validIdentity), signingIdentity = validIdentity(value.signingIdentity);
    if (!identities.some(identity => sameIdentity(identity, signingIdentity))) throw new Error('The active signer must be an accepted project identity.');
    return { schema: value.schema, workId: value.workId, title: value.title, scope: validScope(value.scope), identities, signingIdentity };
}
export async function captureSource(projectRoot: string, scope: ArchiveScope): Promise<Map<string, any>> {
    scope = validScope(scope);
    const files = new Map<string, any>(); let total = 0;
    const excluded = new Set(['.git', '.math-archive', '.signatures', 'node_modules', 'out', 'dist']);
    const visit = async (name: string, depth: number, explicit: boolean) => {
        const file = await safePath(projectRoot, name), stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) throw new Error('Snapshot inputs cannot be symbolic links.');
        if (scope.exclude?.some(prefix => name === prefix || name.startsWith(prefix + '/'))) return;
        if (name.split('/').includes(ARCHIVE_DIRECTORY) || name.split('/').includes('.git')) throw new Error('An archive cannot include itself or Git internals.');
        if (stat.isDirectory()) {
            if (depth >= (scope.maxDepth || 100)) return;
            const names = (await fs.readdir(file)).sort();
            for (const child of names) {
                if (child.startsWith('.') || excluded.has(child)) continue;
                await visit(`${name}/${child}`, depth + 1, false);
            }
        } else if (stat.isFile() && (explicit || scope.extensions.includes(path.extname(name).toLowerCase()))) {
            if (files.has(name)) return;
            if (stat.size > MAX_SOURCE_BYTES || total + stat.size > MAX_SOURCE_BYTES || files.size >= 10000) throw new Error('Snapshot exceeds its file or byte limit.');
            const data = await readFile(projectRoot, name, MAX_SOURCE_BYTES); total += data.length;
            files.set(name, data);
        }
    };
    for (const name of scope.paths) await visit(name, 0, true);
    if (!files.size) throw new Error('The declared snapshot scope is empty.');
    return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}
function hashFiles(files: Map<string, any>): Record<string, string> { return Object.fromEntries([...files].map(([name, data]) => [name, sha256(data)])); }
function equal(a: unknown, b: unknown): boolean { return canonical(a).equals(canonical(b)); }
export function compareFiles(previous: Record<string, string>, current: Record<string, string>) {
    return [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort().flatMap(name => {
        if (previous[name] === current[name]) return [];
        return [{ path: name, change: !Object.hasOwn(previous, name) ? 'added' : !Object.hasOwn(current, name) ? 'removed' : 'modified' }];
    });
}

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
        await captureSource(this.projectRoot, policy.scope);
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
    async records(verify = false, progress?: (done: number, total: number) => void): Promise<{ records: ArchiveRecordView[]; head: ArchivePointer | null; imports: string[]; orphans: string[] }> {
        const policy = await this.policy();
        const catalog = await readCatalog(this.directory, policy), object = cachedObjects(this.directory);
        if (verify) for (const hash of catalog.objects) await object(hash);
        const records = await projectInputs(catalog.inputs, object, policy, this.verifier, verify, progress);
        return { records, head: catalog.head, imports: catalog.imports, orphans: catalog.orphans };
    }
    async status() {
        if (!await this.configured()) return { configured: false, records: [], pending: [] };
        const policy = await this.policy(), state = await this.records();
        const files = hashFiles(await captureSource(this.projectRoot, policy.scope));
        const headRecord = state.records.find(record => record.payload === state.head?.record && record.bundle === state.head?.bundle);
        const pendingRoot = await safePath(this.directory, 'pending');
        const pending = [];
        if (await exists(pendingRoot)) for (const name of (await fs.readdir(pendingRoot)).sort()) {
            if (!/^[a-f0-9]{64}$/.test(name)) continue;
            const data = await readFile(this.directory, `pending/${name}/record.json`);
            if (sha256(data) !== name) throw new Error('A pending archive record has changed.');
            const record = parseJson(data, true);
            pending.push({ prepared: name, label: record.label, preparedAt: record.preparedAt, currentMatches: equal(record.files, files),
                files: Object.keys(record.files).length, scope: record.scope, changes: compareFiles(headRecord?.files || {}, record.files) });
        }
        return { configured: true, policy, ...state, pending,
            current: { files: Object.keys(files).length, coveredByHead: !!headRecord && equal(headRecord.files, files), changes: compareFiles(headRecord?.files || {}, files) },
            cryptographicVerificationPerformed: false, mathematicalCorrectnessAssessed: false };
    }
    async verify(expectedHead?: string, progress?: (done: number, total: number) => void) {
        const state = await this.records(true, progress);
        if (expectedHead && state.head?.record !== digest(expectedHead)) throw new Error('The archive head differs from the independently known head.');
        if (state.orphans.length) throw new Error(`Completed records await publication; resume with archive sign --prepared ${state.orphans[0]}`);
        return { ...state, verified: true, contentComplete: state.records.every(record => record.contentComplete),
            missingReferences: state.records.reduce((sum, record) => sum + record.missing.length, 0),
            externalHeadChecked: !!expectedHead, currentWorkingTreeChecked: false, mathematicalCorrectnessAssessed: false };
    }
    async import(exchange: ArchiveExchange, progress?: (done: number, total: number) => void) {
        return importExchange(this.directory, await this.policy(), exchange, this.verifier, progress);
    }
    async export(): Promise<ArchiveExchange> { return exportExchange(this.directory, await this.policy()); }
    async prepare(label: string) {
        if (typeof label !== 'string' || !label.trim() || label.length > 200) throw new Error('A snapshot label between 1 and 200 characters is required.');
        const policy = await this.policy();
        return withLock(this.directory, async () => {
            const state = await this.verify();
            const files = await captureSource(this.projectRoot, policy.scope), hashes = hashFiles(files);
            const headRecord = state.records.find(row => row.payload === state.head?.record && row.bundle === state.head?.bundle);
            if (headRecord && equal(headRecord.files, hashes) && equal(headRecord.imports, state.imports)) {
                return { prepared: headRecord.payload, alreadySigned: true, sequence: headRecord.sequence, changes: [] };
            }
            let sourceLocator: ArchiveNativeRecord['sourceLocator'];
            try {
                const commit = (await runProcess('git', ['-C', this.projectRoot, 'rev-parse', 'HEAD'])).trim();
                if (/^[a-f0-9]{40,64}$/.test(commit)) sourceLocator = { gitBaseCommit: commit, meaning: 'Git is a locator; archived files contain the actual working-tree bytes.' };
            } catch (_) { /* Archives also support projects without Git. */ }
            const record: ArchiveNativeRecord = {
                schema: 'math-workspace.archive-record/v1', workId: policy.workId, label: label.trim(),
                sequence: headRecord ? headRecord.sequence! + 1 : 1, preparedAt: new Date().toISOString(), signer: policy.signingIdentity,
                previous: state.head, imports: state.imports, scope: policy.scope, files: hashes, ...(sourceLocator ? { sourceLocator } : {})
            };
            const data = canonical(record), prepared = sha256(data);
            const pending = await safePath(this.directory, `pending/${prepared}`);
            await fs.mkdir(pending, { recursive: true });
            for (const bytes of files.values()) await writeObject(this.directory, bytes);
            await writeObject(this.directory, data);
            const target = path.join(pending, 'record.json');
            if (await exists(target)) {
                if (!(await readFile(this.directory, `pending/${prepared}/record.json`)).equals(data)) throw new Error('A prepared record was modified.');
            } else await fs.writeFile(target, data, { flag: 'wx' });
            return { prepared, alreadySigned: false, sequence: record.sequence, label: record.label, files: files.size,
                changes: compareFiles(headRecord?.files || {}, hashes), signatureCreated: false };
        });
    }
    async sign(prepared: string, signer?: (recordPath: string, bundlePath: string) => Promise<void>) {
        digest(prepared); const policy = await this.policy(), policyBytes = await readFile(this.directory, 'policy.json');
        return withLock(this.directory, async () => {
            const pending = await safePath(this.directory, `pending/${prepared}`), destination = await safePath(this.directory, `entries/${prepared}`);
            const directory = await exists(pending) ? pending : destination;
            const payload = await readFile(directory, 'record.json');
            if (sha256(payload) !== prepared) throw new Error('Prepared archive bytes have changed.');
            const record = parseJson(payload, true) as ArchiveNativeRecord;
            await projectArchiveRecord({ input: { format: 'math-workspace.archive-record/v1', payload: prepared, bundle: '0'.repeat(64) },
                payload, object: hash => readObject(this.directory, hash) });
            const before = await this.records(true);
            if (before.head?.record === prepared) return { signed: true, alreadyPublished: true, head: before.head };
            if (before.orphans.some(hash => hash !== prepared)) throw new Error('Another completed record awaits publication.');
            const checkUnchanged = async () => {
                const currentPolicy = await readFile(this.directory, 'policy.json');
                const currentHead = await readHead(this.directory);
                if (!currentPolicy.equals(policyBytes) || !equal(currentHead?.pointer || null, before.head)
                    || !equal(record.previous, before.head) || record.sequence !== (currentHead?.sequence || 0) + 1
                    || !sameIdentity(record.signer, policy.signingIdentity) || record.workId !== policy.workId || !equal(record.scope, policy.scope)) {
                    throw new Error('The predecessor, scope or signing policy changed; prepare a new record.');
                }
                if (!equal(record.files, hashFiles(await captureSource(this.projectRoot, policy.scope)))) throw new Error('Source files changed after preparation; the archive head was not advanced.');
                const catalog = await readCatalog(this.directory, policy);
                if (!equal(catalog.imports, record.imports)) throw new Error('Imported history changed after preparation.');
                for (const hash of Object.values(record.files)) await readObject(this.directory, hash);
            };
            await checkUnchanged();
            const recordPath = path.join(directory, 'record.json'), bundlePath = path.join(directory, 'record.bundle');
            if (!await exists(bundlePath)) {
                if (signer) await signer(recordPath, bundlePath);
                else {
                    const args = ['sign-blob', '--yes', '--oidc-disable-ambient-providers', '--bundle', bundlePath, recordPath];
                    if (this.verifier instanceof SigstoreVerifier && this.verifier.trustedRoot) args.push('--trusted-root', this.verifier.trustedRoot);
                    await runProcess('cosign', args, { timeout: 15 * 60 * 1000, stream: true });
                }
            }
            if (!(await readFile(directory, 'record.json')).equals(payload)) throw new Error('The prepared record changed during authentication.');
            const bundle = await readFile(directory, 'record.bundle');
            await this.verifier.verify(payload, bundle, [policy.signingIdentity]);
            await checkUnchanged();
            await this.records(true); // Re-read evidence after a possibly long authentication flow.
            await checkUnchanged();
            const bundleHash = await writeObject(this.directory, bundle);
            await writeObject(this.directory, payload);
            if (directory !== destination) {
                await fs.mkdir(path.dirname(destination), { recursive: true });
                if (await exists(destination)) throw new Error('The completed record already exists; it will not be overwritten.');
                await fs.rename(directory, destination);
            }
            const head = { schema: 'math-workspace.archive-head/v1', sequence: record.sequence, record: prepared, bundle: bundleHash };
            await atomicWrite(this.directory, 'HEAD.json', canonical(head));
            return { signed: true, alreadyPublished: false, head: { record: prepared, bundle: bundleHash } };
        });
    }
    async record(id: string, verify = false): Promise<ArchiveRecordView> {
        digest(id); const state = await this.records(verify);
        const record = state.records.find(row => row.id === id);
        if (!record) throw new Error('Archive record not found.'); return record;
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
        const state = await this.records();
        const files = async (id: string) => {
            if (id === 'current') return hashFiles(await captureSource(this.projectRoot, (await this.policy()).scope));
            const record = state.records.find(row => row.id === digest(id));
            if (!record) throw new Error('Choose an available archive record.'); return record.files;
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
