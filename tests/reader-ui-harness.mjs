import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await fs.readFile(new URL('../src/reader/web/reader-ui-labels.ts', import.meta.url), 'utf8');
export const readerUiLabels = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: readerUiLabels });

/** Match browser text-node identity so relabeling tests cannot pass by rebuilding controls. */
export function installReaderTextNodes(Element) {
    const setAttribute = Element.prototype.setAttribute, removeAttribute = Element.prototype.removeAttribute;
    Element.prototype.setAttribute = function (name, value) {
        setAttribute.call(this, name, value);
        if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    };
    if (removeAttribute) Element.prototype.removeAttribute = function (name) {
        removeAttribute.call(this, name);
        if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
    };
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'textContent');
    Object.defineProperty(Element.prototype, 'textContent', { ...original,
        set(value) {
            if (this.nodeType === 3) { this._text = String(value); return; }
            original.set.call(this, '');
            if (String(value)) {
                const text = new Element('#text', this.document || this.ownerDocument);
                text.nodeType = 3; text._text = String(value); this.append(text);
            }
        }
    });
    if (!Object.getOwnPropertyDescriptor(Element.prototype, 'childNodes')) Object.defineProperty(Element.prototype, 'childNodes', { get() { return this.children; } });
    if (!Object.getOwnPropertyDescriptor(Element.prototype, 'parentElement')) Object.defineProperty(Element.prototype, 'parentElement', { get() { return this.parent; } });
    const matches = Element.prototype.matches;
    Element.prototype.matches = function (selector) { return this.nodeType !== 3 && matches.call(this, selector); };
}
