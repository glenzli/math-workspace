import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import { toPosix, HASH_ID_RE, DEFAULT_LEAN_COVERAGE_TYPES, type LabelData } from '@math-workspace/core';
import { applyLeanWorkspaceStatus, type LeanAnchorStatus, type LeanProjectSourceState, type LeanWorkspaceStatusSummary } from './lean-state';

const LEAN_ID_RE = /\bh-[0-9a-f]{16,32}\b/gi;
const LEAN_DECLARATION_RE = /^\s*(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|unsafe|opaque|partial)\s+)*(def|abbrev|theorem|lemma|structure|class|inductive|instance|axiom)\s+([A-Za-z_][A-Za-z0-9_'.]*)/;
const DEFAULT_ANCHOR_PREFIX = 'Math Workspace anchor:';
const DEFAULT_COVERAGE_TYPES = DEFAULT_LEAN_COVERAGE_TYPES;

export interface LeanProjectConfig {
    key: string;
    root: string;
    sourceRoots: string[];
    target?: string;
    module?: string;
    anchorPrefix: string;
}

export interface LeanDeclarationAnchor {
    projectKey: string;
    filePath: string;
    line: number;
    kind: string;
    name: string;
    qualifiedName: string;
    signatureFingerprint: string;
}

export interface LeanAnchorEntry {
    id: string;
    formal?: {
        type: string;
        title: string;
        filePath: string;
        line?: number;
    };
    declarations: LeanDeclarationAnchor[];
    status?: LeanAnchorStatus;
}

export interface LeanIndexDiagnostic {
    severity: 'error' | 'warn';
    code: string;
    file?: string;
    line?: number;
    message: string;
}

export interface LeanIndex {
    schemaVersion: 2;
    generatedBy: 'math-workspace';
    projects: LeanProjectConfig[];
    projectSources: Record<string, LeanProjectSourceState>;
    statusSummary?: LeanWorkspaceStatusSummary;
    anchors: Record<string, LeanAnchorEntry>;
    unanchoredFormalObjects: Array<{
        id: string;
        type: string;
        title: string;
        filePath: string;
        line?: number;
    }>;
    diagnostics: LeanIndexDiagnostic[];
    summary: {
        projects: number;
        leanFiles: number;
        anchoredLeanFiles: number;
        anchors: number;
        declarations: number;
        matchedAnchors: number;
        unknownAnchors: number;
        eligibleFormalObjects: number;
        anchoredEligibleFormalObjects: number;
    };
}

function fingerprint(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function normalizedRelativePath(value: unknown): string {
    return toPosix(String(value || '').trim())
        .replace(/^\.\/+/, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
}

function pathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function leanProjects(config: any): LeanProjectConfig[] {
    const projects = Array.isArray(config?.lean?.projects) ? config.lean.projects : [];
    return projects
        .filter((project: unknown) => project && typeof project === 'object')
        .map((project: any, index: number) => {
            const root = normalizedRelativePath(project.root);
            const sourceRoots = unique((Array.isArray(project.sourceRoots) ? project.sourceRoots : ['.'])
                .map(normalizedRelativePath)
                .map(value => value || '.'));
            return {
                key: String(project.key || root || `lean-${index + 1}`),
                root,
                sourceRoots: sourceRoots.length > 0 ? sourceRoots : ['.'],
                target: typeof project.target === 'string' && project.target.trim() ? project.target.trim() : undefined,
                module: typeof project.module === 'string' && project.module.trim() ? project.module.trim() : undefined,
                anchorPrefix: typeof project.anchorPrefix === 'string' && project.anchorPrefix.trim()
                    ? project.anchorPrefix.trim()
                    : DEFAULT_ANCHOR_PREFIX
            };
        });
}

function namespaceForOffset(source: string, offset: number): string {
    const scopes: Array<{ kind: 'namespace' | 'section'; name?: string }> = [];
    const before = source.slice(0, offset).split(/\r?\n/);
    for (const line of before) {
        const namespace = line.match(/^\s*namespace\s+([A-Za-z_][A-Za-z0-9_'.]*)\b/);
        if (namespace) {
            scopes.push({ kind: 'namespace', name: namespace[1] });
            continue;
        }
        if (/^\s*(?:noncomputable\s+)?section(?:\s+[A-Za-z_][A-Za-z0-9_'.]*)?\s*(?:--.*)?$/.test(line)) {
            scopes.push({ kind: 'section' });
            continue;
        }
        if (/^\s*end(?:\s+[A-Za-z_][A-Za-z0-9_'.]*)?\s*(?:--.*)?$/.test(line)) {
            scopes.pop();
        }
    }
    return scopes
        .filter((scope): scope is { kind: 'namespace'; name: string } => scope.kind === 'namespace' && !!scope.name)
        .map(scope => scope.name)
        .join('.');
}

function declarationSignature(source: string, offset: number): string {
    const head = source.slice(offset, offset + 16000);
    const terminator = head.search(/\s(?::=|where)\b/);
    const signature = (terminator >= 0 ? head.slice(0, terminator) : head)
        .replace(/\/--[\s\S]*?-\//g, ' ')
        .replace(/--[^\n]*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return fingerprint(signature);
}

export function isLeanSourcePath(config: any, filePath: string): boolean {
    const normalized = normalizedRelativePath(filePath);
    if (!normalized) return false;
    return leanProjects(config).some(project => {
        const projectRoot = project.root === '.' ? '' : project.root;
        if (projectRoot && normalized !== projectRoot && !normalized.startsWith(`${projectRoot}/`)) return false;
        if (normalized === path.posix.join(projectRoot, 'lakefile.toml') || normalized === path.posix.join(projectRoot, 'lean-toolchain')) return true;
        if (!normalized.toLowerCase().endsWith('.lean')) return false;
        return project.sourceRoots.some(sourceRoot => {
            const base = normalizedRelativePath(path.posix.join(projectRoot, sourceRoot));
            if (!base || base === '.') return true;
            return normalized === base || normalized.startsWith(`${base}/`);
        });
    });
}

async function collectLeanFiles(directory: string, files: string[] = []): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === '.lake') continue;
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            await collectLeanFiles(absolutePath, files);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lean')) {
            files.push(absolutePath);
        }
    }
    return files.sort((left, right) => toPosix(left).localeCompare(toPosix(right)));
}

function lineAt(source: string, offset: number): number {
    let line = 1;
    for (let index = 0; index < offset; index++) {
        if (source.charCodeAt(index) === 10) line++;
    }
    return line;
}

function anchorsInDocstring(content: string, prefix: string): string[] {
    const ids: string[] = [];
    for (const line of content.split(/\r?\n/)) {
        const prefixIndex = line.indexOf(prefix);
        if (prefixIndex < 0) continue;
        const matches = line.slice(prefixIndex + prefix.length).match(LEAN_ID_RE) || [];
        matches.forEach(id => ids.push(id.toLowerCase()));
    }
    return unique(ids);
}

function declarationsFromLeanSource(
    source: string,
    project: LeanProjectConfig,
    filePath: string,
    diagnostics: LeanIndexDiagnostic[]
): Array<{ id: string; declaration: LeanDeclarationAnchor }> {
    const declarations: Array<{ id: string; declaration: LeanDeclarationAnchor }> = [];
    const docstring = /\/--([\s\S]*?)-\//g;
    let match: RegExpExecArray | null;
    while ((match = docstring.exec(source))) {
        const ids = anchorsInDocstring(match[1], project.anchorPrefix);
        if (ids.length === 0) continue;
        const declarationSource = source.slice(docstring.lastIndex, docstring.lastIndex + 2000);
        const declaration = declarationSource.match(LEAN_DECLARATION_RE);
        if (!declaration) {
            const line = lineAt(source, match.index);
            diagnostics.push({
                severity: 'error',
                code: 'lean-anchor-declaration-missing',
                file: filePath,
                line,
                message: `Lean docstring anchor is not followed by a supported named declaration (${ids.join(', ')}).`
            });
            continue;
        }
        const declarationOffset = docstring.lastIndex + (declaration.index || 0) + declaration[0].indexOf(declaration[1]);
        const anchoredDeclaration: LeanDeclarationAnchor = {
            projectKey: project.key,
            filePath,
            line: lineAt(source, declarationOffset),
            kind: declaration[1],
            name: declaration[2],
            qualifiedName: [namespaceForOffset(source, declarationOffset), declaration[2]].filter(Boolean).join('.'),
            signatureFingerprint: declarationSignature(source, declarationOffset)
        };
        ids.forEach(id => declarations.push({ id, declaration: anchoredDeclaration }));
    }
    return declarations;
}

export async function scanLeanWorkspace(
    workspaceRoot: string,
    config: any,
    labels: Record<string, LabelData> = {},
    dependencyGraph?: unknown
): Promise<LeanIndex> {
    const projects = leanProjects(config);
    const diagnostics: LeanIndexDiagnostic[] = [];
    const anchors = new Map<string, LeanAnchorEntry>();
    const projectSources: Record<string, LeanProjectSourceState> = {};
    const scannedFiles = new Set<string>();
    const anchoredFiles = new Set<string>();

    for (const project of projects) {
        const projectSourceParts: string[] = [];
        if (!project.root) {
            diagnostics.push({
                severity: 'error',
                code: 'lean-project-root-missing',
                message: `Lean project ${project.key} must declare a workspace-relative root.`
            });
            continue;
        }
        const projectRoot = path.resolve(workspaceRoot, project.root);
        if (!pathInside(workspaceRoot, projectRoot)) {
            diagnostics.push({
                severity: 'error',
                code: 'lean-project-root-outside-workspace',
                message: `Lean project ${project.key} resolves outside the Math Workspace root.`
            });
            continue;
        }

        for (const sourceRoot of project.sourceRoots) {
            const absoluteSourceRoot = path.resolve(projectRoot, sourceRoot);
            const sourceDisplay = toPosix(path.relative(workspaceRoot, absoluteSourceRoot));
            if (!pathInside(projectRoot, absoluteSourceRoot)) {
                diagnostics.push({
                    severity: 'error',
                    code: 'lean-source-root-outside-project',
                    file: sourceDisplay,
                    message: `Lean source root for ${project.key} resolves outside its project root.`
                });
                continue;
            }

            let files: string[];
            try {
                files = await collectLeanFiles(absoluteSourceRoot);
            } catch (error: any) {
                diagnostics.push({
                    severity: 'error',
                    code: 'lean-source-root-unreadable',
                    file: sourceDisplay,
                    message: `Cannot scan Lean source root for ${project.key}: ${error?.message || error}`
                });
                continue;
            }

            for (const absoluteFile of files) {
                const filePath = toPosix(path.relative(workspaceRoot, absoluteFile));
                if (scannedFiles.has(filePath)) continue;
                scannedFiles.add(filePath);
                const source = await fs.readFile(absoluteFile, 'utf8');
                projectSourceParts.push(`${filePath}\u0000${source}`);
                const declarations = declarationsFromLeanSource(source, project, filePath, diagnostics);
                if (declarations.length > 0) anchoredFiles.add(filePath);
                for (const item of declarations) {
                    const entry = anchors.get(item.id) || { id: item.id, declarations: [] };
                    entry.declarations.push(item.declaration);
                    anchors.set(item.id, entry);
                }
            }
        }
        projectSources[project.key] = {
            fingerprint: fingerprint(projectSourceParts.sort().join('\u0000')),
            module: project.module || project.target
        };
    }

    for (const [id, entry] of anchors) {
        const label = labels[id];
        if (!label) {
            const first = entry.declarations[0];
            diagnostics.push({
                severity: 'error',
                code: 'lean-anchor-unknown',
                file: first?.filePath,
                line: first?.line,
                message: `Lean anchor ${id} does not resolve to a Math Workspace formal object.`
            });
            continue;
        }
        entry.formal = {
            type: label.type,
            title: label.title,
            filePath: label.filePath,
            line: label.startLine === undefined ? undefined : label.startLine + 1
        };
        entry.declarations.sort((left, right) => left.filePath.localeCompare(right.filePath) || left.line - right.line || left.name.localeCompare(right.name));
    }

    const coverageTypes = new Set(Array.isArray(config?.lean?.coverageTypes)
        ? config.lean.coverageTypes.filter((value: unknown) => typeof value === 'string')
        : DEFAULT_COVERAGE_TYPES);
    const eligible = projects.length === 0 ? [] : Object.entries(labels)
        .filter(([id, label]) => HASH_ID_RE.test(id) && (coverageTypes.has(label.type)
            || (label.type === 'exercise' && anchors.has(id))))
        .map(([id, label]) => ({
            id,
            type: label.type,
            title: label.title,
            filePath: label.filePath,
            line: label.startLine === undefined ? undefined : label.startLine + 1
        }))
        .sort((left, right) => left.filePath.localeCompare(right.filePath) || (left.line || 0) - (right.line || 0) || left.id.localeCompare(right.id));
    const unanchoredFormalObjects = eligible.filter(item => !anchors.has(item.id));
    const anchorObject = Object.fromEntries([...anchors.entries()].sort(([left], [right]) => left.localeCompare(right)));
    const declarationCount = [...anchors.values()].reduce((total, entry) => total + entry.declarations.length, 0);
    const unknownAnchors = [...anchors.values()].filter(entry => !entry.formal).length;

    const index: LeanIndex = {
        schemaVersion: 2,
        generatedBy: 'math-workspace',
        projects,
        projectSources,
        anchors: anchorObject,
        unanchoredFormalObjects,
        diagnostics,
        summary: {
            projects: projects.length,
            leanFiles: scannedFiles.size,
            anchoredLeanFiles: anchoredFiles.size,
            anchors: anchors.size,
            declarations: declarationCount,
            matchedAnchors: anchors.size - unknownAnchors,
            unknownAnchors,
            eligibleFormalObjects: eligible.length,
            anchoredEligibleFormalObjects: eligible.length - unanchoredFormalObjects.length
        }
    };
    await applyLeanWorkspaceStatus(workspaceRoot, index, labels, dependencyGraph);
    return index;
}

export function renderLeanReport(index: LeanIndex): string {
    const contracts = index.statusSummary?.contracts;
    const builds = index.statusSummary?.builds;
    const dependencies = index.statusSummary?.dependencies;
    const lines = [
        '# Lean anchor report',
        '',
        '> An anchor records a deterministic link to one or more Lean declarations. It does not by itself claim complete formalization or proof coverage.',
        '',
        '| Metric | Count |',
        '| --- | ---: |',
        `| Projects | ${index.summary.projects} |`,
        `| Lean files | ${index.summary.leanFiles} |`,
        `| Anchored Lean files | ${index.summary.anchoredLeanFiles} |`,
        `| Unique anchors | ${index.summary.anchors} |`,
        `| Lean declarations | ${index.summary.declarations} |`,
        `| Matched formal anchors | ${index.summary.matchedAnchors} |`,
        `| Unknown anchors | ${index.summary.unknownAnchors} |`,
        `| Eligible formal objects | ${index.summary.eligibleFormalObjects} |`,
        `| Eligible objects with anchors | ${index.summary.anchoredEligibleFormalObjects} |`,
        ''
    ];

    if (contracts && builds && dependencies) {
        lines.push(
            '## Review status',
            '',
            '> `current` means that the captured Markdown statement, associated proof/solution content and anchored Lean declaration signatures are unchanged. It is a drift check, not a semantic-equivalence proof.',
            '',
            '| Contract state | Anchors |',
            '| --- | ---: |',
            `| Current | ${contracts.current} |`,
            `| Untracked | ${contracts.untracked} |`,
            `| Markdown drifted | ${contracts['markdown-drifted']} |`,
            `| Declaration drifted | ${contracts['declaration-drifted']} |`,
            `| Both drifted | ${contracts.drifted} |`,
            '',
            '| Build state | Anchors |',
            '| --- | ---: |',
            `| Passed | ${builds.passed} |`,
            `| Failed | ${builds.failed} |`,
            `| Stale | ${builds.stale} |`,
            `| Unverified | ${builds.unverified} |`,
            '',
            '| Dependency state | Anchors |',
            '| --- | ---: |',
            `| Matched | ${dependencies.matched} |`,
            `| Markdown-only review | ${dependencies['markdown-gap']} |`,
            `| Additional Lean support | ${dependencies.supplemental} |`,
            `| Stale comparison | ${dependencies.stale} |`,
            `| Comparison unavailable | ${dependencies.unavailable} |`,
            ''
        );
    }

    if (index.projects.length > 0) {
        lines.push('## Projects', '');
        index.projects.forEach(project => {
            const target = project.target ? `; build target \`${project.target}\`` : '';
            lines.push(`- **${project.key}**: \`${project.root}\`; sources ${project.sourceRoots.map(root => `\`${root}\``).join(', ')}${target}`);
        });
        lines.push('');
    }

    if (index.diagnostics.length > 0) {
        lines.push('## Diagnostics', '');
        index.diagnostics.forEach(diagnostic => {
            const location = diagnostic.file ? ` (${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ''})` : '';
            lines.push(`- **${diagnostic.severity.toUpperCase()} ${diagnostic.code}**${location}: ${diagnostic.message}`);
        });
        lines.push('');
    }

    if (index.unanchoredFormalObjects.length > 0) {
        lines.push('## Eligible formal objects without a Lean anchor', '');
        index.unanchoredFormalObjects.forEach(item => {
            lines.push(`- \`${item.id}\` ${item.type} — ${item.title || '(untitled)'} (${item.filePath}${item.line ? `:${item.line}` : ''})`);
        });
        lines.push('');
    }

    return `${lines.join('\n').trimEnd()}\n`;
}
