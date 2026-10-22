import assert from 'node:assert/strict';
import { readerToolbarHarness } from './reader-toolbar-menu.test.mjs';
const drain = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
export async function testReaderChangeNavigation() {
    const h = await readerToolbarHarness({ renderer: { renderFormalDocument: (_renderer, content) => ({ html: `<p data-source-start-line="3" data-source-end-line="3">${content}</p><span class="katex">math</span>`, formulas: [] }) } });
    const { app, document, find, click } = h;
    try {
        const page = { filePath: 'book/01.md', title: 'Page', documentMode: 'formal' };
        app.page = { page, filePath: page.filePath, content: 'current source', sourceHash: 'snapshot', labels: {} };
        app.state.pages = [page]; app.state.requestToken = 'token-a'; app.applyState(app.state);
        for (const line of [3, 7]) { const p = document.createElement('p'); p.dataset.sourceStartLine = p.dataset.sourceEndLine = String(line); p.textContent = 'current'; app.article.append(p); }
        let pending, finish;
        h.setRequestHandler(async route => {
            if (route === '/api/file-changes') return { ok: true, json: async () => ({ revision: 1, status: 'ready', files: { [page.filePath]: 'modified' } }) };
            if (route.startsWith('/api/page-changes')) return { ok: true, json: async () => ({ filePath: page.filePath, sourceHash: 'snapshot', status: 'ready', ranges: [{ startLine: 3, endLine: 3 }, { startLine: 7, endLine: 7 }], deletions: [] }) };
            if (route.startsWith('/api/page-before')) return pending || { ok: true, json: async () => ({ filePath: page.filePath, sourceHash: 'snapshot', status: 'ready', baseline: 'HEAD', commit: '1234567890', content: 'previous source', hunks: [{ startLine: 3, count: 1, beforeStartLine: 3, beforeCount: 1 }] }) };
            throw new Error(route);
        });
        app.uncommitted.bind({ filePath: page.filePath, sourceHash: 'snapshot', project: 'project-a', token: 'token-a' });
        assert.equal(find('.reader-change-navigation').hidden, true);
        click(find('[data-tool-menu="display"]')); click(find('#reader-uncommitted')); await drain();
        assert.equal(find('.reader-change-navigation').hidden, false); assert.equal(find('.reader-change-count').textContent, '2 处修改');
        click(find('[data-change-next]')); assert.equal(find('.reader-change-count').textContent, '1 / 2');
        assert.equal(app.article.querySelector('[data-source-start-line="3"]').scrolledIntoView, true);
        click(find('[data-change-previous]')); assert.equal(find('.reader-change-count').textContent, '2 / 2');
        click(find('[data-change-preview]')); await drain(); assert.match(find('.reader-change-preview-body').textContent, /previous source/);
        assert.ok(find('.reader-change-preview-body').querySelector('.katex')); assert.ok(find('.is-preview-change'));
        click(find('[data-preview-mode="current"]')); assert.match(find('.reader-change-preview-body').textContent, /current source/);
        h.preferences.setLanguage('en'); app.changeNavigation.update(); assert.equal(find('[data-preview-mode="before"]').textContent, 'Last commit');
        app.changeNavigation.closePreview(); pending = new Promise(resolve => { finish = resolve; }); click(find('[data-change-preview]')); await drain();
        app.page = { ...app.page, filePath: 'other.md', sourceHash: 'other' }; app.changeNavigation.update();
        finish({ ok: true, json: async () => ({ filePath: page.filePath, sourceHash: 'snapshot', status: 'ready', content: 'old response' }) }); await drain();
        assert.equal(find('#reader-change-preview'), null, 'A late response cannot preview the previous page in the new context.');
        console.log('Reader floating change navigation: ordered/wrapping jumps, rendered old/current versions, localization and stale preview rejection passed.');
    } finally { app.fullSearch.dispose(); app.changeNavigation.dispose(); app.uncommitted.dispose(); h.restore(); }
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) await testReaderChangeNavigation();
