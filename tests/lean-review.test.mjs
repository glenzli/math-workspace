import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = 'h-1111111111111111', B = 'h-2222222222222222', C = 'h-3333333333333333';
const toolchain = 'leanprover/lean4:v4.33.1';
const lake = path.join(process.env.ELAN_HOME || path.join(os.homedir(), '.elan'), 'toolchains/leanprover--lean4---v4.33.1/bin/lake');

export async function createLeanReviewFixture(root, { buildLean = true } = {}) {
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.mkdir(path.join(root, 'book'), { recursive: true });
    await fs.mkdir(path.join(root, 'lean'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace/config.json'), JSON.stringify({ lean: { projects: [
        { key: 'fixture', root: 'lean', sourceRoots: ['.'], target: 'ReviewFixture', module: 'ReviewFixture' }
    ] } }));
    await fs.writeFile(path.join(root, 'book/01-review.md'), `# Review\n\nThe claim is global in n.\n\n定理 #${A}（Two subclaims）：For every n, n = n, and a certificate can be constructed.\n\n证明：Use reflexivity; the certificate construction remains to be checked.\n证毕。\n\n定理 #${B}（Trust boundary）：For every n, n = n.\n\n证明：Reflexivity.\n证毕。\n\n习题 #${C}（Unmapped）：Construct the missing certificate.\n\n提示：Check all quantifiers.\n`);
    await fs.writeFile(path.join(root, 'lean/lean-toolchain'), toolchain + '\n');
    await fs.writeFile(path.join(root, 'lean/lakefile.toml'), 'name = "review-fixture"\nversion = "0.1.0"\ndefaultTargets = ["ReviewFixture"]\n\n[[lean_lib]]\nname = "ReviewFixture"\n');
    await fs.writeFile(path.join(root, 'lean/ReviewFixture.lean'), `import Lean\n\nnamespace ReviewFixture\ndef FiniteClaim (n : Nat) : Prop := n = n\nstructure Certificate (n : Nat) : Prop where\n  proof : FiniteClaim n\nsection\nvariable {n : Nat} (certificate : Certificate n)\ninclude certificate\n/-- Math Workspace anchor: ${A} certificate input -/\ntheorem certificate_input : FiniteClaim n := certificate.proof\nomit certificate\n/-- Math Workspace anchor: ${A} formula only -/\ntheorem simple_identity (n : Nat) : n = n := rfl\nend\n/-- Math Workspace anchor: ${B} sorry example -/\ntheorem unfinished (n : Nat) : n = n := by sorry\nend ReviewFixture\n`);
    if (buildLean) {
        const result = spawnSync(lake, ['--offline', '--no-cache', '--rehash', 'build', 'ReviewFixture'], { cwd: path.join(root, 'lean'), encoding: 'utf8',
            env: { ...process.env, LEAN: path.join(path.dirname(lake), 'lean'), LEAN_SYSROOT: path.dirname(path.dirname(lake)), LEAN_PATH: undefined, LEAN_SRC_PATH: undefined } });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
    }
    return root;
}

async function waitJob(service, root, job) {
    const start = Date.now();
    while (Date.now() - start < 60000) {
        const current = (await service.job(root, job.id)).job;
        if (!['queued', 'running'].includes(current.status)) return current;
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Timed out waiting for Lean evidence fixture.');
}

function saveBody(response, overrides = {}) {
    return { action: 'save', id: response.id, expectedRevision: response.review.expectedRevision,
        evidenceFingerprint: response.evidence.fingerprint, verdict: 'partial', reviewer: 'human reviewer',
        scope: 'Only reflexive equality; construction is not covered.', note: 'The supplied certificate is an input.',
        subclaims: [
            { id: 'identity', text: 'For every n, n = n.', declarationKeys: response.evidence.declarations.map(item => item.key), verdict: 'aligned', note: '' },
            { id: 'construction', text: 'Construct a certificate.', declarationKeys: [], verdict: 'undecided', note: 'No construction was established.' }
        ], ...overrides };
}

export async function testLeanReviewBackend() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-lean-review-'));
    let service, server;
    try {
        await build({ entryPoints: [path.join(repoRoot, 'src/lean/lean-review-service.ts'), path.join(repoRoot, 'src/reader/server.ts')],
            bundle: true, platform: 'node', format: 'cjs', outdir: path.join(temporary, 'bundle'),
            outExtension: { '.js': '.cjs' }, tsconfig: path.join(repoRoot, 'tsconfig.cli.json'), logLevel: 'silent' });
        const { LeanReviewService } = require(path.join(temporary, 'bundle/lean/lean-review-service.cjs'));
        const { startReaderServer } = require(path.join(temporary, 'bundle/reader/server.cjs'));
        const installed = await fs.access(lake).then(() => true, () => false);
        const root = await createLeanReviewFixture(path.join(temporary, 'project'), { buildLean: installed });
        service = new LeanReviewService();
        const sourceBefore = await fs.readFile(path.join(root, 'lean/ReviewFixture.lean'), 'utf8');
        const initial = await service.get(root, A);
        assert.equal(initial.evidence.declarations.length, 2);
        assert.equal(initial.evidence.state, 'unavailable');
        assert.equal(initial.review.freshness, 'unreviewed');
        assert.match(initial.evidence.proofs[0].content, /construction remains/);
        assert.match(initial.evidence.contexts[0].content, /global in n/);
        assert.equal(await fs.access(path.join(root, '.math-workspace/lean-review-evidence')).then(() => true, () => false), false,
            'GET must not create evidence metadata or start a build.');
        if (!installed) {
            // Lean is optional for repository consumers; missing tooling still exercises the
            // persisted human-review boundary rather than downloading a test toolchain.
            await service.action(root, saveBody(initial));
            const saved = await service.get(root, A);
            assert.equal(saved.review.freshness, 'current');
            await assert.rejects(service.action(root, saveBody(initial)), /changed in another window/);
            await service.close(); service = new LeanReviewService();
            assert.equal((await service.get(root, A)).review.record.revision, 1);
            const unavailable = await service.action(root, { action: 'refresh', id: A });
            assert.equal((await waitJob(service, root, unavailable.value.job)).status, 'failed');
            assert.equal((await service.get(root, A)).evidence.state, 'unavailable');
            console.log('ok - raw Lean review persistence; real elaboration fixture skipped because Lean 4.33.1 is not installed');
            return;
        }

        const start = await service.action(root, { action: 'refresh', id: A });
        assert.equal(start.status, 202);
        const completed = await waitJob(service, root, start.value.job);
        assert.equal(completed.status, 'completed', completed.error);
        const current = await service.get(root, A);
        assert.equal(current.evidence.state, 'current', JSON.stringify(current.evidence.diagnostics));
        const certificate = current.evidence.declarations.find(item => item.name === 'certificate_input');
        assert.match(certificate.elaboratedType, /Certificate/);
        assert.match(certificate.elaboratedType, /Nat/);
        assert.match(certificate.elaboratedType, /n/);
        assert.equal(certificate.evidenceState, 'available');
        assert.deepEqual(certificate.axioms, []);
        assert.ok(current.evidence.definitions.some(item => item.name === 'Certificate'));
        assert.match(current.evidence.definitions.find(item => item.name === 'Certificate').source.content, /proof : FiniteClaim n/,
            'Structure fields must be visible in the actual located source.');
        assert.equal(certificate.source.rangeKind, 'source', 'GET must retain the elaborator-provided source range.');
        assert.equal(current.evidence.projects[0].build.state, 'passed');
        assert.match(current.evidence.projects[0].build.command.join(' '), /--offline --no-cache --rehash build/);
        assert.equal(current.review.freshness, 'unreviewed', 'Successful kernel evidence must never create a human verdict.');

        await service.action(root, saveBody(current));
        const saved = await service.get(root, A);
        assert.equal(saved.review.record.revision, 1);
        assert.equal(saved.review.record.verdict, 'partial');
        assert.equal(saved.review.record.subclaims[1].declarationKeys.length, 0);
        assert.equal(saved.review.freshness, 'current');
        assert.equal((await service.get(root, B)).review.freshness, 'unreviewed', 'Saving one object must not capture all anchors.');
        assert.equal(await fs.access(path.join(root, '.math-workspace/lean-contracts.json')).then(() => true, () => false), false);
        await assert.rejects(service.action(root, saveBody(current)), /changed in another window/);
        const concurrent = await Promise.allSettled([service.action(root, saveBody(saved)), service.action(root, saveBody(saved))]);
        assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1, 'Revision CAS must admit exactly one concurrent writer.');
        await service.close(); service = new LeanReviewService();
        assert.equal((await service.get(root, A)).review.record.revision, 2, 'Reopening the owner must restore project records.');
        const queue = await service.queue(root, 'book/01-review.md');
        assert.equal(queue.items.length, 3);
        assert.equal(queue.items.find(item => item.id === C).anchored, false);
        assert.equal(queue.items.find(item => item.id === A).reviewer, 'human reviewer');

        const reference = 'h-4444444444444444';
        const mainBeforeReference = await fs.readFile(path.join(root, 'book/01-review.md'), 'utf8');
        await fs.writeFile(path.join(root, 'book/02-definition.md'), `# Background\n\n定理 #${reference}（Domain）：Only natural-number inputs are allowed.\n`);
        await fs.writeFile(path.join(root, 'book/01-review.md'), mainBeforeReference.replace('For every n, n = n,', `Under @${reference}, for every n, n = n,`));
        const linked = await service.get(root, A);
        assert.ok(linked.evidence.contexts.some(item => item.filePath === 'book/02-definition.md' && /natural-number/.test(item.content)));
        await service.action(root, saveBody(linked));
        const beforeReferenceEdit = await service.get(root, A);
        await fs.writeFile(path.join(root, 'book/02-definition.md'), `# Background\n\n定理 #${reference}（Domain）：Real-number inputs are allowed.\n`);
        const changedReference = await service.get(root, A);
        assert.equal(changedReference.review.freshness, 'stale');
        assert.ok(changedReference.review.changes.some(item => item.kind === 'context' && /Real-number/.test(item.current)));
        await assert.rejects(service.action(root, saveBody(beforeReferenceEdit)), /displayed evidence changed/);

        const hostileVariables = ['LEAN', 'LAKE', 'LEAN_SYSROOT', 'LEAN_PATH', 'LEAN_SRC_PATH', 'LAKE_HOME'];
        const previousEnv = Object.fromEntries(hostileVariables.map(key => [key, process.env[key]]));
        try {
            for (const key of hostileVariables) process.env[key] = path.join(temporary, `hostile-${key}`);
            const pinned = await service.action(root, { action: 'refresh', id: A });
            assert.equal((await waitJob(service, root, pinned.value.job)).status, 'completed',
                'Configured installed Lean must be used despite ambient compiler/search-path overrides.');
        } finally {
            for (const [key, value] of Object.entries(previousEnv)) {
                if (value === undefined) delete process.env[key]; else process.env[key] = value;
            }
        }

        const old = await service.get(root, A);
        await fs.writeFile(path.join(root, 'book/01-review.md'), (await fs.readFile(path.join(root, 'book/01-review.md'), 'utf8')).replace('construction remains to be checked', 'construction is a newly changed proof'));
        await assert.rejects(service.action(root, saveBody(old)), /displayed evidence changed/, 'An immediate disk edit must reject a save without waiting for watcher refresh.');
        const proofChanged = await service.get(root, A);
        assert.equal(proofChanged.review.freshness, 'stale');
        assert.equal(proofChanged.evidence.state, 'current', 'Markdown proof drift does not invalidate unchanged Lean kernel evidence.');
        assert.ok(proofChanged.review.changes.some(item => item.kind === 'proof' && /newly changed proof/.test(item.current)));

        await fs.writeFile(path.join(root, 'lean/ReviewFixture.lean'), sourceBefore.replace('n = n\nstructure', 'n + 0 = n\nstructure'));
        const definitionChanged = await service.get(root, A);
        assert.equal(definitionChanged.evidence.state, 'stale', 'A definition edit must invalidate an unchanged theorem signature.');
        assert.ok(definitionChanged.review.changes.some(item => item.kind === 'environment'));
        const refreshed = await service.action(root, { action: 'refresh', id: A });
        const refreshResult = await waitJob(service, root, refreshed.value.job);
        assert.equal(refreshResult.status, 'completed', refreshResult.error);
        const withDefinition = await service.get(root, A);
        assert.equal(withDefinition.evidence.state, 'current');
        assert.equal(withDefinition.review.freshness, 'stale', 'Refreshing evidence must not refresh a human conclusion.');
        const definition = await service.definition(root, A, 'fixture', 'ReviewFixture.FiniteClaim');
        assert.equal(definition.state, 'available');
        assert.match(definition.definition.value, /Nat\.add|HAdd\.hAdd|\+/);

        const trust = await service.action(root, { action: 'refresh', id: B });
        assert.equal((await waitJob(service, root, trust.value.job)).status, 'completed');
        assert.ok((await service.get(root, B)).evidence.declarations[0].axioms.includes('sorryAx'));
        const unanchored = await service.get(root, C);
        assert.equal(unanchored.evidence.declarations.length, 0);
        assert.equal(unanchored.evidence.state, 'unavailable');
        await assert.rejects(service.action(root, saveBody(unanchored, { subclaims: [{ id: 'bad', text: 'foreign', verdict: 'aligned', note: '', declarationKeys: ['fixture:ReviewFixture.simple_identity'] }] })), /outside this formal object/);
        await assert.rejects(service.get(root, '../../escape'), /stable formal/);

        const cachePath = path.join(root, `.math-workspace/lean-review-evidence/${A}.json`);
        await fs.writeFile(cachePath, '{malformed cache');
        await assert.rejects(service.get(root, A), /metadata is unreadable/);
        const recover = await service.action(root, { action: 'refresh', id: A });
        assert.equal((await waitJob(service, root, recover.value.job)).status, 'completed');
        assert.ok((await fs.readdir(path.dirname(cachePath))).some(name => name.includes(`${A}-invalid-`)), 'Explicit refresh preserves the malformed cache bytes.');

        await fs.mkdir(path.join(root, 'support'));
        await fs.writeFile(path.join(root, 'support/lakefile.toml'), 'name = "support"\n\n[[lean_lib]]\nname = "Support"\n');
        await fs.writeFile(path.join(root, 'support/Support.lean'), 'namespace Support\nclass ImportedCertificate : Prop where\n  evidence : True\nend Support\n');
        await fs.appendFile(path.join(root, 'lean/lakefile.toml'), '\n[[require]]\nname = "support"\npath = "../support"\n');
        await fs.writeFile(path.join(root, 'lean/ReviewFixture.lean'), (await fs.readFile(path.join(root, 'lean/ReviewFixture.lean'), 'utf8'))
            .replace('import Lean', 'import Lean\nimport Support').replace('theorem certificate_input :', 'theorem certificate_input (_external : Support.ImportedCertificate) :'));
        const update = spawnSync(lake, ['--offline', '--no-cache', 'update'], { cwd: path.join(root, 'lean'), encoding: 'utf8' });
        assert.equal(update.status, 0, update.stdout + update.stderr);
        const siblingRefresh = await service.action(root, { action: 'refresh', id: A });
        const siblingJob = await waitJob(service, root, siblingRefresh.value.job);
        assert.equal(siblingJob.status, 'completed', siblingJob.error);
        const sibling = await service.get(root, A);
        const imported = sibling.evidence.definitions.find(item => item.qualifiedName === 'Support.ImportedCertificate');
        assert.match(imported?.source?.content || '', /evidence : True/, 'Imported class fields must be read from the actual tracked path dependency.');
        assert.equal(imported.source.filePath, 'support/Support.lean');
        await service.action(root, saveBody(sibling));
        const beforeSiblingEdit = await service.get(root, A);
        await fs.writeFile(path.join(root, 'support/Support.lean'), 'namespace Support\nclass ImportedCertificate : Prop where\n  evidence : True\n  extra : True\nend Support\n');
        const siblingChanged = await service.get(root, A);
        assert.equal(siblingChanged.evidence.state, 'stale');
        assert.equal(siblingChanged.review.freshness, 'stale');
        await assert.rejects(service.action(root, saveBody(beforeSiblingEdit)), /displayed evidence changed/);

        await fs.writeFile(path.join(root, 'lean/Other.lean'), 'namespace ReviewFixture\ntheorem certificate_input (n : Nat) : n = n := rfl\ntheorem simple_identity (n : Nat) : n = n := rfl\nend ReviewFixture\n');
        await fs.appendFile(path.join(root, 'lean/lakefile.toml'), '\n[[lean_lib]]\nname = "Other"\n');
        const originalConfig = await fs.readFile(path.join(root, '.math-workspace/config.json'), 'utf8');
        await fs.writeFile(path.join(root, '.math-workspace/config.json'), originalConfig.replaceAll('"target":"ReviewFixture"', '"target":"Other"').replaceAll('"module":"ReviewFixture"', '"module":"Other"'));
        const wrongOrigin = await service.action(root, { action: 'refresh', id: A });
        assert.equal((await waitJob(service, root, wrongOrigin.value.job)).status, 'failed');
        const origin = await service.get(root, A);
        assert.equal(origin.evidence.state, 'unavailable');
        assert.ok(origin.evidence.declarations.every(item => /cannot be verified as the anchored source/.test(item.diagnostic)),
            'An identically named declaration from another module must never certify the indexed source.');
        await fs.writeFile(path.join(root, '.math-workspace/config.json'), originalConfig);

        const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'math-review-outside-'));
        try {
            const leanDirectory = path.join(root, 'lean');
            await fs.rename(leanDirectory, path.join(root, 'lean-preserved'));
            await fs.symlink(outside, leanDirectory);
            await assert.rejects(service.get(root, A), /escapes the project through a symlink/);
            await fs.rm(leanDirectory);
            await fs.rename(path.join(root, 'lean-preserved'), leanDirectory);
        } finally { await fs.rm(outside, { recursive: true, force: true }); }

        server = await startReaderServer({ rootPath: root, port: 0, recentProjectsPath: path.join(temporary, 'recent.json'), locationRegistryPath: path.join(temporary, 'locations.json') });
        const state = await (await fetch(server.url + '/api/state')).json();
        assert.equal((await fetch(server.url + '/api/lean-review?id=' + A)).status, 403);
        const headers = { 'content-type': 'application/json', 'x-math-workspace-token': state.requestToken, 'x-math-workspace-project': state.projectId };
        const routeObject = await (await fetch(server.url + '/api/lean-review?id=' + A, { headers })).json();
        assert.equal(routeObject.review.freshness, 'stale');
        assert.equal((await fetch(server.url + '/api/lean-review?id=' + A, { headers: { ...headers, 'x-math-workspace-project': 'wrong' } })).status, 409);
        const rejectedProject = await fetch(server.url + '/api/lean-review/action', { method: 'POST', headers: { ...headers, 'x-math-workspace-project': 'wrong' }, body: JSON.stringify(saveBody(routeObject)) });
        assert.equal(rejectedProject.status, 409);
        const accepted = await fetch(server.url + '/api/lean-review/action', { method: 'POST', headers, body: JSON.stringify(saveBody(routeObject)) });
        assert.equal(accepted.status, 200, await accepted.text());
        assert.match(await fs.readFile(path.join(root, 'lean/ReviewFixture.lean'), 'utf8'), /_external : Support.ImportedCertificate/, 'Review operations must preserve Lean source.');
    } finally {
        await server?.close(); await service?.close();
        await fs.rm(temporary, { recursive: true, force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await testLeanReviewBackend();
    console.log('ok - Lean review evidence, persistence, freshness and local API');
}
