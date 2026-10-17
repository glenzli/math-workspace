/** Product text owns a resolver; manuscript text and input values are never registered. */
const bindings = new WeakMap<Node, Map<string, () => void>>();

function bind(node: Node, key: string, update: () => void): void {
    let entries = bindings.get(node);
    if (!entries) { entries = new Map(); bindings.set(node, entries); }
    entries.set(key, update);
}

export function readerAttribute(element: Element | null | undefined, name: string, value: () => string): void {
    if (!element) return;
    const update = () => element.setAttribute(name, value());
    bind(element, name, update); update();
}

export function readerText<T extends Element>(element: T, value: () => string): T {
    element.textContent = value();
    return readerLabel(element, value);
}

/** Register only the supplied label, retaining controls, listeners, focus and selections. */
export function readerLabel<T extends Element>(element: T, value: () => string): T {
    const initial = value();
    const textRoot = /^(INPUT|SELECT|TEXTAREA)$/i.test(element.tagName) && element.parentElement?.tagName.toLowerCase() === 'label'
        ? element.parentElement : element;
    const findText = (node: Node): Node | undefined => {
        if (node.nodeType === 3 && node.textContent === initial) return node;
        for (const child of Array.from(node.childNodes)) { const match = findText(child); if (match) return match; }
        return undefined;
    };
    const text = initial ? findText(textRoot) : undefined;
    if (text) bind(text, 'text', () => { text.textContent = value(); });
    for (const name of ['aria-label', 'title', 'data-tooltip', 'data-reader-tooltip', 'data-reader-action-label', 'placeholder']) {
        if (element.getAttribute(name) === initial) readerAttribute(element, name, value);
    }
    return element;
}

export function refreshReaderLabels(root: Node): void {
    bindings.get(root)?.forEach(update => update());
    for (const child of Array.from(root.childNodes)) refreshReaderLabels(child);
}

/** A transient action status restores the original live label, including after a locale change. */
export function readerTemporaryLabel(element: HTMLElement, value: () => string): () => void {
    const previous = ['aria-label', 'data-tooltip'].map(name => ({ name,
        update: bindings.get(element)?.get(name), value: element.getAttribute(name) }));
    for (const { name } of previous) readerAttribute(element, name, value);
    return () => {
        for (const entry of previous) {
            if (entry.update) { bind(element, entry.name, entry.update); entry.update(); }
            else {
                bindings.get(element)?.delete(entry.name);
                if (entry.value === null) element.removeAttribute(entry.name); else element.setAttribute(entry.name, entry.value);
            }
        }
    };
}

/** Captured label dictionaries keep reading the current locale inside event callbacks. */
export function readerWords<T extends object>(value: () => T): T {
    return new Proxy({} as T, { get: (_target, key) => Reflect.get(value(), key) });
}

export function readerIconDescription(button: HTMLElement, label: () => string, reason: () => string = () => ''): void {
    const description = () => reason() ? `${label()} · ${reason()}` : label();
    readerAttribute(button, 'data-reader-action-label', label);
    for (const name of ['title', 'aria-label', button.dataset.tooltip !== undefined ? 'data-tooltip' : 'data-reader-tooltip']) {
        readerAttribute(button, name, description);
    }
}
