import type { ReaderSearchHit, ReaderSearchResult } from '../search';
import { readerIconAction, describeReaderIconAction } from './reader-icons';

interface Context { projectId?: string; requestToken?: string; revision?: number; language: 'zh' | 'en' }
interface Host {
    context(): Context;
    request(route: string, init?: RequestInit): Promise<Response>;
    beforeOpen(): void;
    openResult(hit: ReaderSearchHit): Promise<void>;
    renderFormula(latex: string): string;
    report(message: string): void;
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '') => { const value = document.createElement(tag); value.className = className; return value; };

/** Owns project search, including debounce, source identity, result navigation and dialog lifetime. */
export class ReaderSearch {
    private dialog?: HTMLDialogElement;
    private input?: HTMLInputElement;
    private scope?: HTMLSelectElement;
    private results?: HTMLElement;
    private status?: HTMLElement;
    private snapshot?: Context;
    private payload?: ReaderSearchResult;
    private query = '';
    private mode: 'all' | 'formula' = 'all';
    private message: 'empty' | 'loading' | 'failed' | 'outdated' | 'stale' | 'ready' = 'empty';
    private generation = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private abort?: AbortController;
    private readonly launch = () => this.open();
    private readonly shortcut = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
            event.preventDefault(); this.open();
        }
    };
    constructor(private trigger: HTMLButtonElement, private host: Host) {
        trigger.addEventListener('click', this.launch); document.addEventListener('keydown', this.shortcut); this.contextChanged();
    }
    private t(zh: string, en: string): string { return this.host.context().language === 'zh' ? zh : en; }
    private identity(context = this.host.context()): string { return JSON.stringify([context.projectId, context.requestToken, context.revision]); }
    contextChanged(): void {
        describeReaderIconAction(this.trigger, this.t('全文搜索', 'Search manuscript'));
        this.trigger.disabled = !this.host.context().projectId;
        this.trigger.setAttribute('aria-haspopup', 'dialog'); this.trigger.setAttribute('aria-expanded', String(!!this.dialog));
        this.trigger.setAttribute('aria-controls', 'reader-search-dialog');
        if (!this.dialog) return;
        const context = this.host.context();
        if (context.projectId !== this.snapshot?.projectId || context.requestToken !== this.snapshot?.requestToken) { this.query = ''; this.close(false); return; }
        if (this.identity() !== this.identity(this.snapshot)) { this.snapshot = { ...context }; this.schedule(); }
        this.translate();
    }
    open(): void {
        if (!this.host.context().projectId) return;
        if (this.dialog) { this.input?.focus(); return; }
        this.host.beforeOpen(); this.snapshot = { ...this.host.context() };
        const dialog = node('dialog', 'reader-search-dialog'); dialog.id = 'reader-search-dialog'; this.dialog = dialog;
        dialog.setAttribute('aria-labelledby', 'reader-search-heading');
        const header = node('header'), heading = node('h2'); heading.id = 'reader-search-heading';
        const close = readerIconAction('x', ''); close.dataset.searchClose = 'true'; close.addEventListener('click', () => this.close());
        header.append(heading, close);
        const controls = node('div', 'reader-search-controls'), input = node('input'); this.input = input;
        input.type = 'search'; input.maxLength = 240; input.autocomplete = 'off'; input.value = this.query; input.id = 'reader-search-query';
        const scope = node('select'); this.scope = scope; scope.id = 'reader-search-scope';
        for (const mode of ['all', 'formula']) { const option = node('option'); option.value = mode; scope.append(option); } scope.value = this.mode;
        controls.append(input, scope);
        const hint = node('p', 'reader-search-hint'); hint.dataset.searchHint = 'true';
        const status = node('p', 'reader-search-status'); this.status = status; status.setAttribute('role', 'status');
        const results = node('div', 'reader-search-results'); this.results = results;
        input.addEventListener('input', () => { this.query = input.value; this.schedule(); });
        scope.addEventListener('change', () => { this.mode = scope.value === 'formula' ? 'formula' : 'all'; this.schedule(); });
        input.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector<HTMLButtonElement>('button')?.focus(); }
            if (event.key === 'Enter' && this.payload?.hits[0]) { event.preventDefault(); this.choose(this.payload.hits[0]); }
        });
        results.addEventListener('keydown', event => {
            const buttons = Array.from(results.querySelectorAll<HTMLButtonElement>('button')), index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
            if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
        });
        dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
        dialog.append(header, controls, hint, status, results); document.body.append(dialog); dialog.showModal();
        this.translate(); this.schedule(); this.contextChanged(); input.focus();
    }
    close(restoreFocus = true): void {
        this.cancel(); const dialog = this.dialog; this.dialog = undefined; this.payload = undefined;
        dialog?.close(); dialog?.remove(); this.contextChanged();
        if (restoreFocus && dialog && this.trigger.isConnected) this.trigger.focus({ preventScroll: true });
    }
    dispose(): void { this.close(false); this.trigger.removeEventListener('click', this.launch); document.removeEventListener('keydown', this.shortcut); }
    private cancel(): void { this.generation++; this.abort?.abort(); this.abort = undefined; if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
    private schedule(): void {
        this.cancel(); this.payload = undefined; this.message = this.query.trim() ? 'loading' : 'empty'; this.renderResults();
        if (this.query.trim()) this.timer = setTimeout(() => { this.timer = undefined; void this.search(); }, 180);
    }
    private async search(): Promise<void> {
        if (!this.dialog || !this.snapshot) return;
        const generation = this.generation, context = { ...this.snapshot }, query = this.query.trim(), mode = this.mode;
        const abort = this.abort = new AbortController();
        const current = () => !!this.dialog && generation === this.generation && !abort.signal.aborted && this.identity() === this.identity(context);
        try {
            const response = await this.host.request('/api/search?' + new URLSearchParams({ q: query, mode }), { signal: abort.signal, cache: 'no-store', headers: { 'x-math-workspace-token': context.requestToken || '', 'x-math-workspace-project': context.projectId || '' } });
            if (!current()) return;
            if (!response.ok) this.message = response.status === 404 ? 'outdated' : 'failed';
            else {
                const result = await response.json() as ReaderSearchResult & { revision: number };
                if (!current()) return;
                this.message = result.revision === context.revision && result.query === query ? 'ready' : 'stale';
                if (this.message === 'ready') this.payload = result;
            }
        } catch { if (current()) this.message = 'failed'; }
        if (current()) this.renderResults();
    }
    private choose(hit: ReaderSearchHit): void {
        if (this.message !== 'ready' || this.identity() !== this.identity(this.snapshot)) return;
        this.close(false); void this.host.openResult(hit).catch(error => this.host.report(error instanceof Error ? error.message : String(error)));
    }
    private translate(): void {
        if (!this.dialog) return;
        this.dialog.querySelector('h2')!.textContent = this.t('全文搜索', 'Search manuscript');
        describeReaderIconAction(this.dialog.querySelector<HTMLButtonElement>('[data-search-close]')!, this.t('关闭', 'Close'));
        this.input!.placeholder = this.t('输入关键词或公式…', 'Enter words or a formula…'); this.input!.setAttribute('aria-label', this.t('搜索文字或公式', 'Search text or formulas'));
        this.scope!.setAttribute('aria-label', this.t('搜索范围', 'Search scope'));
        const options = this.scope!.querySelectorAll('option'); options[0].textContent = this.t('全文与公式', 'Text and formulas'); options[1].textContent = this.t('仅公式', 'Formulas only');
        this.dialog.querySelector<HTMLElement>('[data-search-hint]')!.textContent = this.t('支持 α / \\alpha、≤ / \\le、x² / x^2 等写法，也可输入公式片段。相似匹配用于查找，不代表数学等价。', 'Try α / \\alpha, ≤ / \\le, x² / x^2, or part of a formula. Similar matches help retrieval; they do not establish mathematical equivalence.');
        this.renderResults();
    }
    private renderResults(): void {
        if (!this.results || !this.status || !this.dialog) return;
        const messages = {
            empty: this.t('输入关键词，在整个项目中查找。', 'Search across the project.'), loading: this.t('搜索中…', 'Searching…'), failed: this.t('搜索失败，请重试。', 'Search failed. Try again.'),
            outdated: this.t('请重启 Reader 服务以启用全文搜索。', 'Restart the Reader service to enable search.'), stale: this.t('内容已更新，请重新搜索。', 'The manuscript changed. Search again.'), ready: this.t('没有找到匹配内容。', 'No matches found.')
        };
        const hits = this.payload?.hits || [];
        this.status.textContent = this.message === 'ready' && hits.length ? this.t(`${this.payload?.truncated ? '显示前 ' : ''}${hits.length} 处匹配`, `${this.payload?.truncated ? 'Showing the first ' : ''}${hits.length} matches`) : messages[this.message];
        this.results.replaceChildren();
        for (const hit of hits) {
            const button = node('button', 'reader-search-hit'); button.type = 'button';
            const heading = node('span', 'reader-search-hit-heading'); heading.textContent = hit.title;
            const location = node('span', 'reader-search-hit-location'); location.textContent = `${hit.filePath} · ${hit.startLine}${hit.endLine > hit.startLine ? '–' + hit.endLine : ''}`;
            const kind = node('span', 'reader-search-hit-kind'); kind.textContent = hit.kind === 'formula' ? hit.match === 'exact' ? this.t('公式', 'Formula') : this.t('相似公式', 'Similar formula') : hit.match === 'fuzzy' ? this.t('相似文字', 'Similar text') : this.t('文字', 'Text');
            const excerpt = node('span', 'reader-search-hit-excerpt');
            if (hit.latex) excerpt.innerHTML = this.host.renderFormula(hit.latex); else excerpt.textContent = hit.excerpt;
            button.append(heading, kind, location, excerpt); button.addEventListener('click', () => this.choose(hit)); this.results.append(button);
        }
    }
}
