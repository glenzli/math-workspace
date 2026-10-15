import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Exercise production menu/panel and application event wiring, including capture, bubbling and focus.
class EventTarget {
    listeners = new Map();
    addEventListener(type, callback, options = false) {
        const capture = typeof options === 'boolean' ? options : !!options.capture;
        this.listeners.set(type, [...(this.listeners.get(type) || []), { callback, capture }]);
    }
    removeEventListener(type, callback, options = false) {
        const capture = typeof options === 'boolean' ? options : !!options.capture;
        this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value.callback !== callback || value.capture !== capture));
    }
    emit(type, init = {}) {
        const target = init.target || this;
        const event = { target, type, defaultPrevented: false, stopped: false, ...init,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
        const chain = []; for (let value = target; value; value = value.parent) chain.push(value);
        for (const capture of [true, false]) {
            for (const current of capture ? [...chain].reverse() : chain) {
                event.currentTarget = current;
                for (const listener of current.listeners.get(type) || []) if (listener.capture === capture) listener.callback(event);
                if (event.stopped) return event;
            }
        }
        return event;
    }
}

class Element extends EventTarget {
    static ELEMENT_NODE = 1;
    constructor(tag, document) {
        super(); this.tagName = tag.toLowerCase(); this.document = document; this.nodeType = 1;
        this.children = []; this.dataset = {}; this.attributes = {}; this.className = ''; this._text = '';
        this.style = { setProperty(name, value) { this[name] = value; } }; this.disabled = false; this.tabIndex = 0;
    }
    get classList() { return { contains: name => this.className.split(' ').includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].filter(Boolean).join(' '); },
        remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => force ?? !this.classList.contains(name) ? this.classList.add(name) : this.classList.remove(name) }; }
    append(...children) { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { for (const child of this.children) child.parent = undefined; this.children = []; this._text = ''; this.append(...children); }
    remove() { if (this.parent?.children) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
    replaceWith(...nodes) {
        const parent = this.parent; if (!parent) return;
        const index = parent.children.indexOf(this); this.remove();
        for (const node of nodes) { node.remove(); node.parent = parent; }
        parent.children.splice(index, 0, ...nodes);
    }
    get parentElement() { return this.parent instanceof Element ? this.parent : null; }
    get childNodes() { return this.children; }
    get isConnected() { return this.tagName === 'body' || !!this.parent?.isConnected; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(text) { this.replaceChildren(); this._text = String(text); }
    set innerHTML(html) {
        this.replaceChildren(); const stack = [this];
        for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
            if (token.startsWith('</')) { stack.pop(); continue; }
            if (token.startsWith('<')) {
                const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
                const child = this.document.createElement(tag);
                for (const [, key, value] of token.matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(key, value);
                stack.at(-1).append(child);
                if (!['input', 'br', 'img'].includes(tag) && !token.endsWith('/>')) stack.push(child);
            } else { const text = this.document.createElement('#text'); text.textContent = token; stack.at(-1).append(text); }
        }
    }
    setAttribute(key, value) {
        this.attributes[key] = String(value);
        if (key === 'id') this.id = String(value);
        if (key === 'class') this.className = String(value);
        if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
    }
    getAttribute(key) {
        if (key === 'class') return this.className;
        if (key.startsWith('data-')) return this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] ?? null;
        return this.attributes[key] ?? null;
    }
    hasAttribute(key) { return this.getAttribute(key) !== null; }
    removeAttribute(key) { delete this.attributes[key]; }
    matches(selector) {
        if (selector.includes(',')) return selector.split(',').some(value => this.matches(value.trim()));
        if (selector.includes(':not(:disabled)')) { if (this.disabled) return false; selector = selector.replace(':not(:disabled)', ''); }
        for (const [, key, operator, expected] of selector.matchAll(/\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)) {
            const actual = this.getAttribute(key);
            if (actual === null || operator === '=' && actual !== expected || operator === '^=' && !actual.startsWith(expected)) return false;
        }
        const simple = selector.replace(/\[[^\]]*\]/g, '');
        if (simple.startsWith('#')) return this.id === simple.slice(1);
        if (simple.startsWith('.')) return simple.slice(1).split('.').every(name => this.classList.contains(name));
        return !simple || this.tagName === simple.toLowerCase();
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { for (let value = this; value instanceof Element; value = value.parent) if (value.matches(selector)) return value; return null; }
    contains(value) { return value === this || this.children.some(child => child.contains(value)); }
    focus() {
        if (this.document.activeElement === this) return;
        const previous = this.document.activeElement; this.document.activeElement = this;
        previous?.emit('focusout', { relatedTarget: this }); this.emit('focusin', { relatedTarget: previous });
    }
    scrollIntoView() { this.scrolledIntoView = true; }
    getBoundingClientRect() {
        for (let element = this; element instanceof Element; element = element.parent) {
            if (element.hidden) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
        }
        if (this.dataset.toolMenu) return { left: 146 + ['reference', 'review', 'edition', 'display'].indexOf(this.dataset.toolMenu) * 29,
            right: 174 + ['reference', 'review', 'edition', 'display'].indexOf(this.dataset.toolMenu) * 29, top: 12, bottom: 44, width: 28, height: 32 };
        return { left: 12, right: 292, top: 52, bottom: 532, width: 280, height: 480 };
    }
}

async function harness() {
    const document = new EventTarget();
    document.createElement = tag => new Element(tag, document);
    document.documentElement = document.createElement('html');
    document.compatMode = 'CSS1Compat';
    document.createElementNS = (_, tag) => document.createElement(tag);
    document.createTextNode = text => { const node = document.createElement('#text'); node.textContent = text; return node; };
    document.body = document.createElement('body'); document.body.parent = document; document.activeElement = document.body;
    const previousDocument = globalThis.document; globalThis.document = document;
    const window = new EventTarget(); window.innerWidth = 320; window.innerHeight = 700;
    window.setTimeout = () => 1; window.clearTimeout = () => {};
    window.requestAnimationFrame = () => 1;
    class Owner {
        opened = false; openCount = 0;
        constructor(...args) { this.host = args.at(-1); }
        bind() {} contextChanged() {} navigationStarted() {} dispose() {}
        close() { this.opened = false; }
        open() { this.opened = true; this.openCount++; this.returnFocus = document.activeElement; }
        openPageQueue() { this.open(); }
        render(parent) { parent.append(document.createElement('button')); }
    }
    const primaryActions = [], historyEvents = [], inlineCalls = [];
    let inlineRenderer = source => source;
    const modules = {
        lucide: require('lucide'),
        './reader-route': { isReaderEmbedded: () => true },
        './reader-host': { expandReader() { primaryActions.push('expand'); }, readerHistory(mode, state, url) { historyEvents.push({ mode, state, url }); } },
        './reader-embed': { readerViewStateChanged() {} },
        './reader-figures': { mountReaderFigures: () => () => {} },
        './reader-formula-layout': { mountReaderFormulaLayout: () => ({ dispose() {}, invalidate() {}, canAdapt: () => false, isAdapted: () => false, toggle: async () => {} }) },
        './reader-assets': { mountReaderAssets: () => () => {} },
        './formal-renderer': { renderFormalInline: (_renderer, source, options) => { inlineCalls.push({ source, filePath: options.currentFilePath }); return inlineRenderer(source, options); }, renderFormalDocument: () => ({ html: '', formulas: [] }) },
        './reader-tooltip': { ReaderTooltip: Owner },
        './source-actions': { ReaderSourceActions: Owner },
        './recall-popover': { ReaderRecallPopover: Owner },
        './reader-dependency-popover': { ReaderDependencyPopover: Owner },
        './reader-lean-popover': { ReaderLeanPopover: Owner },
        './reader-lean-review': { ReaderLeanReview: Owner },
        './reader-archive': { ReaderArchive: Owner },
        './reader-publication': { ReaderPublication: Owner },
        './reader-proposition-review': { ReaderPropositionReview: Owner },
        './reader-symbol-audit': { ReaderSymbolAudit: Owner },
        './reader-symbol-audit-report': { ReaderSymbolAuditReportView: Owner }
    };
    async function load(file, name, expose = '') {
        let source = await fs.readFile(path.join(root, 'src/reader/web/' + file), 'utf8');
        if (file === 'main.ts') source = source.replace(/\nstartReader\(\);\s*$/, '\n');
        const exports = {};
        vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + expose,
            { exports, require: name => modules[name] || {}, document, window, Element, HTMLElement: Element, Node: Element, URLSearchParams, console,
                localStorage: { setItem() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
        modules[name] = exports; return exports;
    }
    const icons = await load('reader-icons.ts', './reader-icons');
    await load('reader-popover.ts', './reader-popover');
    await load('reader-toolbar-menu.ts', './reader-toolbar-menu');
    await load('reader-toolbar-panel.ts', './reader-toolbar-panel');
    const { ReaderApplication, words } = await load('main.ts', './main', '\nexports.ReaderApplication = ReaderApplication; exports.words = words;');
    const app = Object.create(ReaderApplication.prototype); app.root = document.createElement('main'); document.body.append(app.root);
    app.state = { language: 'zh', projectId: 'project-a', revision: 1, pages: [], definitions: [] };
    app.currentPath = 'book/01.md'; app.fontSize = 18; app.sourceLineNumbersVisible = false;
    app.historyPaths = []; app.historyIndex = -1; app.pageRequestId = 0; app.selectedPagePaths = [];
    app.disposeFigures = () => {}; app.disposeAssets = () => {}; app.expandedDraftCollections = new Set();
    app.buildShell(); app.installHandlers(); app.updateToolbarLabels();
    const populated = [];
    for (const [method, view] of [['renderContents', 'contents'], ['renderDefinitions', 'definitions'], ['renderSymbols', 'symbols'], ['renderSymbolAudit', 'symbol-audit']]) {
        app[method] = container => { populated.push(view); const item = document.createElement('button'); item.textContent = view; container.append(item); };
    }
    const find = selector => app.root.querySelector(selector) || document.body.querySelector(selector);
    const click = element => { if (element.disabled) return; element.emit('pointerdown'); element.focus(); element.emit('click'); };
    const key = (key, options = {}) => { const event = document.activeElement.emit('keydown', { key, ...options });
        if (!event.defaultPrevented && ['Enter', ' '].includes(key) && document.activeElement.tagName === 'button' && !document.activeElement.disabled) document.activeElement.emit('click'); return event; };
    return { app, document, window, words, icons, populated, primaryActions, historyEvents, inlineCalls, find, click, key,
        setInlineRenderer: renderer => { inlineRenderer = renderer; }, restore: () => { globalThis.document = previousDocument; } };
}

async function documentStageUiContract() {
    const h = await harness(), { app, document, find, click, key } = h;
    const drain = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
    const shape = element => element.querySelector('svg').children.map(node => [node.tagName, node.attributes]);
    const stageOptions = [['draft', 'documentStageDraft'], ['revising', 'documentStageRevising'], ['stable', 'documentStageStable']];
    const submitted = [], reports = [];
    app.postJson = async (route, body) => { submitted.push({ route, body: JSON.parse(JSON.stringify(body)) }); };
    app.refreshState = async () => {}; app.openPage = async () => {}; app.reportLive = value => reports.push(value);
    const second = { filePath: 'book/02.md', title: 'Second chapter', documentMode: 'formal', lifecycle: { stage: 'stable' } };
    const exploratory = { filePath: 'draft/idea.md', title: 'Exploratory idea', documentMode: 'draft', lifecycle: { stage: 'stable', checkpoint: { label: 'Not a formal stage' } } };
    try {
        for (const language of ['zh', 'en']) {
            app.state.language = language; app.updateToolbarLabels();
            for (const [stage, labelKey] of stageOptions) {
                const page = { filePath: 'book/01.md', title: 'First chapter', documentMode: 'formal',
                    lifecycle: { stage, checkpoint: { label: 'RC1 <careful>', hash: 'unchanged-checkpoint' }, changedSinceCheckpoint: true } };
                const originalLifecycle = JSON.stringify(page.lifecycle);
                app.state.pages = [page, second, exploratory]; app.selectedPagePaths = [page.filePath];
                app.page = { filePath: page.filePath, page, content: '', labels: {} };
                app.renderNavigation(); app.renderArticle();
                const row = find('#reader-page-nav').querySelectorAll('.reader-nav-page').find(row => row.dataset.pagePath === page.filePath);
                const sidebar = row.querySelector('.reader-document-status'), header = app.pageTitle.querySelector('.reader-document-status');
                const expectedIcon = document.createElement('span'); expectedIcon.append(h.icons.readerIcon('stage-' + stage));
                assert.deepEqual(shape(sidebar), shape(expectedIcon)); assert.deepEqual(shape(header), shape(expectedIcon));
                assert.equal(header.querySelector('.reader-document-stage-label').textContent, h.words[language][labelKey]);
                assert.equal(row.getAttribute('aria-label').includes(sidebar.dataset.readerTooltip), true, 'The page keeps the compact badge’s full accessible stage description.');
                assert.equal(sidebar.getAttribute('aria-hidden'), 'true'); assert.equal(sidebar.textContent, '');
                assert.deepEqual(shape(row.querySelector('.reader-page-integration')), shape((() => { const value = document.createElement('span'); value.append(h.icons.readerIcon('integration-unmanaged')); return value; })()), 'Stage decoration does not alter the independent integration chain glyph.');
                for (const [choice, choiceKey] of stageOptions) {
                    click(header);
                    assert.match(find('.reader-document-stage-summary').textContent, /RC1 <careful>/);
                    const choices = find('.reader-document-stage-actions').querySelectorAll('button');
                    assert.deepEqual(choices.map(button => button.textContent), stageOptions.map(([, key]) => h.words[language][key]));
                    const action = choices[stageOptions.findIndex(([stage]) => stage === choice)];
                    const expected = document.createElement('span'); expected.append(h.icons.readerIcon('stage-' + choice));
                    assert.deepEqual(shape(action), shape(expected)); assert.equal(action.textContent, h.words[language][choiceKey]);
                    assert.equal(action.querySelector('svg').getAttribute('aria-hidden'), 'true');
                    action.focus(); key('Enter'); await drain();
                    assert.deepEqual(submitted.at(-1), { route: '/api/document-state', body: { filePath: page.filePath, stage: choice } });
                    assert.equal(find('.reader-toolbar-panel'), null);
                }
                for (const [choice, choiceKey] of stageOptions) {
                    app.selectedPagePaths = [page.filePath, second.filePath, exploratory.filePath];
                    row.emit('contextmenu', { clientX: 16, clientY: 24 });
                    const context = find('.reader-nav-context-menu');
                    assert.ok(context); const trigger = context.querySelector('.reader-nav-context-menu-trigger');
                    trigger.focus(); key('ArrowRight');
                    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
                    const choices = context.querySelector('.reader-nav-context-submenu').querySelectorAll('button');
                    assert.equal(document.activeElement, choices[0], 'The existing keyboard submenu entry still focuses its first choice.');
                    const action = choices[stageOptions.findIndex(([stage]) => stage === choice)];
                    const expected = document.createElement('span'); expected.append(h.icons.readerIcon('stage-' + choice));
                    assert.deepEqual(shape(action), shape(expected)); assert.equal(action.textContent, h.words[language][choiceKey]);
                    const before = submitted.length; click(action); await drain();
                    assert.deepEqual(submitted.slice(before), [page.filePath, second.filePath].map(filePath => ({ route: '/api/document-state', body: { filePath, stage: choice } })), 'Batch choices retain their stage values and exclude exploratory drafts.');
                    assert.equal(find('.reader-nav-context-menu'), null);
                }
                click(header);
                const checkpoint = find('.reader-document-stage-checkpoint'); checkpoint.querySelector('input').value = 'RC2 <literal>';
                click(checkpoint.querySelector('button')); await drain();
                assert.deepEqual(submitted.at(-1), { route: '/api/document-state', body: { filePath: page.filePath, checkpointLabel: 'RC2 <literal>' } });
                click(header); click(find('.reader-document-stage-clear')); await drain();
                assert.deepEqual(submitted.at(-1), { route: '/api/document-state', body: { filePath: page.filePath, clearCheckpoint: true } });
                assert.equal(JSON.stringify(page.lifecycle), originalLifecycle, 'Rendering and choice projection never mutate persisted stage/checkpoint input.');
            }
            app.page = { filePath: exploratory.filePath, page: exploratory, content: '', labels: {} };
            app.selectedPagePaths = [exploratory.filePath]; app.renderArticle();
            assert.equal(app.pageTitle.querySelector('.reader-document-status'), null);
            const row = find('#reader-page-nav').querySelectorAll('.reader-nav-page').find(row => row.dataset.pagePath === exploratory.filePath);
            assert.equal(row.querySelector('.reader-document-status'), null);
            const before = submitted.length; row.emit('contextmenu', { clientX: 16, clientY: 24 });
            assert.equal(find('.reader-nav-context-menu'), null); assert.equal(reports.at(-1), h.words[language].documentStageBatchNoFormal);
            app.openDocumentStage(find('[data-panel="contents"]'));
            assert.equal(find('.reader-toolbar-panel'), null); assert.equal(submitted.length, before);
        }
        console.log('Reader document-stage shared glyph, header/sidebar, single/batch choice, checkpoint and bilingual action contracts passed.');
    } finally { app.closeNavigationContextMenu(); app.toolbarPanel.dispose(); app.toolbarMenu.dispose(); h.restore(); }
}

async function titleNavigationContract() {
    const h = await harness(), { app, document, find, click, key } = h;
    const drain = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
    const chapter = (filePath, fields = {}) => ({ kind: 'chapter', filePath, title: 'Repeated title', bookKey: 'book-a', bookTitle: 'Same book label',
        volumeKey: 'volume-1', volumeTitle: 'Same volume label', documentMode: 'formal', lifecycle: { stage: 'revising' }, ...fields });
    const first = chapter('book-a/volume-1/z.md'), current = chapter('book-a/volume-1/m.md', { displayHeading: 'Chapter 2 · $x+y$' }), last = chapter('book-a/volume-1/a.md');
    const otherVolume = chapter('book-a/volume-1/elsewhere.md', { volumeKey: 'volume-2' });
    const otherBook = chapter('book-b/volume-1/m.md', { bookKey: 'book-b' });
    const bookRoot = chapter('book-a/preface.md', { volumeKey: undefined, volumeTitle: undefined });
    const emptyVolume = chapter('book-a/empty.md', { volumeKey: '' });
    const draftA = chapter('book-a/volume-1/draft-a.md', { documentMode: 'draft', documentCollectionId: 'notes-a', documentCollectionTitle: 'Same draft label' });
    const draftASibling = chapter('elsewhere/idea.md', { documentMode: 'draft', documentCollectionId: 'notes-a', documentCollectionTitle: 'Same draft label' });
    const draftB = chapter('book-a/volume-1/draft-b.md', { documentMode: 'draft', documentCollectionId: 'notes-b', documentCollectionTitle: 'Same draft label' });
    const missingDraftId = chapter('draft/missing.md', { documentMode: 'draft', documentCollectionId: undefined });
    const emptyBook = chapter('empty-book/one.md', { bookKey: '', volumeKey: undefined });
    const emptyBookSibling = chapter('empty-book/two.md', { bookKey: '', volumeKey: undefined });
    const missingBook = chapter('unknown/one.md', { bookKey: undefined, volumeKey: undefined });
    const emptyDraft = chapter('draft/empty-one.md', { documentMode: 'draft', documentCollectionId: '' });
    const emptyDraftSibling = chapter('draft/empty-two.md', { documentMode: 'draft', documentCollectionId: '' });
    const pages = [first, otherBook, current, otherVolume, draftA, bookRoot, last, emptyVolume, draftB, draftASibling, emptyBook, missingBook, emptyBookSibling, missingDraftId, emptyDraft, emptyDraftSibling];
    const mount = (page, candidates = pages) => {
        app.toolbarPanel.close(); app.symbolAuditReportOpen = false;
        app.state = { ...app.state, available: true, pages: candidates };
        app.currentPath = page.filePath; app.selectedPagePaths = [page.filePath]; app.selectionAnchorPath = page.filePath;
        app.page = { revision: 1, filePath: page.filePath, page, content: '', labels: {}, symbols: [] };
        app.renderArticle();
    };
    const rows = () => find('.reader-chapter-list').querySelectorAll('button');
    const rowPaths = () => rows().map(button => button.dataset.chapterPath);
    try {
        for (const language of ['zh', 'en']) {
            app.state.language = language; mount(current);
            const title = find('[data-title-navigation]'), status = app.pageTitle.querySelector('[data-document-status]'), integration = app.pageTitle.querySelector('.reader-page-integration');
            assert.equal(title.type, 'button'); assert.equal(title.getAttribute('aria-haspopup'), 'dialog');
            assert.equal(title.getAttribute('aria-expanded'), 'false'); assert.equal(title.getAttribute('aria-controls'), 'reader-chapter-navigation');
            assert.equal(title.contains(status), false); assert.equal(title.contains(integration), false);
            assert.equal(title.parentElement, status.parentElement, 'Stage action remains a sibling of the title action.');
            assert.equal(title.querySelector('.reader-page-title-label').textContent, current.displayHeading);
            assert.ok(h.inlineCalls.some(call => call.source === current.displayHeading && call.filePath === current.filePath), 'Title math uses the formal inline renderer.');
            title.focus(); key('Enter');
            assert.equal(find('#reader-chapter-navigation').getAttribute('role'), 'dialog');
            assert.equal(find('#reader-chapter-navigation').getAttribute('aria-label'), h.words[language].volumeChapters);
            assert.deepEqual(rowPaths(), [first.filePath, current.filePath, last.filePath], 'Real book and volume keys isolate matching labels while retaining project order.');
            assert.equal(document.activeElement.getAttribute('aria-current'), 'page');
            assert.equal(document.activeElement.dataset.chapterPath, current.filePath);
            key('ArrowDown'); assert.equal(document.activeElement.dataset.chapterPath, last.filePath);
            key('ArrowDown'); assert.equal(document.activeElement.dataset.chapterPath, first.filePath);
            key('End'); assert.equal(document.activeElement.dataset.chapterPath, last.filePath);
            key('Home'); assert.equal(document.activeElement.dataset.chapterPath, first.filePath);
            key('ArrowUp'); assert.equal(document.activeElement.dataset.chapterPath, last.filePath);
            key('Escape'); assert.equal(find('.reader-toolbar-panel'), null); assert.equal(document.activeElement, title);
            click(title); click(title); assert.equal(find('.reader-toolbar-panel'), null, 'A second title activation closes its own panel.');
            click(title); click(app.article); assert.equal(find('.reader-toolbar-panel'), null, 'Outside pointer input dismisses the chapter list.');
            click(title); click(status);
            assert.equal(app.toolbarPanel.isActive('document-stage'), true); assert.equal(find('.reader-chapter-list'), null);
            key('Escape'); assert.equal(document.activeElement, status);
            click(title); click(integration); assert.equal(find('.reader-toolbar-panel'), null, 'The integration glyph cannot activate chapter navigation.');
            click(find('[data-panel="contents"]'));
            assert.equal(find('.reader-toolbar-panel').getAttribute('aria-label'), h.words[language].contents);
            assert.equal(find('.reader-chapter-list'), null, 'The chapter outline remains the independent Contents action.');
            key('Escape');

            for (const [page, expected, label] of [
                [otherVolume, [otherVolume], 'volumeChapters'], [otherBook, [otherBook], 'volumeChapters'],
                [bookRoot, [bookRoot], 'bookChapters'], [emptyVolume, [emptyVolume], 'volumeChapters'],
                [emptyBook, [emptyBook, emptyBookSibling], 'bookChapters'],
                [draftA, [draftA, draftASibling], 'collectionPages'], [draftB, [draftB], 'collectionPages'],
                [emptyDraft, [emptyDraft, emptyDraftSibling], 'collectionPages']
            ]) {
                mount(page); click(find('[data-title-navigation]'));
                assert.equal(find('.reader-toolbar-panel').getAttribute('aria-label'), h.words[language][label]);
                assert.deepEqual(rowPaths(), expected.map(value => value.filePath), 'Absent keys never alias explicit empty keys or named collections.');
                key('Escape');
            }
            for (const page of [missingBook, missingDraftId]) {
                mount(page); assert.equal(find('[data-title-navigation]'), null, 'Unknown ownership cannot infer a catalog from labels or path prefixes.');
            }
        }

        mount(current); app.historyPaths = [current.filePath]; app.historyIndex = 0;
        const requests = [];
        app.fetchJson = async route => {
            requests.push(route);
            const filePath = decodeURIComponent(route.split('?path=')[1]);
            const page = pages.find(value => value.filePath === filePath);
            assert.ok(page);
            return { revision: 1, filePath, page, content: '', labels: {}, symbols: [] };
        };
        const previousTitle = find('[data-title-navigation]'); click(previousTitle);
        rows().find(row => row.dataset.chapterPath === last.filePath).focus(); key('Enter'); await drain();
        assert.equal(find('.reader-toolbar-panel'), null); assert.equal(app.currentPath, last.filePath);
        assert.deepEqual(Array.from(app.historyPaths), [current.filePath, last.filePath]);
        assert.equal(h.historyEvents.at(-1).mode, 'push'); assert.equal(h.historyEvents.at(-1).state.filePath, last.filePath);
        assert.deepEqual(requests, ['/api/page?path=' + encodeURIComponent(last.filePath)]);
        assert.notEqual(find('[data-title-navigation]'), previousTitle); assert.equal(document.activeElement, find('[data-title-navigation]'), 'Selecting a chapter focuses its new connected title after the normal history navigation.');
        const rerenderedTitle = find('[data-title-navigation]'); app.renderArticle();
        assert.notEqual(find('[data-title-navigation]'), rerenderedTitle); assert.equal(document.activeElement, find('[data-title-navigation]'));

        click(find('[data-title-navigation]')); app.applyState({ ...app.state, revision: 2, pages: pages.filter(page => page !== first) });
        assert.equal(find('.reader-toolbar-panel'), null); assert.equal(document.activeElement, find('[data-title-navigation]'), 'A metadata refresh dismisses and restores focus from the stale catalog.');
        app.renderArticle(); assert.equal(document.activeElement, find('[data-title-navigation]'));
        click(find('[data-title-navigation]')); app.renderArticle();
        assert.equal(find('.reader-toolbar-panel'), null); assert.equal(document.activeElement, find('[data-title-navigation]'), 'Replacing a focused title or chapter panel never retains a disconnected trigger.');
        const unrelated = find('#reader-back');
        click(find('[data-title-navigation]')); unrelated.focus(); app.applyState({ ...app.state, revision: 3 });
        assert.equal(find('.reader-toolbar-panel'), null); assert.equal(document.activeElement, unrelated, 'A refresh does not steal focus that has tabbed outside the catalog.');
        click(find('[data-title-navigation]')); unrelated.focus(); app.renderArticle();
        assert.equal(find('.reader-toolbar-panel'), null); assert.equal(document.activeElement, unrelated, 'Article rendering preserves unrelated control focus.');

        mount(current);
        let resolvePage;
        app.fetchJson = () => new Promise(resolve => { resolvePage = resolve; });
        click(find('[data-title-navigation]')); click(rows().find(row => row.dataset.chapterPath === last.filePath));
        const outsideInput = find('#reader-page-filter'); outsideInput.focus();
        resolvePage({ revision: 1, filePath: last.filePath, page: last, content: '', labels: {}, symbols: [] }); await drain();
        assert.equal(app.currentPath, last.filePath); assert.equal(document.activeElement, outsideInput, 'A delayed chapter response cannot steal focus from a subsequently focused external input.');

        const bundle = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-title-renderer-'));
        try {
            const output = path.join(bundle, 'renderer.cjs');
            await build({ entryPoints: [path.join(root, 'src/reader/web/formal-renderer.ts')], outfile: output, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' });
            const renderer = require(output), markdown = renderer.createFormalRenderer();
            h.setInlineRenderer((source, options) => renderer.renderFormalInline(markdown, source, options));
            const linked = { ...draftA, title: '[**Notebook $x+y$**](https://example.com/source)' };
            const linkedSibling = { ...draftASibling, title: '[Next **linked** page](https://example.com/next)' };
            const linkedPages = [linked, linkedSibling, draftB];
            mount(linked, linkedPages);
            const title = find('[data-title-navigation]');
            assert.equal(title.querySelector('a'), null); assert.equal(title.querySelector('[href]'), null);
            assert.ok(title.querySelector('strong')); assert.ok(title.querySelector('.katex'), 'Unwrapping real Markdown links retains emphasis and rendered title math.');
            assert.equal(title.querySelector('.katex-error'), null);
            assert.equal(title.querySelector('[tabindex]'), null, 'A linked title creates one native title control without a nested tab stop.');
            click(title);
            for (const row of rows()) { assert.equal(row.querySelector('a'), null); assert.equal(row.querySelector('[href]'), null); assert.equal(row.querySelector('[tabindex]'), null); }
            assert.ok(rows()[0].querySelector('.katex')); assert.ok(rows()[1].querySelector('strong'));
            app.fetchJson = async route => { const filePath = decodeURIComponent(route.split('?path=')[1]); return { revision: 1, filePath, page: linkedPages.find(page => page.filePath === filePath), content: '', labels: {}, symbols: [] }; };
            rows()[1].focus(); key('Enter'); await drain();
            assert.equal(app.currentPath, linkedSibling.filePath); assert.equal(find('.reader-toolbar-panel'), null);
            assert.equal(h.historyEvents.at(-1).state.filePath, linkedSibling.filePath, 'Linked labels activate the Reader chapter route rather than their external href.');
        } finally { await fs.rm(bundle, { recursive: true, force: true }); }

        app.fetchJson = async () => ({ report: {} });
        await app.openSymbolAuditReport('replace');
        assert.equal(find('[data-title-navigation]'), null, 'A symbol audit report title is not presented as a book chapter.');
        app.openTitleNavigation(previousTitle); assert.equal(find('.reader-chapter-list'), null);
        console.log('Reader title chapter navigation: key isolation, bilingual labels, ordering, independent stage/outline actions, history and focused popover lifecycle passed.');
    } finally { app.toolbarPanel.dispose(); app.toolbarMenu.dispose(); h.restore(); }
}

export async function testReaderToolbarMenu() {
    const h = await harness(), { app, document, find, click, key } = h;
    try {
    const menu = find('#reader-category-menu'), primary = find('.reader-tools');
    const categories = ['reference', 'review', 'edition', 'display'];
    const trigger = category => find('[data-tool-menu="' + category + '"]');
    const group = category => find('#reader-menu-' + category).parentElement;
    const assertOpen = category => {
        assert.equal(menu.hidden, false); assert.equal(menu.getAttribute('aria-labelledby'), trigger(category).id);
        for (const candidate of categories) {
            assert.equal(group(candidate).hidden, candidate !== category, 'Only the selected category appears.');
            assert.equal(trigger(candidate).getAttribute('aria-expanded'), String(candidate === category));
        }
    };
    assert.deepEqual(primary.querySelectorAll('button').map(button => button.id || button.dataset.panel), ['reader-lean-review', 'contents', 'reader-reference-tools', 'reader-review-tools', 'reader-edition-tools', 'reader-display-tools', 'reader-expand']);
    assert.equal(find('#reader-more'), null, 'There is no global More action.');
    assert.equal(primary.querySelectorAll('[data-tool-menu]').length, 4);
    assert.equal(find('.reader-toolbar').contains(find('.reader-type-control')), false, 'Font controls no longer consume primary toolbar width.');
    for (const category of categories) {
        assert.equal(trigger(category).getAttribute('aria-haspopup'), 'menu'); assert.equal(trigger(category).getAttribute('aria-controls'), menu.id);
        assert.equal(trigger(category).getAttribute('aria-expanded'), 'false');
    }
    assert.equal(menu.hidden, true);
    assert.deepEqual(menu.querySelectorAll('.reader-menu-heading').map(group => group.textContent), ['查阅', '审阅', '版本与出版', '显示']);
    assert.equal(menu.querySelectorAll('button').length, 9, 'Every secondary action exists once, with no hidden duplicate action wiring.');
    for (const button of menu.querySelectorAll('.reader-menu-item')) { assert.ok(button.querySelector('svg')); assert.ok(button.querySelector('.reader-tool-name').textContent); }

    trigger('reference').focus(); key('Enter'); assertOpen('reference');
    assert.equal(document.activeElement.dataset.panel, 'definitions');
    key('ArrowDown'); assert.equal(document.activeElement.dataset.panel, 'symbols');
    key('End'); assert.equal(document.activeElement.dataset.panel, 'symbols');
    key('ArrowDown'); assert.equal(document.activeElement.dataset.panel, 'definitions', 'Down wraps to the first available item.');
    key('ArrowUp'); assert.equal(document.activeElement.dataset.panel, 'symbols', 'Roving focus never enters an inactive category.');
    key('Home'); assert.equal(document.activeElement.dataset.panel, 'definitions');
    assert.equal(menu.querySelectorAll('button').filter(button => button.tabIndex === 0).length, 1);
    key('Escape'); assert.equal(menu.hidden, true); assert.equal(document.activeElement, trigger('reference'));
    key('ArrowUp'); assert.equal(document.activeElement.dataset.panel, 'symbols');
    const tab = key('Tab'); assert.equal(tab.defaultPrevented, false); assert.equal(menu.hidden, true); assert.equal(document.activeElement, trigger('reference'), 'Tab resumes normal document order at the category launcher.');
    click(trigger('reference')); click(trigger('review')); assertOpen('review');
    assert.equal(document.activeElement.dataset.panel, 'propositions', 'Switching category focuses its first item.');
    key('End'); assert.equal(document.activeElement.dataset.panel, 'symbol-audit');
    click(trigger('review')); assert.equal(menu.hidden, true, 'The active category toggles closed.');
    click(trigger('display')); key('End'); assert.equal(document.activeElement.dataset.fontSize, '1');
    const shiftTab = key('Tab', { shiftKey: true }); assert.equal(shiftTab.defaultPrevented, false); assert.equal(document.activeElement, trigger('display'));
    click(trigger('reference')); click(app.article); assert.equal(menu.hidden, true); assert.equal(document.activeElement, app.article, 'Outside dismissal does not steal focus.');

    app.page = { page: { documentMode: 'draft' } }; app.updateDraftToolbarAvailability();
    app.state.projectId = ''; app.updateToolbarLabels(); click(trigger('reference'));
    assert.equal(document.activeElement, menu, 'An all-disabled category keeps an accessible Escape/Tab target.');
    key('ArrowDown'); key('Home'); assert.equal(document.activeElement, menu);
    assert.equal(find('#reader-publication').disabled, true); assert.equal(find('#reader-lean-review').disabled, true);
    const before = h.populated.length; click(find('[data-panel="definitions"]'));
    assert.equal(h.populated.length, before); assert.equal(menu.hidden, false);
    click(trigger('review')); assertOpen('review'); assert.equal(document.activeElement, menu);
    key('Escape'); assert.equal(document.activeElement, trigger('review'));
    click(trigger('edition')); assertOpen('edition');
    assert.equal(document.activeElement.id, 'reader-archive', 'History remains reachable on drafts.');
    key('ArrowDown'); assert.equal(document.activeElement.id, 'reader-archive', 'Unavailable publication is skipped without entering a hidden group.');
    assert.equal(find('[data-panel="propositions"]').querySelector('.reader-tool-name').textContent, '命题审阅');
    assert.equal(find('[data-panel="propositions"]').getAttribute('aria-label'), h.words.zh.draftFormalToolsUnavailable);

    app.page = { page: { documentMode: 'formal' } }; app.state.projectId = 'project-a';
    for (const language of ['en', 'zh']) {
        app.state.language = language; app.updateToolbarLabels();
        for (const [category, label] of [['reference', 'toolsReference'], ['review', 'toolsReview'], ['edition', 'toolsEdition'], ['display', 'toolsDisplay']]) {
            assert.equal(trigger(category).getAttribute('aria-label'), h.words[language][label]);
            assert.equal(trigger(category).dataset.readerTooltip, h.words[language][label]);
            assert.equal(find('#reader-menu-' + category).textContent, h.words[language][label]);
        }
        assert.equal(find('[data-panel="definitions"]').querySelector('.reader-tool-name').textContent, h.words[language].definitions);
        assert.equal(find('#reader-archive').querySelector('.reader-tool-name').textContent, h.words[language].versionHistory);
        assert.equal(find('#reader-publication').querySelector('.reader-tool-name').textContent, h.words[language].pdfPublication);
        assert.equal(menu.hidden, false, 'Translation updates the same open menu tree.');
    }
    key('End'); assert.equal(document.activeElement.id, 'reader-publication', 'Availability changes update the active category focus list.');
    click(trigger('display')); assertOpen('display');
    const beforeHiddenAction = h.populated.length;
    find('[data-panel="definitions"]').emit('click');
    assert.equal(h.populated.length, beforeHiddenAction, 'An inactive category cannot dispatch an action through the shared popup.');
    assertOpen('display');
    const lines = find('#reader-line-numbers');
    assert.equal(lines.getAttribute('role'), 'menuitemcheckbox'); assert.equal(lines.getAttribute('aria-haspopup'), null);
    click(lines); assert.equal(lines.getAttribute('aria-checked'), 'true'); assert.equal(menu.hidden, false);
    assert.equal(app.article.classList.contains('shows-source-line-numbers'), true);
    click(find('[data-font-size="1"]')); assert.equal(find('#reader-font-size').textContent, '19px'); assert.equal(menu.hidden, false);
    app.updateFontSize(24, false); assert.equal(find('[data-font-size="1"]').disabled, true);
    assert.equal(document.activeElement.dataset.fontSize, '-1', 'A newly disabled font button transfers focus within Display.');
    app.updateFontSize(12, false); assert.equal(find('[data-font-size="-1"]').disabled, true);
    assert.equal(document.activeElement.dataset.fontSize, '1');
    app.updateFontSize(18, false); key('Escape'); assert.equal(document.activeElement, trigger('display')); click(trigger('display'));
    assert.equal(lines.getAttribute('aria-checked'), 'true'); assert.equal(find('#reader-font-size').textContent, '18px', 'Display settings survive reopening the menu.');
    for (const button of find('.reader-type-control').querySelectorAll('button')) {
        assert.ok(button.dataset.readerTooltip); assert.equal(button.dataset.tooltip, undefined, 'Font hover hints cannot create pseudo-element overflow inside the scrolling menu.');
    }

    for (const [view, category] of [['definitions', 'reference'], ['symbols', 'reference'], ['propositions', 'review'], ['symbol-audit', 'review']]) {
        if (trigger(category).getAttribute('aria-expanded') !== 'true') click(trigger(category));
        const action = find('[data-panel="' + view + '"]'); click(action);
        const panel = find('.reader-toolbar-panel');
        assert.equal(menu.hidden, true); assert.equal(trigger(category).getAttribute('aria-expanded'), 'false');
        assert.equal(panel.getAttribute('aria-label'), h.words.zh[view === 'symbol-audit' ? 'symbolAudit' : view]);
        assert.ok(panel.contains(document.activeElement), 'Keyboard focus enters the visible panel after the menu item is hidden.');
        assert.equal(app.toolbarMenu.anchorFor(action), trigger(category), 'Ownership survives capture close.');
        assert.equal(app.toolbarPanel.anchor, trigger(category), 'The application passes the owning category as its visible anchor.');
        assert.equal(panel.style.top, '52px', 'Secondary panels anchor below the visible category button, not the hidden item’s zero rectangle.');
        key('Escape'); assert.equal(find('.reader-toolbar-panel'), null); assert.equal(document.activeElement, trigger(category));
    }
    assert.deepEqual(h.populated.slice(-3), ['definitions', 'symbols', 'symbol-audit']);
    for (const id of ['reader-archive', 'reader-publication']) {
        click(trigger('edition')); click(find('#' + id));
        const owner = id === 'reader-archive' ? app.archive : app.publication;
        assert.equal(owner.openCount, 1); assert.equal(owner.returnFocus, trigger('edition'), 'Modal actions capture the edition category as their focus return target.');
        assert.equal(menu.hidden, true); click(trigger('reference')); assert.equal(owner.opened, false, 'Opening any category closes an existing toolbar dialog.');
        key('Escape');
    }
    click(trigger('reference')); click(find('[data-panel="definitions"]')); click(find('#reader-lean-review'));
    assert.equal(find('.reader-toolbar-panel'), null); assert.equal(app.leanReview.opened, true); assert.equal(menu.hidden, true);
    click(trigger('review')); assert.equal(app.leanReview.opened, false); key('Escape');
    const contents = find('[data-panel="contents"]'); click(contents);
    assert.equal(document.activeElement, contents); assert.ok(find('.reader-toolbar-panel')); key('Escape'); assert.equal(document.activeElement, contents);
    app.navigateHistory = direction => h.primaryActions.push(direction < 0 ? 'back' : 'forward');
    click(find('#reader-back')); click(find('#reader-forward')); click(find('#reader-expand'));
    assert.deepEqual(h.primaryActions, ['back', 'forward', 'expand'], 'Back, forward and embedded fullscreen remain directly wired.');

    click(trigger('display'));
    app.state.pages = [{ filePath: 'book/02.md' }]; app.selectedPagePaths = []; app.pageRequestId = 0;
    let rejectPage; app.fetchJson = () => new Promise((_resolve, reject) => { rejectPage = reject; });
    const navigation = app.openPage('book/02.md', 'push');
    assert.equal(menu.hidden, true, 'Navigation dismisses the old page’s menu before waiting for the next page.');
    rejectPage(new Error('Page request canceled by fixture')); await assert.rejects(navigation, /canceled by fixture/);
    click(trigger('display')); h.window.innerHeight = 270; h.window.emit('resize');
    assert.equal(menu.style.maxHeight, '246px'); assert.equal(menu.style.maxWidth, '280px');
    assert.ok(Number.parseFloat(menu.style.left) >= 12); assert.ok(Number.parseFloat(menu.style.top) >= 12);
    const previousRenderNavigation = app.renderNavigation; app.renderNavigation = () => {};
    app.applyState({ ...app.state, projectId: 'project-b' }); app.renderNavigation = previousRenderNavigation;
    assert.equal(menu.hidden, true, 'A project switch dismisses the previous project’s menu.');
    app.toolbarMenu.dispose(); app.toolbarPanel.dispose();
    assert.equal(find('#reader-category-menu'), null);
    for (const category of categories) {
        assert.equal((trigger(category).listeners.get('click') || []).length, 0); assert.equal((trigger(category).listeners.get('keydown') || []).length, 0);
    }
    assert.equal((document.listeners.get('pointerdown') || []).length, 0); assert.equal((document.listeners.get('keydown') || []).length, 0);
    assert.equal((h.window.listeners.get('resize') || []).length, 1, 'Only the original application resize handler remains.');
    console.log('Reader category toolbar menus: keyboard, switching, actions, localization, state and category anchors passed.');
    } finally { h.restore(); }
    await documentStageUiContract();
    await titleNavigationContract();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderToolbarMenu();
