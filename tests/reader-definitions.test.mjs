import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export async function testReaderDefinitions() {
    const bundle = await fs.mkdtemp(path.join(os.tmpdir(), 'math-definition-renderer-'));
    try {
        await build({ configFile: false, logLevel: 'silent', build: {
            outDir: bundle, emptyOutDir: true, minify: false,
            lib: { entry: path.join(repo, 'src/reader/web/formal-renderer.ts'), formats: ['cjs'], fileName: () => 'renderer.cjs' }
        } });
        const { createFormalRenderer, renderFormalMarkdown } = require(path.join(bundle, 'renderer.cjs'));
        const markdown = createFormalRenderer();
        const options = { currentFilePath: 'book/01-intro.md', labels: {}, pages: [], language: 'zh' };
        const render = source => renderFormalMarkdown(markdown, source, options);
        for (const source of [
            '定义（距离）：正文 $d(x,y)$。',
            '**定义（距离）**：正文 $d(x,y)$。',
            '**定义（距离）：**正文 $d(x,y)$。',
            '__定义（距离）__：正文 $d(x,y)$。',
            'Definition (Distance): Body $d(x,y)$.',
            '**Definition (Distance)**: Body $d(x,y)$.',
            '### 定义（距离）'
        ]) {
            const html = render(source);
            assert.equal((html.match(/data-reader-definition=/g) || []).length, 1, source);
            assert.match(html, /<strong class="reader-definition-label">(?:定义（距离）|Definition \(Distance\))[:：]?<\/strong>/);
            assert.doesNotMatch(html, /id="formal-|data-reader-dependency|reader-lean-anchor|katex-error/);
            if (source.includes('$')) assert.match(html, /<\/strong>[^]*class="reader-formula"/);
        }
        const mathTitle = render('定义（$d_i$ 分量）：正文。\n\n后续说明。');
        assert.match(mathTitle, /data-reader-definition="定义（\$d_i\$ 分量）"/);
        assert.match(mathTitle, /reader-definition-label[^]*katex[^]*<\/strong>：正文/);
        assert.match(mathTitle, /<p[^>]*>后续说明。<\/p>/);
        assert.equal((mathTitle.match(/data-reader-definition=/g) || []).length, 1);
        const quoted = render('> 定义（子空间）：正文。');
        assert.match(quoted, /<blockquote\b[^>]*>[^]*data-reader-definition/);
        for (const source of [
            '这里提到定义（距离）：并未定义新对象。',
            '**普通术语**：说明。',
            '`定义（距离）：代码。`',
            '```md\n定义（距离）：代码。\n```',
            '    定义（距离）：代码。',
            '定义可以通过开球说明。'
        ]) assert.doesNotMatch(render(source), /data-reader-definition=|reader-definition-label/);
        const labels = {
            'h-section': { type: 'section', title: '基本对象', display: '1.1', filePath: options.currentFilePath },
            'h-lemma': { type: 'lemma', title: '基本性质', display: '引理 1.1', filePath: options.currentFilePath }
        };
        const mixed = renderFormalMarkdown(markdown,
            '## #h-section 基本对象\n\n定义（距离）：正文。\n\n**引理 #h-lemma（基本性质）**：结论。', { ...options, labels });
        assert.ok(mixed.indexOf('id="formal-h-section"') < mixed.indexOf('data-reader-definition='));
        assert.ok(mixed.indexOf('data-reader-definition=') < mixed.indexOf('id="formal-h-lemma"'));
        assert.equal((mixed.match(/data-reader-definition=/g) || []).length, 1);
    } finally {
        await fs.rm(bundle, { recursive: true, force: true });
    }
}
