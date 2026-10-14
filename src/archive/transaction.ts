import * as path from 'node:path';
import { atomicWrite, canonical, digest, exists, parseJson, readFile, readObject, safePath, sha256, withLock, writeObject } from './io';
import { readCatalog, readHead } from './catalog';
import { projectArchiveRecord } from './formats';
import { partitionFiles, sameJson } from './policy';
import { captureSource, compareFiles, hashFiles } from './source';
import { deviceAuthentication, normalAuthentication, runProcess, SigstoreVerifier } from './sigstore';
import type { AcademicArchive } from './store';
import type { ArchiveAuthentication, ArchiveAuthFlow, ArchiveIdentity, ArchiveNativeRecord, ArchivePlan, ArchivePointer, ArchiveRecordView, ArchiveTotalRecord, ArchiveVolumeRecord, ArchiveVolumeReceipt } from './types';
const fs = require('node:fs/promises');

export type ArchiveSigner = (recordPath: string, bundlePath: string) => Promise<void>;
export interface ArchiveSignOptions {
    authFlow?: ArchiveAuthFlow;
    onProgress?: (done: number, total: number) => void;
}
export function volumeStatus(files: Record<string, string>, policy: any, records: ArchiveRecordView[], policyDigest: string) {
    const partition = partitionFiles(files, policy);
    return { outside: partition.outside, volumes: partition.volumes.map(volume => {
        const reusable = records.find(record => record.format === 'math-workspace.archive-volume/v1' && record.volumeId === volume.id
            && record.policyDigest === policyDigest && record.verification === 'verified' && record.contentComplete && sameJson(record.files, volume.files));
        const latest = records.find(record => record.format === 'math-workspace.archive-volume/v1' && record.volumeId === volume.id);
        return { id: volume.id, title: volume.title, files: Object.keys(volume.files).length, fileMap: volume.files,
            changed: !reusable, reused: !!reusable, changes: compareFiles(latest?.files || {}, volume.files),
            ...(reusable ? { record: reusable.payload, bundle: reusable.bundle } : {}) };
    }) };
}
export async function prepareArchive(archive: AcademicArchive, label: string) {
    if (typeof label !== 'string' || !label.trim() || label.length > 200) throw new Error('A snapshot label between 1 and 200 characters is required.');
    return withLock(archive.directory, async () => {
        const policy = await archive.policy(), policyBytes = await readFile(archive.directory, 'policy.json');
        const state = await archive.records(true, undefined, true);
        if (state.orphans.length) throw new Error(`Completed records await publication; resume with archive sign --prepared ${state.orphans[0]}`);
        const files = await captureSource(archive.projectRoot, policy.scope), hashes = hashFiles(files), policyObject = canonical(policy);
        const policyHash = sha256(policyObject), head = state.records.find(row => row.payload === state.head?.record && row.bundle === state.head?.bundle);
        if (head?.kind === 'total' && head.policyDigest === policyHash && sameJson(head.files, hashes) && sameJson(head.imports, state.imports)) {
            return { prepared: head.payload, alreadySigned: true, sequence: head.sequence, changes: [], scheme: 'volume-total' };
        }
        const status = volumeStatus(hashes, policy, state.records, policyHash), preparedAt = new Date().toISOString();
        const volumes: ArchivePlan['volumes'] = [];
        for (const volume of status.volumes) {
            if (volume.reused) volumes.push({ id: volume.id, record: volume.record!, bundle: volume.bundle! });
            else {
                const record: ArchiveVolumeRecord = { schema: 'math-workspace.archive-volume/v1', workId: policy.workId,
                    volumeId: volume.id, title: volume.title, preparedAt, signer: policy.signingIdentity, policy: policyHash, files: volume.fileMap };
                volumes.push({ id: volume.id, record: await writeObject(archive.directory, canonical(record)), bundle: null });
            }
        }
        let sourceLocator: ArchivePlan['sourceLocator'];
        try {
            const commit = (await runProcess('git', ['-C', archive.projectRoot, 'rev-parse', 'HEAD'])).trim();
            if (/^[a-f0-9]{40,64}$/.test(commit)) sourceLocator = { gitBaseCommit: commit, meaning: 'Git is a locator; archived files contain the actual working-tree bytes.' };
        } catch (_) { /* Archives also support projects without Git. */ }
        const plan: ArchivePlan = { schema: 'math-workspace.archive-plan/v1', workId: policy.workId, label: label.trim(), sequence: (head?.sequence || 0) + 1,
            preparedAt, signer: policy.signingIdentity, previous: state.head, imports: state.imports, scope: policy.scope, policy: policyHash,
            files: hashes, volumes, ...(sourceLocator ? { sourceLocator } : {}) };
        if (!(await readFile(archive.directory, 'policy.json')).equals(policyBytes) || !sameJson((await readHead(archive.directory))?.pointer || null, state.head)
            || !sameJson(hashes, hashFiles(await captureSource(archive.projectRoot, policy.scope)))) throw new Error('Source, head or signing policy changed during preparation.');
        for (const bytes of files.values()) await writeObject(archive.directory, bytes);
        await writeObject(archive.directory, policyObject);
        const data = canonical(plan), prepared = sha256(data), pending = await safePath(archive.directory, `pending/${prepared}`);
        await fs.mkdir(pending, { recursive: true });
        await fs.writeFile(path.join(pending, 'plan.json'), data, { flag: 'wx' });
        return { prepared, alreadySigned: false, scheme: 'volume-total', sequence: plan.sequence, label: plan.label, files: files.size,
            volumes: status.volumes.map(({ fileMap, ...view }) => ({ ...view, record: volumes.find(item => item.id === view.id)!.record })),
            outside: status.outside, outsideFiles: Object.keys(status.outside).length, totalSignaturePending: true,
            changes: compareFiles(head?.files || {}, hashes), signatureCreated: false };
    });
}
async function signBundle(archive: AcademicArchive, directory: string, payload: any, signer: ArchiveSigner | undefined,
    onAuthentication: ((value: ArchiveAuthentication) => void) | undefined, authFlow: ArchiveAuthFlow, identity: ArchiveIdentity): Promise<any> {
    await fs.mkdir(directory, { recursive: true });
    const recordPath = path.join(directory, 'record.json'), bundlePath = path.join(directory, 'record.bundle');
    if (await exists(recordPath)) {
        if (!(await readFile(directory, 'record.json')).equals(payload)) throw new Error('The prepared record changed during authentication.');
    } else await fs.writeFile(recordPath, payload, { flag: 'wx' });
    if (!await exists(bundlePath)) {
        if (signer) await signer(recordPath, bundlePath);
        else {
            const args = ['sign-blob', '--yes', '--oidc-disable-ambient-providers', '--fulcio-auth-flow', authFlow, '--timeout', '15m', '--bundle', bundlePath, recordPath];
            if (archive.verifier instanceof SigstoreVerifier && archive.verifier.trustedRoot) args.push('--trusted-root', archive.verifier.trustedRoot);
            const output = { stdout: '', stderr: '' }; let authenticationUrl = '';
            await runProcess('cosign', args, { timeout: 15 * 60 * 1000, stream: true, onOutput: (chunk, stream) => {
                output[stream] = (output[stream] + chunk).slice(-16000);
                const authentication = authFlow === 'normal' ? normalAuthentication(output[stream]) : deviceAuthentication(output[stream]);
                if (authentication && authentication.url !== authenticationUrl) { authenticationUrl = authentication.url; onAuthentication?.(authentication); }
            } });
        }
    }
    if (!(await readFile(directory, 'record.json')).equals(payload)) throw new Error('The prepared record changed during authentication.');
    const bundle = await readFile(directory, 'record.bundle');
    const info = await archive.verifier.verify(payload, bundle, [identity]);
    if (info.digest !== sha256(payload)) throw new Error('The original signature bundle does not bind the prepared payload.');
    return bundle;
}
export async function signArchive(archive: AcademicArchive, prepared: string, signer?: ArchiveSigner,
    onAuthentication?: (value: ArchiveAuthentication) => void, options: ArchiveSignOptions = {}) {
    digest(prepared);
    const authFlow = options.authFlow || 'normal';
    if (!['normal', 'device'].includes(authFlow)) throw new Error('Archive authentication flow must be normal or device.');
    return withLock(archive.directory, async () => {
        const policy = await archive.policy(), policyBytes = await readFile(archive.directory, 'policy.json');
        const before = await archive.records(true, undefined, true);
        if (before.head?.record === prepared) return { signed: true, alreadyPublished: true, head: before.head };
        const pending = await safePath(archive.directory, `pending/${prepared}`);
        const pendingPlan = await exists(path.join(pending, 'plan.json'));
        let plan: ArchivePlan | ArchiveTotalRecord | ArchiveNativeRecord, directory: string;
        if (pendingPlan) {
            const data = await readFile(pending, 'plan.json');
            if (sha256(data) !== prepared) throw new Error('Prepared archive bytes have changed.');
            plan = parseJson(data, true); directory = pending;
            if (plan.schema !== 'math-workspace.archive-plan/v1') throw new Error('Invalid prepared volume signing operation.');
            if (await exists(path.join(pending, 'result.json'))) {
                const result = parseJson(await readFile(pending, 'result.json'), true);
                if (before.head?.record === result.head?.record && before.head?.bundle === result.head?.bundle) return { signed: true, alreadyPublished: true, head: before.head };
            }
        } else {
            directory = await safePath(archive.directory, `entries/${prepared}`);
            const data = await readFile(directory, 'record.json');
            if (sha256(data) !== prepared) throw new Error('Completed archive bytes have changed.');
            plan = parseJson(data, true);
            if (plan.schema !== 'math-workspace.archive-total/v1' && plan.schema !== 'math-workspace.archive-record/v1') throw new Error('Choose a prepared volume signing operation or completed original record.');
        }
        let allowedOrphan = prepared;
        if (pendingPlan) {
            if (await exists(path.join(pending, 'total/record.json'))) allowedOrphan = sha256(await readFile(pending, 'total/record.json'));
            else if (await exists(path.join(pending, 'result.json'))) allowedOrphan = digest(parseJson(await readFile(pending, 'result.json'), true).head?.record);
            else if (await exists(path.join(pending, 'receipts.json'))) {
                const receipts = parseJson(await readFile(pending, 'receipts.json'), true).volumes;
                if (Array.isArray(receipts) && receipts.length === (plan as ArchivePlan).volumes.length) {
                    const { schema: _, volumes: __, ...base } = plan as ArchivePlan;
                    allowedOrphan = sha256(canonical({ ...base, schema: 'math-workspace.archive-total/v1', volumes: receipts }));
                }
            } else if (!(plan as ArchivePlan).volumes.length) {
                const { schema: _, volumes: __, ...base } = plan as ArchivePlan;
                allowedOrphan = sha256(canonical({ ...base, schema: 'math-workspace.archive-total/v1', volumes: [] }));
            }
        }
        if (pendingPlan && before.head?.record === allowedOrphan) return { signed: true, alreadyPublished: true, head: before.head };
        if (before.orphans.some(hash => hash !== allowedOrphan)) throw new Error('Another completed record awaits publication.');
        const checkUnchanged = async () => {
            const currentHead = await readHead(archive.directory);
            if (!(await readFile(archive.directory, 'policy.json')).equals(policyBytes) || !sameJson(currentHead?.pointer || null, before.head)
                || !sameJson(plan.previous, before.head) || plan.sequence !== (currentHead?.sequence || 0) + 1 || plan.workId !== policy.workId
                || !sameJson(plan.signer, policy.signingIdentity) || !sameJson(plan.scope, policy.scope)
                || plan.schema !== 'math-workspace.archive-total/v1' && plan.schema !== 'math-workspace.archive-plan/v1' && pendingPlan) {
                throw new Error('The predecessor, scope or signing policy changed; prepare a new record.');
            }
            if (plan.schema !== 'math-workspace.archive-record/v1' && plan.policy !== sha256(canonical(policy))) throw new Error('The signed policy changed; prepare a new record.');
            if (!sameJson(plan.files, hashFiles(await captureSource(archive.projectRoot, policy.scope)))) throw new Error('Source files changed after preparation; the archive head was not advanced.');
            const catalog = await readCatalog(archive.directory, policy);
            if (!sameJson(catalog.imports, plan.imports)) throw new Error('Imported history changed after preparation.');
            for (const hash of Object.values(plan.files)) await readObject(archive.directory, hash);
        };
        await checkUnchanged();
        let record: ArchiveTotalRecord, payload: any, bundle: any, recordHash: string;
        if (pendingPlan) {
            const signedPlan = plan as ArchivePlan, partition = partitionFiles(plan.files, policy), receipts: ArchiveVolumeReceipt[] = [];
            if (signedPlan.volumes.length !== partition.volumes.length || new Set(signedPlan.volumes.map(item => item.id)).size !== signedPlan.volumes.length) throw new Error('Prepared volume mappings differ from the policy.');
            const totalOperations = signedPlan.volumes.filter(item => !item.bundle).length + 1; let done = 0;
            options.onProgress?.(0, totalOperations);
            for (const volume of signedPlan.volumes) {
                const bytes = await readObject(archive.directory, digest(volume.record));
                const projection = await projectArchiveRecord({ input: { format: 'math-workspace.archive-volume/v1', payload: volume.record, bundle: volume.bundle || '0'.repeat(64) }, payload: bytes, object: hash => readObject(archive.directory, hash) });
                const expected = partition.volumes.find(item => item.id === volume.id);
                if (!expected || projection.policyDigest !== signedPlan.policy || projection.volumeId !== volume.id || !sameJson(projection.files, expected.files)) throw new Error('Prepared volume file map or policy differs.');
                await checkUnchanged();
                let original: any;
                if (volume.bundle) {
                    const trusted = before.records.find(row => row.payload === volume.record && row.bundle === volume.bundle && row.verification === 'verified');
                    if (!trusted || trusted.format !== 'math-workspace.archive-volume/v1' || !trusted.contentComplete) throw new Error('A reused volume does not have a verified original receipt.');
                    original = await readObject(archive.directory, volume.bundle);
                    await archive.verifier.verify(bytes, original, [policy.signingIdentity]);
                } else {
                    original = await signBundle(archive, path.join(pending, 'volumes', volume.record), bytes, signer, onAuthentication, authFlow, policy.signingIdentity);
                    // Store a valid original receipt before any race check can reject publication.
                    await writeObject(archive.directory, original);
                    options.onProgress?.(++done, totalOperations);
                }
                receipts.push({ id: volume.id, record: volume.record, bundle: await writeObject(archive.directory, original) });
                await atomicWrite(pending, 'receipts.json', canonical({ schema: 'math-workspace.archive-receipts/v1', volumes: receipts }));
                await checkUnchanged();
            }
            const { schema: _, volumes: __, ...base } = signedPlan;
            record = { ...base, schema: 'math-workspace.archive-total/v1', volumes: receipts };
            payload = canonical(record); recordHash = sha256(payload);
            const destination = await safePath(archive.directory, `entries/${recordHash}`);
            if (await exists(destination)) {
                if (!(await readFile(destination, 'record.json')).equals(payload)) throw new Error('The completed total differs from its preparation.');
                bundle = await readFile(destination, 'record.bundle');
                await archive.verifier.verify(payload, bundle, [policy.signingIdentity]);
            } else {
                await checkUnchanged();
                bundle = await signBundle(archive, path.join(pending, 'total'), payload, signer, onAuthentication, authFlow, policy.signingIdentity);
            }
            options.onProgress?.(++done, totalOperations);
        } else {
            record = plan as ArchiveTotalRecord; payload = await readFile(directory, 'record.json'); recordHash = prepared;
            bundle = await readFile(directory, 'record.bundle');
            await archive.verifier.verify(payload, bundle, [policy.signingIdentity]);
            for (const receipt of record.volumes || []) await archive.verifier.verify(await readObject(archive.directory, receipt.record), await readObject(archive.directory, receipt.bundle), [policy.signingIdentity]);
        }
        await writeObject(archive.directory, payload);
        const bundleHash = await writeObject(archive.directory, bundle);
        await projectArchiveRecord({ input: { format: record.schema, payload: recordHash, bundle: bundleHash }, payload, object: hash => readObject(archive.directory, hash) });
        await checkUnchanged();
        await archive.records(true, undefined, true); // Long authentication may race original evidence on disk.
        await checkUnchanged();
        const destination = await safePath(archive.directory, `entries/${recordHash}`);
        const head: ArchivePointer = { record: recordHash, bundle: bundleHash };
        if (pendingPlan) await atomicWrite(pending, 'result.json', canonical({ head }));
        if (!await exists(destination)) {
            await fs.mkdir(path.dirname(destination), { recursive: true });
            await fs.rename(path.join(pending, 'total'), destination);
        }
        await atomicWrite(archive.directory, 'HEAD.json', canonical({ schema: 'math-workspace.archive-head/v1', sequence: record.sequence, ...head }));
        return { signed: true, alreadyPublished: false, head, scheme: record.schema === 'math-workspace.archive-total/v1' ? 'volume-total' : 'native-original',
            ...(record.volumes ? { volumes: record.volumes } : {}) };
    });
}
