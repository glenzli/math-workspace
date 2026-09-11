import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import type { LeanIndex, LeanProjectConfig } from './lean-index';

const { spawnSync } = require('node:child_process');
const RECORD_PREFIX = 'MW_LEAN_DEPENDENCY\t';
const NAME_SEPARATOR = '\u001f';

export type LeanDependencyWhere = 'type' | 'proof';
export type LeanDependencyState = 'matched' | 'markdown-gap' | 'supplemental' | 'unavailable' | 'stale';

export interface LeanDependencyEdge {
    from: string;
    to: string;
    projectKey: string;
    declaration: string;
    where: LeanDependencyWhere;
}

export interface LeanDependencyComparison {
    markdownOnly: string[];
    leanOnly: string[];
    shared: string[];
}

export interface LeanDependencyArtifact {
    schemaVersion: 1;
    generatedAt: string;
    inputFingerprint: string;
    edges: LeanDependencyEdge[];
    comparisons: Record<string, LeanDependencyComparison>;
    solutionDependencies?: Array<{ exercise: string; solution: string; to: string }>;
    unmappedMarkdownEdges: Array<{ from: string; to: string }>;
    diagnostics: Array<{ projectKey: string; message: string }>;
    summary: {
        markdownEdges: number;
        comparableMarkdownEdges: number;
        leanEdges: number;
        sharedEdges: number;
        markdownOnlyEdges: number;
        leanOnlyEdges: number;
        unmappedMarkdownEdges: number;
    };
}

function fingerprint(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function dependencyPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.math-workspace', 'lean-dependency-graph.json');
}

function reportPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.math-workspace', 'lean-dependency-report.md');
}

function explicitStrictEdges(graph: any): Array<{ from: string; to: string }> {
    return (Array.isArray(graph?.edges) ? graph.edges : [])
        .filter((edge: any) => edge
            && edge.relation !== 'explanatory'
            && (edge.where === 'statement' || edge.where === 'proof')
            && typeof edge.from === 'string'
            && typeof edge.to === 'string'
            && edge.from !== edge.to)
        .map((edge: any) => ({ from: edge.from, to: edge.to }));
}

function solutionDependencies(graph: any): Array<{ exercise: string; solution: string; to: string }> {
    return explicitStrictEdges(graph).flatMap(edge => (graph?.pedagogicalLinks || [])
        .filter((link: any) => link.solution === edge.from && link.exercise !== edge.to)
        .map((link: any) => ({ exercise: link.exercise, solution: link.solution, to: edge.to })));
}

function strictMarkdownEdges(graph: any, index: LeanIndex): Array<{ from: string; to: string }> {
    const edges = explicitStrictEdges(graph).flatMap(edge => {
        const owners = (graph?.pedagogicalLinks || []).filter((link: any) => link.solution === edge.from);
        if (!owners.length) return [edge];
        // The question's proof may live in its linked answer. Compare its explicit premises,
        // retaining the solution's own comparison only when it is separately anchored.
        return [
            ...(index.anchors[edge.from] ? [edge] : []),
            ...owners.filter((link: any) => link.exercise !== edge.to).map((link: any) => ({ from: link.exercise, to: edge.to }))
        ];
    });
    const projected = graph?.pedagogicalLinks?.length
        ? [...new Map(edges.map(edge => [`${edge.from}:${edge.to}`, edge])).values()] : edges;
    return projected.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
}

export function leanDependencyInputFingerprint(index: LeanIndex, graph: any): string {
    return fingerprint(JSON.stringify({
        projects: Object.entries(index.projectSources)
            .map(([key, source]) => ({ key, fingerprint: source.fingerprint, module: source.module || '' }))
            .sort((left, right) => left.key.localeCompare(right.key)),
        markdownEdges: strictMarkdownEdges(graph, index)
    }));
}

export async function readLeanDependencyArtifact(workspaceRoot: string): Promise<LeanDependencyArtifact | undefined> {
    try {
        const value = JSON.parse(await fs.readFile(dependencyPath(workspaceRoot), 'utf8')) as LeanDependencyArtifact;
        return value?.schemaVersion === 1 && Array.isArray(value.edges) && value.comparisons ? value : undefined;
    } catch (error: any) {
        if (error?.code === 'ENOENT') return undefined;
        return undefined;
    }
}

function leanModule(project: LeanProjectConfig): string | undefined {
    const value = project.module || project.target;
    return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_'.]*$/.test(value) ? value : undefined;
}

function generatedDependencyProbe(module: string, names: string[]): string {
    const requested = names.map(name => `  \`${name},`).join('\n');
    return `import Lean
import ${module}

open Lean Elab Command

def math_workspace_requested_names : Array Lean.Name := #[
${requested}
]

def math_workspace_names_text (names : Array Lean.Name) : String :=
  String.intercalate "${NAME_SEPARATOR}" (names.toList.map Lean.Name.toString)

elab "math_workspace_emit_dependencies" : command => do
  let env ← getEnv
  for source in math_workspace_requested_names do
    match env.find? source with
    | none =>
      logWarning m!"Math Workspace dependency query could not resolve {source}"
    | some info =>
      let type_dependencies := (info.type.getUsedConstants).filter fun name =>
        name != source && math_workspace_requested_names.contains name
      let proof_dependencies : Array Lean.Name := match info.value? true with
        | some value => (value.getUsedConstants).filter fun name =>
          name != source && math_workspace_requested_names.contains name
        | none => #[]
      logInfo m!"${RECORD_PREFIX}{source}\\ttype\\t{math_workspace_names_text type_dependencies}"
      logInfo m!"${RECORD_PREFIX}{source}\\tproof\\t{math_workspace_names_text proof_dependencies}"

math_workspace_emit_dependencies
`;
}

function queryProjectDependencies(workspaceRoot: string, project: LeanProjectConfig, names: string[]): {
    records: Array<{ source: string; where: LeanDependencyWhere; targets: string[] }>;
    diagnostic?: string;
} {
    const module = leanModule(project);
    if (!module) return { records: [], diagnostic: `Lean project ${project.key} needs a valid module or target name to inspect declaration dependencies.` };
    if (names.length === 0) return { records: [] };
    const token = crypto.randomBytes(8).toString('hex');
    const probePath = path.join(workspaceRoot, '.math-workspace', `lean-dependencies-${token}.lean`);
    const projectRoot = path.resolve(workspaceRoot, project.root);
    const source = generatedDependencyProbe(module, names);
    const parse = (output: string) => output.split(/\r?\n/)
        .filter(line => line.includes(RECORD_PREFIX))
        .map(line => line.slice(line.indexOf(RECORD_PREFIX) + RECORD_PREFIX.length).split('\t'))
        .filter((parts): parts is [string, LeanDependencyWhere, string] => (
            parts.length >= 3 && (parts[1] === 'type' || parts[1] === 'proof')
        ))
        .map(([sourceName, where, targets]) => ({
            source: sourceName,
            where,
            targets: targets ? targets.split(NAME_SEPARATOR).filter(Boolean) : []
        }));
    try {
        require('node:fs').mkdirSync(path.dirname(probePath), { recursive: true });
        require('node:fs').writeFileSync(probePath, source, 'utf8');
        const result = spawnSync('lake', ['env', 'lean', probePath], {
            cwd: projectRoot,
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024
        });
        const output = `${result.stdout || ''}${result.stderr || ''}`;
        const records = parse(output);
        if (result.error || result.status !== 0) {
            const tail = output.trim().slice(-4000);
            return { records, diagnostic: tail || String(result.error?.message || `Lake exited with ${result.status}`) };
        }
        return { records };
    } finally {
        try { require('node:fs').rmSync(probePath, { force: true }); } catch (_error) { /* best-effort temporary cleanup */ }
    }
}

function setFor(map: Map<string, Set<string>>, id: string): Set<string> {
    const existing = map.get(id);
    if (existing) return existing;
    const created = new Set<string>();
    map.set(id, created);
    return created;
}

function sorted(values: Iterable<string>): string[] {
    return [...values].sort((left, right) => left.localeCompare(right));
}

export function renderLeanDependencyReport(artifact: LeanDependencyArtifact): string {
    const lines = [
        '# Lean dependency comparison',
        '',
        '> This report compares explicit strict Markdown dependencies with direct references in elaborated Lean declaration types and proof values. Markdown-only edges merit direct review; Lean-only edges often record implementation detail or reusable support and are shown as supplemental context. Neither difference by itself establishes a mathematical conflict.',
        '',
        '| Metric | Count |',
        '| --- | ---: |',
        `| Strict Markdown edges | ${artifact.summary.markdownEdges} |`,
        `| Comparable Markdown edges | ${artifact.summary.comparableMarkdownEdges} |`,
        `| Lean edges | ${artifact.summary.leanEdges} |`,
        `| Shared edges | ${artifact.summary.sharedEdges} |`,
        `| Markdown-only review candidates | ${artifact.summary.markdownOnlyEdges} |`,
        `| Additional Lean support edges | ${artifact.summary.leanOnlyEdges} |`,
        `| Unmapped Markdown edges | ${artifact.summary.unmappedMarkdownEdges} |`,
        ''
    ];
    if (artifact.solutionDependencies?.length) {
        lines.push('## Premises in linked solutions', '', 'Explicit references in a linked solution are compared as premises of its exercise; the ownership link itself is not a premise.', '');
        artifact.solutionDependencies.forEach(item => lines.push(`- \`${item.exercise}\` → \`${item.to}\` via solution \`${item.solution}\``));
        lines.push('');
    }
    if (artifact.diagnostics.length > 0) {
        lines.push('## Query diagnostics', '');
        artifact.diagnostics.forEach(diagnostic => lines.push(`- **${diagnostic.projectKey}**: ${diagnostic.message}`));
        lines.push('');
    }
    const candidates = Object.entries(artifact.comparisons)
        .filter(([, comparison]) => comparison.markdownOnly.length > 0 || comparison.leanOnly.length > 0)
        .sort(([left], [right]) => left.localeCompare(right));
    if (candidates.length > 0) {
        lines.push('## Per-anchor comparison', '');
        for (const [id, comparison] of candidates) {
            lines.push(`### \`${id}\``, '');
            if (comparison.markdownOnly.length > 0) lines.push(`- Markdown-only review: ${comparison.markdownOnly.map(value => `\`${value}\``).join(', ')}`);
            if (comparison.leanOnly.length > 0) lines.push(`- Additional Lean support: ${comparison.leanOnly.map(value => `\`${value}\``).join(', ')}`);
            lines.push('');
        }
    }
    if (artifact.unmappedMarkdownEdges.length > 0) {
        lines.push('## Markdown edges not comparable yet', '');
        artifact.unmappedMarkdownEdges.forEach(edge => lines.push(`- \`${edge.from}\` → \`${edge.to}\``));
        lines.push('');
    }
    return `${lines.join('\n').trimEnd()}\n`;
}

export async function collectLeanDependencies(workspaceRoot: string, index: LeanIndex, graph: any): Promise<LeanDependencyArtifact> {
    const nameToAnchors = new Map<string, Set<string>>();
    const declarationsByProject = new Map<string, string[]>();
    for (const [id, anchor] of Object.entries(index.anchors)) {
        for (const declaration of anchor.declarations) {
            const name = declaration.qualifiedName || declaration.name;
            if (!name) continue;
            setFor(nameToAnchors, name).add(id);
            const names = declarationsByProject.get(declaration.projectKey) || [];
            names.push(name);
            declarationsByProject.set(declaration.projectKey, names);
        }
    }

    const edges = new Map<string, LeanDependencyEdge>();
    const diagnostics: LeanDependencyArtifact['diagnostics'] = [];
    for (const project of index.projects) {
        const names = sorted(new Set(declarationsByProject.get(project.key) || []));
        const query = queryProjectDependencies(workspaceRoot, project, names);
        if (query.diagnostic) diagnostics.push({ projectKey: project.key, message: query.diagnostic });
        for (const record of query.records) {
            const fromIds = nameToAnchors.get(record.source) || new Set<string>();
            for (const targetName of record.targets) {
                const toIds = nameToAnchors.get(targetName) || new Set<string>();
                for (const from of fromIds) for (const to of toIds) {
                    if (from === to) continue;
                    const edge: LeanDependencyEdge = {
                        from,
                        to,
                        projectKey: project.key,
                        declaration: record.source,
                        where: record.where
                    };
                    edges.set([edge.from, edge.to, edge.projectKey, edge.declaration, edge.where].join('\u0000'), edge);
                }
            }
        }
    }

    const markdownEdges = strictMarkdownEdges(graph, index);
    const anchoredIds = new Set(Object.keys(index.anchors));
    const comparableMarkdownEdges = markdownEdges.filter(edge => anchoredIds.has(edge.from) && anchoredIds.has(edge.to));
    const unmappedMarkdownEdges = markdownEdges.filter(edge => !anchoredIds.has(edge.from) || !anchoredIds.has(edge.to));
    const markdownBySource = new Map<string, Set<string>>();
    comparableMarkdownEdges.forEach(edge => setFor(markdownBySource, edge.from).add(edge.to));
    const leanBySource = new Map<string, Set<string>>();
    edges.forEach(edge => setFor(leanBySource, edge.from).add(edge.to));
    const comparisons: Record<string, LeanDependencyComparison> = {};
    let sharedEdges = 0;
    let markdownOnlyEdges = 0;
    let leanOnlyEdges = 0;
    const candidateIds = new Set([...markdownBySource.keys(), ...leanBySource.keys()]);
    for (const id of sorted(candidateIds)) {
        const markdown = markdownBySource.get(id) || new Set<string>();
        const lean = leanBySource.get(id) || new Set<string>();
        const shared = sorted([...markdown].filter(target => lean.has(target)));
        const markdownOnly = sorted([...markdown].filter(target => !lean.has(target)));
        const leanOnly = sorted([...lean].filter(target => !markdown.has(target)));
        sharedEdges += shared.length;
        markdownOnlyEdges += markdownOnly.length;
        leanOnlyEdges += leanOnly.length;
        comparisons[id] = { markdownOnly, leanOnly, shared };
    }

    const artifact: LeanDependencyArtifact = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        inputFingerprint: leanDependencyInputFingerprint(index, graph),
        edges: [...edges.values()].sort((left, right) => (
            left.from.localeCompare(right.from)
            || left.to.localeCompare(right.to)
            || left.projectKey.localeCompare(right.projectKey)
            || left.declaration.localeCompare(right.declaration)
            || left.where.localeCompare(right.where)
        )),
        comparisons,
        ...(solutionDependencies(graph).length ? { solutionDependencies: solutionDependencies(graph) } : {}),
        unmappedMarkdownEdges,
        diagnostics,
        summary: {
            markdownEdges: markdownEdges.length,
            comparableMarkdownEdges: comparableMarkdownEdges.length,
            leanEdges: new Set([...edges.values()].map(edge => `${edge.from}\u0000${edge.to}`)).size,
            sharedEdges,
            markdownOnlyEdges,
            leanOnlyEdges,
            unmappedMarkdownEdges: unmappedMarkdownEdges.length
        }
    };
    await fs.mkdir(path.join(workspaceRoot, '.math-workspace'), { recursive: true });
    await fs.writeFile(dependencyPath(workspaceRoot), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await fs.writeFile(reportPath(workspaceRoot), renderLeanDependencyReport(artifact), 'utf8');
    return artifact;
}
