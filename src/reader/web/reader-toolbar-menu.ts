import { readerIcon, type ReaderIconName } from './reader-icons';
import { positionReaderPopover } from './reader-popover';

export interface ReaderToolbarMenuLabels {
    moreTools: string;
    toolsReference: string;
    toolsReview: string;
    toolsEdition: string;
    toolsDisplay: string;
    definitions: string;
    symbols: string;
    propositions: string;
    symbolAudit: string;
    versionHistory: string;
    pdfPublication: string;
    sourceLineNumbers: string;
    fontSize: string;
    decreaseFont: string;
    increaseFont: string;
}

/** Owns the one-level tools menu, including its focus and visible popover anchor. */
export class ReaderToolbarMenu {
    private readonly menu = document.createElement('div');
    private readonly names = new Map<keyof ReaderToolbarMenuLabels, HTMLElement>();
    private opened = false;

    private readonly onTriggerClick = () => this.opened ? this.close(true) : this.open();
    private readonly onTriggerKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        this.open(event.key === 'ArrowUp');
    };
    private readonly onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (!this.menu.contains(target) && !this.trigger.contains(target)) this.close();
    };
    private readonly onFocusOut = (event: FocusEvent) => {
        const next = event.relatedTarget as Node | null;
        if (next && !this.menu.contains(next) && !this.trigger.contains(next)) this.close();
    };
    private readonly onKeyDown = (event: KeyboardEvent) => {
        if (!this.opened) return;
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); this.close(true); return;
        }
        if (!this.menu.contains(event.target as Node)) return;
        if (event.key === 'Tab') {
            // Resume the document's normal tab order from the visible trigger.
            this.close(true); return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = this.enabledItems();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        this.focus(items[index]);
    };
    private readonly onAction = (event: MouseEvent) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button');
        if (!button || !this.menu.contains(button)) return;
        if (button.disabled) { event.preventDefault(); event.stopPropagation(); return; }
        // Existing action handlers run afterwards and retain their original admission guards.
        // Modal dialogs therefore capture a visible focus-return target, never a hidden item.
        if (!button.dataset.keepMenuOpen) this.close(true);
    };
    private readonly onViewportChange = () => this.reposition();

    constructor(
        root: HTMLElement,
        private readonly trigger: HTMLElement,
        private readonly labels: () => ReaderToolbarMenuLabels,
        private readonly beforeOpen: () => void
    ) {
        this.menu.id = 'reader-more-menu';
        this.menu.className = 'reader-toolbar-menu';
        this.menu.hidden = true;
        this.menu.setAttribute('role', 'menu');
        this.menu.setAttribute('aria-labelledby', trigger.id);
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-controls', this.menu.id);
        trigger.setAttribute('aria-expanded', 'false');
        this.group('toolsReference', [
            this.item('definitions', 'definition', { panel: 'definitions' }),
            this.item('symbols', 'sigma', { panel: 'symbols' })
        ]);
        this.group('toolsReview', [
            this.item('propositions', 'propositions', { panel: 'propositions' }),
            this.item('symbolAudit', 'scan', { panel: 'symbol-audit' })
        ]);
        this.group('toolsEdition', [
            this.item('versionHistory', 'history', {}, 'reader-archive'),
            this.item('pdfPublication', 'publication', {}, 'reader-publication')
        ]);
        const lines = this.item('sourceLineNumbers', 'line-numbers', { keepMenuOpen: 'true' }, 'reader-line-numbers');
        lines.setAttribute('role', 'menuitemcheckbox');
        lines.removeAttribute('aria-haspopup');
        lines.setAttribute('aria-checked', 'false');
        const check = document.createElement('span');
        check.className = 'reader-tool-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = '✓';
        lines.append(check);
        const size = document.createElement('div'); size.className = 'reader-menu-font-size';
        const label = document.createElement('span'); label.className = 'reader-menu-font-label';
        this.names.set('fontSize', label);
        const controls = document.createElement('div'); controls.className = 'reader-type-control';
        controls.setAttribute('role', 'group');
        const decrease = this.fontButton('-1', 'A−'), increase = this.fontButton('1', 'A+');
        const value = document.createElement('output'); value.id = 'reader-font-size'; value.setAttribute('aria-live', 'polite');
        controls.append(decrease, value, increase); size.append(label, controls);
        this.group('toolsDisplay', [lines, size]);
        // Keep delegated Reader actions inside their original application root, outside the clipped toolbar.
        root.append(this.menu);
        this.updateLabels();
        trigger.addEventListener('click', this.onTriggerClick);
        trigger.addEventListener('keydown', this.onTriggerKeyDown);
        this.menu.addEventListener('click', this.onAction, true);
        this.menu.addEventListener('focusout', this.onFocusOut);
        document.addEventListener('pointerdown', this.onPointerDown, true);
        document.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('resize', this.onViewportChange);
        window.addEventListener('scroll', this.onViewportChange, true);
    }

    private group(key: keyof ReaderToolbarMenuLabels, children: HTMLElement[]): void {
        const group = document.createElement('div'); group.className = 'reader-menu-group'; group.setAttribute('role', 'group');
        const heading = document.createElement('div'); heading.className = 'reader-menu-heading'; heading.id = 'reader-menu-' + key;
        group.setAttribute('aria-labelledby', heading.id); this.names.set(key, heading);
        group.append(heading, ...children); this.menu.append(group);
    }

    private item(key: keyof ReaderToolbarMenuLabels, icon: ReaderIconName, data: Record<string, string>, id?: string): HTMLButtonElement {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'reader-menu-item'; button.tabIndex = -1;
        button.setAttribute('role', 'menuitem'); button.setAttribute('aria-haspopup', 'dialog');
        if (id) button.id = id;
        Object.assign(button.dataset, data);
        const name = document.createElement('span'); name.className = 'reader-tool-name'; this.names.set(key, name);
        button.append(readerIcon(icon), name); return button;
    }

    private fontButton(delta: string, text: string): HTMLButtonElement {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'type-size-button'; button.textContent = text;
        button.dataset.fontSize = delta; button.dataset.keepMenuOpen = 'true'; button.tabIndex = -1; button.setAttribute('role', 'menuitem'); return button;
    }

    updateLabels(): void {
        const labels = this.labels();
        for (const [key, name] of this.names) name.textContent = labels[key];
        this.trigger.dataset.readerTooltip = labels.moreTools; this.trigger.setAttribute('aria-label', labels.moreTools);
        for (const [key, name] of this.names) {
            if (name.parentElement?.matches('button')) name.parentElement.setAttribute('aria-label', labels[key]);
        }
        this.menu.querySelector('.reader-type-control')?.setAttribute('aria-label', labels.fontSize);
    }

    anchorFor(action: HTMLElement): HTMLElement {
        return this.menu.contains(action) ? this.trigger : action;
    }

    private enabledItems(): HTMLButtonElement[] {
        return Array.from(this.menu.querySelectorAll<HTMLButtonElement>('button')).filter(button => !button.disabled);
    }

    private focus(item: HTMLButtonElement | undefined): void {
        this.menu.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.tabIndex = button === item ? 0 : -1);
        item?.focus({ preventScroll: true }); item?.scrollIntoView({ block: 'nearest' });
    }

    refreshFocus(): void {
        if (!this.opened || !this.menu.contains(document.activeElement)) return;
        const active = document.activeElement as HTMLButtonElement;
        if (active.disabled) this.focus(this.enabledItems().at(-1));
    }

    open(last = false): void {
        if (!this.opened) this.beforeOpen();
        this.opened = true; this.menu.hidden = false;
        this.trigger.setAttribute('aria-expanded', 'true'); this.trigger.classList.add('is-active');
        this.reposition();
        const items = this.enabledItems(); this.focus(last ? items.at(-1) : items[0]);
    }

    private reposition(): void {
        if (!this.opened) return;
        this.menu.style.maxHeight = Math.max(0, window.innerHeight - 24) + 'px';
        positionReaderPopover(this.menu, this.trigger.getBoundingClientRect(), { maxWidth: 280, gap: 8 });
    }

    close(restoreFocus = false): void {
        if (!this.opened) return;
        this.opened = false; this.menu.hidden = true;
        this.trigger.setAttribute('aria-expanded', 'false'); this.trigger.classList.remove('is-active');
        this.menu.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.tabIndex = -1);
        if (restoreFocus && this.trigger.isConnected) this.trigger.focus({ preventScroll: true });
    }

    dispose(): void {
        this.close();
        this.trigger.removeEventListener('click', this.onTriggerClick);
        this.trigger.removeEventListener('keydown', this.onTriggerKeyDown);
        this.menu.removeEventListener('click', this.onAction, true);
        this.menu.removeEventListener('focusout', this.onFocusOut);
        document.removeEventListener('pointerdown', this.onPointerDown, true);
        document.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('resize', this.onViewportChange);
        window.removeEventListener('scroll', this.onViewportChange, true);
        this.menu.remove();
    }
}
