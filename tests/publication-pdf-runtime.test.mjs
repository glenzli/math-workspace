import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';

const require = createRequire(import.meta.url), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const optional = file => fs.readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });

export async function testPublicationPdfRuntime() {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'math-publication-pdf-runtime-')));
    let server;
    try {
        const runtimeBundle = path.join(temporary, 'runtime.cjs');
        await bundle({ entryPoints: [path.join(repo, 'src/publication/pdf-runtime.ts')], outfile: runtimeBundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', tsconfig: path.join(repo, 'tsconfig.cli.json') });
        const runtime = require(runtimeBundle), packageRoot = path.join(repo, 'node_modules/pdfjs-dist');
        assert.equal(runtime.PUBLICATION_PDF_RUNTIME_VERSION, '6.4.299');

        // Exercise the real Vite plugin with an output override; no shared build is touched.
        const sharedManifest = path.join(repo, 'out/reader/pdfjs/runtime.json'), sharedBefore = await optional(sharedManifest);
        const web = path.join(temporary, 'web'), staticRoot = path.join(temporary, 'reader'); await fs.mkdir(web);
        await fs.writeFile(path.join(web, 'index.html'), '<!doctype html><html><head><title>PDF runtime fixture</title></head><body>Local preview</body></html>');
        await viteBuild({ configFile: path.join(repo, 'vite.reader.config.ts'), root: web, logLevel: 'silent', build: { outDir: staticRoot, emptyOutDir: true } });
        assert.deepEqual(await optional(sharedManifest), sharedBefore, 'A private output override cannot copy PDF assets into shared out/reader.');
        const manifest = JSON.parse(await fs.readFile(path.join(staticRoot, 'pdfjs/runtime.json'), 'utf8'));
        assert.equal(manifest.version, '6.4.299'); assert.equal(Object.keys(manifest.files).length, 184);
        assert.deepEqual(Object.keys(manifest.licenses).sort(), ['LICENSE', 'cmaps/LICENSE', 'standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION'].sort());
        for (const [name, item] of Object.entries({ ...manifest.files, ...manifest.licenses })) {
            const source = path.join(packageRoot, ['pdf.mjs', 'pdf.worker.mjs'].includes(name) ? `build/${name}` : name);
            const expected = await fs.readFile(source), actual = await fs.readFile(path.join(staticRoot, 'pdfjs', name));
            assert.equal(digest(actual), digest(expected), `${name} is copied without rewriting.`); assert.equal(item.sha256, digest(actual)); assert.equal(item.bytes, actual.length);
        }
        assert.equal((await fs.readdir(path.join(staticRoot, 'pdfjs'))).some(name => name.endsWith('.map') || name === 'wasm'), false);

        const mismatch = path.join(temporary, 'different-package'); await fs.mkdir(mismatch);
        await fs.writeFile(path.join(mismatch, 'package.json'), JSON.stringify({ name: 'pdfjs-dist', version: '6.4.298' }));
        await assert.rejects(runtime.copyPublicationPdfRuntime(mismatch, path.join(temporary, 'bad-output')), /pinned pdfjs-dist 6\.4\.299/);
        for (const file of ['../package.json', '/etc/hosts', 'pdf.mjs.map', 'LICENSE', 'cmaps/../../pdf.mjs', 'standard_fonts/font.woff2', 'pdf.mjs\0']) await assert.rejects(runtime.readPublicationPdfRuntime(staticRoot, file), error => error.status === 400);
        await assert.rejects(runtime.readPublicationPdfRuntime(staticRoot, 'cmaps/unknown.bcmap'), error => error.status === 404);
        const fontName = 'standard_fonts/FoxitFixed.pfb', moduleFile = path.join(staticRoot, 'pdfjs/pdf.mjs'), originalModule = await fs.readFile(moduleFile);
        assert.equal((await runtime.readPublicationPdfRuntime(staticRoot, fontName)).contentType, 'application/octet-stream');
        await fs.writeFile(moduleFile, 'changed'); await assert.rejects(runtime.readPublicationPdfRuntime(staticRoot, 'pdf.mjs'), error => error.status === 503);
        await fs.writeFile(moduleFile, originalModule); await fs.truncate(moduleFile, 9 * 1024 * 1024); await assert.rejects(runtime.readPublicationPdfRuntime(staticRoot, 'pdf.mjs'), error => error.status === 503); await fs.writeFile(moduleFile, originalModule);
        const fontPath = path.join(staticRoot, 'pdfjs', fontName), originalFont = await fs.readFile(fontPath);
        await fs.rm(fontPath); await fs.symlink('/etc/hosts', fontPath); await assert.rejects(runtime.readPublicationPdfRuntime(staticRoot, fontName), error => error.status === 503); await fs.rm(fontPath); await fs.writeFile(fontPath, originalFont);

        const roots = [path.join(temporary, 'a'), path.join(temporary, 'b')];
        for (const project of roots) { await fs.mkdir(path.join(project, '.math-workspace'), { recursive: true }); await fs.writeFile(path.join(project, '.math-workspace/config.json'), '{}'); await fs.writeFile(path.join(project, 'chapter.md'), '# Chapter\n\nOriginal source.\n'); }
        const serverBundle = path.join(temporary, 'server.cjs');
        await bundle({ entryPoints: [path.join(repo, 'src/reader/server.ts')], outfile: serverBundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', tsconfig: path.join(repo, 'tsconfig.cli.json') });
        server = await require(serverBundle).startReaderServer({ rootPath: roots[0], port: 0, staticRoot, recentProjectsPath: path.join(temporary, 'recent.json'), locationRegistryPath: path.join(temporary, 'locations.json'), chooseProjectDirectory: async () => roots[1] });
        const state = await (await fetch(server.url + '/api/state')).json(), headers = { 'x-math-workspace-token': state.requestToken, 'x-math-workspace-project': state.projectId };
        const route = file => '/api/publication/pdf-runtime?file=' + encodeURIComponent(file);
        assert.equal((await fetch(server.url + route('pdf.mjs'))).status, 403);
        assert.equal((await fetch(server.url + route('pdf.mjs'), { headers: { ...headers, 'x-math-workspace-project': 'wrong' } })).status, 409);
        assert.equal((await fetch(server.url + route('pdf.mjs'), { headers: { ...headers, origin: 'https://outside.invalid' } })).status, 403);
        assert.equal((await fetch(server.url + route('pdf.mjs'), { method: 'POST', headers })).status, 405);
        assert.equal((await fetch(server.url + route('../package.json'), { headers })).status, 400);
        assert.equal((await fetch(server.url + route('cmaps/unknown.bcmap'), { headers })).status, 404);
        for (const file of ['pdf.mjs', 'pdf.worker.mjs', 'cmaps/78-EUC-H.bcmap', fontName]) {
            const response = await fetch(server.url + route(file), { headers }), bytes = Buffer.from(await response.arrayBuffer());
            assert.equal(response.status, 200); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.equal(digest(bytes), manifest.files[file].sha256); assert.equal(response.headers.get('content-type'), file.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'application/octet-stream');
        }
        for (const file of ['/pdfjs/pdf.mjs', '/pdfjs/pdf.worker.mjs', '/pdfjs/runtime.json', '/pdfjs/LICENSE', '/PDFJS/pdf.mjs', '/PdfJs/runtime.json', '/p%64fjs/pdf.mjs', '/pdfjs%2fpdf.mjs']) {
            assert.equal((await fetch(server.url + file)).status, 404, 'Unauthenticated static paths cannot bypass runtime authentication.');
            assert.equal((await fetch(server.url + file, { headers })).status, 404);
        }
        const index = await fetch(server.url), csp = index.headers.get('content-security-policy');
        assert.match(csp, /script-src 'self' blob:/); assert.match(csp, /connect-src 'self'(?:;|$)/); assert.doesNotMatch(csp, /unsafe-eval|worker-src|font-src/);

        // A project switch while the asset read yields cannot complete under the old project identity.
        const originalRead = fs.readFile; let observed, release, delayed = true;
        const seen = new Promise(resolve => { observed = resolve; }), barrier = new Promise(resolve => { release = resolve; });
        fs.readFile = async (name, ...args) => { const value = await originalRead(name, ...args); if (delayed && String(name) === moduleFile) { delayed = false; observed(); await barrier; } return value; };
        const pending = fetch(server.url + route('pdf.mjs'), { headers });
        try { await seen; await fetch(server.url + '/api/projects/pick', { method: 'POST' }); }
        finally { release(); fs.readFile = originalRead; }
        assert.equal((await pending).status, 409);
        assert.equal(await fs.readFile(path.join(roots[0], 'chapter.md'), 'utf8'), '# Chapter\n\nOriginal source.\n');
        assert.equal(await optional(path.join(roots[0], '.math-workspace/publications/remote/book.json')), null);
        console.log('Publication PDF runtime: exact pinned copies/licenses, private build output, bounded allowlist, token/project/origin guards, CSP and stale project reads passed.');
    } finally { if (server) await server.close(); await fs.rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testPublicationPdfRuntime();
