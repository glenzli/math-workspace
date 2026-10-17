import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
async function fixture({ embedded = true, openai, blockedStorage = false, languages = ['zh-CN'], dark = false } = {}) {
    const listeners = new Map(), timers = new Set(), sent = [], persisted = [], root = { lang: '', style: {}, attributes: {},
        hasAttribute: name => name === 'data-math-workspace-app' && embedded,
        setAttribute(name, value) { this.attributes[name] = value; }, classList: { add() {} } };
    const addEventListener = (name, callback) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
    };
    const removeEventListener = (name, callback) => listeners.get(name)?.delete(callback);
    const parent = { postMessage: (message, origin) => sent.push({ ...message, targetOrigin: origin }) };
    const window = { addEventListener, removeEventListener, matchMedia: () => ({ matches: dark }),
        openai: openai === null ? undefined : { widgetState: { projectRoot: '/project', pagePath: 'book/saved.md', scrollTop: 345 },
            setWidgetState: state => persisted.push(plain(state)), ...openai } };
    if (blockedStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
    else {
        let stored = null;
        window.localStorage = { getItem: () => stored, setItem: (_name, value) => { stored = value; } };
    }
    const context = vm.createContext({ window, document: { documentElement: root }, navigator: { languages, language: languages[0] },
        parent, addEventListener, removeEventListener, crypto: webcrypto, URLSearchParams, console,
        Headers, Response, Uint8Array, atob, MessageEvent,
        setTimeout: (callback, delay) => { const timer = setTimeout(callback, delay); timers.add(timer); return timer; },
        clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); } });
    const modules = {};
    // CommonJS modules have separate lexical scopes, as in the actual bundle.
    const wrappedLoad = async name => {
        const source = await fs.readFile(path.join(repoRoot, `src/reader/web/${name}.ts`), 'utf8');
        const exports = {};
        const compiled = ts.transpileModule(source, { compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
        } }).outputText;
        const execute = vm.runInContext(`(function(exports, require) { ${compiled}\n})`, context);
        execute(exports, required => { assert.equal(required, './reader-host'); return modules['reader-host']; });
        modules[name] = exports;
        return exports;
    };
    const host = await wrappedLoad('reader-host'), preferencesModule = await wrappedLoad('reader-preferences');
    const dispatch = (name, event) => { for (const listener of listeners.get(name) || []) listener(event); };
    const receive = (data, source = parent, origin = 'https://codex.example') => dispatch('message', { data, source, origin });
    const reply = (message, result, source = parent, origin = 'https://codex.example') => receive({ jsonrpc: '2.0', id: message.id, result }, source, origin);
    const contextPatch = (patch, source = parent, origin = 'https://codex.example') => receive({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: patch }, source, origin);
    const calls = name => sent.filter(message => message.params?.name === name);
    return { host, preferences: preferencesModule.readerPreferences, root, sent, persisted, parent, window, receive, reply, contextPatch, calls,
        legacy: globals => dispatch('openai:set_globals', { detail: { globals } }),
        async initialize(hostContext = {}, projectRoot = '/project') {
            const initializing = host.initializeReaderHost();
            receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { reader: { projectRoot } } } });
            reply(sent.find(message => message.method === 'ui/initialize'), { hostCapabilities: {}, hostContext });
            await flush();
            reply(calls('reader_view').at(-1), { structuredContent: { ready: true } });
            await initializing;
        },
        async dispose() {
            preferencesModule.readerPreferences.dispose();
            if (embedded && sent.some(message => message.method === 'ui/initialize')) {
                receive({ jsonrpc: '2.0', id: 900, method: 'ui/resource-teardown' });
                const close = calls('close_reader_view').at(-1);
                if (close) reply(close, { structuredContent: { closed: true } });
                await flush();
            }
            for (const timer of timers) clearTimeout(timer);
        } };
}

export async function testReaderHostPreferences() {
    const h = await fixture({ openai: { locale: 'en-US', theme: 'dark' } });
    try {
        assert.equal(h.preferences.snapshot().language, 'en'); assert.equal(h.root.style.colorScheme, 'dark', 'Legacy host context must be available before asynchronous startup.');
        const notifications = [];
        const unsubscribe = h.host.subscribeReaderHostContext(value => notifications.push(plain(value)));
        assert.deepEqual(notifications[0], { locale: 'en-US', theme: 'dark' }, 'Late subscribers must immediately receive current host context.');
        h.contextPatch({ locale: 'zh-TW', theme: 'light' });
        assert.equal(h.preferences.snapshot().language, 'en', 'Context notifications must wait for the initialization response to pin the parent origin.');
        const initializing = h.host.initializeReaderHost();
        const initialize = h.sent.find(message => message.method === 'ui/initialize');
        h.reply(initialize, { hostCapabilities: {}, hostContext: { locale: 'zh-CN', theme: 'light' } }, {});
        await flush(); assert.equal(h.calls('reader_view').length, 0, 'A sibling window must not complete the handshake.');
        h.receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { reader: { projectRoot: '/project' } } } });
        h.reply(initialize, { hostCapabilities: {}, hostContext: { locale: 'zh-CN', theme: 'light' } });
        h.contextPatch({ theme: 'dark' });
        await flush(); h.reply(h.calls('reader_view').at(-1), { structuredContent: { ready: true } }); await initializing;
        assert.deepEqual(plain(h.preferences.snapshot()), { language: 'zh', theme: 'dark', languagePreference: 'auto', themePreference: 'auto' }, 'A partial notification immediately after the initialize reply must win over that reply.');
        assert.equal(h.sent.find(message => message.method === 'ui/notifications/initialized').targetOrigin, 'https://codex.example');
        h.contextPatch({ locale: 'en', theme: 'light' }, {});
        h.contextPatch({ locale: 'en', theme: 'light' }, h.parent, 'https://unrelated.example');
        h.receive({ jsonrpc: '1.0', method: 'ui/notifications/host-context-changed', params: { locale: 'en', theme: 'light' } });
        assert.equal(h.preferences.snapshot().language, 'zh'); assert.equal(h.preferences.snapshot().theme, 'dark');
        h.contextPatch({ locale: 'en-GB' });
        assert.equal(h.preferences.snapshot().language, 'en'); assert.equal(h.preferences.snapshot().theme, 'dark');
        h.legacy({ locale: 'zh-Hant', theme: 'light' });
        assert.equal(h.preferences.snapshot().language, 'en'); assert.equal(h.preferences.snapshot().theme, 'dark', 'Standard fields must take precedence over later legacy globals.');
        h.contextPatch(null); h.contextPatch([]); h.contextPatch({ locale: false, theme: 'sepia' });
        assert.equal(h.preferences.snapshot().language, 'en'); assert.equal(h.preferences.snapshot().theme, 'dark');
        h.preferences.setLanguage('zh'); h.preferences.setTheme('light');
        h.contextPatch({ locale: 'en-AU', theme: 'dark' });
        assert.equal(h.preferences.snapshot().language, 'zh'); assert.equal(h.preferences.snapshot().theme, 'light');
        h.preferences.setLanguage('auto'); h.preferences.setTheme('auto');
        assert.equal(h.preferences.snapshot().language, 'en'); assert.equal(h.preferences.snapshot().theme, 'dark');
        const late = []; h.host.subscribeReaderHostContext(value => late.push(plain(value)))();
        assert.deepEqual(late[0], { locale: 'en-AU', theme: 'dark' });
        unsubscribe();
        h.receive({ jsonrpc: '2.0', id: 901, method: 'ui/resource-teardown' });
        h.reply(h.calls('close_reader_view').at(-1), { structuredContent: { closed: true } }); await flush();
        h.contextPatch({ locale: 'zh', theme: 'light' }); h.legacy({ locale: 'zh', theme: 'light' });
        assert.equal(h.preferences.snapshot().language, 'en'); assert.equal(h.preferences.snapshot().theme, 'dark', 'Teardown must stop host appearance updates.');
        assert.equal(h.sent.some(message => ['ui/message', 'ui/update-model-context'].includes(message.method)), false, 'Preferences must not add conversation context.');
    } finally { await h.dispose(); }

    const partial = await fixture({ openai: { locale: 'en', theme: 'light' } });
    try {
        await partial.initialize({ theme: 'dark' });
        partial.legacy({ locale: 'zh-TW', theme: 'light' });
        assert.equal(partial.preferences.snapshot().language, 'zh'); assert.equal(partial.preferences.snapshot().theme, 'dark');
        partial.contextPatch({ locale: 'en-US' });
        partial.legacy({ locale: 'zh-CN' });
        assert.equal(partial.preferences.snapshot().language, 'en', 'Standard and legacy precedence must be independent per field.');
        partial.contextPatch({ locale: 'fr-FR' });
        assert.equal(partial.preferences.snapshot().language, 'zh', 'Unsupported standard locales fall through browser languages rather than reviving a stale legacy locale.');
    } finally { await partial.dispose(); }

    const standalone = await fixture({ embedded: false, openai: { locale: 'en', theme: 'dark' } });
    try {
        await standalone.host.initializeReaderHost();
        standalone.legacy({ locale: 'en', theme: 'dark' });
        assert.equal(standalone.preferences.snapshot().language, 'zh'); assert.equal(standalone.preferences.snapshot().theme, 'light');
        assert.equal(standalone.host.readerHostPreferenceStorage(), undefined);
        assert.equal(standalone.sent.length, 0, 'Standalone readers must not communicate with a phantom host.');
    } finally { await standalone.dispose(); }

    let resumedWidgetState;
    const fallback = await fixture({ blockedStorage: true, openai: { widgetState: {
        projectRoot: '/project', pagePath: 'book/saved.md', scrollTop: 345, uiPreferences: '{"language":"zh","theme":"dark"}'
    } } });
    try {
        assert.equal(fallback.preferences.snapshot().languagePreference, 'zh'); assert.equal(fallback.preferences.snapshot().themePreference, 'dark');
        fallback.preferences.setLanguage('en');
        assert.deepEqual(fallback.persisted.at(-1), { projectRoot: '/project', pagePath: 'book/saved.md', scrollTop: 345,
            uiPreferences: '{"language":"en","theme":"dark"}' }, 'Host persistence must preserve the saved manuscript location.');
        await fallback.initialize({ locale: 'zh', theme: 'light' });
        assert.equal(fallback.host.readerSearch(), '?path=book%2Fsaved.md&readerScroll=345');
        fallback.preferences.setTheme('light');
        assert.equal(JSON.parse(fallback.persisted.at(-1).uiPreferences).language, 'en', 'Initialization must preserve the local UI preference field.');
        fallback.host.persistReaderState({ pagePath: 'book/new.md', scrollTop: 678 });
        assert.equal(fallback.persisted.at(-1).projectRoot, '/project');
        assert.equal(fallback.persisted.at(-1).pagePath, 'book/new.md');
        assert.deepEqual(JSON.parse(fallback.persisted.at(-1).uiPreferences), { language: 'en', theme: 'light' });
        fallback.host.persistReaderState({ projectRoot: '/different-project', pagePath: 'book/start.md' });
        fallback.preferences.setTheme('dark');
        assert.equal(fallback.persisted.at(-1).projectRoot, '/different-project');
        assert.equal(fallback.persisted.at(-1).pagePath, 'book/start.md');
        resumedWidgetState = fallback.persisted.at(-1);
    } finally { await fallback.dispose(); }
    const resumed = await fixture({ blockedStorage: true, openai: { widgetState: resumedWidgetState } });
    try {
        assert.equal(resumed.preferences.snapshot().languagePreference, 'en'); assert.equal(resumed.preferences.snapshot().themePreference, 'dark', 'A recreated opaque-origin panel must restore manual choices from widget state.');
        await resumed.initialize({ locale: 'zh', theme: 'light' }, '/new-launch-project');
        resumed.preferences.setTheme('light');
        assert.equal(resumed.persisted.at(-1).projectRoot, '/new-launch-project');
        assert.equal(JSON.parse(resumed.persisted.at(-1).uiPreferences).language, 'en', 'Starting a different project must preserve local UI choices.');
    } finally { await resumed.dispose(); }

    const noPersistence = await fixture({ blockedStorage: true, openai: null });
    try {
        noPersistence.preferences.setLanguage('en'); noPersistence.preferences.setTheme('dark');
        assert.equal(noPersistence.preferences.snapshot().language, 'en'); assert.equal(noPersistence.preferences.snapshot().theme, 'dark');
    } finally { await noPersistence.dispose(); }
    console.log('✓ Reader host initialization, trusted context patches, legacy precedence, and widget-state persistence');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderHostPreferences();
