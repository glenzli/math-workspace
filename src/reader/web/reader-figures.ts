import { readerText, readerAttribute, readerWords } from './reader-ui-labels';
import { readerRoute, readerFetch } from './reader-route';
import { isReaderApp } from './reader-host';
import { emptyReaderImage } from './reader-assets';
import type MarkdownIt from 'markdown-it';
import { interactiveFigureReference } from '../../figures/reference';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A blob response cannot carry HTTP headers; apply the same policy before project scripts. */
export function readerFigureDocument(html: string, csp: string | null): string {
    if (!csp) throw new Error('Interactive figure policy is unavailable.');
    const policy = csp.split(';').filter(directive => !/^\s*(?:frame-ancestors|sandbox)\b/.test(directive)).join(';');
    const meta = '<meta http-equiv="Content-Security-Policy" content="' + escape(policy) + '">';
    return /<head(?:\s[^>]*)?>/i.test(html)
        ? html.replace(/<head(?:\s[^>]*)?>/i, match => match + meta)
        : meta + html;
}

export function installInteractiveFigureRule(markdown: MarkdownIt, resolvePath: (source: string, current: string) => string): void {
    markdown.core.ruler.after('inline', 'interactive_figures', state => {
        for (const [index, token] of state.tokens.entries()) {
            if (token.type !== 'inline') continue;
            // Only independent image blocks use figure sizing; inline images stay inline.
            if (token.children?.length === 1 && token.children[0].type === 'image'
                && state.tokens[index - 1]?.type === 'paragraph_open') {
                state.tokens[index - 1].attrJoin('class', 'reader-static-figure');
            }
            const figure = interactiveFigureReference(token.children);
            if (!figure) continue;
            let source: string, poster: string;
            try {
                source = resolvePath('./' + decodeURIComponent(figure.source), state.env.readerCurrentFilePath || '');
                poster = resolvePath('./' + decodeURIComponent(figure.poster), state.env.readerCurrentFilePath || '');
            } catch { continue; }
            const posterRoute = readerRoute('/api/asset?path=' + encodeURIComponent(poster));
            const posterSource = isReaderApp() ? emptyReaderImage : posterRoute;
            const posterAttribute = isReaderApp() ? ' data-reader-asset="' + escape(posterRoute) + '"' : '';
            const child = new state.Token('html_inline', '', 0);
            child.content = `<span class="reader-interactive-figure" data-figure-source="${escape(source)}" data-figure-title="${escape(figure.title)}">`
                + `<span class="reader-figure-toolbar"><button type="button" data-figure-toggle></button><span data-figure-status role="status"></span></span>`
                + `<span class="reader-figure-poster"><img src="${posterSource}"${posterAttribute} alt="${escape(figure.title)}"></span>`
                + `<span class="reader-figure-stage"></span></span>`;
            token.children = [child];
        }
    });
}

export function mountReaderFigures(article: HTMLElement, language: 'zh' | 'en' | (() => 'zh' | 'en')): () => void {
    const locale = typeof language === 'function' ? language : () => language;
    const disposers: Array<() => void> = [];
    let closeViewer = () => {};
    const expandText = () => locale() === 'en' ? 'Enlarge figure' : '放大图示';
    for (const root of article.querySelectorAll<HTMLElement>('.reader-static-figure, .reader-interactive-figure')) {
        const poster = root.querySelector<HTMLImageElement>('img');
        const sizeFromPoster = () => {
            if (!poster?.naturalWidth || !poster.naturalHeight || poster.src === emptyReaderImage) return;
            // Limit tall artwork as well as wide diagrams, without clipping either dimension.
            root.style.setProperty('--reader-figure-aspect-width', (32 * poster.naturalWidth / poster.naturalHeight) + 'em');
            root.style.setProperty('--reader-figure-natural-width', poster.naturalWidth + 'px');
        };
        poster?.addEventListener('load', sizeFromPoster); sizeFromPoster();
        let toolbar = root.querySelector<HTMLElement>('.reader-figure-toolbar');
        if (!toolbar) { toolbar = document.createElement('span'); toolbar.className = 'reader-figure-toolbar'; root.prepend(toolbar); }
        const expand = document.createElement('button');
        expand.type = 'button'; expand.dataset.figureExpand = ''; readerText(expand, expandText);
        const openViewer = () => {
            closeViewer();
            const style = getComputedStyle(article);
            const dialog = document.createElement('dialog'); dialog.className = 'reader-figure-viewer';
            readerAttribute(dialog, 'aria-label', () => root.dataset.figureTitle || poster?.alt || expandText());
            dialog.style.fontSize = style.fontSize; dialog.style.fontFamily = style.fontFamily;
            const close = document.createElement('button'); close.type = 'button';
            readerText(close, () => locale() === 'en' ? 'Close' : '关闭'); close.className = 'reader-figure-viewer-close';
            const viewport = document.createElement('div'); viewport.className = 'reader-figure-viewer-viewport';
            dialog.append(close, viewport); document.body.append(dialog);
            // Atomic moves preserve opaque iframe state. Older engines enlarge the poster instead.
            const live = !root.matches('.reader-interactive-figure') || typeof viewport.moveBefore === 'function';
            const placeholder = document.createElement('div');
            placeholder.style.height = root.getBoundingClientRect().height + 'px';
            const rootStyle = getComputedStyle(root);
            placeholder.style.marginTop = rootStyle.marginTop; placeholder.style.marginBottom = rootStyle.marginBottom;
            dialog.style.setProperty('--reader-figure-max-width', rootStyle.getPropertyValue('--reader-figure-max-width') || '50em');
            if (live) {
                root.before(placeholder);
                if (viewport.moveBefore) viewport.moveBefore(root, null); else viewport.append(root);
            } else if (poster) {
                const still = document.createElement('div'); still.className = 'reader-static-figure';
                still.style.cssText = root.style.cssText; still.append(poster.cloneNode()); viewport.append(still);
            }
            let restored = false;
            const restore = () => {
                if (restored) return; restored = true;
                if (live) {
                    const parent = placeholder.parentElement;
                    if (parent?.moveBefore && parent.isConnected) { parent.moveBefore(root, placeholder); placeholder.remove(); }
                    else placeholder.replaceWith(root);
                }
                dialog.remove(); closeViewer = () => {};
                if (expand.isConnected) expand.focus({ preventScroll: true });
            };
            closeViewer = () => { dialog.close(); restore(); };
            close.addEventListener('click', () => closeViewer());
            dialog.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
            dialog.addEventListener('close', restore);
            dialog.showModal();
        };
        expand.addEventListener('click', openViewer); toolbar.prepend(expand);
        disposers.push(() => { poster?.removeEventListener('load', sizeFromPoster); expand.removeEventListener('click', openViewer); expand.remove(); });
    }
    const beforePrint = () => closeViewer();
    window.addEventListener('beforeprint', beforePrint);
    const typographyListeners = new Set<() => void>();
    const syncTypography = () => typographyListeners.forEach(sync => sync());
    // Reader text settings live on an ancestor; the opaque frames cannot inherit them.
    const typographyObserver = new MutationObserver(syncTypography);
    for (let ancestor: HTMLElement | null = article; ancestor; ancestor = ancestor.parentElement) {
        typographyObserver.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    window.addEventListener('resize', syncTypography);
    const text = readerWords(() => locale() === 'en'
        ? { static: 'Static figure', interactive: 'Interactive figure', loading: 'Loading…', failed: 'Figure unavailable; showing fallback image.' }
        : { static: '静态图', interactive: '交互图', loading: '正在加载…', failed: '图示加载失败，已显示备用静态图。' });
    for (const root of article.querySelectorAll<HTMLElement>('.reader-interactive-figure')) {
        const poster = root.querySelector<HTMLElement>('.reader-figure-poster')!;
        const stage = root.querySelector<HTMLElement>('.reader-figure-stage')!;
        const toggle = root.querySelector<HTMLButtonElement>('[data-figure-toggle]')!;
        const status = root.querySelector<HTMLElement>('[data-figure-status]')!;
        let frame: HTMLIFrameElement | undefined;
        let displayedFrame: HTMLIFrameElement | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let active = false;
        const frameUrls = new Map<HTMLIFrameElement, string>();
        const removeFrame = (value?: HTMLIFrameElement) => {
            if (!value) return; value.remove();
            const url = frameUrls.get(value); if (url) URL.revokeObjectURL(url); frameUrls.delete(value);
        };
        const sendTypography = () => {
            if (!frame) return;
            const style = getComputedStyle(article);
            frame.contentWindow?.postMessage({ type: 'math-workspace-figure', event: 'typography',
                fontFamily: style.fontFamily, fontSize: parseFloat(style.fontSize) }, '*');
        };
        typographyListeners.add(sendTypography);
        const clearTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
        const showPoster = () => {
            active = false; clearTimer(); removeFrame(frame); removeFrame(displayedFrame);
            frame = undefined; displayedFrame = undefined;
            poster.hidden = false; stage.hidden = true;
            readerText(toggle, () => text.interactive); toggle.setAttribute('aria-pressed', 'false');
        };
        const failed = () => { showPoster(); readerText(status, () => text.failed); };
        const showMode = (interactive: boolean) => {
            active = interactive; clearTimer(); readerText(status, () => text.loading);
            readerText(toggle, () => interactive ? text.static : text.interactive);
            toggle.setAttribute('aria-pressed', String(interactive));
            if (frame !== displayedFrame) removeFrame(frame);
            frame = document.createElement('iframe');
            frame.title = root.dataset.figureTitle || text.interactive;
            frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
            const route = readerRoute('/api/figure?path=' + encodeURIComponent(root.dataset.figureSource!) + '&mode=' + (interactive ? 'interactive' : 'static'));
            const loadingFrame = frame;
            if (isReaderApp()) void readerFetch(route).then(async response => {
                if (!response.ok) throw new Error(await response.text());
                let html = await response.text();
                if (frame !== loadingFrame || !loadingFrame.isConnected) return;
                html = readerFigureDocument(html, response.headers.get('content-security-policy'));
                const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
                frameUrls.set(loadingFrame, url); loadingFrame.src = url;
            }).catch(() => { if (frame === loadingFrame) failed(); });
            else frame.src = route;
            // Keep the current SVG visible until its replacement is ready; no PNG flash on toggle.
            frame.className = 'reader-figure-loading';
            stage.append(frame); stage.hidden = false;
            timer = setTimeout(failed, 10000);
        };
        const receive = (event: MessageEvent) => {
            if (!frame || event.source !== frame.contentWindow || event.data?.type !== 'math-workspace-figure') return;
            if (event.data.event === 'ready') {
                clearTimer(); readerText(status, () => '');
                if (displayedFrame !== frame) removeFrame(displayedFrame);
                displayedFrame = frame; frame.classList.remove('reader-figure-loading');
                poster.hidden = true; stage.hidden = false; sendTypography();
            } else if (event.data.event === 'resize' && typeof event.data.height === 'number' && Number.isFinite(event.data.height)) {
                frame.style.height = Math.max(100, Math.min(2400, event.data.height)) + 'px';
            } else if (event.data.event === 'error') failed();
        };
        const click = () => showMode(!active);
        toggle.addEventListener('click', click); window.addEventListener('message', receive);
        showMode(true);
        disposers.push(() => { showPoster(); toggle.removeEventListener('click', click); window.removeEventListener('message', receive); });
    }
    return () => {
        closeViewer(); window.removeEventListener('beforeprint', beforePrint);
        typographyObserver.disconnect(); window.removeEventListener('resize', syncTypography);
        typographyListeners.clear(); disposers.forEach(dispose => dispose());
    };
}
