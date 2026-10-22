import * as path from 'node:path';
import type { ReaderGitChanges, ReaderGitFileChanges, ReaderGitPrevious } from './git-change-types';

const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const os = require('node:os');

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const cache = new Map<string, ReaderGitChanges>();
const environment = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' });
function git(cwd: string, args: string[], input?: string): Promise<{ code: number; stdout: string }> {
    return new Promise(resolve => {
        const child = execFile('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
        { cwd, env: environment(), encoding: 'utf8', timeout: 2500, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (error: any, stdout: string) => resolve({ code: error ? typeof error.code === 'number' ? error.code : -1 : 0, stdout: stdout || '' }));
        child.stdin.on('error', () => {});
        child.stdin.end(input);
    });
}

/** Compare only project snapshots to Git blobs in batches, without invoking working-tree filters. */
export async function readReaderGitFileChanges(root: string, documents: Map<string, string>): Promise<ReaderGitFileChanges> {
    const unavailable: ReaderGitFileChanges = { status: 'unavailable', files: {} };
    try {
        const realRoot = await fs.realpath(root);
        const top = await git(realRoot, ['rev-parse', '--show-toplevel']);
        if (top.code !== 0) return { ...unavailable, status: top.code === 128 ? 'not-git' : 'unavailable' };
        const repository = top.stdout.replace(/\r?\n$/, '');
        const prefix = path.relative(repository, realRoot).split(path.sep).join('/');
        const head = await git(realRoot, ['rev-parse', '--verify', 'HEAD']);
        if (head.code !== 0 && head.code !== 128) return unavailable;
        const commit = head.code === 0 ? head.stdout.trim() : '';
        const tree = commit ? await git(realRoot, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', '.']) : { code: 0, stdout: '' };
        const tracked = await git(realRoot, ['ls-files', '-z']);
        if (tree.code !== 0 || tracked.code !== 0) return unavailable;
        const blobs = new Map<string, string>();
        for (const entry of tree.stdout.split('\0')) {
            const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]*)$/.exec(entry);
            if (match) blobs.set(match[3], match[2]);
        }
        const trackedPaths = new Set(tracked.stdout.split('\0'));
        const files: ReaderGitFileChanges['files'] = {};
        const comparisons: Array<{ filePath: string; content: string; blob: string }> = [];
        const newPaths: string[] = [];
        for (const [filePath, content] of documents) {
            if (!filePath || path.isAbsolute(filePath) || filePath.split(/[\\/]/).some(part => part === '..')) continue;
            const blob = blobs.get(prefix ? prefix + '/' + filePath : filePath);
            if (blob) {
                const blobHash = (text: string) => createHash(blob.length === 64 ? 'sha256' : 'sha1')
                    .update(`blob ${Buffer.byteLength(text, 'utf8')}\0`).update(text).digest('hex');
                if (blob !== blobHash(content) && blob !== blobHash(content.replace(/\r\n/g, '\n'))) comparisons.push({ filePath, content, blob });
            } else if (trackedPaths.has(filePath)) files[filePath] = 'added';
            else newPaths.push(filePath);
        }
        if (newPaths.length) {
            const ignored = await git(realRoot, ['check-ignore', '-z', '--stdin'], newPaths.join('\0') + '\0');
            if (ignored.code !== 0 && ignored.code !== 1) return unavailable;
            const ignoredPaths = new Set(ignored.stdout.split('\0'));
            newPaths.filter(filePath => !ignoredPaths.has(filePath)).forEach(filePath => { files[filePath] = 'added'; });
        }
        // Bound each batch so a large writing project cannot overflow the subprocess output limit.
        for (let start = 0; start < comparisons.length; start += 8) {
            const batch = comparisons.slice(start, start + 8);
            const result = await git(realRoot, ['cat-file', '--batch'], batch.map(item => item.blob).join('\n') + '\n');
            if (result.code !== 0) return unavailable;
            const bytes = Buffer.from(result.stdout, 'utf8');
            let offset = 0;
            for (const item of batch) {
                const end = bytes.indexOf(10, offset);
                const header = bytes.subarray(offset, end).toString('utf8').match(/^[a-f0-9]+ blob (\d+)$/);
                if (end < offset || !header) return unavailable;
                const size = Number(header[1]), body = end + 1;
                if (body + size >= bytes.length || bytes[body + size] !== 10) return unavailable;
                const previous = bytes.subarray(body, body + size).toString('utf8');
                if (previous.replace(/\r\n/g, '\n') !== item.content.replace(/\r\n/g, '\n')) files[item.filePath] = 'modified';
                offset = body + size + 1;
            }
        }
        if ((await git(realRoot, ['rev-parse', '--verify', 'HEAD'])).stdout.trim() !== commit) return unavailable;
        return { status: 'ready', files };
    } catch { return unavailable; }
}

/** Compare the rendered snapshot to committed bytes, never running project diff/text conversion filters. */
export async function readReaderGitChanges(root: string, filePath: string, content: string): Promise<ReaderGitChanges> {
    const result: ReaderGitChanges = { filePath, sourceHash: hash(content), status: 'unavailable', ranges: [], deletions: [] };
    let temporary: string | undefined;
    try {
        if (!filePath || path.isAbsolute(filePath) || filePath.split(/[\\/]/).some(part => part === '..') || content.length > 2 * 1024 * 1024) return result;
        const realRoot = await fs.realpath(root), file = await fs.realpath(path.join(root, filePath));
        if (path.relative(realRoot, file).startsWith('..') || await fs.readFile(file, 'utf8') !== content) return { ...result, status: 'stale' };
        const top = await git(realRoot, ['rev-parse', '--show-toplevel']);
        if (top.code !== 0) return { ...result, status: top.code === 128 ? 'not-git' : 'unavailable' };
        const repository = top.stdout.replace(/\r?\n$/, ''), relative = path.relative(repository, file).split(path.sep).join('/');
        const head = await git(realRoot, ['rev-parse', '--verify', 'HEAD']);
        const commit = head.code === 0 ? head.stdout.trim() : '';
        const previous = commit ? await git(realRoot, ['cat-file', 'blob', `${commit}:${relative}`]) : { code: 1, stdout: '' };
        if (previous.code !== 0 && previous.code !== 1 && previous.code !== 128) return result;
        if (previous.code !== 0) {
            const tracked = await git(realRoot, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', filePath]);
            const ignored = tracked.code === 0 ? false : (await git(realRoot, ['check-ignore', '--quiet', '--', filePath])).code === 0;
            if (ignored) return { ...result, status: 'ignored' };
        }
        const baseline = previous.code === 0 ? 'HEAD' : 'new-file';
        const key = `${realRoot}\0${filePath}\0${commit}\0${result.sourceHash}\0${baseline}`;
        const cached = cache.get(key);
        if (cached) return cached;
        result.status = 'ready'; result.baseline = baseline; result.commit = commit; result.hunks = [];
        if (previous.stdout !== content) {
            // A neutral temporary directory keeps attributes and filters in the writing project out of this comparison.
            temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-git-lines-'));
            await fs.writeFile(path.join(temporary, 'before'), previous.stdout);
            await fs.writeFile(path.join(temporary, 'after'), content);
            const diff = await git(temporary, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--text', '--unified=0', '--ignore-cr-at-eol', '--', 'before', 'after']);
            if (diff.code !== 0 && diff.code !== 1) return { ...result, status: 'unavailable' };
            for (const match of diff.stdout.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
                const beforeStartLine = Number(match[1]), beforeCount = match[2] === undefined ? 1 : Number(match[2]);
                const startLine = Number(match[3]), count = match[4] === undefined ? 1 : Number(match[4]);
                result.hunks.push({ startLine, count, beforeStartLine, beforeCount });
                if (count) result.ranges.push({ startLine, endLine: startLine + count - 1 });
                else result.deletions.push({ afterLine: startLine, count: beforeCount });
            }
        }
        if (await fs.readFile(file, 'utf8') !== content || (await git(realRoot, ['rev-parse', '--verify', 'HEAD'])).stdout.trim() !== commit) return { ...result, status: 'stale', ranges: [], deletions: [] };
        cache.set(key, result);
        if (cache.size > 64) cache.delete(cache.keys().next().value!);
        return result;
    } catch { return { ...result, status: 'unavailable', ranges: [], deletions: [] }; }
    finally { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
}

/** Prior prose is returned only for an explicit, protected preview request. */
export async function readReaderGitPrevious(root: string, filePath: string, content: string): Promise<ReaderGitPrevious> {
    const changes = await readReaderGitChanges(root, filePath, content);
    const result: ReaderGitPrevious = { filePath, sourceHash: changes.sourceHash, status: changes.status, baseline: changes.baseline, commit: changes.commit, hunks: changes.hunks };
    if (changes.status !== 'ready' || changes.baseline === 'new-file') return result;
    try {
        const realRoot = await fs.realpath(root), file = await fs.realpath(path.join(root, filePath));
        const top = await git(realRoot, ['rev-parse', '--show-toplevel']);
        if (top.code !== 0) return { ...result, status: 'unavailable' };
        const relative = path.relative(top.stdout.replace(/\r?\n$/, ''), file).split(path.sep).join('/');
        const before = await git(realRoot, ['cat-file', 'blob', `${changes.commit}:${relative}`]);
        if (before.code !== 0) return { ...result, status: 'unavailable' };
        if (await fs.readFile(file, 'utf8') !== content || (await git(realRoot, ['rev-parse', '--verify', 'HEAD'])).stdout.trim() !== changes.commit) return { ...result, status: 'stale' };
        return { ...result, content: before.stdout };
    } catch { return { ...result, status: 'unavailable' }; }
}
