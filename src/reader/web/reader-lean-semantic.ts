import type { LeanLanguageAction, LeanLanguageDiagnostic, LeanLanguageRequest, LeanLanguageResponse, LeanPosition, LeanSemanticToken, LeanSourceFile } from '../../lean/lean-language';

export interface LeanSemanticHost {
    context(): { projectId: string; token: string };
    request(path: string, options?: RequestInit): Promise<Response>;
}
export interface LeanSemanticState {
    state: 'idle' | 'opening' | 'available' | 'unavailable';
    reason?: string;
    sessionId?: string;
    sourceVersion?: number;
    response?: LeanLanguageResponse;
    position?: LeanPosition;
    hover?: LeanLanguageResponse['hover'];
    goals?: LeanLanguageResponse['goals'];
    renderedGoals?: string;
    termGoal?: string | null;
    diagnostics: LeanLanguageDiagnostic[];
    tokens: LeanSemanticToken[];
    complete: boolean;
}

/** Owns the complete immutable-file LSP lifecycle, independent of review snapshots and rendering. */
export class ReaderLeanSemantic {
    private readonly instance = crypto.randomUUID();
    private source?: LeanSourceFile;
    private generation = 0;
    private sequence = 0;
    private channels = new Map<string, number>();
    private pending = new Map<string, { abort: AbortController; requestId: string }>();
    private timer?: ReturnType<typeof setTimeout>;
    private pollTimer?: ReturnType<typeof setTimeout>;
    state: LeanSemanticState = { state: 'idle', diagnostics: [], tokens: [], complete: false };

    constructor(private readonly host: LeanSemanticHost, private readonly changed: (state: LeanSemanticState) => void) {}

    setSource(source: LeanSourceFile | undefined): void {
        if (source && this.source && this.source.projectToken === source.projectToken && this.source.projectKey === source.projectKey
            && this.source.filePath === source.filePath && this.source.sourceHash === source.sourceHash && this.source.sourceUri === source.sourceUri) return;
        this.close(); this.source = source;
        this.state = { state: 'idle', diagnostics: [], tokens: [], complete: false }; this.changed(this.state);
    }

    async open(): Promise<void> {
        if (!this.source || this.state.state === 'opening') return;
        if (this.state.state === 'available') { await this.refresh(); return; }
        const generation = this.generation;
        this.state = { ...this.state, state: 'opening', reason: undefined }; this.changed(this.state);
        try {
            const response = await this.perform('open', undefined, 'open'); if (!response) return;
            this.state = { ...this.state, state: response.state === 'available' ? 'available' : 'unavailable', reason: response.reason,
                sessionId: response.sessionId, sourceVersion: response.sourceVersion, response, diagnostics: response.diagnostics || [], tokens: response.tokens || [], complete: response.complete === true };
            this.changed(this.state);
            if (this.state.state === 'unavailable') { this.fail(new Error(response.reason || 'Lean semantic information unavailable.')); return; }
            if (this.state.state === 'available') { if (this.state.position) this.select(this.state.position); this.schedulePoll(); }
        } catch (error) { if (generation === this.generation) this.fail(error); }
    }

    select(position: LeanPosition): void {
        this.state = { ...this.state, position, hover: undefined, goals: undefined, renderedGoals: undefined, termGoal: undefined };
        this.channels.set('selected', ++this.sequence); this.changed(this.state);
        if (this.timer) clearTimeout(this.timer);
        if (this.state.state !== 'available') return;
        const selection = this.channels.get('selected'), generation = this.generation;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            if (generation !== this.generation || selection !== this.channels.get('selected')) return;
            void this.readPosition(position, selection!);
        }, 120);
    }

    private async readPosition(position: LeanPosition, selection: number): Promise<void> {
        const generation = this.generation;
        const current = () => generation === this.generation && selection === this.channels.get('selected');
        const results = await Promise.allSettled([
            this.perform('hover', position, 'selected-hover'), this.perform('goals', position, 'selected-goals')
        ]);
        if (!current()) return;
        for (const [index, result] of results.entries()) {
            if (result.status === 'rejected') { this.fail(result.reason); return; }
            const response = result.value; if (!response) continue;
            if (response.state !== 'available') { this.fail(new Error(response.reason || 'Lean semantic information unavailable.')); return; }
            if (index === 0) this.state = { ...this.state, hover: response.hover };
            else this.state = { ...this.state, goals: response.goals, renderedGoals: response.renderedGoals, termGoal: response.termGoal };
        }
        this.changed(this.state);
    }

    async hoverAt(position: LeanPosition): Promise<LeanLanguageResponse['hover']> {
        if (this.state.state !== 'available') return undefined;
        const generation = this.generation;
        try { return (await this.perform('hover', position, 'tooltip'))?.hover; }
        catch (error) { if (generation === this.generation) this.fail(error); return undefined; }
    }

    async definitions(position = this.state.position): Promise<LeanLanguageResponse['definitions']> {
        if (this.state.state !== 'available' || !position) return undefined;
        const generation = this.generation;
        try {
            const response = await this.perform('definition', position, 'definition');
            if (response && response.state !== 'available') this.fail(new Error(response.reason || 'Definition lookup unavailable.'));
            return response?.definitions;
        } catch (error) { if (generation === this.generation) this.fail(error); return undefined; }
    }

    async refresh(): Promise<void> {
        if (this.state.state !== 'available') return;
        const generation = this.generation;
        try {
            const [diagnostics, tokens] = await Promise.all([this.perform('diagnostics', undefined, 'diagnostics'), this.perform('tokens', undefined, 'tokens')]);
            if (generation !== this.generation) return;
            if ([diagnostics, tokens].some(response => response && response.state !== 'available')) {
                this.fail(new Error(diagnostics?.reason || tokens?.reason || 'Lean semantic information unavailable.')); return;
            }
            this.state = { ...this.state, diagnostics: diagnostics?.diagnostics || this.state.diagnostics, tokens: tokens?.tokens || this.state.tokens,
                complete: diagnostics?.complete === true && tokens?.complete === true };
            this.changed(this.state); this.schedulePoll();
        } catch (error) { if (generation === this.generation) this.fail(error); }
    }

    private schedulePoll(): void {
        if (this.pollTimer) clearTimeout(this.pollTimer);
        if (this.state.state === 'available' && !this.state.complete) this.pollTimer = setTimeout(() => { this.pollTimer = undefined; void this.refresh(); }, 1500);
    }

    private async perform(action: LeanLanguageAction, position?: LeanPosition, channel: string = action): Promise<LeanLanguageResponse | undefined> {
        const source = this.source, generation = this.generation;
        if (!source || this.host.context().projectId !== source.projectToken) return undefined;
        const sequence = ++this.sequence, requestId = `reader-${this.instance}-${generation}-${sequence}`;
        this.channels.set(channel, sequence);
        this.pending.get(channel)?.abort.abort();
        const abort = new AbortController(); this.pending.set(channel, { abort, requestId });
        const request: LeanLanguageRequest = { action, projectKey: source.projectKey, filePath: source.filePath, sourceHash: source.sourceHash,
            requestId, position, ...(action !== 'open' ? { sessionId: this.state.sessionId, sourceVersion: this.state.sourceVersion } : {}) };
        const current = () => generation === this.generation && this.source === source && this.channels.get(channel) === sequence && this.host.context().projectId === source.projectToken;
        try {
            const response = await this.host.request('/api/lean-language/action', { method: 'POST', cache: 'no-store', signal: abort.signal,
                headers: { 'content-type': 'application/json', 'x-math-workspace-token': this.host.context().token, 'x-math-workspace-project': source.projectToken }, body: JSON.stringify(request) });
            if (!current()) return undefined;
            if (!response.ok) throw new Error(await response.text());
            const value = await response.json() as LeanLanguageResponse;
            if (!current()) return undefined;
            if (value.requestId !== requestId || value.action !== action || value.projectToken !== source.projectToken || value.projectKey !== source.projectKey
                || value.filePath !== source.filePath || value.sourceUri !== source.sourceUri || value.sourceHash !== source.sourceHash
                || (action !== 'open' && value.state === 'available' && (value.sessionId !== request.sessionId || value.sourceVersion !== request.sourceVersion))) throw new Error('Lean response does not match the displayed source version.');
            return value;
        } catch (error) {
            if (!current() || abort.signal.aborted) return undefined;
            throw error;
        } finally { if (this.pending.get(channel)?.requestId === requestId) this.pending.delete(channel); }
    }

    private fail(error: unknown): void {
        if (!this.source || this.host.context().projectId !== this.source.projectToken) return;
        this.stopOperations();
        this.state = { ...this.state, state: 'unavailable', reason: error instanceof Error ? error.message : String(error), hover: undefined, goals: undefined,
            sessionId: undefined, sourceVersion: undefined, response: undefined, termGoal: undefined, renderedGoals: undefined, tokens: [], diagnostics: [], complete: false };
        this.changed(this.state);
    }

    private stopOperations(): void {
        const source = this.source, state = this.state;
        this.generation++; this.channels.clear();
        if (this.timer) clearTimeout(this.timer); if (this.pollTimer) clearTimeout(this.pollTimer); this.timer = this.pollTimer = undefined;
        for (const pending of this.pending.values()) {
            pending.abort.abort();
            if (source) void this.host.request('/api/lean-language/action', { method: 'POST', cache: 'no-store',
                headers: { 'content-type': 'application/json', 'x-math-workspace-token': this.host.context().token, 'x-math-workspace-project': source.projectToken },
                body: JSON.stringify({ action: 'cancel', projectKey: source.projectKey, filePath: source.filePath, sourceHash: source.sourceHash,
                    sessionId: state.sessionId, sourceVersion: state.sourceVersion, requestId: pending.requestId }) }).catch(() => undefined);
        }
        this.pending.clear();
        if (source && state.sessionId) void this.host.request('/api/lean-language/action', { method: 'POST', cache: 'no-store',
            headers: { 'content-type': 'application/json', 'x-math-workspace-token': this.host.context().token, 'x-math-workspace-project': source.projectToken },
            body: JSON.stringify({ action: 'close', projectKey: source.projectKey, filePath: source.filePath, sourceHash: source.sourceHash,
                sessionId: state.sessionId, sourceVersion: state.sourceVersion, requestId: `reader-close-${this.instance}-${this.generation}` }) }).catch(() => undefined);
    }

    close(): void { this.stopOperations(); this.state = { state: 'idle', diagnostics: [], tokens: [], complete: false }; this.changed(this.state); }

    dispose(): void { this.close(); this.source = undefined; }
}

export function leanHoverText(contents: NonNullable<LeanLanguageResponse['hover']>['contents']): string {
    if (Array.isArray(contents)) return contents.map(value => typeof value === 'string' ? value : value.value).join('\n\n');
    return typeof contents === 'string' ? contents : contents.value;
}
