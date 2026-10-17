import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plain = value => JSON.parse(JSON.stringify(value));
async function loadPreferences(globals = {}, bridge = {}) {
    const source = await fs.readFile(path.join(repoRoot, 'src/reader/web/reader-preferences.ts'), 'utf8');
    const exports = {};
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
    } }).outputText, { exports, require: name => {
        assert.equal(name, './reader-host');
        return { readerHostPreferenceStorage: () => undefined,
            subscribeReaderHostContext: callback => { callback({}); return () => {}; }, ...bridge };
    }, ...globals });
    return exports;
}
function fixture(ReaderPreferences, options = {}) {
    let languages = options.languages || ['en-US'], theme = options.theme || 'light';
    const callbacks = {}, attributes = {}, root = { lang: '', style: {}, setAttribute: (name, value) => { attributes[name] = value; } };
    const listen = name => callback => { callbacks[name] = callback; return () => { delete callbacks[name]; }; };
    const preferences = new ReaderPreferences({ languages: () => languages, systemTheme: () => theme, root,
        onLanguageChange: listen('language'), onSystemThemeChange: listen('theme'), onStorageChange: listen('storage'),
        ...options.environment });
    return { preferences, root, attributes, callbacks,
        language(value) { languages = value; callbacks.language?.(); },
        theme(value) { theme = value; callbacks.theme?.(); } };
}

export async function testReaderPreferences() {
    const { ReaderPreferences, readerPreferences, READER_PREFERENCES_STORAGE_KEY: key } = await loadPreferences();
    assert.deepEqual(plain(readerPreferences.snapshot()), { language: 'en', theme: 'light', languagePreference: 'auto', themePreference: 'auto' }, 'Importing without browser globals must remain safe.');
    const initial = fixture(ReaderPreferences, { languages: ['fr-FR', 'zh-Hant-TW', 'en-US'], theme: 'dark' });
    const { preferences, root, attributes } = initial;
    assert.equal(preferences.snapshot().language, 'zh');
    assert.equal(root.lang, 'zh');
    assert.equal(attributes['data-reader-theme'], 'dark');
    assert.equal(root.style.colorScheme, 'dark');
    const snapshots = [], unsubscribe = preferences.subscribe(value => snapshots.push(plain(value)));
    preferences.updateHostContext({ locale: 'EN-gb', theme: 'light' });
    assert.equal(preferences.snapshot().language, 'en');
    assert.equal(preferences.snapshot().theme, 'light');
    preferences.updateHostContext({ locale: 'zh-CN' });
    assert.equal(preferences.snapshot().theme, 'light', 'Partial host context must preserve the theme.');
    preferences.setLanguage('en'); preferences.setTheme('dark');
    preferences.updateHostContext({ locale: 'zh-Hans', theme: 'light' });
    initial.language(['zh-SG']); initial.theme('light');
    assert.deepEqual(plain(preferences.snapshot()), { language: 'en', theme: 'dark', languagePreference: 'en', themePreference: 'dark' });
    preferences.setLanguage('auto'); preferences.setTheme('auto');
    assert.deepEqual(plain(preferences.snapshot()), { language: 'zh', theme: 'light', languagePreference: 'auto', themePreference: 'auto' }, 'Resetting Auto must use the latest host signals.');
    const count = snapshots.length;
    preferences.updateHostContext({ theme: 'invalid', locale: 42 });
    preferences.updateHostContext(null); preferences.updateHostContext([]); preferences.setTheme('sepia'); preferences.setLanguage('fr');
    assert.equal(snapshots.length, count, 'Malformed inputs must leave valid choices unchanged.');
    const external = preferences.snapshot(); external.language = 'en';
    assert.equal(preferences.snapshot().language, 'zh', 'Snapshots must not expose mutable preference state.');
    unsubscribe(); preferences.setTheme('dark'); assert.equal(snapshots.length, count);
    preferences.dispose(); assert.deepEqual(Object.keys(initial.callbacks), []);

    for (const [languages, expected] of [
        [['zh'], 'zh'], [['zh-Hant-HK'], 'zh'], [['ZH-cn'], 'zh'], [['en-AU'], 'en'],
        [['de', 'fr-FR', 'zh-Hans-CN'], 'zh'], [['de', ''], 'en'], [[], 'en'], [['english', 'zh_CN'], 'en']
    ]) {
        const current = fixture(ReaderPreferences, { languages });
        assert.equal(current.preferences.snapshot().language, expected, `Unexpected locale resolution for ${JSON.stringify(languages)}`);
        current.preferences.dispose();
    }
    const automatic = fixture(ReaderPreferences, { languages: ['en'], theme: 'light' });
    automatic.language(['ja', 'zh-TW']); automatic.theme('dark');
    assert.equal(automatic.preferences.snapshot().language, 'zh'); assert.equal(automatic.preferences.snapshot().theme, 'dark');
    automatic.preferences.updateHostContext({ locale: 'fr-FR' });
    assert.equal(automatic.preferences.snapshot().language, 'zh', 'Unsupported host locales must fall through to supported browser languages.');
    automatic.preferences.setLanguage('en'); automatic.preferences.setTheme('light');
    automatic.language(['zh-HK']); automatic.theme('dark');
    automatic.preferences.setLanguage('auto'); automatic.preferences.setTheme('auto');
    assert.equal(automatic.preferences.snapshot().language, 'zh'); assert.equal(automatic.preferences.snapshot().theme, 'dark');
    automatic.preferences.dispose();

    for (const raw of ['{broken', 'null', '42', '[]', '{"language":"fr","theme":"sepia"}']) {
        const preferences = new ReaderPreferences({ storage: { getItem: () => raw, setItem() {} } });
        assert.equal(preferences.snapshot().languagePreference, 'auto'); assert.equal(preferences.snapshot().themePreference, 'auto');
    }
    let raw = '{"language":"zh","theme":"dark","projectRoot":"must not persist"}';
    const storage = { getItem: name => { assert.equal(name, key); return raw; }, setItem: (name, value) => { assert.equal(name, key); raw = value; } };
    const stored = new ReaderPreferences({ storage });
    assert.equal(stored.snapshot().language, 'zh'); assert.equal(stored.snapshot().theme, 'dark');
    stored.setLanguage('en');
    assert.deepEqual(JSON.parse(raw), { language: 'en', theme: 'dark' }, 'Persistence must contain only local UI preferences.');
    const reloaded = new ReaderPreferences({ storage });
    assert.equal(reloaded.snapshot().languagePreference, 'en'); assert.equal(reloaded.snapshot().themePreference, 'dark');

    const inaccessible = new ReaderPreferences({ storage: { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } } });
    inaccessible.setLanguage('zh'); inaccessible.setTheme('dark');
    assert.equal(inaccessible.snapshot().language, 'zh'); assert.equal(inaccessible.snapshot().theme, 'dark');
    const full = new ReaderPreferences({ storage: { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } } });
    full.setLanguage('zh'); full.setTheme('dark');
    assert.equal(full.snapshot().language, 'zh'); assert.equal(full.snapshot().theme, 'dark', 'A second manual choice must preserve the first when writes are denied.');

    let fallbackValue = null;
    const fallbackStorage = { getItem: () => fallbackValue, setItem: (_name, value) => { fallbackValue = value; } };
    const deniedStorage = { getItem() { throw new Error('opaque'); }, setItem() { throw new Error('opaque'); } };
    const fallback = new ReaderPreferences({ storage: deniedStorage, fallbackStorage });
    fallback.setLanguage('zh'); fallback.setTheme('dark');
    const fallbackReload = new ReaderPreferences({ storage: deniedStorage, fallbackStorage });
    assert.equal(fallbackReload.snapshot().language, 'zh'); assert.equal(fallbackReload.snapshot().theme, 'dark');
    const quotaStorage = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
    fallbackValue = null;
    const quota = new ReaderPreferences({ storage: quotaStorage, fallbackStorage });
    quota.setLanguage('zh'); quota.setTheme('dark');
    const quotaReload = new ReaderPreferences({ storage: quotaStorage, fallbackStorage });
    assert.equal(quotaReload.snapshot().language, 'zh'); assert.equal(quotaReload.snapshot().theme, 'dark');
    const primary = new ReaderPreferences({ storage: { getItem: () => '{"language":"en","theme":"light"}', setItem() {} }, fallbackStorage });
    assert.equal(primary.snapshot().language, 'en'); assert.equal(primary.snapshot().theme, 'light', 'Available browser storage must take precedence over older widget state.');
    const allDenied = new ReaderPreferences({ storage: deniedStorage, fallbackStorage: deniedStorage });
    allDenied.setLanguage('zh'); allDenied.setTheme('dark');
    assert.equal(allDenied.snapshot().language, 'zh'); assert.equal(allDenied.snapshot().theme, 'dark');

    raw = null;
    const views = [fixture(ReaderPreferences, { environment: { storage } }), fixture(ReaderPreferences, { environment: { storage } })];
    views[0].preferences.setLanguage('zh');
    views[1].preferences.setTheme('dark');
    assert.deepEqual(JSON.parse(raw), { language: 'zh', theme: 'dark' }, 'Independent view edits must merge without waiting for storage events.');
    for (const view of views) view.callbacks.storage({ key, newValue: raw, storageArea: storage });
    for (const view of views) assert.deepEqual(plain(view.preferences.snapshot()), { language: 'zh', theme: 'dark', languagePreference: 'zh', themePreference: 'dark' });
    raw = '{"language":"en","theme":"light"}';
    views[0].callbacks.storage({ key: 'unrelated', newValue: raw });
    views[0].callbacks.storage({ key, newValue: raw, storageArea: {} });
    assert.equal(views[0].preferences.snapshot().language, 'zh');
    views[0].callbacks.storage({ key, newValue: raw, storageArea: storage });
    assert.equal(views[0].preferences.snapshot().language, 'en');
    raw = null;
    for (const view of views) { view.callbacks.storage({ key: null, newValue: null, storageArea: storage }); assert.equal(view.preferences.snapshot().languagePreference, 'auto'); view.preferences.dispose(); }

    const listeners = new Map(), mediaListeners = new Set(), media = { matches: true,
        addEventListener: (type, callback) => { assert.equal(type, 'change'); mediaListeners.add(callback); },
        removeEventListener: (_type, callback) => mediaListeners.delete(callback) };
    const browserRoot = { lang: '', style: {}, setAttribute: (name, value) => { attributes[name] = value; } };
    const navigator = { languages: ['de-DE'], language: 'zh-CN' };
    const window = { localStorage: storage, matchMedia: query => { assert.equal(query, '(prefers-color-scheme: dark)'); return media; },
        addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: type => listeners.delete(type) };
    const browser = await loadPreferences({ window, navigator, document: { documentElement: browserRoot } });
    assert.equal(browserRoot.lang, 'zh'); assert.equal(browserRoot.style.colorScheme, 'dark');
    navigator.languages = ['en-GB']; listeners.get('languagechange')();
    media.matches = false; for (const listener of mediaListeners) listener();
    assert.equal(browser.readerPreferences.snapshot().language, 'en'); assert.equal(browser.readerPreferences.snapshot().theme, 'light');
    browser.readerPreferences.dispose(); assert.equal(mediaListeners.size, 0); assert.equal(listeners.size, 0);
    const deniedWindow = { get localStorage() { throw new Error('SecurityError'); } };
    const noStorageBrowser = await loadPreferences({ window: deniedWindow });
    noStorageBrowser.readerPreferences.setLanguage('zh'); assert.equal(noStorageBrowser.readerPreferences.snapshot().language, 'zh');
    const oldMedia = { matches: false, addListener: callback => mediaListeners.add(callback), removeListener: callback => mediaListeners.delete(callback) };
    const oldBrowser = await loadPreferences({ window: { matchMedia: () => oldMedia } });
    oldMedia.matches = true; for (const listener of mediaListeners) listener();
    assert.equal(oldBrowser.readerPreferences.snapshot().theme, 'dark'); oldBrowser.readerPreferences.dispose(); assert.equal(mediaListeners.size, 0);
    console.log('✓ Reader UI preference priority, live events, persistence, fallback, and view synchronization');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderPreferences();
