import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPS = { dependency: 1, paintImageMaskXObject: 83, paintImageMaskXObjectGroup: 84, paintImageXObject: 85, paintInlineImageXObject: 86,
    paintInlineImageXObjectGroup: 87, paintImageXObjectRepeat: 88, paintImageMaskXObjectRepeat: 89, paintSolidColorImageMask: 90 };
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const drain = async () => { for (let index = 0; index < 15; index++) await new Promise(resolve => setImmediate(resolve)); };

class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this._text = ''; this.clientWidth = 820; this.hidden = false; }
    append(...children) { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children.forEach(child => { child.parent = undefined; }); this.children = []; this._text = ''; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
    set textContent(value) { this.replaceChildren(); this._text = String(value); } get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(name, value) { this.attributes[name] = String(value); } getAttribute(name) { return this.attributes[name] ?? null; } removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    click() { if (!this.disabled) for (const listener of this.listeners.click || []) listener(); }
    find(tag) { return this.children.flatMap(child => [...(child.tagName === tag ? [child] : []), ...child.find(tag)]); }
}

async function harness(language = 'en') {
    const document = { createElement: tag => new Element(tag) }, observations = [], urls = new Map(), revoked = [], requested = [];
    const state = { docCalls: 0, pages: [], rendered: [], cleaned: [], cancelled: 0, destroyed: 0, active: 0, maxActive: 0, downloads: 0, number: 3,
        loadingGate: undefined, pageGate: undefined, renderGate: undefined, fail: undefined, base: { width: 612, height: 792 },
        localImages: new Map(), commonImages: new Map(), operators: { fnArray: [], argsArray: [] }, filtered: [] };
    const pdf = { get numPages() { return state.number; }, async getPage(number) {
        state.pages.push(number); if (state.pageGate) await state.pageGate.promise;
        const pool = map => ({ get(id) { if (!map.has(id)) throw new Error('Unresolved test image'); return map.get(id); } });
        return { objs: pool(state.localImages), commonObjs: pool(state.commonImages),
            getViewport: ({ scale }) => ({ width: state.base.width * scale, height: state.base.height * scale }), cleanup: () => state.cleaned.push(number),
            render(options) {
                assert.ok(options.canvas); assert.equal(options.background, '#ffffff'); state.rendered.push({ number, ...options });
                state.operators.fnArray.forEach((_op, index) => { state.filtered.push(options.operationsFilter(index, state.operators)); });
                state.active++; state.maxActive = Math.max(state.maxActive, state.active);
                const gate = state.renderGate; state.renderGate = undefined;
                let cancelled = false, rejectCancel;
                const cancellation = new Promise((_resolve, reject) => { rejectCancel = reject; });
                const promise = Promise.race([gate?.promise || (state.fail ? Promise.reject(new Error(state.fail)) : Promise.resolve()), cancellation])
                    .finally(() => { state.active--; });
                return { promise, cancel() { if (!cancelled) { cancelled = true; state.cancelled++; rejectCancel(new Error('Rendering cancelled')); } } };
            } };
    } };
    const api = { version: '6.4.299', OPS, getDocument(options) {
        state.docCalls++; state.options = options;
        return { promise: state.loadingGate?.promise || Promise.resolve(pdf), async destroy() { state.destroyed++; } };
    } };
    let sequence = 0;
    const sandbox = { exports: {}, document, window: { devicePixelRatio: 4 }, Blob, TextDecoder, Uint8Array, AbortController, console,
        ResizeObserver: class { constructor(run) { this.run = run; observations.push(this); } observe(node) { this.node = node; } disconnect() { this.disconnected = true; } },
        URL: { createObjectURL: blob => { const value = 'blob:pdf-test-' + (++sequence); urls.set(value, blob); return value; }, revokeObjectURL: url => revoked.push(url) },
        require: name => { assert.equal(name, './reader-icons'); return { readerIcon: glyph => { const value = document.createElement('svg'); value.dataset.glyph = glyph; return value; } }; } };
    const source = await fs.readFile(path.join(root, 'src/reader/web/reader-publication-pdf.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
    const host = { language: () => language, request: async (route, options) => {
        requested.push({ route, options }); return new Response(new TextEncoder().encode(route.includes('pdf.worker.mjs') ? 'PARSER\n//# sourceMappingURL=external.map' : route.includes('pdf.mjs') ? 'API' : 'BUILTIN'));
    }, download: () => state.downloads++ };
    const parent = document.createElement('section');
    const reader = new sandbox.exports.ReaderPublicationPdf(parent, host, async () => api);
    return { ...sandbox.exports, sandbox, reader, parent, host, state, api, pdf, requested, observations, urls, revoked,
        button: label => { const value = parent.find('button').find(button => button.getAttribute('aria-label') === label); assert.ok(value, label); return value; },
        open: () => reader.open(async () => new Blob(['%PDF real bytes handed to PDF.js'])) };
}

async function testCanvasLifecycle() {
    for (const language of ['zh', 'en']) {
        const h = await harness(language); assert.equal(h.requested.length, 0); assert.equal(h.state.docCalls, 0, 'Constructing Reader UI never loads the PDF parser.');
        await h.open(); const canvas = h.parent.find('canvas')[0];
        assert.equal(canvas.hidden, false); assert.equal(h.parent.find('canvas').length, 1);
        assert.equal(h.parent.find('output')[0].textContent, language === 'zh' ? '第 1 / 3 页' : 'Page 1 / 3');
        assert.equal(h.button(language === 'zh' ? '上一页' : 'Previous page').disabled, true);
        assert.equal(h.state.options.disableFontFace, true); assert.equal(h.state.options.useWorkerFetch, false); assert.equal(h.state.options.useWasm, false);
        assert.equal(h.state.options.useSystemFonts, false); assert.equal(h.state.options.enableXfa, false); assert.equal(h.state.options.stopAtErrors, true);
        assert.equal(h.state.options.maxImageSize, undefined, 'Do not silently discard source images before the decoded-image guard can inspect them.');
        assert.ok(h.state.options.data instanceof Uint8Array); assert.equal(h.state.options.url, undefined, 'Only authenticated bytes are passed, never a PDF URL.');
        assert.ok(canvas.width <= 4096 && canvas.height <= 4096 && canvas.width * canvas.height <= 8_000_000);
        const gate = deferred(); h.state.renderGate = gate;
        h.button(language === 'zh' ? '下一页' : 'Next page').click(); await drain();
        h.button(language === 'zh' ? '下一页' : 'Next page').click(); await drain();
        assert.equal(h.state.cancelled, 1); assert.equal(h.state.maxActive, 1, 'Rapid navigation serializes cancellation before reusing the same canvas.');
        assert.equal(h.parent.find('output')[0].textContent, language === 'zh' ? '第 3 / 3 页' : 'Page 3 / 3');
        assert.equal(h.button(language === 'zh' ? '下一页' : 'Next page').disabled, true);
        const rendered = h.state.rendered.length; h.observations[0].node.clientWidth = 520; h.observations[0].run(); await drain();
        assert.equal(h.state.rendered.length, rendered + 1); assert.equal(h.parent.find('canvas').length, 1);
        const factory = new h.state.options.BinaryDataFactory({ cMapUrl: 'cmap/', standardFontDataUrl: 'font/', wasmUrl: null });
        assert.equal(factory.cMapUrl, 'cmap/'); assert.equal(factory.standardFontDataUrl, 'font/');
        await factory.fetch({ kind: 'cMapUrl', filename: 'UniGB-UTF16-H.bcmap' });
        await factory.fetch({ kind: 'standardFontDataUrl', filename: 'FoxitSerif.pfb' });
        assert.ok(h.requested.every(request => request.route.startsWith('/api/publication/pdf-runtime?file=')));
        const count = h.requested.length;
        await assert.rejects(factory.fetch({ kind: 'cMapUrl', filename: '../outside.bcmap' }), /unsupported preview resource/);
        await assert.rejects(factory.fetch({ kind: 'wasmUrl', filename: 'openjpeg.wasm' }), /unsupported preview resource/);
        assert.equal(h.requested.length, count, 'Unexpected optional resources cannot initiate a fetch.');
        h.reader.destroy(); assert.equal(h.state.destroyed, 1); assert.equal(h.observations[0].disconnected, true);
        assert.equal(canvas.width, 0); assert.equal(canvas.height, 0); assert.equal(h.parent.children.length, 0);
        await assert.rejects(factory.fetch({ kind: 'cMapUrl', filename: 'UniGB-UTF16-H.bcmap' }), /closed/); assert.equal(h.requested.length, count);
    }
    const loading = await harness(), loadGate = deferred(); loading.state.loadingGate = loadGate;
    const openLoading = loading.open(); await drain(); loading.reader.destroy(); loadGate.resolve(loading.pdf); await openLoading;
    assert.equal(loading.state.destroyed, 1); assert.equal(loading.state.pages.length, 0, 'Closing during document load never requests a late page.');

    const page = await harness(), pageGate = deferred(); page.state.pageGate = pageGate;
    const openPage = page.open(); await drain(); page.reader.destroy(); pageGate.resolve(); await openPage;
    assert.equal(page.state.rendered.length, 0, 'Closing while getPage is pending never draws a late canvas.'); assert.equal(page.parent.children.length, 0);

    const rendering = await harness(), paintGate = deferred(); rendering.state.renderGate = paintGate;
    const openPainting = rendering.open(); await drain(); rendering.reader.destroy(); await openPainting;
    assert.equal(rendering.state.cancelled, 1); assert.equal(rendering.state.destroyed, 1); assert.equal(rendering.parent.children.length, 0);

    const runtime = await harness(), runtimeGate = deferred();
    const runtimeReader = new runtime.ReaderPublicationPdf(runtime.parent, runtime.host, () => runtimeGate.promise);
    const openRuntime = runtimeReader.open(async () => new Blob(['PDF'])); runtimeReader.destroy(); runtimeGate.resolve(runtime.api); await openRuntime;
    assert.equal(runtime.state.docCalls, 0, 'A late runtime cannot open a document after cancellation.'); runtime.reader.destroy();

    const failed = await harness('zh'); failed.state.fail = 'Unexpected PDF operator from a decoder'; await failed.open();
    assert.match(failed.parent.textContent, /无法预览这一页/); assert.match(failed.parent.textContent, /Unexpected PDF operator from a decoder/);
    failed.button('下载 PDF').click(); assert.equal(failed.state.downloads, 1); failed.reader.destroy();
    const large = await harness(); await large.reader.open(async () => ({ size: 16 * 1024 * 1024 + 1 }));
    assert.equal(large.state.docCalls, 0); assert.match(large.parent.textContent, /exceeds the preview size limit/); large.reader.destroy();
}

async function testLazyRuntime() {
    const h = await harness(), abort = new AbortController(), worker = { setup() {} }, imports = [];
    const importer = async url => { const source = await h.urls.get(url).text(); imports.push(source); return source.startsWith('PARSER') ? { WorkerMessageHandler: worker } : h.api; };
    const api = await h.loadPublicationPdfRuntime(h.host.request, abort.signal, importer);
    assert.equal(api, h.api); assert.equal(h.sandbox.pdfjsWorker.WorkerMessageHandler, worker);
    assert.equal(imports.length, 2); assert.doesNotMatch(imports[0], /sourceMappingURL/); assert.equal(h.revoked.length, 2);
    assert.deepEqual(h.requested.map(request => decodeURIComponent(request.route.split('file=')[1])).sort(), ['pdf.mjs', 'pdf.worker.mjs']);
    assert.ok(h.requested.every(request => request.options.signal === abort.signal));
    const again = await h.loadPublicationPdfRuntime(h.host.request, new AbortController().signal, () => { throw new Error('Runtime should already be cached'); });
    assert.equal(again, api); assert.equal(h.requested.length, 2, 'Reopening reuses parser code without retaining a PDF document.'); h.reader.destroy();

    const late = await harness(), gate = deferred(), closed = new AbortController();
    const pending = late.loadPublicationPdfRuntime(late.host.request, closed.signal, async () => { await gate.promise; return { WorkerMessageHandler: worker }; });
    await drain(); closed.abort(); gate.resolve(); await assert.rejects(pending, /closed/);
    assert.equal(late.revoked.length, 2); assert.equal(late.sandbox.pdfjsWorker, undefined, 'A cancelled import never installs a late runtime handler.'); late.reader.destroy();
}

async function testMissingFigures() {
    const data = { width: 2, height: 2, data: new Uint8Array(16) }, bitmap = { width: 2, height: 2, bitmap: { width: 2, height: 2 }, data: null };
    const valid = await harness(); valid.state.localImages.set('png', data); valid.state.localImages.set('mask', data); valid.state.commonImages.set('g_jpeg', bitmap);
    const operations = [[OPS.dependency, ['font_object']], [OPS.paintImageXObject, ['png']], [OPS.paintImageXObjectRepeat, ['g_jpeg', 1, 1, []]],
        [OPS.paintInlineImageXObject, [data]], [OPS.paintInlineImageXObjectGroup, [bitmap, []]], [OPS.paintImageMaskXObject, [{ data: 'mask' }]],
        [OPS.paintImageMaskXObjectRepeat, [data, 1, 0, 0, 1, []]], [OPS.paintImageMaskXObjectGroup, [[{ data: 'mask' }, bitmap]]], [OPS.paintSolidColorImageMask, []], [999, null]];
    valid.state.operators = { fnArray: operations.map(([op]) => op), argsArray: operations.map(([, args]) => args) };
    await valid.open(); assert.equal(valid.parent.find('canvas')[0].hidden, false);
    assert.equal(valid.state.filtered.length, operations.length); assert.ok(valid.state.filtered.every(value => value === true), 'The guard never filters valid image, solid mask or unrelated font/content operations.'); valid.reader.destroy();
    for (const [op, args, pool] of [[OPS.paintImageXObject, ['missing'], 'missing'], [OPS.paintImageXObject, ['null-image'], 'null'],
        [OPS.paintImageXObjectRepeat, ['g_missing', 1, 1, []], 'common'], [OPS.paintInlineImageXObject, [null]], [OPS.paintInlineImageXObjectGroup, [{ data: null }, []]],
        [OPS.paintImageMaskXObject, [{ data: 'null-mask' }], 'mask'], [OPS.paintImageMaskXObjectRepeat, [null]], [OPS.paintImageMaskXObjectGroup, [[{ data: 'null-mask' }]], 'mask']]) {
        const failed = await harness('zh');
        if (pool === 'null') failed.state.localImages.set('null-image', null);
        if (pool === 'common') failed.state.commonImages.set('g_missing', null);
        if (pool === 'mask') failed.state.localImages.set('null-mask', null);
        failed.state.operators = { fnArray: [op], argsArray: [args] }; await failed.open();
        assert.equal(failed.parent.find('canvas')[0].hidden, true, 'A null/missing decoded image cannot expose a partial canvas.');
        assert.match(failed.parent.textContent, /图片未能完整解码/); failed.button('下载 PDF').click(); assert.equal(failed.state.downloads, 1); failed.reader.destroy();
    }
}

export async function testReaderPublicationPdf() { await testCanvasLifecycle(); await testLazyRuntime(); await testMissingFigures(); }
