import * as path from 'node:path';
import { ARCHIVE_DIRECTORY, canonical, MAX_SOURCE_BYTES, readFile, safePath, sha256 } from './io';
import { validScope } from './policy';
import type { ArchiveScope } from './types';
const fs = require('node:fs/promises');

export async function captureSource(projectRoot: string, scope: ArchiveScope): Promise<Map<string, any>> {
    scope = validScope(scope);
    const files = new Map<string, any>(); let total = 0;
    const excluded = new Set(['.git', '.math-archive', '.signatures', 'node_modules', 'out', 'dist']);
    const visit = async (name: string, depth: number, explicit: boolean) => {
        const file = await safePath(projectRoot, name), stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) throw new Error('Snapshot inputs cannot be symbolic links.');
        if (scope.exclude?.some(prefix => name === prefix || name.startsWith(prefix + '/'))) return;
        if (name.split('/').includes(ARCHIVE_DIRECTORY) || name.split('/').includes('.git')) throw new Error('An archive cannot include itself or Git internals.');
        if (stat.isDirectory()) {
            if (depth >= (scope.maxDepth || 100)) return;
            const names = (await fs.readdir(file)).sort();
            for (const child of names) {
                if (child.startsWith('.') || excluded.has(child)) continue;
                await visit(`${name}/${child}`, depth + 1, false);
            }
        } else if (stat.isFile() && (explicit || scope.extensions.includes(path.extname(name).toLowerCase()))) {
            if (files.has(name)) return;
            if (stat.size > MAX_SOURCE_BYTES || total + stat.size > MAX_SOURCE_BYTES || files.size >= 10000) throw new Error('Snapshot exceeds its file or byte limit.');
            const data = await readFile(projectRoot, name, MAX_SOURCE_BYTES); total += data.length;
            files.set(name, data);
        }
    };
    for (const name of scope.paths) await visit(name, 0, true);
    if (!files.size) throw new Error('The declared snapshot scope is empty.');
    return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}
export function hashFiles(files: Map<string, any>): Record<string, string> { return Object.fromEntries([...files].map(([name, data]) => [name, sha256(data)])); }
export function equal(a: unknown, b: unknown): boolean { return canonical(a).equals(canonical(b)); }
export function compareFiles(previous: Record<string, string>, current: Record<string, string>) {
    return [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort().flatMap(name => {
        if (previous[name] === current[name]) return [];
        return [{ path: name, change: !Object.hasOwn(previous, name) ? 'added' : !Object.hasOwn(current, name) ? 'removed' : 'modified' }];
    });
}

