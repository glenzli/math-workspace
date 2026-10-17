import { readerText } from './reader-ui-labels';
import type { ReaderLabel } from './formal-renderer';
import { closestReaderElement, positionReaderPopover } from './reader-popover';

export interface ReaderRecallPopoverLabels {
    recall: string;
}

export interface ReaderRecallPopoverHost {
    fetchRecall(id: string): Promise<ReaderRecallPayload>;
    renderRecall(recall: ReaderRecallPayload): string;
    labels(): ReaderRecallPopoverLabels;
}

interface ReaderRecallPayload {
    display?: string;
    title?: string;
    content?: string;
    filePath?: string;
    labels?: Record<string, ReaderLabel>;
}

export class ReaderRecallPopover {
    private article: HTMLElement | undefined;
    private popover: HTMLElement | undefined;
    private activeReference: HTMLAnchorElement | undefined;
    private showTimer: number | undefined;
    private closeTimer: number | undefined;
    private requestId = 0;
    private readonly cache = new Map<string, ReaderRecallPayload>();
    private readonly onPointerOver = (event: PointerEvent) => {
        const reference = closestReaderElement<HTMLAnchorElement>(event.target as Node, 'a[data-formal-ref]');
        if (!reference?.dataset.formalRef || !this.article?.contains(reference)) return;
        if (reference.contains(event.relatedTarget as Node | null)) return;
        this.cancelClose();
        if (this.activeReference !== reference) this.dismiss();
        this.activeReference = reference;
        window.clearTimeout(this.showTimer);
        this.showTimer = window.setTimeout(() => void this.show(reference), 320);
    };
    private readonly onPointerOut = (event: PointerEvent) => {
        const reference = closestReaderElement<HTMLAnchorElement>(event.target as Node, 'a[data-formal-ref]');
        if (!reference || reference.contains(event.relatedTarget as Node | null)) return;
        if (this.popover?.contains(event.relatedTarget as Node | null)) return;
        this.scheduleClose();
    };
    private readonly onPopoverPointerEnter = () => this.cancelClose();
    private readonly onPopoverPointerLeave = () => this.scheduleClose();
    private readonly onViewportChange = () => this.dismiss();

    constructor(private readonly host: ReaderRecallPopoverHost) {
        document.addEventListener('scroll', this.onViewportChange, true);
        window.addEventListener('resize', this.onViewportChange);
    }

    bind(article: HTMLElement): void {
        if (this.article && this.article !== article) this.unbindArticle(this.article);
        this.article = article;
        article.removeEventListener('pointerover', this.onPointerOver);
        article.removeEventListener('pointerout', this.onPointerOut);
        article.addEventListener('pointerover', this.onPointerOver);
        article.addEventListener('pointerout', this.onPointerOut);
        this.dismiss();
    }

    dispose(): void {
        if (this.article) this.unbindArticle(this.article);
        document.removeEventListener('scroll', this.onViewportChange, true);
        window.removeEventListener('resize', this.onViewportChange);
        this.dismiss();
    }

    private unbindArticle(article: HTMLElement): void {
        article.removeEventListener('pointerover', this.onPointerOver);
        article.removeEventListener('pointerout', this.onPointerOut);
    }

    private async show(reference: HTMLAnchorElement): Promise<void> {
        const id = reference.dataset.formalRef;
        if (!id || reference !== this.activeReference) return;
        const requestId = ++this.requestId;
        let recall = this.cache.get(id);
        try {
            recall ||= await this.host.fetchRecall(id);
        } catch (_error) {
            return;
        }
        if (requestId !== this.requestId || reference !== this.activeReference) return;
        this.remember(id, recall);
        const popover = document.createElement('section');
        popover.className = 'reader-recall-popover';
        popover.setAttribute('role', 'dialog');
        popover.addEventListener('pointerenter', this.onPopoverPointerEnter);
        popover.addEventListener('pointerleave', this.onPopoverPointerLeave);
        const header = document.createElement('header');
        readerText(header, () => recall.display || recall.title || this.host.labels().recall);
        const content = document.createElement('div');
        content.innerHTML = this.host.renderRecall(recall);
        popover.append(header, content);
        this.dismissPopover();
        this.popover = popover;
        positionReaderPopover(popover, reference.getBoundingClientRect(), { maxWidth: 520 });
    }

    private remember(id: string, recall: ReaderRecallPayload): void {
        this.cache.delete(id);
        this.cache.set(id, recall);
        if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value as string);
    }

    private scheduleClose(): void {
        window.clearTimeout(this.closeTimer);
        this.closeTimer = window.setTimeout(() => this.dismiss(), 140);
    }

    private cancelClose(): void {
        window.clearTimeout(this.closeTimer);
    }

    private dismissPopover(): void {
        this.popover?.removeEventListener('pointerenter', this.onPopoverPointerEnter);
        this.popover?.removeEventListener('pointerleave', this.onPopoverPointerLeave);
        this.popover?.remove();
        this.popover = undefined;
    }

    private dismiss(): void {
        window.clearTimeout(this.showTimer);
        window.clearTimeout(this.closeTimer);
        this.requestId++;
        this.activeReference = undefined;
        this.dismissPopover();
    }
}
