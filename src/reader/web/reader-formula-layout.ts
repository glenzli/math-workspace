import type { ReaderFormula } from './formal-renderer';
import { renderReflowedFormula } from './reader-formula-reflow';

type FormulaLanguage = 'zh' | 'en';

const labels = {
    zh: {
        overflow: '公式超出可用宽度，可横向滚动查看完整内容；按回车打开公式操作',
        adapting: '正在调整公式排版…',
        adapted: '公式已适应当前宽度。',
        restored: '已恢复原公式排版。',
        failed: '当前公式无法自动适应，请横向滚动查看完整内容。'
    },
    en: {
        overflow: 'Formula exceeds the available width. Scroll horizontally to read it in full. Press Enter for formula actions.',
        adapting: 'Adapting formula…',
        adapted: 'The formula now fits the available width.',
        restored: 'Original formula layout restored.',
        failed: 'This formula could not be adapted. Scroll horizontally to read it in full.'
    }
};

export interface ReaderFormulaLayoutOptions {
    formulas?: readonly ReaderFormula[];
    request?: (route: string, options?: RequestInit) => Promise<Response>;
    report?: (message: string) => void;
}

export interface ReaderFormulaLayout {
    dispose(): void;
    invalidate(): void;
    canAdapt(formula: ReaderFormula): boolean;
    isAdapted(formula: ReaderFormula): boolean;
    toggle(formula: ReaderFormula): Promise<void>;
}

interface FormulaLayoutState {
    element: HTMLElement;
    attributes: Map<string, string | null>;
    overflowing: boolean;
    formula?: ReaderFormula;
    requested: boolean;
    generation: number;
    pending?: AbortController;
    adapted?: HTMLElement;
    layoutKey?: string;
}

function containingBlock(element: HTMLElement, container: HTMLElement): HTMLElement {
    let parent = element.parentElement;
    while (parent && parent !== container) {
        const display = getComputedStyle(parent).display;
        if (display !== 'inline' && display !== 'contents') return parent;
        parent = parent.parentElement;
    }
    return parent || container;
}

function contentWidth(element: HTMLElement): number {
    const style = getComputedStyle(element);
    return Math.max(0, element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
}

/** Own only preview geometry and its listeners; formula/source identity stays with the renderer. */
export function mountReaderFormulaLayout(container: HTMLElement, language: FormulaLanguage,
    options: ReaderFormulaLayoutOptions = {}): ReaderFormulaLayout {
    let disposed = false;
    let frame = 0;
    let rescan = true;
    const states = new Map<HTMLElement, FormulaLayoutState>();
    const formulas = new Map(options.formulas?.map(formula => [formula.id, formula]));
    const attributeNames = ['tabindex', 'role', 'aria-label'];
    const restoreAttributes = (state: FormulaLayoutState) => {
        for (const [name, value] of state.attributes) {
            if (value === null) state.element.removeAttribute(name);
            else state.element.setAttribute(name, value);
        }
    };
    const setOverflow = (state: FormulaLayoutState, overflowing: boolean) => {
        state.element.classList.toggle('is-overflowing', overflowing);
        if (overflowing) {
            if (state.attributes.get('tabindex') === null) state.element.setAttribute('tabindex', '0');
            if (state.attributes.get('role') === null) state.element.setAttribute('role', 'group');
            if (state.attributes.get('aria-label') === null) state.element.setAttribute('aria-label', labels[language].overflow);
        } else if (state.overflowing) {
            restoreAttributes(state);
            state.element.scrollLeft = 0;
        }
        state.overflowing = overflowing;
    };
    const cancel = (state: FormulaLayoutState) => {
        state.generation++;
        state.pending?.abort(); state.pending = undefined;
    };
    const showOriginal = (state: FormulaLayoutState) => {
        state.adapted?.remove(); state.adapted = undefined;
        state.element.classList.remove('is-adapted');
    };
    const reset = (state: FormulaLayoutState) => {
        cancel(state); state.requested = false; state.layoutKey = undefined; showOriginal(state);
    };
    const current = (state: FormulaLayoutState) => !disposed && container.isConnected
        && states.get(state.element) === state && container.contains(state.element)
        && state.element.dataset.readerFormula === state.formula?.id;
    const geometry = (state: FormulaLayoutState) => {
        const width = contentWidth(containingBlock(state.element, container));
        const chunks = [...state.element.querySelectorAll<HTMLElement>('.katex-html > .base')];
        const widths = chunks.map(chunk => chunk.getBoundingClientRect().width);
        const math = state.element.querySelector<HTMLElement>('.katex') || state.element;
        const style = getComputedStyle(math);
        const fontSize = parseFloat(style.fontSize) || 16;
        const tag = state.element.querySelector<HTMLElement>('.katex-html > .tag');
        const tagSpace = tag ? tag.getBoundingClientRect().width + fontSize : 0;
        const widest = tag ? widths.reduce((sum, value) => sum + value, 0) + tagSpace : Math.max(0, ...widths);
        return { width, widest, tagSpace, fallbackWidth: widest + tagSpace, fontSize,
            key: [Math.round(width * 10), Math.round(widest * 10), fontSize, style.fontFamily].join(':') };
    };
    const adapt = async (state: FormulaLayoutState, size: ReturnType<typeof geometry>) => {
        if (!options.request || !state.formula || !current(state)) return;
        cancel(state); showOriginal(state);
        state.layoutKey = size.key;
        const generation = state.generation;
        const pending = new AbortController(); state.pending = pending;
        const valid = () => current(state) && state.requested && state.generation === generation && !pending.signal.aborted;
        options.report?.(labels[language].adapting);
        let candidate: HTMLElement | undefined;
        try {
            const result = await renderReflowedFormula({ latex: state.formula.latex, widthPx: size.width,
                fontSizePx: size.fontSize, request: options.request, signal: pending.signal });
            candidate = result.element;
            if (!valid()) return;
            const fresh = geometry(state);
            if (fresh.key !== size.key) { state.layoutKey = undefined; queue(); return; }
            const visibility = candidate.style.visibility, position = candidate.style.position;
            candidate.style.visibility = 'hidden'; candidate.style.position = 'absolute';
            state.element.append(candidate);
            const rect = candidate.getBoundingClientRect();
            const width = Math.max(result.widthPx, rect.width, candidate.scrollWidth);
            if (!Number.isFinite(width) || width <= 0 || width > fresh.width + 1
                || !Number.isFinite(result.heightPx) || result.heightPx <= 0 || rect.height <= 0) {
                throw new Error('Reflowed formula does not fit.');
            }
            if (!valid()) return;
            candidate.style.visibility = visibility; candidate.style.position = position;
            state.adapted = candidate; candidate = undefined;
            state.element.classList.add('is-adapted');
            state.element.scrollLeft = 0;
            setOverflow(state, false);
            options.report?.(labels[language].adapted);
        } catch (_error) {
            if (!valid()) return;
            reset(state); setOverflow(state, true);
            options.report?.(labels[language].failed);
        } finally {
            candidate?.remove();
            if (state.pending === pending) state.pending = undefined;
        }
    };
    const measure = () => {
        frame = 0;
        if (disposed || !container.isConnected) return;
        if (rescan) {
            rescan = false;
            const formulas = new Set(container.querySelectorAll<HTMLElement>('[data-reader-formula]'));
            for (const [element, state] of states) {
                if (!formulas.has(element)) { reset(state); restoreAttributes(state); states.delete(element); }
            }
            resizeObserver?.disconnect();
            resizeObserver?.observe(container);
            for (const element of formulas) {
                if (!states.has(element)) states.set(element, {
                    element,
                    attributes: new Map(attributeNames.map(name => [name, element.getAttribute(name)])),
                    overflowing: false,
                    formula: options.formulas?.find(formula => formula.id === element.dataset.readerFormula),
                    requested: false,
                    generation: 0
                });
                resizeObserver?.observe(containingBlock(element, container));
            }
        }
        // Read every formula before changing layout: inline overflow becomes a bounded scroll box.
        const measurements = [...states.values()].map(state => ({ state, ...geometry(state) }));
        for (const { state, ...size } of measurements) {
            // Hidden disclosures have no useful geometry; their toggle/resize retries the measurement.
            if (size.width <= 0 || size.widest <= 0) {
                if (state.pending) { cancel(state); state.layoutKey = undefined; }
                continue;
            }
            const overflowing = size.fallbackWidth > size.width + 1;
            if (size.tagSpace) state.element.style.setProperty('--reader-formula-tag-space', size.tagSpace + 'px');
            if (state.requested && size.widest <= size.width + 1) reset(state);
            if (state.requested && state.layoutKey !== size.key) void adapt(state, size);
            setOverflow(state, overflowing && !state.adapted);
        }
    };
    const queue = () => {
        if (disposed || frame) return;
        frame = window.requestAnimationFrame(measure);
    };
    const refresh = () => {
        if (frame) window.cancelAnimationFrame(frame);
        measure();
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(queue);
    const contentObserver = new MutationObserver(records => {
        if (records.some(record => record.type === 'childList')) rescan = true;
        queue();
    });
    contentObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
    const typographyObserver = new MutationObserver(queue);
    for (let ancestor: HTMLElement | null = container; ancestor; ancestor = ancestor.parentElement) {
        typographyObserver.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    window.addEventListener('resize', queue);
    container.addEventListener('toggle', queue, true);
    const fonts = container.ownerDocument.fonts;
    fonts?.addEventListener('loadingdone', queue);
    void fonts?.ready.then(queue, () => {});
    measure();
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (frame) window.cancelAnimationFrame(frame);
        resizeObserver?.disconnect(); contentObserver.disconnect(); typographyObserver.disconnect();
        window.removeEventListener('resize', queue);
        container.removeEventListener('toggle', queue, true);
        fonts?.removeEventListener('loadingdone', queue);
        states.forEach(state => {
            reset(state);
            const size = geometry(state);
            if (size.width > 0 && size.widest > 0) setOverflow(state, size.fallbackWidth > size.width + 1);
            restoreAttributes(state);
        });
        // Keep the last safe geometry while a replacement page is still loading.
        states.clear();
    };
    const find = (formula: ReaderFormula) => formulas.get(formula.id) === formula
        ? [...states.values()].find(state => state.formula === formula && current(state)) : undefined;
    const eligible = (state: FormulaLayoutState) => state.formula?.display && !state.element.querySelector('.eqn-num');
    return {
        dispose,
        invalidate: () => { if (!disposed) { states.forEach(reset); refresh(); } },
        canAdapt: formula => {
            const state = find(formula);
            if (!options.request || !state || !eligible(state) || !state.overflowing || state.pending) return false;
            const size = geometry(state);
            return size.width > 0 && size.widest > size.width + 1;
        },
        isAdapted: formula => Boolean(find(formula)?.adapted),
        toggle: async formula => {
            const state = find(formula);
            if (!state) return;
            if (state.adapted || state.requested) {
                reset(state); refresh(); options.report?.(labels[language].restored);
            } else if (options.request && eligible(state) && state.overflowing) {
                const size = geometry(state);
                if (size.width > 0 && size.widest > size.width + 1) {
                    state.requested = true;
                    await adapt(state, size);
                }
            }
        }
    };
}
