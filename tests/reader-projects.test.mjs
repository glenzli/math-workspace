import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { readerToolbarHarness } from './reader-toolbar-menu.test.mjs';
import { readerUiLabels } from './reader-ui-harness.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const drain = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

export async function testReaderProjects() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-recent-projects-'));
    let server;
    try {
        const bundle = path.join(temporary, 'bundle');
        await build({ entryPoints: [path.join(root, 'src/reader/projects.ts'), path.join(root, 'src/reader/server.ts')], outdir: bundle,
            outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', tsconfig: path.join(root, 'tsconfig.cli.json') });
        const { ReaderProjectRegistry } = require(path.join(bundle, 'projects.cjs'));
        const { startReaderServer } = require(path.join(bundle, 'server.cjs'));
        const projects = ['temporary', 'retained', 'newer'].map(name => path.join(temporary, name));
        for (const project of projects) {
            await fs.mkdir(path.join(project, '.math-workspace'), { recursive: true });
            await fs.writeFile(path.join(project, '.math-workspace/config.json'), '{}\n');
            await fs.writeFile(path.join(project, '01-page.md'), '# Manuscript\n\nKeep this source.\n');
        }
        const stateFilePath = path.join(temporary, 'recent.json');
        const registry = new ReaderProjectRegistry({ stateFilePath });
        await registry.remember(projects[0]); await registry.remember(projects[1]);
        await registry.forget(projects[0]);
        assert.deepEqual((await new ReaderProjectRegistry({ stateFilePath }).list()).map(project => project.rootName), ['retained'], 'Removal survives a new registry instance.');
        assert.equal(await fs.readFile(path.join(projects[0], '01-page.md'), 'utf8'), '# Manuscript\n\nKeep this source.\n');
        await registry.remember(projects[0]);
        const another = new ReaderProjectRegistry({ stateFilePath });
        await Promise.all([registry.forget(projects[0]), another.remember(projects[2])]);
        assert.deepEqual((await registry.list()).map(project => project.rootName), ['newer', 'retained'], 'Another view opening a project is retained during removal.');
        await registry.remember(projects[0]);

        const staticRoot = path.join(temporary, 'static'); await fs.mkdir(staticRoot); await fs.writeFile(path.join(staticRoot, 'index.html'), '<title>Reader fixture</title>');
        server = await startReaderServer({ staticRoot, port: 0, recentProjectsPath: stateFilePath, locationRegistryPath: path.join(temporary, 'instances.json') });
        const state = await (await fetch(server.url + '/api/state')).json();
        const selected = state.recentProjects.find(project => project.rootName === 'temporary');
        assert.match(selected.id, /^[a-f0-9]{64}$/); assert.equal('rootPath' in selected, false);
        const headers = { 'content-type': 'application/json', 'x-math-workspace-token': state.requestToken };
        const remove = (id, extra = {}) => fetch(server.url + '/api/projects/recent/remove', { method: 'POST', headers, body: JSON.stringify({ id }), ...extra });
        const beforeRejected = await fs.readFile(stateFilePath, 'utf8');
        assert.equal((await remove(selected.id, { headers: { 'content-type': 'application/json' } })).status, 403);
        assert.equal((await remove(selected.id, { headers: { ...headers, origin: 'https://outside.invalid' } })).status, 403);
        assert.equal((await remove(selected.id, { headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status, 403);
        assert.equal((await fetch(server.url + '/api/projects/recent/remove', { headers })).status, 405);
        assert.equal((await remove('not-an-id')).status, 400);
        assert.equal((await remove('0'.repeat(64))).status, 404);
        assert.equal(await fs.readFile(stateFilePath, 'utf8'), beforeRejected, 'Rejected requests never mutate history.');
        await registry.remember(projects[1]);
        const removed = await remove(selected.id); assert.equal(removed.status, 200);
        const remaining = (await removed.json()).recentProjects;
        assert.deepEqual(remaining.map(project => project.rootName), ['retained', 'newer'], 'The same ID is removed even after the old row index points to another project.');
        assert.equal((await remove(selected.id)).status, 404, 'A stale second click cannot remove a different entry.');
        await registry.remember(projects[0]);
        const reopen = await fetch(server.url + '/api/projects/recent', { method: 'POST', headers, body: JSON.stringify({ id: selected.id }) });
        assert.equal((await reopen.json()).rootName, 'temporary', 'An explicitly reopened project returns to history with the same stable ID.');
        assert.equal((await remove(selected.id)).status, 200);
        assert.equal((await (await fetch(server.url + '/api/state')).json()).rootName, 'temporary', 'History removal does not close the active project.');
        await registry.forget(projects[1]); await registry.forget(projects[2]);
        assert.deepEqual(await new ReaderProjectRegistry({ stateFilePath }).list(), []);
        for (const project of projects) assert.equal(await fs.readFile(path.join(project, '01-page.md'), 'utf8'), '# Manuscript\n\nKeep this source.\n');
        assert.ok(!(await fs.readdir(temporary)).some(name => name.endsWith('.tmp')), 'Atomic history updates leave no temporary records behind.');
        await launcherUiContracts();
        console.log('Reader recent projects: persistent removal, stable IDs, shared-view updates, protected API, retained files, separate X actions, failures and empty state passed.');
    } finally { await server?.close(); await fs.rm(temporary, { recursive: true, force: true }); }
}

async function launcherUiContracts() {
    const h = await readerToolbarHarness(), { app, find, click, document } = h;
    try {
        const first = { id: 'a'.repeat(64), index: 0, rootName: 'Temporary project', openedAt: '2026-10-23T01:00:00Z' };
        const second = { id: 'b'.repeat(64), index: 1, rootName: 'Retained project', openedAt: '2026-10-22T01:00:00Z' };
        const state = { ...app.state, available: false, requestToken: 'launcher-token', recentProjects: [first, second] };
        app.applyState(state); app.renderProjectLauncher();
        let finish;
        const pending = new Promise(resolve => { finish = resolve; });
        h.setRequestHandler(() => pending);
        click(find(`[data-remove-recent-project="${first.id}"]`).querySelector('svg')); await drain();
        assert.equal(h.createRequests.length, 1); assert.equal(h.createRequests[0].route, '/api/projects/recent/remove');
        assert.equal(JSON.parse(h.createRequests[0].options.body).id, first.id);
        assert.equal(h.createRequests[0].options.headers['x-math-workspace-token'], 'launcher-token');
        assert.equal(find(`[data-remove-recent-project="${second.id}"]`).disabled, true, 'History actions wait for the pending removal.');
        finish({ ok: true, json: async () => ({ recentProjects: [{ ...second, index: 0 }] }) }); await drain();
        assert.equal(find(`[data-remove-recent-project="${first.id}"]`), null);
        assert.equal(document.activeElement, find(`[data-remove-recent-project="${second.id}"]`));
        assert.equal(find('.reader-shell').classList.contains('is-project-launcher'), true, 'The X button does not open a project.');
        h.preferences.setLanguage('en'); readerUiLabels.refreshReaderLabels(document.body);
        assert.equal(find(`[data-remove-recent-project="${second.id}"]`).getAttribute('aria-label'), 'Remove Retained project from recent projects');
        h.setRequestHandler(async () => ({ ok: false, text: async () => 'Storage unavailable' }));
        click(find(`[data-remove-recent-project="${second.id}"]`)); await drain();
        assert.ok(find(`[data-remove-recent-project="${second.id}"]`)); assert.match(find('.reader-project-launcher').textContent, /Could not remove/);
        h.setRequestHandler(async () => ({ ok: true, json: async () => ({ recentProjects: [] }) }));
        click(find(`[data-remove-recent-project="${second.id}"]`)); await drain();
        assert.equal(find('.reader-project-empty').textContent, 'No recent projects yet.');
        assert.equal(document.activeElement, find('[data-project-picker]'));

        app.state.recentProjects = [first]; app.renderProjectLauncher();
        const late = new Promise(resolve => { finish = resolve; }); h.setRequestHandler(() => late);
        click(find(`[data-remove-recent-project="${first.id}"]`)); await drain();
        app.state = { ...app.state, available: true }; app.article.textContent = 'Already opened manuscript';
        finish({ ok: true, json: async () => ({ recentProjects: [] }) }); await drain();
        assert.equal(app.article.textContent, 'Already opened manuscript', 'A late removal cannot replace an opened manuscript with the launcher.');
    } finally { app.uncommitted.dispose(); app.changeNavigation.dispose(); app.fullSearch.dispose(); h.restore(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await testReaderProjects();
