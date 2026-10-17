import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import katex from 'katex';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const deferred = () => { let resolve, reject; const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; }); return { promise, resolve, reject }; };
const drain = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

class Events {
    listeners = new Map();
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    emit(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
}
class Element extends Events {
    children = []; attributes = new Map(); dataset = {}; properties = new Map(); classes = new Set(); hidden = false; scrollLeft = 0; scrollWidth = 0;
    constructor(document, classes = '', width = 320) {
        super(); this.ownerDocument = document; this.classes = new Set(classes.split(' ').filter(Boolean)); this.width = width; this.height = 32;
        this.style = { setProperty: (name, value) => this.properties.set(name, value) };
        this.classList = { contains: name => this.classes.has(name), add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)), toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
    }
    get isConnected() { return this.root || Boolean(this.parentElement?.isConnected); }
    get visible() { return !this.hidden && (!this.parentElement || this.parentElement.visible); }
    get clientWidth() { return this.visible ? this.width : 0; }
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = undefined; }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    getBoundingClientRect() { return { width: this.visible ? this.width : 0, height: this.visible ? this.height : 0 }; }
    querySelectorAll(selector) {
        const matches = element => selector === '[data-reader-formula]' ? Boolean(element.dataset.readerFormula)
            : selector.startsWith('.katex-html > ') ? element.parentElement?.classes.has('katex-html') && element.classes.has(selector.slice(15))
            : element.classes.has(selector.slice(1));
        return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

async function layoutHarness() {
    const fonts = new Events(), ready = deferred(); fonts.ready = ready.promise;
    const document = { fonts }, window = new Events(), frames = new Map(), observers = [];
    let nextFrame = 0;
    window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
    window.cancelAnimationFrame = frame => frames.delete(frame);
    class Observer {
        targets = new Set();
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(element) { this.targets.add(element); }
        disconnect() { this.targets.clear(); }
        notify(records = []) { if (this.targets.size) this.callback(records); }
    }
    const article = new Element(document); article.root = true;
    const calls = [], reports = [];
    let render = async input => {
        const element = new Element(document, 'reader-formula-reflow', input.widthPx - 10);
        element.setAttribute('aria-hidden', 'true'); element.height = 96;
        return { element, widthPx: element.width, heightPx: element.height };
    };
    const source = await fs.readFile(path.join(root, 'src/reader/web/reader-formula-layout.ts'), 'utf8');
    const exports = {};
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
        { exports, window, AbortController, MutationObserver: Observer, ResizeObserver: Observer,
            getComputedStyle: element => ({ display: element.display || 'block', fontSize: element.fontSize || '18px', fontFamily: 'KaTeX_Main',
                paddingLeft: element.paddingLeft || '0', paddingRight: element.paddingRight || '0' }),
            require: () => ({ renderReflowedFormula: input => { calls.push(input); return render(input); } }) });
    const fixture = (id, widths, { display = true, tag = 0, parent = article } = {}) => {
        const element = new Element(document, 'reader-formula' + (display ? ' is-display' : '')); element.dataset.readerFormula = id;
        element.setAttribute('data-source-start-line', '3'); element.setAttribute('data-source-end-line', '5');
        const katex = new Element(document, 'katex'), html = new Element(document, 'katex-html'), mathml = new Element(document, 'katex-mathml');
        const chunks = widths.map(width => new Element(document, 'base', width));
        html.append(...chunks); katex.append(mathml, html);
        if (tag) html.append(new Element(document, 'tag', tag));
        if (display) { const block = new Element(document, 'katex-display'); block.append(katex); element.append(block); }
        else element.append(katex);
        parent.append(element);
        const formula = Object.freeze({ id, latex: '\\begin{aligned}x&=a+b+c+d\\\\&=q+r+s\\end{aligned}', source: '$$original$$', display, sourceStartLine: 3, sourceEndLine: 5 });
        return { formula, element, chunks, katex, mathml, parent };
    };
    const flush = () => { let count = 0; while (frames.size) { assert.ok(++count < 20, 'Layout callbacks converge.'); const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback()); } };
    const mount = formulas => exports.mountReaderFormulaLayout(article, 'en', { formulas, request: async () => ({}), report: message => reports.push(message) });
    return { fixture, mount, article, document, window, fonts, ready, calls, reports, observers, flush,
        setRender: value => { render = value; } };
}

async function nativeAndLifecycleContract() {
    const h = await layoutHarness(), inline = h.fixture('inline', [190, 190, 190], { display: false });
    const wide = h.fixture('wide', [640]), author = h.fixture('author', [640]);
    author.element.setAttribute('tabindex', '-1'); author.element.setAttribute('role', 'math'); author.element.setAttribute('aria-label', 'Author math');
    const longInline = h.fixture('inline-wide', [640], { display: false });
    const numbered = h.fixture('numbered', [640]); numbered.chunks[0].append(new Element(h.document, 'eqn-num'));
    const handle = h.mount([inline.formula, wide.formula, author.formula, longInline.formula, numbered.formula]);
    assert.equal(inline.element.classList.contains('is-overflowing'), false, 'A long sequence of safe chunks uses native wrapping.');
    assert.equal(wide.element.classList.contains('is-overflowing'), true, 'An atomic group gets a local scroll viewport.');
    assert.equal(wide.element.getAttribute('tabindex'), '0'); assert.match(wide.element.getAttribute('aria-label'), /Scroll horizontally/);
    assert.equal(author.element.getAttribute('tabindex'), '-1'); assert.equal(author.element.getAttribute('role'), 'math'); assert.equal(author.element.getAttribute('aria-label'), 'Author math');
    assert.equal(handle.canAdapt(longInline.formula), false, 'Inline math never silently becomes display math.');
    await handle.toggle(longInline.formula); assert.equal(h.calls.length, 0);
    assert.equal(handle.canAdapt(numbered.formula), false, 'Automatic equation numbers must survive in the original KaTeX output.');
    await handle.toggle(numbered.formula); assert.equal(h.calls.length, 0); assert.ok(numbered.element.querySelector('.eqn-num'));
    wide.element.scrollLeft = 60; h.window.emit('resize'); h.flush(); assert.equal(wide.element.scrollLeft, 60, 'Unchanged layout preserves reading position.');
    h.article.width = 900; h.window.emit('resize'); h.flush();
    assert.equal(wide.element.classList.contains('is-overflowing'), false); assert.equal(wide.element.getAttribute('tabindex'), null); assert.equal(wide.element.scrollLeft, 0);
    h.article.width = 340; h.article.paddingLeft = '20px'; h.article.paddingRight = '20px'; wide.chunks[0].width = 310;
    h.fonts.emit('loadingdone'); h.flush(); assert.equal(wide.element.classList.contains('is-overflowing'), true, 'Available width excludes the containing block padding.');
    const details = new Element(h.document), disclosure = h.fixture('disclosure', [640], { parent: details }); details.hidden = true; h.article.append(details);
    h.observers[1].notify([{ type: 'childList' }]); h.flush(); assert.equal(disclosure.element.classList.contains('is-overflowing'), false);
    details.hidden = false; h.article.emit('toggle'); h.flush(); assert.equal(disclosure.element.classList.contains('is-overflowing'), true, 'Opening a disclosure retries geometry.');
    h.window.emit('resize'); handle.dispose(); handle.dispose(); h.ready.resolve(); await Promise.resolve(); h.flush();
    assert.equal(h.observers.every(observer => observer.targets.size === 0), true); assert.equal(h.window.listeners.get('resize').size, 0); assert.equal(h.fonts.listeners.get('loadingdone').size, 0);
    assert.equal(wide.element.getAttribute('tabindex'), null); assert.equal(handle.canAdapt(wide.formula), false);
}

async function optInAndStaleContract() {
    const h = await layoutHarness(), wide = h.fixture('wide', [640]), handle = h.mount([wide.formula]);
    assert.equal(h.calls.length, 0, 'Mounting formulas never loads the optional engine.');
    assert.equal(handle.canAdapt({ ...wide.formula }), false, 'A reused id from another page is not current formula ownership.');
    const sourceAttributes = [...wide.element.attributes], original = wide.element.children[0];
    await handle.toggle(wide.formula);
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].latex, wide.formula.latex); assert.equal(h.calls[0].fontSizePx, 18);
    assert.equal(handle.isAdapted(wide.formula), true); assert.equal(wide.element.children[0], original); assert.ok(wide.element.contains(wide.mathml), 'Original accessible KaTeX survives adaptation.');
    assert.equal(wide.element.getAttribute('data-source-start-line'), '3'); assert.equal(wide.element.getAttribute('data-source-end-line'), '5');
    assert.match(h.reports.at(-1), /now fits/);
    await handle.toggle(wide.formula); assert.equal(handle.isAdapted(wide.formula), false); assert.equal(wide.element.children.length, 1);
    assert.deepEqual([...wide.element.attributes], sourceAttributes, 'Restoration preserves source and accessibility attributes.');
    const pending = deferred(); h.setRender(() => pending.promise);
    const task = handle.toggle(wide.formula); assert.equal(handle.canAdapt(wide.formula), false);
    h.window.emit('resize');
    handle.invalidate(); assert.equal(h.calls.at(-1).signal.aborted, true);
    const stale = new Element(h.document, 'reader-formula-reflow', 300); stale.height = 90;
    pending.resolve({ element: stale, widthPx: 300, heightPx: 90 }); await task;
    assert.equal(handle.isAdapted(wide.formula), false); assert.equal(stale.isConnected, false); assert.doesNotMatch(h.reports.at(-1), /now fits/);
    h.article.width = 200; h.window.emit('resize'); h.flush(); assert.equal(wide.element.classList.contains('is-overflowing'), true, 'Failed navigation invalidates async work while retaining responsive geometry.');
    h.setRender(async input => { const element = new Element(h.document, 'reader-formula-reflow', input.widthPx - 10); return { element, widthPx: element.width, heightPx: 32 }; });
    await handle.toggle(wide.formula); assert.equal(handle.isAdapted(wide.formula), true, 'The same page remains re-adaptable after navigation failure.');
    h.article.width = 180; h.window.emit('resize'); h.flush(); await drain();
    assert.equal(h.calls.at(-1).widthPx, 180, 'An activated formula reflows for changed container width.');
    assert.equal(handle.isAdapted(wide.formula), true);
    wide.katex.fontSize = '22px'; h.observers[2].notify([{ type: 'attributes', attributeName: 'style' }]); h.flush(); await drain();
    assert.equal(h.calls.at(-1).fontSizePx, 22, 'A new font size retains the intended math scale.');
    h.setRender(async () => { const element = new Element(h.document, 'reader-formula-reflow', 400); return { element, widthPx: 100, heightPx: 32 }; });
    h.article.width = 160; h.window.emit('resize'); h.flush(); await drain();
    assert.equal(handle.isAdapted(wide.formula), false); assert.equal(wide.element.classList.contains('is-overflowing'), true); assert.match(h.reports.at(-1), /could not be adapted/);
    handle.dispose();
}

async function taggedContract() {
    const h = await layoutHarness(), tagged = h.fixture('tagged', [160, 90], { tag: 35 }); h.article.width = 320;
    const handle = h.mount([tagged.formula]);
    assert.equal(tagged.element.classList.contains('is-overflowing'), true, 'A centered tag collision switches to safe left alignment.');
    assert.equal(tagged.element.properties.get('--reader-formula-tag-space'), '53px');
    assert.equal(handle.canAdapt(tagged.formula), false, 'A tag collision solved by left alignment needs no complex adaptation.');
    h.article.width = 280; h.window.emit('resize'); h.flush(); assert.equal(handle.canAdapt(tagged.formula), true);
    handle.dispose();
}

async function rendererContract() {
    const bundle = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-formula-renderer-'));
    try {
        await build({ configFile: false, logLevel: 'silent', build: { outDir: bundle, emptyOutDir: true, minify: false,
            lib: { entry: path.join(root, 'src/reader/web/formal-renderer.ts'), formats: ['cjs'], fileName: () => 'renderer.cjs' } } });
        const { renderReaderFormula, createFormalRenderer, renderFormalDocument } = require(path.join(bundle, 'renderer.cjs'));
        const render = latex => renderReaderFormula({ latex, display: true });
        const original = latex => katex.renderToString(latex, { displayMode: true, throwOnError: false, strict: 'ignore', trust: false });
        const aligned = String.raw`\begin{aligned} \sum_{i=1}^n x_i &= a \\ &= b \\ &= c \end{aligned}`;
        assert.notEqual(render(aligned), original(aligned), 'Simple preview derivations receive a small default minimum leading.');
        assert.equal(render(aligned), katex.renderToString(aligned, { displayMode: true, throwOnError: false, strict: 'ignore', trust: false, macros: { '\\arraystretch': '1.12' } }));
        for (const source of [aligned.replace('\\\\ &= b', '\\\\[0.6em] &= b'), '\\def\\arraystretch{1.8}' + aligned,
            aligned.replace('a \\\\', '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix} \\\\'), String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`]) {
            assert.equal(render(source), original(source), 'Author row spacing and nested/atomic arrays retain the original KaTeX geometry.');
        }
        assert.equal(renderReaderFormula({ latex: aligned, display: false }), katex.renderToString(aligned, { throwOnError: false, strict: 'ignore', trust: false, displayMode: false }));
        const source = '# Formula fixture\n\nInline $a+b+c+d$.\n\n$$\n' + aligned + '\n$$\n';
        const document = renderFormalDocument(createFormalRenderer(), source, { currentFilePath: 'book/01.md', labels: {}, pages: [], language: 'en' });
        assert.equal(document.formulas[1].latex.trim(), aligned); assert.equal(document.formulas[1].source, '$$\n' + aligned + '\n$$');
        assert.equal(document.formulas[1].id, 'formula-1'); assert.equal(document.formulas[1].sourceStartLine, 5); assert.equal(document.formulas[1].sourceEndLine, 7);
        assert.match(document.html, /data-reader-formula="formula-1" data-source-start-line="5" data-source-end-line="7"/);
        assert.ok(document.html.includes('<annotation encoding="application/x-tex">' + aligned.replaceAll('&', '&amp;') + '</annotation>'), 'The accessible TeX annotation remains original.');
    } finally { await fs.rm(bundle, { recursive: true, force: true }); }
}

async function mainOwnershipContract() {
    let source = await fs.readFile(path.join(root, 'src/reader/web/main.ts'), 'utf8'); source = source.replace(/\nstartReader\(\);\s*$/, '\n');
    const exports = {}, captured = [], requests = [];
    const handle = () => ({ invalidations: 0, disposals: 0, invalidate() { this.invalidations++; }, dispose() { this.disposals++; } });
    const modules = {
        './reader-preferences': { readerPreferences: { snapshot: () => ({ language: 'en' }) } }, './reader-route': { readerFetch: async (route, options) => { requests.push({ route, options }); return {}; } },
        './reader-formula-layout': { mountReaderFormulaLayout: (...args) => { captured.push(args); return handle(); } } };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + '\nexports.ReaderApplication = ReaderApplication;',
        { exports, require: name => modules[name] || {}, Headers, document: {}, window: {} });
    const app = Object.create(exports.ReaderApplication.prototype), article = { classList: { add() {}, remove() {} } };
    app.state = { available: true, projectId: 'project-a', requestToken: 'token-a', language: 'en', pages: [{ filePath: 'old.md' }, { filePath: 'next.md' }] };
    app.page = { filePath: 'old.md', formulas: [] }; app.currentPath = 'old.md'; app.pageRequestId = 0; app.selectedPagePaths = ['old.md'];
    app.article = article; app.main = { scrollTop: 15 }; app.leanReview = { navigationStarted() {}, close() {} }; app.toolbarMenu = app.toolbarPanel = { close() {} };
    const old = app.formulaLayout = handle();
    app.fetchJson = async () => { throw new Error('Offline'); };
    await assert.rejects(app.openPage('next.md', 'push'), /Offline/); assert.equal(old.invalidations, 1); assert.equal(old.disposals, 0);
    await assert.rejects(app.openSymbolAuditReport(), /Offline/); assert.equal(old.invalidations, 2); assert.equal(old.disposals, 0);
    app.fetchJson = async () => ({}); await app.openSymbolAuditReport(); assert.equal(old.disposals, 0, 'No-report response preserves the live layout owner.');
    const report = deferred(); app.fetchJson = () => report.promise;
    const openingReport = app.openSymbolAuditReport(); app.pageRequestId++;
    report.resolve({ report: {} }); await openingReport;
    assert.equal(old.disposals, 0, 'A report reply superseded by navigation cannot dispose the current body.');
    app.reportLive = () => {}; app.mountArticleFormulaLayout();
    const [, language, options] = captured.at(-1); assert.equal(language, 'en');
    const abort = new AbortController(); await options.request('/api/formula-runtime?file=mathjax-tex-svg.mjs', { signal: abort.signal });
    assert.equal(requests.at(-1).options.headers.get('x-math-workspace-token'), 'token-a');
    assert.equal(requests.at(-1).options.headers.get('x-math-workspace-project'), 'project-a');
    assert.equal(requests.at(-1).options.signal, abort.signal);
    app.state = { ...app.state, requestToken: 'token-b' }; await assert.rejects(options.request('/api/formula-runtime'), /page has changed/);
    app.state = { ...app.state, requestToken: 'token-a', projectId: 'project-b' }; await assert.rejects(options.request('/api/formula-runtime'), /page has changed/);
}

export async function testReaderFormulaLayout() {
    await nativeAndLifecycleContract(); await optInAndStaleContract(); await taggedContract(); await rendererContract(); await mainOwnershipContract();
    const css = await fs.readFile(path.join(root, 'src/reader/web/styles.css'), 'utf8');
    assert.match(css, /\.reader-formula > \.katex,[^}]*white-space: normal/);
    assert.match(css, /\.reader-formula\.is-overflowing > \.katex-display > \.katex \{ text-align: left/);
    assert.doesNotMatch(css, /\.katex[^{}]*\.vlist[^{}]*\{[^}]*line-height/);
    console.log('Reader formula layout: native chunks, overflow, opt-in reflow, lifecycle, tags and source contracts passed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderFormulaLayout();
