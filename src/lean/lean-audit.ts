/** Deliberate human audit artifacts. This contract has no runtime dependencies. */
import type { LeanReviewQueueItem, ReviewDecision, ReviewFreshness, ReviewVerdict, SourceSnippet } from './lean-review';

/** Zero-based lines and UTF-16 character offsets, matching the Lean language service. */
export interface AuditPosition { line: number; character: number }
export interface AuditRange { start: AuditPosition; end: AuditPosition }
export type AuditCategory = 'assumption' | 'symbol' | 'scope' | 'statement' | 'proof' | 'trust' | 'other';
export type AuditIssueStatus = 'open' | 'resolved' | 'dismissed';
export interface AuditCorrespondence { kind: 'assumption' | 'symbol'; prose: string; lean: string; note: string }

export interface AuditAnchorInput {
    filePath: string;
    range: AuditRange;
    fileHash: string;
    quote?: string;
    snippetKey?: string;
    declarationKey?: string;
    projectKey?: string;
    subclaimId?: string;
}
export interface AuditAnchor extends AuditAnchorInput {
    side: 'prose' | 'lean';
    quote: string;
    textHash: string;
    /** Identity of a saved human subclaim, independent of machine source evidence. */
    subclaimHash?: string;
}
export interface AuditLink {
    id: string;
    prose: AuditAnchor;
    lean: AuditAnchor;
    note: string;
    reviewer: string;
    verdict: ReviewVerdict;
    correspondences: AuditCorrespondence[];
    checkedEvidenceFingerprint: string;
    createdAt: string;
    checkedAt: string;
}
export interface AuditIssue {
    id: string;
    linkId: string;
    category: AuditCategory;
    title: string;
    note: string;
    status: AuditIssueStatus;
    reviewer: string;
    resolution: string;
    checkedEvidenceFingerprint: string;
    checkedLinkFingerprint: string;
    createdAt: string;
    updatedAt: string;
}
export interface AuditEvent {
    revision: number;
    action: 'create-link' | 'edit-link' | 'recheck-link' | 'create-issue' | 'update-issue' | 'recheck-issue';
    targetId: string;
    at: string;
    reviewer: string;
    before?: AuditLink | AuditIssue;
    after: AuditLink | AuditIssue;
}
export interface LeanAuditRecord {
    schemaVersion: 1;
    formalId: string;
    projectToken: string;
    revision: number;
    links: AuditLink[];
    issues: AuditIssue[];
    history: AuditEvent[];
    historyDropped: number;
    updatedAt: string;
}
export interface AuditFreshness { freshness: 'current' | 'stale'; reasons: string[] }
export interface AuditLinkProjection extends AuditFreshness { link: AuditLink }
export interface AuditIssueProjection extends AuditFreshness { issue: AuditIssue; unresolved: boolean }
export interface AuditSource { key: string; source: SourceSnippet; fileHash: string; projectKey?: string; declarationKey?: string }
export interface LeanAuditResponse {
    id: string;
    projectToken: string;
    evidenceFingerprint: string;
    expectedRevision: number;
    record?: LeanAuditRecord;
    links: AuditLinkProjection[];
    issues: AuditIssueProjection[];
    proseSources: AuditSource[];
    leanSources: AuditSource[];
    manualReview: { freshness: ReviewFreshness; verdict?: ReviewVerdict; history: ReviewDecision[]; historyDropped: number };
    warnings: string[];
}
export interface LeanAuditOverviewItem extends LeanReviewQueueItem {
    links: number;
    staleLinks: number;
    issues: number;
    staleIssues: number;
    unresolvedIssues: number;
}
export interface LeanAuditOverview {
    projectToken: string;
    generatedAt: string;
    complete: true;
    items: LeanAuditOverviewItem[];
    counts: { total: number; pending: number; current: number; stale: number; unresolvedIssues: number; staleLinks: number };
    orphaned: { id: string; links: number; issues: number }[];
}
export interface LeanAuditReport { projectToken: string; generatedAt: string; format: 'markdown'; content: string; overview: LeanAuditOverview }
