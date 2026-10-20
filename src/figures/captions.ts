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

/** Pair adjacent paragraphs once, preferring a caption after its image. */
function figureCaptionPairs(tokens: any[], captions: Map<number, { title: string; description: string }>) {
    const usedImages = new Set<number>();
    return [...captions].flatMap(([captionIndex, caption]) => {
        const imageIndex = [captionIndex - 3, captionIndex + 3]
            .find(index => !usedImages.has(index) && isImageParagraph(tokens, index));
        if (imageIndex === undefined) return [];
        usedImages.add(imageIndex);
        return [{ imageIndex, captionIndex, caption,
            start: Math.min(imageIndex, captionIndex), end: Math.max(imageIndex, captionIndex) + 3 }];
    });
}

export function installFigureCaptionRule(markdown: MarkdownIt): void {
    markdown.core.ruler.after('math_workspace_anchors', 'figure_captions', state => {
        const captions = new Map<number, { title: string; description: string }>();
        for (let i = 1; i < state.tokens.length - 1; i++) {
            const inline = state.tokens[i], open = state.tokens[i - 1], close = state.tokens[i + 1];
            if (inline.type !== 'inline' || open.type !== 'paragraph_open' || open.level !== 0 || close?.type !== 'paragraph_close') continue;
            const marker = state.env.readerMarkersByLine?.[inline.map?.[0] ?? -1];
            const caption = splitFigureCaption(inline.content, state.env.readerLabels?.[marker]?.type === 'figure');
            if (!caption) continue;
            captions.set(i - 1, caption);
            const span = (name: string, content: string) => {
                const start = new state.Token('span_open', 'span', 1); start.attrSet('class', name);
                const end = new state.Token('span_close', 'span', -1);
                return [start, ...(markdown.parseInline(content, state.env)[0]?.children || []), end];
            };
            inline.children = [...span('reader-figure-title', caption.title),
                ...(caption.description ? span('reader-figure-description', caption.description) : [])];
            open.attrJoin('class', 'reader-figure-caption');
        }
        for (const pair of figureCaptionPairs(state.tokens, captions).reverse()) {
            state.tokens[pair.captionIndex].tag = state.tokens[pair.captionIndex + 2].tag = 'figcaption';
            const groupOpen = new state.Token('figure_open', 'figure', 1);
            groupOpen.block = true; groupOpen.attrSet('class', 'reader-figure');
            const groupClose = new state.Token('figure_close', 'figure', -1); groupClose.block = true;
            state.tokens.splice(pair.end, 0, groupClose);
            state.tokens.splice(pair.start, 0, groupOpen);
        }
    });
}

const markdown = new MarkdownIt({ html: false });
const latex = (source: string) => '```{=latex}\n' + source + '\n```';

/** PDF-only layout; public Markdown stays portable and readable. */
export function figureMarkdownForPdf(source: string): string {
    const lines = source.split('\n'), tokens = markdown.parse(source, {});
    const changes: Array<{ start: number; end: number; text: string }> = [];
    const captions = new Map<number, { title: string; description: string }>();
    for (let i = 0; i < tokens.length - 2; i++) {
        const [captionOpen, captionInline, captionClose] = tokens.slice(i, i + 3);
        if (captionOpen.type !== 'paragraph_open' || captionOpen.level !== 0 || captionInline.type !== 'inline' || captionClose.type !== 'paragraph_close') continue;
        const caption = splitFigureCaption(captionInline.content);
        if (caption) captions.set(i, caption);
    }
    for (const pair of figureCaptionPairs(tokens, captions)) {
        const { imageIndex, captionIndex, caption } = pair;
        const imageMap = tokens[imageIndex + 1].map, captionMap = tokens[captionIndex + 1].map;
        if (!imageMap || !captionMap) continue;
        const image = lines.slice(imageMap[0], imageMap[1]).join('\n');
        const title = caption.title.startsWith('**') ? caption.title : '**' + caption.title + '**';
        const captionBlock = [
            latex('\\begin{minipage}{0.92\\linewidth}\n\\small\\color[gray]{0.25}\\centering'),
            title,
            ...(caption.description ? [latex('\\par\\vspace{0.3\\baselineskip}\\raggedright'), caption.description] : []),
            latex('\\par\\end{minipage}')
        ];
        const gap = latex('\\par\\vspace{0.45\\baselineskip}');
        const contents = captionIndex < imageIndex ? [...captionBlock, gap, image] : [image, gap, ...captionBlock];
        changes.push({ start: Math.min(imageMap[0], captionMap[0]), end: Math.max(imageMap[1], captionMap[1]), text: [
            latex('\\par\\addvspace{0.8\\baselineskip}\n\\noindent\\begin{minipage}{\\linewidth}\n\\centering'),
            ...contents,
            latex('\\par\\end{minipage}\\par\\addvspace{1.2\\baselineskip}')
        ].join('\n\n') });
    }
    for (const change of changes.reverse()) lines.splice(change.start, change.end - change.start, change.text);
    return lines.join('\n');
}
