import type { LeanPosition, LeanRange } from '../../lean/lean-language';

/** Display offsets use normalized line endings; LSP line/UTF-16 columns do not change. */
export function normalizeLeanSource(content: string): string { return content.replace(/\r\n?|\n/g, '\n'); }

export function leanPositionOffset(content: string, position: LeanPosition): number {
    const lines = normalizeLeanSource(content).split('\n');
    const line = Math.min(lines.length - 1, Math.max(0, Math.trunc(position.line)));
    let offset = 0;
    for (let index = 0; index < line; index++) offset += lines[index].length + 1;
    return offset + Math.min(lines[line].length, Math.max(0, Math.trunc(position.character)));
}

export function leanOffsetPosition(content: string, requested: number): LeanPosition {
    const text = normalizeLeanSource(content), offset = Math.max(0, Math.min(text.length, requested));
    let line = 0, start = 0;
    for (let next = text.indexOf('\n'); next >= 0 && next < offset; next = text.indexOf('\n', start)) {
        line++; start = next + 1;
    }
    return { line, character: offset - start };
}

export function leanFindRanges(content: string, query: string, matchCase = false): LeanRange[] {
    if (!query) return [];
    const text = normalizeLeanSource(content), expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
    return Array.from(text.matchAll(expression), match => ({ start: leanOffsetPosition(text, match.index!), end: leanOffsetPosition(text, match.index! + match[0].length) }));
}

export interface LeanSyntaxSpan { from: number; to: number; className: string; scopes: string[] }
export interface LeanFoldRange { from: number; to: number; kind: 'section' | 'declaration' | 'comment' }

/** Conservative display folds. Strings/comments come from the bundled TextMate grammar. */
export function leanFoldRanges(content: string, syntax: LeanSyntaxSpan[]): LeanFoldRange[] {
    const text = normalizeLeanSource(content), characters = text.split(''), folds: LeanFoldRange[] = [];
    for (const span of syntax) if (span.scopes.some(scope => /^(comment|string)/.test(scope))) {
        for (let index = span.from; index < span.to; index++) if (characters[index] !== '\n') characters[index] = ' ';
    }
    const masked = characters.join(''), lines = masked.split('\n');
    const starts: number[] = []; let offset = 0;
    lines.forEach(line => { starts.push(offset); offset += line.length + 1; });
    const sections: Array<{ line: number; indentation: number }> = [];
    const commands: Array<{ line: number; indentation: number }> = [];
    for (const [line, value] of lines.entries()) {
        const indentation = value.match(/^\s*/)?.[0].length || 0;
        if (/^\s*(namespace|section|mutual)\b/.test(value)) sections.push({ line, indentation });
        if (/^\s*end(?:\s|$)/.test(value)) {
            const section = sections.pop();
            if (section && line > section.line + 1) folds.push({ from: starts[section.line] + lines[section.line].length, to: starts[line], kind: 'section' });
        }
        if (/^\s*(?:(?:private|protected|noncomputable|unsafe|partial|local|scoped)\s+)*(theorem|lemma|def|example|instance|abbrev|opaque|structure|class|inductive|namespace|section|end)\b/.test(value)) commands.push({ line, indentation });
    }
    for (let index = 0; index < commands.length; index++) {
        const command = commands[index];
        if (/^\s*(namespace|section|end)\b/.test(lines[command.line])) continue;
        const next = commands.slice(index + 1).find(candidate => candidate.indentation <= command.indentation);
        let endLine = (next?.line ?? lines.length) - 1;
        while (endLine > command.line && !lines[endLine].trim()) endLine--;
        if (endLine > command.line) folds.push({ from: starts[command.line] + lines[command.line].length, to: starts[endLine] + lines[endLine].length, kind: 'declaration' });
    }
    // Contiguous block-comment spans include newlines, but separate adjacent comments stay separate.
    const comments = syntax.filter(span => span.scopes.some(scope => scope.startsWith('comment.block')));
    let run: { from: number; to: number } | undefined;
    const flush = () => {
        if (!run) return;
        const first = leanOffsetPosition(text, run.from), last = leanOffsetPosition(text, run.to);
        if (last.line > first.line) folds.push({ from: starts[first.line] + lines[first.line].length, to: run.to, kind: 'comment' });
        run = undefined;
    };
    for (const span of comments) {
        if (run && /^\s*$/.test(text.slice(run.to, span.from)) && !text.slice(run.to, span.from).includes('-/')) run.to = span.to;
        else { flush(); run = { from: span.from, to: span.to }; }
        if (span.scopes.filter(scope => scope.startsWith('comment.block')).length === 1 && text.slice(span.from, span.to).endsWith('-/')) flush();
    }
    flush();
    return folds.sort((a, b) => a.from - b.from || b.to - a.to);
}

export function leanRangeText(content: string, range: LeanRange): string {
    const text = normalizeLeanSource(content);
    return text.slice(leanPositionOffset(text, range.start), leanPositionOffset(text, range.end));
}
