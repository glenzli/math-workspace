import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readerUiLabels } from './reader-ui-harness.mjs';
import { readerToolbarHarness } from './reader-toolbar-menu.test.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const drain = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const response = value => ({ ok: true, status: 200, json: async () => structuredClone(value), text: async () => '' });

export async function testReaderUiLanguage() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-ui-language-'));
    let h;
    try {
        const output = path.join(temporary, 'renderer.cjs');
        await build({ entryPoints: [path.join(root, 'src/reader/web/formal-renderer.ts')], outfile: output,
            bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent', plugins: [{ name: 'shared-reader-label-owner', setup(builder) {
                builder.onResolve({ filter: /reader-ui-labels$/ }, () => ({ path: 'labels', namespace: 'fixture' }));
                builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: Object.keys(readerUiLabels).map(key => `export const ${key} = globalThis.__readerUiLanguageLabels.${key};`).join('\n') }));
            } }] });
        globalThis.__readerUiLanguageLabels = readerUiLabels;
        const renderer = require(output); delete globalThis.__readerUiLanguageLabels; let renders = 0;
        h = await readerToolbarHarness({ publication: true, renderer: { ...renderer,
            renderFormalDocument(...args) { renders++; return renderer.renderFormalDocument(...args); } } });
        const { app, find, click, key, document, preferences } = h;
        app.markdown = renderer.createFormalRenderer();
        const id = 'h-aaaaaaaaaaaaaaaa';
        const page = { kind: 'chapter', filePath: 'book/01.md', title: '原稿标题', displayHeading: '第1章 原稿标题', bookKey: 'book',
            documentMode: 'formal', lifecycle: { stage: 'stable', checkpoint: { label: '关闭', recordedAt: '', contentHash: 'same' }, changedSinceCheckpoint: true },
            integration: { status: 'managed', stableAnchorCount: 1, temporaryAnchorCount: 0, issueCount: 0 } };
        const source = `# 原稿标题\n\n定理 #${id}（原稿结论）：正文保持中文。\n\n引用 @${id}。\n`;
        app.state = { ...app.state, available: true, language: 'zh', requestToken: 'token-a', pages: [page] };
        app.page = { filePath: page.filePath, page, content: source, labels: { [id]: { type: 'theorem', title: '原稿结论', filePath: page.filePath, display: '定理 1.1', number: 1 } },
            dependencyMarkers: { [id]: { kind: 'statement', role: 'terminal', directDependencies: 0, directDependents: 0, impactCount: 0,
                sourceReferenceCount: 0, upstream: [], downstream: [], leanDeclarationCount: 1, leanStatus: { contract: 'current', build: 'passed', dependencies: 'matched' } } }, symbols: [] };
        app.renderNavigation(); app.renderArticle(); app.main.scrollTop = 387;
        const manuscriptNodes = [...app.article.childNodes], originalText = app.article.textContent;
        const status = find('[data-document-status]'), navRow = find('.reader-nav-page');
        const display = find('[data-tool-menu="display"]'); click(display);
        const menu = find('#reader-category-menu'), language = find('#reader-interface-language'), appearance = find('#reader-appearance');
        const primaryButtons = find('.reader-tools').querySelectorAll('button').map(value => value.id || value.dataset.panel);
        language.focus();
        for (const value of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.equal(key(value).defaultPrevented, false, 'Native select keys stay native.');
        assert.equal(key('Tab').defaultPrevented, false); appearance.focus();
        assert.equal(menu.hidden, false); assert.equal(language.tabIndex, 0); assert.equal(appearance.tabIndex, 0);
        const requestsBefore = h.createRequests.length;
        language.value = 'en'; language.emit('change');
        assert.equal(menu.hidden, false); assert.equal(find('#reader-interface-language'), language); assert.equal(find('#reader-appearance'), appearance);
        assert.equal(language.getAttribute('aria-label'), 'Interface language'); assert.equal(appearance.getAttribute('aria-label'), 'Appearance');
        assert.equal(display.getAttribute('aria-label'), 'Display'); assert.equal(status.querySelector('.reader-document-stage-label').textContent, h.words.en.documentStageStable);
        assert.match(status.dataset.readerTooltip, /Changed|changed/); assert.match(navRow.getAttribute('aria-label'), /Document stage/);
        assert.match(find('[data-reader-lean-anchor]').getAttribute('aria-label'), /^Lean anchor:/);
        assert.equal(app.state.language, 'zh'); assert.equal(app.article.lang, 'zh'); assert.equal(app.page.content, source);
        assert.equal(app.article.textContent, originalText); assert.equal(renders, 1); assert.equal(app.main.scrollTop, 387);
        assert.ok(manuscriptNodes.every((node, index) => app.article.childNodes[index] === node), 'The formal document is the same mounted tree.');
        assert.match(app.article.textContent, /定理 1\.1/); assert.doesNotMatch(app.article.textContent, /Theorem 1\.1/);
        assert.equal(h.createRequests.length, requestsBefore, 'Relabeling cannot fetch or rewrite source.');
        for (const value of ['dark', 'light', 'auto']) { appearance.value = value; appearance.emit('change'); assert.equal(preferences.snapshot().themePreference, value); }
        assert.deepEqual(find('.reader-tools').querySelectorAll('button').map(value => value.id || value.dataset.panel), primaryButtons, 'Preferences add no primary toolbar controls.');
        assert.equal(renders, 1); key('Escape');

        const scopes = [{ container: '.', kind: 'project', label: '项目根目录' }, { container: 'book', kind: 'book', label: '原稿书名' }];
        h.setRequestHandler(async route => {
            if (route.startsWith('/api/create-page/scopes?')) return response({ projectRoot: '/private/tmp/reader-fixture', scopes, defaultContainer: 'book' });
            if (route.startsWith('/api/create-page/plan?')) {
                const input = Object.fromEntries(new URLSearchParams(route.split('?')[1]));
                return response({ projectRoot: '/private/tmp/reader-fixture', plan: { ...input, filePath: 'book/new.md', exists: false, stateToken: 'a'.repeat(64) },
                    assistantCommand: { executable: '/actual/node', cwd: '/private/tmp/reader-fixture', args: [] } });
            }
            if (route === '/api/publication') return response({ pages: [{ path: page.filePath, title: page.title, kind: 'chapter', book: 'book' },
                { path: 'book/front.md', title: '原稿前文', kind: 'front-matter', book: 'book' }], profiles: [], tools: { pandoc: { available: true }, engine: { available: true } }, credentialStatus: [] });
            throw new Error('Unexpected fixture route ' + route);
        });
        click(find('#reader-create-page')); await drain();
        const creation = find('#reader-create-page-dialog'), title = find('#reader-create-title'), scope = find('#reader-create-scope');
        title.value = '关闭'; title.emit('input'); h.flushTimers(); await drain(); title.focus(); title.selectionStart = 1; title.selectionEnd = 2;
        const creationRequests = h.createRequests.length;
        preferences.setLanguage('zh');
        assert.equal(find('#reader-create-title'), title); assert.equal(find('#reader-create-scope'), scope); assert.equal(title.value, '关闭'); assert.equal(scope.value, 'book');
        assert.equal(title.selectionStart, 1); assert.equal(title.selectionEnd, 2); assert.equal(document.activeElement, title);
        assert.equal(creation.querySelector('h1').textContent, '新建页面'); assert.equal(h.createRequests.length, creationRequests);
        preferences.setLanguage('en'); assert.equal(creation.querySelector('h1').textContent, 'New page'); assert.equal(title.value, '关闭');
        app.createPage.close(false);

        await app.publication.open();
        const publication = find('.reader-publication'); publication.querySelector('.publication-steps').children[1].emit('click');
        const titleInput = publication.querySelectorAll('input').find(value => value.getAttribute('aria-label') === 'Book title / title');
        assert.ok(titleInput, 'Publication details are wired to the interface locale.');
        titleInput.value = '关闭'; titleInput.emit('input'); titleInput.focus(); titleInput.selectionStart = 0; titleInput.selectionEnd = 1;
        const picker = publication.querySelector('[data-publication-file="frontMatter-1"]');
        const publicationLanguage = publication.querySelectorAll('select').find(value => value.getAttribute('aria-label') === 'Publication language');
        assert.equal(publicationLanguage.value, 'zh', 'New publication profiles default to the manuscript locale.');
        const publicationRequests = h.createRequests.length, profile = JSON.stringify(app.publication.profile);
        preferences.setLanguage('zh');
        assert.equal(find('.reader-publication'), publication); assert.equal(publication.querySelector('[data-publication-file="frontMatter-1"]'), picker);
        assert.equal(titleInput.value, '关闭'); assert.equal(titleInput.selectionStart, 0); assert.equal(titleInput.selectionEnd, 1); assert.equal(document.activeElement, titleInput);
        assert.equal(titleInput.getAttribute('aria-label'), '书名 / 标题'); assert.equal(publicationLanguage.getAttribute('aria-label'), '出版语言'); assert.equal(publicationLanguage.value, 'zh');
        assert.match(publication.textContent, /封面/); assert.match(picker.getAttribute('aria-label'), /前文/);
        assert.equal(JSON.stringify(app.publication.profile), profile); assert.equal(h.createRequests.length, publicationRequests);
        preferences.setLanguage('en'); assert.equal(titleInput.getAttribute('aria-label'), 'Book title / title'); assert.match(picker.getAttribute('aria-label'), /Front matter/);
        assert.equal(JSON.stringify(app.publication.profile), profile); assert.equal(h.createRequests.length, publicationRequests); assert.equal(renders, 1);
        app.publication.close();
        const copy = document.createElement('button'), copyLabel = () => preferences.snapshot().language === 'zh' ? '复制' : 'Copy';
        copy.setAttribute('aria-label', copyLabel()); copy.setAttribute('data-tooltip', copyLabel()); document.body.append(copy);
        readerUiLabels.readerLabel(copy, copyLabel);
        const restoreCopy = readerUiLabels.readerTemporaryLabel(copy, () => preferences.snapshot().language === 'zh' ? '已复制' : 'Copied');
        preferences.setLanguage('zh'); assert.equal(copy.getAttribute('aria-label'), '已复制');
        restoreCopy(); assert.equal(copy.getAttribute('aria-label'), '复制');
        preferences.setLanguage('en'); assert.equal(copy.getAttribute('aria-label'), 'Copy'); assert.equal(copy.dataset.tooltip, 'Copy');
        copy.remove();
        console.log('Reader UI preferences: actual menu events, native select keys, manuscript separation and open creation/publication draft preservation passed.');
    } finally {
        delete globalThis.__readerUiLanguageLabels;
        h?.app.createPage.dispose(); h?.app.publication.close(); h?.app.toolbarPanel.dispose(); h?.app.toolbarMenu.dispose(); h?.restore();
        await fs.rm(temporary, { recursive: true, force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderUiLanguage();
