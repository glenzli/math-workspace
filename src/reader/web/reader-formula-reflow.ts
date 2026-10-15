import type { FormulaRenderInput, FormulaRenderOutput } from './reader-formula-reflow-runtime';

type FormulaRequest = (route: string, options?: RequestInit) => Promise<Response>;
type ModuleImporter = (url: string) => Promise<any>;
interface FormulaRuntime { version: string; format: string; renderFormula(input: FormulaRenderInput): FormulaRenderOutput }
export interface FormulaReflowOptions extends FormulaRenderInput { request: FormulaRequest; signal: AbortSignal }
export interface FormulaReflowResult { element: HTMLElement; widthPx: number; heightPx: number }

const RUNTIME_ROUTE = '/api/formula-runtime?file=mathjax-tex-svg.mjs';
const SVG_NS = 'http://www.w3.org/2000/svg', XLINK_NS = 'http://www.w3.org/1999/xlink';
const MAX_MARKUP = 1_048_576, MAX_NODES = 20_000;
const importModule: ModuleImporter = url => import(/* @vite-ignore */ url);
let cachedRuntime: FormulaRuntime | undefined;
interface RuntimeLoad { abort: AbortController; waiters: number; settled: boolean; promise: Promise<FormulaRuntime> }
let pendingRuntime: RuntimeLoad | undefined;

function checkSignal(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Formula adaptation was cancelled.', 'AbortError');
}
function checkInput(input: FormulaRenderInput): void {
    if (typeof input?.latex !== 'string' || !input.latex.trim() || input.latex.length > 16_384
        || !Number.isFinite(input.widthPx) || input.widthPx < 48 || input.widthPx > 8192
        || !Number.isFinite(input.fontSizePx) || input.fontSizePx < 8 || input.fontSizePx > 64) {
        throw new Error('This formula cannot be adapted at the requested size.');
    }
}

function awaitRuntime(pending: RuntimeLoad, signal: AbortSignal): Promise<FormulaRuntime> {
    pending.waiters++;
    return new Promise((resolve, reject) => {
        let finished = false;
        const finish = (accept: (value: any) => void, value: unknown) => {
            if (finished) return;
            finished = true; signal.removeEventListener('abort', aborted); pending.waiters--;
            if (!pending.waiters && !pending.settled) pending.abort.abort();
            accept(value);
        };
        const aborted = () => finish(reject, new DOMException('Formula adaptation was cancelled.', 'AbortError'));
        signal.addEventListener('abort', aborted, { once: true });
        pending.promise.then(runtime => finish(resolve, runtime), error => finish(reject, error));
        if (signal.aborted) aborted();
    });
}

/** Keep the engine and glyph paths outside the initial Reader and MCP HTML. */
export async function loadFormulaReflowRuntime(request: FormulaRequest, signal: AbortSignal,
    importer: ModuleImporter = importModule): Promise<FormulaRuntime> {
    checkSignal(signal);
    if (cachedRuntime) return cachedRuntime;
    if (pendingRuntime && !pendingRuntime.abort.signal.aborted) return awaitRuntime(pendingRuntime, signal);
    const pending: RuntimeLoad = { abort: new AbortController(), waiters: 0, settled: false, promise: undefined as unknown as Promise<FormulaRuntime> };
    const loadingSignal = pending.abort.signal;
    pendingRuntime = pending;
    pending.promise = (async () => {
        let url: string | undefined;
        try {
            const response = await request(RUNTIME_ROUTE, { signal: loadingSignal, cache: 'force-cache' });
            if (!response.ok) throw new Error('The optional formula runtime could not be loaded.');
            const bytes = await response.arrayBuffer(); checkSignal(loadingSignal);
            if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024) throw new Error('The optional formula runtime is invalid.');
            url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
            const runtime = await importer(url); checkSignal(loadingSignal);
            if (runtime?.version !== '4.1.3' || runtime?.format !== 'math-workspace.formula-reflow/v1' || typeof runtime.renderFormula !== 'function') {
                throw new Error('The optional formula runtime is incompatible.');
            }
            return cachedRuntime = runtime;
        } finally {
            pending.settled = true;
            if (url) URL.revokeObjectURL(url);
            if (pendingRuntime === pending) pendingRuntime = undefined;
        }
    })();
    return awaitRuntime(pending, signal);
}

const TAGS = new Set(['svg', 'g', 'defs', 'path', 'use', 'rect', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'text', 'tspan']);
const ATTRIBUTES = new Set(['xmlns', 'xmlns:xlink', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'id', 'd', 'transform',
    'x', 'y', 'dx', 'dy', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'stroke', 'stroke-width', 'stroke-dasharray',
    'stroke-linecap', 'stroke-linejoin', 'fill', 'fill-rule', 'opacity', 'visibility', 'font-size', 'font-family', 'font-style', 'font-weight',
    'text-anchor', 'dominant-baseline', 'role', 'focusable', 'vector-effect']);

/** Rebuild a restricted SVG tree; rejected output leaves the caller's KaTeX intact. */
function sanitizedImage(markup: string): SVGElement {
    if (typeof markup !== 'string' || !markup.length || markup.length > MAX_MARKUP || /<!DOCTYPE|<!ENTITY/i.test(markup)) {
        throw new Error('The adapted formula output is invalid.');
    }
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement?.localName !== 'svg') throw new Error('The adapted formula output is invalid.');
    const ids = new Set<string>(), references: string[] = [];
    let count = 0;
    const copy = (source: Element): SVGElement => {
        if (++count > MAX_NODES || source.namespaceURI !== SVG_NS || !TAGS.has(source.localName)) throw new Error('The adapted formula contains an unsupported element.');
        const target = document.createElementNS(SVG_NS, source.localName);
        for (const attribute of Array.from(source.attributes)) {
            const name = attribute.name, value = attribute.value;
            if (name === 'href' || name === 'xlink:href') {
                if (source.localName !== 'use' || !/^#[a-zA-Z_][\w.:-]*$/.test(value)) throw new Error('The adapted formula contains an external reference.');
                references.push(value.slice(1));
                if (name === 'xlink:href') target.setAttributeNS(XLINK_NS, name, value); else target.setAttribute(name, value);
                continue;
            }
            if (!ATTRIBUTES.has(name) && !/^data-[a-z0-9-]+$/.test(name) || /url\s*\(|[<>]/i.test(value)
                || name === 'xmlns' && value !== SVG_NS || name === 'xmlns:xlink' && value !== XLINK_NS
                || name === 'data-mml-node' && value === 'merror') throw new Error('The adapted formula contains an unsupported attribute.');
            if (name === 'id') {
                if (!/^[a-zA-Z_][\w.:-]*$/.test(value) || ids.has(value)) throw new Error('The adapted formula contains an invalid identity.');
                ids.add(value);
            }
            target.setAttribute(name, value);
        }
        for (const child of Array.from(source.childNodes)) {
            if (child.nodeType === 1) target.append(copy(child as Element));
            else if (child.nodeType === 3) target.append(document.createTextNode(child.textContent || ''));
            else throw new Error('The adapted formula contains unsupported content.');
        }
        return target;
    };
    const image = copy(parsed.documentElement);
    if (references.some(id => !ids.has(id))) throw new Error('The adapted formula contains an unresolved glyph.');
    return image;
}

/** Rendering never edits the live formula; its controller verifies and mounts this result. */
export async function renderReflowedFormula(options: FormulaReflowOptions,
    loadRuntime = loadFormulaReflowRuntime): Promise<FormulaReflowResult> {
    checkSignal(options.signal); checkInput(options);
    const runtime = await loadRuntime(options.request, options.signal); checkSignal(options.signal);
    const result = runtime.renderFormula({ latex: options.latex, widthPx: options.widthPx, fontSizePx: options.fontSizePx });
    checkSignal(options.signal);
    if (!Number.isFinite(result?.widthPx) || result.widthPx <= 0 || result.widthPx > options.widthPx + 1
        || !Number.isFinite(result.heightPx) || result.heightPx <= 0 || result.heightPx > 8192 || result.widthPx * result.heightPx > 8_000_000) {
        throw new Error('The adapted formula does not fit its available space.');
    }
    const image = sanitizedImage(result.markup), element = document.createElement('span');
    image.setAttribute('width', String(result.widthPx)); image.setAttribute('height', String(result.heightPx));
    image.style.display = 'block'; image.style.overflow = 'visible';
    element.className = 'reader-formula-reflow'; element.setAttribute('aria-hidden', 'true');
    element.style.display = 'inline-block'; element.style.width = result.widthPx + 'px'; element.style.height = result.heightPx + 'px';
    element.append(image); checkSignal(options.signal);
    return { element, widthPx: result.widthPx, heightPx: result.heightPx };
}
