import { createShikiPrimitive } from '@shikijs/primitive';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import lean from '@shikijs/langs/lean';
import { normalizeLeanSource, type LeanSyntaxSpan } from './reader-lean-source-model';

// The pinned grammar is the Lean 4 TextMate grammar from leanprover/vscode-lean4,
// distributed by Shiki. Only Lean and the JS engine are bundled; no CDN or WASM fetch.
const primitive = createShikiPrimitive({ langs: lean, themes: [], engine: createJavaScriptRegexEngine() });
const grammar = primitive.getLanguage('lean');
const cache = new Map<string, LeanSyntaxSpan[]>();

function syntaxClass(scopes: string[]): string {
    const has = (prefix: string) => scopes.some(scope => scope.startsWith(prefix));
    if (has('comment')) return 'lean-syntax-comment';
    if (has('string') || has('constant.character')) return 'lean-syntax-string';
    if (has('invalid')) return 'lean-syntax-invalid';
    if (has('storage.type')) return 'lean-syntax-type';
    if (has('keyword') || has('storage.modifier')) return 'lean-syntax-keyword';
    if (has('entity.name')) return 'lean-syntax-name';
    if (has('constant')) return 'lean-syntax-number';
    return '';
}

function remember(content: string, spans: LeanSyntaxSpan[]): LeanSyntaxSpan[] {
    if (content.length < 150000) {
        if (cache.size >= 8) cache.delete(cache.keys().next().value!);
        cache.set(content, spans);
    }
    return spans;
}

/** Stateful TextMate tokenization carries nested comments/strings across every source line. */
export function tokenizeLeanSource(content: string): LeanSyntaxSpan[] {
    const text = normalizeLeanSource(content), found = cache.get(text); if (found) return found;
    const spans: LeanSyntaxSpan[] = []; let stack = null, offset = 0;
    for (const line of text.split('\n')) {
        const result = grammar.tokenizeLine(line, stack); stack = result.ruleStack;
        for (const token of result.tokens) {
            const from = offset + Math.min(token.startIndex, line.length), to = offset + Math.min(token.endIndex, line.length);
            if (from < to) spans.push({ from, to, scopes: token.scopes, className: syntaxClass(token.scopes) });
        }
        offset += line.length + 1;
    }
    return remember(text, spans);
}

/** Yield while highlighting large files so search, source selection and close remain responsive. */
export async function tokenizeLeanSourceAsync(content: string, cancelled: () => boolean = () => false): Promise<LeanSyntaxSpan[]> {
    const text = normalizeLeanSource(content), found = cache.get(text); if (found) return found;
    const spans: LeanSyntaxSpan[] = []; let stack = null, offset = 0, count = 0;
    for (const line of text.split('\n')) {
        if (cancelled()) return [];
        const result = grammar.tokenizeLine(line, stack); stack = result.ruleStack;
        for (const token of result.tokens) {
            const from = offset + Math.min(token.startIndex, line.length), to = offset + Math.min(token.endIndex, line.length);
            if (from < to) spans.push({ from, to, scopes: token.scopes, className: syntaxClass(token.scopes) });
        }
        offset += line.length + 1;
        if (++count % 200 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return cancelled() ? [] : remember(text, spans);
}
