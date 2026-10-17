import { readerUiLabels, installReaderTextNodes } from './reader-ui-harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = letter => letter.repeat(64);

// Exercise the archive owner in isolation without opening a browser or signing evidence.
class Element {
    constructor(tag, document) {
        this.tagName = tag; this.document = document; this.children = []; this.attributes = {}; this.dataset = {};
        this.listeners = {}; this.className = ''; this._text = ''; this.scrollTop = 0; this.disabled = false;
    }
    get classList() { return { contains: name => this.className.split(' ').includes(name) }; }
    append(...nodes) { for (const node of nodes) { node.remove?.(); node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const node of this.children) node.parent = undefined; this.children = []; this._text = ''; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = undefined; }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    get childNodes() { return this.children; }
    get isConnected() { return this.tagName === 'body' || Boolean(this.parent?.isConnected); }
    set href(value) { this.setAttribute('href', value); }
    get href() { return this.getAttribute('href'); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return name === 'class' ? this.className : this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, action) { (this.listeners[name] ||= []).push(action); }
    async emit(name) { if (this.disabled) return; for (const action of this.listeners[name] || []) await action({ target: this }); }
    click() { this.document.clicked.push(this); }
    focus() { this.document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    scrollIntoView() {}
    matches(selector) {
        const attribute = selector.match(/\[([\w-]+)(?:="([^"]*)")?\]/);
        if (attribute) {
            const name = attribute[1], value = name.startsWith('data-')
                ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : this.getAttribute(name);
            if (value === undefined || value === null || attribute[2] !== undefined && value !== attribute[2]) return false;
        }
        const simple = selector.replace(/\[[^\]]*\]/g, '');
        return simple.startsWith('.') ? simple.slice(1).split('.').every(name => this.classList.contains(name))
            : !simple || this.tagName === simple;
    }
    querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

installReaderTextNodes(Element);

async function harness(language = 'en') {
    const document = { clicked: [], activeElement: null };
    document.createElement = tag => new Element(tag, document); document.body = new Element('body', document);
    const context = { language, project: 'project-a', token: 'token-a', currentPath: 'book/volume-a/01.md' };
    const requests = [], downloads = [], timers = [];
    let respond = () => { throw new Error('Unexpected archive request'); };
    const readerFetch = async (route, options) => {
        const request = { route, options, body: options.body ? JSON.parse(options.body) : undefined }; requests.push(request);
        const result = await respond(request);
        return result?.httpError ? { ok: false, text: async () => result.httpError } : { ok: true, json: async () => result };
    };
    const source = await fs.readFile(path.join(root, 'src/reader/web/reader-archive.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, document, HTMLElement: Element, console, Blob,
        URL: { createObjectURL: blob => { downloads.push(blob); return 'blob:archive'; }, revokeObjectURL() {} },
        setTimeout: action => { timers.push(action); return timers.length; },
        require: name => ({ './reader-ui-labels': readerUiLabels, './reader-route': { readerFetch }, './formal-renderer': { createFormalRenderer: () => ({}), renderFormalMarkdown: () => '' },
            './reader-icons': { readerIcon: icon => { const node = document.createElement('svg'); node.dataset.icon = icon; return node; } } })[name] });
    const reader = new exports.ReaderArchive(() => context);
    return { reader, context, document, requests, downloads, timers, setResponse: action => { respond = action; } };
}

function record(id, kind, files, extra = {}) {
    return { id: hash(id), label: `${kind}-${id}`, kind, files, loggedAt: '2026-10-14T10:00:00Z',
        payload: hash(id), bundle: hash(id.toUpperCase()), identity: { identity: 'author@example.invalid', issuer: 'https://issuer.example.invalid' },
        verification: 'unchecked', contentComplete: true, missing: [], ...extra };
}
function state() {
    const a = record('a', 'volume', { 'book/volume-a/01.md': hash('1') }, { volumeId: 'a' });
    const b = record('b', 'volume', { 'book/volume-b/01.md': hash('2') }, { volumeId: 'b' });
    const outside = { 'book/README.md': hash('3'), 'book/draft/attempt.md': hash('4'), 'book/review/report.md': hash('5') };
    const total = record('c', 'total', { ...a.files, ...b.files, ...outside }, { volumes: [
        { id: 'a', record: a.payload, bundle: a.bundle }, { id: 'b', record: b.payload, bundle: b.bundle }], outside });
    const hidden = record('d', 'snapshot', a.files, { contentComplete: false, missing: [{ path: 'old/source.md', expected: hash('9') }] });
    const legacy = record('e', 'root', a.files, { label: 'Imported original MANIFEST' });
    return { configured: true, policy: { title: 'Example work', signingIdentity: a.identity, scope: { paths: ['book'], extensions: ['.md'] },
        volumes: [{ id: 'a', title: 'Volume A', paths: ['book/volume-a'] }, { id: 'b', title: 'Volume B', paths: ['book/volume-b'] }] },
        head: { record: total.payload, bundle: total.bundle }, records: [total, a, b, legacy], hiddenRecords: [hidden],
        current: { files: 5, coveredByHead: false }, pending: [{ prepared: hash('f'), label: 'Next draft', scheme: 'volume-total', currentMatches: true,
            files: 5, changes: [{ path: 'book/volume-a/01.md', change: 'modified' }], outsideFiles: 3, outside,
            volumes: [{ id: 'a', title: 'Volume A', files: 1, fileMap: a.files, changed: true, reused: false, record: hash('6'), changes: [{ path: 'book/volume-a/01.md', change: 'modified' }] },
                { id: 'b', title: 'Volume B', files: 1, fileMap: b.files, changed: false, reused: true, record: b.payload, bundle: b.bundle, changes: [] }] }], compatibleSources: [] };
}
const action = (h, label) => h.document.body.querySelector(`button[aria-label="${label}"]`);
const timeline = h => h.document.body.querySelector('.archive-timeline');
const flush = () => new Promise(resolve => setImmediate(resolve));
function iconOnly(button) {
    assert.ok(button); assert.equal(button.textContent, ''); assert.equal(button.querySelectorAll('svg').length, 1);
    assert.equal(button.dataset.tooltip, button.getAttribute('aria-label'));
}

async function preparedAndHistoricalViews(language) {
    const h = await harness(language), s = state(); h.setResponse(() => s); await h.reader.open();
    const text = h.document.body.textContent;
    assert.match(text, /Volume A · 1/); assert.match(text, /Volume B · 1/);
    assert.match(text, language === 'zh' ? /需要新签/ : /New signature needed/);
    assert.match(text, language === 'zh' ? /复用原签名/ : /Original signature reused/);
    for (const name of Object.keys(s.pending[0].outside)) assert.ok(text.includes(name), `Outside coverage includes ${name}.`);
    assert.ok(text.includes(s.pending[0].volumes[1].bundle), 'The reused receipt retains its original bundle digest.');
    assert.ok(text.includes(s.pending[0].volumes[1].fileMap['book/volume-b/01.md']), 'The unchanged volume shows its exact frozen files.');
    assert.doesNotMatch(timeline(h).textContent, /snapshot-d|volume-a|volume-b/);
    assert.match(timeline(h).textContent, /Imported original MANIFEST/);
    const sign = action(h, language === 'zh' ? '认证并签署' : 'Authenticate and sign'); iconOnly(sign);
    let signed; h.reader.startJob = async body => { signed = body; }; await sign.emit('click');
    assert.deepEqual(JSON.parse(JSON.stringify(signed)), { action: 'sign', prepared: hash('f'), authFlow: 'normal' });
    s.pending[0].currentMatches = false; h.reader.render();
    const changed = action(h, language === 'zh' ? '准备后正文已变化，请重新准备' : 'Source changed after preparation; prepare again');
    assert.equal(changed.disabled, true); iconOnly(changed);
    s.pending[0].scheme = undefined; s.pending[0].currentMatches = true; h.reader.render();
    const legacy = action(h, language === 'zh' ? '旧单快照待签项请重新准备分卷及总记录；原准备字节保留。'
        : 'Prepare a new volume-and-total record for this older pending snapshot; its original preparation is retained.');
    assert.equal(legacy.disabled, true); iconOnly(legacy);
    signed = undefined; await legacy.emit('click'); assert.equal(signed, undefined);
    s.pending[0].scheme = 'volume-total';
    s.pending[0].volumes[0].signed = true; h.reader.render();
    assert.match(h.document.body.textContent, language === 'zh' ? /新签已完成/ : /New signature completed/);
    const hide = action(h, language === 'zh' ? '从日常列表隐藏；证据保留，可恢复，活动链头不变'
        : 'Hide from the daily list; evidence is recoverable and the active head is preserved');
    iconOnly(hide); assert.equal(hide.disabled, false, 'Visibility does not retire the active head.');
    assert.equal(hide.querySelector('svg').dataset.icon, 'hidden');
    let hidden; h.reader.startJob = async body => { hidden = body; }; await hide.emit('click');
    assert.deepEqual(JSON.parse(JSON.stringify(hidden)), { action: 'hide', record: s.records[0].id });
    const visibility = h.document.body.querySelector(`select[aria-label="${language === 'zh' ? '本机隐藏' : 'Locally hidden'}"]`);
    visibility.value = 'all'; visibility.onchange();
    assert.match(timeline(h).textContent, /snapshot-d/); assert.match(timeline(h).textContent, language === 'zh' ? /原稿有缺口/ : /Source gaps/);
    h.reader.selectRecord(hash('d'));
    let restored; h.reader.startJob = async body => { restored = body; };
    const restore = action(h, language === 'zh' ? '恢复到日常列表；不改写原始证据' : 'Restore to the daily list; original evidence is preserved');
    iconOnly(restore); assert.equal(restore.querySelector('svg').dataset.icon, 'visible'); await restore.emit('click');
    assert.deepEqual(JSON.parse(JSON.stringify(restored)), { action: 'restore', record: hash('d') });
    h.reader.verified.add(hash('d')); s.hiddenRecords[0].verification = 'invalid'; h.reader.render();
    assert.match(timeline(h).textContent, language === 'zh' ? /签名无效/ : /Signature invalid/);
    assert.doesNotMatch(timeline(h).textContent, language === 'zh' ? /签名已核验/ : /Signature verified/);
    h.reader.close();
}

async function volumeBindingAndExports() {
    const h = await harness(), s = state(); h.setResponse(({ route }) => route.startsWith('/api/archive/export')
        ? { workId: 'work', records: route.includes('?record=') ? [s.records[2]] : [...s.records, ...s.hiddenRecords], objects: {} }
        : route.startsWith('/api/archive/compare') ? { changes: [] } : s);
    await h.reader.open(); h.reader.currentOnly = true; h.reader.render();
    const bindings = h.document.body.querySelector('.archive-detail').querySelectorAll('button').filter(node => node.getAttribute('aria-label') === 'View original');
    assert.equal(bindings.length, 2); await bindings[1].emit('click');
    assert.equal(h.reader.currentOnly, false, 'A bound volume is reachable even when it does not contain the current document.');
    assert.equal(h.reader.selected, hash('b')); assert.match(timeline(h).textContent, /volume-b/);
    const volumeExport = action(h, 'Export this volume independently'); iconOnly(volumeExport); await volumeExport.emit('click'); await flush();
    assert.equal(h.requests.at(-1).route, '/api/archive/export?record=' + hash('b'));
    assert.ok(h.document.clicked.at(-1).download.includes(hash('b')));
    await action(h, 'Export evidence').emit('click'); await flush();
    assert.equal(h.requests.at(-1).route, '/api/archive/export');
    assert.equal(JSON.parse(await h.downloads.at(-1).text()).records.length, 5, 'The full export retains locally hidden original evidence.');
    h.reader.selectRecord(hash('d')); await h.reader.compare(s.hiddenRecords[0], 'current', h.document.body.querySelector('.archive-detail'));
    assert.equal(h.requests.at(-1).route, '/api/archive/compare?left=' + hash('d') + '&right=current');
    h.reader.close();
}

async function verificationAndAuthentication() {
    const h = await harness(), s = state(); h.setResponse(() => s); await h.reader.open();
    h.reader.includeHidden = true; h.reader.verified.add(hash('d')); h.reader.render();
    h.setResponse(({ route }) => route === '/api/archive/action' ? { id: 'verify-job' }
        : route.startsWith('/api/archive/job') ? { state: 'failed', action: 'verify', error: 'Hidden original signature is invalid' } : s);
    await h.reader.startJob({ action: 'verify' });
    assert.equal(h.reader.verified.size, 0); assert.match(h.document.body.textContent, /Hidden original signature is invalid/);
    assert.doesNotMatch(timeline(h).textContent, /Signature verified/); assert.match(timeline(h).textContent, /snapshot-d/);
    h.setResponse(({ route }) => route === '/api/archive/action' ? { id: 'verified-job' }
        : route.startsWith('/api/archive/job') ? { state: 'completed', action: 'verify', result: {
            records: s.records.map(row => ({ ...row, verification: 'verified' })), hiddenRecords: s.hiddenRecords.map(row => ({ ...row, verification: 'verified' })) } } : s);
    await h.reader.startJob({ action: 'verify' });
    assert.equal(h.reader.verified.size, 5, h.document.body.textContent); assert.match(timeline(h).textContent, /Signature verified · Source gaps/,
        'A valid historical signature does not erase a source gap.');

    for (const authentication of [undefined, { url: 'https://issuer.example.invalid/auth' }]) {
        let complete, count = 0; const pending = new Promise(resolve => { complete = resolve; });
        h.setResponse(({ route }) => route === '/api/archive/action' ? { id: 'sign-job' }
            : route.startsWith('/api/archive/job') ? ++count === 1 ? { state: 'running', action: 'sign', authentication, progress: { done: 1, total: 2, label: 'Volume A' } } : pending : s);
        const signing = h.reader.startJob({ action: 'sign', prepared: hash('f'), authFlow: 'normal' }); await flush();
        assert.match(h.document.body.textContent, /Signing progress: 1\/2 · Volume A/);
        assert.doesNotMatch(h.document.body.textContent, /undefined|Verification code:/);
        if (authentication) {
            const link = h.document.body.querySelector('.archive-live').querySelector('a'); assert.equal(link.href, authentication.url); link.focus();
            h.reader.renderJobStatus({ action: 'sign', authentication, progress: { done: 2, total: 2 } });
            assert.equal(h.document.body.querySelector('.archive-live').querySelector('a'), link, 'Repeated auth polls preserve the link node.');
            assert.equal(h.document.activeElement, link, 'Progress updates preserve keyboard focus on authentication.');
        }
        else assert.match(h.document.body.textContent, /local callback/);
        assert.equal(action(h, 'Authenticate and sign').disabled, true);
        h.timers.shift()(); await flush(); complete({ state: 'completed', action: 'sign' }); await signing;
    }
    h.setResponse(() => ({ httpError: 'Hidden original payload has changed' })); await h.reader.refresh();
    assert.match(h.document.body.textContent, /Hidden original payload has changed/);
    assert.equal(h.document.body.querySelector('.archive-timeline'), null, 'An integrity error is shown instead of a filtered success list.');
    h.reader.close();
}

async function projectBoundJobContinuation() {
    const h = await harness(), s = state(); h.setResponse(() => s); await h.reader.open();
    let admit;
    const admission = new Promise(resolve => { admit = resolve; });
    h.setResponse(({ route }) => route === '/api/archive/action' ? admission
        : route.startsWith('/api/archive/job') ? { state: 'completed', action: 'sign' } : s);
    const signing = h.reader.startJob({ action: 'sign', prepared: hash('f'), authFlow: 'normal' }); await flush();
    await h.reader.refresh(); assert.equal(action(h, 'Authenticate and sign').disabled, true);
    admit({ id: 'refresh-sign-job' }); await signing;
    assert.ok(h.requests.some(({ route }) => route === '/api/archive/job?id=refresh-sign-job'), 'An admitted operation continues after an intervening refresh.');
    assert.equal(h.reader.jobs.size, 0);

    let admitA;
    const admissionA = new Promise(resolve => { admitA = resolve; });
    h.setResponse(({ route, options }) => route === '/api/archive/action' && options.headers['x-math-workspace-project'] === 'project-a'
        ? admissionA : route === '/api/archive/action' ? { id: 'job-b' }
            : route.startsWith('/api/archive/job') ? { state: 'completed', action: 'sign' } : s);
    const signA = h.reader.startJob({ action: 'sign', prepared: hash('f'), authFlow: 'normal' }); await flush();
    h.context.project = 'project-b'; h.context.token = 'token-b'; h.reader.contextChanged(); await h.reader.open();
    assert.equal(action(h, 'Authenticate and sign').disabled, false, 'Admission in another project does not disable this project.');
    await h.reader.startJob({ action: 'sign', prepared: hash('f'), authFlow: 'normal' });
    admitA({ id: 'job-a' }); await signA;
    assert.equal(h.reader.jobs.get('project-a'), 'job-a'); assert.equal(h.reader.jobs.has('project-b'), false);
    assert.equal(h.requests.filter(({ route }) => route.startsWith('/api/archive/job?id=job-a')).length, 0,
        'An older project operation is not polled with the new project token.');
    h.context.project = 'project-a'; h.context.token = 'token-a'; h.reader.contextChanged(); await h.reader.open(); await flush();
    const requestA = h.requests.find(({ route }) => route === '/api/archive/job?id=job-a');
    assert.equal(requestA.options.headers['x-math-workspace-project'], 'project-a');
    assert.equal(requestA.options.headers['x-math-workspace-token'], 'token-a'); h.reader.close();
}

export async function testReaderArchiveVolumes() {
    for (const language of ['zh', 'en']) await preparedAndHistoricalViews(language);
    await volumeBindingAndExports(); await verificationAndAuthentication(); await projectBoundJobContinuation();
    console.log('Reader archive volume/total coverage, receipt links, hidden-history recovery, exports, strict verification and normal authentication passed.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderArchiveVolumes();
