import type { CreatePageInput, ManuscriptCreationScope, ManuscriptPagePlan } from '../../manuscript/create-page-types';
import { copyReaderText } from './reader-clipboard';
import { describeReaderIconAction, readerIconAction } from './reader-icons';

export interface ReaderCreatePageContext {
    projectId: string | null; requestToken?: string; language: string; currentPath: string; revision?: number;
}
export interface ReaderCreatePageHost {
    context(): ReaderCreatePageContext;
    request(path: string, init?: RequestInit): Promise<Response>;
    beforeOpen(): void;
    canAssist(): boolean;
    /** Native composer handoff only; integration retains send:false. */
    assist(content: any[]): Promise<unknown>;
    openPage(filePath: string, isCurrent: () => boolean): Promise<boolean>;
    report(message: string): void;
}
interface ScopeResponse { projectRoot: string; scopes: ManuscriptCreationScope[]; defaultContainer: string }
interface PlanResponse { projectRoot: string; plan: ManuscriptPagePlan; assistantCommand: { executable: string; cwd: string; args: string[] } }
const kinds: CreatePageInput['kind'][] = ['chapter', 'front-matter', 'back-matter', 'continued'];
const kindZh = { chapter: '正文', 'front-matter': '前文', 'back-matter': '后文', continued: '未完待续' };
const kindEn = { chapter: 'Chapter', 'front-matter': 'Front matter', 'back-matter': 'Back matter', continued: 'To be continued' };
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
}

/** Keep user-authored titles as argv data; never interpolate them into an executable shell string. */
export function createPageHandoff(payload: PlanResponse, language: string): string {
    const plan = payload.plan;
    const instruction = language === 'zh'
        ? '请按下面的确切项目、类型、标题与位置新建页面，并根据我补充的要求撰写正文。先读取该项目的写作规则，再用 assistantCommand.executable 执行 args 参数数组；cwd 是项目根目录，参数是数据，不要把标题拼入 shell 命令。如果计划过期，先重新只读规划；项目、类型、标题、容器和文件位置均未变化时更新状态令牌后继续。若目标位置变化或已存在，展示差异或打开现有页面，待我核对。创建后在该页面写正文并运行相关检查。不要自动修改出版方案。\n\n我对正文的要求：'
        : 'Create a page with the exact project, kind, title and location below, then write its body using my additional requirements. Read the project writing rules first, then run assistantCommand.executable with its args array. Use cwd as the project root and treat arguments as data; never interpolate the title into a shell command. If the plan is stale, replan without writing; update the state token and continue when the project, kind, title, container and file path are unchanged. If the target location changed or already exists, show the difference or open the existing page for my review. Write the body in the created page and run the relevant checks. Do not update publication plans automatically.\n\nMy requirements for the body:';
    return instruction + '\n\n' + JSON.stringify({ projectRoot: payload.projectRoot, kind: plan.kind, title: plan.title,
        container: plan.container, filePath: plan.filePath, assistantCommand: payload.assistantCommand }, null, 2);
}

/** Owns dialog admission, scope/plan projection, exact context binding and explicit handoff. */
export class ReaderCreatePage {
    private dialog?: HTMLDialogElement;
    private titleInput?: HTMLInputElement;
    private kindInput?: HTMLSelectElement;
    private scopeInput?: HTMLSelectElement;
    private scopes?: ScopeResponse;
    private payload?: PlanResponse;
    private snapshot?: ReaderCreatePageContext;
    private generation = 0;
    private busy = false;
    private status: '' | 'changed' | 'copied' | 'copy-failed' | 'unavailable' = '';
    private errorMessage = '';
    private error = false;
    private requestText = '';
    private planTimer?: ReturnType<typeof window.setTimeout>;
    private readonly launch = () => { this.host.beforeOpen(); void this.open(); };

    constructor(private readonly trigger: HTMLButtonElement, private readonly host: ReaderCreatePageHost) {
        trigger.addEventListener('click', this.launch); this.updateTrigger();
    }
    private t(zh: string, en: string): string { return this.host.context().language === 'zh' ? zh : en; }
    private identity(context = this.host.context()): string {
        return JSON.stringify([context.projectId, context.requestToken || '', context.currentPath, context.revision]);
    }
    private matches(generation: number): boolean {
        return !!this.dialog && this.generation === generation && this.identity(this.snapshot) === this.identity();
    }
    private updateTrigger(): void {
        const label = this.t('新建页面', 'New page');
        describeReaderIconAction(this.trigger, label); this.trigger.disabled = !this.host.context().projectId;
        this.trigger.setAttribute('aria-haspopup', 'dialog'); this.trigger.setAttribute('aria-expanded', String(!!this.dialog));
        this.trigger.setAttribute('aria-controls', 'reader-create-page-dialog');
    }
    contextChanged(): void {
        this.updateTrigger();
        if (!this.dialog || !this.snapshot) return;
        const context = this.host.context();
        if (context.projectId !== this.snapshot.projectId || context.requestToken !== this.snapshot.requestToken
            || context.currentPath !== this.snapshot.currentPath) { this.close(false); return; }
        if (context.revision !== this.snapshot.revision) {
            this.snapshot = { ...context }; void this.loadScopes(true); return;
        }
        this.translate(); this.renderState();
    }
    navigationStarted(): void { this.close(false); }
    close(restoreFocus = true): void {
        this.cancelPlanTimer();
        this.generation++; const dialog = this.dialog; this.dialog = undefined; this.payload = undefined;
        this.scopes = undefined; this.snapshot = undefined; this.busy = false; this.requestText = '';
        dialog?.close(); dialog?.remove(); this.updateTrigger();
        if (restoreFocus && dialog && this.trigger.isConnected && !this.trigger.disabled) this.trigger.focus({ preventScroll: true });
    }
    dispose(): void { this.close(false); this.trigger.removeEventListener('click', this.launch); }

    async open(): Promise<void> {
        if (!this.host.context().projectId) return;
        if (this.dialog) { this.titleInput?.focus(); return; }
        this.snapshot = { ...this.host.context() }; this.status = ''; this.errorMessage = ''; this.error = false; this.requestText = '';
        const dialog = element('dialog', '', 'reader-create-page'); dialog.id = 'reader-create-page-dialog'; this.dialog = dialog;
        dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'reader-create-page-heading');
        const header = element('header', '', 'reader-create-header'), heading = element('h1'); heading.id = 'reader-create-page-heading';
        const close = readerIconAction('x', this.t('关闭', 'Close')); close.dataset.createClose = 'true'; close.addEventListener('click', () => this.close());
        header.append(heading, close);
        const body = element('div', '', 'reader-create-body'), hint = element('p', '', 'reader-create-hint'); hint.dataset.createHint = 'true';
        const title = element('input'); title.type = 'text'; title.autocomplete = 'off'; title.id = 'reader-create-title'; title.maxLength = 240;
        this.titleInput = title;
        const kind = element('select'); kind.id = 'reader-create-kind'; this.kindInput = kind;
        for (const value of kinds) { const option = element('option'); option.value = value; kind.append(option); } kind.value = 'chapter';
        const scope = element('select'); scope.id = 'reader-create-scope'; this.scopeInput = scope;
        for (const [key, control] of [['title', title], ['kind', kind], ['scope', scope]] as const) {
            const field = element('label', '', 'reader-create-field'), label = element('span'); label.dataset.createLabel = key;
            field.append(label, control); body.append(field);
        }
        title.addEventListener('input', () => this.queuePlan());
        kind.addEventListener('change', () => {
            if (kind.value === 'continued' && !title.value.trim()) title.value = this.t('未完待续', 'To be continued');
            void this.loadPlan();
        });
        scope.addEventListener('change', () => { void this.loadPlan(); });
        const preview = element('div', '', 'reader-create-preview'), previewLabel = element('span'); previewLabel.dataset.createPreviewLabel = 'true';
        const path = element('code'); path.dataset.createPath = 'true'; preview.append(previewLabel, path);
        const live = element('p', '', 'reader-create-status'); live.dataset.createStatus = 'true'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
        const request = element('textarea'); request.dataset.createRequest = 'true'; request.readOnly = true; request.hidden = true;
        const footer = element('footer', '', 'reader-create-actions');
        const retry = element('button'); retry.type = 'button'; retry.dataset.createRetry = 'true'; retry.addEventListener('click', () => { void this.loadScopes(true); });
        const existing = element('button'); existing.type = 'button'; existing.dataset.createExisting = 'true'; existing.addEventListener('click', () => { void this.openExisting(); });
        const submit = element('button', '', 'reader-create-submit'); submit.type = 'button'; submit.dataset.createSubmit = 'true'; submit.addEventListener('click', () => { void this.handoff(); });
        footer.append(retry, existing, submit); body.prepend(hint); body.append(preview, live, request, footer); dialog.append(header, body);
        dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
        dialog.addEventListener('keydown', event => this.keydown(event));
        document.body.append(dialog); this.translate(); this.renderState(); dialog.showModal(); title.focus(); this.updateTrigger();
        await this.loadScopes();
    }

    private async json<T>(route: string): Promise<T> {
        const context = this.snapshot!;
        const response = await this.host.request(route, { cache: 'no-store', headers: {
            'x-math-workspace-token': context.requestToken || '', 'x-math-workspace-project': context.projectId || '' } });
        if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
        return response.json();
    }
    private async loadScopes(preserve = false): Promise<void> {
        if (!this.dialog || !this.snapshot) return;
        this.cancelPlanTimer();
        const selected = preserve ? this.scopeInput?.value : undefined, generation = ++this.generation;
        this.payload = undefined; this.scopes = undefined; this.busy = true; this.status = ''; this.errorMessage = ''; this.error = false; this.requestText = ''; this.renderState();
        try {
            const payload = await this.json<ScopeResponse>('/api/create-page/scopes?filePath=' + encodeURIComponent(this.snapshot.currentPath));
            if (!this.matches(generation)) return;
            this.scopes = payload; this.scopeInput!.replaceChildren();
            for (const scope of payload.scopes) { const option = element('option'); option.value = scope.container; this.scopeInput!.append(option); }
            this.scopeInput!.value = selected && payload.scopes.some(scope => scope.container === selected) ? selected : payload.defaultContainer;
            this.busy = false; this.translate(); await this.loadPlan();
        } catch (error) {
            if (this.matches(generation)) { this.busy = false; this.error = true; this.errorMessage = String(error); this.renderState(); }
        }
    }
    private input(): CreatePageInput | undefined {
        if (!this.scopes || !this.titleInput?.value.trim()) return;
        return { kind: this.kindInput!.value as CreatePageInput['kind'], title: this.titleInput.value, container: this.scopeInput!.value };
    }
    private async readPlan(input: CreatePageInput): Promise<PlanResponse> {
        const query = new URLSearchParams({ kind: input.kind, title: input.title, container: input.container });
        return this.json('/api/create-page/plan?' + query.toString());
    }
    private cancelPlanTimer(): void {
        if (this.planTimer !== undefined) window.clearTimeout(this.planTimer);
        this.planTimer = undefined;
    }
    private queuePlan(): void {
        this.cancelPlanTimer();
        if (!this.dialog || !this.scopes) return;
        this.generation++; this.payload = undefined; this.status = ''; this.errorMessage = ''; this.error = false; this.requestText = '';
        this.busy = !!this.input(); this.renderState();
        if (this.busy) this.planTimer = window.setTimeout(() => { this.planTimer = undefined; void this.loadPlan(); }, 225);
    }
    private async loadPlan(): Promise<void> {
        this.cancelPlanTimer();
        if (!this.dialog) return;
        // Edits during scope discovery are retained and planned when discovery completes.
        if (!this.scopes) return;
        const generation = ++this.generation, input = this.input(); this.payload = undefined;
        this.status = ''; this.errorMessage = ''; this.error = false; this.requestText = ''; this.busy = !!input; this.renderState();
        if (!input) return;
        try {
            const payload = await this.readPlan(input); if (!this.matches(generation)) return;
            this.payload = payload;
        } catch (error) { if (this.matches(generation)) { this.error = true; this.errorMessage = String(error); } }
        finally { if (this.matches(generation)) { this.busy = false; this.renderState(); } }
    }
    private async handoff(): Promise<void> {
        const previous = this.payload, input = this.input();
        if (!this.dialog || this.busy || !previous || previous.plan.exists || !input) return;
        const generation = ++this.generation; this.busy = true; this.status = ''; this.errorMessage = ''; this.error = false; this.renderState();
        try {
            const payload = await this.readPlan(input); if (!this.matches(generation)) return;
            this.payload = payload;
            const reviewedTarget = (value: PlanResponse) => JSON.stringify([value.projectRoot, value.plan.kind, value.plan.title,
                value.plan.container, value.plan.filePath, value.plan.exists, value.plan.existingFile]);
            if (reviewedTarget(payload) !== reviewedTarget(previous)) {
                this.status = 'changed'; return;
            }
            const text = createPageHandoff(payload, this.host.context().language);
            if (this.host.canAssist()) {
                await this.host.assist([{ type: 'text', text }]);
                if (this.matches(generation)) {
                    this.host.report(this.t('创建请求已加入 Codex 输入框，尚未发送。', 'Creation request added to the Codex input; it has not been sent.'));
                    this.close();
                }
            } else {
                const copied = await copyReaderText(text).catch(() => false); if (!this.matches(generation)) return;
                this.requestText = copied ? '' : text;
                this.status = copied ? 'copied' : 'copy-failed';
                this.error = !copied;
            }
        } catch (error) { if (this.matches(generation)) { this.errorMessage = String(error); this.error = true; } }
        finally { if (this.matches(generation)) { this.busy = false; this.renderState(); } }
    }
    private async openExisting(): Promise<void> {
        if (!this.payload?.plan.exists || this.busy) return;
        const filePath = this.payload.plan.existingFile || this.payload.plan.filePath, generation = ++this.generation;
        this.busy = true; this.renderState();
        try {
            const opened = await this.host.openPage(filePath, () => this.matches(generation));
            if (!this.matches(generation)) return;
            if (opened) this.close(false);
            else { this.status = 'unavailable'; this.error = true; }
        } catch (error) { if (this.matches(generation)) { this.errorMessage = String(error); this.error = true; } }
        finally { if (this.matches(generation)) { this.busy = false; this.renderState(); } }
    }

    private translate(): void {
        const dialog = this.dialog; if (!dialog) return;
        dialog.querySelector('h1')!.textContent = this.t('新建页面', 'New page');
        describeReaderIconAction(dialog.querySelector<HTMLButtonElement>('[data-create-close]')!, this.t('关闭', 'Close'));
        dialog.querySelector('[data-create-hint]')!.textContent = this.t('先确认页面位置，再到 Codex 输入框补充正文要求并发送。', 'Confirm the location, then add your requirements in the Codex input and send.');
        for (const [key, zh, en] of [['title', '标题', 'Title'], ['kind', '类型', 'Type'], ['scope', '所属书卷或项目', 'Book, volume or project']])
            dialog.querySelector(`[data-create-label="${key}"]`)!.textContent = this.t(zh, en);
        this.titleInput!.placeholder = this.t('页面标题', 'Page title');
        for (const option of this.kindInput!.querySelectorAll('option')) option.textContent = this.t(kindZh[option.value], kindEn[option.value]);
        for (const option of this.scopeInput!.querySelectorAll('option')) {
            const scope = this.scopes?.scopes.find(scope => scope.container === option.value);
            if (scope) option.textContent = scope.kind === 'project' ? this.t('项目根目录', 'Project root') : scope.label;
        }
        dialog.querySelector('[data-create-preview-label]')!.textContent = this.t('文件位置', 'File location');
        dialog.querySelector('[data-create-retry]')!.textContent = this.t('重试', 'Retry');
        dialog.querySelector('[data-create-existing]')!.textContent = this.t('打开已有页面', 'Open existing page');
        dialog.querySelector('[data-create-submit]')!.textContent = this.host.canAssist()
            ? this.t('加入 Codex 输入框', 'Add to Codex input') : this.t('复制创建请求', 'Copy creation request');
        dialog.querySelector('[data-create-request]')!.setAttribute('aria-label', this.t('创建请求', 'Creation request'));
    }
    private renderState(): void {
        const dialog = this.dialog; if (!dialog) return;
        const plan = this.payload?.plan;
        this.scopeInput!.disabled = !this.scopes;
        dialog.querySelector('[data-create-path]')!.textContent = plan ? (plan.existingFile || plan.filePath)
            : this.busy ? this.t('正在确认…', 'Checking…') : this.t('填写标题后显示', 'Enter a title to preview');
        const live = dialog.querySelector<HTMLElement>('[data-create-status]')!;
        const statuses = {
            changed: this.t('文件位置已变化，请核对后再次选择。', 'The file location changed. Review it before continuing.'),
            copied: this.t('创建请求已复制，可粘贴到 Codex 输入框并补充正文要求。', 'Creation request copied. Paste it into Codex and add your requirements for the body.'),
            'copy-failed': this.t('无法自动复制。请复制下方创建请求。', 'Automatic copy failed. Copy the creation request below.'),
            unavailable: this.t('页面尚未出现在目录中，请稍后重试。', 'The page is not in the navigation yet. Try again shortly.')
        };
        live.textContent = this.errorMessage || statuses[this.status] || (plan?.exists ? this.t('这个位置已有页面，请打开现有页面继续编辑。', 'A page already exists here. Open it to continue editing.') : '');
        live.classList.toggle('is-error', this.error); dialog.setAttribute('aria-busy', String(this.busy));
        const submit = dialog.querySelector<HTMLButtonElement>('[data-create-submit]')!;
        submit.disabled = this.busy || !plan || plan.exists;
        const existing = dialog.querySelector<HTMLButtonElement>('[data-create-existing]')!;
        existing.hidden = !plan?.exists; existing.disabled = this.busy;
        const retry = dialog.querySelector<HTMLButtonElement>('[data-create-retry]')!;
        retry.hidden = !this.error || !!this.requestText; retry.disabled = this.busy;
        const request = dialog.querySelector<HTMLTextAreaElement>('[data-create-request]')!;
        request.hidden = !this.requestText; request.value = this.requestText;
    }
    private keydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
        if (event.key !== 'Tab' || !this.dialog) return;
        const dialog = this.dialog;
        const controls = [...dialog.querySelectorAll<HTMLElement>('input, select, textarea, button')].filter(control => {
            if ((control as HTMLButtonElement).disabled) return false;
            for (let node: HTMLElement | null = control; node && node !== dialog; node = node.parentElement) if (node.hidden) return false;
            return true;
        });
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
}
