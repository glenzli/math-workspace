import assert from 'node:assert/strict';
import { readerToolbarHarness } from './reader-toolbar-menu.test.mjs';
const drain = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

export async function testReaderChangeNavigation() {
    const oldHtml = Array.from({ length: 8 }, (_, i) => `<p id="old-${i}" data-source-start-line="${i * 2 + 1}" data-source-end-line="${i * 2 + 1}">old paragraph ${i}${i === 4 ? '<span class="katex">old formula</span><button>unsafe action</button>' : ''}</p>`).join('');
    const h = await readerToolbarHarness({ sourceActions: true, renderer: { renderFormalDocument: () => ({ html: oldHtml, formulas: [] }) } });
    const { app, document, find, click } = h;
    const visible = () => find('.reader-change-preview-body').querySelector('.reader-article').children.filter(child => !child.hidden);
    try {
        const page = { filePath: 'book/01.md', title: 'Page', documentMode: 'formal' };
        const source = Array.from({ length: 17 }, (_, i) => i === 2 ? '$y$' : i === 12 ? '$x^2+1$' : `current ${i + 1}`).join('\n');
        const formulas = [{ id: 'clean-formula', latex: 'y', source: '$y$', sourceStartLine: 3, sourceEndLine: 3 }, { id: 'changed-formula', latex: 'x^2+1', source: '$x^2+1$', sourceStartLine: 13, sourceEndLine: 13 }];
        app.page = { page, filePath: page.filePath, content: source, sourceHash: 'snapshot', labels: {}, formulas };
        app.state.pages = [page]; app.state.requestToken = 'token-a'; app.applyState(app.state);
        for (const line of [1, 3, 7, 13]) { const p = document.createElement('p'); p.dataset.sourceStartLine = p.dataset.sourceEndLine = String(line); p.textContent = `current ${line}`; if (line === 3 || line === 13) p.dataset.readerFormula = line === 3 ? 'clean-formula' : 'changed-formula'; app.article.append(p); }
        app.sourceActions.bind(app.article, { filePath: page.filePath, source, formulas });
        let pending, finish, failure = false, reads = 0, commit = '1234567890';
        let payload = { filePath: page.filePath, sourceHash: 'snapshot', status: 'ready', baseline: 'HEAD', commit, content: 'previous source', hunks: [{ startLine: 7, count: 1, beforeStartLine: 9, beforeCount: 1 }, { startLine: 13, count: 1, beforeStartLine: 15, beforeCount: 1 }] };
        h.setRequestHandler(async route => {
            if (route === '/api/plugin-context') return { ok: true, json: async () => ({ projectRoot: '/private/tmp/selection-fixture' }) };
            if (route === '/api/file-changes') return { ok: true, json: async () => ({ revision: 1, status: 'ready', files: { [page.filePath]: 'modified' } }) };
            if (route.startsWith('/api/page-changes')) return { ok: true, json: async () => ({ filePath: page.filePath, sourceHash: 'snapshot', commit, status: 'ready', ranges: [{ startLine: 7, endLine: 7 }, { startLine: 13, endLine: 13 }], deletions: [] }) };
            if (route.startsWith('/api/page-before')) { reads++; return pending || (failure ? { ok: false } : { ok: true, json: async () => payload }); }
            throw new Error(route);
        });
        app.uncommitted.bind({ filePath: page.filePath, sourceHash: 'snapshot', project: 'project-a', token: 'token-a' });
        assert.equal(find('.reader-change-navigation').hidden, true);
        click(find('[data-tool-menu="display"]')); click(find('#reader-uncommitted')); await drain();
        assert.equal(app.article.querySelector('[data-change-preview]'), null, 'Changed passages do not acquire persistent controls.');
        const select = async (from, to = from) => {
            const start = app.article.querySelector(`[data-source-start-line="${from}"]`), end = app.article.querySelector(`[data-source-start-line="${to}"]`);
            const text = source.split('\n').slice(Math.min(from, to) - 1, Math.max(from, to)).join('\n');
            h.window.getSelection = () => ({ anchorNode: start.childNodes[0], focusNode: end.childNodes[0], rangeCount: 1, isCollapsed: false,
                toString: () => text, getRangeAt: () => ({ cloneContents: () => document.createTextNode(text), getBoundingClientRect: () => start.getBoundingClientRect() }) });
            document.emit('selectionchange'); h.flushTimers(); await drain();
            return find('.reader-source-popover')?.querySelector('[data-change-preview]');
        };
        const openAt = async line => { const button = await select(line); assert.ok(button, 'The selected change has a contextual compare action.'); click(button); await drain(); return button; };
        await select(1); assert.equal(find('[data-change-preview]'), null, 'Clean selections keep their normal actions.');
        await select(3); assert.equal(find('[data-change-preview]'), null, 'A clean formula has no comparison action.');
        assert.ok(await select(3, 7), 'A selection starting in an unchanged formula still includes later changed prose.');
        const copyLines = find('.reader-source-popover').querySelectorAll('button').find(button => button.getAttribute('aria-label') === h.words.zh.copySourceLines);
        click(copyLines); await drain(); assert.equal(h.copies.at(-1), source.split('\n').slice(2, 7).join('\n'));
        assert.ok(await select(7, 3), 'Backward selections use the same overlapping source range.');
        click(find('.reader-source-reference')); await drain(); assert.equal(h.handoffs.length, 1, 'The existing quote action remains functional.');
        assert.equal(find('.reader-change-navigation').querySelector('[data-change-preview]'), null, 'The corner control only navigates changes.');
        assert.equal(find('.reader-change-count').textContent, '2 处修改');
        click(find('[data-change-next]')); assert.equal(find('.reader-change-count').textContent, '1 / 2');
        assert.equal(app.article.querySelector('[data-source-start-line="7"]').scrolledIntoView, true);
        click(find('[data-change-previous]')); assert.equal(find('.reader-change-count').textContent, '2 / 2');
        await openAt(7);
        const panel = find('#reader-change-preview'), formula = panel.querySelector('.katex');
        assert.equal(panel.getAttribute('role'), 'dialog'); assert.equal(panel.getAttribute('aria-modal'), 'false');
        assert.equal(panel.tagName, 'section', 'Comparison leaves the current manuscript interactive.');
        assert.equal(find('.is-preview-change').dataset.sourceStartLine, '9', 'Current source positions map to the actual old hunk.');
        assert.equal(visible().length, 3, 'Open around the change rather than exposing the full file.');
        assert.ok(formula); assert.equal(panel.querySelector('.reader-article').querySelector('[id]'), null);
        assert.equal(panel.querySelector('.reader-article').querySelector('button'), null);
        assert.equal(app.article.querySelector('[data-source-start-line="7"]').textContent, 'current 7');
        const request = h.createRequests.find(request => request.route.startsWith('/api/page-before'));
        assert.equal(request.options.headers['x-math-workspace-token'], 'token-a');
        assert.equal(request.options.headers['x-math-workspace-project'], 'project-a');
        click(find('[data-preview-expand="before"]')); assert.equal(visible().length, 5);
        click(find('[data-preview-expand="after"]')); assert.equal(visible().length, 7);
        click(find('[data-preview-expand="all"]')); assert.equal(visible().length, 8);
        assert.equal(find('[data-preview-expand="all"]').disabled, true);
        assert.equal(panel.querySelector('.katex'), formula, 'Expanding preserves rendered math and its DOM identity.');
        assert.equal(reads, 1, 'Context expansion uses the already requested old version.');
        click(app.article.querySelector('[data-source-start-line="7"]'));
        assert.equal(find('#reader-change-preview'), panel, 'Reading or selecting current prose does not dismiss old context.');
        h.preferences.setLanguage('en'); app.changeNavigation.update();
        assert.equal(find('[data-preview-expand="before"]').textContent, '↑ Earlier context');
        assert.equal((await select(7)).getAttribute('aria-label'), 'Compare previous content');
        assert.equal(panel.querySelector('.katex'), formula, 'Language changes do not rerender or reset expanded context.');
        h.flushTimers(); await drain();
        assert.equal(app.article.querySelector('[data-change-preview]'), null, 'Polling does not add controls to manuscript content.');
        assert.equal(find('#reader-change-preview'), panel);

        // Exercise production pointer admission, capture cleanup, viewport bounds and keyboard movement.
        h.window.innerWidth = 1200;
        panel.getBoundingClientRect = () => {
            const left = Number.parseFloat(panel.style.left) || 12, top = Number.parseFloat(panel.style.top) || 12;
            return { left, top, right: left + 400, bottom: top + 300, width: 400, height: 300 };
        };
        h.window.emit('resize');
        const grip = find('[data-preview-drag]'), originalLeft = panel.style.left;
        grip.emit('pointerdown', { pointerId: 4, button: 2, clientX: 100, clientY: 100 });
        grip.emit('pointermove', { pointerId: 4, clientX: 200, clientY: 200 }); assert.equal(panel.style.left, originalLeft);
        grip.emit('pointerdown', { pointerId: 7, button: 0, clientX: 100, clientY: 100 });
        grip.emit('pointermove', { pointerId: 8, clientX: 200, clientY: 200 }); assert.equal(panel.style.left, originalLeft);
        grip.emit('pointermove', { pointerId: 7, clientX: 300, clientY: 200 }); assert.notEqual(panel.style.left, originalLeft);
        const draggedLeft = panel.style.left;
        grip.emit('pointercancel', { pointerId: 7 });
        grip.emit('pointermove', { pointerId: 7, clientX: 500, clientY: 300 }); assert.equal(panel.style.left, draggedLeft);
        assert.equal(grip.classList.contains('is-dragging'), false);
        click(find('[data-change-next]'));
        assert.equal(find('.is-preview-change').dataset.sourceStartLine, '15');
        assert.equal(panel.style.left, draggedLeft, 'Following the next change retains the manually placed comparison window.');
        assert.equal(reads, 1, 'Switching changes reuses the same old snapshot.');
        assert.equal(app.article.querySelector('.is-current-change').dataset.sourceStartLine, '13');
        assert.equal(find('[data-change-next]').getAttribute('aria-expanded'), null, 'Change navigation keeps its button semantics while updating the open preview.');
        h.window.innerWidth = 500; h.window.emit('resize'); assert.ok(Number.parseFloat(panel.style.left) <= 88);
        grip.emit('keydown', { key: 'ArrowLeft' }); assert.ok(Number.parseFloat(panel.style.left) >= 12);
        grip.emit('keydown', { key: 'Home' });
        grip.focus(); h.key('Escape'); assert.equal(find('#reader-change-preview'), null); assert.ok(document.activeElement === find('[data-change-next]'));

        h.window.getSelection = () => undefined;
        const currentFormula = app.article.querySelector('[data-reader-formula="changed-formula"]');
        click(currentFormula);
        const formulaMenu = find('.reader-source-popover');
        assert.ok(formulaMenu.querySelector('[data-change-preview]'), 'Clicking a changed formula offers compare in its usual menu.');
        click(formulaMenu.querySelectorAll('button')[0]); await drain(); assert.equal(h.copies.at(-1), 'x^2+1', 'Formula copy keeps exact LaTeX.');
        click(formulaMenu.querySelector('[data-change-preview]')); await drain(); assert.equal(find('.is-preview-change').dataset.sourceStartLine, '15');
        app.changeNavigation.closePreview(); assert.ok(document.activeElement === currentFormula, 'Closing comparison returns focus to content when the source menu has gone.');

        failure = true; await openAt(7); assert.ok(find('[data-preview-retry]'));
        failure = false; click(find('[data-preview-retry]')); await drain(); assert.ok(find('.is-preview-change'));
        app.changeNavigation.closePreview();
        payload = { ...payload, hunks: [{ startLine: 6, count: 0, beforeStartLine: 3, beforeCount: 3 }] };
        await openAt(7); assert.equal(find('.is-preview-change').dataset.sourceStartLine, '3', 'A deletion locates removed prose, not its new neighbor.');
        app.changeNavigation.closePreview();
        payload = { ...payload, hunks: [{ startLine: 7, count: 1, beforeStartLine: 6, beforeCount: 0 }] };
        await openAt(7); assert.ok(find('.is-preview-location')); assert.match(find('[data-preview-description]').textContent, /Added here/);
        app.changeNavigation.closePreview();
        payload = { ...payload, baseline: 'new-file', content: undefined };
        await openAt(7); assert.match(find('[data-preview-message]').textContent, /This file is new/);
        assert.equal(find('[data-preview-expand="all"]').disabled, true);
        app.changeNavigation.closePreview();
        pending = new Promise(resolve => { finish = resolve; }); await openAt(7);
        const pendingRequest = h.createRequests.filter(request => request.route.startsWith('/api/page-before')).at(-1);
        app.page = { ...app.page, filePath: 'other.md', sourceHash: 'other' }; app.changeNavigation.update();
        assert.equal(pendingRequest.options.signal.aborted, true);
        finish({ ok: true, json: async () => ({ ...payload, baseline: 'HEAD', content: 'old response' }) }); await drain();
        assert.equal(find('#reader-change-preview'), null, 'A late response cannot revive old content after navigation.');
        app.page = { ...app.page, filePath: page.filePath, sourceHash: 'snapshot' }; app.changeNavigation.update(); pending = undefined;
        payload = { ...payload, baseline: 'HEAD', content: 'old source' }; await openAt(7);
        commit = 'new-head'; h.flushTimers(); await drain();
        assert.equal(find('#reader-change-preview'), null, 'A changed HEAD invalidates the old snapshot even when current source bytes are unchanged.');
        await select(7); assert.ok(find('[data-change-preview]'));
        app.uncommitted.setEnabled(false); assert.equal(find('[data-change-preview]'), null, 'Disabling markers removes compare from an already open selection menu.');
        app.uncommitted.setEnabled(true); await drain(); assert.ok(find('[data-change-preview]'), 'Loaded markers add compare to an existing matching selection.');
        app.uncommitted.setEnabled(false);
        assert.equal(find('.reader-change-navigation').hidden, true);
        console.log('Reader selection/formula comparison: contextual entry, clean/cross/backward selection, copy/quote preservation, mapped/deleted/added old context, continuous expansion, nonmodal math, drag/keyboard/bounds, polling identity and stale snapshot rejection passed.');
    } finally { app.sourceActions.dispose(); app.fullSearch.dispose(); app.changeNavigation.dispose(); app.uncommitted.dispose(); h.restore(); }
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) await testReaderChangeNavigation();
