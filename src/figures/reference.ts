import MarkdownIt from 'markdown-it';

export interface InteractiveFigureReference {
    source: string;
    poster: string;
    title: string;
}

export function interactiveFigureReference(tokens: any[]): InteractiveFigureReference | undefined {
    if (tokens?.length !== 3) return;
    const [link, image, close] = tokens;
    if (link.type !== 'link_open' || image.type !== 'image' || close.type !== 'link_close') return;
    if (!['交互图', 'interactive figure'].includes(String(link.attrGet('title') || '').trim().toLowerCase())) return;
    const source = String(link.attrGet('href') || '');
    const poster = String(image.attrGet('src') || '');
    const local = (value: string) => !!value && !/^(?:[a-z][a-z0-9+.-]*:|[\\/#])|[?#\u0000-\u001f]/i.test(value);
    if (!local(source) || !/\.html?$/i.test(source) || !local(poster) || !/\.(?:svg|png|jpe?g|webp|gif)$/i.test(poster)) return;
    return { source, poster, title: image.content || '' };
}

const markdown = new MarkdownIt({ html: false });

/** A static export keeps the normal image and needs no browser or project-code execution. */
export function staticFigureMarkdown(line: string): string {
    const tokens = markdown.parseInline(line.trim(), {});
    const figure = interactiveFigureReference(tokens[0]?.children);
    if (!figure) return line;
    const indent = line.match(/^\s*/)?.[0] || '';
    const title = figure.title.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    return `${indent}![${title}](<${figure.poster.replace(/>/g, '%3E')}>)`;
}
