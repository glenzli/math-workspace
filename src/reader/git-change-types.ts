/** Passive markers carry source positions and snapshot identity, with no diff or prior prose. */
export interface ReaderGitChanges {
    filePath: string;
    sourceHash: string;
    status: 'ready' | 'not-git' | 'ignored' | 'stale' | 'unavailable';
    baseline?: 'HEAD' | 'new-file';
    commit?: string;
    hunks?: ReaderGitHunk[];
    ranges: Array<{ startLine: number; endLine: number }>;
    deletions: Array<{ afterLine: number; count: number }>;
}

export interface ReaderGitHunk { startLine: number; count: number; beforeStartLine: number; beforeCount: number }
export interface ReaderGitPrevious<Label = unknown, Page = unknown> {
    filePath: string;
    sourceHash: string;
    status: ReaderGitChanges['status'];
    baseline?: 'HEAD' | 'new-file';
    commit?: string;
    content?: string;
    hunks?: ReaderGitHunk[];
    labels?: Record<string, Label>;
    pages?: Page[];
}

export interface ReaderGitFileChanges {
    status: 'ready' | 'not-git' | 'unavailable';
    revision?: number;
    files: Record<string, 'modified' | 'added'>;
}
