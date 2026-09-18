import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const FIGURE_CSP = [
    "sandbox allow-scripts", "default-src 'none'", "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'", "img-src data:", "font-src data:",
    "connect-src 'none'", "frame-src 'none'", "object-src 'none'",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'"
].join('; ');

function bridge(mode: 'interactive' | 'static'): string {
    return `<script>
window.mathWorkspaceFigure = Object.freeze({mode: ${JSON.stringify(mode)}});
(() => {
  let previous = 0, queued = false;
  const notify = () => {
    queued = false;
    if (!document.body) return;
    const height = Math.ceil(document.body.getBoundingClientRect().height + 2 * parseFloat(getComputedStyle(document.body).marginTop || '0'));
    if (height > 0 && height !== previous) { previous = height; parent.postMessage({type:'math-workspace-figure',event:'resize',height}, '*'); }
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(notify); } };
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || data?.type !== 'math-workspace-figure' || data.event !== 'typography') return;
    if (typeof data.fontSize !== 'number' || !Number.isFinite(data.fontSize) || data.fontSize < 10 || data.fontSize > 40) return;
    if (typeof data.fontFamily !== 'string' || data.fontFamily.length > 240) return;
    document.documentElement.style.setProperty('--math-workspace-font-family', data.fontFamily);
    document.documentElement.style.setProperty('--math-workspace-font-size', data.fontSize + 'px');
    schedule();
  });
  addEventListener('DOMContentLoaded', () => {
    new ResizeObserver(schedule).observe(document.body);
    parent.postMessage({type:'math-workspace-figure',event:'ready'}, '*'); schedule();
  });
  addEventListener('error', () => parent.postMessage({type:'math-workspace-figure',event:'error'}, '*'));
})();
</script>`;
}

/** Project HTML runs only in an opaque, script-only frame; it never becomes Reader DOM. */
export async function sendInteractiveFigure(response: any, rootPath: string, requested: string, mode: string): Promise<void> {
    const fail = (status: number) => {
        response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        response.end('Interactive figure unavailable.');
    };
    if (!requested || path.isAbsolute(requested) || /[\u0000-\u001f]/.test(requested) || !/\.html?$/i.test(requested)) return fail(403);
    try {
        const root = await fs.realpath(rootPath);
        const candidate = path.resolve(root, requested);
        const candidateRelative = path.relative(root, candidate);
        if (candidateRelative === '..' || candidateRelative.startsWith('..' + path.sep) || path.isAbsolute(candidateRelative)) return fail(403);
        const file = await fs.realpath(candidate);
        const relative = path.relative(root, file);
        if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) || !/\.html?$/i.test(file)) return fail(403);
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > 2_000_000) return fail(413);
        const html = await fs.readFile(file, 'utf8');
        const script = bridge(mode === 'static' ? 'static' : 'interactive');
        const body = /<head(?:\s[^>]*)?>/i.test(html)
            ? html.replace(/<head(?:\s[^>]*)?>/i, opening => opening + script)
            : script + html;
        response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
            'content-security-policy': FIGURE_CSP, 'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer'
        });
        response.end(body);
    } catch { fail(404); }
}
