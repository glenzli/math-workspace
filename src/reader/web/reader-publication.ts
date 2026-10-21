import { readerText, readerLabel, readerAttribute, refreshReaderLabels, readerWords } from './reader-ui-labels';
import { readerFetch } from './reader-route';
import { readerIcon, type ReaderIconName } from './reader-icons';
import { ReaderPublicationPdf } from './reader-publication-pdf';
import { mergeWorkMetadata, type WorkMetadata, type WorkAuthor } from '../../../packages/core/src/project-metadata';
import { discoverPublicationMatter, resolvePublicationMatter } from '../../publication/matter';
import type {
    PublicationArtifact, PublicationBuild, PublicationInspection, PublicationPlan,
    PublicationProfile, PublicationProfileRecord, PublicationStatus, PublicationManifest, PublicationUploadPlan, PublicationPage
} from '../../publication/types';

interface PublicationContext { language: 'zh' | 'en'; manuscriptLanguage?: 'zh' | 'en'; token: string; project: string }
interface PublicationJob {
    id: string; action: string; state: 'running' | 'completed' | 'failed'; phase: string;
    result?: any; error?: string;
}
interface Inspection extends PublicationInspection { job?: PublicationJob }

const copy = {
    zh: {
        commonMetadata: '项目公共信息', commonHint: '在项目中维护作品信息；本版只保存需要单独设置的项目。保存后供后续出版版本共同使用。', resolvedMetadata: '本版使用的信息',
        commonPrefix: '项目', saveCommon: '保存项目公共信息', savingCommon: '正在保存项目公共信息…', commonSaved: '项目公共信息已保存。请重新审阅本版。', reloadCommon: '重新载入并放弃未保存的公共信息', commonConflict: '项目公共信息已在其他地方更新。未保存的内容仍保留；重新载入后再编辑和保存。',
        override: '本版单独设置', inherited: '沿用项目公共信息', website: '作品网站', repository: '源码仓库', licenseUrl: '许可链接', keywords: '关键词（每行一个）', preferredCitation: '推荐引用',
        authorName: '作者姓名', authorNative: '本名', authorAliases: '别名（每行一个）', affiliation: '所属机构', addAuthor: '添加作者', removeAuthor: '移除作者',
        autoMatter: '自动收录所选书卷的序言、后记、附录等内容', autoMatterHint: '依据稿件的结构角色识别，保留原标题和附录编号。可以逐项取消收录；已有方案需主动开启。', autoIncluded: '自动识别的内容', customMatter: '手动调整收录与顺序', moveUp: '上移', moveDown: '下移',
        title: 'PDF 出版', close: '关闭', refresh: '刷新出版状态', loading: '正在读取出版计划…',
        intro: '选择这次出版的章节，审阅范围与版面，再生成可留存的 PDF。每一版都保留独立的文件与标识。',
        steps: ['章节', '版面与信息', '审阅范围', 'PDF 与 DOI'], plan: '出版计划', newPlan: '新建计划',
        planName: '计划名称', planHint: '用于再次打开这份计划；名称可以包含字母、数字和短横线。',
        work: '作品标识', workHint: '同一作品的后续版本沿用这个标识。', save: '保存出版计划', saved: '出版计划已保存。',
        selectHint: '只纳入已勾选的章节，并按下面的顺序排版。', all: '全选', none: '清空选择',
        ungrouped: '其他章节', selectedCount: '已选章节', titleField: '书名 / 标题', subtitle: '副标题',
        author: '作者', version: '本版版本', edition: '版次说明', license: '许可协议', releaseTag: '本版源码标签', releaseCommit: '本版源码提交',
        description: '作品介绍', publicationDate: '出版日期', cover: '封面', coverHint: '默认使用书名、副标题、作者与版本制作文字封面。',
        coverImage: '封面图片（可选，项目内的相对路径）', coverVersion: '封面显示版本',
        front: '前文', back: '后文', addMatter: '添加', removeMatter: '移除', matterTitle: '标题（留空沿用稿件标题）', matterText: '手填正文（支持 Markdown，兼容旧方案）',
        matterFile: '引用项目内的稿件', inlineSource: '不引用文件，使用手填内容', fileUnavailable: '当前不可用',
        filePriority: '选择稿件时只引用该文件；手填内容会保留为备用，不会合并进文件。原稿不会被修改。',
        usedAs: '已用于', sourceFile: '引用稿件', sourceInline: '方案内手填内容', manuscriptPreview: '稿件内容预览',
        toc: '目录', tocEnabled: '自动生成目录', inToc: '纳入目录', tocTitle: '目录标题', tocDepth: '目录层级',
        continued: '未完待续', continuedEnabled: '附上“未完待续”声明（也可用于已收录全部章节的版本）',
        continuedTitle: '声明标题（留空沿用稿件标题或默认标题）',
        continuedAuto: '当前沿用自动规则：选择稿件时启用，否则仅在部分发布时附上。操作开关可明确指定。',
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
        verifyPublished: '核验公开版本', verification: '发布后核验', verificationNone: '已发布，尚未独立核验公开文件和 DOI。',
        verificationHint: '匿名读取公开记录，下载 PDF 比对，并检查本版 DOI 是否解析到同一记录。此操作不会再次发布。',
        verificationSandbox: 'Zenodo 官方说明：sandbox 测试 DOI 不是真实 DOI，且不会解析；该项不能在 sandbox 验收。正式环境通过 doi.org 核验。',
        verificationSandboxIncomplete: '公开文件核验通过；sandbox DOI 解析未验收',
        verificationPassed: '核验通过', verificationPending: '核验尚未完成，可稍后重试', verificationFailed: '核验发现不一致或访问错误',
        recordCheck: '公开记录', fileCheck: '下载的 PDF', doiCheck: '本版 DOI 解析', checkPassed: '通过', checkPending: '待核验', checkFailed: '未通过', checkedAt: '核验时间',
        exactPdf: '本版文件校验值', needBuildReserved: '预留或修改 DOI 后，请重新审阅并生成 PDF，再上传。',
        confirmNew: '我确认创建同一作品的新版本，并保留已发布的旧版。', errors: '错误详情',
        empty: '项目中尚无可出版章节。', language: '出版语言', zh: '中文', en: 'English',
        resume: '已续接本项目的出版操作。', reviewDoi: '印入本版的 DOI', noDoi: '未设置',
        buildPhase: '正在排版 PDF…', savePhase: '正在保存计划…', reviewPhase: '正在核对章节与引用…',
        remotePhase: '正在处理 Zenodo 操作…', checkPhase: '检查出版内容', compilePhase: '整理章节',
        renderPhase: '排版 PDF', retainPhase: '保存本版文件', noToken: 'Reader 项目状态尚未准备好，请刷新后重试。'
    },
    en: {
        commonMetadata: 'Project metadata', commonHint: 'Maintain shared work details in the project. This edition stores only its overrides; saved values are reused by future editions.', resolvedMetadata: 'Metadata used for this edition',
        commonPrefix: 'Project', saveCommon: 'Save project metadata', savingCommon: 'Saving project metadata…', commonSaved: 'Project metadata saved. Review this edition again.', reloadCommon: 'Reload and discard unsaved project metadata', commonConflict: 'Project metadata changed elsewhere. Your unsaved draft is retained; reload before editing and saving again.',
        override: 'Override for this edition', inherited: 'Use project metadata', website: 'Work website', repository: 'Source repository', licenseUrl: 'License URL', keywords: 'Keywords (one per line)', preferredCitation: 'Preferred citation',
        authorName: 'Author name', authorNative: 'Native name', authorAliases: 'Aliases (one per line)', affiliation: 'Affiliation', addAuthor: 'Add author', removeAuthor: 'Remove author',
        autoMatter: 'Automatically include prefaces, endings and appendices for the selected books and volumes', autoMatterHint: 'Uses manuscript roles, preserving titles and appendix numbering. Exclude individual pages as needed; existing plans require enabling this option.', autoIncluded: 'Automatically identified pages', customMatter: 'Customize inclusion and order', moveUp: 'Move up', moveDown: 'Move down',
        title: 'PDF publication', close: 'Close', refresh: 'Refresh publication status', loading: 'Loading publication plans…',
        intro: 'Select this edition’s chapters, review its scope and layout, then create a PDF to keep. Each edition retains its own files and identity.',
        steps: ['Chapters', 'Layout & details', 'Review scope', 'PDF & DOI'], plan: 'Publication plan', newPlan: 'New plan',
        planName: 'Plan name', planHint: 'Use letters, numbers and hyphens to identify this reusable plan.',
        work: 'Work identity', workHint: 'Keep this identity for later versions of the same work.', save: 'Save publication plan', saved: 'Publication plan saved.',
        selectHint: 'Only checked chapters are included, in the order shown below.', all: 'Select all', none: 'Clear selection',
        ungrouped: 'Other chapters', selectedCount: 'Selected chapters', titleField: 'Book title / title', subtitle: 'Subtitle',
        author: 'Authors', version: 'Edition version', edition: 'Edition note', license: 'License', releaseTag: 'Source release tag', releaseCommit: 'Source commit',
        description: 'Description', publicationDate: 'Publication date', cover: 'Cover', coverHint: 'The default text cover uses the title, subtitle, authors and version.',
        coverImage: 'Cover image (optional, path within this project)', coverVersion: 'Show version on cover',
        front: 'Front matter', back: 'Back matter', addMatter: 'Add', removeMatter: 'Remove', matterTitle: 'Heading (leave blank to use the manuscript heading)', matterText: 'Inline text (Markdown, existing plans supported)',
        matterFile: 'Reference a project manuscript', inlineSource: 'Use inline content without a file', fileUnavailable: 'Currently unavailable',
        filePriority: 'A selected file supplies the content. Inline text is retained as a fallback and is not appended to the file. The manuscript stays unchanged.',
        usedAs: 'Used as', sourceFile: 'Source manuscript', sourceInline: 'Inline content in this plan', manuscriptPreview: 'Manuscript content preview',
        toc: 'Contents', tocEnabled: 'Generate table of contents', inToc: 'Include in contents', tocTitle: 'Contents heading', tocDepth: 'Contents depth',
        continued: 'To be continued', continuedEnabled: 'Add a “To be continued” declaration (also for a complete chapter selection)',
        continuedTitle: 'Declaration heading (blank uses the manuscript or default heading)',
        continuedAuto: 'Using the automatic rule: enable a referenced manuscript, otherwise add the declaration only to partial editions. Change the switch to choose explicitly.',
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
        verifyPublished: 'Verify public edition', verification: 'Post-publication verification', verificationNone: 'Published; public files and DOI have not been independently verified.',
        verificationHint: 'Read the public record anonymously, download and compare the PDF, and check that the edition DOI reaches the same record. This does not publish again.',
        verificationSandbox: 'Zenodo states that sandbox DOIs are not real and do not resolve. DOI resolution cannot be accepted in sandbox; production uses doi.org.',
        verificationSandboxIncomplete: 'Public files verified; DOI resolution is not verified in sandbox',
        verificationPassed: 'Verification passed', verificationPending: 'Verification is incomplete; retry later', verificationFailed: 'Verification found a mismatch or access error',
        recordCheck: 'Public record', fileCheck: 'Downloaded PDF', doiCheck: 'Edition DOI resolution', checkPassed: 'Passed', checkPending: 'Pending', checkFailed: 'Failed', checkedAt: 'Checked',
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
function manuscriptPreview(content: string): string {
    return content.replace(/^(\s*#{1,6}\s+)#h-[a-f0-9]{16}\b[ \t]*/gim, '$1');
}
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
    private metadataDraft?: WorkMetadata;
    private metadataDraftRevision?: string;
    private metadataDirty = false;
    private metadataExpanded = false;
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
    private words() { return readerWords(() => copy[this.context().language]); }
    private current(generation: number): boolean {
        const context = this.context();
        return !!this.dialog && generation === this.generation && this.project === context.project && this.token === context.token;
    }
    contextChanged(): void {
        const context = this.context();
        if (this.dialog && (context.project !== this.project || context.token !== this.token)) this.close();
        else if (this.dialog && context.language !== this.locale) { this.locale = context.language; refreshReaderLabels(this.dialog); }
    }
    close(): void {
        const returnFocus = this.dialog ? this.returnFocus : undefined;
        this.returnFocus = undefined;
        ++this.generation; this.controller.abort(); if (this.timer) clearTimeout(this.timer); this.timer = undefined;
        this.clearPreview(); for (const url of this.blobs) URL.revokeObjectURL(url); this.blobs.clear();
        this.dialog?.close(); this.dialog?.remove(); this.dialog = undefined; this.content = undefined; this.live = undefined;
        this.busy = false; this.publishConfirmed = false; this.versionConfirmed = false;
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }
    async open(): Promise<void> {
        const context = this.context(), previousProject = this.project;
        this.close(); this.project = context.project; this.token = context.token; this.locale = context.language;
        this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        if (previousProject !== this.project) {
            this.metadataDraft = undefined; this.metadataDraftRevision = undefined; this.metadataDirty = false; this.metadataExpanded = false;
            this.profile = undefined; this.revision = null; this.status = undefined; this.plan = undefined;
            this.build = undefined; this.manifest = undefined; this.job = undefined; this.dirty = false; this.scopeConfirmed = false; this.step = 0;
        }
        this.controller = new AbortController();
        const w = this.words(), dialog = node('dialog', '', 'reader-publication');
        readerAttribute(dialog, 'aria-label', () => this.words().title);
        const header = node('header', '', 'publication-header');
        header.append(readerLabel(node('h1', w.title), () => this.words().title), readerLabel(icon(w.close, 'x', () => this.close()), () => this.words().close));
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
            const details = node('details', '', 'publication-error-details'); details.append(readerLabel(node('summary', this.words().errors), () => this.words().errors), node('pre', message));
            this.live.replaceChildren(readerLabel(node('span', this.words().failed), () => this.words().failed), details);
        } else this.live.textContent = message;
        this.live.classList.toggle('is-error', failed);
    }
    private async refresh(): Promise<void> {
        const generation = this.generation; this.busy = true; this.render(); this.report(this.words().loading);
        try {
            const inspection = await this.request<Inspection>('/api/publication', undefined, generation);
            if (!this.current(generation)) return;
            this.inspection = inspection;
            if (!this.metadataDirty) { this.metadataDraft = clone(inspection.metadata?.value || {}); this.metadataDraftRevision = inspection.metadata?.revision; }
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
        if (job.action === 'save-metadata' && result?.revision) {
            this.inspection!.metadata = result; this.metadataDraft = clone(result.value); this.metadataDraftRevision = result.revision; this.metadataDirty = false; this.changed();
        }
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
        const w = copy[this.context().manuscriptLanguage || this.context().language];
        this.profile = record ? clone(record.profile) : this.inspection?.defaultProfile ? clone(this.inspection.defaultProfile) : {
            id: 'publication', workId: 'publication', title: '', version: '1.0', authors: [],
            language: this.context().manuscriptLanguage || this.context().language, license: 'CC-BY-4.0', chapters: [],
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
        if (status.metadata && !this.metadataDirty) { this.inspection!.metadata = status.metadata; this.metadataDraft = clone(status.metadata.value); this.metadataDraftRevision = status.metadata.revision; }
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
    private input(parent: HTMLElement, label: string | (() => string), value: string, update: (value: string) => void, multiline = false, hint: string | (() => string) = '', invalidate = true): HTMLInputElement | HTMLTextAreaElement {
        const labelText = typeof label === 'function' ? label : () => label;
        const field = node('label', '', 'publication-field'), control = multiline ? node('textarea') : node('input');
        if (control instanceof HTMLInputElement) control.type = 'text';
        control.value = value; readerAttribute(control, 'aria-label', labelText);
        control.addEventListener('input', () => { update(control.value); if (invalidate) this.changed(); });
        field.append(readerText(node('span'), labelText), control); if (hint) field.append(readerText(node('small'), typeof hint === 'function' ? hint : () => hint)); parent.append(field); return control;
    }
    private check(parent: HTMLElement, label: string | (() => string), value: boolean, update: (value: boolean) => void): HTMLInputElement {
        const labelText = typeof label === 'function' ? label : () => label;
        const field = node('label', '', 'publication-check'), control = node('input'); control.type = 'checkbox'; control.checked = value;
        control.addEventListener('change', () => update(control.checked)); field.append(control, readerText(node('span'), labelText)); parent.append(field); return control;
    }
    private render(): void {
        if (!this.content) return;
        this.clearPreview(); const w = this.words();
        readerAttribute(this.dialog, 'aria-label', () => this.words().title);
        const header = this.dialog?.querySelector('.publication-header');
        header?.replaceChildren(readerLabel(node('h1', w.title), () => this.words().title), readerLabel(icon(w.close, 'x', () => this.close()), () => this.words().close));
        const content = this.content; content.replaceChildren(readerLabel(node('p', w.intro, 'publication-intro'), () => this.words().intro));
        const nav = node('nav', '', 'publication-steps'); readerAttribute(nav, 'aria-label', () => this.words().title);
        w.steps.forEach((label, index) => {
            const button = readerLabel(node('button', `${index + 1}  ${label}`), () => `${index + 1}  ${this.words().steps[index]}`); button.type = 'button';
            button.setAttribute('aria-current', this.step === index ? 'step' : 'false');
            button.addEventListener('click', () => { this.step = index; this.publishConfirmed = false; this.render(); }); nav.append(button);
        }); content.append(nav);
        if (!this.inspection || !this.profile) { content.append(readerLabel(icon(w.retry, 'reload', () => void this.refresh()), () => this.words().retry)); return; }
        const panel = node('section', '', 'publication-panel'); panel.append(readerLabel(node('h2', w.steps[this.step]), () => this.words().steps[this.step]));
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
        const label = readerLabel(node('label', w.plan, 'publication-field'), () => this.words().plan), select = node('select'); readerAttribute(select, 'aria-label', () => this.words().plan);
        const empty = readerLabel(node('option', w.newPlan), () => this.words().newPlan); empty.value = ''; select.append(empty);
        for (const record of this.inspection!.profiles) { const option = node('option', `${record.profile.id} · ${record.profile.title || this.inspection!.metadata?.value.title || ''}`); option.value = record.profile.id; select.append(option); }
        select.value = this.revision === null ? '' : profile.id;
        select.addEventListener('change', () => {
            this.chooseProfile(this.inspection!.profiles.find(record => record.profile.id === select.value)); this.render();
            const generation = this.generation, view = this.viewRequest;
            if (this.revision !== null) void this.readStatus(generation).then(() => {
                if (this.current(generation) && view === this.viewRequest) this.render();
            }).catch(error => { if (this.current(generation) && view === this.viewRequest) this.report(String(error), true); });
        }); label.append(select); plans.append(label, readerLabel(icon(w.refresh, 'reload', () => void this.refresh()), () => this.words().refresh)); parent.append(plans);
        parent.append(readerLabel(node('p', w.selectHint, 'publication-hint'), () => this.words().selectHint));
        readerLabel(this.check(parent, w.autoMatter, profile.matter?.automatic === true, automatic => { profile.matter = { ...profile.matter, automatic }; this.changed(); this.render(); }), () => this.words().autoMatter);
        parent.append(readerLabel(node('p', w.autoMatterHint, 'publication-hint'), () => this.words().autoMatterHint));
        if (profile.matter?.automatic) {
            const allCandidates = discoverPublicationMatter({ ...profile, matter: { ...profile.matter, exclude: [] } }, this.inspection!.pages);
            const found = [...allCandidates.frontMatter, ...allCandidates.volumeMatter, ...allCandidates.appendices, ...allCandidates.backMatter, ...(allCandidates.continued.length === 1 ? allCandidates.continued : [])];
            if (found.length) {
                const section = readerLabel(this.section(parent, w.autoIncluded), () => this.words().autoIncluded);
                for (const page of found) this.check(section, pageTitle(page), !profile.matter.exclude?.includes(page.path), checked => {
                    const exclude = new Set(profile.matter?.exclude || []); checked ? exclude.delete(page.path) : exclude.add(page.path);
                    profile.matter = { ...profile.matter, exclude: [...exclude] }; profile.chapters = profile.chapters.filter(name => name !== page.path); this.changed(); this.render();
                });
            }
        }
        const actions = node('div', '', 'publication-actions');
        const assigned = this.matterFiles(), available = this.inspection!.pages.filter(page => !assigned.has(page.path));
        const choose = (paths: string[]) => {
            if (profile.matter?.automatic) {
                const exclude = new Set(profile.matter.exclude || []);
                paths.forEach(name => exclude.delete(name));
                profile.matter = { ...profile.matter, exclude: [...exclude] };
            }
            profile.chapters = paths; this.changed(); this.render();
        };
        actions.append(readerLabel(icon(w.all, 'list-plus', () => choose(available.map(page => page.path))), () => this.words().all), readerLabel(icon(w.none, 'eraser', () => choose([])), () => this.words().none),
            readerLabel(node('span', `${w.selectedCount}: ${profile.chapters.filter(file => !assigned.has(file)).length}`, 'publication-hint'), () => `${this.words().selectedCount}: ${profile.chapters.filter(file => !assigned.has(file)).length}`)); parent.append(actions);
        if (!this.inspection!.pages.length) parent.append(readerLabel(node('p', w.empty), () => this.words().empty));
        const groups = new Map<string, typeof this.inspection.pages>();
        for (const page of this.inspection!.pages) {
            const group = [page.bookTitle || page.book, page.volumeTitle || page.volume].filter(Boolean).join(' · ') || w.ungrouped;
            groups.set(group, [...(groups.get(group) || []), page]);
        }
        for (const [title, pages] of groups) {
            const group = node('fieldset', '', 'publication-chapter-group'), legend = node('legend', title); group.append(legend);
            const selectable = pages.filter(page => !assigned.has(page.path));
            const explicit = new Set(profile.chapters);
            const choosePages = (items: PublicationPage[], checked: boolean) => {
                const exclude = new Set(profile.matter?.exclude || []), candidates = profile.matter?.automatic ? discoverPublicationMatter({ ...profile, matter: { ...profile.matter, exclude: [] } }, this.inspection!.pages) : undefined;
                const automatic = new Set([...(candidates?.appendices || []), ...(candidates?.volumeMatter || [])].map(page => page.path));
                for (const page of items) {
                    checked ? explicit.add(page.path) : explicit.delete(page.path);
                    if (!checked && automatic.has(page.path)) exclude.add(page.path);
                }
                if (profile.matter?.automatic) profile.matter = { ...profile.matter, exclude: [...exclude] };
                choose(available.filter(page => explicit.has(page.path)).map(page => page.path));
            };
            const selected = new Set(resolvePublicationMatter(profile, this.inspection!.pages).chapters), groupCheck = readerLabel(this.check(group, w.all + ' · ' + title, !!selectable.length && selectable.every(page => selected.has(page.path)), checked => {
                choosePages(selectable, checked);
            }), () => this.words().all + ' · ' + title); groupCheck.disabled = !selectable.length; groupCheck.indeterminate = selectable.some(page => selected.has(page.path)) && !groupCheck.checked;
            for (const page of pages) {
                const row = node('div', '', 'publication-chapter');
                const control = this.check(row, pageTitle(page), !assigned.has(page.path) && selected.has(page.path), checked => {
                    choosePages([page], checked);
                }); control.disabled = assigned.has(page.path);
                row.append(readerLabel(node('small', page.path + (assigned.has(page.path) ? ` · ${w.usedAs} ${assigned.get(page.path)}` : '')), () => page.path + (assigned.has(page.path) ? ` · ${this.words().usedAs} ${this.matterFiles().get(page.path)}` : ''))); group.append(row);
            } parent.append(group);
        }
        this.renderNext(parent);
    }
    private matterFiles(): Map<string, string> {
        const files = new Map<string, string>(), w = this.words(), profile = this.profile ? resolvePublicationMatter(this.profile, this.inspection?.pages || []) : undefined;
        for (const [entries, role] of [[profile?.frontMatter, w.front], [profile?.backMatter, w.back]] as const) {
            for (const entry of entries || []) if (entry.file) files.set(entry.file, role);
        }
        if (profile?.continued?.file && profile.continued.enabled !== false) files.set(profile.continued.file, w.continued);
        return files;
    }
    private commonChanged(): void { this.metadataDirty = true; this.changed(); }
    private authorEditor(parent: HTMLElement, authors: WorkAuthor[], update: (authors: WorkAuthor[]) => void, common = false): void {
        const w = this.words(), prefix = () => common ? `${w.commonPrefix} · ` : '';
        authors.forEach((author, index) => {
            const card = node('div', '', 'publication-matter'), grid = node('div', '', 'publication-fields');
            for (const [key, label] of [['name', () => w.authorName], ['nativeName', () => w.authorNative], ['orcid', () => 'ORCID'], ['affiliation', () => w.affiliation]] as const) {
                this.input(grid, () => `${prefix()}${label()} ${index + 1}`, author[key] || '', value => { author[key] = value; update(authors); }, false, '', !common);
            }
            this.input(grid, () => `${prefix()}${w.authorAliases} ${index + 1}`, (author.aliases || []).join('\n'), value => { author.aliases = value.split('\n').map(name => name.trim()).filter(Boolean); update(authors); }, true, '', !common);
            card.append(grid, readerLabel(icon(`${prefix()}${w.removeAuthor} ${index + 1}`, 'trash', () => { update(authors.filter((_, position) => position !== index)); this.render(); }), () => `${prefix()}${this.words().removeAuthor} ${index + 1}`)); parent.append(card);
        });
        parent.append(readerLabel(icon(`${prefix()}${w.addAuthor}`, 'plus', () => { update([...authors, { name: '' }]); this.render(); }), () => `${prefix()}${this.words().addAuthor}`));
    }
    private renderMetadata(parent: HTMLElement): void {
        if (!this.inspection?.metadata) return;
        const w = this.words(), value = this.metadataDraft ||= clone(this.inspection.metadata.value), details = node('details', '', 'publication-metadata-editor');
        details.open = this.metadataExpanded || !this.inspection.metadata.value.title;
        details.addEventListener('toggle', () => { this.metadataExpanded = details.open; });
        details.append(readerLabel(node('summary', w.commonMetadata), () => this.words().commonMetadata), readerLabel(node('p', w.commonHint, 'publication-hint'), () => this.words().commonHint));
        const grid = node('div', '', 'publication-fields');
        for (const [key, labelKey] of [['title', 'titleField'], ['subtitle', 'subtitle'], ['language', 'language'], ['license', 'license'], ['licenseUrl', 'licenseUrl'], ['website', 'website'], ['repository', 'repository'], ['description', 'description'], ['preferredCitation', 'preferredCitation']] as const) {
            this.input(grid, () => `${w.commonPrefix} · ${w[labelKey]}`, value[key] || '', text => { value[key] = text; this.commonChanged(); }, ['description', 'preferredCitation'].includes(key), '', false);
        }
        this.input(grid, () => `${w.commonPrefix} · ${w.keywords}`, (value.keywords || []).join('\n'), text => { value.keywords = text.split('\n').map(item => item.trim()).filter(Boolean); this.commonChanged(); }, true, '', false);
        this.input(grid, () => `${w.commonPrefix} · ${w.conceptDoi}`, value.doi?.conceptDoi || '', text => { value.doi = { ...value.doi, conceptDoi: text }; this.commonChanged(); }, false, '', false);
        this.input(grid, () => `${w.commonPrefix} · ${w.provenance}`, value.doi?.provenance || '', text => { value.doi = { ...value.doi, provenance: text }; this.commonChanged(); }, false, '', false);
        details.append(grid);
        this.authorEditor(details, value.authors || [], authors => { value.authors = authors; this.commonChanged(); }, true);
        const conflict = this.metadataDirty && this.metadataDraftRevision !== this.inspection.metadata.revision;
        if (conflict) details.append(readerLabel(node('p', w.commonConflict, 'publication-warning'), () => this.words().commonConflict));
        const save = readerLabel(icon(w.saveCommon, 'save', () => void this.saveCommon()), () => this.words().saveCommon); save.disabled = conflict;
        details.append(save, readerLabel(icon(w.reloadCommon, 'reload', () => {
            void this.request<Inspection>('/api/publication').then(inspection => {
                this.inspection!.metadata = inspection.metadata; this.metadataDraft = clone(inspection.metadata.value); this.metadataDraftRevision = inspection.metadata.revision; this.metadataDirty = false; this.changed(); this.render();
            }).catch(error => this.report(String(error), true));
        }), () => this.words().reloadCommon)); parent.append(details);
    }
    private editionField(parent: HTMLElement, key: keyof WorkMetadata, label: () => string, multiline = false): void {
        const p = this.profile!, w = this.words(), effective = mergeWorkMetadata(this.inspection?.metadata?.value || {}, p), overridden = Object.prototype.hasOwnProperty.call(p, key);
        const row = node('div', '', 'publication-override');
        this.check(row, () => `${w.override} · ${label()}`, overridden, checked => {
            if (checked) (p as any)[key] = clone((effective as any)[key] ?? ''); else delete (p as any)[key];
            this.changed(); this.render();
        });
        const control = this.input(row, label, String((effective as any)[key] || ''), value => { (p as any)[key] = value; }, multiline, overridden ? '' : () => this.words().inherited);
        control.readOnly = !overridden; parent.append(row);
    }
    private manuscriptPicker(parent: HTMLElement, role: 'front-matter' | 'back-matter' | 'continued', current: string | undefined,
        update: (value: string | undefined) => void, identity: string): void {
        const w = this.words(), field = readerLabel(node('label', w.matterFile, 'publication-field'), () => this.words().matterFile), select = node('select');
        const roleTitle = () => role === 'front-matter' ? w.front : role === 'back-matter' ? w.back : w.continued, number = /-(\d+)$/.exec(identity)?.[1];
        readerAttribute(select, 'aria-label', () => `${this.words().matterFile} · ${roleTitle()}${number ? ` ${number}` : ''}`); select.dataset.publicationFile = identity;
        const inline = readerLabel(node('option', w.inlineSource), () => this.words().inlineSource); inline.value = ''; select.append(inline);
        const used = this.matterFiles(), pages = [...(this.inspection?.pages || [])].filter(page => page.path === current || !used.has(page.path));
        pages.sort((a, b) => Number(b.kind === role) - Number(a.kind === role));
        for (const page of pages) { const option = node('option', `${pageTitle(page)} · ${page.path}`); option.value = page.path; select.append(option); }
        if (current && !pages.some(page => page.path === current)) { const option = readerLabel(node('option', `${current} · ${w.fileUnavailable}`), () => `${current} · ${this.words().fileUnavailable}`); option.value = current; select.append(option); }
        select.value = current || ''; select.addEventListener('change', () => {
            const restoreFocus = document.activeElement === select;
            update(select.value || undefined); this.changed(); this.render();
            if (restoreFocus && (document.activeElement === document.body || document.activeElement === select)) {
                this.content?.querySelector<HTMLSelectElement>(`[data-publication-file="${identity}"]`)?.focus();
            }
        });
        field.append(select, readerLabel(node('small', w.filePriority), () => this.words().filePriority)); parent.append(field);
    }
    private renderDetails(parent: HTMLElement): void {
        const w = this.words(), p = this.profile!, grid = node('div', '', 'publication-fields');
        this.renderMetadata(parent);
        readerLabel(this.input(grid, w.planName, p.id, value => {
            p.id = value; this.revision = null; this.status = undefined; this.build = undefined; this.manifest = undefined; ++this.viewRequest;
        }, false, () => this.words().planHint), () => this.words().planName);
        readerLabel(this.input(grid, w.work, p.workId, value => { p.workId = value; }, false, () => this.words().workHint), () => this.words().work);
        this.editionField(grid, 'title', () => w.titleField);
        this.editionField(grid, 'subtitle', () => w.subtitle);
        readerLabel(this.input(grid, w.version, p.version, value => { p.version = value; }), () => this.words().version);
        readerLabel(this.input(grid, w.edition, p.edition || '', value => { p.edition = value; }), () => this.words().edition);
        readerLabel(this.input(grid, w.releaseTag, p.releaseTag || '', value => { p.releaseTag = value; }), () => this.words().releaseTag);
        readerLabel(this.input(grid, w.releaseCommit, p.releaseCommit || '', value => { p.releaseCommit = value; }), () => this.words().releaseCommit);
        this.editionField(grid, 'license', () => w.license);
        this.editionField(grid, 'licenseUrl', () => w.licenseUrl);
        this.editionField(grid, 'website', () => w.website);
        this.editionField(grid, 'repository', () => w.repository);
        this.editionField(grid, 'preferredCitation', () => w.preferredCitation, true);
        readerLabel(this.input(grid, w.publicationDate, p.publicationDate || '', value => { p.publicationDate = value; }), () => this.words().publicationDate);
        const language = readerLabel(node('label', w.language, 'publication-field'), () => this.words().language), languageChoice = node('select'); readerAttribute(languageChoice, 'aria-label', () => this.words().language);
        readerLabel(this.check(grid, `${w.override} · ${w.language}`, p.language !== undefined, checked => {
            if (checked) p.language = this.inspection?.metadata?.value.language || this.context().manuscriptLanguage || this.context().language; else delete p.language;
            this.changed(); this.render();
        }), () => `${this.words().override} · ${this.words().language}`);
        for (const locale of ['zh', 'en'] as const) { const option = readerLabel(node('option', w[locale]), () => this.words()[locale]); option.value = locale; languageChoice.append(option); }
        languageChoice.value = (p.language || this.inspection?.metadata?.value.language || this.context().manuscriptLanguage || this.context().language).startsWith('zh') ? 'zh' : 'en'; languageChoice.disabled = p.language === undefined;
        languageChoice.addEventListener('change', () => { p.language = languageChoice.value; this.changed(); }); language.append(languageChoice); grid.append(language);
        parent.append(grid); this.editionField(parent, 'description', () => w.description, true);
        const authors = readerLabel(this.section(parent, w.author), () => this.words().author), hasAuthors = p.authors !== undefined;
        readerLabel(this.check(authors, `${w.override} · ${w.author}`, hasAuthors, checked => {
            if (checked) p.authors = clone(this.inspection?.metadata?.value.authors || []); else delete p.authors;
            this.changed(); this.render();
        }), () => `${this.words().override} · ${this.words().author}`);
        const authorFields = node('fieldset'); authorFields.disabled = !hasAuthors;
        this.authorEditor(authorFields, clone(p.authors || this.inspection?.metadata?.value.authors || []), value => { p.authors = value; this.changed(); }); authors.append(authorFields);
        if (!hasAuthors) authors.append(readerLabel(node('p', w.inherited, 'publication-hint'), () => this.words().inherited));
        const effectiveKeywords = p.keywords || this.inspection?.metadata?.value.keywords || [];
        const keywordRow = node('div', '', 'publication-override');
        readerLabel(this.check(keywordRow, `${w.override} · ${w.keywords}`, p.keywords !== undefined, checked => { if (checked) p.keywords = [...effectiveKeywords]; else delete p.keywords; this.changed(); this.render(); }), () => `${this.words().override} · ${this.words().keywords}`);
        const keywordInput = this.input(keywordRow, () => w.keywords, effectiveKeywords.join('\n'), value => { p.keywords = value.split('\n').map(item => item.trim()).filter(Boolean); }, true); keywordInput.readOnly = p.keywords === undefined; parent.append(keywordRow);
        const cover = readerLabel(this.section(parent, w.cover), () => this.words().cover); cover.append(readerLabel(node('p', w.coverHint, 'publication-hint'), () => this.words().coverHint));
        readerLabel(this.input(cover, w.coverImage, p.cover?.image || '', value => { p.cover = { ...p.cover, image: value || undefined }; }), () => this.words().coverImage);
        readerLabel(this.check(cover, w.coverVersion, p.cover?.showVersion !== false, value => { p.cover = { ...p.cover, showVersion: value }; this.changed(); }), () => this.words().coverVersion);
        if (p.matter?.automatic) {
            parent.append(readerLabel(node('p', w.autoMatterHint, 'publication-hint'), () => this.words().autoMatterHint), readerLabel(icon(w.customMatter, 'list-plus', () => {
                const resolved = resolvePublicationMatter(p, this.inspection?.pages || []);
                p.frontMatter = resolved.frontMatter; p.backMatter = resolved.backMatter; p.chapters = resolved.chapters; p.continued = resolved.continued; p.matter = { ...p.matter, automatic: false }; this.changed(); this.render();
            }), () => this.words().customMatter));
        }
        for (const [key, title] of [['frontMatter', w.front], ['backMatter', w.back]] as const) {
            const section = readerLabel(this.section(parent, title), () => this.words()[key === 'frontMatter' ? 'front' : 'back']);
            const role = key === 'frontMatter' ? 'front-matter' : 'back-matter';
            (p[key] || []).forEach((matter, index) => {
                const entry = node('div', '', 'publication-matter');
                this.manuscriptPicker(entry, role, matter.file, value => { matter.file = value; }, `${key}-${index + 1}`);
                readerLabel(this.input(entry, w.matterTitle, matter.title || '', value => { matter.title = value || undefined; }), () => this.words().matterTitle);
                readerLabel(this.input(entry, w.matterText, matter.content || '', value => { matter.content = value || undefined; }, true), () => this.words().matterText);
                readerLabel(this.check(entry, w.inToc, matter.includeInToc !== false, value => { matter.includeInToc = value; this.changed(); }), () => this.words().inToc);
                entry.append(readerLabel(icon(`${w.removeMatter} ${matter.title || title}`, 'trash', () => { p[key].splice(index, 1); this.changed(); this.render(); }), () => `${this.words().removeMatter} ${matter.title || this.words()[key === 'frontMatter' ? 'front' : 'back']}`)); section.append(entry);
                for (const direction of [-1, 1]) {
                    const move = readerLabel(icon(`${direction < 0 ? w.moveUp : w.moveDown} ${matter.title || matter.file || title}`, direction < 0 ? 'chevron-up' : 'chevron-down', () => {
                        const target = index + direction; [p[key][index], p[key][target]] = [p[key][target], p[key][index]]; this.changed(); this.render();
                    }), () => `${direction < 0 ? this.words().moveUp : this.words().moveDown} ${matter.title || matter.file || this.words()[key === 'frontMatter' ? 'front' : 'back']}`);
                    move.disabled = index + direction < 0 || index + direction >= p[key].length; entry.append(move);
                }
            });
            section.append(readerLabel(icon(`${w.addMatter} ${title}`, 'plus', () => {
                (p[key] ||= []).push({ includeInToc: true }); this.changed(); this.render();
            }), () => `${this.words().addMatter} ${this.words()[key === 'frontMatter' ? 'front' : 'back']}`));
        }
        const toc = readerLabel(this.section(parent, w.toc), () => this.words().toc);
        readerLabel(this.check(toc, w.tocEnabled, p.toc?.enabled !== false, value => { p.toc = { ...p.toc, enabled: value }; this.changed(); }), () => this.words().tocEnabled);
        readerLabel(this.input(toc, w.tocTitle, p.toc?.title || copy[this.context().manuscriptLanguage || this.context().language].toc, value => { p.toc = { ...p.toc, title: value }; }), () => this.words().tocTitle);
        const depth = readerLabel(this.input(toc, w.tocDepth, String(p.toc?.depth || 2), value => { p.toc = { ...p.toc, depth: Number(value) }; }), () => this.words().tocDepth);
        if (depth instanceof HTMLInputElement) { depth.type = 'number'; depth.min = '1'; depth.max = '6'; }
        const continued = readerLabel(this.section(parent, w.continued), () => this.words().continued);
        const continuedEnabled = readerLabel(this.check(continued, w.continuedEnabled, p.continued?.enabled ?? !!p.continued?.file, value => { p.continued = { ...p.continued, enabled: value }; this.changed(); this.render(); }), () => this.words().continuedEnabled);
        if (p.continued?.enabled === undefined) { continuedEnabled.indeterminate = !p.continued?.file; continued.append(readerLabel(node('p', w.continuedAuto, 'publication-hint'), () => this.words().continuedAuto)); }
        this.manuscriptPicker(continued, 'continued', p.continued?.file, value => { p.continued = { ...p.continued, file: value }; }, 'continued');
        readerLabel(this.input(continued, w.continuedTitle, p.continued?.title || '', value => { p.continued = { ...p.continued, title: value || undefined }; }), () => this.words().continuedTitle);
        readerLabel(this.input(continued, w.continuedText, p.continued?.text || '', value => { p.continued = { ...p.continued, text: value || undefined }; }, true), () => this.words().continuedText);
        const actions = node('div', '', 'publication-actions'); actions.append(readerLabel(icon(w.save, 'save', () => void this.save()), () => this.words().save)); parent.append(actions); this.renderNext(parent);
    }
    private section(parent: HTMLElement, title: string): HTMLElement {
        const section = node('section', '', 'publication-section'); section.append(node('h3', title)); parent.append(section); return section;
    }
    private checksum(parent: HTMLElement, value: string): void {
        const details = node('details', '', 'publication-checksum');
        details.append(readerLabel(node('summary', `${this.words().exactPdf}: ${value.slice(0, 12)}…`), () => `${this.words().exactPdf}: ${value.slice(0, 12)}…`), node('p', value)); parent.append(details);
    }
    private renderNext(parent: HTMLElement): void {
        if (this.step >= 3) return;
        const next = readerLabel(icon(this.words().steps[this.step + 1], 'chevron-right', () => { ++this.step; this.render(); }, true), () => this.words().steps[this.step + 1]);
        const footer = node('div', '', 'publication-actions publication-next'); footer.append(next); parent.append(footer);
    }
    private renderReview(parent: HTMLElement): void {
        const w = this.words(); parent.append(readerLabel(node('p', w.reviewHint, 'publication-hint'), () => this.words().reviewHint));
        const actions = node('div', '', 'publication-actions'); actions.append(readerLabel(icon(w.review, 'scan', () => void this.review(), true), () => this.words().review)); parent.append(actions);
        const plan = this.plan; if (!plan) { parent.append(readerLabel(node('p', w.needReview, 'publication-hint'), () => this.words().needReview)); return; }
        const metadata = readerLabel(this.section(parent, w.resolvedMetadata), () => this.words().resolvedMetadata), effective = plan.profile;
        for (const [label, value] of [['titleField', effective.title], ['subtitle', effective.subtitle], ['version', effective.version], ['author', (effective.authors || []).map(author => [author.name, author.nativeName, author.aliases?.join('; '), author.orcid, author.affiliation].filter(Boolean).join(' · ')).join('\n')], ['website', effective.website], ['repository', effective.repository], ['license', effective.license], ['publicationDate', effective.publicationDate], ['versionDoi', plan.doi.versionDoi], ['conceptDoi', plan.doi.conceptDoi]]) {
            if (value) { const row = node('p', '', 'publication-prose'); row.append(readerText(node('span'), () => `${w[label]}: `), node('span', value)); metadata.append(row); }
        }
        const summary = node('div', '', 'publication-review-grid');
        for (const [key, pages] of [['selected', plan.selected], ['omitted', plan.omitted]] as const) {
            const section = readerLabel(this.section(summary, `${w[key]} (${pages.length})`), () => `${this.words()[key]} (${pages.length})`), list = node('ol');
            pages.forEach(page => { const item = node('li', [page.bookTitle, page.volumeTitle, pageTitle(page)].filter(Boolean).join(' · ')); item.append(node('small', page.path)); list.append(item); }); section.append(list);
        } parent.append(summary);
        const references = readerLabel(this.section(parent, `${w.external} (${plan.externalReferences.length})`), () => `${this.words().external} (${plan.externalReferences.length})`);
        references.append(readerLabel(node('p', plan.externalReferences.length ? w.externalHint : w.noExternal, 'publication-hint'), () => plan.externalReferences.length ? this.words().externalHint : this.words().noExternal));
        if (plan.externalReferences.length) {
            const list = node('ul'); plan.externalReferences.forEach(reference => list.append(node('li', `${reference.source}:${reference.line} → ${reference.label || reference.target}`))); references.append(list);
        }
        for (const [key, entries] of [['front', plan.frontMatter || plan.profile.frontMatter || []], ['back', plan.backMatter || plan.profile.backMatter || []]] as const) {
            if (!entries.length) continue;
            const section = readerLabel(this.section(parent, w[key]), () => this.words()[key]);
            for (const entry of entries) {
                const preview = node('div', '', 'publication-matter');
                if (entry.title) preview.append(node('h4', entry.title));
                preview.append(readerLabel(node('p', entry.file ? `${w.sourceFile}: ${entry.file} · ${w.manuscriptPreview}` : w.sourceInline, 'publication-hint'), () => entry.file ? `${this.words().sourceFile}: ${entry.file} · ${this.words().manuscriptPreview}` : this.words().sourceInline), node('div', manuscriptPreview(entry.content || ''), 'publication-prose')); section.append(preview);
            }
        }
        if (plan.continuedNotice.enabled) {
            const notice = this.section(parent, plan.continuedNotice.title);
            if (plan.continuedNotice.file) notice.append(readerLabel(node('p', `${w.sourceFile}: ${plan.continuedNotice.file} · ${w.manuscriptPreview}`, 'publication-hint'), () => `${this.words().sourceFile}: ${plan.continuedNotice.file} · ${this.words().manuscriptPreview}`));
            notice.append(node('div', manuscriptPreview(plan.continuedNotice.text), 'publication-prose'));
        }
        parent.append(readerLabel(node('p', `${w.reviewDoi}: ${plan.doi.versionDoi || w.noDoi}`), () => `${this.words().reviewDoi}: ${plan.doi.versionDoi || this.words().noDoi}`));
        // This service warning is already expressed by the localized reference section above.
        const referenceWarning = `${plan.externalReferences.length} reference(s) point outside this edition; omitted pages are not added automatically.`;
        const warnings = plan.warnings.filter(warning => !plan.externalReferences.length || warning !== referenceWarning);
        if (warnings.length) { const list = node('ul', '', 'publication-warning'); warnings.forEach(warning => list.append(node('li', warning))); parent.append(list); }
        const toolsReady = plan.tools.pandoc.available && plan.tools.engine.available;
        if (!toolsReady) parent.append(readerLabel(node('p', w.toolsMissing, 'publication-warning'), () => this.words().toolsMissing));
        const confirmation = readerLabel(this.check(parent, w.acknowledge, this.scopeConfirmed, value => { this.scopeConfirmed = value; build.disabled = !value || !toolsReady; }), () => this.words().acknowledge);
        confirmation.dataset.scopeConfirm = 'true';
        const build = readerLabel(icon(w.build, 'publication', () => void this.createBuild(), true), () => this.words().build); build.dataset.build = 'true'; build.disabled = !this.scopeConfirmed || !toolsReady;
        const footer = node('div', '', 'publication-actions'); footer.append(build); parent.append(footer);
    }
    private renderDelivery(parent: HTMLElement): void {
        const w = this.words(), build = this.build, frozenProfile = this.manifest?.plan.profile;
        if (build) {
            const edition = this.section(parent, `${frozenProfile?.title || this.profile!.title} · ${build.version}`);
            edition.append(readerLabel(node('p', w.frozen, 'publication-hint'), () => this.words().frozen), readerLabel(node('p', `${w.builtAt}: ${new Date(build.createdAt).toLocaleString(this.context().language)}`), () => `${this.words().builtAt}: ${new Date(build.createdAt).toLocaleString(this.context().language)}`));
            if (this.manifest) {
                const scope = node('details', '', 'publication-section'); scope.append(readerLabel(node('summary', `${w.selected} (${this.manifest.plan.selected.length})`), () => `${this.words().selected} (${this.manifest.plan.selected.length})`));
                const list = node('ol'); this.manifest.plan.selected.forEach(page => list.append(node('li', [pageTitle(page), page.path].filter(Boolean).join(' · ')))); scope.append(list); edition.append(scope);
            }
            this.checksum(edition, build.pdfSha256);
            const actions = node('div', '', 'publication-actions');
            actions.append(readerLabel(icon(w.preview, 'visible', () => void this.artifact('publication.pdf', true)), () => this.words().preview), readerLabel(icon(w.download, 'download', () => void this.artifact('publication.pdf')), () => this.words().download),
                readerLabel(icon(w.manifest, 'list-plus', () => void this.artifact('manifest.json')), () => this.words().manifest), readerLabel(icon(w.citation, 'copy-source', () => void this.artifact('citation.json')), () => this.words().citation)); edition.append(actions);
        } else parent.append(readerLabel(node('p', w.noBuild, 'publication-hint'), () => this.words().noBuild));
        const doi = readerLabel(this.section(parent, w.doi), () => this.words().doi); doi.append(readerLabel(node('p', w.doiHint, 'publication-hint'), () => this.words().doiHint));
        const manual = node('details', '', 'publication-section'); manual.append(readerLabel(node('summary', w.manual), () => this.words().manual));
        const p = this.profile!;
        readerLabel(this.input(manual, w.versionDoi, p.doi?.versionDoi || '', value => { p.doi = { ...p.doi, versionDoi: value || undefined }; }), () => this.words().versionDoi);
        const workDoi = this.input(manual, w.conceptDoi, p.doi?.conceptDoi ?? this.inspection?.metadata?.value.doi?.conceptDoi ?? '', value => { p.doi = { ...p.doi, conceptDoi: value }; });
        readerLabel(workDoi, () => this.words().conceptDoi);
        manual.append(readerLabel(icon(`${w.inherited} · ${w.conceptDoi}`, 'reset', () => { if (p.doi) delete p.doi.conceptDoi; this.changed(); this.render(); }), () => `${this.words().inherited} · ${this.words().conceptDoi}`));
        readerLabel(this.input(manual, w.provenance, p.doi?.provenance ?? this.inspection?.metadata?.value.doi?.provenance ?? '', value => { p.doi = { ...p.doi, provenance: value }; }), () => this.words().provenance);
        manual.append(readerLabel(node('p', w.manualHint, 'publication-hint'), () => this.words().manualHint), readerLabel(icon(w.save, 'save', () => void this.save()), () => this.words().save)); doi.append(manual);
        const zenodo = readerLabel(this.section(doi, w.zenodo), () => this.words().zenodo), remote = this.status?.remote;
        const environment = readerLabel(node('label', w.environment, 'publication-field'), () => this.words().environment), select = node('select'); readerAttribute(select, 'aria-label', () => this.words().environment);
        for (const [value, title] of [['production', w.production], ['sandbox', w.sandbox]]) { const option = readerLabel(node('option', title), () => this.words()[value as 'production' | 'sandbox']); option.value = value; select.append(option); }
        select.value = p.zenodo?.environment || 'sandbox'; select.disabled = !!remote;
        select.addEventListener('change', () => { p.zenodo = { ...p.zenodo, environment: select.value as 'production' | 'sandbox' }; this.changed(); }); environment.append(select); zenodo.append(environment);
        const credentialReady = this.status?.credential.configured || this.inspection?.credentialStatus.find(item => item.profileId === p.id)?.configured;
        zenodo.append(readerLabel(node('p', credentialReady ? w.credentialReady : w.credentialMissing, 'publication-hint'), () => credentialReady ? this.words().credentialReady : this.words().credentialMissing));
        zenodo.append(readerLabel(node('p', remote ? remote.status === 'published' ? w.published : remote.status === 'unknown' || remote.pending ? w.remoteUnknown : w.reserved : w.noRemote,
            remote?.status === 'unknown' || remote?.pending ? 'publication-warning' : 'publication-hint'), () => remote ? remote.status === 'published' ? this.words().published : remote.status === 'unknown' || remote.pending ? this.words().remoteUnknown : this.words().reserved : this.words().noRemote));
        if (remote?.versionDoi) zenodo.append(readerLabel(node('p', `${w.versionDoi}: ${remote.versionDoi}`), () => `${this.words().versionDoi}: ${remote.versionDoi}`));
        if (remote?.conceptDoi) zenodo.append(readerLabel(node('p', `${w.conceptDoi}: ${remote.conceptDoi}`), () => `${this.words().conceptDoi}: ${remote.conceptDoi}`));
        if (remote?.recordId || remote?.draftId) zenodo.append(readerLabel(node('p', `${w.remoteRecord}: ${remote.recordId || remote.draftId}`), () => `${this.words().remoteRecord}: ${remote.recordId || remote.draftId}`));
        if (remote?.history?.length) { const history = readerLabel(this.section(zenodo, w.oldEditions), () => this.words().oldEditions); remote.history.forEach(edition => history.append(node('p', `${edition.recordId} · ${edition.versionDoi || ''}`))); }
        if (remote?.status === 'published') {
            const section = readerLabel(this.section(zenodo, w.verification), () => this.words().verification);
            section.append(readerLabel(node('p', w.verificationHint, 'publication-hint'), () => this.words().verificationHint));
            if (remote.environment === 'sandbox') section.append(readerLabel(node('p', w.verificationSandbox, 'publication-hint'), () => this.words().verificationSandbox));
            const receipt = this.status?.verifications?.find(item => item.buildId === build?.id && item.pdfSha256 === build?.pdfSha256 && item.recordId === remote.recordId && item.environment === remote.environment);
            const verdict = () => !receipt ? this.words().verificationNone : receipt.status === 'verified' ? this.words().verificationPassed : receipt.status === 'failed' ? this.words().verificationFailed : receipt.environment === 'sandbox' && receipt.record.status === 'passed' && receipt.file.status === 'passed' && receipt.doi.httpStatus === 404 ? this.words().verificationSandboxIncomplete : this.words().verificationPending;
            section.append(readerLabel(node('p', verdict(), receipt?.status === 'failed' ? 'publication-warning' : 'publication-hint'), verdict));
            if (receipt) {
                section.append(readerLabel(node('p', `${w.checkedAt}: ${new Date(receipt.checkedAt).toLocaleString(this.context().language)}`), () => `${this.words().checkedAt}: ${new Date(receipt.checkedAt).toLocaleString(this.context().language)}`));
                for (const [key, label] of [['record', 'recordCheck'], ['file', 'fileCheck'], ['doi', 'doiCheck']] as const) {
                    const check = receipt[key], line = () => `${this.words()[label]}: ${check.status === 'passed' ? this.words().checkPassed : check.status === 'failed' ? this.words().checkFailed : this.words().checkPending}`;
                    section.append(readerLabel(node('p', line()), line));
                }
            }
            const verify = readerLabel(icon(w.verifyPublished, 'scan', () => {
                if (build && remote.recordId) void this.remoteAction('verify-published', { buildId: build.id, pdfSha256: build.pdfSha256, recordId: remote.recordId });
            }), () => this.words().verifyPublished);
            verify.disabled = !build || !remote.recordId; section.append(verify);
            const confirm = readerLabel(this.check(zenodo, w.confirmNew, this.versionConfirmed, value => { this.versionConfirmed = value; next.disabled = !value || !credentialReady; }), () => this.words().confirmNew);
            confirm.dataset.newVersionConfirm = 'true';
            const next = readerLabel(icon(w.newVersion, 'plus', () => { if (this.versionConfirmed) void this.remoteAction('reserve-doi', { mode: 'new-version', expectedRecordId: remote.recordId, confirmedNewVersion: true }); }), () => this.words().newVersion);
            next.disabled = !this.versionConfirmed || !credentialReady; zenodo.append(next);
        } else if (!remote || remote.status === 'draft' && !remote.pending) {
            const reserve = readerLabel(icon(w.reserve, 'integration-managed', () => void this.remoteAction('reserve-doi', { mode: 'reuse-or-create' })), () => this.words().reserve);
            reserve.disabled = !credentialReady; zenodo.append(reserve);
        }
        const attach = node('details', '', 'publication-section'); attach.append(readerLabel(node('summary', w.attach), () => this.words().attach));
        const id = readerLabel(this.input(attach, w.remoteId, '', () => {}, false, '', false), () => this.words().remoteId), typeLabel = readerLabel(node('label', w.remoteKind, 'publication-field'), () => this.words().remoteKind), kind = node('select');
        readerAttribute(kind, 'aria-label', () => this.words().remoteKind);
        for (const [value, title] of [['draft', w.draftKind], ['record', w.recordKind]]) { const option = readerLabel(node('option', title), () => value === 'draft' ? this.words().draftKind : this.words().recordKind); option.value = value; kind.append(option); }
        typeLabel.append(kind); attach.append(typeLabel);
        const connect = readerLabel(icon(w.attach, 'integration-managed', () => void this.remoteAction('attach-zenodo', { id: id.value, kind: kind.value })), () => this.words().attach); connect.disabled = !credentialReady; attach.append(connect); zenodo.append(attach);
        if (remote?.status === 'draft' && !remote.pending && build) {
            zenodo.append(readerLabel(node('p', w.uploadHint, 'publication-hint'), () => this.words().uploadHint));
            const review = readerLabel(icon(w.reviewUpload, 'scan', () => void this.reviewUpload()), () => this.words().reviewUpload);
            review.disabled = !credentialReady || this.dirty || !this.manifest || this.manifest.plan.doi.versionDoi !== remote.versionDoi; zenodo.append(review);
            if (this.uploadPlan?.buildId === build.id && this.uploadPlan.remoteRevision === remote.revision) {
                const changes = readerLabel(this.section(zenodo, w.reviewUpload), () => this.words().reviewUpload), current = readerLabel(this.section(changes, w.remoteFiles), () => this.words().remoteFiles);
                this.uploadPlan.files.forEach(file => current.append(node('p', `${file.name} · ${file.checksum}`, 'publication-checksum')));
                for (const [key, files] of [['addFiles', this.uploadPlan.add], ['replaceFiles', this.uploadPlan.replace], ['removeFiles', this.uploadPlan.remove], ['blockedFiles', this.uploadPlan.blocked]] as const) {
                    const section = readerLabel(this.section(changes, w[key]), () => this.words()[key]), list = node('ul'); files.forEach(file => list.append(node('li', file)));
                    section.append(files.length ? list : readerLabel(node('p', w.filesUnchanged, 'publication-hint'), () => this.words().filesUnchanged));
                }
                if (this.uploadPlan.blocked.length) changes.append(readerLabel(node('p', w.blockedHint, 'publication-warning'), () => this.words().blockedHint));
                const upload = readerLabel(icon(w.uploadFiles, 'save', () => void this.remoteAction('upload', { buildId: build.id, pdfSha256: build.pdfSha256, remoteRevision: remote.revision, uploadFingerprint: this.uploadPlan?.fingerprint })), () => this.words().uploadFiles);
                upload.disabled = !credentialReady || this.dirty || this.uploadPlan.blocked.length > 0; changes.append(upload);
            }
            zenodo.append(readerLabel(node('p', w.needBuildReserved, 'publication-hint'), () => this.words().needBuildReserved));
            if (remote.upload?.buildId === build.id && remote.upload.pdfSha256 === build.pdfSha256) {
                const publish = readerLabel(this.section(zenodo, w.publish), () => this.words().publish); publish.append(readerLabel(node('p', w.uploaded), () => this.words().uploaded), readerLabel(node('p', w.publishWarning, 'publication-warning'), () => this.words().publishWarning),
                    node('p', `${frozenProfile?.title || this.profile!.title} · ${build.version}`),
                    readerLabel(node('p', `${w.author}: ${frozenProfile?.authors.map(author => author.name).join(', ') || ''}`), () => `${this.words().author}: ${frozenProfile?.authors.map(author => author.name).join(', ') || ''}`),
                    readerLabel(node('p', `${w.license}: ${frozenProfile?.license || ''}`), () => `${this.words().license}: ${frozenProfile?.license || ''}`),
                    node('p', frozenProfile?.description || ''), readerLabel(node('p', `${w.versionDoi}: ${remote.versionDoi || w.noDoi}`), () => `${this.words().versionDoi}: ${remote.versionDoi || this.words().noDoi}`));
                this.checksum(publish, build.pdfSha256);
                const confirm = readerLabel(this.check(publish, w.publishCheck, this.publishConfirmed, value => { this.publishConfirmed = value; action.disabled = !value || !credentialReady || !this.manifest; }), () => this.words().publishCheck); confirm.dataset.publishConfirm = 'true';
                const action = readerLabel(icon(w.publish, 'publication', () => { if (this.publishConfirmed && this.manifest) void this.remoteAction('publish', { buildId: build.id, pdfSha256: build.pdfSha256, remoteRevision: remote.revision, recordId: remote.draftId || remote.recordId, confirmedPublication: true }); }, true), () => this.words().publish);
                action.disabled = !this.publishConfirmed || !credentialReady || !this.manifest; publish.append(action);
            }
        }
    }
    private async save(): Promise<boolean> {
        if (!this.profile || this.busy) return false;
        const generation = this.generation;
        if (this.metadataDirty && !await this.saveCommon()) return false;
        const result = await this.run('save', { profile: clone(this.profile), expectedRevision: this.revision });
        if (!result || !this.current(generation)) return false;
        const record = result as PublicationProfileRecord; this.profile = clone(record.profile); this.revision = record.revision; this.dirty = false;
        const profiles = this.inspection!.profiles; this.inspection!.profiles = [...profiles.filter(item => item.profile.id !== record.profile.id), record];
        this.busy = true; this.render(); this.report(this.words().saved);
        try { await this.readStatus(generation); } catch (error) { if (this.current(generation)) this.report(String(error), true); }
        if (!this.current(generation)) return false; this.busy = false; this.render(); return true;
    }
    private async saveCommon(): Promise<boolean> {
        if (this.busy || !this.inspection?.metadata || !this.metadataDraft) return false;
        const generation = this.generation, result = await this.run('save-metadata', { metadata: clone(this.metadataDraft), expectedRevision: this.metadataDraftRevision });
        if (!result || !this.current(generation)) return false;
        this.inspection.metadata = result; this.metadataDraft = clone(result.value); this.metadataDraftRevision = result.revision; this.metadataDirty = false; this.changed(); this.render(); this.report(this.words().commonSaved); return true;
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
        if (action !== 'verify-published' && this.dirty && !await this.save()) return;
        if (action !== 'verify-published' && this.revision === null && !await this.save()) return;
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
        const w = this.words(); this.report(action === 'save-metadata' ? w.savingCommon : action === 'save' ? w.savePhase : action === 'review' ? w.reviewPhase : action === 'build' ? w.buildPhase : w.remotePhase);
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
        if (job.action === 'save-metadata') return w.savingCommon;
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
                header.append(readerLabel(node('h3', this.words().previewTitle), () => this.words().previewTitle), readerLabel(icon(this.words().closePreview, 'x', () => this.clearPreview()), () => this.words().closePreview));
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
