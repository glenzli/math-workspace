import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function testFormulaRuntime() {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'math-formula-runtime-')));
    let server;
    try {
        const runtimeBundle = path.join(temporary, 'runtime.cjs');
        await build({ entryPoints: [path.join(repo, 'src/reader/formula-runtime.ts')], outfile: runtimeBundle, bundle: true,
            platform: 'node', format: 'cjs', logLevel: 'silent', tsconfig: path.join(repo, 'tsconfig.cli.json') });
        const runtime = require(runtimeBundle), staticRoot = path.join(temporary, 'reader');
        const directory = path.join(staticRoot, 'mathjax'); await fs.mkdir(directory, { recursive: true });
        const moduleFile = path.join(directory, runtime.FORMULA_RUNTIME_FILE);
        const original = Buffer.from('export const version="4.1.3";\n');
        await fs.writeFile(moduleFile, original); await fs.writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><html><head></head><body>Fixture</body></html>');
        await runtime.finalizeFormulaRuntime(staticRoot, path.join(repo, 'node_modules'), path.join(repo, 'media/licenses/mathjax-tex-font-OFL.txt'));
        const manifest = JSON.parse(await fs.readFile(path.join(directory, 'runtime.json'), 'utf8'));
        assert.equal(manifest.version, '4.1.3'); assert.deepEqual(Object.keys(manifest.files), ['mathjax-tex-svg.mjs']);
        assert.deepEqual(Object.keys(manifest.licenses).sort(), ['LICENSE-mathjax', 'LICENSE-tex-font', 'LICENSE-tex-font-OFL']);
        for (const [name, item] of Object.entries({ ...manifest.files, ...manifest.licenses })) {
            const bytes = await fs.readFile(path.join(directory, name)); assert.equal(bytes.length, item.bytes); assert.equal(hash(bytes), item.sha256);
        }
        assert.equal((await runtime.readFormulaRuntime(staticRoot, runtime.FORMULA_RUNTIME_FILE)).bytes.toString(), original.toString());
        for (const file of ['', '../package.json', '/etc/hosts', 'mathjax-tex-svg.mjs.map', 'runtime.json', 'LICENSE-mathjax', 'mathjax-tex-svg.mjs\0']) {
            await assert.rejects(runtime.readFormulaRuntime(staticRoot, file), error => error.status === 400);
        }
        await fs.writeFile(moduleFile, 'changed'); await assert.rejects(runtime.readFormulaRuntime(staticRoot, runtime.FORMULA_RUNTIME_FILE), error => error.status === 503);
        await fs.writeFile(moduleFile, original); await fs.truncate(moduleFile, 5 * 1024 * 1024);
        await assert.rejects(runtime.readFormulaRuntime(staticRoot, runtime.FORMULA_RUNTIME_FILE), error => error.status === 503);
        await fs.rm(moduleFile); await fs.symlink('/etc/hosts', moduleFile);
        await assert.rejects(runtime.readFormulaRuntime(staticRoot, runtime.FORMULA_RUNTIME_FILE), error => error.status === 503);
        await fs.rm(moduleFile); await fs.writeFile(moduleFile, original);

        const roots = [path.join(temporary, 'a'), path.join(temporary, 'b')];
        for (const project of roots) { await fs.mkdir(path.join(project, '.math-workspace'), { recursive: true });
            await fs.writeFile(path.join(project, '.math-workspace/config.json'), '{}'); await fs.writeFile(path.join(project, 'chapter.md'), '# Chapter\n\nOriginal source.\n'); }
        const serverBundle = path.join(temporary, 'server.cjs');
        await build({ entryPoints: [path.join(repo, 'src/reader/server.ts')], outfile: serverBundle, bundle: true,
            platform: 'node', format: 'cjs', logLevel: 'silent', tsconfig: path.join(repo, 'tsconfig.cli.json') });
        server = await require(serverBundle).startReaderServer({ rootPath: roots[0], port: 0, staticRoot,
            recentProjectsPath: path.join(temporary, 'recent.json'), locationRegistryPath: path.join(temporary, 'locations.json'), chooseProjectDirectory: async () => roots[1] });
        const state = await (await fetch(server.url + '/api/state')).json();
        const headers = { 'x-math-workspace-token': state.requestToken, 'x-math-workspace-project': state.projectId };
        const route = '/api/formula-runtime?file=mathjax-tex-svg.mjs';
        assert.equal((await fetch(server.url + route)).status, 403);
        assert.equal((await fetch(server.url + route, { headers: { ...headers, 'x-math-workspace-project': 'wrong' } })).status, 409);
        assert.equal((await fetch(server.url + route, { headers: { ...headers, origin: 'https://outside.invalid' } })).status, 403);
        assert.equal((await fetch(server.url + route, { headers, method: 'POST' })).status, 405);
        assert.equal((await fetch(server.url + '/api/formula-runtime?file=../package.json', { headers })).status, 400);
        const response = await fetch(server.url + route, { headers });
        assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(original));
        for (const suffix of ['/mathjax/mathjax-tex-svg.mjs', '/mathjax/runtime.json', '/MathJax/mathjax-tex-svg.mjs', '/m%61thjax/mathjax-tex-svg.mjs', '/mathjax%2fmathjax-tex-svg.mjs']) {
            assert.equal((await fetch(server.url + suffix)).status, 404);
        }
        const originalRead = fs.readFile; let observed, release, delayed = true;
        const seen = new Promise(resolve => { observed = resolve; }), barrier = new Promise(resolve => { release = resolve; });
        fs.readFile = async (name, ...args) => { const bytes = await originalRead(name, ...args);
            if (delayed && String(name) === moduleFile) { delayed = false; observed(); await barrier; } return bytes; };
        const pending = fetch(server.url + route, { headers });
        try { await seen; await fetch(server.url + '/api/projects/pick', { method: 'POST' }); }
        finally { release(); fs.readFile = originalRead; }
        assert.equal((await pending).status, 409);
        assert.equal(await fs.readFile(path.join(roots[0], 'chapter.md'), 'utf8'), '# Chapter\n\nOriginal source.\n');
        console.log('Formula runtime: pinned notices, bounded hash identity, path/token/project/origin guards and stale reads passed.');
    } finally { if (server) await server.close(); await fs.rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testFormulaRuntime();
