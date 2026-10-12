import type { LeanReviewResponse, ReviewVerdict } from '../../lean/lean-review';
import type { AuditAnchorInput, AuditCategory, AuditCorrespondence, AuditIssue, AuditIssueStatus, AuditLink,
    AuditRange, AuditSource, LeanAuditOverview, LeanAuditResponse, LeanAuditReport } from '../../lean/lean-audit';
import { copyReaderText } from './reader-clipboard';
import './reader-lean-audit.css';

export interface LeanAuditSelection {
    subclaimId?: string;
    declarationKey?: string;
    projectKey?: string;
    filePath?: string;
    range?: AuditRange;
    sourceHash?: string;
    sourceUri?: string;
}
export interface ReaderLeanAuditHost {
    context(): { projectId: string | null; requestToken?: string; token?: string; language: string; revision?: number };
    request(path: string, init?: RequestInit): Promise<Response>;
    report(message: string, warning?: boolean): void;
    openReview(id: string): void | Promise<void>;
    openSource(source: { projectKey: string; filePath: string; range: AuditRange; sourceHash?: string; sourceUri?: string }): void | Promise<void>;
    locateProse(source: { filePath: string; startLine: number; endLine: number; quote?: string }): void | Promise<void>;
    canAssist?(): boolean;
    assist?(content: any[]): Promise<unknown>;
    download?(name: string, content: string): void;
}
type Identity = { id: string; projectId: string };
interface LinkDraft {
    mode: 'create' | 'edit' | 'recheck'; linkId?: string; prose?: AuditAnchorInput; lean?: AuditAnchorInput;
    reviewer: string; note: string; verdict: ReviewVerdict; correspondences: AuditCorrespondence[];
    proseStamp?: string; leanStamp?: string;
    baseRevision?: number; evidenceFingerprint?: string;
}
interface IssueDraft {
    mode: 'create' | 'edit' | 'recheck'; issueId?: string; linkId: string; category: AuditCategory;
    title: string; note: string; status: AuditIssueStatus; resolution: string; reviewer: string;
    baseRevision: number; evidenceFingerprint: string;
}
const categories: AuditCategory[] = ['assumption', 'symbol', 'scope', 'statement', 'proof', 'trust', 'other'];
const verdicts: ReviewVerdict[] = ['aligned', 'partial', 'difference', 'undecided'];
const statuses: AuditIssueStatus[] = ['open', 'resolved', 'dismissed'];
const categoryZh = { assumption: '假设', symbol: '符号', scope: '范围', statement: '陈述', proof: '证明', trust: '信任边界', other: '其他' };
const verdictZh = { aligned: '范围内一致', partial: '部分对应', difference: '存在差异', undecided: '未决定' };
const statusZh = { open: '未解决', resolved: '已解决', dismissed: '已撤回' };
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const value = document.createElement(tag); value.textContent = text; if (className) value.className = className; return value;
}
function action(text: string, name: string, run: () => void): HTMLButtonElement {
    const button = el('button', text); button.type = 'button'; button.dataset.leanAuditAction = name; button.addEventListener('click', run); return button;
}
function newDraft(): LinkDraft { return { mode: 'create', reviewer: '', note: '', verdict: 'undecided', correspondences: [] }; }
function position(content: string, offset: number, startLine: number): { line: number; character: number } {
    const before = content.slice(0, offset).split('\n'); return { line: startLine - 1 + before.length - 1, character: before[before.length - 1].length };
}
function rangeLabel(anchor: AuditAnchorInput): string {
    return `${anchor.filePath}:${anchor.range.start.line + 1}:${anchor.range.start.character + 1}–${anchor.range.end.line + 1}:${anchor.range.end.character + 1}`;
}

/** Bounded candidate-discussion handoff. It neither sends a model turn nor applies a human verdict. */
export function leanAuditAssistance(payload: LeanAuditResponse, language = 'en'): string {
    const instruction = language === 'zh'
        ? '请协助核对下列人工位置关联及问题，逐项区分源码事实、范围/假设差异和待证结论。给出候选建议，不将构建通过或 AI 建议当作语义等价，也不自动保存人工结论。'
        : 'Help inspect these human source associations and issues. Distinguish source facts, scope/assumption differences and unproved claims. Suggest candidates only; a build or AI suggestion is not semantic equivalence and must not automatically save a human verdict.';
    const context = { formalId: payload.id, evidenceFingerprint: payload.evidenceFingerprint,
        manualReview: { freshness: payload.manualReview.freshness, verdict: payload.manualReview.verdict },
        links: payload.links.map(value => ({ freshness: value.freshness, reasons: value.reasons, ...value.link })),
        issues: payload.issues.map(value => ({ freshness: value.freshness, unresolved: value.unresolved, ...value.issue })) };
    const text = instruction + '\n\n' + JSON.stringify(context, null, 2);
    return text.length <= 40000 ? text : text.slice(0, 39700) + '\n\n[Bounded handoff truncated; inspect the current Reader artifacts for the complete record.]';
}

/** Owns audit projection, drafts, exact source selections, request identity and explicit actions. */
export class ReaderLeanAudit {
    private readonly section = el('section', '', 'reader-lean-audit');
    private active?: Identity;
    private payload?: LeanAuditResponse;
    private selected: LeanAuditSelection = {};
    private requestVersion = 0;
    private actionVersion = 0;
    private overviewVersion = 0;
    private busy = false;
    private outdated = false;
    private error = '';
    private draft: LinkDraft = newDraft();
    private readonly drafts = new Map<string, LinkDraft>();
    private readonly issueDrafts = new Map<string, IssueDraft>();
    private issueDraft?: IssueDraft;
    private proseKey = '';
    private leanKey = '';
    private linkFilter = 'all';
    private issueFilter = 'all';
    private overviewFilter = 'all';
    private overview?: LeanAuditOverview;
    private showOverview = false;
    private savedEvidence = '';
    private savedManualRevision = -1;
    private savedWorkspaceRevision?: number;
    private language = '';

    constructor(private readonly host: ReaderLeanAuditHost) { this.section.hidden = true; this.section.setAttribute('aria-label', 'Lean source associations and issues'); }
    mount(): HTMLElement { return this.section; }
    private t(zh: string, en: string): string { return this.host.context().language === 'zh' ? zh : en; }
    private key(identity: Identity): string { return identity.projectId + ':' + identity.id; }
    private matches(identity: Identity): boolean { return this.active?.id === identity.id && this.active.projectId === identity.projectId && this.host.context().projectId === identity.projectId && !this.section.hidden; }
    update(response: LeanReviewResponse, selected: LeanAuditSelection = {}): void {
        if (response.projectToken !== this.host.context().projectId) return;
        const changed = !this.active || this.active.id !== response.id || this.active.projectId !== response.projectToken;
        if (changed) {
            if (this.active) { this.drafts.set(this.key(this.active), this.draft); if (this.issueDraft) this.issueDrafts.set(this.key(this.active), this.issueDraft); }
            this.active = { id: response.id, projectId: response.projectToken }; this.payload = undefined;
            this.draft = this.drafts.get(this.key(this.active)) || newDraft(); this.issueDraft = this.issueDrafts.get(this.key(this.active));
            this.proseKey = ''; this.leanKey = ''; this.error = ''; this.busy = false; this.outdated = false;
            this.actionVersion++; this.overviewVersion++; this.overview = undefined; this.showOverview = false;
        }
        const selectionChanged = JSON.stringify(selected) !== JSON.stringify(this.selected), languageChanged = this.language !== this.host.context().language;
        this.selected = { ...selected }; this.language = this.host.context().language; this.section.hidden = false;
        if (changed || this.savedEvidence !== response.evidence.fingerprint || this.savedManualRevision !== response.review.expectedRevision
            || this.savedWorkspaceRevision !== this.host.context().revision) {
            this.savedEvidence = response.evidence.fingerprint; this.savedManualRevision = response.review.expectedRevision;
            this.savedWorkspaceRevision = this.host.context().revision;
            void this.load(this.active!);
        } else if (selectionChanged || languageChanged) this.render();
    }
    selectionChanged(selected: LeanAuditSelection): void {
        if (JSON.stringify(this.selected) === JSON.stringify(selected)) return;
        this.selected = { ...selected }; if (this.active && !this.section.hidden) this.render();
    }
    metadataChanged(): void {
        if (!this.active || this.section.hidden) return;
        void this.load(this.active); if (this.showOverview) void this.loadOverview(this.active);
    }
    hide(): void {
        if (this.active) { this.drafts.set(this.key(this.active), this.draft); if (this.issueDraft) this.issueDrafts.set(this.key(this.active), this.issueDraft); }
        this.section.hidden = true; this.active = undefined; this.payload = undefined; this.busy = false;
        this.requestVersion++; this.actionVersion++; this.overviewVersion++;
    }
    destroy(): void { this.hide(); this.section.remove(); this.drafts.clear(); this.issueDrafts.clear(); }

    private async json<T>(route: string, identity: Identity, body?: unknown): Promise<T> {
        const context = this.host.context();
        const response = await this.host.request(route, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
            headers: { 'content-type': 'application/json', 'x-math-workspace-token': context.requestToken || context.token || '',
                'x-math-workspace-project': identity.projectId } });
        if (!response.ok) {
            const message = await response.text(); const error = new Error(message || `HTTP ${response.status}`) as Error & { status: number };
            error.status = response.status; throw error;
        }
        return response.json();
    }
    private async load(identity: Identity): Promise<void> {
        const version = ++this.requestVersion; this.render();
        try {
            const payload = await this.json<LeanAuditResponse>('/api/lean-audit?id=' + encodeURIComponent(identity.id), identity);
            if (!this.matches(identity) || version !== this.requestVersion) return;
            if (payload.id !== identity.id || payload.projectToken !== identity.projectId) throw new Error(this.t('审阅响应不属于当前对象。', 'Audit response belongs to another object.'));
            this.payload = payload; this.outdated = false; this.error = ''; this.render();
        } catch (error) {
            if (!this.matches(identity) || version !== this.requestVersion) return;
            this.error = error instanceof Error ? error.message : String(error); this.outdated = true; this.render();
        }
    }
    private async save(body: Record<string, unknown>): Promise<void> {
        const identity = this.active, payload = this.payload; if (!identity || !payload || this.busy || this.outdated || !this.matches(identity)) return;
        const savedLinkDraft = this.draft, savedIssueDraft = this.issueDraft;
        const version = ++this.actionVersion, readVersion = ++this.requestVersion; this.busy = true; this.render();
        try {
            const value = await this.json<LeanAuditResponse>('/api/lean-audit/action', identity,
                { ...body, id: identity.id, expectedRevision: body.expectedRevision ?? payload.expectedRevision, evidenceFingerprint: body.evidenceFingerprint ?? payload.evidenceFingerprint });
            if (!this.matches(identity) || version !== this.actionVersion) return;
            if (value.id !== identity.id || value.projectToken !== identity.projectId) throw new Error(this.t('保存响应不属于当前对象。', 'Save response belongs to another object.'));
            if (String(body.action).endsWith('link') && this.draft === savedLinkDraft) {
                this.draft = { ...newDraft(), reviewer: this.draft.reviewer }; this.drafts.set(this.key(identity), this.draft);
            } else if (!String(body.action).endsWith('link') && this.issueDraft === savedIssueDraft) {
                this.issueDraft = undefined; this.issueDrafts.delete(this.key(identity));
            }
            this.busy = false; this.error = ''; this.outdated = false;
            this.host.report(this.t('位置审阅记录已保存。', 'Source audit saved.'));
            if (readVersion !== this.requestVersion) { this.render(); void this.load(identity); return; }
            this.payload = value; this.render();
            if (this.showOverview) void this.loadOverview(identity);
        } catch (error) {
            if (!this.matches(identity) || version !== this.actionVersion) return;
            this.busy = false; this.error = error instanceof Error ? error.message : String(error);
            if ((error as Error & { status?: number }).status === 409) this.outdated = true;
            this.host.report(this.error, true); this.render();
        }
    }
    private field(labelText: string, value: string, name: string, update: (value: string) => void, multiline = false, maximum = 8000): HTMLLabelElement {
        const label = el('label', '', 'reader-lean-audit-field'), input = multiline ? el('textarea') : el('input');
        input.value = value; input.maxLength = maximum; input.dataset.leanAuditField = name; input.disabled = this.busy;
        input.addEventListener('input', () => update(input.value)); label.append(el('span', labelText), input); return label;
    }
    private select<T extends string>(labelText: string, choices: T[], value: T, name: string, text: (value: T) => string, update: (value: T) => void): HTMLLabelElement {
        const label = el('label', '', 'reader-lean-audit-field'), select = el('select'); select.dataset.leanAuditField = name; select.disabled = this.busy;
        for (const choice of choices) { const option = el('option', text(choice)); option.value = choice; select.append(option); }
        select.value = value; select.addEventListener('change', () => update(select.value as T)); label.append(el('span', labelText), select); return label;
    }
    private verdictLabel(value: ReviewVerdict): string { return this.host.context().language === 'zh' ? verdictZh[value] : value; }
    private categoryLabel(value: AuditCategory): string { return this.host.context().language === 'zh' ? categoryZh[value] : value; }
    private statusLabel(value: AuditIssueStatus): string { return this.host.context().language === 'zh' ? statusZh[value] : value; }
    private freshness(value: string): string { return this.t(value === 'stale' ? '待复核' : '当前', value); }
    private stamp(): string { return this.payload!.evidenceFingerprint + ':' + (this.payload!.manualReview.history.at(-1)?.revision || 0); }
    private selectionReady(): boolean {
        return !!this.draft.prose && !!this.draft.lean && this.draft.proseStamp === this.stamp() && this.draft.leanStamp === this.stamp();
    }
    private draftCurrent(draft: { baseRevision?: number; evidenceFingerprint?: string }): boolean {
        return draft.baseRevision === undefined || (draft.baseRevision === this.payload!.expectedRevision && draft.evidenceFingerprint === this.payload!.evidenceFingerprint);
    }
    private touchLinkDraft(): void {
        if (this.draft.baseRevision === undefined && this.payload) { this.draft.baseRevision = this.payload.expectedRevision; this.draft.evidenceFingerprint = this.payload.evidenceFingerprint; }
    }
    private sourceSelectionValid(source: AuditSource): boolean {
        const range = this.selected.range;
        return !!range && (range.end.line > range.start.line || (range.end.line === range.start.line && range.end.character > range.start.character))
            && !!this.selected.sourceHash && this.selected.declarationKey === source.declarationKey
            && this.selected.projectKey === source.projectKey && this.selected.filePath === source.source.filePath;
    }

    private render(): void {
        if (this.section.hidden) return;
        this.section.replaceChildren(); const head = el('div', '', 'reader-lean-audit-actions');
        head.append(el('h3', this.t('位置关联与问题', 'Source associations and issues')),
            action(this.t('重新读取', 'Reload'), 'reload', () => { if (this.active) void this.load(this.active); }),
            action(this.t('项目总览', 'Project overview'), 'overview', () => {
                this.showOverview = !this.showOverview; this.render(); if (this.showOverview && this.active) void this.loadOverview(this.active);
            }), action(this.t('导出审阅报告', 'Export review report'), 'export', () => { void this.exportReport(); }));
        this.section.append(head, el('p', this.t('人工选择两侧原文，记录对应范围、假设/符号及问题。关联结论与整对象结论分别显示；构建或 AI 建议不会更新人工结论。',
            'Select exact text on both sides and record scope, assumptions/symbols and issues. Link verdicts and object verdicts are independent; builds or AI suggestions never update a human decision.'), 'reader-lean-audit-hint'));
        if (this.error) { const error = el('p', this.error, 'reader-lean-audit-warning'); error.setAttribute('role', 'alert'); this.section.append(error); }
        if (this.outdated) this.section.append(el('p', this.t('记录或源码已变化。草稿保留；重新读取后须重新选择当前两侧范围。', 'Records or source changed. The draft is retained; reload and select both current ranges before saving.'), 'reader-lean-audit-warning'));
        if (!this.payload) { this.section.append(el('p', this.t('正在读取位置审阅…', 'Loading source audit…'))); return; }
        this.section.append(el('p', this.t('整对象人工结论：', 'Object human verdict: ') + this.verdictLabel(this.payload.manualReview.verdict || 'undecided') + ' · ' +
            (this.payload.manualReview.freshness === 'unreviewed' ? this.t('未审阅', 'unreviewed') : this.freshness(this.payload.manualReview.freshness))));
        this.section.append(this.renderLinks(), this.renderLinkEditor(), this.renderIssues());
        if (this.issueDraft) this.section.append(this.renderIssueEditor());
        this.section.append(this.renderHistory());
        const assist = el('div', '', 'reader-lean-audit-actions');
        assist.append(action(this.host.canAssist?.() ? this.t('引用位置审阅到会话', 'Quote source audit in conversation') : this.t('复制审阅材料', 'Copy audit context'), 'assist', () => { void this.assist(); }));
        this.section.append(assist);
        if (this.showOverview) this.section.append(this.renderOverview());
    }
    private renderSourcePicker(side: 'prose' | 'lean'): HTMLElement {
        const section = el('div', '', 'reader-lean-audit-source-picker'), sources = side === 'prose' ? this.payload!.proseSources : this.payload!.leanSources;
        let selectedKey = side === 'prose' ? this.proseKey : this.leanKey;
        if (!sources.some(source => source.key === selectedKey)) selectedKey = side === 'lean' && sources.some(source => source.key === this.selected.declarationKey)
            ? this.selected.declarationKey! : sources[0]?.key || '';
        if (side === 'prose') this.proseKey = selectedKey; else this.leanKey = selectedKey;
        const select = el('select'); select.dataset.leanAuditSource = side; select.disabled = this.busy;
        for (const source of sources) {
            const option = el('option', `${source.projectKey ? source.projectKey + ' · ' : ''}${source.source.role || side} · ${source.source.filePath}:${source.source.startLine}–${source.source.endLine}`);
            option.value = source.key; select.append(option);
        }
        select.value = selectedKey;
        select.addEventListener('change', () => { if (side === 'prose') this.proseKey = select.value; else this.leanKey = select.value; this.render(); });
        section.append(el('h4', this.t(side === 'prose' ? '正文原文选区' : 'Lean 原文选区', side === 'prose' ? 'Prose source selection' : 'Lean source selection')), select);
        const source = sources.find(item => item.key === selectedKey);
        if (source) {
            const textarea = el('textarea'); textarea.readOnly = true; textarea.value = source.source.content; textarea.dataset.leanAuditSelection = side;
            textarea.className = 'reader-lean-audit-source-text'; textarea.setAttribute('aria-label', this.t('拖拽选择要关联的原文', 'Select source text to associate'));
            const capture = () => {
                const start = textarea.selectionStart, end = textarea.selectionEnd;
                if (start === end || this.busy) return;
                if (end - start > 6000) { this.host.report(this.t('选区最多 6000 字符，请缩小范围。', 'Select at most 6000 characters.'), true); return; }
                this.capture(side, source, { start: position(textarea.value, start, source.source.startLine), end: position(textarea.value, end, source.source.startLine) }, textarea.value.slice(start, end));
            };
            textarea.addEventListener('select', capture); textarea.addEventListener('mouseup', capture); textarea.addEventListener('keyup', capture); section.append(textarea);
            if (source.source.truncated) section.append(el('p', this.t('这里只显示有限摘录；完整 Lean 文件可从源码查看器选择。', 'This is a bounded excerpt; select from the full Lean source viewer for other ranges.'), 'reader-lean-audit-hint'));
            if (side === 'lean') {
                const use = action(this.t('采用源码查看器当前选区', 'Use current source viewer selection'), 'capture-lean', () => {
                    if (!this.sourceSelectionValid(source)) return;
                    this.capture('lean', { ...source, fileHash: this.selected.sourceHash! }, this.selected.range!);
                });
                use.disabled = this.busy || !this.sourceSelectionValid(source);
                section.append(use);
            }
        } else section.append(el('p', this.t('当前对象没有可选择的来源。', 'This object has no selectable source.')));
        const captured = this.draft[side];
        if (captured) { const preview = el('div', '', 'reader-lean-audit-capture'); preview.append(el('strong', this.t('已选择：', 'Selected: ') + rangeLabel(captured)), el('pre', captured.quote || this.t('保存时核对源码查看器选区原文。', 'Source viewer text is checked when saving.'))); section.append(preview); }
        return section;
    }
    private capture(side: 'prose' | 'lean', source: AuditSource, range: AuditRange, quote?: string): void {
        this.touchLinkDraft();
        const anchor: AuditAnchorInput = { filePath: source.source.filePath, range, fileHash: source.fileHash,
            ...(quote !== undefined ? { quote } : {}), ...(side === 'prose' ? { snippetKey: source.key } : { declarationKey: source.declarationKey, projectKey: source.projectKey }) };
        if (side === 'prose' && this.selected.subclaimId && this.payload!.manualReview.history.at(-1)?.subclaims.some(claim => claim.id === this.selected.subclaimId)) anchor.subclaimId = this.selected.subclaimId;
        this.draft[side] = anchor;
        if (side === 'prose') this.draft.proseStamp = this.stamp(); else this.draft.leanStamp = this.stamp();
        this.drafts.set(this.key(this.active!), this.draft);
        // Keep the active text selection visible; update only its saved-position preview and save admission.
        const picker = this.section.querySelector<HTMLElement>(`[data-lean-audit-selection="${side}"]`)?.parentElement;
        picker?.querySelector('.reader-lean-audit-capture')?.remove();
        const preview = el('div', '', 'reader-lean-audit-capture'); preview.append(el('strong', this.t('已选择：', 'Selected: ') + rangeLabel(anchor)), el('pre', quote || this.t('保存时核对当前选区原文。', 'Current selection is checked on save.'))); picker?.append(preview);
        const save = this.section.querySelector<HTMLButtonElement>('[data-lean-audit-action="save-link"]');
        if (save) save.disabled = this.busy || this.outdated || !this.draftCurrent(this.draft) || !this.selectionReady();
    }
    private renderLinkEditor(): HTMLElement {
        const editor = el('section', '', 'reader-lean-audit-link-editor');
        editor.append(el('h4', this.t(this.draft.mode === 'create' ? '新建位置关联' : this.draft.mode === 'recheck' ? '重新核对两侧范围' : '更新人工关联说明',
            this.draft.mode === 'create' ? 'New source association' : this.draft.mode === 'recheck' ? 'Explicitly recheck both source ranges' : 'Update human link notes')));
        if (this.draft.mode !== 'edit') { const pair = el('div', '', 'reader-lean-audit-pair'); pair.append(this.renderSourcePicker('prose'), this.renderSourcePicker('lean')); editor.append(pair); }
        editor.append(this.field(this.t('审阅者', 'Reviewer'), this.draft.reviewer, 'link-reviewer', value => { this.touchLinkDraft(); this.draft.reviewer = value; }, false, 300),
            this.select(this.t('此关联范围内的人工结论', 'Human verdict within this link scope'), verdicts, this.draft.verdict, 'link-verdict', value => this.verdictLabel(value), value => { this.touchLinkDraft(); this.draft.verdict = value; }),
            this.field(this.t('范围和说明', 'Scope and notes'), this.draft.note, 'link-note', value => { this.touchLinkDraft(); this.draft.note = value; }, true));
        const pairs = el('fieldset', '', 'reader-lean-audit-correspondences'); pairs.append(el('legend', this.t('明确假设与符号对应', 'Explicit assumptions and symbols')));
        this.draft.correspondences.forEach((pair, index) => {
            const row = el('div', '', 'reader-lean-audit-correspondence');
            row.append(this.select(this.t('类型', 'Kind'), ['assumption', 'symbol'], pair.kind, 'pair-kind-' + index, value => this.categoryLabel(value), value => pair.kind = value),
                this.field(this.t('正文假设 / 符号', 'Prose assumption / symbol'), pair.prose, 'pair-prose-' + index, value => pair.prose = value, false, 1000),
                this.field(this.t('Lean 假设 / 符号', 'Lean assumption / symbol'), pair.lean, 'pair-lean-' + index, value => pair.lean = value, false, 1000),
                this.field(this.t('对应说明', 'Correspondence note'), pair.note, 'pair-note-' + index, value => pair.note = value, true, 4000),
                action(this.t('移除', 'Remove'), 'remove-pair', () => { this.draft.correspondences.splice(index, 1); this.render(); })); pairs.append(row);
        });
        const add = action(this.t('添加假设 / 符号', 'Add assumption / symbol'), 'add-pair', () => {
            this.touchLinkDraft();
            this.draft.correspondences.push({ kind: 'assumption', prose: '', lean: '', note: '' }); this.render();
        }); add.disabled = this.busy || this.draft.correspondences.length >= 40; pairs.append(add); editor.append(pairs);
        const actions = el('div', '', 'reader-lean-audit-actions'), save = action(this.t('保存此位置关联', 'Save this source association'), 'save-link', () => {
            const draft = this.draft;
            void this.save({ action: draft.mode === 'create' ? 'create-link' : draft.mode === 'edit' ? 'edit-link' : 'recheck-link',
                linkId: draft.linkId, prose: draft.prose, lean: draft.lean, reviewer: draft.reviewer, verdict: draft.verdict, note: draft.note,
                correspondences: draft.correspondences, expectedRevision: draft.baseRevision, evidenceFingerprint: draft.evidenceFingerprint });
        });
        save.disabled = this.busy || this.outdated || !this.draftCurrent(this.draft) || (this.draft.mode !== 'edit' && !this.selectionReady()); actions.append(save);
        if (!this.draftCurrent(this.draft)) editor.append(el('p', this.t('此草稿基于旧审阅版本，已保留供参考。取消后重新打开当前记录或重新选择，才能再次保存。', 'This draft uses an older audit revision and is retained for reference. Cancel and reopen the current record or reselect before saving.'), 'reader-lean-audit-warning'));
        if (this.draft.mode !== 'edit' && (this.draft.prose || this.draft.lean) && !this.selectionReady()) editor.append(el('p', this.t('请在当前证据和人工分项版本下重新选择两侧原文。', 'Select both ranges under the current evidence and human subclaim version.'), 'reader-lean-audit-hint'));
        if (this.draft.mode !== 'create' || this.draft.baseRevision !== undefined) actions.append(action(this.t('取消当前草稿', 'Cancel current draft'), 'cancel-link', () => { this.draft = newDraft(); this.render(); }));
        editor.append(actions); return editor;
    }
    private renderLinks(): HTMLElement {
        const section = el('section', '', 'reader-lean-audit-links'); section.append(el('h4', this.t('已保存的位置关联', 'Saved source associations')),
            this.select(this.t('筛选关联', 'Filter links'), ['all', 'current', 'stale'], this.linkFilter, 'link-filter', value => this.t(({ all: '全部', current: '当前', stale: '待复核' })[value], value), value => { this.linkFilter = value; this.render(); }));
        const links = this.payload!.links.filter(item => this.linkFilter === 'all' || item.freshness === this.linkFilter);
        if (!links.length) section.append(el('p', this.t('没有匹配的位置关联。', 'No matching source associations.')));
        for (const projection of links) {
            const link = projection.link, entry = el('article', '', 'reader-lean-audit-link'); entry.dataset.leanAuditLink = link.id;
            entry.append(el('strong', this.verdictLabel(link.verdict) + ' · ' + this.freshness(projection.freshness)), el('p', link.note),
                el('p', this.t('正文：', 'Prose: ') + rangeLabel(link.prose)), el('pre', link.prose.quote),
                el('p', 'Lean: ' + rangeLabel(link.lean)), el('pre', link.lean.quote));
            if (link.prose.subclaimId) entry.append(el('p', this.t('已保存分项：', 'Saved subclaim: ') + link.prose.subclaimId));
            for (const pair of link.correspondences) entry.append(el('p', `${this.categoryLabel(pair.kind)}: ${pair.prose} ↔ ${pair.lean}. ${pair.note}`));
            if (projection.reasons.length) entry.append(el('p', projection.reasons.join('; '), 'reader-lean-audit-warning'));
            const buttons = el('div', '', 'reader-lean-audit-actions');
            buttons.append(action(this.t('定位正文', 'Locate prose'), 'jump-prose', () => { void this.jumpProse(link); }),
                action(this.t('定位 Lean', 'Locate Lean'), 'jump-lean', () => { void this.jumpLean(link, projection.freshness === 'stale'); }),
                action(this.t('重新核对', 'Recheck'), 'recheck-link', () => this.editLink(link, true)));
            const edit = action(this.t('修改说明', 'Edit notes'), 'edit-link', () => this.editLink(link, false)); edit.disabled = projection.freshness === 'stale' || this.busy; buttons.append(edit);
            const issue = action(this.t('记录问题', 'Record issue'), 'create-issue', () => {
                this.issueDraft = { mode: 'create', linkId: link.id, category: 'assumption', title: '', note: '', status: 'open', resolution: '', reviewer: link.reviewer,
                    baseRevision: this.payload!.expectedRevision, evidenceFingerprint: this.payload!.evidenceFingerprint }; this.render();
                this.section.querySelector<HTMLElement>('[data-lean-audit-field="issue-title"]')?.focus();
            }); issue.disabled = projection.freshness === 'stale' || this.busy; buttons.append(issue); entry.append(buttons); section.append(entry);
        }
        return section;
    }
    private editLink(link: AuditLink, recheck: boolean): void {
        this.draft = { mode: recheck ? 'recheck' : 'edit', linkId: link.id, prose: recheck ? undefined : link.prose, lean: recheck ? undefined : link.lean,
            reviewer: link.reviewer, note: link.note, verdict: recheck ? 'undecided' : link.verdict, correspondences: link.correspondences.map(pair => ({ ...pair })) };
        this.draft.baseRevision = this.payload!.expectedRevision; this.draft.evidenceFingerprint = this.payload!.evidenceFingerprint;
        this.proseKey = link.prose.snippetKey || ''; this.leanKey = link.lean.declarationKey || ''; this.render();
    }
    private async jumpProse(link: AuditLink): Promise<void> {
        try { await this.host.locateProse({ filePath: link.prose.filePath, startLine: link.prose.range.start.line + 1, endLine: link.prose.range.end.line + 1, quote: link.prose.quote }); }
        catch (error) { this.host.report(String(error), true); }
    }
    private async jumpLean(link: AuditLink, stale: boolean): Promise<void> {
        try {
            if (stale) this.host.report(this.t('正在打开当前源码的旧位置，请重新选择核对；旧摘录保留在记录中。', 'Opening the saved position in current source; select and recheck it. The historical quote remains in the record.'));
            await this.host.openSource({ projectKey: link.lean.projectKey!, filePath: link.lean.filePath, range: link.lean.range,
                ...(stale ? {} : { sourceHash: link.lean.fileHash }) });
        } catch (error) { this.host.report(String(error), true); }
    }
    private renderIssues(): HTMLElement {
        const section = el('section', '', 'reader-lean-audit-issues'); section.append(el('h4', this.t('问题与复核', 'Issues and rechecks')),
            this.select(this.t('筛选问题', 'Filter issues'), ['all', 'unresolved', 'open', 'resolved', 'dismissed', 'stale'], this.issueFilter, 'issue-filter', value => this.t(({ all: '全部', unresolved: '未解决 / 待复核', open: '未解决', resolved: '已解决', dismissed: '已撤回', stale: '待复核' })[value], value), value => { this.issueFilter = value; this.render(); }));
        const issues = this.payload!.issues.filter(value => this.issueFilter === 'all' || (this.issueFilter === 'unresolved' ? value.unresolved
            : this.issueFilter === 'stale' ? value.freshness === 'stale' : value.issue.status === this.issueFilter));
        if (!issues.length) section.append(el('p', this.t('没有匹配的问题。', 'No matching issues.')));
        for (const projection of issues) {
            const issue = projection.issue, entry = el('article', '', 'reader-lean-audit-issue'); entry.dataset.leanAuditIssue = issue.id;
            entry.append(el('strong', `${this.categoryLabel(issue.category)} · ${this.statusLabel(issue.status)} · ${this.freshness(projection.freshness)}`),
                el('p', issue.title), el('p', issue.note), el('p', this.t('处理说明：', 'Resolution: ') + issue.resolution));
            if (projection.unresolved && issue.status !== 'open') entry.append(el('p', this.t('先前处理结论已过期，仍计入待处理。', 'The previous disposition is stale and remains actionable.'), 'reader-lean-audit-warning'));
            if (projection.reasons.length) entry.append(el('p', projection.reasons.join('; '), 'reader-lean-audit-warning'));
            const buttons = el('div', '', 'reader-lean-audit-actions');
            const edit = action(this.t('修改 / 处理', 'Edit / resolve'), 'edit-issue', () => this.editIssue(issue, false)); edit.disabled = projection.freshness === 'stale' || this.busy;
            buttons.append(edit, action(this.t('明确复核', 'Explicit recheck'), 'recheck-issue', () => this.editIssue(issue, true))); entry.append(buttons); section.append(entry);
        }
        return section;
    }
    private editIssue(issue: AuditIssue, recheck: boolean): void {
        this.issueDraft = { ...issue, issueId: issue.id, mode: recheck ? 'recheck' : 'edit', resolution: recheck ? '' : issue.resolution,
            baseRevision: this.payload!.expectedRevision, evidenceFingerprint: this.payload!.evidenceFingerprint }; this.render();
    }
    private renderIssueEditor(): HTMLElement {
        const draft = this.issueDraft!, editor = el('section', '', 'reader-lean-audit-issue-editor');
        editor.append(el('h4', this.t(draft.mode === 'recheck' ? '明确复核此问题' : '记录 / 处理问题', draft.mode === 'recheck' ? 'Explicitly recheck this issue' : 'Record / resolve an issue')),
            el('p', this.t('关联：', 'Link: ') + draft.linkId),
            this.select(this.t('问题类型', 'Issue category'), categories, draft.category, 'issue-category', value => this.categoryLabel(value), value => draft.category = value),
            this.field(this.t('问题', 'Issue'), draft.title, 'issue-title', value => draft.title = value, false, 500),
            this.field(this.t('说明', 'Notes'), draft.note, 'issue-note', value => draft.note = value, true),
            this.select(this.t('人工处理状态', 'Human disposition'), statuses, draft.status, 'issue-status', value => this.statusLabel(value), value => draft.status = value),
            this.field(this.t('处理 / 复核依据', 'Resolution / recheck rationale'), draft.resolution, 'issue-resolution', value => draft.resolution = value, true),
            this.field(this.t('审阅者', 'Reviewer'), draft.reviewer, 'issue-reviewer', value => draft.reviewer = value, false, 300));
        const save = action(this.t('保存问题决定', 'Save issue decision'), 'save-issue', () => {
            void this.save({ ...draft, expectedRevision: draft.baseRevision, action: draft.mode === 'create' ? 'create-issue' : draft.mode === 'recheck' ? 'recheck-issue' : 'update-issue' });
        }); save.disabled = this.busy || this.outdated || !this.draftCurrent(draft);
        if (!this.draftCurrent(draft)) editor.append(el('p', this.t('此问题草稿基于旧审阅版本，已保留。取消后重新打开当前问题再核对。', 'This issue draft uses an older audit revision and is retained. Cancel and reopen the current issue before checking it again.'), 'reader-lean-audit-warning'));
        editor.append(save, action(this.t('取消', 'Cancel'), 'cancel-issue', () => { this.issueDraft = undefined; if (this.active) this.issueDrafts.delete(this.key(this.active)); this.render(); })); return editor;
    }
    private renderHistory(): HTMLElement {
        const details = el('details', '', 'reader-lean-audit-history'); details.append(el('summary', this.t('人工决定历史', 'Human decision history')));
        details.append(el('p', this.t('历史有界保留；被移除的旧项数量明确显示。来源变化不会自动重写历史。', 'History retention is bounded; dropped counts are explicit. Source changes never rewrite past decisions.')));
        const manual = this.payload!.manualReview;
        details.append(el('h4', this.t('整对象审阅历史', 'Object decision history')), el('p', `${this.t('已保留 / 已移除：', 'Retained / dropped: ')}${manual.history.length} / ${manual.historyDropped}`));
        for (const decision of manual.history) {
            const row = el('details'); row.append(el('summary', `r${decision.revision} · ${decision.reviewedAt} · ${decision.reviewer} · ${this.verdictLabel(decision.verdict)}`), el('p', decision.scope), el('p', decision.note));
            for (const claim of decision.subclaims) row.append(el('p', `${claim.id}: ${claim.text} · ${this.verdictLabel(claim.verdict)} · ${claim.note}`)); details.append(row);
        }
        const record = this.payload!.record;
        details.append(el('h4', this.t('位置关联与问题历史', 'Link and issue history')), el('p', `${this.t('已保留 / 已移除：', 'Retained / dropped: ')}${record?.history.length || 0} / ${record?.historyDropped || 0}`));
        for (const event of record?.history || []) {
            const row = el('details'); row.append(el('summary', `r${event.revision} · ${event.at} · ${event.reviewer} · ${event.action} · ${event.targetId}`));
            if (event.before) row.append(el('strong', this.t('此前', 'Before')), el('pre', JSON.stringify(event.before, null, 2)));
            row.append(el('strong', this.t('此次', 'After')), el('pre', JSON.stringify(event.after, null, 2))); details.append(row);
        }
        return details;
    }
    private async loadOverview(identity: Identity): Promise<void> {
        const version = ++this.overviewVersion;
        try {
            const overview = await this.json<LeanAuditOverview>('/api/lean-audit/overview', identity);
            if (!this.matches(identity) || version !== this.overviewVersion || !this.showOverview) return;
            if (overview.projectToken !== identity.projectId) throw new Error(this.t('总览不属于当前项目。', 'Overview belongs to another project.'));
            this.overview = overview; this.render();
        } catch (error) { if (this.matches(identity) && version === this.overviewVersion) this.host.report(String(error), true); }
    }
    private renderOverview(): HTMLElement {
        const section = el('section', '', 'reader-lean-audit-overview'); section.append(el('h4', this.t('全项目审阅总览', 'Whole project review overview')));
        if (!this.overview) { section.append(el('p', this.t('正在读取总览…', 'Loading overview…'))); return section; }
        const counts = this.overview.counts;
        section.append(el('p', this.t(`对象 ${counts.total} · 未审阅 ${counts.pending} · 人工结论待复核 ${counts.stale} · 未解决 / 待复核问题 ${counts.unresolvedIssues}`, `Objects ${counts.total} · unreviewed ${counts.pending} · stale human reviews ${counts.stale} · unresolved/stale issues ${counts.unresolvedIssues}`)),
            this.select(this.t('筛选对象', 'Filter objects'), ['all', 'pending', 'stale', 'unresolved'], this.overviewFilter, 'overview-filter', value => this.t(({ all: '全部', pending: '未审阅', stale: '待复核', unresolved: '未解决问题' })[value], value), value => { this.overviewFilter = value; this.render(); }));
        const list = el('ul');
        for (const item of this.overview.items.filter(item => this.overviewFilter === 'all' || (this.overviewFilter === 'pending' ? item.reviewFreshness === 'unreviewed'
            : this.overviewFilter === 'stale' ? item.reviewFreshness === 'stale' || item.staleLinks > 0 || item.staleIssues > 0 : item.unresolvedIssues > 0))) {
            const row = el('li'); row.append(action(`${item.display} ${item.title} · ${item.filePath}:${item.line} · ${item.reviewFreshness} · ${this.t('问题', 'issues')} ${item.unresolvedIssues}`, 'open-object', () => { void this.host.openReview(item.id); })); list.append(row);
        }
        section.append(list);
        if (this.overview.orphaned.length) section.append(el('p', this.t('已有记录但对象已不在当前队列：', 'Records outside the current object queue: ') + this.overview.orphaned.map(item => item.id).join(', '), 'reader-lean-audit-warning'));
        return section;
    }
    private async exportReport(): Promise<void> {
        const identity = this.active; if (!identity || !this.matches(identity)) return;
        try {
            const report = await this.json<LeanAuditReport>('/api/lean-audit/report', identity);
            if (!this.matches(identity)) return;
            if (report.projectToken !== identity.projectId || report.format !== 'markdown') throw new Error(this.t('报告不属于当前项目。', 'Report belongs to another project.'));
            const name = 'lean-human-review-' + report.generatedAt.slice(0, 10) + '.md';
            if (this.host.download) this.host.download(name, report.content);
            else {
                const url = URL.createObjectURL(new Blob([report.content], { type: 'text/markdown;charset=utf-8' }));
                const link = el('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            this.host.report(this.t('当前项目审阅报告已导出。', 'Current project review report exported.'));
        } catch (error) { if (this.matches(identity)) this.host.report(String(error), true); }
    }
    private async assist(): Promise<void> {
        const identity = this.active, payload = this.payload; if (!identity || !payload || !this.matches(identity)) return;
        const text = leanAuditAssistance(payload, this.host.context().language);
        try {
            if (this.host.canAssist?.() && this.host.assist) {
                await this.host.assist([{ type: 'resource', resource: { uri: `math-workspace://lean-audit/${encodeURIComponent(identity.id)}?revision=${payload.expectedRevision}`, mimeType: 'text/markdown', text } }]);
                if (this.matches(identity)) this.host.report(this.t('审阅材料已加入会话输入框，尚未发送。', 'Audit material added to conversation input; it has not been sent.'));
            } else {
                const copied = await copyReaderText(text); if (this.matches(identity)) this.host.report(this.t(copied ? '审阅材料已复制。' : '复制失败。', copied ? 'Audit material copied.' : 'Copy failed.'), !copied);
            }
        } catch (error) { if (this.matches(identity)) this.host.report(String(error), true); }
    }
}
