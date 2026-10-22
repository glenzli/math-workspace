import type { ReaderGitPrevious } from '../git-change-types';
import { readerIconAction, describeReaderIconAction } from './reader-icons';
import type { ReaderLabel, ReaderPage } from './formal-renderer';
type Preview = ReaderGitPrevious<ReaderLabel, ReaderPage>;

interface Context { filePath: string; sourceHash?: string; project: string; token: string; language: 'zh' | 'en' }
interface Host {
    context(): Context | undefined;
    targets(): HTMLElement[];
    hasChanges(): boolean;
    request(route: string, init?: RequestInit): Promise<Response>;
    reveal(target: HTMLElement): void;
    render(source: string, previous?: Preview): string;
    currentContent(): string;
    beforeOpen(): void;
}

/** Owns floating change navigation and the explicit rendered previous-version preview. */
export class ReaderChangeNavigation {
    private bar: HTMLElement;
    private previous: HTMLButtonElement;
    private next: HTMLButtonElement;
    private preview: HTMLButtonElement;
    private count: HTMLElement;
    private active?: HTMLElement;
    private identity = '';
    private dialog?: HTMLDialogElement;
    private body?: HTMLElement;
    private payload?: Preview;
    private mode: 'before' | 'current' = 'before';
    private status: 'loading' | 'failed' | 'new-file' | 'ready' = 'loading';
    private generation = 0;
    private abort?: AbortController;
    constructor(container: HTMLElement, private host: Host) {
        this.bar = document.createElement('nav'); this.bar.className = 'reader-change-navigation';
        this.previous = readerIconAction('chevron-up', ''); this.previous.dataset.changePrevious = 'true';
        this.next = readerIconAction('chevron-down', ''); this.next.dataset.changeNext = 'true';
        this.preview = readerIconAction('history', ''); this.preview.dataset.changePreview = 'true';
        this.count = document.createElement('span'); this.count.className = 'reader-change-count'; this.count.setAttribute('aria-live', 'polite');
        this.bar.append(this.previous, this.count, this.next, this.preview); container.append(this.bar);
        this.previous.addEventListener('click', () => this.move(-1)); this.next.addEventListener('click', () => this.move(1));
        this.preview.addEventListener('click', () => void this.openPreview()); this.update();
    }
    private t(zh: string, en: string): string { return this.host.context()?.language === 'zh' ? zh : en; }
    private contextIdentity(): string { const context = this.host.context(); return JSON.stringify([context?.project, context?.token, context?.filePath, context?.sourceHash]); }
    update(): void {
        const identity = this.contextIdentity();
        if (identity !== this.identity) { this.identity = identity; this.active?.classList.remove('is-current-change'); this.active = undefined; this.closePreview(false); }
        this.bar.hidden = !this.host.context() || !this.host.hasChanges();
        this.bar.setAttribute('aria-label', this.t('修改导航', 'Change navigation'));
        describeReaderIconAction(this.previous, this.t('上一处修改', 'Previous change'));
        describeReaderIconAction(this.next, this.t('下一处修改', 'Next change'));
        describeReaderIconAction(this.preview, this.t('查看修改前的内容', 'Preview previous content'));
        const targets = this.host.targets(), index = this.active ? targets.indexOf(this.active) : -1;
        if (index >= 0) this.active!.classList.add('is-current-change');
        this.count.textContent = index >= 0 ? `${index + 1} / ${targets.length}` : this.t(`${targets.length} 处修改`, `${targets.length} changes`);
        this.previous.disabled = this.next.disabled = !targets.length;
        if (this.dialog) this.translatePreview();
    }
    private move(direction: -1 | 1): void {
        const targets = this.host.targets(); if (!targets.length) return;
        const index = this.active ? targets.indexOf(this.active) : -1;
        const next = index >= 0 ? (index + direction + targets.length) % targets.length : direction > 0 ? 0 : targets.length - 1;
        this.active?.classList.remove('is-current-change'); this.active = targets[next]; this.host.reveal(this.active);
        this.active.classList.add('is-current-change');
        this.active.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); this.update();
    }
    closePreview(restoreFocus = true): void {
        this.generation++; this.abort?.abort(); this.abort = undefined;
        const dialog = this.dialog; this.dialog = undefined; this.payload = undefined; this.body = undefined;
        dialog?.close(); dialog?.remove();
        if (restoreFocus && dialog && !this.bar.hidden) this.preview.focus({ preventScroll: true });
    }
    dispose(): void { this.closePreview(false); this.active?.classList.remove('is-current-change'); this.bar.remove(); }
    async openPreview(): Promise<void> {
        const context = this.host.context(); if (!context || this.bar.hidden) return;
        if (this.dialog) return;
        this.host.beforeOpen();
        const dialog = document.createElement('dialog'); this.dialog = dialog; dialog.className = 'reader-change-preview'; dialog.id = 'reader-change-preview';
        dialog.setAttribute('aria-labelledby', 'reader-change-preview-heading');
        const header = document.createElement('header'), heading = document.createElement('h2'); heading.id = 'reader-change-preview-heading';
        const close = readerIconAction('x', ''); close.dataset.previewClose = 'true'; close.addEventListener('click', () => this.closePreview()); header.append(heading, close);
        const tabs = document.createElement('div'); tabs.className = 'reader-change-preview-tabs';
        for (const mode of ['before', 'current'] as const) {
            const button = document.createElement('button'); button.type = 'button'; button.dataset.previewMode = mode;
            button.addEventListener('click', () => { this.mode = mode; this.renderPreview(); }); tabs.append(button);
        }
        const description = document.createElement('p'); description.dataset.previewDescription = 'true';
        const body = document.createElement('div'); body.className = 'reader-change-preview-body'; this.body = body;
        dialog.append(header, tabs, description, body); dialog.addEventListener('cancel', event => { event.preventDefault(); this.closePreview(); });
        document.body.append(dialog); dialog.showModal();
        this.mode = 'before'; this.status = 'loading'; this.renderPreview();
        const generation = ++this.generation, identity = this.contextIdentity(), abort = this.abort = new AbortController();
        const current = () => this.dialog === dialog && generation === this.generation && identity === this.contextIdentity() && !abort.signal.aborted;
        try {
            const response = await this.host.request('/api/page-before?path=' + encodeURIComponent(context.filePath), { signal: abort.signal, cache: 'no-store', headers: { 'x-math-workspace-token': context.token, 'x-math-workspace-project': context.project } });
            const payload = response.ok ? await response.json() as Preview : undefined;
            if (!current()) return;
            if (payload?.filePath === context.filePath && payload.sourceHash === context.sourceHash && payload.status === 'ready') {
                this.payload = payload; this.status = payload.baseline === 'new-file' ? 'new-file' : typeof payload.content === 'string' ? 'ready' : 'failed';
            } else this.status = 'failed';
        } catch { if (current()) this.status = 'failed'; }
        if (current()) this.renderPreview();
    }
    private translatePreview(): void {
        if (!this.dialog) return;
        this.dialog.querySelector('h2')!.textContent = this.t('修改前的内容', 'Previous content');
        describeReaderIconAction(this.dialog.querySelector<HTMLButtonElement>('[data-preview-close]')!, this.t('关闭', 'Close'));
        this.dialog.querySelectorAll<HTMLButtonElement>('[data-preview-mode]').forEach(button => {
            const before = button.dataset.previewMode === 'before'; button.textContent = before ? this.t('上次提交', 'Last commit') : this.t('当前稿件', 'Current manuscript');
            button.setAttribute('aria-pressed', String(button.dataset.previewMode === this.mode));
        });
        this.dialog.querySelector<HTMLElement>('[data-preview-description]')!.textContent = this.t('查看当前文件的上次提交版本，可切换到当前稿件对照。', 'Read this file as of its last commit, or switch to the current manuscript.')
            + (this.payload?.commit ? ' · ' + this.payload.commit.slice(0, 8) : '');
    }
    private renderPreview(): void {
        if (!this.dialog || !this.body) return;
        this.translatePreview(); this.body.replaceChildren();
        if (this.mode === 'before' && this.status !== 'ready') {
            this.body.textContent = this.status === 'loading' ? this.t('正在读取旧稿…', 'Loading previous content…') : this.status === 'new-file' ? this.t('这是新增文件，上次提交中还没有这篇稿件。', 'This file is new and has no version in the last commit.') : this.t('暂时无法读取旧稿，请刷新后重试。', 'Previous content is unavailable. Refresh and try again.'); return;
        }
        const article = document.createElement('div'); article.className = 'reader-article';
        article.innerHTML = this.host.render(this.mode === 'before' ? this.payload!.content! : this.host.currentContent(), this.mode === 'before' ? this.payload : undefined);
        article.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
        article.querySelectorAll('button, iframe, script').forEach(element => element.remove());
        article.querySelectorAll('a').forEach(link => link.replaceWith(...Array.from(link.childNodes)));
        this.body.append(article);
        const line = Number(this.active?.dataset.sourceStartLine || this.host.targets()[0]?.dataset.sourceStartLine || 1);
        const hunks = [...(this.payload?.hunks || [])].sort((a, b) => Math.abs(a.startLine - line) - Math.abs(b.startLine - line));
        const focus = this.mode === 'before' ? Math.max(1, hunks[0]?.beforeStartLine || line) : line;
        const blocks = Array.from(article.querySelectorAll<HTMLElement>('[data-source-start-line]'));
        const target = blocks.filter(element => Number(element.dataset.sourceStartLine) <= focus && Number(element.dataset.sourceEndLine || element.dataset.sourceStartLine) >= focus)
            .sort((a, b) => Number(a.dataset.sourceEndLine) - Number(a.dataset.sourceStartLine) - (Number(b.dataset.sourceEndLine) - Number(b.dataset.sourceStartLine)))[0]
            || blocks.sort((a, b) => Math.abs(Number(a.dataset.sourceStartLine) - focus) - Math.abs(Number(b.dataset.sourceStartLine) - focus))[0];
        target?.classList.add('is-preview-change'); target?.scrollIntoView({ block: 'center' });
    }
}
