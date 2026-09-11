import * as path from 'node:path';
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const os = require('node:os');

export const MAX_ARCHIVE_BYTES = 192 * 1024 * 1024;
export const MAX_ARCHIVE_OBJECTS = 30000;
export const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
export const ARCHIVE_DIRECTORY = '.math-archive';

export function sha256(data: any): string { return crypto.createHash('sha256').update(data).digest('hex'); }
export function digest(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid full SHA-256 digest.');
    return value;
}
export function relative(value: unknown): string {
    if (typeof value !== 'string' || !value || value.includes('\\') || /[\0\r\n]/.test(value)
        || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error('Archive paths must be normalized project-relative paths.');
    }
    return value;
}
export function canonical(value: unknown): any {
    const encode = (item: any): string => {
        if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
        if (typeof item === 'number' && Number.isSafeInteger(item)) return JSON.stringify(item);
        if (Array.isArray(item)) return '[' + item.map(encode).join(',') + ']';
        if (item && typeof item === 'object') {
            return '{' + Object.keys(item).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
                .map(key => JSON.stringify(key) + ':' + encode(item[key])).join(',') + '}';
        }
        throw new Error('Archive JSON accepts strings, safe integers, booleans, arrays and objects.');
    };
    return Buffer.from(encode(value) + '\n', 'utf8');
}
export function parseJson(data: any, exact = false): any {
    const value = JSON.parse(data.toString('utf8'));
    if (exact && !canonical(value).equals(data)) throw new Error('Archive JSON bytes are not canonical.');
    return value;
}
export async function exists(file: string): Promise<boolean> {
    try { await fs.lstat(file); return true; } catch (error: any) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function safePath(root: string, name: string): Promise<string> {
    const parts = relative(name).split('/');
    let current = path.resolve(root);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Archive roots cannot be symbolic links.');
    for (const part of parts) {
        current = path.join(current, part);
        try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Archive paths cannot pass through symbolic links.'); }
        catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    }
    return current;
}
export async function readFile(root: string, name: string, limit = MAX_ARCHIVE_BYTES): Promise<any> {
    const file = await safePath(root, name);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > limit) throw new Error('Archive input is not a bounded regular file.');
    return fs.readFile(file);
}
export async function readObject(root: string, hash: string): Promise<any> {
    const data = await readFile(root, `objects/${digest(hash)}`);
    if (sha256(data) !== hash) throw new Error(`Archive object has changed: ${hash}`);
    return data;
}
export async function writeObject(root: string, data: any): Promise<string> {
    const hash = sha256(data);
    await fs.mkdir(path.join(root, 'objects'), { recursive: true });
    const file = await safePath(root, `objects/${hash}`);
    try { await fs.writeFile(file, data, { flag: 'wx' }); }
    catch (error: any) {
        if (error.code !== 'EEXIST') throw error;
        if (!(await readObject(root, hash)).equals(data)) throw new Error('Archive object collision.');
    }
    return hash;
}
export async function atomicWrite(root: string, name: string, data: any): Promise<void> {
    const file = await safePath(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.tmp-' + crypto.randomBytes(12).toString('hex');
    let handle: any;
    try {
        handle = await fs.open(temporary, 'wx');
        await handle.writeFile(data); await handle.sync(); await handle.close(); handle = undefined;
        await fs.rename(temporary, file);
    } finally { if (handle) await handle.close(); await fs.rm(temporary, { force: true }); }
}
export async function withLock<T>(root: string, work: () => Promise<T>): Promise<T> {
    const file = await safePath(root, 'LOCK.json');
    const token = crypto.randomBytes(16).toString('hex');
    try { await fs.writeFile(file, canonical({ pid: process.pid, host: os.hostname(), token }), { flag: 'wx' }); }
    catch (error: any) {
        if (error.code === 'EEXIST') throw new Error('Another archive operation owns this project. If it exited, use archive recover-lock.');
        throw error;
    }
    try { return await work(); }
    finally {
        if (parseJson(await readFile(root, 'LOCK.json')).token === token) await fs.unlink(file);
    }
}
export async function recoverLock(root: string): Promise<void> {
    const data = await readFile(root, 'LOCK.json'); const lock = parseJson(data);
    if (lock.host !== os.hostname() || !Number.isInteger(lock.pid) || lock.pid < 1) throw new Error('Cannot recover a lock belonging to another host.');
    try { process.kill(lock.pid, 0); throw new Error('The archive owner process is still running.'); }
    catch (error: any) { if (error.code !== 'ESRCH') throw error; }
    if (!(await readFile(root, 'LOCK.json')).equals(data)) throw new Error('The archive lock changed during recovery.');
    await fs.unlink(await safePath(root, 'LOCK.json'));
}
