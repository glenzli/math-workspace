import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import ts from 'typescript';
import { readerToolbarHarness } from './reader-toolbar-menu.test.mjs';

const require = createRequire(import.meta.url);
const repo = path.resolve(new URL('..', import.meta.url).pathname);
const id = 'h-1111111111111111';
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const drain = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

export async function testReaderStartup() {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reader-startup-contracts-')));
    const nodeFs = require('node:fs/promises'), originalRead = nodeFs.readFile, originalReaddir = nodeFs.readdir;
    let workspace, server, gate;
    let reads = 0, blocked = false;
    const visited = [];
    try {
        await build({ entryPoints: [path.join(repo, 'src/reader/workspace.ts'), path.join(repo, 'src/reader/server.ts'),
            path.join(repo, 'src/reader/web/formal-renderer.ts')], bundle: true, platform: 'node', format: 'cjs',
            outdir: path.join(directory, 'bundle'), outExtension: { '.js': '.cjs' },
            alias: { '@math-workspace/core': path.join(repo, 'packages/core/src/formal-core.ts') }, logLevel: 'silent' });
        const { ReaderWorkspace, loadWorkspaceSnapshot } = require(path.join(directory, 'bundle/workspace.cjs'));
        const { startReaderServer } = require(path.join(directory, 'bundle/server.cjs'));
        const renderer = require(path.join(directory, 'bundle/web/formal-renderer.cjs'));
        const root = path.join(directory, 'project'), filePath = 'book/01-main.md';
        for (const name of ['.math-workspace', 'book/nested', 'book/.lake/dependencies', 'lean', 'unrelated']) {
            await fs.mkdir(path.join(root, name), { recursive: true });
        }
        await fs.writeFile(path.join(root, '.math-workspace/config.json'), JSON.stringify({
            scan: { exclude: ['.math-workspace/**', 'book/**/_draft*.md', 'lean/**', 'unrelated/**'] },
            documents: { collections: [{ id: 'drafts', mode: 'draft', include: ['book/**/_draft*.md'] }] },
            lean: { projects: [{ key: 'lean', root: 'lean', sourceRoots: ['.'] }] }
        }));
        const source = `# Chapter\n\n**Theorem #${id}: True.**\n\n$$f(x)=x^2+1$$\n`;
        await fs.writeFile(path.join(root, filePath), source);
        await fs.writeFile(path.join(root, 'book/nested/_draft-idea.md'), '# An intended draft\n');
        await fs.writeFile(path.join(root, 'book/.lake/dependencies/_draft-library.md'), '# Not manuscript content\n');
        const leanPath = path.join(root, 'lean/anchors.lean');
        await fs.writeFile(leanPath, `/-- Math Workspace anchor: ${id} -/\ntheorem first : True := trivial\n`);
        nodeFs.readdir = async function (name, ...args) { visited.push(String(name)); return originalReaddir.call(this, name, ...args); };
        nodeFs.readFile = async function (name, ...args) {
            if (String(name) === leanPath) { reads++; if (blocked) await gate.promise; }
            return originalRead.call(this, name, ...args);
        };
        workspace = new ReaderWorkspace(root, { deferLean: true });
        await workspace.start();
        assert.equal(reads, 0, 'Opening the Reader does not read Lean source before prose is available.');
        assert.equal(workspace.current().state.analysisPending, true);
        assert.equal(workspace.current().state.leanIndex, undefined, 'Pending is distinct from a valid empty index.');
        assert.equal(workspace.current().documents.get(filePath), source);
        assert.ok(workspace.current().documents.has('book/nested/_draft-idea.md'));
        assert.equal(visited.some(name => name.includes('/.lake')), false, 'Wildcard draft discovery never enters Lean dependencies.');
        assert.equal(visited.some(name => name.endsWith('/unrelated')), false, 'Draft discovery prunes branches outside every collection.');

        gate = defer(); blocked = true;
        const originalDocuments = workspace.current().documents;
        const analysis = workspace.completeLeanAnalysis(), sameAnalysis = workspace.completeLeanAnalysis();
        await drain(); assert.equal(reads, 1, 'Concurrent page analysis shares the same source scan.');
        await fs.writeFile(path.join(root, filePath), source + '\nA source refresh.\n');
        await workspace.reload();
        assert.notEqual(workspace.current().documents, originalDocuments);
        gate.resolve(); await Promise.all([analysis, sameAnalysis]);
        assert.equal(workspace.current().state.analysisPending, true, 'An older source job cannot fill a newer snapshot.');
        assert.equal(workspace.current().state.leanIndex, undefined);
        blocked = false;
        const complete = await workspace.completeLeanAnalysis();
        assert.equal(complete.state.analysisPending, false);
        assert.equal(complete.state.leanIndex.anchors[id].declarations[0].name, 'first');
        const analyzedReads = reads;
        await workspace.completeLeanAnalysis(); assert.equal(reads, analyzedReads, 'Completed source analysis is reused.');
        await workspace.close(); workspace = undefined;
        assert.ok((await loadWorkspaceSnapshot(root)).state.leanIndex, 'CLI and review callers retain complete snapshot reads by default.');

        reads = 0;
        server = await startReaderServer({ rootPath: root, staticRoot: path.join(repo, 'out/reader'),
            recentProjectsPath: path.join(directory, 'recent.json'), locationRegistryPath: path.join(directory, 'locations.json') });
        assert.equal(reads, 0);
        const state = await (await fetch(server.url + '/api/state')).json();
        const headers = { 'x-math-workspace-token': state.requestToken, 'x-math-workspace-project': state.projectId };
        const url = server.url + '/api/page-analysis?path=' + encodeURIComponent(filePath);
        assert.equal((await fetch(url)).status, 403);
        assert.equal((await fetch(url, { headers: { ...headers, 'x-math-workspace-project': 'different' } })).status, 409);
        gate = defer(); blocked = true;
        const pending = fetch(url, { headers }).then(response => response.json());
        for (let i = 0; i < 100 && !reads; i++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(reads, 1);
        const page = await Promise.race([fetch(server.url + '/api/page?path=' + encodeURIComponent(filePath)).then(response => response.json()),
            new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Prose waited for optional Lean analysis.')), 1500); timer.unref(); })]);
        assert.match(page.content, /f\(x\)=x\^2\+1/); assert.equal(page.analysisPending, true);
        gate.resolve(); blocked = false;
        const result = await pending;
        assert.equal(result.revision, page.revision); assert.equal(result.sourceHash, page.sourceHash);
        assert.equal(result.analysisPending, false); assert.equal(result.dependencyMarkers[id].leanDeclarationCount, 1);
        assert.equal((await (await fetch(server.url + '/api/lean?id=' + id)).json()).declarations[0].name, 'first');
        await uiContracts(renderer);
        console.log('Reader startup: dependency pruning, prose before slow analysis, shared jobs, source guards, after-paint scheduling and in-place Lean controls passed.');
    } finally {
        gate?.resolve(); nodeFs.readFile = originalRead; nodeFs.readdir = originalReaddir;
        await workspace?.close(); await server?.close(); await fs.rm(directory, { recursive: true, force: true });
    }
}

async function uiContracts(renderer) {
    const frames = new Map(), timers = new Map(); let sequence = 0;
    const window = { requestAnimationFrame: run => { frames.set(++sequence, run); return sequence; }, cancelAnimationFrame: id => frames.delete(id) };
    const flush = queue => { const pending = [...queue.values()]; queue.clear(); pending.forEach(run => run()); };
    const exports = {};
    const source = await fs.readFile(path.join(repo, 'src/reader/web/reader-page-analysis.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
        { exports, window, AbortController, setTimeout: run => { timers.set(++sequence, run); return sequence; }, clearTimeout: id => timers.delete(id) });
    const requests = [], applied = [];
    const analysis = new exports.ReaderPageAnalysis((route, options) => { const pending = defer(); requests.push({ route, options, pending }); return pending.promise; });
    const context = { project: 'project-a', token: 'token', filePath: 'book/01.md', sourceHash: 'bytes-a', revision: 1 };
    const result = { ...context, analysisPending: false, dependencyMarkers: {}, leanSummary: {}, issues: [] };
    analysis.bind(context, value => applied.push(value));
    assert.equal(requests.length, 0); flush(frames); assert.equal(requests.length, 0);
    flush(frames); assert.equal(requests.length, 0); flush(timers); assert.equal(requests.length, 1);
    analysis.bind({ ...context, filePath: 'book/02.md' }, value => applied.push(value));
    assert.equal(requests[0].options.signal.aborted, true);
    requests[0].pending.resolve({ ok: true, json: async () => result }); await drain(); assert.equal(applied.length, 0);
    flush(frames); flush(frames); flush(timers);
    requests[1].pending.resolve({ ok: true, json: async () => result }); await drain(); assert.equal(applied.length, 0, 'Mismatched page results are rejected.');
    analysis.bind(context, value => applied.push(value)); flush(frames); flush(frames); flush(timers);
    requests[2].pending.resolve({ ok: true, json: async () => ({ ...result, revision: 2 }) }); await drain(); assert.equal(applied.length, 0);
    analysis.bind(context, value => applied.push(value)); flush(frames); flush(frames); flush(timers);
    requests[3].pending.resolve({ ok: true, json: async () => result }); await drain(); assert.equal(applied.length, 1);
    analysis.bind(context); analysis.cancel(); flush(frames); flush(frames); flush(timers); assert.equal(requests.length, 4);

    const h = await readerToolbarHarness();
    try {
        const block = h.document.createElement('p'); block.id = 'formal-' + id;
        const formula = h.document.createElement('span'); formula.className = 'katex'; formula.textContent = 'f(x)'; block.append(formula);
        h.app.article.append(block); h.app.main.scrollTop = 420;
        const markers = { [id]: { leanDeclarationCount: 1, leanStatus: { contract: 'current' } } };
        renderer.updateFormalLeanMarkers(h.app.article, markers, () => 'zh');
        assert.equal(block.querySelector('.katex'), formula); assert.equal(h.app.main.scrollTop, 420);
        assert.ok(block.querySelector('[data-reader-lean-anchor]'));
        renderer.updateFormalLeanMarkers(h.app.article, markers, () => 'en');
        assert.equal(block.querySelectorAll('[data-reader-lean-anchor]').length, 1);
        assert.match(block.querySelector('[data-reader-lean-anchor]').getAttribute('aria-label'), /Lean anchor/);
    } finally { h.restore(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await testReaderStartup();
