import { closestReaderElement, positionReaderPopover } from './reader-popover';

export interface ReaderLeanAnchorPayload {
    id: string;
    formal?: {
        type?: string;
        title?: string;
        filePath?: string;
        line?: number;
    };
    declarations?: Array<{
        projectKey?: string;
        filePath?: string;
        line?: number;
        kind?: string;
        name?: string;
        qualifiedName?: string;
    }>;
    status?: {
        contract?: string;
        build?: string;
        dependencies?: string;
    };
    comparison?: {
        markdownOnly?: string[];
        leanOnly?: string[];
        shared?: string[];
    };
}

export interface ReaderLeanPopoverLabels {
    title: string;
    openReview: string;
    loading: string;
    unavailable: string;
    contract: string;
    build: string;
    dependencies: string;
    declarations: string;
    markdownOnly: string;
    leanOnly: string;
    none: string;
    status(kind: 'contract' | 'build' | 'dependencies', value: string | undefined): string;
}

export interface ReaderLeanPopoverHost {
    fetchAnchor(id: string): Promise<ReaderLeanAnchorPayload>;
    openReview(id: string, marker: HTMLButtonElement): void;
    labels(): ReaderLeanPopoverLabels;
}

/**
 * Owns the on-demand Lean alignment inspector for the compact `Lean`
 * marker. It keeps request identity with the popover so a late response cannot
 * repopulate a marker that has already been dismissed or replaced.
 */
export class ReaderLeanPopover {
    private article: HTMLElement | undefined;
    private popover: HTMLElement | undefined;
    private activeMarker: HTMLButtonElement | undefined;
    private requestId = 0;
    private readonly onClick = (event: MouseEvent) => {
        const marker = closestReaderElement<HTMLButtonElement>(event.target as Node, 'button[data-reader-lean-anchor]');
        if (!marker?.dataset.readerLeanAnchor || !this.article?.contains(marker)) return;
        event.preventDefault();
        // Focus opens the inspector before a pointer click is dispatched. Keep
        // that already-open marker visible rather than immediately toggling it
        // closed; outside click and Escape remain the dismissal affordances.
        if (marker !== this.activeMarker) this.open(marker);
    };
    private readonly onFocusIn = (event: FocusEvent) => {
        const marker = closestReaderElement<HTMLButtonElement>(event.target as Node, 'button[data-reader-lean-anchor]');
        if (!marker?.dataset.readerLeanAnchor || !this.article?.contains(marker) || marker === this.activeMarker) return;
        this.open(marker);
    };
    private readonly onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (this.popover?.contains(target) || this.activeMarker?.contains(target)) return;
        this.dismiss();
    };
    private readonly onViewportChange = () => this.dismiss();
    private readonly onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') this.dismiss();
    };

    constructor(private readonly host: ReaderLeanPopoverHost) {
        document.addEventListener('pointerdown', this.onPointerDown, true);
        document.addEventListener('scroll', this.onViewportChange, true);
        window.addEventListener('resize', this.onViewportChange);
        document.addEventListener('keydown', this.onKeyDown);
    }

    bind(article: HTMLElement): void {
        if (this.article && this.article !== article) this.unbindArticle(this.article);
        this.article = article;
        article.removeEventListener('click', this.onClick);
        article.removeEventListener('focusin', this.onFocusIn);
        article.addEventListener('click', this.onClick);
        article.addEventListener('focusin', this.onFocusIn);
        this.dismiss();
    }

    dispose(): void {
        if (this.article) this.unbindArticle(this.article);
        document.removeEventListener('pointerdown', this.onPointerDown, true);
        document.removeEventListener('scroll', this.onViewportChange, true);
        window.removeEventListener('resize', this.onViewportChange);
        document.removeEventListener('keydown', this.onKeyDown);
        this.dismiss();
    }

    private unbindArticle(article: HTMLElement): void {
        article.removeEventListener('click', this.onClick);
        article.removeEventListener('focusin', this.onFocusIn);
    }

    private open(marker: HTMLButtonElement): void {
        const id = marker.dataset.readerLeanAnchor;
        if (!id) return;
        this.dismiss();
        this.activeMarker = marker;
        const requestId = ++this.requestId;
        const labels = this.host.labels();
        const popover = this.createPopover(labels.title, labels.openReview, id, marker);
        const loading = document.createElement('p');
        loading.className = 'reader-lean-popover-status';
        loading.textContent = labels.loading;
        popover.append(loading);
        this.popover = popover;
        positionReaderPopover(popover, marker.getBoundingClientRect(), { maxWidth: 460, gap: 7 });
        void this.host.fetchAnchor(id).then(payload => {
            if (requestId !== this.requestId || marker !== this.activeMarker || !this.popover) return;
            this.renderPayload(payload, labels);
            positionReaderPopover(this.popover, marker.getBoundingClientRect(), { maxWidth: 460, gap: 7 });
        }).catch(() => {
            if (requestId !== this.requestId || marker !== this.activeMarker || !this.popover) return;
            const failed = document.createElement('p');
            failed.className = 'reader-lean-popover-status is-error';
            failed.textContent = labels.unavailable;
            this.popover.replaceChildren(this.popover.querySelector('header') as HTMLElement, failed);
            positionReaderPopover(this.popover, marker.getBoundingClientRect(), { maxWidth: 460, gap: 7 });
        });
    }

    private createPopover(titleText: string, reviewText: string, id: string, marker: HTMLButtonElement): HTMLElement {
        const popover = document.createElement('section');
        popover.className = 'reader-lean-popover';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', titleText);
        const header = document.createElement('header');
        const title = document.createElement('h2');
        title.textContent = titleText;
        const review = document.createElement('button');
        review.type = 'button';
        review.className = 'reader-lean-open-review';
        review.dataset.readerLeanReview = id;
        review.textContent = reviewText;
        review.addEventListener('click', () => {
            this.dismiss();
            this.host.openReview(id, marker);
        });
        header.append(title, review);
        popover.append(header);
        document.body.append(popover);
        return popover;
    }

    private renderPayload(payload: ReaderLeanAnchorPayload, labels: ReaderLeanPopoverLabels): void {
        if (!this.popover) return;
        const header = this.popover.querySelector('header') as HTMLElement;
        const content: HTMLElement[] = [];
        const formal = payload.formal;
        if (formal?.title || formal?.filePath) {
            const source = document.createElement('p');
            source.className = 'reader-lean-popover-source';
            source.textContent = [formal.title, formal.filePath && `${formal.filePath}${formal.line ? ':' + formal.line : ''}`].filter(Boolean).join(' · ');
            content.push(source);
        }
        const status = document.createElement('dl');
        status.className = 'reader-lean-status-list';
        this.appendStatus(status, labels.contract, labels.status('contract', payload.status?.contract));
        this.appendStatus(status, labels.build, labels.status('build', payload.status?.build));
        this.appendStatus(status, labels.dependencies, labels.status('dependencies', payload.status?.dependencies));
        content.push(status);
        content.push(this.renderDeclarations(payload.declarations || [], labels));
        const comparison = payload.comparison;
        if (comparison?.markdownOnly?.length || comparison?.leanOnly?.length) {
            const comparisonSection = document.createElement('section');
            comparisonSection.className = 'reader-lean-comparison';
            if (comparison.markdownOnly?.length) comparisonSection.append(this.renderReferenceList(labels.markdownOnly, comparison.markdownOnly));
            if (comparison.leanOnly?.length) comparisonSection.append(this.renderReferenceList(labels.leanOnly, comparison.leanOnly));
            content.push(comparisonSection);
        }
        this.popover.replaceChildren(header, ...content);
    }

    private appendStatus(list: HTMLDListElement, label: string, value: string): void {
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.textContent = value;
        list.append(term, detail);
    }

    private renderDeclarations(declarations: NonNullable<ReaderLeanAnchorPayload['declarations']>, labels: ReaderLeanPopoverLabels): HTMLElement {
        const section = document.createElement('section');
        section.className = 'reader-lean-declarations';
        const heading = document.createElement('h3');
        heading.textContent = labels.declarations;
        const count = document.createElement('span');
        count.textContent = String(declarations.length);
        heading.append(count);
        section.append(heading);
        if (declarations.length === 0) {
            const empty = document.createElement('p');
            empty.textContent = labels.none;
            section.append(empty);
            return section;
        }
        const list = document.createElement('ul');
        for (const declaration of declarations) {
            const item = document.createElement('li');
            const name = document.createElement('code');
            name.textContent = declaration.qualifiedName || declaration.name || '';
            const detail = document.createElement('span');
            detail.textContent = [declaration.kind, declaration.filePath && `${declaration.filePath}${declaration.line ? ':' + declaration.line : ''}`].filter(Boolean).join(' · ');
            item.append(name, detail);
            list.append(item);
        }
        section.append(list);
        return section;
    }

    private renderReferenceList(title: string, ids: string[]): HTMLElement {
        const section = document.createElement('section');
        section.className = 'reader-lean-reference-list';
        const heading = document.createElement('h3');
        heading.textContent = title;
        const list = document.createElement('p');
        list.textContent = ids.join(', ');
        section.append(heading, list);
        return section;
    }

    private dismiss(): void {
        this.requestId++;
        this.activeMarker = undefined;
        this.popover?.remove();
        this.popover = undefined;
    }
}
