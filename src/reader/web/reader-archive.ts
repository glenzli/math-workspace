import { createFormalRenderer, renderFormalMarkdown } from './formal-renderer';
import { readerIcon, type ReaderIconName } from './reader-icons';

interface ArchiveContext { language: 'zh' | 'en'; currentPath: string; token: string; project: string }
interface ArchiveRow {
    id: string; label: string; kind: string; files: Record<string, string>; loggedAt: string | null;
    identity: { identity: string; issuer: string }; verification: string; contentComplete: boolean;
    missing: Array<{ path: string; expected: string }>; sequence?: number; payload: string; bundle: string;
}
const copy = {
    zh: {
        title: '版本记录', close: '关闭', loading: '正在读取版本记录…', empty: '尚未启用版本记录。',
        hint: '查看历次原稿、版本变化与签署证据。签名状态与数学证明状态分别显示。',
        timeline: '历史记录', current: '当前文档', currentDraft: '当前工作稿', all: '全部文件', rootOnly: '作品快照', allRecords: '含分卷记录',
        verify: '验证签名', prepare: '准备签署', label: '版本名称', export: '导出验证材料', refresh: '刷新',
        unchecked: '尚未验签', verified: '签名已核验', complete: '原稿完整', incomplete: '原稿有缺口',
        changed: '当前内容尚未被链头覆盖', covered: '当前内容与链头一致', files: '文件', read: '查看原稿',
        compare: '比较版本', compareWith: '选择比较对象',
        compareHint: '将选中的记录与另一条历史记录或当前工作稿比较，查看新增、修改和移除的文件。',
        readingSource: '正在读取原稿，请稍候…', comparing: '正在比较文件变化，请稍候…', readingComparison: '正在读取两个版本的内容，请稍候…', noChanges: '文件内容相同。', raw: '源码', rendered: '查看原稿',
        sourceHint: '显示归档原稿；编号与引用未使用当前工作区的内容替换。',
        timeHint: '时间来自 bundle 的透明日志字段；核验后才确认其证据有效性。',
        pending: '待签记录', sign: '认证并签署', signHint: '将签署已准备的快照。认证期间修改正文会阻止入链。',
        import: '导入版本记录', importReview: '预览导入范围', importConfirm: '按此范围导入',
        scope: '记录范围', signer: '签署身份', importing: '正在处理；可以关闭窗口，稍后回来查看。',
        done: '操作完成', failed: '操作未完成', missing: '缺失引用', formalId: '按命题稳定 ID 追溯', search: '追溯',
        noMatch: '在现有版本记录中未找到匹配内容。', removed: '移除', added: '新增', modified: '修改',
        initHint: '选择已有 OET 留档导入，或使用 archive init 声明作品范围与身份。',
        previewOnly: '转换保留原始字节；导入不会创建新签名。', signatureScope: '签名核验不表示数学证明已经完成。',
        authenticate: '打开认证页面', authenticationHint: '请在认证页面完成登录，随后会自动继续签署。', code: '验证码',
        newSnapshot: '新版本记录', showDetails: '证据详情', returnList: '返回版本记录', returnChanges: '返回变更列表', returnTrace: '返回追溯结果', retry: '重新读取'
    },
    en: {
        title: 'Version history', close: 'Close', loading: 'Reading version history…', empty: 'Version history is not configured.',
        hint: 'Inspect original drafts, signing evidence and version changes. Proof status is recorded separately.',
        timeline: 'History', current: 'Current document', currentDraft: 'Current draft', all: 'All files', rootOnly: 'Work snapshots', allRecords: 'Include volumes',
        verify: 'Verify signatures', prepare: 'Prepare for signing', label: 'Version label', export: 'Export evidence', refresh: 'Refresh',
        unchecked: 'Signature unchecked', verified: 'Signature verified', complete: 'Source complete', incomplete: 'Source gaps',
        changed: 'Current source is not covered by the head', covered: 'Current source matches the head', files: 'files', read: 'View original',
        compare: 'Compare versions', compareWith: 'Choose a version to compare',
        compareHint: 'Compare the selected record with another record or the current draft to see added, modified and removed files.',
        readingSource: 'Reading the original draft. Please wait…', comparing: 'Comparing file changes. Please wait…', readingComparison: 'Reading both versions. Please wait…', noChanges: 'File contents are identical.', raw: 'Source', rendered: 'View original',
        sourceHint: 'This is the archived draft. Current workspace content does not replace its numbering or references.',
        timeHint: 'Time is read from the bundle transparency log; verification confirms the evidence.',
        pending: 'Prepared snapshots', sign: 'Authenticate and sign', signHint: 'Sign the prepared snapshot. Source changes during authentication prevent publication.',
        import: 'Import version history', importReview: 'Preview import', importConfirm: 'Import this scope',
        scope: 'Snapshot scope', signer: 'Signing identity', importing: 'Working. You may close this window and return later.',
        done: 'Operation completed', failed: 'Operation did not complete', missing: 'Missing references', formalId: 'Trace a stable formal ID', search: 'Trace',
        noMatch: 'No matching source was found in the available archives.', removed: 'Removed', added: 'Added', modified: 'Modified',
        initHint: 'Import an existing OET archive, or use archive init to declare a work scope and identity.',
        previewOnly: 'Conversion preserves original bytes. Importing creates no new signature.', signatureScope: 'Signature verification does not establish mathematical correctness.',
        authenticate: 'Open authentication page', authenticationHint: 'Complete sign-in on the authentication page. Signing will then continue automatically.', code: 'Verification code',
        newSnapshot: 'New version record', showDetails: 'Evidence details', returnList: 'Back to history', returnChanges: 'Back to changed files', returnTrace: 'Back to trace results', retry: 'Read again'
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
    private currentOnly = false;
    private selected = '';
    private viewRequest = 0;
    private verified = new Set<string>();
    private job?: { id: string; project: string };
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
        this.close(); this.project = this.context().project;
        const w = this.words(), dialog = element('dialog', '', 'reader-archive');
        dialog.setAttribute('aria-label', w.title);
        const header = element('header', '', 'archive-header'); this.header = header; this.renderHeader();
        this.live = element('p', '', 'archive-live'); this.live.setAttribute('role', 'status');
        this.content = element('div', '', 'archive-body'); dialog.append(header, this.live, this.content);
        document.body.append(dialog); dialog.addEventListener('cancel', () => this.close()); this.dialog = dialog; dialog.showModal();
        await this.refresh();
        if (this.job?.project === this.project) void this.pollJob(this.job.id, this.generation).catch(error => this.report(String(error)));
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
        const response = await fetch(route, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
            headers: { 'x-math-workspace-token': token, 'x-math-workspace-project': this.project, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (!response.ok) throw new Error(await response.text()); return response.json();
    }
    private report(message: string): void { if (this.live) this.live.textContent = message; }
    private async refresh(): Promise<void> {
        const generation = ++this.generation; this.report(this.words().loading);
        try {
            const state = await this.request('/api/archive');
            if (generation !== this.generation || !this.content) return;
            this.state = state; this.report(''); this.render();
        } catch (error) { if (generation === this.generation) { this.report(String(error)); this.content?.replaceChildren(button(this.words().retry, () => void this.refresh())); } }
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
        tools.append(iconButton(w.verify, 'verify', () => void this.startJob({ action: 'verify' })), iconButton(w.refresh, 'reload', () => void this.refresh()),
            iconButton(w.export, 'download', () => void this.download()));
        this.content.append(tools, element('p', `${state.policy.title} · ${state.current.files} ${w.files} · ${state.current.coveredByHead ? w.covered : w.changed}`, 'archive-summary'));
        this.renderPrepare(); this.renderImport();
        const filter = element('div', '', 'archive-filters');
        const kind = element('select'); kind.setAttribute('aria-label', w.timeline);
        for (const [value, text] of [['root', w.rootOnly], ['all', w.allRecords]]) { const option = element('option', text); option.value = value; kind.append(option); }
        kind.value = this.rootOnly ? 'root' : 'all'; kind.onchange = () => { this.rootOnly = kind.value === 'root'; this.render(); };
        const current = button(this.currentOnly ? w.all : w.current, () => { this.currentOnly = !this.currentOnly; this.render(); });
        current.setAttribute('aria-pressed', String(this.currentOnly));
        const trace = element('input'); trace.placeholder = w.formalId; trace.setAttribute('aria-label', w.formalId);
        filter.append(kind, current, trace, iconButton(w.search, 'search', () => void this.trace(trace.value)));
        this.content.append(filter);
        const rows: ArchiveRow[] = state.records.filter((row: ArchiveRow) => (!this.rootOnly || row.kind !== 'volume')
            && (!this.currentOnly || Object.hasOwn(row.files, this.context().currentPath)));
        const layout = element('div', '', 'archive-layout'), timeline = element('nav', '', 'archive-timeline');
        timeline.setAttribute('aria-label', w.timeline);
        const selected = rows.find(row => row.id === this.selected) || rows[0];
        if (selected) this.selected = selected.id;
        for (const row of rows) {
            const item = button('', () => { this.selected = row.id; this.render(); }); item.className = 'archive-record' + (this.selected === row.id ? ' is-selected' : '');
            const date = row.loggedAt ? new Date(row.loggedAt).toLocaleString(this.context().language === 'zh' ? 'zh-CN' : 'en-US') : '—';
            item.append(element('strong', date), element('span', row.label), element('small', row.identity.identity),
                element('small', `${this.verified.has(row.id) ? w.verified : w.unchecked} · ${row.contentComplete ? w.complete : w.incomplete}`, row.contentComplete ? '' : 'archive-gap'));
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
        details.append(element('p', `${w.signer}: ${this.state.policy.signingIdentity.identity}`), element('p', w.scope), scope, label, button(w.prepare, () => void this.startJob({ action: 'prepare', label: label.value })));
        for (const pending of this.state.pending || []) {
            const row = element('div', '', 'archive-pending');
            const preview = element('details'); preview.append(element('summary', `${pending.files} ${w.files} · ${pending.changes.length} ${w.modified}`));
            for (const change of pending.changes) preview.append(element('p', `${w[change.change as 'added' | 'removed' | 'modified']} · ${change.path}`));
            const sign = button(w.sign, () => void this.startJob({ action: 'sign', prepared: pending.prepared })); sign.disabled = !pending.currentMatches;
            row.append(element('strong', `${w.pending}: ${pending.label}`), preview, element('p', w.signHint), sign); details.append(row);
        }
        this.content!.append(details);
    }
    private renderImport(): void {
        for (const source of this.state.compatibleSources || []) {
            const box = element('details', '', 'archive-management'); box.append(element('summary', `${this.words().import}: ${source.title}`));
            box.append(element('p', source.path), button(this.words().importReview, () => void this.previewImport(box, source.path)));
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
                button(w.importConfirm, () => void this.startJob({ action: 'import-oet', source, initialize: !this.state.configured, policy: preview.policy })));
        } catch (error) { this.report(String(error)); }
    }
    private renderDetail(target: HTMLElement, row: ArchiveRow): void {
        const w = this.words(); target.append(element('h2', row.label));
        const evidence = element('details'); evidence.append(element('summary', w.showDetails),
            element('pre', `Payload SHA-256\n${row.payload}\n\nBundle SHA-256\n${row.bundle}\n\n${row.identity.identity}\n${row.identity.issuer}`), element('p', w.signatureScope)); target.append(evidence);
        if (row.missing.length) {
            const gaps = element('details'); gaps.append(element('summary', `${w.missing} (${row.missing.length})`));
            for (const gap of row.missing) gaps.append(element('p', gap.path, 'archive-gap')); target.append(gaps);
        }
        const compare = element('select'); compare.setAttribute('aria-label', w.compareWith);
        const placeholder = element('option', w.compareWith); placeholder.value = ''; compare.append(placeholder);
        const current = element('option', w.currentDraft); current.value = 'current'; compare.append(current);
        for (const other of this.state.records as ArchiveRow[]) {
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
            const w = this.words(), right = this.state.records.find((row: ArchiveRow) => row.id === rightId);
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
                            const record = this.state.records.find((row: ArchiveRow) => row.id === id);
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
    private async startJob(body: unknown): Promise<void> {
        const generation = this.generation, project = this.project;
        try {
            const job = await this.request('/api/archive/action', body);
            this.job = { id: job.id, project };
            if (generation !== this.generation || project !== this.project) return;
            await this.pollJob(job.id, generation);
        } catch (error) { if (generation === this.generation) this.report(String(error)); }
    }
    private async pollJob(id: string, generation: number): Promise<void> {
        while (this.dialog && generation === this.generation) {
            const job = await this.request('/api/archive/job?id=' + encodeURIComponent(id));
            if (generation !== this.generation) return;
            if (job.state === 'running') {
                const w = this.words(), auth = job.authentication;
                if (auth && this.live) {
                    if (this.live.querySelector('a')?.getAttribute('href') !== auth.url) {
                        const link = element('a', w.authenticate); link.href = auth.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
                        this.live.replaceChildren(link, element('span', ` · ${w.code}: ${auth.code}. ${w.authenticationHint}`));
                    }
                } else this.report(w.importing + (job.progress ? ` ${job.progress.done}/${job.progress.total}` : ''));
                await new Promise(resolve => setTimeout(resolve, 1000)); continue;
            }
            this.job = undefined;
            if (job.state === 'completed') {
                if (job.action === 'verify') this.verified = new Set((job.result.records || []).map((row: ArchiveRow) => row.id));
                await this.refresh(); this.report(this.words().done);
            } else this.report(`${this.words().failed}: ${job.error}`);
            return;
        }
    }
    private async download(): Promise<void> {
        try {
            const exchange = await this.request('/api/archive/export');
            const url = URL.createObjectURL(new Blob([JSON.stringify(exchange) + '\n'], { type: 'application/json' }));
            const link = element('a'); link.href = url; link.download = `${exchange.workId}-archive.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { this.report(String(error)); }
    }
}
