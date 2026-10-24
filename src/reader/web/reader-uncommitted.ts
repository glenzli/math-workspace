import type { ReaderGitChanges, ReaderGitFileChanges } from '../git-change-types';

interface Page { filePath: string; sourceHash?: string; project: string; token: string }
interface Project { project: string; token: string; revision: number }
type Request = (route: string, options?: RequestInit) => Promise<Response>;
const words = {
    zh: { label: '未提交修改', hint: '用淡琥珀金底标记正文修改，在目录与页眉的文件名旁显示同色空心标记（相对最近一次 Git 提交，含暂存内容）', modified: '未提交修改', added: '新增文件（未提交）', changed: '未提交修改：源码行', deleted: '此处附近删除了源码行', 'not-git': '非 Git 项目', ignored: '稿件已忽略', unavailable: '读取失败', stale: '等待刷新', loading: '检查中…', outdated: '需重启服务', outdatedHint: 'Reader 服务版本较旧，请重启服务；在 Codex 中需重启客户端，再打开 Math Workspace', waiting: '请先打开稿件', clean: '无修改', invisible: '无可见修改', count: (count: number) => `${count} 处` },
    en: { label: 'Uncommitted changes', hint: 'Use a faint amber-gold tint on changed prose and matching rings beside file titles since the latest Git commit, including staged edits', modified: 'Uncommitted changes', added: 'New file (uncommitted)', changed: 'Uncommitted changes: source lines', deleted: 'Source lines deleted near here', 'not-git': 'No Git repository', ignored: 'Manuscript ignored', unavailable: 'Read failed', stale: 'Awaiting refresh', loading: 'Checking…', outdated: 'Restart Reader', outdatedHint: 'The Reader service is outdated. Restart it; in Codex, restart the client and reopen Math Workspace', waiting: 'Open a manuscript first', clean: 'No changes', invisible: 'No visible changes', count: (count: number) => `${count} marked` }
};

/** Owns opt-in markers and their page-bound polling; never rewrites rendered content. */
export class ReaderUncommittedChanges {
    private enabled = false;
    private page?: Page;
    private project?: Project;
    private latestFiles?: ReaderGitFileChanges;
    private fileStatus?: 'unavailable' | 'outdated' | 'stale';
    private generation = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private abort?: AbortController;
    private latest?: ReaderGitChanges;
    private status?: 'loading' | 'unavailable' | 'outdated' | 'stale';
    private marked = new Map<HTMLElement, { tooltip: string | null }>();
    private paused = false;
    private readonly onClick = () => this.setEnabled(!this.enabled);
    private readonly onVisibility = () => { if (document.visibilityState !== 'hidden') void this.refresh(); };
    constructor(private article: HTMLElement, private button: HTMLElement, private language: () => 'zh' | 'en', private request: Request, private markersChanged: () => void = () => {}, private filesChanged: () => void = () => {}) {
        button.addEventListener('click', this.onClick);
        document.addEventListener('visibilitychange', this.onVisibility);
        this.updateLanguage();
    }
    bind(page?: Page): void {
        this.cancel(); this.clear(); this.latest = undefined; this.status = undefined; this.page = page;
        this.updateLanguage();
        if (page && this.enabled) void this.refresh();
    }
    bindProject(project?: Project): void {
        if (this.project?.project === project?.project && this.project?.token === project?.token && this.project?.revision === project?.revision) return;
        this.cancel(); this.clear(); this.latest = undefined; this.status = undefined;
        this.project = project; this.fileStatus = undefined; this.setFiles(undefined);
        if (this.enabled) void this.refresh();
    }
    fileLabel(filePath: string): string {
        const kind = this.enabled && this.latestFiles?.status === 'ready' ? this.latestFiles.files[filePath] : undefined;
        return kind ? words[this.language()][kind] : '';
    }
    fileBadge(filePath: string): HTMLElement | undefined {
        const label = this.fileLabel(filePath);
        if (!label) return;
        const kind = this.latestFiles!.files[filePath];
        const badge = document.createElement('span');
        badge.className = 'reader-file-change is-' + kind;
        badge.setAttribute('aria-hidden', 'true');
        badge.setAttribute('data-reader-tooltip', label);
        return badge;
    }
    targets(): HTMLElement[] {
        return [...this.marked.keys()].sort((a, b) => Number(a.dataset.sourceStartLine || 0) - Number(b.dataset.sourceStartLine || 0));
    }
    hasChanges(): boolean { return this.enabled && this.latest?.status === 'ready' && !!(this.latest.ranges.length || this.latest.deletions.length); }
    baselineCommit(): string | undefined { return this.enabled && this.latest?.status === 'ready' ? this.latest.commit : undefined; }
    private setFiles(value: ReaderGitFileChanges | undefined): void {
        if (JSON.stringify(this.latestFiles) === JSON.stringify(value)) return;
        this.latestFiles = value; this.filesChanged();
    }
    setEnabled(value: boolean): void {
        this.enabled = value; this.cancel(); this.clear(); this.fileStatus = undefined; this.setFiles(undefined); this.latest = undefined; this.status = undefined; this.updateLanguage();
        if (value) void this.refresh();
    }
    pause(): void { this.paused = true; this.cancel(); }
    resume(): void { this.paused = false; void this.refresh(); }
    dispose(): void {
        this.enabled = false; this.bind(); this.bindProject(); this.button.removeEventListener('click', this.onClick);
        document.removeEventListener('visibilitychange', this.onVisibility);
    }
    updateLanguage(): void {
        const w = words[this.language()];
        this.button.setAttribute('aria-checked', String(this.enabled));
        this.button.classList.toggle('is-active', this.enabled);
        if (this.latest && this.enabled) this.apply(this.latest);
        const status = this.button.querySelector<HTMLElement>('#reader-uncommitted-status');
        const failure = this.status || this.fileStatus;
        const label = !this.page ? w.waiting : failure ? w[failure] : this.latest?.status === 'ready'
            ? this.marked.size ? w.count(this.marked.size) : this.latest.ranges.length || this.latest.deletions.length ? w.invisible : w.clean
            : this.latest ? w[this.latest.status] : w.loading;
        if (status) { status.hidden = !this.enabled; status.textContent = this.enabled ? label : ''; }
        this.button.setAttribute('data-reader-tooltip', !this.enabled ? w.hint : failure === 'outdated' ? w.outdatedHint : `${w.hint} · ${label}`);
        this.filesChanged();
    }
    private cancel(): void {
        ++this.generation; this.abort?.abort(); this.abort = undefined;
        if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined;
    }
    private clear(notify = true): void {
        for (const [element, { tooltip }] of this.marked) {
            element.classList.remove('has-uncommitted-change', 'has-uncommitted-deletion');
            delete element.dataset.uncommittedLines; delete element.dataset.uncommittedDeleted;
            if (tooltip === null) element.removeAttribute('data-reader-tooltip'); else element.setAttribute('data-reader-tooltip', tooltip);
        }
        this.marked.clear();
        if (notify) this.markersChanged();
    }
    private async refresh(): Promise<void> {
        this.cancel();
        const page = this.page, generation = this.generation;
        const project = this.project;
        if (!this.enabled || (!page && !project) || this.paused || document.visibilityState === 'hidden') return;
        const abort = this.abort = new AbortController();
        const current = () => generation === this.generation && this.enabled && this.page === page && !abort.signal.aborted;
        const files = project ? this.refreshFiles(project, abort.signal, current) : Promise.resolve();
        if (!this.latest) { this.status = 'loading'; this.updateLanguage(); }
        try {
            if (!page || project && (page.project !== project.project || page.token !== project.token)) return;
            const response = await this.request('/api/page-changes?path=' + encodeURIComponent(page.filePath), { signal: abort.signal, cache: 'no-store', headers: { 'x-math-workspace-token': page.token, 'x-math-workspace-project': page.project } });
            if (!current()) return;
            if (!response.ok) {
                this.latest = undefined; this.status = response.status === 404 ? 'outdated' : 'unavailable';
                this.clear(); this.updateLanguage(); return;
            }
            const changes = await response.json() as ReaderGitChanges;
            if (!current()) return;
            // The page API hashes the exact rendered bytes; opaque hosts need no Web Crypto API.
            this.latest = page.sourceHash && changes.filePath === page.filePath && changes.sourceHash === page.sourceHash ? changes : undefined;
            this.status = !page.sourceHash ? 'outdated' : this.latest ? undefined : 'stale';
            if (!this.latest) this.clear(false);
            this.updateLanguage();
        } catch {
            if (current()) { this.latest = undefined; this.status = 'unavailable'; this.clear(); this.updateLanguage(); }
        } finally {
            await files;
            if (current()) this.timer = setTimeout(() => void this.refresh(), 8000);
        }
    }
    private async refreshFiles(project: Project, signal: AbortSignal, current: () => boolean): Promise<void> {
        try {
            const response = await this.request('/api/file-changes', { signal, cache: 'no-store', headers: { 'x-math-workspace-token': project.token, 'x-math-workspace-project': project.project } });
            const changes = response.ok ? await response.json() as ReaderGitFileChanges : undefined;
            if (!current()) return;
            this.fileStatus = !response.ok ? response.status === 404 ? 'outdated' : 'unavailable'
                : changes?.revision !== project.revision ? 'stale' : changes.status === 'unavailable' ? 'unavailable' : undefined;
            this.setFiles(changes?.revision === project.revision ? changes : undefined); this.updateLanguage();
        } catch { if (current()) { this.fileStatus = 'unavailable'; this.setFiles(undefined); this.updateLanguage(); } }
    }
    private apply(changes: ReaderGitChanges): void {
        this.clear(false);
        if (changes.status !== 'ready') { this.markersChanged(); return; }
        const w = words[this.language()];
        const blocks = Array.from(this.article.querySelectorAll<HTMLElement>('[data-source-start-line]')).map(element => ({ element, start: Number(element.dataset.sourceStartLine), end: Number(element.dataset.sourceEndLine || element.dataset.sourceStartLine) })).filter(block => block.start > 0 && block.end >= block.start);
        const affected = blocks.filter(block => changes.ranges.some(range => range.startLine <= block.end && range.endLine >= block.start));
        const mark = (element: HTMLElement, label: string) => {
            let entry = this.marked.get(element);
            if (!entry) {
                entry = { tooltip: element.getAttribute('data-reader-tooltip') }; this.marked.set(element, entry);
            }
            element.setAttribute('data-reader-tooltip', label);
        };
        for (const block of affected) {
            if (affected.some(other => other !== block && block.element.contains(other.element))) continue;
            const lines = changes.ranges.filter(range => range.startLine <= block.end && range.endLine >= block.start).map(range => `${Math.max(range.startLine, block.start)}–${Math.min(range.endLine, block.end)}`).join(', ');
            block.element.classList.add('has-uncommitted-change'); block.element.dataset.uncommittedLines = lines;
            mark(block.element, `${w.changed} ${lines}`);
        }
        for (const deletion of changes.deletions) {
            const candidates = blocks.filter(block => block.start <= deletion.afterLine + 1 && block.end >= deletion.afterLine + 1).sort((a, b) => (a.end - a.start) - (b.end - b.start));
            const block = candidates[0] || blocks.find(block => block.start > deletion.afterLine) || blocks[blocks.length - 1];
            if (!block) continue;
            const count = Number(block.element.dataset.uncommittedDeleted || 0) + deletion.count;
            block.element.classList.add('has-uncommitted-deletion'); block.element.dataset.uncommittedDeleted = String(count);
            mark(block.element, `${block.element.dataset.uncommittedLines ? `${w.changed} ${block.element.dataset.uncommittedLines}; ` : ''}${w.deleted}: ${count}`);
        }
        this.markersChanged();
    }
}
