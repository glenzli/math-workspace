import { isReaderEmbedded, readerFetch } from './reader-route';
import { persistReaderState, readerSearch } from './reader-host';

export function readerViewStateChanged(): void {
    if (isReaderEmbedded()) window.dispatchEvent(new Event('math-workspace-reader-location'));
}

/** Persist only view navigation in the host. Discussion marks remain project-owned source locators. */
export function mountReaderEmbeddedView(main: HTMLElement): void {
    if (!isReaderEmbedded()) return;
    document.documentElement.classList.add('reader-embedded');
    let projectRoot: string | undefined;
    let pending = 0;
    let generation = 0;
    let restore = Number(new URLSearchParams(readerSearch()).get('readerScroll')) || 0;
    const publish = () => {
        persistReaderState({
            projectRoot, pagePath: new URLSearchParams(readerSearch()).get('path') || '',
            scrollTop: main.scrollTop
        });
    };
    window.addEventListener('math-workspace-reader-location', () => {
        const current = ++generation;
        void readerFetch('/api/plugin-context', { cache: 'no-store' }).then(response => {
            if (!response.ok) throw new Error('Reader context is unavailable.');
            return response.json();
        }).then(context => {
            if (current !== generation) return;
            projectRoot = context.projectRoot;
            if (restore > 0 && readerSearch().includes('path=') && document.querySelector('#reader-article')?.childElementCount) {
                const scroll = restore; restore = 0;
                requestAnimationFrame(() => { main.scrollTop = scroll; publish(); });
            } else publish();
        }).catch(error => console.warn('[math-workspace] Reader view state was not saved', error));
    });
    main.addEventListener('scroll', () => {
        clearTimeout(pending);
        pending = window.setTimeout(publish, 180);
    }, { passive: true });
}
