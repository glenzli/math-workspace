import type { LeanReviewResponse } from '../../lean/lean-review';
import { sameLeanAssistanceSource, type LeanAssistanceBinding, type LeanAssistanceCandidate, type LeanAssistanceResponse, type LeanAssistanceTask } from '../../lean/lean-assistance';
import { copyReaderText } from './reader-clipboard';
import './reader-lean-assistance.css';

export interface ReaderLeanAssistanceHost {
    context(): { projectId: string | null; requestToken?: string; token?: string; language: string; pagePath?: string; revision?: number };
    request(path: string, init?: RequestInit): Promise<Response>;
    report(message: string, warning?: boolean): void;
    canAssist?(): boolean;
    /** Native composer handoff only; integration must retain send:false. */
    assist?(content: any[]): Promise<unknown>;
    /** Add an undecided local draft only. Return false if the displayed review identity has changed. */
    adoptCandidate(item: LeanAssistanceCandidate, binding: LeanAssistanceBinding): boolean;
    candidateInDraft(candidateId: string): boolean;
}
const tasks: LeanAssistanceTask[] = ['assumptions', 'statement', 'proof', 'changes'];
const taskZh = { assumptions: '查假设与符号', statement: '比对陈述', proof: '检查证明范围', changes: '复核变化' };
const taskEn = { assumptions: 'Check assumptions', statement: 'Compare statements', proof: 'Inspect proof scope', changes: 'Recheck changes' };
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
}
function button(label: string, action: string, run: () => void): HTMLButtonElement {
    const node = element('button', label); node.type = 'button'; node.dataset.leanAssistanceAction = action; node.addEventListener('click', run); return node;
}
/** Exact project selection and binding survive fallback copy and native composer handoff. */
export function leanAssistanceHandoff(payload: LeanAssistanceResponse, language: string): string {
    const instruction = language === 'zh'
        ? `请${taskZh[payload.task]}。先用 read_lean_review_context 读取下列工程和对象的当前材料，再逐项给出有依据的差异或待查项；用 submit_lean_review_candidates 把候选返回 Reader。不得直接写人工结论。`
        : `Please ${taskEn[payload.task].toLowerCase()}. First call read_lean_review_context for the exact project and object below; return grounded differences or open questions through submit_lean_review_candidates. Do not write human decisions.`;
    return instruction + '\n\n' + JSON.stringify({ projectRoot: payload.projectRoot, projectToken: payload.binding.projectToken,
        id: payload.binding.id, task: payload.task, formal: payload.formal, binding: payload.binding, boundary: payload.boundary,
        evidenceState: payload.evidenceState }, null, 2);
}

/** Owns candidate projection, manual task handoff, and all late-response rejection. */
export class ReaderLeanAssistance {
    private readonly section = element('section', '', 'reader-lean-assistance');
    private response?: LeanReviewResponse;
    private payload?: LeanAssistanceResponse;
    private stamp = '';
    private task: LeanAssistanceTask = 'statement';
    private generation = 0;
    private busy = false;
    private error = '';
    private workspaceRevision?: number;
    constructor(private readonly host: ReaderLeanAssistanceHost) { this.section.hidden = true; }
    mount(): HTMLElement { return this.section; }
    private t(zh: string, en: string): string { return this.host.context().language === 'zh' ? zh : en; }
    private identity(response: LeanReviewResponse): string {
        return [response.projectToken, response.id, response.evidence.fingerprint, response.review.expectedRevision, this.host.context().pagePath || ''].join(':');
    }
    private matches(stamp: string, generation: number): boolean {
        return !this.section.hidden && this.stamp === stamp && this.generation === generation
            && this.response?.projectToken === this.host.context().projectId && this.identity(this.response) === stamp;
    }
    update(response: LeanReviewResponse): void {
        if (response.projectToken !== this.host.context().projectId) { this.hide(); return; }
        const next = this.identity(response), context = this.host.context(), changed = next !== this.stamp || this.workspaceRevision !== context.revision;
        this.response = response; this.stamp = next; this.workspaceRevision = context.revision; this.section.hidden = false;
        if (changed) { this.payload = undefined; this.error = ''; this.busy = false; void this.load(); }
        else this.render();
    }
    metadataChanged(): void {
        if (this.response && !this.section.hidden) {
            this.workspaceRevision = this.host.context().revision;
            void this.load();
        }
    }
    acknowledgeAssistanceRevision(): void {
        const revision = this.host.context().revision;
        if (revision !== undefined && this.workspaceRevision === revision - 1) this.workspaceRevision = revision;
    }
    hide(): void { this.generation++; this.section.hidden = true; this.response = undefined; this.payload = undefined; this.stamp = ''; this.busy = false; }
    destroy(): void { this.hide(); this.section.remove(); }
    private async json(body?: unknown): Promise<LeanAssistanceResponse> {
        const response = this.response!, context = this.host.context();
        const route = body === undefined ? `/api/lean-assistance?id=${encodeURIComponent(response.id)}&task=${this.task}` : '/api/lean-assistance/action';
        const result = await this.host.request(route, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
            headers: { 'content-type': 'application/json', 'x-math-workspace-token': context.requestToken || context.token || '', 'x-math-workspace-project': response.projectToken } });
        if (!result.ok) throw new Error(await result.text() || `HTTP ${result.status}`);
        return result.json();
    }
    private valid(payload: LeanAssistanceResponse): boolean {
        const response = this.response;
        return !!response && payload.binding.projectToken === response.projectToken && payload.binding.id === response.id
            && payload.binding.evidenceFingerprint === response.evidence.fingerprint && payload.binding.reviewRevision === response.review.expectedRevision;
    }
    private async load(): Promise<void> {
        if (!this.response) return;
        const stamp = this.stamp, generation = ++this.generation; this.busy = true; this.render();
        try {
            const payload = await this.json(); if (!this.matches(stamp, generation)) return;
            if (!this.valid(payload)) throw new Error(this.t('源码或人工记录已变化，请重新读取对象。', 'Source or human review changed. Reload this object.'));
            this.payload = payload; this.error = '';
        } catch (error) { if (this.matches(stamp, generation)) { this.payload = undefined; this.error = String(error); } }
        finally { if (this.matches(stamp, generation)) { this.busy = false; this.render(); } }
    }
    private async assist(task: LeanAssistanceTask): Promise<void> {
        if (this.busy || !this.response) return; this.task = task;
        const stamp = this.stamp, generation = ++this.generation; this.busy = true; this.render();
        try {
            const payload = await this.json(); if (!this.matches(stamp, generation)) return;
            if (!this.valid(payload)) throw new Error(this.t('材料已变化，请先重新读取对象。', 'Context changed. Reload this object first.'));
            this.payload = payload;
            const text = leanAssistanceHandoff(payload, this.host.context().language);
            if (this.host.canAssist?.() && this.host.assist) {
                await this.host.assist([{ type: 'resource', resource: { uri: `math-workspace://lean-assistance/${payload.binding.projectToken}/${payload.binding.id}?task=${task}&revision=${payload.binding.candidateRevision}`, mimeType: 'text/plain', text } }]);
                if (this.matches(stamp, generation)) this.host.report(this.t('材料已加入会话输入框，尚未发送。', 'Review context added to the conversation input; it has not been sent.'));
            } else {
                const copied = await copyReaderText(text);
                if (this.matches(stamp, generation)) this.host.report(this.t(copied ? '材料已复制，可粘贴到 Codex 会话。' : '复制失败。', copied ? 'Context copied for the Codex conversation.' : 'Copy failed.'), !copied);
            }
        } catch (error) { if (this.matches(stamp, generation)) { this.error = String(error); this.host.report(this.error, true); } }
        finally { if (this.matches(stamp, generation)) { this.busy = false; this.render(); } }
    }
    private async act(candidateId: string, kind: 'adopt' | 'dismiss'): Promise<void> {
        if (this.busy || !this.payload) return;
        const stamp = this.stamp, generation = ++this.generation, previous = this.payload; this.busy = true; this.render();
        try {
            // Re-read the persisted source and all revisions immediately before a human draft action.
            const current = await this.json(); if (!this.matches(stamp, generation)) return;
            if (!this.valid(current) || !sameLeanAssistanceSource(previous.binding, current.binding) || previous.binding.candidateRevision !== current.binding.candidateRevision) throw new Error(this.t('材料或审阅版本已变化，请刷新候选。', 'Context or review revisions changed. Refresh candidates.'));
            const value = current.candidates.find(item => item.candidate.id === candidateId);
            if (!value || value.candidate.status !== 'pending') throw new Error(this.t('候选已在其他窗口处理。', 'This candidate was already handled in another window.'));
            this.payload = current;
            if (kind === 'adopt') {
                if (value.freshness !== 'current') throw new Error(this.t('旧候选不能加入当前草稿，请重新核对。', 'A stale candidate cannot enter the current draft. Recheck it first.'));
                if (!this.host.adoptCandidate(value.candidate, current.binding)) throw new Error(this.t('当前草稿已变化，候选未写入。', 'The current draft changed; the candidate was not added.'));
                this.host.report(this.t('已加入未决定草稿。核对后再保存人工结论。', 'Added to an undecided draft. Review it before saving a human decision.'));
            } else {
                const saved = await this.json({ action: 'dismiss', binding: current.binding, candidateId, task: this.task });
                if (!this.matches(stamp, generation)) return;
                if (!this.valid(saved)) throw new Error(this.t('保存响应已过期，请刷新。', 'The save response is stale. Refresh.'));
                this.payload = saved;
            }
            this.error = '';
        } catch (error) { if (this.matches(stamp, generation)) { this.error = String(error); this.host.report(this.error, true); } }
        finally { if (this.matches(stamp, generation)) { this.busy = false; this.render(); } }
    }
    private render(): void {
        this.section.replaceChildren();
        this.section.append(element('h3', this.t('Codex 辅助核对', 'Review with Codex')),
            element('p', this.t('选一个任务准备材料；发送由会话输入框确认。返回的候选逐项加入未决定草稿或忽略。', 'Prepare context for a task, then confirm sending in the conversation composer. Add returned candidates to an undecided draft or ignore them.'), 'reader-lean-assistance-hint'));
        const actions = element('div', '', 'reader-lean-assistance-actions');
        for (const task of tasks) { const action = button(this.t(taskZh[task], taskEn[task]), task, () => { void this.assist(task); }); action.disabled = this.busy; actions.append(action); }
        const reload = button(this.t('刷新候选', 'Refresh candidates'), 'refresh', () => { void this.load(); }); reload.disabled = this.busy; actions.append(reload); this.section.append(actions);
        if (this.error) { const warning = element('p', this.error, 'reader-lean-assistance-warning'); warning.setAttribute('role', 'alert'); this.section.append(warning); }
        if (!this.payload) { this.section.append(element('p', this.t(this.busy ? '正在读取材料…' : '材料暂不可用。', this.busy ? 'Reading context…' : 'Context unavailable.'))); return; }
        const candidates = this.payload.candidates.filter(item => item.candidate.status === 'pending');
        if (!candidates.length) this.section.append(element('p', this.t('暂无待处理候选。', 'No pending AI candidates.')));
        for (const { candidate, freshness } of candidates) {
            const card = element('article', '', 'reader-lean-assistance-candidate'); card.dataset.leanAssistanceCandidate = candidate.id;
            card.append(element('strong', candidate.title), element('p', candidate.note), element('p', candidate.declarationKeys.join(' · '), 'reader-lean-assistance-hint'));
            if (freshness === 'stale') card.append(element('p', this.t('材料或人工版本已变化，需重新核对。', 'Source or human revisions changed; recheck this candidate.'), 'reader-lean-assistance-warning'));
            const actions = element('div', '', 'reader-lean-assistance-actions'), added = this.host.candidateInDraft(candidate.id);
            const adopt = button(this.t(added ? '已加入草稿' : '加入未决定草稿', added ? 'Added to draft' : 'Add to undecided draft'), 'adopt', () => { void this.act(candidate.id, 'adopt'); });
            adopt.disabled = this.busy || freshness === 'stale' || added;
            const dismiss = button(this.t('忽略', 'Ignore'), 'dismiss', () => { void this.act(candidate.id, 'dismiss'); }); dismiss.disabled = this.busy;
            actions.append(adopt, dismiss); card.append(actions); this.section.append(card);
        }
        if (this.payload.dropped) this.section.append(element('p', this.t(`有界保留已移除 ${this.payload.dropped} 项旧候选。`, `${this.payload.dropped} older candidates were dropped by bounded retention.`), 'reader-lean-assistance-hint'));
    }
}
