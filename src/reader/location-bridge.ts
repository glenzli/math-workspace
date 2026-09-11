import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { mathWorkspaceStatePath } from './local-state';

const http = require('node:http');
const nodeFs = require('node:fs');
const { URL } = require('node:url');

export interface ReaderSourceLocation {
    filePath: string;
    line?: number;
    column?: number;
}

export interface ReaderInstanceRecord {
    rootPath: string;
    url: string;
    token: string;
    pid: number;
    updatedAt: string;
}

export interface ReaderLocationDispatch {
    url: string;
    delivered: number;
}

interface ReaderInstanceState {
    version: 1;
    instances: ReaderInstanceRecord[];
}

const MAX_READER_INSTANCES = 12;

export function defaultReaderInstancesPath(): string {
    return process.env.MATH_WORKSPACE_READER_INSTANCES || mathWorkspaceStatePath('reader-instances.json');
}

export function readerLocationUrl(baseUrl: string, location: ReaderSourceLocation): string {
    const url = new URL('/', baseUrl);
    url.searchParams.set('path', location.filePath);
    if (location.line) url.searchParams.set('line', String(location.line));
    if (location.column) url.searchParams.set('column', String(location.column));
    return url.toString();
}

async function readState(stateFilePath: string): Promise<ReaderInstanceState> {
    try {
        const parsed = JSON.parse(await fs.readFile(stateFilePath, 'utf8'));
        if (!Array.isArray(parsed?.instances)) return { version: 1, instances: [] };
        return {
            version: 1,
            instances: parsed.instances.filter((item: any) => (
                typeof item?.rootPath === 'string'
                && typeof item?.url === 'string'
                && typeof item?.token === 'string'
                && Number.isInteger(item?.pid)
                && typeof item?.updatedAt === 'string'
            ))
        };
    } catch (error: any) {
        if (error?.code === 'ENOENT') return { version: 1, instances: [] };
        return { version: 1, instances: [] };
    }
}

async function writeState(stateFilePath: string, instances: ReaderInstanceRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
    const temporaryPath = `${stateFilePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({ version: 1, instances }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await nodeFs.promises.rename(temporaryPath, stateFilePath);
}

export async function registerReaderInstance(
    record: Omit<ReaderInstanceRecord, 'pid' | 'updatedAt'>,
    stateFilePath = defaultReaderInstancesPath()
): Promise<void> {
    const state = await readState(stateFilePath);
    const next: ReaderInstanceRecord = {
        ...record,
        pid: process.pid,
        updatedAt: new Date().toISOString()
    };
    const instances = [next, ...state.instances.filter(item => item.url !== record.url && item.rootPath !== record.rootPath)]
        .slice(0, MAX_READER_INSTANCES);
    await writeState(stateFilePath, instances);
}

export async function unregisterReaderInstance(
    url: string,
    stateFilePath = defaultReaderInstancesPath()
): Promise<void> {
    const state = await readState(stateFilePath);
    const instances = state.instances.filter(item => item.url !== url);
    if (instances.length !== state.instances.length) await writeState(stateFilePath, instances);
}

function postLocation(record: ReaderInstanceRecord, location: ReaderSourceLocation): Promise<number> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(location);
        const endpoint = new URL('/api/open-location', record.url);
        const request = http.request({
            hostname: endpoint.hostname,
            port: endpoint.port,
            path: endpoint.pathname,
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
                'x-math-workspace-bridge-token': record.token
            }
        }, (response: any) => {
            let responseBody = '';
            response.on('data', (chunk: unknown) => { responseBody += String(chunk); });
            response.on('end', () => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Reader rejected the location with status ${response.statusCode}.`));
                    return;
                }
                try {
                    const parsed = JSON.parse(responseBody);
                    resolve(Number.isInteger(parsed?.delivered) ? parsed.delivered : 0);
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.setTimeout(1200, () => request.destroy(new Error('Reader location request timed out.')));
        request.once('error', reject);
        request.end(body);
    });
}

export async function dispatchReaderLocation(
    rootPath: string,
    location: ReaderSourceLocation,
    stateFilePath = defaultReaderInstancesPath()
): Promise<ReaderLocationDispatch | undefined> {
    const state = await readState(stateFilePath);
    const matching = state.instances.filter(item => item.rootPath === rootPath);
    const failed = new Set<string>();
    for (const record of matching) {
        try {
            const delivered = await postLocation(record, location);
            if (failed.size) await writeState(stateFilePath, state.instances.filter(item => !failed.has(item.url)));
            return { url: readerLocationUrl(record.url, location), delivered };
        } catch (_error) {
            failed.add(record.url);
        }
    }
    if (failed.size) await writeState(stateFilePath, state.instances.filter(item => !failed.has(item.url)));
    return undefined;
}
