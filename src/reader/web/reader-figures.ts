import type MarkdownIt from 'markdown-it';
import { interactiveFigureReference } from '../../figures/reference';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function installInteractiveFigureRule(markdown: MarkdownIt, resolvePath: (source: string, current: string) => string): void {
    markdown.core.ruler.after('inline', 'interactive_figures', state => {
        for (const token of state.tokens) {
            if (token.type !== 'inline') continue;
            const figure = interactiveFigureReference(token.children);
            if (!figure) continue;
            let source: string, poster: string;
            try {
                source = resolvePath('./' + decodeURIComponent(figure.source), state.env.readerCurrentFilePath || '');
                poster = resolvePath('./' + decodeURIComponent(figure.poster), state.env.readerCurrentFilePath || '');
            } catch { continue; }
            const child = new state.Token('html_inline', '', 0);
            child.content = `<span class="reader-interactive-figure" data-figure-source="${escape(source)}" data-figure-title="${escape(figure.title)}">`
                + `<span class="reader-figure-toolbar"><button type="button" data-figure-toggle></button><span data-figure-status role="status"></span></span>`
                + `<span class="reader-figure-poster"><img src="/api/asset?path=${encodeURIComponent(poster)}" alt="${escape(figure.title)}"></span>`
                + `<span class="reader-figure-stage"></span></span>`;
            token.children = [child];
        }
    });
}

export function mountInteractiveFigures(article: HTMLElement, language: 'zh' | 'en'): () => void {
    const disposers: Array<() => void> = [];
    const typographyListeners = new Set<() => void>();
    const syncTypography = () => typographyListeners.forEach(sync => sync());
    // Reader text settings live on an ancestor; the opaque frames cannot inherit them.
    const typographyObserver = new MutationObserver(syncTypography);
    for (let ancestor: HTMLElement | null = article; ancestor; ancestor = ancestor.parentElement) {
        typographyObserver.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    window.addEventListener('resize', syncTypography);
    const text = language === 'en'
        ? { static: 'Static figure', interactive: 'Interactive figure', loading: 'Loading…', failed: 'Figure unavailable; showing fallback image.' }
        : { static: '静态图', interactive: '交互图', loading: '正在加载…', failed: '图示加载失败，已显示备用静态图。' };
    for (const root of article.querySelectorAll<HTMLElement>('.reader-interactive-figure')) {
        const poster = root.querySelector<HTMLElement>('.reader-figure-poster')!;
        const stage = root.querySelector<HTMLElement>('.reader-figure-stage')!;
        const toggle = root.querySelector<HTMLButtonElement>('[data-figure-toggle]')!;
        const status = root.querySelector<HTMLElement>('[data-figure-status]')!;
        let frame: HTMLIFrameElement | undefined;
        let displayedFrame: HTMLIFrameElement | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let active = false;
        const sendTypography = () => {
            if (!frame) return;
            const style = getComputedStyle(article);
            frame.contentWindow?.postMessage({ type: 'math-workspace-figure', event: 'typography',
                fontFamily: style.fontFamily, fontSize: parseFloat(style.fontSize) }, '*');
        };
        typographyListeners.add(sendTypography);
        const clearTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
        const showPoster = () => {
            active = false; clearTimer(); frame?.remove(); displayedFrame?.remove();
            frame = undefined; displayedFrame = undefined;
            poster.hidden = false; stage.hidden = true;
            toggle.textContent = text.interactive; toggle.setAttribute('aria-pressed', 'false');
        };
        const failed = () => { showPoster(); status.textContent = text.failed; };
        const showMode = (interactive: boolean) => {
            active = interactive; clearTimer(); status.textContent = text.loading;
            toggle.textContent = interactive ? text.static : text.interactive;
            toggle.setAttribute('aria-pressed', String(interactive));
            if (frame !== displayedFrame) frame?.remove();
            frame = document.createElement('iframe');
            frame.title = root.dataset.figureTitle || text.interactive;
            frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
            frame.src = '/api/figure?path=' + encodeURIComponent(root.dataset.figureSource!) + '&mode=' + (interactive ? 'interactive' : 'static');
            // Keep the current SVG visible until its replacement is ready; no PNG flash on toggle.
            frame.className = 'reader-figure-loading';
            stage.append(frame); stage.hidden = false;
            timer = setTimeout(failed, 10000);
        };
        const receive = (event: MessageEvent) => {
            if (!frame || event.source !== frame.contentWindow || event.data?.type !== 'math-workspace-figure') return;
            if (event.data.event === 'ready') {
                clearTimer(); status.textContent = '';
                if (displayedFrame !== frame) displayedFrame?.remove();
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
        typographyObserver.disconnect(); window.removeEventListener('resize', syncTypography);
        typographyListeners.clear(); disposers.forEach(dispose => dispose());
    };
}
