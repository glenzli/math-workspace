import MarkdownIt from 'markdown-it';

/** Source remains ordinary Markdown; the Reader and PDF give this declaration a caption layout. */
export function splitFigureCaption(source: string, knownFigure = false): { title: string; description: string } | undefined {
    const text = source.trim();
    if (!knownFigure && !/^(?:\*\*)?(?:图|Figure)\s+(?:[A-Z]\.)?\d+(?:\.\d+)*(?:\s*[（(]|(?:\*\*)?\s*[:：]|(?:\*\*)?$)/i.test(text)) return;
    if (text.startsWith('**')) {
        const end = text.indexOf('**', 2);
        if (end >= 2) return { title: text.slice(0, end + 2), description: text.slice(end + 2).replace(/^\s*[:：]?\s*/, '') };
    }
    // A colon inside a displayed title or a math span is not the caption separator.
    let depth = 0, math = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '\\') { i++; continue; }
        if (c === '$') { math = !math; continue; }
        if (math) continue;
        if (c === '(' || c === '（') depth++;
        else if (c === ')' || c === '）') depth = Math.max(0, depth - 1);
        else if (!depth && (c === ':' || c === '：')) return { title: text.slice(0, i).trim(), description: text.slice(i + 1).trim() };
    }
    return { title: text, description: '' };
}

function isImageParagraph(tokens: any[], index: number): boolean {
    const [open, inline, close] = tokens.slice(index, index + 3);
    if (open?.type !== 'paragraph_open' || open.level !== 0 || inline?.type !== 'inline' || close?.type !== 'paragraph_close') return false;
    const children = inline.children;
    return children?.length === 1 && (children[0].type === 'image'
        || (children[0].type === 'html_inline' && children[0].content.startsWith('<span class="reader-interactive-figure"')));
}

export function installFigureCaptionRule(markdown: MarkdownIt): void {
    markdown.core.ruler.after('math_workspace_anchors', 'figure_captions', state => {
        for (let i = state.tokens.length - 2; i >= 1; i--) {
            const inline = state.tokens[i], open = state.tokens[i - 1], close = state.tokens[i + 1];
            if (inline.type !== 'inline' || open.type !== 'paragraph_open' || open.level !== 0 || close?.type !== 'paragraph_close') continue;
            const marker = state.env.readerMarkersByLine?.[inline.map?.[0] ?? -1];
            const caption = splitFigureCaption(inline.content, state.env.readerLabels?.[marker]?.type === 'figure');
            if (!caption) continue;
            const span = (name: string, content: string) => {
                const start = new state.Token('span_open', 'span', 1); start.attrSet('class', name);
                const end = new state.Token('span_close', 'span', -1);
                return [start, ...(markdown.parseInline(content, state.env)[0]?.children || []), end];
            };
            inline.children = [...span('reader-figure-title', caption.title),
                ...(caption.description ? span('reader-figure-description', caption.description) : [])];
            open.attrJoin('class', 'reader-figure-caption');
            if (!isImageParagraph(state.tokens, i - 4)) continue;
            open.tag = close.tag = 'figcaption';
            const groupOpen = new state.Token('figure_open', 'figure', 1);
            groupOpen.block = true; groupOpen.attrSet('class', 'reader-figure');
            const groupClose = new state.Token('figure_close', 'figure', -1); groupClose.block = true;
            state.tokens.splice(i + 2, 0, groupClose);
            state.tokens.splice(i - 4, 0, groupOpen);
        }
    });
}

const markdown = new MarkdownIt({ html: false });
const latex = (source: string) => '```{=latex}\n' + source + '\n```';

/** PDF-only layout; public Markdown stays portable and readable. */
export function figureMarkdownForPdf(source: string): string {
    const lines = source.split('\n'), tokens = markdown.parse(source, {});
    const changes: Array<{ start: number; end: number; text: string }> = [];
    for (let i = 0; i < tokens.length - 5; i++) {
        if (!isImageParagraph(tokens, i)) continue;
        const [captionOpen, captionInline, captionClose] = tokens.slice(i + 3, i + 6);
        if (captionOpen.type !== 'paragraph_open' || captionOpen.level !== 0 || captionInline.type !== 'inline' || captionClose.type !== 'paragraph_close') continue;
        const caption = splitFigureCaption(captionInline.content);
        if (!caption || !tokens[i].map || !tokens[i + 1].map || !captionInline.map) continue;
        const image = lines.slice(tokens[i].map![0], tokens[i + 1].map![1]).join('\n');
        const title = caption.title.startsWith('**') ? caption.title : '**' + caption.title + '**';
        changes.push({ start: tokens[i].map![0], end: captionInline.map[1], text: [
            latex('\\par\\addvspace{0.8\\baselineskip}\n\\noindent\\begin{minipage}{\\linewidth}\n\\centering'),
            image,
            latex('\\par\\vspace{0.45\\baselineskip}\n\\begin{minipage}{0.92\\linewidth}\n\\small\\color[gray]{0.25}\\centering'),
            title,
            ...(caption.description ? [latex('\\par\\vspace{0.3\\baselineskip}\\raggedright'), caption.description] : []),
            latex('\\par\\end{minipage}\n\\end{minipage}\\par\\addvspace{1.2\\baselineskip}')
        ].join('\n\n') });
        i += 5;
    }
    for (const change of changes.reverse()) lines.splice(change.start, change.end - change.start, change.text);
    return lines.join('\n');
}
