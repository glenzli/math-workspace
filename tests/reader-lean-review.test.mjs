import { readerUiLabels, installReaderTextNodes } from './reader-ui-harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const require = createRequire(import.meta.url);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idA = 'h-aaaaaaaaaaaaaaaa', idB = 'h-bbbbbbbbbbbbbbbb', idUnanchored = 'h-cccccccccccccccc';
const rootA = 'a'.repeat(64), rootB = 'b'.repeat(64);
const source = (content, role = 'statement', filePath = 'book1/ch01-a.md') => ({ filePath, startLine: 3, endLine: 4, content, role, fingerprint: content });
function declaration(name = 'Book.exists') {
    return { key: 'formal:' + name, projectKey: 'formal', name: name.split('.').at(-1), qualifiedName: name, kind: 'theorem',
        source: source(`theorem ${name} {α : Type} [Inhabited α] : Nonempty α := ⟨default⟩`, 'declaration', 'lean/Book.lean'),
        elaboratedType: '{α : Type} → [inst : Inhabited α] → Nonempty α', typeDependencies: ['Nonempty', 'Inhabited'],
        proofDependencies: ['default'], axioms: [], evidenceState: 'available' };
}
function payload(id = idA, projectToken = rootA, filePath = 'book1/ch01-a.md') {
    return { id, projectToken, formal: { id, type: 'theorem', title: 'Existence', display: 'Theorem 1.1', filePath, line: 3 },
        evidence: { fingerprint: 'snapshot-' + projectToken[0] + '-' + id, statement: source('Theorem: every inhabited type has an element.', 'statement', filePath),
            proofs: [source('Proof: take the default element.', 'proof', filePath)], contexts: [source('Assume α is inhabited.', 'context', filePath)],
            declarations: [declaration(), declaration('Book.choice')], definitions: [], projects: [{ projectKey: 'formal', inputFingerprint: 'input-v1', freshnessPolicy: 'project-inputs',
                toolchain: 'leanprover/lean4:fixture', build: { state: 'passed' } }], state: 'current', diagnostics: [] },
        review: { freshness: 'unreviewed', changes: [], expectedRevision: 0 } };
}
function record(value, fields = {}) {
    return { schemaVersion: 1, formalId: value.id, revision: 1, verdict: 'partial', scope: 'Existence only; uniqueness has not been reviewed.',
        note: 'Review notes', reviewer: 'Author', reviewedAt: '2026-10-12T00:00:00Z', subclaims: [],
        evidenceFingerprint: value.evidence.fingerprint, snapshot: structuredClone(value.evidence), ...fields };
}
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function settle() { for (let i = 0; i < 18; i++) await new Promise(resolve => setImmediate(resolve)); }

// The harness dispatches the production handlers and preserves DOM tree/focus semantics.
// Layout and real Markdown rendering are checked in the integrated browser preview.
class Element {
    constructor(tag, document) {
        this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.nodeType = 1; this.children = []; this.listeners = new Map();
        this.attributes = new Map(); this.dataset = {}; this.style = {}; this.className = ''; this.hidden = false; this.value = ''; this.checked = false;
        this._text = ''; this._html = ''; this.selectionStart = 0; this.selectionEnd = 0;
        this.classList = { add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
            contains: name => this.className.split(' ').includes(name), toggle: (name, force) => {
                const add = force ?? !this.classList.contains(name); if (add) this.classList.add(name); else this.classList.remove(name); return add;
            } };
    }
    get parentElement() { return this.parent; }
    get childNodes() { return this.children; }
    get isConnected() { return this === this.ownerDocument.body || Boolean(this.parent?.isConnected); }
    get textContent() { return this._text + this._html + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get innerHTML() { return this._html; }
    set innerHTML(value) { this.replaceChildren(); this._html = value; }
    append(...children) { for (const child of children) { child.remove?.(); child.parent = this; this.children.push(child); } }
    appendChild(child) { this.append(child); return child; }
    insertBefore(child, sibling) { child.remove(); child.parent = this; const index = this.children.indexOf(sibling); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
    replaceChildren(...children) { for (const child of this.children) child.parent = undefined; this.children = []; this._text = ''; this._html = ''; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
    contains(child) { return child === this || this.children.some(item => item.contains(child)); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'id') this.id = value; if (name.startsWith('data-')) this.dataset[this.dataKey(name)] = String(value); }
    getAttribute(name) { return name.startsWith('data-') ? this.dataset[this.dataKey(name)] ?? null : name === 'id' ? this.id ?? null : this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'id') this.id = undefined; if (name.startsWith('data-')) delete this.dataset[this.dataKey(name)]; }
    dataKey(name) { return name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
    matches(selector) {
        const simple = selector.replace(/\[[^\]]*\]/g, '');
        const tag = simple.match(/^[a-z][\w-]*/i)?.[0]; if (tag && this.tagName !== tag.toUpperCase()) return false;
        for (const [, name] of simple.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
        const id = simple.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
        for (const [, name, , value] of selector.matchAll(/\[([\w-]+)(?:=(["'])(.*?)\2)?\]/g)) {
            const attribute = this.getAttribute(name); if (attribute === null || (value !== undefined && attribute !== value)) return false;
        }
        return true;
    }
    closest(selector) { for (let item = this; item; item = item.parent) if (item.matches(selector)) return item; return null; }
    querySelectorAll(selector) { const selectors = selector.split(',').map(value => value.trim()); const result = []; const visit = item => {
        for (const child of item.children) { if (selectors.some(value => child.matches(value))) result.push(child); visit(child); }
    }; visit(this); return result; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, handler) { const handlers = this.listeners.get(type) || new Set(); handlers.add(handler); this.listeners.set(type, handlers); }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    dispatchEvent(event) { event.target ||= this; event.currentTarget = this; for (const handler of this.listeners.get(event.type) || []) handler(event);
        if (event.bubbles && !event.stopped) this.parent?.dispatchEvent(event); return !event.defaultPrevented; }
    emit(type, fields = {}) { this.dispatchEvent({ type, bubbles: true, preventDefault() { this.defaultPrevented = true; }, ...fields }); }
    click() { if (!this.disabled) this.emit('click'); }
    focus() { this.ownerDocument.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    getBoundingClientRect() { return { left: 10, top: 10, width: 200, height: 50, bottom: 60 }; }
}

installReaderTextNodes(Element);

async function harness() {
    const document = { createElement(tag) { return new Element(tag, this); }, createElementNS(_namespace, tag) { return this.createElement(tag); } };
    document.body = new Element('body', document); document.activeElement = document.body;
    const documentEvents = new Element('document', document), windowEvents = new Element('window', document);
    document.addEventListener = documentEvents.addEventListener.bind(documentEvents); document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents);
    document.dispatchEvent = documentEvents.dispatchEvent.bind(documentEvents);
    const context = { projectId: rootA, filePath: 'book1/ch01-a.md', language: 'zh', token: 'local-token', revision: 1 };
    const snapshots = new Map(), requests = [], reports = [], assists = [], copied = [], timers = new Map(); let timerId = 0;
    const main = document.createElement('main'), article = document.createElement('article'); article.id = 'reader-article'; document.body.append(main); main.append(article);
    let override, navigate, currentJob;
    const modules = {}, globals = { document, window: { innerWidth: 1280, innerHeight: 900,
        addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents) },
        Element, Node: { ELEMENT_NODE: 1 }, AbortController, crypto: { randomUUID: () => 'test-' + (timerId++) },
        setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
        require: name => { if (name === './reader-ui-labels') return readerUiLabels; if (name === './reader-clipboard') return { copyReaderText: async text => { copied.push(text); return true; } }; return modules[name]; } };
    const assistanceInstances = [];
    modules['./reader-lean-assistance'] = { ReaderLeanAssistance: class {
        constructor(host) { this.host = host; this.root = document.createElement('section'); assistanceInstances.push(this); }
        mount() { return this.root; } update(payload) { this.payload = payload; } metadataChanged() { this.metadataReads = (this.metadataReads || 0) + 1; }
        acknowledgeAssistanceRevision() {} hide() {} destroy() { this.root.remove(); }
    } };
    modules['./reader-lean-source-highlighter'] = { tokenizeLeanSource: () => [], tokenizeLeanSourceAsync: async () => [] };
    modules['./reader-lean-source-editor'] = { LeanSourceEditor: class {
        constructor(parent, content, host) { this.host = host; this.node = document.createElement('pre'); this.node.textContent = content; this.node.dataset.testSourceEditor = 'true'; parent.append(this.node); }
        focusRange(range) { this.range = range; this.host.positionChanged(range.start, range); }
        clearFocusRange() { this.range = undefined; } setSyntax() {} setSemantics() {} setLanguage() {} refreshLayout() {} destroy() { this.node.remove(); }
    } };
    async function load(relative, name) {
        const text = await fs.readFile(path.join(repoRoot, relative), 'utf8'), exports = {};
        const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
        vm.runInNewContext(compiled, { ...readerUiLabels,  ...globals, exports }); modules[name] = exports; return exports;
    }
    const lucide = {}; vm.runInNewContext('(function(exports) {\n' + await fs.readFile(require.resolve('lucide'), 'utf8') + '\n})(exports);', { exports: lucide, document }); modules.lucide = lucide;
    await load('src/reader/web/reader-icons.ts', './reader-icons');
    const { ReaderTooltip } = await load('src/reader/web/reader-tooltip.ts', './reader-tooltip');
    await load('src/reader/web/reader-popover.ts', './reader-popover');
    const { ReaderLeanPopover } = await load('src/reader/web/reader-lean-popover.ts', './reader-lean-popover');
    await load('src/reader/web/reader-lean-source-model.ts', './reader-lean-source-model');
    await load('src/reader/web/reader-lean-semantic.ts', './reader-lean-semantic');
    await load('src/reader/web/reader-lean-source.ts', './reader-lean-source');
    await load('src/reader/web/reader-lean-source-diff.ts', './reader-lean-source-diff');
    await load('src/reader/web/reader-lean-audit.ts', './reader-lean-audit');
    const exports = await load('src/reader/web/reader-lean-review.ts', './reader-lean-review');
    function store(value) { snapshots.set(value.projectToken + ':' + value.id, structuredClone(value)); }
    const request = async (route, options = {}) => {
        requests.push({ route, options: structuredClone(options), project: context.projectId });
        if (override) { const result = override(route, options); if (result) return result; }
        const url = new URL(route, 'http://localhost');
        if (url.pathname === '/api/lean-language/source') return response({ projectToken: context.projectId, projectKey: url.searchParams.get('projectKey'),
            filePath: url.searchParams.get('filePath'), sourceHash: 'file-hash', sourceUri: 'lean-source:fixture', origin: 'project', readonly: true,
            content: 'import Mathlib\n\n' + declaration().source.content + '\n\n' + declaration('Book.choice').source.content, lineCount: 5 });
        if (url.pathname === '/api/lean-audit') {
            const value = snapshots.get(context.projectId + ':' + url.searchParams.get('id'));
            return response({ id: value.id, projectToken: value.projectToken, evidenceFingerprint: value.evidence.fingerprint,
                expectedRevision: 0, links: [], issues: [], warnings: [],
                proseSources: [value.evidence.statement, ...value.evidence.proofs, ...value.evidence.contexts].map((source, index) => ({ key: 'prose:' + index, source, fileHash: 'prose-file' })),
                leanSources: value.evidence.declarations.filter(item => item.source).map(item => ({ key: item.key, source: item.source,
                    projectKey: item.projectKey, declarationKey: item.key, fileHash: 'lean-file' })),
                manualReview: { freshness: value.review.freshness, verdict: value.review.record?.verdict, history: [], historyDropped: 0 } });
        }
        if (url.pathname === '/api/lean-review/queue') {
            return response({ projectToken: context.projectId, items: [...snapshots.values()].filter(item => item.projectToken === context.projectId).map(item => ({
                ...item.formal, anchored: item.evidence.declarations.length > 0, declarationCount: item.evidence.declarations.length,
                reviewFreshness: item.review.freshness, verdict: item.review.record?.verdict })), counts: {} });
        }
        if (url.pathname === '/api/lean-review') return response(snapshots.get(context.projectId + ':' + url.searchParams.get('id')));
        if (url.pathname === '/api/lean-review/definition') return response({ state: 'available', definition: { ...declaration(url.searchParams.get('name')), kind: 'def', value: 'fun α => ∃ _ : α, True' } });
        if (url.pathname === '/api/lean-review/job') return response({ job: currentJob });
        if (url.pathname === '/api/lean-review/action') {
            const input = JSON.parse(options.body), value = snapshots.get(context.projectId + ':' + input.id);
            assert.equal(options.headers['x-math-workspace-token'], 'local-token'); assert.equal(options.headers['x-math-workspace-project'], context.projectId);
            if (input.action === 'save') {
                if (input.evidenceFingerprint !== value.evidence.fingerprint || input.expectedRevision !== value.review.expectedRevision) return response({ error: 'conflict' }, 409);
                const saved = record(value, { ...input, revision: input.expectedRevision + 1 }); delete saved.action; delete saved.id; delete saved.expectedRevision;
                const next = structuredClone(value); next.review = { record: saved, expectedRevision: saved.revision, freshness: 'current', changes: [] }; store(next); return response(next);
            }
            if (input.action === 'cancel') return response({ job: currentJob });
            currentJob = { id: 'job-1', formalId: input.id, status: 'running', phase: 'build', startedAt: '2026-10-12T00:00:00Z' };
            return response({ job: currentJob }, 202);
        }
        throw new Error('Unexpected route ' + route);
    };
    const host = { context: () => context, request, renderProse: source => `<p>${source.content}</p>`, locate: source => reports.push(source.filePath),
        navigatePage: async filePath => { if (navigate) return navigate(filePath); panel.navigationStarted(filePath); context.filePath = filePath; panel.contextChanged(); },
        canAssist: () => true, assist: async content => { assists.push(content); }, report: message => reports.push(message) };
    const panel = new exports.ReaderLeanReview(main, host), region = main.querySelector('.reader-lean-review');
    return { ...exports, ReaderLeanPopover, ReaderTooltip, document, context, main, article, panel, region, requests, reports, assists, copied, snapshots, host, store, assistanceInstances,
        setOverride: fn => { override = fn; }, setNavigate: fn => { navigate = fn; }, setJob: value => { currentJob = value; },
        async runTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); await settle(); },
        get timerCount() { return timers.size; },
        find(selector) { const value = region.querySelector(selector); assert.ok(value, `Missing control ${selector}`); return value; },
        click(action) { this.find(`[data-lean-action="${action}"]`).click(); },
        input(key, value, type = 'input') { const input = this.find(`[data-lean-focus="${key}"]`); input.value = value; input.emit(type); },
        async dispose() { panel.dispose(); } };
}

function assertIconAction(button, label, tooltip = 'readerTooltip') {
    assert.equal(button.textContent, '', 'A short action keeps its glyph during state updates.');
    assert.equal(button.children.length, 1); assert.equal(button.children[0].tagName, 'SVG');
    const description = button.getAttribute('aria-label'); assert.match(description, label);
    assert.equal(button.getAttribute('title'), description); assert.equal(button.dataset[tooltip], description);
    assert.equal(button.children[0].getAttribute('aria-hidden'), 'true'); assert.equal(button.children[0].getAttribute('focusable'), 'false');
}

async function testEntryAndManualReview() {
    const h = await harness(); h.store(payload()); h.store(payload(idB));
    try {
        const marker = h.document.createElement('button'); marker.dataset.readerLeanAnchor = idA; h.article.append(marker);
        const popover = new h.ReaderLeanPopover({ fetchAnchor: async id => ({ id }), openReview: (id, marker) => { void h.panel.open(id, marker); },
            labels: () => ({ title: 'Lean 对齐', openReview: 'Lean 对照', loading: '加载', unavailable: '不可用', contract: '绑定', build: '构建', dependencies: '依赖', declarations: '声明', markdownOnly: '正文', leanOnly: 'Lean', none: '无', status: () => '未读' }) });
        popover.bind(h.article); marker.emit('focusin'); await settle();
        const entry = h.document.body.querySelector(`[data-reader-lean-review="${idA}"]`); assertIconAction(entry, /Lean 对照/, 'tooltip'); entry.click(); await settle();
        assert.equal(h.region.hidden, false); assert.match(h.region.textContent, /Proof: take the default element/);
        for (const key of ['close', 'refresh', 'previous-object', 'next-object', 'locate-prose', 'add-claim', 'save', 'assist', 'copy-assist']) assertIconAction(h.find(`[data-lean-action="${key}"]`), /./);
        assert.match(h.find('[data-lean-action="view-both"]').textContent, /并排对照/);
        assert.match(h.find('[data-lean-action="lean-source"]').textContent, /当前源码/);
        assert.match(h.find('[data-lean-object]').textContent, /Theorem/);
        assert.match(h.find('[data-lean-action="previous-object"]').getAttribute('aria-label'), /第一项/);
        const tooltip = new h.ReaderTooltip(); tooltip.bind(h.main);
        const refresh = h.find('[data-lean-action="refresh"]'); refresh.focus(); refresh.emit('focusin');
        const hint = h.document.body.querySelector('.reader-global-tooltip'); assert.equal(hint.hidden, false); assert.equal(hint.textContent, refresh.getAttribute('aria-label'));
        refresh.emit('focusout'); assert.equal(hint.hidden, true);
        refresh.children[0].emit('pointerover'); assert.equal(hint.textContent, refresh.getAttribute('aria-label')); tooltip.dispose();
        assert.match(h.region.textContent, /\{α : Type\} → \[inst : Inhabited α\]/); assert.match(h.region.textContent, /尚未判断|未审阅/);
        assert.equal(h.requests.some(request => request.options.method === 'POST'), false, 'Entering review never starts tooling or saves.');
        h.document.dispatchEvent({ type: 'scroll', target: h.main }); h.document.dispatchEvent({ type: 'pointerdown', target: h.document.body });
        assert.equal(h.region.hidden, false, 'Scroll and outside clicks preserve comparison mode.');
        h.input('scope', 'Existence, excluding uniqueness.'); h.input('verdict', 'partial', 'change'); h.input('reviewer', 'Author');
        h.click('add-claim'); h.input('claim-text', 'An element exists under the inhabited assumption.');
        h.find('[data-lean-mapping="formal:Book.exists"]').checked = true; h.find('[data-lean-mapping="formal:Book.exists"]').emit('change');
        h.find('[data-lean-mapping="formal:Book.choice"]').checked = true; h.find('[data-lean-mapping="formal:Book.choice"]').emit('change');
        h.input('claim-verdict', 'partial', 'change'); h.input('claim-note', 'Uniqueness remains open.');
        h.click('add-claim'); h.input('claim-text', 'The choice construction is used.');
        h.find('[data-lean-mapping="formal:Book.choice"]').checked = true; h.find('[data-lean-mapping="formal:Book.choice"]').emit('change');
        const firstClaim = h.region.querySelectorAll('[data-lean-claim]')[0]; firstClaim.click();
        assert.equal(h.find('[data-lean-focus="claim-text"]').value, 'An element exists under the inhabited assumption.');
        assert.equal(h.find('[data-lean-focus="declaration"]').value, 'formal:Book.exists');
        h.input('declaration', 'formal:Book.choice', 'change'); assert.match(h.region.textContent, /Book.choice/);
        h.find('[data-lean-definition="Nonempty"]').click(); await settle(); assert.match(h.region.textContent, /fun α => ∃ _ : α, True/);
        h.find('[data-lean-related-definition="Inhabited"]').click(); await settle(); assert.match(h.region.textContent, /Nonempty › Inhabited/);
        h.click('definition-back'); await settle(); assert.equal(h.region.querySelector('[data-lean-action="definition-back"]'), null);
        const save = h.find('[data-lean-action="save"]'), saveGlyph = save.children[0];
        h.click('save'); assertIconAction(save, /正在保存/); assert.equal(save.children[0], saveGlyph); assert.equal(save.disabled, true); assert.equal(save.getAttribute('aria-busy'), 'true'); await settle();
        assertIconAction(h.find('[data-lean-action="save"]'), /保存审阅/);
        const sent = h.requests.find(request => request.options.method === 'POST' && JSON.parse(request.options.body).action === 'save');
        const input = JSON.parse(sent.options.body); assert.equal(input.expectedRevision, 0); assert.equal(input.evidenceFingerprint, payload().evidence.fingerprint);
        assert.equal(input.verdict, 'partial'); assert.equal(input.subclaims.length, 2); assert.deepEqual(input.subclaims[0].declarationKeys, ['formal:Book.exists', 'formal:Book.choice']);
        assert.match(h.region.textContent, /部分覆盖/); assert.match(h.region.textContent, /已保存审阅记录/);
        h.click('close'); await h.panel.open(idA); assert.equal(h.find('[data-lean-focus="scope"]').value, 'Existence, excluding uniqueness.');
        assert.equal(h.find('[data-lean-focus="claim-note"]').value, 'Uniqueness remains open.');
        h.input('note', 'Retain this unsaved edit.'); h.click('close'); await h.panel.open(idA); assert.equal(h.find('[data-lean-focus="note"]').value, 'Retain this unsaved edit.');
        h.click('assist'); await settle(); assert.equal(h.assists.length, 1); assert.match(h.assists[0][0].resource.text, /Retain this unsaved edit/);
        assert.match(h.region.textContent, /发送后才会开始核对/); assert.equal(h.find('[data-lean-focus="verdict"]').value, 'partial');
        h.context.language = 'en'; h.panel.contextChanged(); assert.equal(h.region.getAttribute('aria-label'), 'Lean comparison'); assert.match(h.region.textContent, /Aligned within reviewed scope/);
        assertIconAction(h.find('[data-lean-action="save"]'), /Save review/); assertIconAction(h.find('[data-lean-action="close"]'), /Close comparison/);
        assert.equal(h.find('[data-lean-focus="note"]').value, 'Retain this unsaved edit.');
        h.host.canAssist = () => false; h.panel.contextChanged(); h.click('assist'); await settle(); assert.equal(h.copied.length, 1); assert.match(h.region.textContent, /context copied/);
        popover.dispose();
    } finally { await h.dispose(); }
}

async function testConflictAndDefinitionDrift() {
    const h = await harness(), initial = payload(); h.store(initial);
    try {
        await h.panel.open(idA); h.input('scope', 'Only assumptions.'); h.input('verdict', 'aligned', 'change'); h.click('add-claim'); h.input('claim-text', 'Inhabited is an assumption.');
        h.find('[data-lean-mapping="formal:Book.exists"]').checked = true; h.find('[data-lean-mapping="formal:Book.exists"]').emit('change');
        h.find('[data-lean-definition="Inhabited"]').click(); await settle(); assert.match(h.region.textContent, /fun α =>/);
        const changed = structuredClone(initial); changed.evidence.fingerprint = 'snapshot-changed'; changed.evidence.statement = source('A revised statement.');
        changed.evidence.declarations = [declaration('Book.choice')]; changed.evidence.state = 'stale'; changed.review.expectedRevision = 1;
        changed.review.record = record(initial); changed.review.freshness = 'stale'; changed.review.changes = [{ kind: 'statement', key: 'statement', label: 'Statement', previous: initial.evidence.statement.content, current: changed.evidence.statement.content }]; h.store(changed);
        h.click('save'); await settle(); assert.match(h.region.textContent, /草稿已保留/); assert.equal(h.find('[data-lean-action="save"]').disabled, true);
        assert.equal(h.find('[data-lean-action="acknowledge"]').disabled, true, 'A conflict requires fresh readback before acknowledging.');
        assertIconAction(h.find('[data-lean-action="acknowledge"]'), /保留笔记，重置结论.*重新读取/);
        assertIconAction(h.find('[data-lean-action="save"]'), /保存前需要重新核对/);
        h.click('reload'); await settle(); assert.equal(h.find('[data-lean-focus="scope"]').value, 'Only assumptions.');
        assert.doesNotMatch(h.region.textContent, /fun α =>/); assert.match(h.region.textContent, /A revised statement/); assert.match(h.region.textContent, /原关联声明已不在/);
        h.click('acknowledge'); assert.equal(h.find('[data-lean-focus="verdict"]').value, 'undecided'); assert.equal(h.find('[data-lean-focus="claim-verdict"]').value, 'undecided');
        h.click('unmap-missing'); assert.equal(h.region.querySelector('[data-lean-missing-mapping]'), null); assert.equal(h.find('[data-lean-focus="claim-text"]').value, 'Inhabited is an assumption.');
        assert.equal(h.find('[data-lean-focus="scope"]').maxLength, 8000); assert.equal(h.find('[data-lean-focus="note"]').maxLength, 16000); assert.equal(h.find('[data-lean-focus="claim-note"]').maxLength, 8000);
        h.input('verdict', 'partial', 'change'); h.click('save'); await settle();
        const saved = h.snapshots.get(rootA + ':' + idA).review.record; assert.equal(saved.evidenceFingerprint, 'snapshot-changed'); assert.equal(saved.verdict, 'partial'); assert.equal(saved.subclaims[0].declarationKeys.length, 0);
        const unavailable = structuredClone(changed); unavailable.evidence.declarations[0].evidenceState = 'unavailable'; unavailable.evidence.declarations[0].elaboratedType = undefined; unavailable.evidence.declarations[0].truncated = true; unavailable.evidence.fingerprint = 'unavailable'; h.store(unavailable);
        await h.panel.open(idA); assert.match(h.region.textContent, /尚无可用的递归公理证据/); assert.match(h.region.textContent, /已截断/);
        assert.doesNotMatch(h.region.textContent, /递归检查未发现公理依赖/);
        h.setOverride(route => route.startsWith('/api/lean-review/definition') ? Promise.resolve(response({ state: 'available', definition: {
            ...declaration('Book.Structure'), kind: 'structure', source: undefined, value: undefined, typeDependencies: [], proofDependencies: [] } })) : undefined);
        h.find('[data-lean-definition="Nonempty"]').click(); await settle(); assert.match(h.region.textContent, /当前类型不能替代完整定义/);
    } finally { await h.dispose(); }
}

async function testAsyncIdentityAndJobs() {
    const h = await harness(); h.store(payload()); h.store(payload(idB)); h.store(payload(idA, rootB));
    try {
        const delayed = deferred(); h.setOverride(route => route === '/api/lean-review?id=' + idA ? delayed.promise : undefined);
        const opening = h.panel.open(idA); await h.panel.open(idB); delayed.resolve(response(payload())); await opening;
        assert.match(h.region.textContent, new RegExp(idB)); assert.doesNotMatch(h.region.querySelector('header').textContent, new RegExp(idA));
        h.setOverride(undefined); await h.panel.open(idA); h.input('scope', 'A pending save.');
        const save = deferred(); h.setOverride((route, options) => options.method === 'POST' ? save.promise : undefined);
        h.click('save'); h.context.projectId = rootB; h.panel.contextChanged(); await h.panel.open(idA);
        save.resolve(response({ ...payload(), review: { expectedRevision: 1, freshness: 'current', changes: [], record: record(payload()) } })); await settle();
        assert.equal(h.find('[data-lean-focus="scope"]').value, '', 'A save from another project cannot replace this draft.');
        h.setOverride(undefined); h.context.projectId = rootA; h.panel.contextChanged(); await h.panel.open(idA);
        assert.equal(h.find('[data-lean-focus="scope"]').value, 'A pending save.');
        const definition = deferred(); h.setOverride(route => route.startsWith('/api/lean-review/definition') ? definition.promise : undefined);
        h.find('[data-lean-definition="Nonempty"]').click(); h.input('declaration', 'formal:Book.choice', 'change'); definition.resolve(response({ state: 'available', definition: { ...declaration('Outdated.Definition'), value: 'obsolete' } })); await settle();
        assert.doesNotMatch(h.region.textContent, /obsolete|Outdated.Definition/);
        h.setOverride(undefined); h.click('refresh'); await settle(); assert.equal(h.timerCount, 1);
        h.click('cancel'); await settle(); assert.equal(h.timerCount, 1, 'Cancellation keeps polling while backend still reports running.');
        h.setJob({ id: 'job-1', formalId: idA, status: 'cancelled', phase: 'cancelled', startedAt: '2026-10-12T00:00:00Z' }); await h.runTimers();
        assert.equal(h.find('[data-lean-action="refresh"]').disabled, false); assert.match(h.region.textContent, /已取消/);
        const late = deferred(); h.setOverride(route => route.startsWith('/api/lean-review?id=') ? late.promise : undefined);
        const reopen = h.panel.open(idB); h.panel.navigationStarted('book1/ch02.md'); h.context.filePath = 'book1/ch02.md'; h.panel.contextChanged();
        late.resolve(response(payload(idB))); await reopen; assert.equal(h.region.hidden, true);
        h.setOverride(undefined); h.context.filePath = 'book1/ch01-a.md'; await h.panel.open(idA);
        h.setOverride(route => route === '/api/lean-review?id=' + idA ? Promise.resolve(response(payload(idA, rootB))) : undefined);
        await h.panel.open(idA); assert.match(h.region.textContent, /与当前对象不一致/); assert.equal(h.region.querySelector('[data-lean-action="save"]'), null);
    } finally { await h.dispose(); }
}

async function testChapterQueueAndUnanchoredEntry() {
    const h = await harness(); h.store(payload()); h.store(payload(idB, rootA, 'book1/ch01-b.md'));
    const unanchored = payload(idUnanchored); unanchored.evidence.declarations = []; unanchored.evidence.state = 'unavailable'; h.store(unanchored);
    try {
        await h.panel.open(idA); h.find(`[data-lean-object="${idB}"]`).click(); await settle();
        assert.equal(h.context.filePath, 'book1/ch01-b.md'); assert.match(h.region.querySelector('header').textContent, new RegExp(idB));
        assert.equal(h.region.querySelector('[data-lean-action="save"]').disabled, false);
        h.find(`[data-lean-object="${idUnanchored}"]`).click(); await settle(); assert.equal(h.context.filePath, 'book1/ch01-a.md'); assert.match(h.region.textContent, /尚无 Lean 锚点/);
        h.input('scope', 'Unformalized uniqueness.'); h.input('verdict', 'undecided', 'change'); h.click('save'); await settle();
        assert.equal(h.snapshots.get(rootA + ':' + idUnanchored).review.record.verdict, 'undecided');
        h.snapshots.clear(); h.store(unanchored); h.panel.close(); await h.panel.openPageQueue();
        assert.match(h.region.querySelector('header').textContent, new RegExp(idUnanchored), 'Page-level entry works without an L marker.');
        h.snapshots.clear(); await h.panel.openPageQueue(); assert.match(h.region.textContent, /尚无可审阅的正式对象/); assert.equal(h.region.querySelector('[data-lean-action="save"]'), null);
        h.store(payload()); h.store(payload(idB, rootA, 'book1/ch01-b.md')); await h.panel.open(idA);
        const navigation = deferred(); h.setNavigate(async filePath => { h.panel.navigationStarted(filePath); await navigation.promise; });
        h.find(`[data-lean-object="${idB}"]`).click(); h.panel.navigationStarted('book1/ch02.md'); h.context.filePath = 'book1/ch02.md'; h.panel.contextChanged();
        navigation.resolve(); await settle(); assert.equal(h.region.hidden, true, 'A late queue navigation cannot reopen comparison over newer navigation.');
        h.context.filePath = 'book1/ch01-a.md'; h.setNavigate(undefined);
        h.setOverride(route => route.startsWith('/api/lean-review/queue') ? Promise.resolve(response({ projectToken: rootB, items: [payload(idB).formal], counts: {} })) : undefined);
        await h.panel.openPageQueue(); assert.match(h.region.textContent, /与当前对象不一致/); assert.equal(h.region.querySelector('[data-lean-object]'), null);
    } finally { await h.dispose(); }
}

async function testQueueRevisionFreshness() {
    const h = await harness(), initialA = payload(), initialB = payload(idB);
    const current = value => ({ ...value, review: { record: record(value), expectedRevision: 1, freshness: 'current', changes: [] } });
    const changed = value => {
        const next = structuredClone(value); next.evidence.fingerprint += '-changed'; next.evidence.statement = source('Changed prose for ' + value.id);
        next.review.freshness = 'stale'; next.review.changes = [{ kind: 'statement', key: 'statement', label: 'Statement', previous: value.evidence.statement.content, current: next.evidence.statement.content }];
        return next;
    };
    const queueResponse = items => response({ projectToken: rootA, counts: {}, items: items.map(value => ({ ...value.formal,
        anchored: true, declarationCount: value.evidence.declarations.length, reviewFreshness: value.review.freshness, verdict: value.review.record?.verdict })) });
    h.store(current(initialA)); h.store(current(initialB));
    try {
        await h.panel.open(idA); await settle();
        h.input('queue-filter', 'all', 'change');
        assert.match(h.find('.reader-lean-review-queue').textContent, /已变化 0/);
        const changedA = changed(current(initialA)); h.store(changedA);
        const queueReads = () => h.requests.filter(request => request.route.startsWith('/api/lean-review/queue')).length;
        const beforeA = queueReads(); h.context.revision++; h.panel.contextChanged(); await settle();
        assert.equal(queueReads(), beforeA + 1, 'Every workspace revision refreshes the visible queue.');
        assert.match(h.find(`[data-lean-object="${idA}"]`).textContent, /审阅后材料已变化/);
        assert.match(h.find('.reader-lean-review-queue').textContent, /已变化 1/);
        assert.equal(h.find('[data-lean-action="save"]').disabled, true);

        const changedB = changed(current(initialB)); h.store(changedB);
        const beforeB = queueReads(); h.context.revision++; h.panel.contextChanged(); await settle();
        assert.equal(queueReads(), beforeB + 1, 'Changes to other objects refresh the queue while the selected object stays the same.');
        assert.match(h.find(`[data-lean-object="${idB}"]`).textContent, /审阅后材料已变化/);
        assert.match(h.find('.reader-lean-review-queue').textContent, /已变化 2/);
        assert.match(h.region.querySelector('header').textContent, new RegExp(idA));

        const late = deferred(); let queueRequests = 0;
        h.setOverride(route => route.startsWith('/api/lean-review/queue') && ++queueRequests === 1 ? late.promise : undefined);
        h.context.revision++; h.panel.contextChanged(); await settle();
        assert.equal(h.find('.reader-lean-review-queue').getAttribute('aria-busy'), 'true');
        assert.match(h.find('.reader-lean-review-queue').textContent, /正在更新队列/);
        assert.doesNotMatch(h.find('.reader-lean-review-queue').textContent, /已变化 2/);
        const rereviewedB = current(changedB); h.store(rereviewedB);
        h.context.revision++; h.panel.contextChanged(); await settle();
        assert.equal(h.find('.reader-lean-review-queue').getAttribute('aria-busy'), 'false');
        assert.match(h.find('.reader-lean-review-queue').textContent, /已变化 1/);
        assert.match(h.find(`[data-lean-object="${idB}"]`).textContent, /部分覆盖/);
        late.resolve(queueResponse([changedA, changedB])); await settle();
        assert.match(h.find('.reader-lean-review-queue').textContent, /已变化 1/, 'An older revision cannot overwrite the latest queue.');
        assert.match(h.find(`[data-lean-object="${idB}"]`).textContent, /部分覆盖/);
        h.setOverride(route => route.startsWith('/api/lean-review/queue') ? Promise.resolve(response({ error: 'Unavailable' }, 503)) : undefined);
        h.context.revision++; h.panel.contextChanged(); await settle();
        assert.match(h.find('.reader-lean-review-queue').textContent, /队列未能读取/);
        assert.doesNotMatch(h.find('.reader-lean-review-queue').textContent, /已变化 1|部分覆盖/, 'Failed refreshes cannot present old queue badges as current.');
        assert.equal(h.requests.some(request => request.options.method === 'POST'), false, 'Revision refreshes remain read-only.');
    } finally { await h.dispose(); }
}

async function testBoundedContextAndLayoutContract() {
    const h = await harness();
    try {
        const value = payload(), input = { id: idA, expectedRevision: 0, evidenceFingerprint: value.evidence.fingerprint, verdict: 'partial', scope: 'Existence only', note: '', reviewer: '', subclaims: [] };
        value.evidence.statement.content = 'x'.repeat(80000) + '\n```\n';
        const context = h.leanReviewAssistance(value, input, 'en'); assert.equal(context.truncated, true); assert.ok(context.text.length < 50000); assert.match(context.text, /omissions/);
        const changed = structuredClone(value); changed.evidence = undefined;
        const before = payload().evidence, after = structuredClone(before); after.fingerprint = 'new'; after.definitions = [declaration('Book.KeyDefinition')];
        assert.ok(h.leanReviewDraftChanges(before, after).some(change => change.kind === 'definition'));
        const css = await fs.readFile(path.join(repoRoot, 'src/reader/web/styles.css'), 'utf8');
        assert.match(css, /@media \(max-width: 1100px\)\s*\{\s*\.reader-lean-review-columns \{ grid-template-columns: minmax\(0, 1fr\)/);
        assert.match(css, /reader-lean-review\[hidden\] \{ display: none/);
        const main = await fs.readFile(path.join(repoRoot, 'src/reader/web/main.ts'), 'utf8'); assert.match(main, /id="reader-lean-review"/); assert.match(main, /navigatePage: filePath => this\.openPage/);
    } finally { await h.dispose(); }
}

async function testMetadataEventsWithoutWorkspaceRevision() {
    const h = await harness(), initial = payload(); h.store(initial); h.store(payload(idB));
    try {
        await h.panel.open(idA); h.input('scope', 'Keep the current unsaved scope.');
        const changed = structuredClone(initial); changed.review.record = record(initial); changed.review.expectedRevision = 1; changed.review.freshness = 'current'; h.store(changed);
        const revision = h.context.revision, reads = h.requests.length;
        h.panel.metadataChanged([`.math-workspace/lean-reviews/${idA}.json`]); await settle();
        assert.equal(h.context.revision, revision); assert.ok(h.requests.slice(reads).some(request => request.route === '/api/lean-review?id=' + idA));
        assert.ok(h.requests.slice(reads).some(request => request.route === '/api/lean-audit?id=' + idA));
        assert.equal(h.find('[data-lean-focus="scope"]').value, 'Keep the current unsaved scope.');
        assert.equal(h.find('[data-lean-action="save"]').disabled, true, 'A peer manual save invalidates the draft CAS even without source revision drift.');
        const before = h.requests.length; h.panel.metadataChanged([`.math-workspace/lean-audits/${idB}.json`]); await settle();
        assert.ok(h.requests.slice(before).some(request => request.route === '/api/lean-audit?id=' + idA));
        const unchanged = h.requests.length; h.panel.metadataChanged(['book1/unrelated.md']); await settle(); assert.equal(h.requests.length, unchanged);
    } finally { await h.dispose(); }
}

async function testSavedSourceDiffLocations() {
    const h = await harness(), initial = payload();
    const oldProof = initial.evidence.proofs[0]; oldProof.startLine = 21; oldProof.endLine = 21;
    const oldDeclaration = initial.evidence.declarations[0].source; oldDeclaration.startLine = 40; oldDeclaration.endLine = 40;
    const changed = structuredClone(initial); changed.evidence.fingerprint = 'diff-current';
    changed.evidence.statement = { ...source('A revised statement.'), startLine: 8, endLine: 8 };
    changed.evidence.proofs[0] = { ...source('A revised proof.', 'proof'), startLine: 27, endLine: 27 };
    changed.evidence.declarations[0].source = { ...source('theorem Book.exists : True := by trivial', 'declaration', 'lean/Book.lean'), startLine: 46, endLine: 46 };
    const serialized = value => `${value.filePath}:${value.startLine}\n${value.content}`;
    changed.review = { record: record(initial), expectedRevision: 1, freshness: 'stale', changes: [
        { kind: 'statement', key: 'statement', label: 'statement source', previous: serialized(initial.evidence.statement), current: serialized(changed.evidence.statement) },
        { kind: 'proof', key: 'proof', label: 'proof source', previous: serialized(oldProof), current: serialized(changed.evidence.proofs[0]) },
        { kind: 'declaration', key: initial.evidence.declarations[0].key, label: 'Book.exists', previous: oldDeclaration.content, current: changed.evidence.declarations[0].source.content }
    ] };
    h.store(changed);
    try {
        await h.panel.open(idA); const tables = h.region.querySelectorAll('.reader-lean-source-diff'); assert.equal(tables.length, 3);
        for (const [index, [oldLine, newLine]] of [[3, 8], [21, 27], [40, 46]].entries()) {
            const rows = tables[index].querySelector('tbody').querySelectorAll('tr'); assert.equal(rows.length, 2);
            assert.equal(rows.find(row => row.className === 'is-remove').children[0].textContent, String(oldLine));
            assert.equal(rows.find(row => row.className === 'is-add').children[1].textContent, String(newLine));
            assert.equal(tables[index].querySelectorAll('code').some(code => code.textContent.includes('.md:')), false);
        }
        assert.match(h.region.querySelector('.reader-lean-review-changes').textContent, /book1\/ch01-a\.md:3–4 → book1\/ch01-a\.md:8–8/);
    } finally { await h.dispose(); }
}

async function testStableComparisonWorkbench() {
    const h = await harness(); h.store(payload());
    let renders = 0, mounts = 0, disposals = 0;
    h.host.renderProse = source => { renders++; return `<p>${source.content}</p>`; };
    h.host.mountProse = () => { mounts++; return () => { disposals++; }; };
    try {
        const queue = deferred(); h.setOverride(route => route.startsWith('/api/lean-review/queue') ? queue.promise : undefined);
        await h.panel.open(idA); await settle();
        const prose = h.find('.reader-lean-review-prose-scroll'), editor = h.find('[data-test-source-editor]');
        assert.equal(renders, 3); assert.equal(mounts, 3, 'All statement, proof and context math is rendered without placeholders.');
        assert.equal(h.find('[data-lean-slot="lean"]').contains(editor), true, 'Complete Lean source is beside the prose.');
        assert.equal(h.find('[data-lean-prose-part="statement"]').hidden, false);
        assert.equal(h.find('[data-lean-prose-part="proof:0"]').hidden, true);
        h.input('prose-part', 'proof:0', 'change'); prose.scrollTop = 127;
        assert.equal(h.find('[data-lean-prose-part="proof:0"]').hidden, false);
        queue.resolve(response({ projectToken: rootA, items: [], counts: {} })); await settle();
        assert.equal(h.find('.reader-lean-review-prose-scroll'), prose); assert.equal(prose.scrollTop, 127);
        assert.equal(h.find('[data-test-source-editor]'), editor); assert.equal(renders, 3); assert.equal(disposals, 0);
        h.setOverride(undefined); h.click('refresh'); await settle(); await h.runTimers();
        assert.equal(h.find('[data-test-source-editor]'), editor); assert.equal(h.find('.reader-lean-review-prose-scroll'), prose);
        assert.equal(renders, 3, 'Job progress cannot remount mathematical prose.');
        h.click('view-prose'); assert.equal(h.find('[data-lean-slot="lean"]').hidden, true);
        h.click('view-lean'); assert.equal(h.find('[data-lean-slot="prose"]').hidden, true);
        h.click('view-both'); assert.equal(h.find('[data-lean-slot="prose"]').hidden, false); assert.equal(h.find('[data-lean-slot="lean"]').hidden, false);
        assert.equal(h.find('[data-test-source-editor]'), editor, 'Compact viewport switching preserves the source surface.');
        const reload = deferred(); h.setOverride(route => route === '/api/lean-review?id=' + idA ? reload.promise : undefined);
        h.panel.metadataChanged([`.math-workspace/lean-reviews/${idA}.json`]); await settle();
        assert.equal(h.find('[data-test-source-editor]'), editor); assert.match(h.region.textContent, /正在更新对照材料/);
        assert.equal(h.find('.reader-lean-review-prose-scroll'), prose);
        reload.resolve(response(payload())); await settle(); assert.equal(renders, 3);
        h.input('note', '中文草稿 remains exactly as entered');
        const draftNote = h.find('[data-lean-focus="note"]'), requestsBeforeLanguage = h.requests.length;
        draftNote.focus(); draftNote.setSelectionRange(1, 4);
        h.context.language = 'en'; h.panel.contextChanged(); assert.equal(renders, 3); assert.equal(disposals, 0);
        assert.equal(h.find('[data-lean-focus="note"]'), draftNote); assert.equal(draftNote.value, '中文草稿 remains exactly as entered');
        assert.equal(draftNote.selectionStart, 1); assert.equal(draftNote.selectionEnd, 4); assert.equal(h.document.activeElement, draftNote);
        assert.equal(h.requests.length, requestsBeforeLanguage, 'A language change makes no Lean/source/audit request.');
        h.click('view-prose'); h.click('view-both');
        assert.equal(renders, 3, 'A later view update cannot cause a delayed prose remount solely because the language changed.');
        assert.equal(h.find('.reader-lean-review-prose-scroll'), prose, 'Locale changes retain the rendered manuscript and current prose selection.');
        assert.equal(h.find('[data-test-source-editor]'), editor, 'Locale changes retranslate prose controls without rebuilding Lean source.');
        const css = await fs.readFile(path.join(repoRoot, 'src/reader/web/styles.css'), 'utf8');
        assert.match(css, /reader-lean-review-prose-scroll[^}]*overflow: auto;[^}]*overscroll-behavior: contain;/);
        assert.match(css, /reader-lean-review-columns \[hidden\] \{ display: none !important;/);
    } finally { await h.dispose(); }
}

async function testAssistanceDraftBoundary() {
    const h = await harness(); h.store(payload()); h.store(payload(idB));
    try {
        await h.panel.open(idA); const assistance = h.assistanceInstances[0];
        h.input('scope', 'Only the statement.'); h.input('verdict', 'partial', 'change');
        const binding = { projectToken: rootA, id: idA, evidenceFingerprint: payload().evidence.fingerprint, reviewRevision: 0, auditRevision: 0, candidateRevision: 1 };
        const candidate = { id: 'candidate-1', category: 'assumption', task: 'assumptions', title: 'Check the inhabited hypothesis', note: 'The prose may omit this premise.',
            declarationKeys: ['formal:Book.exists'], binding, status: 'pending', createdAt: '2026-10-13T00:00:00Z' };
        assert.equal(assistance.host.adoptCandidate(candidate, { ...binding, projectToken: rootB }), false);
        assert.equal(assistance.host.adoptCandidate(candidate, { ...binding, reviewRevision: 1 }), false);
        assert.equal(assistance.host.adoptCandidate(candidate, binding), true);
        assert.equal(assistance.host.candidateInDraft(candidate.id), true);
        assert.equal(h.find('[data-lean-focus="verdict"]').value, 'partial', 'Candidate adoption does not change an existing human verdict.');
        assert.equal(h.find('[data-lean-focus="claim-verdict"]').value, 'undecided'); assert.match(h.find('[data-lean-focus="claim-note"]').value, /AI 候选，待人工核对/);
        assert.equal(h.find('[data-lean-focus="scope"]').value, 'Only the statement.');
        assert.equal(h.find('[data-lean-slot="review"]').querySelector('details').open, true);
        assert.equal(assistance.host.adoptCandidate(candidate, binding), false, 'Repeated adoption does not duplicate the same candidate.');
        h.click('remove-claim'); assert.equal(assistance.host.candidateInDraft(candidate.id), false);
        assert.equal(assistance.host.adoptCandidate(candidate, binding), true, 'A removed candidate can be added again after an explicit action.');
        assert.equal(h.requests.some(request => request.options.method === 'POST'), false, 'Adoption creates only a local draft.');
        h.panel.metadataChanged([`.math-workspace/lean-assistance/${idA}.json`]); assert.ok(assistance.metadataReads > 0);
        await h.panel.open(idB); assert.equal(assistance.host.adoptCandidate({ ...candidate, id: 'late' }, binding), false);
        await h.panel.open(idA); assert.equal(h.find('[data-lean-focus="claim-text"]').value, candidate.title, 'Switching objects retains the candidate draft.');
        const changed = payload(); changed.review.expectedRevision = 1; h.store(changed);
        h.panel.metadataChanged([`.math-workspace/lean-reviews/${idA}.json`]); await settle();
        assert.equal(assistance.host.adoptCandidate({ ...candidate, id: 'next' }, { ...binding, reviewRevision: 1 }), false, 'Outdated drafts cannot adopt against a newer saved record.');
    } finally { await h.dispose(); }
}

async function testQueueReuseDuringNavigation() {
    const h = await harness(); h.store(payload()); h.store(payload(idB));
    try {
        await h.panel.open(idA); await settle();
        const reads = () => h.requests.filter(request => request.route.startsWith('/api/lean-review/queue')).length;
        const initial = reads(); h.find(`[data-lean-object="${idB}"]`).click(); await settle();
        assert.equal(reads(), initial, 'Moving within a verified page queue does not reload that queue.');
        assert.match(h.region.querySelector('header').textContent, new RegExp(idB));
        h.context.revision++; h.panel.contextChanged(); await settle();
        assert.equal(reads(), initial + 1, 'Source revisions invalidate the queue.');
        h.panel.metadataChanged([`.math-workspace/lean-reviews/${idA}.json`]); await settle();
        assert.equal(reads(), initial + 2, 'Peer review writes refresh queue badges even without a source revision.');
    } finally { await h.dispose(); }
}

async function testDeclarationSourceRebinding() {
    const h = await harness(); h.store(payload());
    try {
        await h.panel.open(idA); await settle(); h.input('note', 'Keep this draft while anchors change.');
        const changed = payload(), replacement = declaration('Book.replacement');
        replacement.source.filePath = 'lean/Replacement.lean'; changed.evidence.declarations = [replacement]; changed.evidence.fingerprint = 'new-anchor'; h.store(changed);
        h.context.revision++; h.panel.contextChanged(); await settle();
        assert.equal(h.find('[data-lean-focus="declaration"]').value, replacement.key);
        assert.match(h.find('.reader-lean-source-header').textContent, /Book.replacement/);
        assert.ok(h.requests.some(request => request.route.includes('filePath=lean%2FReplacement.lean')));
        assert.equal(h.find('[data-lean-focus="note"]').value, 'Keep this draft while anchors change.');
        const moved = structuredClone(changed); moved.evidence.fingerprint = 'moved-anchor'; moved.evidence.declarations[0].source.filePath = 'lean/Moved.lean'; h.store(moved);
        h.panel.metadataChanged([`.math-workspace/lean-review-evidence/${idA}.json`]); await settle();
        assert.ok(h.requests.some(request => request.route.includes('filePath=lean%2FMoved.lean')), 'Same declaration keys still rebind changed source targets.');
        const removed = structuredClone(moved); removed.evidence.fingerprint = 'removed-anchor'; removed.evidence.declarations = []; h.store(removed);
        h.panel.metadataChanged([`.math-workspace/lean-review-evidence/${idA}.json`]); await settle();
        assert.equal(h.find('.reader-lean-source').hidden, true, 'Removing all declarations cannot leave an unrelated complete file beside the prose.');
        assert.equal(h.region.querySelector('[data-test-source-editor]'), null);
    } finally { await h.dispose(); }
}

async function testCandidateOnlyRealtimeRefresh() {
    const h = await harness(); h.store(payload()); h.store(payload(idB));
    try {
        await h.panel.open(idA); await settle(); h.input('note', 'Keep the local review draft.');
        const candidatePath = `.math-workspace/lean-assistance/${idA}.json`;
        const update = { projectId: rootA, revision: 2, changedPaths: [candidatePath] };
        assert.deepEqual(h.leanAssistanceUpdatePaths(update, { projectId: rootA, revision: 1 }), [candidatePath]);
        for (const invalid of [
            { ...update, projectId: rootB }, { ...update, revision: 3 }, { ...update, revision: 1 },
            { ...update, initial: true }, { ...update, projectChanged: true },
            { ...update, changedPaths: [] }, { ...update, changedPaths: [candidatePath, 'book1/ch01-a.md'] },
            { ...update, changedPaths: [candidatePath + '.tmp'] }, { ...update, changedPaths: [null] },
            { ...update, changedPaths: [`.math-workspace/lean-reviews/${idA}.json`] }
        ]) assert.equal(h.leanAssistanceUpdatePaths(invalid, { projectId: rootA, revision: 1 }), undefined);

        // Run the actual Reader realtime handler without bootstrapping unrelated UI surfaces.
        const mainText = await fs.readFile(path.join(repoRoot, 'src/reader/web/main.ts'), 'utf8');
        const parsed = ts.createSourceFile('main.ts', mainText, ts.ScriptTarget.Latest, true);
        const reader = parsed.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(parsed) === 'installRealtimeUpdates'));
        const method = reader.members.find(member => member.name?.getText(parsed) === 'installRealtimeUpdates');
        const compiled = ts.transpileModule(`class RealtimeHarness { ${method.getText(parsed)} }\nexports.install = RealtimeHarness.prototype.installRealtimeUpdates;`,
            { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
        const handlers = new Map(), exports = {};
        vm.runInNewContext(compiled, { ...readerUiLabels,  exports, leanAssistanceUpdatePaths: h.leanAssistanceUpdatePaths,
            readerEvents: () => ({ addEventListener: (name, handler) => handlers.set(name, handler) }),
            window: { setTimeout() {} }, console });
        let fullRefreshes = 0, nextRevision = 1;
        const app = { state: { projectId: rootA, revision: 1, pages: [{ filePath: h.context.filePath }] },
            leanReview: h.panel, pageRequestId: 1, currentPath: h.context.filePath, liveStatus: h.document.createElement('p'), dictionary: () => ({ live: 'Updated' }),
            async refreshState() { fullRefreshes++; this.state = { ...this.state, revision: nextRevision }; h.panel.contextChanged(); } };
        h.host.context = () => ({ ...h.context, revision: app.state.revision });
        exports.install.call(app);
        const emit = value => { nextRevision = value.revision; handlers.get('workspace-update')({ data: JSON.stringify(value) }); };
        const editor = h.find('[data-test-source-editor]'), prose = h.find('.reader-lean-review-prose-scroll'); prose.scrollTop = 145;
        const requestsBefore = h.requests.length, assistance = h.assistanceInstances[0], candidatesBefore = assistance.metadataReads || 0;
        emit(update); await settle();
        assert.equal(app.state.revision, 2); assert.equal(fullRefreshes, 0);
        assert.equal(h.requests.length, requestsBefore, 'Candidate-only notification does not reread state, source, object, audit or queue.');
        assert.equal(assistance.metadataReads, candidatesBefore + 1, 'Only the active candidate panel is invalidated.');
        assert.equal(h.find('[data-test-source-editor]'), editor); assert.equal(h.find('.reader-lean-review-prose-scroll'), prose);
        assert.equal(prose.scrollTop, 145); assert.equal(h.find('[data-lean-focus="note"]').value, 'Keep the local review draft.');
        h.panel.contextChanged(); await settle();
        assert.equal(h.requests.length, requestsBefore, 'Acknowledged metadata revisions do not cause a deferred source reload.');
        h.click('view-prose'); h.click('view-both'); await settle();
        assert.equal(h.requests.length, requestsBefore, 'An ordinary render after the candidate event cannot cause a deferred audit or source reload.');
        emit({ ...update, revision: 3, changedPaths: [`.math-workspace/lean-assistance/${idB}.json`] }); await settle();
        assert.equal(assistance.metadataReads, candidatesBefore + 1, 'Another object candidate update does not reload the active candidate panel.');
        assert.equal(h.requests.length, requestsBefore);
        h.click('view-prose'); h.click('view-both'); await settle();
        assert.equal(h.requests.length, requestsBefore, 'Another object candidate update also preserves the current audit/source on later renders.');
        emit({ ...update, revision: 5 }); await settle();
        assert.equal(fullRefreshes, 1, 'A revision gap keeps the conservative full state refresh.');
        assert.ok(h.requests.slice(requestsBefore).some(request => request.route.startsWith('/api/lean-review/queue')));
        const afterGap = h.requests.length;
        emit({ ...update, revision: 6, changedPaths: [candidatePath, 'book1/other.md'] }); await settle();
        assert.equal(fullRefreshes, 2, 'A mixed source notification keeps the full refresh.');
        assert.ok(h.requests.slice(afterGap).some(request => request.route.startsWith('/api/lean-language/source')));
    } finally { await h.dispose(); }
}

export async function testReaderLeanReview() {
    await testEntryAndManualReview();
    await testConflictAndDefinitionDrift();
    await testAsyncIdentityAndJobs();
    await testChapterQueueAndUnanchoredEntry();
    await testQueueRevisionFreshness();
    await testBoundedContextAndLayoutContract();
    await testMetadataEventsWithoutWorkspaceRevision();
    await testSavedSourceDiffLocations();
    await testStableComparisonWorkbench();
    await testAssistanceDraftBoundary();
    await testQueueReuseDuringNavigation();
    await testDeclarationSourceRebinding();
    await testCandidateOnlyRealtimeRefresh();
    console.log('Reader Lean review tests passed.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderLeanReview();
