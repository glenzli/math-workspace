import type { ReaderFormula } from './formal-renderer';

export interface ReaderReferenceLocation {
    filePath: string;
    startLine: number;
    endLine: number;
    formalId?: string;
    formulaId?: string;
}

/** Restore Markdown and complete LaTeX from a rendered text selection. */
export function selectedReaderMarkdown(range: Range, formulas: ReaderFormula[], source: string): string | undefined {
    const formulaSource = new Map(formulas.map(formula => [formula.id, formula.source]));
    const read = (node: Node): string => {
        if (node.nodeType === 3) return node.textContent ?? '';
        if (node.nodeType !== 1 && node.nodeType !== 11) return '';
        const element = node.nodeType === 1 ? node as HTMLElement : undefined;
        if (element?.dataset.readerFormula) return formulaSource.get(element.dataset.readerFormula) ?? '';
        if (element?.dataset.formalRef) return `@${element.dataset.formalRef}`;
        const content = Array.from(node.childNodes).map(read).join('');
        switch (element?.tagName.toLowerCase()) {
            case 'strong': case 'b': return `**${content}**`;
            case 'em': case 'i': return `*${content}*`;
            case 'del': case 's': case 'strike': return `~~${content}~~`;
            case 'code': return `\`${content}\``;
            case 'br': return '\n';
            default: return content;
        }
    };
    const selection = read(range.cloneContents()).trim();
    if (!selection) return undefined;
    const wrapped = [`**${selection}**`, `__${selection}__`, `*${selection}*`, `_${selection}_`, `\`${selection}\``]
        .find(candidate => source.includes(candidate));
    if (wrapped) return wrapped;
    const linkStart = source.indexOf(`[${selection}](`);
    if (linkStart >= 0) {
        const end = source.indexOf(')', linkStart + selection.length + 3);
        if (end >= 0) return source.slice(linkStart, end + 1);
    }
    return source.includes(selection) ? selection : undefined;
}

export interface ReaderReferenceContent {
    type: 'resource';
    resource: { uri: string; mimeType: 'text/markdown'; text: string };
}

/** Freeze the selected source as an inline attachment, including its original location. */
export function readerReference(document: { source: string; projectRoot: string; title: string },
    location: ReaderReferenceLocation, selectedMarkdown?: string): ReaderReferenceContent {
    const lines = document.source.split(/\r?\n/);
    if (!Number.isInteger(location.startLine) || !Number.isInteger(location.endLine)
        || location.startLine < 1 || location.endLine < location.startLine || location.endLine > lines.length) {
        throw new Error('The reference source range is unavailable.');
    }
    if (!location.filePath || /^(?:\/|[A-Za-z]:)/.test(location.filePath)
        || location.filePath.split(/[\\/]/).some(part => part === '..')) {
        throw new Error('The reference must belong to the current project.');
    }
    const source = selectedMarkdown ?? lines.slice(location.startLine - 1, location.endLine).join('\n');
    if (!source.trim()) throw new Error('The reference cannot be empty.');
    if (!/^(?:\/|[A-Za-z]:[\\/])/.test(document.projectRoot)) {
        throw new Error('The reference project is unavailable.');
    }
    const path = document.projectRoot.replaceAll('\\', '/').replace(/\/$/, '') + '/' + location.filePath.replaceAll('\\', '/');
    const uri = new URL('file:///');
    uri.pathname = path;
    uri.hash = `L${location.startLine}-L${location.endLine}`;
    const identity = location.formalId || location.formulaId;
    return { type: 'resource', resource: { uri: uri.href, mimeType: 'text/markdown', text:
        `${document.title}\n\nSource: ${path}:${location.startLine}-${location.endLine}`
        + (identity ? `\nObject: ${identity}` : '') + '\n\n' + source } };
}
