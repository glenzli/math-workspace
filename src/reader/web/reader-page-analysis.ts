import type { ReaderDependencyMarker } from '../dependency-markers';

export interface ReaderPageAnalysisContext {
    filePath: string;
    sourceHash: string;
    project: string;
    token: string;
    revision: number;
}

export interface ReaderPageAnalysisResult {
    filePath: string;
    sourceHash: string;
    revision: number;
    analysisPending: boolean;
    dependencyMarkers: Record<string, ReaderDependencyMarker>;
    leanSummary: Record<string, number>;
    issues: Array<{ severity: string; code: string; message: string }>;
}

/** Owns optional page facts from the first painted frame through navigation/cancellation. */
export class ReaderPageAnalysis {
    private generation = 0;
    private frame?: number;
    private timer?: ReturnType<typeof setTimeout>;
    private abort?: AbortController;

    constructor(private readonly request: (route: string, options?: RequestInit) => Promise<Response>) {}

    bind(context?: ReaderPageAnalysisContext, apply: (result: ReaderPageAnalysisResult) => void = () => {}): void {
        this.cancel();
        if (!context) return;
        const generation = this.generation;
        // Two frames let the complete prose paint before optional backend work begins.
        this.frame = window.requestAnimationFrame(() => {
            this.frame = window.requestAnimationFrame(() => {
                this.frame = undefined;
                this.timer = setTimeout(() => { this.timer = undefined; void this.load(context, generation, apply); }, 0);
            });
        });
    }

    cancel(): void {
        ++this.generation;
        if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.frame = undefined; this.timer = undefined;
        this.abort?.abort(); this.abort = undefined;
    }

    private async load(context: ReaderPageAnalysisContext, generation: number, apply: (result: ReaderPageAnalysisResult) => void): Promise<void> {
        if (generation !== this.generation) return;
        const abort = this.abort = new AbortController();
        try {
            const response = await this.request('/api/page-analysis?path=' + encodeURIComponent(context.filePath), {
                signal: abort.signal, cache: 'no-store', headers: {
                    'x-math-workspace-token': context.token, 'x-math-workspace-project': context.project
                }
            });
            if (!response.ok) return;
            const result = await response.json() as ReaderPageAnalysisResult;
            if (generation === this.generation && !abort.signal.aborted && !result.analysisPending
                && result.filePath === context.filePath && result.sourceHash === context.sourceHash && result.revision === context.revision) apply(result);
        } catch { /* Optional analysis never replaces readable prose with a failure screen. */ }
        finally { if (this.abort === abort) this.abort = undefined; }
    }
}
