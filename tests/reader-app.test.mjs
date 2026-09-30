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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function testReaderApps() {
    await testReaderAppBridge();
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
    const client = new Client({ name: 'reader-app-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
        command: process.execPath, args: [cli, 'mcp', '--root', roots[0]], cwd: roots[0],
        env: { ...process.env, MATH_WORKSPACE_STATE: path.join(temporary, 'recent.json'),
            MATH_WORKSPACE_READER_INSTANCES: path.join(temporary, 'instances.json'),
            MATH_WORKSPACE_DISCUSSION_MARKS: path.join(temporary, 'marks.json') }, stderr: 'pipe'
    });
    let stderr = '';
    transport.stderr?.on('data', chunk => { stderr += String(chunk); });
    try {
        await client.connect(transport);
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
        assert.deepEqual(sidebarSeed._meta.reader, { launcher: true });
        const threadSeed = await client.callTool({ name: 'open_reader', arguments: {} });
        assert.equal(threadSeed._meta.reader.projectRoot, await fs.realpath(roots[0]));
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
        assert.equal((await request(first, '/api/discussion-marks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
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
    receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { reader: { launcher: true, projectRoot: '/initial-project' } } } });
    reply(initialize, { protocolVersion: '2026-01-26' }); await flush();
    const open = sent.find(message => message.params?.name === 'reader_view');
    assert.ok(open); const key = open.params.arguments.viewKey;
    assert.match(key, /^[a-f0-9]{32}$/); assert.notEqual(key, oldState.viewKey);
    assert.equal(open.params.arguments.projectRoot, oldState.projectRoot);
    reply(open, { structuredContent: { ready: true } }); await initializing;
    assert.equal(exports.readerSearch(), '?path=book%2Fchapter.md&readerScroll=345');
    assert.equal(history.url, undefined, 'Opaque plugin origins must not require browser history writes.');
    const reading = exports.readerHostFetch('/api/state');
    const read = sent.find(message => message.params?.name === 'reader_request');
    assert.equal(read.params.arguments.viewKey, key);
    receive({ jsonrpc: '2.0', id: read.id, result: {} }, parent, 'https://unrelated.example');
    reply(read, { structuredContent: { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"available":true}').toString('base64') } });
    assert.deepEqual(await (await reading).json(), { available: true });
    exports.persistReaderState({ projectRoot: '/saved-project', pagePath: 'book/chapter.md', scrollTop: 678 });
    assert.equal(persisted.at(-1).scrollTop, 678);
    assert.equal(sent.some(message => message.method === 'ui/update-model-context'), false);
    exports.persistReaderState({ projectRoot: '/saved-project', pagePath: 'book/next.md' });
    const locator = sent.find(message => message.method === 'ui/update-model-context');
    assert.match(locator.params.content[0].text, /book\/next.md/); reply(locator, {});
    exports.expandReader();
    const expand = sent.find(message => message.method === 'ui/request-display-mode'); assert.equal(expand.params.mode, 'fullscreen'); reply(expand, {});
    receive({ jsonrpc: '2.0', id: 99, method: 'ui/resource-teardown' });
    const close = sent.find(message => message.params?.name === 'close_reader_view'); assert.equal(close.params.arguments.viewKey, key);
    reply(close, { structuredContent: { closed: true } }); await flush();
    assert.ok(sent.some(message => message.id === 99 && message.result));
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
