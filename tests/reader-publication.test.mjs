import { readerUiLabels, installReaderTextNodes } from './reader-ui-harness.mjs';
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

installReaderTextNodes(Element);

async function harness(language = 'en') {
    const pureModule = async file => {
        const exports = {};
        vm.runInNewContext(ts.transpileModule(await fs.readFile(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports });
        return exports;
    };
    const metadataModule = await pureModule('packages/core/src/project-metadata.ts'), matterModule = await pureModule('src/publication/matter.ts');
    const document = { downloads: [], activeElement: null, createElement(tag) { return new Element(tag, this); } }; document.body = document.createElement('body'); document.activeElement = document.body;
    const context = { language, project: 'project-a', token: 'token-a' }, requests = [], revoked = [], timers = new Map(), previews = []; let sequence = 0, override;
    const model = { pages: structuredClone(pages), sources: {}, partial: true, warnings: [], profiles: [{ profile: profile(), revision: 1, updatedAt: '' }], builds: [edition()], remote: remote(), job: undefined, verifications: [], credentialConfigured: true,
        uploadPlan: { profileId: 'edition', buildId: hash('b'), draftId: '123', remoteRevision: 4, pdfSha256: hash('a'), fingerprint: hash('c'),
            files: [{ name: 'notes.txt', checksum: 'md5:retained', owned: false }], add: ['publication.pdf'], replace: [], remove: [], blocked: ['notes.txt'] } };
    const currentPlan = (value = profile()) => {
        value = matterModule.resolvePublicationMatter(value, model.pages);
        const resolved = entries => (entries || []).map(entry => ({ ...entry, ...(entry.file ? model.sources[entry.file] : {}) }));
        const assigned = new Set([...(value.frontMatter || []), ...(value.backMatter || []), ...(value.continued?.enabled === false ? [] : [value.continued || {}])].map(entry => entry.file).filter(Boolean));
        const notice = value.continued?.file && value.continued.enabled !== false ? { enabled: true, file: value.continued.file,
            title: model.sources[value.continued.file]?.title || 'To be continued', text: model.sources[value.continued.file]?.content || '' }
            : { enabled: !matterModule.hasPublicationContinuedManuscript(value, model.pages) && (value.continued?.enabled ?? model.partial), title: value.continued?.title || 'To be continued', text: value.continued?.text || 'More chapters will follow.' };
        return { ...plan(value), selected: model.pages.filter(page => value.chapters.includes(page.path) && !assigned.has(page.path)),
            omitted: model.pages.filter(page => !value.chapters.includes(page.path) && !assigned.has(page.path)), partial: model.partial,
            frontMatter: resolved(value.frontMatter), backMatter: resolved(value.backMatter), continuedNotice: notice, warnings: model.warnings };
    };
    const request = async (route, options) => {
        const value = { route, options, body: options.body ? JSON.parse(options.body) : undefined }; requests.push(value);
        assert.equal(options.headers['x-math-workspace-token'], context.token); assert.equal(options.headers['x-math-workspace-project'], context.project);
        if (override) { const result = override(value); if (result) return result; }
        if (route === '/api/publication') return response({ pages: model.pages, profiles: model.profiles, metadata: model.metadata, defaultProfile: profile(), language, tools,
            credentialStatus: [{ profileId: 'edition', environment: 'sandbox', tokenEnv: 'TEST_TOKEN', configured: model.credentialConfigured }], job: model.job });
        if (route.startsWith('/api/publication/status')) return response({ profile: model.profiles[0], metadata: model.metadata, builds: model.builds, remote: model.remote, credential: { configured: model.credentialConfigured }, verifications: model.verifications });
        if (route.includes('/artifact?')) return response({ buildId: hash('b'), plan: currentPlan(), layout: [] });
        if (route === '/api/publication/action') {
            let result;
            if (value.body.action === 'save') { result = { profile: value.body.profile, revision: model.profiles[0].revision + 1, updatedAt: '' }; model.profiles[0] = result; }
            else if (value.body.action === 'save-metadata') {
                if (value.body.expectedRevision !== model.metadata.revision) return response('Project metadata changed.', 409);
                result = { value: value.body.metadata, revision: hash('e') }; model.metadata = result;
            }
            else if (value.body.action === 'review') result = currentPlan(value.body.profile);
            else if (value.body.action === 'build') result = edition();
            else if (value.body.action === 'review-upload') result = model.uploadPlan;
            else if (value.body.action === 'verify-published') {
                result = { profileId: 'edition', buildId: hash('b'), pdfSha256: hash('a'), recordId: '123', environment: 'sandbox', status: 'pending', checkedAt: '2026-10-21T00:00:00Z', record: { status: 'passed' }, file: { status: 'passed' }, doi: { status: 'pending', httpStatus: 404 } };
                model.verifications = [result];
            }
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
            require: name => ({ '../../../packages/core/src/project-metadata': metadataModule, '../../publication/matter': matterModule, './reader-ui-labels': readerUiLabels, './reader-route': { readerFetch: request }, './reader-publication-pdf': { ReaderPublicationPdf: class {
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

export async function testPublicationUi() {
    for (const locale of ['en', 'zh']) {
        const h = await harness(locale);
        h.model.metadata = { revision: hash('d'), value: { title: 'Shared title', authors: [{ name: 'A', orcid: 'https://orcid.org/0000-0002-1825-0097', affiliation: 'Original institute' }], website: 'https://example.org/book', repository: 'https://github.com/example/book' } };
        for (const key of ['title', 'authors', 'language', 'description', 'license']) delete h.model.profiles[0].profile[key];
        await h.reader.open(); await step(h, 1);
        const field = name => h.document.body.querySelectorAll('input, textarea').find(input => input.getAttribute('aria-label') === name);
        const prefix = locale === 'en' ? 'Project · ' : '项目 · ', website = locale === 'en' ? 'Work website' : '作品网站', repository = locale === 'en' ? 'Source repository' : '源码仓库';
        assert.equal(field(website).value, 'https://example.org/book'); assert.equal(field(website).readOnly, true);
        field(prefix + repository).value = 'https://github.com/example/revised'; await field(prefix + repository).emit('input');
        field(prefix + 'ORCID 1').value = 'https://orcid.org/0000-0001-5109-3700'; await field(prefix + 'ORCID 1').emit('input');
        const affiliation = prefix + (locale === 'en' ? 'Affiliation' : '所属机构') + ' 1'; field(affiliation).value = 'Revised institute'; await field(affiliation).emit('input');
        await action(h, locale === 'en' ? 'Save project metadata' : '保存项目公共信息').emit('click'); await drain();
        const common = h.requests.find(request => request.body?.action === 'save-metadata').body;
        assert.equal(common.expectedRevision, hash('d')); assert.equal(common.metadata.repository, 'https://github.com/example/revised'); assert.equal(common.metadata.authors[0].affiliation, 'Revised institute');
        await action(h, locale === 'en' ? 'Save publication plan' : '保存出版计划').emit('click'); await drain();
        const saved = h.requests.find(request => request.body?.action === 'save').body.profile;
        assert.equal(saved.title, undefined); assert.equal(saved.authors, undefined); assert.equal(saved.repository, undefined, 'Shared values do not leak into stored overrides.');
        const checkbox = h.document.body.querySelectorAll('input').find(input => input.type === 'checkbox' && input.parent.textContent.includes((locale === 'en' ? 'Override for this edition' : '本版单独设置') + ' · ' + website));
        checkbox.checked = true; await checkbox.emit('change'); assert.equal(field(website).readOnly, false);
        field(website).value = 'https://example.org/edition'; await field(website).emit('input');
        await action(h, locale === 'en' ? 'Save publication plan' : '保存出版计划').emit('click'); await drain();
        assert.equal(h.requests.filter(request => request.body?.action === 'save').at(-1).body.profile.website, 'https://example.org/edition');
        assert.equal(h.model.metadata.value.website, 'https://example.org/book'); h.reader.close();
    }
    const conflict = await harness(); conflict.model.metadata = { value: { title: 'Original common title' }, revision: hash('d') };
    await conflict.reader.open(); await step(conflict, 1);
    const commonTitle = conflict.document.body.querySelectorAll('input').find(input => input.getAttribute('aria-label') === 'Project · Book title / title');
    assert.ok(commonTitle); commonTitle.value = 'Unsaved draft'; await commonTitle.emit('input');
    conflict.model.metadata = { value: { title: 'Changed elsewhere' }, revision: hash('c') };
    await step(conflict, 0);
    await action(conflict, 'Refresh publication status').emit('click'); await drain(); await step(conflict, 1);
    assert.equal(action(conflict, 'Save project metadata').disabled, true, 'Refreshing cannot silently rebase a dirty common draft over another writer.');
    assert.ok(conflict.document.body.querySelectorAll('input').some(input => input.value === 'Unsaved draft'));
    await action(conflict, 'Reload and discard unsaved project metadata').emit('click'); await drain();
    assert.equal(action(conflict, 'Save project metadata').disabled, false); conflict.reader.close();
    const automatic = await harness(); automatic.model.profiles[0].profile.matter = { automatic: true };
    automatic.model.profiles[0].profile.frontMatter = []; automatic.model.profiles[0].profile.backMatter = [];
    const extra = [
        { ...page('book/front-matter/01.md', 'Automatic preface'), kind: 'front-matter', volume: undefined },
        { ...page('book/front-matter/02.md', 'Another preface'), kind: 'front-matter', volume: undefined },
        { ...page('book/back-matter/01.md', 'Automatic ending'), kind: 'back-matter', volume: undefined },
        { ...page('book/appendix-a.md', 'Appendix A'), kind: 'appendix', volume: undefined }
    ]; automatic.model.pages.push(...extra); await automatic.reader.open();
    await step(automatic, 1);
    const sourceChoice = h => h.document.body.querySelector('[data-publication-matter-source]');
    assert.equal(sourceChoice(automatic).value, 'repository');
    assert(!automatic.document.body.querySelectorAll('button').some(button => button.getAttribute('aria-label') === 'Add Front matter'), 'Repository matter and manual addition must never be shown together.');
    const ending = automatic.document.body.querySelectorAll('input').find(input => input.type === 'checkbox' && !input.disabled && input.parent.textContent === 'Automatic ending');
    assert.equal(ending.checked, true); ending.checked = false; await ending.emit('change');
    sourceChoice(automatic).value = 'manual'; await sourceChoice(automatic).emit('change'); await drain();
    await action(automatic, 'Save publication plan').emit('click'); await drain();
    const savedAutomatic = () => automatic.requests.filter(request => request.body?.action === 'save').at(-1).body.profile;
    assert.deepEqual(savedAutomatic().frontMatter.map(item => item.file).filter(Boolean), extra.slice(0, 2).map(item => item.path));
    await action(automatic, 'Move up book/front-matter/02.md').emit('click'); await drain();
    await action(automatic, 'Save publication plan').emit('click'); await drain();
    assert.deepEqual(savedAutomatic().frontMatter.map(item => item.file).filter(Boolean), extra.slice(0, 2).map(item => item.path).reverse());
    assert(!savedAutomatic().backMatter.some(item => item.file === extra[2].path));
    assert(savedAutomatic().chapters.includes(extra[3].path)); automatic.reader.close();
    for (const language of ['en', 'zh']) {
        const sources = await harness(language); sources.model.profiles[0].profile.matter = { automatic: true };
        sources.model.pages.push(...extra);
        await sources.reader.open(); await step(sources, 1);
        const front = () => sources.document.body.querySelector('[data-publication-matter="frontMatter"]');
        assert.match(front().textContent, /Automatic preface/);
        assert.equal(front().querySelectorAll('textarea').length, 0, 'Dormant hand-written content is not an editor in repository mode.');
        assert(!front().textContent.includes('Why this book.'));
        sourceChoice(sources).value = 'manual'; sourceChoice(sources).focus(); await sourceChoice(sources).emit('change'); await drain();
        assert.equal(sources.document.activeElement, sourceChoice(sources), 'Source switching keeps focus on its replacement control.');
        assert.ok(front().querySelectorAll('textarea').some(control => control.value === 'Why this book.'), 'Switching restores an existing authored manual draft.');
        const draft = front().querySelectorAll('textarea')[0]; draft.value = 'Retained manual revision'; await draft.emit('input');
        sourceChoice(sources).value = 'repository'; await sourceChoice(sources).emit('change'); await drain();
        assert.equal(front().querySelectorAll('textarea').length, 0);
        assert.match(front().textContent, /Automatic preface/);
        await action(sources, language === 'en' ? 'Save publication plan' : '保存出版计划').emit('click'); await drain();
        const stored = sources.requests.filter(request => request.body?.action === 'save').at(-1).body.profile;
        assert.equal(stored.matter.automatic, true); assert.equal(stored.frontMatter[0].content, 'Retained manual revision', 'Inactive manual content survives save and source changes.');
        const choice = sourceChoice(sources); choice.focus(); sources.context.language = language === 'en' ? 'zh' : 'en'; sources.reader.contextChanged();
        assert.equal(sources.document.activeElement, choice); assert.equal(choice.value, 'repository');
        assert.equal(choice.getAttribute('aria-label'), sources.context.language === 'zh' ? '前后文来源' : 'Front and back matter source');
        sourceChoice(sources).value = 'manual'; await sourceChoice(sources).emit('change'); await drain();
        assert.ok(front().querySelectorAll('textarea').some(control => control.value === 'Retained manual revision'));
        sources.reader.close();
    }
    for (const locale of ['zh', 'en']) {
        const continued = await harness(locale), original = continued.model.profiles[0].profile;
        original.matter = { automatic: true }; original.continued = { title: 'Manual outlook', text: 'RETAINED_MANUAL_OUTLOOK' };
        const manuscripts = [
            { path: 'book/to-be-continued.md', title: 'Book outlook', kind: 'continued', book: 'book' },
            { path: 'book/vol-1/to-be-continued.md', title: 'Volume outlook', kind: 'continued', book: 'book', volume: 'vol-1' },
            { path: 'book/vol-2/to-be-continued.md', title: 'Other volume outlook', kind: 'continued', book: 'book', volume: 'vol-2' }
        ];
        continued.model.pages.push(...manuscripts);
        for (const manuscript of manuscripts) continued.model.sources[manuscript.path] = { title: manuscript.title, content: `# ${manuscript.title}\n\nREPOSITORY_${manuscript.title}` };
        await continued.reader.open(); await step(continued, 1);
        const back = () => continued.document.body.querySelector('[data-publication-matter="backMatter"]');
        const row = title => back().querySelectorAll('input').find(input => input.parent.textContent === title);
        assert.ok(row('Book outlook').checked); assert.ok(row('Volume outlook').checked); assert.equal(row('Other volume outlook'), undefined);
        assert.equal(back().querySelectorAll('textarea').length, 0);
        assert.equal(continued.document.body.querySelector('[data-publication-continued]'), null, 'Matching continued manuscripts have no separate declaration section.');
        row('Book outlook').checked = false; await row('Book outlook').emit('change');
        row('Volume outlook').checked = false; await row('Volume outlook').emit('change');
        await step(continued, 2); await action(continued, locale === 'zh' ? '保存并审阅本版' : 'Save and review this edition').emit('click'); await drain();
        assert.equal(continued.reader.plan.continuedNotice.enabled, false, 'Excluding repository back matter never activates a second declaration.');
        assert.doesNotMatch(continued.document.body.textContent, /RETAINED_MANUAL_OUTLOOK|Manual outlook/);
        await step(continued, 1); sourceChoice(continued).value = 'manual'; await sourceChoice(continued).emit('change');
        const manual = () => back().querySelector('[data-publication-continued]');
        assert.ok(manual().querySelectorAll('textarea').some(control => control.value === 'RETAINED_MANUAL_OUTLOOK'));
        assert.ok(manual().querySelectorAll('input').some(control => control.value === 'Manual outlook'));
        assert(!continued.reader.profile.chapters.some(file => file.includes('to-be-continued')));
        const draft = manual().querySelector('textarea'); draft.value = 'REVISED_MANUAL_OUTLOOK'; await draft.emit('input');
        sourceChoice(continued).value = 'repository'; await sourceChoice(continued).emit('change');
        assert.equal(back().querySelectorAll('textarea').length, 0);
        await action(continued, locale === 'zh' ? '保存出版计划' : 'Save publication plan').emit('click'); await drain();
        assert.equal(continued.requests.filter(request => request.body?.action === 'save').at(-1).body.profile.continued.text, 'REVISED_MANUAL_OUTLOOK');
        continued.reader.close();
    }
    const orderedMatter = await harness(); orderedMatter.model.profiles[0].profile.matter = { automatic: true };
    orderedMatter.model.pages = [
        { path: 'book/vol-1/01.md', title: 'First body', kind: 'chapter', book: 'book', volume: 'vol-1' },
        { path: 'book/vol-1/back-matter/end.md', title: 'First ending', kind: 'back-matter', book: 'book', volume: 'vol-1' },
        { path: 'book/vol-1/to-be-continued.md', title: 'First outlook', kind: 'continued', book: 'book', volume: 'vol-1' },
        { path: 'book/vol-2/02.md', title: 'Second body', kind: 'chapter', book: 'book', volume: 'vol-2' },
        { path: 'book/vol-2/back-matter/end.md', title: 'Second ending', kind: 'back-matter', book: 'book', volume: 'vol-2' },
        { path: 'book/vol-2/to-be-continued.md', title: 'Second outlook', kind: 'continued', book: 'book', volume: 'vol-2' },
        { path: 'book/back-matter/end.md', title: 'Book ending', kind: 'back-matter', book: 'book' },
        { path: 'book/to-be-continued.md', title: 'Book outlook', kind: 'continued', book: 'book' }
    ];
    orderedMatter.model.profiles[0].profile.chapters = ['book/vol-1/01.md', 'book/vol-2/02.md'];
    await orderedMatter.reader.open(); await step(orderedMatter, 1);
    const orderedRows = orderedMatter.document.body.querySelector('[data-publication-matter="backMatter"]').querySelectorAll('.publication-repository-matter');
    assert.deepEqual(orderedRows.map(row => row.querySelectorAll('small').at(-1).textContent), orderedMatter.model.pages.filter(page => ['back-matter', 'continued'].includes(page.kind)).map(page => page.path), 'The displayed back matter follows PDF order: volume endings first, book-wide outlook last.');
    orderedMatter.reader.close();
    const disabledNotice = await harness(); disabledNotice.model.profiles[0].profile.matter = { automatic: true };
    disabledNotice.model.profiles[0].profile.continued = { enabled: false, text: 'Disabled draft' };
    disabledNotice.model.pages.push({ path: 'book/to-be-continued.md', title: 'Book outlook', kind: 'continued', book: 'book' },
        { path: 'book/vol-1/to-be-continued.md', title: 'Volume outlook', kind: 'continued', book: 'book', volume: 'vol-1' });
    await disabledNotice.reader.open(); await step(disabledNotice, 1);
    const noticeRow = title => disabledNotice.document.body.querySelectorAll('input').find(input => input.parent.textContent === title);
    assert.equal(noticeRow('Book outlook').checked, false); assert.equal(noticeRow('Volume outlook').checked, false);
    noticeRow('Book outlook').checked = true; await noticeRow('Book outlook').emit('change');
    assert.equal(noticeRow('Book outlook').checked, true); assert.equal(noticeRow('Volume outlook').checked, false, 'Re-enabling one manuscript does not re-enable other legacy-disabled manuscripts.');
    disabledNotice.reader.close();
    const inlineLegacy = await harness(); inlineLegacy.model.profiles[0].profile.frontMatter = []; inlineLegacy.model.profiles[0].profile.backMatter = [];
    inlineLegacy.model.profiles[0].profile.continued.text = 'Authored declaration';
    inlineLegacy.model.pages.push({ path: 'book/to-be-continued.md', title: 'Book outlook', kind: 'continued', book: 'book' });
    await inlineLegacy.reader.open(); await step(inlineLegacy, 1);
    assert.equal(sourceChoice(inlineLegacy).value, 'manual', 'An authored legacy declaration must not be silently replaced with repository matter.'); inlineLegacy.reader.close();
    const manualFile = await harness(); manualFile.model.pages.push({ path: 'book/to-be-continued.md', title: 'Assigned outlook', kind: 'continued', book: 'book' });
    manualFile.model.profiles[0].profile.backMatter = [{ file: 'book/to-be-continued.md' }]; manualFile.model.profiles[0].profile.continued.text = 'DORMANT_ASSIGNED_OUTLOOK';
    await manualFile.reader.open(); await step(manualFile, 1);
    assert.equal(manualFile.document.body.querySelector('[data-publication-continued]'), null, 'A manually referenced back-matter manuscript also hides the duplicate inline declaration.');
    manualFile.reader.close();
    const blankLegacy = await harness(); blankLegacy.model.profiles[0].profile.frontMatter = []; blankLegacy.model.profiles[0].profile.backMatter = [];
    blankLegacy.model.pages.push(...extra); await blankLegacy.reader.open(); await step(blankLegacy, 1);
    assert.equal(sourceChoice(blankLegacy).value, 'repository', 'A blank legacy plan with repository matter displays the detected files without Add.');
    assert.match(blankLegacy.document.body.textContent, /Automatic preface/); blankLegacy.reader.close();
    const scopes = await harness(); scopes.model.profiles[0].profile.matter = { automatic: true };
    scopes.model.pages[2].volume = 'vol-2';
    scopes.model.pages.push({ ...page('book/vol-2/back-matter/ending.md', 'Second volume ending', 'Later volume'), volume: 'vol-2', kind: 'back-matter' });
    await scopes.reader.open();
    const chapter = () => scopes.document.body.querySelectorAll('input').find(input => input.type === 'checkbox' && input.parent.textContent === 'Later chapter');
    chapter().checked = true; await chapter().emit('change');
    assert(scopes.document.body.querySelectorAll('input').some(input => input.parent.textContent === 'Second volume ending' && input.checked));
    chapter().checked = false; await chapter().emit('change');
    assert(!scopes.document.body.querySelectorAll('input').some(input => input.parent.textContent === 'Second volume ending' && input.checked), 'Removing the last selected chapter must also drop its automatically discovered volume matter.');
    await step(scopes, 1); await action(scopes, 'Save publication plan').emit('click'); await drain();
    assert.deepEqual(scopes.requests.find(request => request.body?.action === 'save').body.profile.chapters, ['book/01.md', 'book/02.md'], 'Unrelated checkbox edits must never copy automatically added pages into explicit scope.'); scopes.reader.close();
    const focus = await harness(), more = focus.document.createElement('button'), contents = focus.document.createElement('button');
    focus.document.body.append(more, contents); more.focus(); await focus.reader.open(); focus.reader.close();
    assert.equal(focus.document.activeElement, more, 'Closing the actual publication dialog returns focus to its visible launcher.');
    contents.focus(); focus.reader.close();
    assert.equal(focus.document.activeElement, contents, 'An idempotent close during another toolbar action cannot restore stale publication focus.');
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
        const canvas = h.document.body.querySelector('canvas'), previewCount = h.previews.length, requestsBeforeLocale = h.requests.length;
        h.context.language = language === 'zh' ? 'en' : 'zh'; h.reader.contextChanged();
        assert.equal(h.document.body.querySelector('canvas'), canvas); assert.equal(h.previews.length, previewCount);
        assert.equal(h.requests.length, requestsBeforeLocale); assert.equal(h.previews.at(-1).abort.signal.aborted, false, 'Locale changes keep the existing PDF preview mounted.');
        h.context.language = language; h.reader.contextChanged();
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
    for (const language of ['en', 'zh']) {
        const v = await harness(language); v.model.remote = { ...remote(), status: 'published', recordId: '123' }; v.model.credentialConfigured = false;
        await v.reader.open(); await step(v, 3);
        assert.match(v.document.body.textContent, language === 'en' ? /have not been independently verified/ : /尚未独立核验/);
        const title = v.document.body.querySelectorAll('input').find(input => input.getAttribute('aria-label') === (language === 'en' ? 'Edition DOI' : '本版 DOI'));
        title.value = '10.1234/unsaved'; await title.emit('input');
        const verify = action(v, language === 'en' ? 'Verify public edition' : '核验公开版本'); assert.equal(verify.disabled, false, 'Public verification needs no Zenodo credential.');
        await verify.emit('click'); await drain();
        const request = v.requests.find(request => request.body?.action === 'verify-published');
        assert.equal(request.body.buildId, hash('b')); assert.equal(request.body.recordId, '123'); assert.equal(request.body.pdfSha256, hash('a'));
        assert.equal(v.requests.some(request => ['save', 'publish', 'reserve-doi', 'upload'].includes(request.body?.action)), false, 'Verifying a frozen edition never saves edits or repeats publication.');
        assert.match(v.document.body.textContent, language === 'en' ? /Public files verified; DOI resolution is not verified in sandbox/ : /公开文件核验通过；sandbox DOI 解析未验收/);
        assert.match(v.document.body.textContent, language === 'en' ? /Downloaded PDF: Passed/ : /下载的 PDF: 通过/);
        assert.match(v.document.body.textContent, language === 'en' ? /Edition DOI resolution: Pending/ : /本版 DOI 解析: 待核验/);
        v.reader.close();
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
    delete optional.model.profiles[0].profile.continued.enabled;
    await optional.reader.open(); await step(optional, 1);
    const language = optional.document.body.querySelectorAll('select').find(control => control.getAttribute('aria-label') === 'Publication language');
    assert.equal(language.value, 'zh', 'Standard saved language tags retain a visible language choice.');
    assert.ok(optional.document.body.querySelectorAll('input').some(control => control.indeterminate), 'The legacy automatic continued rule is visible without turning it into an explicit override.');
    await action(optional, 'Save publication plan').emit('click'); await drain();
    const optionalSaved = optional.requests.find(request => request.body?.action === 'save').body.profile;
    assert.equal(optionalSaved.language, 'zh-CN'); assert.deepEqual(optionalSaved.frontMatter, []); assert.deepEqual(optionalSaved.backMatter, [], 'Viewing layout does not add optional matter.');
    assert.equal(optionalSaved.continued.enabled, undefined);
    const identity = optional.document.body.querySelectorAll('input').find(control => control.getAttribute('aria-label') === 'Plan name');
    identity.value = 'new-edition'; await identity.emit('input'); await step(optional, 3);
    assert.equal(optional.document.body.querySelectorAll('button').some(button => button.getAttribute('aria-label') === 'Preview PDF'), false, 'Renaming a plan cannot display the old plan’s PDF.');
    optional.reader.close();

    for (const locale of ['zh', 'en']) {
        const source = await harness(locale), original = source.model.profiles[0].profile;
        const files = [
            { path: 'book/front-matter/preface.md', title: 'A manuscript preface', kind: 'front-matter' },
            { path: 'book/front-matter/readers-letter.md', title: 'A letter to readers', kind: 'front-matter' },
            { path: 'book/back-matter/conclusion.md', title: 'An author ending', kind: 'back-matter' },
            { path: 'book/back-matter/ai-retirement.md', title: 'AI retirement letter', kind: 'back-matter' },
            { path: 'book/to-be-continued.md', title: 'What comes next', kind: 'continued' }
        ];
        source.model.pages.push(...files);
        for (const file of files) source.model.sources[file.path] = { title: file.title, content: `# #h-9999999999999999 ${file.title}\n\nActual source content for ${file.path}.` };
        original.chapters.push(files[0].path); original.continued.text = 'Saved inline declaration';
        source.model.partial = false;
        await source.reader.open(); await step(source, 1);
        const picker = identity => source.document.body.querySelector(`[data-publication-file="${identity}"]`);
        const focusedPicker = picker('frontMatter-1'); focusedPicker.value = files[0].path; focusedPicker.focus(); await focusedPicker.emit('change');
        assert.notEqual(picker('frontMatter-1'), focusedPicker); assert.equal(source.document.activeElement, picker('frontMatter-1'), 'A file choice restores focus to the rebuilt control with the same identity.');
        const externalFocus = source.document.createElement('button'); source.document.body.append(externalFocus); externalFocus.focus();
        await picker('frontMatter-1').emit('change'); assert.equal(source.document.activeElement, externalFocus, 'An unfocused picker cannot take focus from another surface.');
        let backup = source.document.body.querySelectorAll('textarea').find(control => control.value === 'Why this book.'); assert.ok(backup);
        backup.value = 'Retained inline backup'; await backup.emit('input');
        await action(source, locale === 'zh' ? '添加 前文' : 'Add Front matter').emit('click');
        assert.equal(picker('frontMatter-2').value, '', 'Adding an entry never silently imports a manuscript from another book.');
        picker('frontMatter-2').value = files[1].path; await picker('frontMatter-2').emit('change');
        picker('backMatter-1').value = files[2].path; await picker('backMatter-1').emit('change');
        await action(source, locale === 'zh' ? '添加 后文' : 'Add Back matter').emit('click');
        assert.equal(picker('backMatter-2').value, ''); picker('backMatter-2').value = files[3].path; await picker('backMatter-2').emit('change');
        picker('continued').value = files[4].path; await picker('continued').emit('change');
        assert.equal(source.document.body.querySelector('[data-publication-continued]').querySelectorAll('textarea').length, 0, 'A referenced declaration and inline editor are mutually exclusive.');
        await action(source, locale === 'zh' ? '保存出版计划' : 'Save publication plan').emit('click'); await drain();
        const saved = source.requests.find(request => request.body?.action === 'save').body.profile;
        assert.equal(saved.frontMatter[0].file, files[0].path); assert.equal(saved.frontMatter[0].content, 'Retained inline backup'); assert.equal(saved.frontMatter[0].title, 'Preface');
        assert.equal(saved.backMatter.length, 2); assert.equal(saved.continued.text, 'Saved inline declaration'); assert.equal(saved.continued.file, files[4].path);
        await step(source, 0);
        const assignedRow = source.document.body.querySelectorAll('.publication-chapter').find(row => row.textContent.includes(files[0].path));
        assert.equal(assignedRow.querySelector('input').disabled, true); assert.match(assignedRow.textContent, locale === 'zh' ? /已用于 前文/ : /Used as Front matter/);
        await step(source, 2); await action(source, locale === 'zh' ? '保存并审阅本版' : 'Save and review this edition').emit('click'); await drain();
        assert.match(source.document.body.textContent, /Actual source content for book\/to-be-continued\.md/);
        assert.match(source.document.body.textContent, /AI retirement letter/); assert.match(source.document.body.textContent, /book\/front-matter\/readers-letter\.md/);
        assert.match(source.document.body.textContent, locale === 'zh' ? /稿件内容预览/ : /Manuscript content preview/);
        assert.doesNotMatch(source.document.body.textContent, /#h-9999999999999999/);
        assert.doesNotMatch(source.document.body.textContent, /Saved inline declaration|Retained inline backup/);
        await step(source, 1); picker('continued').value = ''; await picker('continued').emit('change');
        assert.ok(source.document.body.querySelectorAll('textarea').some(control => control.value === 'Saved inline declaration'), 'Clearing the file restores the existing declaration field.');
        source.reader.close();
    }

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
 saveMetadata(metadata, revision) { state.calls.push({ action: 'save-metadata', root: this.root, metadata, revision }); return Promise.resolve({ value: metadata, revision: 'new-project-revision' }); }
 plan(profile) { state.calls.push({ action: 'review', root: this.root, profile }); return Promise.resolve({ fingerprint: 'f', selected: profile.chapters }); }
 build(profile, fingerprint, options) { state.calls.push({ action: 'build', root: this.root, profile, fingerprint }); options.onProgress('PDF pages'); return new Promise(resolve => state.releases.set(this.root, () => resolve({ id: 'build-a', profileId: profile.id, pdfSha256: 'pdf-sha' }))); }
 status(id) { return Promise.resolve({ id, root: this.root }); }
 reserveDoi(id, revision, options) { state.calls.push({ action: 'reserve-doi', root: this.root, id, options }); return Promise.resolve({ status: 'draft', draftId: '123' }); }
 attachZenodo(id, revision, options) { return Promise.resolve({ status: options.kind, recordId: options.id }); }
 reviewUpload(id, buildId, review) { return Promise.resolve({ profileId: id, buildId, fingerprint: 'files-fingerprint', files: [], add: ['publication.pdf'], replace: [], remove: [], blocked: [] }); }
 upload(id, buildId, review) { state.calls.push({ action: 'upload', root: this.root, id, buildId, review }); return Promise.resolve({ status: 'draft' }); }
 publish(id, buildId, review) { state.calls.push({ action: 'publish', root: this.root, id, buildId, review }); return Promise.resolve({ status: 'published' }); }
 verifyPublished(id, buildId, request) { state.calls.push({ action: 'verify-published', root: this.root, id, buildId, request }); return Promise.resolve({ status: 'verified', profileId: id, buildId }); }
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
        const verified = await post({ action: 'verify-published', profileId: 'edition', buildId: 'build-a', pdfSha256: 'pdf-sha', recordId: '123' });
        assert.equal(verified.status, 202); await drain();
        assert.deepEqual(globalThis.__publicationReaderFixture.calls.find(call => call.action === 'verify-published'), { action: 'verify-published', root: roots[0], id: 'edition', buildId: 'build-a', request: { pdfSha256: 'pdf-sha', recordId: '123' } });
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
