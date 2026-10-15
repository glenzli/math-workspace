import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readerToolbarHarness } from './reader-toolbar-menu.test.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const drain = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };
const response = value => ({ ok: true, status: 200, json: async () => structuredClone(value) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const scopes = [
    { container: '.', kind: 'project', label: 'Workspace (.)', title: 'Workspace' },
    { container: 'book1', kind: 'book', label: 'Book 1 (book1)', title: 'Book 1', bookKey: 'book1' },
    { container: 'book1/vol-1', kind: 'volume', label: 'Volume 1 (book1/vol-1)', title: 'Volume 1', bookKey: 'book1', volumeKey: 'vol-1' }
];
function planned(input, overrides = {}) {
    const plan = { ...input, title: input.title.trim(), filePath: 'book1/vol-1/02-next.md', exists: false,
        stateToken: 'a'.repeat(64), scope: scopes.find(scope => scope.container === input.container), ...overrides };
    return { projectRoot: '/private/tmp/create-reader-fixture', plan,
        assistantCommand: { executable: '/actual/node', cwd: '/private/tmp/create-reader-fixture', args: ['/actual/plugin/out/cli/math-workspace.js',
            'create-page', '--kind', plan.kind, '--container', plan.container, '--title', plan.title, '--expect-state', plan.stateToken, '--json'] } };
}
async function uiFixture() {
    const h = await readerToolbarHarness(); h.app.state.requestToken = 'request-a';
    h.app.currentPath = 'book1/vol-1/back-matter/01-ending.md';
    const model = { override: undefined, planOverrides: {}, opened: [] };
    h.setRequestHandler(async (route, options) => {
        assert.equal(options.headers['x-math-workspace-token'], h.app.state.requestToken);
        assert.equal(options.headers['x-math-workspace-project'], h.app.state.projectId);
        assert.equal(options.method, undefined, 'Creation previews never ask the Reader to mutate source.');
        if (model.override) { const value = model.override(route, options); if (value) return value; }
        if (route.startsWith('/api/create-page/scopes?')) return response({ projectRoot: '/private/tmp/create-reader-fixture', scopes, defaultContainer: 'book1/vol-1' });
        if (route.startsWith('/api/create-page/plan?')) return response(planned(Object.fromEntries(new URLSearchParams(route.split('?')[1])), model.planOverrides));
        throw new Error('Unexpected create-page route ' + route);
    });
    h.app.openPage = async filePath => { model.opened.push(filePath); };
    h.app.fetchJson = async () => h.app.state;
    const title = () => h.find('#reader-create-title');
    const enter = async value => { title().value = value; title().emit('input'); h.flushTimers(); await drain(); };
    const launch = async () => { h.click(h.find('#reader-create-page')); await drain(); };
    const cleanup = () => { h.app.createPage.dispose(); h.app.toolbarPanel.dispose(); h.app.toolbarMenu.dispose(); h.restore(); };
    return { ...h, model, title, enter, launch, cleanup };
}

async function creationDialogContract() {
    const h = await uiFixture();
    try {
        const trigger = h.find('#reader-create-page');
        assert.ok(h.find('#reader-sidebar').contains(trigger)); assert.ok(trigger.querySelector('svg'));
        assert.equal(trigger.textContent, ''); assert.equal(trigger.getAttribute('aria-label'), '新建页面');
        assert.equal(trigger.dataset.readerTooltip, '新建页面');
        await h.launch();
        const dialog = h.find('.reader-create-page'), kind = h.find('#reader-create-kind'), scope = h.find('#reader-create-scope');
        assert.equal(dialog.open, true); assert.equal(h.document.activeElement, h.title());
        assert.equal(scope.value, 'book1/vol-1');
        assert.deepEqual(kind.querySelectorAll('option').map(option => option.textContent), ['正文', '前文', '后文', '未完待续']);
        const inputsBefore = h.createRequests.length;
        for (const value of ['A', 'A b', 'A bilingual title']) { h.title().value = value; h.title().emit('input'); }
        assert.equal(h.createRequests.length, inputsBefore, 'Fast typing does not rescan on every character.');
        assert.equal(h.find('[data-create-submit]').disabled, true); assert.equal(h.app.createPage.payload, undefined);
        assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [225]); h.flushTimers(); await drain();
        assert.equal(h.createRequests.length, inputsBefore + 1, 'One final debounced title creates one plan request.');
        assert.equal(h.handoffs.length, 0, 'Previewing a target never hands off or sends a message.');
        scope.value = '.'; scope.emit('change'); await drain();
        assert.equal(new URLSearchParams(h.createRequests.at(-1).route.split('?')[1]).get('container'), '.', 'A root scope choice stays explicit.');
        scope.value = 'book1/vol-1'; scope.emit('change'); await drain();
        const titleNode = h.title(); h.app.state.language = 'en'; h.app.updateToolbarLabels();
        assert.equal(h.title(), titleNode); assert.equal(titleNode.value, 'A bilingual title');
        assert.equal(dialog.querySelector('h1').textContent, 'New page');
        assert.deepEqual(kind.querySelectorAll('option').map(option => option.textContent), ['Chapter', 'Front matter', 'Back matter', 'To be continued']);
        assert.equal(scope.querySelector('option').textContent, 'Project root'); assert.equal(trigger.getAttribute('aria-label'), 'New page');
        h.key('Enter'); await drain(); assert.equal(h.handoffs.length, 0, 'Enter in a title does not implicitly hand off.');
        const close = h.find('[data-create-close]'); close.focus(); h.key('Tab', { shiftKey: true });
        assert.equal(h.document.activeElement, h.find('[data-create-submit]')); h.key('Tab'); assert.equal(h.document.activeElement, close);
        const specialTitle = '标题 "quotes" $(touch /tmp/no-create) `literal`'; await h.enter(specialTitle);
        h.click(h.find('[data-create-submit]')); await drain();
        assert.equal(h.handoffs.length, 1); const text = h.handoffs[0][0].text;
        const payload = JSON.parse(text.slice(text.lastIndexOf('\n\n{') + 2));
        assert.equal(payload.title, specialTitle); assert.equal(payload.assistantCommand.executable, '/actual/node');
        assert.equal(payload.assistantCommand.cwd, payload.projectRoot);
        assert.equal(payload.assistantCommand.args[0], '/actual/plugin/out/cli/math-workspace.js');
        assert.equal(payload.assistantCommand.args[payload.assistantCommand.args.indexOf('--title') + 1], specialTitle);
        assert.ok(payload.assistantCommand.args.includes('--expect-state')); assert.match(text, /Do not update publication plans/);
        assert.equal(h.find('.reader-create-page'), null); assert.equal(h.document.activeElement, trigger);
        assert.match(h.app.liveStatus.textContent, /has not been sent/);
    } finally { h.cleanup(); }
}

async function lateResponseContract() {
    const h = await uiFixture();
    try {
        const pendingScopes = deferred(); h.model.override = route => route.startsWith('/api/create-page/scopes') ? pendingScopes.promise : undefined;
        h.click(h.find('#reader-create-page')); h.title().value = 'Typed during loading'; h.title().emit('input');
        pendingScopes.resolve(response({ projectRoot: '/private/tmp/create-reader-fixture', scopes, defaultContainer: 'book1/vol-1' })); await drain();
        assert.equal(h.app.createPage.payload.plan.title, 'Typed during loading', 'Early edits survive asynchronous scope discovery.');
        const slow = deferred(); h.model.override = route => route.includes('title=Old') ? slow.promise : undefined;
        await h.enter('Old'); await h.enter('Current');
        slow.resolve(response(planned({ kind: 'chapter', title: 'Old', container: 'book1/vol-1' }, { filePath: 'old.md' }))); await drain();
        assert.equal(h.app.createPage.payload.plan.title, 'Current'); assert.equal(h.find('[data-create-path]').textContent, 'book1/vol-1/02-next.md');
        const handoff = deferred(); h.model.override = route => route.startsWith('/api/create-page/plan') ? handoff.promise : undefined;
        h.click(h.find('[data-create-submit]')); h.key('Escape');
        assert.equal(h.find('.reader-create-page'), null); assert.equal(h.document.activeElement, h.find('#reader-create-page'));
        handoff.resolve(response(planned({ kind: 'chapter', title: 'Current', container: 'book1/vol-1' }))); await drain();
        assert.equal(h.handoffs.length, 0, 'Closing the dialog rejects the pending handoff before ui/message.');
        h.model.override = undefined; await h.launch(); await h.enter('Before edit');
        const editPending = deferred(); h.model.override = route => route.startsWith('/api/create-page/plan') ? editPending.promise : undefined;
        h.click(h.find('[data-create-submit]')); h.title().value = 'Edited'; h.title().emit('input');
        editPending.resolve(response(planned({ kind: 'chapter', title: 'Before edit', container: 'book1/vol-1' }))); await drain();
        assert.equal(h.handoffs.length, 0, 'Editing immediately invalidates an in-flight handoff before the debounce fires.');
        assert.equal(h.find('[data-create-submit]').disabled, true); h.app.createPage.close();
        h.model.override = undefined; await h.launch(); await h.enter('Page change');
        const pagePending = deferred(); h.model.override = route => route.startsWith('/api/create-page/plan') ? pagePending.promise : undefined;
        h.click(h.find('[data-create-submit]')); h.app.currentPath = 'book2/01-other.md'; h.app.createPage.contextChanged();
        pagePending.resolve(response(planned({ kind: 'chapter', title: 'Page change', container: 'book1/vol-1' }))); await drain();
        assert.equal(h.handoffs.length, 0); assert.equal(h.find('.reader-create-page'), null);
        h.model.override = undefined; await h.launch(); await h.enter('Project change');
        const projectPending = deferred(); h.model.override = route => route.startsWith('/api/create-page/plan') ? projectPending.promise : undefined;
        h.click(h.find('[data-create-submit]')); h.app.applyState({ ...h.app.state, projectId: 'project-b' });
        projectPending.resolve(response(planned({ kind: 'chapter', title: 'Project change', container: 'book1/vol-1' }))); await drain();
        assert.equal(h.handoffs.length, 0); assert.equal(h.find('.reader-create-page'), null);
        h.model.override = undefined; await h.launch(); h.title().value = 'Timer'; h.title().emit('input');
        const before = h.createRequests.length; h.app.createPage.navigationStarted(); h.flushTimers(); await drain();
        assert.equal(h.createRequests.length, before, 'Navigation cancels the pending plan timer.');
    } finally { h.cleanup(); }
}

async function staleExistingAndCopyContract() {
    const h = await uiFixture();
    try {
        await h.launch(); await h.enter('Scoped continued');
        h.model.planOverrides = { stateToken: 'b'.repeat(64), filePath: 'book1/vol-1/03-next.md' }; h.click(h.find('[data-create-submit]')); await drain();
        assert.equal(h.handoffs.length, 0); assert.match(h.find('[data-create-status]').textContent, /文件位置已变化/);
        h.app.state.language = 'en'; h.app.createPage.contextChanged(); assert.match(h.find('[data-create-status]').textContent, /file location changed/);
        h.model.planOverrides = { exists: true, existingFile: 'book1/vol-1/to-be-continued.md' };
        h.find('#reader-create-kind').value = 'continued'; h.find('#reader-create-kind').emit('change'); await drain();
        assert.equal(h.find('[data-create-submit]').disabled, true); assert.equal(h.find('[data-create-existing]').hidden, false);
        assert.equal(h.find('[data-create-path]').textContent, 'book1/vol-1/to-be-continued.md');
        const existing = h.model.planOverrides.existingFile; h.app.state.pages = [{ filePath: existing, title: 'Continued', documentMode: 'formal' }];
        const delayedState = deferred(); h.app.fetchJson = () => delayedState.promise;
        h.click(h.find('[data-create-existing]')); h.key('Escape'); delayedState.resolve(h.app.state); await drain();
        assert.deepEqual(h.model.opened, [], 'Closing during the existing-page lookup cannot navigate a later view.');
        h.app.fetchJson = async () => h.app.state; await h.launch(); await h.enter('Scoped continued');
        h.find('#reader-create-kind').value = 'continued'; h.find('#reader-create-kind').emit('change'); await drain();
        h.click(h.find('[data-create-existing]')); await drain(); assert.deepEqual(h.model.opened, [existing]); assert.equal(h.handoffs.length, 0);
        h.app.createPage.close(false); h.setCanAssist(false); h.model.planOverrides = {}; await h.launch(); await h.enter('Copy draft');
        assert.equal(h.find('[data-create-submit]').textContent, 'Copy creation request');
        h.click(h.find('[data-create-submit]')); await drain(); assert.equal(h.copies.length, 1); assert.equal(h.handoffs.length, 0);
        assert.match(h.find('[data-create-status]').textContent, /Creation request copied/);
        h.model.planOverrides.stateToken = 'c'.repeat(64); h.click(h.find('[data-create-submit]')); await drain();
        assert.equal(h.copies.length, 2, 'A fresh state token can proceed when the reviewed target is unchanged.');
        assert.ok(h.copies.at(-1).includes('c'.repeat(64)));
        h.app.state.language = 'zh'; h.app.createPage.contextChanged(); assert.match(h.find('[data-create-status]').textContent, /创建请求已复制/);
        h.setCopyResult(false); h.click(h.find('[data-create-submit]')); await drain();
        assert.equal(h.find('[data-create-request]').hidden, false); assert.match(h.find('[data-create-request]').value, /"args"/);
        const before = h.createRequests.length; h.app.state.revision++; h.app.createPage.contextChanged(); await drain();
        assert.ok(h.createRequests.length > before, 'Workspace revision refreshes scope and preview without reusing old tokens.');
        assert.equal(h.find('[data-create-request]').hidden, true);
    } finally { h.cleanup(); }
}

async function tree(directory) {
    const files = {};
    const visit = async (base = '') => { for (const entry of await fs.readdir(path.join(directory, base), { withFileTypes: true })) {
        const relative = path.join(base, entry.name); if (entry.isDirectory()) await visit(relative); else files[relative] = await fs.readFile(path.join(directory, relative), 'utf8');
    } }; await visit(); return files;
}

async function readOnlyApiContract() {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'math-create-reader-'))); let server;
    try {
        const project = path.join(temporary, 'project');
        for (const [file, text] of Object.entries({ '.math-workspace/config.json': '{}', 'intro.md': '# Introduction\n',
            'book1/vol-1/01-start.md': '# #h-1111111111111111 Start\n', 'book1/vol-1/parts/02-detail.md': '# Detail\n',
            'book1/vol-1/front-matter/01-preface.md': '# Preface\n', 'book1/back-matter/01-ending.md': '# Ending\n',
            'book1/to-be-continued.md': '# Continuing\n', 'book2/01-other.md': '# Another book\n' })) {
            await fs.mkdir(path.dirname(path.join(project, file)), { recursive: true }); await fs.writeFile(path.join(project, file), text);
        }
        const bundleDir = path.join(temporary, 'bundle');
        await build({ entryPoints: [path.join(root, 'src/reader/reader-create-api.ts'), path.join(root, 'src/reader/server.ts')], outdir: bundleDir,
            outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', tsconfig: path.join(root, 'tsconfig.cli.json') });
        const { handleReaderCreatePageRoute: route } = require(path.join(bundleDir, 'reader-create-api.cjs'));
        const query = value => new URLSearchParams(value), before = await tree(project);
        for (const [filePath, container] of [['book1/back-matter/01-ending.md', 'book1'], ['book1/vol-1/front-matter/01-preface.md', 'book1/vol-1'],
            ['book1/vol-1/parts/02-detail.md', 'book1/vol-1'], ['intro.md', '.'], ['', '.']]) {
            const value = await route(project, 'GET', '/api/create-page/scopes', query({ filePath }));
            assert.equal(value.defaultContainer, container); assert.ok(!value.scopes.some(scope => /(?:front|back)-matter/.test(scope.container)));
        }
        const special = 'AI "quotes" $(literal) `ticks`';
        const value = await route(project, 'GET', '/api/create-page/plan', query({ kind: 'back-matter', title: special, container: 'book1' }));
        assert.equal(value.plan.title, special); assert.match(value.plan.filePath, /^book1\/back-matter\//);
        assert.equal(value.assistantCommand.executable, process.execPath); assert.equal(value.assistantCommand.cwd, project);
        assert.equal(value.assistantCommand.args[0], path.join(bundleDir, 'math-workspace.js'));
        assert.equal(value.assistantCommand.args[value.assistantCommand.args.indexOf('--title') + 1], special);
        const existing = await route(project, 'GET', '/api/create-page/plan', query({ kind: 'continued', title: 'Next steps', container: 'book1' }));
        assert.equal(existing.plan.exists, true); assert.equal(existing.plan.existingFile, 'book1/to-be-continued.md');
        await assert.rejects(route(project, 'POST', '/api/create-page/plan', query({})), error => error.status === 405);
        await assert.rejects(route(project, 'GET', '/api/create-page/write', query({})), error => error.status === 404);
        for (const input of [{ kind: 'write', title: 'X', container: '.' }, { kind: 'chapter', title: 'X', container: '../foreign' }])
            await assert.rejects(route(project, 'GET', '/api/create-page/plan', query(input)), error => error.status === 400);
        assert.deepEqual(await tree(project), before, 'Scopes, plans, duplicate checks and rejected writes do not change project bytes.');
        const staticRoot = path.join(temporary, 'static'); await fs.mkdir(staticRoot); await fs.writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>Reader</title>');
        const { startReaderServer } = require(path.join(bundleDir, 'server.cjs'));
        server = await startReaderServer({ rootPath: project, staticRoot, port: 0, recentProjectsPath: path.join(temporary, 'recent.json'), locationRegistryPath: path.join(temporary, 'locations.json') });
        const state = await (await fetch(server.url + '/api/state')).json(), headers = { 'x-math-workspace-token': state.requestToken, 'x-math-workspace-project': state.projectId };
        const endpoint = server.url + '/api/create-page/plan?' + query({ kind: 'chapter', title: 'Reader preview', container: 'book1' });
        assert.equal((await fetch(endpoint)).status, 403);
        assert.equal((await fetch(endpoint, { headers: { ...headers, 'x-math-workspace-project': 'another-project' } })).status, 409);
        assert.equal((await fetch(endpoint, { headers: { ...headers, origin: 'https://outside.invalid' } })).status, 403);
        assert.equal((await fetch(endpoint, { headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status, 403);
        assert.equal((await fetch(endpoint, { headers, method: 'POST', body: '{}' })).status, 405);
        assert.equal((await fetch(endpoint, { headers, method: 'DELETE' })).status, 405);
        const result = await fetch(endpoint, { headers }); assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
        assert.equal((await result.json()).plan.exists, false); assert.deepEqual(await tree(project), before);
    } finally { await server?.close(); await fs.rm(temporary, { recursive: true, force: true }); }
}

export async function testReaderCreatePage() {
    await creationDialogContract(); await lateResponseContract(); await staleExistingAndCopyContract(); await readOnlyApiContract();
    console.log('Reader create page: read-only scopes/plans, local ACL, compact bilingual dialog, structured CLI handoff, debounce and stale lifecycle passed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderCreatePage();
