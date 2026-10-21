import * as crypto from 'node:crypto';
import { PublicationStore, canonical, sha256 } from './store';
import { normalizeDoi, normalizeProfile } from './render';
import { zenodoFileName, zenodoPublicationMetadata, zenodoMetadataMatches } from './zenodo';
import type { PublicationProfile, PublicationServiceOptions, PublicationVerification, PublicationVerificationCheck, PublicationVerificationRequest } from './types';

const URLConstructor = require('node:url').URL;
class VerificationProblem extends Error {
    constructor(readonly status: 'pending' | 'failed', message: string, readonly httpStatus?: number) { super(message); }
}
const problem = (message: string): never => { throw new VerificationProblem('failed', message); };
const observation = (error: any, url?: string): PublicationVerificationCheck => error instanceof VerificationProblem
    ? { status: error.status, detail: error.message, url, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) }
    : { status: 'pending', detail: 'The public request could not be completed. Retry verification; publication is not repeated.', url };

/** This client never reads credentials or accepts arbitrary origins, even across redirects. */
class PublicReader {
    constructor(private options: PublicationServiceOptions, readonly origin: string) {}
    url(value: string, kind: 'record' | 'file' | 'doi'): any {
        let url: any;
        try { url = new URLConstructor(value); } catch { return problem('The public service returned an invalid URL.'); }
        const resolver = kind === 'doi' && ['https://doi.org', 'https://handle.test.datacite.org'].includes(url.origin);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.origin !== this.origin && !resolver)) problem('The public service returned an untrusted URL.');
        if (url.search && !(kind === 'file' && url.search === '?download=1')) problem('The public service returned an untrusted URL query.');
        if (kind === 'record' && !/^\/api\/records\/[1-9][0-9]*$/.test(url.pathname)) problem('Invalid public record URL.');
        if (kind === 'file' && !/^\/(?:api\/files\/[a-zA-Z0-9-]+\/[^/]+|api\/records\/[1-9][0-9]*\/files\/[^/]+\/content|records?\/[1-9][0-9]*\/files\/[^/]+)$/.test(url.pathname)) problem('Invalid public file URL.');
        return url;
    }
    async open(value: string, kind: 'record' | 'file' | 'doi') {
        const url = this.url(value, kind).toString(), controller = new (globalThis as any).AbortController();
        const timer = setTimeout(() => controller.abort(), 30000), close = () => clearTimeout(timer);
        try {
            const response = await (this.options.fetch || (globalThis as any).fetch)(url, {
                method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
                headers: { Accept: kind === 'record' ? 'application/json' : kind === 'file' ? '*/*' : 'text/html', 'User-Agent': 'math-workspace publication verification (https://github.com/glenzli/math-workspace)' }
            });
            return { response, url, close };
        } catch { close(); throw new VerificationProblem('pending', 'The public request could not be completed. Retry verification; publication is not repeated.'); }
    }
    async bytes(response: any, limit: number, consume: (bytes: any) => void): Promise<number> {
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > limit)) problem('The public response exceeded the expected size.');
        const reader = response.body?.getReader(); if (!reader) problem('The public response did not provide a readable body.');
        let size = 0;
        try {
            for (;;) {
                const item = await reader.read(); if (item.done) break;
                const bytes = Buffer.from(item.value); size += bytes.length;
                if (size > limit) problem('The public response exceeded the expected size.');
                consume(bytes);
            }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        return size;
    }
    checkHttp(response: any): void {
        if (response.status !== 200) throw new VerificationProblem([404, 408, 409, 425, 429].includes(response.status) || response.status >= 500 ? 'pending' : 'failed', 'The public endpoint is not available with HTTP 200. Retry after checking its public availability.', response.status);
    }
    async record(id: string): Promise<any> {
        const opened = await this.open(`${this.origin}/api/records/${id}`, 'record');
        try {
            this.checkHttp(opened.response); const parts = [];
            await this.bytes(opened.response, 2 * 1024 * 1024, bytes => parts.push(bytes));
            try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return problem('The public record response is not valid JSON.'); }
        } finally { await opened.response.body?.cancel().catch(() => undefined); opened.close(); }
    }
    async download(value: string, expectedBytes: number): Promise<{ bytes: number; sha256: string; url: string }> {
        for (let hop = 0; hop < 6; hop++) {
            const opened = await this.open(value, 'file');
            try {
                if ([301, 302, 303, 307, 308].includes(opened.response.status)) {
                    const next = opened.response.headers.get('location'); if (!next) problem('The public file redirect has no destination.');
                    value = this.url(new URLConstructor(next, opened.url).toString(), 'file').toString(); continue;
                }
                this.checkHttp(opened.response); const digest = crypto.createHash('sha256');
                const bytes = await this.bytes(opened.response, expectedBytes, part => digest.update(part));
                return { bytes, sha256: digest.digest('hex'), url: opened.url };
            } finally { await opened.response.body?.cancel().catch(() => undefined); opened.close(); }
        }
        return problem('The public file has too many redirects.');
    }
    async resolve(value: string, recordId: string): Promise<string> {
        for (let hop = 0; hop < 6; hop++) {
            const opened = await this.open(value, 'doi');
            try {
                if ([301, 302, 303, 307, 308].includes(opened.response.status)) {
                    const next = opened.response.headers.get('location'); if (!next) problem('The DOI redirect has no destination.');
                    value = this.url(new URLConstructor(next, opened.url).toString(), 'doi').toString(); continue;
                }
                this.checkHttp(opened.response);
                const url = this.url(opened.url, 'doi');
                if (url.origin !== this.origin || !new RegExp(`^/records?/${recordId}/?$`).test(url.pathname)) problem('The DOI does not resolve to this exact published edition.');
                return opened.url;
            } finally { await opened.response.body?.cancel().catch(() => undefined); opened.close(); }
        }
        return problem('The DOI has too many redirects.');
    }
}

function publicRecord(record: any, profile: PublicationProfile, id: string, doi: string, conceptDoi: string | undefined, name: string, bytes: any, expectedMetadata?: any) {
    if (String(record?.id) !== id || record.is_published === false || ['draft', 'unsubmitted'].includes(record.status || record.state)) problem('The public record identity or publication status differs from this edition.');
    const metadata = record.metadata || {};
    const recordDoi = (value: unknown) => { try { return normalizeDoi(value); } catch { return problem('The public record contains an invalid DOI.'); } };
    const actualDoi = recordDoi(record.doi || record.pids?.doi?.identifier || metadata.doi);
    let parentDoi: string | undefined;
    if (record.links?.parent_doi) {
        let link: any; try { link = new URLConstructor(record.links.parent_doi); } catch { return problem('The public work DOI link is invalid.'); }
        if (!['https://doi.org', 'https://handle.test.datacite.org'].includes(link.origin) || link.username || link.password || link.search || link.hash) problem('The public work DOI link is untrusted.');
        parentDoi = decodeURIComponent(link.pathname.slice(1));
    }
    const actualConcept = recordDoi(record.conceptdoi || record.concept_doi || record.parent?.pids?.doi?.identifier || parentDoi);
    if (actualDoi !== doi || conceptDoi && actualConcept !== conceptDoi) problem('The public record DOI differs from the bound edition or work.');
    if (!Array.isArray(metadata.creators)) problem('The public creators are invalid.');
    const authors = metadata.creators.map(author => author?.name || author?.person_or_org?.name);
    const license = typeof metadata.license === 'string' ? metadata.license : metadata.license?.id || metadata.rights?.[0]?.id;
    if (metadata.title !== profile.title || metadata.version !== profile.version || canonical(authors) !== canonical(profile.authors.map(author => author.name)) || license !== (profile.license || 'cc-by-4.0')) problem('The public title, version, creators or license differs from the frozen edition.');
    if (expectedMetadata && !zenodoMetadataMatches(record, expectedMetadata)) problem('The public author identities, source links or publication metadata differ from the frozen edition.');
    const files = Array.isArray(record.files) ? record.files : Object.entries(record.files?.entries || {}).map(([key, file]: [string, any]) => ({ ...file, key }));
    if (files.length !== 1) problem('The public file set differs from this PDF edition.');
    const file = files[0], checksum = String(file.checksum || '').toLowerCase();
    const md5 = crypto.createHash('md5').update(bytes).digest('hex'), expectedSha = sha256(bytes);
    if ((file.key || file.filename) !== name || Number(file.size ?? file.filesize) !== bytes.length || ![md5, `md5:${md5}`, expectedSha, `sha256:${expectedSha}`].includes(checksum)) problem('The public filename, size or checksum differs from the frozen PDF.');
    return { snapshot: { id, doi: actualDoi, conceptDoi: actualConcept, title: metadata.title, version: metadata.version, authors, license, ...(expectedMetadata ? { expectedMetadata } : {}), name, size: bytes.length, checksum }, fileUrl: file.links?.content || file.links?.download || file.links?.self };
}

/** Verification reads only public endpoints and writes only its own local observation receipt. */
export async function verifyPublishedEdition(store: PublicationStore, options: PublicationServiceOptions, profileId: string, buildId: string, request: PublicationVerificationRequest): Promise<PublicationVerification> {
    return store.locked(profileId, async () => {
        const id = String(request.recordId || ''); if (!/^[1-9][0-9]{0,24}$/.test(id)) throw new Error('Invalid published record identity.');
        const saved = await store.profile(profileId), build = await store.build(profileId, buildId), remote = await store.remote(profileId);
        if (!saved || build.workId !== saved.profile.workId || build.pdfSha256 !== request.pdfSha256) throw new Error('The verification request does not match the frozen PDF and work.');
        const binding = remote?.status === 'published' && remote.recordId === id ? { ...remote.upload, recordId: id, versionDoi: remote.versionDoi } : remote?.history?.find(item => item.recordId === id);
        if (!remote || !binding || binding.buildId && binding.buildId !== buildId || binding.pdfSha256 && binding.pdfSha256 !== build.pdfSha256) throw new Error('Verify a published record bound to this exact edition, or attach the existing published record first.');
        const bytes = await store.artifact(profileId, buildId, 'publication.pdf'), manifest = JSON.parse((await store.artifact(profileId, buildId, 'manifest.json')).toString('utf8'));
        const profile = normalizeProfile(manifest.plan.profile), doi = normalizeDoi(manifest.plan.doi.versionDoi), conceptDoi = normalizeDoi(manifest.plan.doi.conceptDoi || remote.conceptDoi);
        if (profile.id !== profileId || profile.workId !== build.workId || profile.version !== build.version || !doi || binding.versionDoi !== doi) throw new Error('The frozen edition DOI does not match the bound published record.');
        const origin = remote.environment === 'production' ? 'https://zenodo.org' : 'https://sandbox.zenodo.org';
        const resolver = remote.environment === 'production' ? 'doi.org' : 'handle.test.datacite.org';
        const recordUrl = `${origin}/api/records/${id}`, doiUrl = `https://${resolver}/${doi.split('/').map(encodeURIComponent).join('/')}`;
        const notChecked: PublicationVerificationCheck = { status: 'pending', detail: 'Not yet checked.' };
        const result: PublicationVerification = { schema: 'math-workspace.publication-verification/v1', profileId, workId: build.workId, buildId, recordId: id, environment: remote.environment, checkedAt: new Date().toISOString(), status: 'pending', versionDoi: doi, pdfSha256: build.pdfSha256,
            record: { ...notChecked, url: recordUrl }, file: { ...notChecked, expectedBytes: bytes.length }, doi: { ...notChecked, url: doiUrl, resolver } };
        const client = new PublicReader(options, origin);
        const expectedMetadata = manifest.plan.projectMetadata !== undefined ? zenodoPublicationMetadata(profile, build) : undefined;
        try {
            const first = publicRecord(await client.record(id), profile, id, doi, conceptDoi, zenodoFileName(profile), bytes, expectedMetadata);
            result.record = { status: 'passed', detail: 'The anonymous public record matches the edition DOI, work DOI, title, version, creators, license and PDF file metadata.', url: recordUrl, httpStatus: 200 };
            try {
                const fileUrl = first.fileUrl || `${origin}/records/${id}/files/${encodeURIComponent(zenodoFileName(profile))}`;
                const downloaded = await client.download(fileUrl, bytes.length);
                result.file = { status: downloaded.sha256 === build.pdfSha256 && downloaded.bytes === bytes.length ? 'passed' : 'failed', detail: downloaded.sha256 === build.pdfSha256 && downloaded.bytes === bytes.length ? 'The anonymously downloaded PDF matches the frozen PDF byte count and SHA-256.' : 'The anonymously downloaded PDF differs from the frozen edition.', url: downloaded.url, expectedBytes: bytes.length, observedBytes: downloaded.bytes, observedSha256: downloaded.sha256, httpStatus: 200 };
            } catch (error) { result.file = { ...result.file, ...observation(error, result.file.url), expectedBytes: bytes.length }; }
            if (result.file.status === 'passed') try {
                const after = publicRecord(await client.record(id), profile, id, doi, conceptDoi, zenodoFileName(profile), bytes, expectedMetadata);
                if (canonical(first.snapshot) !== canonical(after.snapshot)) problem('The public record changed during the PDF download. Retry verification.');
            } catch (error) { result.record = observation(error, recordUrl); }
            try {
                const target = await client.resolve(doiUrl, id);
                result.doi = { status: 'passed', detail: 'The DOI resolver reaches this exact public edition.', url: target, resolver, httpStatus: 200 };
            } catch (error) { result.doi = { ...observation(error, doiUrl), resolver }; }
            if (remote.environment === 'sandbox' && result.doi.httpStatus === 404) result.doi.detail = 'Zenodo sandbox states that test DOIs are not real and do not resolve. This test DOI does not establish production DOI registration or resolution.';
        } catch (error) { result.record = observation(error, recordUrl); }
        const states = [result.record, result.file, result.doi].map(item => item.status);
        result.status = states.includes('failed') ? 'failed' : states.every(state => state === 'passed') ? 'verified' : 'pending';
        result.checkedAt = new Date().toISOString(); await store.writeVerification(result); return result;
    });
}
