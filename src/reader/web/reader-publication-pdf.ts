import { readerLabel, readerText, readerAttribute, readerWords } from './reader-ui-labels';
import { readerIcon } from './reader-icons';
import type { getDocument, OPS, PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

type PdfRuntime = { getDocument: typeof getDocument; version: string; OPS: typeof OPS };
type PdfOperatorList = Awaited<ReturnType<PDFPageProxy['getOperatorList']>>;
type PdfRequest = (route: string, options?: RequestInit) => Promise<Response>;
type ModuleImporter = (url: string) => Promise<any>;
export interface PublicationPdfHost { language(): 'zh' | 'en'; request: PdfRequest; download(): void }

const MAX_PDF_BYTES = 16 * 1024 * 1024;
const MAX_CANVAS_PIXELS = 8_000_000;
const MAX_CANVAS_DIMENSION = 4096;
const RUNTIME_ROUTE = '/api/publication/pdf-runtime?file=';
const copy = {
    zh: { loading: '正在准备 PDF 预览…', rendering: '正在绘制页面…', failed: '无法预览这一页。仍可下载 PDF 查看。',
        details: '错误详情', download: '下载 PDF', previous: '上一页', next: '下一页', page: (page: number, total: number) => `第 ${page} / ${total} 页`,
        large: '这份 PDF 超过预览大小限制，请下载查看。', invalid: 'PDF 页面尺寸无法用于预览。',
        missingImage: '图片未能完整解码，预览已停止。请下载 PDF 查看。' },
    en: { loading: 'Preparing PDF preview…', rendering: 'Rendering page…', failed: 'This page could not be previewed. You can still download the PDF.',
        details: 'Error details', download: 'Download PDF', previous: 'Previous page', next: 'Next page', page: (page: number, total: number) => `Page ${page} / ${total}`,
        large: 'This PDF exceeds the preview size limit. Download it to view.', invalid: 'The PDF page dimensions cannot be previewed.',
        missingImage: 'A figure could not be decoded completely. Preview stopped; download the PDF to view it.' }
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
}
function checkSignal(signal: AbortSignal): void { if (signal.aborted) throw new Error('PDF preview closed.'); }

async function runtimeBytes(request: PdfRequest, file: string, signal: AbortSignal): Promise<Uint8Array> {
    checkSignal(signal);
    const response = await request(RUNTIME_ROUTE + encodeURIComponent(file), { cache: 'force-cache', signal });
    if (!response.ok) throw new Error(await response.text());
    const bytes = new Uint8Array(await response.arrayBuffer()); checkSignal(signal); return bytes;
}

let cachedRuntime: PdfRuntime | undefined;
let pendingRuntime: { signal: AbortSignal; promise: Promise<PdfRuntime> } | undefined;
const importModule: ModuleImporter = url => import(/* @vite-ignore */ url);

/** The large parser/API stay outside Reader's initial bundle and MCP resource. */
export function loadPublicationPdfRuntime(request: PdfRequest, signal: AbortSignal, importer: ModuleImporter = importModule): Promise<PdfRuntime> {
    checkSignal(signal);
    if (cachedRuntime) return Promise.resolve(cachedRuntime);
    if (pendingRuntime && !pendingRuntime.signal.aborted) return pendingRuntime.promise;
    const pending = { signal, promise: undefined as unknown as Promise<PdfRuntime> };
    pending.promise = (async () => {
        const urls: string[] = [];
        try {
            const files = await Promise.all(['pdf.worker.mjs', 'pdf.mjs'].map(file => runtimeBytes(request, file, signal)));
            checkSignal(signal);
            for (const bytes of files) {
                const source = new TextDecoder().decode(bytes).replace(/^\/\/# sourceMappingURL=.*$/gm, '');
                const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); urls.push(url);
            }
            const parser = await importer(urls[0]); checkSignal(signal);
            const api = await importer(urls[1]); checkSignal(signal);
            if (api.version !== '6.4.299' || typeof api.getDocument !== 'function' || typeof api.OPS?.paintImageXObject !== 'number' || typeof parser.WorkerMessageHandler?.setup !== 'function') {
                throw new Error('The bundled PDF preview runtime is incomplete or incompatible.');
            }
            // Pinned PDF.js selects its loopback implementation before attempting a Worker.
            // No external script, native Worker, eval, or generated font stylesheet is needed.
            (globalThis as any).pdfjsWorker = { WorkerMessageHandler: parser.WorkerMessageHandler };
            return cachedRuntime = api;
        } finally {
            urls.forEach(url => URL.revokeObjectURL(url));
            if (pendingRuntime === pending) pendingRuntime = undefined;
        }
    })();
    pendingRuntime = pending; return pending.promise;
}

/** A per-document factory preserves authenticated project routing for optional built-in data. */
function binaryDataFactory(request: PdfRequest, signal: AbortSignal) {
    return class PublicationBinaryDataFactory {
        readonly cMapUrl: string;
        readonly standardFontDataUrl: string;
        readonly wasmUrl: string;
        constructor(options: { cMapUrl: string; standardFontDataUrl: string; wasmUrl: string }) { Object.assign(this, options); }
        fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
            const folder = kind === 'cMapUrl' ? 'cmaps' : kind === 'standardFontDataUrl' ? 'standard_fonts' : '';
            const extension = folder === 'cmaps' ? /\.bcmap$/ : /\.(?:pfb|ttf)$/;
            if (!folder || typeof filename !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(filename) || filename.includes('..') || !extension.test(filename)) {
                return Promise.reject(new Error('This PDF requires an unsupported preview resource. Download it to view.'));
            }
            return runtimeBytes(request, `${folder}/${filename}`, signal);
        }
    };
}

/** Pinned 6.4.299 may resolve failed XObject decoding as null without rejecting render(). */
function requireImageOperation(page: PDFPageProxy, ops: typeof OPS, list: PdfOperatorList, index: number, message: string): void {
    const op = list.fnArray[index], args = list.argsArray[index];
    const requireImage = (value: any) => {
        if (typeof value === 'string') {
            try { value = (value.startsWith('g_') ? page.commonObjs : page.objs).get(value); }
            catch { throw new Error(message); }
        }
        if (!value || !value.bitmap && !(value.data && (value.data.byteLength > 0 || value.data.length > 0))) throw new Error(message);
    };
    const requireMask = (value: any) => requireImage(typeof value?.data === 'string' ? value.data : value);
    if (op === ops.paintImageXObject || op === ops.paintImageXObjectRepeat
        || op === ops.paintInlineImageXObject || op === ops.paintInlineImageXObjectGroup) requireImage(args?.[0]);
    else if (op === ops.paintImageMaskXObject || op === ops.paintImageMaskXObjectRepeat) requireMask(args?.[0]);
    else if (op === ops.paintImageMaskXObjectGroup) {
        if (!Array.isArray(args?.[0])) throw new Error(message);
        args[0].forEach(requireMask);
    }
}

/** Owns one preview document, one canvas, render admission, resizing and terminal cleanup. */
export class ReaderPublicationPdf {
    private readonly controls = element('div', '', 'publication-pdf-controls');
    private readonly previous = element('button', '', 'publication-icon');
    private readonly next = element('button', '', 'publication-icon');
    private readonly count = element('output', '', 'publication-pdf-count');
    private readonly status = element('div', '', 'publication-pdf-status');
    private readonly stage = element('div', '', 'publication-pdf-stage');
    private readonly canvas = element('canvas');
    private readonly abort = new AbortController();
    private observer?: ResizeObserver;
    private loading?: PDFDocumentLoadingTask;
    private pdf?: PDFDocumentProxy;
    private task?: RenderTask;
    private ops?: typeof OPS;
    private queue: Promise<void> = Promise.resolve();
    private active = true;
    private renderGeneration = 0;
    private page = 1;
    private width = 0;
    constructor(private readonly parent: HTMLElement, private readonly host: PublicationPdfHost,
        private readonly runtime = loadPublicationPdfRuntime) {
        this.previous.type = this.next.type = 'button'; this.previous.append(readerIcon('chevron-left')); this.next.append(readerIcon('chevron-right'));
        this.previous.addEventListener('click', () => this.show(this.page - 1)); this.next.addEventListener('click', () => this.show(this.page + 1));
        this.count.setAttribute('aria-live', 'polite'); this.status.setAttribute('role', 'status');
        this.canvas.setAttribute('role', 'img'); this.canvas.hidden = true;
        this.controls.append(this.previous, this.count, this.next); this.stage.append(this.canvas); parent.append(this.controls, this.status, this.stage);
        this.updateControls();
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => {
                if (!this.active || !this.pdf) return;
                const width = this.availableWidth(); if (Math.abs(width - this.width) < 2) return; this.show(this.page);
            }); this.observer.observe(this.stage);
        }
    }
    private words() { return readerWords(() => copy[this.host.language()]); }
    private current(generation: number): boolean { return this.active && !this.abort.signal.aborted && generation === this.renderGeneration; }
    private updateControls(): void {
        const w = this.words();
        for (const [button, key] of [[this.previous, 'previous'], [this.next, 'next']] as const) {
            for (const attribute of ['title', 'aria-label', 'data-tooltip']) readerAttribute(button, attribute, () => this.words()[key]);
        }
        this.previous.disabled = !this.pdf || this.page <= 1; this.next.disabled = !this.pdf || this.page >= this.pdf.numPages;
        readerText(this.count, () => this.pdf ? this.words().page(this.page, this.pdf.numPages) : '');
    }
    async open(load: (signal: AbortSignal) => Promise<Blob>): Promise<void> {
        readerText(this.status, () => this.words().loading); this.parent.setAttribute('aria-busy', 'true');
        try {
            const [runtime, blob] = await Promise.all([this.runtime(this.host.request, this.abort.signal), load(this.abort.signal)]);
            if (!this.active) return;
            if (blob.size > MAX_PDF_BYTES) throw new Error(this.words().large);
            const data = new Uint8Array(await blob.arrayBuffer()); if (!this.active) return;
            this.ops = runtime.OPS;
            this.loading = runtime.getDocument({ data, disableFontFace: true, useSystemFonts: false, useWasm: false,
                useWorkerFetch: false, stopAtErrors: true, enableXfa: false, disableAutoFetch: true, disableStream: true, disableRange: true,
                isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
                canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4, verbosity: 0,
                cMapUrl: 'urn:math-workspace:pdfjs/cmaps/', standardFontDataUrl: 'urn:math-workspace:pdfjs/standard_fonts/',
                BinaryDataFactory: binaryDataFactory(this.host.request, this.abort.signal) });
            const pdf = await this.loading.promise;
            if (!this.active) return; // The loading task owns and destroys its document.
            this.pdf = pdf; this.show(1); await this.queue;
        } catch (error) { if (this.active) this.error(error); }
    }
    private availableWidth(): number { return Math.max(120, Math.min(1600, (this.stage.clientWidth || this.parent.clientWidth || 800) - 24)); }
    private show(page: number): void {
        if (!this.active || !this.pdf) return;
        this.page = Math.max(1, Math.min(this.pdf.numPages, page));
        const generation = ++this.renderGeneration, target = this.page;
        this.task?.cancel(); this.updateControls();
        this.queue = this.queue.catch(() => undefined).then(() => this.paint(target, generation));
    }
    private async paint(target: number, generation: number): Promise<void> {
        if (!this.current(generation) || !this.pdf) return;
        this.canvas.hidden = true; readerText(this.status, () => this.words().rendering); this.parent.setAttribute('aria-busy', 'true');
        let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>;
        try {
            page = await this.pdf.getPage(target); if (!this.current(generation)) return;
            const base = page.getViewport({ scale: 1 });
            if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0 || base.height / base.width > 40) throw new Error(this.words().invalid);
            this.width = this.availableWidth(); const viewport = page.getViewport({ scale: this.width / base.width });
            const pixels = Math.min(window.devicePixelRatio || 1, 2, MAX_CANVAS_DIMENSION / viewport.width,
                MAX_CANVAS_DIMENSION / viewport.height, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
            this.canvas.width = Math.max(1, Math.floor(viewport.width * pixels)); this.canvas.height = Math.max(1, Math.floor(viewport.height * pixels));
            readerAttribute(this.canvas, 'aria-label', () => this.words().page(target, this.pdf.numPages));
            this.task = page.render({ canvas: this.canvas, viewport, transform: [pixels, 0, 0, pixels, 0, 0], background: '#ffffff',
                operationsFilter: (index, list) => {
                    // Preceding dependency operators have resolved these IDs; never filter valid content.
                    requireImageOperation(page, this.ops!, list, index, this.words().missingImage); return true;
                } });
            await this.task.promise; if (!this.current(generation)) return;
            this.status.replaceChildren(); this.canvas.hidden = false; this.parent.removeAttribute('aria-busy');
        } catch (error) { if (this.current(generation)) this.error(error); }
        finally { this.task = undefined; page?.cleanup(); }
    }
    private error(error: unknown): void {
        const w = this.words(), details = element('details'), download = element('button', '', 'publication-icon');
        details.append(readerLabel(element('summary', w.details), () => this.words().details), element('pre', error instanceof Error ? error.message : String(error)));
        download.type = 'button'; download.title = w.download; readerAttribute(download, 'aria-label', () => this.words().download); download.dataset.tooltip = w.download;
        download.append(readerIcon('download')); download.addEventListener('click', () => this.host.download());
        this.canvas.hidden = true; this.parent.removeAttribute('aria-busy'); this.status.replaceChildren(readerLabel(element('p', w.failed), () => this.words().failed), details, download);
    }
    destroy(): void {
        if (!this.active) return;
        this.active = false; ++this.renderGeneration; this.abort.abort(); this.observer?.disconnect(); this.task?.cancel();
        this.canvas.width = this.canvas.height = 0; this.canvas.hidden = true;
        if (this.loading) void this.loading.destroy().catch(() => undefined);
        this.pdf = undefined; this.loading = undefined; this.controls.remove(); this.status.remove(); this.stage.remove();
    }
}
