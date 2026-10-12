/** Runtime-free Reader contract. All positions and ranges are zero-based LSP UTF-16. */
export interface LeanPosition { line: number; character: number }
export interface LeanRange { start: LeanPosition; end: LeanPosition }
export type LeanSourceOrigin = 'project' | 'dependency' | 'toolchain';
export interface LeanSourceIdentity {
    projectToken: string;
    projectKey: string;
    /** Workspace-relative path, or toolchain:<relative installed standard-library path>. */
    filePath: string;
    /** Opaque local identity, never a file:// or an arbitrary host path. */
    sourceUri: string;
    sourceHash: string;
}
export interface LeanSourceFile extends LeanSourceIdentity {
    content: string;
    lineCount: number;
    range: LeanRange;
    origin: LeanSourceOrigin;
    readonly: true;
}
export interface LeanSemanticToken { range: LeanRange; type: string; modifiers: string[] }
export interface LeanLanguageDiagnostic {
    range: LeanRange;
    message: string;
    severity?: number;
    source?: string;
    code?: string | number;
}
export type LeanHoverContents = string | { kind: 'markdown' | 'plaintext'; value: string }
    | { language: string; value: string } | Array<string | { language: string; value: string }>;
export interface LeanDefinitionLocation extends LeanSourceIdentity {
    range: LeanRange;
    selectionRange?: LeanRange;
    origin: LeanSourceOrigin;
}
export interface LeanLanguageCapabilities {
    hover: boolean;
    definition: boolean;
    goals: boolean;
    diagnostics: boolean;
    semanticTokens: boolean;
}
export type LeanLanguageAction = 'open' | 'hover' | 'definition' | 'goals' | 'tokens' | 'diagnostics' | 'close' | 'cancel';
export interface LeanLanguageRequest {
    action: LeanLanguageAction;
    projectKey: string;
    filePath: string;
    sourceHash: string;
    sessionId?: string;
    sourceVersion?: number;
    position?: LeanPosition;
    /** Caller generated identity echoed by every response; cancel targets this request. */
    requestId: string;
}
export interface LeanLanguageResponse extends LeanSourceIdentity {
    action: LeanLanguageAction;
    requestId: string;
    state: 'available' | 'unavailable' | 'closed' | 'cancelled';
    sessionId?: string;
    sourceVersion?: number;
    toolchain?: string;
    reason?: string;
    capabilities?: LeanLanguageCapabilities;
    hover?: { contents: LeanHoverContents; range?: LeanRange } | null;
    goals?: string[] | null;
    renderedGoals?: string;
    termGoal?: string | null;
    termGoalRange?: LeanRange;
    definitions?: LeanDefinitionLocation[];
    omittedDefinitions?: number;
    tokens?: LeanSemanticToken[];
    diagnostics?: LeanLanguageDiagnostic[];
    /** false means Lean is still processing; explicit diagnostics/tokens requests refresh it. */
    complete?: boolean;
}
