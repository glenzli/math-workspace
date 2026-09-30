import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Inline the built Reader, so the host never needs to frame or fetch a loopback URL. */
export async function readerAppHtml(): Promise<string> {
    const root = path.resolve(__dirname, '../reader');
    let html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
    html = html.replace('<html', '<html data-math-workspace-app');
    const stylesheet = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/);
    const script = html.match(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/);
    if (!stylesheet || !script) throw new Error('Build the Math Workspace Reader before opening the plugin.');
    let css = await fs.readFile(path.join(root, stylesheet[1]), 'utf8');
    // One modern font format keeps the resource small; the standalone Reader keeps all formats.
    css = css.replace(/src:([^;}]+);/g, (declaration, sources: string) => {
        const woff2 = sources.match(/url\(([^)]+\.woff2)\)\s*format\(["']?woff2["']?\)/);
        return woff2 ? 'src:' + woff2[0] + ';' : declaration;
    });
    const fonts = [...new Set([...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map(match => match[1]))];
    for (const font of fonts) {
        const bytes = await fs.readFile(path.join(root, 'assets', font.replace(/^["']|["']$/g, '')));
        css = css.split('url(' + font + ')').join('url(data:font/woff2;base64,' + bytes.toString('base64') + ')');
    }
    const javascript = await fs.readFile(path.join(root, script[1]), 'utf8');
    return html.replace(stylesheet[0], () => '<style>' + css.replace(/<\/style/gi, '<\\/style') + '</style>')
        .replace(script[0], () => '<script type="module">' + javascript.replace(/<\/script/gi, '<\\/script') + '</script>');
}
