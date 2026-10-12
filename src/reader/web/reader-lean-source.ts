import type { LeanDefinitionLocation, LeanPosition, LeanRange, LeanSourceFile } from '../../lean/lean-language';
import type { SourceSnippet } from '../../lean/lean-review';
import { copyReaderText } from './reader-clipboard';
import { ReaderLeanSemantic, leanHoverText, type LeanSemanticState } from './reader-lean-semantic';
import { leanRangeText, normalizeLeanSource } from './reader-lean-source-model';
import { LeanSourceEditor } from './reader-lean-source-editor';
import { tokenizeLeanSource, tokenizeLeanSourceAsync } from './reader-lean-source-highlighter';

export interface LeanSourceTarget {
    projectKey: string;
    filePath: string;
    range?: LeanRange;
    sourceHash?: string;
    sourceUri?: string;
    title?: string;
    fallback?: SourceSnippet;
}
export interface ReaderLeanSourceHost {
    context(): { projectId: string; token: string; language: 'zh' | 'en'; revision: number };
    request(route: string, options?: RequestInit): Promise<Response>;
    report(message: string): void;
    closed?(): void;
    selectionChanged?(selection?: { projectKey: string; filePath: string; sourceHash: string; sourceUri: string; range: LeanRange }): void;
}
const labels = {
    zh: { title: '完整 Lean 源码', readonly: '只读', close: '收起源码', back: '返回上一处源码', loading: '正在读取完整文件…',
        unavailable: '完整文件暂不可用；以下保留已记录片段。', failed: '完整文件未能读取。', reload: '重新读取文件',
        snapshot: '审阅材料中的源码片段', current: '当前完整文件', changed: '此链接的源码已变化；请重新选择范围。',
        rangeUnverified: '记录片段不完整或仅用于上下文；请在当前源码中选择核对范围。',
        find: '查找', fold: '折叠', unfold: '展开', focus: '定位关联范围', copy: '复制完整文件', copyRange: '复制选中范围',
        copied: 'Lean 源码已复制', copyFailed: '复制未完成，可选中源码手动复制。', select: '在源码中选择位置以查看证明目标；按 F12 或 ⌘/Ctrl 点击跳转定义。',
        semantics: '实时 Lean 语义', start: '启动 Lean 语义', refresh: '更新语义', stop: '停止语义', opening: '正在启动已有 Lean 工具链…',
        idle: '尚未启动语义；源码可以直接阅读。', available: '语义已连接', processing: 'Lean 正在处理文件…', semanticUnavailable: 'Lean 语义不可用；完整源码仍可阅读。',
        semanticHint: '使用本地 Lean 语言服务。实时光标信息不改变已保存的审阅证据或结论。',
        position: '当前位置', goals: '证明目标', noGoals: '当前位置没有开放的战术证明目标。', unreadGoals: '等待当前位置的 Lean 结果…',
        termGoal: '期望类型', hover: '类型与定义说明', noHover: '当前位置没有类型提示。', definition: '跳转当前位置的定义', noDefinition: '当前位置没有可定位的定义。',
        diagnostics: '文件诊断', noDiagnostics: '本次语义快照没有诊断。', definitions: '选择定义来源',
        origin: { project: '项目源码', dependency: '依赖源码', toolchain: '工具链源码' }, lines: '行', fingerprint: '源码指纹' },
    en: { title: 'Complete Lean source', readonly: 'Read only', close: 'Collapse source', back: 'Back to previous source', loading: 'Reading the complete file…',
        unavailable: 'The complete file is unavailable. The recorded excerpt remains below.', failed: 'Could not read the complete file.', reload: 'Read file again',
        snapshot: 'Source excerpt in review material', current: 'Current complete file', changed: 'Source changed since this link. Select the range again.',
        rangeUnverified: 'The recorded excerpt is incomplete or context only. Select a comparison range in the current source.',
        find: 'Find', fold: 'Fold', unfold: 'Unfold', focus: 'Focus linked range', copy: 'Copy complete file', copyRange: 'Copy selected range',
        copied: 'Lean source copied', copyFailed: 'Copy did not complete. Select source and copy it manually.', select: 'Select a source position to inspect proof goals. Use F12 or ⌘/Ctrl click to follow its definition.',
        semantics: 'Live Lean semantics', start: 'Start Lean semantics', refresh: 'Refresh semantics', stop: 'Stop semantics', opening: 'Starting the existing Lean toolchain…',
        idle: 'Semantics have not been started. Source is readable.', available: 'Semantics connected', processing: 'Lean is processing the file…', semanticUnavailable: 'Lean semantics unavailable. Complete source remains readable.',
        semanticHint: 'Uses the local Lean language server. Live cursor information does not change saved review evidence or judgments.',
        position: 'Current position', goals: 'Proof goals', noGoals: 'No open tactic proof goals at this position.', unreadGoals: 'Waiting for Lean at this position…',
        termGoal: 'Expected type', hover: 'Type and definition information', noHover: 'No type information at this position.', definition: 'Go to definition at this position', noDefinition: 'No source definition was found at this position.',
        diagnostics: 'File diagnostics', noDiagnostics: 'No diagnostics in this semantic snapshot.', definitions: 'Choose definition source',
        origin: { project: 'Project source', dependency: 'Dependency source', toolchain: 'Toolchain source' }, lines: 'lines', fingerprint: 'Source fingerprint' }
};
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const value = document.createElement(tag); value.textContent = text; if (className) value.className = className; return value;
}
function control(text: string, action: () => void, key: string): HTMLButtonElement {
    const value = node('button', text, 'reader-lean-review-button'); value.type = 'button'; value.dataset.leanSourceAction = key; value.addEventListener('click', action); return value;
}

/** Persisted review evidence is displayed by the review owner; this owner reads current complete files. */
export class ReaderLeanSource {
    private readonly root = node('section', '', 'reader-lean-source');
    private readonly header = node('header', '', 'reader-lean-source-header');
    private readonly status = node('p', '', 'reader-lean-source-status');
    private readonly toolbar = node('div', '', 'reader-lean-source-toolbar');
    private readonly content = node('div', '', 'reader-lean-source-content');
    private readonly live = node('section', '', 'reader-lean-source-semantic');
    private readonly semantic: ReaderLeanSemantic;
    private source?: LeanSourceFile;
    private target?: LeanSourceTarget;
    private history: LeanSourceTarget[] = [];
    private editor?: LeanSourceEditor;
    private range?: LeanRange;
    private linkedRange?: LeanRange;
    private generation = 0;
    private request = 0;
    private objectKey = '';
    private projectId = '';
    private position?: LeanPosition;
    private loading = false;
    private message = '';
    private lastRevision = -1;
    private sourceRevision = -1;
    private sourceAbort?: AbortController;
    private navigationRequest = 0;
    private semanticEnabled = false;

    constructor(private readonly host: ReaderLeanSourceHost) {
        this.root.hidden = true; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
        this.root.append(this.header, this.status, this.toolbar, this.content, this.live);
        this.semantic = new ReaderLeanSemantic(host, state => { this.editor?.setSemantics(state.tokens, state.diagnostics); this.renderSemantic(state); this.renderChrome(); });
    }
    mount(): HTMLElement { return this.root; }
    bindObject(formalId: string): void {
        const key = this.host.context().projectId + '\0' + formalId;
        if (key !== this.objectKey) { this.close(); this.objectKey = key; }
        this.projectId = this.host.context().projectId;
        if (!this.root.hidden) { this.renderChrome(); this.editor?.refreshLayout(); }
    }
    contextChanged(assistanceOnly = false): void {
        if (this.root.hidden) return;
        if (this.projectId !== this.host.context().projectId || (this.source && this.source.projectToken !== this.host.context().projectId)) { this.close(); return; }
        const revision = this.host.context().revision;
        if (assistanceOnly) {
            // A contiguous candidate-only event changes no source. Do not promote an already
            // stale/in-flight source read to current, or interrupt its Lean session.
            if (this.source && !this.loading && this.sourceRevision === this.lastRevision) this.sourceRevision = revision;
            this.lastRevision = revision;
            return;
        }
        if (revision !== this.lastRevision && this.target) { this.lastRevision = revision; void this.open(this.target, false, true); }
        else { this.editor?.setLanguage(this.host.context().language, this.words().title + ' · ' + this.words().readonly); this.renderChrome(); this.renderSemantic(this.semantic.state); }
    }
    currentSelection(): { projectKey: string; filePath: string; sourceHash: string; sourceUri: string; range: LeanRange } | undefined {
        const source = this.source; return source && this.range && !this.root.hidden ? {
            projectKey: source.projectKey, filePath: source.filePath, sourceHash: source.sourceHash, sourceUri: source.sourceUri, range: this.range } : undefined;
    }

    async open(target: LeanSourceTarget, pushHistory = true, passive = false, options: { force?: boolean; reveal?: boolean } = {}): Promise<void> {
        const context = this.host.context(), generation = this.generation, request = ++this.request;
        this.sourceAbort?.abort(); const abort = new AbortController(); this.sourceAbort = abort;
        const same = this.source?.projectToken === context.projectId && this.source.projectKey === target.projectKey && this.source.filePath === target.filePath;
        const previousHash = same ? this.source?.sourceHash : undefined;
        if (pushHistory && this.target && (!same || JSON.stringify(this.target.range) !== JSON.stringify(target.range))) this.history.push({ ...this.target, range: this.range });
        const reusable = same && this.editor && !this.loading && !this.message && this.sourceRevision === context.revision && !passive && !options.force
            && (!target.sourceHash || target.sourceHash === this.source?.sourceHash);
        this.target = target; this.loading = true; this.message = ''; this.root.hidden = false; this.lastRevision = context.revision;
        if (!passive) this.linkedRange = target.range;
        if (reusable) {
            this.loading = false;
            this.validateLinkedRange(this.source!, target);
            if (this.linkedRange && !this.message) this.editor!.focusRange(this.linkedRange);
            this.editor!.refreshLayout(); this.renderChrome(); this.renderSemantic(this.semantic.state);
            if (options.reveal !== false) this.root.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            return;
        }
        if (!same) { this.semantic.setSource(undefined); this.editor?.destroy(); this.editor = undefined; this.source = undefined; this.range = undefined; this.position = undefined; this.showFallback(target.fallback); }
        this.renderChrome();
        const current = () => generation === this.generation && request === this.request && this.target === target && this.host.context().projectId === context.projectId;
        try {
            const response = await this.host.request(`/api/lean-language/source?projectKey=${encodeURIComponent(target.projectKey)}&filePath=${encodeURIComponent(target.filePath)}`, {
                cache: 'no-store', signal: abort.signal, headers: { 'x-math-workspace-token': context.token, 'x-math-workspace-project': context.projectId } });
            if (!current()) return;
            if (!response.ok) throw new Error(await response.text());
            const source = await response.json() as LeanSourceFile; if (!current()) return;
            if (source.projectToken !== context.projectId || source.projectKey !== target.projectKey || source.filePath !== target.filePath || source.readonly !== true
                || typeof source.content !== 'string' || !source.sourceHash || !source.sourceUri) throw new Error('Source response does not match the requested file.');
            const changed = this.source?.sourceHash !== source.sourceHash;
            this.source = source; this.sourceRevision = context.revision; this.semantic.setSource(source); this.loading = false;
            if ((previousHash && previousHash !== source.sourceHash) || (target.sourceHash && target.sourceHash !== source.sourceHash)) {
                this.message = this.words().changed; this.range = undefined; this.linkedRange = undefined; this.position = undefined;
                this.host.selectionChanged?.(undefined);
            }
            if (!passive && !this.message) this.validateLinkedRange(source, target);
            if (changed || !this.editor) await this.installEditor(source, current);
            if (!current()) return;
            if (!passive && !this.message && this.linkedRange) this.editor?.focusRange(this.linkedRange);
            this.renderChrome(); this.renderSemantic(this.semantic.state);
            if (!passive && options.reveal !== false) this.root.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            if (this.semanticEnabled && this.semantic.state.state === 'idle') {
                if (this.position) this.semantic.select(this.position);
                void this.semantic.open();
            }
        } catch (error) {
            if (!current() || abort.signal.aborted) return;
            this.loading = false; this.message = this.words().failed + ' ' + (error instanceof Error ? error.message : String(error));
            if (!this.source) this.showFallback(target.fallback);
            this.renderChrome();
        }
    }

    private validateLinkedRange(source: LeanSourceFile, target: LeanSourceTarget): void {
        const excerpt = target.fallback;
        if (!excerpt || !target.range) return;
        const current = normalizeLeanSource(source.content).split('\n').slice(excerpt.startLine - 1, excerpt.endLine).join('\n').replace(/\n+$/, '');
        if (excerpt.truncated || excerpt.rangeKind === 'context') this.message = this.words().rangeUnverified;
        else if (current !== normalizeLeanSource(excerpt.content).replace(/\n+$/, '')) this.message = this.words().changed;
        if (this.message) { this.editor?.clearFocusRange(); this.range = undefined; this.linkedRange = undefined; this.position = undefined; this.host.selectionChanged?.(undefined); }
    }

    private async installEditor(source: LeanSourceFile, current: () => boolean): Promise<void> {
        // Keep the complete text available even if the display surface fails to initialize.
        this.content.replaceChildren(node('pre', source.content, 'reader-lean-source-fallback'));
        await Promise.resolve(); if (!current()) return;
        this.editor?.destroy(); this.content.replaceChildren();
        const identity = { sourceHash: source.sourceHash, sourceUri: source.sourceUri, projectToken: source.projectToken };
        const valid = () => this.source?.sourceHash === identity.sourceHash && this.source.sourceUri === identity.sourceUri
            && this.source.projectToken === identity.projectToken && this.host.context().projectId === identity.projectToken && !this.root.hidden;
        this.editor = new LeanSourceEditor(this.content, source.content, {
            positionChanged: (position, range) => { if (!valid()) return; this.range = range; this.position = position; this.semantic.select(position); const selection = this.currentSelection(); if (selection) this.host.selectionChanged?.(selection); },
            hoverAt: position => valid() ? this.semantic.hoverAt(position) : Promise.resolve(undefined),
            definitionAt: position => { if (valid()) void this.followDefinition(position); }
        }, this.words().title + ' · ' + this.words().readonly, this.host.context().language);
        const editor = this.editor;
        void tokenizeLeanSourceAsync(source.content, () => !valid() || editor !== this.editor).then(spans => {
            if (valid() && editor === this.editor) editor.setSyntax(spans);
        }).catch(error => { if (valid()) { this.message = String(error); this.renderChrome(); } });
    }

    private showFallback(source?: SourceSnippet): void {
        const w = this.words(); this.content.replaceChildren();
        if (source) this.content.append(node('p', w.snapshot + ` · ${source.filePath}:${source.startLine}–${source.endLine}`), leanSourceSnapshot(source.content, source.startLine));
    }
    private words() { return labels[this.host.context().language]; }
    private renderChrome(): void {
        if (this.root.hidden) return;
        const w = this.words(), title = node('div'); title.append(node('h3', w.title), node('p', `${this.target?.title || this.target?.filePath || ''} · ${w.readonly}`, 'reader-lean-review-location'));
        const controls = node('div', '', 'reader-lean-review-actions');
        if (this.history.length) controls.append(control(w.back, () => { const previous = this.history.pop(); if (previous) void this.open(previous, false); }, 'back'));
        controls.append(control(w.close, () => { this.close(); this.host.closed?.(); }, 'close')); this.header.replaceChildren(title, controls);
        this.status.textContent = this.loading ? w.loading : this.message || (this.source ? `${w.current} · ${w.origin[this.source.origin]} · ${this.source.lineCount} ${w.lines}` : w.unavailable);
        this.status.classList.toggle('is-warning', Boolean(this.message || (!this.loading && !this.source)));
        this.toolbar.replaceChildren();
        if (this.source) {
            const source = this.source;
            for (const [label, key, action] of [
                [w.find, 'find', () => this.editor?.find()], [w.fold, 'fold', () => this.editor?.fold()], [w.unfold, 'unfold', () => this.editor?.unfold()],
                [w.focus, 'focus', () => { if (this.linkedRange && !this.message) this.editor?.focusRange(this.linkedRange); }],
                [w.copy, 'copy', () => { void this.copy(source.content); }],
                [w.copyRange, 'copy-range', () => { if (this.range) void this.copy(leanRangeText(source.content, this.range)); }]
            ] as const) this.toolbar.append(control(label, action, key));
            const metadata = node('details', '', 'reader-lean-source-metadata'); metadata.append(node('summary', w.fingerprint), node('code', source.sourceHash)); this.toolbar.append(metadata);
        }
        const reload = control(w.reload, () => { if (this.target) void this.open(this.target, false, false, { force: true }); }, 'reload'); reload.disabled = this.loading; this.toolbar.append(reload);
    }
    private async copy(value: string): Promise<void> { this.host.report(await copyReaderText(value) ? this.words().copied : this.words().copyFailed); }

    private renderSemantic(state: LeanSemanticState): void {
        if (this.root.hidden) return;
        const w = this.words(), header = node('div', '', 'reader-lean-review-actions'); header.append(node('h4', w.semantics));
        const start = control(state.state === 'available' ? w.refresh : w.start, () => {
            this.semanticEnabled = true;
            if (state.state !== 'available' && this.position) this.semantic.select(this.position);
            void this.semantic.open();
        }, 'semantics');
        start.disabled = !this.source || state.state === 'opening'; header.append(start);
        if (state.state === 'available' || state.state === 'opening') header.append(control(w.stop, () => { this.semanticEnabled = false; this.semantic.close(); }, 'stop-semantics'));
        const status = node('p', state.state === 'opening' ? w.opening : state.state === 'available' ? (state.complete ? w.available : w.processing) : state.state === 'unavailable' ? w.semanticUnavailable : w.idle);
        status.setAttribute('role', 'status');
        this.live.replaceChildren(header, status, node('p', w.semanticHint, 'reader-lean-review-hint'));
        if (state.reason) this.live.append(node('p', state.reason, 'reader-lean-review-warning'));
        if (state.state !== 'available') return;
        this.live.append(node('p', w.select, 'reader-lean-review-hint'));
        if (state.position) {
            const position = node('p', `${w.position} ${state.position.line + 1}:${state.position.character + 1}`, 'reader-lean-review-location'); position.dataset.leanSourcePosition = `${state.position.line}:${state.position.character}`;
            this.live.append(position, control(w.definition, () => { void this.followDefinition(); }, 'definition'));
            const columns = node('div', '', 'reader-lean-source-semantic-columns'), goals = node('section'), hover = node('details'); hover.open = true;
            goals.append(node('h4', w.goals));
            const goalText = state.goals?.join('\n\n') || (state.renderedGoals ? readableLeanMarkdown(state.renderedGoals) : undefined);
            const pre = node('pre', goalText || (state.goals === undefined ? w.unreadGoals : w.noGoals), 'reader-lean-source-goals'); pre.dataset.leanSourceGoals = 'true'; goals.append(pre);
            if (state.termGoal) goals.append(node('h4', w.termGoal), node('pre', readableLeanMarkdown(state.termGoal)));
            hover.append(node('summary', w.hover), state.hover ? node('pre', readableLeanMarkdown(leanHoverText(state.hover.contents))) : node('p', state.hover === undefined ? w.unreadGoals : w.noHover));
            columns.append(goals, hover); this.live.append(columns);
        }
        const diagnostics = node('details'); diagnostics.append(node('summary', `${w.diagnostics} · ${state.diagnostics.length}`));
        if (!state.diagnostics.length) diagnostics.append(node('p', state.complete ? w.noDiagnostics : w.processing));
        const list = node('ul', '', 'reader-lean-source-diagnostics');
        for (const diagnostic of state.diagnostics) {
            const item = node('li'), locate = control(`${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} · ${diagnostic.message}`, () => this.editor?.focusPosition(diagnostic.range.start), 'diagnostic');
            locate.classList.add(diagnostic.severity === 1 ? 'is-error' : 'is-warning'); item.append(locate); list.append(item);
        }
        diagnostics.append(list); this.live.append(diagnostics);
    }

    private async followDefinition(position = this.semantic.state.position): Promise<void> {
        if (!position) return;
        const request = ++this.navigationRequest, generation = this.generation, source = this.source;
        const locations = await this.semantic.definitions(position);
        if (request !== this.navigationRequest || generation !== this.generation || source !== this.source || this.root.hidden) return;
        if (!locations?.length) { this.host.report(this.words().noDefinition); return; }
        if (locations.length === 1) { await this.openDefinition(locations[0]); return; }
        const choices = node('section', '', 'reader-lean-source-definition-choices'); choices.append(node('h4', this.words().definitions));
        locations.forEach(location => choices.append(control(`${location.filePath}:${location.range.start.line + 1}`, () => { void this.openDefinition(location); }, 'definition-target')));
        this.live.append(choices);
    }
    private openDefinition(location: LeanDefinitionLocation): Promise<void> { return this.open({ ...location, range: location.selectionRange || location.range }); }

    close(): void {
        this.generation++; this.request++; this.navigationRequest++; this.sourceAbort?.abort(); this.sourceAbort = undefined;
        this.semanticEnabled = false;
        this.semantic.setSource(undefined); this.editor?.destroy(); this.editor = undefined; this.source = undefined; this.target = undefined; this.range = undefined; this.linkedRange = undefined; this.position = undefined;
        this.history = []; this.root.hidden = true; this.content.replaceChildren(); this.live.replaceChildren();
    }
    dispose(): void { this.close(); this.semantic.dispose(); this.root.remove(); }
}

/** A recorded excerpt remains text-readable immediately, before optional grammar coloring resolves. */
export function leanSourceSnapshot(content: string, startLine = 1): HTMLElement {
    const pre = node('pre', '', 'reader-lean-source-snapshot'), code = node('code'), text = normalizeLeanSource(content);
    const lines = text.split('\n');
    lines.forEach((line, index) => { const row = node('span', '', 'lean-source-snapshot-line'); const number = node('span', String(startLine + index), 'lean-source-snapshot-number'); number.setAttribute('aria-hidden', 'true'); row.append(number, node('span', line || ' ', 'lean-source-snapshot-text')); code.append(row); });
    pre.append(code);
    void Promise.resolve().then(() => {
        const spans = tokenizeLeanSource(text); let offset = 0;
        code.querySelectorAll<HTMLElement>('.lean-source-snapshot-text').forEach((line, index) => {
            const length = lines[index].length, tokens = spans.filter(span => span.from >= offset && span.from < offset + length);
            line.replaceChildren(); tokens.forEach(token => line.append(node('span', text.slice(token.from, token.to), token.className)));
            if (!tokens.length) line.textContent = lines[index] || ' '; offset += length + 1;
        });
    }).catch(() => undefined);
    return pre;
}

/** Lean's Markdown RPC fallback uses fences around plain goals. Preserve text and omit only wrappers. */
function readableLeanMarkdown(value: string): string {
    return value.split('\n').filter(line => !/^\s*```(?:lean|lean4)?\s*$/.test(line) && !/^\s*---\s*$/.test(line)).join('\n').trim();
}
