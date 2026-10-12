/** Public Reader contract. These types contain no runtime or Node dependencies. */
export type ReviewVerdict = 'aligned' | 'partial' | 'difference' | 'undecided';
export type ReviewFreshness = 'unreviewed' | 'current' | 'stale';
export type EvidenceState = 'current' | 'stale' | 'unavailable' | 'partial';

export interface SourceSnippet {
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
    fingerprint: string;
    truncated?: boolean;
    role?: 'statement' | 'proof' | 'support' | 'question' | 'context' | 'declaration';
    rangeKind?: 'source' | 'context';
}

export interface DeclarationEvidence {
    key: string;
    projectKey: string;
    name: string;
    qualifiedName: string;
    kind: string;
    source?: SourceSnippet;
    elaboratedType?: string;
    value?: string;
    module?: string;
    compiledSource?: { filePath: string; fingerprint: string; currentFingerprint?: string };
    typeDependencies: string[];
    proofDependencies: string[];
    /** Recursive Lean collectAxioms result; absent evidence never implies an empty trust boundary. */
    axioms: string[];
    evidenceState: 'available' | 'unavailable' | 'stale';
    diagnostic?: string;
    truncated?: boolean;
}

export interface ProjectEvidence {
    projectKey: string;
    inputFingerprint: string;
    freshnessPolicy: 'project-inputs';
    toolchain: string;
    target?: string;
    module?: string;
    build: {
        state: 'passed' | 'failed' | 'stale' | 'unverified';
        command?: string[];
        startedAt?: string;
        finishedAt?: string;
        exitCode?: number | null;
        output?: string;
        inputFingerprint?: string;
    };
    diagnostic?: string;
}

export interface LeanReviewEvidence {
    fingerprint: string;
    statement: SourceSnippet;
    proofs: SourceSnippet[];
    contexts: SourceSnippet[];
    contextPolicy?: 'explicit-references' | 'workspace-markdown';
    contextInputFingerprint?: string;
    declarations: DeclarationEvidence[];
    /** Only object-related, explicitly collected definitions, never a project source index. */
    definitions: DeclarationEvidence[];
    projects: ProjectEvidence[];
    state: EvidenceState;
    diagnostics: string[];
    generatedAt?: string;
}

export interface ReviewSubclaim {
    id: string;
    text: string;
    declarationKeys: string[];
    verdict: ReviewVerdict;
    note: string;
}

export interface ReviewRecord {
    schemaVersion: 1;
    formalId: string;
    revision: number;
    verdict: ReviewVerdict;
    scope: string;
    note: string;
    reviewer: string;
    reviewedAt: string;
    subclaims: ReviewSubclaim[];
    evidenceFingerprint: string;
    snapshot: LeanReviewEvidence;
    /** Latest bounded human decisions, saved atomically with this record; no source snapshots. */
    history?: ReviewDecision[];
    historyDropped?: number;
}

export interface ReviewDecision {
    revision: number;
    verdict: ReviewVerdict;
    scope: string;
    note: string;
    reviewer: string;
    reviewedAt: string;
    subclaims: ReviewSubclaim[];
    evidenceFingerprint: string;
}

export interface ReviewChange {
    kind: 'statement' | 'proof' | 'context' | 'declaration' | 'type' | 'definition' | 'environment' | 'evidence';
    key: string;
    label: string;
    previous?: string;
    current?: string;
    truncated?: boolean;
}

export interface ReviewJob {
    id: string;
    formalId: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    phase: string;
    startedAt: string;
    finishedAt?: string;
    error?: string;
}

export interface LeanReviewResponse {
    id: string;
    projectToken: string;
    formal: { id: string; type: string; title: string; display: string; filePath: string; line: number };
    evidence: LeanReviewEvidence;
    review: { record?: ReviewRecord; freshness: ReviewFreshness; changes: ReviewChange[]; expectedRevision: number };
    job?: ReviewJob;
}

export interface LeanDefinitionResponse {
    definition?: DeclarationEvidence;
    state: 'available' | 'unavailable' | 'stale';
    diagnostic?: string;
}

export interface LeanReviewQueueItem {
    id: string;
    type: string;
    title: string;
    display: string;
    filePath: string;
    line: number;
    anchored: boolean;
    declarationCount: number;
    reviewFreshness: ReviewFreshness;
    /** Current object evidence identity; enables audit projection without rebuilding contexts. */
    evidenceFingerprint?: string;
    verdict?: ReviewVerdict;
    reviewer?: string;
    reviewedAt?: string;
}

export interface LeanReviewQueueResponse {
    projectToken: string;
    items: LeanReviewQueueItem[];
    counts: Record<string, number>;
}

export interface LeanReviewSaveInput {
    id: string;
    expectedRevision: number;
    evidenceFingerprint: string;
    verdict: ReviewVerdict;
    scope: string;
    note: string;
    reviewer: string;
    subclaims: ReviewSubclaim[];
}
