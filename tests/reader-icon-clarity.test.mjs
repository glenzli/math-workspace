import { readerUiLabels, installReaderTextNodes } from './reader-ui-harness.mjs';
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
    get childNodes() { return this.children; } get parentElement() { return this.parent; } get isConnected() { return this.tagName === 'body' || Boolean(this.parent?.isConnected); }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = String(value); if (name === 'id') this.id = String(value); }
    getAttribute(name) { if (name === 'class') return this.className; return this.attributes[name] ?? null; } removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); } removeEventListener(name, callback) { this.listeners[name] = (this.listeners[name] || []).filter(value => value !== callback); }
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
    closest(selector) { for (let element = this; element; element = element.parent) if (element.matches(selector)) return element; return null; }
    getBoundingClientRect() { return { x: 12, y: 12, left: 12, top: 12, right: 132, bottom: 44, width: 120, height: 32 }; }
    focus() { this.focused = true; }
}

installReaderTextNodes(Element);

async function harness() {
    const document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: value => { const node = new Element('#text'); node.textContent = value; return node; },
        addEventListener() {}, removeEventListener() {}, body: new Element('body') };
    let uiLanguage = 'zh';
    const preferences = { snapshot: () => ({ language: uiLanguage, languagePreference: uiLanguage, themePreference: 'auto' }), setLanguage(value) { uiLanguage = value; }, setTheme() {} };
    const modules = { './reader-host': { readerExpansionTarget: () => 'fullscreen' }, './reader-ui-labels': readerUiLabels, './reader-preferences': { readerPreferences: preferences }, lucide: require('lucide'), './reader-clipboard': { copyReaderText: async value => { copied.push(value); return true; } } }, copied = [];
    const window = { innerWidth: 320, innerHeight: 700, listeners: {}, getSelection: () => undefined,
        getComputedStyle: element => element.style, addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); },
        removeEventListener(name, callback) { this.listeners[name] = (this.listeners[name] || []).filter(value => value !== callback); },
        emit(name) { for (const callback of this.listeners[name] || []) callback(); }, setTimeout: () => 1, clearTimeout() {} };
    const observers = [];
    class MutationObserver {
        constructor(callback) { this.callback = callback; this.targets = new Map(); observers.push(this); }
        observe(target, options) { this.targets.set(target, options); }
        disconnect() { this.targets.clear(); }
    }
    const notifyMutation = (target, type, attributeName) => { for (const observer of observers) {
        const options = observer.targets.get(target);
        if (options && (type === 'childList' ? options.childList : options.attributes && options.attributeFilter.includes(attributeName))) observer.callback([{ target, type, attributeName }], observer);
    } };
    Element.ELEMENT_NODE = 1;
    async function load(file, name, expose = '') {
        let source = await fs.readFile(path.join(root, file), 'utf8');
        // Expose existing owners for isolated tests without starting the application or altering production exports.
        if (file.endsWith('/main.ts')) source = source.replace(/\nstartReader\(\);\s*$/, '\n');
        const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
        const exports = {}; vm.runInNewContext(output + expose, { exports, document, window, Element, Node: Element, MutationObserver, console,
            require: value => modules[value] || {}, setTimeout: () => 1, clearTimeout() {} }); modules[name] = exports; return exports;
    }
    const icons = await load('src/reader/web/reader-icons.ts', './reader-icons');
    const { ReaderTooltip } = await load('src/reader/web/reader-tooltip.ts', './reader-tooltip');
    await load('src/reader/web/reader-popover.ts', './reader-popover');
    const { ReaderToolbarMenu } = await load('src/reader/web/reader-toolbar-menu.ts', './reader-toolbar-menu');
    const { ReaderSourceActions } = await load('src/reader/web/source-actions.ts', './source-actions');
    const { ReaderApplication, words, documentStatusBadge, documentStatusText } = await load('src/reader/web/main.ts', './main', '\nexports.ReaderApplication = ReaderApplication; exports.words = words; exports.documentStatusBadge = documentStatusBadge; exports.documentStatusText = documentStatusText;');
    const { renderLeanAnchorBadge } = await load('src/reader/web/formal-renderer.ts', './formal-renderer', '\nexports.renderLeanAnchorBadge = renderLeanAnchorBadge;');
    const { ReaderPropositionReview } = await load('src/reader/web/reader-proposition-review.ts', './reader-proposition-review');
    const { archiveAction } = await load('src/reader/web/reader-archive.ts', './reader-archive', '\nexports.archiveAction = iconButton;');
    return { document, window, copied, icons, preferences, ReaderTooltip, ReaderToolbarMenu, observers, notifyMutation, ReaderSourceActions, ReaderApplication, words, documentStatusBadge, documentStatusText, renderLeanAnchorBadge, ReaderPropositionReview, archiveAction };
}

function assertIconOnly(button, label, tooltip = 'tooltip') {
    assert.equal(button.textContent, '', 'Action buttons explain their meaning on hover, without a visible title.');
    assert.equal(button.children.length, 1); assert.equal(button.children[0].tagName, 'svg');
    assert.equal(button.getAttribute('aria-label'), label); assert.equal(button.dataset[tooltip], label);
}

function iconShape(button) {
    return button.querySelector('svg').children.map(node => [node.tagName, node.attributes]);
}

function documentStageContract(h) {
    const stages = [['draft', 'documentStageDraft'], ['revising', 'documentStageRevising'], ['stable', 'documentStageStable']];
    const shapes = [];
    for (const language of ['zh', 'en']) {
        h.preferences.setLanguage(language);
        const words = h.words[language];
        for (const [stage, key] of stages) {
            const expectedIcon = new Element('span'); expectedIcon.append(h.icons.readerIcon('stage-' + stage));
            if (language === 'zh') shapes.push(JSON.stringify(iconShape(expectedIcon)));
            for (const checkpoint of [undefined, { label: 'RC1 <careful> edition' }]) {
                for (const changedSinceCheckpoint of [false, true]) {
                    const page = { documentMode: 'formal', lifecycle: { stage, checkpoint, changedSinceCheckpoint } };
                    const header = h.documentStatusBadge(page, language, true), sidebar = h.documentStatusBadge(page, language);
                    assert.equal(header.querySelector('.reader-document-stage-label').textContent, words[key], 'Milestones and later changes cannot replace the base stage name.');
                    assert.deepEqual(iconShape(header), iconShape(expectedIcon)); assert.deepEqual(iconShape(sidebar), iconShape(expectedIcon));
                    assert.equal(sidebar.textContent, ''); assert.equal(sidebar.getAttribute('aria-hidden'), 'true'); assert.ok(sidebar.classList.contains('is-compact'));
                    const expected = [words[key], checkpoint?.label, checkpoint && changedSinceCheckpoint ? words.documentStageChanged : ''].filter(Boolean).join(' · ');
                    assert.equal(h.documentStatusText(page, language), expected);
                    assert.equal(header.dataset.readerTooltip, sidebar.dataset.readerTooltip); assert.equal(header.getAttribute('aria-label'), header.dataset.readerTooltip);
                    assert.equal(header.dataset.readerTooltip.split(words[key]).length - 1, 1, 'Stage wording appears once in hover/ARIA details.');
                    assert.equal(header.getAttribute('title'), null); assert.equal(header.dataset.tooltip, undefined, 'Header status uses the viewport tooltip.');
                    assert.equal(!!header.querySelector('.reader-document-changed'), !!checkpoint && changedSinceCheckpoint);
                    assert.equal(!!header.querySelector('.reader-document-checkpoint'), !!checkpoint);
                    if (checkpoint) assert.equal(header.querySelector('.reader-document-checkpoint').textContent, '· ' + checkpoint.label);
                    assert.equal(header.querySelector('careful'), null, 'User milestone labels remain plain text.');
                }
            }
        }
        const unset = { documentMode: 'formal' }, unsetHeader = h.documentStatusBadge(unset, language, true);
        const revised = { documentMode: 'formal', lifecycle: { stage: 'revising', changedSinceStable: true } };
        const revisedHeader = h.documentStatusBadge(revised, language, true), revisedSidebar = h.documentStatusBadge(revised, language);
        assert.equal(revisedHeader.querySelector('.reader-document-stage-label').textContent, words.documentStageRevising);
        assert.equal(revisedHeader.querySelector('.reader-document-changed').textContent, '· ' + words.documentStageSinceStable);
        assert.equal(h.documentStatusText(revised, language), words.documentStageRevising + ' · ' + words.documentStageSinceStable);
        assert.equal(revisedHeader.classList.contains('is-changed'), true); assert.equal(revisedSidebar.classList.contains('is-changed'), true);
        assert.equal(h.documentStatusBadge(unset, language), undefined);
        assert.equal(unsetHeader.textContent, words.documentStageUnset); assert.equal(unsetHeader.querySelector('svg'), null, 'Unset stages do not acquire an initial-draft icon.');
        const checkpointOnly = { documentMode: 'formal', lifecycle: { checkpoint: { label: 'v1' }, changedSinceCheckpoint: true } };
        const header = h.documentStatusBadge(checkpointOnly, language, true), sidebar = h.documentStatusBadge(checkpointOnly, language);
        const flag = new Element('span'); flag.append(h.icons.readerIcon('stage-checkpoint'));
        assert.equal(header.querySelector('.reader-document-stage-label').textContent, words.documentStageUnset);
        assert.deepEqual(iconShape(header), iconShape(flag)); assert.deepEqual(iconShape(sidebar), iconShape(flag));
        assert.equal(h.documentStatusText(checkpointOnly, language), `${words.documentStageUnset} · v1 · ${words.documentStageChanged}`);
        assert.equal(header.dataset.readerTooltip.includes(words.documentStageDraft), false); assert.equal(header.dataset.readerTooltip.includes(words.documentStageStable), false);
        const exploratory = { ...checkpointOnly, documentMode: 'draft', lifecycle: { ...checkpointOnly.lifecycle, stage: 'stable' } };
        assert.equal(h.documentStatusBadge(exploratory, language), undefined); assert.equal(h.documentStatusBadge(exploratory, language, true), undefined);
    }
    assert.equal(new Set(shapes).size, 3, 'The three existing stage glyphs remain visually distinct.');
}

async function toolbarAndIconContract(h) {
    h.preferences.setLanguage('zh');
    h.preferences.setLanguage('zh');
    const app = Object.create(h.ReaderApplication.prototype); app.root = new Element('main'); app.state = { language: 'zh', projectId: 'project-a' }; app.currentPath = 'book/01.md'; app.sourceLineNumbersVisible = false;
    const tools = new Element('div'); tools.className = 'reader-tools'; app.root.append(tools);
    for (const id of ['reader-back', 'reader-forward', 'reader-navigation-toggle', 'reader-expand', 'reader-lean-review']) {
        const button = new Element('button'); button.id = id; (['reader-back', 'reader-forward', 'reader-navigation-toggle'].includes(id) ? app.root : tools).append(button);
    }
    const contents = new Element('button'); contents.dataset.panel = 'contents'; tools.append(contents);
    for (const category of ['reference', 'review', 'edition', 'display']) { const trigger = new Element('button'); trigger.dataset.toolMenu = category; trigger.id = 'reader-' + category + '-tools'; tools.append(trigger); }
    app.toolbarMenu = new h.ReaderToolbarMenu(app.root, () => app.dictionary(), () => {}, h.preferences);
    app.installToolbarIcons(); app.updateToolbarLabels();
    const lean = tools.querySelector('#reader-lean-review'); assertIconOnly(lean, 'Lean 对照', 'readerTooltip');
    assert.equal(lean.querySelector('path').getAttribute('d'), 'M12 3v18', 'Lean comparison uses a distinct equal-column symbol.');
    const assertSecondary = (selector, name) => { const item = app.root.querySelector(selector);
        assert.equal(item.querySelector('.reader-tool-name').textContent, name, 'Secondary tools keep a visible localized name.');
        assert.ok(item.querySelector('svg')); assert.equal(item.getAttribute('aria-label'), name); };
    assertSecondary('[data-panel="propositions"]', '命题审阅');
    assertSecondary('[data-panel="symbol-audit"]', '符号审计');
    assertIconOnly(tools.querySelector('#reader-expand'), '全屏阅读', 'readerTooltip');
    for (const [category, label] of [['reference', '查阅'], ['review', '审阅'], ['edition', '版本与出版'], ['display', '设置']]) assertIconOnly(tools.querySelector('[data-tool-menu="' + category + '"]'), label, 'readerTooltip');
    for (const button of tools.children) { assert.ok(button.dataset.readerTooltip, 'Primary icons retain viewport tooltips.'); assertIconOnly(button, button.dataset.readerTooltip, 'readerTooltip'); assert.equal(button.dataset.tooltip, undefined); }
    for (const svg of tools.querySelectorAll('svg')) { assert.equal(svg.getAttribute('aria-hidden'), 'true'); assert.equal(svg.getAttribute('focusable'), 'false'); }
    h.preferences.setLanguage('en'); app.state.language = 'en'; app.updateToolbarLabels();
    assertIconOnly(lean, 'Lean comparison', 'readerTooltip');
    assertSecondary('[data-panel="propositions"]', 'Proposition review');
    assertSecondary('[data-panel="symbol-audit"]', 'Symbol audit');
    assertSecondary('#reader-archive', 'Version history'); assertSecondary('#reader-publication', 'PDF publication');
    assertIconOnly(tools.querySelector('#reader-expand'), 'Full screen', 'readerTooltip');
    for (const [category, label] of [['reference', 'Reference'], ['review', 'Review'], ['edition', 'Versions & publication'], ['display', 'Settings']]) assertIconOnly(tools.querySelector('[data-tool-menu="' + category + '"]'), label, 'readerTooltip');
    assert.equal(new Set(tools.children.map(button => JSON.stringify(iconShape(button)))).size, 7, 'Frequent actions and the four categories have distinct primary glyphs.');
    app.page = { page: { documentMode: 'draft' } }; app.updateDraftToolbarAvailability();
    assert.equal(lean.disabled, true); assertIconOnly(lean, h.words.en.draftFormalToolsUnavailable, 'readerTooltip');
    h.preferences.setLanguage('zh'); app.state.language = 'zh'; app.updateToolbarLabels(); assertIconOnly(lean, h.words.zh.draftFormalToolsUnavailable, 'readerTooltip');
    assert.equal(app.root.querySelector('[data-panel="propositions"]').querySelector('.reader-tool-name').textContent, '命题审阅', 'A draft restriction explains availability without replacing the tool name.');
    app.page = { page: { documentMode: 'formal' } }; app.updateDraftToolbarAvailability();
    assert.equal(lean.disabled, false); assertIconOnly(lean, 'Lean 对照', 'readerTooltip');
    assertSecondary('#reader-archive', '版本记录'); assertSecondary('#reader-publication', 'PDF 出版');
    app.toolbarMenu.dispose();
    assert.notDeepEqual(h.icons.readerIcon('lean-compare').children.map(node => node.attributes), h.icons.readerIcon('compare').children.map(node => node.attributes));
}

async function sourceAndArchiveActions(h) {
    for (const language of ['zh', 'en']) {
        h.preferences.setLanguage(language);
        const words = h.words[language], quoted = [];
        const actions = new h.ReaderSourceActions({ labels: () => ({ ...words, locate: words.jump, failed: words.sourceActionFailed }), getDefinitions: () => [],
            canReference: () => true, reference: async (...args) => { quoted.push(args); } });
        actions.sourceDocument = { filePath: 'book/01.md', source: 'paragraph', formulas: [] };
        actions.selectedSource = () => ({ text: 'selected', markdown: '**selected**', sourceLines: 'whole source line', rect: new Element('span').getBoundingClientRect(), startLine: 4, endLine: 6 });
        actions.showSelectionActions();
        const popover = h.document.body.querySelector('.reader-source-popover'), buttons = popover.querySelectorAll('button');
        [words.copySelectedMarkdown, words.copySourceLines, words.reference].forEach((label, index) => assertIconOnly(buttons[index], label));
        assert.match(buttons[2].getAttribute('aria-label'), /Codex/);
        await buttons[0].emit('click'); await buttons[1].emit('click'); await buttons[2].emit('click');
        assert.deepEqual(h.copied.slice(-2), ['**selected**', 'whole source line']); assert.equal(quoted[0][0].startLine, 4); assert.equal(quoted[0][0].endLine, 6);
        actions.showFormulaActions({ id: 'formula', latex: 'x^2', source: '$x^2$', sourceStartLine: 8, sourceEndLine: 8 }, new Element('span').getBoundingClientRect());
        const formulaButtons = h.document.body.querySelector('.reader-source-popover').querySelectorAll('button');
        assertIconOnly(formulaButtons[0], words.copyLatex);
        const shapes = [formulaButtons[0], buttons[0], buttons[1]].map(iconShape);
        assert.equal(new Set(shapes.map(shape => JSON.stringify(shape))).size, 3, 'LaTeX, selected Markdown, and source lines have distinct full-size glyphs.');
        assert.ok(formulaButtons[0].querySelector('rect'), 'LaTeX keeps the familiar overlapping-page copy symbol.');
        assert.equal(buttons[0].querySelector('path').getAttribute('d'), 'm18 16 4-4-4-4', 'Selected Markdown uses code brackets.');
        assert.equal(buttons[1].querySelectorAll('line').length, 3, 'Source lines use a bounded multiline selection.');
        await formulaButtons[0].emit('click'); assert.equal(h.copied.at(-1), 'x^2');
        actions.host.canReference = () => false; actions.showFormulaActions({ id: 'formula', latex: 'x', source: '$x$', sourceStartLine: 8, sourceEndLine: 8 }, new Element('span').getBoundingClientRect());
        const disabled = h.document.body.querySelector('.reader-source-reference'); assert.equal(disabled.disabled, true); assertIconOnly(disabled, words.referenceUnavailable);
        const before = quoted.length; await disabled.emit('click'); assert.equal(quoted.length, before, 'Unavailable Codex actions never send a reference.');
        let adapted = false, adaptationCalls = 0;
        const adaptiveFormula = { id: 'adaptive', latex: '\\begin{aligned}a&=b\\\\&=c\\end{aligned}', source: '$$original formula$$', display: true, sourceStartLine: 8, sourceEndLine: 10 };
        actions.host.canReference = () => true;
        actions.host.canAdaptFormula = formula => formula === adaptiveFormula && !adapted;
        actions.host.isFormulaAdapted = formula => formula === adaptiveFormula && adapted;
        actions.host.toggleFormulaLayout = async formula => { assert.equal(formula, adaptiveFormula); adaptationCalls++; adapted = !adapted; };
        actions.showFormulaActions(adaptiveFormula, new Element('span').getBoundingClientRect());
        const adaptiveButtons = h.document.body.querySelector('.reader-source-popover').querySelectorAll('button');
        assert.equal(adaptiveButtons.length, 3); assertIconOnly(adaptiveButtons[1], words.adaptFormula); assert.equal(adaptiveButtons[1].getAttribute('aria-pressed'), 'false');
        await adaptiveButtons[1].emit('click'); assert.equal(adaptationCalls, 1); assertIconOnly(adaptiveButtons[1], words.restoreFormula); assert.equal(adaptiveButtons[1].getAttribute('aria-pressed'), 'true');
        await adaptiveButtons[0].emit('click'); assert.equal(h.copied.at(-1), adaptiveFormula.latex, 'Adapted formula copy continues to use untouched source TeX.');
        await adaptiveButtons[2].emit('click'); assert.equal(quoted.at(-1)[0].formulaId, adaptiveFormula.id); assert.equal(quoted.at(-1)[1], adaptiveFormula.source);
        actions.showFormulaActions(adaptiveFormula, new Element('span').getBoundingClientRect());
        const restore = h.document.body.querySelector('.reader-source-popover').querySelectorAll('button')[1]; assertIconOnly(restore, words.restoreFormula);
        await restore.emit('click'); assert.equal(adapted, false); assertIconOnly(restore, words.adaptFormula);
        actions.host.toggleFormulaLayout = async () => {}; await restore.emit('click'); assert.equal(restore.getAttribute('aria-pressed'), 'false', 'A rejected-fit fallback cannot claim successful adaptation.');
        assertIconOnly(restore, words.adaptFormula);
        actions.host.canAdaptFormula = () => false; actions.showFormulaActions(adaptiveFormula, new Element('span').getBoundingClientRect());
        assert.equal(h.document.body.querySelector('.reader-source-popover').querySelectorAll('button').length, 2, 'No adaptation action is added to fitting or ineligible formulas.');
        const article = new Element('article'), formulaElement = new Element('span'); formulaElement.nodeType = 1; formulaElement.dataset.readerFormula = adaptiveFormula.id; article.append(formulaElement); h.document.body.append(article);
        actions.bind(article, { filePath: 'book/01.md', source: adaptiveFormula.source, formulas: [adaptiveFormula] });
        await article.emit('keyup', { key: 'Enter', target: formulaElement });
        assert.equal(h.document.body.querySelector('.reader-source-popover').querySelector('button').focused, true, 'Enter makes formula actions reachable from the focused scroll region.');
        actions.onKeyDown({ key: 'Escape' }); assert.equal(formulaElement.focused, true, 'Escape returns focus to the formula scroll region.');
        actions.dispose();
    }
    let invoked = 0;
    for (const [icon, label] of [['verify', '验证签名'], ['download', 'Export evidence'], ['compare', 'Compare versions']]) {
        const action = h.archiveAction(label, icon, () => { invoked++; }); assertIconOnly(action, label); await action.emit('click');
    }
    assert.equal(invoked, 3); assert.equal(h.archiveAction('Close', 'x', () => {}).textContent, '');
}

async function anchorSemantics(h) {
    const status = { contract: 'current', build: 'unverified', dependencies: 'unverified' };
    for (const language of ['zh', 'en']) {
        h.preferences.setLanguage(language);
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

async function tooltipLifecycle(h) {
    const root = new Element('main'), branch = new Element('section'), otherBranch = new Element('section'), editor = new Element('div'), token = new Element('span'), plain = new Element('input');
    h.document.body.append(root); root.append(branch, otherBranch, plain); branch.append(editor); editor.append(token);
    const trigger = h.icons.readerIconAction('save', 'Save review'); branch.append(trigger);
    const tooltip = new h.ReaderTooltip(); tooltip.bind(root);
    const hint = h.document.body.querySelector('.reader-global-tooltip'), glyph = trigger.children[0];
    await root.emit('pointerover', { target: glyph }); assert.equal(hint.hidden, false); assert.equal(hint.textContent, 'Save review');
    const observer = h.observers.at(-1);
    assert.equal(observer.targets.has(trigger), true); assert.equal(observer.targets.has(branch), true); assert.equal(observer.targets.has(root), true);
    assert.equal(observer.targets.has(editor), false); assert.equal(observer.targets.has(token), false);
    for (const options of observer.targets.values()) assert.equal(options.subtree, false, 'Active ancestor observation never follows editor token subtrees.');
    h.icons.describeReaderIconAction(trigger, 'Saving…'); h.notifyMutation(trigger, 'attributes', 'data-reader-tooltip'); assert.equal(hint.textContent, 'Saving…');
    await root.emit('pointerout', { target: trigger, relatedTarget: glyph }); assert.equal(hint.hidden, false, 'Moving within the SVG action retains its tooltip.');
    await root.emit('pointerout', { target: glyph, relatedTarget: plain }); assert.equal(hint.hidden, true); assert.equal(observer.targets.size, 0);
    await root.emit('focusin', { target: trigger }); assert.equal(hint.hidden, false);
    branch.hidden = true; h.notifyMutation(branch, 'attributes', 'hidden'); assert.equal(hint.hidden, true); assert.equal(observer.targets.size, 0);
    branch.hidden = false; await root.emit('focusin', { target: trigger });
    trigger.style.visibility = 'hidden'; h.notifyMutation(trigger, 'attributes', 'style'); assert.equal(hint.hidden, true);
    trigger.style.visibility = ''; await root.emit('focusin', { target: trigger });
    trigger.remove(); h.notifyMutation(branch, 'childList'); assert.equal(hint.hidden, true); assert.equal(observer.targets.size, 0, 'Removing the active action releases all observation.');
    branch.append(trigger); await root.emit('pointerover', { target: glyph }); trigger.remove();
    await root.emit('focusin', { target: plain }); h.window.emit('scroll'); assert.equal(hint.hidden, true, 'The detached-trigger, nontrigger-focus, scroll sequence cannot retain a tooltip.');
    branch.append(trigger); await root.emit('focusin', { target: glyph });
    otherBranch.append(trigger); h.notifyMutation(branch, 'childList'); assert.equal(hint.hidden, false); assert.equal(observer.targets.has(otherBranch), true); assert.equal(observer.targets.has(branch), false);
    otherBranch.style.display = 'none'; h.notifyMutation(otherBranch, 'attributes', 'style'); assert.equal(hint.hidden, true);
    otherBranch.style.display = ''; await root.emit('focusin', { target: trigger });
    trigger.dataset.readerTooltip = ''; h.notifyMutation(trigger, 'attributes', 'data-reader-tooltip'); assert.equal(hint.hidden, true);
    h.icons.describeReaderIconAction(trigger, 'Save review'); await root.emit('focusin', { target: trigger });
    await root.emit('pointerover', { target: plain }); assert.equal(hint.hidden, true); assert.equal(observer.targets.size, 0);
    await root.emit('focusin', { target: trigger }); await root.emit('focusout', { target: trigger }); assert.equal(hint.hidden, true);
    await root.emit('focusin', { target: trigger }); tooltip.dispose(); assert.equal(hint.isConnected, false); assert.equal(observer.targets.size, 0);
    for (const name of ['pointerover', 'pointerout', 'focusin', 'focusout']) assert.equal(root.listeners[name].length, 0);
    assert.equal(h.window.listeners.scroll.length, 0); assert.equal(h.window.listeners.resize.length, 0); root.remove();
}

export async function testReaderIconClarity() {
    const h = await harness(), previous = globalThis.document; globalThis.document = h.document;
    try {
        documentStageContract(h); await toolbarAndIconContract(h); await sourceAndArchiveActions(h); await anchorSemantics(h);
        await tooltipLifecycle(h);
        const shape = icon => h.icons.readerIcon(icon).children.map(node => [node.tagName, node.attributes]);
        assert.notDeepEqual(shape('reset'), shape('verify'), 'Resetting verdicts cannot look like verified evidence.');
        assert.notDeepEqual(shape('list-plus'), shape('verify'), 'Adding an undecided draft cannot look like approval.');
        const css = await fs.readFile(path.join(root, 'src/reader/web/styles.css'), 'utf8');
        assert.doesNotMatch(css, /is-source-copy|is-line-copy|has-action-label|reader-action-label/);
        assert.match(css, /\.reader-panel-close, \.reader-panel-action, \.reader-source-action \{[^}]*width: 28px;[^}]*height: 28px;/);
        assert.match(css, /\.reader-archive \.archive-icon-button \{[^}]*width: 32px;[^}]*height: 32px;/);
        assert.match(css, /\.reader-toolbar\s*\{[^}]*height: 56px;[^}]*min-height: 56px;/);
        assert.match(css, /\.reader-tools \{[^}]*flex: 0 0 auto;[^}]*min-width: 0;/);
        assert.doesNotMatch(css, /\.reader-tools[^}]*overflow-x:/, 'Only the small primary action set occupies the toolbar.');
        assert.doesNotMatch(css, /\.reader-type-control output \{[^}]*display: none/);
        assert.doesNotMatch(css, /\.reader-page-title \{[^}]*display: none/);
        assert.match(css, /\.reader-history, \.reader-type-control \{ flex-shrink: 0;/);
        assert.match(css, /\.reader-tools > button \{ flex: 0 0 auto;/);
        assert.match(css, /\.reader-source-actions \{[^}]*flex-wrap: wrap;/);
        const main = await fs.readFile(path.join(root, 'src/reader/web/main.ts'), 'utf8');
        assert.match(main, /<div class="reader-tools"[^>]*role="group"[^>]*>[\s\S]*?<button id="reader-lean-review"/);
        console.log('Reader compact icon clarity and hover action tests passed.');
    } finally { globalThis.document = previous; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderIconClarity();
