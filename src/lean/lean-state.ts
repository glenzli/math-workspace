import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import { associatedProofContent, type LabelData } from '@math-workspace/core';
import type { LeanIndex } from './lean-index';
import { leanDependencyInputFingerprint, readLeanDependencyArtifact, type LeanDependencyState } from './lean-dependencies';

const { spawnSync } = require('node:child_process');

export const LEAN_CONTRACTS_FILE = 'lean-contracts.json';
export const LEAN_BUILD_FILE = 'lean-build.json';

export type LeanContractState = 'current' | 'untracked' | 'markdown-drifted' | 'declaration-drifted' | 'drifted';
export type LeanBuildState = 'passed' | 'failed' | 'stale' | 'unverified';

export interface LeanProjectSourceState {
    fingerprint: string;
    module?: string;
}

export interface LeanAnchorStatus {
    contract: LeanContractState;
    markdownChanges?: Array<'statement' | 'proof'>;
    build: LeanBuildState;
    dependencies: LeanDependencyState;
}

export interface LeanWorkspaceStatusSummary {
    contracts: Record<LeanContractState, number>;
    builds: Record<LeanBuildState, number>;
    dependencies: Record<LeanDependencyState, number>;
    projects: Record<string, LeanBuildState>;
}

export interface LeanContractRecord {
    formalFingerprint: string;
    proofFingerprint?: string;
    declarationFingerprint: string;
}

export interface LeanContractsArtifact {
    schemaVersion: 1;
    capturedAt: string;
    anchors: Record<string, LeanContractRecord>;
}

export interface LeanBuildProjectResult {
    command: string[];
    target?: string;
    sourceFingerprint: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    exitCode: number | null;
    passed: boolean;
    output: string;
}

export interface LeanBuildArtifact {
    schemaVersion: 1;
    updatedAt: string;
    projects: Record<string, LeanBuildProjectResult>;
}

function fingerprint(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeContractContent(value: string): string {
    return String(value || '')
        .normalize('NFKC')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/#(?:h-[0-9a-f]{16,32}|tmp-[A-Za-z0-9_-]+)/gi, '#id')
        .replace(/\s+/g, ' ')
        .trim();
}

function formalFingerprint(label: LabelData): string {
    return fingerprint(JSON.stringify({
        type: label.type,
        title: normalizeContractContent(label.title),
        content: normalizeContractContent(label.content || label.title)
    }));
}

function declarationFingerprint(index: LeanIndex, id: string): string {
    const declarations = index.anchors[id]?.declarations || [];
    return fingerprint(JSON.stringify(declarations.map(declaration => ({
        projectKey: declaration.projectKey,
        qualifiedName: declaration.qualifiedName || declaration.name,
        kind: declaration.kind,
        signatureFingerprint: declaration.signatureFingerprint
    })).sort((left, right) => (
        left.projectKey.localeCompare(right.projectKey)
        || left.qualifiedName.localeCompare(right.qualifiedName)
        || left.signatureFingerprint.localeCompare(right.signatureFingerprint)
    ))));
}

function contractsPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.math-workspace', LEAN_CONTRACTS_FILE);
}

function buildPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.math-workspace', LEAN_BUILD_FILE);
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
    } catch (error: any) {
        if (error?.code === 'ENOENT') return undefined;
        return undefined;
    }
}

function isContractsArtifact(value: LeanContractsArtifact | undefined): value is LeanContractsArtifact {
    return value?.schemaVersion === 1 && !!value.anchors && typeof value.anchors === 'object';
}

function isBuildArtifact(value: LeanBuildArtifact | undefined): value is LeanBuildArtifact {
    return value?.schemaVersion === 1 && !!value.projects && typeof value.projects === 'object';
}

export async function readLeanContracts(workspaceRoot: string): Promise<LeanContractsArtifact | undefined> {
    const artifact = await readJson<LeanContractsArtifact>(contractsPath(workspaceRoot));
    return isContractsArtifact(artifact) ? artifact : undefined;
}

export async function readLeanBuild(workspaceRoot: string): Promise<LeanBuildArtifact | undefined> {
    const artifact = await readJson<LeanBuildArtifact>(buildPath(workspaceRoot));
    return isBuildArtifact(artifact) ? artifact : undefined;
}

export function captureLeanContracts(index: LeanIndex, labels: Record<string, LabelData>): LeanContractsArtifact {
    const anchors: Record<string, LeanContractRecord> = {};
    for (const id of Object.keys(index.anchors).sort()) {
        const label = labels[id];
        if (!label) continue;
        anchors[id] = {
            formalFingerprint: formalFingerprint(label),
            proofFingerprint: fingerprint(normalizeContractContent(associatedProofContent(label, labels))),
            declarationFingerprint: declarationFingerprint(index, id)
        };
    }
    return { schemaVersion: 1, capturedAt: new Date().toISOString(), anchors };
}

export async function writeLeanContracts(workspaceRoot: string, contracts: LeanContractsArtifact): Promise<void> {
    await fs.mkdir(path.join(workspaceRoot, '.math-workspace'), { recursive: true });
    await fs.writeFile(contractsPath(workspaceRoot), `${JSON.stringify(contracts, null, 2)}\n`, 'utf8');
}

export async function applyLeanWorkspaceStatus(workspaceRoot: string, index: LeanIndex, labels: Record<string, LabelData>, dependencyGraph?: unknown): Promise<void> {
    const [contracts, build, dependencies] = await Promise.all([
        readLeanContracts(workspaceRoot),
        readLeanBuild(workspaceRoot),
        readLeanDependencyArtifact(workspaceRoot)
    ]);
    const dependenciesCurrent = !!dependencies && dependencies.inputFingerprint === leanDependencyInputFingerprint(index, dependencyGraph);
    const contractsSummary: Record<LeanContractState, number> = {
        current: 0,
        untracked: 0,
        'markdown-drifted': 0,
        'declaration-drifted': 0,
        drifted: 0
    };
    const buildsSummary: Record<LeanBuildState, number> = {
        passed: 0,
        failed: 0,
        stale: 0,
        unverified: 0
    };
    const dependenciesSummary: Record<LeanDependencyState, number> = {
        matched: 0,
        'markdown-gap': 0,
        supplemental: 0,
        unavailable: 0,
        stale: 0
    };
    const projectBuildStates: Record<string, LeanBuildState> = {};
    for (const project of index.projects) {
        const result = build?.projects?.[project.key];
        const current = index.projectSources[project.key]?.fingerprint;
        projectBuildStates[project.key] = !result
            ? 'unverified'
            : !current || result.sourceFingerprint !== current
                ? 'stale'
                : result.passed ? 'passed' : 'failed';
    }
    for (const [id, anchor] of Object.entries(index.anchors)) {
        const label = labels[id];
        const baseline = contracts?.anchors?.[id];
        const statementChanged = !!baseline && !!label && baseline.formalFingerprint !== formalFingerprint(label);
        const proofChanged = !!baseline?.proofFingerprint && !!label && baseline.proofFingerprint !== fingerprint(normalizeContractContent(associatedProofContent(label, labels)));
        const markdownChanged = statementChanged || proofChanged;
        const declarationChanged = !!baseline && baseline.declarationFingerprint !== declarationFingerprint(index, id);
        const contract: LeanContractState = !baseline || baseline.proofFingerprint === undefined
            ? 'untracked'
            : markdownChanged && declarationChanged
                ? 'drifted'
                : markdownChanged
                    ? 'markdown-drifted'
                    : declarationChanged
                        ? 'declaration-drifted'
                        : 'current';
        const projects = [...new Set(anchor.declarations.map(declaration => declaration.projectKey))];
        const buildStates = projects.map(projectKey => projectBuildStates[projectKey] || 'unverified');
        const buildState: LeanBuildState = buildStates.includes('failed')
            ? 'failed'
            : buildStates.includes('stale')
                ? 'stale'
                : buildStates.length > 0 && buildStates.every(state => state === 'passed')
                    ? 'passed'
                    : 'unverified';
        const comparison = dependencies?.comparisons?.[id];
        const dependencyState: LeanDependencyState = !dependencies
            ? 'unavailable'
            : !dependenciesCurrent
                ? 'stale'
                : comparison?.markdownOnly.length
                    ? 'markdown-gap'
                    : comparison?.leanOnly.length
                        ? 'supplemental'
                    : 'matched';
        anchor.status = { contract, build: buildState, dependencies: dependencyState,
            ...(markdownChanged ? { markdownChanges: [...(statementChanged ? ['statement' as const] : []), ...(proofChanged ? ['proof' as const] : [])] } : {}) };
        contractsSummary[contract]++;
        buildsSummary[buildState]++;
        dependenciesSummary[dependencyState]++;
    }
    index.statusSummary = { contracts: contractsSummary, builds: buildsSummary, dependencies: dependenciesSummary, projects: projectBuildStates };
}

function boundedOutput(result: any): string {
    const output = `${result?.stdout || ''}${result?.stderr || ''}`.trim();
    return output.length <= 12000 ? output : output.slice(-12000);
}

export async function buildLeanWorkspace(workspaceRoot: string, index: LeanIndex, projectKey?: string): Promise<LeanBuildArtifact> {
    const selected = index.projects.filter(project => !projectKey || project.key === projectKey);
    if (projectKey && selected.length === 0) throw new Error(`Unknown Lean project: ${projectKey}`);
    const previous = await readLeanBuild(workspaceRoot);
    const projects = { ...(previous?.projects || {}) };
    for (const project of selected) {
        const root = path.resolve(workspaceRoot, project.root);
        const sourceFingerprint = index.projectSources[project.key]?.fingerprint || '';
        const command = ['lake', 'build', ...(project.target ? [project.target] : [])];
        const started = new Date();
        const result = spawnSync(command[0], command.slice(1), {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024
        });
        const finished = new Date();
        projects[project.key] = {
            command,
            ...(project.target ? { target: project.target } : {}),
            sourceFingerprint,
            startedAt: started.toISOString(),
            finishedAt: finished.toISOString(),
            durationMs: Math.max(0, finished.getTime() - started.getTime()),
            exitCode: typeof result.status === 'number' ? result.status : null,
            passed: !result.error && result.status === 0,
            output: result.error ? String(result.error.message || result.error) : boundedOutput(result)
        };
    }
    const artifact: LeanBuildArtifact = { schemaVersion: 1, updatedAt: new Date().toISOString(), projects };
    await fs.mkdir(path.join(workspaceRoot, '.math-workspace'), { recursive: true });
    await fs.writeFile(buildPath(workspaceRoot), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    return artifact;
}
