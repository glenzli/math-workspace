import * as crypto from 'node:crypto';
import { PublicationStore, canonical, sha256 } from './store';
import { normalizeDoi, normalizeProfile } from './render';
import { readPublicationMetadata, resolvePublicationMetadata } from './metadata';
import type { PublicationProfile, PublicationRemoteState, PublicationServiceOptions, PublicationReserveOptions, PublicationAttachOptions, PublicationProviderReview, PublicationPublishReview, PublicationPlan, PublicationBuild, PublicationUploadPlan, PublicationUploadReview } from './types';

const numericId = (value: unknown): string => {
    const id = String(value ?? ''); if (!/^[1-9][0-9]{0,24}$/.test(id)) throw new Error('Invalid Zenodo record or draft identity.'); return id;
};
const submitted = (record: any): boolean => record?.submitted === true || record?.state === 'done';
const md5 = (bytes: any): string => crypto.createHash('md5').update(bytes).digest('hex');
const checksumIdentity = (value: unknown): string | undefined => {
    const text = String(value || '').toLowerCase();
    if (/^(?:md5:)?[a-f0-9]{32}$/.test(text)) return `md5:${text.replace(/^md5:/, '')}`;
    if (/^(?:sha256:)?[a-f0-9]{64}$/.test(text)) return `sha256:${text.replace(/^sha256:/, '')}`;
    return undefined;
};
const sameChecksum = (left: unknown, right: unknown): boolean => !!checksumIdentity(left) && checksumIdentity(left) === checksumIdentity(right);
const checksumMatches = (value: any, bytes: any): boolean => {
    const text = String(value || '').toLowerCase(); return text === `md5:${md5(bytes)}` || text === md5(bytes) || text === `sha256:${sha256(bytes)}` || text === sha256(bytes);
};
export function zenodoFileName(profile: PublicationProfile): string { return `${profile.id}-${profile.version.replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`; }
function zenodoLanguage(value?: string): string | undefined {
    if (!value) return undefined;
    const language = value.toLowerCase(); if (/^[a-z]{3}$/.test(language)) return language;
    const known = { zh: 'zho', en: 'eng', de: 'deu', fr: 'fra', es: 'spa', ja: 'jpn', ko: 'kor', ru: 'rus', it: 'ita', pt: 'por', ar: 'ara' };
    const result = known[language.split('-')[0]]; if (!result) throw new Error('Zenodo language must be a supported language tag or an ISO 639-2/639-3 three-letter code.'); return result;
}
/** One projection is shared by authenticated publication and anonymous verification. */
export function zenodoPublicationMetadata(profile: PublicationProfile, build?: PublicationBuild): any {
    if (!profile.authors?.length) throw new Error('Zenodo publication requires at least one named author.');
    if (!profile.description) throw new Error('Zenodo publication requires a description in the saved profile.');
    const date = profile.publicationDate || build?.createdAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Zenodo publication date must use YYYY-MM-DD.');
    const language = zenodoLanguage(profile.language);
    const related = [profile.website ? { identifier: profile.website, relation: 'isDescribedBy', scheme: 'url' } : undefined, profile.repository ? { identifier: profile.repository, relation: 'isDerivedFrom', scheme: 'url' } : undefined].filter(Boolean);
    const notes = [profile.subtitle ? `Subtitle: ${profile.subtitle}` : '', profile.edition ? `Edition: ${profile.edition}` : '', profile.licenseUrl ? `License URL: ${profile.licenseUrl}` : '', profile.preferredCitation ? `Preferred citation: ${profile.preferredCitation}` : '', profile.releaseTag ? `Source tag: ${profile.releaseTag}` : '', profile.releaseCommit ? `Source commit: ${profile.releaseCommit}` : '', profile.doi?.provenance ? `DOI source note: ${profile.doi.provenance}` : '',
        ...profile.authors.flatMap(author => [author.nativeName ? `${author.name} — native name: ${author.nativeName}` : '', author.aliases?.length ? `${author.name} — aliases: ${author.aliases.join('; ')}` : ''])].filter(Boolean);
    const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    return { upload_type: 'publication', publication_type: 'book', title: profile.title, creators: profile.authors.map(author => ({ name: author.name, ...(author.orcid ? { orcid: author.orcid.replace(/^https?:\/\/orcid.org\//i, '') } : {}), ...(author.affiliation ? { affiliation: author.affiliation } : {}) })), description: profile.description, version: profile.version, publication_date: date, access_right: 'open', license: profile.license || 'cc-by-4.0', ...(language ? { language } : {}), keywords: profile.keywords || [], related_identifiers: related, notes: notes.map(note => `<p>${escape(note)}</p>`).join(''), ...(profile.doi?.versionDoi ? { doi: profile.doi.versionDoi } : {}) };
}
export function zenodoMetadataMatches(record: any, expected: any): boolean {
    const metadata = record?.metadata || {}, native = !!metadata.resource_type || metadata.creators?.some(author => author.person_or_org);
    const actual = { ...metadata, license: typeof metadata.license === 'string' ? metadata.license : metadata.license?.id || metadata.rights?.[0]?.id, creators: (metadata.creators || []).map(author => native ? { name: author.person_or_org?.name, orcid: author.person_or_org?.identifiers?.find(item => item.scheme === 'orcid')?.identifier, affiliation: author.affiliations?.map(item => item.name).join('; ') || undefined } : author),
        keywords: metadata.keywords || metadata.subjects?.map(item => item.subject) || [], related_identifiers: (metadata.related_identifiers || []).map(item => ({ identifier: item.identifier, scheme: item.scheme, relation: (item.relation || item.relation_type?.id || '').toLowerCase() })),
        notes: metadata.notes || metadata.additional_descriptions?.filter(item => item.type?.id === 'notes').map(item => item.description).join('') || '',
        ...(native ? { upload_type: 'publication', publication_type: metadata.resource_type?.id === 'publication-book' ? 'book' : undefined, access_right: record.access?.record === 'public' || record.access?.status === 'open' ? 'open' : undefined,
            language: metadata.languages?.[0]?.id, license: metadata.rights?.[0]?.id } : {}) };
    const value = (input: any): any => Array.isArray(input) ? input.map(value) : input && typeof input === 'object'
        ? Object.fromEntries(Object.entries(input).filter(([, item]) => item !== null && item !== undefined).map(([key, item]) => [key, value(item)])) : input;
    const ordered = (key: string, input: any): any => key === 'keywords' || key === 'related_identifiers'
        ? (input || []).map(item => key === 'related_identifiers' ? { identifier: item.identifier, scheme: item.scheme, relation: (item.relation || item.relation_type?.id || '').toLowerCase() } : item).sort((a, b) => canonical(a).localeCompare(canonical(b))) : input;
    return Object.entries(expected).every(([key, item]) => canonical(value(ordered(key, actual[key]))) === canonical(value(ordered(key, item))));
}
class ZenodoHttpError extends Error {
    constructor(readonly status: number) { super(`Zenodo request failed (HTTP ${status}); no response body or credential is retained.`); }
}
export class ZenodoPublication {
    constructor(private store: PublicationStore, private options: PublicationServiceOptions, private plan: (profile: PublicationProfile) => Promise<PublicationPlan>) {}
    credential(profile: PublicationProfile) { const tokenEnv = profile.zenodo?.tokenEnv || 'ZENODO_TOKEN'; return { tokenEnv, configured: !!(this.options.environment || process.env)[tokenEnv] }; }
    private client(profile: PublicationProfile) {
        const environment = profile.zenodo?.environment || 'sandbox', origin = environment === 'production' ? 'https://zenodo.org' : 'https://sandbox.zenodo.org';
        const token = (this.options.environment || process.env)[profile.zenodo?.tokenEnv || 'ZENODO_TOKEN'];
        if (!token) throw new Error(`Zenodo credential is unavailable in the server process environment (${profile.zenodo?.tokenEnv || 'ZENODO_TOKEN'}).`);
        const secureUrl = (input: string): string => {
            const URLConstructor = require('node:url').URL, url = new URLConstructor(input, origin);
            if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.startsWith('/api/')) throw new Error('Zenodo returned an untrusted API URL.');
            return url.toString();
        };
        const request = async (input: string, method = 'GET', body?: any, binary = false, native = false): Promise<any> => {
            const url = secureUrl(input), fetcher = this.options.fetch || (globalThis as any).fetch;
            if (!fetcher) throw new Error('This Node.js runtime does not provide fetch for Zenodo.');
            let response;
            try { response = await fetcher(url, { method, redirect: 'error', headers: { Authorization: `Bearer ${token}`, ...(native ? { Accept: 'application/vnd.inveniordm.v1+json' } : {}), ...(body !== undefined ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : {}) }, ...(body !== undefined ? { body: binary ? body : JSON.stringify(body) } : {}) }); }
            catch { throw new Error('Zenodo request result is unknown. Reconcile the existing draft or record before retrying a creation or publication.'); }
            if (!response.ok) throw new ZenodoHttpError(response.status);
            if (response.status === 204) return null;
            try { return await response.json(); } catch { throw new Error('Zenodo returned an invalid JSON acknowledgement. Reconcile its existing draft before retrying.'); }
        };
        return { environment, origin, secureUrl, request };
    }
    private async nativeDraft(client: ReturnType<ZenodoPublication['client']>, id: string): Promise<any> {
        const draft = await client.request(`/api/records/${numericId(id)}/draft`, 'GET', undefined, false, true);
        if (String(draft?.id) !== id || draft.is_published === true || draft.is_draft !== true) throw new Error('Zenodo did not return the expected editable native draft.');
        return draft;
    }
    private authoritativeDraft(record: any, native: any): any {
        const doi = normalizeDoi(native.pids?.doi?.identifier);
        // The compatibility API can synthesize prereserve_doi even when native pids is empty.
        // Only a native DOI binding is evidence of an actual reservation.
        return { ...record, doi, metadata: { ...record.metadata, doi, prereserve_doi: doi ? { doi, recid: String(record.id) } : undefined } };
    }
    private nextState(profile: PublicationProfile, record: any, previous?: PublicationRemoteState | null): Omit<PublicationRemoteState, 'revision' | 'updatedAt'> {
        const id = numericId(record.id), published = submitted(record), doi = normalizeDoi(record.doi || record.metadata?.doi || (published ? record.metadata?.prereserve_doi?.doi : previous?.versionDoi)), conceptDoi = normalizeDoi(record.conceptdoi || record.concept_doi || previous?.conceptDoi);
        const conceptRecordId = record.conceptrecid ? numericId(record.conceptrecid) : previous?.conceptRecordId;
        if (previous?.conceptRecordId && conceptRecordId && previous.conceptRecordId !== conceptRecordId) throw new Error('Zenodo returned a different work record identity. The existing binding is retained.');
        if (previous?.conceptDoi && conceptDoi && previous.conceptDoi !== conceptDoi) throw new Error('Zenodo returned a different work DOI. The existing work binding is retained.');
        if (profile.doi?.versionDoi && doi && profile.doi.versionDoi !== doi) throw new Error('The manually entered version DOI differs from this Zenodo draft. Reconcile the DOI before proceeding.');
        if (profile.doi?.conceptDoi && conceptDoi && profile.doi.conceptDoi !== conceptDoi) throw new Error('The manually entered work DOI differs from the bound Zenodo work.');
        const origin = profile.zenodo?.environment === 'production' ? 'https://zenodo.org' : 'https://sandbox.zenodo.org';
        const ownedFiles = (previous?.ownedFiles || []).filter(file => file.draftId === id);
        const owned = [previous?.upload, ...(previous?.history || []), ...ownedFiles].filter(Boolean);
        const draftFiles = (record.files || []).map(file => ({ name: String(file.filename || file.key || ''), checksum: String(file.checksum || ''), bytes: Number(file.filesize || file.size) || undefined, owned: owned.some(item => item.fileName === (file.filename || file.key) && sameChecksum(item.remoteChecksum, file.checksum)) }));
        const uploadMatches = previous?.upload && (previous.draftId === id || previous.recordId === id) && draftFiles.length === 1 && draftFiles[0].name === previous.upload.fileName && sameChecksum(draftFiles[0].checksum, previous.upload.remoteChecksum);
        return { schema: 'math-workspace.publication-zenodo/v1', environment: profile.zenodo?.environment || 'sandbox', status: published ? 'published' : 'draft', ...(published ? { recordId: id } : { draftId: id }), conceptRecordId, versionDoi: doi, conceptDoi, recordUrl: `${origin}/${published ? 'records' : 'deposit'}/${id}`, history: previous?.history || [], draftFiles, ownedFiles, ...(uploadMatches ? { upload: previous.upload } : {}) };
    }
    private metadata(profile: PublicationProfile, build?: PublicationBuild): any {
        return zenodoPublicationMetadata(profile, build);
    }
    private metadataMatches(record: any, expected: any): boolean {
        return zenodoMetadataMatches(record, expected);
    }
    private nativeMetadata(native: any, expected: any): any {
        const creators = expected.creators.map(author => {
            const [family, ...given] = author.name.split(',');
            return { person_or_org: { type: 'personal', name: author.name, family_name: family.trim(), ...(given.length ? { given_name: given.join(',').trim() } : {}), ...(author.orcid ? { identifiers: [{ scheme: 'orcid', identifier: author.orcid }] } : {}) }, ...(author.affiliation ? { affiliations: [{ name: author.affiliation }] } : {}) };
        });
        return { metadata: { ...native.metadata, resource_type: { id: 'publication-book' }, title: expected.title, creators, description: expected.description, version: expected.version, publication_date: expected.publication_date,
            publisher: native.metadata?.publisher || 'Zenodo', rights: [{ id: expected.license }], subjects: (expected.keywords || []).map(subject => ({ subject })), related_identifiers: (expected.related_identifiers || []).map(item => ({ identifier: item.identifier, scheme: item.scheme, relation_type: { id: item.relation.toLowerCase() } })), languages: expected.language ? [{ id: expected.language }] : [],
            additional_descriptions: [...(native.metadata?.additional_descriptions || []).filter(item => item.type?.id !== 'notes'), ...(expected.notes ? [{ description: expected.notes, type: { id: 'notes' } }] : [])] },
            pids: native.pids, access: { record: 'public', files: 'public' }, ...(native.custom_fields ? { custom_fields: native.custom_fields } : {}) };
    }
    private checkBinding(profile: PublicationProfile, remote: PublicationRemoteState | null): void {
        if (remote && remote.environment !== (profile.zenodo?.environment || 'sandbox')) throw new Error('This publication is already bound to a different Zenodo environment.');
    }
    private bucket(client: ReturnType<ZenodoPublication['client']>, record: any): string {
        if (!record.links?.bucket) throw new Error('Zenodo did not provide an editable draft upload bucket.');
        const bucket = client.secureUrl(record.links.bucket).replace(/\/$/, '');
        if (!/^\/api\/files\/[a-zA-Z0-9-]+$/.test(new (require('node:url').URL)(bucket).pathname)) throw new Error('Zenodo returned an untrusted upload bucket.');
        return bucket;
    }
    private async checkOtherWorkBinding(profile: PublicationProfile): Promise<void> {
        for (const saved of await this.store.profiles()) if (saved.profile.id !== profile.id && saved.profile.workId === profile.workId && (saved.profile.zenodo?.environment || 'sandbox') === profile.zenodo.environment && await this.store.remote(saved.profile.id)) throw new Error(`This work already has a Zenodo binding in publication profile ${saved.profile.id}. Continue its existing profile instead of creating a disconnected record.`);
    }
    async reserve(profileId: string, expectedRevision: number, options: PublicationReserveOptions): Promise<PublicationRemoteState> {
        return this.store.locked(profileId, async () => {
            const { profile: raw } = await this.store.expectProfile(profileId, expectedRevision), profile = resolvePublicationMetadata(normalizeProfile(raw), (await readPublicationMetadata(this.store.root)).config), client = this.client(profile);
            let remote = await this.store.remote(profileId); this.checkBinding(profile, remote);
            if (remote?.pending) throw new Error('A previous Zenodo operation has an unresolved result. Attach its existing draft or record to reconcile it before continuing.');
            if (options.mode === 'new-version') {
                if (remote?.status !== 'published' || remote.recordId !== numericId(options.expectedRecordId)) throw new Error('Creating a new version requires the reviewed latest published record identity.');
                if (profile.doi?.versionDoi) throw new Error('Remove the manually entered version DOI before reserving a new Zenodo version DOI. The stable work DOI can be retained.');
                const record = await client.request(`/api/deposit/depositions/${remote.recordId}`);
                if (!submitted(record)) throw new Error('The bound Zenodo record is not published. Reconcile its status first.');
                const prior = remote;
                remote = await this.store.writeRemote(profileId, { ...remote, status: 'unknown', pending: { action: 'new-version', startedAt: new Date().toISOString(), recordId: remote.recordId } });
                const result = await client.request(`/api/deposit/depositions/${prior.recordId}/actions/newversion`, 'POST');
                const latest = result?.links?.latest_draft;
                if (!latest) throw new Error('Zenodo did not acknowledge a latest draft. Attach the existing new-version draft explicitly.');
                const verified = client.secureUrl(latest), idMatch = /\/api\/deposit\/depositions\/([1-9][0-9]*)\/?$/.exec(verified);
                if (!idMatch) throw new Error('Zenodo returned an invalid latest draft identity.');
                remote = await this.store.writeRemote(profileId, { ...prior, status: 'unknown', pending: { action: 'new-version', startedAt: new Date().toISOString(), recordId: idMatch[1] }, recordId: undefined, draftId: idMatch[1], versionDoi: undefined, upload: undefined, history: [...(prior.history || []), { recordId: prior.recordId, versionDoi: prior.versionDoi, buildId: prior.upload?.buildId, pdfSha256: prior.upload?.pdfSha256, fileName: prior.upload?.fileName, remoteChecksum: prior.upload?.remoteChecksum }] });
                const draft = await client.request(verified);
                if (submitted(draft)) throw new Error('Zenodo returned a published record instead of an editable new-version draft.');
                remote = await this.store.writeRemote(profileId, this.nextState(profile, draft, remote));
            } else if (options.mode !== 'reuse-or-create') throw new Error('Choose draft reuse or an explicit new version.');
            else if (remote?.status === 'published') throw new Error('This edition is published and immutable. Use the explicit new-version action to continue the same work.');
            if (!remote) {
                if (profile.doi?.versionDoi || profile.doi?.conceptDoi) throw new Error('A manual version or work DOI is already present. Attach its existing Zenodo record before continuing the same work, or remove the manual DOI before creating a new Zenodo work.');
                this.metadata(profile);
                const marker = await this.store.locked('zenodo-work-bindings', async () => { await this.checkOtherWorkBinding(profile); return this.store.writeRemote(profileId, { schema: 'math-workspace.publication-zenodo/v1', environment: client.environment, status: 'unknown', pending: { action: 'create', startedAt: new Date().toISOString() } }); }, 'provider');
                let created: any;
                try { created = await client.request('/api/deposit/depositions', 'POST', {}); }
                catch (error) {
                    // An explicit authentication rejection cannot have created this identity-free draft.
                    // Transport failures, all other HTTP statuses, and acknowledged identities remain unresolved.
                    if (error instanceof ZenodoHttpError && [401, 403].includes(error.status)) {
                        const current = await this.store.remote(profileId);
                        if (current?.revision === marker.revision && current.pending?.action === 'create'
                            && !current.draftId && !current.recordId && !current.conceptRecordId && !current.versionDoi && !current.conceptDoi
                            && !current.pending.recordId && !current.pending.buildId) {
                            await require('node:fs/promises').unlink(await this.store.directory(`remote/${profileId}.json`));
                        }
                    }
                    throw error;
                }
                if (submitted(created)) throw new Error('Zenodo returned an unexpected published record.');
                await this.store.writeRemote(profileId, { schema: 'math-workspace.publication-zenodo/v1', environment: client.environment, status: 'unknown', draftId: numericId(created.id), pending: { action: 'create', startedAt: new Date().toISOString(), recordId: numericId(created.id) } });
                remote = await this.store.writeRemote(profileId, this.nextState(profile, created));
            }
            if (!remote.draftId || remote.status !== 'draft') throw new Error('Attach a known editable Zenodo draft before reserving a DOI.');
            const draft = await client.request(`/api/deposit/depositions/${numericId(remote.draftId)}`);
            if (submitted(draft)) throw new Error('Published Zenodo files and metadata cannot be overwritten. Reconcile the record and create a new version.');
            let native = await this.nativeDraft(client, remote.draftId);
            if (!native.pids?.doi?.identifier) {
                if (profile.doi?.versionDoi) throw new Error('The existing Zenodo draft has no native DOI binding matching the manually supplied DOI. Reconcile it in Zenodo before continuing.');
                await this.store.writeRemote(profileId, { ...remote, status: 'unknown', pending: { action: 'reserve-doi', startedAt: new Date().toISOString(), recordId: remote.draftId } });
                await client.request(`/api/records/${remote.draftId}/draft/pids/doi`, 'POST', undefined, false, true);
                native = await this.nativeDraft(client, remote.draftId);
            }
            remote = await this.store.writeRemote(profileId, this.nextState(profile, this.authoritativeDraft(draft, native), remote));
            if (!remote.versionDoi) throw new Error('Zenodo has not acknowledged a reserved version DOI. The draft is retained for reconciliation.');
            return remote;
        });
    }
    async attach(profileId: string, expectedRevision: number, options: PublicationAttachOptions): Promise<PublicationRemoteState> {
        return this.store.locked(profileId, async () => {
            const { profile: raw } = await this.store.expectProfile(profileId, expectedRevision), profile = resolvePublicationMetadata(normalizeProfile(raw), (await readPublicationMetadata(this.store.root)).config), client = this.client(profile), previous = await this.store.remote(profileId); this.checkBinding(profile, previous);
            if (!['draft', 'record'].includes(options.kind)) throw new Error('Choose draft or published record.');
            let record = await client.request(`/api/deposit/depositions/${numericId(options.id)}`);
            if (submitted(record) !== (options.kind === 'record')) throw new Error('The selected Zenodo identity has a different publication status.');
            if (!submitted(record)) record = this.authoritativeDraft(record, await this.nativeDraft(client, String(record.id)));
            const sameKnownRecord = previous && [previous.draftId, previous.recordId, ...(previous.history || []).map(item => item.recordId)].includes(String(record.id));
            if (previous && !sameKnownRecord && (previous.conceptRecordId || previous.conceptDoi) && !record.conceptrecid && !record.conceptdoi && !record.concept_doi) throw new Error('Zenodo did not provide the work identity needed to reconcile this different record.');
            let recovered = previous;
            if (!submitted(record) && previous?.pending?.action === 'upload' && previous.pending.buildId && (previous.draftId || previous.pending.recordId) === String(record.id)) {
                const build = await this.store.build(profileId, previous.pending.buildId), bytes = await this.store.artifact(profileId, build.id, 'publication.pdf');
                const manifest = JSON.parse((await this.store.artifact(profileId, build.id, 'manifest.json')).toString('utf8'));
                const builtProfile = normalizeProfile(manifest.plan.profile);
                if (build.workId !== profile.workId || builtProfile.id !== profile.id || builtProfile.workId !== profile.workId) throw new Error('The interrupted upload build belongs to a different work.');
                const name = zenodoFileName(builtProfile), file = (record.files || []).find(file => (file.filename || file.key) === name && checksumMatches(file.checksum, bytes) && (!(file.filesize || file.size) || Number(file.filesize || file.size) === bytes.length));
                if (file) recovered = { ...previous, ownedFiles: [...(previous.ownedFiles || []).filter(item => item.draftId !== String(record.id) || item.fileName !== name), { draftId: String(record.id), buildId: build.id, pdfSha256: build.pdfSha256, fileName: name, remoteChecksum: String(file.checksum) }] };
            }
            const next = this.nextState(profile, record, recovered);
            if (previous && previous.draftId !== next.draftId && previous.recordId !== next.recordId && previous.conceptRecordId && next.conceptRecordId !== previous.conceptRecordId) throw new Error('The selected Zenodo record belongs to a different work.');
            return this.store.locked('zenodo-work-bindings', async () => { await this.checkOtherWorkBinding(profile); return this.store.writeRemote(profileId, next); }, 'provider');
        });
    }
    private async reviewed(profileId: string, buildId: string, review: PublicationProviderReview) {
        const saved = await this.store.profile(profileId); if (!saved) throw new Error('Save the publication profile first.');
        const currentPlan = await this.plan(saved.profile).catch(() => null);
        if (!currentPlan) throw new Error('The selected sources, profile, or DOI binding changed. Build and review a fresh edition before uploading or publishing.');
        const profile = currentPlan.profile, build = await this.store.build(profileId, buildId), remote = await this.store.remote(profileId); this.checkBinding(profile, remote);
        if (!remote || remote.revision !== review.remoteRevision) throw new Error('The Zenodo draft state changed. Reload and review it again.');
        if (remote.pending) throw new Error('Reconcile the unresolved Zenodo operation before continuing.');
        if (remote.status !== 'draft' || !remote.draftId) throw new Error('Only an editable Zenodo draft can receive this edition; published records are immutable.');
        if (build.pdfSha256 !== review.pdfSha256) throw new Error('The reviewed PDF digest does not match this build.');
        const manifest = JSON.parse((await this.store.artifact(profileId, buildId, 'manifest.json')).toString('utf8'));
        if (canonical(normalizeProfile(manifest.plan.profile)) !== canonical(profile) || currentPlan.fingerprint !== build.fingerprint) throw new Error('The selected sources, profile, or DOI binding changed. Build and review a fresh edition before uploading or publishing.');
        const client = this.client(profile), native = await this.nativeDraft(client, remote.draftId);
        if (!native.pids?.doi?.identifier || normalizeDoi(native.pids.doi.identifier) !== manifest.plan.doi.versionDoi || manifest.plan.doi.source === 'zenodo' && native.pids.doi.provider !== 'datacite') throw new Error('The native Zenodo DOI reservation differs from this PDF or lost its registration provider. Reconcile the actual DOI before uploading or publishing.');
        const bytes = await this.store.artifact(profileId, buildId, 'publication.pdf');
        return { profile, profileInput: saved.profile, build, remote, bytes, client, native, metadata: this.metadata(profile, build) };
    }
    private exactFiles(record: any, name: string, bytes: any): boolean {
        return Array.isArray(record?.files) && record.files.length === 1 && (record.files[0].filename || record.files[0].key) === name && checksumMatches(record.files[0].checksum, bytes) && (!record.files[0].filesize || Number(record.files[0].filesize) === bytes.length);
    }
    private uploadPlan(profile: PublicationProfile, build: PublicationBuild, remote: PublicationRemoteState, record: any, metadata: any): PublicationUploadPlan {
        if (submitted(record)) throw new Error('The Zenodo draft was already published. Its files cannot be overwritten.');
        const name = zenodoFileName(profile), owned = [remote.upload, ...(remote.history || []), ...(remote.ownedFiles || []).filter(file => file.draftId === remote.draftId)].filter(Boolean);
        const files = (record.files || []).map(file => ({ id: String(file.id || ''), name: String(file.filename || file.key || ''), checksum: String(file.checksum || ''), bytes: Number(file.filesize || file.size) || undefined, owned: owned.some(item => item.fileName === (file.filename || file.key) && sameChecksum(item.remoteChecksum, file.checksum)) })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        const content = { profileId: profile.id, buildId: build.id, draftId: remote.draftId, remoteRevision: remote.revision, pdfSha256: build.pdfSha256, files, metadataSha256: sha256(canonical(metadata)), target: name, bucket: String(record.links?.bucket || '') };
        return { profileId: profile.id, buildId: build.id, draftId: remote.draftId, remoteRevision: remote.revision, pdfSha256: build.pdfSha256, fingerprint: sha256(canonical(content)), files: files.map(({ id, ...file }) => file), add: files.some(file => file.name === name) ? [] : [name], replace: files.filter(file => file.name === name && file.owned).map(file => file.name), remove: files.filter(file => file.name !== name && file.owned).map(file => file.name), blocked: files.filter(file => !file.owned).map(file => file.name) };
    }
    async reviewUpload(profileId: string, buildId: string, review: PublicationProviderReview): Promise<PublicationUploadPlan> {
        const { profile, build, remote, client, metadata } = await this.reviewed(profileId, buildId, review);
        const draft = await client.request(`/api/deposit/depositions/${remote.draftId}`);
        this.bucket(client, draft);
        return this.uploadPlan(profile, build, remote, draft, metadata);
    }
    async upload(profileId: string, buildId: string, review: PublicationUploadReview): Promise<PublicationRemoteState> {
        return this.store.locked(profileId, async () => {
            const { profile, profileInput, build, remote, bytes, client, native, metadata } = await this.reviewed(profileId, buildId, review), name = zenodoFileName(profile);
            const draft = await client.request(`/api/deposit/depositions/${remote.draftId}`);
            const bucket = this.bucket(client, draft);
            const preflight = this.uploadPlan(profile, build, remote, draft, metadata);
            if (!review.uploadFingerprint || review.uploadFingerprint !== preflight.fingerprint) throw new Error('The Zenodo upload file plan changed or was not reviewed. Review its exact file changes before uploading.');
            if (preflight.blocked.length) throw new Error(`The Zenodo draft contains files not owned by this publication workflow (${preflight.blocked.join(', ')}). Review them in Zenodo before uploading this edition.`);
            await this.store.writeRemote(profileId, { ...remote, pending: { action: 'upload', startedAt: new Date().toISOString(), recordId: remote.draftId, buildId } });
            // A new version may inherit old files. Only known, checksum-bound draft copies may be replaced.
            for (const file of draft.files || []) {
                const id = String(file.id || ''); if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Zenodo returned an invalid draft file identity.');
                await client.request(`/api/deposit/depositions/${remote.draftId}/files/${id}`, 'DELETE');
            }
            const acknowledgement = await client.request(`${bucket}/${encodeURIComponent(name)}`, 'PUT', bytes, true);
            if (!checksumMatches(acknowledgement?.checksum, bytes)) throw new Error('Zenodo did not acknowledge the exact PDF checksum. Reconcile the draft before publishing.');
            // Updating legacy metadata.doi would turn our reserved DOI into an external DOI,
            // preventing Zenodo from registering it. Preserve the native PID provider instead.
            await client.request(`/api/records/${remote.draftId}/draft`, 'PUT', this.nativeMetadata(native, metadata), false, true);
            const observed = await client.request(`/api/deposit/depositions/${remote.draftId}`);
            if (submitted(observed) || !this.exactFiles(observed, name, bytes)) throw new Error('The Zenodo draft file set differs from this exact edition.');
            // Recheck local freshness after the remote upload as well; stale remote drafts remain unpublished.
            if ((await this.plan(profileInput)).fingerprint !== build.fingerprint) throw new Error('Publication inputs changed during upload. The draft remains unpublished; build and review a fresh edition.');
            const upload = { buildId, pdfSha256: build.pdfSha256, metadataSha256: sha256(canonical(metadata)), fileName: name, remoteChecksum: String(acknowledgement.checksum), uploadedAt: new Date().toISOString() };
            return this.store.writeRemote(profileId, this.nextState(profile, observed, { ...remote, upload }));
        });
    }
    async publish(profileId: string, buildId: string, review: PublicationPublishReview): Promise<PublicationRemoteState> {
        return this.store.locked(profileId, async () => {
            const { profile, profileInput, build, remote, bytes, client, metadata } = await this.reviewed(profileId, buildId, review);
            if (remote.draftId !== numericId(review.recordId) || remote.upload?.buildId !== buildId || remote.upload?.pdfSha256 !== build.pdfSha256 || remote.upload?.metadataSha256 !== sha256(canonical(metadata))) throw new Error('Publication requires the reviewed record identity and the exact uploaded edition.');
            const draft = await client.request(`/api/deposit/depositions/${remote.draftId}`);
            if (submitted(draft) || !this.exactFiles(draft, remote.upload.fileName, bytes)) throw new Error('The Zenodo draft changed after upload. Review and upload the exact edition again.');
            if (!this.metadataMatches(draft, metadata)) throw new Error('The Zenodo publication metadata changed after review. Upload the reviewed edition again.');
            if ((await this.plan(profileInput).catch(() => null))?.fingerprint !== build.fingerprint) throw new Error('Publication inputs changed before publication. Build and review a fresh edition; the draft remains unpublished.');
            await this.store.writeRemote(profileId, { ...remote, status: 'unknown', pending: { action: 'publish', startedAt: new Date().toISOString(), recordId: remote.draftId, buildId } });
            const result = await client.request(`/api/deposit/depositions/${remote.draftId}/actions/publish`, 'POST');
            if (!submitted(result)) throw new Error('Zenodo has not confirmed publication. Attach the existing record to reconcile the result.');
            const returnedDoi = normalizeDoi(result.doi || result.metadata?.doi || result.metadata?.prereserve_doi?.doi);
            const metadataMatches = this.metadataMatches(result, metadata);
            if (String(result.id) !== remote.draftId || !this.exactFiles(result, remote.upload.fileName, bytes) || !metadataMatches || returnedDoi !== remote.versionDoi) throw new Error('Zenodo publication acknowledgement differs from the reviewed edition. The remote result requires reconciliation before claiming publication success.');
            return this.store.writeRemote(profileId, this.nextState(profile, result, remote));
        });
    }
}
