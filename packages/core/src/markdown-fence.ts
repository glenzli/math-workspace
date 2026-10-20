/** Track fenced Markdown without treating shorter or different fences as a close. */
export class MarkdownFence {
    private delimiter?: string;

    /** True for the opening/closing delimiter and every line inside the block. */
    consume(line: string): boolean {
        const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (this.delimiter) {
            if (match && match[1][0] === this.delimiter[0]
                && match[1].length >= this.delimiter.length && !match[2].trim()) this.delimiter = undefined;
            return true;
        }
        if (!match || (match[1][0] === '`' && match[2].includes('`'))) return false;
        this.delimiter = match[1];
        return true;
    }
}

/** Ignore code while retaining source offsets and line numbers for references. */
export function maskFencedMarkdown(content: string): string {
    const fence = new MarkdownFence();
    return content.split('\n').map(line => fence.consume(line) ? line.replace(/[^\r\n]/g, ' ') : line).join('\n');
}
