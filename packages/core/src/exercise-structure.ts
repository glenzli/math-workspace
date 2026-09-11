/** Source ranges and explicit exercise/solution relationships, independent of rendering. */
import { FORMAL_ID_PATTERN } from './formal-kinds';
import type { FormalDefinition, FormalDocument, FormalIssue, FormalMarker, LabelData } from './formal-core';

export interface ExerciseSupportRange {
    kind: 'hint' | 'solution';
    startLine: number;
    endLine: number;
}

export function exerciseSupportKind(line: string): 'hint' | 'solution' | undefined {
    const text = line.trim().replace(/^>\s*/, '').replace(/^(?:\*\*|__)(.*?)(?:\*\*|__)/, '$1').trim();
    if (/^(?:提示|Hint)\s*(?:[：:.]|$)/i.test(text)) return 'hint';
    if (/^(?:解答|答案|Solution|Answer)\s*(?:[：:.]|$)/i.test(text)) return 'solution';
    return undefined;
}

export function solutionTarget(title: string): { id: string; title: string } | undefined {
    const match = title.match(new RegExp(`^(?:对应|for)\\s+@(${FORMAL_ID_PATTERN})(?:\\s*[；;]\\s*(.*))?$`, 'i'));
    return match ? { id: match[1], title: (match[2] || '').trim() } : undefined;
}

export function collectExerciseContent(lines: string[], startLine: number, marker: FormalMarker,
    parseMarker: (line: string) => FormalMarker | undefined): { contentLines: string[]; endLine: number; support: ExerciseSupportRange[]; bodyEndLine: number } {
    let end = startLine;
    let inFence = false;
    for (let i = startLine + 1; i < lines.length; i++) {
        if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; end = i; continue; }
        if (!inFence && (/^#{1,6}\s+/.test(lines[i]) || parseMarker(lines[i])
            || /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(lines[i]))) break;
        end = i;
    }
    while (end > startLine && !lines[end].trim()) end--;
    const support: ExerciseSupportRange[] = [];
    inFence = false;
    if (marker.type === 'exercise') for (let i = startLine + 1; i <= end; i++) {
        if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue; }
        const kind = !inFence && exerciseSupportKind(lines[i]);
        if (!kind) continue;
        if (support.length) support[support.length - 1].endLine = i - 1;
        support.push({ kind, startLine: i, endLine: end });
    }
    let promptEnd = support.length ? support[0].startLine - 1 : end;
    while (promptEnd > startLine && !lines[promptEnd].trim()) promptEnd--;
    const contentLines = lines.slice(startLine, promptEnd + 1);
    contentLines[0] = contentLines[0].replace(marker.markerText, marker.markerText.replace(/\s+#[A-Za-z0-9_-]+\b$/, ''));
    return { contentLines, endLine: promptEnd, support, bodyEndLine: end };
}

export function connectExerciseSolutions(definitions: FormalDefinition[], labels: Record<string, LabelData>): FormalIssue[] {
    const issues: FormalIssue[] = [];
    for (const definition of definitions) {
        if (definition.type !== 'solution' || !definition.id) continue;
        const targetId = definition.label.solutionOf;
        const target = targetId && labels[targetId];
        if (!target || target.type !== 'exercise') {
            issues.push({ severity: 'error', code: 'solution-target-invalid', file: definition.file, line: definition.line,
                message: targetId ? `Solution target @${targetId} must resolve to an exercise.` : 'A solution needs an explicit target: 解答 #tmp-s（对应 @tmp-e） / Solution #tmp-s (for @tmp-e).' });
            continue;
        }
        if (target.bookKey !== definition.label.bookKey) {
            issues.push({ severity: 'error', code: 'solution-target-cross-book', file: definition.file, line: definition.line,
                message: 'An exercise and its solution must belong to the same book.' });
            continue;
        }
        definition.label.number = target.number;
        definition.label.solutionExerciseNumber = target.unitLabel && target.number !== undefined ? `${target.unitLabel}.${target.number}` : '';
        definition.label.solutionExerciseTitle = target.title;
        (target.solutions ||= []).push(definition.id);
    }
    for (const label of Object.values(labels)) if (label.solutions) label.solutions.sort();
    return issues;
}

/** Proof fingerprints include actual support text, including linked answers in other files. */
export function associatedProofContent(label: LabelData, labels: Record<string, LabelData>): string {
    return JSON.stringify({
        question: label.solutionOf ? { id: label.solutionOf, content: labels[label.solutionOf]?.content || '' } : undefined,
        local: label.proofContent || '',
        support: label.supportContent || '',
        solutions: (label.solutions || []).map(id => ({ id, content: labels[id]?.proofContent || '', target: labels[id]?.solutionOf || '' }))
    });
}

