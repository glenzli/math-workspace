import * as path from 'node:path';
import { PublicationStore, canonical } from './store';
import { normalizeProfile, makePublicationPlan, publicationCatalog, publicationTools, renderPublication } from './render';
import { ZenodoPublication } from './zenodo';
import type { PublicationProfile, PublicationProfileRecord, PublicationServiceOptions, PublicationPlan, PublicationBuild, PublicationBuildOptions, PublicationInspection, PublicationStatus, PublicationDoiBinding, PublicationArtifact, PublicationReserveOptions, PublicationAttachOptions, PublicationProviderReview, PublicationPublishReview, PublicationUploadReview } from './types';
export type * from './types';

/** No constructor, inspection, planning, or artifact read creates state or contacts Zenodo. */
export class PublicationService {
    readonly store: PublicationStore;
    private readonly zenodo: ZenodoPublication;
    constructor(root: string, private readonly options: PublicationServiceOptions = {}) {
        this.store = new PublicationStore(root);
        this.zenodo = new ZenodoPublication(this.store, options, profile => this.plan(profile));
    }
    async inspect(): Promise<PublicationInspection> {
        const catalog = await publicationCatalog(this.store.root), profiles = await this.store.profiles();
        const defaultProfile: PublicationProfile = { id: 'publication', workId: path.basename(this.store.root).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[^a-zA-Z0-9]+/, '').slice(0, 79) || 'work', title: '', version: '0.1.0', authors: [], language: catalog.language, license: 'cc-by-4.0', chapters: [], frontMatter: [], backMatter: [], toc: { enabled: true, depth: 2 }, cover: { showVersion: true }, zenodo: { environment: 'sandbox', tokenEnv: 'ZENODO_TOKEN' } };
        return { ...catalog, profiles, tools: await publicationTools(undefined, this.options), defaultProfile, credentialStatus: profiles.map(({ profile }) => ({ profileId: profile.id, environment: profile.zenodo?.environment || 'sandbox', ...this.zenodo.credential(profile) })) };
    }
    async save(input: PublicationProfile, expectedRevision: number | null): Promise<PublicationProfileRecord> {
        return this.store.save(normalizeProfile(input), expectedRevision);
    }
    private async doi(profile: PublicationProfile): Promise<PublicationDoiBinding> {
        const remote = await this.store.remote(profile.id);
        if (profile.doi?.versionDoi || !remote?.versionDoi && profile.doi?.conceptDoi) return { source: 'manual', state: 'unverified', versionDoi: profile.doi.versionDoi, conceptDoi: profile.doi.conceptDoi, provenance: profile.doi.provenance || 'Manually entered in the publication profile; provider registration is not asserted.' };
        if (remote?.versionDoi) return { source: 'zenodo', state: remote.status === 'published' ? 'published' : 'reserved', versionDoi: remote.versionDoi, conceptDoi: remote.conceptDoi || profile.doi?.conceptDoi, recordId: remote.draftId || remote.recordId, provenance: remote.status === 'published' ? 'Zenodo publication acknowledgement' : 'Zenodo draft DOI reservation; not registered until publication' };
        return { source: 'none', state: 'none', conceptDoi: profile.doi?.conceptDoi };
    }
    async plan(input: PublicationProfile): Promise<PublicationPlan> {
        const profile = normalizeProfile(input); return (await makePublicationPlan(this.store.root, profile, await this.doi(profile), this.options)).plan;
    }
    async build(input: PublicationProfile, expectedFingerprint: string, options: PublicationBuildOptions = {}): Promise<PublicationBuild> {
        const profile = normalizeProfile(input), result = await makePublicationPlan(this.store.root, profile, await this.doi(profile), this.options);
        if (!/^[a-f0-9]{64}$/.test(expectedFingerprint) || result.plan.fingerprint !== expectedFingerprint) throw new Error('The publication plan changed. Review a fresh plan before building.');
        return renderPublication(this.store, result.plan, result.snapshot, () => this.plan(profile), this.options, options);
    }
    async status(profileId: string): Promise<PublicationStatus> {
        const profile = await this.store.profile(profileId); if (!profile) throw new Error('Publication profile not found.');
        return { profile, builds: await this.store.builds(profileId), remote: await this.store.remote(profileId), credential: this.zenodo.credential(profile.profile) };
    }
    async readArtifact(profileId: string, buildId: string, artifact: PublicationArtifact): Promise<{ bytes: any; contentType: string; fileName: string }> {
        const bytes = await this.store.artifact(profileId, buildId, artifact);
        return { bytes, contentType: artifact === 'publication.pdf' ? 'application/pdf' : artifact.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8', fileName: artifact };
    }
    reserveDoi(profileId: string, expectedRevision: number, options: PublicationReserveOptions = { mode: 'reuse-or-create' }) { return this.zenodo.reserve(profileId, expectedRevision, options); }
    attachZenodo(profileId: string, expectedRevision: number, options: PublicationAttachOptions) { return this.zenodo.attach(profileId, expectedRevision, options); }
    reviewUpload(profileId: string, buildId: string, review: PublicationProviderReview) { return this.zenodo.reviewUpload(profileId, buildId, review); }
    upload(profileId: string, buildId: string, review: PublicationUploadReview) { return this.zenodo.upload(profileId, buildId, review); }
    publish(profileId: string, buildId: string, review: PublicationPublishReview) { return this.zenodo.publish(profileId, buildId, review); }
}
