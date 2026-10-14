import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
        if (this.id === 'reader-more') return { left: 270, right: 302, top: 12, bottom: 44, width: 32, height: 32 };
        return { left: 12, right: 292, top: 52, bottom: 532, width: 280, height: 480 };
    }
}

async function harness() {
    const document = new EventTarget();
    document.createElement = tag => new Element(tag, document);
    document.createElementNS = (_, tag) => document.createElement(tag);
    document.createTextNode = text => { const node = document.createElement('#text'); node.textContent = text; return node; };
    document.body = document.createElement('body'); document.body.parent = document; document.activeElement = document.body;
    const previousDocument = globalThis.document; globalThis.document = document;
    const window = new EventTarget(); window.innerWidth = 320; window.innerHeight = 700;
    window.setTimeout = () => 1; window.clearTimeout = () => {};
    class Owner {
        opened = false; openCount = 0;
        constructor(...args) { this.host = args.at(-1); }
        bind() {} contextChanged() {} navigationStarted() {}
        close() { this.opened = false; }
        open() { this.opened = true; this.openCount++; this.returnFocus = document.activeElement; }
        openPageQueue() { this.open(); }
        render(parent) { parent.append(document.createElement('button')); }
    }
    const modules = {
        lucide: require('lucide'),
        './reader-route': { isReaderEmbedded: () => true },
        './reader-host': { expandReader() {} },
        './reader-embed': { readerViewStateChanged() {} },
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
            { exports, require: name => modules[name] || {}, document, window, Element, HTMLElement: Element, Node: Element, console,
                localStorage: { setItem() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
        modules[name] = exports; return exports;
    }
    await load('reader-icons.ts', './reader-icons');
    await load('reader-popover.ts', './reader-popover');
    await load('reader-toolbar-menu.ts', './reader-toolbar-menu');
    await load('reader-toolbar-panel.ts', './reader-toolbar-panel');
    const { ReaderApplication, words } = await load('main.ts', './main', '\nexports.ReaderApplication = ReaderApplication; exports.words = words;');
    const app = Object.create(ReaderApplication.prototype); app.root = document.createElement('main'); document.body.append(app.root);
    app.state = { language: 'zh', projectId: 'project-a', revision: 1, pages: [], definitions: [] };
    app.currentPath = 'book/01.md'; app.fontSize = 18; app.sourceLineNumbersVisible = false;
    app.buildShell(); app.installHandlers(); app.updateToolbarLabels();
    const populated = [];
    for (const [method, view] of [['renderContents', 'contents'], ['renderDefinitions', 'definitions'], ['renderSymbols', 'symbols'], ['renderSymbolAudit', 'symbol-audit']]) {
        app[method] = container => { populated.push(view); const item = document.createElement('button'); item.textContent = view; container.append(item); };
    }
    const find = selector => app.root.querySelector(selector) || document.body.querySelector(selector);
    const click = element => { if (element.disabled) return; element.emit('pointerdown'); element.focus(); element.emit('click'); };
    const key = key => { const event = document.activeElement.emit('keydown', { key });
        if (!event.defaultPrevented && ['Enter', ' '].includes(key) && document.activeElement.tagName === 'button' && !document.activeElement.disabled) document.activeElement.emit('click'); return event; };
    return { app, document, window, words, populated, find, click, key, restore: () => { globalThis.document = previousDocument; } };
}

export async function testReaderToolbarMenu() {
    const h = await harness(), { app, document, find, click, key } = h;
    try {
    const more = find('#reader-more'), menu = find('#reader-more-menu'), primary = find('.reader-tools');
    assert.deepEqual(primary.querySelectorAll('button').map(button => button.id || button.dataset.panel), ['reader-lean-review', 'contents', 'reader-expand', 'reader-more']);
    assert.equal(find('.reader-toolbar').contains(find('.reader-type-control')), false, 'Font controls no longer consume primary toolbar width.');
    assert.equal(more.getAttribute('aria-haspopup'), 'menu'); assert.equal(more.getAttribute('aria-controls'), menu.id);
    assert.equal(menu.hidden, true); assert.equal(more.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(menu.querySelectorAll('.reader-menu-heading').map(group => group.textContent), ['查阅', '审阅', '版本与出版', '显示']);
    assert.equal(menu.querySelectorAll('button').length, 9, 'Every secondary action exists once, with no hidden duplicate action wiring.');
    for (const button of menu.querySelectorAll('.reader-menu-item')) { assert.ok(button.querySelector('svg')); assert.ok(button.querySelector('.reader-tool-name').textContent); }

    more.focus(); key('Enter');
    assert.equal(menu.hidden, false); assert.equal(more.getAttribute('aria-expanded'), 'true');
    assert.equal(document.activeElement.dataset.panel, 'definitions');
    key('ArrowDown'); assert.equal(document.activeElement.dataset.panel, 'symbols');
    key('End'); assert.equal(document.activeElement.dataset.fontSize, '1');
    key('ArrowDown'); assert.equal(document.activeElement.dataset.panel, 'definitions', 'Down wraps to the first available item.');
    key('ArrowUp'); assert.equal(document.activeElement.dataset.fontSize, '1');
    key('Home'); assert.equal(document.activeElement.dataset.panel, 'definitions');
    assert.equal(menu.querySelectorAll('button').filter(button => button.tabIndex === 0).length, 1);
    key('Escape'); assert.equal(menu.hidden, true); assert.equal(document.activeElement, more);
    key('ArrowUp'); assert.equal(document.activeElement.dataset.fontSize, '1');
    const tab = key('Tab'); assert.equal(tab.defaultPrevented, false); assert.equal(menu.hidden, true); assert.equal(document.activeElement, more, 'Tab resumes normal document order at the visible launcher.');
    click(more); click(app.article); assert.equal(menu.hidden, true); assert.equal(document.activeElement, app.article, 'Outside dismissal does not steal focus.');

    app.page = { page: { documentMode: 'draft' } }; app.updateDraftToolbarAvailability();
    app.state.projectId = ''; app.updateToolbarLabels(); click(more);
    assert.equal(document.activeElement.id, 'reader-archive', 'Roving focus skips draft-only tools and keeps history reachable.');
    assert.equal(find('#reader-publication').disabled, true); assert.equal(find('#reader-lean-review').disabled, true);
    const before = h.populated.length; click(find('[data-panel="definitions"]'));
    assert.equal(h.populated.length, before); assert.equal(menu.hidden, false);
    key('ArrowDown'); assert.equal(document.activeElement.id, 'reader-line-numbers', 'Unavailable publication is skipped.');
    assert.equal(find('[data-panel="propositions"]').querySelector('.reader-tool-name').textContent, '命题审阅');
    assert.equal(find('[data-panel="propositions"]').getAttribute('aria-label'), h.words.zh.draftFormalToolsUnavailable);

    app.page = { page: { documentMode: 'formal' } }; app.state.projectId = 'project-a';
    for (const language of ['en', 'zh']) {
        app.state.language = language; app.updateToolbarLabels();
        assert.equal(more.getAttribute('aria-label'), h.words[language].moreTools);
        assert.equal(find('[data-panel="definitions"]').querySelector('.reader-tool-name').textContent, h.words[language].definitions);
        assert.equal(find('#reader-archive').querySelector('.reader-tool-name').textContent, h.words[language].versionHistory);
        assert.equal(find('#reader-publication').querySelector('.reader-tool-name').textContent, h.words[language].pdfPublication);
        assert.equal(menu.hidden, false, 'Translation updates the same open menu tree.');
    }
    const lines = find('#reader-line-numbers');
    assert.equal(lines.getAttribute('role'), 'menuitemcheckbox'); assert.equal(lines.getAttribute('aria-haspopup'), null);
    click(lines); assert.equal(lines.getAttribute('aria-checked'), 'true'); assert.equal(menu.hidden, false);
    assert.equal(app.article.classList.contains('shows-source-line-numbers'), true);
    click(find('[data-font-size="1"]')); assert.equal(find('#reader-font-size').textContent, '19px'); assert.equal(menu.hidden, false);
    app.updateFontSize(24, false); assert.equal(find('[data-font-size="1"]').disabled, true);
    app.updateFontSize(12, false); assert.equal(find('[data-font-size="-1"]').disabled, true);
    app.updateFontSize(18, false); key('Escape'); click(more);
    assert.equal(lines.getAttribute('aria-checked'), 'true'); assert.equal(find('#reader-font-size').textContent, '18px', 'Display settings survive reopening the menu.');
    for (const button of find('.reader-type-control').querySelectorAll('button')) {
        assert.ok(button.dataset.readerTooltip); assert.equal(button.dataset.tooltip, undefined, 'Font hover hints cannot create pseudo-element overflow inside the scrolling menu.');
    }

    for (const view of ['definitions', 'symbols', 'propositions', 'symbol-audit']) {
        if (menu.hidden) click(more);
        const action = find('[data-panel="' + view + '"]'); click(action);
        const panel = find('.reader-toolbar-panel');
        assert.equal(menu.hidden, true); assert.equal(more.getAttribute('aria-expanded'), 'false');
        assert.equal(panel.getAttribute('aria-label'), h.words.zh[view === 'symbol-audit' ? 'symbolAudit' : view]);
        assert.ok(panel.contains(document.activeElement), 'Keyboard focus enters the visible panel after the menu item is hidden.');
        assert.equal(panel.style.top, '52px', 'Secondary panels anchor below the visible More button, not the hidden item’s zero rectangle.');
        key('Escape'); assert.equal(find('.reader-toolbar-panel'), null); assert.equal(document.activeElement, more);
    }
    assert.deepEqual(h.populated.slice(-3), ['definitions', 'symbols', 'symbol-audit']);
    for (const id of ['reader-archive', 'reader-publication']) {
        click(more); click(find('#' + id));
        const owner = id === 'reader-archive' ? app.archive : app.publication;
        assert.equal(owner.openCount, 1); assert.equal(owner.returnFocus, more, 'Modal actions capture More as their focus return target.');
        assert.equal(menu.hidden, true); click(more); assert.equal(owner.opened, false, 'Opening More closes an existing toolbar dialog.');
        key('Escape');
    }
    click(more); click(find('[data-panel="definitions"]')); click(find('#reader-lean-review'));
    assert.equal(find('.reader-toolbar-panel'), null); assert.equal(app.leanReview.opened, true); assert.equal(menu.hidden, true);
    click(more); assert.equal(app.leanReview.opened, false); key('Escape');
    const contents = find('[data-panel="contents"]'); click(contents);
    assert.equal(document.activeElement, contents); assert.ok(find('.reader-toolbar-panel')); key('Escape'); assert.equal(document.activeElement, contents);

    click(more); h.window.innerHeight = 270; h.window.emit('resize');
    assert.equal(menu.style.maxHeight, '246px'); assert.equal(menu.style.maxWidth, '280px');
    assert.ok(Number.parseFloat(menu.style.left) >= 12); assert.ok(Number.parseFloat(menu.style.top) >= 12);
    const previousRenderNavigation = app.renderNavigation; app.renderNavigation = () => {};
    app.applyState({ ...app.state, projectId: 'project-b' }); app.renderNavigation = previousRenderNavigation;
    assert.equal(menu.hidden, true, 'A project switch dismisses the previous project’s menu.');
    app.toolbarMenu.dispose(); app.toolbarPanel.dispose();
    assert.equal(find('#reader-more-menu'), null);
    assert.equal((document.listeners.get('pointerdown') || []).length, 0); assert.equal((document.listeners.get('keydown') || []).length, 0);
    assert.equal((h.window.listeners.get('resize') || []).length, 1, 'Only the original application resize handler remains.');
    console.log('Reader grouped toolbar menu keyboard, action, localization, state and anchor contracts passed.');
    } finally { h.restore(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderToolbarMenu();
