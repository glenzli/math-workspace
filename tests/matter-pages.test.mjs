import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const id = number => 'h-' + number.toString(16).padStart(16, '0');
const document = (filePath, title, number, body = '') => ({ filePath, content: `# #${id(number)} ${title}\n\n${body}\n` });

async function sourceWorkspaceLoader(directory) {
    const output = path.join(directory, 'workspace.cjs');
    await build({ entryPoints: [path.join(repo, 'src/reader/workspace.ts')], outfile: output, bundle: true, format: 'cjs', platform: 'node',
        alias: { '@math-workspace/core': path.join(repo, 'packages/core/src/formal-core.ts') }, logLevel: 'silent' });
    return require(output).loadWorkspaceSnapshot;
}

async function sourceRuntime(directory) {
    const corePath = path.join(directory, 'core.cjs'), rendererPath = path.join(directory, 'renderer.cjs');
    const cliPath = path.join(directory, 'runtime', 'out', 'cli', 'math-workspace.js');
    const [, , , loadWorkspaceSnapshot] = await Promise.all([
        build({ entryPoints: [path.join(repo, 'packages/core/src/formal-core.ts')], outfile: corePath, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' }),
        build({ entryPoints: [path.join(repo, 'src/reader/web/formal-renderer.ts')], outfile: rendererPath, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' }),
        build({ entryPoints: [path.join(repo, 'src/cli/math-workspace.ts')], outfile: cliPath, bundle: true, packages: 'external', format: 'cjs', platform: 'node',
            alias: { '@math-workspace/core': path.join(repo, 'packages/core/src/formal-core.ts') }, loader: { '.png': 'dataurl' }, logLevel: 'silent' }),
        sourceWorkspaceLoader(directory)
    ]);
    await fs.copyFile(path.join(repo, 'package.json'), path.join(directory, 'runtime', 'package.json'));
    return { core: require(corePath), renderer: require(rendererPath), cliPath, loadWorkspaceSnapshot };
}

export async function testMatterPages(runtime) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-matter-pages-'));
    try {
        const { core, renderer, cliPath, loadWorkspaceSnapshot: suppliedLoader } = runtime || await sourceRuntime(directory);
        const loadWorkspaceSnapshot = suppliedLoader || await sourceWorkspaceLoader(directory);
        const documents = [
            document('book1/front-matter/10-author.md', '作者的话', 1),
            document('book1/front-matter/02-ai.md', 'AI 与写作', 2),
            document('book1/vol-1/front-matter/01-volume.md', '卷前寄语', 3),
            document('book1/vol-1/01-main.md', '第一章', 4, `定理 #${id(40)}（First）：True.\n\n定理 #${id(41)}（Second）：True.`),
            document('book1/vol-1/appendix-a-tools.md', '工具', 5),
            document('book1/vol-1/back-matter/01-goodbye.md', '卷后寄语', 6),
            document('book1/vol-1/99-to-be-continued.md', '下一卷再见', 7),
            document('book1/vol-2/02-next.md', '第二章', 8, `定理 #${id(80)}（Third）：True.\n\nSee @${id(9)}.full and @page:book1/back-matter/01-ai.md.title.`),
            document('book1/vol-2/front-matter/01-volume.md', '第二卷前言', 19),
            document('book1/vol-2/appendix-a-tools.md', '第二卷工具', 20),
            document('book1/appendix-b-index.md', '索引', 10),
            document('book1/back-matter/01-ai.md', 'AI 退休寄语', 9),
            document('book1/back-matter/02-summary.md', '概念小结', 11, 'This is an author essay, not an inferred mathematical glossary.'),
            document('book1/to-be-continued.md', '尚未写完的旅程', 12),
            document('book2/01-other.md', '另一册', 13),
            document('book1/front-matter/volume-1-author-note.md', '书级作者前言', 15),
            document('book1/back-matter/vol-3-final-note.md', '书级作者后记', 16),
            document('front-matter/book2-author-note.md', '项目作者前言', 17),
            document('book1/vol-1/back-matter/book2-retirement.md', '卷级作者后记', 18)
        ];
        const state = core.scanFormalDocuments(documents, { language: 'en' });
        assert.deepEqual(state.issues.filter(issue => issue.severity === 'error'), []);
        const page = filePath => state.pages.find(page => page.filePath === filePath);
        assert.equal(state.pages.filter(page => page.kind === 'chapter').length, 3, 'Numeric matter filenames never become chapters.');
        assert.equal(page('book1/front-matter/02-ai.md').chapter, undefined);
        assert.equal(page('book1/front-matter/02-ai.md').unitKey, undefined);
        assert.equal(page('book1/back-matter/01-ai.md').title, 'AI 退休寄语');
        assert.equal(page('book1/vol-1/99-to-be-continued.md').kind, 'continued');
        for (const file of ['book1/front-matter/volume-1-author-note.md', 'book1/back-matter/vol-3-final-note.md']) {
            assert.equal(page(file).bookKey, 'book1');
            assert.equal(page(file).volumeKey, undefined, 'Volume-like filenames cannot assign book-level matter to a volume.');
        }
        assert.equal(page('front-matter/book2-author-note.md').bookKey, '__workspace__', 'A book-like filename cannot create a book scope.');
        assert.equal(page('book1/vol-1/back-matter/book2-retirement.md').bookKey, 'book1');
        assert.equal(page('book1/vol-1/back-matter/book2-retirement.md').volumeKey, 'vol-1', 'Real parent directories remain authoritative.');
        assert.equal(core.formatLabelNumber(state.labels[id(40)]), '1.1');
        assert.equal(core.formatLabelNumber(state.labels[id(41)]), '1.2');
        assert.equal(core.formatLabelNumber(state.labels[id(80)]), '2.1');
        for (const kind of ['front-matter', 'back-matter', 'continued']) assert.equal(core.isPageLabelType(kind), true);
        const afterword = page('book1/back-matter/01-ai.md');
        assert.equal(state.labels[id(9)].type, 'back-matter');
        assert.equal(core.formatLabelNumber(state.labels[id(9)]), '');
        for (const mode of ['default', 'title', 'full']) assert.equal(core.formatPageReference(afterword, state.config, mode), 'AI 退休寄语');
        assert.equal(core.formatPageHeading(afterword, state.config), 'AI 退休寄语');
        assert.equal(state.projectAnalysis.sources.some(source => source.filePath.includes('-matter/')), false, 'Matter titles do not opt essays into mathematical knowledge inference.');
        assert.equal(state.issues.some(issue => issue.code === 'duplicate-special-page'), false, 'Multiple front/back pages are supported.');
        const mismatched = core.scanFormalDocuments([...documents, document('book1/front-matter/link.md', 'Links', 14, '@chapter:book1/back-matter/01-ai.md')], {});
        assert.equal(mismatched.issues.some(issue => issue.code === 'page-ref-kind-mismatch'), true);
        const legacy = [document('book1/intro.md', '旧前言', 21), document('book1/00-introduction.md', '旧导读', 22), document('book1/summary.md', '旧小结', 23)];
        assert.deepEqual(core.scanFormalDocuments(legacy, {}).pages.map(page => page.kind), ['intro', 'intro', 'summary']);
        assert.equal(core.unnumberedPageKind('book1/front-matter/05-summary.md'), 'front-matter');
        assert.equal(core.unnumberedPageKind('book1/back-matter/raw.txt'), undefined);

        const ordinary = core.scanFormalDocuments(documents.filter(document => !core.isManuscriptMatterKind(core.unnumberedPageKind(document.filePath))), {}).pages;
        assert.deepEqual(ordinary.map(page => page.filePath), ['book1/appendix-b-index.md', 'book1/vol-1/01-main.md', 'book1/vol-1/appendix-a-tools.md', 'book1/vol-2/02-next.md', 'book1/vol-2/appendix-a-tools.md', 'book2/01-other.md']);
        assert.deepEqual(core.sortManuscriptPages(ordinary, 'export').map(page => page.filePath), ['book1/vol-1/01-main.md', 'book1/vol-1/appendix-a-tools.md', 'book1/vol-2/02-next.md', 'book1/vol-2/appendix-a-tools.md', 'book1/appendix-b-index.md', 'book2/01-other.md']);
        const legacyVolume = core.scanFormalDocuments([
            document('book1/vol-1/intro.md', 'Intro', 31), document('book1/vol-1/01-main.md', 'Main', 32),
            document('book1/vol-1/summary.md', 'Summary', 33), document('book1/vol-1/appendix-a-index.md', 'Index', 34)
        ], {}).pages;
        assert.deepEqual(legacyVolume.map(page => page.kind), ['intro', 'chapter', 'appendix', 'summary']);
        assert.deepEqual(core.sortManuscriptPages(legacyVolume, 'export').map(page => page.kind), ['intro', 'chapter', 'summary', 'appendix']);
        for (const context of ['reader', 'export']) {
            const ordered = core.sortManuscriptPages(state.pages, context), paths = ordered.map(page => page.filePath);
            assert.deepEqual(ordered.filter(page => !core.isManuscriptMatterKind(page.kind)).map(page => page.filePath), core.sortManuscriptPages(ordinary, context).map(page => page.filePath), 'Ordinary pages retain their legacy relative order.');
            const index = file => paths.indexOf(file);
            assert(index('book1/front-matter/02-ai.md') < index('book1/front-matter/10-author.md'));
            assert(index('book1/front-matter/10-author.md') < index('book1/vol-1/front-matter/01-volume.md'));
            assert(index('book1/front-matter/volume-1-author-note.md') < index('book1/vol-1/01-main.md'));
            assert(index('book1/vol-1/front-matter/01-volume.md') < index('book1/vol-1/01-main.md'));
            assert(index('book1/vol-1/appendix-a-tools.md') < index('book1/vol-1/back-matter/01-goodbye.md'));
            assert(index('book1/vol-1/back-matter/01-goodbye.md') < index('book1/vol-1/99-to-be-continued.md'));
            assert(index('book1/vol-1/99-to-be-continued.md') < index('book1/vol-2/02-next.md'));
            assert(index('book1/back-matter/01-ai.md') > Math.max(index('book1/appendix-b-index.md'), index('book1/vol-2/02-next.md')));
            assert(index('book1/back-matter/02-summary.md') < index('book1/to-be-continued.md'));
            assert(index('book1/back-matter/vol-3-final-note.md') > index('book1/vol-2/02-next.md'));
            assert(index('book1/back-matter/vol-3-final-note.md') < index('book1/to-be-continued.md'));
            assert(index('book1/to-be-continued.md') < index('book2/01-other.md'));
            assert.deepEqual(core.sortManuscriptPages(ordered, context), ordered, 'Ordering remains stable when consumed again.');
        }
        const matterOnly = [
            { kind: 'back-matter', filePath: 'book1/back-matter/end.md', bookKey: 'book1', bookOrder: 1 },
            { kind: 'front-matter', filePath: 'book1/vol-1/front-matter/start.md', bookKey: 'book1', bookOrder: 1, volumeKey: 'vol-1', volumeOrder: 1 },
            { kind: 'continued', filePath: 'book1/to-be-continued.md', bookKey: 'book1', bookOrder: 1 }
        ];
        assert.deepEqual(core.sortManuscriptPages(matterOnly).map(page => page.kind), ['front-matter', 'back-matter', 'continued']);

        if (renderer) {
            const rendered = renderer.renderFormalDocument(renderer.createFormalRenderer(), documents.find(document => document.filePath === afterword.filePath).content,
                { currentFilePath: afterword.filePath, labels: { [id(9)]: { ...state.labels[id(9)], display: 'AI 退休寄语' } }, pages: state.pages, language: 'en' });
            assert.match(rendered.html, /<h1[^>]*>AI 退休寄语<\/h1>/);
            assert.doesNotMatch(rendered.html, /back-matter|Chapter|AI 退休寄语 AI 退休寄语/);
        }
        const workspace = path.join(directory, 'project'); await fs.mkdir(path.join(workspace, '.math-workspace'), { recursive: true });
        const workspaceConfig = { language: 'en', scan: { exclude: ['draft/**', 'z-draft/**'] },
            documents: { collections: [{ id: 'notes', title: 'Draft notes', mode: 'draft', include: ['draft/**', 'z-draft/**'] }] } };
        await fs.writeFile(path.join(workspace, '.math-workspace/config.json'), JSON.stringify(workspaceConfig));
        for (const { filePath, content } of documents) { const full = path.join(workspace, filePath); await fs.mkdir(path.dirname(full), { recursive: true }); await fs.writeFile(full, content); }
        const drafts = [document('draft/01-unfinished.md', 'Draft A', 91), document('z-draft/last.md', 'Draft Z', 92)];
        for (const { filePath, content } of drafts) { const full = path.join(workspace, filePath); await fs.mkdir(path.dirname(full), { recursive: true }); await fs.writeFile(full, content); }
        const snapshot = await loadWorkspaceSnapshot(workspace);
        const runtimePaths = snapshot.state.pages.map(page => page.filePath), runtimeIndex = file => runtimePaths.indexOf(file);
        const ordinaryPaths = snapshot.state.pages.filter(page => !core.isManuscriptMatterKind(page.kind)).map(page => page.filePath);
        const oldRuntimePaths = [...ordinary.map(page => page.filePath), ...drafts.map(document => document.filePath)].sort((a, b) => a.localeCompare(b));
        assert.deepEqual(ordinaryPaths, oldRuntimePaths, 'The real Reader loader preserves ordinary formal/draft relative lexicographic order.');
        assert.equal(snapshot.state.pages.filter(page => page.documentMode === 'draft').length, 2);
        assert.equal(snapshot.state.labels[id(91)], undefined, 'Reader draft aggregation does not introduce formal labels.');
        assert(runtimeIndex('book1/front-matter/02-ai.md') < runtimeIndex('book1/vol-1/01-main.md'));
        assert(runtimeIndex('book1/front-matter/volume-1-author-note.md') < runtimeIndex('book1/vol-1/01-main.md'));
        assert(runtimeIndex('book1/vol-1/front-matter/01-volume.md') < runtimeIndex('book1/vol-1/01-main.md'));
        assert(runtimeIndex('book1/vol-1/back-matter/01-goodbye.md') > runtimeIndex('book1/vol-1/appendix-a-tools.md'));
        assert(runtimeIndex('book1/vol-2/front-matter/01-volume.md') < runtimeIndex('book1/vol-2/02-next.md'));
        assert(runtimeIndex('book1/vol-2/front-matter/01-volume.md') < runtimeIndex('book1/vol-2/appendix-a-tools.md'));
        assert(runtimeIndex('book1/back-matter/01-ai.md') > Math.max(runtimeIndex('book1/vol-2/appendix-a-tools.md'), runtimeIndex('book1/appendix-b-index.md')));
        assert(runtimeIndex('book1/to-be-continued.md') > runtimeIndex('book1/back-matter/vol-3-final-note.md'));
        assert.deepEqual(core.sortManuscriptPages(snapshot.state.pages, 'workspace').map(page => page.filePath), runtimePaths, 'Workspace placement is idempotent after actual loading.');
        const legacyRoot = path.join(directory, 'legacy-project'); await fs.mkdir(path.join(legacyRoot, '.math-workspace'), { recursive: true });
        await fs.writeFile(path.join(legacyRoot, '.math-workspace/config.json'), JSON.stringify(workspaceConfig));
        for (const item of [...documents.filter(document => !core.isManuscriptMatterKind(core.unnumberedPageKind(document.filePath))), ...drafts]) {
            const full = path.join(legacyRoot, item.filePath); await fs.mkdir(path.dirname(full), { recursive: true }); await fs.writeFile(full, item.content);
        }
        assert.deepEqual((await loadWorkspaceSnapshot(legacyRoot)).state.pages.map(page => page.filePath), oldRuntimePaths, 'A real project without new matter retains its complete previous Reader order.');
        console.log('Actual Reader workspace loader matter placement and legacy formal/draft ordering passed.');
        const run = args => spawnSync(process.execPath, [cliPath, ...args], { cwd: workspace, encoding: 'utf8',
            env: { ...process.env, NODE_PATH: path.join(repo, 'node_modules'), MATH_WORKSPACE_STATE: path.join(directory, 'state.json'), MATH_WORKSPACE_READER_INSTANCES: path.join(directory, 'instances.json') } });
        const exported = run(['export-md', 'book1', '--out', 'compiled.md']);
        assert.equal(exported.status, 0, exported.stdout + exported.stderr);
        const output = await fs.readFile(path.join(workspace, 'compiled.md'), 'utf8');
        assert.match(output, /# AI 退休寄语/); assert.doesNotMatch(output, /#h-|@h-|@page:|back-matter/);
        assert.match(output, /See AI 退休寄语 and AI 退休寄语/);
        assert.match(output, /^# Chapter 1 第一章/m);
        assert.match(output, /^# Chapter 2 第二章/m);
        assert(output.indexOf('# AI 与写作') < output.indexOf('# Chapter 1 第一章'));
        assert(output.indexOf('# 书级作者前言') < output.indexOf('# Chapter 1 第一章'));
        assert(output.indexOf('# AI 退休寄语') > output.indexOf('# Chapter 2 第二章'));
        assert(output.indexOf('# AI 退休寄语') > output.indexOf('索引'));
        assert(output.indexOf('# 尚未写完的旅程') > output.indexOf('# AI 退休寄语'));
        assert(output.indexOf('# 书级作者后记') > output.indexOf('# Chapter 2 第二章'));
        assert(output.indexOf('# 书级作者后记') < output.indexOf('# 尚未写完的旅程'));
        const continued = path.join(workspace, 'book1/to-be-continued.md');
        await fs.writeFile(continued, '# #tmp-cont 尚未写完的旅程\n\nSee @tmp-cont.full.\n');
        const finish = run(['finish', 'book1/to-be-continued.md']);
        assert.equal(finish.status, 0, finish.stdout + finish.stderr);
        assert.match(await fs.readFile(continued, 'utf8'), /^# #h-[a-f0-9]{16} 尚未写完的旅程/m);
        assert.doesNotMatch(await fs.readFile(continued, 'utf8'), /tmp-cont/);
        console.log('Matter page source titles/hashes/refs, counter isolation, scoped ordering and compiled Markdown passed.');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testMatterPages();
