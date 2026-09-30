type ReaderState = { projectRoot?: string; pagePath?: string; scrollTop?: number };
type HostWindow = Window & { openai?: {
    widgetState?: ReaderState; toolOutput?: { reader?: ReaderState & { launcher?: boolean } };
    setWidgetState?: (state: ReaderState) => void; requestDisplayMode?: (request: { mode: string }) => Promise<unknown>;
} };
const host = typeof window === 'undefined' ? undefined : window as HostWindow;
const embedded = typeof document !== 'undefined' && document.documentElement.hasAttribute('data-math-workspace-app');
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let sequence = 0, parentOrigin = '*', stopped = false;
let search = '';
let saved: ReaderState = host?.openai?.widgetState || {};
let initial: ReaderState & { launcher?: boolean } | undefined;
let receiveSeed: (() => void) | undefined;
const viewKey = embedded ? crypto.randomUUID().replaceAll('-', '') : '';

export function isReaderApp(): boolean { return embedded; }
function send(message: object): void { parent.postMessage({ jsonrpc: '2.0', ...message }, parentOrigin); }
function request(method: string, params: object = {}): Promise<any> {
    if (stopped) return Promise.reject(new Error('Math Workspace panel is closed.'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Math Workspace host did not respond.')); }, 25000);
        pending.set(id, { resolve, reject, timer }); send({ id, method, params });
    });
}
async function call(name: string, arguments_: object): Promise<any> {
    const result = await request('tools/call', { name, arguments: arguments_ });
    if (result.isError) throw new Error(result.content?.find((item: any) => item.type === 'text')?.text || 'Reader is unavailable.');
    return result.structuredContent;
}
if (embedded) addEventListener('message', event => {
    const message = event.data;
    if (event.source !== parent || message?.jsonrpc !== '2.0' || (parentOrigin !== '*' && event.origin !== parentOrigin)) return;
    if (message.method === 'ui/resource-teardown') {
        void call('close_reader_view', { viewKey }).catch(() => {}).finally(() => {
            if (message.id !== undefined) send({ id: message.id, result: {} });
            stopped = true; pending.forEach(work => { clearTimeout(work.timer); work.reject(new Error('Math Workspace panel is closed.')); }); pending.clear();
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
    await request('ui/initialize', { appInfo: { name: 'math-workspace', version: '0.4.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' });
    send({ method: 'ui/notifications/initialized' });
    if (!initial && host?.openai?.toolOutput) initial = host?.openai.toolOutput.reader || {};
    if (!initial) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { receiveSeed = undefined; reject(new Error('Math Workspace launch context did not arrive.')); }, 25000);
        receiveSeed = () => { clearTimeout(timer); receiveSeed = undefined; resolve(); };
    });
    const state = { ...initial, ...saved };
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

export async function readerHostFetch(route: string, options: RequestInit = {}): Promise<Response> {
    const headers = Object.fromEntries(new Headers(options.headers).entries());
    const result = await call('reader_request', { viewKey, route, method: options.method || 'GET', headers,
        ...(typeof options.body === 'string' ? { body: options.body } : {}) });
    const bytes = Uint8Array.from(atob(result.body), character => character.charCodeAt(0));
    return new Response(bytes, { status: result.status, headers: result.headers });
}

export function persistReaderState(value: ReaderState): void {
    const changed = value.projectRoot !== undefined && (value.projectRoot !== saved.projectRoot || value.pagePath !== saved.pagePath);
    saved = { ...saved, ...value };
    host?.openai?.setWidgetState?.(saved);
    if (changed) void request('ui/update-model-context', { content: [{ type: 'text', text:
        'Math Workspace Reader project: ' + saved.projectRoot + '; page: ' + (saved.pagePath || '(project chooser)') + '.' }] }).catch(() => {});
}

export function expandReader(): void {
    void Promise.resolve(host?.openai?.requestDisplayMode
        ? host?.openai.requestDisplayMode({ mode: 'fullscreen' })
        : request('ui/request-display-mode', { mode: 'fullscreen' })).catch(() => {});
}

export interface ReaderEvents {
    addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
    close(): void;
}
export function readerHostEvents(): ReaderEvents {
    let closed = false, cursor = 0;
    const listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
    const poll = async () => {
        while (!closed && !stopped) {
            try {
                const result = await call('reader_updates', { viewKey, cursor, waitMs: 15000 });
                if (closed || stopped) return;
                cursor = result.cursor;
                for (const event of result.events) listeners.get(event.type)?.forEach(listener => listener(new MessageEvent(event.type, { data: event.data })));
            } catch (error) {
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
    }, close() { closed = true; listeners.clear(); } };
}
