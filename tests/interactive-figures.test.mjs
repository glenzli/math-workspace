import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export async function testInteractiveFigures({ makeWorkspace, runCli, startReader, stopReader }) {
    const bundle = await fs.mkdtemp(path.join(os.tmpdir(), 'math-figure-renderer-'));
    await build({ configFile: false, logLevel: 'silent', build: { outDir: bundle, emptyOutDir: true,
        lib: { entry: path.join(repo, 'src/reader/web/formal-renderer.ts'), formats: ['cjs'], fileName: () => 'renderer.cjs' }, minify: false } });
    const renderer = require(path.join(bundle, 'renderer.cjs'));
    const markdown = renderer.createFormalRenderer();
    const options = { currentFilePath: 'book1/01-a.md', labels: {}, pages: [], language: 'zh' };
    const figure = '[![转移图](figures/graph.svg)](figures/graph.html "交互图")';
    const html = renderer.renderFormalMarkdown(markdown, figure, options);
    assert.match(html, /reader-interactive-figure/);
    assert.match(html, /data-figure-source="book1\/figures\/graph.html"/);
    assert.match(html, /src="\/api\/asset\?path=book1%2Ffigures%2Fgraph.svg"/);
    assert.doesNotMatch(html, /<script|<iframe/);
    assert.match(renderer.renderFormalMarkdown(markdown, figure.replace('交互图', 'Interactive figure'), options), /reader-interactive-figure/);
    for (const literal of [
        figure.replace('"交互图"', '"普通链接"'),
        figure.replace('](figures/graph.html', '](https://example.com/graph.html'),
        figure.replace('figures/graph.svg', 'https://example.com/graph.svg'),
        '文字 ' + figure,
        '```md\n' + figure + '\n```',
        '<iframe src="evil.html"></iframe>'
    ]) assert.doesNotMatch(renderer.renderFormalMarkdown(markdown, literal, options), /class="reader-interactive-figure"/);

    const captionOptions = { ...options, labels: {
        'h-caption': { type: 'figure', display: '图 5.1', title: '观察 $x$', filePath: options.currentFilePath },
        'h-other': { type: 'prop', display: '命题 1.1', title: '参考', filePath: options.currentFilePath }
    } };
    const caption = '**图 #h-caption（观察 $x$）**：说明 $x$ 与 @h-other。';
    for (const visual of [figure, '![图](figures/graph.svg)']) {
        const rendered = renderer.renderFormalMarkdown(markdown, visual + '\n\n' + caption + '\n\n正文继续。', captionOptions);
        assert.match(rendered, /<figure class="reader-figure">/);
        assert.match(rendered, /<figcaption[^>]*id="formal-h-caption"[^>]*class="formal-anchor reader-figure-caption"/);
        assert.match(rendered, /reader-figure-title/);
        assert.match(rendered, /reader-figure-description/);
        assert.match(rendered, /class="formal-reference"[^>]*data-formal-ref="h-other"/);
        assert.match(rendered, /katex/);
        assert.match(rendered, /<\/figcaption>\s*<\/figure>\s*<p[^>]*>正文继续。/);
    }
    const ordinary = renderer.renderFormalMarkdown(markdown, '![图](figures/graph.svg)\n\n**说明**：普通正文。', options);
    assert.doesNotMatch(ordinary, /reader-figure-caption/);
    await build({ configFile: false, logLevel: 'silent', build: { outDir: bundle, emptyOutDir: false,
        lib: { entry: path.join(repo, 'src/figures/captions.ts'), formats: ['cjs'], fileName: () => 'captions.cjs' }, minify: false } });
    const { figureMarkdownForPdf, splitFigureCaption } = require(path.join(bundle, 'captions.cjs'));
    assert.deepEqual(splitFigureCaption('图 5.1（含 $a:b$）：说明 $x$。'), { title: '图 5.1（含 $a:b$）', description: '说明 $x$。' });
    const portable = '![图](figures/graph.svg)\n\n**Figure A.1 (Values $x$)**: Explanation $x$.\n\nFollowing text.';
    const print = figureMarkdownForPdf(portable);
    assert.match(print, /\\begin\{minipage\}\{\\linewidth\}/);
    assert.match(print, /\\small\\color\[gray\]\{0.25\}\\centering/);
    assert.match(print, /Explanation \$x\$\./);
    assert.match(print, /\\end\{minipage\}[^]*Following text\.$/);
    assert.equal(figureMarkdownForPdf('```md\n' + portable + '\n```'), '```md\n' + portable + '\n```');
    assert.equal(figureMarkdownForPdf('![图](figures/graph.svg)\n\nOrdinary paragraph.'), '![图](figures/graph.svg)\n\nOrdinary paragraph.');

    const root = await makeWorkspace('interactive-figures');
    await fs.mkdir(path.join(root, 'book1/figures'));
    await fs.writeFile(path.join(root, 'book1/01-a.md'), '# Example\n\n' + figure + '\n\n```md\n' + figure + '\n```\n');
    await fs.writeFile(path.join(root, 'book1/figures/graph.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="5" y="25">x</text></svg>');
    const source = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="figure">Figure</div><script>document.body.dataset.rendered="yes"</script></body></html>';
    await fs.writeFile(path.join(root, 'book1/figures/graph.html'), source);
    const exportResult = runCli(root, ['export-md', 'book1', '--out', 'compiled.md']);
    assert.equal(exportResult.status, 0, exportResult.stdout + exportResult.stderr);
    const output = await fs.readFile(path.join(root, 'compiled.md'), 'utf8');
    assert.match(output, /!\[转移图\]\(<book1\/figures\/graph.svg>\)/);
    assert.equal(output.split('```')[0].includes('graph.html'), false);
    assert.match(output.split('```')[1], /graph.html/, 'Code examples must remain literal');
    const split = runCli(root, ['export-md-split', 'book1', '--out', 'public']);
    assert.equal(split.status, 0, split.stdout + split.stderr);
    assert.match(await fs.readFile(path.join(root, 'public/book1/01-a.md'), 'utf8'), /!\[转移图\]\(<figures\/graph.svg>\)/);

    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'math-figure-outside-'));
    await fs.writeFile(path.join(outside, 'external.html'), 'outside');
    await fs.symlink(path.join(outside, 'external.html'), path.join(root, 'book1/figures/link.html'));
    const reader = await startReader(root, { env: { MATH_WORKSPACE_STATE: path.join(root, 'reader-state.json') } });
    try {
        const response = await fetch(reader.url + '/api/figure?path=book1%2Ffigures%2Fgraph.html');
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-security-policy'), /sandbox allow-scripts/);
        assert.doesNotMatch(response.headers.get('content-security-policy'), /allow-same-origin/);
        assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        const served = await response.text();
        assert.match(served, /mode: "interactive"/);
        // Exercise the actual served bridge: only its parent may change reader typography.
        const properties = new Map(), handlers = new Map(), parent = {};
        vm.runInNewContext(served.match(/<script>([^]*?)<\/script>/)[1], {
            window: {}, parent, document: { documentElement: { style: {
                setProperty: (name, value) => properties.set(name, value)
            } } }, addEventListener: (event, handler) => handlers.set(event, handler),
            requestAnimationFrame: () => 0
        });
        const typography = { type: 'math-workspace-figure', event: 'typography', fontFamily: '"Songti SC", serif', fontSize: 20 };
        handlers.get('message')({ source: {}, data: typography });
        assert.equal(properties.size, 0);
        handlers.get('message')({ source: parent, data: typography });
        assert.equal(properties.get('--math-workspace-font-family'), typography.fontFamily);
        assert.equal(properties.get('--math-workspace-font-size'), '20px');
        for (const fontSize of [0, 1000, NaN, '20px']) handlers.get('message')({ source: parent, data: { ...typography, fontSize } });
        assert.equal(properties.get('--math-workspace-font-size'), '20px');
        handlers.get('message')({ source: parent, data: { ...typography, fontSize: 24 } });
        assert.equal(properties.get('--math-workspace-font-size'), '24px');
        const staticResponse = await fetch(reader.url + '/api/figure?path=book1%2Ffigures%2Fgraph.html&mode=static');
        assert.match(await staticResponse.text(), /mode: "static"/);
        for (const file of ['book1/figures/link.html', '../outside.html', '/etc/passwd', 'book1/figures/graph.svg']) {
            assert.equal((await fetch(reader.url + '/api/figure?path=' + encodeURIComponent(file))).status, 403, file);
        }
        assert.equal((await fetch(reader.url + '/api/asset?path=book1%2Ffigures%2Fgraph.html')).status, 403);
        assert.equal((await fetch(reader.url + '/api/figure?path=book1%2Fmissing.html')).status, 404);
        assert.equal(await fs.readFile(path.join(root, 'book1/figures/graph.html'), 'utf8'), source, 'Reader never modifies authored figure bytes');
    } finally { await stopReader(reader.child); }
}
