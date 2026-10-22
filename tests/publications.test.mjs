import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = () => require(process.env.MATH_PUBLICATION_TEST_API || path.join(repo, 'out/cli/publication.js'));
const cli = () => process.env.MATH_PUBLICATION_TEST_CLI || path.join(repo, 'out/cli/math-workspace.js');
const exists = file => fs.access(file).then(() => true, () => false);
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

class MockZenodo {
    records = new Map(); calls = []; next = 101; unknownCreate = false; unknownUpload = false; unknownReservation = false; placeholderReservation = false; maliciousBucket = false; publicationAckChange;
    expectedToken = 'TEST_ONLY_SECRET'; createStatus; getStatus; malformedCreate = false; bareFileChecksums = false; nullableCreatorAffiliations = false;
    async fetch(input, options = {}) {
        const url = new URL(input), method = options.method || 'GET';
        assert.equal(url.origin, 'https://sandbox.zenodo.org'); assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, `Bearer ${this.expectedToken}`);
        this.calls.push({ path: url.pathname, method });
        const result = (value, status = 200) => ({ ok: true, status, json: async () => {
            const copy = clone(value);
            if (this.bareFileChecksums && copy?.files) copy.files.forEach(file => { file.checksum = file.checksum.replace(/^md5:/, ''); });
            if (this.nullableCreatorAffiliations && copy?.metadata?.creators) copy.metadata.creators.forEach(author => { if (author.affiliation === undefined) author.affiliation = null; });
            return copy;
        } });
        const native = /^\/api\/records\/(\d+)\/draft(?:\/(pids\/doi))?$/.exec(url.pathname);
        if (native) {
            assert.equal(options.headers.Accept, 'application/vnd.inveniordm.v1+json');
            const record = this.records.get(native[1]); assert.ok(record);
            if (method === 'POST' && native[2] === 'pids/doi') {
                record.nativeDoi = `10.5072/zenodo.${record.id}`;
                record.nativeProvider = 'datacite';
                if (this.unknownReservation) { this.unknownReservation = false; throw new Error('Lost DOI reservation acknowledgement'); }
            } else if (method === 'PUT' && !native[2]) {
                assert.equal(options.headers['Content-Type'], 'application/json');
                const body = JSON.parse(options.body), metadata = body.metadata;
                record.nativeDoi = body.pids?.doi?.identifier; record.nativeProvider = body.pids?.doi?.provider; record.nativeMetadata = metadata;
                record.metadata = { upload_type: 'publication', publication_type: 'book', title: metadata.title, creators: metadata.creators.map(author => ({ name: author.person_or_org.name, ...(author.affiliations?.length ? { affiliation: author.affiliations[0].name } : {}), ...(author.person_or_org.identifiers?.length ? { orcid: author.person_or_org.identifiers[0].identifier } : {}) })), description: metadata.description, version: metadata.version, publication_date: metadata.publication_date, access_right: 'open', license: metadata.rights[0].id, ...(metadata.languages?.length ? { language: metadata.languages[0].id } : {}), prereserve_doi: { doi: record.nativeDoi, recid: record.id } };
                if (metadata.subjects?.length) record.metadata.keywords = metadata.subjects.map(item => item.subject);
                if (metadata.additional_descriptions?.length) record.metadata.notes = metadata.additional_descriptions.filter(item => item.type.id === 'notes').map(item => item.description).join('');
                if (metadata.related_identifiers?.length) record.metadata.related_identifiers = metadata.related_identifiers.map(item => ({ identifier: item.identifier, scheme: item.scheme, relation: item.relation_type.id === 'isdescribedby' ? 'isDescribedBy' : 'isDerivedFrom' }));
            } else assert.equal(method, 'GET');
            return result({ id: record.id, is_published: false, is_draft: true, metadata: record.nativeMetadata || {}, pids: record.nativeDoi ? { doi: { identifier: record.nativeDoi, provider: record.nativeProvider || 'datacite' } } : {} });
        }
        if (url.pathname === '/api/deposit/depositions' && method === 'POST') {
            if (this.createStatus) { const status = this.createStatus; this.createStatus = undefined; return { ok: false, status, json: async () => { throw new Error('A rejected response body must not be read.'); } }; }
            const id = String(this.next++), record = { id, submitted: false, state: 'unsubmitted', conceptdoi: '10.5072/zenodo.100', conceptrecid: '100', metadata: {}, files: [], links: { bucket: `https://sandbox.zenodo.org/api/files/bucket-${id}` } };
            if (this.placeholderReservation) record.metadata.prereserve_doi = { doi: `10.5281/zenodo.${id}`, recid: id };
            this.records.set(id, record); if (this.unknownCreate) { this.unknownCreate = false; throw new Error('TEST_ONLY_SECRET must never escape'); }
            if (this.malformedCreate) { this.malformedCreate = false; return { ok: true, status: 201, json: async () => { throw new Error('Malformed JSON'); } }; } return result(record, 201);
        }
        const bucket = /^\/api\/files\/bucket-(\d+)\/(.+)$/.exec(url.pathname);
        if (bucket && method === 'PUT') {
            const record = this.records.get(bucket[1]), bytes = Buffer.from(options.body), checksum = `md5:${hash(bytes, 'md5')}`;
            record.files = [{ id: `file-${bucket[1]}`, filename: decodeURIComponent(bucket[2]), checksum, filesize: bytes.length }];
            if (this.unknownUpload) { this.unknownUpload = false; throw new Error('Lost upload acknowledgement'); } return result({ checksum, size: bytes.length });
        }
        const match = /^\/api\/deposit\/depositions\/(\d+)(?:\/(.*))?$/.exec(url.pathname);
        if (!match || !this.records.has(match[1])) throw new Error('Unexpected mock Zenodo request.');
        const record = this.records.get(match[1]), suffix = match[2];
        if (method === 'GET') {
            if (this.getStatus) { const status = this.getStatus; this.getStatus = undefined; return { ok: false, status, json: async () => { throw new Error('A rejected response body must not be read.'); } }; }
            const copy = clone(record); if (this.maliciousBucket) copy.links.bucket = 'https://untrusted.invalid/api/files/stolen'; return result(copy);
        }
        if (suffix === 'actions/newversion' && method === 'POST') {
            assert.equal(record.submitted, true); const id = String(this.next++), next = clone(record); next.id = id; next.submitted = false; next.state = 'unsubmitted'; delete next.doi; delete next.nativeDoi; delete next.metadata.doi; delete next.metadata.prereserve_doi;
            next.links.bucket = `https://sandbox.zenodo.org/api/files/bucket-${id}`; next.files = next.files.map(file => ({ ...file, id: `inherited-${id}` })); this.records.set(id, next);
            return result({ links: { latest_draft: `https://sandbox.zenodo.org/api/deposit/depositions/${id}` } }, 201);
        }
        if (suffix === 'actions/publish' && method === 'POST') {
            record.submitted = true; record.state = 'done'; record.doi = record.metadata.prereserve_doi?.doi || record.metadata.doi;
            if (this.publicationAckChange === 'file') record.files[0].checksum = `md5:${hash('Changed final PDF', 'md5')}`;
            if (this.publicationAckChange === 'metadata') record.metadata.title = 'Changed final metadata';
            if (this.publicationAckChange === 'doi') record.doi = '10.5072/zenodo.999';
            return result(this.publicationAckChange === 'id' ? { ...record, id: '999' } : record);
        }
        if (suffix?.startsWith('files/') && method === 'DELETE') { record.files = record.files.filter(file => file.id !== suffix.slice(6)); return result(null, 204); }
        if (!suffix && method === 'PUT') {
            assert.equal(record.submitted, false); record.metadata = JSON.parse(options.body).metadata;
            if (record.metadata.language) assert.match(record.metadata.language, /^[a-z]{3}$/);
            if (record.metadata.prereserve_doi === true) record.metadata.prereserve_doi = { doi: `10.5072/zenodo.${record.id}`, recid: record.id };
            return result(record);
        }
        throw new Error('Unexpected mock Zenodo mutation.');
    }
}
async function fixture(options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'math-publication-'));
    const put = async (name, bytes) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), bytes); };
    await put('.math-workspace/config.json', JSON.stringify({ language: 'en' }));
    await put('book1/01-one.md', '# #h-1111111111111111 First\n\nTheorem #h-aaaaaaaaaaaaaaaa (One): $x^2+y^2=z^2$.\n\nSee @h-cccccccccccccccc and @chapter:./03-three.md.\n\n![Plot](images/plot.png)\n');
    await put('book1/02-two.md', '# #h-2222222222222222 Second\n\nTheorem #h-bbbbbbbbbbbbbbbb (Two): Intermediate.\n');
    await put('book1/03-three.md', '# #h-3333333333333333 Third\n\nTheorem #h-cccccccccccccccc (Three): $$\\int_0^1 x^2\\,dx=\\frac13$$\n\nSee @h-bbbbbbbbbbbbbbbb.\n');
    await put('book2/01-other.md', '# #h-4444444444444444 Other book\n');
    await put('book1/images/plot.png', Buffer.from('TEST PNG BYTES')); await put('cover.png', Buffer.from('TEST COVER BYTES'));
    const profile = { id: 'book', workId: 'stable-work', title: 'A continuing work', version: '0.1.0', authors: [{ name: 'Test Author' }], language: 'en-US', description: 'An explicit partial edition for tests.', license: 'cc-by-4.0', publicationDate: '2026-10-15', chapters: ['book1/03-three.md', 'book1/01-one.md'], cover: { image: 'cover.png' }, frontMatter: [{ title: 'Preface', content: '# Existing heading {#preface}\n\nSee @h-cccccccccccccccc.', includeInToc: false }], backMatter: [{ title: 'Conclusion', content: 'See @h-aaaaaaaaaaaaaaaa.\n\n# Existing conclusion {#conclusion}', includeInToc: true }], zenodo: { environment: 'sandbox', tokenEnv: 'ZENODO_TOKEN' } };
    const rendered = [], remote = new MockZenodo();
    const runCli = async (args, runtime) => {
        if (args[0] === 'render-pdf') {
            const fronts = await Promise.all(args.filter(arg => arg.startsWith('--front-matter=')).map(arg => fs.readFile(path.resolve(runtime.cwd, arg.slice('--front-matter='.length)), 'utf8')));
            rendered.push({ args, markdown: await fs.readFile(path.resolve(runtime.cwd, args[1]), 'utf8'), front: fronts[0] || '', fronts });
            if (options.failRender) throw new Error('Test renderer failed');
            if (options.mutateOnRender) await put('book1/01-one.md', 'Changed while rendering\n');
            await fs.writeFile(path.resolve(runtime.cwd, args.find(arg => arg.startsWith('--out=')).slice(6)), '%PDF-1.7\nTEST PUBLICATION\n%%EOF\n');
            return { stdout: '', stderr: '' };
        }
        const result = spawnSync(process.execPath, [cli(), ...args], { cwd: runtime.cwd, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr || result.stdout); return result;
    };
    const environment = { ZENODO_TOKEN: 'TEST_ONLY_SECRET' };
    const service = new (api().PublicationService)(root, { runCli, toolProbe: command => ({ available: true, identity: `${command} TEST` }), fetch: remote.fetch.bind(remote), environment, ...options.serviceOptions });
    return { root, put, profile, service, remote, rendered, environment, store: path.join(root, '.math-workspace/publications') };
}
async function build(f) { const plan = await f.service.plan(f.profile); return f.service.build(f.profile, plan.fingerprint); }
async function reserve(f) { const saved = await f.service.save(f.profile, null); return f.service.reserveDoi(f.profile.id, saved.revision); }
async function upload(f, release, remote) { const review = { pdfSha256: release.pdfSha256, remoteRevision: remote.revision }, preview = await f.service.reviewUpload(f.profile.id, release.id, review); return f.service.upload(f.profile.id, release.id, { ...review, uploadFingerprint: preview.fingerprint }); }

export async function testPublications() {
    let passed = 0;
    const check = async (name, body, options) => {
        const f = await fixture(options);
        try { await body(f); passed++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
        finally { await fs.rm(f.root, { recursive: true, force: true }); }
    };
    await check('inspection and planning stay passive', async f => {
        const before = await fs.readFile(path.join(f.root, '.math-workspace/config.json'));
        const inspection = await f.service.inspect(), plan = await f.service.plan(f.profile);
        assert(inspection.pages.some(page => page.book === 'book1')); assert.equal(inspection.profiles.length, 0); assert.equal(await exists(f.store), false); assert.equal(f.remote.calls.length, 0); assert.deepEqual(await fs.readFile(path.join(f.root, '.math-workspace/config.json')), before);
        assert.deepEqual(plan.selected.map(page => page.path), ['book1/01-one.md', 'book1/03-three.md']); assert.deepEqual(plan.omitted.map(page => page.path), ['book1/02-two.md']); assert.equal(plan.continuedNotice.enabled, true); assert(plan.externalReferences.some(ref => ref.target === 'book1/02-two.md'));
    });
    await check('full selected book is not partial because of another book', async f => {
        f.profile.chapters = ['book1/01-one.md', 'book1/02-two.md', 'book1/03-three.md']; const plan = await f.service.plan(f.profile); assert.equal(plan.partial, false); assert.equal(plan.continuedNotice.enabled, false);
    });
    const sharedMetadata = () => ({ title: 'Shared work', subtitle: 'A common subtitle', authors: [{ name: 'Li, Example', nativeName: '示例作者', aliases: ['Example Li'], orcid: '0000-0002-1825-0097', affiliation: 'Example Institute' }], language: 'en-US', description: 'Shared work description.', license: 'cc-by-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', website: 'https://example.org/book', repository: 'https://github.com/example/book', preferredCitation: 'Li. Shared work.', keywords: ['mathematics', 'examples'] });
    const inherit = profile => { for (const key of ['title', 'subtitle', 'authors', 'language', 'license', 'description', 'repository']) delete profile[key]; };
    await check('shared metadata is inherited without copying it into edition overrides', async f => {
        const initial = await f.service.metadata(); await f.service.saveMetadata(sharedMetadata(), initial.revision); inherit(f.profile);
        const saved = await f.service.save(f.profile, null), plan = await f.service.plan(saved.profile);
        assert.equal(saved.profile.title, undefined); assert.equal(saved.profile.authors, undefined); assert.equal(plan.profile.title, 'Shared work');
        assert.equal(plan.profile.authors[0].orcid, 'https://orcid.org/0000-0002-1825-0097'); assert.equal(plan.projectMetadata.website, 'https://example.org/book');
        assert.equal(plan.profileOverrides.title, undefined);
        const overridden = await f.service.plan({ ...f.profile, title: 'This edition', website: '', authors: [] });
        assert.equal(overridden.profile.title, 'This edition'); assert.equal(overridden.profile.website, ''); assert.deepEqual(overridden.profile.authors, []);
    });
    await check('project metadata CAS preserves config and rejects concurrent or invalid updates', async f => {
        await f.put('.math-workspace/config.json', JSON.stringify({ language: 'en', custom: { retained: true }, pdf: { margin: '3cm' } }));
        const initial = await f.service.metadata(), saved = await f.service.saveMetadata(sharedMetadata(), initial.revision);
        const config = JSON.parse(await fs.readFile(path.join(f.root, '.math-workspace/config.json')));
        assert.deepEqual(config.custom, { retained: true }); assert.equal(config.pdf.margin, '3cm'); assert.notEqual(initial.revision, saved.revision);
        await assert.rejects(f.service.saveMetadata({ title: 'Stale' }, initial.revision), /changed/);
        await assert.rejects(f.service.saveMetadata({ website: 'javascript:alert(1)' }, saved.revision), /HTTP or HTTPS/);
        await assert.rejects(f.service.saveMetadata({ repository: 'https://token@example.org/repo' }, saved.revision), /Invalid/);
        await assert.rejects(f.service.saveMetadata({ authors: [{ name: 'A', orcid: 'not-an-orcid' }] }, saved.revision), /ORCID/);
        assert.equal((await f.service.metadata()).value.title, 'Shared work'); assert.equal(f.remote.calls.length, 0);
    });
    await check('old PDF identity remains a fallback while explicit common values take precedence', async f => {
        await f.put('.math-workspace/config.json', JSON.stringify({ language: 'en', pdf: { title: 'Old title', author: 'Old author', repository: 'https://example.org/old' }, metadata: { title: 'Common title', website: 'https://example.org/new' } }));
        inherit(f.profile); const plan = await f.service.plan(f.profile);
        assert.equal(plan.profile.title, 'Common title'); assert.equal(plan.profile.authors[0].name, 'Old author'); assert.equal(plan.profile.repository, 'https://example.org/old');
        assert.equal((await f.service.plan({ ...f.profile, title: 'Legacy explicit title' })).profile.title, 'Legacy explicit title');
    });
    await check('PDF, citation and Zenodo use the same resolved author and source metadata', async f => {
        await f.service.saveMetadata(sharedMetadata(), (await f.service.metadata()).revision); inherit(f.profile);
        const remote = await reserve(f), release = await build(f), rendered = f.rendered.at(-1), citation = JSON.parse((await f.service.readArtifact('book', release.id, 'citation.json')).bytes);
        assert(rendered.args.includes('--website=https://example.org/book')); assert(rendered.args.includes('--repository=https://github.com/example/book'));
        const authors = JSON.parse(rendered.args.find(value => value.startsWith('--authors-json=')).slice('--authors-json='.length));
        assert.equal(authors[0].affiliation, 'Example Institute'); assert.deepEqual(authors[0].aliases, ['Example Li']);
        assert.equal(citation.URL, 'https://example.org/book'); assert.equal(citation.repository, 'https://github.com/example/book'); assert.equal(citation.author[0].ORCID, authors[0].orcid); assert.equal(citation.author[0].affiliation, authors[0].affiliation);
        assert.equal(citation.language, 'en-US'); assert.equal(citation.abstract, 'Shared work description.'); assert.equal(citation.note, 'Li. Shared work.');
        const uploaded = await upload(f, release, remote), native = f.remote.records.get(uploaded.draftId).nativeMetadata;
        assert.equal(native.creators[0].affiliations[0].name, authors[0].affiliation); assert.equal(native.creators[0].person_or_org.identifiers[0].identifier, '0000-0002-1825-0097');
        assert.deepEqual(native.related_identifiers.map(item => [item.identifier, item.relation_type.id]), [['https://example.org/book', 'isdescribedby'], ['https://github.com/example/book', 'isderivedfrom']]);
        assert.deepEqual(native.subjects.map(item => item.subject), ['mathematics', 'examples']);
        assert.match(native.additional_descriptions.find(item => item.type.id === 'notes').description, /Preferred citation: Li\. Shared work\./);
        assert.match(native.additional_descriptions.find(item => item.type.id === 'notes').description, /示例作者/);
        const before = await f.service.metadata(); await f.service.saveMetadata({ ...before.value, website: 'https://example.org/revised' }, before.revision);
        await assert.rejects(f.service.publish('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: uploaded.revision, recordId: uploaded.draftId }), /sources, profile, or DOI/);
        assert.equal(f.remote.records.get(uploaded.draftId).submitted, false);
        assert.equal(JSON.parse((await f.service.readArtifact('book', release.id, 'citation.json')).bytes).website, 'https://example.org/book');
    });
    await check('changing shared metadata invalidates a reviewed build fingerprint', async f => {
        await f.service.saveMetadata(sharedMetadata(), (await f.service.metadata()).revision); inherit(f.profile); const plan = await f.service.plan(f.profile);
        await f.service.saveMetadata({ ...sharedMetadata(), title: 'New common title' }, (await f.service.metadata()).revision);
        await assert.rejects(f.service.build(f.profile, plan.fingerprint), /plan changed/);
    });
    await check('common work DOI is inherited while edition DOI remains an edition value', async f => {
        const value = { ...sharedMetadata(), doi: { conceptDoi: '10.1234/work', provenance: 'From the existing work record.' } };
        await f.service.saveMetadata(value, (await f.service.metadata()).revision); inherit(f.profile);
        const plan = await f.service.plan({ ...f.profile, doi: { versionDoi: '10.1234/edition' } });
        assert.equal(plan.doi.conceptDoi, '10.1234/work'); assert.equal(plan.doi.versionDoi, '10.1234/edition'); assert.equal(plan.doi.source, 'manual');
    });
    await check('new plans discover structural matter and numbered appendices in the selected book only', async f => {
        await f.put('book1/front-matter/preface.md', '# #h-5555555555555555 A personal preface\n\nBefore the chapters.');
        await f.put('book1/back-matter/afterword.md', '# #h-6666666666666666 A personal ending\n\nAfter the appendices.');
        await f.put('book1/appendix-a-details.md', '# #h-7777777777777777 Details\n\nTheorem #h-dddddddddddddddd (Appendix result): True.');
        await f.put('book2/back-matter/other.md', '# Another book ending');
        f.profile.frontMatter = []; f.profile.backMatter = [];
        assert.equal((await f.service.plan(f.profile)).frontMatter.length, 0, 'Existing explicit plans do not silently expand.');
        assert.equal((await f.service.inspect()).defaultProfile.matter.automatic, true);
        f.profile.matter = { automatic: true }; const plan = await f.service.plan(f.profile);
        assert.deepEqual(plan.frontMatter.map(item => item.file), ['book1/front-matter/preface.md']);
        assert.deepEqual(plan.backMatter.map(item => item.file), ['book1/back-matter/afterword.md']);
        assert(plan.selected.some(page => page.path === 'book1/appendix-a-details.md')); assert(!plan.backMatter.some(item => item.file.startsWith('book2/')));
        const release = await f.service.build(f.profile, plan.fingerprint), compiled = (await f.service.readArtifact('book', release.id, 'compiled.md')).bytes.toString();
        assert.match(compiled, /Theorem A\.1/); assert(compiled.indexOf('Details') < compiled.indexOf('A personal ending'));
        assert.equal(f.rendered.at(-1).front.includes('A personal preface'), true);
        const excluded = await f.service.plan({ ...f.profile, matter: { automatic: true, exclude: ['book1/back-matter/afterword.md', 'book1/appendix-a-details.md'] } });
        assert.equal(excluded.backMatter.length, 0); assert(!excluded.selected.some(page => page.kind === 'appendix'));
    });
    await check('repository and manual front/back matter are exclusive without losing stored drafts', async f => {
        await f.put('book1/front-matter/preface.md', '# #h-5555555555555555 Repository preface\n\nREPOSITORY_FRONT');
        await f.put('book1/back-matter/afterword.md', '# #h-6666666666666666 Repository ending\n\nREPOSITORY_BACK');
        f.profile.frontMatter = [{ title: 'Manual preface', content: 'DORMANT_MANUAL_FRONT' }];
        f.profile.backMatter = [{ title: 'Manual ending', content: 'DORMANT_MANUAL_BACK' }];
        f.profile.matter = { automatic: true };
        const saved = await f.service.save(f.profile, null), plan = await f.service.plan(saved.profile);
        assert.deepEqual(plan.frontMatter.map(item => item.file), ['book1/front-matter/preface.md']);
        assert.deepEqual(plan.backMatter.map(item => item.file), ['book1/back-matter/afterword.md']);
        assert.equal(plan.profileOverrides.frontMatter[0].content, 'DORMANT_MANUAL_FRONT');
        const built = await f.service.build(saved.profile, plan.fingerprint);
        const compiled = (await f.service.readArtifact('book', built.id, 'compiled.md')).bytes.toString();
        assert.match(f.rendered.at(-1).front, /REPOSITORY_FRONT/); assert.doesNotMatch(f.rendered.at(-1).front, /DORMANT_MANUAL_FRONT/);
        assert.match(compiled, /REPOSITORY_BACK/); assert.doesNotMatch(compiled, /DORMANT_MANUAL_BACK/);
        const manual = await f.service.plan({ ...saved.profile, matter: { automatic: false } });
        assert.equal(manual.frontMatter[0].content, 'DORMANT_MANUAL_FRONT'); assert.equal(manual.backMatter[0].content, 'DORMANT_MANUAL_BACK');
        assert(!manual.frontMatter.some(item => item.file)); assert(!manual.backMatter.some(item => item.file));
    });
    await check('repository exclusions do not fall back to manual content or manual file assignments', async f => {
        const front = 'book1/front-matter/preface.md', back = 'book1/back-matter/afterword.md';
        await f.put(front, '# #h-5555555555555555 Repository preface\n\nAuthor-owned source.');
        await f.put(back, '# #h-6666666666666666 Repository ending\n\nAuthor-owned ending.');
        f.profile.frontMatter = [{ file: front, title: 'Dormant heading override', content: 'DORMANT' }];
        f.profile.backMatter = [{ file: back, content: 'DORMANT_BACK' }]; f.profile.matter = { automatic: true };
        const active = await f.service.plan(f.profile);
        assert.equal(active.frontMatter[0].title, 'Repository preface', 'A dormant manual override must not suppress or rename the detected manuscript.');
        assert.equal(active.backMatter[0].title, 'Repository ending');
        const excluded = await f.service.plan({ ...f.profile, matter: { automatic: true, exclude: [front, back] } });
        assert.equal(excluded.frontMatter.length, 0); assert.equal(excluded.backMatter.length, 0);
    });
    await check('empty inactive manual entries can be retained but cannot be published in manual mode', async f => {
        f.profile.frontMatter = [{ includeInToc: true }]; f.profile.backMatter = [];
        f.profile.matter = { automatic: true };
        const saved = await f.service.save(f.profile, null), plan = await f.service.plan(saved.profile);
        assert.equal(saved.profile.frontMatter.length, 1); assert.equal(plan.frontMatter.length, 0);
        await assert.rejects(f.service.plan({ ...saved.profile, matter: { automatic: false } }), /empty front matter/);
    });
    await check('automatic volume matter stays around the selected volume without importing another volume', async f => {
        await f.put('book1/vol-i/01-main.md', '# #h-5555555555555555 Volume one main\n\nVolume one body.');
        await f.put('book1/vol-i/front-matter/preface.md', '# #h-6666666666666666 Volume one preface\n\nFirst volume only.');
        await f.put('book1/vol-i/back-matter/ending.md', '# #h-7777777777777777 Volume one ending\n\nEnd of first volume.');
        await f.put('book1/vol-ii/01-main.md', '# #h-8888888888888888 Volume two main');
        await f.put('book1/vol-ii/back-matter/ending.md', '# #h-9999999999999999 Volume two ending');
        f.profile.chapters = ['book1/vol-i/01-main.md']; f.profile.frontMatter = []; f.profile.backMatter = []; f.profile.matter = { automatic: true };
        const plan = await f.service.plan(f.profile);
        assert.deepEqual(plan.selected.map(page => page.path), ['book1/vol-i/front-matter/preface.md', 'book1/vol-i/01-main.md', 'book1/vol-i/back-matter/ending.md']);
        assert.equal(plan.frontMatter.length, 0); assert.equal(plan.backMatter.length, 0);
        assert.equal(plan.selected.some(page => page.path.includes('vol-ii')), false);
    });
    await check('repository continued manuscripts are back matter once in their owning book or volume', async f => {
        const manuscripts = {
            'book1/vol-i/04-main.md': '# #h-e100000000000001 First volume\n\nVOLUME_ONE_BODY',
            'book1/vol-i/to-be-continued.md': '# #h-e100000000000002 First volume outlook\n\nVOLUME_ONE_OUTLOOK',
            'book1/vol-ii/05-main.md': '# #h-e100000000000003 Second volume\n\nVOLUME_TWO_BODY',
            'book1/vol-ii/to-be-continued.md': '# #h-e100000000000004 Second volume outlook\n\nVOLUME_TWO_OUTLOOK',
            'book1/back-matter/ending.md': '# #h-e100000000000005 Author afterword\n\nBOOK_AFTERWORD',
            'book1/to-be-continued.md': '# #h-e100000000000006 Next edition\n\nBOOK_OUTLOOK',
            'book2/to-be-continued.md': '# Other book outlook\n\nOTHER_BOOK_OUTLOOK'
        };
        for (const [name, content] of Object.entries(manuscripts)) await f.put(name, content);
        f.profile.chapters = ['book1/vol-i/04-main.md', 'book1/vol-ii/05-main.md'];
        f.profile.matter = { automatic: true }; f.profile.frontMatter = []; f.profile.backMatter = [];
        f.profile.continued = { enabled: true, title: 'Manual outlook', text: 'DORMANT_MANUAL_OUTLOOK' };
        const saved = await f.service.save(f.profile, null), plan = await f.service.plan(saved.profile);
        assert.deepEqual(plan.backMatter.map(entry => entry.file), ['book1/back-matter/ending.md', 'book1/to-be-continued.md']);
        assert.deepEqual(plan.selected.map(page => page.path), ['book1/vol-i/04-main.md', 'book1/vol-i/to-be-continued.md', 'book1/vol-ii/05-main.md', 'book1/vol-ii/to-be-continued.md']);
        assert.equal(plan.continuedNotice.enabled, false); assert.equal(plan.profileOverrides.continued.text, 'DORMANT_MANUAL_OUTLOOK');
        const resolvedAgain = await f.service.plan(plan.profile);
        assert.deepEqual(resolvedAgain.backMatter, plan.backMatter); assert.deepEqual(resolvedAgain.selected, plan.selected);
        assert.equal(resolvedAgain.continuedNotice.enabled, false, 'Resolving an already resolved profile retains its continued manuscripts.');
        const built = await f.service.build(saved.profile, plan.fingerprint), compiled = (await f.service.readArtifact('book', built.id, 'compiled.md')).bytes.toString();
        for (const marker of ['VOLUME_ONE_OUTLOOK', 'VOLUME_TWO_OUTLOOK', 'BOOK_OUTLOOK']) assert.equal(compiled.split(marker).length - 1, 1, `${marker} is printed once.`);
        assert(compiled.indexOf('VOLUME_ONE_OUTLOOK') < compiled.indexOf('VOLUME_TWO_BODY'));
        assert(compiled.indexOf('BOOK_AFTERWORD') < compiled.indexOf('BOOK_OUTLOOK'));
        assert.doesNotMatch(compiled, /DORMANT_MANUAL_OUTLOOK|Manual outlook|OTHER_BOOK_OUTLOOK|This is a partial edition/);
        const manual = await f.service.plan({ ...saved.profile, matter: { automatic: false } });
        assert.equal(manual.continuedNotice.text, 'DORMANT_MANUAL_OUTLOOK'); assert.equal(manual.continuedNotice.title, 'Manual outlook');
        assert.equal(manual.selected.some(page => page.kind === 'continued'), false);
    });
    await check('continued exclusions never restore inline drafts or a generated second declaration', async f => {
        const file = 'book1/to-be-continued.md'; await f.put(file, '# #h-9999999999999999 Repository outlook\n\nREPOSITORY_OUTLOOK');
        f.profile.matter = { automatic: true, exclude: [file] }; f.profile.chapters.push(file);
        f.profile.continued = { file, title: 'Dormant override', text: 'DORMANT_OUTLOOK' };
        let plan = await f.service.plan(f.profile);
        assert.equal(plan.backMatter.some(entry => entry.file === file), false); assert.equal(plan.selected.some(page => page.path === file), false);
        assert.equal(plan.continuedNotice.enabled, false);
        f.profile.matter.exclude = []; plan = await f.service.plan(f.profile);
        assert.equal(plan.backMatter.find(entry => entry.file === file).title, 'Repository outlook');
        assert.equal(plan.continuedNotice.enabled, false); assert.equal(plan.profileOverrides.continued.file, file);
        f.profile.continued.enabled = false; plan = await f.service.plan(f.profile);
        assert.equal(plan.backMatter.some(entry => entry.file === file), false); assert.equal(plan.continuedNotice.enabled, false);
    });
    await check('repository mode without a continued manuscript uses only the default declaration', async f => {
        f.profile.matter = { automatic: true };
        f.profile.continued = { file: 'unavailable-dormant.md', title: 'Dormant title', text: 'DORMANT_OUTLOOK' };
        const plan = await f.service.plan(f.profile);
        assert.equal(plan.continuedNotice.enabled, true); assert.equal(plan.continuedNotice.file, undefined);
        assert.equal(plan.continuedNotice.title, 'To be continued'); assert.doesNotMatch(plan.continuedNotice.text, /DORMANT_OUTLOOK/);
        assert.equal(plan.profileOverrides.continued.file, 'unavailable-dormant.md');
        f.profile.continued.enabled = false; assert.equal((await f.service.plan(f.profile)).continuedNotice.enabled, false);
    });
    await check('manually assigned continued manuscripts suppress an inline or default duplicate', async f => {
        const file = 'book1/to-be-continued.md'; await f.put(file, '# #h-9999999999999999 Repository outlook\n\nMANUAL_FILE_OUTLOOK');
        f.profile.continued = { enabled: true, title: 'Dormant title', text: 'DORMANT_OUTLOOK' };
        for (const placement of ['back', 'body']) {
            const profile = { ...f.profile, backMatter: placement === 'back' ? [{ file }] : [], chapters: [...f.profile.chapters, ...(placement === 'body' ? [file] : [])] };
            const plan = await f.service.plan(profile); assert.equal(plan.continuedNotice.enabled, false);
            assert.equal(plan.profileOverrides.continued.text, 'DORMANT_OUTLOOK');
            const built = await f.service.build(profile, plan.fingerprint), compiled = (await f.service.readArtifact('book', built.id, 'compiled.md')).bytes.toString();
            assert.equal(compiled.split('MANUAL_FILE_OUTLOOK').length - 1, 1); assert.doesNotMatch(compiled, /DORMANT_OUTLOOK|Dormant title/);
        }
    });
    await check('CAS keeps work identity and concurrent edits bounded', async f => {
        const one = await f.service.save(f.profile, null); await assert.rejects(f.service.save(f.profile, null), /changed/); await assert.rejects(f.service.save({ ...f.profile, workId: 'different' }, one.revision), /stable work/); const two = await f.service.save({ ...f.profile, version: '0.2.0' }, one.revision); assert.equal(two.revision, 2);
    });
    await check('profile save and provider binding share one environment lock', async f => {
        const saved = await f.service.save(f.profile, null), originalRemote = f.service.store.remote.bind(f.service.store);
        let observed, release; const seen = new Promise(resolve => { observed = resolve; }), barrier = new Promise(resolve => { release = resolve; }); let delay = true;
        f.service.store.remote = async id => { const value = await originalRemote(id); if (delay) { delay = false; observed(); await barrier; } return value; };
        const saving = f.service.save({ ...f.profile, zenodo: { environment: 'production' } }, saved.revision);
        await seen;
        try { await assert.rejects(f.service.reserveDoi('book', saved.revision), /active operation/); } finally { release(); }
        const changed = await saving; assert.equal(changed.profile.zenodo.environment, 'production'); assert.equal(await originalRemote('book'), null);
        const restored = await f.service.save(f.profile, changed.revision), bound = await f.service.reserveDoi('book', restored.revision); assert.equal(bound.environment, 'sandbox');
        await assert.rejects(f.service.save({ ...f.profile, zenodo: { environment: 'production' } }, restored.revision), /bound to another Zenodo environment/); assert.equal((await f.service.status('book')).profile.profile.zenodo.environment, bound.environment);
    });
    await check('frozen build shares formal compilation and preserves math', async f => {
        const original = await fs.readFile(path.join(f.root, 'book1/01-one.md')), result = await build(f), rendered = f.rendered[0];
        assert.match(rendered.markdown, /Chapter 1 First/); assert.match(rendered.markdown, /Chapter 3 Third/); assert.doesNotMatch(rendered.markdown, /#h-|@h-|@chapter:/); assert.match(rendered.markdown, /Theorem 2\.1/); assert.match(rendered.markdown, /\$x\^2\+y\^2=z\^2\$/); assert.match(rendered.markdown, /\\int_0\^1 x\^2\\,dx=\\frac13/);
        assert(rendered.markdown.indexOf('Conclusion') > rendered.markdown.indexOf('Chapter 3')); assert(rendered.markdown.indexOf('To be continued') > rendered.markdown.indexOf('Conclusion')); assert.match(rendered.front, /Existing heading \{#preface \.unnumbered \.unlisted\}/); assert.doesNotMatch(rendered.front, /@h-/); assert(rendered.args.includes('--toc')); assert(rendered.args.includes('--cover-image=cover.png'));
        assert.equal(rendered.args.some(arg => arg.startsWith('--documentclass=')), false, 'English keeps the renderer default.');
        assert.equal(rendered.args.some(arg => arg.includes('fontset=')), false, 'English keeps its font settings.');
        assert.match(rendered.markdown, /\\clearpage\n\\markboth\{\}\{\}\n\n# Conclusion/); assert.match(rendered.markdown, /\\clearpage\n\\markboth\{\}\{\}\n\n# To be continued/); assert.equal(rendered.args.some(arg => arg.startsWith('--doi-state=')), false);
        assert.deepEqual(await fs.readFile(path.join(f.root, 'book1/01-one.md')), original); assert.equal(await exists(path.join(f.root, '.math-workspace/workspace-index.json')), false);
        const artifact = await f.service.readArtifact('book', result.id, 'publication.pdf'); assert.equal(hash(artifact.bytes), result.pdfSha256); const second = await build(f); assert.notEqual(second.id, result.id); assert.equal((await f.service.readArtifact('book', result.id, 'publication.pdf')).bytes.toString(), artifact.bytes.toString());
    });
    await check('frozen export compiles configured Lean projects as Markdown without Lean activity', async f => {
        const configName = '.math-workspace/config.json', config = {
            language: 'en', dictionary: { en: { theorem: 'Result' } }, ui: { en: { chapter: 'Unit {number}' } }, render: { pageHeadingStyle: 'number-title' },
            pdf: { documentClass: 'article', variables: ['colorlinks:false'] },
            lean: { projects: [{ key: 'fixture', root: 'lean', sourceRoots: ['.'], target: 'Fixture' }], coverageTypes: ['theorem'] }
        };
        const leanFiles = { 'lean/Fixture.lean': 'theorem fixture_identity (n : Nat) : n = n := rfl\n', 'lean/lean-toolchain': 'leanprover/lean4:v4.33.1\n', 'lean/lakefile.toml': 'name = "fixture"\n[[lean_lib]]\nname = "Fixture"\n' };
        await f.put(configName, `${JSON.stringify(config, null, 2)}\n`);
        for (const [file, content] of Object.entries(leanFiles)) await f.put(file, content);
        const matterFiles = {
            'book1/front-matter/preface.md': '# #h-5555555555555555 Author preface\n\nLEAN_FRONT See @h-cccccccccccccccc.\n',
            'book1/back-matter/conclusion.md': '# #h-7777777777777777 Author conclusion\n\nLEAN_BACK See @h-aaaaaaaaaaaaaaaa.\n',
            'book1/to-be-continued.md': '# #h-8888888888888888 Next edition\n\nLEAN_CONTINUED See @h-bbbbbbbbbbbbbbbb.\n'
        };
        for (const [file, content] of Object.entries(matterFiles)) await f.put(file, content);
        f.profile.frontMatter = [{ file: 'book1/front-matter/preface.md' }]; f.profile.backMatter = [{ file: 'book1/back-matter/conclusion.md' }]; f.profile.continued = { file: 'book1/to-be-continued.md' };
        const plan = await f.service.plan(f.profile), originals = new Map();
        for (const file of [...plan.inputs.map(input => input.path), ...Object.keys(leanFiles)]) originals.set(file, { bytes: await fs.readFile(path.join(f.root, file)), modified: (await fs.stat(path.join(f.root, file))).mtimeMs });
        const toolBin = path.join(f.root, 'lean-probe-bin'), activityLog = path.join(f.root, 'lean-activity.log');
        await fs.mkdir(toolBin);
        for (const command of ['lean', 'lake', 'elan']) { const executable = path.join(toolBin, command); await fs.writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$0" >> "$PUBLICATION_TEST_LEAN_LOG"\nexit 93\n'); await fs.chmod(executable, 0o755); }
        const oldPath = process.env.PATH, oldLog = process.env.PUBLICATION_TEST_LEAN_LOG;
        let release;
        try { process.env.PATH = toolBin; process.env.PUBLICATION_TEST_LEAN_LOG = activityLog; release = await f.service.build(f.profile, plan.fingerprint); }
        finally { if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath; if (oldLog === undefined) delete process.env.PUBLICATION_TEST_LEAN_LOG; else process.env.PUBLICATION_TEST_LEAN_LOG = oldLog; }
        const rendered = f.rendered[0], buildRoot = path.join(f.store, 'builds/book', release.id), frozen = path.join(buildRoot, 'inputs');
        assert.match(rendered.markdown, /^# 1 First/m); assert.match(rendered.markdown, /^# 3 Third/m); assert.doesNotMatch(rendered.markdown, /^# 2 Second/m); assert.match(rendered.markdown, /Result 2\.1/); assert.match(rendered.markdown, /Unit 3/);
        assert.match(rendered.front, /LEAN_FRONT See Result 3\.1/); assert.match(rendered.markdown, /LEAN_BACK See Result 1\.1/); assert.match(rendered.markdown, /LEAN_CONTINUED See Result 2\.1/);
        assert.doesNotMatch(rendered.markdown + rendered.front, /@h-|# #h-/); assert.equal(await exists(path.join(frozen, 'lean')), false); assert.equal(await exists(activityLog), false); assert.equal(await exists(path.join(f.root, 'lean/.lake')), false);
        const exportConfig = JSON.parse(await fs.readFile(path.join(frozen, configName), 'utf8'));
        assert.deepEqual(exportConfig, { ...config, lean: { ...config.lean, projects: [] } }, 'Only the frozen export configuration disables Lean project scanning.');
        for (const [file, original] of originals) { assert.deepEqual(await fs.readFile(path.join(f.root, file)), original.bytes, file); assert.equal((await fs.stat(path.join(f.root, file))).mtimeMs, original.modified, file); }
        const manifest = JSON.parse(await fs.readFile(path.join(buildRoot, 'manifest.json'), 'utf8'));
        assert.equal(manifest.plan.fingerprint, plan.fingerprint); assert.equal(manifest.plan.inputs.find(input => input.path === configName).sha256, hash(originals.get(configName).bytes));
        assert.equal(manifest.mathematicalCorrectnessAssessed, false); assert.equal(manifest.sourceArchiveSignatureAsserted, false);
        await f.put(configName, JSON.stringify({ ...config, lean: { ...config.lean, projects: [{ ...config.lean.projects[0], target: 'ChangedTarget' }] } }));
        assert.notEqual((await f.service.plan(f.profile)).fingerprint, plan.fingerprint, 'The original Lean configuration still binds the publication plan.');
    });
    await check('Chinese publication language selects CTeX without changing the saved profile', async f => {
        f.profile.language = 'zh-CN'; const saved = await f.service.save(f.profile, null); await build(f);
        assert(f.rendered[0].args.includes('--lang=zh-CN')); assert.deepEqual(f.rendered[0].args.filter(arg => arg.startsWith('--documentclass=')), ['--documentclass=ctexart']);
        const fonts = (await f.service.plan(f.profile)).tools.chineseFonts;
        assert(f.rendered[0].args.includes(`--variable=classoption:fontset=${fonts ? 'none' : 'fandol'}`));
        if (fonts) assert(f.rendered[0].args.includes(`--variable=CJKmainfont:${fonts.family}`));
        assert.equal((await f.service.status(f.profile.id)).profile.revision, saved.revision); assert.equal((await f.service.status(f.profile.id)).profile.profile.pdf.documentClass, undefined);
        await f.put('.math-workspace/config.json', JSON.stringify({ language: 'zh' })); delete f.profile.language; await build(f);
        assert(f.rendered[1].args.includes('--lang=zh-CN')); assert.deepEqual(f.rendered[1].args.filter(arg => arg.startsWith('--documentclass=')), ['--documentclass=ctexart']);
        assert(f.rendered[1].args.includes(`--variable=classoption:fontset=${fonts ? 'none' : 'fandol'}`));
        f.profile.language = 'en-US'; await build(f);
        assert(f.rendered[2].args.includes('--lang=en-US')); assert.equal(f.rendered[2].args.some(arg => arg.startsWith('--documentclass=')), false, 'Explicit English overrides the Chinese project language.');
        assert.equal(f.rendered[2].args.some(arg => arg.includes('fontset=')), false);
    });
    await check('explicit publication document classes override the Chinese default', async f => {
        f.profile.language = 'zh-CN';
        for (const documentClass of ['ctexart', 'ctexbook', 'article']) {
            f.profile.pdf = { documentClass }; await build(f);
            assert.deepEqual(f.rendered.at(-1).args.filter(arg => arg.startsWith('--documentclass=')), [`--documentclass=${documentClass}`]);
            assert.equal(f.rendered.at(-1).args.some(arg => arg.includes('fontset=')), false, 'Explicit classes keep author font selection.');
        }
    });
    await check('source, cover, and front matter changes invalidate reviewed plan', async f => {
        const plan = await f.service.plan(f.profile); await f.put('cover.png', 'Changed cover'); await assert.rejects(f.service.build(f.profile, plan.fingerprint), /plan changed/);
        const fresh = await f.service.plan(f.profile); await assert.rejects(f.service.build({ ...f.profile, frontMatter: [{ content: 'Changed front' }] }, fresh.fingerprint), /plan changed/);
    });
    await check('source drift during rendering saves no successful build', async f => { await assert.rejects(build(f), /changed during/); assert.equal(await exists(path.join(f.store, 'builds/book')), false); }, { mutateOnRender: true });
    await check('render failures preserve prior immutable releases', async f => {
        const plan = await f.service.plan(f.profile); await assert.rejects(f.service.build(f.profile, plan.fingerprint), /Test renderer failed/); assert.equal(await exists(path.join(f.store, 'builds/book')), false);
    }, { failRender: true });
    await check('path traversal, symlink resources, and artifact reads are bounded', async f => {
        await assert.rejects(f.service.plan({ ...f.profile, chapters: ['../outside.md'] }), /paths/);
        await fs.symlink('/etc/hosts', path.join(f.root, 'linked.png')); await assert.rejects(f.service.plan({ ...f.profile, cover: { image: 'linked.png' } }), /symbolic/);
        const release = await build(f); await assert.rejects(f.service.readArtifact('book', release.id, '../config.json'), /Unknown publication artifact/); await fs.writeFile(path.join(f.store, `builds/book/${release.id}/publication.pdf`), 'changed'); await assert.rejects(f.service.readArtifact('book', release.id, 'publication.pdf'), /immutable/);
    });
    await check('manual DOI retains unverified provenance without provider requests', async f => {
        f.profile.doi = { versionDoi: 'https://doi.org/10.1234/manual-v1', conceptDoi: '10.1234/manual-work', provenance: 'Author supplied' }; const plan = await f.service.plan(f.profile); assert.equal(plan.doi.source, 'manual'); assert.equal(plan.doi.state, 'unverified'); assert.equal(plan.doi.versionDoi, '10.1234/manual-v1'); assert.equal(f.remote.calls.length, 0);
        await build(f); assert.match(f.rendered[0].args.find(arg => arg.startsWith('--doi-state=')), /supplied by the author/); assert.doesNotMatch(f.rendered[0].args.find(arg => arg.startsWith('--doi-state=')), /unpublished|reserved|draft/i);
        f.profile.language = 'zh-CN'; await build(f); assert.match(f.rendered[1].args.find(arg => arg.startsWith('--doi-state=')), /作者提供/); assert.equal(f.remote.calls.length, 0);
    });
    await check('manual work DOI cannot create a disconnected new Zenodo work', async f => {
        f.profile.doi = { conceptDoi: '10.5072/zenodo.999' }; const saved = await f.service.save(f.profile, null);
        await assert.rejects(f.service.reserveDoi('book', saved.revision), /Attach its existing Zenodo record/); assert.equal(f.remote.calls.length, 0); assert.equal((await f.service.status('book')).remote, null);
    });
    await check('all remote image forms are rejected before rendering', async f => {
        for (const content of ['![Remote](https://example.invalid/image.png)', '![Remote][poster]\n\n[poster]: https://example.invalid/image.png', '![poster][]\n\n[poster]: https://example.invalid/image.png', '<img src="https://example.invalid/image.png">']) {
            await assert.rejects(f.service.plan({ ...f.profile, frontMatter: [{ content }] }), /local frozen resources/);
        }
        const plan = await f.service.plan({ ...f.profile, frontMatter: [{ content: '```markdown\n![Example](https://example.invalid/image.png)\n```\n\n`![Example](https://example.invalid/image.png)`' }] }); assert(plan.fingerprint);
    });
    await check('matter references receive omission review and unknown refs reject', async f => {
        const plan = await f.service.plan({ ...f.profile, frontMatter: [{ content: 'See @h-bbbbbbbbbbbbbbbb.' }] }); assert(plan.externalReferences.some(reference => reference.source === 'front-matter-1.md' && reference.target === 'book1/02-two.md'));
        await assert.rejects(f.service.plan({ ...f.profile, backMatter: [{ content: 'See @h-eeeeeeeeeeeeeeee.' }] }), /Unresolved publication reference/);
    });
    await check('manuscript matter and continued files are single frozen sources with author headings', async f => {
        const files = {
            'book1/front-matter/preface.md': '# #h-5555555555555555 Author preface\n\nFRONT_SOURCE See @h-cccccccccccccccc.\n',
            'book1/front-matter/readers-letter.md': '# #h-6666666666666666 Letter to readers\n\nLETTER_SOURCE\n',
            'book1/back-matter/ai-retirement.md': '# #h-7777777777777777 AI retirement letter\n\nAI_SOURCE See @h-aaaaaaaaaaaaaaaa.\n',
            'book1/to-be-continued.md': '# #h-8888888888888888 The next volume\n\nCONTINUED_SOURCE See @h-bbbbbbbbbbbbbbbb and @page:./02-two.md.\n\n![Plot](images/plot.png)\n\n[Next chapter](02-two.md)\n'
        };
        for (const [file, content] of Object.entries(files)) await f.put(file, content);
        f.profile.chapters.push(...Object.keys(files));
        f.profile.frontMatter = [{ file: 'book1/front-matter/preface.md', content: 'DORMANT_FRONT' }, { file: 'book1/front-matter/readers-letter.md', includeInToc: true }];
        f.profile.backMatter = [{ file: 'book1/back-matter/ai-retirement.md', content: 'DORMANT_BACK', includeInToc: true }];
        f.profile.continued = { file: 'book1/to-be-continued.md', text: 'DORMANT_CONTINUED' };
        const saved = await f.service.save(f.profile, null), plan = await f.service.plan(saved.profile);
        assert.equal(saved.profile.frontMatter[0].content, 'DORMANT_FRONT'); assert.equal(saved.profile.continued.text, 'DORMANT_CONTINUED');
        assert.deepEqual(plan.selected.map(page => page.path), ['book1/01-one.md', 'book1/03-three.md']);
        assert.equal(plan.frontMatter[0].title, 'Author preface'); assert.equal(plan.backMatter[0].title, 'AI retirement letter');
        assert.equal(plan.continuedNotice.title, 'The next volume'); assert.equal(plan.continuedNotice.file, 'book1/to-be-continued.md'); assert.equal(plan.continuedNotice.text, files['book1/to-be-continued.md']);
        assert.ok(plan.inputs.some(input => input.path === 'book1/to-be-continued.md' && input.role === 'continued'));
        assert.ok(plan.inputs.some(input => input.path === 'book1/back-matter/ai-retirement.md' && input.role === 'back-matter'));
        assert.ok(plan.externalReferences.some(reference => reference.source === 'book1/to-be-continued.md' && reference.target === 'book1/02-two.md'));
        const release = await f.service.build(saved.profile, plan.fingerprint), rendered = f.rendered[0];
        assert.equal(rendered.fronts.length, 2); assert.equal((rendered.fronts.join('\n').match(/FRONT_SOURCE/g) || []).length, 1);
        assert.equal((rendered.markdown.match(/AI_SOURCE/g) || []).length, 1); assert.equal((rendered.markdown.match(/CONTINUED_SOURCE/g) || []).length, 1);
        assert.equal((rendered.markdown.match(/^# The next volume\b/gm) || []).length, 1); assert.equal((rendered.front.match(/^# Author preface\b/gm) || []).length, 1);
        assert.doesNotMatch(rendered.markdown + rendered.fronts.join('\n'), /DORMANT_|@h-|@page:|^# #h-/m);
        assert.match(rendered.markdown, /book1\/images\/plot\.png/); assert.match(rendered.markdown, /#h-8888888888888888/);
        assert.equal(rendered.args.some(arg => arg.startsWith('--front-matter-title=')), false, 'A file H1 is not duplicated by a generated title.');
        const buildRoot = path.join(f.store, 'builds/book', release.id);
        for (const [file, content] of Object.entries(files)) { assert.equal(await fs.readFile(path.join(f.root, file), 'utf8'), content); assert.equal(await fs.readFile(path.join(buildRoot, 'inputs', file), 'utf8'), content); }
        assert.equal(JSON.parse(await fs.readFile(path.join(buildRoot, 'manifest.json'), 'utf8')).plan.continuedNotice.file, 'book1/to-be-continued.md');
        await f.put('book1/to-be-continued.md', files['book1/to-be-continued.md'] + '\nUpdated source.\n');
        await assert.rejects(f.service.build(saved.profile, plan.fingerprint), /plan changed/);
    });
    await check('back matter clears running marks after each author heading before its body', async f => {
        await f.put('book1/back-matter/afterword.md', '# #h-9999999999999999 Author afterword\n\nAFTERWORD_BODY\n');
        await f.put('book1/back-matter/retirement.md', '# #h-eeeeeeeeeeeeeeee AI retirement letter\n\nRETIREMENT_BODY\n');
        f.profile.backMatter = [{ file: 'book1/back-matter/afterword.md', includeInToc: true }, { file: 'book1/back-matter/retirement.md' }, { title: 'Legacy afterword', content: 'INLINE_BACK_BODY' }];
        await build(f); const markdown = f.rendered[0].markdown;
        assert.match(markdown, /^# Author afterword \{#h-9999999999999999 \.unnumbered\}\n\n\\markboth\{\}\{\}\s+AFTERWORD_BODY/m);
        assert.match(markdown, /^# AI retirement letter \{#h-eeeeeeeeeeeeeeee \.unnumbered \.unlisted\}\n\n\\markboth\{\}\{\}\s+RETIREMENT_BODY/m);
        assert.match(markdown, /^# Legacy afterword \{\.unnumbered \.unlisted\}\n\n\\markboth\{\}\{\}\s+INLINE_BACK_BODY/m);
        assert.doesNotMatch(markdown, /\\markboth\{(?:Author afterword|AI retirement letter|Legacy afterword)/);
    });
    await check('continued file paths and duplicate matter roles are validated without source writes', async f => {
        await f.put('book1/back-matter/note.md', '# #h-9999999999999999 A source note\n\nContent.\n');
        await f.put('node_modules/hidden.md', '# Excluded source\n');
        for (const file of ['../outside.md', '/tmp/outside.md', 'book1/../note.md']) await assert.rejects(f.service.plan({ ...f.profile, continued: { file } }), /paths/);
        for (const file of ['missing.md', 'README.md', 'node_modules/hidden.md']) await assert.rejects(f.service.plan({ ...f.profile, continued: { file } }), /unavailable or excluded/);
        await assert.rejects(f.service.plan({ ...f.profile, continued: { file: 'cover.png' } }), /Markdown/);
        await fs.symlink(path.join(f.root, 'book1/back-matter'), path.join(f.root, 'linked-matter'));
        await assert.rejects(f.service.plan({ ...f.profile, continued: { file: 'linked-matter/note.md' } }), /symbolic/);
        const file = 'book1/back-matter/note.md';
        await assert.rejects(f.service.plan({ ...f.profile, frontMatter: [{ file }], backMatter: [{ file }] }), /one matter role/);
        await assert.rejects(f.service.plan({ ...f.profile, backMatter: [{ file }], continued: { file } }), /one matter role/);
        await assert.rejects(f.service.plan({ ...f.profile, frontMatter: [{ file }, { file }] }), /one matter role/);
        const saved = await f.service.save(f.profile, null);
        await assert.rejects(f.service.save({ ...f.profile, backMatter: [{ file }], continued: { file } }, saved.revision), /one matter role/);
        assert.equal((await f.service.status(f.profile.id)).profile.revision, saved.revision, 'Ambiguous roles cannot overwrite the saved profile.');
        assert.equal(await fs.readFile(path.join(f.root, file), 'utf8'), '# #h-9999999999999999 A source note\n\nContent.\n');
    });
    await check('enabled full-edition file notice keeps author heading and dormant inline draft', async f => {
        const file = 'book1/to-be-continued.md'; await f.put(file, '# #h-9999999999999999 Original ending\n\nFILE_BODY\n');
        f.profile.chapters = ['book1/01-one.md', 'book1/02-two.md', 'book1/03-three.md'];
        f.profile.continued = { enabled: true, file, title: 'Override ending', text: 'INLINE_BACKUP' };
        let plan = await f.service.plan(f.profile); assert.equal(plan.partial, false); assert.equal(plan.continuedNotice.enabled, true);
        assert.equal(plan.continuedNotice.title, 'Original ending');
        await f.service.build(f.profile, plan.fingerprint); assert.match(f.rendered[0].markdown, /^# Original ending /m); assert.doesNotMatch(f.rendered[0].markdown, /Override ending|INLINE_BACKUP/);
        f.profile.continued = { enabled: true, title: 'Inline ending', text: 'INLINE_BACKUP' };
        plan = await f.service.plan(f.profile); assert.equal(plan.continuedNotice.text, 'INLINE_BACKUP'); await f.service.build(f.profile, plan.fingerprint); assert.match(f.rendered[1].markdown, /INLINE_BACKUP/);
        f.profile.continued = { enabled: false, file: 'missing.md', text: 'DISABLED' }; plan = await f.service.plan(f.profile); assert.equal(plan.continuedNotice.enabled, false);
    });
    await check('nested LaTeX resources are frozen and affect fingerprint', async f => {
        await f.put('preamble.tex', '\\input{nested/macros.tex}\n'); await f.put('nested/macros.tex', '\\newcommand{\\proofmark}{QED}\n'); await f.put('book1/03-three.md', `${await fs.readFile(path.join(f.root, 'book1/03-three.md'), 'utf8')}\n\\input{preamble.tex}\n`);
        const plan = await f.service.plan(f.profile); assert(plan.inputs.some(input => input.path === 'nested/macros.tex')); await f.put('nested/macros.tex', '\\newcommand{\\proofmark}{Done}\n'); assert.notEqual((await f.service.plan(f.profile)).fingerprint, plan.fingerprint);
    });
    await check('reserve reuses existing draft and keeps concept/version DOI separate', async f => {
        const first = await reserve(f), again = await f.service.reserveDoi('book', 1); assert.equal(first.draftId, again.draftId); assert.equal(f.remote.calls.filter(call => call.path === '/api/deposit/depositions' && call.method === 'POST').length, 1); assert.notEqual(again.conceptDoi, again.versionDoi); assert.equal((await f.service.plan(f.profile)).doi.state, 'reserved'); assert.equal((await fs.readFile(path.join(f.store, 'remote/book.json'), 'utf8')).includes('TEST_ONLY_SECRET'), false);
    });
    await check('unknown create cannot duplicate and explicit attach reconciles', async f => {
        await f.service.save(f.profile, null); f.remote.unknownCreate = true; await assert.rejects(f.service.reserveDoi('book', 1), error => !error.message.includes('TEST_ONLY_SECRET') && /unknown/.test(error.message)); await assert.rejects(f.service.reserveDoi('book', 1), /unresolved/); const attached = await f.service.attachZenodo('book', 1, { id: '101', kind: 'draft' }); assert.equal(attached.status, 'draft'); const reserved = await f.service.reserveDoi('book', 1); assert(reserved.versionDoi); assert.equal(f.remote.next, 102);
    });
    for (const status of [401, 403]) await check(`initial create HTTP ${status} permits corrected credential retry`, async f => {
        const saved = await f.service.save(f.profile, null); f.environment.ZENODO_TOKEN = 'BAD_TEST_TOKEN'; f.remote.expectedToken = 'BAD_TEST_TOKEN'; f.remote.createStatus = status;
        await assert.rejects(f.service.reserveDoi('book', saved.revision), error => error.status === status && !error.message.includes('BAD_TEST_TOKEN'));
        assert.equal((await f.service.status('book')).remote, null); assert.equal(f.remote.records.size, 0);
        f.environment.ZENODO_TOKEN = 'CORRECTED_TEST_TOKEN'; f.remote.expectedToken = 'CORRECTED_TEST_TOKEN'; const remote = await f.service.reserveDoi('book', saved.revision);
        assert.equal(remote.status, 'draft'); assert.equal(f.remote.records.size, 1); assert.equal(f.remote.calls.filter(call => call.path === '/api/deposit/depositions' && call.method === 'POST').length, 2);
    });
    for (const status of [400, 404, 409, 422, 429, 500, 503]) await check(`initial create HTTP ${status} keeps unknown-result duplicate protection`, async f => {
        const saved = await f.service.save(f.profile, null); f.remote.createStatus = status; await assert.rejects(f.service.reserveDoi('book', saved.revision), error => error.status === status);
        const unknown = (await f.service.status('book')).remote; assert.equal(unknown.status, 'unknown'); assert.equal(unknown.pending.action, 'create'); assert.equal(unknown.draftId, undefined);
        await assert.rejects(f.service.reserveDoi('book', saved.revision), /unresolved/); assert.equal(f.remote.calls.length, 1);
    });
    await check('malformed creation acknowledgement remains unknown and cannot create twice', async f => {
        const saved = await f.service.save(f.profile, null); f.remote.malformedCreate = true; await assert.rejects(f.service.reserveDoi('book', saved.revision), /invalid JSON acknowledgement/);
        assert.equal((await f.service.status('book')).remote.pending.action, 'create'); await assert.rejects(f.service.reserveDoi('book', saved.revision), /unresolved/); assert.equal(f.remote.records.size, 1); assert.equal(f.remote.calls.length, 1);
    });
    for (const status of [401, 403]) await check(`HTTP ${status} after an acknowledged draft retains its identity`, async f => {
        const saved = await f.service.save(f.profile, null); f.remote.getStatus = status; await assert.rejects(f.service.reserveDoi('book', saved.revision), error => error.status === status);
        const retained = (await f.service.status('book')).remote; assert.equal(retained.draftId, '101'); const retried = await f.service.reserveDoi('book', saved.revision); assert.equal(retried.draftId, retained.draftId); assert.equal(f.remote.records.size, 1);
    });
    await check('same work cannot silently create a second provider record', async f => {
        await reserve(f); const other = { ...f.profile, id: 'duplicate-profile' }; const saved = await f.service.save(other, null); const creates = f.remote.calls.filter(call => call.path === '/api/deposit/depositions' && call.method === 'POST').length;
        await assert.rejects(f.service.reserveDoi(other.id, saved.revision), /already has a Zenodo binding/); assert.equal(f.remote.calls.filter(call => call.path === '/api/deposit/depositions' && call.method === 'POST').length, creates);
    });
    await check('internal provider guard cannot collide with a valid profile identity', async f => { f.profile.id = 'zenodo-work-bindings'; const remote = await reserve(f); assert.equal(remote.status, 'draft'); });
    await check('compatibility placeholder is replaced by an actual native DOI reservation', async f => {
        f.remote.placeholderReservation = true; const remote = await reserve(f);
        assert.equal(remote.versionDoi, '10.5072/zenodo.101');
        assert.equal(f.remote.calls.filter(call => call.method === 'POST' && call.path.endsWith('/pids/doi')).length, 1);
        await f.service.reserveDoi('book', 1);
        assert.equal(f.remote.calls.filter(call => call.method === 'POST' && call.path.endsWith('/pids/doi')).length, 1);
    });
    await check('lost native DOI acknowledgement is reconciled without a second reservation', async f => {
        f.remote.unknownReservation = true; await f.service.save(f.profile, null);
        await assert.rejects(f.service.reserveDoi('book', 1), /unknown/);
        assert.equal((await f.service.status('book')).remote.pending.action, 'reserve-doi');
        await assert.rejects(f.service.reserveDoi('book', 1), /unresolved/);
        const attached = await f.service.attachZenodo('book', 1, { id: '101', kind: 'draft' }); assert.equal(attached.versionDoi, '10.5072/zenodo.101'); assert.equal(attached.pending, undefined);
        await f.service.reserveDoi('book', 1); assert.equal(f.remote.calls.filter(call => call.method === 'POST' && call.path.endsWith('/pids/doi')).length, 1);
    });
    await check('a PDF with a stale native reservation cannot be uploaded', async f => {
        const remote = await reserve(f), release = await build(f); delete f.remote.records.get(remote.draftId).nativeDoi;
        await assert.rejects(f.service.reviewUpload('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: remote.revision }), /native Zenodo DOI/);
        assert.equal(f.remote.calls.some(call => call.method === 'DELETE'), false);
    });
    await check('legacy bare MD5 retains owned files and exact upload across publication', async f => {
        f.remote.bareFileChecksums = true; const remote = await reserve(f), release = await build(f), uploaded = await upload(f, release, remote);
        assert.equal(uploaded.draftFiles[0].owned, true); assert.equal(uploaded.upload.buildId, release.id);
        const changes = await f.service.reviewUpload('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: uploaded.revision }); assert.deepEqual(changes.blocked, []);
        const published = await f.service.publish('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: uploaded.revision, recordId: uploaded.draftId });
        assert.equal(published.upload.buildId, release.id); assert.equal(published.draftFiles[0].owned, true);
    });
    await check('nullable creator fields normalize without accepting changed affiliations', async f => {
        f.remote.nullableCreatorAffiliations = true; const remote = await reserve(f), release = await build(f), uploaded = await upload(f, release, remote);
        const review = { pdfSha256: release.pdfSha256, remoteRevision: uploaded.revision, recordId: uploaded.draftId };
        f.remote.records.get(uploaded.draftId).metadata.creators[0].affiliation = 'Changed affiliation';
        await assert.rejects(f.service.publish('book', release.id, review), /metadata changed/);
        delete f.remote.records.get(uploaded.draftId).metadata.creators[0].affiliation;
        assert.equal((await f.service.publish('book', release.id, review)).status, 'published');
    });
    await check('metadata updates retain the native DOI registration provider and unrelated metadata', async f => {
        const remote = await reserve(f), release = await build(f), record = f.remote.records.get(remote.draftId);
        record.nativeMetadata = { keywords: ['retained'] };
        await upload(f, release, remote); assert.equal(record.nativeProvider, 'datacite'); assert.deepEqual(record.nativeMetadata.keywords, ['retained']);
        assert.equal(f.remote.calls.some(call => call.method === 'PUT' && call.path === `/api/deposit/depositions/${remote.draftId}`), false);
    });
    await check('externally reclassified DOI blocks a provider-owned edition', async f => {
        const remote = await reserve(f), release = await build(f); f.remote.records.get(remote.draftId).nativeProvider = 'external';
        await assert.rejects(f.service.reviewUpload('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: remote.revision }), /registration provider/);
    });
    await check('exact upload and explicit publication preserve old version', async f => {
        const remote = await reserve(f), release = await build(f); await assert.rejects(f.service.publish('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: remote.revision, recordId: remote.draftId }), /exact uploaded/);
        const uploaded = await upload(f, release, remote); await assert.rejects(f.service.publish('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: uploaded.revision, recordId: '999' }), /record identity/);
        const published = await f.service.publish('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: uploaded.revision, recordId: uploaded.draftId }); assert.equal(published.status, 'published'); await assert.rejects(f.service.reserveDoi('book', 1), /immutable/);
        const previous = clone(f.remote.records.get(published.recordId)); f.profile.version = '0.2.0'; f.profile.doi = { versionDoi: published.versionDoi, conceptDoi: published.conceptDoi }; await f.service.save(f.profile, 1); const effects = f.remote.calls.length; await assert.rejects(f.service.reserveDoi('book', 2, { mode: 'new-version', expectedRecordId: published.recordId }), /manually entered version DOI/); assert.equal(f.remote.calls.length, effects);
        f.profile.doi = { conceptDoi: published.conceptDoi }; const saved = await f.service.save(f.profile, 2); const next = await f.service.reserveDoi('book', saved.revision, { mode: 'new-version', expectedRecordId: published.recordId }); assert.notEqual(next.draftId, published.recordId); assert.equal(next.conceptDoi, published.conceptDoi); assert.notEqual(next.versionDoi, published.versionDoi); assert.deepEqual(f.remote.records.get(published.recordId), previous);
        const newer = await build(f), review = await f.service.reviewUpload('book', newer.id, { pdfSha256: newer.pdfSha256, remoteRevision: next.revision }); assert.deepEqual(review.remove, ['book-0.1.0.pdf']); assert.equal(review.blocked.length, 0); await f.service.upload('book', newer.id, { pdfSha256: newer.pdfSha256, remoteRevision: next.revision, uploadFingerprint: review.fingerprint }); assert.deepEqual(f.remote.records.get(published.recordId), previous);
    });
    await check('unowned draft files block without any deletion', async f => {
        const remote = await reserve(f), release = await build(f); f.remote.records.get(remote.draftId).files.push({ id: 'foreign', filename: 'other-material.pdf', checksum: 'md5:unknown' });
        const preview = await f.service.reviewUpload('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: remote.revision }); assert.deepEqual(preview.blocked, ['other-material.pdf']); await assert.rejects(f.service.upload('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: remote.revision, uploadFingerprint: preview.fingerprint }), /not owned/); assert.equal(f.remote.calls.some(call => call.method === 'DELETE'), false);
    });
    await check('lost upload acknowledgement recovers only file ownership until exact reupload', async f => {
        const remote = await reserve(f), release = await build(f); f.remote.unknownUpload = true;
        await assert.rejects(upload(f, release, remote), /unknown/); assert.equal((await f.service.status('book')).remote.pending.action, 'upload');
        const attached = await f.service.attachZenodo('book', 1, { id: remote.draftId, kind: 'draft' }); assert.equal(attached.upload, undefined); assert.equal(attached.pending, undefined); assert.equal(attached.draftFiles[0].owned, true); assert.equal(attached.ownedFiles[0].pdfSha256, release.pdfSha256);
        const review = { pdfSha256: release.pdfSha256, remoteRevision: attached.revision }, preview = await f.service.reviewUpload('book', release.id, review); assert.deepEqual(preview.blocked, []); assert.deepEqual(preview.replace, ['book-0.1.0.pdf']);
        await assert.rejects(f.service.publish('book', release.id, { ...review, recordId: attached.draftId }), /exact uploaded/);
        const uploaded = await f.service.upload('book', release.id, { ...review, uploadFingerprint: preview.fingerprint }); assert.equal(uploaded.upload.buildId, release.id);
    });
    await check('lost upload reconciliation never owns a checksum mismatch', async f => {
        const remote = await reserve(f), release = await build(f); f.remote.unknownUpload = true; await assert.rejects(upload(f, release, remote), /unknown/); f.remote.records.get(remote.draftId).files[0].checksum = 'md5:not-the-built-PDF';
        const attached = await f.service.attachZenodo('book', 1, { id: remote.draftId, kind: 'draft' }), preview = await f.service.reviewUpload('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: attached.revision }); assert.equal(attached.upload, undefined); assert.equal(attached.draftFiles[0].owned, false); assert.deepEqual(preview.blocked, ['book-0.1.0.pdf']);
    });
    await check('remote file changes and stale sources block reviewed upload', async f => {
        const remote = await reserve(f), release = await build(f), review = { pdfSha256: release.pdfSha256, remoteRevision: remote.revision }, preview = await f.service.reviewUpload('book', release.id, review);
        f.remote.records.get(remote.draftId).files.push({ id: 'new', filename: 'added.pdf', checksum: 'md5:new' }); await assert.rejects(f.service.upload('book', release.id, { ...review, uploadFingerprint: preview.fingerprint }), /file plan changed/);
        f.remote.records.get(remote.draftId).files = []; await f.put('book1/02-two.md', '# Changed omitted chapter\n'); await assert.rejects(f.service.reviewUpload('book', release.id, review), /sources, profile, or DOI/);
    });
    await check('publish rejects draft file and metadata drift', async f => {
        const remote = await reserve(f), release = await build(f), uploaded = await upload(f, release, remote), record = f.remote.records.get(uploaded.draftId), review = { pdfSha256: release.pdfSha256, remoteRevision: uploaded.revision, recordId: uploaded.draftId };
        record.metadata.title = 'Changed title'; await assert.rejects(f.service.publish('book', release.id, review), /metadata changed/); record.metadata.title = f.profile.title; record.files.push({ id: 'extra', filename: 'extra.pdf', checksum: 'md5:extra' }); await assert.rejects(f.service.publish('book', release.id, review), /draft changed/); assert.equal(f.remote.calls.some(call => call.path.endsWith('/actions/publish')), false);
    });
    for (const change of ['file', 'metadata', 'doi', 'id']) await check(`final publication acknowledgement validates ${change}`, async f => {
        const remote = await reserve(f), release = await build(f), uploaded = await upload(f, release, remote); f.remote.publicationAckChange = change;
        await assert.rejects(f.service.publish('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: uploaded.revision, recordId: uploaded.draftId }), /requires reconciliation/);
        const uncertain = (await f.service.status('book')).remote; assert.equal(uncertain.status, 'unknown'); assert.equal(uncertain.pending.action, 'publish');
        if (change === 'file') { const attached = await f.service.attachZenodo('book', 1, { id: uploaded.draftId, kind: 'record' }); assert.equal(attached.status, 'published'); assert.equal(attached.upload, undefined); assert.equal(attached.draftFiles[0].owned, false); }
    });
    await check('untrusted upload URLs never receive credentials', async f => {
        const remote = await reserve(f), release = await build(f), preview = await f.service.reviewUpload('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: remote.revision }); f.remote.maliciousBucket = true;
        await assert.rejects(f.service.upload('book', release.id, { pdfSha256: release.pdfSha256, remoteRevision: remote.revision, uploadFingerprint: preview.fingerprint }), /untrusted API URL/); assert.equal(f.remote.calls.some(call => call.path.includes('stolen')), false);
    });
    await check('dead owner lock recovers while active owner lock remains held', async f => {
        await fs.mkdir(path.join(f.store, 'locks/profile/book'), { recursive: true }); await fs.writeFile(path.join(f.store, 'locks/profile/book/owner.json'), JSON.stringify({ pid: 2147483647 })); await f.service.save(f.profile, null);
        await fs.mkdir(path.join(f.store, 'locks/profile/book')); await fs.writeFile(path.join(f.store, 'locks/profile/book/owner.json'), JSON.stringify({ pid: process.pid })); await assert.rejects(f.service.save(f.profile, 1), /active operation/); await fs.rm(path.join(f.store, 'locks/profile/book'), { recursive: true });
    });
    await check('default PDF subprocess excludes both default and custom credential variables', async f => {
        const wrapper = path.join(f.root, 'credential-boundary.cjs'), oldDefault = process.env.ZENODO_TOKEN, oldCustom = process.env.PUBLICATION_TEST_TOKEN;
        await fs.writeFile(wrapper, `const fs=require('node:fs'); const path=require('node:path'); const cp=require('node:child_process'); if(process.env.ZENODO_TOKEN||process.env.PUBLICATION_TEST_TOKEN) process.exit(31); const args=process.argv.slice(2); if(args[0]==='render-pdf'){fs.writeFileSync(path.resolve(process.cwd(),args.find(x=>x.startsWith('--out=')).slice(6)),'%PDF-1.7\\nTEST\\n%%EOF\\n');}else{const r=cp.spawnSync(process.execPath,[${JSON.stringify(cli())},...args],{stdio:'inherit',env:process.env});process.exit(r.status||0);}`);
        process.env.ZENODO_TOKEN = 'TEST_DEFAULT_ONLY'; process.env.PUBLICATION_TEST_TOKEN = 'TEST_CUSTOM_ONLY';
        try {
            f.profile.zenodo.tokenEnv = 'PUBLICATION_TEST_TOKEN';
            const service = new (api().PublicationService)(f.root, { cliPath: wrapper, toolProbe: command => ({ available: true, identity: `${command} TEST` }) });
            const plan = await service.plan(f.profile), release = await service.build(f.profile, plan.fingerprint); assert(release.pdfSha256);
            const manifest = await service.readArtifact('book', release.id, 'manifest.json'); assert.equal(manifest.bytes.includes(Buffer.from('TEST_CUSTOM_ONLY')), false);
        } finally {
            if (oldDefault === undefined) delete process.env.ZENODO_TOKEN; else process.env.ZENODO_TOKEN = oldDefault;
            if (oldCustom === undefined) delete process.env.PUBLICATION_TEST_TOKEN; else process.env.PUBLICATION_TEST_TOKEN = oldCustom;
        }
    });
    console.log(`PDF publication backend: ${passed} focused contracts passed.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await testPublications();
