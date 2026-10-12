import * as fs from 'node:fs/promises';
import { LeanReviewService } from './lean-review-service';
import { formalReviewId, LeanReviewError, reviewHash, reviewSafePath, validateReviewWorkspace } from './lean-evidence';
import { readReviewRecord } from './lean-review-store';
import { AUDIT_CATEGORIES, AUDIT_STATUSES, AUDIT_VERDICTS, auditCorrespondences, auditEvent, auditHash,
    auditId, auditPath, auditRange, auditText, newAuditId, readAllAuditRecords, readAuditRecord, updateAuditRecord } from './lean-audit-store';
import type { LeanReviewResponse, ReviewDecision, ReviewSubclaim, SourceSnippet } from './lean-review';
import type { AuditAnchor, AuditFreshness, AuditIssue, AuditIssueProjection, AuditLink, AuditLinkProjection,
    AuditRange, AuditSource, LeanAuditOverview, LeanAuditRecord, LeanAuditReport, LeanAuditResponse } from './lean-audit';

type SourceFile = { content: string; lines: string[]; hash: string };
type SourceCache = Map<string, Promise<SourceFile | undefined>>;

async function sourceFile(root: string, filePath: string, cache: SourceCache): Promise<SourceFile | undefined> {
    auditPath(filePath);
    if (!cache.has(filePath)) cache.set(filePath, (async () => {
        const file = await reviewSafePath(root, filePath, true);
        if (!file) return undefined;
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new LeanReviewError(413, 'Source selection requires a file of at most 4 MiB.');
        const content = await fs.readFile(file, 'utf8');
        return { content, lines: content.split(/\r?\n/), hash: reviewHash(content) };
    })());
    return cache.get(filePath)!;
}
function rangeQuote(source: SourceFile, range: AuditRange): string {
    const { start, end } = range;
    if (start.line >= source.lines.length || end.line >= source.lines.length
        || start.character > source.lines[start.line].length || end.character > source.lines[end.line].length) {
        throw new LeanReviewError(400, 'Source selection range is outside the displayed file.');
    }
    const selected = source.lines.slice(start.line, end.line + 1);
    selected[selected.length - 1] = selected[selected.length - 1].slice(0, end.character);
    selected[0] = selected[0].slice(start.character);
    return selected.join('\n');
}
function snippetKey(source: SourceSnippet): string { return `${source.filePath}:${source.startLine}:${source.endLine}:${source.role || 'context'}`; }
function proseSnippets(response: LeanReviewResponse): SourceSnippet[] { return [response.evidence.statement, ...response.evidence.proofs, ...response.evidence.contexts]; }
function subclaimHashes(claims: ReviewSubclaim[] = []): Map<string, string> {
    return new Map(claims.map(claim => [claim.id, reviewHash(JSON.stringify(claim))]));
}
function linkFingerprint(link: AuditLink): string {
    return reviewHash(JSON.stringify({ prose: link.prose, lean: link.lean, correspondences: link.correspondences }));
}
function manualDecision(response: LeanReviewResponse): ReviewDecision[] {
    const record = response.review.record;
    return record?.history || (record ? [{ revision: record.revision, verdict: record.verdict, scope: record.scope,
        note: record.note, reviewer: record.reviewer, reviewedAt: record.reviewedAt, subclaims: record.subclaims,
        evidenceFingerprint: record.evidenceFingerprint }] : []);
}

async function currentAnchor(root: string, side: 'prose' | 'lean', value: any, response: LeanReviewResponse, cache: SourceCache): Promise<AuditAnchor> {
    const filePath = auditPath(value?.filePath), range = auditRange(value?.range), fileHash = auditHash(value?.fileHash);
    let identity: Partial<AuditAnchor>;
    if (side === 'prose') {
        const key = auditText(value?.snippetKey, 'Prose source identity', 1600, true);
        const source = proseSnippets(response).find(item => snippetKey(item) === key && item.filePath === filePath);
        if (!source || range.start.line < source.startLine - 1 || range.end.line > source.endLine - 1) {
            throw new LeanReviewError(400, 'The prose range must belong to this formal object or its displayed proof/context.');
        }
        identity = { snippetKey: key };
        if (value.subclaimId !== undefined) {
            const claimId = auditText(value.subclaimId, 'Subclaim identity', 100, true);
            if (!response.review.record?.subclaims.some(claim => claim.id === claimId)) throw new LeanReviewError(400, 'Save this object subclaim before linking its source range.');
            identity.subclaimId = claimId;
            identity.subclaimHash = subclaimHashes(response.review.record.subclaims).get(claimId);
        }
    } else {
        const key = auditText(value?.declarationKey, 'Lean declaration identity', 500, true);
        const projectKey = auditText(value?.projectKey, 'Lean project identity', 100, true);
        const declaration = [...response.evidence.declarations, ...response.evidence.definitions]
            .find(item => item.key === key && item.projectKey === projectKey && item.source?.filePath === filePath);
        if (!declaration) throw new LeanReviewError(400, 'The Lean range must come from an actual declaration/definition source of this formal object and project.');
        identity = { declarationKey: key, projectKey };
    }
    const file = await sourceFile(root, filePath, cache);
    if (!file || file.hash !== fileHash) throw new LeanReviewError(409, 'The selected source changed. Reload both sides before linking.');
    const quote = auditText(rangeQuote(file, range), 'Selected source quote', 6000, true);
    if (value.quote !== undefined && value.quote !== quote) throw new LeanReviewError(409, 'The selected text no longer matches this exact source range.');
    return { side, filePath, range, fileHash, quote, textHash: reviewHash(quote), ...identity };
}

async function anchorFreshness(root: string, anchor: AuditAnchor, cache: SourceCache): Promise<string[]> {
    const file = await sourceFile(root, anchor.filePath, cache);
    if (!file) return [`${anchor.side}: source file is missing`];
    const reasons: string[] = [];
    if (file.hash !== anchor.fileHash) reasons.push(`${anchor.side}: file bytes changed; the saved range has not been rebased`);
    try {
        const quote = rangeQuote(file, anchor.range);
        if (quote !== anchor.quote || reviewHash(quote) !== anchor.textHash) reasons.push(`${anchor.side}: text at the saved range changed`);
    } catch (_error) { reasons.push(`${anchor.side}: saved range is no longer present`); }
    return reasons;
}
async function linkFreshness(root: string, link: AuditLink, evidenceFingerprint: string | undefined, cache: SourceCache,
    claims = new Map<string, string>()): Promise<AuditFreshness> {
    const reasons = [...await anchorFreshness(root, link.prose, cache), ...await anchorFreshness(root, link.lean, cache)];
    if (link.checkedEvidenceFingerprint !== evidenceFingerprint) reasons.push('Object evidence, inputs or source associations changed since the human check');
    if (link.prose.subclaimId && claims.get(link.prose.subclaimId) !== link.prose.subclaimHash) reasons.push('The linked human subclaim changed or was deleted');
    return { freshness: reasons.length ? 'stale' : 'current', reasons };
}
async function projectRecord(root: string, record: LeanAuditRecord | undefined, evidenceFingerprint: string | undefined, cache: SourceCache,
    claimIdentity?: Map<string, string>): Promise<{ links: AuditLinkProjection[]; issues: AuditIssueProjection[] }> {
    if (!claimIdentity && record?.links.some(link => link.prose.subclaimId)) claimIdentity = subclaimHashes((await readReviewRecord(root, record.formalId))?.subclaims);
    const links: AuditLinkProjection[] = [];
    for (const link of record?.links || []) links.push({ link, ...await linkFreshness(root, link, evidenceFingerprint, cache, claimIdentity) });
    const issues: AuditIssueProjection[] = (record?.issues || []).map(issue => {
        const link = links.find(item => item.link.id === issue.linkId);
        const reasons = [...(link?.reasons || ['Linked source association is missing'])];
        if (issue.checkedEvidenceFingerprint !== evidenceFingerprint) reasons.push('Issue decision predates the current object evidence');
        if (link && issue.checkedLinkFingerprint !== linkFingerprint(link.link)) reasons.push('Linked ranges or assumption/symbol correspondences changed after this issue decision');
        const stale = reasons.length > 0;
        return { issue, freshness: stale ? 'stale' : 'current', reasons, unresolved: issue.status === 'open' || stale };
    });
    return { links, issues };
}

export class LeanAuditService {
    constructor(private readonly review: LeanReviewService, private readonly onChange?: (root: string, id: string) => void) {}

    async get(rootInput: string, idInput: unknown): Promise<LeanAuditResponse> {
        const root = await validateReviewWorkspace(rootInput), response = await this.review.get(root, idInput);
        const record = await readAuditRecord(root, response.id), cache: SourceCache = new Map();
        const sources = async (snippets: SourceSnippet[]): Promise<AuditSource[]> => {
            const result: AuditSource[] = [];
            for (const source of snippets) {
                const file = await sourceFile(root, source.filePath, cache);
                if (file) result.push({ key: snippetKey(source), source, fileHash: file.hash });
            }
            return [...new Map(result.map(item => [item.key, item])).values()];
        };
        const proseSources = await sources(proseSnippets(response)), leanSources: AuditSource[] = [];
        for (const declaration of [...response.evidence.declarations, ...response.evidence.definitions]) {
            if (!declaration.source) continue;
            const file = await sourceFile(root, declaration.source.filePath, cache);
            if (file) leanSources.push({ key: declaration.key, declarationKey: declaration.key, projectKey: declaration.projectKey,
                source: declaration.source, fileHash: file.hash });
        }
        return { id: response.id, projectToken: response.projectToken, evidenceFingerprint: response.evidence.fingerprint,
            expectedRevision: record?.revision || 0, ...(record ? { record } : {}),
            ...await projectRecord(root, record, response.evidence.fingerprint, cache, subclaimHashes(response.review.record?.subclaims)), proseSources, leanSources,
            manualReview: { freshness: response.review.freshness, verdict: response.review.record?.verdict,
                history: manualDecision(response), historyDropped: response.review.record?.historyDropped || 0 },
            warnings: ['Human source links and issue decisions do not establish semantic equivalence or kernel proof coverage.',
                'Changes to either file conservatively stale its associations; positions are never silently rebased.',
                'History retains at most 120 audit actions / 1 MiB and 50 ordinary decisions / 1.5 MiB; older dropped counts are explicit.'] };
    }

    async action(rootInput: string, body: any): Promise<LeanAuditResponse> {
        const root = await validateReviewWorkspace(rootInput), id = formalReviewId(body?.id), fingerprint = auditHash(body?.evidenceFingerprint);
        if (!['create-link', 'edit-link', 'recheck-link', 'create-issue', 'update-issue', 'recheck-issue'].includes(body?.action)) {
            throw new LeanReviewError(400, 'Choose a deliberate link or issue audit action.');
        }
        await updateAuditRecord(root, id, body.expectedRevision, async record => {
            const response = await this.review.get(root, id);
            if (response.evidence.fingerprint !== fingerprint) throw new LeanReviewError(409, 'The displayed audit evidence changed. Reload before saving.');
            if (response.job && ['queued', 'running'].includes(response.job.status)) throw new LeanReviewError(409, 'Wait for the evidence job before recording an audit decision.');
            const cache: SourceCache = new Map(), reviewer = auditText(body.reviewer ?? '', 'Reviewer', 300);
            if (body.action.endsWith('link')) {
                const previous = body.action === 'create-link' ? undefined : record.links.find(item => item.id === auditId(body.linkId));
                if (body.action !== 'create-link' && !previous) throw new LeanReviewError(404, 'Source link not found in this formal object.');
                if (!previous && record.links.length >= 80) throw new LeanReviewError(413, 'An object can retain at most 80 source links.');
                if (!AUDIT_VERDICTS.includes(body.verdict)) throw new LeanReviewError(400, 'Choose a human link verdict.');
                if (body.action === 'edit-link' && (await linkFreshness(root, previous!, fingerprint, cache, subclaimHashes(response.review.record?.subclaims))).freshness !== 'current') {
                    throw new LeanReviewError(409, 'This source link is stale. Select and explicitly recheck both ranges before updating a verdict.');
                }
                const rebinding = body.action !== 'edit-link';
                const link: AuditLink = { id: previous?.id || newAuditId('link'),
                    prose: rebinding ? await currentAnchor(root, 'prose', body.prose, response, cache) : previous!.prose,
                    lean: rebinding ? await currentAnchor(root, 'lean', body.lean, response, cache) : previous!.lean,
                    verdict: body.verdict, note: auditText(body.note ?? '', 'Link note', 8000), reviewer,
                    correspondences: auditCorrespondences(body.correspondences ?? []), checkedEvidenceFingerprint: fingerprint,
                    createdAt: previous?.createdAt || record.updatedAt, checkedAt: record.updatedAt };
                if (previous) record.links[record.links.indexOf(previous)] = link; else record.links.push(link);
                auditEvent(record, body.action, link, previous);
            } else {
                const previous = body.action === 'create-issue' ? undefined : record.issues.find(item => item.id === auditId(body.issueId));
                if (body.action !== 'create-issue' && !previous) throw new LeanReviewError(404, 'Issue not found in this formal object.');
                if (!previous && record.issues.length >= 120) throw new LeanReviewError(413, 'An object can retain at most 120 issues.');
                const linkId = previous?.linkId || auditId(body.linkId), link = record.links.find(item => item.id === linkId);
                if (!link) throw new LeanReviewError(400, 'Each issue must reference a link with both prose and Lean ranges in this object.');
                if (!AUDIT_CATEGORIES.includes(body.category) || !AUDIT_STATUSES.includes(body.status)) throw new LeanReviewError(400, 'Choose a valid issue category and status.');
                const fresh = await linkFreshness(root, link, fingerprint, cache, subclaimHashes(response.review.record?.subclaims));
                if (fresh.freshness !== 'current') throw new LeanReviewError(409, 'Explicitly recheck the linked source ranges before recording an issue decision.');
                const resolution = auditText(body.resolution ?? '', 'Resolution/recheck note', 8000);
                if ((body.status !== 'open' || body.action === 'recheck-issue') && !resolution.trim()) throw new LeanReviewError(400, 'Resolving, dismissing or rechecking an issue requires a human explanation.');
                // An edit to an existing stale issue is not an implicit recheck.
                if (previous && body.action === 'update-issue' && (previous.checkedEvidenceFingerprint !== fingerprint
                    || previous.checkedLinkFingerprint !== linkFingerprint(link))) {
                    throw new LeanReviewError(409, 'This issue predates current evidence. Use the explicit recheck action.');
                }
                const issue: AuditIssue = { id: previous?.id || newAuditId('issue'), linkId, category: body.category,
                    title: auditText(body.title, 'Issue title', 500, true), note: auditText(body.note ?? '', 'Issue note', 8000),
                    status: body.status, reviewer, resolution, checkedEvidenceFingerprint: fingerprint,
                    checkedLinkFingerprint: linkFingerprint(link),
                    createdAt: previous?.createdAt || record.updatedAt, updatedAt: record.updatedAt };
                if (previous) record.issues[record.issues.indexOf(previous)] = issue; else record.issues.push(issue);
                auditEvent(record, body.action, issue, previous);
            }
            // Re-read all admission sources just before persisting, rejecting edits made mid-operation.
            const latest = await this.review.get(root, id);
            if (latest.evidence.fingerprint !== fingerprint) throw new LeanReviewError(409, 'Object evidence changed during the audit save; reload before retrying.');
            const target = record.history[record.history.length - 1].after;
            const checkedLink = 'prose' in target ? target : record.links.find(item => item.id === target.linkId)!;
            if ((await linkFreshness(root, checkedLink, fingerprint, new Map(), subclaimHashes(latest.review.record?.subclaims))).freshness !== 'current') {
                throw new LeanReviewError(409, 'Selected source changed during the audit save; no decision was written.');
            }
        });
        this.onChange?.(root, id);
        return this.get(root, id);
    }

    async overview(rootInput: string): Promise<LeanAuditOverview> {
        const root = await validateReviewWorkspace(rootInput);
        const queue = await this.review.queue(root, '', true), records = await readAllAuditRecords(root), cache: SourceCache = new Map();
        const byId = new Map(records.map(record => [record.formalId, record]));
        const items = [];
        for (const item of queue.items) {
            const projected = await projectRecord(root, byId.get(item.id), item.evidenceFingerprint, cache);
            items.push({ ...item, links: projected.links.length, staleLinks: projected.links.filter(link => link.freshness === 'stale').length,
                issues: projected.issues.length, staleIssues: projected.issues.filter(issue => issue.freshness === 'stale').length,
                unresolvedIssues: projected.issues.filter(issue => issue.unresolved).length });
            byId.delete(item.id);
        }
        const counts = { total: items.length, pending: 0, current: 0, stale: 0, unresolvedIssues: 0, staleLinks: 0 };
        for (const item of items) {
            if (item.reviewFreshness === 'unreviewed') counts.pending++;
            else counts[item.reviewFreshness]++;
            counts.unresolvedIssues += item.unresolvedIssues; counts.staleLinks += item.staleLinks;
        }
        return { projectToken: queue.projectToken, generatedAt: new Date().toISOString(), complete: true, items, counts,
            orphaned: [...byId.values()].map(record => ({ id: record.formalId, links: record.links.length, issues: record.issues.length })) };
    }

    async report(rootInput: string): Promise<LeanAuditReport> {
        const root = await validateReviewWorkspace(rootInput), overview = await this.overview(root), records = await readAllAuditRecords(root);
        const escape = (value: string) => value.replace(/[\\|`*#<>]/g, character => '\\' + character).replace(/\r?\n/g, '<br>');
        const lines = ['# Human Lean/prose review report', '', `Generated: ${overview.generatedAt}`, '',
            'Build facts, human verdicts, source associations and issue decisions are independent. AI discussion material is never an automatic verdict.',
            'File or evidence changes make saved associations and decisions stale. Saved ranges are not silently rebased.',
            'History is bounded: 120 audit actions / 1 MiB, 50 object decisions / 1.5 MiB. Dropped counts are recorded.', '',
            `Objects: ${overview.counts.total}; unreviewed: ${overview.counts.pending}; current manual reviews: ${overview.counts.current}; stale manual reviews: ${overview.counts.stale}; unresolved/stale issues: ${overview.counts.unresolvedIssues}.`, '',
            '| Object | Source | Manual verdict / freshness | Links / stale | Issues / unresolved |',
            '| --- | --- | --- | --- | --- |'];
        for (const item of overview.items) lines.push(`| ${item.id} ${escape(item.display + ' ' + item.title)} | ${escape(item.filePath)}:${item.line} | ${item.verdict || 'undecided'} / ${item.reviewFreshness} | ${item.links} / ${item.staleLinks} | ${item.issues} / ${item.unresolvedIssues} |`);
        for (const item of overview.items.filter(item => item.reviewFreshness !== 'unreviewed')) {
            const manual = await readReviewRecord(root, item.id);
            if (!manual) continue;
            lines.push('', `## Object decision ${item.id}`, '', `Verdict: ${manual.verdict}; freshness: ${item.reviewFreshness}; reviewer: ${escape(manual.reviewer)}; revision: ${manual.revision}.`,
                `Scope: ${escape(manual.scope)}`, `Note: ${escape(manual.note)}`, `Retained decisions: ${manual.history?.length || 1}; dropped: ${manual.historyDropped || 0}.`);
            for (const decision of manual.history || [manual]) lines.push(`- Revision ${decision.revision}, ${decision.reviewedAt}, ${escape(decision.reviewer)}, ${decision.verdict}: ${escape(decision.scope)}; ${escape(decision.note)}`);
        }
        const cache: SourceCache = new Map();
        for (const record of records) {
            const item = overview.items.find(item => item.id === record.formalId);
            const projection = await projectRecord(root, record, item?.evidenceFingerprint, cache);
            lines.push('', `## Source audit ${record.formalId}${item ? '' : ' (object no longer in current review queue)'}`, '',
                `Audit revision: ${record.revision}; retained actions: ${record.history.length}; dropped actions: ${record.historyDropped}.`);
            for (const projected of projection.links) {
                const link = projected.link;
                lines.push('', `### ${link.id}: ${link.verdict}, ${projected.freshness}`, '',
                    `Prose: ${escape(link.prose.filePath)}:${link.prose.range.start.line + 1}:${link.prose.range.start.character + 1}–${link.prose.range.end.line + 1}:${link.prose.range.end.character + 1}; file SHA-256 ${link.prose.fileHash}.`,
                    `> ${escape(link.prose.quote)}`, `Lean: ${escape(link.lean.projectKey!)} / ${escape(link.lean.declarationKey!)} / ${escape(link.lean.filePath)}:${link.lean.range.start.line + 1}:${link.lean.range.start.character + 1}–${link.lean.range.end.line + 1}:${link.lean.range.end.character + 1}; file SHA-256 ${link.lean.fileHash}.`,
                    `> ${escape(link.lean.quote)}`, `Reviewer: ${escape(link.reviewer)}; note: ${escape(link.note)}.`);
                for (const pair of link.correspondences) lines.push(`- ${pair.kind}: ${escape(pair.prose)} ↔ ${escape(pair.lean)}. ${escape(pair.note)}`);
                for (const reason of projected.reasons) lines.push(`- Recheck: ${escape(reason)}`);
                for (const issue of projection.issues.filter(value => value.issue.linkId === link.id)) lines.push(`- Issue ${issue.issue.id} [${issue.issue.category}/${issue.issue.status}/${issue.freshness}${issue.unresolved ? '/unresolved' : ''}]: ${escape(issue.issue.title)}. ${escape(issue.issue.note)} Resolution: ${escape(issue.issue.resolution)}`);
            }
            lines.push('', '### Human action history', '');
            for (const event of record.history) lines.push(`- Revision ${event.revision}, ${event.at}, ${escape(event.reviewer)}: ${event.action} ${event.targetId}; ${'verdict' in event.after ? event.after.verdict : event.after.status}. ${escape('resolution' in event.after ? event.after.resolution : event.after.note)}`);
        }
        const content = lines.join('\n') + '\n';
        if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new LeanReviewError(413, 'Review report exceeds 4 MiB; no truncated report was exported.');
        return { projectToken: overview.projectToken, generatedAt: overview.generatedAt, format: 'markdown', content, overview };
    }
}
