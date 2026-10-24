import { ReaderChangePreview, type ReaderChangePreviewHost } from './reader-change-preview';
import { readerIconAction, describeReaderIconAction } from './reader-icons';
import type { ReaderReferenceLocation } from './reader-references';

interface Host extends ReaderChangePreviewHost {
    article: HTMLElement;
    targets(): HTMLElement[];
    hasChanges(): boolean;
    reveal(target: HTMLElement): void;
}

/** Owns change navigation and resolves source-action ranges to changed passages. */
export class ReaderChangeNavigation {
    private bar: HTMLElement;
    private previous: HTMLButtonElement;
    private next: HTMLButtonElement;
    private count: HTMLElement;
    private active?: HTMLElement;
    private identity = '';
    private preview: ReaderChangePreview;
    constructor(container: HTMLElement, private host: Host) {
        this.preview = new ReaderChangePreview(host);
        this.bar = document.createElement('nav'); this.bar.className = 'reader-change-navigation';
        this.previous = readerIconAction('chevron-up', ''); this.previous.dataset.changePrevious = 'true';
        this.next = readerIconAction('chevron-down', ''); this.next.dataset.changeNext = 'true';
        this.count = document.createElement('span'); this.count.className = 'reader-change-count'; this.count.setAttribute('aria-live', 'polite');
        this.bar.append(this.previous, this.count, this.next); container.append(this.bar);
        this.previous.addEventListener('click', () => this.move(-1)); this.next.addEventListener('click', () => this.move(1));
        this.update();
    }
    private t(zh: string, en: string): string { return this.host.context()?.language === 'zh' ? zh : en; }
    private contextIdentity(): string { const context = this.host.context(); return JSON.stringify([context?.project, context?.token, context?.filePath, context?.sourceHash, context?.commit]); }
    update(): void {
        const identity = this.contextIdentity();
        if (identity !== this.identity) { this.identity = identity; this.active?.classList.remove('is-current-change'); this.active = undefined; this.closePreview(false); }
        this.bar.hidden = !this.host.context() || !this.host.hasChanges();
        this.bar.setAttribute('aria-label', this.t('修改导航', 'Change navigation'));
        describeReaderIconAction(this.previous, this.t('上一处修改', 'Previous change'));
        describeReaderIconAction(this.next, this.t('下一处修改', 'Next change'));
        const targets = this.bar.hidden ? [] : this.host.targets(), index = this.active ? targets.indexOf(this.active) : -1;
        if (index >= 0) this.active!.classList.add('is-current-change');
        this.count.textContent = index >= 0 ? `${index + 1} / ${targets.length}` : this.t(`${targets.length} 处修改`, `${targets.length} changes`);
        this.previous.disabled = this.next.disabled = !targets.length;
        if (this.bar.hidden || this.active && !targets.includes(this.active)) this.closePreview(false);
        this.preview.update();
    }
    private select(target: HTMLElement): void {
        this.active?.classList.remove('is-current-change'); this.active = target; target.classList.add('is-current-change'); this.update();
    }
    private comparisonTarget(location: ReaderReferenceLocation): HTMLElement | undefined {
        if (this.bar.hidden || location.filePath !== this.host.context()?.filePath || !Number.isInteger(location.startLine) || !Number.isInteger(location.endLine) || location.startLine < 1 || location.endLine < location.startLine) return;
        return this.host.targets().find(target => this.host.article.contains(target)
            && Number(target.dataset.sourceStartLine) <= location.endLine
            && Number(target.dataset.sourceEndLine || target.dataset.sourceStartLine) >= location.startLine);
    }
    canCompare(location: ReaderReferenceLocation): boolean { return !!this.comparisonTarget(location); }
    async openComparison(location: ReaderReferenceLocation, trigger: HTMLElement): Promise<void> {
        const target = this.comparisonTarget(location); if (!target) return;
        this.select(target); await this.preview.open(target, trigger);
    }
    private move(direction: -1 | 1): void {
        const targets = this.host.targets(); if (!targets.length) return;
        const index = this.active ? targets.indexOf(this.active) : -1;
        const next = index >= 0 ? (index + direction + targets.length) % targets.length : direction > 0 ? 0 : targets.length - 1;
        this.host.reveal(targets[next]); this.select(targets[next]);
        this.active!.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        if (this.preview.isOpen()) void this.preview.open(this.active!, direction > 0 ? this.next : this.previous);
    }
    closePreview(restoreFocus = true): void { this.preview.close(restoreFocus); }
    dispose(): void {
        this.preview.close(false);
        this.active?.classList.remove('is-current-change'); this.bar.remove();
    }
}
