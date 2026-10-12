/** AI suggestions are separate from every human review and audit decision. */
import type { AuditCategory } from './lean-audit';
import type { LeanReviewResponse } from './lean-review';

export type LeanAssistanceTask = 'assumptions' | 'statement' | 'proof' | 'changes';
export interface LeanAssistanceBinding {
    projectToken: string;
    id: string;
    evidenceFingerprint: string;
    reviewRevision: number;
    auditRevision: number;
    candidateRevision: number;
}
export interface LeanAssistanceItemInput {
    category: AuditCategory;
    title: string;
    note: string;
    declarationKeys: string[];
}
export interface LeanAssistanceCandidate extends LeanAssistanceItemInput {
    id: string;
    task: LeanAssistanceTask;
    binding: LeanAssistanceBinding;
    createdAt: string;
    status: 'pending' | 'ignored';
}
export interface LeanAssistanceRecord {
    schemaVersion: 1;
    projectToken: string;
    formalId: string;
    revision: number;
    candidates: LeanAssistanceCandidate[];
    dropped: number;
}
export interface LeanAssistanceMaterial {
    kind: string;
    label: string;
    text: string;
    filePath?: string;
    startLine?: number;
    fingerprint?: string;
    declarationKey?: string;
    truncated?: boolean;
}
export interface LeanAssistanceResponse {
    projectRoot: string;
    binding: LeanAssistanceBinding;
    task: LeanAssistanceTask;
    formal: LeanReviewResponse['formal'];
    evidenceState: string;
    materials: LeanAssistanceMaterial[];
    omittedMaterials: number;
    candidates: { candidate: LeanAssistanceCandidate; freshness: 'current' | 'stale' }[];
    dropped: number;
    boundary: string;
}

/** Candidate-list revision is CAS, not source freshness; later suggestions do not stale earlier ones. */
export function sameLeanAssistanceSource(a: LeanAssistanceBinding, b: LeanAssistanceBinding): boolean {
    return a.projectToken === b.projectToken && a.id === b.id && a.evidenceFingerprint === b.evidenceFingerprint
        && a.reviewRevision === b.reviewRevision && a.auditRevision === b.auditRevision;
}
