/**
 * A viewport-level tooltip for small reader affordances that may live inside
 * independently scrolling regions such as the page navigation.
 */
export class ReaderTooltip {
    private readonly element = document.createElement('div');
    private active: HTMLElement | undefined;
    private root: HTMLElement | undefined;
    private observer: MutationObserver | undefined;
    private observed: HTMLElement[] = [];
    private readonly onPointerOver = (event: PointerEvent) => {
        const trigger = this.findTrigger(event.target);
        if (trigger) this.show(trigger);
        else this.hide();
    };
    private readonly onPointerOut = (event: PointerEvent) => {
        const trigger = this.findTrigger(event.target);
        if (!trigger) return;
        const related = event.relatedTarget;
        if (!(related instanceof Node) || !trigger.contains(related)) this.hide(trigger);
    };
    private readonly onFocusIn = (event: FocusEvent) => {
        const trigger = this.findTrigger(event.target);
        if (trigger) this.show(trigger);
        else this.hide();
    };
    private readonly onFocusOut = (event: FocusEvent) => {
        const trigger = this.findTrigger(event.target);
        if (trigger) this.hide(trigger);
    };
    private readonly onViewportChange = () => this.reposition();

    constructor() {
        this.element.className = 'reader-global-tooltip';
        this.element.setAttribute('role', 'tooltip');
        this.element.hidden = true;
        document.body.append(this.element);
        window.addEventListener('resize', this.onViewportChange);
        window.addEventListener('scroll', this.onViewportChange, true);
    }

    bind(root: HTMLElement): void {
        this.root = root;
        root.addEventListener('pointerover', this.onPointerOver);
        root.addEventListener('pointerout', this.onPointerOut);
        root.addEventListener('focusin', this.onFocusIn);
        root.addEventListener('focusout', this.onFocusOut);
    }

    dispose(): void {
        this.hide();
        this.root?.removeEventListener('pointerover', this.onPointerOver);
        this.root?.removeEventListener('pointerout', this.onPointerOut);
        this.root?.removeEventListener('focusin', this.onFocusIn);
        this.root?.removeEventListener('focusout', this.onFocusOut);
        window.removeEventListener('resize', this.onViewportChange);
        window.removeEventListener('scroll', this.onViewportChange, true);
        this.element.remove();
    }

    private findTrigger(target: EventTarget | null): HTMLElement | undefined {
        if (!(target instanceof Element)) return undefined;
        const trigger = target.closest<HTMLElement>('[data-reader-tooltip]');
        return trigger && this.root?.contains(trigger) ? trigger : undefined;
    }

    private show(trigger: HTMLElement): void {
        const text = trigger.dataset.readerTooltip;
        if (!text || !this.visible(trigger)) { this.hide(); return; }
        this.active = trigger;
        this.element.textContent = text;
        this.element.hidden = false;
        this.element.classList.add('is-visible');
        this.reposition();
    }

    private hide(trigger = this.active): void {
        if (this.active !== trigger) return;
        this.active = undefined;
        this.observer?.disconnect(); this.observed = [];
        this.element.classList.remove('is-visible');
        this.element.hidden = true;
    }

    private visible(trigger: HTMLElement): boolean {
        if (!trigger.isConnected || !this.root?.contains(trigger)) return false;
        for (let ancestor: HTMLElement | null = trigger; ancestor; ancestor = ancestor.parentElement) {
            if (ancestor.hidden || ancestor.style.display === 'none') return false;
            if (ancestor === this.root) break;
        }
        const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(trigger) : trigger.style;
        if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none') return false;
        return typeof trigger.getClientRects !== 'function' || trigger.getClientRects().length > 0;
    }

    /** Watch only the active branch; editor token changes below sibling nodes are irrelevant. */
    private observeActive(): void {
        if (!this.active || typeof MutationObserver === 'undefined') return;
        const ancestors: HTMLElement[] = [];
        for (let ancestor: HTMLElement | null = this.active; ancestor; ancestor = ancestor.parentElement) {
            ancestors.push(ancestor); if (ancestor === this.root) break;
        }
        if (ancestors.length === this.observed.length && ancestors.every((ancestor, index) => ancestor === this.observed[index])) return;
        this.observer ??= new MutationObserver(() => this.reposition());
        this.observer.disconnect(); this.observed = ancestors;
        for (const ancestor of ancestors) this.observer.observe(ancestor, {
            childList: true, attributes: true, subtree: false, attributeFilter: ['hidden', 'class', 'style', 'data-reader-tooltip']
        });
    }

    private reposition(): void {
        if (!this.active || this.element.hidden) return;
        const text = this.active.dataset.readerTooltip;
        if (!text || !this.visible(this.active)) { this.hide(); return; }
        if (this.element.textContent !== text) this.element.textContent = text;
        this.observeActive();
        const trigger = this.active.getBoundingClientRect();
        const tooltip = this.element.getBoundingClientRect();
        const padding = 12;
        const gap = 9;
        const right = trigger.right + gap;
        const left = right + tooltip.width <= window.innerWidth - padding
            ? right
            : Math.max(padding, trigger.left - tooltip.width - gap);
        const top = Math.max(
            padding,
            Math.min(window.innerHeight - tooltip.height - padding, trigger.top + trigger.height / 2 - tooltip.height / 2)
        );
        this.element.style.left = Math.round(left) + 'px';
        this.element.style.top = Math.round(top) + 'px';
    }
}
