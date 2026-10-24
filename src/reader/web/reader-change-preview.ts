import type { ReaderGitPrevious } from '../git-change-types';
import type { ReaderLabel, ReaderPage } from './formal-renderer';
import { readerIconAction, describeReaderIconAction } from './reader-icons';

type Preview = ReaderGitPrevious<ReaderLabel, ReaderPage>;
export interface ReaderChangePreviewHost {
    context(): { filePath: string; sourceHash?: string; commit?: string; project: string; token: string; language: 'zh' | 'en' } | undefined;
    request(route: string, init?: RequestInit): Promise<Response>;
    render(source: string, previous?: Preview): string;
    beforeOpen(): void;
}

/** A read-only old-manuscript window with its own request, context and drag lifecycle. */
export class ReaderChangePreview {
    private panel?: HTMLElement;
    private body?: HTMLElement;
    private target?: HTMLElement;
    private trigger?: HTMLElement;
    private payload?: Preview;
    private identity = '';
    private status: 'loading' | 'failed' | 'new-file' | 'ready' = 'loading';
    private generation = 0;
    private abort?: AbortController;
    private blocks: HTMLElement[] = [];
    private start = 0;
    private end = 0;
    private insertion = false;
    private moved = false;
    private drag?: { id: number; x: number; y: number; left: number; top: number; handle: HTMLElement };
    private readonly onResize = () => this.place();
    private readonly onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && !event.defaultPrevented && this.panel) { event.preventDefault(); this.close(); }
    };
    constructor(private host: ReaderChangePreviewHost) {}
    private t(zh: string, en: string): string { return this.host.context()?.language === 'zh' ? zh : en; }
    private contextIdentity(): string { const c = this.host.context(); return JSON.stringify([c?.project, c?.token, c?.filePath, c?.sourceHash, c?.commit]); }
    isOpen(): boolean { return !!this.panel; }
    update(): void {
        if (this.panel && (this.identity !== this.contextIdentity() || !this.target?.isConnected)) this.close(false);
        if (this.panel) this.translate();
    }
    async open(target: HTMLElement, trigger: HTMLElement, toggle = false): Promise<void> {
        if (!this.host.context()) return;
        this.update();
        if (this.panel && this.target === target && toggle) { this.close(); return; }
        if (this.trigger?.hasAttribute('aria-haspopup')) this.trigger.setAttribute('aria-expanded', 'false');
        this.target = target; this.trigger = trigger;
        if (trigger.hasAttribute('aria-haspopup')) trigger.setAttribute('aria-expanded', 'true');
        if (this.panel) { if (this.payload) this.render(); this.place(); return; }
        this.host.beforeOpen(); this.identity = this.contextIdentity(); this.moved = false;
        const panel = this.panel = document.createElement('section'); panel.className = 'reader-change-preview'; panel.id = 'reader-change-preview';
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false'); panel.setAttribute('aria-labelledby', 'reader-change-preview-heading');
        const header = document.createElement('header'), handle = document.createElement('div'), heading = document.createElement('h2');
        handle.className = 'reader-change-preview-grip'; handle.dataset.previewDrag = 'true'; handle.tabIndex = 0; handle.setAttribute('role', 'button');
        heading.id = 'reader-change-preview-heading'; handle.append(heading);
        const close = readerIconAction('x', ''); close.dataset.previewClose = 'true'; close.addEventListener('click', () => this.close()); header.append(handle, close);
        const description = document.createElement('p'); description.dataset.previewDescription = 'true';
        const before = document.createElement('button'); before.type = 'button'; before.dataset.previewExpand = 'before'; before.addEventListener('click', () => this.expand('before'));
        const body = this.body = document.createElement('div'); body.className = 'reader-change-preview-body'; body.tabIndex = 0;
        const footer = document.createElement('footer');
        for (const direction of ['after', 'all'] as const) {
            const button = document.createElement('button'); button.type = 'button'; button.dataset.previewExpand = direction;
            button.addEventListener('click', () => this.expand(direction)); footer.append(button);
        }
        const status = document.createElement('span'); status.dataset.previewContext = 'true'; status.setAttribute('aria-live', 'polite'); footer.append(status);
        panel.append(header, description, before, body, footer); document.body.append(panel);
        this.installDrag(handle); document.addEventListener('keydown', this.onKeyDown); window.addEventListener('resize', this.onResize);
        handle.focus({ preventScroll: true }); await this.read();
    }
    close(restoreFocus = true): void {
        ++this.generation; this.abort?.abort(); this.abort = undefined; this.endDrag();
        this.panel?.remove(); this.panel = undefined; this.body = undefined; this.payload = undefined; this.blocks = [];
        document.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('resize', this.onResize);
        const trigger = this.trigger, target = this.target; this.trigger = undefined; this.target = undefined;
        if (trigger?.hasAttribute('aria-haspopup')) trigger.setAttribute('aria-expanded', 'false');
        const focus = trigger?.isConnected ? trigger : target;
        if (restoreFocus && focus?.isConnected) {
            if (focus === target && !focus.hasAttribute('tabindex')) {
                focus.setAttribute('tabindex', '-1'); focus.addEventListener('blur', () => focus.removeAttribute('tabindex'), { once: true });
            }
            focus.focus({ preventScroll: true });
        }
    }
    private async read(): Promise<void> {
        const context = this.host.context(), panel = this.panel; if (!context || !panel) return;
        this.abort?.abort(); const abort = this.abort = new AbortController(), generation = ++this.generation, identity = this.identity;
        this.status = 'loading'; this.payload = undefined; this.render(); this.place();
        const current = () => this.panel === panel && generation === this.generation && identity === this.contextIdentity() && !abort.signal.aborted;
        try {
            const response = await this.host.request('/api/page-before?path=' + encodeURIComponent(context.filePath), { signal: abort.signal, cache: 'no-store', headers: { 'x-math-workspace-token': context.token, 'x-math-workspace-project': context.project } });
            const payload = response.ok ? await response.json() as Preview : undefined;
            if (!current()) return;
            if (payload?.filePath === context.filePath && payload.sourceHash === context.sourceHash && (!context.commit || payload.commit === context.commit) && payload.status === 'ready') {
                this.payload = payload; this.status = payload.baseline === 'new-file' ? 'new-file' : typeof payload.content === 'string' ? 'ready' : 'failed';
            } else this.status = 'failed';
        } catch { if (current()) this.status = 'failed'; }
        if (current()) { this.render(); this.place(); }
    }
    private translate(): void {
        if (!this.panel) return;
        this.panel.querySelector('h2')!.textContent = this.t('此处的旧稿', 'Previous content here');
        this.panel.querySelector('[data-preview-drag]')!.setAttribute('aria-label', this.t('移动旧稿窗口：拖动或用方向键，Home 回到原处', 'Move previous-content window: drag or use arrow keys; Home resets position'));
        describeReaderIconAction(this.panel.querySelector<HTMLButtonElement>('[data-preview-close]')!, this.t('关闭旧稿窗口', 'Close previous content'));
        this.panel.querySelector<HTMLElement>('[data-preview-description]')!.textContent = this.t('上次提交', 'Last commit') + (this.payload?.commit ? ' · ' + this.payload.commit.slice(0, 8) : '')
            + (this.status === 'ready' ? this.insertion ? this.t(' · 此处为新增内容，显示相邻旧稿', ' · Added here; showing adjacent old context') : this.t(' · 对照正文，可拖动标题移开窗口', ' · Compare with the page; drag the title to move') : '');
        this.panel.querySelectorAll<HTMLButtonElement>('[data-preview-expand]').forEach(button => {
            const direction = button.dataset.previewExpand;
            button.textContent = direction === 'before' ? this.t('↑ 向前展开旧稿', '↑ Earlier context') : direction === 'after' ? this.t('↓ 向后展开旧稿', '↓ Later context') : this.t('显示完整旧稿', 'Show full previous manuscript');
            button.disabled = this.status !== 'ready' || (direction === 'before' ? this.start === 0 : direction === 'after' ? this.end === this.blocks.length : this.start === 0 && this.end === this.blocks.length);
        });
        this.panel.querySelector<HTMLElement>('[data-preview-context]')!.textContent = this.status === 'ready' ? this.start === 0 && this.end === this.blocks.length ? this.t('完整旧稿', 'Full previous manuscript') : this.t('可继续展开上下文', 'More context available') : '';
        const retry = this.panel.querySelector<HTMLButtonElement>('[data-preview-retry]'); if (retry) retry.textContent = this.t('重试', 'Retry');
        if (this.status !== 'ready' && this.body) {
            const message = this.body.querySelector('[data-preview-message]'); if (message) message.textContent = this.status === 'loading' ? this.t('正在读取旧稿…', 'Loading previous content…') : this.status === 'new-file' ? this.t('这是新增文件，上次提交中还没有这篇稿件。', 'This file is new and has no version in the last commit.') : this.t('暂时无法读取旧稿。', 'Previous content is unavailable.');
        }
    }
    private render(): void {
        if (!this.panel || !this.body || !this.target) return;
        this.body.replaceChildren(); this.blocks = [];
        if (this.status !== 'ready') {
            const message = document.createElement('p'); message.dataset.previewMessage = 'true'; this.body.append(message);
            if (this.status === 'failed') {
                const retry = document.createElement('button'); retry.type = 'button'; retry.dataset.previewRetry = 'true'; retry.addEventListener('click', () => void this.read()); this.body.append(retry);
            }
            this.translate(); return;
        }
        const article = document.createElement('div'); article.className = 'reader-article';
        article.innerHTML = this.host.render(this.payload!.content!, this.payload);
        article.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
        article.querySelectorAll('button, iframe, script').forEach(element => element.remove());
        article.querySelectorAll('a').forEach(link => link.replaceWith(...Array.from(link.childNodes)));
        this.body.append(article); this.blocks = Array.from(article.children) as HTMLElement[];
        const start = Number(this.target.dataset.sourceStartLine || 1), end = Number(this.target.dataset.sourceEndLine || start);
        const hunks = this.payload?.hunks || [];
        const matching = hunks.filter(hunk => hunk.count ? hunk.startLine <= end && hunk.startLine + hunk.count - 1 >= start : hunk.startLine + 1 >= start && hunk.startLine + 1 <= end);
        if (!matching.length && hunks.length) matching.push([...hunks].sort((a, b) => Math.abs(a.startLine - start) - Math.abs(b.startLine - start))[0]);
        const from = Math.max(1, matching.length ? Math.min(...matching.map(hunk => hunk.beforeStartLine)) : start);
        const to = Math.max(from, ...matching.map(hunk => hunk.beforeStartLine + Math.max(1, hunk.beforeCount) - 1));
        this.insertion = !!matching.length && matching.every(hunk => hunk.beforeCount === 0);
        const sourceBlocks = Array.from(article.querySelectorAll<HTMLElement>('[data-source-start-line]'));
        let focused = sourceBlocks.filter(element => Number(element.dataset.sourceStartLine) <= to && Number(element.dataset.sourceEndLine || element.dataset.sourceStartLine) >= from);
        focused = focused.filter(element => !focused.some(child => child !== element && element.contains(child)));
        if (!focused.length && sourceBlocks.length) focused = [[...sourceBlocks].sort((a, b) => Math.abs(Number(a.dataset.sourceStartLine) - from) - Math.abs(Number(b.dataset.sourceStartLine) - from))[0]];
        focused.forEach(element => { element.classList.add(this.insertion ? 'is-preview-location' : 'is-preview-change'); for (let parent = element.parentElement; parent && parent !== article; parent = parent.parentElement) if (parent.tagName.toLowerCase() === 'details') (parent as HTMLDetailsElement).open = true; });
        const indices = this.blocks.map((block, index) => focused.some(element => block.contains(element)) ? index : -1).filter(index => index >= 0);
        this.start = Math.max(0, (indices.length ? Math.min(...indices) : 0) - 1);
        this.end = Math.min(this.blocks.length, (indices.length ? Math.max(...indices) : 0) + 2);
        this.showContext(); this.translate();
        this.body.scrollTop = 0;
        if (focused[0]) this.body.scrollTop = Math.max(0, focused[0].getBoundingClientRect().top - this.body.getBoundingClientRect().top - 48);
    }
    private showContext(): void { this.blocks.forEach((block, index) => { block.hidden = index < this.start || index >= this.end; }); }
    private expand(direction: 'before' | 'after' | 'all'): void {
        if (!this.body || this.status !== 'ready') return;
        const reference = this.blocks[this.start], before = reference?.getBoundingClientRect().top || 0;
        const scroll = this.body.scrollTop;
        if (direction !== 'after') this.start = direction === 'all' ? 0 : Math.max(0, this.start - 2);
        if (direction !== 'before') this.end = direction === 'all' ? this.blocks.length : Math.min(this.blocks.length, this.end + 2);
        this.showContext(); this.translate();
        this.body.scrollTop = scroll + ((reference?.getBoundingClientRect().top || 0) - before); this.clamp();
    }
    private place(): void {
        if (!this.panel || !this.target) return;
        if (this.moved) { this.clamp(); return; }
        const target = this.target.getBoundingClientRect(), rect = this.panel.getBoundingClientRect();
        const right = target.right + 12, left = target.left - rect.width - 12;
        this.panel.style.left = Math.max(12, Math.min(right + rect.width <= window.innerWidth - 12 ? right : left >= 12 ? left : target.left, window.innerWidth - rect.width - 12)) + 'px';
        this.panel.style.top = Math.max(12, Math.min(target.bottom + 10 + rect.height <= window.innerHeight - 12 ? target.bottom + 10 : target.top - rect.height - 10, window.innerHeight - rect.height - 12)) + 'px';
    }
    private clamp(left?: number, top?: number): void {
        if (!this.panel) return;
        const rect = this.panel.getBoundingClientRect();
        this.panel.style.left = Math.max(12, Math.min(left ?? rect.left, window.innerWidth - rect.width - 12)) + 'px';
        this.panel.style.top = Math.max(12, Math.min(top ?? rect.top, window.innerHeight - rect.height - 12)) + 'px';
    }
    private installDrag(handle: HTMLElement): void {
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.isPrimary === false || !this.panel) return;
            event.preventDefault(); handle.focus({ preventScroll: true }); const rect = this.panel.getBoundingClientRect();
            this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, handle };
            handle.setPointerCapture?.(event.pointerId); handle.classList.add('is-dragging');
        });
        handle.addEventListener('pointermove', event => {
            if (!this.drag || event.pointerId !== this.drag.id) return;
            this.moved = true; this.clamp(this.drag.left + event.clientX - this.drag.x, this.drag.top + event.clientY - this.drag.y);
        });
        const end = (event: PointerEvent) => { if (this.drag?.id === event.pointerId) this.endDrag(); };
        handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
        handle.addEventListener('keydown', event => {
            if (!this.panel) return;
            if (event.key === 'Home') { event.preventDefault(); this.moved = false; this.place(); return; }
            const delta = event.shiftKey ? 50 : 20, moves: Record<string, number[]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }, move = moves[event.key];
            if (!move) return;
            event.preventDefault(); this.moved = true; const rect = this.panel.getBoundingClientRect(); this.clamp(rect.left + move[0], rect.top + move[1]);
        });
    }
    private endDrag(): void {
        const drag = this.drag; this.drag = undefined;
        if (drag) { drag.handle.classList.remove('is-dragging'); if (drag.handle.hasPointerCapture?.(drag.id)) drag.handle.releasePointerCapture(drag.id); }
    }
}
