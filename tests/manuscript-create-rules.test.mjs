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

async function sourceRuntime(directory) {
    const corePath = path.join(directory, 'core.cjs');
    const cliPath = path.join(directory, 'runtime/out/cli/math-workspace.js');
    await Promise.all([
        build({ entryPoints: [path.join(repo, 'packages/core/src/formal-core.ts')], outfile: corePath,
            bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' }),
        build({ entryPoints: [path.join(repo, 'src/cli/math-workspace.ts')], outfile: cliPath,
            bundle: true, packages: 'external', format: 'cjs', platform: 'node', logLevel: 'silent',
            alias: { '@math-workspace/core': path.join(repo, 'packages/core/src/formal-core.ts') }, loader: { '.png': 'dataurl' } })
    ]);
    await fs.copyFile(path.join(repo, 'package.json'), path.join(directory, 'runtime/package.json'));
    return { core: require(corePath), cliPath };
}

// These documented examples use quoted title arguments, never shell expansion.
function exampleArguments(command) {
    return (command.match(/"[^"]*"|'[^']*'|\S+/gu) || []).map(part => /^['"]/.test(part) ? part.slice(1, -1) : part);
}

async function sourceFiles(root, prefix = '') {
    const output = {};
    for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
        const relative = path.posix.join(prefix, entry.name);
        if (entry.isDirectory()) Object.assign(output, await sourceFiles(root, relative));
        else output[relative] = await fs.readFile(path.join(root, relative), 'utf8');
    }
    return output;
}

export async function testManuscriptCreationRules(runtime) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-create-rules-'));
    try {
        const { core, cliPath } = runtime || await sourceRuntime(directory);
        const project = path.join(directory, 'project');
        await fs.mkdir(path.join(project, '.math-workspace'), { recursive: true });
        await fs.mkdir(path.join(project, 'book'));
        await fs.writeFile(path.join(project, '.math-workspace/config.json'), '{"language":"zh-CN"}\n');
        await fs.writeFile(path.join(project, 'book/01-foundations.md'), '# #h-0000000000000001 Foundations\n\nOriginal source.\n');
        const run = args => spawnSync(process.execPath, [cliPath, ...args], { cwd: project, encoding: 'utf8',
            env: { ...process.env, NODE_PATH: path.join(repo, 'node_modules'),
                MATH_WORKSPACE_STATE: path.join(directory, 'state.json'), MATH_WORKSPACE_READER_INSTANCES: path.join(directory, 'instances.json') } });
        const json = args => {
            const result = run(args);
            assert.equal(result.status, 0, result.stdout + result.stderr);
            return JSON.parse(result.stdout);
        };

        const usage = await fs.readFile(path.join(repo, 'docs-src/docs/usage.vasm.md'), 'utf8');
        const commands = [...usage.matchAll(/^math-workspace create-page .+$/gm)].map(match => exampleArguments(match[0]).slice(1));
        const planArgs = commands.find(args => args.includes('--dry-run'));
        const createArgs = commands.find(args => args.includes('--expect-state') && !args.includes('--dry-run'));
        assert(planArgs && createArgs, 'Public creation instructions must provide a plan and a plan-bound creation example.');
        const original = await sourceFiles(project);
        const plan = json(planArgs);
        assert.equal(plan.exists, false);
        assert.deepEqual(await sourceFiles(project), original, 'Running the documented plan must not change source, configuration, or derived files.');
        const created = json(createArgs.map(arg => arg === 'PLAN_STATE_TOKEN' ? plan.stateToken : arg));
        assert.equal(created.created, true);
        assert.equal(created.filePath, plan.filePath);
        const heading = await fs.readFile(path.join(project, created.filePath), 'utf8');
        assert.equal(heading, `# #${created.id} ${plan.title}\n\n`, 'The documented helper creates one stable heading and leaves body composition to the author.');
        assert.match(created.id, /^h-[a-f0-9]{16}$/);
        const page = core.scanFormalDocuments([{ filePath: created.filePath, content: heading }], {}).pages[0];
        assert.equal(page.kind, plan.kind);
        assert.equal(page.title, plan.title);
        assert.equal(page.chapter, undefined, 'The public back-matter example must not consume a chapter number.');

        await fs.appendFile(path.join(project, created.filePath), 'A body added to the single manuscript source.\n');
        const finished = run(['finish', created.filePath]);
        assert.equal(finished.status, 0, finished.stdout + finished.stderr);
        assert.match(await fs.readFile(path.join(project, created.filePath), 'utf8'), new RegExp(`^# #${created.id} `));
        assert.equal(json(planArgs).exists, true, 'Returning to the same instructions identifies the existing manuscript.');

        const guide = await fs.readFile(path.join(project, '.math-workspace/agent-guide.md'), 'utf8');
        const template = guide.match(/`(create-page [^`]*--dry-run --json)`/)?.[1];
        assert(template, 'The actual prepare/finish guide must expose the read-only helper command.');
        const beforeGuidePlans = await sourceFiles(project);
        for (const kind of ['chapter', 'front-matter', 'back-matter', 'continued']) {
            const args = exampleArguments(template.replace('<kind>', kind).replace('<container>', 'book').replace('<title>', `Guide-${kind}`));
            const guided = json(args);
            assert.equal(guided.kind, kind);
            assert.equal(guided.scope.container, 'book');
            assert.equal(guided.exists, false);
        }
        assert.deepEqual(await sourceFiles(project), beforeGuidePlans, 'Every kind in the generated creation guide remains a read-only plan.');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testManuscriptCreationRules();
