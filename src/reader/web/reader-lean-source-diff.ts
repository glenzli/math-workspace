import type { LeanReviewEvidence, ReviewChange, SourceSnippet } from '../../lean/lean-review';

export interface LeanDiffLine { kind: 'equal' | 'remove' | 'add'; text: string; oldLine?: number; newLine?: number; ending: string }
interface Line { text: string; ending: string; value: string }

export interface LeanReviewDiffEntry {
    previous?: string;
    current?: string;
    previousSource?: SourceSnippet;
    currentSource?: SourceSnippet;
    truncated?: boolean;
}

/** Snapshot locators are metadata. Never render the backend's combined locator headers as source. */
export function leanReviewDiffEntries(change: ReviewChange, before?: LeanReviewEvidence, after?: LeanReviewEvidence): LeanReviewDiffEntry[] {
    const sources = (snapshot: LeanReviewEvidence | undefined): SourceSnippet[] => {
        if (!snapshot) return [];
        if (change.kind === 'statement') return [snapshot.statement];
        if (change.kind === 'proof') return snapshot.proofs;
        if (change.kind === 'context') return snapshot.contexts;
        return [];
    };
    const old = sources(before), next = sources(after);
    const serialized = (items: SourceSnippet[]) => items.map(source => `${source.filePath}:${source.startLine}\n${source.content}`).join('\n\n');
    const matches = (value: string | undefined, items: SourceSnippet[]) => {
        if (value === undefined) return items.length === 0;
        const expected = serialized(items);
        return value === expected || (change.truncated === true && value === expected.slice(0, value.length));
    };
    if (change.key === change.kind && ['statement', 'proof', 'context'].includes(change.kind)
        && matches(change.previous, old) && matches(change.current, next)) {
        const keyed = (items: SourceSnippet[]) => {
            const occurrences = new Map<string, number>();
            return new Map(items.map(source => {
                const ordinal = occurrences.get(source.filePath) || 0; occurrences.set(source.filePath, ordinal + 1);
                return [`${source.filePath}\0${ordinal}`, source];
            }));
        };
        const previous = keyed(old), current = keyed(next), entries: LeanReviewDiffEntry[] = [];
        for (const key of new Set([...previous.keys(), ...current.keys()])) {
            const left = previous.get(key), right = current.get(key);
            if (left?.fingerprint === right?.fingerprint && left?.content === right?.content
                && left?.startLine === right?.startLine && left?.endLine === right?.endLine) continue;
            entries.push({ previous: left?.content, current: right?.content, previousSource: left, currentSource: right,
                truncated: change.truncated || left?.truncated || right?.truncated });
        }
        if (entries.length) return entries;
    }
    const individual = (snapshot?: LeanReviewEvidence): SourceSnippet | undefined => {
        if (!snapshot) return undefined;
        if (change.kind === 'statement') return snapshot.statement;
        if (change.kind === 'proof' || change.kind === 'context') return sources(snapshot).find((source, index) =>
            change.key === `${source.filePath}:${index}` || change.label === `${source.filePath}:${source.startLine}–${source.endLine}`);
        if (change.kind === 'declaration' || change.kind === 'definition') return [...snapshot.declarations, ...snapshot.definitions].find(item => item.key === change.key)?.source;
        return undefined;
    };
    const left = individual(before), right = individual(after);
    return [{ previous: change.previous, current: change.current,
        previousSource: change.previous === left?.content ? left : undefined,
        currentSource: change.current === right?.content ? right : undefined, truncated: change.truncated }];
}

function splitLines(value: string): Line[] {
    if (!value) return [];
    const result: Line[] = [];
    for (const match of value.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
        if (!match[0]) continue;
        result.push({ text: match[1], ending: match[2], value: match[0] });
    }
    return result;
}

/** Linear-space LCS yields exact line edits, including line-ending and final-newline changes. */
function lcs<T>(left: T[], right: T[]): T[] {
    if (!left.length || !right.length) return [];
    if (left.length === 1) return right.includes(left[0]) ? [left[0]] : [];
    const middle = Math.floor(left.length / 2);
    const lengths = (a: T[], b: T[]) => {
        let row = new Uint32Array(b.length + 1);
        for (const item of a) {
            const next = new Uint32Array(b.length + 1);
            for (let index = 1; index <= b.length; index++) next[index] = item === b[index - 1] ? row[index - 1] + 1 : Math.max(row[index], next[index - 1]);
            row = next;
        }
        return row;
    };
    const prefix = lengths(left.slice(0, middle), right), suffix = lengths(left.slice(middle).reverse(), [...right].reverse());
    let split = 0, best = -1;
    for (let index = 0; index <= right.length; index++) {
        const score = prefix[index] + suffix[right.length - index];
        if (score > best) { best = score; split = index; }
    }
    return [...lcs(left.slice(0, middle), right.slice(0, split)), ...lcs(left.slice(middle), right.slice(split))];
}

export function leanSourceLineDiff(before: string, after: string, oldStart = 1, newStart = 1): LeanDiffLine[] {
    const old = splitLines(before), next = splitLines(after), result: LeanDiffLine[] = [];
    // Trim shared edges before LCS. Most review changes touch only a small central range.
    let prefix = 0, suffix = 0;
    while (prefix < old.length && prefix < next.length && old[prefix].value === next[prefix].value) prefix++;
    while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - suffix - 1].value === next[next.length - suffix - 1].value) suffix++;
    const common = [...old.slice(0, prefix).map(line => line.value),
        ...lcs(old.slice(prefix, old.length - suffix).map(line => line.value), next.slice(prefix, next.length - suffix).map(line => line.value)),
        ...old.slice(old.length - suffix).map(line => line.value)];
    let left = 0, right = 0;
    const emit = (kind: LeanDiffLine['kind'], line: Line) => {
        result.push({ kind, text: line.text, ending: line.ending,
            ...(kind !== 'add' ? { oldLine: oldStart + left++ } : {}), ...(kind !== 'remove' ? { newLine: newStart + right++ } : {}) });
    };
    for (const value of common) {
        while (old[left]?.value !== value) emit('remove', old[left]);
        while (next[right]?.value !== value) emit('add', next[right]);
        emit('equal', old[left]);
    }
    while (left < old.length) emit('remove', old[left]);
    while (right < next.length) emit('add', next[right]);
    return result;
}

export function renderLeanSourceDiff(before: string, after: string, labels: { previous: string; current: string; noNewline: string }, oldStart = 1, newStart = 1): HTMLElement {
    const root = document.createElement('div'); root.className = 'reader-lean-source-diff';
    const table = document.createElement('table'), caption = document.createElement('caption');
    caption.textContent = `${labels.previous} → ${labels.current}`; table.append(caption);
    const head = document.createElement('thead'), heading = document.createElement('tr');
    for (const label of [labels.previous, labels.current, '±', '']) { const cell = document.createElement('th'); cell.textContent = label; heading.append(cell); }
    head.append(heading); table.append(head);
    const body = document.createElement('tbody');
    const lines = leanSourceLineDiff(before, after, oldStart, newStart);
    for (const line of lines) {
        const row = document.createElement('tr'); row.className = 'is-' + line.kind;
        for (const value of [line.oldLine?.toString() || '', line.newLine?.toString() || '', line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ']) {
            const cell = document.createElement('td'); cell.textContent = value; cell.className = 'lean-diff-number'; row.append(cell);
        }
        const cell = document.createElement('td'), code = document.createElement('code'); code.textContent = line.text || ' '; cell.append(code);
        if (!line.ending) { const ending = document.createElement('span'); ending.className = 'lean-diff-ending'; ending.textContent = ' ↵ ' + labels.noNewline; cell.append(ending); }
        else {
            cell.dataset.lineEnding = line.ending === '\r\n' ? 'CRLF' : line.ending === '\r' ? 'CR' : 'LF';
            if (line.kind !== 'equal' && lines.some(other => other.kind !== 'equal' && other.kind !== line.kind && other.text === line.text && other.ending !== line.ending)) {
                const ending = document.createElement('span'); ending.className = 'lean-diff-ending'; ending.textContent = ' ↵ ' + cell.dataset.lineEnding; cell.append(ending);
            }
        }
        row.append(cell); body.append(row);
    }
    table.append(body); root.append(table); return root;
}
