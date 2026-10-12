import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const toolchainRoot = version => path.join(process.env.ELAN_HOME || path.join(os.homedir(), '.elan'), `toolchains/leanprover--lean4---v${version}`);
const profile = '(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write-data (literal "/dev/null"))';

async function fixture(root, version) {
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.mkdir(path.join(root, 'lean/LanguageFixture'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace/config.json'), JSON.stringify({ lean: { projects: [
        { key: 'fixture', root: 'lean', sourceRoots: ['.'], target: 'LanguageFixture' }
    ] } }));
    await fs.writeFile(path.join(root, 'lean/lean-toolchain'), `leanprover/lean4:v${version}\n`);
    await fs.writeFile(path.join(root, 'lean/lakefile.toml'), 'name = "language-fixture"\n\n[[lean_lib]]\nname = "LanguageFixture"\n');
    await fs.writeFile(path.join(root, 'lean/LanguageFixture/Support.lean'), 'namespace LanguageFixture\ndef successor (n : Nat) := n + 1\nend LanguageFixture\n');
    const content = [
        'import Lean', 'import LanguageFixture.Support', 'namespace LanguageFixture',
        '/- nested /- 内层 -/ comment 😀 -/', 'def «🌱 消息» : String := "λ 😀 -- string"',
        'theorem pair_claim (p q : Prop) (hp : p) (hq : q) : p ∧ q := by',
        '  constructor', '  · exact hp', '  · exact hq',
        'theorem successor_three : successor 3 = 4 := by', '  rfl',
        'theorem unfinished : True := by sorry', 'end LanguageFixture', ''
    ].join('\n');
    await fs.writeFile(path.join(root, 'lean/LanguageFixture.lean'), content);
    const binaryRoot = toolchainRoot(version);
    if (await fs.access(path.join(binaryRoot, 'bin/lake')).then(() => true, () => false)) {
        const result = spawnSync(path.join(binaryRoot, 'bin/lake'), ['--offline', '--no-cache', 'build', 'LanguageFixture'], {
            cwd: path.join(root, 'lean'), encoding: 'utf8', timeout: 60000,
            env: { ...process.env, LEAN: path.join(binaryRoot, 'bin/lean'), LAKE: path.join(binaryRoot, 'bin/lake'),
                LEAN_SYSROOT: binaryRoot, LEAN_PATH: undefined, LEAN_SRC_PATH: undefined }
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    return { root, content };
}
function body(source, session, action, requestId, position) {
    return { action, requestId, projectKey: source.projectKey, filePath: source.filePath, sourceHash: source.sourceHash,
        ...(session ? { sessionId: session.sessionId, sourceVersion: session.sourceVersion } : {}), ...(position ? { position } : {}) };
}
function position(content, needle, token = needle) {
    const rows = content.split('\n'), line = rows.findIndex(row => row.includes(needle));
    assert.ok(line >= 0, needle); return { line, character: rows[line].indexOf(token) + 1 };
}
function tacticPosition(content) {
    const rows = content.split('\n'), line = rows.findIndex(row => row.includes('· exact hp'));
    return { line, character: rows[line].indexOf('exact') };
}
async function fileSnapshot(root) {
    const result = {};
    const visit = async directory => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(file);
            else if (entry.isFile()) result[path.relative(root, file)] = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
        }
    };
    await visit(root); return result;
}
function descendants(pid) {
    const output = spawnSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).stdout || '';
    const pairs = output.split('\n').map(row => row.trim().split(/\s+/).map(Number)).filter(pair => pair.length === 2);
    const found = new Set([pid]);
    for (let iteration = 0; iteration < 16; iteration++) for (const [child, parent] of pairs) if (found.has(parent)) found.add(child);
    return [...found];
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (_error) { return false; } }

export async function testLeanLanguageBackend() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-lean-language-tests-'));
    let service, server;
    try {
        await build({ entryPoints: [path.join(repoRoot, 'src/lean/lean-language-service.ts'), path.join(repoRoot, 'src/reader/server.ts')],
            bundle: true, platform: 'node', format: 'cjs', outdir: path.join(temporary, 'bundle'), outExtension: { '.js': '.cjs' },
            tsconfig: path.join(repoRoot, 'tsconfig.cli.json'), logLevel: 'silent' });
        const { LeanLanguageService } = require(path.join(temporary, 'bundle/lean/lean-language-service.cjs'));
        const { startReaderServer } = require(path.join(temporary, 'bundle/reader/server.cjs'));
        const current = await fixture(path.join(temporary, 'project'), '4.33.1');
        service = new LeanLanguageService();
        const source = await service.source(current.root, 'fixture', 'lean/LanguageFixture.lean');
        assert.equal(source.content, current.content);
        assert.equal(source.readonly, true);
        assert.equal(source.lineCount, current.content.split('\n').length);
        assert.match(source.sourceUri, /^mw-lean:/);
        assert.equal(service.sessions.size, 0, 'Complete source GET must never start Lean.');
        await assert.rejects(service.source(current.root, 'fixture', '../../outside.lean'), /outside/);
        await assert.rejects(service.source(current.root, 'fixture', '/tmp/outside.lean'), /project-relative/);
        await assert.rejects(service.source(current.root, 'fixture', 'lean/lakefile.toml'), /actual Lean source/);
        await assert.rejects(service.source(current.root, 'unknown', 'lean/LanguageFixture.lean'), /not uniquely configured/);
        await fs.writeFile(path.join(current.root, 'unrelated.lean'), 'def unrelated := 1\n');
        await assert.rejects(service.source(current.root, 'fixture', 'unrelated.lean'), /outside configured/);
        await fs.symlink(path.join(current.root, 'lean/LanguageFixture.lean'), path.join(current.root, 'lean/link.lean'));
        await assert.rejects(service.source(current.root, 'fixture', 'lean/link.lean'), /symlinks/);
        await fs.rm(path.join(current.root, 'lean/link.lean'));
        await fs.mkdir(path.join(current.root, 'lean/docs'));
        await fs.mkdir(path.join(current.root, 'lean/bench'));
        await fs.writeFile(path.join(current.root, 'lean/README.md'), 'Documentation alias target.\n');
        await fs.writeFile(path.join(current.root, 'lean/bench/run'), 'Benchmark alias target.\n');
        await fs.symlink('../README.md', path.join(current.root, 'lean/docs/README.md'));
        await fs.symlink('run', path.join(current.root, 'lean/bench/run.py'));
        await assert.rejects(service.action(current.root, { ...body(source, null, 'open', 'stale-open'), sourceHash: '0'.repeat(64) }), /displayed Lean source changed/);
        await assert.rejects(service.action(current.root, { ...body(source, null, 'open', 'malformed'), requestId: null }), /request id/);
        assert.equal(service.sessions.size, 0);

        server = await startReaderServer({ rootPath: current.root, recentProjectsPath: path.join(temporary, 'recent.json'), locationRegistryPath: path.join(temporary, 'locations.json') });
        const state = await (await fetch(server.url + '/api/state')).json();
        const url = server.url + '/api/lean-language/source?projectKey=fixture&filePath=lean%2FLanguageFixture.lean';
        assert.equal((await fetch(url)).status, 403);
        assert.equal((await fetch(url, { headers: { 'x-math-workspace-token': state.requestToken } })).status, 409);
        const headers = { 'x-math-workspace-token': state.requestToken, 'x-math-workspace-project': source.projectToken, 'content-type': 'application/json' };
        assert.equal((await fetch(url, { headers })).status, 200);
        assert.equal((await fetch(url, { headers: { ...headers, 'x-math-workspace-project': '0'.repeat(64) } })).status, 409);
        assert.equal((await fetch(server.url + '/api/lean-language/action', { method: 'POST', headers: { ...headers, origin: 'https://foreign.example' }, body: JSON.stringify(body(source, null, 'open', 'foreign')) })).status, 403);
        await server.close(); server = undefined;

        const installed = await fs.access(path.join(toolchainRoot('4.33.1'), 'bin/lean')).then(() => true, () => false);
        const nativeAvailable = installed && process.platform === 'darwin' && spawnSync('/usr/bin/sandbox-exec', ['-p', profile, path.join(toolchainRoot('4.33.1'), 'bin/lean'), '--version'], { encoding: 'utf8' }).status === 0;
        if (!nativeAvailable) {
            const result = await service.action(current.root, body(source, null, 'open', 'unavailable-native'));
            assert.equal(result.state, 'unavailable');
            console.log('ok - passive source/security contracts; real Lean language checks skipped because installed toolchain/native read-only sandbox is unavailable');
            return;
        }

        const before = await fileSnapshot(current.root);
        await fs.symlink('LanguageFixture/Support.lean', path.join(current.root, 'lean/symlink-source.lean'));
        await assert.rejects(service.action(current.root, body(source, null, 'open', 'source-symlink-environment')), /environment symlinks/);
        await fs.rm(path.join(current.root, 'lean/symlink-source.lean'));
        const supportArtifact = path.join(current.root, 'lean/.lake/build/lib/lean/LanguageFixture/Support.olean');
        await fs.symlink(supportArtifact, path.join(current.root, 'lean/symlink-artifact.olean'));
        await assert.rejects(service.action(current.root, body(source, null, 'open', 'artifact-symlink-environment')), /environment symlinks/);
        await fs.rm(path.join(current.root, 'lean/symlink-artifact.olean'));
        const hostileNames = ['LEAN', 'LAKE', 'LEAN_PATH', 'LEAN_SRC_PATH', 'LEAN_SYSROOT', 'LAKE_HOME'];
        const previousEnvironment = Object.fromEntries(hostileNames.map(name => [name, process.env[name]]));
        let open;
        try {
            for (const name of hostileNames) process.env[name] = path.join(temporary, `hostile-${name}`);
            open = await service.action(current.root, body(source, null, 'open', 'window-a-open'));
        } finally {
            for (const [name, value] of Object.entries(previousEnvironment)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
        }
        assert.equal(open.state, 'available', open.reason);
        assert.equal(open.complete, true);
        assert.ok(open.tokens.length > 10);
        assert.ok(open.diagnostics.some(item => /sorry/.test(item.message)));
        assert.equal(open.diagnostics.some(item => item.severity === 1), false, JSON.stringify(open.diagnostics));
        const hover = await service.action(current.root, body(source, open, 'hover', 'hover', position(source.content, 'successor_three', 'successor 3')));
        assert.match(JSON.stringify(hover.hover), /successor|Nat/);
        const goal = await service.action(current.root, body(source, open, 'goals', 'goals', tacticPosition(source.content)));
        assert.ok(goal.goals.some(item => /hp : p/.test(item) && /hq : q/.test(item) && /⊢ p/.test(item)), JSON.stringify(goal));
        const definition = await service.action(current.root, body(source, open, 'definition', 'definition', position(source.content, 'successor_three', 'successor 3')));
        assert.ok(definition.definitions.some(item => item.filePath === 'lean/LanguageFixture/Support.lean'));
        const stdlib = await service.action(current.root, body(source, open, 'definition', 'stdlib-definition', position(source.content, 'successor_three', '= 4')));
        const standard = stdlib.definitions.find(item => item.origin === 'toolchain');
        assert.ok(standard, JSON.stringify(stdlib));
        assert.ok((await service.source(current.root, standard.projectKey, standard.filePath)).content.length > 100);
        const unicodeRow = source.content.split('\n')[4];
        const unicodeGoal = await service.action(current.root, body(source, open, 'hover', 'unicode-hover', { line: 4, character: unicodeRow.indexOf('String') + 1 }));
        assert.match(JSON.stringify(unicodeGoal.hover), /String/);
        const surrogate = source.content.split('\n')[3].indexOf('😀');
        await assert.rejects(service.action(current.root, body(source, open, 'hover', 'bad-unicode', { line: 3, character: surrogate + 1 })), /surrogate pair/);
        await assert.rejects(service.action(current.root, body(source, open, 'hover', 'bad-position', { line: 999999, character: 0 })), /UTF-16/);

        const second = await service.action(current.root, body(source, null, 'open', 'window-b-open'));
        assert.equal(second.state, 'available', second.reason);
        assert.notEqual(second.sessionId, open.sessionId);
        assert.equal((await service.action(current.root, body(source, open, 'goals', 'window-a-still-live', tacticPosition(source.content)))).state, 'available');
        await assert.rejects(service.action(current.root, body(source, null, 'open', 'third-window')), error => error.status === 429);
        await service.action(current.root, body(source, second, 'close', 'window-b-close'));

        const supportPath = path.join(current.root, 'lean/LanguageFixture/Support.lean');
        const supportBefore = await fs.readFile(supportPath, 'utf8');
        await fs.appendFile(supportPath, '-- input changed\n');
        await assert.rejects(service.action(current.root, body(source, open, 'goals', 'stale-import', tacticPosition(source.content))), /source, imports, build artifacts/);
        assert.equal(service.sessions.size, 0, 'Imported source drift must retire old semantics.');
        await fs.writeFile(supportPath, supportBefore);
        const updatedSource = await service.source(current.root, 'fixture', source.filePath);
        const reopened = await service.action(current.root, body(updatedSource, null, 'open', 'close-after-edit-open'));
        assert.equal(reopened.state, 'available', reopened.reason);
        await fs.appendFile(path.join(current.root, source.filePath), '-- changed active file\n');
        assert.equal((await service.action(current.root, body(updatedSource, reopened, 'close', 'close-after-edit'))).state, 'closed');
        await fs.writeFile(path.join(current.root, source.filePath), current.content);
        const deletedSession = await service.action(current.root, body(source, null, 'open', 'close-after-delete-open'));
        assert.equal(deletedSession.state, 'available', deletedSession.reason);
        await fs.rm(path.join(current.root, source.filePath));
        assert.equal((await service.action(current.root, body(source, deletedSession, 'close', 'close-after-delete'))).state, 'closed');
        await fs.writeFile(path.join(current.root, source.filePath), current.content);

        const cancelling = service.action(current.root, body(source, null, 'open', 'cancel-startup'));
        await service.action(current.root, body(source, null, 'cancel', 'cancel-startup'));
        assert.equal((await cancelling).state, 'cancelled');
        assert.equal(service.sessions.size, 0);
        const crashSession = await service.action(current.root, body(source, null, 'open', 'crash-open'));
        assert.equal(crashSession.state, 'available', crashSession.reason);
        const watchdog = service.sessions.get(crashSession.sessionId).connection.child;
        await pause(700);
        const ownedPids = descendants(watchdog.pid);
        assert.ok(ownedPids.length > 1, 'A real Lean worker must be present for crash cleanup.');
        process.kill(watchdog.pid, 'SIGKILL');
        for (let attempt = 0; attempt < 30 && ownedPids.some(alive); attempt++) await pause(100);
        assert.equal(ownedPids.some(alive), false, `Watchdog crash left owned processes: ${ownedPids.filter(alive)}`);
        await service.close(); service = new LeanLanguageService();
        assert.deepEqual(await fileSnapshot(current.root), before, 'Language actions must not write project sources, build artifacts or review metadata.');

        // A project's elaboration code also inherits the native read-only boundary.
        await fs.appendFile(path.join(current.root, source.filePath), '\n#eval IO.FS.writeFile "../language-forbidden.txt" "must not write"\n');
        const hostileSource = await service.source(current.root, 'fixture', source.filePath);
        const guarded = await service.action(current.root, body(hostileSource, null, 'open', 'readonly-open'));
        assert.equal(guarded.state, 'available', guarded.reason);
        assert.ok(guarded.diagnostics.some(item => /denied|not permitted|permission/i.test(item.message)), JSON.stringify(guarded.diagnostics));
        assert.equal(await fs.access(path.join(current.root, 'language-forbidden.txt')).then(() => true, () => false), false);
        await service.action(current.root, body(hostileSource, guarded, 'close', 'readonly-close'));
        await fs.writeFile(path.join(current.root, source.filePath), current.content);

        const old = await fixture(path.join(temporary, 'old-toolchain'), '4.29.1');
        if (await fs.access(path.join(toolchainRoot('4.29.1'), 'bin/lean')).then(() => true, () => false)) {
            const oldSource = await service.source(old.root, 'fixture', 'lean/LanguageFixture.lean');
            const oldOpen = await service.action(old.root, body(oldSource, null, 'open', 'old-open'));
            assert.equal(oldOpen.state, 'available', oldOpen.reason);
            const oldGoals = await service.action(old.root, body(oldSource, oldOpen, 'goals', 'old-goals', tacticPosition(oldSource.content)));
            assert.ok(oldGoals.goals.some(item => /hp : p/.test(item) && /⊢ p/.test(item)));
            await service.closeProject(await fs.realpath(old.root));
            assert.equal(service.sessions.size, 0);
        }
        await fs.writeFile(path.join(old.root, 'lean/lean-toolchain'), 'leanprover/lean4:v4.99.99\n');
        const absentSource = await service.source(old.root, 'fixture', 'lean/LanguageFixture.lean');
        const absent = await service.action(old.root, body(absentSource, null, 'open', 'absent-toolchain'));
        assert.equal(absent.state, 'unavailable');
        assert.match(absent.reason, /not installed locally/);
    } finally {
        await server?.close(); await service?.close();
        await fs.rm(temporary, { recursive: true, force: true });
    }
}
