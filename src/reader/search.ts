import { maskFencedMarkdown } from '../../packages/core/src/markdown-fence';

export interface ReaderSearchHit {
    filePath: string;
    title: string;
    startLine: number;
    endLine: number;
    kind: 'text' | 'formula';
    match: 'exact' | 'notation' | 'fuzzy';
    excerpt: string;
    latex?: string;
    score: number;
}
export interface ReaderSearchResult { query: string; hits: ReaderSearchHit[]; truncated: boolean }
interface Formula { latex: string; startLine: number; endLine: number }
const symbols: Record<string, string> = {
    'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ϵ': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ϑ': 'theta',
    'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'ς': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'ϕ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
    'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'Λ': 'Lambda', 'Ξ': 'Xi', 'Π': 'Pi', 'Σ': 'Sigma', 'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega',
    '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~=', '≃': '~=', '≡': '===', '→': '->', '⇒': '=>', '↔': '<->', '⇔': '<=>', '∞': 'infty',
    '∈': 'in', '∉': 'notin', '⊂': 'subset', '⊆': 'subseteq', '∪': 'cup', '∩': 'cap', '∅': 'emptyset', '∀': 'forall', '∃': 'exists', '∫': 'int', '∑': 'sum', '∏': 'prod', '∂': 'partial', '∇': 'nabla', '√': 'sqrt', '×': '*', '·': '*', '−': '-',
    'ℝ': 'R', 'ℕ': 'N', 'ℤ': 'Z', 'ℚ': 'Q', 'ℂ': 'C'
};
const aliases: Record<string, string> = {
    le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=', ne: '!=', neq: '!=', approx: '~=', simeq: '~=', equiv: '===',
    to: '->', rightarrow: '->', longrightarrow: '->', implies: '=>', Rightarrow: '=>', iff: '<=>', Leftrightarrow: '<=>', leftrightarrow: '<->',
    cdot: '*', times: '*', varnothing: 'emptyset', varepsilon: 'epsilon', vartheta: 'theta', varphi: 'phi',
    left: '', right: '', big: '', Big: '', bigl: '', bigr: '', Bigl: '', Bigr: '', displaystyle: '', textstyle: '', limits: '', nolimits: '',
    quad: '', qquad: '', mathrm: '', mathbf: '', mathit: '', mathsf: '', mathtt: '', mathbb: '', mathcal: '', boldsymbol: '', operatorname: '', text: ''
};
const powers: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n', 'ⁱ': 'i', '⁺': '+', '⁻': '-' };
const subscripts: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', 'ₙ': 'n', 'ᵢ': 'i', 'ₖ': 'k', 'ₓ': 'x' };

function fractions(source: string, depth = 0): string {
    if (depth > 8) return source;
    const group = (start: number): { value: string; end: number } | undefined => {
        while (start < source.length && /\s/.test(source[start])) start++;
        if (source[start] !== '{') return;
        let nesting = 1;
        for (let cursor = start + 1; cursor < source.length; cursor++) {
            if (source[cursor] === '\\') { cursor++; continue; }
            if (source[cursor] === '{') nesting++;
            if (source[cursor] === '}' && --nesting === 0) return { value: source.slice(start + 1, cursor), end: cursor + 1 };
        }
    };
    const pattern = /\\(?:dfrac|tfrac|frac)\b/g;
    let result = '', last = 0, match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
        const numerator = group(pattern.lastIndex), denominator = numerator && group(numerator.end);
        if (!numerator || !denominator) continue;
        result += source.slice(last, match.index) + '(' + fractions(numerator.value, depth + 1) + ')/(' + fractions(denominator.value, depth + 1) + ')';
        last = denominator.end; pattern.lastIndex = last;
    }
    return result + source.slice(last);
}

/** Retrieval keys only: similar notation is never evidence of mathematical equivalence. */
function formulaKey(source: string): string {
    return fractions(source).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿⁱ⁺⁻]+/g, value => '^' + [...value].map(char => powers[char]).join(''))
        .replace(/[₀₁₂₃₄₅₆₇₈₉ₙᵢₖₓ]+/g, value => '_' + [...value].map(char => subscripts[char]).join(''))
        .replace(/[α-ωΑ-Ωϵϑϕς≤≥≠≈≃≡→⇒↔⇔∞∈∉⊂⊆∪∩∅∀∃∫∑∏∂∇√×·−ℝℕℤℚℂ]/g, value => symbols[value] || value)
        .normalize('NFKC').replace(/\\(?:dfrac|tfrac)/g, '\\frac')
        .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
        .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, '')
        .replace(/\\([A-Za-z]+)/g, (_whole, name) => aliases[name] ?? name)
        .replace(/\\[!,;:\s]/g, '').replace(/\\[()[\]]/g, '').replace(/[\s{}$&]/g, '').replace(/\\\\/g, '');
}
const looseKey = (value: string) => value.replace(/[()^_]/g, '');
const textKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function formulas(content: string): Formula[] {
    const masked = maskFencedMarkdown(content).replace(/(`+)[^\n]*?\1/g, value => value.replace(/[^\n]/g, ' '));
    const result: Formula[] = [];
    let cursor = 0, line = 1;
    const escaped = (at: number) => { let count = 0; while (at > 0 && masked[--at] === '\\') count++; return count % 2 === 1; };
    while (cursor < masked.length) {
        if (masked[cursor] === '\n') { line++; cursor++; continue; }
        let open = '', close = '';
        if (!escaped(cursor)) {
            if (masked.startsWith('$$', cursor)) open = close = '$$';
            else if (masked.startsWith('\\[', cursor)) { open = '\\['; close = '\\]'; }
            else if (masked.startsWith('\\(', cursor)) { open = '\\('; close = '\\)'; }
            else if (masked[cursor] === '$' && !/\s/.test(masked[cursor + 1] || ' ')) open = close = '$';
        }
        if (!open) { cursor++; continue; }
        let end = masked.indexOf(close, cursor + open.length);
        while (end >= 0 && escaped(end)) end = masked.indexOf(close, end + close.length);
        if (end < 0 || close === '$' && /\n|\s$/.test(masked.slice(cursor + open.length, end))) { cursor += open.length; continue; }
        const whole = masked.slice(cursor, end + close.length), endLine = line + (whole.match(/\n/g) || []).length;
        const latex = content.slice(cursor + open.length, end).trim();
        if (latex) result.push({ latex, startLine: line, endLine });
        line = endLine; cursor = end + close.length;
    }
    return result;
}

/** Bounded edit distance against a substring; operators retain their identity during typo matching. */
function nearby(query: string, source: string, budget: number, protectOperators = false): number | undefined {
    if (query.length < 5 || source.length > 1600) return;
    const protectedChar = (value: string) => protectOperators && /[+\-*/=<>!]/.test(value);
    let previous = new Array(source.length + 1).fill(0), beforePrevious: number[] | undefined;
    for (let row = 1; row <= query.length; row++) {
        const current = [row];
        for (let column = 1; column <= source.length; column++) {
            const a = query[row - 1], b = source[column - 1];
            current[column] = Math.min(previous[column] + (protectedChar(a) ? budget + 1 : 1), current[column - 1] + (protectedChar(b) ? budget + 1 : 1), previous[column - 1] + (a === b ? 0 : protectedChar(a) || protectedChar(b) ? budget + 1 : 1));
            if (beforePrevious && column > 1 && a === source[column - 2] && query[row - 2] === b && !protectedChar(a) && !protectedChar(b)) current[column] = Math.min(current[column], beforePrevious[column - 2] + 1);
        }
        beforePrevious = previous; previous = current;
    }
    const distance = Math.min(...previous);
    return distance <= budget ? distance : undefined;
}

export function searchReaderDocuments(documents: Map<string, string>, pages: Array<{ filePath: string; title: string }>, input: string, mode: 'all' | 'formula' = 'all', limit = 60): ReaderSearchResult {
    const query = input.trim().slice(0, 240), result: ReaderSearchResult = { query, hits: [], truncated: false };
    if (!query) return result;
    const literal = textKey(query), terms = literal.split(' '), math = formulaKey(query), looseMath = looseKey(math);
    const hits: ReaderSearchHit[] = [];
    for (const page of pages) {
        const content = documents.get(page.filePath); if (content === undefined) continue;
        const fileHits: ReaderSearchHit[] = [];
        if (math && !/[\u3400-\u9fff]/.test(math)) {
            for (const formula of formulas(content)) {
                const key = formulaKey(formula.latex), loose = looseKey(key);
                const exact = formula.latex.includes(query), notation = key.includes(math) || looseMath.length >= 2 && loose.includes(looseMath);
                const distance = exact || notation ? undefined : nearby(looseMath, loose, Math.min(3, Math.max(1, Math.floor(looseMath.length * .15))), true);
                if (!exact && !notation && distance === undefined) continue;
                fileHits.push({ filePath: page.filePath, title: page.title, ...formula, kind: 'formula', match: exact ? 'exact' : notation ? 'notation' : 'fuzzy', excerpt: formula.latex.slice(0, 1200), latex: formula.latex.length <= 8000 ? formula.latex : undefined, score: exact ? 120 : notation ? 112 : 95 - distance! });
            }
        }
        if (mode === 'all') {
            const lines = content.split(/\r?\n/);
            for (let start = 0; start < lines.length;) {
                if (!lines[start].trim()) { start++; continue; }
                let end = start + 1;
                while (end < lines.length && lines[end].trim()) end++;
                const body = lines.slice(start, end).join('\n'), key = textKey(body);
                const exact = terms.every(term => key.includes(term));
                const fuzzy = !exact && terms.length === 1 && /^[a-z]{5,40}$/.test(literal) && key.split(/[^a-z]+/).some(word => word.length >= literal.length - 1 && word.length <= literal.length + 1 && nearby(literal, word, 1) !== undefined);
                if ((exact || fuzzy) && !fileHits.some(hit => hit.startLine >= start + 1 && hit.endLine <= end)) {
                    const position = exact ? Math.max(0, key.indexOf(terms[0])) : 0;
                    const excerpt = body.slice(Math.max(0, position - 80), Math.max(0, position - 80) + 420);
                    fileHits.push({ filePath: page.filePath, title: page.title, startLine: start + 1, endLine: end, kind: 'text', match: exact ? 'exact' : 'fuzzy', excerpt, score: (exact ? 100 : 75) + (start === 0 ? 5 : 0) });
                }
                start = end;
            }
        }
        hits.push(...fileHits);
    }
    const order = new Map(pages.map((page, index) => [page.filePath, index]));
    hits.sort((a, b) => b.score - a.score || order.get(a.filePath)! - order.get(b.filePath)! || a.startLine - b.startLine);
    result.hits = hits.slice(0, Math.max(1, Math.min(100, limit))); result.truncated = hits.length > result.hits.length;
    return result;
}
