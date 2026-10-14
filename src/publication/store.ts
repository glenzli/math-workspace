import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { PublicationArtifact, PublicationBuild, PublicationProfile, PublicationProfileRecord, PublicationRemoteState } from './types';

const fs = require('node:fs/promises');
export const sha256 = (value: any): string => crypto.createHash('sha256').update(value).digest('hex');
export function canonical(value: any): string {
    const sort = (item: any): any => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object'
        ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, sort(item[key])])) : item;
    return `${JSON.stringify(sort(value), null, 2)}\n`;
}
export function publicationId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) throw new Error('Invalid publication identity.');
    return value;
}
export function buildId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new Error('Invalid publication build identity.');
    return value;
}
export function relativeInput(value: unknown): string {
    if (typeof value !== 'string' || !value || value.includes('\\') || /[\u0000-\u001f]/.test(value) || path.isAbsolute(value)
        || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Publication paths must be normalized files inside the project.');
    return value;
}
/** Reject symlinks in every existing component, including state/output paths. */
export async function safePath(root: string, relative: string): Promise<string> {
    relativeInput(relative);
    let current = root;
    for (const component of relative.split('/')) {
        current = path.join(current, component);
        try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Publication paths cannot follow symbolic links.'); }
        catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    }
    return current;
}
export async function optionalJson(file: string): Promise<any | null> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function atomicJson(root: string, relative: string, value: any): Promise<void> {
    const destination = await safePath(root, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await safePath(root, relative);
    const temporary = `${destination}.tmp-${crypto.randomBytes(12).toString('hex')}`;
    try { await fs.writeFile(temporary, canonical(value), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, destination); }
    finally { await fs.rm(temporary, { force: true }); }
}

export class PublicationStore {
    readonly root: string;
    readonly relativeDirectory = '.math-workspace/publications';
    constructor(root: string) { this.root = path.resolve(root); }
    async directory(relative = ''): Promise<string> { return safePath(this.root, `${this.relativeDirectory}${relative ? `/${relative}` : ''}`); }
    async locked<T>(id: string, action: () => Promise<T>, namespace: 'profile' | 'provider' = 'profile'): Promise<T> {
        publicationId(id);
        const parent = await this.directory(`locks/${namespace}`); await fs.mkdir(parent, { recursive: true });
        const lock = await this.directory(`locks/${namespace}/${id}`);
        try { await fs.mkdir(lock); }
        catch (error: any) {
            if (error.code !== 'EEXIST') throw error;
            // Recover only a demonstrably dead owner, with a separate exclusive recovery guard.
            const recovery = await this.directory(`lock-recovery/${namespace}/${id}`); await fs.mkdir(path.dirname(recovery), { recursive: true });
            try { await fs.mkdir(recovery); } catch { throw new Error('This publication has an active operation or lock recovery. Retry after it finishes.'); }
            let stale: string;
            try {
                const owner = await optionalJson(await safePath(lock, 'owner.json'));
                if (!Number.isInteger(owner?.pid) || owner.pid < 1) throw new Error('The publication lock has no valid owner. Inspect the interrupted local operation before recovering its lock.');
                try { process.kill(owner.pid, 0); throw new Error('This publication has an active operation. Retry after it finishes.'); }
                catch (probe: any) { if (probe.code !== 'ESRCH') throw probe; }
                stale = `${lock}.stale-${crypto.randomBytes(12).toString('hex')}`;
                await fs.rename(lock, stale);
                try { await fs.mkdir(lock); } catch { throw new Error('Another publication operation acquired the recovered lock. Retry after it finishes.'); }
            } finally { if (stale) await fs.rm(stale, { recursive: true, force: true }); await fs.rm(recovery, { recursive: true, force: true }); }
        }
        try { await fs.writeFile(path.join(lock, 'owner.json'), canonical({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); return await action(); }
        finally { await fs.rm(lock, { recursive: true, force: true }); }
    }
    async profile(id: string): Promise<PublicationProfileRecord | null> {
        const value = await optionalJson(await this.directory(`profiles/${publicationId(id)}.json`));
        if (value && (value.profile?.id !== id || !Number.isInteger(value.revision) || value.revision < 1)) throw new Error('Invalid publication profile record.');
        return value;
    }
    async profiles(): Promise<PublicationProfileRecord[]> {
        const directory = await this.directory('profiles'); let names: string[];
        try { names = await fs.readdir(directory); } catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
        const records = [];
        for (const name of names.sort()) if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\.json$/.test(name)) records.push(await this.profile(name.slice(0, -5)));
        return records.filter(Boolean);
    }
    async expectProfile(id: string, revision: number): Promise<PublicationProfileRecord> {
        const value = await this.profile(id);
        if (!value || value.revision !== revision) throw new Error('The publication profile changed. Reload and review it again.');
        return value;
    }
    async save(profile: PublicationProfile, expectedRevision: number | null): Promise<PublicationProfileRecord> {
        return this.locked(profile.id, async () => {
            const previous = await this.profile(profile.id);
            if ((previous?.revision ?? null) !== expectedRevision) throw new Error('The publication profile changed. Reload and review it again.');
            if (previous && previous.profile.workId !== profile.workId) throw new Error('A publication profile must retain the stable work identity.');
            const remote = await this.remote(profile.id);
            if (remote && remote.environment !== (profile.zenodo?.environment || 'sandbox')) throw new Error('The existing work is bound to another Zenodo environment. Keep this profile on its established work entry.');
            const record = { profile, revision: (previous?.revision || 0) + 1, updatedAt: new Date().toISOString() };
            await atomicJson(this.root, `${this.relativeDirectory}/profiles/${profile.id}.json`, record); return record;
        });
    }
    async remote(id: string): Promise<PublicationRemoteState | null> {
        const value = await optionalJson(await this.directory(`remote/${publicationId(id)}.json`));
        if (value && (value.schema !== 'math-workspace.publication-zenodo/v1' || !Number.isInteger(value.revision) || value.revision < 1)) throw new Error('Invalid publication provider record.');
        return value;
    }
    async writeRemote(id: string, value: Omit<PublicationRemoteState, 'revision' | 'updatedAt'> & Partial<PublicationRemoteState>): Promise<PublicationRemoteState> {
        const previous = await this.remote(id);
        const next = { ...value, revision: (previous?.revision || 0) + 1, updatedAt: new Date().toISOString() } as PublicationRemoteState;
        await atomicJson(this.root, `${this.relativeDirectory}/remote/${publicationId(id)}.json`, next); return next;
    }
    async builds(id: string): Promise<PublicationBuild[]> {
        const directory = await this.directory(`builds/${publicationId(id)}`); let names: string[];
        try { names = await fs.readdir(directory); } catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
        const values = [];
        for (const name of names.sort()) if (/^[a-f0-9]{32}$/.test(name)) values.push(await this.build(id, name));
        return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    async build(id: string, release: string): Promise<PublicationBuild> {
        const file = await this.directory(`builds/${publicationId(id)}/${buildId(release)}/build.json`);
        const value = await optionalJson(file);
        if (!value || value.schema !== 'math-workspace.publication-build/v1' || value.id !== release || value.profileId !== id) throw new Error('Publication build not found.');
        return value;
    }
    async artifact(id: string, release: string, name: PublicationArtifact): Promise<any> {
        if (!['publication.pdf', 'compiled.md', 'manifest.json', 'citation.json'].includes(name)) throw new Error('Unknown publication artifact.');
        const build = await this.build(id, release);
        const bytes = await fs.readFile(await this.directory(`builds/${publicationId(id)}/${buildId(release)}/${name}`));
        const expected = name === 'publication.pdf' ? build.pdfSha256 : name === 'compiled.md' ? build.markdownSha256 : name === 'manifest.json' ? build.manifestSha256 : undefined;
        if (expected && sha256(bytes) !== expected) throw new Error('The immutable publication artifact changed.');
        if (name === 'citation.json') {
            const manifest = JSON.parse((await this.artifact(id, release, 'manifest.json')).toString('utf8'));
            if (sha256(bytes) !== manifest.artifacts[name]?.sha256) throw new Error('The immutable publication artifact changed.');
        }
        return bytes;
    }
}
