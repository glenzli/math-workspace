import * as path from 'node:path';
import type { ReaderGitChanges } from './git-change-types';

const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const os = require('node:os');

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const cache = new Map<string, ReaderGitChanges>();
const environment = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' });
function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
    return new Promise(resolve => execFile('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
        { cwd, env: environment(), encoding: 'utf8', timeout: 2500, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (error: any, stdout: string) => resolve({ code: error ? typeof error.code === 'number' ? error.code : -1 : 0, stdout: stdout || '' })));
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
        result.status = 'ready'; result.baseline = baseline;
        if (previous.stdout !== content) {
            // A neutral temporary directory keeps attributes and filters in the writing project out of this comparison.
            temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-git-lines-'));
            await fs.writeFile(path.join(temporary, 'before'), previous.stdout);
            await fs.writeFile(path.join(temporary, 'after'), content);
            const diff = await git(temporary, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--text', '--unified=0', '--ignore-cr-at-eol', '--', 'before', 'after']);
            if (diff.code !== 0 && diff.code !== 1) return { ...result, status: 'unavailable' };
            for (const match of diff.stdout.matchAll(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
                const startLine = Number(match[2]), count = match[3] === undefined ? 1 : Number(match[3]);
                if (count) result.ranges.push({ startLine, endLine: startLine + count - 1 });
                else result.deletions.push({ afterLine: startLine, count: match[1] === undefined ? 1 : Number(match[1]) });
            }
        }
        if (await fs.readFile(file, 'utf8') !== content || (await git(realRoot, ['rev-parse', '--verify', 'HEAD'])).stdout.trim() !== commit) return { ...result, status: 'stale', ranges: [], deletions: [] };
        cache.set(key, result);
        if (cache.size > 64) cache.delete(cache.keys().next().value!);
        return result;
    } catch { return { ...result, status: 'unavailable', ranges: [], deletions: [] }; }
    finally { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
}
