import { isReaderApp } from './reader-host';
import { readerFetch } from './reader-route';

export const emptyReaderImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Local image bytes cross MCP; object URLs live only as long as their article. */
export function mountReaderAssets(article: HTMLElement): () => void {
    if (!isReaderApp()) return () => {};
    let disposed = false;
    const urls = new Set<string>();
    for (const image of article.querySelectorAll<HTMLImageElement>('img[data-reader-asset]')) {
        void readerFetch(image.dataset.readerAsset!).then(async response => {
            if (!response.ok) throw new Error(await response.text());
            const blob = await response.blob();
            if (disposed || !image.isConnected) return;
            const url = URL.createObjectURL(blob); urls.add(url); image.src = url;
        }).catch(error => { if (!disposed) console.warn('[math-workspace] Reader image unavailable', error); });
    }
    return () => { disposed = true; urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
}
