import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { pathPatternMatches, toPosix } from '@math-workspace/core';

export type DocumentMode = 'formal' | 'draft';
export type DocumentStage = 'draft' | 'revising' | 'stable';

export interface DocumentCollection {
    id: string;
    title: string;
    mode: 'draft';
    include: string[];
}

export interface DocumentCheckpoint {
    label: string;
    contentHash: string;
    recordedAt: string;
}

export interface DocumentStateRecord {
    stage?: DocumentStage;
    stableContentHash?: string;
    checkpoint?: DocumentCheckpoint;
    updatedAt?: string;
}

export interface DocumentLifecycle {
    mode: DocumentMode;
    collectionId?: string;
    collectionTitle?: string;
    stage?: DocumentStage;
    changedSinceStable?: boolean;
    checkpoint?: DocumentCheckpoint;
    changedSinceCheckpoint: boolean;
}

export interface DocumentStateSnapshot {
    schemaVersion: 1;
    stateFile: string;
    records: Record<string, DocumentStateRecord>;
    lifecycles: Record<string, DocumentLifecycle>;
    orphaned: string[];
}

export interface DocumentLifecycleUpdate {
    filePath: string;
    stage?: DocumentStage;
    checkpointLabel?: string;
    clearCheckpoint?: boolean;
}

const STATE_FILE = '.math-workspace/documents.json';
const STAGES = new Set<DocumentStage>(['draft', 'revising', 'stable']);
const HARD_IGNORED_DIRECTORIES = new Set([
    '.git',
    '.lake',
    '.math-workspace',
    'node_modules',
    'out',
    'dist',
    '.vscode-test'
]);

function normalizedRelativePath(value: unknown): string {
    if (typeof value !== 'string') return '';
    const normalized = toPosix(value).replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normalized || normalized.startsWith('../') || normalized.includes('/../') || path.posix.isAbsolute(normalized)) return '';
    return normalized;
}

function normalizedStage(value: unknown): DocumentStage | undefined {
    return typeof value === 'string' && STAGES.has(value as DocumentStage)
        ? value as DocumentStage
        : undefined;
}

function normalizedCheckpoint(value: unknown): DocumentCheckpoint | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    const contentHash = typeof raw.contentHash === 'string' ? raw.contentHash.trim() : '';
    const recordedAt = typeof raw.recordedAt === 'string' ? raw.recordedAt.trim() : '';
    if (!label || label.length > 80 || !/^[a-f0-9]{64}$/i.test(contentHash) || !recordedAt || recordedAt.length > 80) return undefined;
    return { label, contentHash: contentHash.toLowerCase(), recordedAt };
}

function normalizedRecord(value: unknown): DocumentStateRecord | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    const stage = normalizedStage(raw.stage);
    const stableContentHash = typeof raw.stableContentHash === 'string' && /^[a-f0-9]{64}$/i.test(raw.stableContentHash)
        ? raw.stableContentHash.toLowerCase() : undefined;
    const checkpoint = normalizedCheckpoint(raw.checkpoint);
    const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.length <= 80 ? raw.updatedAt : undefined;
    if (!stage && !checkpoint) return undefined;
    return {
        ...(stage ? { stage } : {}),
        ...(stage === 'stable' && stableContentHash ? { stableContentHash } : {}),
        ...(checkpoint ? { checkpoint } : {}),
        ...(updatedAt ? { updatedAt } : {})
    };
}

function sourceHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

function configuredCollections(config: any): DocumentCollection[] {
    const raw = Array.isArray(config?.documents?.collections) ? config.documents.collections : [];
    const used = new Set<string>();
    const collections: DocumentCollection[] = [];
    for (const candidate of raw) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const item = candidate as Record<string, unknown>;
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        const mode = item.mode;
        const include = Array.isArray(item.include)
            ? item.include.map(normalizedRelativePath).filter(Boolean)
            : [];
        if (!id || id.length > 80 || used.has(id) || mode !== 'draft' || include.length === 0) continue;
        used.add(id);
        const title = typeof item.title === 'string' && item.title.trim()
            ? item.title.trim().slice(0, 120)
            : id;
        collections.push({ id, title, mode, include: [...new Set(include)] });
    }
    return collections;
}

export function documentCollections(config: any): DocumentCollection[] {
    return configuredCollections(config);
}

export function documentCollectionForPath(filePath: string, config: any): DocumentCollection | undefined {
    const normalized = normalizedRelativePath(filePath);
    if (!normalized) return undefined;
    return configuredCollections(config).find(collection => collection.include.some(pattern => pathPatternMatches(normalized, pattern)));
}

export function documentModeForPath(filePath: string, config: any): DocumentMode {
    return documentCollectionForPath(filePath, config) ? 'draft' : 'formal';
}

export function collectionMayContainPath(directoryPath: string, collection: DocumentCollection): boolean {
    const directory = normalizedRelativePath(directoryPath);
    if (!directory) return true;
    return collection.include.some(pattern => {
        const prefix = normalizedRelativePath(pattern.split(/[?*]/, 1)[0]);
        if (!prefix) return true;
        return prefix === directory || prefix.startsWith(`${directory}/`) || directory.startsWith(`${prefix}/`);
    });
}

export function isHardIgnoredDirectory(name: string): boolean {
    return HARD_IGNORED_DIRECTORIES.has(name);
}

export function documentStateRelativePath(config: any): string {
    const configured = normalizedRelativePath(config?.documents?.stateFile);
    return configured || STATE_FILE;
}

function emptyState(stateFile: string): DocumentStateSnapshot {
    return { schemaVersion: 1, stateFile, records: {}, lifecycles: {}, orphaned: [] };
}

async function readRecords(rootPath: string, config: any): Promise<{ stateFile: string; records: Record<string, DocumentStateRecord> }> {
    const stateFile = documentStateRelativePath(config);
    const absolute = path.join(rootPath, stateFile);
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(absolute, 'utf8'));
    } catch (error: any) {
        if (error?.code === 'ENOENT') return { stateFile, records: {} };
        throw new Error(`Could not read ${stateFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${stateFile} must contain an object.`);
    }
    const rawRecords = (parsed as Record<string, unknown>).documents;
    if (!rawRecords || typeof rawRecords !== 'object' || Array.isArray(rawRecords)) return { stateFile, records: {} };
    const records: Record<string, DocumentStateRecord> = {};
    for (const [filePath, value] of Object.entries(rawRecords as Record<string, unknown>)) {
        const normalized = normalizedRelativePath(filePath);
        const record = normalizedRecord(value);
        if (normalized && record) records[normalized] = record;
    }
    return { stateFile, records };
}

export async function readDocumentState(rootPath: string, config: any, documents: Map<string, string>): Promise<DocumentStateSnapshot> {
    const { stateFile, records } = await readRecords(rootPath, config);
    const state = emptyState(stateFile);
    state.records = records;
    documents.forEach((content, filePath) => {
        const collection = documentCollectionForPath(filePath, config);
        const record = collection ? undefined : records[filePath];
        const checkpoint = record?.checkpoint;
        const contentHash = sourceHash(content);
        const changedSinceStable = record?.stage === 'stable' && !!record.stableContentHash && record.stableContentHash !== contentHash;
        state.lifecycles[filePath] = {
            mode: collection ? 'draft' : 'formal',
            ...(collection ? { collectionId: collection.id, collectionTitle: collection.title } : {}),
            ...(collection ? {} : { stage: changedSinceStable ? 'revising' : record?.stage || 'draft', changedSinceStable }),
            ...(checkpoint ? { checkpoint } : {}),
            changedSinceCheckpoint: !!checkpoint && checkpoint.contentHash !== contentHash
        };
    });
    state.orphaned = Object.keys(records).filter(filePath => !documents.has(filePath)).sort();
    return state;
}

function validCheckpointLabel(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const label = value.trim();
    if (!label || label.length > 80 || /[\r\n]/.test(label)) return undefined;
    return label;
}

export async function updateDocumentState(
    rootPath: string,
    config: any,
    documents: Map<string, string>,
    update: DocumentLifecycleUpdate
): Promise<DocumentStateSnapshot> {
    const filePath = normalizedRelativePath(update.filePath);
    const content = documents.get(filePath);
    if (!filePath || content === undefined) throw new Error('The document is not part of the bound Math Workspace project.');
    const stage = update.stage === undefined ? undefined : normalizedStage(update.stage);
    if (documentCollectionForPath(filePath, config)) throw new Error('Draft collections do not use formal document stages or milestones.');
    const checkpointLabel = update.checkpointLabel === undefined ? undefined : validCheckpointLabel(update.checkpointLabel);
    if (update.stage !== undefined && !stage) throw new Error('The document stage is invalid.');
    if (update.checkpointLabel !== undefined && !checkpointLabel) throw new Error('The version label is invalid.');
    if (!stage && checkpointLabel === undefined && !update.clearCheckpoint) throw new Error('Choose a stage or a version label.');

    const { stateFile, records } = await readRecords(rootPath, config);
    const previous = records[filePath] || {};
    const next: DocumentStateRecord = {
        ...previous,
        ...(stage ? { stage } : {}),
        updatedAt: new Date().toISOString()
    };
    if (stage === 'stable') next.stableContentHash = sourceHash(content);
    else if (stage) delete next.stableContentHash;
    if (checkpointLabel) {
        next.checkpoint = {
            label: checkpointLabel,
            contentHash: sourceHash(content),
            recordedAt: new Date().toISOString()
        };
    }
    if (update.clearCheckpoint) delete next.checkpoint;
    records[filePath] = next;

    const sorted = Object.fromEntries(Object.entries(records).sort(([left], [right]) => left.localeCompare(right)));
    const target = path.join(rootPath, stateFile);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify({ schemaVersion: 1, documents: sorted }, null, 2)}\n`, 'utf8');
    return readDocumentState(rootPath, config, documents);
}
