import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const cli = path.join(repo, 'out/cli/math-workspace.js');
const h = digit => `h-${digit.repeat(16)}`;
const chapter = 'book1/01-foundations.md';
const appendix = 'book1/appendix-h-solutions.md';
const question = [
    '# Chapter 1', '',
    `定理 #${h('1')}（基础）：基础结论。`, '', '证明：直接成立。', '',
    `习题 #${h('2')}（计算）：由 @${h('1')} 开始。`, '',
    '第二段题面，包含 $x^2$。', '', '**(a)** 计算下式。', '', '$$', 'x^2 + 1', '$$', '',
    '```text', 'Hint: this is literal code inside the question.', '```', '',
    '提示：先考虑特殊情况。', '',
    `再使用 @${h('1')}。`, '',
    '解答：这是本地解答。', '',
    `由 @${h('1')} 可得。`, '',
    `Exercise #${h('3')} (Second): Another question.`, '',
    `Lemma #${h('4')} (After): The theorem sequence continues.`, '', 'Proof: immediate.', ''
].join('\n');
const solution = [
    '# Appendix H', '',
    `解答 #${h('5')}（对应 @${h('2')}；另一种方法）：这是附录解答。`, '',
    `先应用 @${h('1')}。`, '', '$$', 'x^2 = x x', '$$', '',
    `Solution #${h('6')} (for @${h('2')}): Alternative answer.`, '',
    'Second answer paragraph.', ''
].join('\n');

export const exerciseFixture = { question, solution, chapter, appendix };

function run(root, args) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
}
async function json(root, name) { return JSON.parse(await fs.readFile(path.join(root, '.math-workspace', name), 'utf8')); }

export async function testExercises() {
    const core = require(path.join(repo, 'packages/core/out/formal-core.js'));
    const documents = [{ filePath: chapter, content: question }, { filePath: appendix, content: solution }];
    const state = core.scanFormalDocuments(documents, {});
    assert.deepEqual(state.issues.filter(issue => issue.severity === 'error'), []);
    assert.equal(state.labels[h('2')].number, 1);
    assert.equal(state.labels[h('3')].number, 2);
    assert.equal(state.labels[h('4')].number, 2);
    assert.equal(state.labels[h('5')].solutionOf, h('2'));
    assert.equal(core.formatLabelNumber(state.labels[h('5')]), '1.1');
    assert.deepEqual(state.labels[h('2')].solutions, [h('5'), h('6')]);
    assert.match(state.labels[h('2')].content, /第二段题面/);
    assert.match(state.labels[h('2')].content, /x\^2 \+ 1/);
    assert.match(state.labels[h('2')].content, /literal code/);
    assert.doesNotMatch(state.labels[h('2')].content, /先考虑|本地解答|附录解答/);
    assert.equal(state.labels[h('2')].supportRanges.length, 2);
    assert.equal(state.dependencyGraph.summary.theoremLikeNodes, 2);
    assert.equal(state.dependencyGraph.summary.pedagogicalNodes, 4);
    assert.equal(state.dependencyGraph.pedagogicalLinks.length, 2);
    assert.equal(state.dependencyGraph.edges.some(edge => edge.from === h('5') && edge.to === h('2')), false);
    assert.equal(state.dependencyGraph.edges.find(edge => edge.from === h('5') && edge.to === h('1')).where, 'proof');
    assert.equal(state.dependencyGraph.cycles.length, 0);
    const impact = core.renderDependencyGraphImpact(state.dependencyGraph, h('1'));
    assert.match(impact, /Downstream impacted nodes: 3/);
    assert.match(impact, /习题 1.1 的解答/);
    const warning = core.scanFormalDocuments([{ filePath: chapter, content: question.replace('基础结论。', `依赖 @${h('2')}。`) }, documents[1]], {});
    assert.ok(warning.dependencyGraph.diagnostics.some(issue => issue.code === 'mainline-references-exercise'));
    for (const source of [solution.replace(`对应 @${h('2')}`, `对应 @${h('1')}`), solution.replace(`对应 @${h('2')}`, `对应 @${h('9')}`)]) {
        assert.ok(core.scanFormalDocuments([documents[0], { filePath: appendix, content: source }], {}).issues.some(issue => issue.code === 'solution-target-invalid'));
    }
    const duplicate = core.scanFormalDocuments([...documents, { filePath: 'book1/02-duplicate.md', content: `# Chapter 2\n\nExercise #${h('2')}: Duplicate.` }], {});
    assert.ok(duplicate.issues.some(issue => issue.code.includes('duplicate')));
    for (const alias of ['习题', '练习', 'Exercise']) assert.equal(core.parseFormalMarkerLine(`${alias} #tmp-ex (Title): Body.`)?.type, 'exercise');
    for (const alias of ['答案', '解答', 'Solution', 'Answer']) assert.equal(core.parseFormalMarkerLine(`${alias} #tmp-answer (for @tmp-ex): Body.`)?.solutionOf, 'tmp-ex');
    for (const [kind, policy] of Object.entries(core.FORMAL_KIND_POLICIES)) for (const alias of policy.aliases) {
        if (kind === 'def') continue;
        assert.equal(core.parseFormalMarkerLine(`${alias} #${h('a')} (Title): Body.`)?.type, kind, alias);
    }
    assert.ok(core.DEFAULT_CONFIG.lean.coverageTypes.includes('exercise'));

    // A final exercise or solution must not absorb the chapter's footer; fenced examples remain intact.
    const terminalQuestion = `${question}\nExercise #${h('7')} (Last): Keep this prompt.\n\n\`\`\`text\n---\n# Literal heading\n\`\`\`\n\nFinal prompt paragraph.\n`;
    const terminalSolution = `${solution}\nSolution #${h('8')} (for @${h('7')}): Final solution paragraph.\n`;
    let terminalState;
    for (const separator of ['----', '* * *', '___']) {
        terminalState = core.scanFormalDocuments([
            { filePath: chapter, content: `${terminalQuestion}\n${separator}\n\n*Chapter footer*\n` },
            { filePath: appendix, content: `${terminalSolution}\n${separator}\n\n*Solution footer*\n` }
        ], {});
        assert.deepEqual(terminalState.issues.filter(issue => issue.severity === 'error'), []);
        assert.match(terminalState.labels[h('7')].content, /Literal heading/);
        assert.match(terminalState.labels[h('7')].content, /Final prompt paragraph/);
        assert.doesNotMatch(terminalState.labels[h('7')].content, /Chapter footer/);
        assert.doesNotMatch(terminalState.labels[h('8')].proofContent, /Solution footer/);
    }

    const bundleDir = await fs.mkdtemp(path.join(os.tmpdir(), 'math-exercise-renderer-'));
    await build({ configFile: false, logLevel: 'silent', build: { outDir: bundleDir, emptyOutDir: true,
        lib: { entry: { renderer: path.join(repo, 'src/reader/web/formal-renderer.ts'), markers: path.join(repo, 'src/reader/dependency-markers.ts') }, formats: ['cjs'], fileName: (_format, name) => `${name}.cjs` }, minify: false } });
    const renderer = require(path.join(bundleDir, 'renderer.cjs'));
    const { projectReaderDependencyMarkers } = require(path.join(bundleDir, 'markers.cjs'));
    const labels = Object.fromEntries(state.definitions.filter(def => def.id).map(def => [def.id, { ...def.label, display: core.displayLabel(def, state.config) }]));
    const markers = projectReaderDependencyMarkers(state.dependencyGraph, chapter);
    assert.equal(markers[h('1')].directDependents, 0, 'Pedagogical references must not increase mainline rank');
    assert.equal(markers[h('2')].kind, 'pedagogical');
    const rendered = renderer.renderFormalDocument(renderer.createFormalRenderer(), question, { currentFilePath: chapter, labels, pages: state.pages, language: 'zh', dependencyMarkers: markers });
    assert.equal(renderer.renderFormalInline(renderer.createFormalRenderer(), 'Chapter title', { currentFilePath: chapter, labels, pages: state.pages, language: 'zh' }), 'Chapter title');
    assert.match(rendered.html, /reader-exercise-links/);
    assert.ok(rendered.html.indexOf('reader-exercise-links') < rendered.html.indexOf('<details'));
    assert.match(rendered.html, /<details[^>]*data-exercise-support="hint">/);
    assert.doesNotMatch(rendered.html, /<details[^>]*\bopen/);
    assert.equal(rendered.formulas.some(formula => formula.latex.includes('x^2 + 1')), true);
    assert.equal(rendered.formulas.find(formula => formula.latex.includes('x^2 + 1')).sourceStartLine, question.split('\n').indexOf('$$') + 1);
    assert.ok(rendered.html.lastIndexOf('</details>') < rendered.html.indexOf(`id="formal-${h('3')}"`));
    const answerHtml = renderer.renderFormalMarkdown(renderer.createFormalRenderer(), solution, { currentFilePath: appendix, labels, pages: state.pages, language: 'en' });
    assert.equal((answerHtml.match(/<details/g) || []).length, 2);
    assert.equal((answerHtml.match(/<\/details>/g) || []).length, 2);
    assert.match(answerHtml, /Back to exercise/);
    assert.doesNotMatch(answerHtml, /对应|for @/);
    assert.equal((answerHtml.match(new RegExp(`id="formal-${h('5')}"`, 'g')) || []).length, 1);

    const terminalLabels = Object.fromEntries(terminalState.definitions.filter(def => def.id).map(def => [def.id, { ...def.label, display: core.displayLabel(def, terminalState.config) }]));
    const chapterEndHtml = renderer.renderFormalMarkdown(renderer.createFormalRenderer(), `${terminalQuestion}\n----\n\n*Chapter footer*\n`, { currentFilePath: chapter, labels: terminalLabels, pages: terminalState.pages, language: 'en' });
    assert.ok(chapterEndHtml.lastIndexOf('reader-exercise-links') < chapterEndHtml.indexOf('Chapter footer'), 'The answer link belongs before the footer');
    const appendixEndHtml = renderer.renderFormalMarkdown(renderer.createFormalRenderer(), `${terminalSolution}\n----\n\n*Solution footer*\n`, { currentFilePath: appendix, labels: terminalLabels, pages: terminalState.pages, language: 'en' });
    assert.ok(appendixEndHtml.lastIndexOf('</details>') < appendixEndHtml.indexOf('Solution footer'), 'The footer must stay outside the collapsible solution');

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'math-exercises-contract-'));
    await fs.mkdir(path.join(root, 'book1'), { recursive: true });
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.mkdir(path.join(root, 'formal/src'), { recursive: true });
    await fs.writeFile(path.join(root, chapter), question);
    await fs.writeFile(path.join(root, appendix), solution);
    await fs.writeFile(path.join(root, '.math-workspace/config.json'), JSON.stringify({ lean: { projects: [{ key: 'fixture', root: 'formal', sourceRoots: ['src'], anchorPrefix: 'Book anchor:' }] } }));
    await fs.writeFile(path.join(root, 'formal/src/Fixture.lean'), [h('1'), h('2'), h('5')].map((id, index) => `/-- Book anchor: ${id} -/\ntheorem t${index} : True := by trivial`).join('\n'));
    run(root, ['lean', 'capture']);
    let index = await json(root, 'lean-index.json');
    assert.equal(index.summary.eligibleFormalObjects, 4, 'Solutions do not double-count exercise coverage');
    assert.equal(index.anchors[h('2')].status.contract, 'current');
    await fs.writeFile(path.join(root, appendix), solution.replace('附录解答', '修改后的附录解答'));
    run(root, ['lean', 'verify']);
    index = await json(root, 'lean-index.json');
    assert.equal(index.anchors[h('2')].status.contract, 'markdown-drifted');
    assert.deepEqual(index.anchors[h('2')].status.markdownChanges, ['proof']);
    await fs.writeFile(path.join(root, appendix), solution);
    await fs.writeFile(path.join(root, chapter), question.replace('第二段题面', '修改后的第二段题面'));
    run(root, ['lean', 'verify']);
    index = await json(root, 'lean-index.json');
    assert.equal(index.anchors[h('2')].status.contract, 'markdown-drifted');
    assert.equal(index.anchors[h('5')].status.contract, 'markdown-drifted', 'A question change requires its answer to be reviewed');
    await fs.writeFile(path.join(root, chapter), question.replace('证明：直接成立。', '证明：补充一步后成立。'));
    run(root, ['lean', 'verify']);
    index = await json(root, 'lean-index.json');
    assert.deepEqual(index.anchors[h('1')].status.markdownChanges, ['proof']);
    await fs.writeFile(path.join(root, chapter), question);
    const contracts = await json(root, 'lean-contracts.json');
    delete contracts.anchors[h('1')].proofFingerprint;
    await fs.writeFile(path.join(root, '.math-workspace/lean-contracts.json'), JSON.stringify(contracts));
    run(root, ['lean', 'verify']);
    assert.equal((await json(root, 'lean-index.json')).anchors[h('1')].status.contract, 'untracked');
    run(root, ['export-md', 'book1', '--out', 'compiled.md']);
    const exported = await fs.readFile(path.join(root, 'compiled.md'), 'utf8');
    assert.match(exported, /习题 1\.1 的解答/);
    assert.doesNotMatch(exported, /对应|for @|#h-|@h-/);
    assert.match(exported, /本地解答/);
    assert.match(exported, /附录解答/);

    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'math-exercises-finalize-'));
    await fs.mkdir(path.join(temporaryRoot, 'book1'));
    await fs.writeFile(path.join(temporaryRoot, chapter), '# Chapter 1\n\n习题 #tmp-question（题目）：计算。\n');
    await fs.writeFile(path.join(temporaryRoot, appendix), '# Appendix H\n\n解答 #tmp-answer（对应 @tmp-question）：答案。\n');
    run(temporaryRoot, ['finish', 'book1', '--all']);
    const finalized = await json(temporaryRoot, 'workspace-index.json');
    const exercise = Object.entries(finalized.entries).find(([, label]) => label.type === 'exercise');
    const answer = Object.entries(finalized.entries).find(([, label]) => label.type === 'solution');
    assert.match(exercise[0], /^h-[a-f0-9]{16}$/);
    assert.equal(answer[1].solutionOf, exercise[0]);
    assert.notEqual(exercise[0], answer[0]);
    await fs.appendFile(path.join(temporaryRoot, chapter), '\n由 习题 1.1 可得。\n');
    run(temporaryRoot, ['migrate-text-refs', '--all', '--apply']);
    assert.match(await fs.readFile(path.join(temporaryRoot, chapter), 'utf8'), new RegExp(`由 @${exercise[0]} 可得`));
    await fs.rm(bundleDir, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { await testExercises(); console.log('ok - native exercises, Reader, export and proof drift'); }
