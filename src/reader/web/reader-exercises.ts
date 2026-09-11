import type MarkdownIt from 'markdown-it';
import type { ReaderLabel } from './formal-renderer';

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function link(id: string, label: ReaderLabel, text: string): string {
    return `<a data-reader-page="${escapeHtml(label.filePath)}" href="?path=${encodeURIComponent(label.filePath)}#formal-${encodeURIComponent(id)}">${escapeHtml(text)}</a>`;
}

/** Add disclosure boundaries to complete Markdown blocks without altering source line numbers. */
export function installExerciseRules(markdown: MarkdownIt): void {
    markdown.core.ruler.after('math_workspace_anchors', 'math_workspace_exercises', (state: any) => {
        const labels: Record<string, ReaderLabel> = state.env.readerLabels || {};
        const english = state.env.readerLanguage === 'en';
        const inserts = new Map<number, string[]>();
        const append = (index: number, html: string) => inserts.set(index, [...(inserts.get(index) || []), html]);
        const blockIndex = (line: number) => {
            const index = state.tokens.findIndex((token: any) => token.level === 0 && token.map && token.map[0] >= line);
            return index < 0 ? state.tokens.length : index;
        };
        for (const [id, label] of Object.entries(labels)) {
            if (label.filePath !== state.env.readerCurrentFilePath || label.startLine === undefined
                || state.env.readerMarkersByLine?.[label.startLine] !== id) continue;
            if (label.type === 'exercise') {
                for (const range of label.supportRanges || []) {
                    const start = blockIndex(range.startLine);
                    const end = blockIndex(range.endLine + 1);
                    if (start >= end) continue;
                    const title = range.kind === 'hint' ? (english ? 'Hint' : '提示') : (english ? 'Solution' : '解答');
                    append(start, `<details class="reader-exercise-support" data-exercise-support="${range.kind}"><summary>${title}</summary>\n`);
                    append(end, '</details>\n');
                }
                const links = (label.solutions || []).filter(target => labels[target]).map((target, index) =>
                    link(target, labels[target], (english ? 'View solution' : '查看解答') + ((label.solutions?.length || 0) > 1 ? ` ${index + 1}` : '')));
                if (links.length) {
                    const at = blockIndex((label.endLine ?? label.startLine) + 1);
                    inserts.set(at, [`<p class="reader-exercise-links">${links.join(' · ')}</p>\n`, ...(inserts.get(at) || [])]);
                }
            }
            if (label.type === 'solution' && label.bodyEndLine !== undefined) {
                const start = blockIndex(label.startLine);
                const end = blockIndex(label.bodyEndLine + 1);
                if (start >= end) continue;
                // The disclosure owns the stable anchor, so navigation can reveal the full answer.
                for (const token of state.tokens) if (token.attrGet('id') === `formal-${id}`) token.attrSet('id', `solution-body-${id}`);
                const target = label.solutionOf && labels[label.solutionOf];
                const back = target ? ` <span class="reader-exercise-back">${link(label.solutionOf!, target, english ? 'Back to exercise' : '返回习题')}</span>` : '';
                append(start, `<details class="reader-exercise-support reader-exercise-solution" id="formal-${escapeHtml(id)}"><summary>${escapeHtml(label.display || (english ? 'Solution' : '解答'))}${back}</summary>\n`);
                append(end, '</details>\n');
            }
        }
        for (const index of [...inserts.keys()].sort((a, b) => b - a)) {
            const token = new state.Token('html_block', '', 0);
            token.content = inserts.get(index)!.join('');
            state.tokens.splice(index, 0, token);
        }
    });
}

export function revealExerciseTarget(target: Element | null): void {
    let element = target;
    while (element) {
        if (element instanceof HTMLDetailsElement) element.open = true;
        element = element.parentElement;
    }
}
