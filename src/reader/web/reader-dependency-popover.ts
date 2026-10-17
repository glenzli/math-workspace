import { readerText, readerAttribute } from './reader-ui-labels';
import type { ReaderDependencyMarker, ReaderDependencyMarkerKind, ReaderDependencyNeighbor } from '../dependency-markers';
import { closestReaderElement, positionReaderPopover } from './reader-popover';

export interface ReaderDependencyPopoverLabels {
    dependencyTitle: (kind: ReaderDependencyMarkerKind) => string;
    upstream: string;
    downstream: string;
    noUpstream: string;
    noDownstream: string;
    otherFormalReferences: (count: number) => string;
}

export interface ReaderDependencyPopoverHost {
    markerFor(id: string): ReaderDependencyMarker | undefined;
    openTarget(target: ReaderDependencyNeighbor): void;
    labels(): ReaderDependencyPopoverLabels;
}

/**
 * Displays the direct dependency neighborhood for one marker. The graph
 * projection is already page-local, so opening this card never fetches or
 * expands the full project graph.
 */
export class ReaderDependencyPopover {
    private article: HTMLElement | undefined;
    private popover: HTMLElement | undefined;
    private activeMarker: HTMLButtonElement | undefined;
    private showTimer: number | undefined;
    private closeTimer: number | undefined;
    private readonly onPointerOver = (event: PointerEvent) => {
        const marker = closestReaderElement<HTMLButtonElement>(event.target as Node, 'button[data-reader-dependency]');
        if (!marker?.dataset.readerDependency || !this.article?.contains(marker)) return;
        if (marker.contains(event.relatedTarget as Node | null)) return;
        this.cancelClose();
        if (this.activeMarker !== marker) this.dismiss();
        this.activeMarker = marker;
        window.clearTimeout(this.showTimer);
        this.showTimer = window.setTimeout(() => this.show(marker), 140);
    };
    private readonly onPointerOut = (event: PointerEvent) => {
        const marker = closestReaderElement<HTMLButtonElement>(event.target as Node, 'button[data-reader-dependency]');
        if (!marker || marker.contains(event.relatedTarget as Node | null)) return;
        if (this.popover?.contains(event.relatedTarget as Node | null)) return;
        this.scheduleClose();
    };
    private readonly onFocusIn = (event: FocusEvent) => {
        const marker = closestReaderElement<HTMLButtonElement>(event.target as Node, 'button[data-reader-dependency]');
        if (!marker?.dataset.readerDependency || !this.article?.contains(marker)) return;
        this.cancelClose();
        if (this.activeMarker !== marker) this.dismiss();
        this.activeMarker = marker;
        window.clearTimeout(this.showTimer);
        this.show(marker);
    };
    private readonly onFocusOut = (event: FocusEvent) => {
        if (this.popover?.contains(event.relatedTarget as Node | null)) return;
        this.scheduleClose();
    };
    private readonly onClick = (event: MouseEvent) => {
        const marker = closestReaderElement<HTMLButtonElement>(event.target as Node, 'button[data-reader-dependency]');
        if (!marker?.dataset.readerDependency || !this.article?.contains(marker)) return;
        event.preventDefault();
        this.cancelClose();
        if (this.activeMarker !== marker) this.dismiss();
        this.activeMarker = marker;
        this.show(marker);
    };
    private readonly onPopoverPointerEnter = () => this.cancelClose();
    private readonly onPopoverPointerLeave = () => this.scheduleClose();
    private readonly onViewportChange = () => this.dismiss();
    private readonly onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') this.dismiss();
    };

    constructor(private readonly host: ReaderDependencyPopoverHost) {
        document.addEventListener('scroll', this.onViewportChange, true);
        window.addEventListener('resize', this.onViewportChange);
        document.addEventListener('keydown', this.onKeyDown);
    }

    bind(article: HTMLElement): void {
        if (this.article && this.article !== article) this.unbindArticle(this.article);
        this.article = article;
        article.removeEventListener('pointerover', this.onPointerOver);
        article.removeEventListener('pointerout', this.onPointerOut);
        article.removeEventListener('focusin', this.onFocusIn);
        article.removeEventListener('focusout', this.onFocusOut);
        article.removeEventListener('click', this.onClick);
        article.addEventListener('pointerover', this.onPointerOver);
        article.addEventListener('pointerout', this.onPointerOut);
        article.addEventListener('focusin', this.onFocusIn);
        article.addEventListener('focusout', this.onFocusOut);
        article.addEventListener('click', this.onClick);
        this.dismiss();
    }

    dispose(): void {
        if (this.article) this.unbindArticle(this.article);
        document.removeEventListener('scroll', this.onViewportChange, true);
        window.removeEventListener('resize', this.onViewportChange);
        document.removeEventListener('keydown', this.onKeyDown);
        this.dismiss();
    }

    private unbindArticle(article: HTMLElement): void {
        article.removeEventListener('pointerover', this.onPointerOver);
        article.removeEventListener('pointerout', this.onPointerOut);
        article.removeEventListener('focusin', this.onFocusIn);
        article.removeEventListener('focusout', this.onFocusOut);
        article.removeEventListener('click', this.onClick);
    }

    private show(marker: HTMLButtonElement): void {
        const id = marker.dataset.readerDependency;
        if (!id || marker !== this.activeMarker) return;
        const dependency = this.host.markerFor(id);
        if (!dependency) return;

        const labels = this.host.labels();
        const dependencyTitle = labels.dependencyTitle(dependency.kind);
        const popover = document.createElement('section');
        popover.className = 'reader-dependency-popover';
        popover.setAttribute('role', 'dialog');
        readerAttribute(popover, 'aria-label', () => this.host.labels().dependencyTitle(dependency.kind));
        popover.addEventListener('pointerenter', this.onPopoverPointerEnter);
        popover.addEventListener('pointerleave', this.onPopoverPointerLeave);

        const header = document.createElement('header');
        const title = document.createElement('h2');
        readerText(title, () => this.host.labels().dependencyTitle(dependency.kind));
        header.append(title);
        popover.append(header);
        popover.append(
            this.renderNeighbors(() => this.host.labels().upstream, Array.isArray(dependency.upstream) ? dependency.upstream : [], () => this.host.labels().noUpstream),
            this.renderNeighbors(() => this.host.labels().downstream, Array.isArray(dependency.downstream) ? dependency.downstream : [], () => this.host.labels().noDownstream)
        );

        const otherReferences = Math.max(0, dependency.sourceReferenceCount - dependency.directDependencies);
        if (otherReferences > 0) {
            const note = document.createElement('p');
            note.className = 'reader-dependency-note';
            readerText(note, () => this.host.labels().otherFormalReferences(otherReferences));
            popover.append(note);
        }

        this.dismissPopover();
        this.popover = popover;
        positionReaderPopover(popover, marker.getBoundingClientRect(), { maxWidth: 420, gap: 8 });
    }

    private renderNeighbors(title: () => string, neighbors: ReaderDependencyNeighbor[], emptyLabel: () => string): HTMLElement {
        const section = document.createElement('section');
        section.className = 'reader-dependency-group';
        const heading = document.createElement('h3');
        readerText(heading, title);
        const count = document.createElement('span');
        count.textContent = String(neighbors.length);
        heading.append(count);
        section.append(heading);
        if (neighbors.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'reader-dependency-empty';
            readerText(empty, emptyLabel);
            section.append(empty);
            return section;
        }

        const list = document.createElement('div');
        list.className = 'reader-dependency-list';
        for (const neighbor of neighbors) {
            const target = document.createElement('button');
            target.type = 'button';
            target.className = 'reader-dependency-target';
            const display = document.createElement('strong');
            display.textContent = neighbor.display;
            target.append(display);
            if (neighbor.title && neighbor.title !== neighbor.display) {
                const detail = document.createElement('span');
                detail.textContent = neighbor.title;
                target.append(detail);
            }
            target.addEventListener('click', () => {
                this.host.openTarget(neighbor);
                this.dismiss();
            });
            list.append(target);
        }
        section.append(list);
        return section;
    }

    private scheduleClose(): void {
        window.clearTimeout(this.closeTimer);
        this.closeTimer = window.setTimeout(() => this.dismiss(), 180);
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
        this.activeMarker = undefined;
        this.dismissPopover();
    }
}
