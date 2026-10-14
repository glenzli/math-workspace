/** Portable evidence belongs to the writing project; views and verification are derived. */
export interface ArchiveIdentity { identity: string; issuer: string }
export interface ArchiveAuthentication { url: string; code?: string; flow?: 'normal' | 'device' }
export type ArchiveAuthFlow = 'normal' | 'device';
export interface ArchiveScope { paths: string[]; extensions: string[]; maxDepth?: number; exclude?: string[] }
export interface ArchiveVolume { id: string; title: string; paths: string[] }
export interface ArchivePolicy {
    schema: 'math-workspace.archive-policy/v1';
    workId: string;
    title: string;
    scope: ArchiveScope;
    identities: ArchiveIdentity[];
    signingIdentity: ArchiveIdentity;
    volumes?: ArchiveVolume[];
}
export interface ArchivePointer { record: string; bundle: string }
export interface ArchiveNativeRecord {
    schema: 'math-workspace.archive-record/v1';
    workId: string;
    label: string;
    sequence: number;
    preparedAt: string;
    signer: ArchiveIdentity;
    previous: ArchivePointer | null;
    imports: string[];
    scope: ArchiveScope;
    files: Record<string, string>;
    sourceLocator?: { gitBaseCommit: string; meaning: string };
}
export interface ArchiveVolumeReceipt extends ArchivePointer { id: string }
export interface ArchiveVolumeRecord {
    schema: 'math-workspace.archive-volume/v1';
    workId: string;
    volumeId: string;
    title: string;
    preparedAt: string;
    signer: ArchiveIdentity;
    policy: string;
    files: Record<string, string>;
}
export interface ArchiveTotalRecord extends Omit<ArchiveNativeRecord, 'schema'> {
    schema: 'math-workspace.archive-total/v1';
    policy: string;
    volumes: ArchiveVolumeReceipt[];
}
/** Preparation is not evidence. Total payload bytes exist only after exact volume bundles exist. */
export interface ArchivePlan extends Omit<ArchiveTotalRecord, 'schema' | 'volumes'> {
    schema: 'math-workspace.archive-plan/v1';
    volumes: Array<{ id: string; record: string; bundle: string | null }>;
}
/** A converter emits original bytes plus a format hint. It cannot assert verification. */
export interface ArchiveInputRecord {
    format: string;
    payload: string;
    bundle: string;
    metadata?: Record<string, unknown>;
}
export interface ArchiveExchange {
    schema: 'math-workspace.archive-exchange/v1';
    workId: string;
    records: ArchiveInputRecord[];
    objects: Record<string, string>; // SHA-256 -> canonical base64 of original bytes
}
export interface ArchiveMissing { path: string; expected: string }
export interface ArchiveProjection {
    workId: string;
    label: string;
    kind: 'snapshot' | 'root' | 'volume' | 'total';
    files: Record<string, string>;
    missing: ArchiveMissing[];
    sequence?: number;
    previous?: ArchivePointer | null;
    imports?: string[];
    legacyArchive?: string;
    signer?: ArchiveIdentity;
    sourceLocator?: unknown;
    additionalSignatures?: Array<{ payload: string; bundle: string }>;
    policyDigest?: string;
    volumeId?: string;
    volumes?: ArchiveVolumeReceipt[];
    outside?: Record<string, string>;
    hidden?: boolean;
}
export interface ArchiveFormatContext {
    input: ArchiveInputRecord;
    payload: any;
    object: (digest: string) => Promise<any>;
}
/** Formats must derive file mappings from original evidence, never from UI metadata. */
export interface ArchiveFormat {
    id: string;
    project(context: ArchiveFormatContext): Promise<ArchiveProjection>;
}
export interface ArchiveBundleInfo {
    digest: string;
    identity: ArchiveIdentity;
    loggedAt: string | null;
    timestampCount: number;
}
export interface ArchiveRecordView extends ArchiveProjection {
    id: string;
    format: string;
    payload: string;
    bundle: string;
    identity: ArchiveIdentity;
    loggedAt: string | null;
    timestampCount: number;
    verification: 'unchecked' | 'verified';
    contentComplete: boolean;
}
export interface ArchiveVerifier {
    inspect(bundle: any): Promise<ArchiveBundleInfo>;
    verify(payload: any, bundle: any, identities: ArchiveIdentity[]): Promise<ArchiveBundleInfo>;
}
