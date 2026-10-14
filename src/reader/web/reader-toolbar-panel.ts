import { readerIcon } from './reader-icons';
import { positionReaderPopover } from './reader-popover';

export interface ReaderToolbarPanelLabels {
    close: string;
}

export class ReaderToolbarPanel {
    private panel: HTMLElement | undefined;
    private trigger: HTMLElement | undefined;
    private anchor: HTMLElement | undefined;
    private activeId = '';
    private readonly onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (this.panel?.contains(target) || this.anchor?.contains(target)) return;
        this.close();
    };
    private readonly onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && this.panel) { event.preventDefault(); this.close(true); }
    };
    private readonly onViewportChange = () => this.reposition();

    constructor(private readonly labels: () => ReaderToolbarPanelLabels) {
        document.addEventListener('pointerdown', this.onPointerDown, true);
        document.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('resize', this.onViewportChange);
    }

    open(id: string, trigger: HTMLElement, title: string, populate: (content: HTMLElement) => void, anchor = trigger): HTMLElement | undefined {
        if (this.activeId === id && this.trigger === trigger) {
            this.close();
            return undefined;
        }
        this.close();

        const panel = document.createElement('section');
        panel.className = 'reader-toolbar-panel is-' + id;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', title);
        panel.tabIndex = -1;
        const header = document.createElement('header');
        const heading = document.createElement('h2');
        heading.textContent = title;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'reader-panel-close';
        close.append(readerIcon('x'));
        close.dataset.tooltip = this.labels().close;
        close.setAttribute('aria-label', this.labels().close);
        close.addEventListener('click', () => this.close(true));
        header.append(heading, close);
        const content = document.createElement('div');
        content.className = 'reader-panel-content';
        panel.append(header, content);
        this.panel = panel;
        this.trigger = trigger;
        this.anchor = anchor;
        this.activeId = id;
        trigger.classList.add('is-active');
        trigger.setAttribute('aria-expanded', 'true');
        populate(content);
        this.reposition();
        if (anchor !== trigger) {
            (content.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || panel).focus({ preventScroll: true });
        }
        return content;
    }

    isActive(id: string): boolean {
        return this.activeId === id;
    }

    reposition(): void {
        if (!this.panel || !this.anchor) return;
        positionReaderPopover(this.panel, this.anchor.getBoundingClientRect(), {
            maxWidth: this.activeId === 'propositions' ? 780 : 580,
            gap: 8
        });
    }

    close(restoreFocus = false): void {
        const anchor = this.anchor;
        this.trigger?.classList.remove('is-active');
        this.trigger?.setAttribute('aria-expanded', 'false');
        this.panel?.remove();
        this.panel = undefined;
        this.trigger = undefined;
        this.anchor = undefined;
        this.activeId = '';
        if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
    }

    dispose(): void {
        document.removeEventListener('pointerdown', this.onPointerDown, true);
        document.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('resize', this.onViewportChange);
        this.close();
    }
}
