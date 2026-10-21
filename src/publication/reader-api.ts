import * as path from 'node:path';
import { PublicationService } from './index';
import type { PublicationArtifact } from './types';

const { randomBytes } = require('node:crypto');

export interface PublicationReaderJob {
    id: string;
    action: string;
    state: 'running' | 'completed' | 'failed';
    phase: string;
    startedAt: string;
    finishedAt?: string;
    result?: unknown;
    error?: string;
}

type ReaderPublicationService = Pick<PublicationService,
    'inspect' | 'save' | 'saveMetadata' | 'plan' | 'build' | 'status' | 'reserveDoi' | 'attachZenodo' | 'reviewUpload' | 'upload' | 'publish' | 'verifyPublished' | 'readArtifact'>;

export interface PublicationReaderApiOptions { service?: (root: string) => ReaderPublicationService }

export class PublicationReaderError extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
}

const ACTIONS = new Set(['save', 'save-metadata', 'review', 'build', 'reserve-doi', 'attach-zenodo', 'review-upload', 'upload', 'publish', 'verify-published']);
const ARTIFACTS = new Set<PublicationArtifact>(['publication.pdf', 'compiled.md', 'manifest.json', 'citation.json']);

/** Admits one publication operation per captured project; modal navigation never owns the job. */
export class PublicationReaderApi {
    private readonly services = new Map<string, ReaderPublicationService>();
    private readonly jobs = new Map<string, PublicationReaderJob>();
    constructor(private readonly options: PublicationReaderApiOptions = {}) {}
    private service(root: string): ReaderPublicationService {
        if (!this.services.has(root)) this.services.set(root, this.options.service?.(root)
            || new PublicationService(root, { cliPath: path.resolve(__dirname, 'math-workspace.js') }));
        return this.services.get(root)!;
    }
    async get(root: string, route: string, params: { get(name: string): string | null }): Promise<unknown> {
        if (route === '/api/publication/job') {
            const job = this.jobs.get(root);
            if (!job || job.id !== params.get('id')) throw new PublicationReaderError('This publication operation is not available in the bound project.', 404);
            return job;
        }
        const service = this.service(root);
        if (route === '/api/publication') return { ...await service.inspect(), job: this.jobs.get(root) };
        if (route === '/api/publication/status') return service.status(params.get('profile') || '');
        throw new PublicationReaderError('Unknown publication read operation.', 404);
    }
    async artifact(root: string, params: { get(name: string): string | null }): Promise<{ bytes: any; contentType: string; fileName: string }> {
        const file = params.get('file') as PublicationArtifact;
        if (!ARTIFACTS.has(file)) throw new PublicationReaderError('Choose a known publication artifact.');
        const profile = params.get('profile') || '', build = params.get('build') || '';
        if (!profile || !build) throw new PublicationReaderError('A publication plan and frozen build are required.');
        return this.service(root).readArtifact(profile, build, file);
    }
    start(root: string, input: any): PublicationReaderJob {
        if (!input || typeof input !== 'object' || Array.isArray(input) || !ACTIONS.has(input.action)) throw new PublicationReaderError('Choose a publication operation.');
        if (input.action === 'publish' && input.confirmedPublication !== true) throw new PublicationReaderError('Review this edition and explicitly confirm public publication.');
        if (input.action === 'reserve-doi' && input.mode === 'new-version' && input.confirmedNewVersion !== true) throw new PublicationReaderError('Explicitly confirm a new version of the same work.');
        if (this.jobs.get(root)?.state === 'running') throw new PublicationReaderError('A publication operation is already running in this project.', 409);
        // Freeze the admitted request so later UI or project changes cannot alter its authority.
        const body = JSON.parse(JSON.stringify(input));
        const job: PublicationReaderJob = { id: randomBytes(16).toString('hex'), action: body.action,
            state: 'running', phase: 'Preparing', startedAt: new Date().toISOString() };
        this.jobs.set(root, job);
        void (async () => {
            try {
                const service = this.service(root);
                if (body.action === 'save') job.result = await service.save(body.profile, body.expectedRevision);
                else if (body.action === 'save-metadata') job.result = await service.saveMetadata(body.metadata, body.expectedRevision);
                else if (body.action === 'review') job.result = await service.plan(body.profile);
                else if (body.action === 'build') job.result = await service.build(body.profile, body.expectedFingerprint,
                    { onProgress: message => { job.phase = message; } });
                else if (body.action === 'reserve-doi') job.result = await service.reserveDoi(body.profileId, body.expectedRevision,
                    { mode: body.mode, expectedRecordId: body.expectedRecordId });
                else if (body.action === 'attach-zenodo') job.result = await service.attachZenodo(body.profileId, body.expectedRevision,
                    { id: body.id, kind: body.kind });
                else if (body.action === 'review-upload') job.result = await service.reviewUpload(body.profileId, body.buildId,
                    { pdfSha256: body.pdfSha256, remoteRevision: body.remoteRevision });
                else if (body.action === 'upload') job.result = await service.upload(body.profileId, body.buildId,
                    { pdfSha256: body.pdfSha256, remoteRevision: body.remoteRevision, uploadFingerprint: body.uploadFingerprint });
                else if (body.action === 'verify-published') job.result = await service.verifyPublished(body.profileId, body.buildId,
                    { pdfSha256: body.pdfSha256, recordId: body.recordId });
                else job.result = await service.publish(body.profileId, body.buildId,
                    { pdfSha256: body.pdfSha256, remoteRevision: body.remoteRevision, recordId: body.recordId });
                job.state = 'completed'; job.phase = 'Completed';
            } catch (error) {
                job.state = 'failed'; job.phase = 'Failed'; job.error = error instanceof Error ? error.message : String(error);
            } finally { job.finishedAt = new Date().toISOString(); }
        })();
        return job;
    }
}
