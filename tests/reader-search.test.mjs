import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { readerToolbarHarness } from './reader-toolbar-menu.test.mjs';

const require = createRequire(import.meta.url), root = path.resolve(new URL('..', import.meta.url).pathname);
const drain = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
export async function testReaderSearch() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-search-'));
    try {
        await build({ entryPoints: [path.join(root, 'src/reader/search.ts')], outfile: path.join(temporary, 'search.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
        const { searchReaderDocuments: search } = require(path.join(temporary, 'search.cjs'));
        const source = '# A chapter\n\n有限覆盖保证紧性。Compactness is useful.\n\nInline $\\alpha_{n} \\le \\frac{1}{n^{2}}$ here.\n\n\\[\nf(x) = x^{2} + 1\n\\]\n\n$R \\subseteq \\mathbb{C}$\n\n`$not_a_formula$`\n\n````markdown\n$code_only$\n```\n$still_code$\n````\n\n$a + b = c$\n';
        const documents = new Map([['book/a.md', source], ['draft/idea.md', '# Idea\n\n探索稿也可全文检索。\n']]);
        const pages = [...documents.keys()].map(filePath => ({ filePath, title: filePath }));
        const find = (query, mode = 'all') => search(documents, pages, query, mode);
        assert.equal(find('有限覆盖').hits[0].startLine, 3);
        assert.equal(find('COMPACTNESS').hits[0].kind, 'text');
        assert.equal(find('compctness').hits[0].match, 'fuzzy');
        assert.equal(find('全文检索').hits[0].filePath, 'draft/idea.md');
        for (const query of ['αₙ ≤ 1/n²', '\\alpha_n <= 1/n2', 'f(x)=x2+1', 'f(x) = x² + 1']) {
            const hit = find(query).hits[0]; assert.ok(hit, query); assert.equal(hit.kind, 'formula'); assert.equal(hit.match, 'notation');
        }
        assert.equal(find('\\alhpa_n<=1/n2').hits[0].match, 'fuzzy');
        assert.equal(find('f(x)=x2-1', 'formula').hits.length, 0, 'Fuzzy matching does not substitute a different arithmetic operator.');
        assert.equal(find('a-b=c', 'formula').hits.length, 0);
        assert.equal(find('code_only', 'formula').hits.length, 0); assert.equal(find('still_code', 'formula').hits.length, 0);
        assert.equal(find('not_a_formula', 'formula').hits.length, 0);
        assert.ok(find('code_only').hits.length, 'Code remains searchable as text.');
        const formula = find('f(x)=x²+1').hits[0]; assert.equal(formula.startLine, 7); assert.equal(formula.endLine, 9); assert.equal(formula.latex, 'f(x) = x^{2} + 1');
        assert.equal(find('  ').hits.length, 0);
        assert.equal(search(documents, pages, 'a', 'all', 1).truncated, true);
        await ui();
        console.log('Reader full-text search: CJK/English, notation and typo tolerance, protected operators, code boundaries, source lines, dialog cancellation and cross-project guards passed.');
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
async function ui() {
    const h = await readerToolbarHarness({ renderer: { renderReaderFormula: () => '<span class="katex">original formula</span>' } }), { app, find, click, document } = h;
    try {
        app.state.requestToken = 'token-a'; app.applyState(app.state);
        const opened = []; app.openPage = async (...args) => { opened.push(args); };
        let finish, pending;
        h.setRequestHandler(async route => {
            assert.ok(route.startsWith('/api/search?'));
            if (pending) return pending;
            const query = new URLSearchParams(route.split('?')[1]).get('q');
            return { ok: true, json: async () => ({ revision: app.state.revision, query, hits: [{ filePath: 'book/02.md', title: 'A formula', startLine: 12, endLine: 14, kind: 'formula', match: 'notation', latex: 'x^{2}+1', excerpt: 'x^{2}+1' }], truncated: false }) };
        });
        click(find('#reader-search')); const input = find('#reader-search-query'); input.value = 'x²+1'; input.emit('input');
        assert.equal(h.createRequests.length, 0); h.flushTimers(); await drain();
        assert.ok(find('.reader-search-hit').querySelector('.katex'));
        assert.match(find('.reader-search-hit-kind').textContent, /相似公式/);
        h.preferences.setLanguage('en'); app.fullSearch.contextChanged(); assert.equal(input.value, 'x²+1'); assert.equal(document.activeElement, input);
        assert.equal(find('.reader-search-hit-kind').textContent, 'Similar formula');
        click(find('.reader-search-hit')); await drain(); assert.equal(find('#reader-search-dialog'), null);
        assert.deepEqual(JSON.parse(JSON.stringify(opened[0])), ['book/02.md', 'push', '', false, { line: 12 }]);
        click(find('#reader-search')); input.value = 'ignored';
        const newInput = find('#reader-search-query'); newInput.value = 'pending'; pending = new Promise(resolve => { finish = resolve; }); newInput.emit('input'); h.flushTimers(); await drain();
        app.fullSearch.close(); finish({ ok: true, json: async () => ({ revision: 1, query: 'pending', hits: [] }) }); await drain(); assert.equal(find('#reader-search-dialog'), null);
        pending = undefined; click(find('#reader-search')); app.applyState({ ...app.state, projectId: 'other', revision: 2 });
        assert.equal(find('#reader-search-dialog'), null, 'Switching projects closes search and invalidates queued results.');
    } finally { app.fullSearch.dispose(); app.changeNavigation.dispose(); app.uncommitted.dispose(); h.restore(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await testReaderSearch();
