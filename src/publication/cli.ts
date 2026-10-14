import { PublicationService } from './index';
import { safePath, relativeInput } from './store';
import type { PublicationProfile } from './types';
const fs = require('node:fs/promises');

const usage = `math-workspace publication inspect
math-workspace publication status <profile-id>
math-workspace publication save <profile.json> --expected-revision new|N
math-workspace publication plan <profile.json|profile-id>
math-workspace publication build <profile.json|profile-id> --fingerprint SHA256
math-workspace publication reserve-doi <profile-id> --expected-revision N [--new-version --record-id ID]
math-workspace publication attach-zenodo <profile-id> --expected-revision N --kind draft|record --record-id ID
math-workspace publication review-upload <profile-id> --build ID --pdf-sha256 SHA256 --remote-revision N
math-workspace publication upload <profile-id> --build ID --pdf-sha256 SHA256 --remote-revision N --upload-fingerprint SHA256
math-workspace publication publish <profile-id> --build ID --pdf-sha256 SHA256 --remote-revision N --record-id ID`;
export async function runPublicationCli(args: string[], root = process.cwd()): Promise<void> {
    const [action, selector, ...flags] = args;
    if (!action || action === '--help' || action === 'help') { console.log(usage); return; }
    const service = new PublicationService(root), options: Record<string, string | boolean> = {};
    for (let index = 0; index < flags.length; index++) {
        const flag = flags[index];
        if (flag === '--new-version') { options['new-version'] = true; continue; }
        const match = /^--(expected-revision|fingerprint|record-id|kind|build|pdf-sha256|remote-revision|upload-fingerprint)(?:=(.*))?$/.exec(flag);
        if (!match) throw new Error(`Unknown publication option: ${flag}`);
        const value = match[2] ?? flags[++index]; if (!value || value.startsWith('--')) throw new Error(`Missing ${match[1]}.`); options[match[1]] = value;
    }
    const required = (key: string): string => { const value = options[key]; if (typeof value !== 'string' || !value) throw new Error(`Publication action requires --${key}.`); return value; };
    const revision = (key: string): number => { const value = Number(required(key)); if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${key}.`); return value; };
    const profile = async (): Promise<PublicationProfile> => {
        if (!selector) throw new Error('A publication profile is required.');
        if (/\.json$/i.test(selector)) return JSON.parse(await fs.readFile(await safePath(root, relativeInput(selector)), 'utf8'));
        return (await service.status(selector)).profile.profile;
    };
    let result: any;
    if (action === 'inspect') result = await service.inspect();
    else if (action === 'status') result = await service.status(selector);
    else if (action === 'save') result = await service.save(await profile(), required('expected-revision') === 'new' ? null : revision('expected-revision'));
    else if (action === 'plan') result = await service.plan(await profile());
    else if (action === 'build') result = await service.build(await profile(), required('fingerprint'));
    else if (action === 'reserve-doi') result = await service.reserveDoi(selector, revision('expected-revision'), { mode: options['new-version'] ? 'new-version' : 'reuse-or-create', expectedRecordId: options['new-version'] ? required('record-id') : undefined });
    else if (action === 'attach-zenodo') result = await service.attachZenodo(selector, revision('expected-revision'), { id: required('record-id'), kind: required('kind') as 'draft' | 'record' });
    else if (action === 'review-upload' || action === 'upload' || action === 'publish') {
        const review = { pdfSha256: required('pdf-sha256'), remoteRevision: revision('remote-revision') };
        result = action === 'review-upload' ? await service.reviewUpload(selector, required('build'), review) : action === 'upload' ? await service.upload(selector, required('build'), { ...review, uploadFingerprint: required('upload-fingerprint') }) : await service.publish(selector, required('build'), { ...review, recordId: required('record-id') });
    } else throw new Error(`Unknown publication action.\n${usage}`);
    console.log(JSON.stringify(result, null, 2));
}
