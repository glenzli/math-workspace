import { readerFetch } from './reader-route';
import { createFormalRenderer, renderFormalMarkdown } from './formal-renderer';
import { readerIcon, type ReaderIconName } from './reader-icons';

interface ArchiveContext { language: 'zh' | 'en'; currentPath: string; token: string; project: string }
interface ArchiveVolumePointer { id: string; title?: string; record: string; bundle: string }
interface ArchiveChange { path: string; change: 'added' | 'removed' | 'modified' }
interface ArchivePendingVolume {
    id: string; title: string; files: number; changed: boolean; reused: boolean;
    record: string; bundle?: string; changes?: ArchiveChange[]; fileMap?: Record<string, string>; signed?: boolean;
}
interface ArchiveRow {
    id: string; label: string; kind: string; files: Record<string, string>; loggedAt: string | null;
    identity: { identity: string; issuer: string }; verification: string; contentComplete: boolean;
    missing: Array<{ path: string; expected: string }>; sequence?: number; payload: string; bundle: string;
    volumeId?: string; volumes?: ArchiveVolumePointer[]; outside?: Record<string, string>;
}
const copy = {
    zh: {
        title: '版本记录', close: '关闭', loading: '正在读取版本记录…', empty: '尚未启用版本记录。',
        hint: '查看历次原稿、版本变化与签署证据。签名状态与数学证明状态分别显示。',
        timeline: '历史记录', current: '当前文档', currentDraft: '当前工作稿', all: '全部文件', rootOnly: '总记录与作品快照', allRecords: '含分卷记录',
        verify: '验证签名', prepare: '准备签署', label: '版本名称', export: '导出验证材料', refresh: '刷新',
        unchecked: '尚未验签', verified: '签名已核验', invalid: '签名无效', complete: '原稿完整', incomplete: '原稿有缺口',
        changed: '当前内容尚未被链头覆盖', covered: '当前内容与链头一致', files: '文件', read: '查看原稿',
        compare: '比较版本', compareWith: '选择比较对象',
        compareHint: '将选中的记录与另一条历史记录或当前工作稿比较，查看新增、修改和移除的文件。',
        readingSource: '正在读取原稿，请稍候…', comparing: '正在比较文件变化，请稍候…', readingComparison: '正在读取两个版本的内容，请稍候…', noChanges: '文件内容相同。', raw: '源码', rendered: '查看原稿',
        sourceHint: '显示归档原稿；编号与引用未使用当前工作区的内容替换。',
        timeHint: '时间来自 bundle 的透明日志字段；核验后才确认其证据有效性。',
        pending: '待签记录', sign: '认证并签署', signHint: '依次签署变化的卷与总记录；未变卷保留原签名。认证期间修改正文会阻止入链。',
        legacyPendingHint: '旧单快照待签项请重新准备分卷及总记录；原准备字节保留。',
        import: '导入版本记录', importReview: '预览导入范围', importConfirm: '按此范围导入',
        scope: '记录范围', signer: '签署身份', importing: '正在处理；可以关闭窗口，稍后回来查看。',
        done: '操作完成', failed: '操作未完成', missing: '缺失引用', formalId: '按命题稳定 ID 追溯', search: '追溯',
        noMatch: '在现有版本记录中未找到匹配内容。', removed: '移除', added: '新增', modified: '修改',
        initHint: '选择已有 OET 留档导入，或使用 archive init 声明作品范围与身份。',
        previewOnly: '转换保留原始字节；导入不会创建新签名。', signatureScope: '签名核验不表示数学证明已经完成。',
        authenticate: '打开认证页面', authenticationHint: '请在认证页面完成登录，随后会自动继续签署。', code: '验证码',
        newSnapshot: '新版本记录', showDetails: '证据详情', returnList: '返回版本记录', returnChanges: '返回变更列表', returnTrace: '返回追溯结果', retry: '重新读取',
        volumes: '分卷', changedVolume: '需要新签', reusedVolume: '复用原签名', signedVolume: '新签已完成', total: '总记录', snapshot: '旧单快照',
        totalHint: '总记录绑定各卷原始记录与 bundle 的完整摘要，并覆盖以下卷外文件。',
        outside: '卷外文件', totalPending: '最后签署总记录', sourceChanged: '准备后正文已变化，请重新准备',
        signingBrowser: '正在签署；请在自动打开的浏览器中完成登录，随后由本机回调继续。',
        signingProgress: '签署进度', visibleHistory: '日常记录', includeHidden: '含本机隐藏记录', hidden: '本机隐藏',
        hiddenHint: '本机隐藏仅改变日常列表，活动链头不变；原始证据仍参与核验和完整导出，可随时恢复。',
        hide: '从日常列表隐藏；证据保留，可恢复，活动链头不变', restore: '恢复到日常列表；不改写原始证据',
        exportRecord: '导出此记录及原始证据', exportVolume: '独立导出此卷', binding: '绑定的分卷证据',
        noVolumes: '未声明分卷；总记录覆盖全部范围内文件。'
    },
    en: {
        title: 'Version history', close: 'Close', loading: 'Reading version history…', empty: 'Version history is not configured.',
        hint: 'Inspect original drafts, signing evidence and version changes. Proof status is recorded separately.',
        timeline: 'History', current: 'Current document', currentDraft: 'Current draft', all: 'All files', rootOnly: 'Totals and work snapshots', allRecords: 'Include volumes',
        verify: 'Verify signatures', prepare: 'Prepare for signing', label: 'Version label', export: 'Export evidence', refresh: 'Refresh',
        unchecked: 'Signature unchecked', verified: 'Signature verified', invalid: 'Signature invalid', complete: 'Source complete', incomplete: 'Source gaps',
        changed: 'Current source is not covered by the head', covered: 'Current source matches the head', files: 'files', read: 'View original',
        compare: 'Compare versions', compareWith: 'Choose a version to compare',
        compareHint: 'Compare the selected record with another record or the current draft to see added, modified and removed files.',
        readingSource: 'Reading the original draft. Please wait…', comparing: 'Comparing file changes. Please wait…', readingComparison: 'Reading both versions. Please wait…', noChanges: 'File contents are identical.', raw: 'Source', rendered: 'View original',
        sourceHint: 'This is the archived draft. Current workspace content does not replace its numbering or references.',
        timeHint: 'Time is read from the bundle transparency log; verification confirms the evidence.',
        pending: 'Prepared records', sign: 'Authenticate and sign', signHint: 'Sign changed volumes, then the total. Unchanged volumes retain their original signatures. Source changes during authentication prevent publication.',
        legacyPendingHint: 'Prepare a new volume-and-total record for this older pending snapshot; its original preparation is retained.',
        import: 'Import version history', importReview: 'Preview import', importConfirm: 'Import this scope',
        scope: 'Snapshot scope', signer: 'Signing identity', importing: 'Working. You may close this window and return later.',
        done: 'Operation completed', failed: 'Operation did not complete', missing: 'Missing references', formalId: 'Trace a stable formal ID', search: 'Trace',
        noMatch: 'No matching source was found in the available archives.', removed: 'Removed', added: 'Added', modified: 'Modified',
        initHint: 'Import an existing OET archive, or use archive init to declare a work scope and identity.',
        previewOnly: 'Conversion preserves original bytes. Importing creates no new signature.', signatureScope: 'Signature verification does not establish mathematical correctness.',
        authenticate: 'Open authentication page', authenticationHint: 'Complete sign-in on the authentication page. Signing will then continue automatically.', code: 'Verification code',
        newSnapshot: 'New version record', showDetails: 'Evidence details', returnList: 'Back to history', returnChanges: 'Back to changed files', returnTrace: 'Back to trace results', retry: 'Read again',
        volumes: 'Volumes', changedVolume: 'New signature needed', reusedVolume: 'Original signature reused', signedVolume: 'New signature completed', total: 'Total', snapshot: 'Older single snapshot',
        totalHint: 'The total binds each original volume record and bundle by full digest, and covers the outside-volume files below.',
        outside: 'Outside-volume files', totalPending: 'Sign the total last', sourceChanged: 'Source changed after preparation; prepare again',
        signingBrowser: 'Signing. Complete sign-in in the browser that opens; the local callback will continue the operation.',
        signingProgress: 'Signing progress', visibleHistory: 'Daily history', includeHidden: 'Include locally hidden records', hidden: 'Locally hidden',
        hiddenHint: 'Local hiding only changes the daily list; the active head is preserved. Original evidence remains in verification and full exports and can be restored.',
        hide: 'Hide from the daily list; evidence is recoverable and the active head is preserved', restore: 'Restore to the daily list; original evidence is preserved',
        exportRecord: 'Export this record and original evidence', exportVolume: 'Export this volume independently', binding: 'Bound volume evidence',
        noVolumes: 'No volumes are declared. The total covers all in-scope files.'
    }
};
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const result = document.createElement(tag); if (text) result.textContent = text; if (className) result.className = className; return result;
}
function button(text: string, action: () => void): HTMLButtonElement {
    const result = element('button', text); result.type = 'button'; result.addEventListener('click', action); return result;
}

function iconButton(text: string, icon: ReaderIconName, action: () => void): HTMLButtonElement {
    const result = button('', action);
    result.className = 'archive-icon-button';
    result.setAttribute('aria-label', text);
    result.dataset.tooltip = text;
    result.append(readerIcon(icon));
    return result;
}

export class ReaderArchive {
    private dialog?: HTMLDialogElement;
    private content?: HTMLElement;
    private header?: HTMLElement;
    private pageTitle = '';
    private pageReturnLabel = '';
    private pageHistory: Array<{
        nodes: Node[]; title: string; returnLabel: string; scrollTop: number;
        timelineScrollTop: number; focus: HTMLElement | null;
    }> = [];
    private live?: HTMLElement;
    private generation = 0;
    private project = '';
    private state: any;
    private rootOnly = true;
    private includeHidden = false;
    private currentOnly = false;
    private selected = '';
    private viewRequest = 0;
    private verified = new Set<string>();
    private readonly jobs = new Map<string, string>();
    private readonly startingJobs = new Set<string>();
    private readonly markdown = createFormalRenderer();
    constructor(private readonly context: () => ArchiveContext) {}
    private words() { return copy[this.context().language]; }
    private date(value: string | null) { return value ? new Date(value).toLocaleString(this.context().language) : '—'; }
    contextChanged(): void { if (this.dialog && this.project !== this.context().project) this.close(); }
    close(): void {
        this.generation++; this.dialog?.close(); this.dialog?.remove();
        this.dialog = undefined; this.content = undefined; this.header = undefined;
        this.pageHistory = []; this.pageTitle = ''; this.pageReturnLabel = '';
    }
    async open(): Promise<void> {
        const project = this.context().project;
        if (project !== this.project) { this.verified.clear(); this.selected = ''; this.includeHidden = false; }
        this.close(); this.project = project;
        const w = this.words(), dialog = element('dialog', '', 'reader-archive');
        dialog.setAttribute('aria-label', w.title);
        const header = element('header', '', 'archive-header'); this.header = header; this.renderHeader();
        this.live = element('p', '', 'archive-live'); this.live.setAttribute('role', 'status');
        this.content = element('div', '', 'archive-body'); dialog.append(header, this.live, this.content);
        document.body.append(dialog); dialog.addEventListener('cancel', () => this.close()); this.dialog = dialog; dialog.showModal();
        await this.refresh();
    }
    private renderHeader(): void {
        if (!this.header) return;
        const w = this.words(), title = element('div', '', 'archive-header-title');
        if (this.pageHistory.length) title.append(iconButton(this.pageReturnLabel, 'arrow-left', () => this.backPage()));
        title.append(element('h1', this.pageTitle || w.title));
        this.header.replaceChildren(title, iconButton(w.close, 'x', () => this.close()));
    }
    private openPage(title: string, returnLabel: string): HTMLElement {
        const content = this.content!, dialog = this.dialog!;
        this.pageHistory.push({ nodes: [...content.childNodes], title: this.pageTitle, returnLabel: this.pageReturnLabel,
            scrollTop: dialog.scrollTop, timelineScrollTop: content.querySelector('.archive-timeline')?.scrollTop || 0,
            focus: document.activeElement instanceof HTMLElement ? document.activeElement : null });
        this.viewRequest++;
        this.pageTitle = title; this.pageReturnLabel = returnLabel;
        const page = element('section', '', 'archive-page');
        content.replaceChildren(page); content.removeAttribute('aria-busy'); this.renderHeader();
        dialog.scrollTop = 0; this.header?.querySelector('button')?.focus({ preventScroll: true });
        return page;
    }
    private backPage(): void {
        const previous = this.pageHistory.pop();
        if (!previous || !this.content || !this.dialog) return;
        this.viewRequest++;
        this.pageTitle = previous.title; this.pageReturnLabel = previous.returnLabel;
        this.content.replaceChildren(...previous.nodes); this.content.removeAttribute('aria-busy'); this.renderHeader();
        const timeline = this.content.querySelector('.archive-timeline');
        if (timeline) timeline.scrollTop = previous.timelineScrollTop;
        this.dialog.scrollTop = previous.scrollTop;
        previous.focus?.focus({ preventScroll: true });
    }
    private async request(route: string, body?: unknown): Promise<any> {
        const token = this.context().token;
        const response = await readerFetch(route, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
            headers: { 'x-math-workspace-token': token, 'x-math-workspace-project': this.project, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (!response.ok) throw new Error(await response.text()); return response.json();
    }
    private report(message: string): void { if (this.live) this.live.textContent = message; }
    private allRows(): ArchiveRow[] {
        return [...new Map<string, ArchiveRow>([...(this.state.records || []), ...(this.state.hiddenRecords || [])]
            .map((row: ArchiveRow) => [row.id, row] as [string, ArchiveRow])).values()]
            .sort((a, b) => (b.loggedAt || '').localeCompare(a.loggedAt || '') || a.id.localeCompare(b.id));
    }
    private isHidden(id: string): boolean { return (this.state.hiddenRecords || []).some((row: ArchiveRow) => row.id === id); }
    private signatureLabel(row: ArchiveRow): string {
        const w = this.words();
        if (row.verification === 'invalid' || row.verification === 'failed') return w.invalid;
        return row.verification === 'verified' || this.verified.has(row.id) ? w.verified : w.unchecked;
    }
    private mutationButton(text: string, icon: ReaderIconName, body: { action: string; [name: string]: unknown }): HTMLButtonElement {
        const action = iconButton(text, icon, () => void this.startJob(body));
        action.dataset.archiveMutation = 'true'; action.disabled = this.startingJobs.has(this.project) || this.jobs.has(this.project);
        return action;
    }
    private selectRecord(id: string): void {
        const row = this.allRows().find(value => value.id === id);
        if (!row) return;
        this.selected = id; this.includeHidden ||= this.isHidden(id); this.rootOnly = row.kind !== 'volume';
        if (!Object.hasOwn(row.files, this.context().currentPath)) this.currentOnly = false;
        this.render();
    }
    private async refresh(): Promise<void> {
        const generation = ++this.generation; this.report(this.words().loading);
        try {
            const state = await this.request('/api/archive');
            if (generation !== this.generation || !this.content) return;
            this.state = state; this.report(''); this.render();
            const job = this.jobs.get(this.project);
            if (job) void this.pollJob(job, generation).catch(error => {
                if (generation === this.generation) { this.verified.clear(); this.render(); this.report(String(error)); }
            });
        } catch (error) { if (generation === this.generation) { this.verified.clear(); this.report(String(error)); this.content?.replaceChildren(iconButton(this.words().retry, 'reload', () => void this.refresh())); } }
    }
    private render(): void {
        if (!this.content) return;
        this.viewRequest++;
        this.content.removeAttribute('aria-busy');
        this.pageHistory = []; this.pageTitle = ''; this.pageReturnLabel = ''; this.renderHeader();
        const w = this.words(), state = this.state;
        this.content.replaceChildren(element('p', w.hint, 'archive-hint'));
        if (!state.configured) {
            this.content.append(element('h2', w.empty), element('p', w.initHint));
            this.renderImport(); return;
        }
        const tools = element('div', '', 'archive-actions');
        tools.append(this.mutationButton(w.verify, 'verify', { action: 'verify' }), iconButton(w.refresh, 'reload', () => void this.refresh()),
            iconButton(w.export, 'download', () => void this.download()));
        this.content.append(tools, element('p', `${state.policy.title} · ${state.current.files} ${w.files} · ${state.current.coveredByHead ? w.covered : w.changed}`, 'archive-summary'));
        this.renderPrepare(); this.renderImport();
        const filter = element('div', '', 'archive-filters');
        const kind = element('select'); kind.setAttribute('aria-label', w.timeline);
        for (const [value, text] of [['root', w.rootOnly], ['all', w.allRecords]]) { const option = element('option', text); option.value = value; kind.append(option); }
        kind.value = this.rootOnly ? 'root' : 'all'; kind.onchange = () => { this.rootOnly = kind.value === 'root'; this.render(); };
        const current = iconButton(this.currentOnly ? w.all : w.current, 'locate', () => { this.currentOnly = !this.currentOnly; this.render(); });
        current.setAttribute('aria-pressed', String(this.currentOnly));
        const trace = element('input'); trace.placeholder = w.formalId; trace.setAttribute('aria-label', w.formalId);
        filter.append(kind, current, trace, iconButton(w.search, 'search', () => void this.trace(trace.value)));
        if (state.hiddenRecords?.length || this.includeHidden) {
            const visibility = element('select'); visibility.setAttribute('aria-label', w.hidden);
            for (const [value, text] of [['active', w.visibleHistory], ['all', `${w.includeHidden} (${state.hiddenRecords?.length || 0})`]]) {
                const option = element('option', text); option.value = value; visibility.append(option);
            }
            visibility.value = this.includeHidden ? 'all' : 'active';
            visibility.onchange = () => { this.includeHidden = visibility.value === 'all'; this.render(); };
            filter.append(visibility);
        }
        this.content.append(filter);
        if (state.hiddenRecords?.length) this.content.append(element('p', w.hiddenHint, 'archive-hint'));
        const rows: ArchiveRow[] = (this.includeHidden ? this.allRows() : state.records).filter((row: ArchiveRow) => (!this.rootOnly || row.kind !== 'volume')
            && (!this.currentOnly || Object.hasOwn(row.files, this.context().currentPath)));
        const layout = element('div', '', 'archive-layout'), timeline = element('nav', '', 'archive-timeline');
        timeline.setAttribute('aria-label', w.timeline);
        const selected = rows.find(row => row.id === this.selected) || rows[0];
        if (selected) this.selected = selected.id;
        for (const row of rows) {
            const item = button('', () => { this.selected = row.id; this.render(); }); item.className = 'archive-record' + (this.selected === row.id ? ' is-selected' : '');
            const date = row.loggedAt ? new Date(row.loggedAt).toLocaleString(this.context().language === 'zh' ? 'zh-CN' : 'en-US') : '—';
            item.append(element('strong', date), element('span', row.label), element('small', row.identity.identity),
                element('small', `${this.signatureLabel(row)} · ${row.contentComplete ? w.complete : w.incomplete}`,
                    row.contentComplete && !['invalid', 'failed'].includes(row.verification) ? '' : 'archive-gap'));
            if (this.isHidden(row.id)) item.append(element('small', w.hidden));
            if (row.kind === 'total' || row.kind === 'snapshot') item.append(element('small', row.kind === 'total' ? w.total : w.snapshot));
            timeline.append(item);
        }
        if (!rows.length) timeline.append(element('p', w.noMatch));
        const detail = element('section', '', 'archive-detail');
        if (selected) this.renderDetail(detail, selected);
        layout.append(timeline, detail); this.content.append(layout, element('p', w.timeHint, 'archive-hint'));
    }
    private renderPrepare(): void {
        const w = this.words(), details = element('details', '', 'archive-management');
        details.open = Boolean(this.state.pending?.length);
        details.append(element('summary', w.prepare));
        const label = element('input'); label.placeholder = w.label; label.setAttribute('aria-label', w.label);
        const scope = element('pre', JSON.stringify(this.state.policy.scope, null, 2));
        const prepare = iconButton(w.prepare, 'plus', () => void this.startJob({ action: 'prepare', label: label.value }));
        prepare.dataset.archiveMutation = 'true'; prepare.disabled = this.startingJobs.has(this.project) || this.jobs.has(this.project);
        details.append(element('p', `${w.signer}: ${this.state.policy.signingIdentity.identity}`), element('p', w.scope), scope);
        if (this.state.policy.volumes?.length) {
            const volumes = element('details'); volumes.append(element('summary', w.volumes));
            for (const volume of this.state.policy.volumes) volumes.append(element('p', `${volume.title || volume.id}: ${volume.paths.join(', ')}`));
            details.append(volumes);
        } else details.append(element('p', w.noVolumes, 'archive-hint'));
        details.append(label, prepare);
        for (const pending of this.state.pending || []) {
            const row = element('div', '', 'archive-pending');
            const preview = element('details'); preview.append(element('summary', `${pending.files} ${w.files} · ${pending.changes.length} ${w.modified}`));
            for (const change of pending.changes) preview.append(element('p', `${w[change.change as 'added' | 'removed' | 'modified']} · ${change.path}`));
            row.append(element('strong', `${w.pending}: ${pending.label}`), preview);
            if (pending.scheme === 'volume-total') {
                for (const volume of (pending.volumes || []) as ArchivePendingVolume[]) {
                    const volumeDetail = element('details');
                    volumeDetail.append(element('summary', `${volume.title || volume.id} · ${volume.files} ${w.files} · ${volume.reused ? w.reusedVolume : volume.signed ? w.signedVolume : w.changedVolume}`));
                    volumeDetail.append(element('pre', `Payload SHA-256\n${volume.record}${volume.bundle ? `\n\nBundle SHA-256\n${volume.bundle}` : ''}`));
                    if (volume.fileMap) for (const name of Object.keys(volume.fileMap).sort()) volumeDetail.append(element('pre', `${name}\nSHA-256 ${volume.fileMap[name]}`));
                    for (const change of volume.changes || []) volumeDetail.append(element('p', `${w[change.change]} · ${change.path}`));
                    row.append(volumeDetail);
                }
                row.append(element('p', w.totalHint, 'archive-hint'));
                this.renderOutside(row, pending.outside, pending.outsideFiles);
                row.append(element('p', w.totalPending));
            }
            const supported = pending.scheme === 'volume-total';
            const hint = !supported ? w.legacyPendingHint : pending.currentMatches ? w.signHint : w.sourceChanged;
            const sign = this.mutationButton(!supported ? w.legacyPendingHint : pending.currentMatches ? w.sign : w.sourceChanged, 'marker-pen',
                { action: 'sign', prepared: pending.prepared, authFlow: 'normal' });
            sign.disabled ||= !pending.currentMatches || !supported;
            row.append(element('p', hint,
                pending.currentMatches ? 'archive-hint' : 'archive-gap'), sign); details.append(row);
        }
        this.content!.append(details);
    }
    private renderOutside(target: HTMLElement, files?: Record<string, string>, count = 0): void {
        const w = this.words(), details = element('details');
        details.append(element('summary', `${w.outside} (${files ? Object.keys(files).length : count})`));
        if (files) for (const name of Object.keys(files).sort()) details.append(element('pre', `${name}\nSHA-256 ${files[name]}`));
        target.append(details);
    }
    private renderImport(): void {
        for (const source of this.state.compatibleSources || []) {
            const box = element('details', '', 'archive-management'); box.append(element('summary', `${this.words().import}: ${source.title}`));
            box.append(element('p', source.path), iconButton(this.words().importReview, 'search', () => void this.previewImport(box, source.path)));
            this.content!.append(box);
        }
    }
    private async previewImport(box: HTMLElement, source: string): Promise<void> {
        const generation = this.generation;
        try {
            const preview = await this.request('/api/archive/oet-preview?source=' + encodeURIComponent(source));
            if (generation !== this.generation || !box.isConnected) return;
            const w = this.words(); box.replaceChildren(element('summary', w.import), element('p', w.previewOnly),
                element('p', `${preview.records} ${w.timeline}`), element('p', w.scope), element('pre', JSON.stringify(preview.policy.scope, null, 2)),
                element('p', w.signer), element('pre', preview.policy.identities.map((identity: any) => `${identity.identity}\n${identity.issuer}`).join('\n\n')),
                this.mutationButton(w.importConfirm, 'plus', { action: 'import-oet', source, initialize: !this.state.configured, policy: preview.policy }));
        } catch (error) { this.report(String(error)); }
    }
    private renderDetail(target: HTMLElement, row: ArchiveRow): void {
        const w = this.words(); target.append(element('h2', row.label));
        target.append(element('p', `${this.signatureLabel(row)} · ${row.contentComplete ? w.complete : w.incomplete}`,
            row.contentComplete && !['invalid', 'failed'].includes(row.verification) ? 'archive-hint' : 'archive-gap'));
        const actions = element('div', '', 'archive-actions');
        actions.append(iconButton(row.kind === 'volume' ? w.exportVolume : w.exportRecord, 'download', () => void this.download(row.id)));
        const hidden = this.isHidden(row.id);
        const visibility = this.mutationButton(hidden ? w.restore : w.hide,
            hidden ? 'visible' : 'hidden', { action: hidden ? 'restore' : 'hide', record: row.id });
        actions.append(visibility); target.append(actions);
        if (hidden) target.append(element('p', w.hiddenHint, 'archive-hint'));
        const evidence = element('details'); evidence.append(element('summary', w.showDetails),
            element('pre', `Payload SHA-256\n${row.payload}\n\nBundle SHA-256\n${row.bundle}\n\n${row.identity.identity}\n${row.identity.issuer}`), element('p', w.signatureScope)); target.append(evidence);
        if (row.missing.length) {
            const gaps = element('details'); gaps.append(element('summary', `${w.missing} (${row.missing.length})`));
            for (const gap of row.missing) gaps.append(element('p', gap.path, 'archive-gap')); target.append(gaps);
        }
        if (row.kind === 'total') {
            const volumes = element('details'); volumes.append(element('summary', `${w.binding} (${row.volumes?.length || 0})`));
            const records = this.allRows();
            for (const pointer of row.volumes || []) {
                const volume = records.find(value => value.payload === pointer.record && value.bundle === pointer.bundle);
                const title = volume?.label || pointer.title || pointer.id;
                const item = element('div'); item.append(element('strong', title),
                    element('pre', `Payload SHA-256\n${pointer.record}\n\nBundle SHA-256\n${pointer.bundle}`));
                if (volume) item.append(iconButton(w.read, 'definition', () => this.selectRecord(volume.id)),
                    iconButton(w.exportVolume, 'download', () => void this.download(volume.id)));
                volumes.append(item);
            }
            target.append(volumes, element('p', w.totalHint, 'archive-hint')); this.renderOutside(target, row.outside);
        }
        const compare = element('select'); compare.setAttribute('aria-label', w.compareWith);
        const placeholder = element('option', w.compareWith); placeholder.value = ''; compare.append(placeholder);
        const current = element('option', w.currentDraft); current.value = 'current'; compare.append(current);
        for (const other of (this.includeHidden ? this.allRows() : this.state.records) as ArchiveRow[]) {
            if (other.id === row.id || other.kind === 'volume') continue;
            const option = element('option', `${this.date(other.loggedAt)} · ${other.label}`); option.value = other.id; compare.append(option);
        }
        const compareButton = iconButton(w.compare, 'compare', () => void this.compare(row, compare.value, this.openPage(w.compare, w.returnList)));
        compareButton.disabled = true;
        compare.onchange = () => { compareButton.disabled = !compare.value; };
        target.append(element('p', w.compareHint, 'archive-hint'), compare, compareButton);
        const list = element('div', '', 'archive-files');
        for (const name of Object.keys(row.files).filter(name => name.endsWith('.md')).sort()) list.append(button(name, () => void this.read(row.id, name, this.openPage(w.read, w.returnList))));
        target.append(list);
    }
    private feedback(target: HTMLElement, title: string, message: string, retry?: () => void): void {
        const w = this.words(), view = element('div', '', 'archive-feedback');
        view.append(element('h2', title));
        const status = element('p', '', 'archive-loading');
        status.setAttribute('role', retry ? 'alert' : 'status');
        if (!retry) {
            const spinner = element('span', '', 'archive-spinner'); spinner.setAttribute('aria-hidden', 'true'); status.append(spinner);
        }
        status.append(element('span', retry ? `${w.failed}: ${message}` : message));
        view.append(status);
        if (retry) view.append(button(w.retry, retry));
        target.setAttribute('aria-busy', String(!retry));
        target.replaceChildren(view); target.scrollIntoView({ block: 'start' });
    }
    private isCurrentView(generation: number, request: number, target: HTMLElement): boolean {
        return generation === this.generation && request === this.viewRequest && target.isConnected;
    }
    private async read(id: string, name: string, target: HTMLElement): Promise<void> {
        const generation = this.generation, request = ++this.viewRequest;
        this.feedback(target, name, this.words().readingSource);
        try {
            const source = await this.request(`/api/archive/source?record=${encodeURIComponent(id)}&file=${encodeURIComponent(name)}`);
            if (!this.isCurrentView(generation, request, target)) return;
            const w = this.words(), article = element('article', '', 'archive-original markdown-body');
            const render = () => { const template = document.createElement('template');
                template.innerHTML = renderFormalMarkdown(this.markdown, source.content,
                { currentFilePath: name, labels: {}, pages: [], language: this.context().language });
                // Original evidence must not resolve images or file links against today's workspace.
                template.content.querySelectorAll('img').forEach(image => image.replaceWith(element('span', image.alt || '[image]')));
                template.content.querySelectorAll<HTMLAnchorElement>('a').forEach(link => { link.removeAttribute('href'); });
                article.replaceChildren(template.content);
            };
            target.replaceChildren(element('h2', name), element('p', w.sourceHint, 'archive-hint'),
                button(w.rendered, render), button(w.raw, () => article.replaceChildren(element('pre', source.content))), article);
            render(); target.removeAttribute('aria-busy'); target.scrollIntoView({ block: 'start' });
        } catch (error) {
            if (this.isCurrentView(generation, request, target)) this.feedback(target, name, String(error), () => void this.read(id, name, target));
        }
    }
    private async compare(left: ArchiveRow, rightId: string, target: HTMLElement): Promise<void> {
        if (rightId !== 'current' && !/^[a-f0-9]{64}$/.test(rightId)) { this.report(this.words().compareWith); return; }
        const generation = this.generation, request = ++this.viewRequest;
        this.feedback(target, this.words().compare, this.words().comparing);
        try {
            const result = await this.request(`/api/archive/compare?left=${left.id}&right=${rightId}`);
            if (!this.isCurrentView(generation, request, target)) return;
            const w = this.words(), right = this.allRows().find((row: ArchiveRow) => row.id === rightId);
            const leftLabel = `${this.date(left.loggedAt)} · ${left.label}`;
            const rightLabel = rightId === 'current' ? w.currentDraft : `${this.date(right.loggedAt)} · ${right.label}`;
            target.replaceChildren(element('p', `${leftLabel} → ${rightLabel}`, 'archive-comparison-summary'));
            if (!result.changes.length) target.append(element('p', w.noChanges));
            const changes = element('div', '', 'archive-files');
            for (const change of result.changes) {
                changes.append(button(`${w[change.change as 'added' | 'removed' | 'modified']} · ${change.path}`, () => {
                    const preview = this.openPage(w.compare, w.returnChanges);
                    const showComparison = async () => {
                        const previewRequest = ++this.viewRequest;
                        this.feedback(preview, change.path, w.readingComparison);
                        const readSide = async (id: string) => {
                            const record = this.allRows().find((row: ArchiveRow) => row.id === id);
                            if (id === 'current' ? change.change === 'removed' : !record || !Object.hasOwn(record.files, change.path)) return '';
                            return (await this.request(`/api/archive/source?record=${id}&file=${encodeURIComponent(change.path)}`)).content;
                        };
                        try {
                            const [a, b] = await Promise.all([readSide(left.id), readSide(rightId)]);
                            if (!this.isCurrentView(generation, previewRequest, preview)) return;
                            const before = element('section'), after = element('section'), diff = element('div', '', 'archive-diff');
                            before.append(element('h3', leftLabel), element('pre', a)); after.append(element('h3', rightLabel), element('pre', b));
                            diff.append(before, after);
                            preview.replaceChildren(element('h2', change.path), diff); preview.removeAttribute('aria-busy');
                        } catch (error) {
                            if (this.isCurrentView(generation, previewRequest, preview)) this.feedback(preview, change.path, String(error), () => void showComparison());
                        }
                    };
                    void showComparison();
                }));
            }
            target.append(changes); target.removeAttribute('aria-busy'); target.scrollIntoView({ block: 'start' });
        } catch (error) {
            if (this.isCurrentView(generation, request, target)) this.feedback(target, this.words().compare, String(error), () => void this.compare(left, rightId, target));
        }
    }
    private async trace(value: string): Promise<void> {
        const generation = this.generation, request = ++this.viewRequest;
        try {
            const result = await this.request('/api/archive/history?formalId=' + encodeURIComponent(value.replace(/^[@#]/, '').trim()));
            if (generation !== this.generation || request !== this.viewRequest || !this.content) return;
            const w = this.words(), list = element('div', '', 'archive-files');
            this.content.replaceChildren(iconButton(w.returnList, 'arrow-left', () => this.render()), element('h2', w.formalId));
            if (!result.matches.length) list.append(element('p', w.noMatch));
            for (const match of result.matches) list.append(button(`${this.date(match.loggedAt)} · ${match.filePath}:${match.line}`, () => void this.read(match.recordId, match.filePath, this.openPage(w.read, w.returnTrace))));
            this.content.append(list);
        } catch (error) { this.report(String(error)); }
    }
    private async startJob(body: { action: string; [name: string]: unknown }): Promise<void> {
        const generation = this.generation, project = this.project;
        if (this.startingJobs.has(project) || this.jobs.has(project)) return;
        this.startingJobs.add(project);
        if (body.action === 'verify') this.verified.clear();
        this.render();
        try {
            const job = await this.request('/api/archive/action', body);
            this.jobs.set(project, job.id); this.startingJobs.delete(project);
            if (project !== this.project || !this.dialog) return;
            if (generation !== this.generation) this.render();
            await this.pollJob(job.id, this.generation);
        } catch (error) {
            this.startingJobs.delete(project);
            if (generation === this.generation && project === this.project) {
                this.verified.clear(); this.render(); this.report(String(error));
            }
        }
    }
    private renderJobStatus(job: any): void {
        if (!this.live) return;
        const w = this.words(), auth = job.authentication;
        if (auth) {
            let hint = this.live.querySelector<HTMLElement>('.archive-authentication-hint');
            if (this.live.querySelector('a')?.getAttribute('href') !== auth.url || !hint) {
                const link = element('a', w.authenticate); link.href = auth.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
                hint = element('span', '', 'archive-authentication-hint'); this.live.replaceChildren(link, hint);
            }
            hint.textContent = `${auth.code ? ` · ${w.code}: ${auth.code}.` : ''} ${w.authenticationHint}`;
        } else this.report(job.action === 'sign' ? w.signingBrowser : w.importing);
        let progress = this.live.querySelector<HTMLElement>('.archive-operation-progress');
        if (!progress) { progress = element('span', '', 'archive-operation-progress'); this.live.append(progress); }
        progress.textContent = job.progress
            ? ` ${job.action === 'sign' ? w.signingProgress + ': ' : ''}${job.progress.done}/${job.progress.total}${job.progress.label ? ` · ${job.progress.label}` : ''}` : '';
    }
    private async pollJob(id: string, generation: number): Promise<void> {
        const project = this.project;
        while (this.dialog && generation === this.generation) {
            const job = await this.request('/api/archive/job?id=' + encodeURIComponent(id));
            if (generation !== this.generation) return;
            if (job.state === 'running') {
                this.renderJobStatus(job);
                await new Promise(resolve => setTimeout(resolve, 1000)); continue;
            }
            if (this.jobs.get(project) === id) this.jobs.delete(project);
            if (job.state === 'completed') {
                if (job.action === 'verify') this.verified = new Set([...(job.result.records || []), ...(job.result.hiddenRecords || [])]
                    .filter((row: ArchiveRow) => row.verification === 'verified').map((row: ArchiveRow) => row.id));
                await this.refresh(); this.report(this.words().done);
            } else {
                if (job.action === 'verify') this.verified.clear();
                this.render(); this.report(`${this.words().failed}: ${job.error}`);
            }
            return;
        }
    }
    private async download(record?: string): Promise<void> {
        try {
            const exchange = await this.request('/api/archive/export' + (record ? '?record=' + encodeURIComponent(record) : ''));
            const url = URL.createObjectURL(new Blob([JSON.stringify(exchange) + '\n'], { type: 'application/json' }));
            const link = element('a'); link.href = url; link.download = `${exchange.workId}${record ? '-' + record : ''}-archive.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { this.report(String(error)); }
    }
}
