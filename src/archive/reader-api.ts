import { AcademicArchive, compareFiles } from './store';
import { convertOetArchive, discoverOetArchives } from './oet-converter';
import { digest } from './io';
const crypto = require('node:crypto');

export interface ArchiveJob {
    id: string;
    action: string;
    state: 'running' | 'completed' | 'failed';
    progress?: { done: number; total: number };
    result?: any;
    error?: string;
}

/** A job remains bound to the project that admitted it, even if Reader navigation changes. */
export class ArchiveReaderApi {
    private readonly services = new Map<string, Promise<AcademicArchive>>();
    private readonly jobs = new Map<string, ArchiveJob>();
    private service(root: string): Promise<AcademicArchive> {
        if (!this.services.has(root)) this.services.set(root, AcademicArchive.open(root));
        return this.services.get(root)!;
    }
    async get(root: string, route: string, params: { get(name: string): string | null }): Promise<any> {
        const archive = await this.service(root);
        if (route === '/api/archive') return { ...await archive.status(), compatibleSources: await discoverOetArchives(root) };
        if (route === '/api/archive/job') {
            const job = this.jobs.get(root);
            if (!job || job.id !== params.get('id')) throw new Error('This archive operation is not available in the bound project.');
            return job;
        }
        if (route === '/api/archive/source') return params.get('record') === 'current' ? archive.currentSource(params.get('file') || '')
            : archive.source(params.get('record') || '', params.get('file') || '');
        if (route === '/api/archive/history') return archive.history({ filePath: params.get('file') || undefined, formalId: params.get('formalId') || undefined });
        if (route === '/api/archive/compare') {
            return archive.compare(params.get('left') || '', params.get('right') || '');
        }
        if (route === '/api/archive/export') return archive.export();
        if (route === '/api/archive/oet-preview') {
            const converted = await convertOetArchive(root, params.get('source') || '');
            return { policy: converted.suggestedPolicy, records: converted.exchange.records.length, objects: Object.keys(converted.exchange.objects).length, signatureCreated: false };
        }
        throw new Error('Unknown archive read operation.');
    }
    async start(root: string, body: any): Promise<ArchiveJob> {
        if (!body || typeof body.action !== 'string') throw new Error('Choose an archive operation.');
        const allowed = new Set(['verify', 'prepare', 'sign', 'import-oet', 'initialize']);
        if (!allowed.has(body.action)) throw new Error('Unknown archive write operation.');
        if (this.jobs.get(root)?.state === 'running') throw new Error('An archive operation is already running in this project.');
        const job: ArchiveJob = { id: crypto.randomBytes(16).toString('hex'), action: body.action, state: 'running' };
        this.jobs.set(root, job);
        const progress = (done: number, total: number) => { job.progress = { done, total }; };
        void (async () => {
            try {
                const archive = await this.service(root);
                if (body.action === 'verify') job.result = await archive.verify(body.expectedHead || undefined, progress);
                else if (body.action === 'prepare') job.result = await archive.prepare(body.label);
                else if (body.action === 'sign') job.result = await archive.sign(body.prepared);
                else if (body.action === 'initialize') job.result = await archive.initialize(body.policy);
                else {
                    const converted = await convertOetArchive(root, body.source);
                    if (body.initialize === true) {
                        // The UI must show the exact scope and identities before submitting this policy.
                        if (!body.policy) throw new Error('Review the imported project policy first.');
                        await archive.initialize(body.policy);
                    }
                    job.result = await archive.import(converted.exchange, progress);
                }
                job.state = 'completed';
            } catch (error) { job.state = 'failed'; job.error = error instanceof Error ? error.message : String(error); }
        })();
        return job;
    }
}
