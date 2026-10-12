type ReaderState = { projectRoot?: string; pagePath?: string; scrollTop?: number };
import type { ReaderReferenceContent } from './reader-references';
type HostWindow = Window & { openai?: {
    widgetState?: ReaderState; toolOutput?: { reader?: ReaderState & { launcher?: boolean } };
    setWidgetState?: (state: ReaderState) => void; requestDisplayMode?: (request: { mode: string }) => Promise<unknown>;
} };
const host = typeof window === 'undefined' ? undefined : window as HostWindow;
const embedded = typeof document !== 'undefined' && document.documentElement.hasAttribute('data-math-workspace-app');
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let sequence = 0, parentOrigin = '*', stopped = false;
let closing: Promise<unknown> | undefined;
let recovering: Promise<void> | undefined;
let viewGeneration = 0;
let requestToken: string | undefined;
const reconnectListeners = new Set<(state: string) => void>();
let search = '';
let restoredPage = false;
let referenceDraftAvailable = false;
let saved: ReaderState = host?.openai?.widgetState || {};
let initial: ReaderState & { launcher?: boolean } | undefined;
let receiveSeed: (() => void) | undefined;
const viewKey = embedded ? crypto.randomUUID().replaceAll('-', '') : '';

export function isReaderApp(): boolean { return embedded; }
export function isReaderPageRestored(): boolean { return restoredPage; }
export function canReferenceReaderInConversation(): boolean { return embedded && referenceDraftAvailable && !stopped; }
function send(message: object): void { parent.postMessage({ jsonrpc: '2.0', ...message }, parentOrigin); }
function request(method: string, params: object = {}, allowStopped = false): Promise<any> {
    if (stopped && !allowStopped) return Promise.reject(new Error('Math Workspace panel is closed.'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Math Workspace host did not respond.')); }, 25000);
        pending.set(id, { resolve, reject, timer }); send({ id, method, params });
    });
}
async function call(name: string, arguments_: object, allowStopped = false): Promise<any> {
    const result = await request('tools/call', { name, arguments: arguments_ }, allowStopped);
    if (result.isError) throw new Error(result.content?.find((item: any) => item.type === 'text')?.text || 'Reader is unavailable.');
    return result.structuredContent;
}
if (embedded) addEventListener('message', event => {
    const message = event.data;
    if (event.source !== parent || message?.jsonrpc !== '2.0' || (parentOrigin !== '*' && event.origin !== parentOrigin)) return;
    if (message.method === 'ui/resource-teardown') {
        if (!closing) {
            stopped = true;
            pending.forEach(work => { clearTimeout(work.timer); work.reject(new Error('Math Workspace panel is closed.')); });
            pending.clear();
            closing = call('close_reader_view', { viewKey }, true).catch(() => {});
        }
        void closing.finally(() => {
            if (message.id !== undefined) send({ id: message.id, result: {} });
        });
    } else if (message.method === 'ui/notifications/tool-result') {
        initial = message.params?._meta?.reader || message.params?.structuredContent?.reader || {};
        receiveSeed?.();
    } else if (message.id !== undefined && pending.has(message.id)) {
        const work = pending.get(message.id)!; pending.delete(message.id); clearTimeout(work.timer);
        if (parentOrigin === '*') parentOrigin = event.origin;
        message.error ? work.reject(new Error(message.error.message)) : work.resolve(message.result);
    }
});

export async function initializeReaderHost(): Promise<void> {
    if (!embedded) return;
    const initialized = await request('ui/initialize', { appInfo: { name: 'math-workspace', version: '0.5.7' }, appCapabilities: {}, protocolVersion: '2026-01-26' });
    referenceDraftAvailable = Boolean(initialized.hostCapabilities?.message
        && initialized.hostCapabilities?.experimental?.['openai/message']?.draft);
    send({ method: 'ui/notifications/initialized' });
    if (!initial && host?.openai?.toolOutput) initial = host?.openai.toolOutput.reader || {};
    if (!initial) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { receiveSeed = undefined; reject(new Error('Math Workspace launch context did not arrive.')); }, 25000);
        receiveSeed = () => { clearTimeout(timer); receiveSeed = undefined; resolve(); };
    });
    const resume = initial.projectRoot && saved.projectRoot === initial.projectRoot ? saved : {};
    const state = { ...resume, ...initial };
    restoredPage = !initial.pagePath && Boolean(resume.pagePath);
    if (initial.pagePath) state.scrollTop = undefined;
    saved = { projectRoot: state.projectRoot, pagePath: state.pagePath, scrollTop: state.scrollTop };
    await call('reader_view', { viewKey, launcher: initial?.launcher === true, ...(state.projectRoot ? { projectRoot: state.projectRoot } : {}) });
    const query = new URLSearchParams();
    if (state.pagePath) query.set('path', state.pagePath);
    if (state.scrollTop) query.set('readerScroll', String(state.scrollTop));
    search = query.size ? '?' + query : '';
    document.documentElement.classList.add('reader-embedded');
}

// Plugin resources may have opaque origins. Keep their navigation in view state.
export function readerSearch(): string { return embedded ? search : location.search; }
export function readerHistory(mode: 'push' | 'replace', state: object, url: string): void {
    if (embedded) { search = url.startsWith('?') ? url.split('#')[0] : ''; return; }
    if (mode === 'push') history.pushState(state, '', url);
    else history.replaceState(state, '', url);
}

function readerResponse(result: any): Response {
    const bytes = Uint8Array.from(atob(result.body), character => character.charCodeAt(0));
    return new Response(bytes, { status: result.status, headers: result.headers });
}

function isMissingView(error: unknown): boolean {
    return error instanceof Error && error.message === 'Reader view not found.';
}

async function recoverReaderView(generation: number): Promise<void> {
    if (stopped) throw new Error('Math Workspace panel is closed.');
    if (generation !== viewGeneration) return;
    if (!recovering) recovering = (async () => {
        await call('reader_view', { viewKey, launcher: true, ...(saved.projectRoot ? { projectRoot: saved.projectRoot } : {}) });
        // The restarted Reader has a new request token even when its revision is unchanged.
        const response = readerResponse(await call('reader_request', { viewKey, route: '/api/state' }));
        if (!response.ok) throw new Error(await response.text());
        const state = await response.json();
        if (stopped) throw new Error('Math Workspace panel is closed.');
        requestToken = state.requestToken;
        viewGeneration++;
        reconnectListeners.forEach(listener => listener(JSON.stringify(state)));
    })().finally(() => { recovering = undefined; });
    await recovering;
}

export async function readerHostFetch(route: string, options: RequestInit = {}): Promise<Response> {
    if (recovering) await recovering;
    const generation = viewGeneration;
    const headers = Object.fromEntries(new Headers(options.headers).entries());
    const method = (options.method || 'GET').toUpperCase();
    const read = () => {
        const currentHeaders = requestToken && headers['x-math-workspace-token']
            ? { ...headers, 'x-math-workspace-token': requestToken } : headers;
        return call('reader_request', { viewKey, route, method, headers: currentHeaders,
            ...(typeof options.body === 'string' ? { body: options.body } : {}) });
    };
    let result;
    try { result = await read(); }
    catch (error) {
        if (!isMissingView(error)) throw error;
        await recoverReaderView(generation);
        // Preserve mutation outcomes: only a failed read is automatically replayed, once.
        if (method !== 'GET') throw error;
        result = await read();
    }
    return readerResponse(result);
}

export function persistReaderState(value: ReaderState): void {
    // Scroll can be saved before the asynchronous project context lookup finishes.
    saved = { ...saved, ...value, projectRoot: value.projectRoot ?? saved.projectRoot };
    host?.openai?.setWidgetState?.(saved);
}

export function expandReader(): void {
    void Promise.resolve(host?.openai?.requestDisplayMode
        ? host?.openai.requestDisplayMode({ mode: 'fullscreen' })
        : request('ui/request-display-mode', { mode: 'fullscreen' })).catch(() => {});
}

export async function referenceReaderInConversation(content: ReaderReferenceContent[]): Promise<void> {
    if (!canReferenceReaderInConversation()) throw new Error('This panel cannot add references to the conversation input.');
    if (!content.length) throw new Error('Select source material before adding a reference.');
    await request('ui/message', { role: 'user', content, _meta: { 'openai/message': { target: 'active', send: false } } });
}

export interface ReaderEvents {
    addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
    close(): void;
}
export function readerHostEvents(): ReaderEvents {
    let closed = false, cursor = 0;
    const listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
    const reconnect = (state: string) => {
        cursor = 0;
        if (!closed && !stopped) listeners.get('reader-reconnect')?.forEach(listener => listener(new MessageEvent('reader-reconnect', { data: state })));
    };
    reconnectListeners.add(reconnect);
    const poll = async () => {
        while (!closed && !stopped) {
            const generation = viewGeneration;
            try {
                const result = await call('reader_updates', { viewKey, cursor, waitMs: 15000 });
                if (closed || stopped) return;
                if (generation !== viewGeneration) continue;
                cursor = result.cursor;
                for (const event of result.events) listeners.get(event.type)?.forEach(listener => listener(new MessageEvent(event.type, { data: event.data })));
            } catch (error) {
                if (closed || stopped) return;
                if (isMissingView(error)) {
                    try { await recoverReaderView(generation); continue; }
                    catch (recoveryError) { error = recoveryError; }
                }
                if (closed || stopped) return;
                console.warn('[math-workspace] Reader updates will reconnect', error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    };
    void poll();
    return { addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
    }, close() { closed = true; listeners.clear(); reconnectListeners.delete(reconnect); } };
}
