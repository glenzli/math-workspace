import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const page = (title, number) => `# #h-${number.toString(16).padStart(16, '0')} ${title}\n\n`;

async function sourceRuntime(directory, suppliedCli) {
    const helperPath = path.join(directory, 'create.cjs');
    const corePath = path.join(directory, 'core.cjs');
    const apiPath = path.join(directory, 'runtime/out/cli/reader-create-api.cjs');
    const handoffPath = path.join(directory, 'handoff.cjs');
    const cliPath = suppliedCli || path.join(directory, 'runtime/out/cli/math-workspace.js');
    const common = { bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent',
        alias: { '@math-workspace/core': path.join(repo, 'packages/core/src/formal-core.ts') } };
    await Promise.all([
        build({ ...common, entryPoints: [path.join(repo, 'src/manuscript/create-page.ts')], outfile: helperPath }),
        build({ ...common, entryPoints: [path.join(repo, 'packages/core/src/formal-core.ts')], outfile: corePath }),
        build({ ...common, entryPoints: [path.join(repo, 'src/reader/reader-create-api.ts')], outfile: apiPath }),
        build({ ...common, entryPoints: [path.join(repo, 'src/reader/web/reader-create-page.ts')], outfile: handoffPath }),
        ...(suppliedCli ? [] : [build({ ...common, entryPoints: [path.join(repo, 'src/cli/math-workspace.ts')], outfile: cliPath,
            packages: 'external', loader: { '.png': 'dataurl' } })])
    ]);
    if (!suppliedCli) await fs.copyFile(path.join(repo, 'package.json'), path.join(directory, 'runtime/package.json'));
    return { helper: require(helperPath), core: require(corePath), cliPath,
        readerCreateApi: require(apiPath).handleReaderCreatePageRoute, createPageHandoff: require(handoffPath).createPageHandoff };
}

async function write(root, file, content) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
}

async function tree(root, directory = root, rows = []) {
    for (const name of (await fs.readdir(directory)).sort()) {
        const absolute = path.join(directory, name), stat = await fs.lstat(absolute);
        const file = path.relative(root, absolute).split(path.sep).join('/');
        rows.push([file, stat.isSymbolicLink() ? await fs.readlink(absolute) : stat.isDirectory() ? 'directory' : await fs.readFile(absolute, 'utf8')]);
        if (stat.isDirectory()) await tree(root, absolute, rows);
    }
    return rows;
}

export async function testManuscriptCreation({ cliPath: suppliedCli } = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-create-page-'));
    try {
        const { helper, core, cliPath, readerCreateApi, createPageHandoff } = await sourceRuntime(directory, suppliedCli);
        const { manuscriptCreationScopes, planManuscriptPage: plan, createManuscriptPage: create } = helper;
        const root = path.join(directory, 'project');
        const config = { language: 'en', scan: { exclude: ['excluded/**', 'draft/**', 'book1/front-matter/*-blocked.md'] },
            documents: { collections: [{ id: 'drafts', title: 'Drafts', mode: 'draft', include: ['draft/**', 'book1/back-matter/*-private.md'] }] } };
        await write(root, '.math-workspace/config.json', JSON.stringify(config));
        const originals = new Map([
            ['book1/vol-1/01-base.md', page('Base', 1)], ['book1/vol-2/02-next.md', page('Next', 2)],
            ['book2/01-other.md', page('Other book', 3)], ['formal-text/01-root.md', page('Formal scope', 4)],
            ['book1/front-matter/04-author.md', page('Author', 5)], ['book1/vol-1/99-to-be-continued.md', page('An existing ending', 6)],
            ['excluded/book5/01-hidden.md', page('Excluded', 7)], ['draft/book6/01-draft.md', page('Draft', 8)]
        ]);
        for (const [file, content] of originals) await write(root, file, content);
        await fs.mkdir(path.join(root, 'book4/volume-II 空间'), { recursive: true });
        const outside = path.join(directory, 'outside'); await fs.mkdir(outside);
        await fs.symlink(outside, path.join(root, 'book7'));
        const before = await tree(root);
        const scopes = await manuscriptCreationScopes(root);
        assert.deepEqual(scopes.map(scope => scope.container), ['.', 'book1', 'book1/vol-1', 'book1/vol-2', 'book2', 'book4', 'book4/volume-II 空间', 'formal-text']);
        assert.equal(scopes.find(scope => scope.container === 'book1/vol-2').kind, 'volume');
        assert.equal(scopes.find(scope => scope.container === 'formal-text').kind, 'formal');
        assert(!scopes.some(scope => /matter|excluded|draft|book7/.test(scope.container)));
        const input = { kind: 'front-matter', title: 'AI 与写作：第 2 次（终）?!', container: 'book1' };
        const planned = await plan(root, input);
        assert.equal(planned.filePath, 'book1/front-matter/05-ai-与写作-第-2-次-终.md');
        assert.equal(planned.exists, false); assert.match(planned.stateToken, /^[a-f0-9]{64}$/);
        assert.deepEqual(await plan(root, input), planned);
        assert.deepEqual(await tree(root), before, 'Planning and scope discovery leave every source/configuration byte and directory untouched.');
        assert.equal((await plan(root, { kind: 'chapter', title: 'Root page', container: '.' })).filePath, '02-root-page.md');
        assert.equal((await plan(root, { kind: 'chapter', title: 'Next chapter', container: 'book1/vol-2' })).filePath, 'book1/vol-2/03-next-chapter.md');
        assert.equal((await plan(root, { kind: 'chapter', title: 'Fresh', container: 'book4/volume-II 空间' })).filePath, 'book4/volume-II 空间/01-fresh.md');

        for (const container of ['/tmp', '../book1', './book1', 'book1/', 'book1/../book2', 'book1\\vol-1', 'C:/book1', 'book1/front-matter', 'excluded/book5', 'draft/book6', 'book7', 'Book 1', 'unknown']) {
            await assert.rejects(plan(root, { ...input, container }));
        }
        for (const title of ['', ' ', 'bad\nheading', 'bad\n', '\tbad', 'bad\u2028heading', 'bad\0heading']) await assert.rejects(plan(root, { ...input, title }));
        for (const slug of ['../escape', '/escape', '.hidden', 'bad\\path', 'bad.md', 'bad\nline', 'bad?', 'bad.', ' bad']) await assert.rejects(plan(root, { ...input, slug }));
        await assert.rejects(plan(root, { ...input, kind: 'continued', slug: 'ending' }), /canonical filename/);
        await assert.rejects(plan(root, { ...input, slug: 'blocked' }), /excluded/);
        await assert.rejects(plan(root, { kind: 'back-matter', title: 'Private', container: 'book1', slug: 'private' }), /draft collection/);
        await assert.rejects(plan(root, { ...input, slug: 'to-be-continued' }), /requested page kind/);
        const created = await create(root, input, { expectedStateToken: planned.stateToken });
        assert.match(created.id, /^h-[a-f0-9]{16}$/); assert.equal(created.created, true);
        assert.equal(await fs.readFile(path.join(root, created.filePath), 'utf8'), `# #${created.id} ${input.title}\n\n`);
        const newPage = core.scanFormalDocuments([{ filePath: created.filePath, content: await fs.readFile(path.join(root, created.filePath), 'utf8') }], config).pages[0];
        assert.equal(newPage.id, created.id); assert.equal(newPage.kind, input.kind); assert.equal(newPage.chapter, undefined);
        for (const [file, content] of originals) assert.equal(await fs.readFile(path.join(root, file), 'utf8'), content, `Creation must preserve ${file}.`);
        assert.equal(await fs.readFile(path.join(root, '.math-workspace/config.json'), 'utf8'), JSON.stringify(config));
        const duplicate = await plan(root, input);
        assert.equal(duplicate.exists, true); assert.equal(duplicate.existingFile, created.filePath);
        assert.equal(duplicate.existingTitle, input.title);
        const beforeConflict = await tree(root);
        await assert.rejects(create(root, input), /already exists/);
        assert.deepEqual(await tree(root), beforeConflict, 'Conflict never replaces a source or leaves a lock/temp file.');
        await assert.rejects(create(root, { ...input, title: 'Changed request' }, { expectedStateToken: planned.stateToken }), /changed after this plan/);
        const staleInput = { kind: 'back-matter', container: 'book1', title: 'Afterword' };
        const stale = await plan(root, staleInput);
        await fs.appendFile(path.join(root, 'book2/01-other.md'), 'A source change.\n');
        await assert.rejects(create(root, staleInput, { expectedStateToken: stale.stateToken }), /changed after this plan/);
        const configStale = await plan(root, staleInput);
        await fs.writeFile(path.join(root, '.math-workspace/config.json'), JSON.stringify({ ...config, language: 'zh' }));
        await assert.rejects(create(root, staleInput, { expectedStateToken: configStale.stateToken }), /changed after this plan/);
        await fs.writeFile(path.join(root, '.math-workspace/config.json'), JSON.stringify(config));

        const ending = await plan(root, { kind: 'continued', title: 'A different title', container: 'book1/vol-1' });
        assert.equal(ending.filePath, 'book1/vol-1/to-be-continued.md'); assert.equal(ending.exists, true);
        assert.equal(ending.existingFile, 'book1/vol-1/99-to-be-continued.md'); assert.equal(ending.existingTitle, 'An existing ending');
        await assert.rejects(create(root, { kind: 'continued', title: 'A different title', container: 'book1/vol-1' }), /already exists/);
        for (const container of ['book1', 'book1/vol-2', '.']) {
            const endingInput = { kind: 'continued', title: `Continuation for ${container}`, container };
            const result = await create(root, endingInput);
            assert.equal(result.filePath, container === '.' ? 'to-be-continued.md' : `${container}/to-be-continued.md`);
            assert.equal((await plan(root, endingInput)).existingFile, result.filePath);
        }
        const unicodeInput = { kind: 'back-matter', title: 'Élan, 空间 & “quotes”', container: 'book2', slug: 'Élan' };
        await write(root, 'book2/back-matter/01-E\u0301lan.md', page('Already here', 90));
        assert.equal((await plan(root, unicodeInput)).existingFile, 'book2/back-matter/01-E\u0301lan.md');
        const spaced = await create(root, { kind: 'back-matter', title: 'A title with punctuation: !? ()', container: 'book2', slug: 'Space and Unicode 中文' });
        assert.equal(spaced.filePath, 'book2/back-matter/02-Space and Unicode 中文.md');
        const caseRoot = path.join(directory, 'case-project');
        await write(caseRoot, '.math-workspace/config.json', '{}');
        await write(caseRoot, 'book1/Front-Matter/09-Existing.MD', page('Existing', 99));
        assert.equal((await plan(caseRoot, { ...input, title: 'EXISTING' })).existingFile, 'book1/Front-Matter/09-Existing.MD');
        assert.equal((await create(caseRoot, { ...input, title: 'Another' })).filePath, 'book1/Front-Matter/10-another.md');
        const symlinkRoot = path.join(directory, 'symlink-project');
        await write(symlinkRoot, '.math-workspace/config.json', '{}');
        await fs.mkdir(path.join(symlinkRoot, 'book1')); await fs.symlink(outside, path.join(symlinkRoot, 'book1/front-matter'));
        await assert.rejects(plan(symlinkRoot, { ...input, title: 'Unsafe' }), /symbolic links/);
        await fs.symlink(path.join(root, 'book2/01-other.md'), path.join(symlinkRoot, 'book1/01-linked.md'));
        await assert.rejects(create(symlinkRoot, { kind: 'chapter', title: 'Linked', container: 'book1' }), /symbolic links/);
        const linkedRoot = path.join(directory, 'linked-project-root'); await fs.symlink(root, linkedRoot);
        await assert.rejects(manuscriptCreationScopes(linkedRoot), /real directory/);
        await assert.rejects(manuscriptCreationScopes(outside), /prepared project/);
        assert.deepEqual(await fs.readdir(outside), []);

        const matterOnlyRoot = path.join(directory, 'matter-only-project');
        await write(matterOnlyRoot, '.math-workspace/config.json', JSON.stringify(config));
        for (const [file, title] of [['book/front-matter/01-only.md', 'Book opening'], ['manuscript/back-matter/01-only.md', 'Manuscript ending'],
            ['series/vol-1/front-matter/01-only.md', 'Volume opening'], ['excluded/ignored/front-matter/01-only.md', 'Excluded opening'],
            ['draft/draft-book/front-matter/01-only.md', 'Draft opening']]) await write(matterOnlyRoot, file, page(title, 100));
        const linkedMatter = path.join(directory, 'linked-matter'); await write(linkedMatter, 'front-matter/01-only.md', page('Linked opening', 101));
        await fs.symlink(linkedMatter, path.join(matterOnlyRoot, 'book-linked'));
        const matterOnlyScopes = await manuscriptCreationScopes(matterOnlyRoot);
        assert.deepEqual(matterOnlyScopes.map(scope => scope.container), ['.', 'book', 'manuscript', 'series', 'series/vol-1']);
        for (const container of ['book', 'manuscript', 'series']) assert.equal(matterOnlyScopes.find(scope => scope.container === container).kind, 'formal');
        assert.equal(matterOnlyScopes.find(scope => scope.container === 'series/vol-1').kind, 'volume');
        assert.equal((await plan(matterOnlyRoot, { kind: 'front-matter', title: 'Second opening', container: 'book' })).filePath, 'book/front-matter/02-second-opening.md');
        for (const [filePath, container] of [['book/front-matter/01-only.md', 'book'], ['manuscript/back-matter/01-only.md', 'manuscript'],
            ['series/vol-1/front-matter/01-only.md', 'series/vol-1']]) {
            const response = await readerCreateApi(matterOnlyRoot, 'GET', '/api/create-page/scopes', new URLSearchParams({ filePath }));
            assert.equal(response.defaultContainer, container, 'A matter-only manuscript keeps its actual physical container in the Reader.');
        }
        const matterOnlyChapter = await create(matterOnlyRoot, { kind: 'chapter', title: 'First chapter', container: 'book' });
        assert.equal(matterOnlyChapter.filePath, 'book/01-first-chapter.md');
        await assert.rejects(fs.access(path.join(matterOnlyRoot, '01-first-chapter.md')), { code: 'ENOENT' });

        const concurrent = await Promise.all(['Concurrent A', 'Concurrent B'].map(title => create(root, { kind: 'chapter', title, container: 'book1/vol-2' })));
        assert.deepEqual(concurrent.map(result => path.basename(result.filePath).slice(0, 2)).sort(), ['03', '04']);
        assert.equal(new Set(concurrent.map(result => result.id)).size, 2);
        const sameName = await Promise.allSettled([1, 2].map(() => create(root, { kind: 'front-matter', title: 'Single name', container: 'book2' })));
        assert.equal(sameName.filter(result => result.status === 'fulfilled').length, 1);
        assert.match(sameName.find(result => result.status === 'rejected').reason.message, /already exists/);

        const env = { ...process.env, NODE_PATH: path.join(repo, 'node_modules'), MATH_WORKSPACE_STATE: path.join(directory, 'state.json'), MATH_WORKSPACE_READER_INSTANCES: path.join(directory, 'instances.json') };
        const run = (args, cwd = root) => spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8', env });
        for (const title of ['--help', '--json', '--a real title']) {
            const payload = await readerCreateApi(root, 'GET', '/api/create-page/plan', new URLSearchParams({ kind: 'front-matter', container: 'book4', title }));
            assert.equal(payload.assistantCommand.args[payload.assistantCommand.args.indexOf('--title') + 1], title);
            const handoff = createPageHandoff(payload, 'en');
            const transferred = JSON.parse(handoff.slice(handoff.indexOf('\n{') + 1));
            assert.equal(transferred.title, title);
            assert.deepEqual(transferred.assistantCommand.args, payload.assistantCommand.args, 'The actual Reader handoff retains argv values as data.');
            // Only relocate the bundled CLI entry in the source fixture; preserve every generated argument.
            const argv = [cliPath, ...transferred.assistantCommand.args.slice(1)];
            const readonlyBefore = await tree(root);
            const preview = spawnSync(transferred.assistantCommand.executable, [...argv, '--dry-run'], { cwd: transferred.assistantCommand.cwd, encoding: 'utf8', env });
            assert.equal(preview.status, 0, preview.stdout + preview.stderr); assert.equal(JSON.parse(preview.stdout).title, title);
            assert.deepEqual(await tree(root), readonlyBefore);
            const result = spawnSync(transferred.assistantCommand.executable, argv, { cwd: transferred.assistantCommand.cwd, encoding: 'utf8', env });
            assert.equal(result.status, 0, result.stdout + result.stderr);
            const created = JSON.parse(result.stdout); assert.equal(created.title, title);
            assert.equal(await fs.readFile(path.join(root, created.filePath), 'utf8'), `# #${created.id} ${title}\n\n`);
        }
        for (const option of ['--kind', '--container', '--title', '--slug', '--expect-state']) {
            const missing = run(['create-page', option]); assert.equal(missing.status, 1);
            assert.match(missing.stderr, new RegExp(`Missing create-page value: ${option}`));
        }
        const cliInput = ['create-page', '--kind', 'chapter', '--container', 'book2', '--title', 'CLI 中文：第三种 “文字”'];
        const cliBefore = await tree(root);
        const dryRun = run([...cliInput, '--dry-run', '--json'], path.join(root, 'book1/vol-1'));
        assert.equal(dryRun.status, 0, dryRun.stdout + dryRun.stderr);
        const cliPlan = JSON.parse(dryRun.stdout); assert.equal(cliPlan.filePath, 'book2/02-cli-中文-第三种-文字.md');
        assert.deepEqual(await tree(root), cliBefore, 'Real CLI dry-run is source/configuration read-only.');
        const cliCreated = run([...cliInput, '--expect-state', cliPlan.stateToken, '--json']);
        assert.equal(cliCreated.status, 0, cliCreated.stdout + cliCreated.stderr);
        const cliResult = JSON.parse(cliCreated.stdout); assert.match(cliResult.id, /^h-[a-f0-9]{16}$/);
        assert.equal(run([...cliInput, '--json']).status, 1, 'Real CLI rejects duplicate names.');
        for (const args of [['create-page', '--wat'], ['create-page', '--kind', 'chapter'], [...cliInput, '--kind', 'chapter']]) assert.equal(run(args).status, 1);
        assert.match(run(['create-page', '--help']).stdout, /--expect-state/);
        const runAsync = args => new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [cliPath, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
            child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }));
        });
        const processResults = await Promise.all(['Process A', 'Process B'].map(title => runAsync(['create-page', '--kind', 'chapter', '--container', 'book2', '--title', title, '--json'])));
        for (const result of processResults) assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.deepEqual(processResults.map(result => path.basename(JSON.parse(result.stdout).filePath).slice(0, 2)).sort(), ['03', '04']);
        const finish = run(['finish', cliResult.filePath]);
        assert.equal(finish.status, 0, finish.stdout + finish.stderr);
        assert.match(await fs.readFile(path.join(root, cliResult.filePath), 'utf8'), new RegExp(`^# #${cliResult.id} `));
        assert(!(await tree(root)).some(([file]) => /\.create-page-|create-page\.lock/.test(file)), 'Successful operations leave no temporary files or lock.');
        console.log('Manuscript scopes, read-only plans, stable blank pages, non-overwrite safety and real concurrent CLI creation passed.');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testManuscriptCreation();
