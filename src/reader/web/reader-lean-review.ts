import type {
    DeclarationEvidence, LeanDefinitionResponse, LeanReviewEvidence, LeanReviewQueueItem, LeanReviewQueueResponse,
    LeanReviewResponse, LeanReviewSaveInput, ReviewChange, ReviewJob, ReviewRecord,
    ReviewSubclaim, ReviewVerdict, SourceSnippet
} from '../../lean/lean-review';
import type { ReaderReferenceContent } from './reader-references';
import { copyReaderText } from './reader-clipboard';
import { ReaderLeanSource, leanSourceSnapshot } from './reader-lean-source';
import { leanReviewDiffEntries, renderLeanSourceDiff } from './reader-lean-source-diff';
import { ReaderLeanAudit, type LeanAuditSelection } from './reader-lean-audit';

type Language = 'zh' | 'en';
interface ReviewContext { projectId: string; filePath: string; language: Language; token: string; revision: number }
export interface ReaderLeanReviewHost {
    context(): ReviewContext;
    request(route: string, options?: RequestInit): Promise<Response>;
    renderProse(source: SourceSnippet): string;
    mountProse?(container: HTMLElement): () => void;
    locate(source: SourceSnippet): void;
    navigatePage(filePath: string): Promise<void>;
    canAssist(): boolean;
    assist(content: ReaderReferenceContent[]): Promise<void>;
    report(message: string): void;
}
interface ReviewDraft extends LeanReviewSaveInput {
    projectToken: string;
    snapshot: LeanReviewEvidence;
    dirty: boolean;
    editVersion: number;
    acknowledgementRequired: boolean;
    needsReload: boolean;
}
interface RequestIdentity { generation: number; projectId: string; filePath: string; id: string }
const verdicts: ReviewVerdict[] = ['undecided', 'aligned', 'partial', 'difference'];
const copy = {
    zh: {
        title: 'Lean 对照', close: '关闭对照', loading: '正在读取对照材料…', retry: '重新读取',
        failed: '对照材料未能读取。', invalidResponse: '返回的对照材料与当前对象不一致。',
        prose: '正文与关联证明', statement: '陈述', proofs: '关联证明', contexts: '必要上下文',
        noProof: '未找到可定位的关联证明。', locate: '定位正文', raw: '查看 Markdown 原文',
        truncated: '此片段已截断；核对完整内容时请打开来源。', noContext: '没有额外的上下文片段。',
        declarations: 'Lean 声明', noDeclarations: '此对象尚无 Lean 锚点，可记录待形式化的范围与问题。',
        source: '已记录的源码片段', fullSource: '查看完整 Lean 源码', sourceUnavailable: '源码片段不可用。', fullType: '已记录的实际展开类型',
        noFinalNewline: '此段文本末尾没有换行',
        typeHint: '与源码签名逐项比较，并核对隐式参数、类型类前提、量词与结论。',
        typeUnavailable: '尚无可用的实际类型证据。', definition: '关键定义', definitionLoading: '正在读取定义…',
        noDefinitions: '没有已记录的类型定义依赖。', definitionUnavailable: '此定义尚无可用证据。',
        readDefinition: '读取此定义的 Lean 证据', trust: '信任边界与证明依赖', axioms: '递归公理依赖',
        definitionRelated: '关联定义与构造', definitionBack: '返回上一层定义', definitionBody: '展开定义值',
        definitionValueUnavailable: '本次未获得展开定义值。请结合定义源码核对。',
        definitionSourceIncomplete: '完整定义源码／定义体尚不可用；当前类型不能替代完整定义。',
        sourceContextWarning: '此定位片段只用于上下文，未确认完整声明范围。',
        noAxioms: '本次 Lean 递归检查未发现公理依赖。', axiomsUnavailable: '尚无可用的递归公理证据。',
        proofDependencies: '证明使用的声明', noProofDependencies: '本次未记录证明声明依赖。',
        omittedDependencies: '依赖列表只显示前 60 项。', omittedDefinitions: '定义列表只显示前 40 项。',
        machine: '机器证据', human: '已保存的人工判断', evidenceCurrent: '当前材料', evidenceStale: '证据已变化',
        evidenceUnavailable: '实际 Lean 证据不可用', evidencePartial: 'Lean 证据不完整',
        available: '已读取', unavailable: '未读取或不可用', stale: '已过期',
        unreviewed: '未审阅', reviewCurrent: '审阅材料未变化', reviewStale: '审阅后材料已变化',
        boundaryHint: '构建、实际类型与公理信息是机器证据；陈述是否一致由人工在明确范围内判断。',
        refresh: '读取 Lean 证据', refreshHint: '使用项目已有工具链执行本地构建并读取实际类型；不会安装依赖或下载工具链。',
        cancel: '取消读取', jobQueued: '等待读取', jobRunning: '正在读取 Lean 证据', jobFailed: 'Lean 证据读取未完成',
        jobCancelled: 'Lean 证据读取已取消', jobCompleted: 'Lean 证据已读取',
        environments: '项目环境', toolchain: '工具链', target: '构建目标', build: '本地构建',
        buildPassed: '通过', buildFailed: '未通过', buildStale: '已变化', buildUnverified: '未验证',
        freshnessPolicy: '新鲜度依据：项目源码、构建配置、依赖清单、工具链与目标。', buildOutput: '构建输出',
        changes: '与审阅时材料的变化', draftChanges: '与本地草稿材料的变化', previous: '审阅时', current: '当前',
        removed: '当前已移除或不可用', missingPrevious: '当时未记录', noTextChange: '指纹变化；此项没有可显示的文本。',
        changedKinds: { statement: '陈述', proof: '证明', context: '上下文', declaration: '声明源码', type: '实际类型', definition: '定义', environment: '环境', evidence: '证据' },
        queue: '本页／本章审阅队列', queuePending: '未审阅或已变化', queueAll: '全部对象', queueUnanchored: '无 Lean 锚点',
        queueEmpty: '此筛选下没有对象。', queueFailed: '本页队列未能读取。', previousObject: '上一项', nextObject: '下一项',
        queueRefreshing: '正在更新队列…',
        queueNoObjects: '本页或本章尚无可审阅的正式对象。',
        unanchored: '无锚点', queueSummary: (pending: number, stale: number, unanchored: number) => `未审 ${pending} · 已变化 ${stale} · 无锚点 ${unanchored}`,
        reviewTitle: '人工审阅记录', reviewHint: '手动列出需要核对的子主张，并关联一个或多个 Lean 声明；未关联不自动表示缺少证明。',
        scope: '已核对范围', scopePlaceholder: '明确列出本次核对的假设、结论与未覆盖部分。',
        reviewer: '审阅者（可选）', note: '整体笔记', verdict: '范围内结论',
        verdicts: { aligned: '受审范围内一致', partial: '部分覆盖', difference: '存在差异', undecided: '尚未判断' },
        addClaim: '添加子主张', removeClaim: '移除此子主张', noClaims: '尚未添加子主张。',
        maximumClaims: '每个对象最多记录 80 条子主张。',
        claimText: '子主张', claimPlaceholder: '例如：假设、存在性、唯一性、构造或结论。',
        claimNote: '子主张笔记', mapping: '关联 Lean 声明（可多选）', noMapping: '未关联声明',
        missingMapping: '原关联声明已不在当前锚点中', unmapped: (count: number) => `尚未关联子主张的声明：${count} 项`,
        unmapMissing: '移除失效关联',
        save: '保存审阅', saving: '正在保存…', saved: '已保存审阅记录', unsaved: '有未保存的改动',
        draftHint: '草稿仅暂存于当前 Reader；关闭 Reader 后不会保留。', retained: '未保存的审阅草稿已暂存于当前 Reader。',
        saveRequired: '请填写已核对范围及每条子主张的内容。', saveFailed: '审阅记录未能保存。',
        conflict: '材料或审阅版本已变化；草稿已保留。重新读取后核对变化，再明确开始审阅当前材料。',
        outdatedDraft: '这份草稿依据的材料或审阅版本已变化；保存前需要重新核对。',
        acknowledge: '审阅当前材料（保留笔记，重置结论）', restore: '载入已保存记录（替换本地草稿）',
        resetVerdicts: '笔记与关联已保留；结论已重置，请核对当前材料后再保存。',
        assist: '请 Codex 协助核对', copyAssist: '复制核对材料', assistContext: '将引用的核对材料',
        assistDrafted: '核对材料已加入当前会话输入框；发送后才会开始核对。', copied: '核对材料已复制，可粘贴到 Codex 会话。',
        assistFailed: '未能加入会话输入框；可复制核对材料后手动粘贴。', copyFailed: '复制未完成，可从核对材料中手动复制。',
        assistHint: '仅引用当前对象的正文、Lean 证据与审阅草稿。Codex 的建议不会自动写入审阅结论。',
        boundedContext: '核对材料已按长度截断；省略范围已在材料中注明。'
    },
    en: {
        title: 'Lean comparison', close: 'Close comparison', loading: 'Reading comparison material…', retry: 'Read again',
        failed: 'Could not read the comparison material.', invalidResponse: 'The returned material does not match this object.',
        prose: 'Prose and associated proofs', statement: 'Statement', proofs: 'Associated proofs', contexts: 'Relevant context',
        noProof: 'No associated proof with a source location was found.', locate: 'Locate prose', raw: 'View Markdown source',
        truncated: 'This excerpt is truncated. Open the source to review the complete content.', noContext: 'No additional context excerpts.',
        declarations: 'Lean declarations', noDeclarations: 'This object has no Lean anchor. Record the intended scope and open questions.',
        source: 'Recorded source excerpt', fullSource: 'View complete Lean source', sourceUnavailable: 'Source excerpt unavailable.', fullType: 'Recorded actual elaborated type',
        noFinalNewline: 'No newline at end of this text',
        typeHint: 'Compare it with the source signature, checking implicit parameters, typeclass assumptions, quantifiers and conclusions.',
        typeUnavailable: 'No usable actual type evidence is available.', definition: 'Key definitions', definitionLoading: 'Reading the definition…',
        noDefinitions: 'No type definition dependencies were recorded.', definitionUnavailable: 'No usable evidence for this definition is available.',
        readDefinition: 'Read Lean evidence for this definition', trust: 'Trust boundary and proof dependencies', axioms: 'Recursive axiom dependencies',
        definitionRelated: 'Related definitions and constructions', definitionBack: 'Back to the previous definition', definitionBody: 'Elaborated definition value',
        definitionValueUnavailable: 'No elaborated definition value was read. Inspect the definition source as well.',
        definitionSourceIncomplete: 'The complete definition source or body is unavailable; its type cannot replace the complete definition.',
        sourceContextWarning: 'This located excerpt is context; a complete declaration range has not been confirmed.',
        noAxioms: 'This recursive Lean check found no axiom dependencies.', axiomsUnavailable: 'No usable recursive axiom evidence is available.',
        proofDependencies: 'Declarations used by the proof', noProofDependencies: 'No proof declaration dependencies were recorded.',
        omittedDependencies: 'Only the first 60 dependencies are shown.', omittedDefinitions: 'Only the first 40 definitions are shown.',
        machine: 'Machine evidence', human: 'Saved human judgment', evidenceCurrent: 'Current material', evidenceStale: 'Evidence changed',
        evidenceUnavailable: 'Actual Lean evidence unavailable', evidencePartial: 'Incomplete Lean evidence',
        available: 'Read', unavailable: 'Not read or unavailable', stale: 'Stale',
        unreviewed: 'Unreviewed', reviewCurrent: 'Reviewed material unchanged', reviewStale: 'Material changed after review',
        boundaryHint: 'Build, actual type and axiom information are machine evidence. A human judges agreement within an explicit scope.',
        refresh: 'Read Lean evidence', refreshHint: 'Build locally with the existing project toolchain and read actual types; no dependency installation or toolchain download.',
        cancel: 'Cancel reading', jobQueued: 'Waiting to read', jobRunning: 'Reading Lean evidence', jobFailed: 'Lean evidence reading did not complete',
        jobCancelled: 'Lean evidence reading cancelled', jobCompleted: 'Lean evidence read',
        environments: 'Project environment', toolchain: 'Toolchain', target: 'Build target', build: 'Local build',
        buildPassed: 'Passed', buildFailed: 'Failed', buildStale: 'Changed', buildUnverified: 'Unverified',
        freshnessPolicy: 'Freshness covers project sources, build configuration, dependency manifest, toolchain and target.', buildOutput: 'Build output',
        changes: 'Changes since the saved review', draftChanges: 'Changes since the local draft', previous: 'At review time', current: 'Current',
        removed: 'Now removed or unavailable', missingPrevious: 'Not recorded then', noTextChange: 'Fingerprint changed; no text comparison is available for this item.',
        changedKinds: { statement: 'Statement', proof: 'Proof', context: 'Context', declaration: 'Declaration source', type: 'Actual type', definition: 'Definition', environment: 'Environment', evidence: 'Evidence' },
        queue: 'Page / chapter review queue', queuePending: 'Unreviewed or changed', queueAll: 'All objects', queueUnanchored: 'Without Lean anchors',
        queueEmpty: 'No objects match this filter.', queueFailed: 'Could not read this page’s queue.', previousObject: 'Previous object', nextObject: 'Next object',
        queueRefreshing: 'Updating the queue…',
        queueNoObjects: 'This page or chapter has no formal objects to review.',
        unanchored: 'No anchor', queueSummary: (pending: number, stale: number, unanchored: number) => `${pending} unreviewed · ${stale} changed · ${unanchored} without anchors`,
        reviewTitle: 'Human review record', reviewHint: 'Write subclaims manually and link each to one or more Lean declarations. An unlinked declaration does not automatically imply a missing proof.',
        scope: 'Reviewed scope', scopePlaceholder: 'Specify the assumptions, conclusions and omitted parts reviewed in this pass.',
        reviewer: 'Reviewer (optional)', note: 'Overall notes', verdict: 'Verdict within scope',
        verdicts: { aligned: 'Aligned within reviewed scope', partial: 'Partial coverage', difference: 'Difference found', undecided: 'Undecided' },
        addClaim: 'Add subclaim', removeClaim: 'Remove this subclaim', noClaims: 'No subclaims added yet.',
        maximumClaims: 'At most 80 subclaims may be recorded per object.',
        claimText: 'Subclaim', claimPlaceholder: 'For example: assumptions, existence, uniqueness, construction or conclusion.',
        claimNote: 'Subclaim notes', mapping: 'Linked Lean declarations (select any)', noMapping: 'No declaration linked',
        missingMapping: 'Previously linked declaration is absent from the current anchor', unmapped: (count: number) => `${count} declarations have no subclaim link`,
        unmapMissing: 'Remove missing link',
        save: 'Save review', saving: 'Saving…', saved: 'Review record saved', unsaved: 'Unsaved changes',
        draftHint: 'Drafts remain only in this Reader view and are lost when the Reader closes.', retained: 'The unsaved review draft remains in this Reader view.',
        saveRequired: 'Fill in the reviewed scope and every subclaim’s text.', saveFailed: 'Could not save the review record.',
        conflict: 'The material or review revision changed. Your draft is preserved. Read again, inspect the changes and explicitly begin reviewing the current material.',
        outdatedDraft: 'This draft uses older material or an older review revision. Review the changes before saving.',
        acknowledge: 'Review current material (keep notes, reset verdicts)', restore: 'Load saved record (replace local draft)',
        resetVerdicts: 'Notes and links are preserved. Verdicts have been reset; review the current material before saving.',
        assist: 'Ask Codex to help compare', copyAssist: 'Copy comparison context', assistContext: 'Comparison context to quote',
        assistDrafted: 'Comparison context added to the conversation input. Send it to begin the comparison.', copied: 'Comparison context copied. Paste it into a Codex conversation.',
        assistFailed: 'Could not add it to the conversation input. Copy the context and paste it manually.', copyFailed: 'Copy did not complete. You can select and copy the displayed context.',
        assistHint: 'Quotes only this object’s prose, Lean evidence and review draft. Codex suggestions never change the review verdict automatically.',
        boundedContext: 'The comparison context is length limited; omissions are marked in the context.'
    }
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const result = document.createElement(tag);
    if (text) result.textContent = text;
    if (className) result.className = className;
    return result;
}
function button(text: string, action: () => void, key = ''): HTMLButtonElement {
    const result = element('button', text, 'reader-lean-review-button');
    result.type = 'button';
    if (key) result.dataset.leanAction = key;
    result.addEventListener('click', action);
    return result;
}
function details(title: string): HTMLDetailsElement {
    const result = element('details');
    result.append(element('summary', title));
    return result;
}
function code(value: string, className = ''): HTMLPreElement {
    const result = element('pre', '', className);
    result.append(element('code', value));
    return result;
}
function sourceLabel(source: SourceSnippet): string { return `${source.filePath}:${source.startLine}–${source.endLine}`; }
function draftKey(projectId: string, id: string): string { return projectId + '\0' + id; }
function cloneClaims(claims: ReviewSubclaim[]): ReviewSubclaim[] { return claims.map(claim => ({ ...claim, declarationKeys: [...claim.declarationKeys] })); }
function equalRecord(draft: ReviewDraft, record: ReviewRecord | undefined): boolean {
    return Boolean(record && draft.evidenceFingerprint === record.evidenceFingerprint && draft.verdict === record.verdict
        && draft.scope === record.scope && draft.note === record.note && draft.reviewer === record.reviewer
        && JSON.stringify(draft.subclaims) === JSON.stringify(record.subclaims));
}

/** Changes against a transient, unsaved draft; persisted snapshot comparison belongs to the backend. */
export function leanReviewDraftChanges(before: LeanReviewEvidence, after: LeanReviewEvidence): ReviewChange[] {
    const changes: ReviewChange[] = [];
    const compare = (kind: ReviewChange['kind'], previous: SourceSnippet[], current: SourceSnippet[]) => {
        const old = new Map(previous.map((source, index) => [source.filePath + ':' + index, source]));
        const next = new Map(current.map((source, index) => [source.filePath + ':' + index, source]));
        for (const key of new Set([...old.keys(), ...next.keys()])) {
            const left = old.get(key), right = next.get(key);
            if (left?.fingerprint === right?.fingerprint) continue;
            changes.push({ kind, key, label: sourceLabel(right || left!), previous: left?.content, current: right?.content,
                truncated: left?.truncated || right?.truncated });
        }
    };
    compare('statement', [before.statement], [after.statement]);
    compare('proof', before.proofs, after.proofs);
    compare('context', before.contexts, after.contexts);
    for (const kind of ['declarations', 'definitions'] as const) {
        const old = new Map(before[kind].map(declaration => [declaration.key, declaration]));
        const next = new Map(after[kind].map(declaration => [declaration.key, declaration]));
        for (const key of new Set([...old.keys(), ...next.keys()])) {
            const left = old.get(key), right = next.get(key), label = (right || left)!.qualifiedName;
            if (left?.source?.fingerprint !== right?.source?.fingerprint) changes.push({ kind: kind === 'definitions' ? 'definition' : 'declaration', key, label,
                previous: left?.source?.content, current: right?.source?.content, truncated: left?.source?.truncated || right?.source?.truncated });
            if (left?.elaboratedType !== right?.elaboratedType || left?.evidenceState !== right?.evidenceState) changes.push({
                kind: kind === 'definitions' ? 'definition' : 'type', key: key + ':type', label,
                previous: left?.elaboratedType, current: right?.elaboratedType, truncated: left?.truncated || right?.truncated });
        }
    }
    const oldProjects = new Map(before.projects.map(project => [project.projectKey, project]));
    for (const project of after.projects) {
        const previous = oldProjects.get(project.projectKey);
        if (previous?.inputFingerprint !== project.inputFingerprint) changes.push({ kind: 'environment', key: project.projectKey,
            label: project.projectKey, previous: previous ? `${previous.toolchain}\n${previous.inputFingerprint}` : undefined,
            current: `${project.toolchain}\n${project.inputFingerprint}` });
    }
    if (changes.length === 0 && before.fingerprint !== after.fingerprint) changes.push({ kind: 'evidence', key: 'fingerprint', label: 'snapshot',
        previous: before.fingerprint, current: after.fingerprint });
    return changes;
}

/** Freeze only the selected object's bounded source and evidence for a user-controlled conversation draft. */
export function leanReviewAssistance(payload: LeanReviewResponse, draft: LeanReviewSaveInput, language: Language): { text: string; truncated: boolean } {
    const zh = language === 'zh', blocks: string[] = [];
    let remaining = 48000, truncated = false;
    const add = (title: string, value: string, omitted = false) => {
        if (remaining < 200) { truncated = true; return; }
        const limit = Math.min(10000, remaining - title.length - 80);
        const bounded = value.slice(0, limit);
        if (bounded.length !== value.length || omitted) truncated = true;
        const fence = '`'.repeat(Math.max(3, ...Array.from(bounded.matchAll(/`+/g), match => match[0].length + 1)));
        const block = `${title}\n${fence}\n${bounded}${bounded.length !== value.length || omitted ? '\n[truncated / 已截断]' : ''}\n${fence}`;
        blocks.push(block); remaining -= block.length;
    };
    blocks.push(zh
        ? '请在下列明确范围内协助核对正文与 Lean，指出前提、量词、构造及结论的差异、缺口和不确定性。机器证据与人工判断分别说明。请只讨论；不要修改文件，也不要自动采纳或保存结论。'
        : 'Help compare the prose and Lean within the explicit scope below. Identify differences, gaps and uncertainty in assumptions, quantifiers, construction and conclusions. Keep machine evidence and human judgment separate. Discuss only; do not edit files or automatically adopt or save a verdict.');
    blocks.push(`Object: ${payload.id}\nSource: ${payload.formal.filePath}:${payload.formal.line}\nDisplayed evidence: ${payload.evidence.fingerprint}\nDraft evidence: ${draft.evidenceFingerprint}\nEvidence state: ${payload.evidence.state}\nReview revision: ${draft.expectedRevision}`);
    add(zh ? '人工审阅草稿（尚未采纳 AI 建议）' : 'Human review draft (no AI suggestion adopted)', JSON.stringify({ scope: draft.scope, verdict: draft.verdict, note: draft.note, subclaims: draft.subclaims }, null, 2));
    for (const snippet of [payload.evidence.statement, ...payload.evidence.proofs, ...payload.evidence.contexts]) add(`${snippet.role || 'prose'} · ${sourceLabel(snippet)}`, snippet.content, snippet.truncated);
    for (const declaration of [...payload.evidence.declarations, ...payload.evidence.definitions]) {
        add(`${declaration.projectKey} · ${declaration.qualifiedName} · ${declaration.evidenceState}`,
            [declaration.source && `Source: ${sourceLabel(declaration.source)}\n${declaration.source.content}`,
                `Actual elaborated type:\n${declaration.elaboratedType || '[unavailable / 不可用]'}`,
                `Recursive axiom evidence: ${declaration.evidenceState === 'available' ? JSON.stringify(declaration.axioms) : '[unavailable / 不可用]'}`,
                declaration.diagnostic].filter(Boolean).join('\n\n'), declaration.truncated || declaration.source?.truncated);
    }
    add('Project environment', JSON.stringify(payload.evidence.projects, null, 2));
    if (truncated) blocks.push(zh ? '[核对材料有省略；不能据此断言完整对象已被覆盖。]' : '[Context contains omissions; it cannot establish coverage of the complete object.]');
    return { text: blocks.join('\n\n'), truncated };
}

/** Owns the comparison mode, object-scoped drafts, explicit mutations and every asynchronous lifecycle. */
export class ReaderLeanReview {
    private readonly section: HTMLElement;
    private readonly drafts = new Map<string, ReviewDraft>();
    private active?: RequestIdentity;
    private generation = 0;
    private loadRequest = 0;
    private queueRequest = 0;
    private definitionRequest = 0;
    private jobReadRequest = 0;
    private actionRequest = 0;
    private payload?: LeanReviewResponse;
    private queue: LeanReviewQueueItem[] = [];
    private queueError = false;
    private queueLoading = false;
    private queueFilter = 'pending';
    private queueOpen = false;
    private pageQueueMode = false;
    private emptyQueue = false;
    private selectedDeclaration = '';
    private selectedClaim = '';
    private selectedDefinition?: { projectKey: string; name: string };
    private definitionTrail: Array<{ projectKey: string; name: string }> = [];
    private definition?: LeanDefinitionResponse;
    private definitionLoading = false;
    private busy = false;
    private saving = false;
    private job?: ReviewJob;
    private pollTimer?: ReturnType<typeof setTimeout>;
    private message = '';
    private messageError = false;
    private returnFocus?: HTMLElement;
    private pendingNavigation?: { projectId: string; filePath: string; id: string; returnFocus?: HTMLElement };
    private draftStatus?: HTMLElement;
    private saveButton?: HTMLButtonElement;
    private status?: HTMLElement;
    private assistancePreview?: HTMLDetailsElement;
    private proseDisposers: Array<() => void> = [];
    private lastContext: ReviewContext;
    private readonly sourceViewer: ReaderLeanSource;
    private readonly audit: ReaderLeanAudit;
    private readonly onBeforeUnload = (event: BeforeUnloadEvent) => {
        if (![...this.drafts.values()].some(draft => draft.dirty)) return;
        event.preventDefault(); event.returnValue = '';
    };
    private readonly onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !this.active || event.defaultPrevented) return;
        if (!this.section.contains(event.target as Node)) return;
        // Native selects and details retain their normal keyboard behavior first.
        if ((event.target as HTMLElement)?.tagName === 'SELECT') return;
        event.preventDefault(); this.close();
    };

    constructor(private readonly container: HTMLElement, private readonly host: ReaderLeanReviewHost) {
        this.lastContext = { ...host.context() };
        this.sourceViewer = new ReaderLeanSource({
            context: () => host.context(), request: (route, options) => host.request(route, options), report: message => host.report(message),
            selectionChanged: selection => this.audit?.selectionChanged({ ...this.auditSelection(), ...selection })
        });
        this.audit = new ReaderLeanAudit({
            context: () => ({ projectId: host.context().projectId, requestToken: host.context().token, language: host.context().language, revision: host.context().revision }),
            request: (route, options) => host.request(route, options), report: message => host.report(message),
            openReview: id => { void this.open(id); }, openSource: target => { void this.sourceViewer.open(target); },
            locateProse: location => host.locate({ ...location, content: location.quote || '', fingerprint: '' }),
            canAssist: () => host.canAssist(), assist: content => host.assist(content)
        });
        this.section = element('section', '', 'reader-lean-review');
        this.section.hidden = true;
        this.section.setAttribute('role', 'region');
        this.container.insertBefore(this.section, this.container.querySelector('#reader-article'));
        window.addEventListener('beforeunload', this.onBeforeUnload);
        document.addEventListener('keydown', this.onKeyDown);
    }

    contextChanged(): void {
        const context = this.host.context(), previous = this.lastContext;
        this.lastContext = { ...context };
        this.sourceViewer.contextChanged();
        if (!this.active) return;
        if (context.projectId !== this.active.projectId || (context.filePath && context.filePath !== this.active.filePath)) {
            this.close(false); return;
        }
        if (previous.language !== context.language) this.render();
        if (previous.revision !== context.revision) {
            if (this.pageQueueMode) void this.openPageQueue(this.returnFocus);
            else {
                const identity = this.active;
                void this.load(identity);
                void this.loadQueue(identity);
            }
        }
    }

    metadataChanged(changedPaths: string[]): void {
        const identity = this.active; if (!identity || !this.matches(identity)) return;
        const paths = changedPaths.map(filePath => filePath.replace(/\\/g, '/'));
        const review = paths.some(filePath => filePath === `.math-workspace/lean-reviews/${identity.id}.json`
            || filePath === `.math-workspace/lean-review-evidence/${identity.id}.json`);
        const metadata = paths.some(filePath => /^\.math-workspace\/lean-(?:audits|reviews|review-evidence)\//.test(filePath));
        if (!metadata) return;
        if (review) void this.load(identity);
        if (paths.some(filePath => /^\.math-workspace\/lean-(?:reviews|review-evidence)\//.test(filePath))) void this.loadQueue(identity);
        this.audit.metadataChanged();
    }

    navigationStarted(filePath: string): void {
        const intent = this.pendingNavigation;
        const preserveIntent = Boolean(intent && intent.filePath === filePath && intent.projectId === this.host.context().projectId);
        if (!preserveIntent) this.pendingNavigation = undefined;
        if (this.active && filePath !== this.active.filePath) this.hide(false, preserveIntent);
    }

    async open(id: string, returnFocus?: HTMLElement): Promise<void> {
        this.pageQueueMode = false;
        const identity = this.activate(id, returnFocus); if (!identity) return;
        this.render(); this.section.querySelector<HTMLElement>('h2')?.focus();
        void this.loadQueue(identity);
        await this.load(identity);
    }

    async openPageQueue(returnFocus?: HTMLElement): Promise<void> {
        this.pageQueueMode = true;
        const identity = this.activate('', returnFocus); if (!identity) return;
        const request = ++this.queueRequest;
        this.queueOpen = true; this.render(); this.section.querySelector<HTMLElement>('h2')?.focus();
        try {
            const response = await this.get<LeanReviewQueueResponse>('/api/lean-review/queue?filePath=' + encodeURIComponent(identity.filePath), identity.projectId);
            if (!this.matches(identity) || request !== this.queueRequest) return;
            if (response.projectToken !== identity.projectId) throw new Error(this.words().invalidResponse);
            this.queue = response.items;
            const first = response.items.find(item => item.reviewFreshness !== 'current') || response.items[0];
            if (first) await this.openQueueItem(first);
            else { this.emptyQueue = true; this.render(); }
        } catch (error) {
            if (!this.matches(identity) || request !== this.queueRequest) return;
            this.report(this.words().queueFailed + ' ' + (error instanceof Error ? error.message : String(error)), true); this.render();
        }
    }

    private activate(id: string, returnFocus?: HTMLElement): RequestIdentity | undefined {
        const context = this.host.context();
        if (!context.projectId || !context.filePath) return;
        this.pendingNavigation = undefined;
        this.clearTimers(); this.disposeProse();
        const identity = { generation: ++this.generation, projectId: context.projectId, filePath: context.filePath, id };
        this.active = identity; this.lastContext = { ...context }; this.returnFocus = returnFocus;
        this.sourceViewer.bindObject(id); this.audit.hide();
        this.queue = []; this.queueError = false; this.queueLoading = false; this.emptyQueue = false;
        this.payload = undefined; this.selectedDeclaration = ''; this.selectedClaim = '';
        this.selectedDefinition = undefined; this.definition = undefined; this.definitionLoading = false;
        this.definitionTrail = [];
        this.definitionRequest++; this.actionRequest++; this.busy = false; this.saving = false; this.job = undefined;
        this.message = ''; this.messageError = false;
        this.section.hidden = false; this.container.classList.add('is-lean-review');
        return identity;
    }

    close(restoreFocus = true): void {
        this.hide(restoreFocus);
    }

    private hide(restoreFocus: boolean, preserveNavigation = false): void {
        const draft = this.currentDraft();
        this.generation++; this.loadRequest++; this.definitionRequest++; this.actionRequest++;
        this.clearTimers(); this.disposeProse();
        this.sourceViewer.close(); this.audit.hide();
        this.active = undefined; this.payload = undefined; this.busy = false; this.saving = false;
        this.section.hidden = true; this.section.replaceChildren(); this.container.classList.remove('is-lean-review');
        if (draft?.dirty) this.host.report(this.words().retained);
        if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus();
        this.returnFocus = undefined;
        if (!preserveNavigation) this.pendingNavigation = undefined;
    }

    dispose(): void {
        this.close(false); this.section.remove();
        this.sourceViewer.dispose(); this.audit.destroy();
        window.removeEventListener('beforeunload', this.onBeforeUnload);
        document.removeEventListener('keydown', this.onKeyDown);
    }

    private words() { return copy[this.host.context().language]; }
    private currentDraft(): ReviewDraft | undefined { return this.active && this.drafts.get(draftKey(this.active.projectId, this.active.id)); }
    private matches(identity: RequestIdentity): boolean {
        const context = this.host.context();
        return Boolean(this.active && this.active.generation === identity.generation && this.active.id === identity.id
            && this.active.projectId === identity.projectId && this.active.filePath === identity.filePath
            && context.projectId === identity.projectId && context.filePath === identity.filePath);
    }
    private clearTimers(): void { if (this.pollTimer !== undefined) clearTimeout(this.pollTimer); this.pollTimer = undefined; }
    private disposeProse(): void { this.proseDisposers.splice(0).forEach(dispose => dispose()); }
    private headers(projectToken = ''): Record<string, string> {
        const headers: Record<string, string> = {};
        if (this.host.context().token) headers['x-math-workspace-token'] = this.host.context().token;
        if (projectToken) headers['x-math-workspace-project'] = projectToken;
        return headers;
    }
    private async get<T>(route: string, projectToken = ''): Promise<T> {
        const response = await this.host.request(route, { cache: 'no-store', headers: this.headers(projectToken) });
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<T>;
    }
    private async action<T>(value: object, projectToken: string): Promise<T> {
        const response = await this.host.request('/api/lean-review/action', { method: 'POST', cache: 'no-store',
            headers: { ...this.headers(projectToken), 'content-type': 'application/json' }, body: JSON.stringify(value) });
        if (!response.ok) {
            const error = new Error(await response.text()) as Error & { status?: number }; error.status = response.status; throw error;
        }
        return response.json() as Promise<T>;
    }
    private newDraft(payload: LeanReviewResponse): ReviewDraft {
        const record = payload.review.record;
        return { id: payload.id, expectedRevision: payload.review.expectedRevision, evidenceFingerprint: payload.evidence.fingerprint,
            projectToken: payload.projectToken, verdict: record?.verdict || 'undecided', scope: record?.scope || '', note: record?.note || '',
            reviewer: record?.reviewer || '', subclaims: cloneClaims(record?.subclaims || []), snapshot: payload.evidence,
            dirty: false, editVersion: 0, acknowledgementRequired: payload.review.freshness === 'stale', needsReload: false };
    }
    private accept(payload: LeanReviewResponse, identity: RequestIdentity): void {
        if (payload.id !== identity.id || payload.formal.filePath !== identity.filePath || payload.projectToken !== identity.projectId
            || (this.payload && this.payload.projectToken !== payload.projectToken)) throw new Error(this.words().invalidResponse);
        const key = draftKey(identity.projectId, identity.id), current = this.drafts.get(key);
        if (!current?.dirty || equalRecord(current, payload.review.record)) this.drafts.set(key, this.newDraft(payload));
        else current.needsReload = false;
        if (this.payload && this.payload.evidence.fingerprint !== payload.evidence.fingerprint) this.resetDefinition();
        this.payload = payload;
        if (!payload.evidence.declarations.some(item => item.key === this.selectedDeclaration)) this.selectedDeclaration = payload.evidence.declarations[0]?.key || '';
        const draft = this.currentDraft();
        if (!draft?.subclaims.some(claim => claim.id === this.selectedClaim)) this.selectedClaim = draft?.subclaims[0]?.id || '';
    }
    private async load(identity: RequestIdentity): Promise<void> {
        const request = ++this.loadRequest, projectToken = this.payload?.projectToken || identity.projectId;
        try {
            const payload = await this.get<LeanReviewResponse>('/api/lean-review?id=' + encodeURIComponent(identity.id), projectToken);
            if (!this.matches(identity) || request !== this.loadRequest) return;
            this.accept(payload, identity); this.render();
            if (payload.job && ['queued', 'running'].includes(payload.job.status)) {
                this.job = payload.job; this.render(); this.pollJob(identity, payload.job.id);
            }
        } catch (error) {
            if (!this.matches(identity) || request !== this.loadRequest) return;
            this.message = this.words().failed + ' ' + (error instanceof Error ? error.message : String(error)); this.messageError = true;
            this.render();
        }
    }
    private async loadQueue(identity: RequestIdentity): Promise<void> {
        const request = ++this.queueRequest;
        this.queueLoading = true; this.render();
        try {
            const response = await this.get<LeanReviewQueueResponse>('/api/lean-review/queue?filePath=' + encodeURIComponent(identity.filePath), identity.projectId);
            if (!this.matches(identity) || request !== this.queueRequest) return;
            if (response.projectToken !== identity.projectId) throw new Error(this.words().invalidResponse);
            this.queue = response.items; this.queueError = false; this.queueLoading = false; this.render();
        } catch (_error) { if (this.matches(identity) && request === this.queueRequest) { this.queueError = true; this.queueLoading = false; this.render(); } }
    }
    private draftOutdated(draft = this.currentDraft()): boolean {
        return Boolean(draft && this.payload && (draft.acknowledgementRequired || draft.evidenceFingerprint !== this.payload.evidence.fingerprint
            || draft.expectedRevision !== this.payload.review.expectedRevision));
    }
    private changed(): void {
        const draft = this.currentDraft(); if (!draft) return;
        draft.dirty = true; draft.editVersion++;
        this.updateDraftStatus();
        if (this.message === this.words().saved) this.report('');
        if (this.assistancePreview?.open && this.payload) this.assistancePreview.querySelector('code')!.textContent = leanReviewAssistance(this.payload, draft, this.host.context().language).text;
    }
    private report(message: string, error = false): void {
        this.message = message; this.messageError = error;
        if (this.status) { this.status.textContent = message; this.status.classList.toggle('is-error', error); }
    }
    private updateDraftStatus(): void {
        const draft = this.currentDraft(), w = this.words(); if (!draft) return;
        if (this.draftStatus) {
            this.draftStatus.textContent = this.draftOutdated(draft) ? w.outdatedDraft : draft.dirty ? w.unsaved : this.payload?.review.record ? w.saved : w.unreviewed;
            this.draftStatus.classList.toggle('is-warning', this.draftOutdated(draft) || draft.dirty);
        }
        if (this.saveButton) { this.saveButton.disabled = this.busy || this.draftOutdated(draft); this.saveButton.textContent = this.saving ? w.saving : w.save; }
    }

    private render(): void {
        if (!this.active) return;
        const focused = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
        const focusKey = this.section.contains(focused) ? focused?.dataset.leanFocus : undefined;
        const selection = focusKey && focused && ['INPUT', 'TEXTAREA'].includes(focused.tagName) ? [focused.selectionStart, focused.selectionEnd] : undefined;
        this.disposeProse();
        const w = this.words(), header = element('header', '', 'reader-lean-review-header');
        const title = element('div'), heading = element('h2', w.title); heading.tabIndex = -1;
        title.append(heading, element('p', this.payload ? `${this.payload.formal.display || this.payload.formal.title} · ${this.active.id}` : this.active.id || this.active.filePath));
        header.append(title, button(w.close, () => this.close(), 'close'));
        this.section.setAttribute('aria-label', w.title);
        this.status = element('p', this.message, 'reader-lean-review-live' + (this.messageError ? ' is-error' : ''));
        this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
        const children: HTMLElement[] = [header, this.status];
        if (!this.payload) {
            children.push(element('p', this.messageError ? w.failed : this.emptyQueue ? w.queueNoObjects : w.loading, 'reader-lean-review-empty'));
            if (this.messageError || this.emptyQueue) children.push(button(w.retry, () => {
                this.message = ''; this.messageError = false;
                if (this.pageQueueMode) void this.openPageQueue(this.returnFocus); else void this.load(this.active!);
            }, 'retry'));
        } else {
            children.push(this.renderEvidenceStatus(), this.renderQueue());
            const columns = element('div', '', 'reader-lean-review-columns');
            columns.append(this.renderProse(), this.renderLean()); children.push(columns);
            this.sourceViewer.bindObject(this.active.id); children.push(this.sourceViewer.mount());
            const changes = this.payload.review.changes;
            if (changes.length) children.push(this.renderChanges(w.changes, changes, this.payload.review.record?.snapshot));
            const draft = this.currentDraft()!;
            if (draft.snapshot.fingerprint !== this.payload.evidence.fingerprint) children.push(this.renderChanges(w.draftChanges, leanReviewDraftChanges(draft.snapshot, this.payload.evidence), draft.snapshot));
            children.push(this.renderReview());
            this.audit.update(this.payload, this.auditSelection()); children.push(this.audit.mount(), this.renderAssistance());
        }
        this.section.replaceChildren(...children);
        this.updateDraftStatus();
        if (focusKey) {
            const target = [...this.section.querySelectorAll<HTMLElement>('[data-lean-focus]')].find(item => item.dataset.leanFocus === focusKey);
            target?.focus({ preventScroll: true });
            if (selection && target && 'setSelectionRange' in target) {
                try { (target as HTMLInputElement).setSelectionRange(selection[0], selection[1]); } catch (_error) { /* Non-text input. */ }
            }
        }
    }

    private renderEvidenceStatus(): HTMLElement {
        const payload = this.payload!, w = this.words(), section = element('section', '', 'reader-lean-review-evidence');
        const machine = element('div'), human = element('div');
        machine.append(element('h3', w.machine), element('p', ({ current: w.evidenceCurrent, stale: w.evidenceStale, unavailable: w.evidenceUnavailable, partial: w.evidencePartial })[payload.evidence.state], 'reader-lean-review-state is-' + payload.evidence.state));
        const actions = element('div', '', 'reader-lean-review-actions');
        const refresh = button(w.refresh, () => { void this.startJob('refresh'); }, 'refresh');
        refresh.title = w.refreshHint; refresh.disabled = this.busy || ['queued', 'running'].includes(this.job?.status || '');
        actions.append(refresh);
        if (this.job && ['queued', 'running'].includes(this.job.status)) actions.append(button(w.cancel, () => { void this.cancelJob(); }, 'cancel'));
        if (this.job) actions.append(element('span', this.jobText(this.job), 'reader-lean-review-job'));
        machine.append(actions);
        human.append(element('h3', w.human), element('p', payload.review.record ? w.verdicts[payload.review.record.verdict] : w.unreviewed),
            element('p', ({ current: w.reviewCurrent, stale: w.reviewStale, unreviewed: w.unreviewed })[payload.review.freshness], 'reader-lean-review-freshness is-' + payload.review.freshness));
        if (payload.review.record) human.append(element('span', payload.review.record.reviewer + ' · ' + new Date(payload.review.record.reviewedAt).toLocaleString(this.host.context().language)));
        section.append(machine, human, element('p', w.boundaryHint, 'reader-lean-review-boundary'));
        if (payload.evidence.diagnostics.length) section.append(this.diagnostics(payload.evidence.diagnostics));
        return section;
    }
    private renderQueue(): HTMLElement {
        const w = this.words(), queue = details(w.queue + ' · ' + (this.queueLoading ? w.queueRefreshing : this.queueError ? w.queueFailed : w.queueSummary(this.queue.filter(item => item.reviewFreshness === 'unreviewed').length,
            this.queue.filter(item => item.reviewFreshness === 'stale').length, this.queue.filter(item => !item.anchored).length)));
        queue.className = 'reader-lean-review-queue'; queue.open = this.queueOpen;
        queue.setAttribute('aria-busy', String(this.queueLoading));
        queue.addEventListener('toggle', () => { this.queueOpen = queue.open; });
        const select = element('select'); select.setAttribute('aria-label', w.queue); select.dataset.leanFocus = 'queue-filter';
        for (const [value, label] of [['pending', w.queuePending], ['all', w.queueAll], ['unanchored', w.queueUnanchored]]) {
            const option = element('option', label); option.value = value; select.append(option);
        }
        select.value = this.queueFilter;
        select.addEventListener('change', () => { this.queueFilter = select.value; this.render(); });
        const items = this.queue.filter(item => this.queueFilter === 'all' || (this.queueFilter === 'unanchored' ? !item.anchored : item.reviewFreshness !== 'current'));
        const index = items.findIndex(item => item.id === this.active!.id), navigation = element('div', '', 'reader-lean-review-actions');
        const previous = button(w.previousObject, () => { if (index > 0) void this.openQueueItem(items[index - 1]); }, 'previous-object'); previous.disabled = index <= 0;
        const next = button(w.nextObject, () => { const nextItem = items[index + 1]; if (nextItem) void this.openQueueItem(nextItem); }, 'next-object'); next.disabled = index >= items.length - 1;
        navigation.append(select, previous, next); queue.append(navigation);
        if (this.queueError) queue.append(element('p', w.queueFailed));
        else if (!items.length) queue.append(element('p', w.queueEmpty));
        else {
            const list = element('ul');
            for (const item of items) {
                const entry = element('li'), open = button(`${item.display || item.title || item.id} · ${this.queueLoading ? w.queueRefreshing : this.queueError ? w.queueFailed : item.reviewFreshness === 'stale' ? w.reviewStale : item.reviewFreshness === 'current' ? w.verdicts[item.verdict || 'undecided'] : w.unreviewed}${!item.anchored ? ' · ' + w.unanchored : ''}`,
                    () => { void this.openQueueItem(item); });
                open.dataset.leanObject = item.id; open.setAttribute('aria-current', item.id === this.active!.id ? 'true' : 'false'); entry.append(open); list.append(entry);
            }
            queue.append(list);
        }
        return queue;
    }
    private async openQueueItem(item: LeanReviewQueueItem): Promise<void> {
        const context = this.host.context();
        if (!this.active || !this.matches(this.active)) return;
        if (item.filePath === context.filePath) { await this.open(item.id, this.returnFocus); return; }
        const intent = { projectId: context.projectId, filePath: item.filePath, id: item.id, returnFocus: this.returnFocus };
        this.pendingNavigation = intent;
        try {
            await this.host.navigatePage(item.filePath);
            if (this.pendingNavigation !== intent || this.host.context().projectId !== intent.projectId || this.host.context().filePath !== intent.filePath) return;
            this.pendingNavigation = undefined;
            await this.open(intent.id, intent.returnFocus);
        } catch (error) {
            if (this.pendingNavigation !== intent) return;
            this.pendingNavigation = undefined;
            this.host.report(this.words().failed + ' ' + (error instanceof Error ? error.message : String(error)));
        }
    }
    private renderProse(): HTMLElement {
        const w = this.words(), evidence = this.payload!.evidence, section = element('section', '', 'reader-lean-review-prose-column');
        section.append(element('h3', w.prose), this.proseSnippet(evidence.statement, w.statement));
        section.append(element('h4', w.proofs));
        if (!evidence.proofs.length) section.append(element('p', w.noProof, 'reader-lean-review-empty'));
        evidence.proofs.forEach((source, index) => section.append(this.proseSnippet(source, `${w.proofs} ${index + 1}`)));
        const context = details(w.contexts);
        if (!evidence.contexts.length) context.append(element('p', w.noContext));
        evidence.contexts.forEach(source => context.append(this.proseSnippet(source, w.contexts)));
        section.append(context); return section;
    }
    private proseSnippet(source: SourceSnippet, title: string): HTMLElement {
        const w = this.words(), section = element('section', '', 'reader-lean-review-source-card');
        const header = element('header'); header.append(element('strong', title), button(w.locate, () => this.host.locate(source)));
        section.append(header, element('p', sourceLabel(source), 'reader-lean-review-location'));
        const content = element('div', '', 'reader-article reader-lean-review-prose'); content.innerHTML = this.host.renderProse(source);
        content.querySelectorAll('[data-reader-lean-anchor], [data-reader-dependency]').forEach(marker => marker.remove());
        // The full page remains mounted for returning to reading; avoid duplicate DOM anchors.
        content.querySelectorAll('[id]').forEach(item => item.removeAttribute('id'));
        section.append(content);
        if (source.truncated) section.append(element('p', w.truncated, 'reader-lean-review-warning'));
        const raw = details(w.raw); raw.append(code(source.content)); section.append(raw);
        if (this.host.mountProse) this.proseDisposers.push(this.host.mountProse(content));
        return section;
    }
    private renderLean(): HTMLElement {
        const w = this.words(), section = element('section', '', 'reader-lean-review-lean-column'), declarations = this.payload!.evidence.declarations;
        section.append(element('h3', w.declarations));
        if (!declarations.length) section.append(element('p', w.noDeclarations, 'reader-lean-review-empty'));
        else {
            const select = element('select'); select.setAttribute('aria-label', w.declarations); select.dataset.leanFocus = 'declaration';
            for (const declaration of declarations) { const option = element('option', `${declaration.projectKey} · ${declaration.qualifiedName}`); option.value = declaration.key; select.append(option); }
            select.value = this.selectedDeclaration;
            select.addEventListener('change', () => { this.selectedDeclaration = select.value; this.resetDefinition(); this.render(); });
            section.append(select);
            const declaration = declarations.find(item => item.key === this.selectedDeclaration)!;
            section.append(this.declarationCard(declaration), this.renderDefinitions(declaration));
        }
        const environment = details(w.environments); environment.className = 'reader-lean-review-environments';
        for (const project of this.payload!.evidence.projects) {
            const card = element('section'); card.append(element('h4', project.projectKey));
            const list = element('dl', '', 'reader-lean-status-list');
            for (const [label, value] of [[w.toolchain, project.toolchain], [w.target, project.target || '—'], [w.build, ({ passed: w.buildPassed, failed: w.buildFailed, stale: w.buildStale, unverified: w.buildUnverified })[project.build.state]]]) {
                list.append(element('dt', label), element('dd', value));
            }
            card.append(list, element('p', w.freshnessPolicy));
            if (project.build.output) { const output = details(w.buildOutput); output.append(code(project.build.output)); card.append(output); }
            if (project.diagnostic) card.append(this.diagnostics([project.diagnostic])); environment.append(card);
        }
        section.append(environment); return section;
    }
    private declarationCard(declaration: DeclarationEvidence): HTMLElement {
        const w = this.words(), section = element('section', '', 'reader-lean-review-declaration');
        section.append(element('h4', declaration.qualifiedName), element('p', `${declaration.kind} · ${declaration.projectKey} · ${{ available: w.available, unavailable: w.unavailable, stale: w.stale }[declaration.evidenceState]}`, 'reader-lean-review-location'));
        const source = details(w.source); source.open = true;
        source.append(declaration.source ? element('p', sourceLabel(declaration.source), 'reader-lean-review-location') : element('p', w.sourceUnavailable));
        if (declaration.source) source.append(leanSourceSnapshot(declaration.source.content, declaration.source.startLine));
        const fullSource = button(w.fullSource, () => { void this.sourceViewer.open({ projectKey: declaration.projectKey,
            filePath: declaration.source?.filePath || declaration.compiledSource?.filePath || '', title: declaration.qualifiedName,
            range: declaration.source ? { start: { line: declaration.source.startLine - 1, character: 0 }, end: { line: declaration.source.endLine, character: 0 } } : undefined,
            fallback: declaration.source }); }, 'full-source');
        fullSource.disabled = !declaration.source?.filePath && !declaration.compiledSource?.filePath;
        fullSource.dataset.leanSourceDeclaration = declaration.key; source.append(fullSource);
        if (declaration.source?.truncated) source.append(element('p', w.truncated, 'reader-lean-review-warning'));
        if (declaration.source?.rangeKind === 'context') source.append(element('p', w.sourceContextWarning, 'reader-lean-review-warning'));
        const type = declaration.elaboratedType ? leanSourceSnapshot(declaration.elaboratedType) : code(w.typeUnavailable); type.classList.add('reader-lean-review-full-type');
        section.append(source, element('h4', w.fullType), element('p', w.typeHint, 'reader-lean-review-hint'), type);
        if (declaration.evidenceState !== 'available' || declaration.truncated) section.append(element('p', declaration.truncated ? w.truncated : declaration.evidenceState === 'stale' ? w.stale : w.typeUnavailable, 'reader-lean-review-warning'));
        if (declaration.value) { const value = details(w.definitionBody); value.append(leanSourceSnapshot(declaration.value)); section.append(value); }
        else if (!['theorem', 'lemma', 'axiom'].includes(declaration.kind)) {
            section.append(element('p', !declaration.source || declaration.source.rangeKind === 'context' || declaration.source.truncated
                ? w.definitionSourceIncomplete : w.definitionValueUnavailable, 'reader-lean-review-warning'));
        }
        const trust = details(w.trust); trust.append(element('h4', w.axioms));
        if (declaration.evidenceState !== 'available') trust.append(element('p', w.axiomsUnavailable, 'reader-lean-review-warning'));
        else if (!declaration.axioms.length) trust.append(element('p', w.noAxioms));
        else trust.append(this.names(declaration.axioms));
        trust.append(element('h4', w.proofDependencies));
        if (declaration.evidenceState !== 'available') trust.append(element('p', w.unavailable));
        else if (!declaration.proofDependencies.length) trust.append(element('p', w.noProofDependencies));
        else trust.append(this.names(declaration.proofDependencies.slice(0, 60)));
        if (declaration.proofDependencies.length > 60) trust.append(element('p', w.omittedDependencies, 'reader-lean-review-warning'));
        if (declaration.diagnostic) trust.append(this.diagnostics([declaration.diagnostic]));
        section.append(trust); return section;
    }
    private names(names: string[]): HTMLElement {
        const list = element('ul', '', 'reader-lean-review-names');
        names.forEach(name => { const item = element('li'); item.append(element('code', name)); if (name.includes('sorryAx')) item.classList.add('is-warning'); list.append(item); });
        return list;
    }
    private diagnostics(messages: string[]): HTMLElement { const list = element('ul', '', 'reader-lean-review-diagnostics'); messages.forEach(message => list.append(element('li', message))); return list; }
    private resetDefinition(): void { this.definitionRequest++; this.selectedDefinition = undefined; this.definition = undefined; this.definitionLoading = false; this.definitionTrail = []; }
    private renderDefinitions(declaration: DeclarationEvidence): HTMLElement {
        const w = this.words(), section = element('section', '', 'reader-lean-review-definitions'); section.append(element('h4', w.definition));
        if (!declaration.typeDependencies.length) section.append(element('p', declaration.evidenceState === 'available' ? w.noDefinitions : w.definitionUnavailable));
        const list = element('div', '', 'reader-lean-review-definition-list');
        for (const name of declaration.typeDependencies.slice(0, 40)) {
            const open = button(name, () => { void this.loadDefinition(declaration.projectKey, name); });
            open.dataset.leanDefinition = name;
            open.setAttribute('aria-pressed', String(this.selectedDefinition?.name === name && this.selectedDefinition.projectKey === declaration.projectKey)); list.append(open);
        }
        section.append(list);
        if (declaration.typeDependencies.length > 40) section.append(element('p', w.omittedDefinitions, 'reader-lean-review-warning'));
        if (this.selectedDefinition) {
            const content = element('div', '', 'reader-lean-review-definition-content');
            const path = element('p', this.definitionTrail.map(item => item.name).join(' › '), 'reader-lean-review-location'); content.append(path);
            if (this.definitionTrail.length > 1) content.append(button(w.definitionBack, () => {
                this.definitionTrail.pop(); const previous = this.definitionTrail[this.definitionTrail.length - 1];
                void this.loadDefinition(previous.projectKey, previous.name, 'back');
            }, 'definition-back'));
            if (this.definitionLoading) content.append(element('p', w.definitionLoading));
            else if (this.definition?.definition) {
                const definition = this.definition.definition; content.append(this.declarationCard(definition));
                const names = [...new Set([...definition.typeDependencies, ...definition.proofDependencies])].filter(name => name !== definition.qualifiedName);
                if (names.length) {
                    content.append(element('h4', w.definitionRelated));
                    const related = element('div', '', 'reader-lean-review-definition-list');
                    for (const name of names.slice(0, 40)) {
                        const open = button(name, () => { void this.loadDefinition(definition.projectKey, name, 'follow'); });
                        open.dataset.leanRelatedDefinition = name; related.append(open);
                    }
                    content.append(related);
                    if (names.length > 40) content.append(element('p', w.omittedDefinitions, 'reader-lean-review-warning'));
                }
            }
            else {
                content.append(element('p', w.definitionUnavailable));
                const selected = this.selectedDefinition;
                const read = button(w.readDefinition, () => { void this.startJob('expand', selected); }, 'expand'); read.disabled = this.busy || ['queued', 'running'].includes(this.job?.status || ''); content.append(read);
            }
            if (this.definition?.diagnostic) content.append(this.diagnostics([this.definition.diagnostic])); section.append(content);
        }
        return section;
    }
    private async loadDefinition(projectKey: string, name: string, navigation: 'root' | 'follow' | 'back' = 'root'): Promise<void> {
        if (!this.active || !this.payload) return;
        const identity = this.active, request = ++this.definitionRequest, declaration = this.selectedDeclaration, fingerprint = this.payload.evidence.fingerprint;
        if (navigation === 'root') this.definitionTrail = [{ projectKey, name }];
        else if (navigation === 'follow') this.definitionTrail.push({ projectKey, name });
        this.selectedDefinition = { projectKey, name }; this.definition = undefined; this.definitionLoading = true; this.render();
        try {
            const definition = await this.get<LeanDefinitionResponse>(`/api/lean-review/definition?id=${encodeURIComponent(identity.id)}&projectKey=${encodeURIComponent(projectKey)}&name=${encodeURIComponent(name)}`, this.payload.projectToken);
            if (!this.matches(identity) || request !== this.definitionRequest || declaration !== this.selectedDeclaration || fingerprint !== this.payload?.evidence.fingerprint) return;
            this.definition = definition; this.definitionLoading = false; this.render();
        } catch (error) {
            if (!this.matches(identity) || request !== this.definitionRequest || declaration !== this.selectedDeclaration || fingerprint !== this.payload?.evidence.fingerprint) return;
            this.definition = { state: 'unavailable', diagnostic: error instanceof Error ? error.message : String(error) }; this.definitionLoading = false; this.render();
        }
    }
    private renderChanges(title: string, changes: ReviewChange[], before?: LeanReviewEvidence): HTMLElement {
        const w = this.words(), section = details(`${title} · ${changes.length}`); section.className = 'reader-lean-review-changes';
        for (const change of changes) {
            const entry = element('section'); entry.append(element('h4', `${w.changedKinds[change.kind]} · ${change.label}`));
            for (const value of leanReviewDiffEntries(change, before, this.payload?.evidence)) {
                if (value.previous === undefined) entry.append(element('p', w.missingPrevious, 'reader-lean-review-location'));
                if (value.current === undefined) entry.append(element('p', w.removed, 'reader-lean-review-location'));
                if (value.previousSource || value.currentSource) entry.append(element('p',
                    `${value.previousSource ? sourceLabel(value.previousSource) : w.missingPrevious} → ${value.currentSource ? sourceLabel(value.currentSource) : w.removed}`,
                    'reader-lean-review-location'));
                entry.append(renderLeanSourceDiff(value.previous || '', value.current || '', { previous: w.previous, current: w.current, noNewline: w.noFinalNewline },
                    value.previousSource?.startLine || 1, value.currentSource?.startLine || 1));
                if (value.truncated) entry.append(element('p', w.truncated, 'reader-lean-review-warning'));
            }
            section.append(entry);
        }
        return section;
    }

    private auditSelection(): LeanAuditSelection {
        const declaration = this.payload?.evidence.declarations.find(item => item.key === this.selectedDeclaration);
        const source = declaration?.source;
        return { subclaimId: this.selectedClaim || undefined, declarationKey: declaration?.key, projectKey: declaration?.projectKey,
            filePath: source?.filePath, range: source ? { start: { line: source.startLine - 1, character: 0 }, end: { line: source.endLine, character: 0 } } : undefined,
            ...this.sourceViewer.currentSelection() };
    }

    private renderReview(): HTMLElement {
        const w = this.words(), draft = this.currentDraft()!, section = element('section', '', 'reader-lean-review-editor');
        section.append(element('h3', w.reviewTitle), element('p', w.reviewHint, 'reader-lean-review-hint'));
        this.draftStatus = element('p', '', 'reader-lean-review-draft-status'); this.draftStatus.setAttribute('role', 'status'); section.append(this.draftStatus);
        if (this.draftOutdated(draft)) {
            const actions = element('div', '', 'reader-lean-review-actions');
            const acknowledge = button(w.acknowledge, () => this.acknowledge(), 'acknowledge'); acknowledge.disabled = draft.needsReload;
            actions.append(button(w.retry, () => { void this.load(this.active!); }, 'reload'), acknowledge);
            if (this.payload!.review.record) actions.append(button(w.restore, () => { this.drafts.set(draftKey(this.active!.projectId, this.active!.id), this.newDraft(this.payload!)); this.selectedClaim = this.currentDraft()!.subclaims[0]?.id || ''; this.render(); }, 'restore'));
            section.append(actions);
        }
        const row = element('div', '', 'reader-lean-review-form-row');
        row.append(this.verdictSelect(w.verdict, draft.verdict, 'verdict', value => { draft.verdict = value; this.changed(); }),
            this.textField(w.reviewer, draft.reviewer, 'reviewer', value => { draft.reviewer = value; this.changed(); }, false));
        section.append(row, this.textField(w.scope, draft.scope, 'scope', value => { draft.scope = value; this.changed(); }, true, w.scopePlaceholder),
            this.textField(w.note, draft.note, 'note', value => { draft.note = value; this.changed(); }, true));
        const claims = element('div', '', 'reader-lean-review-subclaims'), navigation = element('div', '', 'reader-lean-review-claim-list');
        for (const [index, claim] of draft.subclaims.entries()) {
            const open = button(`${index + 1}. ${claim.text || w.claimText} · ${w.verdicts[claim.verdict]}${claim.declarationKeys.length ? '' : ' · ' + w.noMapping}`, () => {
                this.selectedClaim = claim.id;
                const mapped = claim.declarationKeys.find(key => this.payload!.evidence.declarations.some(declaration => declaration.key === key));
                if (mapped && mapped !== this.selectedDeclaration) { this.selectedDeclaration = mapped; this.resetDefinition(); }
                this.render();
            });
            open.dataset.leanClaim = claim.id; open.setAttribute('aria-pressed', String(claim.id === this.selectedClaim)); navigation.append(open);
        }
        if (!draft.subclaims.length) navigation.append(element('p', w.noClaims));
        const addClaim = button(w.addClaim, () => {
            if (draft.subclaims.length >= 80) return;
            const claim: ReviewSubclaim = { id: 'claim-' + crypto.randomUUID(), text: '', note: '', verdict: 'undecided', declarationKeys: [] };
            draft.subclaims.push(claim); this.selectedClaim = claim.id; this.changed(); this.render();
            this.section.querySelector<HTMLElement>('[data-lean-focus="claim-text"]')?.focus();
        }, 'add-claim'); addClaim.disabled = draft.subclaims.length >= 80; addClaim.title = w.maximumClaims; navigation.append(addClaim);
        claims.append(navigation);
        const claim = draft.subclaims.find(item => item.id === this.selectedClaim);
        if (claim) claims.append(this.renderClaim(claim));
        section.append(claims);
        const linked = new Set(draft.subclaims.flatMap(claim => claim.declarationKeys));
        section.append(element('p', w.unmapped(this.payload!.evidence.declarations.filter(declaration => !linked.has(declaration.key)).length), 'reader-lean-review-hint'));
        const footer = element('div', '', 'reader-lean-review-actions'); this.saveButton = button(w.save, () => { void this.save(); }, 'save');
        footer.append(this.saveButton, element('span', w.draftHint)); section.append(footer); return section;
    }
    private textField(labelText: string, value: string, key: string, update: (value: string) => void, multiline: boolean, placeholder = ''): HTMLLabelElement {
        const label = element('label', '', 'reader-lean-review-field'); label.append(element('span', labelText));
        const input = multiline ? element('textarea') : element('input'); input.value = value; input.dataset.leanFocus = key;
        input.placeholder = placeholder; input.maxLength = key === 'reviewer' ? 300 : key === 'note' ? 16000 : 8000;
        if (!multiline) (input as HTMLInputElement).type = 'text';
        input.addEventListener('input', () => update(input.value)); label.append(input); return label;
    }
    private verdictSelect(labelText: string, value: ReviewVerdict, key: string, update: (value: ReviewVerdict) => void): HTMLLabelElement {
        const label = element('label', '', 'reader-lean-review-field'), select = element('select'); label.append(element('span', labelText));
        select.dataset.leanFocus = key;
        verdicts.forEach(verdict => { const option = element('option', this.words().verdicts[verdict]); option.value = verdict; select.append(option); });
        select.value = value; select.addEventListener('change', () => update(select.value as ReviewVerdict)); label.append(select); return label;
    }
    private renderClaim(claim: ReviewSubclaim): HTMLElement {
        const w = this.words(), draft = this.currentDraft()!, editor = element('div', '', 'reader-lean-review-claim-editor');
        editor.append(this.textField(w.claimText, claim.text, 'claim-text', value => { claim.text = value; this.changed(); }, true, w.claimPlaceholder),
            this.verdictSelect(w.verdict, claim.verdict, 'claim-verdict', value => { claim.verdict = value; this.changed(); }),
            this.textField(w.claimNote, claim.note, 'claim-note', value => { claim.note = value; this.changed(); }, true));
        const mapping = element('fieldset', '', 'reader-lean-review-mapping'); mapping.append(element('legend', w.mapping));
        for (const declaration of this.payload!.evidence.declarations) {
            const label = element('label'), checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = claim.declarationKeys.includes(declaration.key);
            checkbox.dataset.leanMapping = declaration.key;
            checkbox.addEventListener('change', () => {
                claim.declarationKeys = checkbox.checked ? [...new Set([...claim.declarationKeys, declaration.key])] : claim.declarationKeys.filter(key => key !== declaration.key);
                this.changed(); this.render();
            });
            label.append(checkbox, element('code', `${declaration.projectKey} · ${declaration.qualifiedName}`)); mapping.append(label);
        }
        if (!this.payload!.evidence.declarations.length) mapping.append(element('p', w.noMapping));
        const missing = claim.declarationKeys.filter(key => !this.payload!.evidence.declarations.some(declaration => declaration.key === key));
        for (const key of missing) {
            const warning = element('div', '', 'reader-lean-review-missing-mapping');
            const remove = button(w.unmapMissing, () => { claim.declarationKeys = claim.declarationKeys.filter(item => item !== key); this.changed(); this.render(); }, 'unmap-missing');
            remove.dataset.leanMissingMapping = key;
            warning.append(element('p', w.missingMapping + ': ' + key, 'reader-lean-review-warning'), remove); mapping.append(warning);
        }
        editor.append(mapping, button(w.removeClaim, () => {
            draft.subclaims = draft.subclaims.filter(item => item.id !== claim.id); this.selectedClaim = draft.subclaims[0]?.id || ''; this.changed(); this.render();
        }, 'remove-claim')); return editor;
    }
    private acknowledge(): void {
        const draft = this.currentDraft(), payload = this.payload; if (!draft || !payload || draft.needsReload) return;
        draft.expectedRevision = payload.review.expectedRevision; draft.evidenceFingerprint = payload.evidence.fingerprint;
        draft.snapshot = payload.evidence; draft.projectToken = payload.projectToken; draft.acknowledgementRequired = false;
        draft.verdict = 'undecided'; draft.subclaims.forEach(claim => { claim.verdict = 'undecided'; });
        this.changed(); this.report(this.words().resetVerdicts); this.render();
    }
    private async save(): Promise<void> {
        const draft = this.currentDraft(), identity = this.active, payload = this.payload;
        if (!draft || !identity || !payload || !this.matches(identity) || this.busy || this.draftOutdated(draft)) return;
        if (!draft.scope.trim() || draft.subclaims.some(claim => !claim.text.trim())) { this.report(this.words().saveRequired, true); return; }
        const request = ++this.actionRequest, editVersion = draft.editVersion;
        const readVersion = ++this.loadRequest;
        const input: LeanReviewSaveInput = { id: draft.id, expectedRevision: draft.expectedRevision, evidenceFingerprint: draft.evidenceFingerprint,
            verdict: draft.verdict, scope: draft.scope, note: draft.note, reviewer: draft.reviewer, subclaims: cloneClaims(draft.subclaims) };
        this.busy = true; this.saving = true; this.updateDraftStatus();
        try {
            const response = await this.action<LeanReviewResponse>({ action: 'save', ...input }, draft.projectToken);
            if (!this.matches(identity) || request !== this.actionRequest) return;
            if (response.id !== identity.id || response.formal.filePath !== identity.filePath || response.projectToken !== identity.projectId) throw new Error(this.words().invalidResponse);
            if (readVersion !== this.loadRequest) {
                this.busy = false; this.saving = false; this.report(this.words().saved); this.updateDraftStatus();
                void this.load(identity); void this.loadQueue(identity); return;
            }
            if (editVersion === draft.editVersion) this.drafts.set(draftKey(identity.projectId, identity.id), this.newDraft(response));
            else { draft.expectedRevision = response.review.expectedRevision; draft.dirty = true; }
            this.accept(response, identity); this.busy = false; this.saving = false; this.report(this.words().saved); this.render(); void this.loadQueue(identity);
        } catch (error) {
            if (!this.matches(identity) || request !== this.actionRequest) return;
            this.busy = false; this.saving = false;
            if ((error as Error & { status?: number }).status === 409) { draft.acknowledgementRequired = true; draft.needsReload = true; this.report(this.words().conflict, true); }
            else this.report(this.words().saveFailed + ' ' + (error instanceof Error ? error.message : String(error)), true);
            this.render();
        }
    }

    private jobText(job: ReviewJob): string {
        const w = this.words();
        return ({ queued: w.jobQueued, running: w.jobRunning, completed: w.jobCompleted, failed: w.jobFailed, cancelled: w.jobCancelled })[job.status] + (job.error ? ': ' + job.error : '');
    }
    private async startJob(action: 'refresh' | 'expand', definition?: { projectKey: string; name: string }): Promise<void> {
        const identity = this.active, payload = this.payload;
        if (!identity || !payload || !this.matches(identity) || this.busy || ['queued', 'running'].includes(this.job?.status || '')) return;
        const request = ++this.actionRequest; this.busy = true; this.render();
        try {
            const result = await this.action<{ job: ReviewJob }>({ action, id: identity.id, ...(definition || {}) }, payload.projectToken);
            if (!this.matches(identity) || request !== this.actionRequest) return;
            this.busy = false; this.job = result.job; this.render(); this.pollJob(identity, result.job.id);
        } catch (error) {
            if (!this.matches(identity) || request !== this.actionRequest) return;
            this.busy = false; this.report(this.words().jobFailed + ' ' + (error instanceof Error ? error.message : String(error)), true); this.render();
        }
    }
    private pollJob(identity: RequestIdentity, jobId: string): void {
        this.clearTimers();
        this.pollTimer = setTimeout(() => { void this.readJob(identity, jobId); }, 700);
    }
    private async readJob(identity: RequestIdentity, jobId: string): Promise<void> {
        if (!this.matches(identity) || this.job?.id !== jobId || !this.payload) return;
        const request = ++this.jobReadRequest;
        try {
            const result = await this.get<{ job: ReviewJob }>('/api/lean-review/job?jobId=' + encodeURIComponent(jobId), this.payload.projectToken);
            if (!this.matches(identity) || this.job?.id !== jobId || request !== this.jobReadRequest) return;
            this.job = result.job;
            if (['queued', 'running'].includes(result.job.status)) { this.render(); this.pollJob(identity, jobId); return; }
            this.report(this.jobText(result.job), result.job.status === 'failed');
            const selected = this.selectedDefinition, trail = [...this.definitionTrail];
            await this.load(identity);
            if (!this.matches(identity)) return;
            if (selected && result.job.status === 'completed') { this.definitionTrail = trail; await this.loadDefinition(selected.projectKey, selected.name, 'back'); }
            void this.loadQueue(identity);
        } catch (error) {
            if (!this.matches(identity) || this.job?.id !== jobId || request !== this.jobReadRequest) return;
            this.report(this.words().jobFailed + ' ' + (error instanceof Error ? error.message : String(error)), true);
            this.job = { ...this.job, status: 'failed' }; this.render();
        }
    }
    private async cancelJob(): Promise<void> {
        const identity = this.active, job = this.job, payload = this.payload; if (!identity || !job || !payload || !this.matches(identity)) return;
        const request = ++this.jobReadRequest; this.clearTimers();
        try {
            const result = await this.action<{ job: ReviewJob }>({ action: 'cancel', jobId: job.id }, payload.projectToken);
            if (!this.matches(identity) || this.job?.id !== job.id || request !== this.jobReadRequest) return;
            this.job = result.job; this.clearTimers(); this.report(this.jobText(result.job)); this.render();
            if (['queued', 'running'].includes(result.job.status)) this.pollJob(identity, job.id);
        } catch (error) {
            if (!this.matches(identity) || this.job?.id !== job.id || request !== this.jobReadRequest) return;
            this.report(this.words().jobFailed + ' ' + String(error), true);
            if (['queued', 'running'].includes(this.job.status)) this.pollJob(identity, job.id);
        }
    }

    private renderAssistance(): HTMLElement {
        const w = this.words(), section = element('section', '', 'reader-lean-review-assistance');
        const context = leanReviewAssistance(this.payload!, this.currentDraft()!, this.host.context().language);
        const preview = details(w.assistContext); preview.append(code(context.text)); this.assistancePreview = preview;
        preview.addEventListener('toggle', () => {
            if (preview.open && this.payload && this.currentDraft()) preview.querySelector('code')!.textContent = leanReviewAssistance(this.payload, this.currentDraft()!, this.host.context().language).text;
        });
        if (context.truncated) preview.append(element('p', w.boundedContext, 'reader-lean-review-warning'));
        section.append(element('p', w.assistHint, 'reader-lean-review-hint'), preview,
            button(this.host.canAssist() ? w.assist : w.copyAssist, () => { void this.assist(); }, 'assist'));
        if (this.host.canAssist()) section.append(button(w.copyAssist, () => { void this.assist(true); }, 'copy-assist'));
        return section;
    }
    private async assist(copyOnly = false): Promise<void> {
        const identity = this.active, payload = this.payload, draft = this.currentDraft(); if (!identity || !payload || !draft || !this.matches(identity)) return;
        const context = leanReviewAssistance(payload, draft, this.host.context().language), w = this.words();
        try {
            if (!copyOnly && this.host.canAssist()) {
                await this.host.assist([{ type: 'resource', resource: { uri: `math-workspace://lean-review/${encodeURIComponent(identity.id)}?snapshot=${encodeURIComponent(payload.evidence.fingerprint)}`,
                    mimeType: 'text/markdown', text: context.text } }]);
                if (this.matches(identity)) this.report(w.assistDrafted);
            } else {
                const copied = await copyReaderText(context.text);
                if (this.matches(identity)) this.report(copied ? w.copied : w.copyFailed, !copied);
            }
        } catch (_error) { if (this.matches(identity)) this.report(w.assistFailed, true); }
    }
}
