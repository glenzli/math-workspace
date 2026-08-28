#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import {
    DEFAULT_CONFIG,
    HASH_ID_RE,
    TMP_ID_RE,
    buildReaderIndex,
    displayLabel,
    displayNumber,
    escapeRegExp,
    formatPageHeading,
    formatPageReference,
    mergeConfig,
    normalizeFormalPagePath,
    parseFormalMarkerLine,
    renderAgentGuide,
    renderDependencyGraphBridges,
    renderDependencyGraphCycles,
    renderDependencyGraphFocus,
    renderDependencyGraphImpact,
    renderDependencyGraphIsolated,
    renderDependencyGraphMatrix,
    renderDependencyGraphSummary,
    renderDependencyGraphUpstream,
    renderDependencyReport,
    renderProjectAnalysis,
    renderReferenceMap,
    renderReport,
    scanFormalDocuments,
    shouldExcludeScanPath,
    toPosix,
    typeName,
    unique,
    type DependencyGraphMatrixScope,
    type DependencyGraphWhereFilter
} from '@math-workspace/core';
import { startReaderServer } from '../reader/server';
import { runReaderMcpServer } from '../mcp/reader-mcp-server';
import { findMathWorkspaceRoot } from '../project-root';
import { renderLeanReport, scanLeanWorkspace } from '../lean/lean-index';
import { buildLeanWorkspace, captureLeanContracts, writeLeanContracts } from '../lean/lean-state';
import { collectLeanDependencies } from '../lean/lean-dependencies';

let ROOT = process.cwd();
let CACHE_DIR = path.join(ROOT, '.math-workspace');
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const { spawnSync } = require('node:child_process');
const nodeFs = require('node:fs');

function setWorkspaceRoot(rootPath: string): void {
    ROOT = path.resolve(rootPath);
    CACHE_DIR = path.join(ROOT, '.math-workspace');
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (_err) {
        return false;
    }
}

async function ensureCacheDir() {
    await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function readConfig() {
    await ensureCacheDir();
    const configPath = path.join(CACHE_DIR, 'config.json');
    try {
        const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
        const config = mergeConfig(raw);
        if (JSON.stringify(raw) !== JSON.stringify(config)) {
            await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        }
        return config;
    } catch (_err) {
        const config = mergeConfig(DEFAULT_CONFIG);
        await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        return config;
    }
}

async function readConfigIfExists() {
    const configPath = path.join(CACHE_DIR, 'config.json');
    try {
        return mergeConfig(JSON.parse(await fs.readFile(configPath, 'utf8')));
    } catch (err: any) {
        if (err?.code === 'ENOENT') return mergeConfig(DEFAULT_CONFIG);
        throw err;
    }
}

async function collectMarkdownFiles(config, dir = ROOT, acc = []) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relative = relativePath(fullPath);
        if (entry.isDirectory()) {
            if (shouldExcludeScanPath(relative, config)) continue;
            await collectMarkdownFiles(config, fullPath, acc);
            continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
        if (shouldExcludeScanPath(relative, config)) continue;
        acc.push(fullPath);
    }
    return acc.sort((a, b) => relativePath(a).localeCompare(relativePath(b)));
}

function relativePath(filePath) {
    return toPosix(path.relative(ROOT, filePath));
}

function isPathInside(parentPath, candidatePath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readWorkspaceDocuments(files) {
    const documents = [];
    for (const fullPath of files) {
        documents.push({
            filePath: relativePath(fullPath),
            content: await fs.readFile(fullPath, 'utf8')
        });
    }
    return documents;
}

async function readSymbols() {
    try {
        return JSON.parse(await fs.readFile(path.join(CACHE_DIR, 'symbols.json'), 'utf8'));
    } catch (err: any) {
        if (err?.code === 'ENOENT') return undefined;
        throw err;
    }
}

async function readDefinitions() {
    try {
        return JSON.parse(await fs.readFile(path.join(CACHE_DIR, 'definitions.json'), 'utf8'));
    } catch (err: any) {
        if (err?.code === 'ENOENT') return undefined;
        throw err;
    }
}

async function scanWorkspace() {
    const config = await readConfig();
    const files = await collectMarkdownFiles(config);
    const documents = await readWorkspaceDocuments(files);
    const symbols = await readSymbols();
    const definitions = await readDefinitions();
    const state = scanFormalDocuments(documents, config, symbols, definitions);
    const leanIndex = await scanLeanWorkspace(ROOT, config, state.labels, state.dependencyGraph);
    state.issues.push(...leanIndex.diagnostics.map(diagnostic => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        file: diagnostic.file,
        line: diagnostic.line,
        message: diagnostic.message
    })));
    return { ...state, leanIndex };
}

async function writeArtifacts(state) {
    await ensureCacheDir();
    await fs.writeFile(path.join(CACHE_DIR, 'workspace-index.json'), `${JSON.stringify(buildReaderIndex(state), null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(CACHE_DIR, 'dependency-graph.json'), `${JSON.stringify(state.dependencyGraph, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(CACHE_DIR, 'dependency-report.md'), renderDependencyReport(state.dependencyGraph), 'utf8');
    await fs.writeFile(path.join(CACHE_DIR, 'reference-map.md'), renderReferenceMap(state.definitions, state.config, state.pages), 'utf8');
    await fs.writeFile(path.join(CACHE_DIR, 'project-analysis.json'), `${JSON.stringify(state.projectAnalysis || {}, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(CACHE_DIR, 'project-analysis.md'), renderProjectAnalysis(state.projectAnalysis), 'utf8');
    await fs.writeFile(path.join(CACHE_DIR, 'lean-index.json'), `${JSON.stringify(state.leanIndex, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(CACHE_DIR, 'lean-report.md'), renderLeanReport(state.leanIndex), 'utf8');
    await fs.writeFile(path.join(CACHE_DIR, 'agent-guide.md'), renderAgentGuide(state), 'utf8');
    await fs.writeFile(path.join(CACHE_DIR, 'report.md'), renderReport(state), 'utf8');
    await removeStaleArtifact('definition-index.md');
    await removeStaleArtifact('labels.json');
    await removeStaleArtifact('pages.json');
    await removeStaleArtifact('preview-index.json');
    await removeStaleArtifact('inventory.full.json');
    await removeStaleArtifact('preview-cache.json');
}

async function removeStaleArtifact(fileName) {
    try {
        await fs.rm(path.join(CACHE_DIR, fileName));
    } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
    }
}

function printSummary(action, state) {
    const errors = state.issues.filter(issue => issue.severity === 'error');
    const warnings = state.issues.filter(issue => issue.severity !== 'error');
    const status = errors.length > 0 ? 'ERROR' : warnings.length > 0 ? 'WARN' : 'OK';
    console.log(`${status} ${action}: ${Object.keys(state.labels).length} preview entries, ${state.pages.length} pages, ${errors.length} errors, ${warnings.length} warnings`);
    const knowledge = state.projectAnalysis?.summary;
    if (knowledge?.conceptSources || knowledge?.notationSources || knowledge?.summaryPages) {
        console.log(`Project knowledge: ${knowledge.conceptSources} concept/glossary sources, ${knowledge.notationSources} notation sources, ${knowledge.extractedDefinitions} supplemental definitions`);
    }
    const lean = state.leanIndex?.summary;
    if (lean?.projects > 0) {
        console.log(`Lean anchors: ${lean.matchedAnchors} matched formal objects, ${lean.declarations} declarations, ${lean.unknownAnchors} unknown anchors`);
    }
    if (errors.length > 0 || warnings.length > 0) {
        console.log('Report: .math-workspace/report.md');
        [...errors, ...warnings].slice(0, 5).forEach(issue => {
            const location = issue.line ? `${issue.file}:${issue.line}` : issue.file || 'workspace';
            console.log(`${issue.severity.toUpperCase()} ${issue.code} ${location}`);
        });
        if (errors.length + warnings.length > 5) {
            console.log(`... ${errors.length + warnings.length - 5} more issues in report.md`);
        }
    }
}

async function prepare({ exitOnError = true } = {}) {
    const state = await scanWorkspace();
    await writeArtifacts(state);
    printSummary('prepare', state);
    if (exitOnError && state.issues.some(issue => issue.severity === 'error')) process.exitCode = 1;
    return state;
}

function parseProjectDirectoryArg(args: string[], commandName: string): { inputPath?: string; help?: boolean } {
    let inputPath: string | undefined;
    for (const arg of args) {
        if (arg === '--help' || arg === 'help') {
            console.log(`Usage: math-workspace ${commandName} [project-dir]`);
            return { help: true };
        }
        if (arg.startsWith('-') || inputPath) throw new Error(`Unknown ${commandName} option: ${arg}`);
        inputPath = arg;
    }
    return { inputPath };
}

async function requireDirectory(inputPath: string): Promise<string> {
    const rootPath = path.resolve(ROOT, inputPath);
    let stat;
    try {
        stat = await fs.stat(rootPath);
    } catch (_error) {
        throw new Error(`Project directory does not exist: ${rootPath}`);
    }
    if (!stat.isDirectory()) throw new Error(`Project path is not a directory: ${rootPath}`);
    return nodeFs.promises.realpath(rootPath);
}

async function initWorkspace(args: string[]): Promise<void> {
    const options = parseProjectDirectoryArg(args, 'init');
    if (options.help) return;
    if (options.inputPath) setWorkspaceRoot(await requireDirectory(options.inputPath));
    await prepare({ exitOnError: false });
    console.log(`Initialized Math Workspace: ${ROOT}`);
    console.log('Next: math-workspace open');
}

function commandAvailable(command: string): boolean {
    const result = spawnSync(command, ['--version'], { cwd: ROOT, encoding: 'utf8' });
    return !result.error && result.status === 0;
}

async function doctor(args: string[]): Promise<void> {
    const options = parseProjectDirectoryArg(args, 'doctor');
    if (options.help) return;
    const startPath = options.inputPath ? await requireDirectory(options.inputPath) : ROOT;
    const projectRoot = await findMathWorkspaceRoot(startPath);
    const packagePath = path.join(PACKAGE_ROOT, 'package.json');
    const manifestPath = path.join(PACKAGE_ROOT, '.codex-plugin', 'plugin.json');
    const isPluginPackage = await pathExists(manifestPath);
    const metadataPath = await pathExists(packagePath) ? packagePath : manifestPath;
    const packageJson = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    const readerReady = await pathExists(path.join(PACKAGE_ROOT, 'out', 'reader', 'index.html'));
    const sourcePluginRoot = path.join(PACKAGE_ROOT, 'plugins', 'math-workspace');
    const hasSourcePlugin = await pathExists(path.join(sourcePluginRoot, '.codex-plugin', 'plugin.json'));
    const pluginRuntimeReady = isPluginPackage
        ? await pathExists(path.join(PACKAGE_ROOT, 'out', 'cli', 'math-workspace.js'))
        : hasSourcePlugin && await pathExists(path.join(sourcePluginRoot, 'out', 'cli', 'math-workspace.js'));
    const pluginRuntimeStatus = isPluginPackage
        ? (pluginRuntimeReady ? 'bundled' : 'missing from plugin package')
        : hasSourcePlugin
            ? (pluginRuntimeReady ? 'staged' : 'not staged; run the project build')
            : 'distributed separately through the Codex marketplace';

    console.log(`Math Workspace doctor ${packageJson.version}`);
    console.log(`CLI: ${path.join(__dirname, 'math-workspace.js')}`);
    console.log(`Node: ${process.version}`);
    console.log(`Project root: ${projectRoot || 'not found'}`);
    console.log(`Configuration: ${projectRoot ? 'found' : 'run `math-workspace init`'}`);
    console.log(`Reader bundle: ${readerReady ? 'ready' : 'missing; run the project build'}`);
    console.log(`Plugin runtime: ${pluginRuntimeStatus}`);
    console.log(`Pandoc: ${commandAvailable('pandoc') ? 'available' : 'not found (optional)'}`);
    console.log(`Lean: ${commandAvailable('lake') ? 'available' : 'not found (optional)'}`);
}

async function lint() {
    const state = await scanWorkspace();
    await writeArtifacts(state);
    printSummary('lint', state);
    if (state.issues.some(issue => issue.severity === 'error')) process.exitCode = 1;
}

function printLeanUsage(): void {
    console.log(`Usage:
  npm run workspace -- lean scan
  npm run workspace -- lean coverage
  npm run workspace -- lean verify
  npm run workspace -- lean capture
  npm run workspace -- lean build [--project <key>]
  npm run workspace -- lean dependencies

The Lean index records stable docstring anchors. ` + '`capture`' + ` records the reviewed Markdown/declaration contract; ` + '`build`' + ` records the configured Lake build result. Neither result by itself claims complete formalization or proof coverage.`);
}

async function lean(args: string[] = []): Promise<void> {
    const action = args[0] || 'scan';
    if (action === 'help' || action === '--help') {
        printLeanUsage();
        return;
    }
    const rest = args.slice(1);
    const projectOption = rest.indexOf('--project');
    const projectKey = projectOption >= 0 ? rest[projectOption + 1] : undefined;
    const validProjectOption = action === 'build'
        && (rest.length === 0 || (projectOption === 0 && rest.length === 2 && !!projectKey));
    if (!['scan', 'coverage', 'verify', 'capture', 'build', 'dependencies'].includes(action)
        || (action !== 'build' && rest.length > 0)
        || (action === 'build' && !validProjectOption)) {
        printLeanUsage();
        process.exitCode = 1;
        return;
    }

    let state = await scanWorkspace();
    if (action === 'capture') {
        await writeLeanContracts(ROOT, captureLeanContracts(state.leanIndex, state.labels));
        state = await scanWorkspace();
    }
    if (action === 'build') {
        const build = await buildLeanWorkspace(ROOT, state.leanIndex, projectKey);
        state = await scanWorkspace();
        const failed = Object.entries(build.projects)
            .filter(([, result]) => !result.passed)
            .map(([key]) => key);
        if (failed.length > 0) process.exitCode = 1;
    }
    if (action === 'dependencies') {
        const artifact = await collectLeanDependencies(ROOT, state.leanIndex, state.dependencyGraph);
        state = await scanWorkspace();
        if (artifact.diagnostics.length > 0) process.exitCode = 1;
    }
    await writeArtifacts(state);
    const summary = state.leanIndex.summary;
    const errors = state.leanIndex.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    const status = errors.length > 0 ? 'ERROR' : 'OK';
    console.log(`${status} lean ${action}: ${summary.anchors} anchors, ${summary.declarations} declarations, ${summary.matchedAnchors} matched, ${summary.unknownAnchors} unknown`);
    const review = state.leanIndex.statusSummary;
    if (review) {
        console.log(`Lean review: ${review.contracts.current} current, ${review.contracts.untracked} untracked, ${review.contracts['markdown-drifted'] + review.contracts['declaration-drifted'] + review.contracts.drifted} drifted; ${review.builds.passed} build-passed, ${review.builds.stale} build-stale, ${review.builds.unverified} build-unverified`);
    }
    console.log('Index: .math-workspace/lean-index.json');
    console.log('Report: .math-workspace/lean-report.md');
    if (action === 'dependencies') console.log('Dependency comparison: .math-workspace/lean-dependency-report.md');
    if (action === 'coverage') console.log(renderLeanReport(state.leanIndex));
    if (action === 'verify' && errors.length > 0) process.exitCode = 1;
}

function normalizeGraphId(value) {
    return String(value || '').trim().replace(/^[@#]/, '').replace(/\.title$/, '');
}

function isGraphWhere(value): value is DependencyGraphWhereFilter {
    return value === 'all' || value === 'statement' || value === 'proof' || value === 'body';
}

function parseGraphArgs(args) {
    const options: {
        action: string;
        positionals: string[];
        depth: number;
        where: DependencyGraphWhereFilter | string;
    } = {
        action: args[0] || '',
        positionals: [],
        depth: 2,
        where: 'all'
    };

    const rest = args.slice(options.action ? 1 : 0);
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === '--depth') {
            options.depth = Number(rest[++i]);
        } else if (arg.startsWith('--depth=')) {
            options.depth = Number(arg.slice('--depth='.length));
        } else if (arg === '--where') {
            options.where = rest[++i] || 'all';
        } else if (arg.startsWith('--where=')) {
            options.where = arg.slice('--where='.length);
        } else {
            options.positionals.push(arg);
        }
    }

    if (!Number.isFinite(options.depth) || options.depth < 1) options.depth = 2;
    options.depth = Math.floor(options.depth);
    if (!isGraphWhere(options.where)) {
        throw new Error(`Invalid graph --where value: ${options.where}. Use all, statement, proof, or body.`);
    }
    return options as {
        action: string;
        positionals: string[];
        depth: number;
        where: DependencyGraphWhereFilter;
    };
}

function printGraphUsage() {
    console.log(`Usage:
  npm run workspace -- graph
  npm run workspace -- graph summary [--where all|statement|proof|body]
  npm run workspace -- graph focus <h-id> [--depth N] [--where all|statement|proof|body]
  npm run workspace -- graph impact <h-id> [--where all|statement|proof|body]
  npm run workspace -- graph upstream <h-id> [--where all|statement|proof|body]
  npm run workspace -- graph bridges [--where all|statement|proof|body]
  npm run workspace -- graph isolated [--where all|statement|proof|body]
  npm run workspace -- graph cycles [--where all|statement|proof|body]
  npm run workspace -- graph matrix chapter|volume|book [--where all|statement|proof|body]`);
}

async function graph(args = []) {
    const options = parseGraphArgs(args);
    if (options.action === 'help' || options.action === '--help') {
        printGraphUsage();
        return;
    }

    const state = await scanWorkspace();
    await writeArtifacts(state);
    const dependencyGraph = state.dependencyGraph;

    if (!options.action) {
        const supplementalRemarks = dependencyGraph.summary.supplementalRemarkNodes;
        const remarkLabel = supplementalRemarks === 1 ? 'supplemental remark' : 'supplemental remarks';
        console.log(`OK graph: ${dependencyGraph.summary.theoremLikeNodes} theorem-like nodes, ${supplementalRemarks} ${remarkLabel}, ${dependencyGraph.summary.edges} explicit edges, ${dependencyGraph.summary.proofEdges} proof edges, ${dependencyGraph.summary.cycles} cycles`);
        console.log('Graph: .math-workspace/dependency-graph.json');
        console.log('Report: .math-workspace/dependency-report.md');
        console.log('Run `npm run workspace -- graph summary` for a Markdown summary.');
        return;
    }

    if (options.action === 'summary') {
        console.log(renderDependencyGraphSummary(dependencyGraph, options.where));
        return;
    }

    if (options.action === 'isolated') {
        console.log(renderDependencyGraphIsolated(dependencyGraph, options.where));
        return;
    }

    if (options.action === 'cycles') {
        console.log(renderDependencyGraphCycles(dependencyGraph, options.where));
        return;
    }

    if (options.action === 'bridges') {
        console.log(renderDependencyGraphBridges(dependencyGraph, options.where));
        return;
    }

    if (options.action === 'matrix') {
        const scope = options.positionals[0] || 'chapter';
        if (scope !== 'chapter' && scope !== 'volume' && scope !== 'book') {
            throw new Error(`Invalid graph matrix scope: ${scope}. Use chapter, volume, or book.`);
        }
        console.log(renderDependencyGraphMatrix(dependencyGraph, scope as DependencyGraphMatrixScope, options.where));
        return;
    }

    if (options.action === 'focus' || options.action === 'impact' || options.action === 'upstream') {
        const id = normalizeGraphId(options.positionals[0]);
        if (!id) {
            throw new Error(`graph ${options.action} requires a hash id.`);
        }
        if (options.action === 'focus') {
            console.log(renderDependencyGraphFocus(dependencyGraph, id, options.depth, options.where));
        } else if (options.action === 'impact') {
            console.log(renderDependencyGraphImpact(dependencyGraph, id, options.where));
        } else {
            console.log(renderDependencyGraphUpstream(dependencyGraph, id, options.where));
        }
        return;
    }

    console.error(`Unknown graph command: ${options.action}`);
    printGraphUsage();
    process.exitCode = 1;
}

const VERIFY_BLOCKING_WARNING_CODES = new Set([
    'non-hash-id',
    'formal-marker-outside-numbered-file',
    'duplicate-special-page',
    'definition-content-missing',
    'definition-content-stale'
]);

async function readTextReferenceMigrationCounts() {
    try {
        const report = await fs.readFile(path.join(CACHE_DIR, 'text-ref-migration.md'), 'utf8');
        return {
            unresolved: Number(report.match(/^Unresolved:\s*(\d+)/m)?.[1] || 0),
            ambiguous: Number(report.match(/^Ambiguous:\s*(\d+)/m)?.[1] || 0)
        };
    } catch (_err) {
        return { unresolved: 0, ambiguous: 0 };
    }
}

async function verify(args) {
    const strictChapters = args.includes('--strict-chapters');
    const state = await scanWorkspace();
    await writeArtifacts(state);
    printSummary('verify', state);

    const blockingIssues = state.issues.filter(issue => {
        if (issue.severity === 'error') return true;
        if (VERIFY_BLOCKING_WARNING_CODES.has(issue.code)) return true;
        return strictChapters && issue.code === 'chapter-gap';
    });
    const migrationCounts = await readTextReferenceMigrationCounts();
    const hasOpenTextMigration = migrationCounts.unresolved > 0 || migrationCounts.ambiguous > 0;

    if (blockingIssues.length === 0 && !hasOpenTextMigration) {
        console.log('OK verify: generated/ migrated content gate passed');
        return;
    }

    if (blockingIssues.length > 0) {
        console.error(`VERIFY failed: ${blockingIssues.length} blocking issues`);
        blockingIssues.slice(0, 10).forEach(issue => {
            const location = issue.line ? `${issue.file}:${issue.line}` : issue.file || 'workspace';
            console.error(`${issue.code} ${location}: ${issue.message}`);
        });
        if (blockingIssues.length > 10) {
            console.error(`... ${blockingIssues.length - 10} more blocking issues in .math-workspace/report.md`);
        }
    }

    if (hasOpenTextMigration) {
        console.error(`VERIFY failed: text-reference migration has unresolved=${migrationCounts.unresolved}, ambiguous=${migrationCounts.ambiguous}`);
        console.error('Resolve .math-workspace/text-ref-migration.md before treating migration as complete.');
    }

    process.exitCode = 1;
}

async function finalize(paths, commandName = 'finalize') {
    const options = parseMigrationArgs(paths);
    if (options.paths.length === 0) {
        console.error(`Usage: npm run workspace -- ${commandName} <file-or-dir> [...] [--all]`);
        process.exitCode = 1;
        return;
    }

    const state = await scanWorkspace();
    const targetFiles = await resolveInputMarkdownFiles(options.paths, state.config);
    const existingIds = new Set(Object.keys(state.labels).filter(id => !TMP_ID_RE.test(id)));
    const tmpDefs = [];

    for (const filePath of targetFiles) {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        let inFence = false;
        for (const line of lines) {
            if (/^\s*(```|~~~)/.test(line)) {
                inFence = !inFence;
                continue;
            }
            if (inFence) continue;
            const marker = parseFormalMarkerLine(line);
            if (marker?.id && TMP_ID_RE.test(marker.id)) {
                tmpDefs.push({ id: marker.id, file: relativePath(filePath) });
            }
        }
    }

    const tmpIds = [...new Set(tmpDefs.map(def => def.id))].sort((a, b) => naturalTmpCompare(a, b));
    const duplicateTmp = tmpIds.filter(id => tmpDefs.filter(def => def.id === id).length > 1);
    if (duplicateTmp.length > 0) {
        duplicateTmp.forEach(id => console.error(`Duplicate temporary marker #${id}`));
        process.exitCode = 1;
        return;
    }
    if (tmpIds.length === 0) {
        const normalizedPageRefFiles = await normalizePageReferencesInFiles(targetFiles);
        console.log(`OK finalize: no temporary ids found${normalizedPageRefFiles > 0 ? `, normalized page refs in ${normalizedPageRefFiles} files` : ''}`);
        await prepare({ exitOnError: true });
        return;
    }

    const targetFileSet = new Set(targetFiles.map(relativePath));
    const tmpIdSet = new Set(tmpIds);
    const outsideTmpRefs = state.references.filter(ref => tmpIdSet.has(ref.id) && !targetFileSet.has(ref.file));
    if (!options.all && outsideTmpRefs.length > 0) {
        console.error(`Scoped finalize would leave ${outsideTmpRefs.length} cross-file temporary references unresolved.`);
        console.error('Rerun with --all if those cross-file @tmp-* references intentionally point to this target scope.');
        printReferenceSamples(outsideTmpRefs);
        process.exitCode = 1;
        return;
    }

    const mapping = new Map();
    for (const tmpId of tmpIds) {
        let newId;
        do {
            newId = `h-${crypto.randomBytes(8).toString('hex')}`;
        } while (existingIds.has(newId));
        existingIds.add(newId);
        mapping.set(tmpId, newId);
    }

    let changedFiles = 0;
    const rewriteFiles = options.all ? await collectMarkdownFiles(state.config) : targetFiles;
    for (const filePath of rewriteFiles) {
        const original = await fs.readFile(filePath, 'utf8');
        let updated = rewriteFormalIds(original, mapping, {
            rewriteDefinitions: targetFileSet.has(relativePath(filePath))
        });
        if (options.all || targetFileSet.has(relativePath(filePath))) {
            updated = rewritePageReferences(updated, relativePath(filePath));
        }
        if (updated !== original) {
            await fs.writeFile(filePath, updated, 'utf8');
            changedFiles++;
        }
    }

    console.log(`OK finalize: ${tmpIds.length} ids finalized across ${changedFiles} files`);
    if (!options.all) {
        console.log('Scope: target files only. Use --all to rewrite cross-file @tmp-* references.');
    }
    for (const [tmpId, hashId] of mapping) {
        console.log(`${tmpId} -> ${hashId}`);
    }
    await prepare({ exitOnError: true });
}

async function normalizePageReferencesInFiles(files) {
    let changedFiles = 0;
    for (const filePath of files) {
        const original = await fs.readFile(filePath, 'utf8');
        const updated = rewritePageReferences(original, relativePath(filePath));
        if (updated !== original) {
            await fs.writeFile(filePath, updated, 'utf8');
            changedFiles++;
        }
    }
    return changedFiles;
}

async function finish(args) {
    await finalize(args, 'finish');
    if (process.exitCode && process.exitCode !== 0) return;
    await verify([]);
}

function naturalTmpCompare(a, b) {
    const na = a.match(/^tmp-(\d+)$/)?.[1];
    const nb = b.match(/^tmp-(\d+)$/)?.[1];
    if (na && nb) return Number(na) - Number(nb);
    return a.localeCompare(b);
}

function rewriteInlineRefsOutsideCode(line, mapping) {
    const parts = line.split(/(`[^`]*`)/g);
    return parts.map(part => {
        if (part.startsWith('`') && part.endsWith('`')) return part;
        let updated = part;
        for (const [oldId, newId] of mapping) {
            const re = new RegExp(`@${escapeRegExp(oldId)}(?=(?:\\.(?:title|full))?\\b)`, 'g');
            updated = updated.replace(re, `@${newId}`);
        }
        return updated;
    }).join('');
}

function rewriteMarkerId(line, mapping) {
    const marker = parseFormalMarkerLine(line);
    if (!marker?.id) return line;
    let updated = line;
    for (const [oldId, newId] of mapping) {
        const re = new RegExp(`#${escapeRegExp(oldId)}(?=\\b)`, 'g');
        updated = updated.replace(re, `#${newId}`);
    }
    return updated;
}

function rewriteFormalIds(content, mapping, { rewriteDefinitions }) {
    const lines = content.split(/\r?\n/);
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    let inFence = false;
    const updated = lines.map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;

        let next = rewriteDefinitions ? rewriteMarkerId(line, mapping) : line;
        next = rewriteInlineRefsOutsideCode(next, mapping);
        return next;
    });
    return updated.join(eol);
}

function rewritePageReferences(content, file) {
    const lines = content.split(/\r?\n/);
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const pageRefRe = /(^|[^A-Za-z0-9_])@(chapter|page):([^\s<>"'`，。；;！？]+?\.md)(?:\.(title|full))?(?=$|[\s,，。；;:：.!！?？)\]}])/g;
    let inFence = false;
    let changed = false;

    const updated = lines.map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;

        return splitProtectedInlineSegments(line).map(part => {
            if (part.kind !== 'text') return part.text;

            pageRefRe.lastIndex = 0;
            return part.text.replace(pageRefRe, (match, prefix, kind, rawTarget, mode) => {
                const normalized = normalizeFormalPagePath(rawTarget, file);
                if (!normalized || normalized === rawTarget) return match;
                changed = true;
                return `${prefix}@${kind}:${normalized}${mode ? `.${mode}` : ''}`;
            });
        }).join('');
    });

    return changed ? updated.join(eol) : content;
}

function isPageLabel(label) {
    return !!label && ['chapter', 'intro', 'summary', 'appendix'].includes(label.type);
}

function pageFromLabel(label, state) {
    const page = (state.pages || []).find(item => item.id && state.labels[item.id] === label);
    if (page) return page;
    return {
        kind: label.type,
        filePath: label.filePath,
        title: label.title,
        order: label.unitOrder || 0,
        bookKey: label.bookKey,
        bookTitle: label.bookTitle,
        bookOrder: label.bookOrder,
        volumeKey: label.volumeKey,
        volumeTitle: label.volumeTitle,
        volumeOrder: label.volumeOrder,
        unitKind: label.unitKind,
        unitKey: label.unitKey,
        unitLabel: label.unitLabel,
        unitOrder: label.unitOrder,
        chapter: label.chapter,
        appendix: label.appendix
    };
}

function findDefinitionById(state, id) {
    return (state.definitions || []).find(def => def.id === id);
}

function displayObjectReference(state, id, mode = 'default') {
    const label = state.labels[id];
    if (!label) return `@${id}${mode === 'default' ? '' : `.${mode}`}`;

    if (isPageLabel(label)) {
        const page = pageFromLabel(label, state);
        const pageMode = mode === 'title' || mode === 'full' ? mode : 'default';
        return formatPageReference(page, state.config, pageMode);
    }

    if (mode === 'title') return label.title || id;

    const def = findDefinitionById(state, id);
    const base = def ? displayLabel(def, state.config) : label.title || id;
    if (mode !== 'full' || !label.title) return base;

    const language = state.config?.language === 'en' ? 'en' : 'zh';
    const open = language === 'en' ? ' (' : '（';
    const close = language === 'en' ? ')' : '）';
    return `${base}${open}${label.title}${close}`;
}

function displayPagePathReference(state, sourceFilePath, kind, rawTarget, mode = 'default') {
    const target = normalizeFormalPagePath(rawTarget, sourceFilePath);
    const page = (state.pages || []).find(item => item.filePath === target);
    if (!page) return `@${kind}:${rawTarget}${mode === 'default' ? '' : `.${mode}`}`;
    const displayMode = mode === 'title' || mode === 'full' ? mode : 'default';
    return formatPageReference(page, state.config, displayMode);
}

function displayMarkerDeclaration(marker, state) {
    if (!marker?.id) return marker?.markerText || '';
    const label = state.labels[marker.id];
    if (!label) return marker.markerText;
    if (isPageLabel(label)) return '';

    const def = findDefinitionById(state, marker.id);
    if (!def) return marker.markerText;
    if (marker.type === 'section') return displayNumber(def) || marker.title;
    return displayLabel(def, state.config);
}

function compileFormalMarkerLine(line, state) {
    const marker = parseFormalMarkerLine(line);
    if (!marker?.id) return line;

    const label = state.labels[marker.id];
    if (isPageLabel(label)) {
        const page = pageFromLabel(label, state);
        const headingRe = new RegExp(`^(\\s*#{1,6}\\s+)#${escapeRegExp(marker.id)}\\b\\s*.*$`);
        return line.replace(headingRe, `$1${formatPageHeading(page, state.config)}`);
    }

    const replacement = displayMarkerDeclaration(marker, state);
    return line.replace(marker.markerText, replacement);
}

function rewriteFormalRefsForExport(text, sourceFilePath, state) {
    const pageRefRe = /(^|[^A-Za-z0-9_])@(chapter|page):([^\s<>"'`，。；;！？]+?\.md)(?:\.(title|full))?(?=$|[\s,，。；;:：.!！?？)\]}])/g;
    const idRefRe = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_-]+)(?:\.(title|full))?\b(?!:)/g;

    return text
        .replace(pageRefRe, (_match, prefix, kind, rawTarget, mode) => {
            return `${prefix}${displayPagePathReference(state, sourceFilePath, kind, rawTarget, mode || 'default')}`;
        })
        .replace(idRefRe, (_match, prefix, id, mode) => {
            return `${prefix}${displayObjectReference(state, id, mode || 'default')}`;
        });
}

type ExportLinkTargetMode = 'root' | 'preserve';

function normalizeExportLinkTarget(rawTarget, sourceFilePath) {
    const raw = String(rawTarget || '');
    const match = raw.match(/^(\s*<?)([^\s>]+)(>?[\s\S]*)$/);
    if (!match) return raw;

    const target = match[2];
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return raw;
    if (target.startsWith('@')) return raw;
    if (target.startsWith('{') || target.startsWith('[')) return raw;

    const sourceDir = path.posix.dirname(sourceFilePath);
    const normalized = path.posix.normalize(path.posix.join(sourceDir === '.' ? '' : sourceDir, target)).replace(/^\.\/+/, '');
    return `${match[1]}${normalized}${match[3]}`;
}

function rewriteMarkdownLinkTargetsForExport(segment, sourceFilePath, mode: ExportLinkTargetMode = 'root') {
    if (mode === 'preserve') return segment;
    return segment.replace(/(\[[^\]\n]*\]\()([^\)\n]+)(\))/g, (_match, prefix, target, suffix) => {
        return `${prefix}${normalizeExportLinkTarget(target, sourceFilePath)}${suffix}`;
    });
}

function compileFormalMarkdownContent(content, sourceFilePath, state, options: { linkTargetMode?: ExportLinkTargetMode } = {}) {
    const lines = String(content || '').split(/\r?\n/);
    let inFence = false;
    const linkTargetMode = options.linkTargetMode || 'root';

    return lines.map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;

        const markerCompiled = compileFormalMarkerLine(line, state);
        return splitProtectedInlineSegments(markerCompiled).map(part => {
            if (part.kind === 'code') return part.text;
            if (part.kind === 'link') return rewriteMarkdownLinkTargetsForExport(part.text, sourceFilePath, linkTargetMode);
            return rewriteFormalRefsForExport(part.text, sourceFilePath, state);
        }).join('');
    }).join('\n');
}

async function compileFormalMarkdownForFiles(files, state, options: { linkTargetMode?: ExportLinkTargetMode } = {}) {
    const chunks = [];
    for (const filePath of files) {
        const relative = relativePath(filePath);
        const content = await fs.readFile(filePath, 'utf8');
        chunks.push(compileFormalMarkdownContent(content, relative, state, options).trimEnd());
    }
    return `${chunks.filter(Boolean).join('\n\n\\pagebreak\n\n')}\n`;
}

function exportPageOrder(page) {
    if (!page) return Number.MAX_SAFE_INTEGER;
    if (page.kind === 'intro') return -100000;
    if (page.kind === 'summary') return 90000;
    if (page.kind === 'appendix') return typeof page.unitOrder === 'number' ? page.unitOrder : 100000;
    if (typeof page.unitOrder === 'number') return page.unitOrder;
    return typeof page.order === 'number' ? page.order : Number.MAX_SAFE_INTEGER;
}

function compareExportNumber(a, b) {
    const av = Number.isFinite(a) ? a : Number.MAX_SAFE_INTEGER;
    const bv = Number.isFinite(b) ? b : Number.MAX_SAFE_INTEGER;
    return av === bv ? 0 : av - bv;
}

function sortExportFiles(files, state) {
    const pageByPath = new Map((state.pages || []).map(page => [page.filePath, page]));
    return [...files].sort((a, b) => {
        const relA = relativePath(a);
        const relB = relativePath(b);
        const pageA: any = pageByPath.get(relA);
        const pageB: any = pageByPath.get(relB);

        const bookOrder = compareExportNumber(pageA?.bookOrder, pageB?.bookOrder);
        if (bookOrder !== 0) return bookOrder;
        const volumeOrder = compareExportNumber(pageA?.volumeOrder, pageB?.volumeOrder);
        if (volumeOrder !== 0) return volumeOrder;
        const pageOrder = compareExportNumber(exportPageOrder(pageA), exportPageOrder(pageB));
        if (pageOrder !== 0) return pageOrder;
        return relA.localeCompare(relB);
    });
}

const PDF_TOC_PAGEBREAK_HEADER = '\\let\\markdownFormalOldTableOfContents\\tableofcontents\\renewcommand{\\tableofcontents}{\\clearpage\\markdownFormalOldTableOfContents\\clearpage}';

function latexEscapeText(value) {
    return String(value || '')
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/([#$%&_{}])/g, '\\$1')
        .replace(/\^/g, '\\textasciicircum{}')
        .replace(/~/g, '\\textasciitilde{}');
}

function latexLine(text, size, options: { bold?: boolean } = {}) {
    const content = latexEscapeText(text);
    if (!content) return '';
    const leading = String(size || '').replace(/pt$/i, '');
    const baseline = Number.isFinite(Number(leading)) ? `${Math.round(Number(leading) * 1.25)}pt` : size;
    const weight = options.bold ? '\\bfseries ' : '';
    return `{\\fontsize{${size}}{${baseline}}\\selectfont ${weight}${content}\\par}`;
}

function simpleTitlePageHeader(options) {
    if (!options.titlePage || options.coverStyle !== 'simple' || !options.title) return '';
    const title = latexLine(options.title, options.titleSize, { bold: true });
    const subtitle = latexLine(options.subtitle, options.subtitleSize);
    const author = latexLine(options.author, options.authorSize);
    const date = latexLine(options.date, options.dateSize);
    const version = options.showVersionOnCover ? latexLine(options.releaseVersion, options.dateSize) : '';
    const authorBlock = [author, date, version].filter(Boolean).join('\\vspace{0.8em}');
    return [
        '\\renewcommand{\\maketitle}{',
        '\\begin{titlepage}\\thispagestyle{empty}\\vspace*{0.20\\textheight}\\begin{center}',
        title,
        subtitle ? `\\vspace{1.2em}${subtitle}` : '',
        authorBlock ? `\\vfill${authorBlock}` : '',
        '\\end{center}\\end{titlepage}',
        '}'
    ].filter(Boolean).join('');
}

function normalizedMetadataUrl(value) {
    const text = String(value || '').trim();
    return text;
}

function publicationMetadataRows(options): Array<[string, string]> {
    const rows: Array<[string, string]> = [];
    const add = (label: string, value: string) => {
        const normalized = String(value || '').trim();
        if (normalized) rows.push([label, normalized]);
    };

    add('Author', options.author);
    add('Native name', options.authorNative);
    add('Also known as', (options.authorAliases || []).join('; '));
    add('ORCID', normalizedMetadataUrl(options.orcid));
    add('Repository', normalizedMetadataUrl(options.repository));
    const license = options.licenseUrl
        ? `${options.license || options.licenseUrl}${options.license ? ' ' : ''}(${normalizedMetadataUrl(options.licenseUrl)})`
        : options.license;
    add('License', license);
    add('Release version', options.releaseVersion);
    add('Release tag', options.releaseTag);
    add('Commit', options.releaseCommit);
    add('DOI', options.doi);
    add('Preferred citation', options.preferredCitation);
    return rows;
}

function latexMetadataText(value) {
    return latexEscapeText(value).replace(/\r?\n/g, '\\par ');
}

function frontMatterMarkdownWithSafeHeadings(content, includeHeadingsInToc) {
    const classes = includeHeadingsInToc ? '{.unnumbered}' : '{.unnumbered .unlisted}';
    return String(content || '').replace(/^(#{1,6}\s+)(.+?)\s*$/gm, (_match, prefix, title) => {
        if (/\{[^}]*\}\s*$/.test(title)) return `${prefix}${title}`;
        return `${prefix}${title} ${classes}`;
    });
}

function markdownToLatexSnippet(content, sourceLabel) {
    const result = spawnSync('pandoc', ['-f', 'markdown', '-t', 'latex'], {
        cwd: ROOT,
        input: content,
        encoding: 'utf8'
    });

    if (result.error) {
        throw new Error(`Unable to render front matter ${sourceLabel}: ${result.error.message || result.error}`);
    }
    if (result.status !== 0) {
        throw new Error(`Unable to render front matter ${sourceLabel}: ${result.stderr || result.stdout || `pandoc exited with ${result.status}`}`);
    }
    return String(result.stdout || '').trim();
}

async function frontMatterMarkdown(entry) {
    const parts: string[] = [];
    if (entry.source) {
        const sourcePath = path.resolve(ROOT, entry.source);
        parts.push(await fs.readFile(sourcePath, 'utf8'));
    }
    if (entry.content) {
        parts.push(entry.content);
    }
    return parts.join('\n\n').trim();
}

async function frontMatterLatex(options) {
    const pages: string[] = [];
    for (const entry of options.frontMatter || []) {
        const markdown = await frontMatterMarkdown(entry);
        const normalized = frontMatterMarkdownWithSafeHeadings(markdown, entry.toc === true);
        const body = normalized ? markdownToLatexSnippet(normalized, entry.source || entry.title || 'inline content') : '';
        if (!entry.title && !body) continue;

        const lines = ['\\clearpage'];
        if (entry.title) {
            lines.push(`\\section*{${latexMetadataText(entry.title)}}`);
            if (entry.toc === true) {
                lines.push(`\\addcontentsline{toc}{section}{${latexMetadataText(entry.title)}}`);
            }
        }
        if (body) lines.push(body);
        if (entry.pageBreakAfter !== false) lines.push('\\clearpage');
        pages.push(lines.join('\n'));
    }
    return pages.join('\n\n');
}

function publicationMetadataLatex(options) {
    if (!options.metadataPage) return '';

    const rows = publicationMetadataRows(options);
    if (rows.length === 0) return '';

    return [
        '\\clearpage',
        '\\section*{Publication Metadata}',
        '\\begin{description}',
        ...rows.map(([label, value]) => `\\item[${latexMetadataText(label)}] ${latexMetadataText(value)}`),
        '\\end{description}',
        '\\clearpage',
        ''
    ].join('\n');
}

async function preparePdfIncludeBeforeBody(options, inputMarkdownPath) {
    const chunks = [
        publicationMetadataLatex(options),
        await frontMatterLatex(options)
    ].filter(Boolean);
    if (chunks.length === 0) {
        return {
            path: '',
            cleanup: async () => {}
        };
    }

    const frontMatter = chunks.join('\n\n');
    const base = path.basename(inputMarkdownPath).replace(/[^A-Za-z0-9_.-]/g, '_');
    const name = `.${base}.${process.pid}.${Date.now()}.publication.tex`;
    const candidate = path.join(path.dirname(inputMarkdownPath), name);
    await fs.writeFile(candidate, frontMatter, 'utf8');
    return {
        path: candidate,
        cleanup: async () => {
            await fs.rm(candidate, { force: true });
        }
    };
}

function pdfLanguageDefault(config) {
    return config?.language === 'en' ? 'en-US' : 'zh-CN';
}

function pdfTocTitleDefault(config) {
    return config?.language === 'en' ? 'Contents' : '目录';
}

function pdfConfigDefaults(configInput = DEFAULT_CONFIG) {
    const config = mergeConfig(configInput);
    const pdf = config.pdf || {};
    return {
        pdfEngine: pdf.pdfEngine || 'xelatex',
        toc: pdf.toc !== false,
        tocDepth: Number.isFinite(Number(pdf.tocDepth)) && Number(pdf.tocDepth) >= 1 ? Math.floor(Number(pdf.tocDepth)) : 2,
        margin: pdf.margin || '2.5cm',
        paper: pdf.paper || 'a4',
        lang: pdf.lang || pdfLanguageDefault(config),
        tocTitle: pdf.tocTitle || pdfTocTitleDefault(config),
        title: pdf.title || '',
        subtitle: pdf.subtitle || '',
        author: pdf.author || '',
        authorNative: pdf.authorNative || '',
        authorAliases: Array.isArray(pdf.authorAliases) ? pdf.authorAliases.filter(value => typeof value === 'string' && value) : [],
        orcid: pdf.orcid || '',
        repository: pdf.repository || '',
        license: pdf.license || '',
        licenseUrl: pdf.licenseUrl || '',
        preferredCitation: pdf.preferredCitation || '',
        date: pdf.date || '',
        releaseVersion: pdf.releaseVersion || '',
        releaseTag: pdf.releaseTag || '',
        releaseCommit: pdf.releaseCommit || '',
        doi: pdf.doi || '',
        showVersionOnCover: pdf.showVersionOnCover === true,
        metadataPage: pdf.metadataPage === true,
        documentClass: pdf.documentClass || '',
        titlePage: pdf.titlePage === true,
        coverStyle: pdf.coverStyle || 'simple',
        titleSize: pdf.titleSize || '32pt',
        subtitleSize: pdf.subtitleSize || '18pt',
        authorSize: pdf.authorSize || '12pt',
        dateSize: pdf.dateSize || '12pt',
        tocPageBreak: pdf.tocPageBreak !== false,
        frontMatter: Array.isArray(pdf.frontMatter) ? pdf.frontMatter : [],
        variables: Array.isArray(pdf.variables) ? pdf.variables.filter(value => typeof value === 'string' && value) : []
    };
}

function parseExportArgs(args, defaultOutput, configInput = DEFAULT_CONFIG) {
    const pdfDefaults = pdfConfigDefaults(configInput);
    const options: {
        output: string;
        mdOutput: string;
        pdfEngine: string;
        keepMarkdown: boolean;
        toc: boolean;
        tocDepth: number;
        margin: string;
        paper: string;
        lang: string;
        tocTitle: string;
        title: string;
        subtitle: string;
        author: string;
        authorNative: string;
        authorAliases: string[];
        orcid: string;
        repository: string;
        license: string;
        licenseUrl: string;
        preferredCitation: string;
        date: string;
        releaseVersion: string;
        releaseTag: string;
        releaseCommit: string;
        doi: string;
        showVersionOnCover: boolean;
        metadataPage: boolean;
        documentClass: string;
        titlePage: boolean;
        coverStyle: string;
        titleSize: string;
        subtitleSize: string;
        authorSize: string;
        dateSize: string;
        tocPageBreak: boolean;
        includeBeforeBodyPath: string;
        frontMatter: Array<{ title?: string; source?: string; content?: string; toc?: boolean; pageBreakAfter?: boolean }>;
        variables: string[];
        paths: string[];
    } = {
        output: defaultOutput,
        mdOutput: '',
        pdfEngine: pdfDefaults.pdfEngine,
        keepMarkdown: false,
        toc: pdfDefaults.toc,
        tocDepth: pdfDefaults.tocDepth,
        margin: pdfDefaults.margin,
        paper: pdfDefaults.paper,
        lang: pdfDefaults.lang,
        tocTitle: pdfDefaults.tocTitle,
        title: pdfDefaults.title,
        subtitle: pdfDefaults.subtitle,
        author: pdfDefaults.author,
        authorNative: pdfDefaults.authorNative,
        authorAliases: [...pdfDefaults.authorAliases],
        orcid: pdfDefaults.orcid,
        repository: pdfDefaults.repository,
        license: pdfDefaults.license,
        licenseUrl: pdfDefaults.licenseUrl,
        preferredCitation: pdfDefaults.preferredCitation,
        date: pdfDefaults.date,
        releaseVersion: pdfDefaults.releaseVersion,
        releaseTag: pdfDefaults.releaseTag,
        releaseCommit: pdfDefaults.releaseCommit,
        doi: pdfDefaults.doi,
        showVersionOnCover: pdfDefaults.showVersionOnCover,
        metadataPage: pdfDefaults.metadataPage,
        documentClass: pdfDefaults.documentClass,
        titlePage: pdfDefaults.titlePage,
        coverStyle: pdfDefaults.coverStyle,
        titleSize: pdfDefaults.titleSize,
        subtitleSize: pdfDefaults.subtitleSize,
        authorSize: pdfDefaults.authorSize,
        dateSize: pdfDefaults.dateSize,
        tocPageBreak: pdfDefaults.tocPageBreak,
        includeBeforeBodyPath: '',
        frontMatter: [...pdfDefaults.frontMatter],
        variables: [...pdfDefaults.variables],
        paths: []
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--out' || arg === '-o') {
            options.output = args[++i] || options.output;
        } else if (arg.startsWith('--out=')) {
            options.output = arg.slice('--out='.length);
        } else if (arg === '--md-out') {
            options.mdOutput = args[++i] || options.mdOutput;
        } else if (arg.startsWith('--md-out=')) {
            options.mdOutput = arg.slice('--md-out='.length);
        } else if (arg === '--pdf-engine') {
            options.pdfEngine = args[++i] || options.pdfEngine;
        } else if (arg.startsWith('--pdf-engine=')) {
            options.pdfEngine = arg.slice('--pdf-engine='.length);
        } else if (arg === '--toc') {
            options.toc = true;
        } else if (arg === '--no-toc') {
            options.toc = false;
        } else if (arg === '--toc-depth') {
            options.tocDepth = Number(args[++i] || options.tocDepth);
        } else if (arg.startsWith('--toc-depth=')) {
            options.tocDepth = Number(arg.slice('--toc-depth='.length));
        } else if (arg === '--margin') {
            options.margin = args[++i] || options.margin;
        } else if (arg.startsWith('--margin=')) {
            options.margin = arg.slice('--margin='.length);
        } else if (arg === '--paper') {
            options.paper = args[++i] || options.paper;
        } else if (arg.startsWith('--paper=')) {
            options.paper = arg.slice('--paper='.length);
        } else if (arg === '--lang') {
            options.lang = args[++i] || options.lang;
        } else if (arg.startsWith('--lang=')) {
            options.lang = arg.slice('--lang='.length);
        } else if (arg === '--toc-title') {
            options.tocTitle = args[++i] || options.tocTitle;
        } else if (arg.startsWith('--toc-title=')) {
            options.tocTitle = arg.slice('--toc-title='.length);
        } else if (arg === '--title') {
            options.title = args[++i] || options.title;
        } else if (arg.startsWith('--title=')) {
            options.title = arg.slice('--title='.length);
        } else if (arg === '--subtitle') {
            options.subtitle = args[++i] || options.subtitle;
        } else if (arg.startsWith('--subtitle=')) {
            options.subtitle = arg.slice('--subtitle='.length);
        } else if (arg === '--author') {
            options.author = args[++i] || options.author;
        } else if (arg.startsWith('--author=')) {
            options.author = arg.slice('--author='.length);
        } else if (arg === '--author-native') {
            options.authorNative = args[++i] || options.authorNative;
        } else if (arg.startsWith('--author-native=')) {
            options.authorNative = arg.slice('--author-native='.length);
        } else if (arg === '--author-alias') {
            const value = args[++i];
            if (value) options.authorAliases.push(value);
        } else if (arg.startsWith('--author-alias=')) {
            const value = arg.slice('--author-alias='.length);
            if (value) options.authorAliases.push(value);
        } else if (arg === '--orcid') {
            options.orcid = args[++i] || options.orcid;
        } else if (arg.startsWith('--orcid=')) {
            options.orcid = arg.slice('--orcid='.length);
        } else if (arg === '--repository') {
            options.repository = args[++i] || options.repository;
        } else if (arg.startsWith('--repository=')) {
            options.repository = arg.slice('--repository='.length);
        } else if (arg === '--license') {
            options.license = args[++i] || options.license;
        } else if (arg.startsWith('--license=')) {
            options.license = arg.slice('--license='.length);
        } else if (arg === '--license-url') {
            options.licenseUrl = args[++i] || options.licenseUrl;
        } else if (arg.startsWith('--license-url=')) {
            options.licenseUrl = arg.slice('--license-url='.length);
        } else if (arg === '--preferred-citation') {
            options.preferredCitation = args[++i] || options.preferredCitation;
        } else if (arg.startsWith('--preferred-citation=')) {
            options.preferredCitation = arg.slice('--preferred-citation='.length);
        } else if (arg === '--date') {
            options.date = args[++i] || options.date;
        } else if (arg.startsWith('--date=')) {
            options.date = arg.slice('--date='.length);
        } else if (arg === '--release-version') {
            options.releaseVersion = args[++i] || options.releaseVersion;
        } else if (arg.startsWith('--release-version=')) {
            options.releaseVersion = arg.slice('--release-version='.length);
        } else if (arg === '--release-tag') {
            options.releaseTag = args[++i] || options.releaseTag;
        } else if (arg.startsWith('--release-tag=')) {
            options.releaseTag = arg.slice('--release-tag='.length);
        } else if (arg === '--release-commit') {
            options.releaseCommit = args[++i] || options.releaseCommit;
        } else if (arg.startsWith('--release-commit=')) {
            options.releaseCommit = arg.slice('--release-commit='.length);
        } else if (arg === '--doi') {
            options.doi = args[++i] || options.doi;
        } else if (arg.startsWith('--doi=')) {
            options.doi = arg.slice('--doi='.length);
        } else if (arg === '--show-version-on-cover') {
            options.showVersionOnCover = true;
        } else if (arg === '--no-show-version-on-cover') {
            options.showVersionOnCover = false;
        } else if (arg === '--metadata-page') {
            options.metadataPage = true;
        } else if (arg === '--no-metadata-page') {
            options.metadataPage = false;
        } else if (arg === '--front-matter') {
            const value = args[++i];
            if (value) options.frontMatter.push({ source: value, toc: false, pageBreakAfter: true });
        } else if (arg.startsWith('--front-matter=')) {
            const value = arg.slice('--front-matter='.length);
            if (value) options.frontMatter.push({ source: value, toc: false, pageBreakAfter: true });
        } else if (arg === '--front-matter-title') {
            const value = args[++i] || '';
            const last = options.frontMatter[options.frontMatter.length - 1];
            if (last && value) last.title = value;
        } else if (arg.startsWith('--front-matter-title=')) {
            const value = arg.slice('--front-matter-title='.length);
            const last = options.frontMatter[options.frontMatter.length - 1];
            if (last && value) last.title = value;
        } else if (arg === '--front-matter-toc') {
            const last = options.frontMatter[options.frontMatter.length - 1];
            if (last) last.toc = true;
        } else if (arg === '--no-front-matter-toc') {
            const last = options.frontMatter[options.frontMatter.length - 1];
            if (last) last.toc = false;
        } else if (arg === '--documentclass' || arg === '--document-class') {
            options.documentClass = args[++i] || options.documentClass;
        } else if (arg.startsWith('--documentclass=')) {
            options.documentClass = arg.slice('--documentclass='.length);
        } else if (arg.startsWith('--document-class=')) {
            options.documentClass = arg.slice('--document-class='.length);
        } else if (arg === '--title-page') {
            options.titlePage = true;
        } else if (arg === '--no-title-page') {
            options.titlePage = false;
        } else if (arg === '--cover-style') {
            options.coverStyle = args[++i] || options.coverStyle;
        } else if (arg.startsWith('--cover-style=')) {
            options.coverStyle = arg.slice('--cover-style='.length);
        } else if (arg === '--title-size') {
            options.titleSize = args[++i] || options.titleSize;
        } else if (arg.startsWith('--title-size=')) {
            options.titleSize = arg.slice('--title-size='.length);
        } else if (arg === '--subtitle-size') {
            options.subtitleSize = args[++i] || options.subtitleSize;
        } else if (arg.startsWith('--subtitle-size=')) {
            options.subtitleSize = arg.slice('--subtitle-size='.length);
        } else if (arg === '--author-size') {
            options.authorSize = args[++i] || options.authorSize;
        } else if (arg.startsWith('--author-size=')) {
            options.authorSize = arg.slice('--author-size='.length);
        } else if (arg === '--date-size') {
            options.dateSize = args[++i] || options.dateSize;
        } else if (arg.startsWith('--date-size=')) {
            options.dateSize = arg.slice('--date-size='.length);
        } else if (arg === '--toc-page-break') {
            options.tocPageBreak = true;
        } else if (arg === '--no-toc-page-break') {
            options.tocPageBreak = false;
        } else if (arg === '-V' || arg === '--variable') {
            const value = args[++i];
            if (value) options.variables.push(value);
        } else if (arg.startsWith('-V')) {
            const value = arg.slice(2);
            if (value) options.variables.push(value);
        } else if (arg.startsWith('--variable=')) {
            options.variables.push(arg.slice('--variable='.length));
        } else if (arg === '--keep-md') {
            options.keepMarkdown = true;
        } else if (!arg.startsWith('--')) {
            options.paths.push(arg);
        }
    }

    if (!Number.isFinite(options.tocDepth) || options.tocDepth < 1) options.tocDepth = 2;
    options.tocDepth = Math.floor(options.tocDepth);
    return options;
}

async function exportMarkdown(args = []) {
    const options = parseExportArgs(args, '.math-workspace/export.md');
    if (options.paths.length === 0) {
        console.error('Usage: npm run workspace -- export-md <file-or-dir> [...] --out <compiled.md>');
        process.exitCode = 1;
        return '';
    }

    const state = await scanWorkspace();
    await writeArtifacts(state);
    const errors = state.issues.filter(issue => issue.severity === 'error');
    if (errors.length > 0) {
        printSummary('export-md', state);
        process.exitCode = 1;
        return '';
    }

    const files = sortExportFiles(await resolveInputMarkdownFiles(options.paths, state.config), state);
    if (files.length === 0) {
        console.error('No Markdown files matched export input.');
        process.exitCode = 1;
        return '';
    }

    const outputPath = path.resolve(ROOT, options.output);
    const compiled = await compileFormalMarkdownForFiles(files, state);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, compiled, 'utf8');
    console.log(`OK export-md: ${files.length} files -> ${relativePath(outputPath)}`);
    return outputPath;
}

async function exportMarkdownSplit(args = []) {
    const options = parseExportArgs(args, '.math-workspace/export-md-split');
    if (options.paths.length === 0) {
        console.error('Usage: npm run workspace -- export-md-split <file-or-dir> [...] --out <dir>');
        process.exitCode = 1;
        return '';
    }

    const state = await scanWorkspace();
    await writeArtifacts(state);
    const errors = state.issues.filter(issue => issue.severity === 'error');
    if (errors.length > 0) {
        printSummary('export-md-split', state);
        process.exitCode = 1;
        return '';
    }

    const files = sortExportFiles(await resolveInputMarkdownFiles(options.paths, state.config), state);
    if (files.length === 0) {
        console.error('No Markdown files matched export input.');
        process.exitCode = 1;
        return '';
    }

    const outputRoot = path.resolve(ROOT, options.output);
    if (outputRoot === ROOT) {
        console.error('Refusing to export split Markdown into the project root because it would overwrite source files. Use --out <dir>.');
        process.exitCode = 1;
        return '';
    }

    for (const filePath of files) {
        const relative = relativePath(filePath);
        const outputPath = path.resolve(outputRoot, relative);
        if (!isPathInside(outputRoot, outputPath)) {
            console.error(`Refusing to export ${relative} outside output directory ${relativePath(outputRoot)}.`);
            process.exitCode = 1;
            return '';
        }
        const content = await fs.readFile(filePath, 'utf8');
        const compiled = `${compileFormalMarkdownContent(content, relative, state, { linkTargetMode: 'preserve' }).trimEnd()}\n`;
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, compiled, 'utf8');
    }

    console.log(`OK export-md-split: ${files.length} files -> ${relativePath(outputRoot)}`);
    return outputRoot;
}

function buildPandocPdfArgs(inputMarkdownPath, outputPdfPath, options) {
    const titlePageHeader = simpleTitlePageHeader(options);
    const variables = [
        `papersize:${options.paper}`,
        `geometry:margin=${options.margin}`,
        options.lang ? `lang:${options.lang}` : '',
        options.tocTitle ? `toc-title:${options.tocTitle}` : '',
        options.documentClass ? `documentclass:${options.documentClass}` : '',
        options.title ? `title:${options.title}` : '',
        options.subtitle ? `subtitle:${options.subtitle}` : '',
        options.author ? `author:${options.author}` : '',
        options.date ? `date:${options.date}` : '',
        options.releaseVersion ? `version:${options.releaseVersion}` : '',
        options.titlePage ? 'classoption:titlepage' : '',
        titlePageHeader ? `header-includes:${titlePageHeader}` : '',
        options.toc && options.tocPageBreak ? `header-includes:${PDF_TOC_PAGEBREAK_HEADER}` : '',
        ...options.variables
    ].filter(Boolean);

    const pandocArgs = [
        relativePath(inputMarkdownPath),
        '-o',
        relativePath(outputPdfPath),
        '--pdf-engine',
        options.pdfEngine,
        ...variables.flatMap(value => ['-V', value])
    ];
    if (options.includeBeforeBodyPath) {
        pandocArgs.push('--include-before-body', relativePath(options.includeBeforeBodyPath));
    }
    if (options.toc) {
        pandocArgs.push('--toc', '--toc-depth', String(options.tocDepth));
    }
    return pandocArgs;
}

function pdfLayoutSummary(options) {
    return `paper=${options.paper}, margin=${options.margin}, lang=${options.lang || 'n/a'}, toc=${options.toc ? 'on' : 'off'}, toc-depth=${options.toc ? options.tocDepth : 'n/a'}, toc-title=${options.toc && options.tocTitle ? options.tocTitle : 'n/a'}, title-page=${options.titlePage ? 'on' : 'off'}, cover-style=${options.titlePage ? options.coverStyle : 'n/a'}, release-version=${options.releaseVersion || 'n/a'}, show-version-on-cover=${options.showVersionOnCover ? 'on' : 'off'}, metadata-page=${options.metadataPage ? 'on' : 'off'}, toc-page-break=${options.toc && options.tocPageBreak ? 'on' : 'off'}, pdf-engine=${options.pdfEngine}`;
}

async function renderPdfFile(inputMarkdownPath, outputPdfPath, options) {
    await fs.mkdir(path.dirname(outputPdfPath), { recursive: true });
    let preparedInclude;
    try {
        preparedInclude = await preparePdfIncludeBeforeBody(options, inputMarkdownPath);
    } catch (err: any) {
        console.error(err?.message || String(err));
        process.exitCode = 1;
        return false;
    }
    options.includeBeforeBodyPath = preparedInclude.path;
    let result;
    try {
        result = spawnSync('pandoc', buildPandocPdfArgs(inputMarkdownPath, outputPdfPath, options), {
            cwd: ROOT,
            encoding: 'utf8'
        });
    } finally {
        options.includeBeforeBodyPath = '';
        await preparedInclude.cleanup();
    }

    if (result.error) {
        console.error('PDF rendering requires pandoc on PATH. Install pandoc and a LaTeX engine, or use export-md and compile the generated Markdown yourself.');
        console.error(String(result.error.message || result.error));
        process.exitCode = 1;
        return false;
    }

    if (result.status !== 0) {
        if (result.stdout) console.error(result.stdout.trim());
        if (result.stderr) console.error(result.stderr.trim());
        process.exitCode = result.status || 1;
        return false;
    }

    return true;
}

async function exportPdf(args = []) {
    const config = await readConfigIfExists();
    const options = parseExportArgs(args, '.math-workspace/export.pdf', config);
    if (options.paths.length === 0) {
        console.error('Usage: npm run workspace -- export-pdf <file-or-dir> [...] --out <book.pdf> [--md-out compiled.md] [--pdf-engine xelatex] [--no-toc] [--toc-depth N] [--margin 2.5cm] [--paper a4] [--lang zh-CN] [--toc-title 目录] [--title-page] [--release-version rc.1] [--release-tag v1] [--release-commit abc123] [--doi DOI] [--metadata-page] [--front-matter page.md] [--front-matter-title Title] [--front-matter-toc] [--author-native Name] [--author-alias Alias] [--orcid URL] [--repository URL] [--license Name] [--license-url URL] [--preferred-citation Text] [--show-version-on-cover] [--cover-style simple] [--title-size 32pt] [-V key:value] [--variable key:value] [--keep-md]');
        process.exitCode = 1;
        return;
    }

    const pdfPath = path.resolve(ROOT, options.output);
    const mdPath = path.resolve(ROOT, options.mdOutput || `${options.output.replace(/\.pdf$/i, '')}.compiled.md`);
    const mdArgs = [...options.paths, '--out', relativePath(mdPath)];
    const compiledPath = await exportMarkdown(mdArgs);
    if (!compiledPath || process.exitCode) return;

    const rendered = await renderPdfFile(compiledPath, pdfPath, options);
    if (!rendered) return;

    if (!options.keepMarkdown && !options.mdOutput) {
        await fs.rm(compiledPath, { force: true });
    }
    console.log(`OK export-pdf: ${relativePath(pdfPath)} (${pdfLayoutSummary(options)})`);
}

async function renderPdf(args = []) {
    const config = await readConfigIfExists();
    const options = parseExportArgs(args, '.math-workspace/render.pdf', config);
    if (options.paths.length !== 1) {
        console.error('Usage: npm run workspace -- render-pdf <compiled.md> --out <book.pdf> [--pdf-engine xelatex] [--no-toc] [--toc-depth N] [--margin 2.5cm] [--paper a4] [--lang zh-CN] [--toc-title 目录] [--title-page] [--release-version rc.1] [--release-tag v1] [--release-commit abc123] [--doi DOI] [--metadata-page] [--front-matter page.md] [--front-matter-title Title] [--front-matter-toc] [--author-native Name] [--author-alias Alias] [--orcid URL] [--repository URL] [--license Name] [--license-url URL] [--preferred-citation Text] [--show-version-on-cover] [--cover-style simple] [--title-size 32pt] [-V key:value] [--variable key:value]');
        process.exitCode = 1;
        return;
    }

    const inputMarkdownPath = path.resolve(ROOT, options.paths[0]);
    const pdfPath = path.resolve(ROOT, options.output);
    const rendered = await renderPdfFile(inputMarkdownPath, pdfPath, options);
    if (!rendered) return;
    console.log(`OK render-pdf: ${relativePath(inputMarkdownPath)} -> ${relativePath(pdfPath)} (${pdfLayoutSummary(options)})`);
}

async function resolveInputMarkdownFiles(inputs, config) {
    const result = new Set();
    for (const input of inputs) {
        const full = path.resolve(ROOT, input);
        const relative = relativePath(full);
        if (shouldExcludeScanPath(relative, config)) continue;
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
            const files = await collectMarkdownFiles(config, full, []);
            files.forEach(file => result.add(file));
        } else if (stat.isFile() && full.toLowerCase().endsWith('.md')) {
            result.add(full);
        }
    }
    return [...result].sort((a, b) => relativePath(a).localeCompare(relativePath(b)));
}

async function migrateIds(args) {
    const options = parseMigrationArgs(args);
    const apply = options.apply;
    const dryRun = options.dryRun;
    if (!options.all && options.paths.length === 0) {
        console.error('Usage: npm run workspace -- migrate-ids <file-or-dir> [...] [--apply] [--target-only]');
        console.error('       npm run workspace -- migrate-ids --all [--apply]');
        process.exitCode = 1;
        return;
    }

    const state = await scanWorkspace();
    const allFiles = await collectMarkdownFiles(state.config);
    const targetFiles = options.all ? allFiles : await resolveInputMarkdownFiles(options.paths, state.config);
    const rewriteFiles = migrationRewriteFiles(options, allFiles, targetFiles);
    const targetFileSet = new Set(targetFiles.map(relativePath));
    const idsToMigrate = state.definitions
        .filter(def => targetFileSet.has(def.file))
        .map(def => def.id)
        .filter(id => typeof id === 'string' && !HASH_ID_RE.test(id) && !TMP_ID_RE.test(id));
    const uniqueIds = [...new Set(idsToMigrate)].sort();

    if (uniqueIds.length === 0) {
        console.log('OK migrate-ids: no non-hash ids found');
        return;
    }

    const existingIds = new Set(Object.keys(state.labels));
    const mapping = new Map();
    for (const id of uniqueIds) {
        let newId;
        do {
            newId = `h-${crypto.randomBytes(8).toString('hex')}`;
        } while (existingIds.has(newId));
        existingIds.add(newId);
        mapping.set(id, newId);
    }

    console.log(`${dryRun ? 'DRY-RUN' : 'APPLY'} migrate-ids: ${mapping.size} ids`);
    for (const [oldId, newId] of mapping) {
        console.log(`${oldId} -> ${newId}`);
    }

    const migratedIdSet = new Set(uniqueIds);
    const outsideRefs = state.references.filter(ref => migratedIdSet.has(ref.id) && !targetFileSet.has(ref.file));
    if (outsideRefs.length > 0 && !options.all && options.targetOnly) {
        console.warn(`Scoped migrate-ids found ${outsideRefs.length} references outside the target scope.`);
        printReferenceSamples(outsideRefs);
        if (apply) {
            console.error('Refusing to apply because those outside references would point to removed IDs.');
            console.error('Omit --target-only to update incoming references, or choose a closed chapter/volume scope.');
            process.exitCode = 1;
            return;
        }
    } else if (outsideRefs.length > 0 && !options.all) {
        console.log(`Incoming references outside target scope will be updated: ${outsideRefs.length}`);
    }

    if (!apply) return;

    let changedFiles = 0;
    for (const filePath of rewriteFiles) {
        const original = await fs.readFile(filePath, 'utf8');
        const updated = rewriteFormalIds(original, mapping, {
            rewriteDefinitions: targetFileSet.has(relativePath(filePath))
        });
        if (updated !== original) {
            await fs.writeFile(filePath, updated, 'utf8');
            changedFiles++;
        }
    }

    console.log(`Updated ${changedFiles} files.`);
    if (!options.all) {
        const scopeText = options.targetOnly
            ? 'target files only'
            : 'target numbered markers, all incoming references';
        console.log(`Scope: ${scopeText}. Run on later chapters/volumes as you migrate them.`);
    }
    await prepare({ exitOnError: true });
}

function printReferenceSamples(references, limit = 5) {
    for (const ref of references.slice(0, limit)) {
        console.log(`  ${ref.file}:${ref.line} @${ref.id}`);
    }
    if (references.length > limit) {
        console.log(`  ... ${references.length - limit} more`);
    }
}

function parseMigrationArgs(args) {
    return {
        apply: args.includes('--apply'),
        dryRun: args.includes('--dry-run') || !args.includes('--apply'),
        all: args.includes('--all'),
        targetOnly: args.includes('--target-only'),
        paths: args.filter(arg => !arg.startsWith('--'))
    };
}

function migrationRewriteFiles(options, allFiles, targetFiles) {
    return options.all || !options.targetOnly ? allFiles : targetFiles;
}

function migrationReferenceScope(options) {
    if (options.all) return 'all files';
    return options.targetOnly ? 'target files only' : 'target files plus incoming refs across all files';
}

const TEXT_REF_NUMBER = '[A-Z]+(?:[.．]\\d+)+|\\d+(?:[.．]\\d+)+';

function normalizeReferenceNumber(value) {
    return value.replace(/．/g, '.');
}

function pushAlias(byAlias, alias, def) {
    const key = normalizeTextReferenceAlias(alias);
    if (!byAlias.has(key)) byAlias.set(key, []);
    const defs = byAlias.get(key);
    if (!defs.some(existing => existing.id === def.id)) defs.push(def);
}

function numberedReferenceAliases(def, config) {
    const number = displayNumber(def);
    if (!number) return [];

    const aliases = [];
    const zhTypes = {
        theorem: '定理',
        lemma: '引理',
        prop: '命题',
        cor: '推论',
        remark: '注',
        example: '例',
        section: '节',
        equation: '公式',
        figure: '图',
        table: '表'
    };
    const enTypes = {
        theorem: 'Theorem',
        lemma: 'Lemma',
        prop: 'Proposition',
        cor: 'Corollary',
        remark: 'Remark',
        example: 'Example',
        section: 'Section',
        equation: 'Equation',
        figure: 'Figure',
        table: 'Table'
    };
    const shortEnTypes = {
        theorem: 'Thm.',
        lemma: 'Lem.',
        prop: 'Prop.',
        cor: 'Cor.',
        remark: 'Rem.',
        example: 'Ex.',
        section: 'Sec.',
        equation: 'Eq.',
        figure: 'Fig.',
        table: 'Tab.'
    };
    const shortEnNoDotTypes = {
        theorem: 'Thm',
        lemma: 'Lem',
        prop: 'Prop',
        cor: 'Cor',
        remark: 'Rem',
        example: 'Ex',
        section: 'Sec',
        equation: 'Eq',
        figure: 'Fig',
        table: 'Tab'
    };

    const zh = zhTypes[def.type];
    if (zh) {
        aliases.push(`${zh}${number}`, `${zh} ${number}`);
        if (def.type === 'equation') {
            aliases.push(`${zh}(${number})`, `${zh} (${number})`, `${zh}（${number}）`);
        }
    }

    const en = enTypes[def.type];
    if (en) {
        aliases.push(`${en} ${number}`);
        if (def.type === 'equation') {
            aliases.push(`${en} (${number})`);
        }
    }

    const shortEn = shortEnTypes[def.type];
    if (shortEn) {
        aliases.push(`${shortEn} ${number}`);
        if (def.type === 'equation') {
            aliases.push(`${shortEn} (${number})`);
        }
    }

    const shortEnNoDot = shortEnNoDotTypes[def.type];
    if (shortEnNoDot) {
        aliases.push(`${shortEnNoDot} ${number}`);
        if (def.type === 'equation') {
            aliases.push(`${shortEnNoDot} (${number})`);
        }
    }

    if (def.type === 'section') {
        aliases.push(
            `§ ${number}`,
            `§${number}`,
            `${number}节`,
            `${number} 节`,
            `第${number}节`,
            `第 ${number} 节`,
            `节${number}`,
            `节 ${number}`,
            `小节${number}`,
            `小节 ${number}`,
            `章节${number}`,
            `章节 ${number}`
        );
    }

    // Honor custom dictionary labels as aliases when they are numbered.
    const configuredName = typeName(config, def.type);
    if (configuredName && configuredName !== zh && configuredName !== en) {
        aliases.push(`${configuredName}${number}`, `${configuredName} ${number}`);
        if (def.type === 'equation') {
            aliases.push(`${configuredName}(${number})`, `${configuredName} (${number})`, `${configuredName}（${number}）`);
        }
    }

    return unique(aliases);
}

function buildTextReferenceIndex(definitions, config) {
    const byAlias = new Map();

    for (const def of definitions) {
        for (const alias of numberedReferenceAliases(def, config)) {
            pushAlias(byAlias, alias, def);
        }
    }

    return byAlias;
}

function normalizeTextReferenceAlias(value) {
    const alias = value.trim().replace(/．/g, '.').replace(/\s+/g, ' ');
    const number = `(${TEXT_REF_NUMBER.replace(/．/g, '.')})`;
    const cjk = alias.match(new RegExp(`^(定理|引理|命题|推论|注|例|公式|方程|图|表)\\s*[（(]?${number}[）)]?$`));
    if (cjk) return `${cjk[1]}${normalizeReferenceNumber(cjk[2])}`;
    const enTyped = alias.match(new RegExp(`^(Theorem|Lemma|Proposition|Corollary|Remark|Example|Equation|Formula|Figure|Table|Thm\\.?|Lem\\.?|Prop\\.?|Cor\\.?|Rem\\.?|Ex\\.?|Eq\\.?|Fig\\.?|Tab\\.?)\\s*[（(]?${number}[）)]?$`, 'i'));
    if (enTyped) return `${enTyped[1].replace(/\s+/g, ' ')} ${normalizeReferenceNumber(enTyped[2])}`;
    const cjkSectionPrefix = alias.match(new RegExp(`^第\\s*${number}\\s*节$`));
    if (cjkSectionPrefix) return `§${normalizeReferenceNumber(cjkSectionPrefix[1])}`;
    const cjkSectionName = alias.match(new RegExp(`^(?:节|小节|章节)\\s*${number}$`));
    if (cjkSectionName) return `§${normalizeReferenceNumber(cjkSectionName[1])}`;
    const cjkSectionSuffix = alias.match(new RegExp(`^${number}\\s*节$`));
    if (cjkSectionSuffix) return `§${normalizeReferenceNumber(cjkSectionSuffix[1])}`;
    const sectionSymbol = alias.match(new RegExp(`^§\\s*${number}$`));
    if (sectionSymbol) return `§${normalizeReferenceNumber(sectionSymbol[1])}`;
    return alias;
}

function makeTextReferencePattern(config) {
    const configuredTypes = ['prop', 'lemma', 'theorem', 'cor', 'section', 'equation', 'figure', 'table']
        .map(type => typeName(config, type))
        .filter(name => name && name !== '§');
    const typeWords = unique([
        '定理',
        '引理',
        '命题',
        '推论',
        '公式',
        '方程',
        '图',
        '表',
        '节',
        'Theorem',
        'Lemma',
        'Proposition',
        'Corollary',
        'Remark',
        'Example',
        'Equation',
        'Formula',
        'Figure',
        'Table',
        'Section',
        'Thm\\.',
        'Thm',
        'Lem\\.',
        'Lem',
        'Prop\\.',
        'Prop',
        'Cor\\.',
        'Cor',
        'Rem\\.',
        'Rem',
        'Ex\\.',
        'Ex',
        'Eq\\.',
        'Eq',
        'Fig\\.',
        'Fig',
        'Tab\\.',
        'Tab',
        'Sec\\.',
        'Sec',
        ...configuredTypes.map(escapeRegExp)
    ]).join('|');
    const typedNumber = `[（(]?(?:${TEXT_REF_NUMBER})[）)]?`;
    const alternatives = [
        `(?:(?:${typeWords})\\s*${typedNumber})`,
        `(?:§\\s*(?:${TEXT_REF_NUMBER}))`,
        `(?:(?:${TEXT_REF_NUMBER})\\s*节)`,
        `(?:第\\s*(?:${TEXT_REF_NUMBER})\\s*节)`,
        `(?:(?:小节|章节)\\s*(?:${TEXT_REF_NUMBER}))`
    ].filter(Boolean).join('|');
    return new RegExp(`(^|[^@#A-Za-z0-9_])(${alternatives})(?![A-Za-z0-9_-]|\\.\\d)`, 'g');
}

function describeTextReference(alias, byAlias) {
    const defs = byAlias.get(normalizeTextReferenceAlias(alias)) || [];
    if (defs.length === 1) {
        const def = defs[0];
        return {
            status: 'resolved',
            id: def.id,
            title: def.title,
            display: displayLabel(def, { language: 'zh', dictionary: DEFAULT_CONFIG.dictionary })
        };
    }
    if (defs.length > 1) {
        return {
            status: 'ambiguous',
            candidates: defs.map(def => ({
                id: def.id,
                display: displayLabel(def, { language: 'zh', dictionary: DEFAULT_CONFIG.dictionary }),
                title: def.title,
                file: def.file,
                line: def.line
            }))
        };
    }
    return { status: 'unresolved' };
}

function splitProtectedInlineSegments(line) {
    const segments = [];
    const re = /(`[^`]*`|\[[^\]\n]+\]\([^\)\n]*\))/g;
    let lastIndex = 0;
    let match;
    while ((match = re.exec(line))) {
        if (match.index > lastIndex) {
            segments.push({ text: line.slice(lastIndex, match.index), kind: 'text' });
        }
        segments.push({
            text: match[0],
            kind: match[0].startsWith('`') ? 'code' : 'link'
        });
        lastIndex = re.lastIndex;
    }
    if (lastIndex < line.length) {
        segments.push({ text: line.slice(lastIndex), kind: 'text' });
    }
    return segments;
}

function collectLinkedTextReferences(segment, pattern, byAlias, file, lineNumber, linkedReferences, options: any = {}) {
    const match = segment.match(/^\[([^\]\n]+)\]\(([^\)\n]*)\)$/);
    if (!match) return;

    const label = match[1];
    pattern.lastIndex = 0;
    let refMatch;
    while ((refMatch = pattern.exec(label))) {
        const alias = refMatch[2];
        const description = describeTextReference(alias, byAlias);
        if (description.status === 'unresolved' && options.recordUnresolved === false) continue;
        linkedReferences.push({
            file,
            line: lineNumber,
            text: alias,
            link: segment,
            ...description
        });
    }
    pattern.lastIndex = 0;
}

function rewriteTextReferenceLine(line, pattern, byAlias, file, lineNumber, replacements, unresolved, ambiguous, linkedReferences, options: any = {}) {
    const parts = splitProtectedInlineSegments(line);
    let changed = false;

    const updated = parts.map(part => {
        if (part.kind === 'code') return part.text;
        if (part.kind === 'link') {
            collectLinkedTextReferences(part.text, pattern, byAlias, file, lineNumber, linkedReferences, options);
            return part.text;
        }

        return part.text.replace(pattern, (match, prefix, alias) => {
            const defs = byAlias.get(normalizeTextReferenceAlias(alias)) || [];
            if (defs.length === 1) {
                const def = defs[0];
                replacements.push({
                    file,
                    line: lineNumber,
                    from: alias,
                    to: `@${def.id}`,
                    id: def.id,
                    title: def.title
                });
                changed = true;
                return `${prefix}@${def.id}`;
            }

            const record = { file, line: lineNumber, text: alias };
            if (defs.length > 1) {
                ambiguous.push({
                    ...record,
                    candidates: defs.map(def => ({
                        id: def.id,
                        display: displayLabel(def, { language: 'zh', dictionary: DEFAULT_CONFIG.dictionary }),
                        title: def.title,
                        file: def.file,
                        line: def.line
                    }))
                });
            } else if (options.recordUnresolved !== false) {
                unresolved.push(record);
            }
            return match;
        });
    }).join('');

    return { line: updated, changed };
}

function findAuditPageTitleHeadingLine(content) {
    const headings = [];
    const lines = String(content || '').split(/\r?\n/);
    let inFence = false;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;

        const match = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)\s*$/);
        if (!match) continue;

        const title = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
        if (!title) continue;

        headings.push({
            level: match[1].length,
            line: index + 1,
            formalMarker: /^#[A-Za-z0-9_-]+\b/.test(title)
        });
    }

    if (headings.length === 0) return undefined;

    const topLevel = Math.min(...headings.map(heading => heading.level));
    const topHeadings = headings.filter(heading => heading.level === topLevel);
    if (topHeadings.length !== 1 || topHeadings[0].formalMarker) return undefined;
    return topHeadings[0].line;
}

function collectSectionHeadingAudit(line, file, lineNumber, sectionHeadings, pageTitleHeadingLine) {
    const match = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (!match) return;
    if (lineNumber === pageTitleHeadingLine) return;

    const rawTitle = match[2].replace(/\s*\{#[^}]+\}\s*$/, '').trim();
    if (!rawTitle) return;
    if (/^#[A-Za-z0-9_-]+\b/.test(rawTitle)) return;

    sectionHeadings.push({
        file,
        line: lineNumber,
        level: match[1].length,
        title: rawTitle,
        text: line.trim()
    });
}

function rewriteTextReferences(content, file, pattern, byAlias, options: any = {}) {
    const lines = content.split(/\r?\n/);
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const replacements = [];
    const unresolved = [];
    const ambiguous = [];
    const linkedReferences = [];
    const sectionHeadings = [];
    const pageTitleHeadingLine = findAuditPageTitleHeadingLine(content);
    let inFence = false;
    let changed = false;

    const updatedLines = lines.map((line, index) => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;

        if (options.auditStructure !== false) {
            collectSectionHeadingAudit(line, file, index + 1, sectionHeadings, pageTitleHeadingLine);
        }

        const result = rewriteTextReferenceLine(
            line,
            pattern,
            byAlias,
            file,
            index + 1,
            replacements,
            unresolved,
            ambiguous,
            linkedReferences,
            options
        );
        if (result.changed) changed = true;
        return result.line;
    });

    return {
        content: updatedLines.join(eol),
        changed,
        replacements,
        unresolved,
        ambiguous,
        linkedReferences,
        sectionHeadings
    };
}

function renderTextReferenceMigrationReport(result) {
    const lines = [
        '# Text Reference Migration',
        '',
        `Mode: ${result.apply ? 'apply' : 'dry-run'}`,
        `Reference scope: ${result.referenceScope}`,
        `Target files: ${result.definitionFiles}`,
        `Numbered entries in scope: ${result.definitionsInScope}`,
        `Files scanned: ${result.files}`,
        `Replacements: ${result.replacements.length}`,
        `Unresolved: ${result.unresolved.length}`,
        `Ambiguous: ${result.ambiguous.length}`,
        `Markdown links needing manual rewrite: ${result.linkedReferences.length}`,
        `Section headings needing numbered markers: ${result.sectionHeadings.length}`,
        ''
    ];

    if (result.replacements.length > 0) {
        lines.push('## Replacements', '');
        result.replacements.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.from} -> @${item.id} (${item.title || 'untitled'})`);
        });
        lines.push('');
    }

    if (result.unresolved.length > 0) {
        lines.push('## Unresolved', '');
        result.unresolved.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.text}`);
        });
        lines.push('');
    }

    if (result.ambiguous.length > 0) {
        lines.push('## Ambiguous', '');
        result.ambiguous.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.text}`);
            item.candidates.forEach(candidate => {
                lines.push(`  - ${candidate.id} ${candidate.title || 'untitled'} (${candidate.file}:${candidate.line})`);
            });
        });
        lines.push('');
    }

    if (result.linkedReferences.length > 0) {
        lines.push('## Markdown Links Needing Manual Rewrite', '');
        lines.push('Inline formal refs render as links already. Do not put `@h-...` inside an existing Markdown link label; replace the whole old link after checking the target.', '');
        result.linkedReferences.forEach(item => {
            const suffix = item.status === 'resolved' ? `; suggested @${item.id} (${item.title || item.display || 'untitled'})` : `; ${item.status}`;
            lines.push(`- ${item.file}:${item.line}: ${item.link} contains ${item.text}${suffix}`);
            if (item.candidates) {
                item.candidates.forEach(candidate => {
                    lines.push(`  - ${candidate.id} ${candidate.title || 'untitled'} (${candidate.file}:${candidate.line})`);
                });
            }
        });
        lines.push('');
    }

    if (result.sectionHeadings.length > 0) {
        lines.push('## Section Headings Needing Numbered Markers', '');
        lines.push('Plain Markdown headings are navigable as prose, but they are not stable numbered anchors. For referenced sections, write the heading as `## #tmp-* Title` and run `finish`.', '');
        result.sectionHeadings.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.text}`);
        });
        lines.push('');
    }

    return `${lines.join('\n')}\n`;
}

function splitAuditTextSegments(line) {
    const segments = [];
    const re = /(`[^`]*`|\[[^\]\n]+\]\([^\)\n]*\)|\$[^$\n]+\$|\\\([\s\S]*?\\\))/g;
    let lastIndex = 0;
    let match;
    while ((match = re.exec(line))) {
        if (match.index > lastIndex) {
            segments.push({ text: line.slice(lastIndex, match.index), offset: lastIndex });
        }
        lastIndex = re.lastIndex;
    }
    if (lastIndex < line.length) {
        segments.push({ text: line.slice(lastIndex), offset: lastIndex });
    }
    return segments;
}

function hasBareReferenceCue(before, after) {
    const left = before.slice(-24);
    const right = after.slice(0, 24);
    return /(由|见|参见|参考|根据|结合|利用|推出|得到|可得|来自|遵循|see|by|from|using|as|in)\s*$/i.test(left)
        || /^\s*(可得|推出|得到|给出|implies|gives|shows|follows)/i.test(right);
}

function isTypedNumberContext(before, after) {
    return /(定理|引理|命题|推论|注|例|公式|方程|图|表|Theorem|Lemma|Proposition|Corollary|Remark|Example|Equation|Formula|Figure|Table|Thm\.?|Lem\.?|Prop\.?|Cor\.?|Rem\.?|Ex\.?|Eq\.?|Fig\.?|Tab\.?|§|第)\s*$/i.test(before)
        || /^\s*节/.test(after);
}

function collectBareNumberCandidates(content, file) {
    const candidates = [];
    const lines = content.split(/\r?\n/);
    const numberRe = /(^|[^@#A-Za-z0-9_])(\(?[A-Z]?(?:\d+|[A-Z])(?:[.．]\d+)+\)?)(?![A-Za-z0-9_-]|[.．]\d)/g;
    let inFence = false;

    lines.forEach((line, index) => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return;
        }
        if (inFence) return;

        for (const segment of splitAuditTextSegments(line)) {
            numberRe.lastIndex = 0;
            let match;
            while ((match = numberRe.exec(segment.text))) {
                const localStart = match.index + match[1].length;
                const start = segment.offset + localStart;
                const end = start + match[2].length;
                const before = line.slice(0, start);
                const after = line.slice(end);
                if (isTypedNumberContext(before, after)) continue;
                if (!hasBareReferenceCue(before, after)) continue;
                candidates.push({
                    code: 'bare-number-candidate',
                    file,
                    line: index + 1,
                    text: match[2],
                    context: line.trim()
                });
            }
        }
    });

    return candidates;
}

function chapterReferenceNumber(text) {
    const zh = String(text).match(/^第\s*(\d+)\s*章$/);
    if (zh) return Number(zh[1]);
    const en = String(text).match(/^Chapter\s+(\d+)$/i);
    if (en) return Number(en[1]);
    return undefined;
}

function describeChapterReference(text, file, pages) {
    const number = chapterReferenceNumber(text);
    if (!number) return { status: 'unresolved' };

    const sourcePage = pages.find(page => page.filePath === file);
    const candidates = pages.filter(page => (
        page.kind === 'chapter'
        && page.chapter === number
        && (!sourcePage?.bookKey || page.bookKey === sourcePage.bookKey)
    ));

    if (candidates.length === 1) {
        const target = candidates[0];
        return {
            status: 'resolved',
            target: target.filePath,
            ref: target.id ? `@${target.id}` : `@chapter:${target.filePath}`
        };
    }
    return { status: candidates.length > 1 ? 'ambiguous' : 'unresolved' };
}

function collectChapterReferenceCandidates(content, file, pages) {
    const candidates = [];
    const lines = content.split(/\r?\n/);
    const chapterRe = /(^|[^@#A-Za-z0-9_])((?:第\s*\d+\s*章)|(?:Chapter\s+\d+))(?![A-Za-z0-9_-])/gi;
    let inFence = false;

    lines.forEach((line, index) => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return;
        }
        if (inFence || /^#{1,6}\s+/.test(line)) return;

        for (const segment of splitAuditTextSegments(line)) {
            chapterRe.lastIndex = 0;
            let match;
            while ((match = chapterRe.exec(segment.text))) {
                candidates.push({
                    code: 'chapter-ref-candidate',
                    file,
                    line: index + 1,
                    text: match[2],
                    ...describeChapterReference(match[2], file, pages)
                });
            }
        }
    });

    return candidates;
}

function normalizeAuditProofLine(line) {
    return line
        .trim()
        .replace(/^>\s*/, '')
        .replace(/^\s*[-+*]\s+/, '')
        .replace(/^\*\*(.+?)\*\*/, '$1')
        .replace(/^__(.+?)__/, '$1')
        .replace(/^\*(.+?)\*/, '$1')
        .replace(/^_(.+?)_/, '$1')
        .trim();
}

function isAuditProofBoundary(line) {
    const text = normalizeAuditProofLine(line);
    return /^(?:证明(?:概要|草图|思路|如下|在此略去)?|Proof(?:\s+sketch)?|Sketch of proof)\s*(?:[：:。.．.]|$|\s)/i.test(text);
}

function isAuditBlockBoundary(line) {
    return /^#{1,6}\s+/.test(line) || !!parseFormalMarkerLine(line);
}

function collectMissingProofBoundaries(content, file) {
    const findings = [];
    const theoremTypes = new Set(['prop', 'lemma', 'theorem', 'cor']);
    const lines = content.split(/\r?\n/);
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;

        const marker = parseFormalMarkerLine(line);
        if (!marker || !theoremTypes.has(marker.type)) continue;

        let hasProof = false;
        for (let j = i + 1; j < lines.length; j++) {
            if (isAuditProofBoundary(lines[j])) {
                hasProof = true;
                break;
            }
            if (isAuditBlockBoundary(lines[j])) break;
        }

        if (!hasProof) {
            findings.push({
                code: 'missing-proof-boundary',
                file,
                line: i + 1,
                text: marker.markerText,
                title: marker.title || ''
            });
        }
    }

    return findings;
}

function collectUnusedOptionalBlocks(state, targetFileSet) {
    const referencedIds = new Set(state.references.map(ref => ref.id));
    return state.definitions
        .filter(def => def.id && def.type === 'example')
        .filter(def => targetFileSet.has(def.file))
        .filter(def => !referencedIds.has(def.id))
        .map(def => ({
            code: 'unused-optional-block-hash',
            file: def.file,
            line: def.line,
            id: def.id,
            display: displayLabel(def, state.config),
            title: def.title || ''
        }));
}

function escapeAuditText(value) {
    return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderAuditReport(result) {
    const lines = [
        '# math-workspace Audit',
        '',
        'Generated by `npm run workspace -- audit`. This report is advisory and does not affect `verify`.',
        '',
        `Scope: ${result.scope}`,
        `Files scanned: ${result.files}`,
        `Typed old references: ${result.replacements.length + result.unresolved.length + result.ambiguous.length}`,
        `Markdown links needing manual rewrite: ${result.linkedReferences.length}`,
        `Chapter references needing page refs: ${result.chapterReferences.length}`,
        `Section headings needing numbered markers: ${result.sectionHeadings.length}`,
        `Bare number candidates: ${result.bareNumberCandidates.length}`,
        `Unused optional example hashes: ${result.unusedOptionalBlocks.length}`,
        `Theorem-like blocks without proof boundary: ${result.missingProofBoundaries.length}`,
        ''
    ];

    if (result.replacements.length > 0) {
        lines.push('## Typed Old References', '');
        lines.push('These can usually be migrated to `@h-...`.', '');
        result.replacements.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.from} -> @${item.id} (${item.title || 'untitled'})`);
        });
        lines.push('');
    }

    if (result.unresolved.length > 0) {
        lines.push('## Unresolved Typed References', '');
        result.unresolved.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.text}`);
        });
        lines.push('');
    }

    if (result.ambiguous.length > 0) {
        lines.push('## Ambiguous Typed References', '');
        result.ambiguous.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.text}`);
            item.candidates.forEach(candidate => {
                lines.push(`  - ${candidate.id} ${candidate.title || 'untitled'} (${candidate.file}:${candidate.line})`);
            });
        });
        lines.push('');
    }

    if (result.linkedReferences.length > 0) {
        lines.push('## Markdown Links Needing Manual Rewrite', '');
        result.linkedReferences.forEach(item => {
            const suffix = item.status === 'resolved' ? `; suggested @${item.id} (${item.title || item.display || 'untitled'})` : `; ${item.status}`;
            lines.push(`- ${item.file}:${item.line}: ${item.link} contains ${item.text}${suffix}`);
        });
        lines.push('');
    }

    if (result.chapterReferences.length > 0) {
        lines.push('## Chapter References Needing Page Refs', '');
        lines.push('Use a page hash such as `@h-...` when available; otherwise use compatibility `@chapter:<formal-root-relative-path>` instead of handwritten chapter numbers.', '');
        result.chapterReferences.forEach(item => {
            const suffix = item.ref
                ? `; suggested ${item.ref}`
                : `; ${item.status}`;
            lines.push(`- ${item.file}:${item.line}: ${item.text}${suffix}`);
        });
        lines.push('');
    }

    if (result.sectionHeadings.length > 0) {
        lines.push('## Section Headings Needing Numbered Markers', '');
        result.sectionHeadings.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.text}`);
        });
        lines.push('');
    }

    if (result.bareNumberCandidates.length > 0) {
        lines.push('## Bare Number Candidates', '');
        lines.push('These are only heuristics. Read the sentence before converting anything.', '');
        result.bareNumberCandidates.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.text} in "${escapeAuditText(item.context)}"`);
        });
        lines.push('');
    }

    if (result.unusedOptionalBlocks.length > 0) {
        lines.push('## Unused Optional Example Hashes', '');
        lines.push('Examples usually stay plain unless later text cites them. Anchored fact remarks may be intentionally unnumbered and are not reported here.', '');
        result.unusedOptionalBlocks.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.display} \`${item.id}\`${item.title ? ` (${escapeAuditText(item.title)})` : ''}`);
        });
        lines.push('');
    }

    if (result.missingProofBoundaries.length > 0) {
        lines.push('## Theorem-Like Blocks Without Proof Boundary', '');
        lines.push('This is advisory. Add `证明` / `Proof` when the block has a proof and recall should stop before it.', '');
        result.missingProofBoundaries.forEach(item => {
            lines.push(`- ${item.file}:${item.line}: ${item.text}${item.title ? ` (${escapeAuditText(item.title)})` : ''}`);
        });
        lines.push('');
    }

    if (lines[lines.length - 1] !== '') lines.push('');
    if ([
        result.replacements,
        result.unresolved,
        result.ambiguous,
        result.linkedReferences,
        result.chapterReferences,
        result.sectionHeadings,
        result.bareNumberCandidates,
        result.unusedOptionalBlocks,
        result.missingProofBoundaries
    ].every(items => items.length === 0)) {
        lines.push('No audit findings.', '');
    }

    return `${lines.join('\n')}\n`;
}

async function audit(args) {
    const state = await scanWorkspace();
    await writeArtifacts(state);

    const allFiles = await collectMarkdownFiles(state.config);
    const targetFiles = args.length > 0 ? await resolveInputMarkdownFiles(args, state.config) : allFiles;
    const targetFileSet = new Set(targetFiles.map(relativePath));
    const byAlias = buildTextReferenceIndex(state.definitions, state.config);
    const pattern = makeTextReferencePattern(state.config);
    const result = {
        scope: args.length > 0 ? args.join(', ') : 'workspace',
        files: targetFiles.length,
        replacements: [],
        unresolved: [],
        ambiguous: [],
        linkedReferences: [],
        chapterReferences: [],
        sectionHeadings: [],
        bareNumberCandidates: [],
        unusedOptionalBlocks: collectUnusedOptionalBlocks(state, targetFileSet),
        missingProofBoundaries: []
    };

    for (const fullPath of targetFiles) {
        const file = relativePath(fullPath);
        const original = await fs.readFile(fullPath, 'utf8');
        const rewritten = rewriteTextReferences(original, file, pattern, byAlias);
        result.replacements.push(...rewritten.replacements);
        result.unresolved.push(...rewritten.unresolved);
        result.ambiguous.push(...rewritten.ambiguous);
        result.linkedReferences.push(...rewritten.linkedReferences);
        result.chapterReferences.push(...collectChapterReferenceCandidates(original, file, state.pages));
        result.sectionHeadings.push(...rewritten.sectionHeadings);
        result.bareNumberCandidates.push(...collectBareNumberCandidates(original, file));
        result.missingProofBoundaries.push(...collectMissingProofBoundaries(original, file));
    }

    await ensureCacheDir();
    await fs.writeFile(path.join(CACHE_DIR, 'audit.md'), renderAuditReport(result), 'utf8');

    const findingCount = result.replacements.length
        + result.unresolved.length
        + result.ambiguous.length
        + result.linkedReferences.length
        + result.chapterReferences.length
        + result.sectionHeadings.length
        + result.bareNumberCandidates.length
        + result.unusedOptionalBlocks.length
        + result.missingProofBoundaries.length;
    const status = findingCount > 0 ? 'WARN' : 'OK';
    console.log(`${status} audit: ${findingCount} findings across ${targetFiles.length} files`);
    console.log('Report: .math-workspace/audit.md');
}

async function migrateTextRefs(args) {
    const options = parseMigrationArgs(args);
    if (!options.all && options.paths.length === 0) {
        console.error('Usage: npm run workspace -- migrate-text-refs <file-or-dir> [...] [--apply] [--target-only]');
        console.error('       npm run workspace -- migrate-text-refs --all [--apply]');
        process.exitCode = 1;
        return;
    }

    const state = await scanWorkspace();
    await writeArtifacts(state);
    const byAlias = buildTextReferenceIndex(state.definitions, state.config);
    if (byAlias.size === 0) {
        console.log('OK migrate-text-refs: no numbered formal entries found');
        return;
    }
    const pattern = makeTextReferencePattern(state.config);

    const allFiles = await collectMarkdownFiles(state.config);
    const targetFiles = options.all ? allFiles : await resolveInputMarkdownFiles(options.paths, state.config);
    const targetFileSet = new Set(targetFiles.map(relativePath));
    const targetDefinitions = options.all
        ? state.definitions
        : state.definitions.filter(def => targetFileSet.has(def.file));
    const targetNumberedEntries = targetDefinitions.filter(displayNumber);
    const targetByAlias = buildTextReferenceIndex(targetDefinitions, state.config);
    const rewriteFiles = migrationRewriteFiles(options, allFiles, targetFiles);
    const result = {
        apply: options.apply,
        referenceScope: migrationReferenceScope(options),
        definitionFiles: targetFiles.length,
        definitionsInScope: targetNumberedEntries.length,
        files: rewriteFiles.length,
        replacements: [],
        unresolved: [],
        ambiguous: [],
        linkedReferences: [],
        sectionHeadings: []
    };

    let changedFiles = 0;
    for (const fullPath of rewriteFiles) {
        const file = relativePath(fullPath);
        const original = await fs.readFile(fullPath, 'utf8');
        const isTargetFile = targetFileSet.has(file);
        const rewritten = rewriteTextReferences(
            original,
            file,
            pattern,
            isTargetFile ? byAlias : targetByAlias,
            isTargetFile
                ? {}
                : { recordUnresolved: false, auditStructure: false }
        );
        result.replacements.push(...rewritten.replacements);
        result.unresolved.push(...rewritten.unresolved);
        result.ambiguous.push(...rewritten.ambiguous);
        result.linkedReferences.push(...rewritten.linkedReferences);
        result.sectionHeadings.push(...rewritten.sectionHeadings);
        if (options.apply && rewritten.changed) {
            await fs.writeFile(fullPath, rewritten.content, 'utf8');
            changedFiles++;
        }
    }

    await ensureCacheDir();
    await fs.writeFile(path.join(CACHE_DIR, 'text-ref-migration.md'), renderTextReferenceMigrationReport(result), 'utf8');

    const mode = options.apply ? 'APPLY' : 'DRY-RUN';
    console.log(`${mode} migrate-text-refs: ${result.replacements.length} replacements, ${result.unresolved.length} unresolved, ${result.ambiguous.length} ambiguous`);
    console.log(`Scope: ${result.referenceScope}.`);
    console.log(`Manual review: ${result.linkedReferences.length} markdown links, ${result.sectionHeadings.length} section headings`);
    console.log('Report: .math-workspace/text-ref-migration.md');

    if (options.apply) {
        console.log(`Updated ${changedFiles} files.`);
        await prepare({ exitOnError: true });
    }
}

async function printReport() {
    try {
        process.stdout.write(await fs.readFile(path.join(CACHE_DIR, 'report.md'), 'utf8'));
    } catch (_err) {
        console.log('No report found. Run: npm run workspace -- prepare');
    }
}

function makeDummyHash(chapter, index) {
    return `h-${chapter.toString(16).padStart(4, '0')}${index.toString(16).padStart(12, '0')}`;
}

function makeDummyDocuments(chapters, blocksPerChapter) {
    const documents = [];
    for (let chapter = 1; chapter <= chapters; chapter++) {
        const lines = [`# Dummy Chapter ${chapter}`, ''];
        for (let index = 1; index <= blocksPerChapter; index++) {
            const id = makeDummyHash(chapter, index);
            const previous = index > 1 ? ` By @${makeDummyHash(chapter, index - 1)} we continue.` : '';
            lines.push(`定理 #${id}（Dummy ${chapter}.${index}）：This is a generated theorem for scanner performance.${previous}`);
            lines.push('');
        }
        documents.push({
            filePath: `perf/book1/${String(chapter).padStart(2, '0')}-dummy.md`,
            content: lines.join('\n')
        });
    }
    return documents;
}

async function perfDummy(args) {
    const options = parsePerfArgs(args);
    const chapters = Math.max(1, Number(options.positionals[0] || 50));
    const blocksPerChapter = Math.max(1, Number(options.positionals[1] || 200));
    const documents = makeDummyDocuments(chapters, blocksPerChapter);
    const started = Date.now();
    const state = scanFormalDocuments(documents, mergeConfig(DEFAULT_CONFIG));
    const elapsed = Date.now() - started;
    const memory = process.memoryUsage ? process.memoryUsage() : undefined;
    const heapMbValue = memory ? memory.heapUsed / 1024 / 1024 : undefined;
    const heapMb = heapMbValue === undefined ? 'n/a' : Math.round(heapMbValue);
    printSummary('perf-dummy', state);
    console.log(`Documents: ${chapters}, blocks/document: ${blocksPerChapter}, total blocks: ${chapters * blocksPerChapter}`);
    console.log(`Elapsed: ${elapsed}ms, heap used: ${heapMb}MB`);
    if (state.issues.some(issue => issue.severity === 'error')) process.exitCode = 1;
    if (options.maxMs !== undefined && elapsed > options.maxMs) {
        console.error(`PERF failed: elapsed ${elapsed}ms exceeds --max-ms ${options.maxMs}`);
        process.exitCode = 1;
    }
    if (options.maxHeapMb !== undefined && heapMbValue !== undefined && heapMbValue > options.maxHeapMb) {
        console.error(`PERF failed: heap ${Math.round(heapMbValue)}MB exceeds --max-heap-mb ${options.maxHeapMb}`);
        process.exitCode = 1;
    }
}

function parsePerfArgs(args) {
    const options = {
        positionals: [],
        maxMs: undefined,
        maxHeapMb: undefined
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--max-ms') {
            options.maxMs = Number(args[++i]);
        } else if (arg.startsWith('--max-ms=')) {
            options.maxMs = Number(arg.slice('--max-ms='.length));
        } else if (arg === '--max-heap-mb') {
            options.maxHeapMb = Number(args[++i]);
        } else if (arg.startsWith('--max-heap-mb=')) {
            options.maxHeapMb = Number(arg.slice('--max-heap-mb='.length));
        } else {
            options.positionals.push(arg);
        }
    }
    return options;
}

function printHelp({ all = false } = {}) {
    if (!all) {
        console.log(`Usage:
  math-workspace init [project-dir]
  math-workspace open [project-dir] [--port 0]
  math-workspace finish <file-or-dir> [...] [--all]
  math-workspace verify [--strict-chapters]
  math-workspace doctor [project-dir]

Advanced commands:
  npm run workspace -- prepare
  npm run workspace -- migrate-text-refs <file-or-dir> [...] [--apply] [--target-only] [--all]
  npm run workspace -- migrate-ids <file-or-dir> [...] [--apply] [--target-only] [--all]
  npm run workspace -- audit [file-or-dir] [...]
  npm run workspace -- graph
  npm run workspace -- graph impact <h-id>
  npm run workspace -- graph focus <h-id> [--depth N]
  npm run workspace -- graph matrix chapter|volume|book
  npm run workspace -- lean scan|coverage|verify|capture|dependencies
  npm run workspace -- lean build [--project <key>]
  npm run workspace -- serve [project-dir] [--port 0]  # no project-dir opens the local launcher
  npm run workspace -- mcp [--root project-dir] [--port 0]
  npm run workspace -- export-md <file-or-dir> [...] --out <compiled.md>
  npm run workspace -- export-md-split <file-or-dir> [...] --out <dir>
  npm run workspace -- export-pdf <file-or-dir> [...] --out <book.pdf> [--no-toc] [--toc-depth N] [--margin 2.5cm]
  npm run workspace -- render-pdf <compiled.md> --out <book.pdf> [--title "Title"] [--toc-title 目录]
  npm run workspace -- paths

Migrations are dry-run by default. Pass --apply to edit files.

Agent workflow:
  1. Run prepare when starting or resuming a task, or when the index may be stale.
  2. Read the target source; retrieve only matching rows from .math-workspace/reference-map.md for external existing refs.
  3. Use tmp-* for new objects and page anchors, then run finish on the edited file or directory (it verifies).
  4. For old numbered prose, migrate-text-refs <scope> updates target files plus incoming references by default.
  5. If you use finalize directly, run verify before treating generated or migrated content as complete.

Advanced commands:
  npm run workspace -- help --all`);
        return;
    }

    console.log(`Usage:
  math-workspace init [project-dir]
  math-workspace open [project-dir] [--port 0]
  math-workspace doctor [project-dir]
  npm run workspace -- prepare
  npm run workspace -- finish <file-or-dir> [...] [--all]
  npm run workspace -- migrate-text-refs <file-or-dir> [...] [--apply] [--target-only] [--all]
  npm run workspace -- migrate-ids <file-or-dir> [...] [--apply] [--target-only] [--all]
  npm run workspace -- audit [file-or-dir] [...]
  npm run workspace -- graph
  npm run workspace -- graph summary [--where all|statement|proof|body]
  npm run workspace -- graph focus <h-id> [--depth N] [--where all|statement|proof|body]
  npm run workspace -- graph impact <h-id> [--where all|statement|proof|body]
  npm run workspace -- graph upstream <h-id> [--where all|statement|proof|body]
  npm run workspace -- graph bridges|isolated|cycles [--where all|statement|proof|body]
  npm run workspace -- graph matrix chapter|volume|book [--where all|statement|proof|body]
  npm run workspace -- lean scan|coverage|verify|capture|dependencies
  npm run workspace -- lean build [--project <key>]
  npm run workspace -- serve [project-dir] [--port 0]  # no project-dir opens the local launcher
  npm run workspace -- mcp [--root project-dir] [--port 0]
  npm run workspace -- export-md <file-or-dir> [...] --out <compiled.md>
  npm run workspace -- export-md-split <file-or-dir> [...] --out <dir>
  npm run workspace -- export-pdf <file-or-dir> [...] --out <book.pdf> [--md-out compiled.md] [--pdf-engine xelatex] [--no-toc] [--toc-depth N] [--margin 2.5cm] [--paper a4] [--lang zh-CN] [--toc-title 目录] [--title "Title"] [--subtitle "Subtitle"] [--author Name] [--author-native Name] [--author-alias Alias] [--orcid URL] [--repository URL] [--license Name] [--license-url URL] [--preferred-citation Text] [--date "Revised 2026-06-26"] [--release-version rc.1] [--release-tag v1] [--release-commit abc123] [--doi DOI] [--metadata-page] [--front-matter page.md] [--front-matter-title "AI Statement"] [--front-matter-toc] [--show-version-on-cover] [--documentclass ctexbook] [--title-page] [--no-title-page] [--cover-style simple] [--title-size 32pt] [--subtitle-size 18pt] [--toc-page-break] [--no-toc-page-break] [-V key:value] [--variable key:value] [--keep-md]
  npm run workspace -- render-pdf <compiled.md> --out <book.pdf> [--pdf-engine xelatex] [--no-toc] [--toc-depth N] [--margin 2.5cm] [--paper a4] [--lang zh-CN] [--toc-title 目录] [--title "Title"] [--subtitle "Subtitle"] [--author Name] [--author-native Name] [--author-alias Alias] [--orcid URL] [--repository URL] [--license Name] [--license-url URL] [--preferred-citation Text] [--date "Revised 2026-06-26"] [--release-version rc.1] [--release-tag v1] [--release-commit abc123] [--doi DOI] [--metadata-page] [--front-matter page.md] [--front-matter-title "AI Statement"] [--front-matter-toc] [--show-version-on-cover] [--documentclass ctexbook] [--title-page] [--no-title-page] [--cover-style simple] [--title-size 32pt] [--subtitle-size 18pt] [--toc-page-break] [--no-toc-page-break] [-V key:value] [--variable key:value]
  npm run workspace -- paths
  npm run workspace -- help-ai
  npm run workspace -- verify [--strict-chapters]

Advanced:
  npm run workspace -- finalize <file-or-dir> [...] [--all]
  npm run workspace -- lint
  npm run workspace -- audit [file-or-dir] [...]
  npm run workspace -- perf-dummy [chapters] [blocks-per-chapter] [--max-ms N] [--max-heap-mb N]
  npm run workspace -- report

Migrations are dry-run by default. Pass --apply to edit files.

Agent workflow:
  1. Run prepare when starting or resuming a task, or when the index may be stale.
  2. Read the target source; retrieve only matching rows from .math-workspace/reference-map.md for external existing refs.
  3. Use tmp-* for new objects and page anchors, then run finish on the edited file or directory (it verifies).
  4. For old numbered prose, migrate-text-refs <scope> updates target files plus incoming references by default.
  5. If you use finalize directly, run verify before treating generated or migrated content as complete.`);
}

async function printArtifactPaths() {
    const rows = [
        ['package root', PACKAGE_ROOT],
        ['CLI', path.join(__dirname, 'math-workspace.js')],
        ['workspace UI', path.join(PACKAGE_ROOT, 'out', 'reader', 'index.html')],
        ['editor skill', path.join(PACKAGE_ROOT, 'skills', 'editor.md')],
        ['math writing skill', path.join(PACKAGE_ROOT, 'skills', 'math-writing.md')],
        ['integrator guide', path.join(PACKAGE_ROOT, 'skills', 'integrator.md')],
        ['Lean formalization skill', path.join(PACKAGE_ROOT, 'skills', 'lean-formalization.md')],
        ['VASMC catalog', path.join(PACKAGE_ROOT, 'vasm-catalog', 'vasmc-catalog.yaml')],
        ['usage doc', path.join(PACKAGE_ROOT, 'docs', 'usage.md')],
        ['release doc', path.join(PACKAGE_ROOT, 'docs', 'release.md')]
    ];
    console.log('math-workspace paths');
    for (const [label, filePath] of rows) {
        const exists = await pathExists(filePath);
        console.log(`${label}: ${toPosix(filePath)}${exists ? '' : ' (missing)'}`);
    }
    console.log('');
    console.log('AI workflow: review skills/editor.md, skills/math-writing.md, and skills/integrator.md; for Lean projects, also review skills/lean-formalization.md.');
    console.log('VASMC: vasmc add --catalog <VASMC catalog> --export editor|math-writing|integrator|lean-formalization');
}

function parseReaderArgs(args: string[], commandName = 'serve'): { rootPath?: string; port: number; help?: boolean } {
    let inputPath: string | undefined;
    let port = 0;
    let hasPath = false;

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--port') {
            port = Number(args[++index]);
            continue;
        }
        if (arg.startsWith('--port=')) {
            port = Number(arg.slice('--port='.length));
            continue;
        }
        if (arg === '--help' || arg === 'help') {
            console.log(`Usage: math-workspace ${commandName} [project-dir] [--port 0]`);
            if (commandName === 'serve') console.log('Omit project-dir to choose a local project in Math Workspace.');
            if (commandName === 'open') console.log('Omit project-dir to use the nearest prepared project, or open the local launcher.');
            process.exitCode = 0;
            return { port: 0, help: true };
        }
        if (arg.startsWith('-') || hasPath) {
            throw new Error(`Unknown workspace option: ${arg}`);
        }
        inputPath = arg;
        hasPath = true;
    }

    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid workspace port: ${port}`);
    }
    return { rootPath: inputPath ? path.resolve(ROOT, inputPath) : undefined, port };
}

async function runReader(options: { rootPath?: string; port: number }): Promise<void> {
    const reader = await startReaderServer(options);
    console.log(`Math Workspace: ${reader.url}`);
    if (reader.rootPath) {
        console.log(`Bound project: ${reader.rootPath}`);
    } else {
        console.log('No project is bound. Choose a recent project or select a project directory in Math Workspace.');
    }
    console.log('Math Workspace is local-only and read-only. Source changes refresh the current view automatically.');

    let closing = false;
    const close = async () => {
        if (closing) return;
        closing = true;
        await reader.close();
        process.exit(0);
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
}

async function serveReader(args: string[]): Promise<void> {
    const options = parseReaderArgs(args, 'serve');
    if (options.help) return;
    await runReader(options);
}

async function openReader(args: string[]): Promise<void> {
    const options = parseReaderArgs(args, 'open');
    if (options.help) return;
    const startPath = options.rootPath || ROOT;
    const rootPath = await findMathWorkspaceRoot(startPath);
    if (options.rootPath && !rootPath) {
        throw new Error('No Math Workspace project was found at or above that path. Run `math-workspace init` first.');
    }
    await runReader({ rootPath, port: options.port });
}

function parseReaderMcpArgs(args: string[]): { rootPath?: string; port: number; help?: boolean } {
    let rootPath: string | undefined;
    let port = 0;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--root') {
            rootPath = args[++index];
            continue;
        }
        if (arg.startsWith('--root=')) {
            rootPath = arg.slice('--root='.length);
            continue;
        }
        if (arg === '--port') {
            port = Number(args[++index]);
            continue;
        }
        if (arg.startsWith('--port=')) {
            port = Number(arg.slice('--port='.length));
            continue;
        }
        if (arg === '--help' || arg === 'help') {
            console.log('Usage: math-workspace mcp [--root project-dir] [--port 0]');
            return { port: 0, help: true };
        }
        throw new Error(`Unknown MCP option: ${arg}`);
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid workspace port: ${port}`);
    }
    return { rootPath: rootPath ? path.resolve(ROOT, rootPath) : undefined, port };
}

async function serveReaderMcp(args: string[]): Promise<void> {
    const options = parseReaderMcpArgs(args);
    if (options.help) return;
    await runReaderMcpServer(options);
}

async function main() {
    const [command, ...args] = process.argv.slice(2);

    if (!command || command === 'help' || command === '--help') {
        printHelp({ all: args.includes('--all') });
    } else if (command === 'init') {
        await initWorkspace(args);
    } else if (command === 'open') {
        await openReader(args);
    } else if (command === 'doctor') {
        await doctor(args);
    } else if (command === 'prepare') {
        await prepare({ exitOnError: true });
    } else if (command === 'lint') {
        await lint();
    } else if (command === 'graph') {
        await graph(args);
    } else if (command === 'lean') {
        await lean(args);
    } else if (command === 'serve') {
        await serveReader(args);
    } else if (command === 'mcp') {
        await serveReaderMcp(args);
    } else if (command === 'verify') {
        await verify(args);
    } else if (command === 'finalize') {
        await finalize(args);
    } else if (command === 'finish') {
        await finish(args);
    } else if (command === 'migrate-text-refs') {
        await migrateTextRefs(args);
    } else if (command === 'migrate-ids') {
        await migrateIds(args);
    } else if (command === 'export-md') {
        await exportMarkdown(args);
    } else if (command === 'export-md-split') {
        await exportMarkdownSplit(args);
    } else if (command === 'export-pdf') {
        await exportPdf(args);
    } else if (command === 'render-pdf') {
        await renderPdf(args);
    } else if (command === 'paths' || command === 'help-ai') {
        await printArtifactPaths();
    } else if (command === 'audit') {
        await audit(args);
    } else if (command === 'report') {
        await printReport();
    } else if (command === 'perf-dummy') {
        await perfDummy(args);
    } else {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});
