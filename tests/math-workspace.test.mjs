import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'out', 'cli', 'math-workspace.js');
const require = createRequire(import.meta.url);

function formalCore() {
    return require(path.join(repoRoot, 'packages', 'core', 'out', 'formal-core.js'));
}

async function makeWorkspace(name) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `math-workspace-${name}-`));
    await fs.mkdir(path.join(root, 'book1'), { recursive: true });
    return root;
}

function runCli(cwd, args) {
    return spawnSync('node', [cliPath, ...args], {
        cwd,
        encoding: 'utf8'
    });
}

function runCliWithEnv(cwd, args, env) {
    return spawnSync('node', [cliPath, ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...env }
    });
}

function combinedOutput(result) {
    return `${result.stdout}\n${result.stderr}`;
}

function waitFor(condition, timeoutMs = 3000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const check = async () => {
            try {
                const value = await condition();
                if (value) {
                    resolve(value);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    reject(new Error('Timed out while waiting for Reader state.'));
                    return;
                }
                setTimeout(check, 50);
            } catch (error) {
                if (Date.now() - startedAt >= timeoutMs) {
                    reject(error);
                    return;
                }
                setTimeout(check, 50);
            }
        };
        void check();
    });
}

async function startReader(root, { projectPath = root, env = {} } = {}) {
    const args = ['serve'];
    if (projectPath) args.push(projectPath);
    args.push('--port', '0');
    const child = spawn('node', [cliPath, ...args], {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Reader did not report a localhost URL.\n' + output)), 5000);
        const receive = chunk => {
            output += String(chunk);
            const match = output.match(/Math Workspace: (http:\/\/127\.0\.0\.1:\d+)/);
            if (!match) return;
            clearTimeout(timeout);
            resolve(match[1]);
        };
        child.stdout.on('data', receive);
        child.stderr.on('data', receive);
        child.once('error', error => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once('exit', code => {
            if (output.includes('Math Workspace:')) return;
            clearTimeout(timeout);
            reject(new Error('Reader exited before startup with code ' + code + '.\n' + output));
        });
    });
    const url = await ready;
    return { child, url };
}

async function stopReader(child) {
    if (child.exitCode !== null) return;
    const done = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([done, new Promise(resolve => setTimeout(resolve, 2000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
}

async function startMcp(root, options = {}) {
    const child = spawn('node', [cliPath, 'mcp'], {
        cwd: root,
        env: { ...process.env, ...(options.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    const pending = new Map();
    let nextId = 1;
    let buffer = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
        buffer += String(chunk);
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (!line.trim()) continue;
            const message = JSON.parse(line);
            if (message.id !== undefined && pending.has(message.id)) {
                const { resolve, reject, timer } = pending.get(message.id);
                clearTimeout(timer);
                pending.delete(message.id);
                if (message.error) reject(new Error(message.error.message));
                else resolve(message.result);
            }
        }
    });
    child.stderr.on('data', chunk => { stderr += String(chunk); });

    const request = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`MCP ${method} timed out.\n${stderr}`));
        }, 5000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

    await request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'math-workspace-test', version: '1.0.0' }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return { child, request };
}

async function read(root, filePath) {
    return fs.readFile(path.join(root, filePath), 'utf8');
}

async function testFinalizeCrossFileSafety() {
    const root = await makeWorkspace('finalize');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定理 #tmp-1（Tmp Main）：A.',
        '',
        'Local @tmp-1.',
        'Inline code `@tmp-1 #tmp-1` must stay unchanged.',
        '```',
        'Fenced @tmp-1 #tmp-1 must stay unchanged.',
        '```',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '02-b.md'), [
        '# Chapter 2',
        '',
        'Cross @tmp-1.',
        ''
    ].join('\n'));

    const scoped = runCli(root, ['finalize', 'book1/01-a.md']);
    assert.notEqual(scoped.status, 0, combinedOutput(scoped));
    assert.match(combinedOutput(scoped), /cross-file temporary references/);
    assert.match(await read(root, 'book1/01-a.md'), /定理 #tmp-1/);
    assert.match(await read(root, 'book1/02-b.md'), /@tmp-1/);

    const all = runCli(root, ['finalize', 'book1/01-a.md', '--all']);
    assert.equal(all.status, 0, combinedOutput(all));
    const chapter1 = await read(root, 'book1/01-a.md');
    const chapter2 = await read(root, 'book1/02-b.md');
    assert.doesNotMatch(chapter1, /定理 #tmp-1/);
    assert.doesNotMatch(chapter1, /Local @tmp-1\./);
    assert.doesNotMatch(chapter2, /tmp-1/);
    assert.match(chapter1, /#h-[a-f0-9]{16}/);
    assert.match(chapter2, /@h-[a-f0-9]{16}/);
    assert.match(chapter1, /`@tmp-1 #tmp-1`/);
    assert.match(chapter1, /Fenced @tmp-1 #tmp-1 must stay unchanged\./);
}

async function testFinishFinalizesAndVerifies() {
    const root = await makeWorkspace('finish');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定理 #tmp-1（Tmp Main）：A.',
        '',
        'Local @tmp-1.',
        ''
    ].join('\n'));

    const finish = runCli(root, ['finish', 'book1/01-a.md']);
    assert.equal(finish.status, 0, combinedOutput(finish));
    assert.match(combinedOutput(finish), /OK verify: generated\/ migrated content gate passed/);
    const chapter = await read(root, 'book1/01-a.md');
    assert.doesNotMatch(chapter, /tmp-1/);
    assert.match(chapter, /#h-[a-f0-9]{16}/);
    assert.match(chapter, /@h-[a-f0-9]{16}/);
}

async function testMigrateIdsScopedSafety() {
    const root = await makeWorkspace('migrate-ids');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定理 #old-main（Old Main）：A.',
        '',
        'Local @old-main.',
        '',
        '定义（旧术语）：Definitions are lookup-only and have no IDs.',
        'Inline code `@old-main #old-main` must stay unchanged.',
        '```',
        'Fenced @old-main #old-main must stay unchanged.',
        '```',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '02-b.md'), [
        '# Chapter 2',
        '',
        'Cross @old-main.',
        'Code `@old-main` must stay unchanged.',
        '',
        '引理 #outside-old（Outside）：B.',
        ''
    ].join('\n'));

    const targetOnly = runCli(root, ['migrate-ids', '--apply', '--target-only', 'book1/01-a.md']);
    assert.notEqual(targetOnly.status, 0, combinedOutput(targetOnly));
    assert.match(combinedOutput(targetOnly), /Refusing to apply/);
    assert.match(await read(root, 'book1/01-a.md'), /定理 #old-main/);
    assert.match(await read(root, 'book1/02-b.md'), /@old-main/);

    const scoped = runCli(root, ['migrate-ids', '--apply', 'book1/01-a.md']);
    assert.equal(scoped.status, 0, combinedOutput(scoped));
    assert.match(combinedOutput(scoped), /Incoming references outside target scope will be updated: 1/);
    const chapter1 = await read(root, 'book1/01-a.md');
    const chapter2 = await read(root, 'book1/02-b.md');
    assert.doesNotMatch(chapter1, /定理 #old-main/);
    assert.doesNotMatch(chapter1, /Local @old-main\./);
    assert.doesNotMatch(chapter2, /Cross @old-main\./);
    assert.match(chapter1, /定义（旧术语）：Definitions are lookup-only and have no IDs\./);
    assert.match(chapter1, /#h-[a-f0-9]{16}/);
    assert.match(chapter2, /@h-[a-f0-9]{16}/);
    assert.match(chapter2, /#outside-old/);
    assert.match(chapter1, /`@old-main #old-main`/);
    assert.match(chapter1, /Fenced @old-main #old-main must stay unchanged\./);
    assert.match(chapter2, /`@old-main`/);
}

async function testMigrateTextRefsReport() {
    const root = await makeWorkspace('text-refs');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定理 #h-1111111111111111（Base）：Base statement.',
        '',
        '由 定理 1.1 和 Theorem 1.1 可得结论。',
        'Inline code `定理 1.1` must stay unchanged.',
        '```',
        'Fenced 定理 1.1 must stay unchanged.',
        '```',
        'Unresolved 定理 9.9 stays textual.',
        ''
    ].join('\n'));

    const apply = runCli(root, ['migrate-text-refs', '--apply', 'book1/01-a.md']);
    assert.equal(apply.status, 0, combinedOutput(apply));
    const chapter = await read(root, 'book1/01-a.md');
    assert.match(chapter, /由 @h-1111111111111111 和 @h-1111111111111111 可得结论。/);
    assert.match(chapter, /`定理 1\.1`/);
    assert.match(chapter, /Fenced 定理 1\.1 must stay unchanged\./);
    assert.match(chapter, /Unresolved 定理 9\.9 stays textual\./);

    const report = await read(root, '.math-workspace/text-ref-migration.md');
    assert.match(report, /Replacements: 2/);
    assert.match(report, /Unresolved: 1/);
    assert.match(report, /book1\/01-a\.md:10: 定理 9\.9/);

    const verify = runCli(root, ['verify']);
    assert.notEqual(verify.status, 0, combinedOutput(verify));
    assert.match(combinedOutput(verify), /text-reference migration has unresolved=1, ambiguous=0/);
}

async function testCustomDictionaryTextRefs() {
    const root = await makeWorkspace('custom-dictionary');
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'config.json'), JSON.stringify({
        language: 'en',
        dictionary: {
            en: {
                theorem: 'Satz'
            }
        }
    }, null, 2));
    await fs.writeFile(path.join(root, '.math-workspace/definitions.json'), JSON.stringify([
        {
            term: '非标准定义',
            aliases: ['别名定义'],
            source: 'book1/01-a.md:17',
            content: '我们把满足谱约束且闭合于极限的对象称为“非标准定义”，后续只通过定义搜索查询它。'
        }
    ], null, 2));
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        'Theorem #h-2222222222222222 (Base): Base statement.',
        '',
        'Definition (Spectrum): A definition body.',
        '',
        '**定义（加粗术语）：** 中文定义正文。',
        '',
        '定义（指标密度）：指标密度由下式给出',
        '',
        '$$',
        '\\alpha(D)=\\widehat{A}(TX)\\operatorname{ch}(\\sigma(D))',
        '$$',
        '',
        '其中 $D$ 是局部椭圆算子。',
        '',
        '我们把满足谱约束且闭合于极限的对象称为“非标准定义”，后续只通过定义搜索查询它。',
        '',
        'By Satz 1.1 we conclude.',
        ''
    ].join('\n'));

    const apply = runCli(root, ['migrate-text-refs', '--apply', 'book1/01-a.md']);
    assert.equal(apply.status, 0, combinedOutput(apply));
    const chapter = await read(root, 'book1/01-a.md');
    assert.match(chapter, /By @h-2222222222222222 we conclude\./);

    const readerIndex = JSON.parse(await read(root, '.math-workspace/workspace-index.json'));
    assert.equal(readerIndex.entries['h-2222222222222222'].content, 'Theorem (Base): Base statement.');
    assert.equal(readerIndex.definitions[0].title, 'Spectrum');
    assert.equal(readerIndex.definitions[0].filePath, 'book1/01-a.md');
    assert.equal(readerIndex.definitions[0].line, 5);
    assert.equal(readerIndex.definitions[0].content, 'Definition (Spectrum): A definition body.');
    assert.equal(readerIndex.definitions[1].title, '加粗术语');
    assert.equal(readerIndex.definitions[1].line, 7);
    assert.equal(readerIndex.definitions[1].content, '**定义（加粗术语）：** 中文定义正文。');
    assert.equal(readerIndex.definitions[2].title, '指标密度');
    assert.equal(readerIndex.definitions[2].line, 9);
    assert.match(readerIndex.definitions[2].content, /\\alpha\(D\)=/);
    assert.match(readerIndex.definitions[2].content, /其中 \$D\$ 是局部椭圆算子。/);
    assert.equal(readerIndex.definitions[3].title, '非标准定义');
    assert.deepEqual(readerIndex.definitions[3].aliases, ['别名定义']);
    assert.equal(readerIndex.definitions[3].line, 17);
    assert.match(readerIndex.definitions[3].content, /称为“非标准定义”/);
    await assert.rejects(read(root, '.math-workspace/definition-index.md'), /ENOENT/);
}

async function testStructuredDefinitionMarkerContent() {
    const root = await makeWorkspace('structured-definition');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定义（算子网络环路）：一个算子网络环路由以下数据构成。',
        '',
        '**(i)** 给定有限有向图',
        '',
        '$$',
        'G=(V,E).',
        '$$',
        '',
        '允许含有有向闭路。',
        '',
        '**(ii)** 对每个节点给定局域算子。',
        '',
        '这句是定义后的普通正文，不应进入定义预览。',
        ''
    ].join('\n'));

    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));
    const readerIndex = JSON.parse(await read(root, '.math-workspace/workspace-index.json'));
    const definition = readerIndex.definitions.find(item => item.title === '算子网络环路');
    assert.ok(definition);
    assert.match(definition.content, /\*\*\(i\)\*\* 给定有限有向图/);
    assert.match(definition.content, /G=\(V,E\)\./);
    assert.match(definition.content, /允许含有有向闭路。/);
    assert.match(definition.content, /\*\*\(ii\)\*\* 对每个节点给定局域算子。/);
    assert.doesNotMatch(definition.content, /定义后的普通正文/);
}

async function testProjectKnowledgeAnalysis() {
    const root = await makeWorkspace('project-knowledge');
    await fs.writeFile(path.join(root, 'book1', '01-foundations.md'), [
        '# Foundations',
        '',
        'Compactness is used throughout this chapter.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', 'appendix-b-core-concepts.md'), [
        '# Appendix B: Core Concepts',
        '',
        '| Term | Definition |',
        '| --- | --- |',
        '| Compactness | Every open cover admits a finite subcover. |',
        '| Spectral gap | A positive separation in the relevant spectrum. |',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', 'appendix-a-symbols.md'), [
        '# Appendix A: Symbols',
        '',
        'Notation reference.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', 'summary.md'), '# Summary\n');

    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));
    assert.match(combinedOutput(prepare), /Project knowledge: 1 concept\/glossary sources, 1 notation sources, 2 supplemental definitions/);

    const analysis = JSON.parse(await read(root, '.math-workspace/project-analysis.json'));
    assert.deepEqual(analysis.summary, {
        conceptSources: 1,
        notationSources: 1,
        summaryPages: 1,
        extractedDefinitions: 2
    });
    assert.deepEqual(analysis.sources.map(source => source.kind), ['notation-appendix', 'concept-appendix', 'summary-page']);
    const report = await read(root, '.math-workspace/project-analysis.md');
    assert.match(report, /appendix-b-core-concepts\.md/);
    assert.match(report, /Supplemental definitions extracted from concept sources: 2/);

    const readerIndex = JSON.parse(await read(root, '.math-workspace/workspace-index.json'));
    const compactness = readerIndex.definitions.find(definition => definition.title === 'Compactness');
    assert.deepEqual(compactness && {
        filePath: compactness.filePath,
        line: compactness.line,
        content: compactness.content,
        origin: compactness.origin
    }, {
        filePath: 'book1/appendix-b-core-concepts.md',
        line: 5,
        content: 'Every open cover admits a finite subcover.',
        origin: 'concept-appendix'
    });

    const reader = await startReader(root);
    try {
        const state = await (await fetch(reader.url + '/api/state')).json();
        assert.equal(state.projectAnalysis.summary.extractedDefinitions, 2);
        const readerDefinition = state.definitions.find(definition => definition.title === 'Compactness');
        const detail = await (await fetch(reader.url + '/api/definition?index=' + readerDefinition.index)).json();
        assert.equal(detail.origin, 'concept-appendix');
        assert.match(detail.content, /finite subcover/);
        const endpointAnalysis = await (await fetch(reader.url + '/api/project-analysis')).json();
        assert.equal(endpointAnalysis.summary.conceptSources, 1);
    } finally {
        await stopReader(reader.child);
    }
}

async function testSymbolCache() {
    const root = await makeWorkspace('symbols');
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'symbols.json'), JSON.stringify([
        {
            pattern: '\\sigma(${operator})',
            meaning: 'Spectrum of the captured operator.',
            scope: 'book',
            source: 'book1/01-a.md:3'
        },
        {
            pattern: '\\lambda',
            meaning: 'A local spectral parameter.',
            scope: 'file',
            source: 'book1/01-a.md:3'
        }
    ], null, 2));
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定义（算子谱）：The spectrum $\\sigma(T)$ contains values $\\lambda$.',
        ''
    ].join('\n'));

    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));
    const readerIndex = JSON.parse(await read(root, '.math-workspace/workspace-index.json'));
    assert.equal(readerIndex.symbols.length, 2);
    assert.equal(readerIndex.symbols[0].display, '$\\sigma(T)$');
    assert.equal(readerIndex.symbols[1].display, '$\\lambda$');
    assert.equal(readerIndex.symbols[0].regex, '^\\\\sigma\\((.+?)\\)$');
    assert.deepEqual(readerIndex.symbols[0].captures, ['operator']);
    assert.equal(readerIndex.symbols[0].sourceFilePath, 'book1/01-a.md');
    assert.equal(readerIndex.symbols[0].sourceLine, 3);
}

async function testWarnsUnbalancedSymbolPattern() {
    const root = await makeWorkspace('symbol-pattern-warning');
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'symbols.json'), JSON.stringify([
        {
            pattern: '\\mathcal{N}_{${index}}\\bigl(${mesh},\\,${base}',
            meaning: 'An intentionally incomplete notation pattern.',
            scope: 'book',
            source: 'book1/01-a.md:3'
        }
    ], null, 2));
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定义（覆盖数）：The symbol is introduced here.',
        ''
    ].join('\n'));

    const verify = runCli(root, ['verify']);
    assert.equal(verify.status, 0, combinedOutput(verify));
    assert.match(combinedOutput(verify), /symbol-pattern-unbalanced-delimiter/);
}

async function testRecallBoundariesAndOptionalBlocks() {
    const root = await makeWorkspace('recall-boundaries');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '## #h-1111111111111111 Boundary Section',
        '',
        'Theorem #h-2222222222222222 (Boundary): First line of the statement.',
        'Second statement line with $x$.',
        '',
        'Proof.',
        'The proof body should not enter recall preview.',
        '',
        'Remark #h-3333333333333333 (Important): This remark is explicitly indexed.',
        'It has a second line.',
        '',
        '> 注 #h-8888888888888888（旁支事实）：这是放在引用块里的带锚点事实注释。',
        '> 证明：',
        '> 这行证明不应进入 recall 预览。',
        '',
        'Theorem #h-4444444444444444 (After remark): The theorem counter should ignore remark numbering.',
        '',
        'Example #h-5555555555555555 (Model): A referenced example.',
        '',
        '命题 #h-6666666666666666（有效分量包含律）：**(i)** 对于复合算子 $\\phi_2 \\circ \\phi_1 \\in \\Omega$，有效分量满足包含关系。',
        '',
        '命题 #h-7777777777777777 **（加粗标题）：** 允许标题括号本身加粗。',
        '',
        'Later text cites @h-3333333333333333 and @h-5555555555555555.',
        ''
    ].join('\n'));

    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));
    const readerIndex = JSON.parse(await read(root, '.math-workspace/workspace-index.json'));

    assert.equal(readerIndex.entries['h-1111111111111111'].content, undefined);
    assert.equal(readerIndex.entries['h-2222222222222222'].content, [
        'Theorem (Boundary): First line of the statement.',
        'Second statement line with $x$.'
    ].join('\n'));
    assert.doesNotMatch(readerIndex.entries['h-2222222222222222'].content, /proof body/i);
    assert.match(readerIndex.entries['h-3333333333333333'].content, /second line/);
    assert.equal(readerIndex.entries['h-8888888888888888'].title, '旁支事实');
    assert.match(readerIndex.entries['h-8888888888888888'].content, /^> 注/);
    assert.doesNotMatch(readerIndex.entries['h-8888888888888888'].content, /不应进入 recall/);
    assert.equal(readerIndex.entries['h-2222222222222222'].number, 1);
    assert.equal(readerIndex.entries['h-4444444444444444'].number, 2);
    assert.equal(readerIndex.entries['h-6666666666666666'].title, '有效分量包含律');
    assert.equal(readerIndex.entries['h-7777777777777777'].title, '加粗标题');
    assert.equal(readerIndex.entries['h-3333333333333333'].number, undefined);
    assert.equal(readerIndex.entries['h-5555555555555555'].number, 1);

    const referenceMap = await read(root, '.math-workspace/reference-map.md');
    assert.doesNotMatch(referenceMap, /注 1\.1/);
    assert.ok(referenceMap.includes('| 注 | `h-3333333333333333` | Important | `book1/01-a.md:11` |'));
    assert.ok(referenceMap.includes('| 注 | `h-8888888888888888` | 旁支事实 | `book1/01-a.md:14` |'));
    assert.match(referenceMap, /例 1\.1/);
}

async function testStrongMarkerWithSoftbreak() {
    const { parseFormalMarkerLine } = formalCore();
    const marker = parseFormalMarkerLine([
        '**命题 #h-2ebc63596b817afd（零化截断条件）**：设 $\\phi^\\natural \\in \\Omega$。',
        '对指标对 $(i,j)\\in I^2$，若：'
    ].join('\n'));

    assert.equal(marker?.type, 'prop');
    assert.equal(marker?.id, 'h-2ebc63596b817afd');
    assert.equal(marker?.title, '零化截断条件');
    assert.equal(marker?.markerText, '命题 #h-2ebc63596b817afd');
}

async function testDependencyGraph() {
    const root = await makeWorkspace('dependency-graph');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定理 #h-1111111111111111（Base）：Base statement.',
        '',
        '证明：',
        'The proof uses @h-2222222222222222.',
        '',
        '命题 #h-2222222222222222（Statement Uses）：由 @h-1111111111111111 和 @h-5555555555555555 可得 statement.',
        '',
        'Proof.',
        'The proof uses @h-3333333333333333.',
        '',
        '注 #h-5555555555555555（Supporting Fact）：This supplemental fact has a proof.',
        '',
        'Proof.',
        'The proof uses @h-3333333333333333.',
        '',
        '注（Plain Note）：This explanatory note must not become a dependency node.',
        '',
        '## #h-4444444444444444 Notes',
        '',
        'Ambient prose cites @h-1111111111111111 but should not become a theorem dependency.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '02-b.md'), [
        '# Chapter 2',
        '',
        '引理 #h-3333333333333333（Cross Chapter）：Cross statement.',
        ''
    ].join('\n'));

    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));

    const graph = JSON.parse(await read(root, '.math-workspace/dependency-graph.json'));
    assert.equal(graph.schemaVersion, 1);
    assert.equal(graph.nodes.length, 4);
    assert.equal(graph.summary.theoremLikeNodes, 3);
    assert.equal(graph.summary.supplementalRemarkNodes, 1);
    assert.equal(graph.nodes.find(node => node.id === 'h-5555555555555555')?.kind, 'remark');
    assert.equal(graph.nodes.some(node => node.title === 'Plain Note'), false);
    assert.equal(graph.edges.length, 5);
    assert.equal(graph.summary.theoremLikeEdges, 3);
    assert.equal(graph.summary.supplementalRemarkEdges, 2);
    assert.equal(graph.summary.statementEdges, 2);
    assert.equal(graph.summary.proofEdges, 3);
    assert.equal(graph.summary.crossChapterEdges, 2);
    assert.equal(graph.summary.cycles, 1);
    assert.equal(graph.diagnostics.filter(item => item.code === 'ambient-dependency-ref').length, 1);

    const edgeKey = edge => `${edge.from}->${edge.to}:${edge.where}`;
    assert.ok(graph.edges.map(edgeKey).includes('h-1111111111111111->h-2222222222222222:proof'));
    assert.ok(graph.edges.map(edgeKey).includes('h-2222222222222222->h-1111111111111111:statement'));
    assert.ok(graph.edges.map(edgeKey).includes('h-2222222222222222->h-3333333333333333:proof'));
    assert.ok(graph.edges.map(edgeKey).includes('h-2222222222222222->h-5555555555555555:statement'));
    assert.ok(graph.edges.map(edgeKey).includes('h-5555555555555555->h-3333333333333333:proof'));
    assert.deepEqual(graph.cycles[0].ids.sort(), ['h-1111111111111111', 'h-2222222222222222']);

    const report = await read(root, '.math-workspace/dependency-report.md');
    assert.match(report, /Supplemental fact remarks: 1/);
    assert.match(report, /Proof edges: 3/);
    assert.match(report, /Cross-Scope Edges/);
    assert.match(report, /ambient-dependency-ref/);

    const graphCommand = runCli(root, ['graph']);
    assert.equal(graphCommand.status, 0, combinedOutput(graphCommand));
    assert.match(combinedOutput(graphCommand), /OK graph: 3 theorem-like nodes, 1 supplemental remark, 5 explicit edges, 3 proof edges, 1 cycles/);

    const graphSummary = runCli(root, ['graph', 'summary']);
    assert.equal(graphSummary.status, 0, combinedOutput(graphSummary));
    assert.match(combinedOutput(graphSummary), /# Dependency Graph Summary/);
    assert.match(combinedOutput(graphSummary), /- Supplemental fact remarks: 1/);
    assert.match(combinedOutput(graphSummary), /- Proof edges: 3/);
    assert.match(combinedOutput(graphSummary), /- Cross-chapter edges: 2/);

    const proofSummary = runCli(root, ['graph', 'summary', '--where', 'proof']);
    assert.equal(proofSummary.status, 0, combinedOutput(proofSummary));
    assert.match(combinedOutput(proofSummary), /# Dependency Graph Summary \(proof edges only\)/);
    assert.match(combinedOutput(proofSummary), /- Statement edges: 0/);
    assert.match(combinedOutput(proofSummary), /- Proof edges: 3/);

    const impact = runCli(root, ['graph', 'impact', '@h-1111111111111111']);
    assert.equal(impact.status, 0, combinedOutput(impact));
    assert.match(combinedOutput(impact), /# Dependency Impact Closure/);
    assert.match(combinedOutput(impact), /Downstream impacted nodes: 1/);
    assert.match(combinedOutput(impact), /命题 1\.2 Statement Uses/);

    const upstream = runCli(root, ['graph', 'upstream', 'h-2222222222222222']);
    assert.equal(upstream.status, 0, combinedOutput(upstream));
    assert.match(combinedOutput(upstream), /# Dependency Upstream Closure/);
    assert.match(combinedOutput(upstream), /定理 1\.1 Base/);
    assert.match(combinedOutput(upstream), /引理 2\.1 Cross Chapter/);

    const focus = runCli(root, ['graph', 'focus', 'h-2222222222222222', '--depth', '1']);
    assert.equal(focus.status, 0, combinedOutput(focus));
    assert.match(combinedOutput(focus), /# Dependency Focus Depth 1/);
    assert.match(combinedOutput(focus), /## Upstream/);
    assert.match(combinedOutput(focus), /## Downstream Impact/);
    assert.match(combinedOutput(focus), /## Local Edges/);

    const matrix = runCli(root, ['graph', 'matrix', 'chapter']);
    assert.equal(matrix.status, 0, combinedOutput(matrix));
    assert.match(combinedOutput(matrix), /# Dependency Matrix By chapter/);
    assert.match(combinedOutput(matrix), /Edges: 5/);

    const cycles = runCli(root, ['graph', 'cycles']);
    assert.equal(cycles.status, 0, combinedOutput(cycles));
    assert.match(combinedOutput(cycles), /Cycles: 1/);

    const statementCycles = runCli(root, ['graph', 'cycles', '--where=statement']);
    assert.equal(statementCycles.status, 0, combinedOutput(statementCycles));
    assert.match(combinedOutput(statementCycles), /# Dependency Cycles \(statement edges only\)/);
    assert.match(combinedOutput(statementCycles), /Cycles: 0/);

    const isolated = runCli(root, ['graph', 'isolated']);
    assert.equal(isolated.status, 0, combinedOutput(isolated));
    assert.match(combinedOutput(isolated), /Isolated nodes: 0/);

    const bridges = runCli(root, ['graph', 'bridges']);
    assert.equal(bridges.status, 0, combinedOutput(bridges));
    assert.match(combinedOutput(bridges), /# Bridge Candidates/);
    assert.match(combinedOutput(bridges), /命题 1\.2 Statement Uses/);
}

async function testProofTerminatorsExcludeFollowingExplanatoryReferences() {
    const root = await makeWorkspace('dependency-proof-terminator');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '命题 #h-1111111111111111（Base）：Base statement.',
        '',
        'Proof: direct. $\\square$',
        '',
        '> 注（Forward reference）：A strengthened application appears in @h-2222222222222222.',
        '',
        '推论 #h-2222222222222222（Application）：By @h-1111111111111111, the conclusion follows.',
        ''
    ].join('\n'));

    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));

    const graph = JSON.parse(await read(root, '.math-workspace/dependency-graph.json'));
    const edgeKey = edge => `${edge.from}->${edge.to}:${edge.where}`;
    assert.deepEqual(graph.edges.map(edgeKey), ['h-2222222222222222->h-1111111111111111:statement']);
    assert.deepEqual(graph.ambientReferences, [{
        to: 'h-2222222222222222',
        path: 'book1/01-a.md',
        line: 7
    }]);
    assert.equal(graph.diagnostics.filter(item => item.code === 'ambient-dependency-ref').length, 1);
}

async function testEquationFigureTableNumbering() {
    const root = await makeWorkspace('media-numbering');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '公式 #h-1111111111111111：',
        '$$',
        '\\rho(T)<1',
        '$$',
        '',
        '![Feedback loop](assets/feedback.svg)',
        '',
        '图 #h-2222222222222222（反馈环）：谱半径由反馈环控制。',
        '',
        '表 #h-3333333333333333（稳定性条件）：',
        '',
        '| 条件 | 结论 |',
        '| --- | --- |',
        '| $\\rho(T)<1$ | 收敛 |',
        '',
        '见 公式 (1.1)、Figure 1.1 和 表 1.1。',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', 'appendix-a-estimates.md'), [
        '# Appendix A',
        '',
        '公式 #h-4444444444444444：',
        '$$',
        '\\|[D,\\chi_R]\\|\\to 0',
        '$$',
        ''
    ].join('\n'));

    const apply = runCli(root, ['migrate-text-refs', '--apply', 'book1/01-a.md']);
    assert.equal(apply.status, 0, combinedOutput(apply));
    const chapter = await read(root, 'book1/01-a.md');
    assert.match(chapter, /见 @h-1111111111111111、@h-2222222222222222 和 @h-3333333333333333。/);

    const readerIndex = JSON.parse(await read(root, '.math-workspace/workspace-index.json'));
    assert.equal(readerIndex.entries['h-1111111111111111'].type, 'equation');
    assert.equal(readerIndex.entries['h-1111111111111111'].number, 1);
    assert.equal(readerIndex.entries['h-2222222222222222'].type, 'figure');
    assert.equal(readerIndex.entries['h-2222222222222222'].title, '反馈环');
    assert.equal(readerIndex.entries['h-3333333333333333'].type, 'table');
    assert.equal(readerIndex.entries['h-4444444444444444'].appendix, 'A');
    assert.equal(readerIndex.entries['h-4444444444444444'].number, 1);

    const referenceMap = await read(root, '.math-workspace/reference-map.md');
    assert.match(referenceMap, /公式 \(1\.1\)/);
    assert.match(referenceMap, /图 1\.1/);
    assert.match(referenceMap, /表 1\.1/);
    assert.match(referenceMap, /公式 \(A\.1\)/);
}

async function testStructuredMarkerValidation() {
    const root = await makeWorkspace('structured-marker-validation');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '公式 #h-1111111111111111：',
        'This is not display math.',
        '',
        '图 #h-2222222222222222：No nearby image.',
        '',
        '表 #h-3333333333333333（Broken table）：',
        'No table follows.',
        ''
    ].join('\n'));

    const verify = runCli(root, ['verify']);
    assert.notEqual(verify.status, 0, combinedOutput(verify));
    assert.match(combinedOutput(verify), /equation-target-missing/);
    assert.match(combinedOutput(verify), /figure-target-missing/);
    assert.match(combinedOutput(verify), /table-target-missing/);

    const report = await read(root, '.math-workspace/report.md');
    assert.match(report, /figure-caption-missing/);
}

async function testCrossBookReferencesRequireDependencies() {
    const root = await makeWorkspace('cross-book-refs');
    await fs.mkdir(path.join(root, 'book2'), { recursive: true });
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Book 1 Chapter',
        '',
        '定理 #h-1111111111111111（Source）：Statement.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book2', '01-b.md'), [
        '# Book 2 Chapter',
        '',
        'Use @h-1111111111111111.',
        ''
    ].join('\n'));

    const blocked = runCli(root, ['verify']);
    assert.notEqual(blocked.status, 0, combinedOutput(blocked));
    assert.match(combinedOutput(blocked), /cross-book-ref-disallowed/);

    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'config.json'), JSON.stringify({
        lookup: {
            bookDependencies: {
                book2: ['book1']
            }
        }
    }, null, 2));

    const allowed = runCli(root, ['verify']);
    assert.equal(allowed.status, 0, combinedOutput(allowed));
}

async function testChapterPageReferences() {
    const root = await makeWorkspace('chapter-page-refs');
    await fs.mkdir(path.join(root, 'book2'), { recursive: true });
    await fs.writeFile(path.join(root, 'book1', 'intro.md'), [
        '# #h-aaaaaaaaaaaaaaaa Book Intro',
        '',
        'Intro page.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '见 @chapter:./02-b.md.full，也可回到 @page:./intro.md.title。',
        '同样可以引用页面 hash：@h-bbbbbbbbbbbbbbbb.full 与 @h-aaaaaaaaaaaaaaaa.title。',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '02-b.md'), [
        '# #h-bbbbbbbbbbbbbbbb Target Chapter',
        '',
        '定理 #h-1111111111111111（Target）：Statement.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book2', '01-other.md'), [
        '# Other Book',
        '',
        'Other content.',
        ''
    ].join('\n'));

    const finish = runCli(root, ['finish', 'book1/01-a.md']);
    assert.equal(finish.status, 0, combinedOutput(finish));
    const chapter = await read(root, 'book1/01-a.md');
    assert.match(chapter, /@chapter:book1\/02-b\.md\.full/);
    assert.match(chapter, /@page:book1\/intro\.md\.title/);
    assert.match(chapter, /@h-bbbbbbbbbbbbbbbb\.full/);
    assert.match(chapter, /@h-aaaaaaaaaaaaaaaa\.title/);

    const referenceMap = await read(root, '.math-workspace/reference-map.md');
    assert.match(referenceMap, /@h-bbbbbbbbbbbbbbbb/);
    assert.match(referenceMap, /@h-aaaaaaaaaaaaaaaa/);
    assert.match(referenceMap, /@chapter:book1\/02-b\.md/);
    assert.match(referenceMap, /@page:book1\/intro\.md/);

    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        'Wrong kind @chapter:book1/intro.md.',
        ''
    ].join('\n'));
    const wrongKind = runCli(root, ['verify']);
    assert.notEqual(wrongKind.status, 0, combinedOutput(wrongKind));
    assert.match(combinedOutput(wrongKind), /page-ref-kind-mismatch/);

    await fs.writeFile(path.join(root, 'book2', '01-other.md'), [
        '# Other Book',
        '',
        'Cross book @chapter:../book1/02-b.md.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        'Back to valid @page:book1/intro.md.',
        ''
    ].join('\n'));
    const blocked = runCli(root, ['verify']);
    assert.notEqual(blocked.status, 0, combinedOutput(blocked));
    assert.match(combinedOutput(blocked), /cross-book-page-ref-disallowed/);
}

async function testPageAnchorFinalize() {
    const root = await makeWorkspace('page-anchor-finalize');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# #tmp-ch Draft Chapter',
        '',
        '正文引用本章 @tmp-ch.full。',
        '',
        '## #tmp-sec Local Section',
        '',
        '正文引用小节 @tmp-sec.title。',
        ''
    ].join('\n'));

    const finish = runCli(root, ['finish', 'book1/01-a.md']);
    assert.equal(finish.status, 0, combinedOutput(finish));
    const chapter = await read(root, 'book1/01-a.md');
    assert.doesNotMatch(chapter, /tmp-ch|tmp-sec/);
    assert.match(chapter, /^# #h-[a-f0-9]{16} Draft Chapter/m);
    assert.match(chapter, /^## #h-[a-f0-9]{16} Local Section/m);
    assert.match(chapter, /@h-[a-f0-9]{16}\.full/);
    assert.match(chapter, /@h-[a-f0-9]{16}\.title/);

    const referenceMap = await read(root, '.math-workspace/reference-map.md');
    assert.match(referenceMap, /\| 第 1 章 \| `@h-[a-f0-9]{16}` \| `@chapter:book1\/01-a\.md` \| Draft Chapter \|/);
}

async function testMigrateTextRefsSectionsAndAudits() {
    const root = await makeWorkspace('text-refs-audit');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '## #h-3333333333333333 背景',
        '',
        'Background.',
        '',
        '定理 #h-4444444444444444（Base）：Base statement.',
        '',
        '定义（谱）：A definition body.',
        '',
        '见第 1.1 节、§1.1 和 1.1 节。',
        '链接 [定理 1.1](old.md#thm) 需要人工处理。',
        '根据谱定义可得。',
        '## 1.2 旧小节标题',
        ''
    ].join('\n'));

    const apply = runCli(root, ['migrate-text-refs', '--apply', 'book1/01-a.md']);
    assert.equal(apply.status, 0, combinedOutput(apply));
    const chapter = await read(root, 'book1/01-a.md');
    assert.match(chapter, /见@h-3333333333333333、@h-3333333333333333 和 @h-3333333333333333。/);
    assert.match(chapter, /链接 \[定理 1\.1\]\(old\.md#thm\) 需要人工处理。/);
    assert.match(chapter, /根据谱定义可得。/);

    const report = await read(root, '.math-workspace/text-ref-migration.md');
    assert.match(report, /Replacements: 3/);
    assert.match(report, /Markdown links needing manual rewrite: 1/);
    assert.match(report, /Section headings needing numbered markers: 1/);
    assert.match(report, /\[定理 1\.1\]\(old\.md#thm\).*suggested @h-4444444444444444/);
    assert.match(report, /book1\/01-a\.md:14: ## 1\.2 旧小节标题/);
}

async function testMigrateTextRefsUpdatesIncomingByDefault() {
    const root = await makeWorkspace('text-refs-incoming');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定理 #h-aaaaaaaaaaaaaaaa（Target）：Target statement.',
        '',
        'Target chapter outgoing 定理 2.1.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '02-b.md'), [
        '# Chapter 2',
        '',
        '定理 #h-bbbbbbbbbbbbbbbb（Outside）：Outside statement.',
        '',
        'Incoming 定理 1.1 should update.',
        'Unrelated 定理 2.1 should stay for later migration.',
        'Link [定理 1.1](old.md#target) should be reported.',
        'Other link [定理 2.1](old.md#outside) should not be reported.',
        ''
    ].join('\n'));

    const apply = runCli(root, ['migrate-text-refs', '--apply', 'book1/01-a.md']);
    assert.equal(apply.status, 0, combinedOutput(apply));
    const chapter1 = await read(root, 'book1/01-a.md');
    const chapter2 = await read(root, 'book1/02-b.md');
    assert.match(chapter1, /Target chapter outgoing @h-bbbbbbbbbbbbbbbb\./);
    assert.match(chapter2, /Incoming @h-aaaaaaaaaaaaaaaa should update\./);
    assert.match(chapter2, /Unrelated 定理 2\.1 should stay for later migration\./);
    assert.match(chapter2, /Link \[定理 1\.1\]\(old\.md#target\) should be reported\./);
    assert.match(chapter2, /Other link \[定理 2\.1\]\(old\.md#outside\) should not be reported\./);

    const report = await read(root, '.math-workspace/text-ref-migration.md');
    assert.match(report, /Reference scope: target files plus incoming refs across all files/);
    assert.match(report, /Replacements: 2/);
    assert.match(report, /Unresolved: 0/);
    assert.match(report, /Markdown links needing manual rewrite: 1/);
    assert.match(report, /\[定理 1\.1\]\(old\.md#target\).*suggested @h-aaaaaaaaaaaaaaaa/);
    assert.doesNotMatch(report, /old\.md#outside/);
}

async function testVerifyRejectsNonHashIds() {
    const root = await makeWorkspace('verify');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定理 #semantic-id（Semantic）：Statement.',
        ''
    ].join('\n'));

    const verify = runCli(root, ['verify']);
    assert.notEqual(verify.status, 0, combinedOutput(verify));
    assert.match(combinedOutput(verify), /non-hash-id/);
}

async function testVerifyRejectsMissingDefinitionContent() {
    const root = await makeWorkspace('definition-content');
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'definitions.json'), JSON.stringify([
        {
            term: 'Indexed Concept',
            source: 'book1/01-a.md:3'
        }
    ], null, 2));
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        'We call this object an Indexed Concept.',
        ''
    ].join('\n'));

    const verify = runCli(root, ['verify']);
    assert.notEqual(verify.status, 0, combinedOutput(verify));
    assert.match(combinedOutput(verify), /definition-content-missing/);
}

async function testScanExcludeAndZeroIntroductionPages() {
    const root = await makeWorkspace('scan-exclude');
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'config.json'), JSON.stringify({
        scan: {
            exclude: [
                'draft/**',
                '.context/**',
                'formal-oet/.lake/**'
            ]
        }
    }, null, 2));
    await fs.mkdir(path.join(root, 'book1', 'vol-1'), { recursive: true });
    await fs.mkdir(path.join(root, 'book1', 'vol-2'), { recursive: true });
    await fs.mkdir(path.join(root, 'draft'), { recursive: true });
    await fs.mkdir(path.join(root, '.context'), { recursive: true });
    await fs.mkdir(path.join(root, 'formal-oet', '.lake'), { recursive: true });

    await fs.writeFile(path.join(root, 'book1', 'vol-1', '00-introduction.md'), [
        '# 第一卷导读',
        '',
        'This page should be an intro, not chapter 0.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', 'vol-1', '01-main.md'), [
        '# Chapter 1',
        '',
        '定理 #h-1111111111111111（Main）：Statement.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', 'vol-2', '00-introduction.md'), [
        '# 第二卷导读',
        '',
        'This second intro should not duplicate chapter 0.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', 'vol-2', '02-next.md'), [
        '# Chapter 2',
        '',
        '定理 #h-2222222222222222（Next）：Statement.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'draft', '01-bad.md'), '定理 #semantic-draft（Bad）：Should be excluded.\n');
    await fs.writeFile(path.join(root, '.context', '01-bad.md'), '定理 #semantic-context（Bad）：Should be excluded.\n');
    await fs.writeFile(path.join(root, 'formal-oet', '.lake', '01-bad.md'), '定理 #semantic-lake（Bad）：Should be excluded.\n');

    const verify = runCli(root, ['verify']);
    assert.equal(verify.status, 0, combinedOutput(verify));
    const readerIndex = JSON.parse(await read(root, '.math-workspace/workspace-index.json'));
    assert.equal(readerIndex.pages.filter(page => page.kind === 'intro').length, 2);
    assert.equal(readerIndex.pages.filter(page => page.kind === 'chapter' && page.chapter === 0).length, 0);
    assert.equal(readerIndex.pages.some(page => page.filePath.startsWith('draft/')), false);
    assert.equal(readerIndex.pages.some(page => page.filePath.startsWith('.context/')), false);
    assert.equal(readerIndex.pages.some(page => page.filePath.startsWith('formal-oet/.lake/')), false);
}

async function testPageTitleUsesUniqueHighestHeading() {
    const root = await makeWorkspace('page-title');
    await fs.writeFile(path.join(root, 'book1', '01-lowered.md'), [
        '## Lowered Chapter Title',
        '',
        '### Local Section',
        '',
        '定理 #h-1111111111111111（Main）：Statement.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '02-formal-only.md'), [
        '## #h-2222222222222222 Stable Section',
        '',
        'Content.',
        '',
        '## #h-3333333333333333 Another Stable Section',
        '',
        'Content.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '03-ambiguous.md'), [
        '# First Candidate',
        '',
        '# Second Candidate',
        '',
        '定理 #h-4444444444444444（Ambiguous）：Statement.',
        ''
    ].join('\n'));

    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));
    const readerIndex = JSON.parse(await read(root, '.math-workspace/workspace-index.json'));
    const titleFor = filePath => readerIndex.pages.find(page => page.filePath === filePath)?.title;

    assert.equal(titleFor('book1/01-lowered.md'), 'Lowered Chapter Title');
    assert.equal(titleFor('book1/02-formal-only.md'), 'formal only');
    assert.equal(titleFor('book1/03-ambiguous.md'), 'ambiguous');

    const audit = runCli(root, ['audit', 'book1/01-lowered.md']);
    assert.equal(audit.status, 0, combinedOutput(audit));
    const report = await read(root, '.math-workspace/audit.md');
    assert.doesNotMatch(report, /Lowered Chapter Title/);
    assert.match(report, /Local Section/);
}

async function testPageIntegrationStatus() {
    const root = await makeWorkspace('page-integration');
    await fs.writeFile(path.join(root, 'book1', '01-managed.md'), [
        '# #h-1111111111111111 Managed page',
        '',
        'Content.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '02-segmented.md'), [
        '## #h-2222222222222222 First segment',
        '',
        'Content.',
        '',
        '## #h-3333333333333333 Second segment',
        '',
        'Content.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '03-unmanaged.md'), [
        '# Unmanaged page',
        '',
        'Content.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '04-attention.md'), [
        '# #tmp-page Pending page',
        '',
        'Content.',
        ''
    ].join('\n'));

    const prepare = runCli(root, ['prepare']);
    assert.notEqual(prepare.status, 0, combinedOutput(prepare));
    assert.match(combinedOutput(prepare), /tmp-id-left/);
    const readerIndex = JSON.parse(await read(root, '.math-workspace/workspace-index.json'));
    const integrationFor = filePath => readerIndex.pages.find(page => page.filePath === filePath)?.integration;

    assert.deepEqual(integrationFor('book1/01-managed.md'), {
        status: 'managed',
        stableAnchorCount: 1,
        temporaryAnchorCount: 0,
        issueCount: 0
    });
    assert.deepEqual(integrationFor('book1/02-segmented.md'), {
        status: 'segmented',
        stableAnchorCount: 2,
        temporaryAnchorCount: 0,
        issueCount: 0
    });
    assert.deepEqual(integrationFor('book1/03-unmanaged.md'), {
        status: 'unmanaged',
        stableAnchorCount: 0,
        temporaryAnchorCount: 0,
        issueCount: 0
    });
    assert.deepEqual(integrationFor('book1/04-attention.md'), {
        status: 'attention',
        stableAnchorCount: 0,
        temporaryAnchorCount: 1,
        issueCount: 1
    });
}

async function testPerfDummyThresholds() {
    const root = await makeWorkspace('perf');
    const pass = runCli(root, ['perf-dummy', '2', '5', '--max-ms', '10000', '--max-heap-mb', '512']);
    assert.equal(pass.status, 0, combinedOutput(pass));

    const fail = runCli(root, ['perf-dummy', '2', '5', '--max-heap-mb', '0']);
    assert.notEqual(fail.status, 0, combinedOutput(fail));
    assert.match(combinedOutput(fail), /PERF failed: heap/);
}

async function testLeanAnchorIndex() {
    const root = await makeWorkspace('lean-index');
    await fs.writeFile(path.join(root, 'book1', '01-foundations.md'), [
        '# Chapter 1',
        '',
        '定理 #h-3333333333333333（Finite cover）：Every open cover has a finite subcover.',
        '',
        'Proof: direct.',
        ''
    ].join('\n'));
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.mkdir(path.join(root, 'formal', 'src'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'config.json'), JSON.stringify({
        lean: {
            projects: [{
                key: 'fixture',
                root: 'formal',
                sourceRoots: ['src'],
                target: 'fixture',
                anchorPrefix: 'Book anchor:'
            }]
        }
    }, null, 2));
    const leanPath = path.join(root, 'formal', 'src', 'Fixture.lean');
    await fs.writeFile(leanPath, [
        'namespace Fixture',
        '',
        '/-- Book anchor: h-3333333333333333 **Finite cover** -/',
        'theorem finite_cover : True := by trivial',
        '',
        'end Fixture',
        ''
    ].join('\n'));

    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));
    assert.match(combinedOutput(prepare), /Lean anchors: 1 matched formal objects, 1 declarations, 0 unknown anchors/);
    const index = JSON.parse(await read(root, '.math-workspace/lean-index.json'));
    assert.equal(index.summary.leanFiles, 1);
    assert.equal(index.summary.anchors, 1);
    assert.equal(index.summary.matchedAnchors, 1);
    assert.equal(index.summary.eligibleFormalObjects, 1);
    assert.equal(index.summary.anchoredEligibleFormalObjects, 1);
    assert.equal(index.anchors['h-3333333333333333'].declarations[0].name, 'finite_cover');
    assert.equal(index.anchors['h-3333333333333333'].declarations[0].qualifiedName, 'Fixture.finite_cover');
    assert.equal(index.anchors['h-3333333333333333'].status.contract, 'untracked');
    assert.match(await read(root, '.math-workspace/lean-report.md'), /Anchor records a deterministic link|An anchor records a deterministic link/);

    const capture = runCli(root, ['lean', 'capture']);
    assert.equal(capture.status, 0, combinedOutput(capture));
    const captured = JSON.parse(await read(root, '.math-workspace/lean-index.json'));
    assert.equal(captured.anchors['h-3333333333333333'].status.contract, 'current');

    await fs.writeFile(path.join(root, 'book1', '01-foundations.md'), [
        '# Chapter 1',
        '',
        '定理 #h-3333333333333333（Finite cover）：Every open cover has a finite subcover when the cover is indexed.',
        '',
        'Proof: direct.',
        ''
    ].join('\n'));
    const drift = runCli(root, ['lean', 'verify']);
    assert.equal(drift.status, 0, combinedOutput(drift));
    const drifted = JSON.parse(await read(root, '.math-workspace/lean-index.json'));
    assert.equal(drifted.anchors['h-3333333333333333'].status.contract, 'markdown-drifted');

    const coverage = runCli(root, ['lean', 'coverage']);
    assert.equal(coverage.status, 0, combinedOutput(coverage));
    assert.match(combinedOutput(coverage), /Eligible objects with anchors \| 1/);

    await fs.appendFile(leanPath, [
        '',
        '/-- Book anchor: h-9999999999999999 **Unknown** -/',
        'lemma unknown_anchor : True := by trivial',
        ''
    ].join('\n'));
    const verify = runCli(root, ['lean', 'verify']);
    assert.notEqual(verify.status, 0, combinedOutput(verify));
    assert.match(combinedOutput(verify), /1 unknown/);
    assert.match(await read(root, '.math-workspace/lean-report.md'), /lean-anchor-unknown/);
}

async function testLeanBuildAndDependencyComparison() {
    const root = await makeWorkspace('lean-dependencies');
    await fs.writeFile(path.join(root, 'book1', '01-foundations.md'), [
        '# Chapter 1',
        '',
        '定理 #h-1111111111111111（Seed）：A seed assertion.',
        '',
        'Proof: direct.',
        '',
        '命题 #h-2222222222222222（Consequence）：The conclusion holds.',
        '',
        'Proof: by @h-1111111111111111.',
        ''
    ].join('\n'));
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.mkdir(path.join(root, 'formal', 'src'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'config.json'), JSON.stringify({
        lean: {
            projects: [{
                key: 'fixture',
                root: 'formal',
                sourceRoots: ['src'],
                target: 'Fixture',
                module: 'Fixture',
                anchorPrefix: 'Book anchor:'
            }]
        }
    }, null, 2));
    await fs.writeFile(path.join(root, 'formal', 'lakefile.toml'), [
        'name = "fixture"',
        'version = "0.1.0"',
        '',
        '[[lean_lib]]',
        'name = "Fixture"',
        'srcDir = "src"',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'formal', 'src', 'Fixture.lean'), [
        'namespace Fixture',
        '',
        '/-- Book anchor: h-1111111111111111 **Seed** -/',
        'theorem seed : True := by trivial',
        '',
        '/-- Book anchor: h-2222222222222222 **Consequence** -/',
        'theorem consequence : True := by exact seed',
        '',
        'end Fixture',
        ''
    ].join('\n'));

    const capture = runCli(root, ['lean', 'capture']);
    assert.equal(capture.status, 0, combinedOutput(capture));
    const build = runCli(root, ['lean', 'build']);
    assert.equal(build.status, 0, combinedOutput(build));
    const dependencies = runCli(root, ['lean', 'dependencies']);
    const graph = JSON.parse(await read(root, '.math-workspace/lean-dependency-graph.json'));
    assert.equal(
        dependencies.status,
        0,
        `${combinedOutput(dependencies)}\n${JSON.stringify(graph.diagnostics, null, 2)}`
    );

    const index = JSON.parse(await read(root, '.math-workspace/lean-index.json'));
    assert.equal(index.anchors['h-1111111111111111'].status.build, 'passed');
    assert.equal(index.anchors['h-2222222222222222'].status.dependencies, 'matched');
    assert.ok(graph.comparisons['h-2222222222222222'].shared.includes('h-1111111111111111'));
    assert.match(await read(root, '.math-workspace/lean-dependency-report.md'), /direct references in elaborated Lean declaration types and proof values/);
}

async function testReaderServer() {
    const root = await makeWorkspace('reader');
    const chapterPath = path.join(root, 'book1', '01-foundations.md');
    await fs.writeFile(chapterPath, [
        '# #h-1111111111111111 Foundations',
        '',
        '## #h-2222222222222222 Compactness',
        '',
        '定理 #h-3333333333333333（Finite cover）：Every open cover has a finite subcover.',
        '',
        'A related strengthening: see @h-4444444444444444.',
        '',
        'Proof: direct.',
        '',
        '命题 #h-4444444444444444（Consequence）：By @h-3333333333333333 and @h-2222222222222222, the conclusion follows.',
        '',
        'By @h-3333333333333333, the conclusion follows.',
        '',
        '注 #h-5555555555555555（Supporting Fact）：This supplemental fact is proof-backed.',
        '',
        'Proof: by @h-3333333333333333. $\\square$',
        '',
        '> 注（Related reading）：A later note cites @h-4444444444444444.',
        '',
        '注（Plain Note）：This explanatory note must not receive a marker.',
        ''
    ].join('\n'));
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.mkdir(path.join(root, 'formal', 'src'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'config.json'), JSON.stringify({
        lean: {
            projects: [{
                key: 'reader-fixture',
                root: 'formal',
                sourceRoots: ['src'],
                anchorPrefix: 'Book anchor:'
            }]
        }
    }, null, 2));
    await fs.writeFile(path.join(root, 'formal', 'src', 'Fixture.lean'), [
        '/-- Book anchor: h-3333333333333333 **Finite cover** -/',
        'theorem finite_cover : True := by trivial',
        '',
        '/-- Book anchor: h-5555555555555555 **Supporting Fact** -/',
        'lemma supporting_fact : True := by trivial',
        ''
    ].join('\n'));
    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));
    const dependencyGraph = JSON.parse(await read(root, '.math-workspace/dependency-graph.json'));
    assert.ok(dependencyGraph.edges.some(edge => (
        edge.from === 'h-3333333333333333'
        && edge.to === 'h-4444444444444444'
        && edge.where === 'statement'
        && edge.relation === 'explanatory'
    )));

    const reader = await startReader(root, {
        env: { MATH_WORKSPACE_STATE: path.join(root, 'reader-projects.json') }
    });
    try {
        const readerDocumentResponse = await fetch(reader.url + '/');
        const contentSecurityPolicy = readerDocumentResponse.headers.get('content-security-policy') || '';
        assert.match(contentSecurityPolicy, /style-src-attr 'unsafe-inline'/);
        assert.doesNotMatch(contentSecurityPolicy, /script-src[^;]*'unsafe-inline'/);

        const state = await (await fetch(reader.url + '/api/state')).json();
        assert.equal(state.pages.length, 1);
        assert.equal(state.pages[0].filePath, 'book1/01-foundations.md');
        assert.equal('labels' in state, false);

        const page = await (await fetch(reader.url + '/api/page?path=book1%2F01-foundations.md')).json();
        assert.match(page.content, /Finite cover/);
        assert.equal(page.page.displayHeading, '第 1 章 Foundations');
        assert.equal(page.labels['h-3333333333333333'].content, undefined);
        const theoremMarker = page.dependencyMarkers['h-3333333333333333'];
        assert.equal(theoremMarker.leanDeclarationCount, 1);
        assert.equal(theoremMarker.kind, 'theorem-like');
        assert.equal(theoremMarker.directDependencies, 0);
        assert.equal(theoremMarker.directDependents, 2);
        assert.equal(theoremMarker.impactCount, 2);
        assert.equal(theoremMarker.ambientReferenceCount, 1);
        assert.deepEqual(theoremMarker.leanStatus, {
            contract: 'untracked',
            build: 'unverified',
            dependencies: 'unavailable'
        });
        assert.deepEqual(theoremMarker.downstream.map(item => item.id).sort(), ['h-4444444444444444', 'h-5555555555555555']);
        assert.deepEqual(page.dependencyMarkers['h-4444444444444444'], {
            directDependencies: 1,
            sourceReferenceCount: 2,
            directDependents: 0,
            impactCount: 0,
            ambientReferenceCount: 1,
            role: 'leaf',
            kind: 'theorem-like',
            upstream: [{
                id: 'h-3333333333333333',
                display: '定理 1.1',
                title: 'Finite cover',
                filePath: 'book1/01-foundations.md',
                kind: 'theorem-like'
            }],
            downstream: []
        });
        assert.deepEqual(page.dependencyMarkers['h-5555555555555555'], {
            directDependencies: 1,
            sourceReferenceCount: 1,
            directDependents: 0,
            impactCount: 0,
            ambientReferenceCount: 0,
            role: 'leaf',
            kind: 'remark',
            leanDeclarationCount: 1,
            leanStatus: {
                contract: 'untracked',
                build: 'unverified',
                dependencies: 'unavailable'
            },
            upstream: [{
                id: 'h-3333333333333333',
                display: '定理 1.1',
                title: 'Finite cover',
                filePath: 'book1/01-foundations.md',
                kind: 'theorem-like'
            }],
            downstream: []
        });

        const lean = await (await fetch(reader.url + '/api/lean?id=h-3333333333333333')).json();
        assert.equal(lean.id, 'h-3333333333333333');
        assert.equal(lean.declarations[0].name, 'finite_cover');
        assert.equal(lean.status.contract, 'untracked');
        assert.equal(lean.status.build, 'unverified');

        const recall = await (await fetch(reader.url + '/api/recall?id=h-3333333333333333')).json();
        assert.match(recall.content, /Finite cover/);
        assert.equal(recall.display, '定理 1.1');

        const sectionRecall = await (await fetch(reader.url + '/api/recall?id=h-2222222222222222')).json();
        assert.match(sectionRecall.content, /Compactness/);
        assert.match(sectionRecall.content, /Finite cover/);
        assert.equal(sectionRecall.display, '§ 1.1');

        const initialRevision = state.revision;
        await fs.appendFile(chapterPath, '\nA live update.\n');
        const refreshed = await waitFor(async () => {
            const next = await (await fetch(reader.url + '/api/state')).json();
            return next.revision > initialRevision ? next : undefined;
        });
        assert.ok(refreshed.revision > initialRevision);
    } finally {
        await stopReader(reader.child);
    }
}

async function testReaderMcpServer() {
    const root = await makeWorkspace('reader-mcp');
    await fs.writeFile(path.join(root, 'book1', '01-foundations.md'), [
        '# #h-1111111111111111 Foundations',
        '',
        '定义（紧致性）：每个开覆盖都有有限子覆盖。',
        '',
        '定理 #h-3333333333333333（Finite cover）：Every open cover has a finite subcover.',
        ''
    ].join('\n'));
    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));

    const rootPath = await fs.realpath(root);
    const discussionMarksPath = path.join(root, 'discussion-marks.json');
    const symbolAuditStatePath = path.join(root, 'symbol-audit.json');
    await fs.writeFile(discussionMarksPath, JSON.stringify({
        version: 1,
        marks: [{
            id: 'mwmark_reader_mcp',
            order: 1,
            createdAt: '2026-08-04T00:00:00.000Z',
            rootPath,
            revision: 1,
            filePath: 'book1/01-foundations.md',
            title: 'Finite cover',
            startLine: 5,
            endLine: 5,
            sourceHash: 'fixture',
            kind: 'selection'
        }]
    }));
    const auditBinding = {
        id: 'mwsym_fixture_c',
        filePath: 'book1/01-foundations.md',
        startLine: 5,
        endLine: 5,
        expression: 'C',
        normalizedExpression: 'C',
        structure: { base: 'C', modifiers: [] },
        kind: 'temporary',
        scope: 'local',
        bindingKey: 'cover-constant',
        semanticType: 'constant',
        meaning: 'a local cover constant',
        evidence: 'C is fixed in this theorem.',
        confidence: 'high'
    };
    await fs.writeFile(symbolAuditStatePath, JSON.stringify({
        version: 1,
        projects: {
            [rootPath]: {
                settings: {},
                extractions: {},
                reports: {
                    legacy: {
                        cacheKey: 'legacy',
                        createdAt: '2026-08-04T00:00:00.000Z',
                        inputHash: 'fixture',
                        promptVersion: 'symbol-audit-v2',
                        reviewVersion: 'symbol-audit-reconciliation-v1',
                        bindingCount: 1,
                        externalSpecialBindingCount: 0,
                        scannedFiles: 1,
                        reusedFiles: 0,
                        hardConflicts: [{
                            expression: 'C',
                            severity: 'hard',
                            reason: 'A local binding collides with maintained notation.',
                            bindings: [auditBinding]
                        }],
                        candidates: [{ expression: 'C', bindings: [auditBinding] }],
                        reconciliations: [],
                        advisories: []
                    }
                },
                latestReportKey: 'legacy'
            }
        }
    }));

    const mcp = await startMcp(root, { env: {
        MATH_WORKSPACE_DISCUSSION_MARKS: discussionMarksPath,
        MATH_WORKSPACE_SYMBOL_AUDIT_STATE: symbolAuditStatePath
    } });
    try {
        const tools = await mcp.request('tools/list');
        const names = tools.tools.map(tool => tool.name).sort();
        assert.deepEqual(names, [
            'inspect_dependencies',
            'inspect_lean_alignment',
            'lookup_formal_object',
            'lookup_knowledge',
            'open',
            'read_marks',
            'read_symbol_audit',
            'verify'
        ]);
        tools.tools.forEach(tool => assert.equal(tool._meta, undefined));

        const launch = await mcp.request('tools/call', {
            name: 'open',
            arguments: { pagePath: 'book1/01-foundations.md' }
        });
        assert.equal(launch.isError, undefined);
        assert.equal(launch.structuredContent.rootPath, rootPath);
        assert.equal(launch.structuredContent.pagePath, 'book1/01-foundations.md');
        assert.match(launch.structuredContent.url, /^http:\/\/127\.0\.0\.1:\d+\/\?path=book1%2F01-foundations\.md$/);
        assert.match(launch.content[0].text, /Codex's local browser/);

        const marks = await mcp.request('tools/call', { name: 'read_marks', arguments: {} });
        assert.equal(marks.structuredContent.result.marks.length, 1);
        assert.match(marks.content[0].text, /已读取 1 个标记。/);

        const knowledge = await mcp.request('tools/call', {
            name: 'lookup_knowledge',
            arguments: { query: '紧致性' }
        });
        assert.equal(knowledge.isError, undefined, JSON.stringify(knowledge));
        assert.ok(knowledge.structuredContent.result.matches.some(match => match.kind === 'definition' && match.title === '紧致性'));

        const audit = await mcp.request('tools/call', { name: 'read_symbol_audit', arguments: {} });
        assert.equal(audit.isError, undefined, JSON.stringify(audit));
        assert.equal(audit.structuredContent.result.reportState, 'stale');
        assert.equal(audit.structuredContent.result.report.hardConflictCount, 1);
        assert.equal(audit.structuredContent.result.report.findings[0].expression, 'C');
        assert.equal(audit.structuredContent.result.report.findings[0].bindings[0].filePath, 'book1/01-foundations.md');
    } finally {
        await stopReader(mcp.child);
    }
}
async function testReaderPluginMcpConfig() {
    const pluginRoot = path.join(repoRoot, 'plugins', 'math-workspace');
    const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
    const mcpConfig = JSON.parse(await fs.readFile(path.join(pluginRoot, '.mcp.json'), 'utf8'));

    assert.equal(manifest.mcpServers, './.mcp.json');
    assert.deepEqual(mcpConfig, {
        mcpServers: {
            'math-workspace': {
                command: './scripts/launch_math_workspace_mcp',
                args: ['mcp'],
                cwd: '.',
                env_vars: [
                    'CODEX_HOME',
                    'CODEX_MCP_NODE_PATH',
                    'CODEX_BROWSER_USE_NODE_PATH',
                    'CODEX_ELECTRON_RESOURCES_PATH',
                    'CODEX_CLI_PATH',
                    'XDG_CACHE_HOME'
                ]
            }
        }
    });
    const launcherPath = path.join(pluginRoot, 'scripts', 'launch_math_workspace_mcp');
    const launcher = await fs.stat(launcherPath);
    assert.ok((launcher.mode & 0o111) !== 0);
    await fs.access(path.join(pluginRoot, 'out', 'cli', 'math-workspace.js'));
    await fs.access(path.join(pluginRoot, 'out', 'reader', 'index.html'));
}

async function testSimplifiedCliFlow() {
    const root = await makeWorkspace('simple-cli');
    await fs.writeFile(path.join(root, 'book1', '01-start.md'), '# Start\n');

    const init = runCli(root, ['init']);
    assert.equal(init.status, 0, combinedOutput(init));
    assert.match(init.stdout, /Initialized Math Workspace:/);
    await fs.access(path.join(root, '.math-workspace', 'config.json'));

    const nested = path.join(root, 'book1', 'notes');
    await fs.mkdir(nested, { recursive: true });
    const doctor = runCli(nested, ['doctor']);
    assert.equal(doctor.status, 0, combinedOutput(doctor));
    const canonicalRoot = await fs.realpath(root);
    assert.match(doctor.stdout, new RegExp(`Project root: ${canonicalRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(doctor.stdout, /Configuration: found/);
    assert.match(doctor.stdout, /Reader bundle: ready/);
}

async function testReaderDiscussionMarks() {
    const root = await makeWorkspace('reader-discussion-marks');
    const chapterPath = path.join(root, 'book1', '01-foundations.md');
    await fs.writeFile(chapterPath, [
        '# #h-1111111111111111 Foundations',
        '',
        '定理 #h-3333333333333333（Finite cover）：Every open cover has a finite subcover.',
        '',
        '推论 #h-4444444444444444（Consequence）：Apply @h-3333333333333333.',
        ''
    ].join('\n'));
    assert.equal(runCli(root, ['prepare']).status, 0);
    const env = {
        MATH_WORKSPACE_STATE: path.join(root, 'reader-projects.json'),
        MATH_WORKSPACE_DISCUSSION_MARKS: path.join(root, 'reader-discussion-marks.json')
    };
    const reader = await startReader(root, { env });
    try {
        const state = await (await fetch(reader.url + '/api/state')).json();
        const unauthorized = await fetch(reader.url + '/api/discussion-marks');
        assert.equal(unauthorized.status, 403);
        const created = await fetch(reader.url + '/api/discussion-marks', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-math-workspace-token': state.requestToken
            },
            body: JSON.stringify({ marks: [
                { filePath: 'book1/01-foundations.md', startLine: 3, endLine: 3, kind: 'formal', formalId: 'h-3333333333333333' },
                { filePath: 'book1/01-foundations.md', startLine: 5, endLine: 5, kind: 'region' },
                {
                    filePath: 'book1/01-foundations.md',
                    startLine: 3,
                    endLine: 3,
                    kind: 'selection',
                    startTextOffset: 21,
                    endTextOffset: 25
                }
            ] })
        });
        assert.equal(created.status, 200);
        const createdPayload = await created.json();
        assert.equal(createdPayload.marks.length, 3);
        assert.equal(createdPayload.marks[0].status, 'current');
        assert.equal(createdPayload.marks[0].formalId, 'h-3333333333333333');
        assert.equal(createdPayload.marks[2].startTextOffset, 21);
        assert.equal(createdPayload.marks[2].endTextOffset, 25);
        assert.equal('markdown' in createdPayload.marks[0], false);

        const stored = JSON.parse(await fs.readFile(env.MATH_WORKSPACE_DISCUSSION_MARKS, 'utf8'));
        assert.equal(stored.marks.length, 3, JSON.stringify(stored));
        assert.equal(stored.marks[0].rootPath, await fs.realpath(root), JSON.stringify(stored));
        assert.equal(typeof stored.marks[0].sourceHash, 'string');

        const listed = await fetch(reader.url + '/api/discussion-marks', {
            headers: { 'x-math-workspace-token': state.requestToken }
        });
        assert.equal(listed.status, 200);
        const listedPayload = await listed.json();
        assert.equal(listedPayload.marks.length, 3);

        const mcp = await startMcp(root, { env });
        try {
            const tools = await mcp.request('tools/list');
            assert.ok(tools.tools.some(tool => tool.name === 'read_marks'));
            const marked = await mcp.request('tools/call', {
                name: 'read_marks',
                arguments: {}
            });
            assert.equal(marked.isError, undefined, JSON.stringify(marked));
            const result = marked.structuredContent.result;
            assert.equal(result.marks.length, 3);
            assert.equal(result.marks[0].filePath, 'book1/01-foundations.md');
            assert.equal(result.marks[0].startLine, 3);
            assert.equal(result.marks[2].startTextOffset, 21);
            assert.equal(result.marks[2].endTextOffset, 25);
            assert.equal(JSON.stringify(result).includes('Every open cover has a finite subcover.'), false);

            await fs.writeFile(chapterPath, (await fs.readFile(chapterPath, 'utf8')).replace('finite subcover.', 'finite extracted subcover.'));
            const stale = await mcp.request('tools/call', {
                name: 'read_marks',
                arguments: {}
            });
            assert.equal(stale.structuredContent.result.marks[0].status, 'changed');
        } finally {
            await stopReader(mcp.child);
        }

        const removed = await fetch(reader.url + '/api/discussion-marks?id=' + encodeURIComponent(createdPayload.marks[0].id), {
            method: 'DELETE',
            headers: { 'x-math-workspace-token': state.requestToken }
        });
        assert.equal(removed.status, 200);
        const cleared = await fetch(reader.url + '/api/discussion-marks', {
            method: 'DELETE',
            headers: { 'x-math-workspace-token': state.requestToken }
        });
        assert.equal((await cleared.json()).cleared, 2);
    } finally {
        await stopReader(reader.child);
    }
}

async function testReaderSymbolAudit() {
    const root = await makeWorkspace('reader-symbol-audit');
    await fs.writeFile(path.join(root, 'book1', '01-local.md'), [
        '# #h-1111111111111111 Local notation',
        '',
        'In this derivation, let $C$ be a temporary bound constant.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '02-cyclic.md'), [
        '# #h-2222222222222222 Cyclic notation',
        '',
        '定义 $C$ 为循环算子网络。',
        ''
    ].join('\n'));
    await fs.mkdir(path.join(root, 'book2'), { recursive: true });
    await fs.writeFile(path.join(root, 'book2', '03-outside.md'), [
        '# #h-3333333333333333 Outside notation',
        '',
        'This chapter is outside the focused audit range.',
        ''
    ].join('\n'));
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'config.json'), '{}\n');
    await fs.writeFile(path.join(root, '.math-workspace', 'symbols.json'), JSON.stringify([{
        pattern: 'C',
        display: '$C$',
        meaning: '循环算子网络',
        scope: 'book',
        source: 'book1/02-cyclic.md:3'
    }], null, 2));
    assert.equal(runCli(root, ['prepare']).status, 0);

    const counterPath = path.join(root, 'symbol-audit-turns.txt');
    const fakeCodex = path.join(root, 'fake-codex-symbol-audit.mjs');
    await fs.writeFile(fakeCodex, `#!/usr/bin/env node
import fs from 'node:fs';
let buffer = '';
let threadCount = 0;
const write = value => process.stdout.write(JSON.stringify(value) + '\\n');
const receive = message => {
  if (message.method === 'initialize') {
    if (message.params.capabilities?.experimentalApi !== true) return write({ id: message.id, error: { message: 'experimental API capability was not enabled' } });
    return write({ id: message.id, result: { platformFamily: 'test' } });
  }
  if (message.method === 'model/list') return write({ id: message.id, result: { data: [{
    id: 'symbol-model', model: 'gpt-symbol', displayName: 'Symbol test model', description: 'fixture', hidden: false, isDefault: true,
    defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'low' }, { reasoningEffort: 'high', description: 'high' }]
  }], nextCursor: null } });
  if (message.method === 'thread/start') {
    if (message.params.ephemeral !== true || message.params.sandbox !== 'read-only' || message.params.approvalPolicy !== 'never' || message.params.model !== 'gpt-symbol') {
      return write({ id: message.id, error: { message: 'Symbol audit must use the configured ephemeral read-only model.' } });
    }
    threadCount += 1;
    return write({ id: message.id, result: { thread: { id: 'symbol-thread-' + threadCount } } });
  }
  if (message.method === 'turn/start') {
    if (message.params.model !== 'gpt-symbol' || message.params.effort !== 'high' || !message.params.outputSchema) {
      return write({ id: message.id, error: { message: 'Symbol audit turn did not use its configured model, effort, and schema.' } });
    }
    fs.appendFileSync(${JSON.stringify(counterPath)}, 'turn\\n');
    const prompt = message.params.input?.[0]?.text || '';
    const shouldFail = prompt.includes('TRIGGER_SYMBOL_AUDIT_FAILURE');
    const result = prompt.includes('Candidate groups')
      ? { reconciliations: [
          { expression: 'C', relation: 'conflict', confidence: 'high', readerRisk: true, reason: 'C has incompatible overlapping meanings.', bindingKeys: ['local-bound-constant', 'cyclic-operator-network'] },
          { expression: 'S', relation: 'same-binding', confidence: 'high', readerRisk: false, reason: 'Both occurrences describe the same summary symbol.', bindingKeys: ['summary-symbol', 'summary-notation'] }
        ] }
      : prompt.includes('01-local.md')
        ? { bindings: [
            { expression: 'C', startLine: 3, endLine: 3, structure: { base: 'C', modifiers: [] }, kind: 'temporary', scope: 'local', bindingKey: 'local-bound-constant', semanticType: 'constant', meaning: '局部推导中的临时有界常数', evidence: 'let C be a temporary bound constant', confidence: 'high' },
            { expression: 'S', startLine: 3, endLine: 3, structure: { base: 'S', modifiers: [] }, kind: 'special', scope: 'book', bindingKey: 'summary-symbol', semanticType: 'set', meaning: '同一个汇总符号', evidence: 'summary notation S', confidence: 'high' }
          ] }
        : prompt.includes('03-outside.md')
          ? 'No project-relevant mathematical symbols are defined or used in this source.'
        : { bindings: [
            { expression: 'C', startLine: 3, endLine: 3, structure: { base: 'C', modifiers: [] }, kind: 'special', scope: 'book', bindingKey: 'cyclic-operator-network', semanticType: 'network', meaning: '循环算子网络', evidence: '定义 C 为循环算子网络', confidence: 'high' },
            { expression: 'S', startLine: 3, endLine: 3, structure: { base: 'S', modifiers: [] }, kind: 'special', scope: 'book', bindingKey: 'summary-notation', semanticType: 'set', meaning: '同一个汇总符号', evidence: 'summary notation S', confidence: 'high' }
          ] };
    const turnId = 'symbol-turn-' + threadCount;
    const startedTurn = { id: turnId, status: 'inProgress' };
    if (shouldFail) {
      write({ method: 'turn/completed', params: { threadId: message.params.threadId, turn: {
        id: turnId, status: 'failed', error: { message: 'Synthetic symbol-audit model failure.', additionalDetails: 'Fixture detail.' }, items: []
      } } });
      return write({ id: message.id, result: { turn: startedTurn } });
    }
    const resultText = typeof result === 'string' ? result : JSON.stringify(result);
    if (prompt.includes('03-outside.md')) {
      write({ method: 'item/completed', params: { threadId: message.params.threadId, turnId, completedAtMs: Date.now(), item: {
        type: 'agentMessage', id: 'message', text: resultText, phase: 'final_answer', memoryCitation: null
      } } });
      write({ method: 'rawResponse/completed', params: { threadId: message.params.threadId, turnId, responseId: 'response-' + threadCount, usage: {
        totalTokens: 100, inputTokens: 50, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 30
      } } });
    } else {
      write({ method: 'item/agentMessage/delta', params: { threadId: message.params.threadId, turnId, itemId: 'message', delta: resultText } });
      write({ method: 'thread/tokenUsage/updated', params: { threadId: message.params.threadId, turnId, tokenUsage: {
        total: { totalTokens: 100, inputTokens: 50, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 30 },
        last: { totalTokens: 100, inputTokens: 50, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 30 },
        modelContextWindow: 128000
      } } });
    }
    write({ id: message.id, result: { turn: startedTurn } });
    return write({ method: 'turn/completed', params: { threadId: message.params.threadId, turn: {
      id: turnId, status: 'completed', error: null, items: [{ type: 'agentMessage', id: 'message', text: resultText, phase: 'final_answer', memoryCitation: null }]
    } } });
  }
  if (message.method === 'turn/interrupt') return write({ id: message.id, result: {} });
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index = buffer.indexOf('\\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) receive(JSON.parse(line));
    index = buffer.indexOf('\\n');
  }
});
`);
    await fs.chmod(fakeCodex, 0o755);
    const env = {
        MATH_WORKSPACE_STATE: path.join(root, 'reader-projects.json'),
        MATH_WORKSPACE_SYMBOL_AUDIT_STATE: path.join(root, 'reader-symbol-audit.json'),
        MATH_WORKSPACE_CODEX_COMMAND: fakeCodex
    };
    const reader = await startReader(root, { env });
    try {
        const state = await (await fetch(reader.url + '/api/state')).json();
        const headers = { 'content-type': 'application/json', 'x-math-workspace-token': state.requestToken };
        assert.equal((await fetch(reader.url + '/api/symbol-audit')).status, 403);
        const before = await (await fetch(reader.url + '/api/symbol-audit', { headers })).json();
        assert.equal(before.job, undefined);
        assert.equal(before.cache.missingFiles, 3);
        assert.deepEqual(before.scope.groups.map(group => group.id), ['book1', 'book2']);
        await assert.rejects(fs.readFile(counterPath, 'utf8'));

        const models = await (await fetch(reader.url + '/api/symbol-audit/models', { headers })).json();
        assert.equal(models.models[0].model, 'gpt-symbol');
        const configured = await fetch(reader.url + '/api/symbol-audit', {
            method: 'POST', headers,
            body: JSON.stringify({ action: 'settings', settings: { model: 'gpt-symbol', effort: 'high' } })
        });
        assert.equal(configured.status, 200);
        const started = await fetch(reader.url + '/api/symbol-audit', {
            method: 'POST', headers,
            body: JSON.stringify({ action: 'run' })
        });
        assert.equal(started.status, 202);
        const completed = await waitFor(async () => {
            const status = await (await fetch(reader.url + '/api/symbol-audit', { headers })).json();
            return status.job?.status === 'complete' ? status : undefined;
        });
        assert.equal(completed.reportState, 'current');
        assert.equal(completed.report.hardConflicts.length, 1);
        assert.equal(completed.report.hardConflicts[0].expression, 'C');
        assert.equal(completed.report.reconciliations.length, 2);
        assert.equal(completed.report.reconciliations.find(item => item.expression === 'S').relation, 'same-binding');
        assert.equal(completed.report.hardConflicts.some(item => item.expression === 'S'), false);
        assert.equal(completed.job.modelCalls, 4);
        assert.equal(completed.job.tokenUsageReportedCalls, 4);
        assert.equal(completed.job.tokenUsage.totalTokens, 400);
        assert.equal(completed.job.tokenUsage.inputTokens, 200);
        assert.equal(completed.job.tokenUsage.outputTokens, 80);
        assert.equal(completed.job.tokenUsage.reasoningOutputTokens, 120);
        assert.equal((await fs.readFile(counterPath, 'utf8')).trim().split('\n').length, 4);

        const cachedRun = await fetch(reader.url + '/api/symbol-audit', {
            method: 'POST', headers,
            body: JSON.stringify({ action: 'run' })
        });
        assert.equal(cachedRun.status, 202);
        const cachedComplete = await waitFor(async () => {
            const status = await (await fetch(reader.url + '/api/symbol-audit', { headers })).json();
            return status.job?.status === 'complete' && status.job.reusedFiles === 3 ? status : undefined;
        });
        assert.equal(cachedComplete.job.modelCalls, 0);
        assert.equal(cachedComplete.job.tokenUsage, undefined);
        assert.equal((await fs.readFile(counterPath, 'utf8')).trim().split('\n').length, 4);

        await fs.appendFile(path.join(root, 'book1', '01-local.md'), '\nThis file changed.\n');
        await waitFor(async () => {
            const status = await (await fetch(reader.url + '/api/symbol-audit', { headers })).json();
            return status.cache.missingFiles === 1 ? status : undefined;
        });
        await fetch(reader.url + '/api/symbol-audit', { method: 'POST', headers, body: JSON.stringify({ action: 'run' }) });
        await waitFor(async () => {
            const status = await (await fetch(reader.url + '/api/symbol-audit', { headers })).json();
            return status.job?.status === 'complete' && status.job.scannedFiles === 1 ? status : undefined;
        });
        assert.equal((await fs.readFile(counterPath, 'utf8')).trim().split('\n').length, 6);

        const chapterScope = await fetch(reader.url + '/api/symbol-audit', {
            method: 'POST', headers,
            body: JSON.stringify({ action: 'settings', settings: {
                model: 'gpt-symbol', effort: 'high', scope: { kind: 'chapters', filePaths: ['book1/01-local.md'] }
            } })
        });
        assert.equal(chapterScope.status, 200);
        const chapterStatus = (await chapterScope.json()).status;
        assert.equal(chapterStatus.cache.totalFiles, 1);
        assert.equal(chapterStatus.cache.reusableFiles, 1);
        assert.equal(chapterStatus.scope.externalSpecialBindingCount, 1);
        await fetch(reader.url + '/api/symbol-audit', { method: 'POST', headers, body: JSON.stringify({ action: 'run' }) });
        const chapterComplete = await waitFor(async () => {
            const status = await (await fetch(reader.url + '/api/symbol-audit', { headers })).json();
            return status.job?.status === 'complete' && status.job.reusedFiles === 1 ? status : undefined;
        });
        assert.equal(chapterComplete.report.hardConflicts.length, 1);
        assert.equal(chapterComplete.report.externalSpecialBindingCount, 1);
        assert.equal(chapterComplete.job.modelCalls, 1);
        assert.equal((await fs.readFile(counterPath, 'utf8')).trim().split('\n').length, 7);

        const volumeScope = await fetch(reader.url + '/api/symbol-audit', {
            method: 'POST', headers,
            body: JSON.stringify({ action: 'settings', settings: {
                model: 'gpt-symbol', effort: 'high', scope: { kind: 'volume', groupId: 'book1' }
            } })
        });
        assert.equal(volumeScope.status, 200);
        const volumeStatus = (await volumeScope.json()).status;
        assert.equal(volumeStatus.cache.totalFiles, 2);
        assert.equal(volumeStatus.cache.reusableFiles, 2);

        await fs.appendFile(path.join(root, 'book1', '01-local.md'), '\nTRIGGER_SYMBOL_AUDIT_FAILURE\n');
        await fetch(reader.url + '/api/symbol-audit', {
            method: 'POST', headers,
            body: JSON.stringify({ action: 'settings', settings: {
                model: 'gpt-symbol', effort: 'high', scope: { kind: 'chapters', filePaths: ['book1/01-local.md'] }
            } })
        });
        await waitFor(async () => {
            const status = await (await fetch(reader.url + '/api/symbol-audit', { headers })).json();
            return status.cache.missingFiles === 1 ? status : undefined;
        });
        const failedRun = await fetch(reader.url + '/api/symbol-audit', { method: 'POST', headers, body: JSON.stringify({ action: 'run' }) });
        assert.equal(failedRun.status, 202);
        const failed = await waitFor(async () => {
            const status = await (await fetch(reader.url + '/api/symbol-audit', { headers })).json();
            return status.job?.status === 'failed' ? status : undefined;
        });
        assert.equal(failed.job.error, 'Synthetic symbol-audit model failure. Fixture detail.');
        assert.equal(failed.job.error.includes('required JSON'), false);
    } finally {
        await stopReader(reader.child);
    }
}

async function testReaderLauncher() {
    const root = await makeWorkspace('reader-launcher');
    await fs.writeFile(path.join(root, 'book1', '01-foundations.md'), [
        '# Foundations',
        '',
        'A Reader launcher fixture.',
        ''
    ].join('\n'));
    const prepare = runCli(root, ['prepare']);
    assert.equal(prepare.status, 0, combinedOutput(prepare));

    const recentStatePath = path.join(root, 'reader-projects.json');
    const env = { MATH_WORKSPACE_STATE: recentStatePath };
    const boundReader = await startReader(root, { env });
    await stopReader(boundReader.child);

    const launcher = await startReader(root, { projectPath: null, env });
    try {
        const initial = await (await fetch(launcher.url + '/api/state')).json();
        assert.equal(initial.available, false);
        assert.equal(initial.recentProjects.length, 1);
        assert.equal(initial.recentProjects[0].rootName, path.basename(root));
        assert.equal('rootPath' in initial.recentProjects[0], false);

        const selected = await (await fetch(launcher.url + '/api/projects/recent', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ index: 0 })
        })).json();
        assert.equal(selected.available, true);
        assert.equal(selected.pages.length, 1);
        assert.equal(selected.rootName, path.basename(root));

        const page = await (await fetch(launcher.url + '/api/page?path=book1%2F01-foundations.md')).json();
        assert.match(page.content, /launcher fixture/);
    } finally {
        await stopReader(launcher.child);
    }
}

async function testPageHeadingFormatting() {
    const { formatPageHeading, formatPageHeadingPrefix } = formalCore();
    const chapter = {
        kind: 'chapter',
        filePath: 'book1/01-foundations.md',
        title: '基础',
        order: 1,
        unitLabel: '1',
        chapter: 1
    };
    const appendix = {
        kind: 'appendix',
        filePath: 'book1/appendix-a-symbols.md',
        title: '附录 A 符号表',
        order: 100001,
        unitLabel: 'A',
        appendix: 'A'
    };

    assert.equal(formatPageHeading(chapter, { language: 'zh' }), '第 1 章 基础');
    assert.equal(formatPageHeadingPrefix(chapter, { language: 'zh' }), '第 1 章');
    assert.equal(formatPageHeading({ ...chapter, title: '第 1 章 基础' }, { language: 'zh' }), '第 1 章 基础');
    assert.equal(formatPageHeading(chapter, { language: 'zh', render: { pageHeadingStyle: 'number-title' } }), '1 基础');
    assert.equal(formatPageHeading(chapter, { language: 'zh', render: { pageHeadingStyle: 'title' } }), '基础');
    assert.equal(formatPageHeading(appendix, { language: 'zh' }), '附录 A 符号表');
}

async function testExportMarkdownCompilesFormalSyntax() {
    const root = await makeWorkspace('export-md');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# #h-aaaaaaaaaaaaaaaa Chapter One',
        '',
        '本章见 @h-aaaaaaaaaaaaaaaa.full。',
        '',
        '## #h-bbbbbbbbbbbbbbbb Section One',
        '',
        '命题 #h-cccccccccccccccc（Main）：Statement uses @h-bbbbbbbbbbbbbbbb.title.',
        '',
        '公式 #h-dddddddddddddddd：',
        '$$',
        'a=b',
        '$$',
        '',
        'See @h-cccccccccccccccc and @h-cccccccccccccccc.full.',
        '',
        'This **bold phrase** must stay bold.',
        '',
        '![pic](figures/main.png)',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', 'summary.md'), [
        '# Summary',
        '',
        'Summary page.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', 'appendix-a-notes.md'), [
        '# #h-eeeeeeeeeeeeeeee Appendix Notes',
        '',
        'Appendix page.',
        ''
    ].join('\n'));

    const exported = runCli(root, ['export-md', 'book1', '--out', 'compiled.md']);
    assert.equal(exported.status, 0, combinedOutput(exported));
    const compiled = await read(root, 'compiled.md');
    assert.doesNotMatch(compiled, /#h-|@h-/);
    assert.match(compiled, /^# 第 1 章 Chapter One/m);
    assert.match(compiled, /本章见 第 1 章：Chapter One。/);
    assert.match(compiled, /^## 1\.1 Section One/m);
    assert.match(compiled, /命题 1\.1（Main）：Statement uses Section One\./);
    assert.match(compiled, /公式 \(1\.1\)：/);
    assert.match(compiled, /See 命题 1\.1 and 命题 1\.1（Main）\./);
    assert.match(compiled, /This \*\*bold phrase\*\* must stay bold\./);
    assert.match(compiled, /!\[pic\]\(book1\/figures\/main\.png\)/);
    assert.ok(compiled.indexOf('# Summary') > compiled.indexOf('# 第 1 章 Chapter One'));
    assert.ok(compiled.indexOf('# 附录 A Appendix Notes') > compiled.indexOf('# Summary'));
}

async function testExportMarkdownSplitCompilesFiles() {
    const root = await makeWorkspace('export-md-split');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# #h-aaaaaaaaaaaaaaaa Chapter One',
        '',
        '本章见 @h-aaaaaaaaaaaaaaaa.full。',
        '',
        '## #h-bbbbbbbbbbbbbbbb Section One',
        '',
        '命题 #h-cccccccccccccccc（Main）：Statement uses @h-bbbbbbbbbbbbbbbb.title.',
        '',
        'See @h-cccccccccccccccc and @h-cccccccccccccccc.full.',
        '',
        'Read [next](02-b.md).',
        '',
        '![pic](figures/main.png)',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '02-b.md'), [
        '# #h-dddddddddddddddd Chapter Two',
        '',
        'Back to @h-aaaaaaaaaaaaaaaa.title.',
        ''
    ].join('\n'));

    const exported = runCli(root, ['export-md-split', 'book1', '--out', 'dist/public']);
    assert.equal(exported.status, 0, combinedOutput(exported));
    assert.match(combinedOutput(exported), /OK export-md-split: 2 files -> dist\/public/);

    const chapter1 = await read(root, 'dist/public/book1/01-a.md');
    const chapter2 = await read(root, 'dist/public/book1/02-b.md');
    assert.doesNotMatch(chapter1, /#h-|@h-/);
    assert.doesNotMatch(chapter2, /#h-|@h-/);
    assert.match(chapter1, /^# 第 1 章 Chapter One/m);
    assert.match(chapter1, /本章见 第 1 章：Chapter One。/);
    assert.match(chapter1, /^## 1\.1 Section One/m);
    assert.match(chapter1, /命题 1\.1（Main）：Statement uses Section One\./);
    assert.match(chapter1, /See 命题 1\.1 and 命题 1\.1（Main）\./);
    assert.match(chapter1, /Read \[next\]\(02-b\.md\)\./);
    assert.match(chapter1, /!\[pic\]\(figures\/main\.png\)/);
    assert.doesNotMatch(chapter1, /\\pagebreak/);
    assert.match(chapter2, /^# 第 2 章 Chapter Two/m);
    assert.match(chapter2, /Back to Chapter One\./);
}

async function makeFakePandoc(root) {
    const bin = path.join(root, 'bin');
    const logPath = path.join(root, 'pandoc-args.json');
    const scriptPath = path.join(bin, 'pandoc');
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(scriptPath, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const args = process.argv.slice(2);',
        "if (args.includes('-t') && args[args.indexOf('-t') + 1] === 'latex') {",
        "  const input = fs.readFileSync(0, 'utf8');",
        "  const output = input",
        "    .replace(/^#\\s+(.+?)\\s*\\{[^}]*\\}\\s*$/gm, '\\\\section*{$1}')",
        "    .replace(/\\$([^$]+)\\$/g, '\\\\($1\\\\)');",
        "  process.stdout.write(output);",
        "  process.exit(0);",
        "}",
        "fs.writeFileSync(process.env.PANDOC_LOG, JSON.stringify(args));",
        "if (process.env.PANDOC_INPUT_LOG && args[0]) {",
        "  fs.writeFileSync(process.env.PANDOC_INPUT_LOG, fs.readFileSync(path.resolve(process.cwd(), args[0]), 'utf8'));",
        "}",
        "const includeBeforeIndex = args.indexOf('--include-before-body');",
        "if (process.env.PANDOC_INCLUDE_BEFORE_LOG && includeBeforeIndex >= 0 && args[includeBeforeIndex + 1]) {",
        "  fs.writeFileSync(process.env.PANDOC_INCLUDE_BEFORE_LOG, fs.readFileSync(path.resolve(process.cwd(), args[includeBeforeIndex + 1]), 'utf8'));",
        "}",
        "const outIndex = args.indexOf('-o');",
        'if (outIndex >= 0 && args[outIndex + 1]) {',
        '  const output = path.resolve(process.cwd(), args[outIndex + 1]);',
        '  fs.mkdirSync(path.dirname(output), { recursive: true });',
        "  fs.writeFileSync(output, 'PDF');",
        '}',
        ''
    ].join('\n'));
    await fs.chmod(scriptPath, 0o755);
    return { bin, logPath };
}

async function testRenderPdfUsesPandocRenderer() {
    const root = await makeWorkspace('render-pdf');
    await fs.writeFile(path.join(root, 'compiled.md'), '# Compiled Book\n\nThis is already ordinary Markdown.\n');

    const usage = runCli(root, ['render-pdf']);
    assert.notEqual(usage.status, 0, combinedOutput(usage));
    assert.match(combinedOutput(usage), /render-pdf <compiled\.md>/);
    assert.match(combinedOutput(usage), /--variable key:value/);
    await assert.rejects(() => fs.stat(path.join(root, '.math-workspace', 'config.json')));

    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'config.json'), JSON.stringify({
        language: 'zh',
        pdf: {
            title: '算子演化论',
            subtitle: '卷 I：规范空间与算子',
            author: 'GLENZLI',
            date: 'Revised 2026-06-26',
            releaseVersion: 'rc.1',
            showVersionOnCover: true,
            documentClass: 'ctexbook',
            titlePage: true
        }
    }, null, 2));

    const { bin, logPath } = await makeFakePandoc(root);
    const rendered = runCliWithEnv(root, [
        'render-pdf',
        'compiled.md',
        '--out',
        'dist/book.pdf',
        '--paper',
        'letter',
        '--margin',
        '1in',
        '--toc-depth',
        '3',
        '--variable',
        'mainfont:STSong',
        '-V',
        'header-includes:test'
    ], {
        PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
        PANDOC_LOG: logPath
    });

    assert.equal(rendered.status, 0, combinedOutput(rendered));
    assert.match(combinedOutput(rendered), /OK render-pdf: compiled\.md -> dist\/book\.pdf/);
    assert.match(combinedOutput(rendered), /paper=letter, margin=1in, lang=zh-CN, toc=on, toc-depth=3, toc-title=目录, title-page=on, cover-style=simple, release-version=rc\.1, show-version-on-cover=on, metadata-page=off, toc-page-break=on, pdf-engine=xelatex/);
    const coverHeader = '\\renewcommand{\\maketitle}{\\begin{titlepage}\\thispagestyle{empty}\\vspace*{0.20\\textheight}\\begin{center}{\\fontsize{32pt}{40pt}\\selectfont \\bfseries 算子演化论\\par}\\vspace{1.2em}{\\fontsize{18pt}{23pt}\\selectfont 卷 I：规范空间与算子\\par}\\vfill{\\fontsize{12pt}{15pt}\\selectfont GLENZLI\\par}\\vspace{0.8em}{\\fontsize{12pt}{15pt}\\selectfont Revised 2026-06-26\\par}\\vspace{0.8em}{\\fontsize{12pt}{15pt}\\selectfont rc.1\\par}\\end{center}\\end{titlepage}}';
    assert.doesNotMatch(coverHeader, /%/);
    assert.deepEqual(JSON.parse(await fs.readFile(logPath, 'utf8')), [
        'compiled.md',
        '-o',
        'dist/book.pdf',
        '--pdf-engine',
        'xelatex',
        '-V',
        'papersize:letter',
        '-V',
        'geometry:margin=1in',
        '-V',
        'lang:zh-CN',
        '-V',
        'toc-title:目录',
        '-V',
        'documentclass:ctexbook',
        '-V',
        'title:算子演化论',
        '-V',
        'subtitle:卷 I：规范空间与算子',
        '-V',
        'author:GLENZLI',
        '-V',
        'date:Revised 2026-06-26',
        '-V',
        'version:rc.1',
        '-V',
        'classoption:titlepage',
        '-V',
        `header-includes:${coverHeader}`,
        '-V',
        `header-includes:${'\\let\\markdownFormalOldTableOfContents\\tableofcontents\\renewcommand{\\tableofcontents}{\\clearpage\\markdownFormalOldTableOfContents\\clearpage}'}`,
        '-V',
        'mainfont:STSong',
        '-V',
        'header-includes:test',
        '--toc',
        '--toc-depth',
        '3'
    ]);
    assert.equal(await read(root, 'dist/book.pdf'), 'PDF');
    await assert.rejects(() => fs.stat(path.join(root, '.math-workspace', 'workspace-index.json')));
    assert.ok(await read(root, '.math-workspace/config.json'));
}

async function testRenderPdfMetadataPage() {
    const root = await makeWorkspace('render-pdf-metadata');
    const originalMarkdown = '# Body\n\nCompiled body.\n';
    await fs.writeFile(path.join(root, 'compiled.md'), originalMarkdown);
    await fs.writeFile(path.join(root, 'license-note.md'), 'License note with $L$.\n');
    await fs.writeFile(path.join(root, 'ai-en.md'), 'AI assistance statement with $A$.\n');
    await fs.mkdir(path.join(root, '.math-workspace'), { recursive: true });
    await fs.writeFile(path.join(root, '.math-workspace', 'config.json'), JSON.stringify({
        language: 'zh',
        pdf: {
            author: 'Zhe Li',
            authorNative: '李喆',
            authorAliases: ['Glen Li / glenzli'],
            orcid: 'https://orcid.org/0009-0006-6536-3453',
            repository: 'https://github.com/glenzli/formal-math',
            license: 'CC BY 4.0',
            licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
            preferredCitation: 'Zhe Li ... licensed under CC BY 4.0.',
            releaseVersion: 'rc.1',
            frontMatter: [
                {
                    title: 'AI 辅助声明',
                    content: '本书使用 $A$ 作为辅助工具。',
                    toc: false,
                    pageBreakAfter: true
                },
                {
                    title: 'License Note',
                    source: 'license-note.md',
                    toc: true,
                    pageBreakAfter: true
                }
            ]
        }
    }, null, 2));

    const { bin, logPath } = await makeFakePandoc(root);
    const inputLogPath = path.join(root, 'pandoc-input.md');
    const includeBeforeLogPath = path.join(root, 'pandoc-before.tex');
    const rendered = runCliWithEnv(root, [
        'render-pdf',
        'compiled.md',
        '--out',
        'dist/book.pdf',
        '--metadata-page',
        '--author-alias',
        'G. Li',
        '--release-tag',
        'v0.1.0',
        '--release-commit',
        'abc123',
        '--doi',
        '10.1234/formal',
        '--front-matter',
        'ai-en.md',
        '--front-matter-title',
        'AI Assistance Statement'
    ], {
        PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
        PANDOC_LOG: logPath,
        PANDOC_INPUT_LOG: inputLogPath,
        PANDOC_INCLUDE_BEFORE_LOG: includeBeforeLogPath
    });

    assert.equal(rendered.status, 0, combinedOutput(rendered));
    assert.match(combinedOutput(rendered), /metadata-page=on/);
    const pandocArgs = JSON.parse(await fs.readFile(logPath, 'utf8'));
    assert.equal(pandocArgs[0], 'compiled.md');
    const includeBeforeIndex = pandocArgs.indexOf('--include-before-body');
    assert.ok(includeBeforeIndex > 0);
    assert.match(pandocArgs[includeBeforeIndex + 1], /\.publication\.tex$/);
    assert.ok(pandocArgs.includes('author:Zhe Li'));
    assert.equal(pandocArgs.some(item => String(item).includes('李喆') || String(item).includes('glenzli')), false);

    const pandocInput = await fs.readFile(inputLogPath, 'utf8');
    assert.equal(pandocInput, originalMarkdown);
    const metadataInput = await fs.readFile(includeBeforeLogPath, 'utf8');
    assert.match(metadataInput, /\\clearpage\n\\section\*\{Publication Metadata\}/);
    assert.match(metadataInput, /\\item\[Author\] Zhe Li/);
    assert.match(metadataInput, /\\item\[Native name\] 李喆/);
    assert.match(metadataInput, /\\item\[Also known as\] Glen Li \/ glenzli; G\. Li/);
    assert.match(metadataInput, /\\item\[ORCID\] https:\/\/orcid\.org\/0009-0006-6536-3453/);
    assert.match(metadataInput, /\\item\[Repository\] https:\/\/github\.com\/glenzli\/formal-math/);
    assert.match(metadataInput, /\\item\[License\] CC BY 4\.0 \(https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/\)/);
    assert.match(metadataInput, /\\item\[Release version\] rc\.1/);
    assert.match(metadataInput, /\\item\[Release tag\] v0\.1\.0/);
    assert.match(metadataInput, /\\item\[Commit\] abc123/);
    assert.match(metadataInput, /\\item\[DOI\] 10\.1234\/formal/);
    assert.match(metadataInput, /\\item\[Preferred citation\] Zhe Li \.\.\. licensed under CC BY 4\.0\./);
    assert.match(metadataInput, /\\end\{description\}\n\\clearpage/);
    assert.ok(metadataInput.indexOf('\\section*{Publication Metadata}') < metadataInput.indexOf('\\section*{AI 辅助声明}'));
    assert.ok(metadataInput.indexOf('\\section*{AI 辅助声明}') < metadataInput.indexOf('\\section*{License Note}'));
    assert.ok(metadataInput.indexOf('\\section*{License Note}') < metadataInput.indexOf('\\section*{AI Assistance Statement}'));
    assert.match(metadataInput, /\\section\*\{AI 辅助声明\}/);
    assert.match(metadataInput, /本书使用 \\\(A\\\) 作为辅助工具。/);
    assert.doesNotMatch(metadataInput, /\\addcontentsline\{toc\}\{section\}\{AI 辅助声明\}/);
    assert.match(metadataInput, /\\section\*\{License Note\}/);
    assert.match(metadataInput, /\\addcontentsline\{toc\}\{section\}\{License Note\}/);
    assert.match(metadataInput, /License note with \\\(L\\\)\./);
    assert.match(metadataInput, /\\section\*\{AI Assistance Statement\}/);
    assert.match(metadataInput, /AI assistance statement with \\\(A\\\)\./);
    assert.equal(await read(root, 'compiled.md'), originalMarkdown);
    await assert.rejects(() => fs.stat(path.join(root, pandocArgs[includeBeforeIndex + 1])));
}

async function testAuditReport() {
    const root = await makeWorkspace('audit');
    await fs.writeFile(path.join(root, 'book1', '01-a.md'), [
        '# Chapter 1',
        '',
        '定理 #h-1111111111111111（Base）：Statement without a proof boundary.',
        '',
        '由 定理 1.1 和 (1.1) 可得结论。',
        '进一步见第 2 章。',
        '链接 [定理 1.1](old.md#thm) 需要人工处理。',
        '',
        '## Plain Heading',
        '',
        '例 #h-2222222222222222（Unused）：This example is indexed but never cited.',
        ''
    ].join('\n'));
    await fs.writeFile(path.join(root, 'book1', '02-b.md'), [
        '# Chapter 2',
        '',
        'Second chapter.',
        ''
    ].join('\n'));

    const audit = runCli(root, ['audit']);
    assert.equal(audit.status, 0, combinedOutput(audit));
    assert.match(combinedOutput(audit), /WARN audit:/);

    const report = await read(root, '.math-workspace/audit.md');
    assert.match(report, /Typed old references: 1/);
    assert.match(report, /Markdown links needing manual rewrite: 1/);
    assert.match(report, /Chapter references needing page refs: 1/);
    assert.match(report, /Section headings needing numbered markers: 1/);
    assert.match(report, /Bare number candidates: 1/);
    assert.match(report, /Unused optional example hashes: 1/);
    assert.match(report, /Theorem-like blocks without proof boundary: 1/);
    assert.match(report, /定理 1\.1 -> @h-1111111111111111/);
    assert.match(report, /bare-number-candidate|Bare Number Candidates/);
    assert.match(report, /例 1\.1 `h-2222222222222222`/);
    assert.match(report, /第 2 章; suggested @chapter:book1\/02-b\.md/);
}

const tests = [
    ['finalize cross-file safety', testFinalizeCrossFileSafety],
    ['finish finalizes and verifies', testFinishFinalizesAndVerifies],
    ['migrate-ids scoped safety', testMigrateIdsScopedSafety],
    ['migrate-text-refs report', testMigrateTextRefsReport],
    ['custom dictionary text refs', testCustomDictionaryTextRefs],
    ['structured definition marker content', testStructuredDefinitionMarkerContent],
    ['project knowledge analysis', testProjectKnowledgeAnalysis],
    ['symbol cache', testSymbolCache],
    ['local Reader symbol audit', testReaderSymbolAudit],
    ['warns unbalanced symbol pattern', testWarnsUnbalancedSymbolPattern],
    ['recall boundaries and optional blocks', testRecallBoundariesAndOptionalBlocks],
    ['strong marker with softbreak', testStrongMarkerWithSoftbreak],
    ['dependency graph', testDependencyGraph],
    ['proof terminators exclude explanatory references', testProofTerminatorsExcludeFollowingExplanatoryReferences],
    ['equation figure table numbering', testEquationFigureTableNumbering],
    ['structured marker validation', testStructuredMarkerValidation],
    ['cross-book references require dependencies', testCrossBookReferencesRequireDependencies],
    ['chapter page references', testChapterPageReferences],
    ['page anchor finalize', testPageAnchorFinalize],
    ['migrate-text-refs sections and audits', testMigrateTextRefsSectionsAndAudits],
    ['migrate-text-refs updates incoming refs by default', testMigrateTextRefsUpdatesIncomingByDefault],
    ['verify rejects non-hash ids', testVerifyRejectsNonHashIds],
    ['verify rejects missing definition content', testVerifyRejectsMissingDefinitionContent],
    ['scan exclude and zero introduction pages', testScanExcludeAndZeroIntroductionPages],
    ['page title uses unique highest heading', testPageTitleUsesUniqueHighestHeading],
    ['page integration status', testPageIntegrationStatus],
    ['perf-dummy thresholds', testPerfDummyThresholds],
    ['Lean anchor index', testLeanAnchorIndex],
    ['Lean build and dependency comparison', testLeanBuildAndDependencyComparison],
    ['local Reader server', testReaderServer],
    ['local Reader MCP server', testReaderMcpServer],
    ['Reader plugin MCP configuration', testReaderPluginMcpConfig],
    ['simplified CLI flow', testSimplifiedCliFlow],
    ['local Reader discussion marks', testReaderDiscussionMarks],
    ['local Reader launcher', testReaderLauncher],
    ['page heading formatting', testPageHeadingFormatting],
    ['export-md compiles formal syntax', testExportMarkdownCompilesFormalSyntax],
    ['export-md-split compiles files', testExportMarkdownSplitCompilesFiles],
    ['render-pdf uses pandoc renderer', testRenderPdfUsesPandocRenderer],
    ['render-pdf metadata page', testRenderPdfMetadataPage],
    ['audit report', testAuditReport]
];

for (const [name, test] of tests) {
    await test();
    console.log(`ok - ${name}`);
}
