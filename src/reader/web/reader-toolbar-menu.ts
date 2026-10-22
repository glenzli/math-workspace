import { readerIcon, replaceReaderButtonIcon, type ReaderIconName } from './reader-icons';
import { positionReaderPopover } from './reader-popover';
import type { LanguagePreference, ThemePreference } from './reader-preferences';

export interface ReaderToolbarMenuLabels {
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
    uncommittedChanges: string;
    fontSize: string;
    decreaseFont: string;
    increaseFont: string;
    interfaceLanguage: string;
    appearance: string;
    automatic: string;
    chinese: string;
    english: string;
    light: string;
    dark: string;
}

interface ReaderToolbarPreferences {
    snapshot(): { languagePreference: LanguagePreference; themePreference: ThemePreference };
    setLanguage(value: LanguagePreference): void;
    setTheme(value: ThemePreference): void;
}

type Category = 'reference' | 'review' | 'edition' | 'display';
interface CategoryMenu {
    trigger: HTMLElement;
    group: HTMLElement;
    label: keyof ReaderToolbarMenuLabels;
}

/** Owns the category menus, including shared dismissal, focus and visible anchors. */
export class ReaderToolbarMenu {
    private readonly menu = document.createElement('div');
    private readonly names = new Map<keyof ReaderToolbarMenuLabels, HTMLElement>();
    private readonly categories = new Map<Category, CategoryMenu>();
    private active: CategoryMenu | undefined;

    private readonly onTriggerClick = (event: MouseEvent) => {
        const category = this.categories.get((event.currentTarget as HTMLElement).dataset.toolMenu as Category);
        if (category === this.active) this.close(true);
        else this.open(category);
    };
    private readonly onTriggerKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        this.open(this.categories.get((event.currentTarget as HTMLElement).dataset.toolMenu as Category), event.key === 'ArrowUp');
    };
    private readonly onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (!this.menu.contains(target) && !this.containsTrigger(target)) this.close();
    };
    private readonly onFocusOut = (event: FocusEvent) => {
        const next = event.relatedTarget as Node | null;
        if (next && !this.menu.contains(next) && !this.containsTrigger(next)) this.close();
    };
    private readonly onKeyDown = (event: KeyboardEvent) => {
        if (!this.active) return;
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); this.close(true); return;
        }
        if (!this.menu.contains(event.target as Node)) return;
        const select = (event.target as HTMLElement).tagName.toLowerCase() === 'select';
        if (select && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        if (event.key === 'Tab') {
            if (select) {
                const controls = [...this.active.group.querySelectorAll<HTMLSelectElement>('select')].filter(control => !control.disabled);
                const index = controls.indexOf(event.target as HTMLSelectElement);
                if (event.shiftKey ? index > 0 : index < controls.length - 1) return;
            }
            // Resume the document's normal tab order from the visible trigger.
            this.close(true); return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = this.enabledItems();
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement | HTMLSelectElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        this.focus(items[index]);
    };
    private readonly onAction = (event: MouseEvent) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button');
        if (!button || !this.menu.contains(button)) return;
        if (button.disabled || !this.active?.group.contains(button)) { event.preventDefault(); event.stopPropagation(); return; }
        // Existing action handlers run afterwards and retain their original admission guards.
        // Modal dialogs therefore capture a visible focus-return target, never a hidden item.
        if (!button.dataset.keepMenuOpen) this.close(true);
    };
    private readonly onViewportChange = () => this.reposition();

    constructor(
        root: HTMLElement,
        private readonly labels: () => ReaderToolbarMenuLabels,
        private readonly beforeOpen: () => void,
        private readonly preferences: ReaderToolbarPreferences
    ) {
        this.menu.id = 'reader-category-menu';
        this.menu.className = 'reader-toolbar-menu';
        this.menu.hidden = true;
        this.menu.tabIndex = -1;
        this.menu.setAttribute('role', 'menu');
        for (const [category, label, icon] of [
            ['reference', 'toolsReference', 'reference-tools'],
            ['review', 'toolsReview', 'review-tools'],
            ['edition', 'toolsEdition', 'edition-tools'],
            ['display', 'toolsDisplay', 'display-tools']
        ] as const) {
            const trigger = root.querySelector<HTMLElement>('[data-tool-menu="' + category + '"]')!;
            trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-controls', this.menu.id); trigger.setAttribute('aria-expanded', 'false');
            replaceReaderButtonIcon(trigger, icon);
            const group = document.createElement('div'); group.className = 'reader-menu-group'; group.setAttribute('role', 'group'); group.hidden = true;
            const heading = document.createElement('div'); heading.className = 'reader-menu-heading'; heading.id = 'reader-menu-' + category;
            group.setAttribute('aria-labelledby', heading.id); this.names.set(label, heading);
            group.append(heading); this.menu.append(group);
            this.categories.set(category, { trigger, group, label });
            trigger.addEventListener('click', this.onTriggerClick);
            trigger.addEventListener('keydown', this.onTriggerKeyDown);
        }
        this.group('reference', [
            this.item('definitions', 'definition', { panel: 'definitions' }),
            this.item('symbols', 'sigma', { panel: 'symbols' })
        ]);
        this.group('review', [
            this.item('propositions', 'propositions', { panel: 'propositions' }),
            this.item('symbolAudit', 'scan', { panel: 'symbol-audit' })
        ]);
        this.group('edition', [
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
        const changes = this.item('uncommittedChanges', 'compare', { keepMenuOpen: 'true' }, 'reader-uncommitted');
        changes.setAttribute('role', 'menuitemcheckbox'); changes.removeAttribute('aria-haspopup'); changes.setAttribute('aria-checked', 'false');
        const changesStatus = document.createElement('span'); changesStatus.id = 'reader-uncommitted-status'; changesStatus.className = 'reader-tool-status';
        changesStatus.hidden = true; changesStatus.setAttribute('role', 'status'); changesStatus.setAttribute('aria-live', 'polite'); changes.append(changesStatus);
        const changesCheck = document.createElement('span'); changesCheck.className = 'reader-tool-check'; changesCheck.setAttribute('aria-hidden', 'true'); changesCheck.textContent = '✓'; changes.append(changesCheck);
        const size = document.createElement('div'); size.className = 'reader-menu-font-size';
        const label = document.createElement('span'); label.className = 'reader-menu-font-label';
        this.names.set('fontSize', label);
        const controls = document.createElement('div'); controls.className = 'reader-type-control';
        controls.setAttribute('role', 'group');
        const decrease = this.fontButton('-1', 'A−'), increase = this.fontButton('1', 'A+');
        const value = document.createElement('output'); value.id = 'reader-font-size'; value.setAttribute('aria-live', 'polite');
        controls.append(decrease, value, increase); size.append(label, controls);
        this.group('display', [lines, changes, size,
            this.preference('reader-interface-language', 'interfaceLanguage', [['auto', 'automatic'], ['zh', 'chinese'], ['en', 'english']],
                value => this.preferences.setLanguage(value as LanguagePreference)),
            this.preference('reader-appearance', 'appearance', [['auto', 'automatic'], ['light', 'light'], ['dark', 'dark']],
                value => this.preferences.setTheme(value as ThemePreference))]);
        // Keep delegated Reader actions inside their original application root, outside the clipped toolbar.
        root.append(this.menu);
        this.updateLabels();
        this.updatePreferences();
        this.menu.addEventListener('click', this.onAction, true);
        this.menu.addEventListener('focusout', this.onFocusOut);
        document.addEventListener('pointerdown', this.onPointerDown, true);
        document.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('resize', this.onViewportChange);
        window.addEventListener('scroll', this.onViewportChange, true);
    }

    private group(category: Category, children: HTMLElement[]): void {
        this.categories.get(category)!.group.append(...children);
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

    private preference(id: string, key: keyof ReaderToolbarMenuLabels,
        choices: Array<[string, keyof ReaderToolbarMenuLabels]>, change: (value: string) => void): HTMLLabelElement {
        const field = document.createElement('label'); field.className = 'reader-menu-preference';
        const label = document.createElement('span'); label.dataset.preferenceLabel = key;
        const select = document.createElement('select'); select.id = id; select.tabIndex = -1;
        select.dataset.preferenceLabel = key;
        for (const [value, name] of choices) {
            const option = document.createElement('option'); option.value = value; option.dataset.preferenceLabel = name; select.append(option);
        }
        select.addEventListener('change', () => change(select.value)); field.append(label, select); return field;
    }

    updatePreferences(): void {
        const snapshot = this.preferences.snapshot();
        this.menu.querySelector<HTMLSelectElement>('#reader-interface-language')!.value = snapshot.languagePreference;
        this.menu.querySelector<HTMLSelectElement>('#reader-appearance')!.value = snapshot.themePreference;
    }

    updateLabels(): void {
        const labels = this.labels();
        for (const [key, name] of this.names) name.textContent = labels[key];
        for (const { trigger, label } of this.categories.values()) {
            trigger.dataset.readerTooltip = labels[label]; trigger.setAttribute('aria-label', labels[label]);
        }
        for (const [key, name] of this.names) {
            if (name.parentElement?.matches('button')) name.parentElement.setAttribute('aria-label', labels[key]);
        }
        this.menu.querySelector('.reader-type-control')?.setAttribute('aria-label', labels.fontSize);
        this.menu.querySelectorAll<HTMLElement>('[data-preference-label]').forEach(element => {
            const value = labels[element.dataset.preferenceLabel as keyof ReaderToolbarMenuLabels];
            if (element.tagName.toLowerCase() === 'select') element.setAttribute('aria-label', value);
            else element.textContent = value;
        });
    }

    anchorFor(action: HTMLElement): HTMLElement {
        for (const category of this.categories.values()) if (category.group.contains(action)) return category.trigger;
        return action;
    }

    private containsTrigger(target: Node | null): boolean {
        return Array.from(this.categories.values()).some(category => category.trigger.contains(target));
    }

    private enabledItems(): Array<HTMLButtonElement | HTMLSelectElement> {
        return Array.from(this.active?.group.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select') || []).filter(item => !item.disabled);
    }

    private focus(item: HTMLButtonElement | HTMLSelectElement | undefined): void {
        this.menu.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select').forEach(control => control.tabIndex = control === item || control.tagName.toLowerCase() === 'select' && !control.closest<HTMLElement>('.reader-menu-group')?.hidden ? 0 : -1);
        (item || this.menu).focus({ preventScroll: true }); item?.scrollIntoView({ block: 'nearest' });
    }

    refreshFocus(): void {
        if (!this.active || !this.menu.contains(document.activeElement)) return;
        const active = document.activeElement as HTMLButtonElement;
        if (active.disabled) {
            const fontPeer = active.dataset.fontSize && this.active.group.querySelector<HTMLButtonElement>(`[data-font-size="${active.dataset.fontSize === '1' ? '-1' : '1'}"]`);
            this.focus(fontPeer && !fontPeer.disabled ? fontPeer : this.enabledItems().at(-1));
        }
    }

    private open(category: CategoryMenu | undefined, last = false): void {
        if (!category) return;
        if (category !== this.active) { this.close(); this.beforeOpen(); }
        this.active = category; this.menu.hidden = false; category.group.hidden = false;
        this.menu.setAttribute('aria-labelledby', category.trigger.id);
        category.trigger.setAttribute('aria-expanded', 'true'); category.trigger.classList.add('is-active');
        this.reposition();
        const items = this.enabledItems(); this.focus(last ? items.at(-1) : items[0]);
    }

    private reposition(): void {
        if (!this.active) return;
        this.menu.style.maxHeight = Math.max(0, window.innerHeight - 24) + 'px';
        positionReaderPopover(this.menu, this.active.trigger.getBoundingClientRect(), { maxWidth: 280, gap: 8 });
    }

    close(restoreFocus = false): void {
        const category = this.active;
        if (!category) return;
        this.active = undefined; this.menu.hidden = true; category.group.hidden = true;
        category.trigger.setAttribute('aria-expanded', 'false'); category.trigger.classList.remove('is-active');
        this.menu.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select').forEach(control => control.tabIndex = -1);
        if (restoreFocus && category.trigger.isConnected) category.trigger.focus({ preventScroll: true });
    }

    dispose(): void {
        this.close();
        for (const category of this.categories.values()) {
            category.trigger.removeEventListener('click', this.onTriggerClick);
            category.trigger.removeEventListener('keydown', this.onTriggerKeyDown);
        }
        this.menu.removeEventListener('click', this.onAction, true);
        this.menu.removeEventListener('focusout', this.onFocusOut);
        document.removeEventListener('pointerdown', this.onPointerDown, true);
        document.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('resize', this.onViewportChange);
        window.removeEventListener('scroll', this.onViewportChange, true);
        this.menu.remove();
    }
}
