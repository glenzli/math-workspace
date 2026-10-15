/** Publication is an explicit PDF release workflow, independent of signed source archives. */
export interface PublicationAuthor { name: string; orcid?: string; affiliation?: string }
export interface PublicationMatter { title?: string; file?: string; content?: string; includeInToc?: boolean }
export interface PublicationResolvedMatter { title?: string; file?: string; content: string; includeInToc: boolean }
export interface PublicationProfile {
    id: string;
    workId: string;
    title: string;
    subtitle?: string;
    edition?: string;
    version: string;
    authors: PublicationAuthor[];
    language?: string;
    license?: string;
    description?: string;
    publicationDate?: string;
    repository?: string;
    chapters: string[];
    /** Optional work boundary; otherwise selected books define it, or all pages in a single-book workspace. */
    scope?: { books?: string[]; volumes?: string[]; paths?: string[] };
    cover?: { image?: string; showVersion?: boolean };
    frontMatter?: PublicationMatter[];
    backMatter?: PublicationMatter[];
    toc?: { enabled?: boolean; depth?: number; title?: string };
    continued?: { enabled?: boolean; file?: string; title?: string; text?: string };
    pdf?: { engine?: string; paper?: string; margin?: string; documentClass?: string };
    doi?: { versionDoi?: string; conceptDoi?: string; provenance?: string };
    zenodo?: { environment?: 'sandbox' | 'production'; tokenEnv?: string };
}
export interface PublicationProfileRecord { profile: PublicationProfile; revision: number; updatedAt: string }
export interface PublicationPage {
    path: string; title: string; kind: string; number?: string;
    book?: string; bookTitle?: string; volume?: string; volumeTitle?: string;
}
export interface PublicationInput { path: string; sha256: string; role: 'source' | 'config' | 'metadata' | 'asset' | 'front-matter' | 'back-matter' | 'continued' }
export interface PublicationExternalReference { source: string; line: number; target: string; label?: string; kind: 'formal' | 'page' | 'link' }
export interface PublicationDoiBinding {
    versionDoi?: string; conceptDoi?: string;
    source: 'manual' | 'zenodo' | 'none';
    state: 'unverified' | 'reserved' | 'published' | 'none';
    provenance?: string; recordId?: string;
}
export interface PublicationPlan {
    schema: 'math-workspace.publication-plan/v1';
    profile: PublicationProfile;
    fingerprint: string;
    selected: PublicationPage[];
    omitted: PublicationPage[];
    externalReferences: PublicationExternalReference[];
    partial: boolean;
    frontMatter: PublicationResolvedMatter[];
    backMatter: PublicationResolvedMatter[];
    continuedNotice: { enabled: boolean; file?: string; title: string; text: string };
    doi: PublicationDoiBinding;
    inputs: PublicationInput[];
    tools: PublicationTools;
    warnings: string[];
}
export interface PublicationTool { available: boolean; identity?: string }
export interface PublicationTools { pandoc: PublicationTool; engine: PublicationTool; engineName: string }
export interface PublicationBuild {
    schema: 'math-workspace.publication-build/v1';
    id: string;
    profileId: string;
    workId: string;
    version: string;
    fingerprint: string;
    createdAt: string;
    pdfSha256: string;
    markdownSha256: string;
    manifestSha256: string;
    files: { pdf: 'publication.pdf'; markdown: 'compiled.md'; manifest: 'manifest.json'; citation: 'citation.json' };
}
export interface PublicationManifest {
    schema: 'math-workspace.publication-manifest/v1';
    buildId: string; createdAt: string; plan: PublicationPlan;
    artifacts: Record<string, { sha256: string; bytes: number }>;
    layout: string[];
    mathematicalCorrectnessAssessed: false;
    sourceArchiveSignatureAsserted: false;
}
export interface PublicationUpload {
    buildId: string; pdfSha256: string; metadataSha256: string;
    fileName: string; remoteChecksum: string; uploadedAt: string;
}
export interface PublicationRemoteState {
    schema: 'math-workspace.publication-zenodo/v1'; revision: number;
    environment: 'sandbox' | 'production';
    status: 'draft' | 'published' | 'unknown';
    draftId?: string; recordId?: string; conceptRecordId?: string;
    versionDoi?: string; conceptDoi?: string;
    recordUrl?: string; updatedAt: string;
    pending?: { action: 'create' | 'new-version' | 'upload' | 'publish'; startedAt: string; recordId?: string; buildId?: string };
    upload?: PublicationUpload;
    /** Exact file ownership recovered after an interrupted upload; this is not metadata or publication acknowledgement. */
    ownedFiles?: Array<{ draftId: string; buildId: string; pdfSha256: string; fileName: string; remoteChecksum: string }>;
    history?: Array<{ recordId: string; versionDoi?: string; buildId?: string; pdfSha256?: string; fileName?: string; remoteChecksum?: string }>;
    draftFiles?: Array<{ name: string; checksum: string; bytes?: number; owned: boolean }>;
}
export interface PublicationInspection {
    pages: PublicationPage[];
    profiles: PublicationProfileRecord[];
    tools: PublicationTools;
    language: string;
    defaultProfile: PublicationProfile;
    credentialStatus: Array<{ profileId: string; environment: 'sandbox' | 'production'; tokenEnv: string; configured: boolean }>;
}
export interface PublicationStatus {
    profile: PublicationProfileRecord;
    builds: PublicationBuild[];
    remote: PublicationRemoteState | null;
    credential: { tokenEnv: string; configured: boolean };
}
export type PublicationArtifact = 'publication.pdf' | 'compiled.md' | 'manifest.json' | 'citation.json';
export interface PublicationBuildOptions { onProgress?: (message: string) => void }
export interface PublicationProviderReview { pdfSha256: string; remoteRevision: number }
export interface PublicationUploadReview extends PublicationProviderReview { uploadFingerprint: string }
export interface PublicationUploadPlan {
    profileId: string; buildId: string; draftId: string; remoteRevision: number; pdfSha256: string; fingerprint: string;
    files: Array<{ name: string; checksum: string; bytes?: number; owned: boolean }>;
    add: string[]; replace: string[]; remove: string[]; blocked: string[];
}
export interface PublicationPublishReview extends PublicationProviderReview { recordId: string }
export interface PublicationReserveOptions { mode: 'reuse-or-create' | 'new-version'; expectedRecordId?: string }
export interface PublicationAttachOptions { id: string; kind: 'draft' | 'record' }
export interface PublicationProcessResult { stdout: string; stderr: string }
export interface PublicationServiceOptions {
    cliPath?: string;
    runCli?: (args: string[], options: { cwd: string; onProgress?: (message: string) => void }) => Promise<PublicationProcessResult>;
    fetch?: (url: string, options: any) => Promise<any>;
    environment?: Record<string, string | undefined>;
    toolProbe?: (command: string) => PublicationTool | Promise<PublicationTool>;
}
