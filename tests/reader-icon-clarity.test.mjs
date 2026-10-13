import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// No browser is launched: production renderers run against a small DOM surface.
class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.style = { setProperty(name, value) { this[name] = value; } }; this.className = ''; this._text = ''; this.disabled = false;
        this.classList = { add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].filter(Boolean).join(' '); },
            remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
            contains: name => this.className.split(' ').includes(name), toggle: (name, force) => { if (force ?? !this.classList.contains(name)) this.classList.add(name); else this.classList.remove(name); } }; }
    append(...children) { children.forEach(child => { child.remove?.(); child.parent = this; this.children.push(child); }); }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { this.children.forEach(child => { child.parent = undefined; }); this.children = []; this._text = ''; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
    set textContent(text) { this.replaceChildren(); this._text = String(text); } get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    get childNodes() { return this.children; } get isConnected() { return this.tagName === 'body' || Boolean(this.parent?.isConnected); }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = String(value); if (name === 'id') this.id = String(value); }
    getAttribute(name) { if (name === 'class') return this.className; return this.attributes[name] ?? null; } removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); } removeEventListener() {}
    async emit(name, value = {}) { for (const callback of this.listeners[name] || []) await callback({ target: this, ...value }); }
    contains(other) { return other === this || this.children.some(child => child.contains(other)); }
    matches(selector) {
        const attr = selector.match(/\[([\w-]+)(?:="([^"]*)")?\]/);
        if (attr) { const key = attr[1].startsWith('data-') ? attr[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : '';
            const value = key ? this.dataset[key] : this.getAttribute(attr[1]); if (value === undefined || value === null || (attr[2] !== undefined && value !== attr[2])) return false; }
        const simple = selector.replace(/\[[^\]]*\]/g, '');
        if (simple.startsWith('#')) return this.id === simple.slice(1);
        if (simple.startsWith('.')) return simple.slice(1).split('.').every(name => this.classList.contains(name));
        return !simple || this.tagName.toLowerCase() === simple.toLowerCase();
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return { x: 12, y: 12, left: 12, top: 12, right: 132, bottom: 44, width: 120, height: 32 }; }
}

async function harness() {
    const document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: value => { const node = new Element('#text'); node.textContent = value; return node; },
        addEventListener() {}, removeEventListener() {}, body: new Element('body') };
    const modules = { lucide: require('lucide'), './reader-clipboard': { copyReaderText: async value => { copied.push(value); return true; } } }, copied = [];
    const window = { innerWidth: 320, innerHeight: 700, getSelection: () => undefined, addEventListener() {}, removeEventListener() {}, setTimeout: () => 1, clearTimeout() {} };
    async function load(file, name, expose = '') {
        let source = await fs.readFile(path.join(root, file), 'utf8');
        // Expose existing owners for isolated tests without starting the application or altering production exports.
        if (file.endsWith('/main.ts')) source = source.replace(/\nstartReader\(\);\s*$/, '\n');
        const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
        const exports = {}; vm.runInNewContext(output + expose, { exports, document, window, Element, Node: { ELEMENT_NODE: 1 }, console,
            require: value => modules[value] || {}, setTimeout: () => 1, clearTimeout() {} }); modules[name] = exports; return exports;
    }
    const icons = await load('src/reader/web/reader-icons.ts', './reader-icons');
    await load('src/reader/web/reader-popover.ts', './reader-popover');
    const { ReaderSourceActions } = await load('src/reader/web/source-actions.ts', './source-actions');
    const { ReaderApplication, words } = await load('src/reader/web/main.ts', './main', '\nexports.ReaderApplication = ReaderApplication; exports.words = words;');
    const { renderLeanAnchorBadge } = await load('src/reader/web/formal-renderer.ts', './formal-renderer', '\nexports.renderLeanAnchorBadge = renderLeanAnchorBadge;');
    const { ReaderPropositionReview } = await load('src/reader/web/reader-proposition-review.ts', './reader-proposition-review');
    const { archiveAction } = await load('src/reader/web/reader-archive.ts', './reader-archive', '\nexports.archiveAction = iconButton;');
    return { document, window, copied, icons, ReaderSourceActions, ReaderApplication, words, renderLeanAnchorBadge, ReaderPropositionReview, archiveAction };
}

async function toolbarAndIconContract(h) {
    const app = Object.create(h.ReaderApplication.prototype); app.root = new Element('main'); app.state = { language: 'zh' }; app.currentPath = 'book/01.md'; app.sourceLineNumbersVisible = false;
    const tools = new Element('div'); tools.className = 'reader-tools'; app.root.append(tools);
    for (const id of ['reader-back', 'reader-forward', 'reader-navigation-toggle', 'reader-expand', 'reader-archive', 'reader-lean-review', 'reader-line-numbers']) {
        const button = new Element('button'); button.id = id; (['reader-back', 'reader-forward', 'reader-navigation-toggle'].includes(id) ? app.root : tools).append(button);
    }
    const type = new Element('div'); type.className = 'reader-type-control'; app.root.append(type);
    for (const value of ['-1', '1']) { const button = new Element('button'); button.dataset.fontSize = value; type.append(button); }
    for (const panel of ['contents', 'definitions', 'symbols', 'propositions', 'symbol-audit']) { const button = new Element('button'); button.dataset.panel = panel; tools.append(button); }
    app.installToolbarIcons(); app.updateToolbarLabels();
    const lean = tools.querySelector('#reader-lean-review'); assert.equal(lean.textContent, 'Lean 对照'); assert.equal(lean.getAttribute('aria-label'), 'Lean 对照');
    assert.equal(lean.querySelector('path').getAttribute('d'), 'M12 3v18', 'Lean comparison uses a distinct equal-column symbol.');
    assert.equal(tools.querySelector('[data-panel="propositions"]').textContent, '命题审阅');
    assert.equal(tools.querySelector('[data-panel="symbol-audit"]').textContent, '符号审计');
    for (const selector of ['[data-panel="contents"]', '[data-panel="definitions"]', '[data-panel="symbols"]', '#reader-archive']) assert.equal(tools.querySelector(selector).textContent, '', 'Familiar toolbar icons stay compact.');
    assert.equal(tools.querySelector('#reader-expand').getAttribute('aria-label'), '全屏阅读');
    assert.equal(tools.querySelector('#reader-expand').textContent, '', 'A four-corner fullscreen icon replaces the external-link arrow.');
    for (const button of tools.children) { assert.ok(button.dataset.readerTooltip, 'Scrolling toolbar uses viewport tooltips.'); assert.equal(button.dataset.tooltip, undefined); }
    for (const svg of tools.querySelectorAll('svg')) { assert.equal(svg.getAttribute('aria-hidden'), 'true'); assert.equal(svg.getAttribute('focusable'), 'false'); }
    app.state.language = 'en'; app.updateToolbarLabels();
    assert.equal(lean.textContent, 'Lean comparison'); assert.equal(tools.querySelector('[data-panel="propositions"]').textContent, 'Proposition review');
    assert.equal(tools.querySelector('#reader-expand').dataset.readerTooltip, 'Full screen');
    app.page = { page: { documentMode: 'draft' } }; app.updateDraftToolbarAvailability();
    assert.equal(lean.disabled, true); assert.equal(lean.textContent, 'Lean comparison', 'Disabled states retain the visible action name.');
    assert.equal(lean.dataset.readerTooltip, h.words.en.draftFormalToolsUnavailable);
    assert.notDeepEqual(h.icons.readerIcon('lean-compare').children.map(node => node.attributes), h.icons.readerIcon('compare').children.map(node => node.attributes));
}

async function sourceAndArchiveActions(h) {
    for (const language of ['zh', 'en']) {
        const words = h.words[language], quoted = [];
        const actions = new h.ReaderSourceActions({ labels: () => ({ ...words, locate: words.jump, failed: words.sourceActionFailed }), getDefinitions: () => [],
            canReference: () => true, reference: async (...args) => { quoted.push(args); } });
        actions.sourceDocument = { filePath: 'book/01.md', source: 'paragraph', formulas: [] };
        actions.selectedSource = () => ({ text: 'selected', markdown: '**selected**', sourceLines: 'whole source line', rect: new Element('span').getBoundingClientRect(), startLine: 4, endLine: 6 });
        actions.showSelectionActions();
        const popover = h.document.body.querySelector('.reader-source-popover'), buttons = popover.querySelectorAll('button');
        assert.deepEqual(buttons.map(button => button.textContent), [words.copySelectedMarkdown, words.copySourceLines, words.reference]);
        assert.match(buttons[2].textContent, /Codex/);
        await buttons[0].emit('click'); await buttons[1].emit('click'); await buttons[2].emit('click');
        assert.deepEqual(h.copied.slice(-2), ['**selected**', 'whole source line']); assert.equal(quoted[0][0].startLine, 4); assert.equal(quoted[0][0].endLine, 6);
        actions.showFormulaActions({ id: 'formula', latex: 'x^2', source: '$x^2$', sourceStartLine: 8, sourceEndLine: 8 }, new Element('span').getBoundingClientRect());
        const formulaButtons = h.document.body.querySelector('.reader-source-popover').querySelectorAll('button');
        assert.equal(formulaButtons[0].textContent, words.copyLatex); await formulaButtons[0].emit('click'); assert.equal(h.copied.at(-1), 'x^2');
        actions.host.canReference = () => false; actions.showFormulaActions({ id: 'formula', latex: 'x', source: '$x$', sourceStartLine: 8, sourceEndLine: 8 }, new Element('span').getBoundingClientRect());
        const disabled = h.document.body.querySelector('.reader-source-reference'); assert.equal(disabled.disabled, true); assert.equal(disabled.textContent, words.reference); assert.match(disabled.getAttribute('aria-label'), /Codex/);
        actions.dispose();
    }
    let invoked = 0;
    for (const [icon, label] of [['verify', '验证签名'], ['download', 'Export evidence'], ['compare', 'Compare versions']]) {
        const action = h.archiveAction(label, icon, () => { invoked++; }); assert.equal(action.textContent, label); assert.ok(action.classList.contains('has-action-label')); await action.emit('click');
    }
    assert.equal(invoked, 3); assert.equal(h.archiveAction('Close', 'x', () => {}).textContent, '');
}

async function anchorSemantics(h) {
    const status = { contract: 'current', build: 'unverified', dependencies: 'unverified' };
    for (const language of ['zh', 'en']) {
        const html = h.renderLeanAnchorBadge('h-anchor', 2, status, language);
        assert.match(html, />Lean<\/button>/); assert.match(html, /data-reader-lean-anchor="h-anchor"/); assert.doesNotMatch(html, />L<|✓|✔/);
        assert.match(html, /未记录构建|build unverified/);
    }
    const marker = { upstream: [], downstream: [], directDependencies: 0, directDependents: 0, transitiveDependents: 0, ambientReferenceCount: 0, leanDeclarationCount: 1 };
    const labels = { graphHint: h.words.en.propositionReviewGraphHint, graphTitle: 'Graph', hub: 'Hub', linked: 'Linked', terminal: 'Terminal', isolated: 'Isolated', terminalPropositions: 'Terminal propositions', terminalPropositionSummary: count => `${count}`, terminalPropositionHint: 'Review', nodeLabel: h.words.en.propositionReviewNodeLabel };
    const host = { labels: () => labels, openProposition() {} }, container = new Element('section');
    new h.ReaderPropositionReview(host).render(container, [{ id: 'h-anchor', display: 'Theorem 1', compactDisplay: '1', title: 'Sample', marker }]);
    const badge = container.querySelector('.reader-proposition-map-lean-badge'); assert.equal(badge.querySelector('text').textContent, 'Lean'); assert.equal(badge.querySelector('rect').getAttribute('width'), '29');
    assert.equal(badge.getAttribute('aria-hidden'), 'true'); assert.match(container.querySelector('.reader-proposition-map-node').getAttribute('aria-label'), /Lean anchor with 1 declaration/);
}

export async function testReaderIconClarity() {
    const h = await harness(), previous = globalThis.document; globalThis.document = h.document;
    try {
        await toolbarAndIconContract(h); await sourceAndArchiveActions(h); await anchorSemantics(h);
        const css = await fs.readFile(path.join(root, 'src/reader/web/styles.css'), 'utf8');
        assert.doesNotMatch(css, /is-source-copy|is-line-copy/);
        assert.match(css, /\.reader-toolbar\s*\{[^}]*height: 56px;[^}]*min-height: 56px;/);
        assert.match(css, /\.reader-tools \{[^}]*min-width: 0;[^}]*overflow-x: auto;[^}]*scrollbar-width: thin;/);
        assert.doesNotMatch(css, /\.reader-tools[^}]*scrollbar-width: none/);
        assert.match(css, /\.reader-history, \.reader-type-control \{ flex-shrink: 0;/);
        assert.match(css, /\.reader-tools > button \{ flex: 0 0 auto;/);
        assert.match(css, /\.reader-source-actions \{[^}]*flex-wrap: wrap;/);
        const main = await fs.readFile(path.join(root, 'src/reader/web/main.ts'), 'utf8');
        assert.match(main, /<div class="reader-tools"[^>]*tabindex="0"[^>]*>[\s\S]*?<button id="reader-lean-review"/);
        console.log('Reader icon clarity and labelled action tests passed.');
    } finally { globalThis.document = previous; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderIconClarity();
