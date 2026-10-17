import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MarkdownIt = require('markdown-it');
const markdown = new MarkdownIt({ html: true });
const bannerUrl = 'https://raw.githubusercontent.com/glenzli/math-workspace/main/media/readme/banner.jpg';
const sample = [
    '~~~~markdown',
    '# #tmp-1 Natural-number addition',
    '## #tmp-2 Zero',
    '<a name="en"></a>',
    '[English](#en)',
    `![Banner in a code example](${bannerUrl})`,
    'Theorem #tmp-3: For every natural number $n$, $n+0=n$.',
    '~~~',
    '~~~~'
].join('\n');
const formula = String.raw`$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$`;
const bracketFormula = String.raw`\[
\begin{aligned}
x+y &= y+x \\
x+0 &= x
\end{aligned}
\]`;

function fixture(order) {
    const bodies = {
        'zh-cn': [
            '<a name="zh-cn"></a>', '', '## 🇨🇳 中文', '',
            '中文正文保留：界面语言与书稿语言独立。', '', `![中文横幅](${bannerUrl})`, '',
            '## 阅读与写作', '', '### Codex 插件', '', sample, '', formula, '', bracketFormula,
            '', '![Lean 对照](media/readme/lean-review.jpg)', '', '中文结尾保留。'
        ].join('\n'),
        en: [
            '<a name="en"></a>', '', '## 🌍 English', '',
            'English prose stays: interface language is independent of manuscript language.', '',
            '![English banner](media/readme/banner.png)', '',
            '### Reading and writing', '', '#### Codex plugin', '',
            '```json', '{"language":"zh-CN","title":"$n+0=n$"}', '```', '',
            '![Lean comparison](media/readme/lean-review.jpg)', '', 'English ending stays.'
        ].join('\n')
    };
    return ['# Math Workspace', '', `![Existing banner](${bannerUrl})`, '',
        '[🌍 English](#en) | [🇨🇳 中文](#zh-cn)', '', '---', '',
        ...order.flatMap((language, index) => [bodies[language], ...(index < order.length - 1 ? ['', '---', ''] : [])]),
        ''].join('\n');
}

function assertReadingStructure(output) {
    const html = markdown.render(output);
    assert.equal((html.match(/<h1>/g) || []).length, 1, 'The bilingual README has one document title.');
    assert.deepEqual([...html.matchAll(/<h2>(.*?)<\/h2>/g)].map(match => match[1]), ['中文', 'English']);
    assert.equal((html.match(/<a id="zh-cn"><\/a>/g) || []).length, 1);
    assert.equal((html.match(/<a id="en"><\/a>/g) || []).length, 1, 'Language jumps use explicit stable HTML anchors.');
    assert.equal((html.match(/href="#zh-cn"/g) || []).length, 2);
    assert.equal((html.match(/href="#en"/g) || []).length, 2, 'Each language has a top navigation link and a reciprocal jump.');
    assert.equal((html.match(/<img [^>]*src="[^"]*media\/readme\/banner\.(?:png|jpe?g)"/g) || []).length, 1,
        'Only one rendered screenshot banner survives, while examples can contain their own literal Markdown.');
    assert.ok(html.includes('<h3>阅读与写作</h3>'));
    assert.ok(html.includes('<h3>Reading and writing</h3>'));
    assert.ok(html.includes('<h4>Codex 插件</h4>'));
    assert.ok(html.includes('<h4>Codex plugin</h4>'), 'Both languages retain the same heading hierarchy beneath their wrapper.');
    assert.ok(output.indexOf('中文正文保留') < output.indexOf('English prose stays'), 'Chinese is first in the document body.');
    assert.match(output, /\[中文\]\(#zh-cn\) \| \[English\]\(#en\)/);
}

function fencedContents(source) {
    return markdown.parse(source, {}).filter(token => token.type === 'fence').map(token => token.info + '\n' + token.content).sort();
}

function proseContents(source) {
    const navigationText = new Set(['🌍 English', '🇨🇳 中文', 'English', '中文', ' | ']);
    return markdown.parse(source, {}).filter(token => token.type === 'inline').flatMap(token => token.children || [])
        .filter(token => token.type === 'text' && !navigationText.has(token.content)).map(token => token.content).sort();
}

export async function testReaderPreferenceDocs() {
    const existing = await fs.readFile(path.join(root, 'README.md'), 'utf8');
    const { postprocessReadme } = require('../scripts/postprocess-readme.js');
    assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), existing,
        'Importing the transformer for tests must not write generated documentation.');

    const input = fixture(['en', 'zh-cn']);
    const output = postprocessReadme(input);
    assertReadingStructure(output);
    assert.equal(postprocessReadme(output), output, 'Repeated postprocessing is byte-identical.');
    assert.equal(postprocessReadme(fixture(['zh-cn', 'en'])), output, 'Compiler language ordering does not affect the final README.');
    assert.ok(output.includes(sample), 'Code headings, language anchors, banner Markdown, and short fence runs stay intact inside examples.');
    assert.ok(output.includes(formula));
    assert.ok(output.includes(bracketFormula), 'Display LaTeX stays intact.');
    assert.deepEqual(fencedContents(output), fencedContents(input));
    assert.deepEqual(proseContents(output), proseContents(input), 'Both translations retain all rendered prose.');
    for (const prose of ['中文正文保留：界面语言与书稿语言独立。', 'English prose stays: interface language is independent of manuscript language.',
        '中文结尾保留。', 'English ending stays.']) assert.ok(output.includes(prose));
    assert.equal((markdown.render(output).match(/<img [^>]*src="media\/readme\/lean-review.jpg"/g) || []).length, 2,
        'Other screenshot references in both languages are preserved.');

    const current = postprocessReadme(existing);
    assert.equal(postprocessReadme(current), current);
    assert.deepEqual(fencedContents(current), fencedContents(existing), 'The real README retains every existing code example.');
    assert.deepEqual(proseContents(current), proseContents(existing), 'The real README retains both translations without losing prose.');
    assert.throws(() => postprocessReadme('## Missing document title\n'), /level-one heading/);
    assert.throws(() => postprocessReadme(input.replace('<a name="zh-cn"></a>', '')), /exactly one Chinese and one English/);
    assert.throws(() => postprocessReadme(input + '\n<a id="en"></a>\n'), /exactly one Chinese and one English/);
    assert.throws(() => postprocessReadme(input.replace('# Math Workspace\n', '# Math Workspace\n\nUnexpected prose.\n')),
        /unexpected content before/, 'Unexpected prelude content is rejected rather than silently dropped.');

    console.log('Reader preference documentation: Chinese-first README, stable language jumps, banner, heading hierarchy and content-preserving idempotence passed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testReaderPreferenceDocs();
