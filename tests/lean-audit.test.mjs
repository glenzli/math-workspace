import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createLeanReviewFixture } from './lean-review.test.mjs';

const require = createRequire(import.meta.url), repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = 'h-1111111111111111', B = 'h-2222222222222222', D = 'h-5555555555555555';
function pos(content, offset, startLine) { const lines = content.slice(0, offset).split('\n'); return { line: startLine - 1 + lines.length - 1, character: lines.at(-1).length }; }
function anchor(source, quote, subclaimId) {
    const offset = source.source.content.indexOf(quote); assert.ok(offset >= 0, 'Fixture quote belongs to source');
    return { filePath: source.source.filePath, fileHash: source.fileHash, quote,
        range: { start: pos(source.source.content, offset, source.source.startLine), end: pos(source.source.content, offset + quote.length, source.source.startLine) },
        ...(source.projectKey ? { projectKey: source.projectKey, declarationKey: source.declarationKey } : { snippetKey: source.key }),
        ...(subclaimId ? { subclaimId } : {}) };
}
function base(payload) { return { id: payload.id, expectedRevision: payload.expectedRevision, evidenceFingerprint: payload.evidenceFingerprint, reviewer: 'Author' }; }
function manualBody(response, overrides = {}) { return { action: 'save', id: response.id, expectedRevision: response.review.expectedRevision,
    evidenceFingerprint: response.evidence.fingerprint, verdict: 'partial', scope: 'Identity only; certificate construction remains open.', note: '', reviewer: 'Author',
    subclaims: [{ id: 'construction', text: 'Construct a certificate.', verdict: 'undecided', note: '', declarationKeys: [] }], ...overrides }; }
function linkBody(payload, options = {}) {
    const prose = payload.proseSources.find(value => value.source.role === 'statement');
    const lean = payload.leanSources.find(value => value.key.endsWith('certificate_input'));
    return { ...base(payload), action: 'create-link', prose: anchor(prose, 'certificate can be constructed', 'construction'),
        lean: anchor(lean, 'certificate.proof'), verdict: 'difference', note: 'Certificate is a supplied input.',
        correspondences: [{ kind: 'assumption', prose: 'Construct a certificate', lean: 'certificate : Certificate n', note: 'Lean receives it.' }], ...options };
}
function issueBody(payload, linkId, overrides = {}) { return { ...base(payload), action: 'create-issue', linkId, category: 'assumption',
    title: 'Construction is assumed', note: 'The theorem uses a supplied certificate.', status: 'open', resolution: '', ...overrides }; }

export async function testLeanAuditBackend() {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'math-workspace-lean-audit-')); let review, server;
    try {
        await build({ entryPoints: ['src/lean/lean-review-service.ts', 'src/lean/lean-review-store.ts', 'src/lean/lean-audit-service.ts', 'src/lean/lean-audit-store.ts', 'src/lean/lean-audit-routes.ts', 'src/reader/server.ts'].map(value => path.join(repoRoot, value)),
            bundle: true, platform: 'node', format: 'cjs', outdir: path.join(temporary, 'bundle'), outExtension: { '.js': '.cjs' }, tsconfig: path.join(repoRoot, 'tsconfig.cli.json'), logLevel: 'silent' });
        const { LeanReviewService } = require(path.join(temporary, 'bundle/lean/lean-review-service.cjs'));
        const { LeanAuditService } = require(path.join(temporary, 'bundle/lean/lean-audit-service.cjs'));
        const { handleLeanAuditRoute } = require(path.join(temporary, 'bundle/lean/lean-audit-routes.cjs'));
        const { updateAuditRecord, auditEvent } = require(path.join(temporary, 'bundle/lean/lean-audit-store.cjs'));
        const { saveReviewRecord } = require(path.join(temporary, 'bundle/lean/lean-review-store.cjs'));
        const { startReaderServer } = require(path.join(temporary, 'bundle/reader/server.cjs'));
        const root = await createLeanReviewFixture(path.join(temporary, 'project'), { buildLean: false });
        await fs.mkdir(path.join(root, 'other-book'));
        await fs.writeFile(path.join(root, 'other-book/02-other.md'), `# Another chapter\n\n定理 #${D}（Other chapter）：True.\n`);
        const leanBefore = await fs.readFile(path.join(root, 'lean/ReviewFixture.lean'), 'utf8');
        const proseBefore = await fs.readFile(path.join(root, 'book/01-review.md'), 'utf8');
        review = new LeanReviewService(); let audit = new LeanAuditService(review);
        const initial = await audit.get(root, A);
        assert.equal(initial.expectedRevision, 0); assert.equal(initial.manualReview.freshness, 'unreviewed');
        assert.equal(await fs.access(path.join(root, '.math-workspace/lean-audits')).then(() => true, () => false), false, 'Passive audit reads create no records.');
        assert.equal(await fs.access(path.join(root, 'lean/.lake')).then(() => true, () => false), false, 'Audit reads never build.');
        await review.action(root, manualBody(await review.get(root, A)));
        const mainPath = path.join(root, `.math-workspace/lean-reviews/${A}.json`);
        const inherited = JSON.parse(await fs.readFile(mainPath, 'utf8')); delete inherited.history; delete inherited.historyDropped;
        await fs.writeFile(mainPath, JSON.stringify(inherited));
        await review.action(root, manualBody(await review.get(root, A), { note: 'Second human decision' }));
        const withHistory = await audit.get(root, A);
        assert.equal(withHistory.manualReview.history.length, 2, 'First update retains a legacy previous human decision atomically.');
        assert.equal(withHistory.manualReview.history[0].revision, 1); assert.equal(withHistory.manualReview.history[1].note, 'Second human decision');
        const linked = await audit.action(root, linkBody(withHistory));
        assert.equal(linked.links.length, 1); assert.equal(linked.links[0].freshness, 'current');
        assert.match(linked.links[0].link.prose.fileHash, /^[a-f0-9]{64}$/); assert.equal(linked.links[0].link.lean.quote, 'certificate.proof');
        assert.match(linked.links[0].link.prose.subclaimHash, /^[a-f0-9]{64}$/);
        const linkId = linked.links[0].link.id;
        await assert.rejects(audit.action(root, linkBody(withHistory)), /changed in another window/);
        let issue = await audit.action(root, issueBody(linked, linkId));
        const issueId = issue.issues[0].issue.id;
        issue = await audit.action(root, issueBody(issue, linkId, { action: 'update-issue', issueId, status: 'resolved', resolution: 'Scope explicitly restricted to supplied certificates.' }));
        assert.equal(issue.issues[0].unresolved, false); assert.equal(issue.record.history.at(-1).before.status, 'open');
        assert.equal(issue.record.history.at(-1).after.status, 'resolved');
        const concurrent = await Promise.allSettled([audit.action(root, issueBody(issue, linkId, { title: 'A' })), audit.action(root, issueBody(issue, linkId, { title: 'B' }))]);
        assert.equal(concurrent.filter(value => value.status === 'fulfilled').length, 1, 'Only one concurrent revision writer succeeds.');
        issue = await audit.get(root, A);
        await review.close(); review = new LeanReviewService(); audit = new LeanAuditService(review);
        assert.equal((await audit.get(root, A)).expectedRevision, issue.expectedRevision, 'Audit artifacts persist across owner restarts.');

        const rebound = await audit.action(root, linkBody(issue, { action: 'recheck-link', linkId,
            prose: anchor(issue.proseSources.find(value => value.source.role === 'statement'), 'For every n'), verdict: 'undecided' }));
        assert.equal(rebound.links[0].freshness, 'current');
        assert.equal(rebound.issues.find(value => value.issue.id === issueId).freshness, 'stale', 'A new range within unchanged file bytes cannot inherit an old issue decision.');
        assert.equal(rebound.issues.find(value => value.issue.id === issueId).unresolved, true);
        await assert.rejects(audit.action(root, issueBody(rebound, linkId, { action: 'update-issue', issueId, status: 'resolved', resolution: 'Silent edit' })), /explicit recheck/);
        let checked = await audit.action(root, issueBody(rebound, linkId, { action: 'recheck-issue', issueId, status: 'resolved', resolution: 'Checked the newly selected quantifier range.' }));
        assert.equal(checked.issues.find(value => value.issue.id === issueId).unresolved, false);
        const paired = await audit.action(root, { ...base(checked), action: 'edit-link', linkId, verdict: 'partial', note: 'Symbol correspondence revised', correspondences: [{ kind: 'symbol', prose: 'n', lean: 'n : Nat', note: '' }] });
        assert.equal(paired.issues.find(value => value.issue.id === issueId).freshness, 'stale', 'Changing assumptions/symbols invalidates the issue disposition.');

        const beforeManualChange = await audit.get(root, A), main = await review.get(root, A);
        await review.action(root, manualBody(main, { subclaims: [{ ...main.review.record.subclaims[0], text: 'Construct all certificates.' }] }));
        const manualChanged = await audit.get(root, A);
        assert.equal(manualChanged.evidenceFingerprint, beforeManualChange.evidenceFingerprint, 'Human subclaim changes are independent of machine source evidence.');
        // Rebind to a saved human claim, then change or delete that claim under the same ID.
        const claimLinked = await audit.action(root, linkBody(manualChanged, { action: 'recheck-link', linkId }));
        await review.action(root, manualBody(await review.get(root, A), { subclaims: [] }));
        const deletedClaim = await audit.get(root, A);
        assert.equal(deletedClaim.links[0].freshness, 'stale'); assert.match(deletedClaim.links[0].reasons.join(' '), /human subclaim changed or was deleted/);
        await review.action(root, manualBody(await review.get(root, A)));
        checked = await audit.action(root, linkBody(await audit.get(root, A), { action: 'recheck-link', linkId }));
        await review.action(root, manualBody(await review.get(root, A), { subclaims: [{ ...((await review.get(root, A)).review.record.subclaims[0]), text: 'A changed claim under the same ID.' }] }));
        assert.equal((await audit.get(root, A)).links[0].freshness, 'stale', 'Editing subclaim text stales the bound positional human decision.');

        const beforeDiskChange = await audit.get(root, A);
        await fs.writeFile(path.join(root, 'book/01-review.md'), proseBefore + '\nA changed unrelated trailing source line.\n');
        const drifted = await audit.get(root, A);
        assert.equal(drifted.links[0].freshness, 'stale', 'Even an edit elsewhere in either file conservatively stales the range.');
        assert.equal(drifted.issues.find(value => value.issue.id === issueId).unresolved, true);
        await assert.rejects(audit.action(root, linkBody(beforeDiskChange, { action: 'recheck-link', linkId })), /selected source changed|displayed audit evidence changed/);
        const overview = await audit.overview(root);
        assert.equal(overview.items.length, 4, 'Whole-project overview includes a second chapter and unanchored objects.');
        assert.ok(overview.items.some(value => value.id === D && value.reviewFreshness === 'unreviewed'));
        assert.ok(overview.items.find(value => value.id === A).staleLinks > 0);
        const report = await audit.report(root);
        assert.match(report.content, /Human Lean\/prose review report/); assert.match(report.content, /other-book\/02-other.md/);
        assert.match(report.content, /file bytes changed/); assert.match(report.content, /Second human decision/);
        assert.match(report.content, /recheck-issue/); assert.equal(report.overview.complete, true);

        await assert.rejects(audit.action(root, linkBody(drifted, { prose: { ...linkBody(drifted).prose, filePath: '../escape.md' } })), /canonical project-relative/);
        await assert.rejects(audit.action(root, linkBody(drifted, { lean: { ...linkBody(drifted).lean, projectKey: 'foreign' } })), /this formal object and project/);
        await assert.rejects(audit.action(root, { ...linkBody(drifted), ...base(await audit.get(root, B)) }), /prose range must belong/);
        await assert.rejects(audit.get(root, '../../escape'), /stable formal/);
        const auditPath = path.join(root, `.math-workspace/lean-audits/${A}.json`), validBytes = await fs.readFile(auditPath, 'utf8');
        await fs.writeFile(auditPath, '{ corrupt human decisions');
        await assert.rejects(audit.get(root, A), /unreadable/);
        await assert.rejects(audit.action(root, linkBody(drifted)), /unreadable/);
        assert.equal(await fs.readFile(auditPath, 'utf8'), '{ corrupt human decisions', 'Corrupt human metadata is never overwritten.');
        await fs.writeFile(auditPath, validBytes);
        const foreignRecord = JSON.parse(validBytes); foreignRecord.projectToken = 'e'.repeat(64);
        await fs.writeFile(auditPath, JSON.stringify(foreignRecord)); await assert.rejects(audit.get(root, A), /another object\/project/);
        await fs.writeFile(auditPath, validBytes);
        const invalidRecord = JSON.parse(validBytes); invalidRecord.issues[0].linkId = 'foreign-link';
        await fs.writeFile(auditPath, JSON.stringify(invalidRecord)); await assert.rejects(audit.get(root, A), /malformed/);
        await fs.writeFile(auditPath, validBytes);
        const outside = path.join(temporary, 'outside.lean'); await fs.writeFile(outside, 'private outside');
        await fs.rename(path.join(root, 'lean/ReviewFixture.lean'), path.join(root, 'lean/ReviewFixture.kept'));
        await fs.symlink(outside, path.join(root, 'lean/ReviewFixture.lean'));
        await assert.rejects(audit.get(root, A), /symlink/);
        await fs.rm(path.join(root, 'lean/ReviewFixture.lean')); await fs.rename(path.join(root, 'lean/ReviewFixture.kept'), path.join(root, 'lean/ReviewFixture.lean'));

        let revision = (await audit.get(root, A)).expectedRevision;
        for (let index = 0; index < 125; index++) {
            await updateAuditRecord(await fs.realpath(root), A, revision++, async record => {
                const before = record.issues[0], after = { ...before, note: 'History checkpoint ' + index, updatedAt: record.updatedAt };
                record.issues[0] = after; auditEvent(record, 'update-issue', after, before);
            });
        }
        const bounded = await audit.get(root, A); assert.equal(bounded.record.history.length, 120); assert.ok(bounded.record.historyDropped > 0);
        assert.equal(bounded.record.history.at(-1).after.note, 'History checkpoint 124');
        const ordinary = await review.get(root, A);
        for (let index = 0; index < 52; index++) await saveReviewRecord(await fs.realpath(root), { ...manualBody(ordinary),
            expectedRevision: ordinary.review.expectedRevision + index, subclaims: ordinary.review.record.subclaims, note: 'Bounded ordinary decision ' + index }, async () => ordinary.evidence);
        const ordinaryBounded = await audit.get(root, A);
        assert.equal(ordinaryBounded.manualReview.history.length, 50); assert.ok(ordinaryBounded.manualReview.historyDropped > 0);
        assert.equal(ordinaryBounded.manualReview.history.at(-1).note, 'Bounded ordinary decision 51');
        const mainBytes = await fs.readFile(mainPath, 'utf8'), malformedMain = JSON.parse(mainBytes);
        malformedMain.history.at(-1).note = 'tampered final history'; await fs.writeFile(mainPath, JSON.stringify(malformedMain));
        await assert.rejects(audit.get(root, A), /unsupported format/);
        await assert.rejects(review.action(root, manualBody(ordinary)), /unsupported format/);
        assert.match(await fs.readFile(mainPath, 'utf8'), /tampered final history/, 'Malformed decision history is preserved on attempted save.');
        await fs.writeFile(mainPath, mainBytes);
        assert.equal(await fs.readFile(path.join(root, 'lean/ReviewFixture.lean'), 'utf8'), leanBefore, 'All audit actions preserve Lean bytes.');
        assert.equal((await handleLeanAuditRoute(audit, root, 'GET', '/api/lean-audit', new URLSearchParams({ id: A }))).status, 200);
        await assert.rejects(handleLeanAuditRoute(audit, root, 'DELETE', '/api/lean-audit', new URLSearchParams()), /route not found/);

        server = await startReaderServer({ rootPath: root, port: 0, recentProjectsPath: path.join(temporary, 'recent.json'), locationRegistryPath: path.join(temporary, 'locations.json') });
        const state = await (await fetch(server.url + '/api/state')).json();
        const headers = { 'content-type': 'application/json', 'x-math-workspace-token': state.requestToken, 'x-math-workspace-project': state.projectId };
        assert.equal((await fetch(server.url + '/api/lean-audit?id=' + A)).status, 403, 'Audit endpoint retains token guard.');
        assert.equal((await fetch(server.url + '/api/lean-audit?id=' + A, { headers: { ...headers, 'x-math-workspace-project': 'foreign' } })).status, 409);
        const object = await (await fetch(server.url + '/api/lean-audit?id=' + A, { headers })).json();
        assert.equal(object.record.historyDropped, bounded.record.historyDropped);
        assert.equal((await fetch(server.url + '/api/lean-audit/overview', { headers })).status, 200);
        assert.equal((await fetch(server.url + '/api/lean-audit/report', { headers })).status, 200);
        const eventsAbort = new AbortController(), eventResponse = await fetch(server.url + '/api/events', { signal: eventsAbort.signal });
        const eventReader = eventResponse.body.getReader(); let eventBuffer = '';
        const nextEvent = async () => {
            const timeout = setTimeout(() => eventsAbort.abort(), 5000);
            try {
                while (true) {
                    const separator = eventBuffer.indexOf('\n\n');
                    if (separator >= 0) {
                        const block = eventBuffer.slice(0, separator); eventBuffer = eventBuffer.slice(separator + 2);
                        const data = block.split('\n').find(line => line.startsWith('data: '));
                        if (block.includes('event: workspace-update') && data) return JSON.parse(data.slice(6));
                    } else {
                        const chunk = await eventReader.read(); assert.equal(chunk.done, false, 'Workspace event stream remains connected.');
                        eventBuffer += new TextDecoder().decode(chunk.value);
                    }
                }
            } finally { clearTimeout(timeout); }
        };
        const initialEvent = await nextEvent(); assert.equal(initialEvent.initial, true);
        const live = await fetch(server.url + '/api/lean-audit/action', { method: 'POST', headers, body: JSON.stringify(linkBody(object, { prose: anchor(object.proseSources.find(value => value.source.role === 'statement'), 'certificate can be constructed') })) });
        assert.equal(live.status, 200, await live.text());
        const savedEvent = await nextEvent(); assert.ok(savedEvent.revision > initialEvent.revision, 'A metadata-only audit save advances the real Reader event revision.');
        assert.ok(savedEvent.changedPaths.includes(`.math-workspace/lean-audits/${A}.json`));
        assert.ok((await (await fetch(server.url + '/api/state')).json()).revision >= savedEvent.revision);
        await eventReader.cancel(); eventsAbort.abort();
        assert.equal((await fetch(server.url + '/api/lean-audit/action', { method: 'POST', headers: { ...headers, 'x-math-workspace-project': 'foreign' }, body: JSON.stringify(linkBody(object)) })).status, 409);
    } finally { await server?.close(); await review?.close(); await fs.rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await testLeanAuditBackend(); console.log('ok - positional Lean audit, persistence, history, freshness and guarded API'); }
