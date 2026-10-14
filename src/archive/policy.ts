import * as path from 'node:path';
import { canonical, digest, relative } from './io';
import { sameIdentity, validIdentity } from './sigstore';
import type { ArchivePolicy, ArchiveScope, ArchiveVolume } from './types';

export function validWorkId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error('Invalid stable work identifier.');
    return value;
}
export function validScope(value: any): ArchiveScope {
    if (!value || !Array.isArray(value.paths) || !value.paths.length || value.paths.length > 128
        || !Array.isArray(value.extensions) || !value.extensions.length
        || value.extensions.some(item => typeof item !== 'string' || !/^\.[a-zA-Z0-9]+$/.test(item))) throw new Error('An explicit archive file scope is required.');
    const paths = value.paths.map(relative);
    if (new Set(paths).size !== paths.length) throw new Error('Archive scope paths must be unique.');
    if (value.maxDepth !== undefined && (!Number.isSafeInteger(value.maxDepth) || value.maxDepth < 1 || value.maxDepth > 100)) throw new Error('Invalid archive scope depth.');
    if (value.exclude !== undefined && (!Array.isArray(value.exclude) || value.exclude.length > 128)) throw new Error('Invalid archive exclusions.');
    return { paths: [...paths].sort(), extensions: [...new Set<string>(value.extensions)].sort(),
        ...(value.maxDepth !== undefined ? { maxDepth: value.maxDepth } : {}),
        ...(value.exclude !== undefined ? { exclude: [...new Set<string>(value.exclude.map(relative))].sort() } : {}) };
}
export function fileMap(value: any): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 30000) throw new Error('Invalid archive file map.');
    return Object.fromEntries(Object.entries(value).map(([name, hash]) => [relative(name), digest(hash)]));
}
export const sameJson = (a: unknown, b: unknown): boolean => canonical(a).equals(canonical(b));
export const matchesPath = (name: string, prefix: string): boolean => name === prefix || name.startsWith(prefix + '/');
export function inScope(name: string, scope: ArchiveScope): boolean {
    if (name.split('/').some(part => part === '.git' || part === '.math-archive')
        || scope.exclude?.some(prefix => matchesPath(name, prefix))) return false;
    return scope.paths.some(prefix => name === prefix || name.startsWith(prefix + '/')
        && scope.extensions.includes(path.extname(name).toLowerCase())
        && name.slice(prefix.length + 1).split('/').length <= (scope.maxDepth || 100)
        && !name.slice(prefix.length + 1).split('/').some(part => part.startsWith('.')));
}
export function validPolicy(value: any): ArchivePolicy {
    if (value?.schema !== 'math-workspace.archive-policy/v1' || typeof value.title !== 'string' || !value.title || value.title.length > 300
        || !Array.isArray(value.identities) || !value.identities.length || value.identities.length > 32) throw new Error('Invalid academic archive policy.');
    const identities = value.identities.map(validIdentity), signingIdentity = validIdentity(value.signingIdentity);
    if (!identities.some(identity => sameIdentity(identity, signingIdentity))) throw new Error('The active signer must be an accepted project identity.');
    const scope = validScope(value.scope);
    let volumes: ArchiveVolume[] | undefined;
    if (value.volumes !== undefined) {
        if (!Array.isArray(value.volumes) || value.volumes.length > 128) throw new Error('Invalid declared archive volumes.');
        const ids = new Set<string>(), prefixes: string[] = [];
        volumes = value.volumes.map(volume => {
            const id = validWorkId(volume?.id);
            if (ids.has(id)) throw new Error('Archive volume identifiers must be unique.'); ids.add(id);
            if (typeof volume.title !== 'string' || !volume.title || volume.title.length > 200
                || !Array.isArray(volume.paths) || !volume.paths.length || volume.paths.length > 128) throw new Error('A volume requires a title and explicit paths.');
            const paths = volume.paths.map(relative).sort();
            for (const prefix of paths) {
                if (!scope.paths.some(root => matchesPath(prefix, root)) || scope.exclude?.some(exclude => matchesPath(prefix, exclude))) throw new Error('A declared volume path is outside the archive scope.');
                if (prefixes.some(old => matchesPath(prefix, old) || matchesPath(old, prefix))) throw new Error('Declared volume paths overlap.');
                prefixes.push(prefix);
            }
            return { id, title: volume.title, paths };
        }).sort((a, b) => a.id.localeCompare(b.id));
    }
    return { schema: value.schema, workId: validWorkId(value.workId), title: value.title, scope, identities, signingIdentity,
        ...(volumes !== undefined ? { volumes } : {}) };
}
export function partitionFiles(files: Record<string, string>, policy: ArchivePolicy) {
    const volumes = (policy.volumes || []).map(volume => ({ ...volume, files: {} as Record<string, string> }));
    const outside: Record<string, string> = {};
    for (const [name, hash] of Object.entries(fileMap(files))) {
        if (!inScope(name, policy.scope)) throw new Error('A snapshot file is outside its signed scope.');
        const matches = volumes.filter(volume => volume.paths.some(prefix => matchesPath(name, prefix)));
        if (matches.length > 1) throw new Error('A snapshot file belongs to overlapping volumes.');
        if (matches.length) {
            matches[0].files[name] = hash;
        } else outside[name] = hash;
    }
    return { volumes, outside };
}
