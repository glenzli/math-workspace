import { projectMetadata, normalizeWorkMetadata, mergeWorkMetadata, type WorkMetadata } from '@math-workspace/core';
import { PublicationStore, safePath, sha256, atomicJson } from './store';
import type { PublicationMetadataRecord, PublicationProfile } from './types';

const fs = require('node:fs/promises');
const configPath = '.math-workspace/config.json';
export async function readPublicationMetadata(root: string): Promise<{ record: PublicationMetadataRecord; config: any }> {
    let bytes: any;
    try { bytes = await fs.readFile(await safePath(root, configPath)); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    const config = bytes ? JSON.parse(bytes.toString('utf8')) : {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid project configuration.');
    return { config, record: { value: projectMetadata(config), revision: sha256(bytes || '') } };
}
export function resolvePublicationMetadata(profile: PublicationProfile, config: any): PublicationProfile {
    const value = mergeWorkMetadata(projectMetadata(config), normalizeWorkMetadata(profile));
    if (!value.title) throw new Error('Publication title is required in project metadata or this edition.');
    return { ...profile, ...value, authors: value.authors || [], language: value.language || (config.language === 'en' ? 'en-US' : 'zh-CN'), license: value.license || 'cc-by-4.0', doi: { ...value.doi, ...profile.doi } };
}
/** Compare the complete config identity and preserve every non-metadata key. Never write on reads. */
export async function savePublicationMetadata(store: PublicationStore, input: WorkMetadata, expectedRevision: string): Promise<PublicationMetadataRecord> {
    const value = normalizeWorkMetadata(input);
    return store.locked('project-metadata', async () => {
        const { config, record } = await readPublicationMetadata(store.root);
        if (record.revision !== expectedRevision) throw new Error('Project metadata changed. Reload it before saving.');
        await atomicJson(store.root, configPath, { ...config, metadata: value });
        return (await readPublicationMetadata(store.root)).record;
    }, 'metadata');
}
