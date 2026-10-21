import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

async function fixture(environment = 'production') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'math-publication-verification-'));
    const { PublicationService } = require(path.join(repo, 'out/cli/publication.js'));
    const origin = environment === 'production' ? 'https://zenodo.org' : 'https://sandbox.zenodo.org';
    const resolver = environment === 'production' ? 'https://doi.org' : 'https://handle.test.datacite.org';
    const prefix = environment === 'production' ? '10.5281' : '10.5072';
    const doi = `${prefix}/zenodo.101`, conceptDoi = `${prefix}/zenodo.100`, pdf = Buffer.from('%PDF-1.7\nExact frozen edition\n%%EOF\n');
    const profile = { id: 'book', workId: 'stable-work', title: 'Public verification fixture', version: '1.0', authors: [{ name: 'Test Author' }], description: 'A test edition.', license: 'cc-by-4.0', chapters: ['01-one.md'], doi: { versionDoi: doi, conceptDoi }, zenodo: { environment } };
    const model = { calls: [], reads: 0, pdf, doiStatus: 302, doiTarget: `${origin}/records/101`, recordStatus: 200, downloadStatus: 200 };
    model.record = { id: 101, status: 'published', metadata: { doi, title: profile.title, version: profile.version, creators: clone(profile.authors), license: { id: profile.license } },
        links: { parent_doi: `${resolver}/${conceptDoi}` }, files: [{ key: 'book-1.0.pdf', size: pdf.length, checksum: `md5:${digest(pdf, 'md5')}`, links: { self: `${origin}/api/records/101/files/book-1.0.pdf/content` } }] };
    const fetcher = async (url, options) => {
        assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
        assert.equal(Object.keys(options.headers).some(key => /authorization|cookie/i.test(key)), false); assert.ok(options.signal);
        model.calls.push(url);
        if (model.throwNetwork) throw new Error('TEST_SECRET must not escape');
        if (url === `${origin}/api/records/101`) {
            model.reads++; if (model.afterRead) model.afterRead(model.reads);
            if (model.rawRecord !== undefined) return new Response(model.rawRecord, { status: 200 });
            return json(model.record, model.recordStatus);
        }
        if (url === `${origin}/api/records/101/files/book-1.0.pdf/content`) {
            assert.equal(options.headers.Accept, '*/*', 'The binary API rejects a PDF-only Accept header with HTTP 406.');
            if (model.downloadRedirect) return new Response(null, { status: 302, headers: { location: model.downloadRedirect } });
            return new Response(model.pdf, { status: model.downloadStatus, ...(model.downloadLength ? { headers: { 'content-length': model.downloadLength } } : {}) });
        }
        if (url === `${resolver}/${doi}`) return new Response(null, { status: model.doiStatus, ...(model.doiStatus === 302 ? { headers: { location: model.doiTarget } } : {}) });
        if (url === model.doiTarget) return new Response('<html>Public record</html>', { status: 200 });
        throw new Error('Unexpected public request: ' + url);
    };
    await fs.mkdir(path.join(root, '.math-workspace')); await fs.writeFile(path.join(root, '.math-workspace/config.json'), '{}');
    await fs.writeFile(path.join(root, '01-one.md'), '# First chapter\n\nA fixed source.\n');
    const runCli = async (args, { cwd }) => { const out = args.find(value => value.startsWith('--out=')).slice(6); await fs.writeFile(path.resolve(cwd, out), args[0] === 'render-pdf' ? pdf : '# Compiled edition\n'); return { stdout: '', stderr: '' }; };
    const service = new PublicationService(root, { fetch: fetcher, runCli, environment: { ZENODO_TOKEN: 'TEST_SECRET' }, toolProbe: () => ({ available: true, identity: 'test tool' }) });
    await service.save(profile, null); const plan = await service.plan(profile), build = await service.build(profile, plan.fingerprint);
    Object.assign(model.record.metadata, { description: profile.description, publication_date: build.createdAt.slice(0, 10), language: 'zho', upload_type: 'publication', publication_type: 'book', access_right: 'open', notes: '', keywords: [], related_identifiers: [] });
    const remote = { schema: 'math-workspace.publication-zenodo/v1', environment, status: 'published', recordId: '101', versionDoi: doi, conceptDoi, upload: { buildId: build.id, pdfSha256: build.pdfSha256, fileName: 'book-1.0.pdf' } };
    await service.store.writeRemote('book', remote);
    const request = { recordId: '101', pdfSha256: build.pdfSha256 };
    return { root, service, model, build, profile, request, remote, origin, resolver, doi, conceptDoi, verify: () => service.verifyPublished('book', build.id, request) };
}

export async function testPublicationVerification() {
    let passed = 0;
    const check = async (name, body, environment) => {
        const f = await fixture(environment);
        try { await body(f); passed++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
        finally { await fs.rm(f.root, { recursive: true, force: true }); }
    };
    await check('public record, real download digest and exact DOI destination', async f => {
        const before = await f.service.store.remote('book'), profile = await f.service.store.profile('book');
        const result = await f.verify(); assert.equal(result.status, 'verified'); assert.equal(result.file.observedSha256, f.build.pdfSha256); assert.equal(result.file.observedBytes, f.model.pdf.length);
        assert.equal(f.model.reads, 2); assert.equal(result.doi.resolver, 'doi.org');
        assert.deepEqual(await f.service.store.remote('book'), before); assert.deepEqual(await f.service.store.profile('book'), profile);
        assert.equal((await f.service.status('book')).verifications[0].status, 'verified'); assert.equal(JSON.stringify(result).includes('TEST_SECRET'), false);
    });
    await check('sandbox uses its test resolver without production requests', async f => {
        const result = await f.verify(); assert.equal(result.status, 'verified'); assert.equal(result.doi.resolver, 'handle.test.datacite.org');
        assert.equal(f.model.calls.some(url => url.startsWith('https://doi.org') || url.startsWith('https://zenodo.org')), false);
    }, 'sandbox');
    await check('RDM entries and creator structure', async f => {
        const old = f.model.record; f.model.record = { id: '101', is_published: true, access: { record: 'public', files: 'public' }, pids: { doi: { identifier: f.doi } }, parent: { pids: { doi: { identifier: f.conceptDoi } } }, metadata: { ...old.metadata, resource_type: { id: 'publication-book' }, languages: [{ id: 'zho' }], title: f.profile.title, version: f.profile.version, creators: [{ person_or_org: { name: 'Test Author' } }], rights: [{ id: f.profile.license }] }, files: { entries: { 'book-1.0.pdf': { ...old.files[0], links: { content: old.files[0].links.self } } } } };
        assert.equal((await f.verify()).status, 'verified');
    });
    await check('legacy concept DOI and filename', async f => {
        const record = f.model.record; record.doi = record.metadata.doi; record.conceptdoi = f.conceptDoi; delete record.links;
        record.files[0].filename = record.files[0].key; delete record.files[0].key;
        assert.equal((await f.verify()).status, 'verified');
    });
    await check('earlier frozen manifests retain their original verification contract', async f => {
        const directory = await f.service.store.directory(`builds/book/${f.build.id}`), manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json')));
        delete manifest.plan.projectMetadata; delete manifest.plan.profileOverrides;
        const bytes = Buffer.from(JSON.stringify(manifest)); await fs.writeFile(path.join(directory, 'manifest.json'), bytes);
        const oldBuild = { ...f.build, manifestSha256: digest(bytes) }; await fs.writeFile(path.join(directory, 'build.json'), JSON.stringify(oldBuild));
        for (const key of ['description', 'publication_date', 'language', 'upload_type', 'publication_type', 'access_right', 'notes', 'keywords', 'related_identifiers']) delete f.model.record.metadata[key];
        assert.equal((await f.verify()).status, 'verified');
    });
    for (const [name, mutate] of [
        ['description', r => { r.metadata.description = 'Changed abstract'; }], ['author ORCID', r => { r.metadata.creators[0].orcid = '0000-0002-1825-0097'; }],
        ['author affiliation', r => { r.metadata.creators[0].affiliation = 'Changed institute'; }], ['keywords', r => { r.metadata.keywords = ['unexpected']; }],
        ['source links', r => { r.metadata.related_identifiers = [{ identifier: 'https://example.org/changed', scheme: 'url', relation: 'isDerivedFrom' }]; }], ['notes', r => { r.metadata.notes = 'Changed citation'; }],
        ['record identity', r => { r.id = 999; }], ['edition DOI', r => { r.metadata.doi = '10.5281/zenodo.999'; }],
        ['work DOI', r => { r.links.parent_doi = 'https://doi.org/10.5281/zenodo.999'; }], ['title', r => { r.metadata.title = 'Changed'; }],
        ['version', r => { r.metadata.version = '2.0'; }], ['creators', r => { r.metadata.creators = [{ name: 'Someone else' }]; }],
        ['license', r => { r.metadata.license.id = 'cc0-1.0'; }], ['size', r => { r.files[0].size++; }],
        ['checksum', r => { r.files[0].checksum = 'md5:wrong'; }], ['filename', r => { r.files[0].key = 'other.pdf'; }],
        ['extra files', r => { r.files.push(clone(r.files[0])); }], ['unpublished record', r => { r.status = 'draft'; }],
        ['invalid DOI', r => { r.metadata.doi = 'not-a-doi'; }], ['invalid creators', r => { r.metadata.creators = 'invalid'; }], ['invalid work DOI link', r => { r.links.parent_doi = 'not-a-url'; }]
    ]) await check(`reject public ${name} drift`, async f => { mutate(f.model.record); const result = await f.verify(); assert.equal(result.status, 'failed'); assert.equal(result.record.status, 'failed'); assert.equal(f.model.calls.length, 1); });
    await check('downloaded bytes differ even when size and advertised checksum agree', async f => {
        f.model.pdf = Buffer.from(f.model.pdf); f.model.pdf[10] ^= 1;
        const result = await f.verify(); assert.equal(result.status, 'failed'); assert.equal(result.file.status, 'failed'); assert.notEqual(result.file.observedSha256, result.pdfSha256);
    });
    await check('oversized download is bounded', async f => { f.model.pdf = Buffer.concat([f.model.pdf, Buffer.from('extra')]); assert.equal((await f.verify()).file.status, 'failed'); });
    await check('oversized declared length is rejected before reading', async f => { f.model.downloadLength = String(f.model.pdf.length + 1); assert.equal((await f.verify()).file.status, 'failed'); });
    await check('record is rechecked after download', async f => { f.model.afterRead = count => { if (count === 2) f.model.record.metadata.title = 'Changed during download'; }; const result = await f.verify(); assert.equal(result.status, 'failed'); assert.equal(result.record.status, 'failed'); assert.equal(result.file.status, 'passed'); });
    await check('download statistics do not invalidate content identity', async f => { f.model.afterRead = count => { f.model.record.stats = { downloads: count }; }; assert.equal((await f.verify()).status, 'verified'); });
    await check('DOI delayed registration remains pending and is retryable', async f => {
        f.model.doiStatus = 404; const result = await f.verify(); assert.equal(result.status, 'pending'); assert.equal(result.record.status, 'passed'); assert.equal(result.file.status, 'passed'); assert.equal(result.doi.httpStatus, 404);
        f.model.doiStatus = 302; assert.equal((await f.verify()).status, 'verified'); assert.equal((await f.service.status('book')).verifications.length, 1);
    });
    await check('Zenodo sandbox non-resolving DOI is explicitly not acceptance evidence', async f => {
        f.model.doiStatus = 404; const result = await f.verify(); assert.equal(result.status, 'pending'); assert.equal(result.record.status, 'passed'); assert.equal(result.file.status, 'passed'); assert.equal(result.doi.status, 'pending'); assert.match(result.doi.detail, /test DOIs are not real and do not resolve/);
    }, 'sandbox');
    await check('DOI cannot point to another version', async f => { f.model.doiTarget = `${f.origin}/records/999`; assert.equal((await f.verify()).doi.status, 'failed'); });
    await check('DOI cannot redirect to an unrelated origin', async f => { f.model.doiTarget = 'https://untrusted.invalid/records/101'; assert.equal((await f.verify()).doi.status, 'failed'); assert.equal(f.model.calls.includes(f.model.doiTarget), false); });
    await check('untrusted file URLs are never followed', async f => { f.model.record.files[0].links.self = 'https://untrusted.invalid/leak'; assert.equal((await f.verify()).file.status, 'failed'); assert.equal(f.model.calls.some(url => url.includes('untrusted')), false); });
    await check('file redirects cannot escape the provider', async f => { f.model.downloadRedirect = 'https://untrusted.invalid/leak'; assert.equal((await f.verify()).file.status, 'failed'); assert.equal(f.model.calls.some(url => url.includes('untrusted')), false); });
    await check('public query strings cannot carry credentials', async f => { f.model.record.files[0].links.self += '?access_token=TEST_SECRET'; const result = await f.verify(); assert.equal(result.file.status, 'failed'); assert.equal(JSON.stringify(result).includes('TEST_SECRET'), false); });
    for (const status of [404, 429, 503]) await check(`public HTTP ${status} cannot imply success`, async f => { f.model.recordStatus = status; const result = await f.verify(); assert.equal(result.status, 'pending'); assert.equal(result.record.httpStatus, status); });
    await check('malformed JSON is a failed observation', async f => { f.model.rawRecord = '{broken'; assert.equal((await f.verify()).record.status, 'failed'); });
    await check('record response size is bounded', async f => { f.model.rawRecord = ' '.repeat(2 * 1024 * 1024 + 1); assert.equal((await f.verify()).record.status, 'failed'); });
    await check('network failures preserve publication and redact transport details', async f => { f.model.throwNetwork = true; const result = await f.verify(); assert.equal(result.status, 'pending'); assert.equal(JSON.stringify(result).includes('TEST_SECRET'), false); assert.equal((await f.service.store.remote('book')).status, 'published'); });
    await check('review digest and record binding reject before network access', async f => {
        await assert.rejects(f.service.verifyPublished('book', f.build.id, { ...f.request, pdfSha256: '0'.repeat(64) }), /frozen PDF/);
        await assert.rejects(f.service.verifyPublished('book', f.build.id, { ...f.request, recordId: '999' }), /bound to this exact edition/); assert.equal(f.model.calls.length, 0);
    });
    await check('tampered local PDF rejects before remote verification', async f => { await fs.appendFile(path.join(f.root, '.math-workspace/publications/builds/book', f.build.id, 'publication.pdf'), 'changed'); await assert.rejects(f.verify(), /immutable/); assert.equal(f.model.calls.length, 0); });
    await check('historical editions remain verifiable after source and profile changes', async f => {
        await f.service.save({ ...f.profile, title: 'A new edition', version: '2.0' }, 1); await fs.writeFile(path.join(f.root, '01-one.md'), 'A changed manuscript.');
        await f.service.store.writeRemote('book', { ...f.remote, status: 'draft', recordId: undefined, draftId: '102', history: [{ recordId: '101', versionDoi: f.doi, buildId: f.build.id, pdfSha256: f.build.pdfSha256 }] });
        assert.equal((await f.verify()).status, 'verified');
    });
    console.log(`Published edition verification: ${passed} focused contracts passed.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testPublicationVerification();
