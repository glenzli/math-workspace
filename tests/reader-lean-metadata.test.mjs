import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const id = 'h-1111111111111111';

export async function testReaderLeanMetadata() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-review-metadata-'));
    let first, second, server;
    try {
        await build({ entryPoints: [path.join(repoRoot, 'src/reader/workspace.ts'), path.join(repoRoot, 'src/reader/server.ts')],
            bundle: true, platform: 'node', format: 'cjs', outdir: path.join(temporary, 'bundle'), outExtension: { '.js': '.cjs' },
            tsconfig: path.join(repoRoot, 'tsconfig.cli.json'), logLevel: 'silent' });
        const { ReaderWorkspace } = require(path.join(temporary, 'bundle/workspace.cjs'));
        const { startReaderServer } = require(path.join(temporary, 'bundle/server.cjs'));
        const root = path.join(temporary, 'project');
        await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
        await fs.mkdir(path.join(root, 'book'));
        await fs.writeFile(path.join(root, '.math-workspace/config.json'), '{}');
        await fs.writeFile(path.join(root, 'book/chapter.md'), `# Chapter\n\nTheorem #${id}: True.\n`);
        first = new ReaderWorkspace(root); second = new ReaderWorkspace(root);
        await first.start(); await second.start();
        const original = first.current(), peerOriginal = second.current();
        let sourceRefreshes = 0;
        const originalRefresh = second.refresh.bind(second);
        second.refresh = async () => { sourceRefreshes++; return originalRefresh(); };
        const paths = [];
        second.onChange(change => paths.push(...change.changedPaths));
        const auditPath = `.math-workspace/lean-audits/${id}.json`;
        const bumped = first.notifyMetadataChange([auditPath]);
        assert.equal(bumped.revision, original.revision + 1);
        assert.equal(bumped.documents, original.documents, 'Metadata invalidation must retain the source map.');
        assert.equal(bumped.state, original.state, 'Metadata invalidation must not rescan source or rebuild Lean indexes.');
        // Reproduce the exact delayed initial native event batch without relying on FSEvents
        // scheduling. These inputs already belong to the scanned snapshot.
        for (const file of [path.basename(root), '.math-workspace', 'book', '.math-workspace/config.json', 'book/chapter.md']) {
            second.watcher.emit('change', 'rename', file);
        }
        for (const category of ['lean-audits', 'lean-reviews', 'lean-review-evidence']) {
            const relative = `.math-workspace/${category}/${id}.json`;
            await fs.mkdir(path.join(root, '.math-workspace', category), { recursive: true });
            const previous = second.current().revision;
            await fs.writeFile(path.join(root, relative), JSON.stringify({ revision: category }));
            for (let attempt = 0; attempt < 40 && !paths.includes(relative); attempt++) await pause(50);
            assert.ok(paths.includes(relative), `Another Reader must observe ${relative}.`);
            assert.ok(second.current().revision > previous);
            assert.equal(second.current().documents, peerOriginal.documents);
            assert.equal(second.current().state, peerOriginal.state);
            assert.equal(sourceRefreshes, 0, 'Metadata and unchanged delayed source events must never parse source again.');
        }
        const beforeTemporary = second.current().revision;
        await fs.writeFile(path.join(root, `.math-workspace/lean-audits/${id}.json.tmp`), 'temporary');
        await fs.writeFile(path.join(root, `.math-workspace/lean-audits/${id}.json.lock`), 'lock');
        await pause(250);
        assert.equal(second.current().revision, beforeTemporary, 'Lock and temporary files must not invalidate review controllers.');
        assert.equal(sourceRefreshes, 0);

        // Stop only the native event source; manually delivered coalesced events still run
        // the production callback. Individual file events cannot accidentally satisfy this.
        second.watcher.close();
        await fs.mkdir(path.join(root, path.basename(root)));
        await fs.writeFile(path.join(root, path.basename(root), 'existing.md'), '# Existing child directory\n');
        second.watcher.emit('change', 'rename', path.basename(root));
        for (let attempt = 0; attempt < 40 && !second.current().documents.has(path.basename(root) + '/existing.md'); attempt++) await pause(50);
        assert.ok(second.current().documents.has(path.basename(root) + '/existing.md'));
        await fs.writeFile(path.join(root, 'top-level.md'), '# Top-level source\n');
        second.watcher.emit('change', 'rename', path.basename(root));
        for (let attempt = 0; attempt < 40 && !second.current().documents.has('top-level.md'); attempt++) await pause(50);
        assert.ok(second.current().documents.has('top-level.md'), 'A coalesced root event must discover top-level source.');
        await fs.rm(path.join(root, 'top-level.md'));
        second.watcher.emit('change', 'rename', path.basename(root));
        for (let attempt = 0; attempt < 40 && second.current().documents.has('top-level.md'); attempt++) await pause(50);
        assert.equal(second.current().documents.has('top-level.md'), false, 'A coalesced root event must discover top-level deletion.');
        const chapter = path.join(root, 'book/chapter.md');
        await fs.appendFile(chapter, '\nA real source edit.\n');
        second.watcher.emit('change', 'change', 'book/chapter.md');
        for (let attempt = 0; attempt < 40 && !second.current().documents.get('book/chapter.md').includes('real source edit'); attempt++) await pause(50);
        assert.match(second.current().documents.get('book/chapter.md'), /real source edit/);
        assert.ok(sourceRefreshes > 0, 'A genuine Markdown edit must still refresh source.');
        await fs.writeFile(path.join(root, 'book/new.md'), '# New source\n');
        second.watcher.emit('change', 'rename', 'book');
        for (let attempt = 0; attempt < 40 && !second.current().documents.has('book/new.md'); attempt++) await pause(50);
        assert.ok(second.current().documents.has('book/new.md'), 'Coalesced directory events must discover new source.');
        await fs.rename(path.join(root, 'book/new.md'), path.join(root, 'book/renamed.md'));
        second.watcher.emit('change', 'rename', 'book');
        for (let attempt = 0; attempt < 40 && !second.current().documents.has('book/renamed.md'); attempt++) await pause(50);
        assert.ok(second.current().documents.has('book/renamed.md')); assert.equal(second.current().documents.has('book/new.md'), false);
        await fs.rm(path.join(root, 'book/renamed.md'));
        second.watcher.emit('change', 'rename', 'book');
        for (let attempt = 0; attempt < 40 && second.current().documents.has('book/renamed.md'); attempt++) await pause(50);
        assert.equal(second.current().documents.has('book/renamed.md'), false, 'Source deletion must still refresh.');
        const beforeUnknown = sourceRefreshes;
        second.watcher.emit('change', 'change', undefined);
        for (let attempt = 0; attempt < 40 && sourceRefreshes === beforeUnknown; attempt++) await pause(50);
        assert.ok(sourceRefreshes > beforeUnknown, 'An uncertain filename must conservatively refresh source.');
        await fs.writeFile(path.join(root, '.math-workspace/config.json'), '{"language":"en"}');
        second.watcher.emit('change', 'change', path.basename(root));
        for (let attempt = 0; attempt < 40 && second.current().state.config.language !== 'en'; attempt++) await pause(50);
        assert.equal(second.current().state.config.language, 'en', 'A genuine configuration change must still refresh.');

        const staticRoot = path.join(temporary, 'static');
        await fs.mkdir(staticRoot);
        await fs.writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body>Reader</body></html>');
        await fs.writeFile(path.join(staticRoot, 'styles.css'), '.reader { color: red; }');
        server = await startReaderServer({ rootPath: root, staticRoot, recentProjectsPath: path.join(temporary, 'recent.json'), locationRegistryPath: path.join(temporary, 'locations.json') });
        const response = await fetch(server.url + '/');
        const html = await response.text(), policy = response.headers.get('content-security-policy');
        const nonce = html.match(/<meta name="math-workspace-style-nonce" content="([A-Za-z0-9_-]+)">/)?.[1];
        assert.ok(nonce?.length >= 32);
        assert.ok(policy.includes(`style-src 'self' 'nonce-${nonce}'`));
        assert.equal(policy.split(';').find(part => part.trim().startsWith('style-src ')).includes('unsafe-inline'), false);
        assert.match(policy, /script-src 'self'/);
        const state = await (await fetch(server.url + '/api/state')).json();
        assert.notEqual(nonce, state.requestToken);
        const nextHtml = await (await fetch(server.url + '/index.html')).text();
        assert.equal(nextHtml.includes(`content="${nonce}"`), false, 'Each Reader document response needs a fresh nonce.');
        const css = await fetch(server.url + '/styles.css');
        assert.equal(await css.text(), '.reader { color: red; }');
        assert.equal(css.headers.get('content-security-policy').includes('nonce-'), false, 'Plain assets retain the existing static policy.');
    } finally {
        await server?.close(); await first?.close(); await second?.close();
        await fs.rm(temporary, { recursive: true, force: true });
    }
}
