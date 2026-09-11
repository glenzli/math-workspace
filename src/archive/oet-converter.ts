/** OET transport conversion preserves every original byte; format validators decide evidence. */
import * as path from 'node:path';
import { canonical, digest, exists, MAX_ARCHIVE_BYTES, parseJson, readFile, readObject, relative, safePath, sha256 } from './io';
import { validIdentity } from './sigstore';
import type { ArchiveExchange, ArchiveInputRecord, ArchivePolicy } from './types';
const fs = require('node:fs/promises');

export async function discoverOetArchives(projectRoot: string): Promise<Array<{ path: string; workId: string; title: string }>> {
    const candidates = ['.signatures'];
    for (const entry of await fs.readdir(projectRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'out', 'dist'].includes(entry.name)) candidates.push(entry.name + '/.signatures');
    }
    const found = [];
    for (const name of candidates) {
        if (!await exists(path.join(projectRoot, name, 'policy.json'))) continue;
        try {
            const policy = parseJson(await readFile(projectRoot, name + '/policy.json'));
            if (policy.schema === 'oet.sign-policy/v1' && await exists(path.join(projectRoot, name, 'legacy/index.json'))) {
                found.push({ path: name, workId: String(policy.work_id), title: String(policy.work_title || policy.work_id) });
            }
        } catch (_) { /* Discovery never grants authority to malformed candidates. */ }
    }
    return found;
}

export async function convertOetArchive(projectRoot: string, source: string): Promise<{ exchange: ArchiveExchange; suggestedPolicy: ArchivePolicy }> {
    relative(source); const store = await safePath(projectRoot, source);
    const policy = parseJson(await readFile(store, 'policy.json'));
    if (policy.schema !== 'oet.sign-policy/v1') throw new Error('The selected source is not an OET archive.');
    const indexBytes = await readFile(store, 'legacy/index.json'), index = parseJson(indexBytes, true);
    if (index.schema !== 'oet.legacy-signatures/v1' || index.work_id !== policy.work_id || !Array.isArray(index.records)) throw new Error('OET historical evidence has not been archived in a supported format.');
    const objects: Record<string, string> = {}; let total = 0;
    const add = (data: any): string => {
        const hash = sha256(data);
        if (!Object.hasOwn(objects, hash)) { total += data.length; if (total > MAX_ARCHIVE_BYTES) throw new Error('OET archive exceeds the exchange byte limit.'); objects[hash] = data.toString('base64'); }
        return hash;
    };
    const indexHash = add(indexBytes);
    const legacy = path.join(store, 'legacy');
    for (const hash of (await fs.readdir(await safePath(legacy, 'objects'))).sort()) add(await readObject(legacy, digest(hash)));
    const records: ArchiveInputRecord[] = index.records.map(record => ({ format: 'oet.legacy-signatures/v1',
        payload: digest(record.manifest_sha256), bundle: digest(record.bundle_sha256), metadata: { index: indexHash } }));
    if (await exists(path.join(store, 'HEAD.json'))) {
        const head = parseJson(await readFile(store, 'HEAD.json'), true);
        if (head.schema !== 'oet.sign-head/v1' || head.work_id !== policy.work_id || !Number.isSafeInteger(head.sequence)) throw new Error('Invalid OET chain head.');
        let pointer = { record_sha256: digest(head.record_sha256), bundle_sha256: digest(head.bundle_sha256) }, sequence = head.sequence;
        const seen = new Set<string>();
        while (pointer) {
            if (seen.has(pointer.record_sha256)) throw new Error('OET chain has a cycle.'); seen.add(pointer.record_sha256);
            const prefix = `entries/${pointer.record_sha256}`;
            const data = await readFile(store, `${prefix}/record.json`), bundle = await readFile(store, `${prefix}/record.bundle`);
            if (add(data) !== pointer.record_sha256 || add(bundle) !== pointer.bundle_sha256) throw new Error('OET chain receipt bytes changed.');
            const record = parseJson(data, true);
            if (record.schema !== 'oet.sign-record/v1' || record.work_id !== policy.work_id || record.sequence !== sequence) throw new Error('OET chain sequence differs.');
            for (const hash of Object.values(record.snapshot.files)) add(await readObject(path.join(store, prefix), digest(hash)));
            if (record.legacy_archive_sha256 !== null && record.legacy_archive_sha256 !== indexHash) throw new Error('OET chain no longer matches its original legacy archive.');
            records.push({ format: 'oet.sign-record/v1', payload: pointer.record_sha256, bundle: pointer.bundle_sha256 });
            pointer = record.previous; sequence--;
        }
        if (sequence !== 0) throw new Error('OET chain ended prematurely.');
    }
    const sourceRoot = path.posix.dirname(source);
    if (sourceRoot === '.') throw new Error('Bind Math Workspace to the repository containing the OET work directory before conversion.');
    const identities = policy.legacy_identities.map(validIdentity);
    const suggestedPolicy: ArchivePolicy = { schema: 'math-workspace.archive-policy/v1', workId: policy.work_id,
        title: policy.work_title || policy.work_id, identities, signingIdentity: validIdentity(policy.signing_identity),
        scope: { paths: [sourceRoot], extensions: ['.md'], maxDepth: 2,
            exclude: ['tools', 'scripts', 'release', 'formal-oet'].map(name => sourceRoot + '/' + name) } };
    return { exchange: { schema: 'math-workspace.archive-exchange/v1', workId: policy.work_id, records, objects }, suggestedPolicy };
}

export async function writeExchangeFile(file: string, exchange: ArchiveExchange): Promise<void> {
    // Explicit CLI export destinations are files, not project-selected executable converters.
    const data = canonical(exchange);
    await fs.writeFile(file, data, { flag: 'wx' });
}
