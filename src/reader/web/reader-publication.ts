import { readerFetch } from './reader-route';
import { readerIcon, type ReaderIconName } from './reader-icons';
import { ReaderPublicationPdf } from './reader-publication-pdf';
import type {
    PublicationArtifact, PublicationBuild, PublicationInspection, PublicationPlan,
    PublicationProfile, PublicationProfileRecord, PublicationStatus, PublicationManifest, PublicationUploadPlan, PublicationPage
} from '../../publication/types';

interface PublicationContext { language: 'zh' | 'en'; token: string; project: string }
interface PublicationJob {
    id: string; action: string; state: 'running' | 'completed' | 'failed'; phase: string;
    result?: any; error?: string;
}
interface Inspection extends PublicationInspection { job?: PublicationJob }

const copy = {
    zh: {
        title: 'PDF 出版', close: '关闭', refresh: '刷新出版状态', loading: '正在读取出版计划…',
        intro: '选择这次出版的章节，审阅范围与版面，再生成可留存的 PDF。每一版都保留独立的文件与标识。',
        steps: ['章节', '版面与信息', '审阅范围', 'PDF 与 DOI'], plan: '出版计划', newPlan: '新建计划',
        planName: '计划名称', planHint: '用于再次打开这份计划；名称可以包含字母、数字和短横线。',
        work: '作品标识', workHint: '同一作品的后续版本沿用这个标识。', save: '保存出版计划', saved: '出版计划已保存。',
        selectHint: '只纳入已勾选的章节，并按下面的顺序排版。', all: '全选', none: '清空选择',
        ungrouped: '其他章节', selectedCount: '已选章节', titleField: '书名 / 标题', subtitle: '副标题',
        author: '作者（每行一位）', version: '本版版本', edition: '版次说明', license: '许可协议',
        description: '作品介绍', publicationDate: '出版日期', cover: '封面', coverHint: '默认使用书名、副标题、作者与版本制作文字封面。',
        coverImage: '封面图片（可选，项目内的相对路径）', coverVersion: '封面显示版本',
        front: '写在前面', back: '结语', addMatter: '添加', removeMatter: '移除', matterTitle: '标题', matterText: '正文（支持 Markdown）',
        matterFile: '使用项目内的现有文件（可选）',
        toc: '目录', tocEnabled: '自动生成目录', inToc: '纳入目录', tocTitle: '目录标题', tocDepth: '目录层级',
        continued: '未完待续', continuedEnabled: '为未收录全书的版本附上“未完待续”声明',
        continuedText: '声明正文（留空使用默认文字）', review: '保存并审阅本版',
        reviewHint: '生成前确认本版的确切范围。修改计划后，需要重新审阅。', selected: '本版收录', omitted: '本版未收录',
        external: '指向本版范围以外的引用', noExternal: '未发现指向未收录章节的引用。',
        externalHint: '这些引用不会自动把其他章节加入本版。请确认当前内容能独立阅读。',
        acknowledge: '我已核对收录、未收录章节和范围以外的引用。', build: '生成本版 PDF',
        needReview: '请先保存并审阅当前计划，再确认本版范围。', noSelection: '请至少选择一个章节。',
        reviewReady: '范围已准备好，请核对本版章节。', noBuild: '尚未生成本版 PDF。',
        toolsMissing: '本机缺少 PDF 排版工具。可以先保存计划，安装工具后再生成。',
        running: '正在处理', failed: '操作未完成', completed: '已完成', retry: '重新读取状态',
        frozen: '本版文件已固定；后续修改会生成另一份出版文件。', preview: '预览 PDF', download: '下载 PDF',
        manifest: '下载本版清单', citation: '下载引用信息', previewTitle: '本版 PDF 预览', closePreview: '关闭 PDF 预览',
        builtAt: '生成时间', doi: 'DOI 与持续版本', doiHint: '作品 DOI 标识整个作品；本版 DOI 标识这一版 PDF。',
        manual: '手动填入 DOI', versionDoi: '本版 DOI', conceptDoi: '作品 DOI（跨版本）',
        provenance: 'DOI 来源说明', manualHint: '手动填写的信息不会自动验证或注册。保存后重新审阅并生成，才能印入 PDF。',
        zenodo: 'Zenodo', environment: '存放位置', sandbox: 'Zenodo 测试环境', production: 'Zenodo 正式环境',
        credentialReady: '当前进程已配置 Zenodo 凭证。', credentialMissing: '当前进程尚未配置 Zenodo 凭证。',
        reserve: '预留本版 DOI', reserved: 'DOI 已预留；草稿尚未公开，预留不等于公开注册。',
        attach: '连接已有草稿或记录', remoteId: 'Zenodo 草稿 / 记录编号', remoteKind: '连接类型',
        draftKind: '未发布草稿', recordKind: '已发布记录', newVersion: '为同一作品创建新版本',
        published: '这一版已经公开发布。继续修订时，请明确创建新版本；旧版会保留。',
        draft: '未发布草稿', remoteUnknown: '远端结果待核对。请先连接已有草稿或记录，再继续。',
        upload: '上传已审阅 PDF', uploadHint: '上传的是下面这份已生成的 PDF；计划后续修改不会替换它。',
        uploaded: '已上传本版 PDF，尚未公开发布。', publish: '公开发布这一版',
        reviewUpload: '审阅将上传的文件', uploadFiles: '上传本次列出的文件变更', remoteFiles: '草稿中的现有文件',
        addFiles: '将添加', replaceFiles: '将替换', removeFiles: '将移除的旧版文件', blockedFiles: '需先在 Zenodo 核对的其他材料',
        blockedHint: '发现其他材料时，不会上传或删除文件。请先在 Zenodo 整理草稿，然后重新审阅。',
        filesUnchanged: '没有这一类变更。',
        publishCheck: '我确认将下面的 PDF 和信息公开发布到 Zenodo。', publishWarning: '公开发布后保留该版记录。此操作需要最后明确确认。',
        remoteRecord: 'Zenodo 记录', oldEditions: '保留的旧版', noRemote: '尚未连接 Zenodo 草稿。',
        exactPdf: '本版文件校验值', needBuildReserved: '预留或修改 DOI 后，请重新审阅并生成 PDF，再上传。',
        confirmNew: '我确认创建同一作品的新版本，并保留已发布的旧版。', errors: '错误详情',
        empty: '项目中尚无可出版章节。', language: '出版语言', zh: '中文', en: 'English',
        resume: '已续接本项目的出版操作。', reviewDoi: '印入本版的 DOI', noDoi: '未设置',
        buildPhase: '正在排版 PDF…', savePhase: '正在保存计划…', reviewPhase: '正在核对章节与引用…',
        remotePhase: '正在处理 Zenodo 操作…', checkPhase: '检查出版内容', compilePhase: '整理章节',
        renderPhase: '排版 PDF', retainPhase: '保存本版文件', noToken: 'Reader 项目状态尚未准备好，请刷新后重试。'
    },
    en: {
        title: 'PDF publication', close: 'Close', refresh: 'Refresh publication status', loading: 'Loading publication plans…',
        intro: 'Select this edition’s chapters, review its scope and layout, then create a PDF to keep. Each edition retains its own files and identity.',
        steps: ['Chapters', 'Layout & details', 'Review scope', 'PDF & DOI'], plan: 'Publication plan', newPlan: 'New plan',
        planName: 'Plan name', planHint: 'Use letters, numbers and hyphens to identify this reusable plan.',
        work: 'Work identity', workHint: 'Keep this identity for later versions of the same work.', save: 'Save publication plan', saved: 'Publication plan saved.',
        selectHint: 'Only checked chapters are included, in the order shown below.', all: 'Select all', none: 'Clear selection',
        ungrouped: 'Other chapters', selectedCount: 'Selected chapters', titleField: 'Book title / title', subtitle: 'Subtitle',
        author: 'Authors (one per line)', version: 'Edition version', edition: 'Edition note', license: 'License',
        description: 'Description', publicationDate: 'Publication date', cover: 'Cover', coverHint: 'The default text cover uses the title, subtitle, authors and version.',
        coverImage: 'Cover image (optional, path within this project)', coverVersion: 'Show version on cover',
        front: 'Preface', back: 'Conclusion', addMatter: 'Add', removeMatter: 'Remove', matterTitle: 'Heading', matterText: 'Text (Markdown supported)',
        matterFile: 'Use an existing file within the project (optional)',
        toc: 'Contents', tocEnabled: 'Generate table of contents', inToc: 'Include in contents', tocTitle: 'Contents heading', tocDepth: 'Contents depth',
        continued: 'To be continued', continuedEnabled: 'Add a “To be continued” declaration when chapters are omitted',
        continuedText: 'Declaration text (leave blank for the default)', review: 'Save and review this edition',
        reviewHint: 'Check the exact scope before building. Editing the plan requires a fresh review.', selected: 'Included in this edition', omitted: 'Omitted from this edition',
        external: 'References outside this edition', noExternal: 'No references to omitted chapters were found.',
        externalHint: 'These references do not add other chapters automatically. Check that the selected text stands on its own.',
        acknowledge: 'I have checked the included and omitted chapters and references outside this edition.', build: 'Build this edition’s PDF',
        needReview: 'Save and review the current plan, then confirm its scope before building.', noSelection: 'Select at least one chapter.',
        reviewReady: 'The scope is ready to review.', noBuild: 'No PDF has been built for this edition yet.',
        toolsMissing: 'PDF typesetting tools are unavailable on this computer. Save the plan and build after installing them.',
        running: 'Working', failed: 'Operation did not complete', completed: 'Completed', retry: 'Read status again',
        frozen: 'These edition files are fixed. Later edits create another publication file.', preview: 'Preview PDF', download: 'Download PDF',
        manifest: 'Download edition manifest', citation: 'Download citation data', previewTitle: 'Edition PDF preview', closePreview: 'Close PDF preview',
        builtAt: 'Built', doi: 'DOI & continuing versions', doiHint: 'The work DOI identifies the whole work; the edition DOI identifies this PDF edition.',
        manual: 'Enter DOI manually', versionDoi: 'Edition DOI', conceptDoi: 'Work DOI (all versions)',
        provenance: 'DOI source note', manualHint: 'Manual information is not verified or registered automatically. Save, review and rebuild to print it in the PDF.',
        zenodo: 'Zenodo', environment: 'Destination', sandbox: 'Zenodo sandbox', production: 'Zenodo public service',
        credentialReady: 'Zenodo credentials are configured for the current process.', credentialMissing: 'Zenodo credentials are not configured for the current process.',
        reserve: 'Reserve edition DOI', reserved: 'The DOI is reserved. This draft is private; reservation is not public registration.',
        attach: 'Connect an existing draft or record', remoteId: 'Zenodo draft / record number', remoteKind: 'Connection type',
        draftKind: 'Unpublished draft', recordKind: 'Published record', newVersion: 'Create a new version of this work',
        published: 'This edition is published. To continue revising, explicitly create a new version; the old edition is retained.',
        draft: 'Unpublished draft', remoteUnknown: 'The remote result needs checking. Connect the existing draft or record before continuing.',
        upload: 'Upload reviewed PDF', uploadHint: 'Upload the fixed PDF shown below. Later plan edits do not replace it.',
        uploaded: 'This PDF is uploaded and has not been published.', publish: 'Publish this edition publicly',
        reviewUpload: 'Review files before upload', uploadFiles: 'Upload the listed file changes', remoteFiles: 'Files currently in the draft',
        addFiles: 'To add', replaceFiles: 'To replace', removeFiles: 'Retained edition files to remove', blockedFiles: 'Other material to check on Zenodo',
        blockedHint: 'Other material prevents upload. No files will be uploaded or deleted. Organize the draft on Zenodo, then review again.',
        filesUnchanged: 'No changes of this kind.',
        publishCheck: 'I confirm publishing the PDF and details shown below publicly on Zenodo.', publishWarning: 'Publishing retains this edition as a public record. An explicit final confirmation is required.',
        remoteRecord: 'Zenodo record', oldEditions: 'Retained editions', noRemote: 'No Zenodo draft is connected.',
        exactPdf: 'PDF checksum', needBuildReserved: 'After reserving or changing a DOI, review and rebuild the PDF before uploading.',
        confirmNew: 'I confirm creating a new version of the same work and retaining the published edition.', errors: 'Error details',
        empty: 'This project has no chapters available to publish.', language: 'Publication language', zh: '中文', en: 'English',
        resume: 'Resumed this project’s publication operation.', reviewDoi: 'DOI printed in this edition', noDoi: 'Not set',
        buildPhase: 'Typesetting PDF…', savePhase: 'Saving plan…', reviewPhase: 'Checking chapters and references…',
        remotePhase: 'Processing Zenodo action…', checkPhase: 'Checking edition content', compilePhase: 'Preparing chapters',
        renderPhase: 'Typesetting PDF', retainPhase: 'Saving edition files', noToken: 'Reader project state is not ready. Refresh and try again.'
    }
};

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const value = document.createElement(tag); value.textContent = text; if (className) value.className = className; return value;
}
function icon(label: string, glyph: ReaderIconName, run: () => void, primary = false): HTMLButtonElement {
    const value = node('button', '', 'publication-icon' + (primary ? ' is-primary' : ''));
    value.type = 'button'; value.title = label; value.setAttribute('aria-label', label); value.dataset.tooltip = label;
    value.append(readerIcon(glyph)); value.addEventListener('click', run); return value;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function pageTitle(page: PublicationPage): string {
    const title = (page.title || '').trim(), number = (page.number || '').trim();
    if (!title || !number) return title || number;
    const prefix = Array.from(number.replace(/\s/g, '')).map(character => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    return new RegExp(`^${prefix}(?=$|[\\s\\p{P}\\p{S}])`, 'iu').test(title) ? title : `${number} · ${title}`;
}

/** Owns the complete publication dialog, its project identity, requests, polling and blob lifetimes. */
export class ReaderPublication {
    private dialog?: HTMLDialogElement;
    private content?: HTMLElement;
    private live?: HTMLElement;
    private project = '';
    private token = '';
    private locale = '';
    private generation = 0;
    private controller = new AbortController();
    private timer?: ReturnType<typeof setTimeout>;
    private inspection?: Inspection;
    private profile?: PublicationProfile;
    private revision: number | null = null;
    private status?: PublicationStatus;
    private plan?: PublicationPlan;
    private build?: PublicationBuild;
    private manifest?: PublicationManifest;
    private uploadPlan?: PublicationUploadPlan;
    private job?: PublicationJob;
    private busy = false;
    private dirty = false;
    private scopeConfirmed = false;
    private publishConfirmed = false;
    private versionConfirmed = false;
    private step = 0;
    private viewRequest = 0;
    private statusRequest = 0;
    private returnFocus?: HTMLElement;
    private preview?: HTMLElement;
    private pdfPreview?: ReaderPublicationPdf;
    private readonly blobs = new Set<string>();
    private readonly handledJobs = new Set<string>();
    constructor(private readonly context: () => PublicationContext) {}
    private words() { return copy[this.context().language]; }
    private current(generation: number): boolean {
        const context = this.context();
        return !!this.dialog && generation === this.generation && this.project === context.project && this.token === context.token;
    }
    contextChanged(): void {
        const context = this.context();
        if (this.dialog && (context.project !== this.project || context.token !== this.token)) this.close();
        else if (this.dialog && context.language !== this.locale) { this.locale = context.language; this.render(); }
    }
    close(): void {
        ++this.generation; this.controller.abort(); if (this.timer) clearTimeout(this.timer); this.timer = undefined;
        this.clearPreview(); for (const url of this.blobs) URL.revokeObjectURL(url); this.blobs.clear();
        this.dialog?.close(); this.dialog?.remove(); this.dialog = undefined; this.content = undefined; this.live = undefined;
        this.busy = false; this.publishConfirmed = false; this.versionConfirmed = false;
        if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    }
    async open(): Promise<void> {
        const context = this.context(), previousProject = this.project;
        this.close(); this.project = context.project; this.token = context.token; this.locale = context.language;
        this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        if (previousProject !== this.project) {
            this.profile = undefined; this.revision = null; this.status = undefined; this.plan = undefined;
            this.build = undefined; this.manifest = undefined; this.job = undefined; this.dirty = false; this.scopeConfirmed = false; this.step = 0;
        }
        this.controller = new AbortController();
        const w = this.words(), dialog = node('dialog', '', 'reader-publication');
        dialog.setAttribute('aria-label', w.title);
        const header = node('header', '', 'publication-header');
        header.append(node('h1', w.title), icon(w.close, 'x', () => this.close()));
        this.live = node('p', '', 'publication-live'); this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite');
        this.content = node('div', '', 'publication-body'); dialog.append(header, this.live, this.content);
        this.dialog = dialog; document.body.append(dialog); dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
        dialog.showModal(); await this.refresh();
    }
    private async request<T>(route: string, body?: unknown, generation = this.generation): Promise<T> {
        if (!this.project || !this.token || !this.current(generation)) throw new Error(this.words().noToken);
        const response = await readerFetch(route, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
            headers: { 'x-math-workspace-token': this.token, 'x-math-workspace-project': this.project,
                ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: this.controller.signal });
        if (!this.current(generation)) throw new Error('Publication context changed.');
        if (!response.ok) throw new Error(await response.text());
        return response.json();
    }
    private report(message: string, failed = false): void {
        if (!this.live) return;
        if (failed) {
            const details = node('details', '', 'publication-error-details'); details.append(node('summary', this.words().errors), node('pre', message));
            this.live.replaceChildren(node('span', this.words().failed), details);
        } else this.live.textContent = message;
        this.live.classList.toggle('is-error', failed);
    }
    private async refresh(): Promise<void> {
        const generation = this.generation; this.busy = true; this.render(); this.report(this.words().loading);
        try {
            const inspection = await this.request<Inspection>('/api/publication', undefined, generation);
            if (!this.current(generation)) return;
            this.inspection = inspection;
            if (!this.profile) this.chooseProfile(inspection.profiles[0]);
            if (this.profile && this.revision !== null) await this.readStatus(generation);
            if (!this.current(generation)) return;
            this.job = inspection.job; this.busy = this.job?.state === 'running'; this.render(); this.report('');
            if (this.job?.state === 'completed' && !this.handledJobs.has(this.job.id)) {
                this.acceptResumedResult(this.job); await this.readStatus(generation); this.render();
            } else if (this.job?.state === 'failed' && !this.handledJobs.has(this.job.id)) {
                this.handledJobs.add(this.job.id); this.report(this.job.error || this.words().failed, true);
            }
            if (this.busy) {
                this.report(this.words().resume); const action = this.job!.action, result = await this.poll(this.job!, generation);
                if (result && this.current(generation)) {
                    this.acceptResumedResult({ ...this.job!, action, result });
                    await this.readStatus(generation); this.render();
                }
            }
        } catch (error) { if (this.current(generation)) { this.busy = false; this.report(String(error), true); this.render(); } }
    }
    private acceptResumedResult(job: PublicationJob): void {
        this.handledJobs.add(job.id); const result = job.result;
        if (job.action === 'save' && result?.profile?.id === this.profile?.id) {
            this.profile = clone(result.profile); this.revision = result.revision; this.dirty = false;
        } else if (job.action === 'review' && result?.profile?.id === this.profile?.id) {
            this.plan = result; this.scopeConfirmed = false; this.step = 2;
        } else if (job.action === 'build' && result?.profileId === this.profile?.id) {
            this.build = result; this.manifest = undefined; this.step = 3;
        } else if (job.action === 'review-upload' && result?.profileId === this.profile?.id) this.uploadPlan = result;
    }
    private chooseProfile(record?: PublicationProfileRecord): void {
        ++this.viewRequest;
        const w = this.words();
        this.profile = record ? clone(record.profile) : this.inspection?.defaultProfile ? clone(this.inspection.defaultProfile) : {
            id: 'publication', workId: 'publication', title: '', version: '1.0', authors: [],
            language: this.context().language, license: 'CC-BY-4.0', chapters: [],
            cover: { showVersion: true }, frontMatter: [{ title: w.front, content: '', includeInToc: true }],
            backMatter: [{ title: w.back, content: '', includeInToc: true }], toc: { enabled: true, depth: 2, title: w.toc },
            continued: { enabled: true }, zenodo: { environment: 'sandbox' }
        };
        this.revision = record?.revision ?? null; this.status = undefined; this.plan = undefined; this.build = undefined; this.manifest = undefined; this.uploadPlan = undefined;
        this.dirty = !record; this.scopeConfirmed = false; this.publishConfirmed = false; this.versionConfirmed = false;
    }
    private async readStatus(generation = this.generation): Promise<void> {
        if (!this.profile || this.revision === null) return;
        const profileId = this.profile.id, view = this.viewRequest, request = ++this.statusRequest;
        const status = await this.request<PublicationStatus>('/api/publication/status?profile=' + encodeURIComponent(profileId), undefined, generation);
        if (!this.current(generation) || this.profile?.id !== profileId || view !== this.viewRequest || request !== this.statusRequest) return;
        this.status = status;
        if (!this.dirty) { this.profile = clone(status.profile.profile); this.revision = status.profile.revision; }
        this.build = this.build || status.builds[0];
        if (this.build && this.manifest?.buildId !== this.build.id) {
            const buildId = this.build.id;
            const manifest = await this.request<PublicationManifest>(`/api/publication/artifact?profile=${encodeURIComponent(profileId)}&build=${encodeURIComponent(buildId)}&file=manifest.json`, undefined, generation);
            if (this.current(generation) && this.profile?.id === profileId && this.build?.id === buildId && view === this.viewRequest && request === this.statusRequest) this.manifest = manifest;
        }
    }
    private changed(): void {
        this.dirty = true; this.plan = undefined; this.uploadPlan = undefined; this.scopeConfirmed = false; this.publishConfirmed = false;
        this.content?.querySelector<HTMLButtonElement>('[data-build]')?.setAttribute('disabled', '');
    }
    private input(parent: HTMLElement, label: string, value: string, update: (value: string) => void, multiline = false, hint = '', invalidate = true): HTMLInputElement | HTMLTextAreaElement {
        const field = node('label', '', 'publication-field'), control = multiline ? node('textarea') : node('input');
        if (control instanceof HTMLInputElement) control.type = 'text';
        control.value = value; control.setAttribute('aria-label', label);
        control.addEventListener('input', () => { update(control.value); if (invalidate) this.changed(); });
        field.append(node('span', label), control); if (hint) field.append(node('small', hint)); parent.append(field); return control;
    }
    private check(parent: HTMLElement, label: string, value: boolean, update: (value: boolean) => void): HTMLInputElement {
        const field = node('label', '', 'publication-check'), control = node('input'); control.type = 'checkbox'; control.checked = value;
        control.addEventListener('change', () => update(control.checked)); field.append(control, node('span', label)); parent.append(field); return control;
    }
    private render(): void {
        if (!this.content) return;
        this.clearPreview(); const w = this.words();
        this.dialog?.setAttribute('aria-label', w.title);
        const header = this.dialog?.querySelector('.publication-header');
        header?.replaceChildren(node('h1', w.title), icon(w.close, 'x', () => this.close()));
        const content = this.content; content.replaceChildren(node('p', w.intro, 'publication-intro'));
        const nav = node('nav', '', 'publication-steps'); nav.setAttribute('aria-label', w.title);
        w.steps.forEach((label, index) => {
            const button = node('button', `${index + 1}  ${label}`); button.type = 'button';
            button.setAttribute('aria-current', this.step === index ? 'step' : 'false');
            button.addEventListener('click', () => { this.step = index; this.publishConfirmed = false; this.render(); }); nav.append(button);
        }); content.append(nav);
        if (!this.inspection || !this.profile) { content.append(icon(w.retry, 'reload', () => void this.refresh())); return; }
        const panel = node('section', '', 'publication-panel'); panel.append(node('h2', w.steps[this.step]));
        if (this.step === 0) this.renderChapters(panel);
        else if (this.step === 1) this.renderDetails(panel);
        else if (this.step === 2) this.renderReview(panel);
        else this.renderDelivery(panel);
        content.append(panel);
        if (this.busy) {
            content.setAttribute('aria-busy', 'true');
            content.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>('input, button, textarea, select').forEach(control => { control.disabled = true; });
        } else content.removeAttribute('aria-busy');
    }
    private renderChapters(parent: HTMLElement): void {
        const w = this.words(), profile = this.profile!, plans = node('div', '', 'publication-plan-row');
        const label = node('label', w.plan, 'publication-field'), select = node('select'); select.setAttribute('aria-label', w.plan);
        const empty = node('option', w.newPlan); empty.value = ''; select.append(empty);
        for (const record of this.inspection!.profiles) { const option = node('option', `${record.profile.id} · ${record.profile.title}`); option.value = record.profile.id; select.append(option); }
        select.value = this.revision === null ? '' : profile.id;
        select.addEventListener('change', () => {
            this.chooseProfile(this.inspection!.profiles.find(record => record.profile.id === select.value)); this.render();
            const generation = this.generation, view = this.viewRequest;
            if (this.revision !== null) void this.readStatus(generation).then(() => {
                if (this.current(generation) && view === this.viewRequest) this.render();
            }).catch(error => { if (this.current(generation) && view === this.viewRequest) this.report(String(error), true); });
        }); label.append(select); plans.append(label, icon(w.refresh, 'reload', () => void this.refresh())); parent.append(plans);
        parent.append(node('p', w.selectHint, 'publication-hint'));
        const actions = node('div', '', 'publication-actions');
        const choose = (paths: string[]) => { profile.chapters = paths; this.changed(); this.render(); };
        actions.append(icon(w.all, 'list-plus', () => choose(this.inspection!.pages.map(page => page.path))), icon(w.none, 'eraser', () => choose([])),
            node('span', `${w.selectedCount}: ${profile.chapters.length}`, 'publication-hint')); parent.append(actions);
        if (!this.inspection!.pages.length) parent.append(node('p', w.empty));
        const groups = new Map<string, typeof this.inspection.pages>();
        for (const page of this.inspection!.pages) {
            const group = [page.bookTitle || page.book, page.volumeTitle || page.volume].filter(Boolean).join(' · ') || w.ungrouped;
            groups.set(group, [...(groups.get(group) || []), page]);
        }
        for (const [title, pages] of groups) {
            const group = node('fieldset', '', 'publication-chapter-group'), legend = node('legend', title); group.append(legend);
            const selected = new Set(profile.chapters), groupCheck = this.check(group, w.all + ' · ' + title, pages.every(page => selected.has(page.path)), checked => {
                pages.forEach(page => checked ? selected.add(page.path) : selected.delete(page.path));
                choose(this.inspection!.pages.filter(page => selected.has(page.path)).map(page => page.path));
            }); groupCheck.indeterminate = pages.some(page => selected.has(page.path)) && !groupCheck.checked;
            for (const page of pages) {
                const row = node('div', '', 'publication-chapter');
                this.check(row, pageTitle(page), selected.has(page.path), checked => {
                    checked ? selected.add(page.path) : selected.delete(page.path);
                    choose(this.inspection!.pages.filter(item => selected.has(item.path)).map(item => item.path));
                }); row.append(node('small', page.path)); group.append(row);
            } parent.append(group);
        }
        this.renderNext(parent);
    }
    private renderDetails(parent: HTMLElement): void {
        const w = this.words(), p = this.profile!, grid = node('div', '', 'publication-fields');
        this.input(grid, w.planName, p.id, value => {
            p.id = value; this.revision = null; this.status = undefined; this.build = undefined; this.manifest = undefined; ++this.viewRequest;
        }, false, w.planHint);
        this.input(grid, w.work, p.workId, value => { p.workId = value; }, false, w.workHint);
        this.input(grid, w.titleField, p.title, value => { p.title = value; });
        this.input(grid, w.subtitle, p.subtitle || '', value => { p.subtitle = value; });
        this.input(grid, w.author, p.authors.map(author => author.name).join('\n'), value => {
            const existing = new Map(p.authors.map(author => [author.name, author]));
            p.authors = value.split('\n').filter(name => name.trim()).map(name => existing.get(name.trim()) || { name: name.trim() });
        }, true);
        this.input(grid, w.version, p.version, value => { p.version = value; });
        this.input(grid, w.edition, p.edition || '', value => { p.edition = value; });
        this.input(grid, w.license, p.license || '', value => { p.license = value; });
        this.input(grid, w.publicationDate, p.publicationDate || '', value => { p.publicationDate = value; });
        const language = node('label', w.language, 'publication-field'), select = node('select'); select.setAttribute('aria-label', w.language);
        for (const locale of ['zh', 'en'] as const) { const option = node('option', w[locale]); option.value = locale; select.append(option); }
        select.value = (p.language || this.context().language).startsWith('zh') ? 'zh' : 'en';
        select.addEventListener('change', () => { p.language = select.value; this.changed(); }); language.append(select); grid.append(language);
        parent.append(grid); this.input(parent, w.description, p.description || '', value => { p.description = value; }, true);
        const cover = this.section(parent, w.cover); cover.append(node('p', w.coverHint, 'publication-hint'));
        this.input(cover, w.coverImage, p.cover?.image || '', value => { p.cover = { ...p.cover, image: value || undefined }; });
        this.check(cover, w.coverVersion, p.cover?.showVersion !== false, value => { p.cover = { ...p.cover, showVersion: value }; this.changed(); });
        for (const [key, title] of [['frontMatter', w.front], ['backMatter', w.back]] as const) {
            const section = this.section(parent, title);
            if (!p[key]?.length) {
                section.append(icon(`${w.addMatter} ${title}`, 'plus', () => {
                    p[key] = [{ title, content: '', includeInToc: true }]; this.changed(); this.render();
                }));
            } else p[key].forEach((matter, index) => {
                const entry = node('div', '', 'publication-matter');
                this.input(entry, w.matterTitle, matter.title || title, value => { matter.title = value; });
                this.input(entry, w.matterText, matter.content || '', value => { matter.content = value; delete matter.file; }, true);
                this.input(entry, w.matterFile, matter.file || '', value => { matter.file = value || undefined; if (value) delete matter.content; });
                this.check(entry, w.inToc, matter.includeInToc !== false, value => { matter.includeInToc = value; this.changed(); });
                entry.append(icon(`${w.removeMatter} ${matter.title || title}`, 'trash', () => { p[key].splice(index, 1); this.changed(); this.render(); })); section.append(entry);
            });
        }
        const toc = this.section(parent, w.toc);
        this.check(toc, w.tocEnabled, p.toc?.enabled !== false, value => { p.toc = { ...p.toc, enabled: value }; this.changed(); });
        this.input(toc, w.tocTitle, p.toc?.title || w.toc, value => { p.toc = { ...p.toc, title: value }; });
        const depth = this.input(toc, w.tocDepth, String(p.toc?.depth || 2), value => { p.toc = { ...p.toc, depth: Number(value) }; });
        if (depth instanceof HTMLInputElement) { depth.type = 'number'; depth.min = '1'; depth.max = '6'; }
        const continued = this.section(parent, w.continued);
        this.check(continued, w.continuedEnabled, p.continued?.enabled !== false, value => { p.continued = { ...p.continued, enabled: value }; this.changed(); });
        this.input(continued, w.continuedText, p.continued?.text || '', value => { p.continued = { ...p.continued, text: value || undefined }; }, true);
        const actions = node('div', '', 'publication-actions'); actions.append(icon(w.save, 'save', () => void this.save())); parent.append(actions); this.renderNext(parent);
    }
    private section(parent: HTMLElement, title: string): HTMLElement {
        const section = node('section', '', 'publication-section'); section.append(node('h3', title)); parent.append(section); return section;
    }
    private checksum(parent: HTMLElement, value: string): void {
        const details = node('details', '', 'publication-checksum');
        details.append(node('summary', `${this.words().exactPdf}: ${value.slice(0, 12)}…`), node('p', value)); parent.append(details);
    }
    private renderNext(parent: HTMLElement): void {
        if (this.step >= 3) return;
        const next = icon(this.words().steps[this.step + 1], 'chevron-right', () => { ++this.step; this.render(); }, true);
        const footer = node('div', '', 'publication-actions publication-next'); footer.append(next); parent.append(footer);
    }
    private renderReview(parent: HTMLElement): void {
        const w = this.words(); parent.append(node('p', w.reviewHint, 'publication-hint'));
        const actions = node('div', '', 'publication-actions'); actions.append(icon(w.review, 'scan', () => void this.review(), true)); parent.append(actions);
        const plan = this.plan; if (!plan) { parent.append(node('p', w.needReview, 'publication-hint')); return; }
        const summary = node('div', '', 'publication-review-grid');
        for (const [title, pages] of [[w.selected, plan.selected], [w.omitted, plan.omitted]] as const) {
            const section = this.section(summary, `${title} (${pages.length})`), list = node('ol');
            pages.forEach(page => { const item = node('li', [page.bookTitle, page.volumeTitle, pageTitle(page)].filter(Boolean).join(' · ')); item.append(node('small', page.path)); list.append(item); }); section.append(list);
        } parent.append(summary);
        const references = this.section(parent, `${w.external} (${plan.externalReferences.length})`);
        references.append(node('p', plan.externalReferences.length ? w.externalHint : w.noExternal, 'publication-hint'));
        if (plan.externalReferences.length) {
            const list = node('ul'); plan.externalReferences.forEach(reference => list.append(node('li', `${reference.source}:${reference.line} → ${reference.label || reference.target}`))); references.append(list);
        }
        if (plan.partial && plan.continuedNotice.enabled) { const notice = this.section(parent, plan.continuedNotice.title); notice.append(node('p', plan.continuedNotice.text, 'publication-prose')); }
        parent.append(node('p', `${w.reviewDoi}: ${plan.doi.versionDoi || w.noDoi}`));
        // This service warning is already expressed by the localized reference section above.
        const referenceWarning = `${plan.externalReferences.length} reference(s) point outside this edition; omitted pages are not added automatically.`;
        const warnings = plan.warnings.filter(warning => !plan.externalReferences.length || warning !== referenceWarning);
        if (warnings.length) { const list = node('ul', '', 'publication-warning'); warnings.forEach(warning => list.append(node('li', warning))); parent.append(list); }
        const toolsReady = plan.tools.pandoc.available && plan.tools.engine.available;
        if (!toolsReady) parent.append(node('p', w.toolsMissing, 'publication-warning'));
        const confirmation = this.check(parent, w.acknowledge, this.scopeConfirmed, value => { this.scopeConfirmed = value; build.disabled = !value || !toolsReady; });
        confirmation.dataset.scopeConfirm = 'true';
        const build = icon(w.build, 'publication', () => void this.createBuild(), true); build.dataset.build = 'true'; build.disabled = !this.scopeConfirmed || !toolsReady;
        const footer = node('div', '', 'publication-actions'); footer.append(build); parent.append(footer);
    }
    private renderDelivery(parent: HTMLElement): void {
        const w = this.words(), build = this.build, frozenProfile = this.manifest?.plan.profile;
        if (build) {
            const edition = this.section(parent, `${frozenProfile?.title || this.profile!.title} · ${build.version}`);
            edition.append(node('p', w.frozen, 'publication-hint'), node('p', `${w.builtAt}: ${new Date(build.createdAt).toLocaleString(this.context().language)}`));
            if (this.manifest) {
                const scope = node('details', '', 'publication-section'); scope.append(node('summary', `${w.selected} (${this.manifest.plan.selected.length})`));
                const list = node('ol'); this.manifest.plan.selected.forEach(page => list.append(node('li', [pageTitle(page), page.path].filter(Boolean).join(' · ')))); scope.append(list); edition.append(scope);
            }
            this.checksum(edition, build.pdfSha256);
            const actions = node('div', '', 'publication-actions');
            actions.append(icon(w.preview, 'visible', () => void this.artifact('publication.pdf', true)), icon(w.download, 'download', () => void this.artifact('publication.pdf')),
                icon(w.manifest, 'list-plus', () => void this.artifact('manifest.json')), icon(w.citation, 'copy-source', () => void this.artifact('citation.json'))); edition.append(actions);
        } else parent.append(node('p', w.noBuild, 'publication-hint'));
        const doi = this.section(parent, w.doi); doi.append(node('p', w.doiHint, 'publication-hint'));
        const manual = node('details', '', 'publication-section'); manual.append(node('summary', w.manual));
        const p = this.profile!;
        this.input(manual, w.versionDoi, p.doi?.versionDoi || '', value => { p.doi = { ...p.doi, versionDoi: value || undefined }; });
        this.input(manual, w.conceptDoi, p.doi?.conceptDoi || '', value => { p.doi = { ...p.doi, conceptDoi: value || undefined }; });
        this.input(manual, w.provenance, p.doi?.provenance || '', value => { p.doi = { ...p.doi, provenance: value || undefined }; });
        manual.append(node('p', w.manualHint, 'publication-hint'), icon(w.save, 'save', () => void this.save())); doi.append(manual);
        const zenodo = this.section(doi, w.zenodo), remote = this.status?.remote;
        const environment = node('label', w.environment, 'publication-field'), select = node('select'); select.setAttribute('aria-label', w.environment);
        for (const [value, title] of [['production', w.production], ['sandbox', w.sandbox]]) { const option = node('option', title); option.value = value; select.append(option); }
        select.value = p.zenodo?.environment || 'sandbox'; select.disabled = !!remote;
        select.addEventListener('change', () => { p.zenodo = { ...p.zenodo, environment: select.value as 'production' | 'sandbox' }; this.changed(); }); environment.append(select); zenodo.append(environment);
        const credentialReady = this.status?.credential.configured || this.inspection?.credentialStatus.find(item => item.profileId === p.id)?.configured;
        zenodo.append(node('p', credentialReady ? w.credentialReady : w.credentialMissing, 'publication-hint'));
        zenodo.append(node('p', remote ? remote.status === 'published' ? w.published : remote.status === 'unknown' || remote.pending ? w.remoteUnknown : w.reserved : w.noRemote,
            remote?.status === 'unknown' || remote?.pending ? 'publication-warning' : 'publication-hint'));
        if (remote?.versionDoi) zenodo.append(node('p', `${w.versionDoi}: ${remote.versionDoi}`));
        if (remote?.conceptDoi) zenodo.append(node('p', `${w.conceptDoi}: ${remote.conceptDoi}`));
        if (remote?.recordId || remote?.draftId) zenodo.append(node('p', `${w.remoteRecord}: ${remote.recordId || remote.draftId}`));
        if (remote?.history?.length) { const history = this.section(zenodo, w.oldEditions); remote.history.forEach(edition => history.append(node('p', `${edition.recordId} · ${edition.versionDoi || ''}`))); }
        if (remote?.status === 'published') {
            const confirm = this.check(zenodo, w.confirmNew, this.versionConfirmed, value => { this.versionConfirmed = value; next.disabled = !value || !credentialReady; });
            confirm.dataset.newVersionConfirm = 'true';
            const next = icon(w.newVersion, 'plus', () => { if (this.versionConfirmed) void this.remoteAction('reserve-doi', { mode: 'new-version', expectedRecordId: remote.recordId, confirmedNewVersion: true }); });
            next.disabled = !this.versionConfirmed || !credentialReady; zenodo.append(next);
        } else if (!remote || remote.status === 'draft' && !remote.pending) {
            const reserve = icon(w.reserve, 'integration-managed', () => void this.remoteAction('reserve-doi', { mode: 'reuse-or-create' }));
            reserve.disabled = !credentialReady; zenodo.append(reserve);
        }
        const attach = node('details', '', 'publication-section'); attach.append(node('summary', w.attach));
        const id = this.input(attach, w.remoteId, '', () => {}, false, '', false), typeLabel = node('label', w.remoteKind, 'publication-field'), kind = node('select');
        kind.setAttribute('aria-label', w.remoteKind);
        for (const [value, title] of [['draft', w.draftKind], ['record', w.recordKind]]) { const option = node('option', title); option.value = value; kind.append(option); }
        typeLabel.append(kind); attach.append(typeLabel);
        const connect = icon(w.attach, 'integration-managed', () => void this.remoteAction('attach-zenodo', { id: id.value, kind: kind.value })); connect.disabled = !credentialReady; attach.append(connect); zenodo.append(attach);
        if (remote?.status === 'draft' && !remote.pending && build) {
            zenodo.append(node('p', w.uploadHint, 'publication-hint'));
            const review = icon(w.reviewUpload, 'scan', () => void this.reviewUpload());
            review.disabled = !credentialReady || this.dirty || !this.manifest || this.manifest.plan.doi.versionDoi !== remote.versionDoi; zenodo.append(review);
            if (this.uploadPlan?.buildId === build.id && this.uploadPlan.remoteRevision === remote.revision) {
                const changes = this.section(zenodo, w.reviewUpload), current = this.section(changes, w.remoteFiles);
                this.uploadPlan.files.forEach(file => current.append(node('p', `${file.name} · ${file.checksum}`, 'publication-checksum')));
                for (const [title, files] of [[w.addFiles, this.uploadPlan.add], [w.replaceFiles, this.uploadPlan.replace], [w.removeFiles, this.uploadPlan.remove], [w.blockedFiles, this.uploadPlan.blocked]] as const) {
                    const section = this.section(changes, title), list = node('ul'); files.forEach(file => list.append(node('li', file)));
                    section.append(files.length ? list : node('p', w.filesUnchanged, 'publication-hint'));
                }
                if (this.uploadPlan.blocked.length) changes.append(node('p', w.blockedHint, 'publication-warning'));
                const upload = icon(w.uploadFiles, 'save', () => void this.remoteAction('upload', { buildId: build.id, pdfSha256: build.pdfSha256, remoteRevision: remote.revision, uploadFingerprint: this.uploadPlan?.fingerprint }));
                upload.disabled = !credentialReady || this.dirty || this.uploadPlan.blocked.length > 0; changes.append(upload);
            }
            zenodo.append(node('p', w.needBuildReserved, 'publication-hint'));
            if (remote.upload?.buildId === build.id && remote.upload.pdfSha256 === build.pdfSha256) {
                const publish = this.section(zenodo, w.publish); publish.append(node('p', w.uploaded), node('p', w.publishWarning, 'publication-warning'),
                    node('p', `${frozenProfile?.title || this.profile!.title} · ${build.version}`),
                    node('p', `${w.author}: ${frozenProfile?.authors.map(author => author.name).join(', ') || ''}`),
                    node('p', `${w.license}: ${frozenProfile?.license || ''}`),
                    node('p', frozenProfile?.description || ''), node('p', `${w.versionDoi}: ${remote.versionDoi || w.noDoi}`));
                this.checksum(publish, build.pdfSha256);
                const confirm = this.check(publish, w.publishCheck, this.publishConfirmed, value => { this.publishConfirmed = value; action.disabled = !value || !credentialReady || !this.manifest; }); confirm.dataset.publishConfirm = 'true';
                const action = icon(w.publish, 'publication', () => { if (this.publishConfirmed && this.manifest) void this.remoteAction('publish', { buildId: build.id, pdfSha256: build.pdfSha256, remoteRevision: remote.revision, recordId: remote.draftId || remote.recordId, confirmedPublication: true }); }, true);
                action.disabled = !this.publishConfirmed || !credentialReady || !this.manifest; publish.append(action);
            }
        }
    }
    private async save(): Promise<boolean> {
        if (!this.profile || this.busy) return false;
        const generation = this.generation;
        const result = await this.run('save', { profile: clone(this.profile), expectedRevision: this.revision });
        if (!result || !this.current(generation)) return false;
        const record = result as PublicationProfileRecord; this.profile = clone(record.profile); this.revision = record.revision; this.dirty = false;
        const profiles = this.inspection!.profiles; this.inspection!.profiles = [...profiles.filter(item => item.profile.id !== record.profile.id), record];
        this.busy = true; this.render(); this.report(this.words().saved);
        try { await this.readStatus(generation); } catch (error) { if (this.current(generation)) this.report(String(error), true); }
        if (!this.current(generation)) return false; this.busy = false; this.render(); return true;
    }
    private async review(): Promise<void> {
        if (!this.profile?.chapters.length) { this.report(this.words().noSelection, true); return; }
        const generation = this.generation; if (!await this.save() || !this.current(generation)) return;
        const result = await this.run('review', { profile: clone(this.profile) });
        if (!result || !this.current(generation)) return; this.plan = result; this.scopeConfirmed = false; this.report(this.words().reviewReady); this.render();
    }
    private async createBuild(): Promise<void> {
        if (!this.profile || !this.plan || !this.scopeConfirmed || this.dirty) { this.report(this.words().needReview, true); return; }
        const generation = this.generation;
        const result = await this.run('build', { profile: clone(this.profile), expectedFingerprint: this.plan.fingerprint });
        if (!result || !this.current(generation)) return; this.build = result; this.step = 3; this.publishConfirmed = false;
        this.busy = true; this.render();
        try { await this.readStatus(generation); } catch (error) { if (this.current(generation)) this.report(String(error), true); }
        if (this.current(generation)) { this.busy = false; this.render(); }
    }
    private async remoteAction(action: string, fields: Record<string, unknown>): Promise<void> {
        if (!this.profile || this.busy) return;
        const generation = this.generation;
        if (this.dirty && !await this.save()) return;
        if (this.revision === null && !await this.save()) return;
        if (!this.current(generation)) return;
        const result = await this.run(action, { profileId: this.profile!.id, expectedRevision: this.revision, ...fields });
        if (!result || !this.current(generation)) return;
        this.plan = undefined; this.uploadPlan = undefined; this.scopeConfirmed = false; this.publishConfirmed = false; this.versionConfirmed = false;
        this.busy = true; this.render();
        try { await this.readStatus(generation); } catch (error) { if (this.current(generation)) this.report(String(error), true); }
        if (this.current(generation)) { this.busy = false; this.render(); }
    }
    private async reviewUpload(): Promise<void> {
        if (!this.profile || !this.build || !this.status?.remote || this.dirty) return;
        const generation = this.generation;
        const result = await this.run('review-upload', { profileId: this.profile.id, buildId: this.build.id,
            pdfSha256: this.build.pdfSha256, remoteRevision: this.status.remote.revision });
        if (result && this.current(generation)) { this.uploadPlan = result; this.render(); }
    }
    private async run(action: string, fields: Record<string, unknown>): Promise<any | undefined> {
        if (this.busy) return undefined;
        const generation = this.generation; this.busy = true; this.render();
        const w = this.words(); this.report(action === 'save' ? w.savePhase : action === 'review' ? w.reviewPhase : action === 'build' ? w.buildPhase : w.remotePhase);
        try {
            const job = await this.request<PublicationJob>('/api/publication/action', { action, ...fields }, generation);
            if (!this.current(generation)) return undefined;
            this.job = job; return await this.poll(job, generation);
        } catch (error) {
            if (this.current(generation)) { this.busy = false; this.report(String(error), true); this.render(); }
            return undefined;
        }
    }
    private async poll(job: PublicationJob, generation: number): Promise<any | undefined> {
        let current = job;
        while (this.current(generation) && current.state === 'running') {
            this.report(this.phase(current));
            await new Promise<void>(resolve => {
                const signal = this.controller.signal;
                const finish = () => { signal.removeEventListener('abort', finish); this.timer = undefined; resolve(); };
                this.timer = setTimeout(finish, 450); signal.addEventListener('abort', finish, { once: true });
            });
            if (!this.current(generation)) return undefined;
            try { current = await this.request<PublicationJob>('/api/publication/job?id=' + encodeURIComponent(job.id), undefined, generation); }
            catch (error) { if (this.current(generation)) { this.busy = false; this.report(String(error), true); this.render(); } return undefined; }
        }
        if (!this.current(generation)) return undefined;
        this.job = current; this.busy = false;
        this.handledJobs.add(current.id);
        if (current.state === 'failed') { this.report(`${this.words().failed}: ${current.error || ''}`, true); this.render(); return undefined; }
        this.report(this.words().completed); this.render(); return current.result;
    }
    private phase(job: PublicationJob): string {
        const w = this.words();
        if (job.action === 'save') return w.savePhase;
        if (job.action === 'review') return w.reviewPhase;
        if (job.action !== 'build') return w.remotePhase;
        if (/immutable|saved|saving/i.test(job.phase)) return w.retainPhase;
        if (/rendering|typesetting/i.test(job.phase)) return w.renderPhase;
        if (/compiling|chapters/i.test(job.phase)) return w.compilePhase;
        return w.checkPhase;
    }
    private clearPreview(): void {
        this.pdfPreview?.destroy(); this.pdfPreview = undefined;
        this.preview?.remove(); this.preview = undefined;
        for (const url of this.blobs) URL.revokeObjectURL(url); this.blobs.clear();
    }
    private async artifact(file: PublicationArtifact, preview = false): Promise<void> {
        if (!this.build || !this.profile) return;
        const generation = this.generation, build = this.build, profileId = this.profile.id, token = this.token, project = this.project;
        const route = `/api/publication/artifact?profile=${encodeURIComponent(profileId)}&build=${encodeURIComponent(build.id)}&file=${encodeURIComponent(file)}`;
        try {
            if (preview) {
                this.clearPreview(); const panel = node('section', '', 'publication-preview'), header = node('div', '', 'publication-actions');
                header.append(node('h3', this.words().previewTitle), icon(this.words().closePreview, 'x', () => this.clearPreview()));
                panel.append(header); this.content!.append(panel); this.preview = panel;
                const request = async (url: string, options: RequestInit = {}): Promise<Response> => {
                    if (!this.current(generation) || this.build?.id !== build.id || this.profile?.id !== profileId) throw new Error('Publication context changed.');
                    const result = await readerFetch(url, { ...options, headers: { 'x-math-workspace-token': token, 'x-math-workspace-project': project } });
                    if (!this.current(generation) || this.build?.id !== build.id || this.profile?.id !== profileId) throw new Error('Publication context changed.');
                    return result;
                };
                this.pdfPreview = new ReaderPublicationPdf(panel, { language: () => this.context().language, request,
                    download: () => { if (this.current(generation) && this.build?.id === build.id && this.profile?.id === profileId) void this.artifact('publication.pdf'); } });
                panel.scrollIntoView({ block: 'start' });
                await this.pdfPreview.open(async signal => {
                    const response = await request(route, { cache: 'no-store', signal });
                    if (!response.ok) throw new Error(await response.text()); return response.blob();
                });
                return;
            }
            const response = await readerFetch(route,
                { cache: 'no-store', signal: this.controller.signal, headers: { 'x-math-workspace-token': this.token, 'x-math-workspace-project': this.project } });
            if (!response.ok) throw new Error(await response.text());
            const blob = await response.blob(); if (!this.current(generation) || this.build?.id !== build.id || this.profile?.id !== profileId) return;
            const url = URL.createObjectURL(blob); this.blobs.add(url);
            const anchor = node('a'); anchor.href = url; anchor.download = `${profileId}-${build.version}-${file}`; anchor.click();
            setTimeout(() => { URL.revokeObjectURL(url); this.blobs.delete(url); }, 1500);
        } catch (error) { if (this.current(generation)) this.report(String(error), true); }
    }
}
