import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = () => require(path.join(repo, 'out/cli/archive.js'));
const identity = { identity: 'archive-tests@example.invalid', issuer: 'https://issuer.example.invalid' };
const sha = data => createHash('sha256').update(data).digest('hex');
const exists = file => fs.access(file).then(() => true, () => false);

/** Test-only signer/verifier. Production entrypoints always construct SigstoreVerifier. */
class TestVerifier {
    calls = 0;
    async inspect(bundle) {
        const value = JSON.parse(bundle);
        assert.equal(value.testOnly, true);
        return { digest: value.digest, identity: value.identity, loggedAt: value.loggedAt, timestampCount: 1 };
    }
    async verify(payload, bundle, identities) {
        const info = await this.inspect(bundle);
        assert.equal(info.digest, sha(payload));
        assert(identities.some(item => item.identity === info.identity.identity && item.issuer === info.identity.issuer));
        this.calls++; return info;
    }
}
function testBundle(payload, nonce = 0) {
    return api().canonical({ testOnly: true, digest: sha(payload), identity, loggedAt: '2026-09-11T01:00:00.000Z', nonce });
}
async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'math-archive-test-'));
    await fs.mkdir(path.join(root, 'book')); await fs.writeFile(path.join(root, 'book/01.md'), '# Example #h-1234567890abcdef\n\nTheorem #h-abcdef1234567890 (Example): Original.\n');
    const verifier = new TestVerifier(), archive = new (api().AcademicArchive)(root, verifier);
    const policy = { schema: 'math-workspace.archive-policy/v1', workId: 'test-work', title: 'Archive tests',
        scope: { paths: ['book'], extensions: ['.md'] }, identities: [identity], signingIdentity: identity };
    await archive.initialize(policy);
    return { root, archive, verifier, policy, source: path.join(root, 'book/01.md'), store: path.join(root, '.math-archive') };
}
async function signer(recordPath, bundlePath) { await fs.writeFile(bundlePath, testBundle(await fs.readFile(recordPath))); }
async function signed(f, label = 'Example') { const prepared = await f.archive.prepare(label); await f.archive.sign(prepared.prepared, signer); return prepared; }

function manifest(members) {
    return Buffer.from('# Generated: 2026-03-12T00:00:00Z\n\n' + Object.entries(members).map(([name, bytes]) => {
        const hashes = [['SHA-256', 'sha256'], ['SHA-512', 'sha512'], ['BLAKE2b', 'blake2b512']];
        return `## ${name}\n` + hashes.map(([label, hash]) => `${label}: ${createHash(hash).update(bytes).digest('hex')}\n`).join('');
    }).join('\n') + '\n');
}
function oetExchange({ gap = false, extra = false } = {}) {
    const source = Buffer.from('# Historical theorem\n'), payload = manifest({ '01.md': source }), bundle = testBundle(payload);
    const files = { 'old-work/book/MANIFEST.txt': sha(payload), ...(!gap ? { 'old-work/book/01.md': sha(source) } : {}) };
    if (extra) files['old-work/book/unbound.md'] = sha(source);
    const hashes = Object.fromEntries([['SHA-256', 'sha256'], ['SHA-512', 'sha512'], ['BLAKE2b', 'blake2b512']].map(([label, algorithm]) => [label, createHash(algorithm).update(source).digest('hex')]));
    const index = api().canonical({ schema: 'oet.legacy-signatures/v1', work_id: 'test-work', historical_project_paths: ['old-work'],
        records: [{ manifest_sha256: sha(payload), bundle_sha256: sha(bundle), kind: 'volume', origin: { commit: 'a'.repeat(40), bundle_path: 'old-work/book/MANIFEST.bundle' },
            closure: { files, complete: !gap, recovered: [], unresolved: gap ? [{ path: 'old-work/book/01.md', expected_hashes: hashes, observed_object_sha256: null }] : [] } }] });
    const objects = Object.fromEntries([payload, bundle, source, index].map(data => [sha(data), data.toString('base64')]));
    return { schema: 'math-workspace.archive-exchange/v1', workId: 'test-work',
        records: [{ format: 'oet.legacy-signatures/v1', payload: sha(payload), bundle: sha(bundle), metadata: { index: sha(index) } }], objects };
}
function withOetContinuation(exchange, sequence = 1, previous = null) {
    const add = data => { const hash = sha(data); exchange.objects[hash] = data.toString('base64'); return hash; };
    const body = `# OET version ${sequence}\n`, source = Buffer.from(body + `\n---\n*[OE] TEST ⊢ [${sha(Buffer.from(body)).slice(0,16)}]*\n`);
    const root = manifest({ '01.md': source }), rootBundle = testBundle(root);
    const record = api().canonical({ schema: 'oet.sign-record/v1', work_id: 'test-work', sequence, prepared_at: '2026-09-11T00:00:00Z', signer: identity,
        previous, legacy_archive_sha256: sequence === 1 ? exchange.records[0].metadata.index : null,
        source_locator: { project_path: 'book', git_base_commit: 'a'.repeat(40) },
        snapshot: { scope: 'root-markdown-and-direct-child-markdown/v1', root_manifest_sha256: sha(root),
            files: { '01.md': add(source), 'MANIFEST.txt': add(root), 'MANIFEST.bundle': add(rootBundle) } } });
    const bundle = testBundle(record), input = { format: 'oet.sign-record/v1', payload: add(record), bundle: add(bundle) };
    exchange.records.push(input); return { record_sha256: input.payload, bundle_sha256: input.bundle };
}

export async function testArchives() {
    let passed = 0;
    const check = async (name, body) => {
        const f = await fixture();
        try { await body(f); passed++; }
        catch (error) { error.message = `${name}: ${error.message}`; throw error; }
        finally { await fs.rm(f.root, { recursive: true, force: true }); }
    };
    await check('preparation leaves source and chain untouched', async f => {
        const before = await fs.readFile(f.source), prepared = await f.archive.prepare('Draft milestone');
        assert.equal(prepared.signatureCreated, false); assert.equal(await exists(path.join(f.store, 'HEAD.json')), false);
        assert.deepEqual(await fs.readFile(f.source), before); assert.equal((await f.archive.status()).pending.length, 1);
    });
    await check('signed snapshots verify and do not duplicate', async f => {
        const first = await signed(f); const verification = await f.archive.verify(first.prepared);
        assert.equal(verification.verified, true); assert.equal(verification.records.length, 1);
        assert.equal(verification.currentWorkingTreeChecked, false); assert.equal(verification.mathematicalCorrectnessAssessed, false);
        assert.equal((await f.archive.prepare('Another label')).alreadySigned, true);
        assert.equal((await f.archive.sign(first.prepared, () => assert.fail('must not re-sign'))).alreadyPublished, true);
    });
    await check('successors bind the original predecessor bundle', async f => {
        await signed(f, 'First'); const before = JSON.parse(await fs.readFile(path.join(f.store, 'HEAD.json')));
        await fs.appendFile(f.source, '\nA revised hypothesis.\n'); const second = await signed(f, 'Second');
        const record = JSON.parse(await fs.readFile(path.join(f.store, `entries/${second.prepared}/record.json`)));
        assert.deepEqual(record.previous, { record: before.record, bundle: before.bundle }); assert.equal(record.sequence, 2);
        assert.equal((await f.archive.verify()).records.length, 2);
    });
    await check('source changes before signing are rejected', async f => {
        const prepared = await f.archive.prepare('Before'); await fs.appendFile(f.source, 'Changed');
        await assert.rejects(f.archive.sign(prepared.prepared, () => assert.fail('authentication must not start')), /Source files changed/);
        assert.equal(await exists(path.join(f.store, 'HEAD.json')), false);
    });
    await check('file additions and removals are part of the snapshot', async f => {
        const prepared = await f.archive.prepare('Before'); await fs.writeFile(path.join(f.root, 'book/02.md'), '# Added\n');
        await assert.rejects(f.archive.sign(prepared.prepared, signer), /Source files changed/);
        await fs.unlink(path.join(f.root, 'book/02.md')); await fs.unlink(f.source);
        await assert.rejects(f.archive.sign(prepared.prepared, signer), /empty|Source files changed/);
    });
    await check('authentication edits leave a reusable receipt', async f => {
        const original = await fs.readFile(f.source), prepared = await f.archive.prepare('Before'); let calls = 0;
        await assert.rejects(f.archive.sign(prepared.prepared, async (record, bundle) => {
            calls++; await signer(record, bundle); await fs.writeFile(f.source, 'Changed during authentication');
        }), /Source files changed/);
        assert.equal(await exists(path.join(f.store, 'HEAD.json')), false);
        await fs.writeFile(f.source, original); await f.archive.sign(prepared.prepared, () => assert.fail('receipt should be reused'));
        assert.equal(calls, 1); assert.equal((await f.archive.verify()).records.length, 1);
    });
    await check('failed authentication does not advance history', async f => {
        const prepared = await f.archive.prepare('Before');
        await assert.rejects(f.archive.sign(prepared.prepared, async () => { throw new Error('Authentication cancelled'); }), /Authentication cancelled/);
        assert.equal(await exists(path.join(f.store, 'HEAD.json')), false); await f.archive.sign(prepared.prepared, signer);
    });
    await check('policy changes during authentication block publication', async f => {
        const prepared = await f.archive.prepare('Before');
        await assert.rejects(f.archive.sign(prepared.prepared, async (record, bundle) => {
            await signer(record, bundle); const policy = JSON.parse(await fs.readFile(path.join(f.store, 'policy.json'))); policy.title = 'Changed';
            await fs.writeFile(path.join(f.store, 'policy.json'), api().canonical(policy));
        }), /policy changed/);
        assert.equal(await exists(path.join(f.store, 'HEAD.json')), false);
    });
    await check('completed entry resumes after a missing head publication', async f => {
        const prepared = await signed(f); await fs.unlink(path.join(f.store, 'HEAD.json'));
        await assert.rejects(f.archive.verify(), /await publication/);
        await f.archive.sign(prepared.prepared, () => assert.fail('must reuse completed entry'));
        assert.equal((await f.archive.verify()).head.record, prepared.prepared);
    });
    await check('replacing a predecessor bundle breaks existing successors', async f => {
        const first = await signed(f); await fs.appendFile(f.source, 'Changed'); await signed(f);
        const record = await fs.readFile(path.join(f.store, `entries/${first.prepared}/record.json`));
        await fs.writeFile(path.join(f.store, `entries/${first.prepared}/record.bundle`), testBundle(record, 1));
        await assert.rejects(f.archive.verify(), /receipt has changed/);
    });
    await check('independently known head detects rollback', async f => {
        await signed(f); await assert.rejects(f.archive.verify('a'.repeat(64)), /independently known head/);
    });
    await check('portable exchange restores source and signatures', async f => {
        await signed(f, 'First'); await fs.appendFile(f.source, 'Updated'); await signed(f, 'Second');
        const exchange = await f.archive.export(); const target = await fixture();
        try {
            const imported = await target.archive.import(exchange); assert.equal(imported.records, 2);
            assert.equal((await target.archive.verify()).records.length, 2);
            assert.equal((await target.archive.import(exchange)).alreadyPresent, true);
            const old = (await target.archive.records()).records.find(row => row.label === 'First');
            const source = await target.archive.source(old.id, 'book/01.md'); assert(!source.content.includes('Updated'));
            assert.equal(source.source, 'archived-original-bytes');
        } finally { await fs.rm(target.root, { recursive: true, force: true }); }
    });
    await check('tampered portable objects fail before import', async f => {
        const exchange = oetExchange(); const hash = Object.keys(exchange.objects)[0]; exchange.objects[hash] = Buffer.from('wrong bytes').toString('base64');
        await assert.rejects(f.archive.import(exchange), /full digest/); assert.equal(await exists(path.join(f.store, 'imports')), false);
    });
    await check('legacy OET signatures keep original bytes and times', async f => {
        const exchange = oetExchange(); await f.archive.import(exchange);
        const state = await f.archive.verify(), row = state.records[0];
        assert.equal(row.format, 'oet.legacy-signatures/v1'); assert.equal(row.loggedAt, '2026-09-11T01:00:00.000Z');
        assert.equal(row.previous, undefined); assert.equal(state.head, null); assert.equal(row.contentComplete, true);
        const exported = await f.archive.export();
        for (const [hash, original] of Object.entries(exchange.objects)) assert.equal(exported.objects[hash], original);
    });
    await check('legacy content gaps remain separate from signature validity', async f => {
        await f.archive.import(oetExchange({ gap: true })); const result = await f.archive.verify();
        assert.equal(result.verified, true); assert.equal(result.contentComplete, false); assert.equal(result.missingReferences, 1);
        await assert.rejects(f.archive.source(result.records[0].id, 'old-work/book/01.md'), /not available/);
    });
    await check('OET importer rejects files unbound by the original manifest', async f => {
        await assert.rejects(f.archive.import(oetExchange({ extra: true })), /unbound files/);
    });
    await check('OET v1 continuation retains scope and original predecessor receipts', async f => {
        const exchange = oetExchange(), first = withOetContinuation(exchange); withOetContinuation(exchange, 2, first);
        await f.archive.import(exchange); const result = await f.archive.verify();
        const records = result.records.filter(row => row.format === 'oet.sign-record/v1');
        assert.equal(records.length, 2); assert(records.every(row => Object.hasOwn(row.files, 'book/01.md')));
        assert.deepEqual(records.find(row => row.sequence === 2).previous, { record: first.record_sha256, bundle: first.bundle_sha256 });
    });
    await check('OET continuation cannot omit its bound old signatures', async f => {
        const exchange = oetExchange(); withOetContinuation(exchange); exchange.records.shift();
        await assert.rejects(f.archive.import(exchange), /bound legacy signature/);
    });
    await check('new native snapshot binds imported historical evidence', async f => {
        await f.archive.import(oetExchange()); const prepared = await signed(f, 'Continuation');
        const record = JSON.parse(await fs.readFile(path.join(f.store, `entries/${prepared.prepared}/record.json`)));
        assert.equal(record.previous, null); assert.equal(record.imports.length, 1); assert.equal((await f.archive.verify()).records.length, 2);
        const indexPath = path.join(f.store, `imports/${record.imports[0]}.json`); await fs.appendFile(indexPath, ' ');
        await assert.rejects(f.archive.verify(), /immutable archive import has changed/);
    });
    await check('native history and imported history round-trip together', async f => {
        await f.archive.import(oetExchange()); await signed(f, 'Continuation'); const exchange = await f.archive.export(), target = await fixture();
        try { await target.archive.import(exchange); assert.equal((await target.archive.verify()).records.length, 2); }
        finally { await fs.rm(target.root, { recursive: true, force: true }); }
    });
    await check('original objects are rechecked after authentication', async f => {
        const imported = await f.archive.import(oetExchange()), prepared = await f.archive.prepare('Continuation');
        await assert.rejects(f.archive.sign(prepared.prepared, async (record, bundle) => {
            await signer(record, bundle); await fs.appendFile(path.join(f.store, `objects/${imported.imported}`), ' ');
        }), /object has changed/);
        assert.equal(await exists(path.join(f.store, 'HEAD.json')), false);
    });
    await check('scope depth and exclusions are applied to file membership', async f => {
        await fs.mkdir(path.join(f.root, 'book/nested')); await fs.writeFile(path.join(f.root, 'book/nested/02.md'), 'Nested');
        const files = await api().captureSource(f.root, { paths: ['book'], extensions: ['.md'], maxDepth: 1 });
        assert.deepEqual([...files.keys()], ['book/01.md']);
        await assert.rejects(api().captureSource(f.root, { paths: ['../escape'], extensions: ['.md'] }), /project-relative/);
    });
    await check('symbolic links cannot redirect archived source', async f => {
        await fs.symlink(f.source, path.join(f.root, 'book/link.md'));
        await assert.rejects(f.archive.prepare('Symlink'), /symbolic links/);
    });
    await check('stable identifiers locate historical declarations', async f => {
        await signed(f); const history = await f.archive.history({ formalId: 'h-abcdef1234567890' });
        assert.equal(history.matches.length, 1); assert.equal(history.matches[0].filePath, 'book/01.md');
        assert.match(history.interpretation, /not a claim/);
    });
    await check('current-draft comparison uses declared current bytes', async f => {
        await signed(f); const old = (await f.archive.records()).records[0]; await fs.appendFile(f.source, '\nCurrent revision');
        const compared = await f.archive.compare(old.id, 'current');
        assert.deepEqual(compared.changes, [{ path: 'book/01.md', change: 'modified' }]);
        assert.match((await f.archive.currentSource('book/01.md')).content, /Current revision/);
        assert.doesNotMatch((await f.archive.source(old.id, 'book/01.md')).content, /Current revision/);
        await assert.rejects(f.archive.currentSource('.math-archive/policy.json'), /not in the current declared/);
    });
    await check('an active archive lock blocks another writer', async f => {
        await fs.writeFile(path.join(f.store, 'LOCK.json'), '{}');
        await assert.rejects(f.archive.prepare('Locked'), /Another archive operation/);
    });
    console.log(`Academic archive contracts: ${passed} passed.`);
}

export async function testArchiveReaderApi() {
    const f = await fixture();
    await fs.mkdir(path.join(f.root, '.math-workspace')); await fs.writeFile(path.join(f.root, '.math-workspace/config.json'), '{"language":"en"}');
    const cli = path.join(repo, 'out/cli/math-workspace.js');
    const stateRoot = path.join(f.root, '.reader-state'); await fs.mkdir(stateRoot);
    const bin = path.join(f.root, 'bin'); await fs.mkdir(bin);
    const finishAuthentication = path.join(f.root, 'finish-authentication');
    // A subprocess fixture exercises the production stdout -> signing -> HTTP handoff without signing anything.
    await fs.writeFile(path.join(bin, 'cosign'), '#!' + process.execPath + '\n' + `
        const fs = require('node:fs');
        const finish = ${JSON.stringify(finishAuthentication)};
        process.stdout.write('private output is not job data\\n');
        process.stdout.write('Enter the verification code EVIL-CODE in your browser at: https://example.invalid/auth/device?user_code=EVIL-CODE\\n');
        process.stdout.write('Enter the verification code MATH-TEST in your browser at: https://oauth2.sigstore.dev/auth/device?user_code=WRONG\\n');
        const timer = setInterval(() => {
            if (!fs.existsSync(finish)) return;
            if (fs.readFileSync(finish, 'utf8') === 'emit' && !global.sent) {
                global.sent = true;
                process.stdout.write('Enter the verification code MATH-TEST in your browser at: https://oauth2.sigstore.dev/auth/de');
                setTimeout(() => process.stdout.write('vice?user_code=MATH-TEST\\nCode will be valid for 300 seconds\\n'), 20);
            } else if (fs.readFileSync(finish, 'utf8') === 'finish') {
                clearInterval(timer); process.stderr.write('Test authentication ended without signing.'); process.exit(1);
            }
        }, 20);
        setTimeout(() => process.exit(1), 10000).unref();
    `, { mode: 0o755 });
    const child = spawn(process.execPath, [cli, 'serve', f.root, '--port', '0'], { cwd: f.root,
        env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, MATH_WORKSPACE_STATE: path.join(stateRoot, 'projects.json'), MATH_WORKSPACE_READER_INSTANCES: path.join(stateRoot, 'instances.json') },
        stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    try {
        const url = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Archive Reader did not start: ' + output)), 12000);
            const receive = chunk => { output += String(chunk); const match = output.match(/Math Workspace: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } };
            child.stdout.on('data', receive); child.stderr.on('data', receive);
            child.once('error', reject); child.once('exit', code => { clearTimeout(timer); if (!output.includes('Math Workspace:')) reject(new Error(`Reader exited ${code}: ${output}`)); });
        });
        const state = await (await fetch(url + '/api/state')).json();
        assert.match(state.projectId, /^[a-f0-9]{64}$/);
        assert.equal((await fetch(url + '/api/archive')).status, 403);
        assert.equal((await fetch(url + '/api/archive', { headers: { 'x-math-workspace-token': state.requestToken } })).status, 409);
        const headers = { 'x-math-workspace-token': state.requestToken, 'x-math-workspace-project': state.projectId, 'content-type': 'application/json' };
        const status = await (await fetch(url + '/api/archive', { headers })).json();
        assert.equal(status.configured, true); assert.deepEqual(status.records, []);
        const source = await fs.readFile(f.source);
        const response = await fetch(url + '/api/archive/action', { method: 'POST', headers, body: JSON.stringify({ action: 'prepare', label: 'Reader preview' }) });
        assert.equal(response.status, 202); let job = await response.json();
        for (let tries = 0; tries < 100 && job.state === 'running'; tries++) {
            await new Promise(resolve => setTimeout(resolve, 30)); job = await (await fetch(`${url}/api/archive/job?id=${job.id}`, { headers })).json();
        }
        assert.equal(job.state, 'completed', job.error); assert.equal(job.result.signatureCreated, false);
        const after = await (await fetch(url + '/api/archive', { headers })).json();
        assert.equal(after.pending.length, 1); assert.equal(after.pending[0].changes.length, 1); assert.equal(after.pending[0].currentMatches, true);
        assert.deepEqual(await fs.readFile(f.source), source); assert.equal(await exists(path.join(f.store, 'HEAD.json')), false);
        const signResponse = await fetch(url + '/api/archive/action', { method: 'POST', headers,
            body: JSON.stringify({ action: 'sign', prepared: after.pending[0].prepared }) });
        assert.equal(signResponse.status, 202); let signing = await signResponse.json();
        for (let tries = 0; tries < 100 && !output.includes('user_code=WRONG'); tries++) await new Promise(resolve => setTimeout(resolve, 20));
        assert(output.includes('user_code=WRONG'), output);
        signing = await (await fetch(`${url}/api/archive/job?id=${signing.id}`, { headers })).json();
        assert.equal(signing.state, 'running'); assert.equal(signing.authentication, undefined);
        await fs.writeFile(finishAuthentication, 'emit');
        for (let tries = 0; tries < 100 && !signing.authentication && signing.state === 'running'; tries++) {
            await new Promise(resolve => setTimeout(resolve, 20));
            signing = await (await fetch(`${url}/api/archive/job?id=${signing.id}`, { headers })).json();
        }
        assert.equal(signing.state, 'running', signing.error);
        assert.deepEqual(signing.authentication, { url: 'https://oauth2.sigstore.dev/auth/device?user_code=MATH-TEST', code: 'MATH-TEST' });
        assert.doesNotMatch(JSON.stringify(signing), /private output|EVIL-CODE|WRONG/);
        await fs.writeFile(finishAuthentication, 'finish');
        for (let tries = 0; tries < 100 && signing.state === 'running'; tries++) {
            await new Promise(resolve => setTimeout(resolve, 20));
            signing = await (await fetch(`${url}/api/archive/job?id=${signing.id}`, { headers })).json();
        }
        assert.equal(signing.state, 'failed'); assert.equal(signing.authentication, undefined);
        assert.equal(await exists(path.join(f.store, 'HEAD.json')), false); assert.deepEqual(await fs.readFile(f.source), source);
        const wrongProject = await fetch(url + '/api/archive/action', { method: 'POST', headers: { ...headers, 'x-math-workspace-project': '0'.repeat(64) }, body: JSON.stringify({ action: 'prepare', label: 'wrong project' }) });
        assert.equal(wrongProject.status, 409);
        assert.equal((await fetch(url + '/api/archive', { method: 'DELETE', headers })).status, 405);
        const cliResult = spawnSync(process.execPath, [cli, 'archive', 'status', '--prepared', '0'.repeat(64)], { cwd: f.root, encoding: 'utf8' });
        assert.notEqual(cliResult.status, 0); assert.match(cliResult.stderr, /does not apply/);
    } finally {
        if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited; }
        await fs.rm(f.root, { recursive: true, force: true });
    }
    console.log('Academic archive Reader: token, project binding, async preparation, authentication handoff, source preservation and CLI admission passed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.includes('--reader')) await testArchiveReaderApi(); else await testArchives();
}
