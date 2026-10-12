import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { formatDisplayNumber, HASH_ID_RE, toPosix, typeName, type LabelData } from '@math-workspace/core';
import { loadWorkspaceSnapshot, type WorkspaceSnapshot } from '../reader/workspace';
import { leanProjects, type LeanDeclarationAnchor, type LeanProjectConfig } from './lean-index';
import type { DeclarationEvidence, LeanReviewEvidence, ProjectEvidence, SourceSnippet } from './lean-review';

const nodeFs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { homedir } = require('node:os');
const MAX_TEXT = 24000;
const MAX_INPUT_FILES = 30000;
const MAX_INPUT_BYTES = 512 * 1024 * 1024;
const RECORD_PREFIX = 'MW_LEAN_REVIEW\t';
const LEAN_NAME = /^[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*$/;

export function reviewHash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export function formalReviewId(value: unknown): string {
    const id = String(value || '').replace(/^[@#]/, '').trim().toLowerCase();
    if (!HASH_ID_RE.test(id)) throw new LeanReviewError(400, 'A stable formal h-* ID is required.');
    return id;
}

export class LeanReviewError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}

export function reviewPathInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** Reject symlink escapes before source reads or executable working-directory selection. */
export async function reviewSafePath(root: string, relative: string, optional = false): Promise<string | undefined> {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\0')) {
        throw new LeanReviewError(400, 'Review paths must be project-relative.');
    }
    const candidate = path.resolve(root, relative);
    if (!reviewPathInside(root, candidate)) throw new LeanReviewError(400, 'Review path is outside the prepared project.');
    try {
        const resolved = await fs.realpath(candidate);
        if (!reviewPathInside(root, resolved)) throw new LeanReviewError(400, 'Review path escapes the project through a symlink.');
        return resolved;
    } catch (error: any) {
        if (optional && error?.code === 'ENOENT') return undefined;
        throw error;
    }
}

export async function validateReviewWorkspace(root: string): Promise<string> {
    const canonical = await fs.realpath(root);
    const configPath = await reviewSafePath(canonical, '.math-workspace/config.json');
    const config = JSON.parse(await fs.readFile(configPath!, 'utf8'));
    for (const project of leanProjects(config)) {
        const projectRoot = await reviewSafePath(canonical, project.root);
        if (!projectRoot) continue;
        for (const source of project.sourceRoots) await reviewSafePath(projectRoot, source);
    }
    return canonical;
}

function bounded(value: string): { content: string; truncated?: boolean } {
    return value.length > MAX_TEXT ? { content: value.slice(0, MAX_TEXT), truncated: true } : { content: value };
}

function snippet(filePath: string, lines: string[], start: number, end: number, role: SourceSnippet['role'], context = false): SourceSnippet {
    const startLine = Math.max(1, Math.min(lines.length, start));
    const endLine = Math.max(startLine, Math.min(lines.length, end));
    const source = lines.slice(startLine - 1, endLine).join('\n');
    return { filePath, startLine, endLine, ...bounded(source), fingerprint: reviewHash(source), role,
        ...(context ? { rangeKind: 'context' as const } : { rangeKind: 'source' as const }) };
}

function matchingSnippet(snapshot: WorkspaceSnapshot, label: LabelData, text: string, role: SourceSnippet['role']): SourceSnippet | undefined {
    const source = snapshot.documents.get(label.filePath);
    if (source === undefined || !text) return undefined;
    const lines = source.split(/\r?\n/);
    const contentLines = text.split(/\r?\n/);
    const from = Math.max(0, label.startLine || 0);
    for (let index = from; index < lines.length; index++) {
        if (lines.slice(index, index + contentLines.length).join('\n') === contentLines.join('\n')) {
            return snippet(label.filePath, lines, index + 1, index + contentLines.length, role);
        }
    }
    // Never invent a source location from a mismatching cached label.
    return undefined;
}

export interface ReviewContext {
    root: string;
    snapshot: WorkspaceSnapshot;
    id: string;
    formal: { id: string; type: string; title: string; display: string; filePath: string; line: number };
    evidence: LeanReviewEvidence;
    projectConfigs: LeanProjectConfig[];
}

export function declarationReviewKey(projectKey: string, qualifiedName: string): string {
    return `${projectKey}:${qualifiedName}`;
}

async function declarationSource(root: string, declaration: LeanDeclarationAnchor): Promise<SourceSnippet | undefined> {
    const file = await reviewSafePath(root, declaration.filePath);
    const lines = (await fs.readFile(file!, 'utf8')).split(/\r?\n/);
    const start = Math.max(1, declaration.line);
    let end = lines.length;
    for (let index = start; index < lines.length; index++) {
        if (/^\s*(?:\/--|(?:private |protected |noncomputable |unsafe |opaque |partial )*(?:def|abbrev|theorem|lemma|structure|class|inductive|instance|axiom)\s|namespace\s|section\b|end\b)/.test(lines[index])) {
            end = index;
            break;
        }
    }
    // This is an exact located source excerpt, but lexical boundaries are not an elaborated range.
    return snippet(declaration.filePath, lines, start, end, 'declaration', true);
}

export interface ProjectInputs { fingerprint: string; toolchain: string; diagnostic?: string }

export async function manifestDependencies(root: string, projectRoot: string): Promise<Array<{ directory: string; gitRevision?: string }>> {
    const manifestPath = await reviewSafePath(root, toPosix(path.relative(root, path.join(projectRoot, 'lake-manifest.json'))), true);
    if (!manifestPath) return [];
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (!Array.isArray(manifest.packages)) throw new Error('Lake manifest package entries are unavailable.');
    const packagesDir = typeof manifest.packagesDir === 'string' ? manifest.packagesDir : '.lake/packages';
    const dependencies: Array<{ directory: string; gitRevision?: string }> = [];
    for (const entry of manifest.packages) {
        let dependency: string;
        if (entry.type === 'path' && typeof entry.dir === 'string') dependency = path.resolve(projectRoot, entry.dir);
        else if (entry.type === 'git' && typeof entry.name === 'string' && /^[A-Za-z0-9_.-]+$/.test(entry.name)) {
            dependency = path.resolve(projectRoot, packagesDir, entry.name, typeof entry.subDir === 'string' ? entry.subDir : '.');
        } else throw new Error('Unsupported Lake manifest dependency format; initialize dependencies deliberately outside the Reader.');
        if (!reviewPathInside(root, dependency)) throw new Error('A Lake dependency is outside the prepared Math Workspace; its input boundary cannot be tracked.');
        const resolved = await reviewSafePath(root, toPosix(path.relative(root, dependency)), true);
        if (!resolved) throw new Error(`Lake dependency is not installed locally: ${toPosix(path.relative(root, dependency))}.`);
        dependencies.push({ directory: resolved, ...(entry.type === 'git' ? { gitRevision: entry.rev } : {}) });
    }
    return dependencies;
}

export async function inputFingerprint(root: string, project: LeanProjectConfig): Promise<ProjectInputs> {
    const projectRoot = await reviewSafePath(root, project.root);
    const files = new Map<string, string>();
    const visited = new Set<string>();
    let diagnostic: string | undefined;
    let bytes = 0;
    const visit = async (directory: string, packages = false): Promise<void> => {
        if (visited.has(directory)) return;
        visited.add(directory);
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (['.git', 'node_modules', '.math-workspace'].includes(entry.name)) continue;
            const candidate = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                // Sources beneath symlinks could be executed by Lake but are not safely fingerprinted.
                throw new LeanReviewError(400, `Lean input symlink is not supported for review evidence: ${toPosix(path.relative(root, candidate))}`);
            }
            if (entry.isDirectory()) {
                if (entry.name !== '.lake') await visit(candidate, packages);
            } else if (entry.isFile() && (entry.name.endsWith('.lean') || ['lakefile.toml', 'lake-manifest.json', 'lean-toolchain'].includes(entry.name))) {
                const text = await fs.readFile(candidate, 'utf8');
                bytes += text.length;
                if (files.size >= MAX_INPUT_FILES || bytes > MAX_INPUT_BYTES) throw new LeanReviewError(413, 'Lean project inputs exceed the bounded review evidence limit.');
                files.set(toPosix(path.relative(root, candidate)), reviewHash(text));
            }
        }
    };
    await visit(projectRoot!);
    try {
        for (const dependency of await manifestDependencies(root, projectRoot!)) await visit(dependency.directory, true);
        const manifestFile = await reviewSafePath(root, toPosix(path.relative(root, path.join(projectRoot!, 'lake-manifest.json'))), true);
        const manifest = manifestFile ? JSON.parse(await fs.readFile(manifestFile, 'utf8')) : {};
        const lakeDir = typeof manifest.lakeDir === 'string' ? manifest.lakeDir : '.lake';
        const override = await reviewSafePath(root, toPosix(path.relative(root, path.resolve(projectRoot!, lakeDir, 'package-overrides.json'))), true);
        if (override) {
            files.set(toPosix(path.relative(root, override)), reviewHash(await fs.readFile(override, 'utf8')));
            diagnostic = 'Lake package overrides require deliberate external resolution; override dependencies are not admitted by the Reader.';
        }
    } catch (error: any) { diagnostic = error.message || String(error); }
    const toolchainFile = await reviewSafePath(projectRoot!, 'lean-toolchain', true);
    const toolchain = toolchainFile ? (await fs.readFile(toolchainFile, 'utf8')).trim() : '';
    const toolchainRoot = installedToolchainRoot(toolchain);
    let binaryIdentity: unknown = 'unavailable';
    if (toolchainRoot) {
        try {
            const stat = await fs.stat(path.join(toolchainRoot, 'bin', 'lean'));
            binaryIdentity = { path: toolchainRoot, size: stat.size, mtimeMs: stat.mtimeMs };
        } catch (_error) { /* Missing toolchain remains visibly unavailable. */ }
    }
    return { toolchain, diagnostic, fingerprint: reviewHash(JSON.stringify({ project, binaryIdentity, diagnostic,
        inputs: [...files.entries()].sort(([left], [right]) => left.localeCompare(right)) })) };
}

export function installedToolchainRoot(toolchain: string): string | undefined {
    // Direct installed binaries avoid an elan invocation silently downloading a toolchain.
    if (!/^[A-Za-z0-9_.:/-]+$/.test(toolchain) || toolchain.includes('..')) return undefined;
    const directory = toolchain.replace(/\//g, '--').replace(/:/g, '---');
    return path.join(process.env.ELAN_HOME || path.join(homedir(), '.elan'), 'toolchains', directory);
}

export async function readReviewContext(rootInput: string, idInput: unknown, reusableSnapshot?: WorkspaceSnapshot,
    projectInputs = new Map<string, Promise<ProjectInputs>>(), validated = false): Promise<ReviewContext> {
    const root = validated ? rootInput : await validateReviewWorkspace(rootInput);
    const id = formalReviewId(idInput);
    const snapshot = reusableSnapshot || await loadWorkspaceSnapshot(root);
    const labels: Record<string, LabelData> = snapshot.state.labels || {};
    const label = labels[id];
    if (!label) throw new LeanReviewError(404, 'Formal object not found in the prepared project.');
    // Ensure even a reused snapshot cannot route a snippet beyond the canonical root.
    await reviewSafePath(root, label.filePath);
    const lines = snapshot.documents.get(label.filePath)?.split(/\r?\n/) || [];
    const statement = snippet(label.filePath, lines, (label.startLine || 0) + 1, (label.endLine ?? label.startLine ?? 0) + 1, 'statement');
    const proofs: SourceSnippet[] = [];
    const localProof = matchingSnippet(snapshot, label, label.proofContent || '', 'proof');
    if (localProof) proofs.push(localProof);
    for (const range of label.supportRanges || []) proofs.push(snippet(label.filePath, lines, range.startLine + 1, range.endLine + 1, 'support'));
    for (const solution of label.solutions || []) {
        const linked = labels[solution];
        if (!linked) continue;
        await reviewSafePath(root, linked.filePath);
        const proof = matchingSnippet(snapshot, linked, linked.proofContent || linked.content || '', 'proof');
        if (proof) proofs.push(proof);
    }
    if (label.solutionOf && labels[label.solutionOf]) {
        const question = labels[label.solutionOf];
        await reviewSafePath(root, question.filePath);
        const questionLines = snapshot.documents.get(question.filePath)?.split(/\r?\n/) || [];
        proofs.push(snippet(question.filePath, questionLines, (question.startLine || 0) + 1, (question.endLine ?? question.startLine ?? 0) + 1, 'question'));
    }
    const contexts: SourceSnippet[] = [];
    // Show the preceding heading and bounded local preamble as context; it is not a inferred premise.
    const start = label.startLine || 0;
    let heading = start - 1;
    while (heading >= 0 && !/^\s{0,3}#{1,6}\s/.test(lines[heading])) heading--;
    if (start > 0) contexts.push(snippet(label.filePath, lines, Math.max(heading + 1, start - 80, 1), start, 'context'));
    const visitedReferences = new Set<string>([id]);
    const referenceQueue = [statement.content, ...proofs.map(item => item.content), ...contexts.map(item => item.content)];
    let contextOverflow = [statement, ...proofs, ...contexts].some(item => item.truncated);
    while (referenceQueue.length) {
        const text = referenceQueue.shift()!;
        for (const reference of text.match(/@h-[0-9a-f]{16,32}\b/gi) || []) {
            const targetId = reference.slice(1).toLowerCase();
            if (visitedReferences.has(targetId)) continue;
            visitedReferences.add(targetId);
            if (visitedReferences.size > 25) { contextOverflow = true; continue; }
            const target = labels[targetId];
            if (!target) { contextOverflow = true; continue; }
            await reviewSafePath(root, target.filePath);
            const targetLines = snapshot.documents.get(target.filePath)?.split(/\r?\n/) || [];
            const targetStart = target.startLine || 0;
            let targetEnd = target.endLine ?? targetStart;
            if (/^\s{0,3}#{1,6}\s/.test(targetLines[targetStart] || '')) {
                const depth = targetLines[targetStart].match(/^\s{0,3}(#{1,6})\s/)![1].length;
                targetEnd = targetLines.length - 1;
                for (let lineIndex = targetStart + 1; lineIndex < targetLines.length; lineIndex++) {
                    const boundary = targetLines[lineIndex].match(/^\s{0,3}(#{1,6})\s/);
                    if (boundary && boundary[1].length <= depth) { targetEnd = lineIndex - 1; break; }
                }
            }
            const source = snippet(target.filePath, targetLines, targetStart + 1, targetEnd + 1, 'context');
            contexts.push(source); referenceQueue.push(source.content);
            if (source.truncated) contextOverflow = true;
        }
    }
    const anchors: LeanDeclarationAnchor[] = snapshot.state.leanIndex?.anchors?.[id]?.declarations || [];
    const declarations: DeclarationEvidence[] = [];
    for (const anchor of anchors) declarations.push({
        key: declarationReviewKey(anchor.projectKey, anchor.qualifiedName || anchor.name),
        projectKey: anchor.projectKey, name: anchor.name, qualifiedName: anchor.qualifiedName || anchor.name,
        kind: anchor.kind, source: await declarationSource(root, anchor),
        typeDependencies: [], proofDependencies: [], axioms: [], evidenceState: 'unavailable',
        diagnostic: 'Elaborated evidence has not been refreshed for this declaration.'
    });
    const keys = new Set(anchors.map(anchor => anchor.projectKey));
    const projectConfigs = leanProjects(snapshot.state.config).filter(project => keys.has(project.key));
    const projects: ProjectEvidence[] = [];
    for (const project of projectConfigs) {
        if (!projectInputs.has(project.key)) projectInputs.set(project.key, inputFingerprint(root, project));
        const input = await projectInputs.get(project.key)!;
        projects.push({ projectKey: project.key, inputFingerprint: input.fingerprint, toolchain: input.toolchain,
            target: project.target, module: project.module, diagnostic: input.diagnostic, freshnessPolicy: 'project-inputs', build: { state: 'unverified' } });
    }
    const displayNumber = formatDisplayNumber(label);
    const evidence: LeanReviewEvidence = { fingerprint: '', statement, proofs: [...new Map(proofs.map(proof => [`${proof.filePath}:${proof.startLine}:${proof.endLine}`, proof])).values()],
        contexts, contextPolicy: contextOverflow ? 'workspace-markdown' : 'explicit-references',
        ...(contextOverflow ? { contextInputFingerprint: reviewHash(JSON.stringify([...snapshot.documents.entries()].map(([file, content]) => [file, reviewHash(content)]))) } : {}),
        declarations, definitions: [], projects, state: 'unavailable',
        diagnostics: contextOverflow ? ['Explicit reference context exceeds the bounded snapshot; review freshness conservatively tracks all workspace Markdown inputs.'] : [] };
    evidence.fingerprint = evidenceFingerprint(evidence);
    const displayName = typeName(snapshot.state.config, label.type);
    return { root, id, snapshot, projectConfigs, formal: { id, type: label.type, title: label.title,
        display: displayNumber ? `${displayName} ${displayNumber}` : displayName, filePath: label.filePath, line: statement.startLine }, evidence };
}

export function evidenceFingerprint(evidence: LeanReviewEvidence): string {
    const snippets = (items: SourceSnippet[]) => items.map(item => [item.filePath, item.startLine, item.endLine, item.fingerprint]);
    const declarations = (items: DeclarationEvidence[]) => items.map(item => ({ key: item.key, source: item.source?.fingerprint,
        type: item.elaboratedType, value: item.value, axioms: item.axioms, typeDependencies: item.typeDependencies,
        proofDependencies: item.proofDependencies, compiledSource: item.compiledSource, state: item.evidenceState, truncated: item.truncated }));
    return reviewHash(JSON.stringify({ statement: snippets([evidence.statement]), proofs: snippets(evidence.proofs), contexts: snippets(evidence.contexts),
        contextInputFingerprint: evidence.contextInputFingerprint, contextPolicy: evidence.contextPolicy,
        declarations: declarations(evidence.declarations), definitions: declarations(evidence.definitions),
        projects: evidence.projects.map(item => [item.projectKey, item.inputFingerprint, item.build.state, item.build.inputFingerprint]), state: evidence.state }));
}

export interface EvidenceProcessControl {
    cancelled(): boolean;
    onProcess(process: any | undefined): void;
    phase(value: string): void;
}

async function runBounded(command: string, args: string[], cwd: string, control: EvidenceProcessControl): Promise<{ exitCode: number | null; output: string }> {
    if (control.cancelled()) throw new Error('Review evidence refresh cancelled.');
    return new Promise((resolve, reject) => {
        const toolchainRoot = ['lake', 'lean'].includes(path.basename(command)) ? path.dirname(path.dirname(command)) : undefined;
        const child = spawn(command, args, { cwd, env: { ...process.env, ELAN_TOOLCHAIN: undefined,
            LEAN: toolchainRoot ? path.join(toolchainRoot, 'bin', 'lean') : undefined,
            LAKE: toolchainRoot ? path.join(toolchainRoot, 'bin', 'lake') : undefined,
            PATH: toolchainRoot ? `${path.join(toolchainRoot, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}` : process.env.PATH,
            LAKE_HOME: undefined, LEAN_PATH: undefined, LEAN_SRC_PATH: undefined,
            LEAN_SYSROOT: toolchainRoot, LEAN_GITHASH: undefined, LAKE_NO_CACHE: 'true',
            LAKE_ARTIFACT_CACHE: 'false', LAKE_RESTORE_ARTIFACTS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
        control.onProcess(child);
        let output = '';
        let bytes = 0;
        let failure = '';
        const kill = () => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch (_error) { child.kill('SIGKILL'); } };
        const timer = setTimeout(() => { failure = 'Lean evidence command exceeded its 120-second limit.'; kill(); }, 120000);
        const receive = (chunk: any) => {
            const text = String(chunk);
            bytes += Buffer.byteLength(text);
            if (bytes > 8 * 1024 * 1024) { failure = 'Lean evidence command output exceeded 8 MiB.'; kill(); return; }
            output += text;
        };
        child.stdout.on('data', receive); child.stderr.on('data', receive);
        child.once('error', (error: Error) => { clearTimeout(timer); control.onProcess(undefined); reject(error); });
        child.once('close', (exitCode: number | null) => {
            clearTimeout(timer); control.onProcess(undefined);
            if (failure) reject(new Error(failure));
            else if (control.cancelled()) reject(new Error('Review evidence refresh cancelled.'));
            else resolve({ exitCode, output });
        });
    });
}

function leanString(value: string): string { return JSON.stringify(value); }

/** All semantic material comes from Lean's environment, never from source regexes. */
export function generatedReviewProbe(module: string, names: string[]): string {
    if (!LEAN_NAME.test(module) || names.some(name => !LEAN_NAME.test(name))) throw new LeanReviewError(400, 'Unsupported Lean module or declaration identifier.');
    return `import Lean\nimport ${module}\n\nopen Lean Elab Command Meta\nset_option pp.explicit true\nset_option pp.universes true\nset_option pp.fullNames true\nset_option format.width 120\n\ndef mw_review_names : Array Name := #[${names.map(name => `\`${name}`).join(', ')}]\ndef mw_review_strings (names : Array Name) : Json := toJson (names.toList.map Name.toString)\n\nelab "mw_review_emit" : command => do\n  let env ← getEnv\n  let mut requested := mw_review_names\n  for name in mw_review_names do\n    if let some info := env.find? name then\n      for dependency in info.type.getUsedConstants do\n        if !requested.contains dependency && requested.size < 80 then\n          requested := requested.push dependency\n  for name in requested do\n    match env.find? name with\n    | none => logWarning m!"Unresolved review declaration: {name}"\n    | some info =>\n      let typeText ← liftTermElabM do return (← ppExpr info.type).pretty\n      let valueText ← liftTermElabM do\n        match info with\n        | .defnInfo _ | .opaqueInfo _ =>\n          match info.value? true with\n          | some value => return (← ppExpr value).pretty\n          | none => return ""\n        | _ => return ""\n      let typeDeps := info.type.getUsedConstants\n      let proofDeps := match info.value? true with\n        | some value => value.getUsedConstants\n        | none => #[]\n      let axioms ← collectAxioms name\n      let moduleName ← findModuleOf? name\n      let sourcePath ← liftIO do\n        match moduleName with\n        | none => pure ""\n        | some mod =>\n          try pure (← findLean (← getSrcSearchPath) mod).toString\n          catch _ => pure ""\n      let oleanPath ← liftIO do\n        match moduleName with\n        | none => pure ""\n        | some mod =>\n          try pure (← findOLean mod).toString\n          catch _ => pure ""\n      let ranges ← findDeclarationRanges? name\n      let startLine := ranges.map (·.range.pos.line) |>.getD 0\n      let endLine := ranges.map (·.range.endPos.line) |>.getD 0\n      let kind := match info with\n        | .axiomInfo _ => "axiom"\n        | .thmInfo _ => "theorem"\n        | .defnInfo _ => "def"\n        | .opaqueInfo _ => "opaque"\n        | .inductInfo _ => "inductive"\n        | .ctorInfo _ => "constructor"\n        | .recInfo _ => "recursor"\n        | .quotInfo _ => "quotient"\n      let result := Json.mkObj [\n        ("name", toJson name.toString), ("type", toJson typeText), ("value", toJson valueText),\n        ("kind", toJson kind), ("module", toJson (moduleName.map Name.toString |>.getD "")),\n        ("sourcePath", toJson sourcePath), ("oleanPath", toJson oleanPath),\n        ("startLine", toJson startLine), ("endLine", toJson endLine),\n        ("typeDependencies", mw_review_strings typeDeps), ("proofDependencies", mw_review_strings proofDeps),\n        ("axioms", mw_review_strings axioms)]\n      logInfo m!"${RECORD_PREFIX}{result.compress}"\n\nmw_review_emit\n`;
}

export async function refreshReviewEvidence(context: ReviewContext, control: EvidenceProcessControl, expansion?: { projectKey: string; name: string }): Promise<LeanReviewEvidence> {
    const evidence: LeanReviewEvidence = JSON.parse(JSON.stringify(context.evidence));
    evidence.generatedAt = new Date().toISOString();
    const compiledFingerprints = new Map<string, Promise<string>>();
    for (const project of context.projectConfigs) {
        if (expansion && expansion.projectKey !== project.key) continue;
        const current = evidence.projects.find(item => item.projectKey === project.key)!;
        const module = project.module || project.target || '';
        if (!LEAN_NAME.test(module)) { current.diagnostic = 'A valid configured Lean module or target is required to inspect the environment.'; continue; }
        const toolchainRoot = installedToolchainRoot(current.toolchain);
        const lake = toolchainRoot && path.join(toolchainRoot, 'bin', 'lake');
        const lean = toolchainRoot && path.join(toolchainRoot, 'bin', 'lean');
        try {
            if (!lake || !lean) throw new Error('The configured Lean toolchain is unavailable. Install it deliberately outside the Reader.');
            await fs.access(lake); await fs.access(lean);
            const cwd = (await reviewSafePath(context.root, project.root))!;
            if (current.diagnostic) throw new Error(current.diagnostic);
            // Lake's --offline does not prevent dependency materialization in every version.
            // Admit only an existing, fully materialized manifest before invoking Lake at all.
            const manifest = await reviewSafePath(context.root, toPosix(path.relative(context.root, path.join(cwd, 'lake-manifest.json'))), true);
            if (!manifest) throw new Error('Lake manifest is missing. Initialize dependencies deliberately outside the Reader before refreshing evidence.');
            const dependencies = await manifestDependencies(context.root, cwd);
            for (const dependency of dependencies) if (dependency.gitRevision) {
                const revision = await runBounded('git', ['-C', dependency.directory, 'rev-parse', 'HEAD'], cwd, control);
                if (revision.exitCode !== 0 || revision.output.trim() !== dependency.gitRevision) {
                    throw new Error('A local Lake dependency is not at its locked Git revision. Resolve it deliberately outside the Reader; no fetch or checkout was attempted.');
                }
            }
            control.phase(`Building ${project.key} with installed toolchain (offline)`);
            const startedAt = new Date().toISOString();
            const args = ['--offline', '--no-cache', '--rehash', 'build', ...(project.target ? [project.target] : [module])];
            if (project.target?.startsWith('-')) throw new Error('A Lean build target cannot be an option.');
            const result = await runBounded(lake, args, cwd, control);
            current.build = { state: result.exitCode === 0 ? 'passed' : 'failed', command: [lake, ...args], startedAt,
                finishedAt: new Date().toISOString(), exitCode: result.exitCode, output: result.output.slice(-12000), inputFingerprint: current.inputFingerprint };
            if (result.exitCode !== 0) throw new Error(`Local Lean build failed. ${result.output.trim().slice(-2000)}`);
            control.phase(`Reading elaborated types and recursive axioms for ${project.key}`);
            const names = evidence.declarations.filter(item => item.projectKey === project.key).map(item => item.qualifiedName);
            if (expansion) names.push(expansion.name);
            const probePath = path.join(context.root, '.math-workspace', `lean-review-probe-${crypto.randomBytes(8).toString('hex')}.lean`);
            try {
                await fs.writeFile(probePath, generatedReviewProbe(module, [...new Set(names)]), 'utf8');
                const probe = await runBounded(lake, ['--offline', '--no-cache', 'env', lean, probePath], cwd, control);
                if (probe.exitCode !== 0) throw new Error(`Lean evidence probe failed. ${probe.output.trim().slice(-3000)}`);
                const seen = new Set<string>();
                for (const line of probe.output.split(/\r?\n/)) {
                    const index = line.indexOf(RECORD_PREFIX);
                    if (index < 0) continue;
                    const row = JSON.parse(line.slice(index + RECORD_PREFIX.length));
                    if (!LEAN_NAME.test(row.name) || typeof row.type !== 'string' || !Array.isArray(row.axioms)) continue;
                    const key = declarationReviewKey(project.key, row.name);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const anchor = evidence.declarations.find(item => item.key === key);
                    let source = anchor?.source;
                    let actualFile: string | undefined;
                    if (typeof row.sourcePath === 'string' && row.sourcePath) {
                        const candidate = path.resolve(cwd, row.sourcePath);
                        const tracked = [cwd, ...dependencies.map(item => item.directory)].some(directory => reviewPathInside(directory, candidate));
                        if (tracked && reviewPathInside(context.root, candidate)) {
                            const sourceFile = await reviewSafePath(context.root, toPosix(path.relative(context.root, candidate)), true);
                            if (sourceFile) {
                                actualFile = toPosix(path.relative(context.root, sourceFile));
                                if (row.startLine > 0 && row.endLine >= row.startLine) {
                                    source = snippet(actualFile, (await fs.readFile(sourceFile, 'utf8')).split(/\r?\n/), row.startLine, row.endLine, 'declaration');
                                }
                            }
                        }
                    }
                    if (anchor && (!actualFile || actualFile !== anchor.source?.filePath)) {
                        anchor.diagnostic = `The environment defines ${row.name} in ${row.module || 'an unknown module'}, which cannot be verified as the anchored source ${anchor.source?.filePath || ''}.`;
                        continue;
                    }
                    const definition: DeclarationEvidence = { key, projectKey: project.key, name: row.name.split('.').pop(), qualifiedName: row.name,
                        kind: row.kind, source, module: row.module, elaboratedType: bounded(row.type).content,
                        ...(row.value ? { value: bounded(row.value).content } : {}), typeDependencies: row.typeDependencies || [],
                        proofDependencies: row.proofDependencies || [], axioms: row.axioms, evidenceState: 'available',
                        ...(row.type.length > MAX_TEXT || row.value?.length > MAX_TEXT ? { truncated: true } : {}) };
                    if (!source) definition.diagnostic = 'The elaborated type is available; definition source/fields could not be read inside the tracked project boundary.';
                    if (typeof row.oleanPath === 'string' && row.oleanPath) {
                        const compiled = path.resolve(cwd, row.oleanPath);
                        if (reviewPathInside(context.root, compiled)) {
                            const compiledFile = await reviewSafePath(context.root, toPosix(path.relative(context.root, compiled)), true);
                            if (compiledFile) {
                                if (!compiledFingerprints.has(compiledFile)) compiledFingerprints.set(compiledFile, fs.readFile(compiledFile).then(reviewHash));
                                definition.compiledSource = { filePath: toPosix(path.relative(context.root, compiledFile)),
                                    fingerprint: await compiledFingerprints.get(compiledFile)! };
                            }
                        }
                    }
                    if (anchor) Object.assign(anchor, definition, { diagnostic: undefined });
                    else evidence.definitions.push(definition);
                }
                const missing = names.filter(name => !seen.has(declarationReviewKey(project.key, name)));
                if (missing.length) throw new Error(`Lean did not return evidence for ${missing.join(', ')}.`);
            } finally { await fs.rm(probePath, { force: true }); }
            const after = await inputFingerprint(context.root, project);
            if (after.fingerprint !== current.inputFingerprint) throw new Error('Lean inputs changed during refresh; refresh again before relying on this evidence.');
        } catch (error: any) {
            if (control.cancelled()) throw error;
            current.diagnostic = error.message || String(error);
            evidence.diagnostics.push(`${project.key}: ${current.diagnostic}`);
            for (const declaration of evidence.declarations.filter(item => item.projectKey === project.key)) {
                declaration.evidenceState = 'unavailable'; declaration.diagnostic = current.diagnostic;
            }
        }
    }
    const available = evidence.declarations.filter(item => item.evidenceState === 'available').length;
    evidence.state = available === evidence.declarations.length && available > 0 ? 'current' : available > 0 ? 'partial' : 'unavailable';
    if (!evidence.declarations.length) evidence.diagnostics.push('This formal object has no anchored Lean declarations.');
    evidence.fingerprint = evidenceFingerprint(evidence);
    return evidence;
}
