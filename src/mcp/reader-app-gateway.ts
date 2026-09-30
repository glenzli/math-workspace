import * as path from 'node:path';
import { findMathWorkspaceRoot } from '../project-root';
import { startReaderServer, type FormalReaderServer } from '../reader/server';

const { fetch, AbortController, TextDecoder } = globalThis as any;

interface ReaderEvent { sequence: number; type: string; data: string }
interface ReaderView {
    reader: FormalReaderServer;
    abort: any;
    events: ReaderEvent[];
    sequence: number;
    listeners: Set<() => void>;
}

/** Keeps local Reader APIs on the server side of MCP, with one lifetime per app instance. */
export class ReaderAppGateway {
    private closed = false;
    private views = new Map<string, ReaderView>();
    private creating = new Map<string, Promise<ReaderView>>();

    constructor(private readonly defaultRoot?: string) {}

    async open(key: string, projectRoot?: string, launcher = false): Promise<{ ready: true }> {
        if (this.closed) throw new Error('Math Workspace panel is closed.');
        if (!/^[a-f0-9]{32}$/.test(key)) throw new Error('Invalid Reader view identity.');
        if (!this.views.has(key)) {
            let pending = this.creating.get(key);
            if (!pending) {
                if (this.views.size + this.creating.size >= 16) throw new Error('Close an unused Math Workspace panel before opening another.');
                pending = this.create(key, projectRoot, launcher);
                this.creating.set(key, pending);
            }
            try { await pending; }
            finally { this.creating.delete(key); }
        }
        return { ready: true };
    }

    private async create(key: string, projectRoot?: string, launcher = false): Promise<ReaderView> {
        const requested = projectRoot || (launcher ? undefined : this.defaultRoot);
        const rootPath = requested ? await findMathWorkspaceRoot(path.resolve(requested)) : undefined;
        if (projectRoot && !rootPath) throw new Error('Choose a prepared Math Workspace project.');
        const reader = await startReaderServer({ rootPath });
        if (this.closed) { await reader.close(); throw new Error('Math Workspace panel is closed.'); }
        const view: ReaderView = { reader, abort: new AbortController(), events: [], sequence: 0, listeners: new Set() };
        this.views.set(key, view);
        // The existing SSE stream supplies file changes and source navigation; no browser HTTP connection is needed.
        void this.watch(view);
        return view;
    }

    private async watch(view: ReaderView): Promise<void> {
        while (!view.abort.signal.aborted) {
            try {
                const response = await fetch(view.reader.url + '/api/events', { signal: view.abort.signal });
                if (!response.ok || !response.body) throw new Error('Reader updates are unavailable.');
                const stream = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                while (!view.abort.signal.aborted) {
                    const chunk = await stream.read();
                    if (chunk.done) break;
                    buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r/g, '');
                    let end: number;
                    while ((end = buffer.indexOf('\n\n')) >= 0) {
                        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
                        const type = block.match(/^event: (.+)$/m)?.[1];
                        const data = block.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
                        if (!type || !['workspace-update', 'reader-navigate'].includes(type)) continue;
                        view.events.push({ sequence: ++view.sequence, type, data });
                        if (view.events.length > 32) view.events.shift();
                        view.listeners.forEach(notify => notify());
                    }
                }
            } catch { if (view.abort.signal.aborted) return; }
            if (!view.abort.signal.aborted) await new Promise<void>(resolve => {
                const timer = setTimeout(done, 1000);
                function done() { clearTimeout(timer); view.abort.signal.removeEventListener('abort', done); resolve(); }
                view.abort.signal.addEventListener('abort', done, { once: true });
            });
        }
    }

    async request(key: string, route: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
        const view = this.views.get(key);
        if (!view) throw new Error('Reader view not found.');
        const rawPath = route.split('?')[0];
        if (!/^\/api\/[a-z0-9/-]+$/.test(rawPath) || rawPath === '/api/events' || /(?:^|\/)\.\.(?:\/|$)|%2e|%2f|%5c/i.test(rawPath)) {
            throw new Error('Invalid Reader API path.');
        }
        if (rawPath === '/api/plugin-context') {
            if (method !== 'GET') throw new Error('Reader context supports GET only.');
            return { status: 200, headers: { 'content-type': 'application/json' },
                body: Buffer.from(JSON.stringify({ projectRoot: view.reader.rootPath })).toString('base64') };
        }
        const allowedHeaders: Record<string, string> = {};
        for (const [name, value] of Object.entries(headers)) {
            if (['content-type', 'x-math-workspace-token', 'x-math-workspace-project'].includes(name.toLowerCase())) allowedHeaders[name.toLowerCase()] = value;
        }
        const response = await fetch(view.reader.url + route, { method, headers: allowedHeaders, body, signal: view.abort.signal });
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 16 * 1024 * 1024) throw new Error('Reader response is too large.');
        const responseHeaders: Record<string, string> = {};
        for (const name of ['content-type', 'content-security-policy']) {
            const value = response.headers.get(name); if (value) responseHeaders[name] = value;
        }
        return { status: response.status, headers: responseHeaders, body: bytes.toString('base64') };
    }

    async updates(key: string, cursor: number, waitMs: number) {
        const view = this.views.get(key);
        if (!view) throw new Error('Reader view not found.');
        if (view.sequence <= cursor && !view.abort.signal.aborted) await new Promise<void>(resolve => {
            const timer = setTimeout(done, waitMs);
            function done() { clearTimeout(timer); view.listeners.delete(done); resolve(); }
            view.listeners.add(done);
        });
        const missed = view.events.length && cursor < view.events[0].sequence - 1;
        const events = view.events.filter(event => event.sequence > cursor);
        if (missed) events.unshift({ sequence: view.sequence, type: 'workspace-update', data: '{"changedPaths":[]}' });
        return { cursor: view.sequence, events };
    }

    async closeView(key: string): Promise<void> {
        await this.creating.get(key)?.catch(() => undefined);
        const view = this.views.get(key);
        if (!view) return;
        this.views.delete(key);
        view.abort.abort(); view.listeners.forEach(notify => notify());
        await view.reader.close();
    }

    async close(): Promise<void> {
        this.closed = true;
        await Promise.allSettled([...this.creating.values()]);
        await Promise.allSettled([...this.views.keys()].map(key => this.closeView(key)));
    }
}
