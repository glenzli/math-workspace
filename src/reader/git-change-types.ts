/** Only line locations and snapshot identity cross the Reader boundary; no Git diff or prior prose. */
export interface ReaderGitChanges {
    filePath: string;
    sourceHash: string;
    status: 'ready' | 'not-git' | 'ignored' | 'stale' | 'unavailable';
    baseline?: 'HEAD' | 'new-file';
    ranges: Array<{ startLine: number; endLine: number }>;
    deletions: Array<{ afterLine: number; count: number }>;
}
