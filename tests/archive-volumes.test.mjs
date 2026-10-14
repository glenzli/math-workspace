import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const api = () => require(process.env.MATH_ARCHIVE_TEST_API || path.join(repo, 'out/cli/archive.js'));
const identity = { identity: 'volumes@example.invalid', issuer: 'https://issuer.example.invalid' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = file => fs.access(file).then(() => true, () => false);

class MockVerifier {
    calls = [];
    async inspect(bytes) {
        const bundle = JSON.parse(bytes);
        if (!bundle.mock) throw new Error('Expected a mock signature receipt.');
        return { digest: bundle.digest, identity: bundle.identity, loggedAt: bundle.loggedAt, timestampCount: 1 };
    }
    async verify(payload, bytes, identities) {
        const bundle = JSON.parse(bytes), info = await this.inspect(bytes);
        if (bundle.invalid) throw new Error('Invalid original signature.');
        if (info.digest !== sha(payload)) throw new Error('The original bundle does not bind these payload bytes.');
        if (!identities.some(item => item.identity === info.identity.identity && item.issuer === info.identity.issuer)) throw new Error('Wrong signing identity.');
        this.calls.push({ payload: sha(payload), bundle: sha(bytes) });
        return info;
    }
}
function mockBundle(payload, nonce = 0, author = identity, extra = {}) {
    return api().canonical({ mock: true, digest: sha(payload), identity: author, loggedAt: `2026-09-11T01:00:${String(nonce % 60).padStart(2, '0')}.000Z`, nonce, ...extra });
}
async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'math-archive-volumes-'));
    const files = { 'book/volume-i/a.md': '# First volume\n', 'book/volume-ii/b.md': '# Second volume\n',
        'book/front.md': '# Front matter\n', 'book/draft/work.md': '# Working draft\n', 'book/review/note.md': '# Review\n' };
    for (const [name, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content); }
    const verifier = new MockVerifier(), archive = new (api().AcademicArchive)(root, verifier);
    const policy = { schema: 'math-workspace.archive-policy/v1', workId: 'volume-fixture', title: 'Volume fixtures', scope: { paths: ['book'], extensions: ['.md'] },
        signingIdentity: identity, identities: [identity], volumes: [{ id: 'i', title: 'Volume I', paths: ['book/volume-i'] }, { id: 'ii', title: 'Volume II', paths: ['book/volume-ii'] }] };
    await archive.initialize(policy);
    const signatures = [];
    const signer = async (recordPath, bundlePath) => {
        const payload = await fs.readFile(recordPath), record = JSON.parse(payload);
        signatures.push({ schema: record.schema, volumeId: record.volumeId, payload: sha(payload) });
        await fs.writeFile(bundlePath, mockBundle(payload, signatures.length));
    };
    return { root, archive, policy, verifier, signer, signatures, store: path.join(root, '.math-archive'), files };
}
async function sign(f, label = 'Daily archive') {
    const prepared = await f.archive.prepare(label), result = await f.archive.sign(prepared.prepared, f.signer);
    return { ...result, prepared: prepared.prepared };
}
async function object(f, bytes) { const hash = sha(bytes); await fs.mkdir(path.join(f.store, 'objects'), { recursive: true }); await fs.writeFile(path.join(f.store, 'objects', hash), bytes); return hash; }
async function native(f, label) {
    const state = await f.archive.records(true, undefined, true), hashes = {};
    for (const [name, bytes] of await api().captureSource(f.root, f.policy.scope)) hashes[name] = await object(f, bytes);
    const oldHead = state.head && state.records.find(row => row.payload === state.head.record && row.bundle === state.head.bundle);
    const payload = api().canonical({ schema: 'math-workspace.archive-record/v1', workId: f.policy.workId, label, sequence: (oldHead?.sequence || 0) + 1,
        preparedAt: '2026-09-11T00:00:00.000Z', signer: identity, previous: state.head, imports: state.imports, scope: f.policy.scope, files: hashes });
    const receipt = { record: await object(f, payload), bundle: await object(f, mockBundle(payload, 41)) };
    const directory = path.join(f.store, 'entries', receipt.record); await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'record.json'), payload); await fs.writeFile(path.join(directory, 'record.bundle'), mockBundle(payload, 41));
    await fs.writeFile(path.join(f.store, 'HEAD.json'), api().canonical({ schema: 'math-workspace.archive-head/v1', sequence: (oldHead?.sequence || 0) + 1, ...receipt }));
    return { ...receipt, payload, signature: mockBundle(payload, 41) };
}
function legacyExchange() {
    const source = Buffer.from('# Historical source\n');
    const manifest = Buffer.from('## 01.md\n' + [['SHA-256', 'sha256'], ['SHA-512', 'sha512'], ['BLAKE2b', 'blake2b512']].map(([label, hash]) => `${label}: ${createHash(hash).update(source).digest('hex')}\n`).join(''));
    const bundle = mockBundle(manifest, 42), index = api().canonical({ schema: 'oet.legacy-signatures/v1', work_id: 'volume-fixture', historical_project_paths: ['old-work'], records: [{
        kind: 'volume', manifest_sha256: sha(manifest), bundle_sha256: sha(bundle), origin: { commit: 'a'.repeat(40), bundle_path: 'old-work/book/MANIFEST.bundle' },
        closure: { files: { 'old-work/book/MANIFEST.txt': sha(manifest), 'old-work/book/01.md': sha(source) }, complete: true, recovered: [], unresolved: [] } }] });
    return { schema: 'math-workspace.archive-exchange/v1', workId: 'volume-fixture', records: [{ format: 'oet.legacy-signatures/v1', payload: sha(manifest), bundle: sha(bundle), metadata: { index: sha(index) } }],
        objects: Object.fromEntries([source, manifest, bundle, index].map(bytes => [sha(bytes), bytes.toString('base64')])) };
}
function rewriteTotal(exchange, mutate) {
    const input = exchange.records.find(record => record.format === 'math-workspace.archive-total/v1');
    const value = JSON.parse(Buffer.from(exchange.objects[input.payload], 'base64')); mutate(value);
    const payload = api().canonical(value), bundle = mockBundle(payload, 51);
    exchange.objects[sha(payload)] = payload.toString('base64'); exchange.objects[sha(bundle)] = bundle.toString('base64');
    input.payload = sha(payload); input.bundle = sha(bundle);
    return exchange;
}

export async function testArchiveVolumes() {
    let passed = 0;
    const check = async (name, work) => {
        const f = await fixture();
        try { await work(f); passed++; }
        catch (error) { error.message = `${name}: ${error.message}`; throw error; }
        finally { await fs.rm(f.root, { recursive: true, force: true }); }
    };
    await check('explicit volumes and complete outside coverage', async f => {
        const prepared = await f.archive.prepare('Daily');
        assert.deepEqual(prepared.volumes.map(row => [row.id, row.changed, row.reused, row.files]), [['i', true, false, 1], ['ii', true, false, 1]]);
        assert.deepEqual(Object.keys(prepared.outside).sort(), ['book/draft/work.md', 'book/front.md', 'book/review/note.md']);
        assert.equal(prepared.files, 5); assert.equal(prepared.signatureCreated, false); assert.equal(await exists(path.join(f.store, 'HEAD.json')), false);
        const result = await f.archive.sign(prepared.prepared, f.signer);
        assert.notEqual(result.head.record, prepared.prepared);
        assert.deepEqual(f.signatures.map(row => row.volumeId || 'total'), ['i', 'ii', 'total']);
        const verification = await f.archive.verify(result.head.record), total = verification.records.find(row => row.kind === 'total');
        assert.equal(Object.keys(total.files).length, 5); assert.deepEqual(total.volumes, result.volumes);
        assert.deepEqual(total.outside, prepared.outside); assert.equal(verification.contentComplete, true);
    });
    await check('only the changed volume and total need new signatures', async f => {
        const first = await sign(f), originals = await f.archive.export();
        await fs.appendFile(path.join(f.root, 'book/volume-i/a.md'), 'Changed volume I\n');
        const prepared = await f.archive.prepare('Second');
        assert.deepEqual(prepared.volumes.map(row => [row.id, row.changed, row.reused]), [['i', true, false], ['ii', false, true]]);
        const second = await f.archive.sign(prepared.prepared, f.signer);
        assert.deepEqual(f.signatures.map(row => row.volumeId || 'total'), ['i', 'ii', 'total', 'i', 'total']);
        assert.deepEqual(second.volumes.find(row => row.id === 'ii'), first.volumes.find(row => row.id === 'ii'));
        const exported = await f.archive.export();
        for (const receipt of first.volumes) for (const hash of [receipt.record, receipt.bundle]) assert.equal(exported.objects[hash], originals.objects[hash]);
        const total = (await f.archive.record(second.head.record, true));
        assert.deepEqual(total.previous, first.head); assert.equal(total.sequence, 2);
    });
    await check('root draft review changes advance only the total', async f => {
        const first = await sign(f), before = await f.archive.export();
        for (const name of ['book/front.md', 'book/draft/work.md', 'book/review/note.md']) await fs.appendFile(path.join(f.root, name), 'New content\n');
        const second = await sign(f);
        assert.deepEqual(second.volumes, first.volumes); assert.equal(f.signatures.length, 4);
        const after = await f.archive.export();
        for (const receipt of first.volumes) for (const hash of [receipt.record, receipt.bundle]) assert.equal(after.objects[hash], before.objects[hash]);
        assert.equal((await f.archive.prepare('No change')).alreadySigned, true);
        await f.archive.sign(second.prepared, () => assert.fail('must not re-sign'));
    });
    await check('each original volume exports and verifies independently', async f => {
        const result = await sign(f), volume = await f.archive.record(result.volumes[0].record, true);
        const exchange = await f.archive.export(volume.id), target = await fixture();
        try {
            assert.equal(exchange.records.length, 1); assert.equal(exchange.records[0].format, 'math-workspace.archive-volume/v1');
            assert.equal(Object.keys(exchange.objects).length, 4);
            await target.archive.import(exchange); const verified = await target.archive.verify();
            assert.equal(verified.records.length, 1); assert.equal(verified.records[0].volumeId, 'i'); assert.equal(verified.head, null);
        } finally { await fs.rm(target.root, { recursive: true, force: true }); }
    });
    await check('full archive exchange preserves all total and volume receipts', async f => {
        await sign(f); await fs.appendFile(path.join(f.root, 'book/front.md'), 'Updated'); await sign(f);
        const exchange = await f.archive.export(), target = await fixture();
        try { await target.archive.import(exchange); const result = await target.archive.verify(); assert.equal(result.records.length, 4); assert.equal(result.contentComplete, true); }
        finally { await fs.rm(target.root, { recursive: true, force: true }); }
    });
    await check('overlap and accidental extra volume mappings are rejected', async f => {
        await assert.rejects(f.archive.updatePolicy({ ...f.policy, volumes: [{ id: 'all', title: 'All', paths: ['book'] }, ...f.policy.volumes] }), /overlap/);
        await sign(f);
        const exchange = rewriteTotal(await f.archive.export(), total => total.volumes.push(total.volumes[0]));
        await assert.rejects(f.archive.import(exchange), /missing, additional or repeated/);
    });
    await check('omitted volumes and cross-volume bundles cannot masquerade as bindings', async f => {
        await sign(f);
        await assert.rejects(f.archive.import(rewriteTotal(await f.archive.export(), total => total.volumes.pop())), /missing, additional or repeated/);
        await assert.rejects(f.archive.import(rewriteTotal(await f.archive.export(), total => { total.volumes[0].bundle = total.volumes[1].bundle; })), /exact original volume|bind/);
        await assert.rejects(f.archive.import(rewriteTotal(await f.archive.export(), total => { total.volumes[0].record = total.volumes[1].record; })), /exact declared volume/);
    });
    await check('a total cannot omit a declared volume file or include it as another volume', async f => {
        await sign(f);
        await assert.rejects(f.archive.import(rewriteTotal(await f.archive.export(), total => { delete total.files['book/volume-i/a.md']; })), /exact declared volume file map/);
        await assert.rejects(f.archive.import(rewriteTotal(await f.archive.export(), total => { total.files['outside/extra.md'] = Object.values(total.files)[0]; })), /outside.*scope/);
    });
    await check('wrong signing certificate is rejected without head publication', async f => {
        const prepared = await f.archive.prepare('Wrong identity');
        await assert.rejects(f.archive.sign(prepared.prepared, async (record, bundle) => {
            await fs.writeFile(bundle, mockBundle(await fs.readFile(record), 1, { ...identity, identity: 'other@example.invalid' }));
        }), /Wrong signing identity/);
        assert.equal(await exists(path.join(f.store, 'HEAD.json')), false);
    });
    await check('source additions after preparation block authentication', async f => {
        const prepared = await f.archive.prepare('Before addition'); await fs.writeFile(path.join(f.root, 'book/draft/new.md'), 'New draft');
        await assert.rejects(f.archive.sign(prepared.prepared, () => assert.fail('authentication must not start')), /Source files changed/);
    });
    for (const race of ['source', 'policy', 'head']) await check(`${race} race preserves valid original receipts and rejects publication`, async f => {
        await sign(f, 'First'); await fs.appendFile(path.join(f.root, 'book/volume-i/a.md'), 'Prepared change\n');
        const prepared = await f.archive.prepare('Second'), oldPolicy = await fs.readFile(path.join(f.store, 'policy.json')),
            oldHead = await fs.readFile(path.join(f.store, 'HEAD.json')), oldSource = await fs.readFile(path.join(f.root, 'book/front.md'));
        await assert.rejects(f.archive.sign(prepared.prepared, async (recordPath, bundlePath) => {
            await f.signer(recordPath, bundlePath);
            if (race === 'source') await fs.appendFile(path.join(f.root, 'book/front.md'), 'Concurrent edit');
            if (race === 'policy') await fs.writeFile(path.join(f.store, 'policy.json'), api().canonical({ ...f.policy, title: 'Concurrent title' }));
            if (race === 'head') await fs.writeFile(path.join(f.store, 'HEAD.json'), api().canonical({ schema: 'math-workspace.archive-head/v1', sequence: 99, record: 'f'.repeat(64), bundle: 'e'.repeat(64) }));
        }), /changed/);
        const volume = prepared.volumes.find(row => row.changed), bundleFile = path.join(f.store, 'pending', prepared.prepared, 'volumes', volume.record, 'record.bundle'), receipt = await fs.readFile(bundleFile);
        await fs.writeFile(path.join(f.store, 'policy.json'), oldPolicy); await fs.writeFile(path.join(f.store, 'HEAD.json'), oldHead); await fs.writeFile(path.join(f.root, 'book/front.md'), oldSource);
        const before = f.signatures.length; await f.archive.sign(prepared.prepared, f.signer);
        assert.equal(f.signatures.length, before + 1); assert.deepEqual(await fs.readFile(bundleFile), receipt); await f.archive.verify();
    });
    await check('partial volume failure retries only the missing receipt and total', async f => {
        const prepared = await f.archive.prepare('Partial'); let failed = false;
        await assert.rejects(f.archive.sign(prepared.prepared, async (record, bundle) => {
            if (JSON.parse(await fs.readFile(record)).volumeId === 'ii' && !failed) { failed = true; throw new Error('Second authentication cancelled'); }
            await f.signer(record, bundle);
        }), /cancelled/);
        const firstBundle = path.join(f.store, 'pending', prepared.prepared, 'volumes', prepared.volumes[0].record, 'record.bundle'), original = await fs.readFile(firstBundle);
        assert.equal(await exists(path.join(f.store, 'HEAD.json')), false); assert.deepEqual((await f.archive.status()).pending[0].volumes.map(row => row.signed), [true, false]);
        await f.archive.sign(prepared.prepared, f.signer);
        assert.deepEqual(f.signatures.map(row => row.volumeId || 'total'), ['i', 'ii', 'total']); assert.deepEqual(await fs.readFile(firstBundle), original);
    });
    await check('a completed total bundle survives a signer exception and resumes unchanged', async f => {
        const prepared = await f.archive.prepare('Total interrupted');
        await assert.rejects(f.archive.sign(prepared.prepared, async (record, bundle) => {
            await f.signer(record, bundle); if (JSON.parse(await fs.readFile(record)).schema === 'math-workspace.archive-total/v1') throw new Error('Interrupted after original total receipt');
        }), /Interrupted/);
        const original = await fs.readFile(path.join(f.store, 'pending', prepared.prepared, 'total/record.bundle'));
        const result = await f.archive.sign(prepared.prepared, () => assert.fail('all original receipts must be reused'));
        assert.deepEqual(await fs.readFile(path.join(f.store, 'entries', result.head.record, 'record.bundle')), original); await f.archive.verify();
    });
    await check('the original plan resumes both publication crash windows', async f => {
        const result = await sign(f); await fs.unlink(path.join(f.store, 'pending', result.prepared, 'result.json'));
        assert.equal((await f.archive.sign(result.prepared, () => assert.fail('must not re-sign'))).alreadyPublished, true);
        await fs.unlink(path.join(f.store, 'HEAD.json'));
        await assert.rejects(f.archive.verify(), /await publication/);
        const recovered = await f.archive.sign(result.prepared, () => assert.fail('must reuse the completed entry'));
        assert.deepEqual(recovered.head, result.head); assert.equal((await f.archive.verify()).orphans.length, 0);
    });
    await check('hide and retire old native history without losing its import closure', async f => {
        const legacy = legacyExchange(); await f.archive.import(legacy); const september = await native(f, 'September');
        await fs.appendFile(path.join(f.root, 'book/front.md'), 'October'); const october = await native(f, 'October');
        const original = await f.archive.export();
        await f.archive.hide(october.record, true);
        await fs.unlink(path.join(f.store, 'visibility.json')); // Crash after head rollback and before local hide publication.
        await f.archive.hide(october.record, true); await f.archive.hide(september.record);
        assert.deepEqual((await f.archive.records()).records.map(row => row.format), ['oet.legacy-signatures/v1']);
        const oldVerified = await f.archive.verify(); assert.equal(oldVerified.records.length, 3); assert.deepEqual(oldVerified.orphans, []); assert.deepEqual(oldVerified.head, { record: september.record, bundle: september.bundle });
        const replacement = await sign(f, 'Replacement total');
        const total = await f.archive.record(replacement.head.record, true); assert.equal(total.sequence, 2); assert.deepEqual(total.previous, { record: september.record, bundle: september.bundle });
        assert.deepEqual((await f.archive.verify()).orphans, []);
        const exported = await f.archive.export(); for (const [hash, bytes] of Object.entries(original.objects)) assert.equal(exported.objects[hash], bytes);
        await assert.rejects(f.archive.hide(october.record, true), /head advanced/);
        await f.archive.restore(september.record); assert.equal((await f.archive.records()).records.find(row => row.payload === september.record).hidden, false);
        assert.deepEqual(await fs.readFile(path.join(f.store, 'entries', october.record, 'record.bundle')), october.signature);
    });
    await check('hidden invalid original signatures still fail strict verification', async f => {
        const old = await native(f, 'Old'); await f.archive.hide(old.record);
        const invalid = mockBundle(old.payload, 41, identity, { invalid: true });
        await fs.writeFile(path.join(f.store, 'entries', old.record, 'record.bundle'), invalid);
        await fs.writeFile(path.join(f.store, 'HEAD.json'), api().canonical({ schema: 'math-workspace.archive-head/v1', sequence: 1, record: old.record, bundle: sha(invalid) }));
        await object(f, invalid);
        await assert.rejects(f.archive.verify(), /Invalid original signature/);
    });
    await check('missing hidden historical content remains separate from valid signatures', async f => {
        const old = await native(f, 'Old'); await f.archive.hide(old.record);
        const payload = JSON.parse(old.payload), missing = payload.files['book/front.md']; await fs.unlink(path.join(f.store, 'objects', missing));
        const result = await f.archive.verify(); assert.equal(result.verified, true); assert.equal(result.contentComplete, false);
        assert.equal(result.missingReferences, 1); assert(result.missingObjects.includes(missing));
        const exported = await f.archive.export(old.record); assert.equal(exported.objects[old.record], old.payload.toString('base64')); assert.equal(exported.objects[missing], undefined);
    });
    await check('retained head sequence metadata must match the original payload', async f => {
        const first = await native(f, 'Old');
        await fs.writeFile(path.join(f.store, 'retained-heads.json'), api().canonical({ schema: 'math-workspace.archive-retained-heads/v1', heads: [{ sequence: 2, record: first.record, bundle: first.bundle }] }));
        await assert.rejects(f.archive.verify(), /sequence differs/);
    });
    await check('explicit policy updates use stable work identity and optional compare-and-swap', async f => {
        const digest = (await f.archive.status()).policyDigest;
        await f.archive.updatePolicy({ ...f.policy, volumes: [] }, digest);
        await assert.rejects(f.archive.updatePolicy(f.policy, digest), /policy changed/);
        await assert.rejects(f.archive.updatePolicy({ ...f.policy, workId: 'other-work' }), /stable work identity/);
        // A legal project can choose a directory named draft as an explicit volume; names are not inferred.
        await f.archive.updatePolicy({ ...f.policy, volumes: [{ id: 'draft-volume', title: 'Declared draft volume', paths: ['book/draft'] }] });
        assert.equal((await f.archive.prepare('Explicit')).volumes[0].files, 1);
    });
    await check('CLI exposes normal auth policy changes and explicit hidden listing', async f => {
        const cli = process.env.MATH_ARCHIVE_TEST_CLI || path.join(repo, 'out/cli/math-workspace.js');
        const run = args => spawnSync(process.execPath, [cli, 'archive', ...args, '--root', f.root], { encoding: 'utf8' });
        const configured = run(['update-policy', '--volume', 'one=book/volume-i', '--volume-title', 'one=First book']);
        assert.equal(configured.status, 0, configured.stderr); assert.equal(JSON.parse(configured.stdout).volumes[0].title, 'First book');
        const prepared = run(['prepare', '--label', 'CLI plan']); assert.equal(prepared.status, 0, prepared.stderr); assert.equal(JSON.parse(prepared.stdout).volumes.length, 1);
        const invalid = run(['sign', '--prepared', JSON.parse(prepared.stdout).prepared, '--auth-flow', 'token']); assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /normal or device/);
        const old = await native(f, 'CLI hidden');
        // Mock only certificate inspection in subprocess reads; no test-only production verification bypass.
        const bin = path.join(f.root, 'bin'); await fs.mkdir(bin);
        await fs.writeFile(path.join(bin, 'openssl'), '#!' + process.execPath + '\nprocess.stdout.write(' + JSON.stringify(`email:${identity.identity}\n1.3.6.1.4.1.57264.1.1:\n  ${identity.issuer}\n`) + ');\n', { mode: 0o755 });
        const bundle = api().canonical({ ...JSON.parse(old.signature), messageSignature: { messageDigest: { algorithm: 'SHA2_256', digest: Buffer.from(old.record, 'hex').toString('base64') } },
            verificationMaterial: { certificate: { rawBytes: Buffer.from('mock certificate').toString('base64') } } });
        const hash = await object(f, bundle); await fs.writeFile(path.join(f.store, 'entries', old.record, 'record.bundle'), bundle);
        await fs.writeFile(path.join(f.store, 'HEAD.json'), api().canonical({ schema: 'math-workspace.archive-head/v1', sequence: 1, record: old.record, bundle: hash }));
        const read = args => spawnSync(process.execPath, [cli, 'archive', ...args, '--root', f.root], { encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } });
        const hidden = read(['hide', '--record', old.record]); assert.equal(hidden.status, 0, hidden.stderr);
        assert.equal(JSON.parse(read(['list']).stdout).records.length, 0);
        assert.equal(JSON.parse(read(['list', '--include-hidden']).stdout).records.length, 1);
        assert.equal(read(['restore', '--record', old.record]).status, 0);
    });
    await check('normal authorization links require the Sigstore origin and local callback', async () => {
        const url = 'https://oauth2.sigstore.dev/auth/auth?client_id=sigstore&redirect_uri=http%3A%2F%2Flocalhost%3A43210%2Fauth%2Fcallback&response_type=code&scope=openid&state=test-state';
        assert.deepEqual(api().normalAuthentication(`Go to the following link in a browser:\n${url}\n`), { url, flow: 'normal' });
        assert.equal(api().normalAuthentication(url), undefined);
        assert.equal(api().normalAuthentication(url.replace('localhost%3A43210', 'example.invalid%3A43210')), undefined);
        assert.equal(api().normalAuthentication(url.replace('oauth2.sigstore.dev', 'evil.example.invalid')), undefined);
        assert.equal(api().normalAuthentication(url.replace('client_id=sigstore', 'client_id=other')), undefined);
    });
    await check('production signing chooses normal and waits for the whole streamed authorization URL', async f => {
        const bin = path.join(f.root, 'bin'), calls = path.join(f.root, 'cosign-calls.jsonl'); await fs.mkdir(bin);
        const first = 'https://oauth2.sigstore.dev/auth/auth?client_id=sigstore&redirect_uri=http%3A%2F%2Flocalhost%3A43210%2Fauth%2Fcallback&response_type=code';
        await fs.writeFile(path.join(bin, 'cosign'), '#!' + process.execPath + '\n' + `
            const fs = require('node:fs'), crypto = require('node:crypto');
            const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
            process.stdout.write('Go to the following link in a browser:\\n' + ${JSON.stringify(first)});
            setTimeout(() => {
                process.stdout.write('&scope=openid&state=complete-state\\n');
                const payload = fs.readFileSync(args[args.indexOf('--bundle') + 2]);
                fs.writeFileSync(args[args.indexOf('--bundle') + 1], JSON.stringify({ mock: true, digest: crypto.createHash('sha256').update(payload).digest('hex'),
                    identity: ${JSON.stringify(identity)}, loggedAt: '2026-09-11T01:00:00.000Z', nonce: 1 }) + '\\n');
            }, 20);
        `, { mode: 0o755 });
        const oldPath = process.env.PATH, authentications = [];
        try {
            process.env.PATH = bin + path.delimiter + oldPath;
            const prepared = await f.archive.prepare('Normal signing'); await f.archive.sign(prepared.prepared, undefined, value => authentications.push(value));
        } finally { process.env.PATH = oldPath; }
        assert.equal(authentications.length, 3);
        assert(authentications.every(value => value.url.endsWith('&scope=openid&state=complete-state') && value.flow === 'normal' && value.code === undefined));
        for (const args of (await fs.readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse)) {
            assert.equal(args[args.indexOf('--fulcio-auth-flow') + 1], 'normal'); assert(args.includes('--oidc-disable-ambient-providers'));
        }
    });
    console.log(`Academic archive volume contracts: ${passed} passed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testArchiveVolumes();
