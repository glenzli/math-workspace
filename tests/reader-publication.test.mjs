import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => value.repeat(64);
const tools = { pandoc: { available: true }, engine: { available: true }, engineName: 'xelatex' };
const page = (path, title, volume = 'First volume') => ({ path, title, kind: 'chapter', book: 'book', bookTitle: 'One work', volume: 'vol-1', volumeTitle: volume });
const pages = [page('book/01.md', 'First chapter'), page('book/02.md', 'Second chapter'), page('book/03.md', 'Later chapter', 'Later volume')];
const profile = () => ({ id: 'edition', workId: 'one-work', title: 'A <careful> book', version: '1.0', authors: [{ name: 'Author' }],
    language: 'en', license: 'CC-BY-4.0', description: 'The work description.', chapters: [pages[0].path, pages[1].path],
    frontMatter: [{ title: 'Preface', content: 'Why this book.' }], backMatter: [{ title: 'Conclusion', content: 'More follows.' }],
    continued: { enabled: true }, zenodo: { environment: 'sandbox' } });
const plan = (value = profile()) => ({ profile: value, fingerprint: hash('f'), selected: pages.filter(page => value.chapters.includes(page.path)),
    omitted: pages.filter(page => !value.chapters.includes(page.path)), externalReferences: [{ source: pages[0].path, line: 5, target: '@later', label: 'Later chapter' }],
    partial: true, continuedNotice: { enabled: true, title: 'To be continued', text: 'More chapters will follow.' },
    doi: { versionDoi: '10.5072/zenodo.123', source: 'zenodo', state: 'reserved' }, tools, warnings: [], inputs: [] });
const edition = () => ({ id: hash('b'), profileId: 'edition', workId: 'one-work', version: '1.0', fingerprint: hash('f'),
    createdAt: '2026-10-15T00:00:00Z', pdfSha256: hash('a'), files: { pdf: 'publication.pdf', manifest: 'manifest.json', citation: 'citation.json' } });
const remote = () => ({ status: 'draft', revision: 4, draftId: '123', environment: 'sandbox', versionDoi: '10.5072/zenodo.123', conceptDoi: '10.5072/zenodo.100',
    upload: { buildId: hash('b'), pdfSha256: hash('a') } });
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(value), text: async () => String(value), blob: async () => new Blob(['%PDF fixture']) });
const drain = async () => { for (let index = 0; index < 20; index++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

class Element {
    constructor(tag, document) { this.tagName = tag; this.document = document; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {};
        this.className = ''; this._text = ''; this.value = ''; this.disabled = false; this.checked = false; }
    get classList() { return { contains: name => this.className.split(' ').includes(name), toggle: (name, active) => {
        const names = new Set(this.className.split(' ').filter(Boolean)); active ? names.add(name) : names.delete(name); this.className = [...names].join(' ');
    } }; }
    append(...nodes) { for (const child of nodes) { child.remove?.(); child.parent = this; this.children.push(child); } }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parent = undefined; }); this.children = []; this._text = ''; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    get isConnected() { return this.tagName === 'body' || !!this.parent?.isConnected; }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'disabled') this.disabled = true; }
    getAttribute(name) { if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] ?? null; return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    async emit(type) { if (this.disabled) return; for (const listener of this.listeners[type] || []) await listener({ target: this, preventDefault() {} }); }
    click() { if (this.tagName === 'a') this.document.downloads.push(this); else void this.emit('click'); }
    focus() { this.document.activeElement = this; }
    showModal() { this.open = true; } close() { this.open = false; } scrollIntoView() {}
    matches(selector) {
        const attribute = selector.match(/\[([\w-]+)(?:="([^"]*)")?\]/);
        if (attribute) { const value = this.getAttribute(attribute[1]); if (value === null || attribute[2] !== undefined && value !== attribute[2]) return false; }
        const simple = selector.replace(/\[[^\]]*\]/g, '');
        return simple.startsWith('.') ? simple.slice(1).split('.').every(name => this.classList.contains(name)) : !simple || this.tagName === simple;
    }
    querySelectorAll(selector) { const alternatives = selector.split(',').map(value => value.trim()); return this.children.flatMap(child => [...(alternatives.some(selector => child.matches(selector)) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

async function harness(language = 'en') {
    const document = { downloads: [], activeElement: null, createElement(tag) { return new Element(tag, this); } }; document.body = document.createElement('body'); document.activeElement = document.body;
    const context = { language, project: 'project-a', token: 'token-a' }, requests = [], revoked = [], timers = new Map(), previews = []; let sequence = 0, override;
    const model = { pages: structuredClone(pages), warnings: [], profiles: [{ profile: profile(), revision: 1, updatedAt: '' }], builds: [edition()], remote: remote(), job: undefined,
        uploadPlan: { profileId: 'edition', buildId: hash('b'), draftId: '123', remoteRevision: 4, pdfSha256: hash('a'), fingerprint: hash('c'),
            files: [{ name: 'notes.txt', checksum: 'md5:retained', owned: false }], add: ['publication.pdf'], replace: [], remove: [], blocked: ['notes.txt'] } };
    const currentPlan = (value = profile()) => ({ ...plan(value), selected: model.pages.filter(page => value.chapters.includes(page.path)),
        omitted: model.pages.filter(page => !value.chapters.includes(page.path)), warnings: model.warnings });
    const request = async (route, options) => {
        const value = { route, options, body: options.body ? JSON.parse(options.body) : undefined }; requests.push(value);
        assert.equal(options.headers['x-math-workspace-token'], context.token); assert.equal(options.headers['x-math-workspace-project'], context.project);
        if (override) { const result = override(value); if (result) return result; }
        if (route === '/api/publication') return response({ pages: model.pages, profiles: model.profiles, defaultProfile: profile(), language, tools,
            credentialStatus: [{ profileId: 'edition', environment: 'sandbox', tokenEnv: 'TEST_TOKEN', configured: true }], job: model.job });
        if (route.startsWith('/api/publication/status')) return response({ profile: model.profiles[0], builds: model.builds, remote: model.remote, credential: { configured: true } });
        if (route.includes('/artifact?')) return response({ buildId: hash('b'), plan: currentPlan(), layout: [] });
        if (route === '/api/publication/action') {
            let result;
            if (value.body.action === 'save') { result = { profile: value.body.profile, revision: model.profiles[0].revision + 1, updatedAt: '' }; model.profiles[0] = result; }
            else if (value.body.action === 'review') result = currentPlan(value.body.profile);
            else if (value.body.action === 'build') result = edition();
            else if (value.body.action === 'review-upload') result = model.uploadPlan;
            else result = model.remote;
            return response({ id: 'job-' + (++sequence), action: value.body.action, state: 'completed', phase: 'done', result });
        }
        if (route.startsWith('/api/publication/job')) return response(model.job);
        throw new Error('Unexpected publication route ' + route);
    };
    const source = await fs.readFile(path.join(root, 'src/reader/web/reader-publication.ts'), 'utf8'), exports = {};
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
        { exports, document, HTMLElement: Element, HTMLInputElement: Element, AbortController, Blob, console,
            URL: { createObjectURL: () => 'blob:publication-' + (++sequence), revokeObjectURL: value => revoked.push(value) },
            setTimeout: run => { const id = ++sequence; timers.set(id, run); return id; }, clearTimeout: id => timers.delete(id),
            require: name => ({ './reader-route': { readerFetch: request }, './reader-publication-pdf': { ReaderPublicationPdf: class {
                constructor(parent, host) { this.host = host; this.canvas = document.createElement('canvas'); parent.append(this.canvas); this.abort = new AbortController(); previews.push(this); }
                async open(load) { this.blob = await load(this.abort.signal); if (!this.abort.signal.aborted) this.canvas.dataset.rendered = 'true'; }
                destroy() { this.abort.abort(); this.canvas.remove(); }
            } }, './reader-icons': { readerIcon: glyph => {
                const value = document.createElement('svg'); value.dataset.icon = glyph; return value;
            } } })[name] });
    return { reader: new exports.ReaderPublication(() => context), context, document, requests, model, revoked, timers, previews, override: action => { override = action; } };
}
const action = (h, label) => { const value = h.document.body.querySelectorAll('button').find(button => button.getAttribute('aria-label') === label); assert.ok(value, 'Missing action: ' + label); return value; };
const step = async (h, index) => { const nav = h.document.body.querySelector('.publication-steps'); await nav.children[index].emit('click'); await drain(); };
const check = async (h, attribute) => { const control = h.document.body.querySelector('[' + attribute + ']'); assert.ok(control); control.checked = true; await control.emit('change'); await drain(); };

async function testPublicationUi() {
    for (const language of ['zh', 'en']) {
        const h = await harness(language), number = language === 'zh' ? '第1章' : 'Chapter 1', title = language === 'zh' ? '第 1 章 空间与距离' : 'Chapter 1 Space and distance';
        h.model.pages[0] = { ...h.model.pages[0], number, title };
        h.model.pages[1] = { ...h.model.pages[1], number: language === 'zh' ? '第2章' : 'Chapter 2', title: 'Plain unprefixed title' };
        h.model.pages[2] = { ...h.model.pages[2], number: language === 'zh' ? '第3章' : 'Chapter 3', title: language === 'zh' ? '第3章 后续问题' : 'Chapter 3 Further questions' };
        h.model.warnings = ['1 reference(s) point outside this edition; omitted pages are not added automatically.', 'Preserve this unknown warning.'];
        await h.reader.open();
        const rows = h.document.body.querySelectorAll('.publication-chapter');
        assert.equal(rows[0].querySelector('label').textContent, title, 'The catalog does not repeat a number already in the title, including normalized Chinese spacing.');
        assert.equal(rows[1].querySelector('label').textContent, `${h.model.pages[1].number} · Plain unprefixed title`, 'Plain titles retain their number fallback.');
        await step(h, 2); await action(h, language === 'zh' ? '保存并审阅本版' : 'Save and review this edition').emit('click'); await drain();
        const reviewRows = h.document.body.querySelector('.publication-review-grid').querySelectorAll('li');
        assert.ok(reviewRows[0].textContent.startsWith(`One work · First volume · ${title}`));
        assert.ok(reviewRows[2].textContent.startsWith(`One work · Later volume · ${h.model.pages[2].title}`), 'Omitted chapter titles use the same display rule.');
        assert.doesNotMatch(h.document.body.textContent, /1 reference\(s\) point outside this edition/);
        assert.match(h.document.body.textContent, language === 'zh' ? /这些引用不会自动把其他章节加入本版/ : /These references do not add other chapters automatically/);
        assert.match(h.document.body.textContent, /Preserve this unknown warning\./);
        await step(h, 3);
        const frozenRows = h.document.body.querySelector('ol').children;
        assert.equal(frozenRows[0].textContent, `${title} · book/01.md`);
        assert.equal(frozenRows[1].textContent, `${h.model.pages[1].number} · Plain unprefixed title · book/02.md`);
        h.reader.close();
    }
    for (const language of ['en', 'zh']) {
        const h = await harness(language); await h.reader.open();
        assert.match(h.document.body.textContent, /One work/); assert.match(h.document.body.textContent, /First volume/);
        const first = h.document.body.querySelectorAll('input').find(input => input.parent?.textContent.includes('First chapter'));
        first.checked = false; await first.emit('change');
        await step(h, 2); await action(h, language === 'en' ? 'Save and review this edition' : '保存并审阅本版').emit('click'); await drain();
        const saved = h.requests.find(request => request.body?.action === 'save');
        assert.deepEqual(saved.body.profile.chapters, ['book/02.md'], 'The request uses only the exact checked chapters.');
        assert.match(h.document.body.textContent, /book\/01.md/); assert.match(h.document.body.textContent, /book\/03.md/);
        assert.match(h.document.body.textContent, /Later chapter/);
        const build = action(h, language === 'en' ? 'Build this edition’s PDF' : '生成本版 PDF'); assert.equal(build.disabled, true);
        await check(h, 'data-scope-confirm'); assert.equal(build.disabled, false); await build.emit('click'); await drain();
        assert.equal(h.requests.filter(request => request.body?.action === 'build').length, 1);
        const preview = action(h, language === 'en' ? 'Preview PDF' : '预览 PDF'); assert.equal(preview.textContent, ''); await preview.emit('click'); await drain();
        assert.equal(h.document.body.querySelector('canvas').dataset.rendered, 'true'); assert.equal(h.document.body.querySelector('iframe'), null);
        await action(h, language === 'en' ? 'Download PDF' : '下载 PDF').emit('click'); await drain();
        assert.equal(h.document.downloads.length, 1, 'Canvas preview preserves the existing download action.');
        const publication = action(h, language === 'en' ? 'Publish this edition publicly' : '公开发布这一版'); assert.equal(publication.disabled, true);
        await publication.emit('click'); assert.equal(h.requests.filter(request => request.body?.action === 'publish').length, 0);
        await check(h, 'data-publish-confirm'); await publication.emit('click'); await drain();
        const submitted = h.requests.find(request => request.body?.action === 'publish');
        assert.equal(submitted.body.confirmedPublication, true); assert.equal(submitted.body.recordId, '123'); assert.equal(submitted.body.pdfSha256, hash('a'));
        assert.ok(h.requests.some(request => request.route.includes('file=manifest.json')), 'Public metadata comes from the frozen manifest.');
        h.reader.close(); assert.ok(h.revoked.length > 0); assert.equal(h.document.body.querySelector('canvas'), null);
        assert.equal(h.previews[0].abort.signal.aborted, true, 'Closing the publication dialog disposes its preview.');
    }
    const h = await harness(); h.model.remote = { ...remote(), status: 'published', recordId: '123', history: [{ recordId: '99', versionDoi: '10.5072/zenodo.99' }] };
    await h.reader.open(); await step(h, 3);
    assert.match(h.document.body.textContent, /old edition is retained/); assert.match(h.document.body.textContent, /10.5072\/zenodo.99/);
    const next = action(h, 'Create a new version of this work'); assert.equal(next.disabled, true);
    await check(h, 'data-new-version-confirm'); await next.emit('click'); await drain();
    const reserve = h.requests.find(request => request.body?.action === 'reserve-doi'); assert.equal(reserve.body.mode, 'new-version'); assert.equal(reserve.body.expectedRecordId, '123');
    assert.equal(reserve.body.confirmedNewVersion, true); h.reader.close();

    const upload = await harness(); upload.model.remote.upload = undefined;
    await upload.reader.open(); await step(upload, 3); await action(upload, 'Review files before upload').emit('click'); await drain();
    assert.match(upload.document.body.textContent, /notes\.txt/); assert.match(upload.document.body.textContent, /No files will be uploaded or deleted/);
    assert.equal(action(upload, 'Upload the listed file changes').disabled, true);
    assert.equal(upload.requests.some(request => request.body?.action === 'upload'), false);
    upload.model.uploadPlan.files = []; upload.model.uploadPlan.blocked = []; upload.model.uploadPlan.remove = ['old-edition.pdf'];
    await action(upload, 'Review files before upload').emit('click'); await drain();
    assert.match(upload.document.body.textContent, /old-edition\.pdf/);
    await action(upload, 'Upload the listed file changes').emit('click'); await drain();
    assert.equal(upload.requests.find(request => request.body?.action === 'upload').body.uploadFingerprint, hash('c'));
    upload.reader.close();

    const optional = await harness(); optional.model.profiles[0].profile.language = 'zh-CN'; optional.model.profiles[0].profile.frontMatter = []; optional.model.profiles[0].profile.backMatter = [];
    await optional.reader.open(); await step(optional, 1);
    const language = optional.document.body.querySelectorAll('select').find(control => control.getAttribute('aria-label') === 'Publication language');
    assert.equal(language.value, 'zh', 'Standard saved language tags retain a visible language choice.');
    await action(optional, 'Save publication plan').emit('click'); await drain();
    const optionalSaved = optional.requests.find(request => request.body?.action === 'save').body.profile;
    assert.equal(optionalSaved.language, 'zh-CN'); assert.deepEqual(optionalSaved.frontMatter, []); assert.deepEqual(optionalSaved.backMatter, [], 'Viewing layout does not add optional matter.');
    const identity = optional.document.body.querySelectorAll('input').find(control => control.getAttribute('aria-label') === 'Plan name');
    identity.value = 'new-edition'; await identity.emit('input'); await step(optional, 3);
    assert.equal(optional.document.body.querySelectorAll('button').some(button => button.getAttribute('aria-label') === 'Preview PDF'), false, 'Renaming a plan cannot display the old plan’s PDF.');
    optional.reader.close();

    const late = await harness(), gate = deferred(); late.override(request => request.route === '/api/publication' ? gate.promise : undefined);
    const pending = late.reader.open(); late.context.project = 'project-b'; late.context.token = 'token-b'; late.reader.contextChanged();
    gate.resolve(response({ pages, profiles: [], defaultProfile: profile(), tools, credentialStatus: [] })); await pending;
    assert.equal(late.document.body.querySelector('dialog'), null, 'A late project A response cannot reopen or populate project B.');

    const savedLate = await harness(), saveGate = deferred(); await savedLate.reader.open(); await step(savedLate, 1);
    savedLate.override(request => request.body?.action === 'save' ? saveGate.promise : undefined);
    await action(savedLate, 'Save publication plan').emit('click'); await drain(); savedLate.reader.close();
    const record = { profile: profile(), revision: 2, updatedAt: '' }, completed = { id: 'completed-save', action: 'save', state: 'completed', phase: 'done', result: record };
    savedLate.model.profiles[0] = record; savedLate.model.job = completed; saveGate.resolve(response(completed)); await drain(); savedLate.override(undefined);
    await savedLate.reader.open(); assert.equal(savedLate.requests.filter(request => request.body?.action === 'save').length, 1, 'A completed save resumes without repeating POST.');
    await step(savedLate, 1); await action(savedLate, 'Save publication plan').emit('click'); await drain();
    assert.equal(savedLate.requests.filter(request => request.body?.action === 'save')[1].body.expectedRevision, 2, 'A closed dialog resumes the saved revision instead of writing with a stale revision.');
    savedLate.reader.close();

    const resumed = await harness(); resumed.model.job = { id: 'persisted-job', action: 'build', state: 'running', phase: 'typesetting' };
    const reopening = resumed.reader.open(); await drain(); // Close before a delayed completion.
    resumed.reader.close(); await reopening;
    assert.equal(resumed.requests.filter(request => request.body).length, 0, 'Reopening never retries a mutating POST.');
}

const backendFixture = `
const state = globalThis.__publicationReaderFixture = { calls: [], releases: new Map(), jobs: [] };
export class PublicationService {
 constructor(root) { this.root = root; }
 inspect() { return Promise.resolve({ pages: [], profiles: [], tools: {}, credentialStatus: [] }); }
 save(profile, revision) { state.calls.push({ action: 'save', root: this.root, profile }); return Promise.resolve({ profile, revision: (revision || 0) + 1 }); }
 plan(profile) { state.calls.push({ action: 'review', root: this.root, profile }); return Promise.resolve({ fingerprint: 'f', selected: profile.chapters }); }
 build(profile, fingerprint, options) { state.calls.push({ action: 'build', root: this.root, profile, fingerprint }); options.onProgress('PDF pages'); return new Promise(resolve => state.releases.set(this.root, () => resolve({ id: 'build-a', profileId: profile.id, pdfSha256: 'pdf-sha' }))); }
 status(id) { return Promise.resolve({ id, root: this.root }); }
 reserveDoi(id, revision, options) { state.calls.push({ action: 'reserve-doi', root: this.root, id, options }); return Promise.resolve({ status: 'draft', draftId: '123' }); }
 attachZenodo(id, revision, options) { return Promise.resolve({ status: options.kind, recordId: options.id }); }
 reviewUpload(id, buildId, review) { return Promise.resolve({ profileId: id, buildId, fingerprint: 'files-fingerprint', files: [], add: ['publication.pdf'], replace: [], remove: [], blocked: [] }); }
 upload(id, buildId, review) { state.calls.push({ action: 'upload', root: this.root, id, buildId, review }); return Promise.resolve({ status: 'draft' }); }
 publish(id, buildId, review) { state.calls.push({ action: 'publish', root: this.root, id, buildId, review }); return Promise.resolve({ status: 'published' }); }
 readArtifact(profileId, buildId, artifact) { state.calls.push({ action: 'artifact', root: this.root, profileId, buildId, artifact }); if (profileId !== 'edition' || buildId !== 'build-a') throw new Error('Unknown frozen edition'); return Promise.resolve({ bytes: Buffer.from('%PDF fixed fixture'), contentType: 'application/pdf', fileName: artifact }); }
}`;

async function testPublicationHttp() {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'math-publication-reader-'))); let server;
    try {
        const roots = [path.join(temporary, 'a'), path.join(temporary, 'b')];
        for (const project of roots) { await fs.mkdir(path.join(project, '.math-workspace'), { recursive: true }); await fs.writeFile(path.join(project, '.math-workspace/config.json'), '{}'); await fs.writeFile(path.join(project, 'chapter.md'), '# Chapter\n\nA chapter.\n'); }
        const staticRoot = path.join(temporary, 'static'); await fs.mkdir(staticRoot); await fs.writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>Reader</title>');
        const bundle = path.join(temporary, 'server.cjs');
        await build({ entryPoints: [path.join(root, 'src/reader/server.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', tsconfig: path.join(root, 'tsconfig.cli.json'),
            plugins: [{ name: 'publication-fixture', setup(build) {
                build.onResolve({ filter: /^\.\/index$/ }, args => args.importer.endsWith('/publication/reader-api.ts') ? { path: 'publication-fixture', namespace: 'fixture' } : undefined);
                build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: backendFixture, loader: 'js' }));
            } }] });
        const { startReaderServer } = require(bundle);
        server = await startReaderServer({ rootPath: roots[0], staticRoot, port: 0, recentProjectsPath: path.join(temporary, 'recent.json'), locationRegistryPath: path.join(temporary, 'locations.json'), chooseProjectDirectory: async () => roots[1] });
        const initial = await (await fetch(server.url + '/api/state')).json();
        const headers = { 'content-type': 'application/json', 'x-math-workspace-token': initial.requestToken, 'x-math-workspace-project': initial.projectId };
        for (const route of ['/api/publication', '/api/publication/job?id=no-job', '/api/publication/status?profile=edition', '/api/publication/artifact?profile=edition&build=build-a&file=publication.pdf']) {
            assert.equal((await fetch(server.url + route)).status, 403);
            assert.equal((await fetch(server.url + route, { headers: { ...headers, 'x-math-workspace-project': 'wrong' } })).status, 409);
        }
        assert.equal((await fetch(server.url + '/api/publication', { headers: { ...headers, origin: 'https://outside.invalid' } })).status, 403);
        assert.equal((await fetch(server.url + '/api/publication/action', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 403);
        assert.equal((await fetch(server.url + '/api/publication/action', { method: 'DELETE', headers })).status, 405);
        const post = body => fetch(server.url + '/api/publication/action', { method: 'POST', headers, body: JSON.stringify(body) });
        assert.equal((await post({ action: 'publish', profileId: 'edition' })).status, 400);
        assert.equal((await post({ action: 'reserve-doi', mode: 'new-version' })).status, 400);
        const callCount = globalThis.__publicationReaderFixture.calls.length;
        const invalid = await fetch(server.url + '/api/publication/artifact?profile=edition&build=build-a&file=../../secret', { headers });
        assert.equal(invalid.status, 400); assert.equal(globalThis.__publicationReaderFixture.calls.length, callCount, 'Arbitrary paths do not reach storage.');
        assert.equal((await fetch(server.url + '/api/publication/artifact?profile=edition&build=wrong&file=publication.pdf', { headers })).status, 500);
        const artifact = await fetch(server.url + '/api/publication/artifact?profile=edition&build=build-a&file=publication.pdf', { headers });
        assert.equal(artifact.status, 200); assert.equal(artifact.headers.get('content-type'), 'application/pdf'); assert.match(artifact.headers.get('content-disposition'), /publication\.pdf/);
        assert.equal(await artifact.text(), '%PDF fixed fixture');
        const jobResponse = await post({ action: 'build', profile: profile(), expectedFingerprint: 'f' }); assert.equal(jobResponse.status, 202); const job = await jobResponse.json();
        assert.equal(job.state, 'running'); assert.equal((await post({ action: 'save', profile: profile(), expectedRevision: 0 })).status, 409);
        const resumed = await (await fetch(server.url + '/api/publication', { headers })).json(); assert.equal(resumed.job.id, job.id);
        await drain(); assert.equal(globalThis.__publicationReaderFixture.calls.find(call => call.action === 'build').root, roots[0]);

        // Leave a request body unfinished, then switch the shared Reader project before admission.
        let pendingResponse;
        const delayedResult = new Promise((resolve, reject) => {
            const request = http.request(server.url + '/api/publication/action', { method: 'POST', headers }, result => { result.resume(); result.on('end', () => resolve(result.statusCode)); });
            request.on('error', reject); request.write('{"action":"save",'); pendingResponse = request;
        });
        await new Promise(resolve => setTimeout(resolve, 25));
        const switched = await (await fetch(server.url + '/api/projects/pick', { method: 'POST' })).json();
        pendingResponse.end('"profile":{"id":"late"},"expectedRevision":null}');
        assert.equal(await delayedResult, 409); assert.equal(globalThis.__publicationReaderFixture.calls.some(call => call.profile?.id === 'late'), false);
        const nextHeaders = { ...headers, 'x-math-workspace-project': switched.projectId };
        assert.equal((await fetch(server.url + '/api/publication/job?id=' + job.id, { headers: nextHeaders })).status, 404, 'Old jobs cannot be accessed through the new project.');
        const nextSave = await fetch(server.url + '/api/publication/action', { method: 'POST', headers: nextHeaders, body: JSON.stringify({ action: 'save', profile: profile(), expectedRevision: null }) });
        assert.equal(nextSave.status, 202); await drain();
        assert.equal(globalThis.__publicationReaderFixture.calls.find(call => call.action === 'save').root, roots[1], 'A second project has its own job admission.');
        globalThis.__publicationReaderFixture.releases.get(roots[0])(); await drain();
        assert.equal((await fetch(server.url + '/api/publication', { headers: nextHeaders })).status, 200);
        assert.equal(globalThis.__publicationReaderFixture.calls.some(call => call.action === 'build' && call.root === roots[1]), false);
    } finally {
        if (server) await server.close(); delete globalThis.__publicationReaderFixture;
        await fs.rm(temporary, { recursive: true, force: true });
    }
}

export async function testReaderPublication() { await testPublicationUi(); await testPublicationHttp(); }
