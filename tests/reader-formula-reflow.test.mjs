import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import ts from 'typescript';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG_NS = 'http://www.w3.org/2000/svg';
const simple = String.raw`a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s+t=u+v+w+x+y+z`;
const aligned = String.raw`\begin{aligned} A_n &= a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}\\ B_n &= b_1+b_2+b_3+b_4+b_5+b_6+b_7+b_8+b_9+b_{10}+b_{11}+b_{12}\end{aligned}`;
const nested = String.raw`\left(\sum_{i=1}^{n}a_i+\left[\frac{b_1+b_2}{c_1+c_2}+\sqrt{x_1+x_2+x_3+x_4+x_5}\right]+d_1+d_2+d_3+d_4+d_5\right)=z`;
const matrix = String.raw`\begin{pmatrix}12345678901234567890&12345678901234567890&12345678901234567890\\12345678901234567890&12345678901234567890&12345678901234567890\end{pmatrix}`;
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

class Element {
    constructor(localName, namespaceURI) { this.localName = localName; this.namespaceURI = namespaceURI; this.nodeType = 1; this.attributes = []; this.childNodes = []; this.style = {}; }
    setAttribute(name, value) { const previous = this.attributes.find(attribute => attribute.name === name); if (previous) previous.value = String(value); else this.attributes.push({ name, value: String(value) }); }
    setAttributeNS(_ns, name, value) { this.setAttribute(name, value); }
    getAttribute(name) { return this.attributes.find(attribute => attribute.name === name)?.value ?? null; }
    append(...children) { this.childNodes.push(...children); }
    get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
}

/** Use the dependency's parser for DOM facades; live XML parsing is exercised by Reader preview. */
class Parser {
    parseFromString(markup) {
        const adaptor = liteAdaptor(), tree = adaptor.parse(markup, 'image/svg+xml');
        const copy = (node, namespace) => {
            if (adaptor.kind(node) === '#text') return { nodeType: 3, textContent: adaptor.value(node) };
            const item = new Element(adaptor.kind(node), adaptor.getAttribute(node, 'xmlns') || namespace);
            for (const { name, value } of adaptor.allAttributes(node)) item.setAttribute(name, value);
            item.append(...adaptor.childNodes(node).map(child => copy(child, item.namespaceURI))); return item;
        };
        const children = adaptor.childNodes(adaptor.body(tree));
        return { documentElement: children[0] && copy(children[0], SVG_NS), querySelector: () => children.length === 1 ? null : {} };
    }
}

async function loaderHarness() {
    const source = await fs.readFile(path.join(repo, 'src/reader/web/reader-formula-reflow.ts'), 'utf8'), urls = new Map(), revoked = [];
    const document = { createElement: tag => new Element(tag), createElementNS: (namespace, tag) => new Element(tag, namespace),
        createTextNode: textContent => ({ nodeType: 3, textContent }) };
    let sequence = 0;
    const sandbox = { exports: {}, document, DOMParser: Parser, DOMException, Blob, AbortController, console, Set, URL: {
        createObjectURL(blob) { const url = 'blob:formula-test-' + (++sequence); urls.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); }
    } };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
    return { ...sandbox.exports, urls, revoked };
}

async function testLoading() {
    const h = await loaderHarness(), calls = [], runtime = { version: '4.1.3', format: 'math-workspace.formula-reflow/v1', renderFormula() {} };
    const gate = deferred(), first = new AbortController(), second = new AbortController();
    const request = async (route, options) => { calls.push({ route, options }); await gate.promise; return new Response('LOCAL MODULE'); };
    const imports = [], importer = async url => { imports.push(await h.urls.get(url).text()); return runtime; };
    const a = h.loadFormulaReflowRuntime(request, first.signal, importer), aRejected = assert.rejects(a, error => error.name === 'AbortError');
    const b = h.loadFormulaReflowRuntime(request, second.signal, importer);
    first.abort(); assert.equal(calls.length, 1); assert.equal(calls[0].options.signal.aborted, false, 'Another formula still owns the shared code load.');
    gate.resolve(); await aRejected; assert.equal(await b, runtime); assert.deepEqual(imports, ['LOCAL MODULE']); assert.equal(h.revoked.length, 1);
    assert.equal(calls[0].route, '/api/formula-runtime?file=mathjax-tex-svg.mjs');
    assert.equal(await h.loadFormulaReflowRuntime(() => { throw new Error('Already cached'); }, new AbortController().signal, importer), runtime);
    const aborted = new AbortController(); aborted.abort(); await assert.rejects(h.loadFormulaReflowRuntime(request, aborted.signal, importer), error => error.name === 'AbortError');

    const cancelled = await loaderHarness(), importGate = deferred(), abort = new AbortController();
    let internalSignal;
    const c = cancelled.loadFormulaReflowRuntime(async (_route, options) => { internalSignal = options.signal; return new Response('LOCAL MODULE'); }, abort.signal,
        async () => { await importGate.promise; return runtime; });
    const cRejected = assert.rejects(c, error => error.name === 'AbortError');
    await new Promise(resolve => setImmediate(resolve)); abort.abort(); await cRejected; assert.equal(internalSignal.aborted, true); importGate.resolve();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled.revoked.length, 1);
    let retried = 0;
    await cancelled.loadFormulaReflowRuntime(async () => { retried++; return new Response('RETRY'); }, new AbortController().signal, async () => runtime);
    assert.equal(retried, 1, 'An entirely cancelled load cannot install a late cache.');

    for (const invalid of [{ ...runtime, version: '3.2.2' }, { ...runtime, format: 'other' }, { ...runtime, renderFormula: null }]) {
        const bad = await loaderHarness(); await assert.rejects(bad.loadFormulaReflowRuntime(async () => new Response('MODULE'), new AbortController().signal, async () => invalid), /incompatible/);
        assert.equal(bad.revoked.length, 1);
    }
    const failure = await loaderHarness();
    await assert.rejects(failure.loadFormulaReflowRuntime(() => { throw new Error('Request context changed'); }, new AbortController().signal, importer), /context changed/);
    assert.equal(await failure.loadFormulaReflowRuntime(async () => new Response('RETRY'), new AbortController().signal, async () => runtime), runtime,
        'A synchronous request rejection must not strand the runtime cache.');
}

async function testSafeResult(runtime) {
    const h = await loaderHarness(), signal = new AbortController().signal;
    const options = { latex: aligned, widthPx: 320, fontSizePx: 18, request: () => { throw new Error('Injected runtime performs no request'); }, signal };
    const result = await h.renderReflowedFormula(options, async () => runtime);
    assert.equal(result.element.className, 'reader-formula-reflow'); assert.equal(result.element.getAttribute('aria-hidden'), 'true');
    assert.equal(result.element.style.display, 'inline-block'); assert.equal(result.element.style.width, result.widthPx + 'px');
    assert.equal(result.element.childNodes.length, 1); assert.equal(result.element.childNodes[0].localName, 'svg'); assert.equal(result.element.childNodes[0].getAttribute('width'), String(result.widthPx));
    const frame = markup => ({ ...runtime, renderFormula: () => ({ markup, widthPx: 20, heightPx: 20 }) });
    for (const markup of [
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>HTML</div></foreignObject></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><g onclick="alert(1)"></g></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><g style="fill:url(https://outside.invalid/x)"></g></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://outside.invalid/x"></use></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><use href="#missing"></use></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><g data-mml-node="merror"></g></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><path id="duplicate"></path><path id="duplicate"></path></svg>',
        '<!DOCTYPE svg [<!ENTITY x SYSTEM "https://outside.invalid">]><svg xmlns="http://www.w3.org/2000/svg"></svg>'
    ]) await assert.rejects(h.renderReflowedFormula(options, async () => frame(markup)), /adapted formula/);
    for (const dimensions of [{ widthPx: 322, heightPx: 20 }, { widthPx: NaN, heightPx: 20 }, { widthPx: 20, heightPx: 9000 }]) {
        await assert.rejects(h.renderReflowedFormula(options, async () => ({ ...runtime, renderFormula: () => dimensions })), /does not fit/);
    }
    let requested = 0;
    await assert.rejects(h.renderReflowedFormula({ ...options, latex: 'x'.repeat(16_385) }, async () => { requested++; return runtime; }), /requested size/);
    assert.equal(requested, 0, 'Invalid source or geometry is rejected before loading code.');
    const gate = deferred(), abort = new AbortController(); let rendered = 0;
    const pending = h.renderReflowedFormula({ ...options, signal: abort.signal }, async () => { await gate.promise; return { renderFormula() { rendered++; } }; });
    abort.abort(); gate.resolve(); await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(rendered, 0);
}

export async function testReaderFormulaReflow() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-formula-reflow-'));
    try {
        const output = path.join(temporary, 'mathjax-tex-svg.mjs');
        const bundle = await build({ entryPoints: [path.join(repo, 'src/reader/web/reader-formula-reflow-runtime.ts')], outfile: output,
            bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, logLevel: 'silent', metafile: true,
            plugins: [{ name: 'static-tex-font', setup(builder) { builder.onResolve({ filter: /^#default-font\/svg\/default\.js$/ }, () => ({ path: path.join(repo, 'src/reader/web/reader-formula-tex-font.ts') })); } }] });
        const bytes = await fs.readFile(output), source = bytes.toString();
        assert.ok(bytes.length < 2_000_000); assert.ok(gzipSync(bytes).length < 800_000);
        assert.ok(Object.values(bundle.metafile.outputs).every(item => item.imports.length === 0), 'The packaged module must have no imports or dynamic chunks.');
        assert.ok(Object.keys(bundle.metafile.inputs).every(name => !/mathjax-newcm-font|speech-rule-engine|mj-context-menu|mhchemparser/.test(name)), 'Unused menus, speech, chemistry and dynamic fonts stay outside the runtime.');
        assert.doesNotMatch(source, /import\s*\(|https:\/\//, 'No script/font loader or external URL is bundled.');
        const runtime = await import(pathToFileURL(output));
        assert.equal(runtime.version, '4.1.3'); assert.equal(runtime.format, 'math-workspace.formula-reflow/v1');
        for (const latex of [simple, aligned, nested]) {
            const narrow = runtime.renderFormula({ latex, widthPx: 320, fontSizePx: 18 }), wide = runtime.renderFormula({ latex, widthPx: 700, fontSizePx: 18 });
            assert.ok(narrow.widthPx <= 321); assert.ok(narrow.heightPx > wide.heightPx, 'Narrow render creates additional lines at the same font size.');
            assert.match(narrow.markup, /data-mjx-linestack/); assert.match(narrow.markup, /<defs><path/);
            assert.doesNotMatch(narrow.markup, /<text|<style|style=|<image|<foreignObject/);
        }
        const matrixWide = runtime.renderFormula({ latex: matrix, widthPx: 700, fontSizePx: 18 }); assert.ok(matrixWide.widthPx > 500);
        assert.throws(() => runtime.renderFormula({ latex: matrix, widthPx: 320, fontSizePx: 18 }), /cannot fit/);
        for (const latex of [String.raw`x+\unsupported{y}+z`, String.raw`\href{https://outside.invalid}{x}`, String.raw`\require{html}x`, String.raw`\text{你好}+x`]) {
            assert.throws(() => runtime.renderFormula({ latex, widthPx: 320, fontSizePx: 18 }));
        }
        for (const environment of ['align', 'alignat', 'flalign', 'gather', 'equation', 'eqnarray', 'multline']) {
            const columns = environment === 'alignat' ? '{1}' : '';
            assert.throws(() => runtime.renderFormula({ latex: `\\begin{${environment}}${columns} x=1 \\end{${environment}}`, widthPx: 700, fontSizePx: 18 }), /Numbered formulas/);
        }
        for (const latex of [String.raw`x=1\tag{A.1}`, String.raw`x=1\tag*{A.1}`, String.raw`\newcommand{\mytag}[1]{\tag{#1}}x=1\mytag{A.1}`]) {
            assert.throws(() => runtime.renderFormula({ latex, widthPx: 700, fontSizePx: 18 }), /Tagged formulas/);
        }
        assert.throws(() => runtime.renderFormula({ latex: String.raw`\newcommand{\numbered}{\begin{align}}\numbered x=1\end{align}`, widthPx: 700, fontSizePx: 18 }), /Numbered formulas/);
        const local = runtime.renderFormula({ latex: String.raw`\newcommand{\localmacro}{a+b}\localmacro`, widthPx: 320, fontSizePx: 18 }); assert.match(local.markup, /<svg/);
        assert.throws(() => runtime.renderFormula({ latex: String.raw`\localmacro`, widthPx: 320, fontSizePx: 18 }), /Undefined control sequence/);
        await testSafeResult(runtime); await testLoading();
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await testReaderFormulaReflow(); console.log('Reader formula reflow passed.');
}
