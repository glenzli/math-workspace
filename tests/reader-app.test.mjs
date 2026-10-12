import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function testReaderApps() {
    await testReaderAppBridge();
    await testReaderViewRecovery();
    await testReaderReferences();
    await testReaderLaunchState();
    await testFigurePolicy();
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-app-'));
    const cli = path.join(repoRoot, 'out/cli/math-workspace.js');
    const roots = [path.join(temporary, 'first'), path.join(temporary, 'second')];
    for (const [index, root] of roots.entries()) {
        await fs.mkdir(path.join(root, 'book1'), { recursive: true });
        await fs.writeFile(path.join(root, 'book1/01-foundations.md'), '# Foundations\n\nProject ' + index + '.\n\n$$x^2 + y^2 = 1$$\n');
        await fs.writeFile(path.join(root, 'book1/image.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text>Local asset</text></svg>');
        await fs.writeFile(path.join(root, 'book1/figure.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body>Figure<script>document.body.dataset.rendered="yes"</script></body></html>');
        const prepared = spawnSync(process.execPath, [cli, 'prepare'], { cwd: root, encoding: 'utf8' });
        assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
    }
    let clientRoots = [roots[0]];
    let rootsUnavailable = false;
    const client = new Client({ name: 'reader-app-test', version: '1.0.0' }, { capabilities: { roots: { listChanged: true } } });
    client.setRequestHandler(ListRootsRequestSchema, async () => {
        if (rootsUnavailable) throw new Error('Workspace context unavailable.');
        return { roots: clientRoots.map(root => ({ uri: pathToFileURL(root).href })) };
    });
    const pluginRoot = path.join(repoRoot, 'plugins', 'math-workspace');
    const mcpConfig = JSON.parse(await fs.readFile(path.join(pluginRoot, '.mcp.json'), 'utf8')).mcpServers['math-workspace'];
    const pluginCwd = path.resolve(pluginRoot, mcpConfig.cwd);
    // Exercise the packaged entrypoint, including its runtime selection and configured cwd.
    const transport = new StdioClientTransport({
        command: path.resolve(pluginCwd, mcpConfig.command), args: mcpConfig.args, cwd: pluginCwd,
        env: { ...process.env, CODEX_MCP_NODE_PATH: process.execPath,
            MATH_WORKSPACE_STATE: path.join(temporary, 'recent.json'),
            MATH_WORKSPACE_READER_INSTANCES: path.join(temporary, 'instances.json'),
            MATH_WORKSPACE_DISCUSSION_MARKS: path.join(temporary, 'marks.json') }, stderr: 'pipe'
    });
    let stderr = '';
    transport.stderr?.on('data', chunk => { stderr += String(chunk); });
    try {
        await client.connect(transport);
        const icon = client.getServerVersion().icons?.[0];
        assert.equal(icon?.mimeType, 'image/png');
        assert.deepEqual(icon.sizes, ['128x128']);
        assert.match(icon.src, /^data:image\/png;base64,/);
        assert.deepEqual(Buffer.from(icon.src.split(',')[1], 'base64'),
            await fs.readFile(path.join(pluginRoot, 'assets/file-handler-icon.png')),
            'Sidebar and conversation entrypoints must inherit the packaged M# icon.');
        const tools = (await client.listTools()).tools;
        const global = tools.find(tool => tool.name === 'open_workspace');
        const thread = tools.find(tool => tool.name === 'open_reader');
        assert.deepEqual(global._meta['openai/ui'].entrypoints, [{ type: 'global' }]);
        assert.deepEqual(thread._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);
        assert.equal(global._meta.ui.resourceUri, thread._meta.ui.resourceUri);
        assert.match(global._meta.ui.resourceUri, /reader-v2\.html$/);
        for (const name of ['reader_view', 'reader_request', 'reader_updates', 'close_reader_view']) {
            assert.deepEqual(tools.find(tool => tool.name === name)._meta.ui.visibility, ['app']);
        }
        const resource = (await client.readResource({ uri: global._meta.ui.resourceUri })).contents[0];
        assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
        assert.deepEqual(resource._meta.ui.csp.frameDomains, ['blob:']);
        assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
        assert.match(resource.text, /data-math-workspace-app/);
        assert.match(resource.text, /ui\/initialize/);
        assert.match(resource.text, /data:font\/woff2;base64,/);
        assert.doesNotMatch(resource.text, /<(?:script|link)[^>]+(?:src|href)="[^"]+\.(?:js|css)"/);
        assert.doesNotMatch(resource.text, /<iframe[^>]+src="http:/);
        const sidebarSeed = await client.callTool({ name: 'open_workspace', arguments: {} });
        assert.deepEqual(sidebarSeed._meta.reader, { launcher: false, projectRoot: await fs.realpath(roots[0]) });
        const threadSeed = await client.callTool({ name: 'open_reader', arguments: {} });
        assert.equal(threadSeed._meta.reader.projectRoot, await fs.realpath(roots[0]));
        clientRoots = [roots[1]];
        const changedProject = await client.callTool({ name: 'open_workspace', arguments: {} });
        assert.equal(changedProject._meta.reader.projectRoot, await fs.realpath(roots[1]), 'Current workspace overrides the server startup project.');
        const explicitProject = await client.callTool({ name: 'open_workspace', arguments: { projectRoot: roots[0] } });
        assert.equal(explicitProject._meta.reader.projectRoot, await fs.realpath(roots[0]));
        for (const unavailable of [[], [roots[0], roots[1]], [temporary]]) {
            clientRoots = unavailable;
            const chooser = await client.callTool({ name: 'open_workspace', arguments: {} });
            assert.deepEqual(chooser._meta.reader, { launcher: true });
        }
        rootsUnavailable = true;
        assert.deepEqual((await client.callTool({ name: 'open_workspace', arguments: {} }))._meta.reader, { launcher: true });
        rootsUnavailable = false;
        clientRoots = [roots[0]];
        for (const cwd of [path.join(roots[0], 'book1'), temporary]) {
            const fallback = new Client({ name: 'reader-cwd-test', version: '1.0.0' });
            try {
                await fallback.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], cwd,
                    env: { ...process.env, MATH_WORKSPACE_STATE: path.join(temporary, 'recent.json') }, stderr: 'pipe' }));
                const seed = await fallback.callTool({ name: 'open_workspace', arguments: {} });
                assert.deepEqual(seed._meta.reader, cwd === temporary ? { launcher: true }
                    : { launcher: false, projectRoot: await fs.realpath(roots[0]) });
            } finally { await fallback.close(); }
        }
        const open = async (viewKey, extra = {}) => {
            const result = await client.callTool({ name: 'reader_view', arguments: { viewKey, ...extra } });
            assert.equal(result.isError, undefined, JSON.stringify(result));
            assert.deepEqual(result.structuredContent, { ready: true });
        };
        const request = async (viewKey, route, extra = {}) => {
            const result = await client.callTool({ name: 'reader_request', arguments: { viewKey, route, ...extra } });
            assert.equal(result.isError, undefined, JSON.stringify(result));
            return { ...result.structuredContent, text: Buffer.from(result.structuredContent.body, 'base64').toString() };
        };
        const json = async (...args) => JSON.parse((await request(...args)).text);
        const first = 'a'.repeat(32), second = 'b'.repeat(32), launcher = 'c'.repeat(32);
        await open(first, { projectRoot: roots[0] }); await open(second, { projectRoot: roots[1] }); await open(launcher, { launcher: true });
        assert.equal((await json(first, '/api/state')).rootName, 'first');
        assert.equal((await json(second, '/api/state')).rootName, 'second');
        const chooser = await json(launcher, '/api/state');
        assert.equal(chooser.available, false);
        const index = chooser.recentProjects.findIndex(project => project.rootName === 'second');
        assert.ok(index >= 0);
        assert.equal((await json(launcher, '/api/projects/recent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ index }) })).rootName, 'second');
        assert.equal((await json(first, '/api/state')).rootName, 'first');
        assert.equal((await json(launcher, '/api/plugin-context')).projectRoot, await fs.realpath(roots[1]));
        assert.match((await json(first, '/api/page?path=book1%2F01-foundations.md')).content, /Project 0/);
        assert.match((await json(second, '/api/page?path=book1%2F01-foundations.md')).content, /Project 1/);
        const asset = await request(first, '/api/asset?path=book1%2Fimage.svg');
        assert.equal(asset.status, 200); assert.match(asset.text, /Local asset/);
        assert.equal(asset.text, await fs.readFile(path.join(roots[0], 'book1/image.svg'), 'utf8'));
        const figure = await request(first, '/api/figure?path=book1%2Ffigure.html');
        assert.equal(figure.status, 200);
        assert.match(figure.headers['content-security-policy'], /sandbox allow-scripts/);
        assert.match(figure.headers['content-security-policy'], /connect-src 'none'/);
        assert.match(figure.text, /math-workspace-figure/);
        assert.equal((await request(first, '/api/asset?path=book1%2Ffigure.html')).status, 403);
        assert.equal((await request(first, '/api/figure?path=..%2Foutside.html')).status, 403);
        assert.equal((await request(first, '/api/discussion-marks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 405);
        for (const route of ['https://example.com/api/state', '/api/../state', '/api/%2e%2e/state', '/api/events', '/assets/index.js']) {
            assert.equal((await client.callTool({ name: 'reader_request', arguments: { viewKey: first, route } })).isError, true, route);
        }
        assert.equal((await client.callTool({ name: 'reader_view', arguments: { viewKey: 'e'.repeat(32), projectRoot: temporary } })).isError, true);
        await open(first, { projectRoot: roots[1] });
        assert.equal((await json(first, '/api/state')).rootName, 'first');
        const updates = async cursor => {
            const result = await client.callTool({ name: 'reader_updates', arguments: { viewKey: first, cursor, waitMs: 5000 } });
            assert.equal(result.isError, undefined, JSON.stringify(result)); return result.structuredContent;
        };
        const initial = await updates(0);
        assert.equal(initial.events[0].type, 'workspace-update');
        assert.equal(JSON.parse(initial.events[0].data).initial, true);
        await fs.appendFile(path.join(roots[0], 'book1/01-foundations.md'), '\nA live update.\n');
        const update = await updates(initial.cursor);
        assert.ok(update.events.some(event => event.type === 'workspace-update' && JSON.parse(event.data).changedPaths.includes('book1/01-foundations.md')));
        const waiting = client.callTool({ name: 'reader_updates', arguments: { viewKey: first, cursor: update.cursor, waitMs: 5000 } });
        await client.callTool({ name: 'close_reader_view', arguments: { viewKey: first } });
        const released = await waiting;
        assert.ok(!released.isError || /Reader view not found/.test(released.content[0].text));
        assert.equal((await client.callTool({ name: 'reader_request', arguments: { viewKey: first, route: '/api/state' } })).isError, true);
        assert.equal((await request(second, '/api/state')).status, 200);
    } finally {
        await client.close(); await fs.rm(temporary, { recursive: true, force: true });
    }
    assert.equal(stderr.includes('Error:'), false, stderr);
}

async function testReaderAppBridge() {
    const callbacks = new Map(), sent = [], persisted = [], exports = {};
    const parent = { postMessage: message => sent.push(message) };
    const oldState = { viewKey: 'f'.repeat(32), projectRoot: '/saved-project', pagePath: 'book/chapter.md', scrollTop: 345 };
    const window = { openai: { widgetState: oldState, setWidgetState: value => persisted.push(JSON.parse(JSON.stringify(value))) } };
    const history = { replaceState: (_state, _title, url) => { history.url = url; } };
    const source = await fs.readFile(path.join(repoRoot, 'src/reader/web/reader-host.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const context = vm.createContext({
        exports, window, parent, crypto, URLSearchParams, Headers, Response, Uint8Array, atob, MessageEvent,
        history, location: { pathname: '/resource' }, setTimeout, clearTimeout, console,
        document: { documentElement: { hasAttribute: () => true, classList: { add() {} } } },
        addEventListener: (name, callback) => callbacks.set(name, callback)
    });
    vm.runInContext(compiled, context);
    const receive = (data, source = parent, origin = 'https://codex.example') => callbacks.get('message')({ data, source, origin });
    const flush = async () => new Promise(resolve => setImmediate(resolve));
    const reply = (call, result) => receive({ jsonrpc: '2.0', id: call.id, result });
    const initializing = exports.initializeReaderHost();
    const initialize = sent.find(message => message.method === 'ui/initialize');
    receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { reader: { launcher: false, projectRoot: '/saved-project' } } } });
    assert.equal(exports.canReferenceReaderInConversation(), false);
    await assert.rejects(exports.referenceReaderInConversation([{ type: 'resource', resource: { uri: 'file:///saved-project/book/chapter.md', mimeType: 'text/markdown', text: '$x \\le y$' } }]), /cannot add references/);
    reply(initialize, { protocolVersion: '2026-01-26', hostCapabilities: { message: {}, experimental: { 'openai/message': { draft: {} } } } }); await flush();
    const open = sent.find(message => message.params?.name === 'reader_view');
    assert.ok(open); const key = open.params.arguments.viewKey;
    assert.match(key, /^[a-f0-9]{32}$/); assert.notEqual(key, oldState.viewKey);
    assert.equal(open.params.arguments.projectRoot, oldState.projectRoot);
    reply(open, { structuredContent: { ready: true } }); await initializing;
    assert.equal(exports.canReferenceReaderInConversation(), true);
    assert.equal(sent.some(message => message.method === 'ui/message'), false, 'Opening a panel must not add a source reference.');
    assert.equal(sent.some(message => message.method === 'ui/update-model-context'), false, 'Opening a panel must not attach automatic conversation context.');
    const content = [{ type: 'resource', resource: { uri: 'file:///saved-project/book/chapter.md#L2-L4', mimeType: 'text/markdown', text: '$x \\le y$' } }];
    const quoted = exports.referenceReaderInConversation(content);
    const quote = sent.find(message => message.method === 'ui/message');
    assert.equal(quote.params.role, 'user');
    assert.equal(quote.params.content[0].resource.text, content[0].resource.text);
    assert.equal(quote.params._meta['openai/message'].target, 'active');
    assert.equal(quote.params._meta['openai/message'].send, false, 'A quote must never automatically send the conversation.');
    reply(quote, {}); await quoted;
    const denied = exports.referenceReaderInConversation(content);
    const retry = sent.at(-1);
    receive({ jsonrpc: '2.0', id: retry.id, error: { code: -32601, message: 'The composer is unavailable.' } });
    await assert.rejects(denied, /composer is unavailable/);
    assert.equal(content[0].resource.text, '$x \\le y$', 'Failed handoff must retain the source attachment.');
    assert.equal(exports.readerSearch(), '?path=book%2Fchapter.md&readerScroll=345');
    assert.equal(history.url, undefined, 'Opaque plugin origins must not require browser history writes.');
    const reading = exports.readerHostFetch('/api/state');
    const read = sent.find(message => message.params?.name === 'reader_request');
    assert.equal(read.params.arguments.viewKey, key);
    receive({ jsonrpc: '2.0', id: read.id, result: {} }, parent, 'https://unrelated.example');
    reply(read, { structuredContent: { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"available":true}').toString('base64') } });
    assert.deepEqual(await (await reading).json(), { available: true });
    const referenceCount = sent.filter(message => message.method === 'ui/message').length;
    exports.persistReaderState({ projectRoot: '/saved-project', pagePath: 'book/chapter.md', scrollTop: 678 });
    assert.equal(persisted.at(-1).scrollTop, 678);
    assert.equal(sent.some(message => message.method === 'ui/update-model-context'), false);
    exports.persistReaderState({ projectRoot: '/saved-project', pagePath: 'book/next.md' });
    assert.equal(persisted.at(-1).pagePath, 'book/next.md');
    exports.persistReaderState({ projectRoot: '/another-project', pagePath: 'book/start.md' });
    assert.equal(persisted.at(-1).projectRoot, '/another-project');
    assert.equal(sent.filter(message => message.method === 'ui/message').length, referenceCount, 'Saving reading position, navigating, or changing projects must not add a reference.');
    assert.equal(sent.some(message => message.method === 'ui/update-model-context'), false, 'Opening or navigating a page must not attach automatic conversation context.');
    exports.expandReader();
    const expand = sent.find(message => message.method === 'ui/request-display-mode'); assert.equal(expand.params.mode, 'fullscreen'); reply(expand, {});
    receive({ jsonrpc: '2.0', id: 99, method: 'ui/resource-teardown' });
    const close = sent.find(message => message.params?.name === 'close_reader_view'); assert.equal(close.params.arguments.viewKey, key);
    reply(close, { structuredContent: { closed: true } }); await flush();
    assert.ok(sent.some(message => message.id === 99 && message.result));
}

async function readerRecoveryFixture(seed = { projectRoot: '/original-project' }) {
    const callbacks = new Map(), sent = [], timers = new Set(), exports = {}, warnings = [];
    const parent = { postMessage: message => sent.push(message) };
    const persisted = [];
    const source = await fs.readFile(path.join(repoRoot, 'src/reader/web/reader-host.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
    } }).outputText, {
        exports, parent, crypto, URLSearchParams, Headers, Response, Uint8Array, atob, MessageEvent,
        window: { openai: { widgetState: { projectRoot: '/old-project' }, setWidgetState: value => persisted.push({ ...value }) } },
        document: { documentElement: { hasAttribute: () => true, classList: { add() {} } } },
        console: { warn: (...args) => warnings.push(args) },
        setTimeout: (callback, delay) => { const timer = setTimeout(callback, delay); timers.add(timer); return timer; },
        clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); },
        addEventListener: (name, callback) => callbacks.set(name, callback)
    });
    const receive = data => callbacks.get('message')({ data, source: parent, origin: 'https://codex.example' });
    const reply = (message, result) => receive({ jsonrpc: '2.0', id: message.id, result });
    const json = (message, value) => reply(message, { structuredContent: {
        status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)).toString('base64')
    } });
    const missing = message => reply(message, { isError: true, content: [{ type: 'text', text: 'Reader view not found.' }] });
    const calls = name => sent.filter(message => message.params?.name === name);
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const initializing = exports.initializeReaderHost();
    receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { reader: seed } } });
    reply(sent[0], { hostCapabilities: { message: {}, experimental: { 'openai/message': { draft: {} } } } });
    await flush();
    const key = calls('reader_view')[0].params.arguments.viewKey;
    reply(calls('reader_view')[0], { structuredContent: { ready: true } });
    await initializing;
    const events = exports.readerHostEvents();
    return { exports, events, sent, persisted, warnings, receive, reply, json, missing, calls, flush, key,
        async recover() {
            reply(calls('reader_view').at(-1), { structuredContent: { ready: true } });
            await flush();
            const state = calls('reader_request').at(-1);
            assert.equal(state.params.arguments.route, '/api/state');
            json(state, { available: true, requestToken: 'new-token', revision: 1 });
            await flush();
        },
        async dispose() {
            events.close();
            receive({ jsonrpc: '2.0', id: 999, method: 'ui/resource-teardown' });
            const close = calls('close_reader_view').at(-1);
            if (close) reply(close, { structuredContent: { closed: true } });
            await flush();
            for (const timer of timers) clearTimeout(timer);
        }
    };
}

export async function testReaderViewRecovery() {
    const fixture = await readerRecoveryFixture();
    const { exports, events, calls, reply, json, missing, flush } = fixture;
    try {
        exports.persistReaderState({ projectRoot: '/selected-project', pagePath: 'book/current.md', scrollTop: 678 });
        exports.persistReaderState({ projectRoot: undefined, scrollTop: 678 });
        exports.readerHistory('replace', {}, '?path=book%2Fcurrent.md');
        const reconnects = [], updates = [];
        events.addEventListener('reader-reconnect', event => reconnects.push(JSON.parse(event.data)));
        events.addEventListener('workspace-update', event => updates.push(JSON.parse(event.data)));
        reply(calls('reader_updates').at(-1), { structuredContent: { cursor: 9, events: [] } });
        await flush();
        const polling = calls('reader_updates').at(-1);
        const page = exports.readerHostFetch('/api/page?path=book%2Fnext.md'); page.catch(() => {});
        const pageCall = calls('reader_request').at(-1);
        const protectedRead = exports.readerHostFetch('/api/document-state', { headers: { 'x-math-workspace-token': 'old-token' } }); protectedRead.catch(() => {});
        const protectedCall = calls('reader_request').at(-1);
        const delayed = exports.readerHostFetch('/api/definition?index=0'); delayed.catch(() => {});
        const delayedCall = calls('reader_request').at(-1);
        missing(pageCall); missing(protectedCall); missing(polling);
        await flush();
        assert.equal(calls('reader_view').length, 2, 'Concurrent navigation and polling failures must reopen exactly one view.');
        assert.equal(calls('reader_view').at(-1).params.arguments.projectRoot, '/selected-project');
        assert.equal(calls('reader_view').at(-1).params.arguments.viewKey, fixture.key);
        await fixture.recover();
        assert.equal(calls('reader_updates').at(-1).params.arguments.cursor, 0, 'A new backend must not inherit the old event cursor.');
        assert.equal(reconnects.length, 1);
        assert.equal(reconnects[0].requestToken, 'new-token');
        const retryPage = calls('reader_request').filter(call => call.params.arguments.route === pageCall.params.arguments.route).at(-1);
        const retryProtected = calls('reader_request').filter(call => call.params.arguments.route === '/api/document-state').at(-1);
        assert.notEqual(retryPage.id, pageCall.id);
        assert.equal(retryProtected.params.arguments.headers['x-math-workspace-token'], 'new-token');
        json(retryPage, { filePath: 'book/next.md' }); json(retryProtected, { documents: [] });
        assert.equal((await (await page).json()).filePath, 'book/next.md');
        await protectedRead;
        missing(delayedCall); await flush();
        assert.equal(calls('reader_view').length, 2, 'A delayed failure from the old view must reuse the completed recovery.');
        json(calls('reader_request').at(-1), { definition: true }); await delayed;
        reply(calls('reader_updates').at(-1), { structuredContent: {
            cursor: 1, events: [{ type: 'workspace-update', data: '{"changedPaths":["book/current.md"]}' }]
        } });
        await flush();
        assert.deepEqual(updates[0].changedPaths, ['book/current.md']);
        assert.equal(exports.readerSearch(), '?path=book%2Fcurrent.md');
        assert.equal(fixture.persisted.at(-1).scrollTop, 678, 'Recovery must preserve the reading position.');
        assert.equal(fixture.sent.some(message => ['ui/message', 'ui/update-model-context'].includes(message.method)), false);
        const forbidden = exports.readerHostFetch('/api/invalid');
        const rejection = assert.rejects(forbidden, /Invalid Reader API path/);
        reply(calls('reader_request').at(-1), { isError: true, content: [{ type: 'text', text: 'Invalid Reader API path.' }] });
        await rejection;
        assert.equal(calls('reader_view').length, 2, 'Ordinary API failures must not recreate the view.');
    } finally { await fixture.dispose(); }

    for (const method of ['GET', 'POST', 'DELETE']) {
        const fixture = await readerRecoveryFixture({ launcher: true });
        try {
            const read = fixture.exports.readerHostFetch('/api/document-state', { method });
            const rejection = assert.rejects(read, /Reader view not found/);
            fixture.missing(fixture.calls('reader_request').at(-1)); await fixture.flush();
            assert.equal(fixture.calls('reader_view').at(-1).params.arguments.projectRoot, undefined, 'An unbound launcher must remain unbound.');
            assert.equal(fixture.calls('reader_view').at(-1).params.arguments.launcher, true);
            await fixture.recover();
            const attempts = fixture.calls('reader_request').filter(call => call.params.arguments.route === '/api/document-state');
            assert.equal(attempts.length, method === 'GET' ? 2 : 1, 'Only reads may be replayed automatically.');
            if (method === 'GET') fixture.missing(attempts.at(-1));
            await rejection;
            assert.equal(fixture.calls('reader_view').length, 2, 'A failed retry must terminate instead of reopening forever.');
        } finally { await fixture.dispose(); }
    }

    const stale = await readerRecoveryFixture();
    try {
        const oldPoll = stale.calls('reader_updates').at(-1);
        const read = stale.exports.readerHostFetch('/api/page?path=book%2Fnext.md'); read.catch(() => {});
        stale.missing(stale.calls('reader_request').at(-1)); await stale.flush();
        await stale.recover();
        stale.json(stale.calls('reader_request').at(-1), { filePath: 'book/next.md' }); await read;
        stale.reply(oldPoll, { structuredContent: { cursor: 99, events: [{ type: 'reader-navigate', data: '{}' }] } });
        await stale.flush();
        assert.equal(stale.calls('reader_updates').at(-1).params.arguments.cursor, 0, 'A late old poll must not overwrite the reset cursor.');
        const failing = stale.exports.readerHostFetch('/api/page?path=book%2Fnext.md');
        const rejection = assert.rejects(failing, /Choose a prepared/);
        stale.missing(stale.calls('reader_request').at(-1)); await stale.flush();
        stale.reply(stale.calls('reader_view').at(-1), { isError: true, content: [{ type: 'text', text: 'Choose a prepared Math Workspace project.' }] });
        await rejection;
        assert.equal(stale.calls('reader_view').length, 3, 'A reopening failure must terminate the page request.');
    } finally { await stale.dispose(); }

    const closing = await readerRecoveryFixture();
    try {
        const read = closing.exports.readerHostFetch('/api/page?path=book%2Fnext.md');
        const rejection = assert.rejects(read, /panel is closed/);
        closing.missing(closing.calls('reader_request').at(-1)); await closing.flush();
        const recovering = closing.calls('reader_view').at(-1);
        closing.receive({ jsonrpc: '2.0', id: 77, method: 'ui/resource-teardown' });
        closing.receive({ jsonrpc: '2.0', id: 78, method: 'ui/resource-teardown' });
        assert.equal(closing.exports.canReferenceReaderInConversation(), false, 'Teardown must stop the panel before the close response arrives.');
        await assert.rejects(closing.exports.readerHostFetch('/api/state'), /panel is closed/);
        await rejection;
        assert.equal(closing.calls('close_reader_view').length, 1, 'Repeated teardown must share one close operation.');
        closing.reply(recovering, { structuredContent: { ready: true } }); await closing.flush();
        assert.equal(closing.calls('reader_request').length, 1, 'A late recovery response must not resurrect a closed panel.');
        closing.reply(closing.calls('close_reader_view')[0], { structuredContent: { closed: true } }); await closing.flush();
        assert.ok(closing.sent.some(message => message.id === 77 && message.result));
        assert.ok(closing.sent.some(message => message.id === 78 && message.result));
        assert.equal(closing.calls('reader_updates').length, 1);
    } finally { await closing.dispose(); }
}

async function testReaderReferences() {
    const source = await fs.readFile(path.join(repoRoot, 'src/reader/web/reader-references.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, URL });
    const document = { projectRoot: '/project with spaces/数学', title: '算子界', source: '# Title\r\nLet $T \\circ S$ be a map.\r\n$$\\|T\\| \\le K$$\r\n' };
    const location = { filePath: 'book/chapter.md', startLine: 2, endLine: 3, formalId: 'h-bound' };
    const reference = exports.readerReference(document, location);
    assert.equal(reference.type, 'resource');
    assert.equal(reference.resource.mimeType, 'text/markdown');
    assert.match(reference.resource.uri, /^file:\/\/\/project%20with%20spaces\/%E6%95%B0%E5%AD%A6\/book\/chapter.md#L2-L3$/);
    assert.match(reference.resource.text, /Object: h-bound/);
    assert.ok(reference.resource.text.endsWith('Let $T \\circ S$ be a map.\n$$\\|T\\| \\le K$$'));
    assert.ok(exports.readerReference(document, location, '$T \\circ S$').resource.text.endsWith('$T \\circ S$'));
    for (const malformed of [{ startLine: 0 }, { endLine: 9 }, { filePath: '../outside.md' }, { filePath: '/outside.md' }]) {
        assert.throws(() => exports.readerReference(document, { ...location, ...malformed }));
    }
    assert.throws(() => exports.readerReference({ ...document, projectRoot: '' }, location), /project is unavailable/);

    const textNode = text => ({ nodeType: 3, textContent: text });
    const element = (tagName, childNodes, dataset = {}) => ({ nodeType: 1, tagName, childNodes, dataset });
    const markdown = 'Let **$T \\circ S$** and @h-bound apply.';
    const fragment = { nodeType: 11, childNodes: [
        textNode('Let '),
        element('STRONG', [element('SPAN', [textNode('rendered KaTeX text')], { readerFormula: 'formula-1' })]),
        textNode(' and '),
        element('A', [textNode('Theorem 1')], { formalRef: 'h-bound' }),
        textNode(' apply.')
    ] };
    assert.equal(exports.selectedReaderMarkdown({ cloneContents: () => fragment }, [{ id: 'formula-1', source: '$T \\circ S$' }], markdown), markdown, 'A rendered selection must restore source LaTeX, emphasis, and formal references.');
}

async function testReaderLaunchState() {
    const source = await fs.readFile(path.join(repoRoot, 'src/reader/web/reader-host.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    for (const fixture of [
        { initial: { projectRoot: '/current-project' }, expectedRoot: '/current-project', expectedSearch: '', restored: false },
        { initial: { projectRoot: '/saved-project' }, expectedRoot: '/saved-project', expectedSearch: '?path=draft%2Fidea.md&readerScroll=345', restored: true },
        { initial: { projectRoot: '/saved-project', pagePath: 'book/start.md' }, expectedRoot: '/saved-project', expectedSearch: '?path=book%2Fstart.md', restored: false },
        { initial: { launcher: true }, expectedRoot: undefined, expectedSearch: '', restored: false }
    ]) {
        const callbacks = new Map(), sent = [], exports = {};
        const parent = { postMessage: message => sent.push(message) };
        const window = { openai: { widgetState: { projectRoot: '/saved-project', pagePath: 'draft/idea.md', scrollTop: 345 } } };
        const context = vm.createContext({ exports, window, parent, crypto, URLSearchParams, setTimeout, clearTimeout,
            document: { documentElement: { hasAttribute: () => true, classList: { add() {} } } },
            addEventListener: (name, callback) => callbacks.set(name, callback) });
        vm.runInContext(compiled, context);
        const receive = data => callbacks.get('message')({ data, source: parent, origin: 'https://codex.example' });
        const initializing = exports.initializeReaderHost();
        const init = sent.find(message => message.method === 'ui/initialize');
        receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { reader: fixture.initial } } });
        receive({ jsonrpc: '2.0', id: init.id, result: { hostCapabilities: { message: {} } } });
        await new Promise(resolve => setImmediate(resolve));
        const open = sent.find(message => message.params?.name === 'reader_view');
        assert.equal(open.params.arguments.projectRoot, fixture.expectedRoot);
        receive({ jsonrpc: '2.0', id: open.id, result: { structuredContent: { ready: true } } });
        await initializing;
        assert.equal(exports.canReferenceReaderInConversation(), false, 'Message support alone must not enable a draft handoff.');
        await assert.rejects(exports.referenceReaderInConversation([]), /cannot add references/);
        assert.equal(sent.some(message => message.method === 'ui/message'), false, 'Older hosts must never receive a quote that could send a turn.');
        assert.equal(exports.readerSearch(), fixture.expectedSearch);
        assert.equal(exports.isReaderPageRestored(), fixture.restored);
    }
}

async function testFigurePolicy() {
    const source = await fs.readFile(path.join(repoRoot, 'src/reader/web/reader-figures.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: () => ({}) });
    const policy = "sandbox allow-scripts; script-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'self'";
    for (const html of ['<html><head></head><script>run()</script></html>', '<script>run()</script>', '<!doctype html><html><body><script>run()</script></body></html>']) {
        const served = exports.readerFigureDocument(html, policy);
        assert.ok(served.indexOf('Content-Security-Policy') < served.indexOf('<script>'));
        assert.match(served, /connect-src 'none'/);
        assert.doesNotMatch(served, /frame-ancestors|sandbox/);
    }
    assert.throws(() => exports.readerFigureDocument('<script>run()</script>', null), /policy is unavailable/);
}
