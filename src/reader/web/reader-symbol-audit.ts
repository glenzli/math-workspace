import { readerLabel, readerText, readerWords } from './reader-ui-labels';
export interface ReaderSymbolAuditBinding {
    id?: string;
    filePath: string;
    startLine: number;
    endLine?: number;
    expression: string;
    kind: 'special' | 'temporary';
    scope?: 'book' | 'chapter' | 'section' | 'local';
    bindingKey: string;
    semanticType: string;
    meaning: string;
    evidence?: string;
    confidence?: 'high' | 'medium' | 'low';
}

export interface ReaderSymbolAuditReport {
    createdAt: string;
    model?: string;
    effort?: string;
    bindingCount: number;
    externalSpecialBindingCount: number;
    scannedFiles: number;
    reusedFiles: number;
    hardConflicts: Array<{ expression: string; reason: string; bindings: ReaderSymbolAuditBinding[] }>;
    candidates: Array<{ id?: string; kind?: 'collision' | 'notation-choice'; expression: string; bindings: ReaderSymbolAuditBinding[] }>;
    reconciliations?: Array<{
        candidateId?: string;
        expression: string;
        relation: 'same-binding' | 'specialization' | 'compatible-reuse' | 'conflict' | 'notation-reuse' | 'distinct-bindings' | 'uncertain';
        confidence: 'high' | 'medium' | 'low';
        readerRisk: boolean;
        reason: string;
        bindingKeys: string[];
        bindingIds?: string[];
    }>;
    advisories: Array<{ candidateId?: string; expression: string; severity: 'notice' | 'review'; reason: string; bindingKeys: string[]; bindingIds?: string[] }>;
}

export interface ReaderSymbolAuditStatus {
    settings: {
        model?: string;
        effort?: string;
        scope?: ReaderSymbolAuditScope;
    };
    cache: { totalFiles: number; reusableFiles: number; missingFiles: number };
    scope: {
        selectedFilePaths: string[];
        pages: Array<{ filePath: string; title: string; groupId: string }>;
        groups: Array<{ id: string; label: string; filePaths: string[] }>;
        externalSpecialBindingCount: number;
    };
    reportState: 'none' | 'current' | 'stale';
    report?: ReaderSymbolAuditReport;
    job?: {
        status: 'running' | 'complete' | 'failed' | 'cancelled';
        startedAt: string;
        totalFiles: number;
        completedFiles: number;
        scannedFiles: number;
        reusedFiles: number;
        modelCalls: number;
        tokenUsageReportedCalls: number;
        tokenUsage?: {
            totalTokens: number;
            inputTokens: number;
            cachedInputTokens: number;
            cacheWriteInputTokens: number;
            outputTokens: number;
            reasoningOutputTokens: number;
        };
        currentFilePath?: string;
        activity?: string;
        activityAt?: string;
        error?: string;
    };
}

export type ReaderSymbolAuditScope =
    | { kind: 'all' }
    | { kind: 'volume'; groupId: string }
    | { kind: 'chapters'; filePaths: string[] };

export interface ReaderSymbolAuditModel {
    model: string;
    displayName: string;
    description: string;
    isDefault: boolean;
    defaultReasoningEffort: string;
    supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
}

export interface ReaderSymbolAuditLabels {
    intro: string;
    cache: (reusable: number, total: number, missing: number) => string;
    configuredModel: string;
    configuredEffort: string;
    codexDefault: string;
    model: string;
    effort: string;
    scope: string;
    scopeAll: string;
    scopeVolume: string;
    scopeChapters: string;
    scopeVolumePicker: string;
    scopePages: string;
    scopeSummary: (files: number, externalSpecials: number) => string;
    scopeRequired: string;
    savingSettings: string;
    creatingJob: string;
    cancellingJob: string;
    activity: (value: string | undefined) => string;
    elapsed: (seconds: number) => string;
    tokenUsage: (usage: NonNullable<ReaderSymbolAuditStatus['job']>['tokenUsage'], reportedCalls: number, modelCalls: number) => string;
    saveSettings: string;
    start: string;
    force: string;
    cancel: string;
    running: (completed: number, total: number, filePath?: string) => string;
    complete: (scanned: number, reused: number) => string;
    failed: string;
    cancelled: string;
    reportCurrent: string;
    reportStale: string;
    noReport: string;
    hardConflicts: (count: number) => string;
    legacyCandidates: (count: number) => string;
    possibleConfusion: (count: number) => string;
    noHardConflicts: string;
    noAdvisories: string;
    openReport: string;
    locate: string;
    loading: string;
    modelLoadFailed: string;
    actionFailed: string;
}

export interface ReaderSymbolAuditHost {
    labels: () => ReaderSymbolAuditLabels;
    getStatus: () => Promise<ReaderSymbolAuditStatus>;
    loadModels: () => Promise<ReaderSymbolAuditModel[]>;
    saveSettings: (settings: { model?: string; effort?: string; scope?: ReaderSymbolAuditScope }) => Promise<ReaderSymbolAuditStatus>;
    start: (force: boolean) => Promise<ReaderSymbolAuditStatus>;
    cancel: () => Promise<ReaderSymbolAuditStatus>;
    openReport: () => void;
    locate: (filePath: string, line: number) => void;
    currentFilePath: () => string | undefined;
    changed: () => void;
}

function text(value: string, className?: string): HTMLElement {
    const element = document.createElement('p');
    if (className) element.className = className;
    element.textContent = value;
    return element;
}

function option(value: string, label: string, selected = false): HTMLOptionElement {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    element.selected = selected;
    return element;
}

/** A compact, explicitly-triggered UI for the local symbol-audit job. */
export class ReaderSymbolAudit {
    private container: HTMLElement | undefined;
    private host: ReaderSymbolAuditHost | undefined;
    private status: ReaderSymbolAuditStatus | undefined;
    private models: ReaderSymbolAuditModel[] = [];
    private pollTimer: number | undefined;
    private busy = false;
    private modelsLoading = false;
    private modelsRequested = false;
    private modelLoadError = '';
    private pendingStatus = '';

    render(container: HTMLElement, host: ReaderSymbolAuditHost): void {
        this.dispose();
        this.container = container;
        this.host = host;
        this.models = [];
        this.modelsRequested = false;
        this.modelLoadError = '';
        this.pendingStatus = '';
        this.draw();
        void this.refresh();
    }

    dispose(): void {
        if (this.pollTimer !== undefined) window.clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        this.container = undefined;
        this.host = undefined;
    }

    private async refresh(): Promise<void> {
        if (!this.host || !this.container?.isConnected) return;
        try {
            this.status = await this.host.getStatus();
            this.draw();
            if (!this.modelsRequested) void this.loadModels();
            if (this.status.job?.status === 'running') {
                this.pollTimer = window.setTimeout(() => void this.refresh(), 1100);
            }
        } catch (error) {
            this.draw(error instanceof Error ? error.message : String(error));
        }
    }

    private draw(error = ''): void {
        const container = this.container;
        const host = this.host;
        if (!container || !host) return;
        const labels = readerWords(() => host.labels());
        container.replaceChildren();
        if (!this.status) {
            container.append(readerLabel(text(error || labels.loading, 'reader-panel-summary'), () => error || this.host!.labels().loading));
            host.changed();
            return;
        }

        container.append(readerLabel(text(labels.intro, 'reader-symbol-audit-intro'), () => this.host!.labels().intro));
        container.append(readerLabel(text(labels.cache(
            this.status.cache.reusableFiles,
            this.status.cache.totalFiles,
            this.status.cache.missingFiles
        ), 'reader-symbol-audit-cache'), () => this.host!.labels().cache(
            this.status.cache.reusableFiles,
            this.status.cache.totalFiles,
            this.status.cache.missingFiles
        )));
        const jobStatus = this.jobStatusView(labels);
        if (jobStatus) container.append(jobStatus);

        const settings = document.createElement('section');
        settings.className = 'reader-symbol-audit-settings';
        const settingsHeader = document.createElement('div');
        settingsHeader.className = 'reader-symbol-audit-settings-header';
        settingsHeader.append(
            readerLabel(text(labels.configuredModel + '：' + (this.status.settings.model || labels.codexDefault)), () => this.host!.labels().configuredModel + '：' + (this.status.settings.model || this.host!.labels().codexDefault)),
            readerLabel(text(labels.configuredEffort + '：' + (this.status.settings.effort || labels.codexDefault)), () => this.host!.labels().configuredEffort + '：' + (this.status.settings.effort || this.host!.labels().codexDefault)),
            readerLabel(text(labels.scopeSummary(this.status.scope.selectedFilePaths.length, this.status.scope.externalSpecialBindingCount)), () => this.host!.labels().scopeSummary(this.status.scope.selectedFilePaths.length, this.status.scope.externalSpecialBindingCount))
        );
        const configuredScope = this.status.settings.scope;
        const scopeRow = document.createElement('label');
        scopeRow.className = 'reader-symbol-audit-field';
        scopeRow.append(readerText(document.createElement('span'), () => this.host!.labels().scope));
        const scopeMode = document.createElement('select');
        scopeMode.className = 'reader-panel-search';
        const scopeKind = configuredScope?.kind || 'all';
        scopeMode.append(
            readerLabel(option('all', labels.scopeAll, scopeKind === 'all'), () => this.host!.labels().scopeAll),
            readerLabel(option('volume', labels.scopeVolume, scopeKind === 'volume'), () => this.host!.labels().scopeVolume),
            readerLabel(option('chapters', labels.scopeChapters, scopeKind === 'chapters'), () => this.host!.labels().scopeChapters)
        );
        scopeRow.append(scopeMode);
        const currentGroupId = this.status.scope.pages.find(page => page.filePath === host.currentFilePath())?.groupId || this.status.scope.groups[0]?.id || '';
        const volumeRow = document.createElement('label');
        volumeRow.className = 'reader-symbol-audit-field';
        volumeRow.append(document.createTextNode(labels.scopeVolumePicker));
        const volume = document.createElement('select');
        volume.className = 'reader-panel-search';
        const selectedGroupId = configuredScope?.kind === 'volume' ? configuredScope.groupId : currentGroupId;
        this.status.scope.groups.forEach(group => volume.append(option(group.id, `${group.label} · ${group.filePaths.length}`, group.id === selectedGroupId)));
        volumeRow.append(volume);
        const chapterDetails = document.createElement('details');
        chapterDetails.className = 'reader-symbol-audit-scope-pages';
        const chapterSummary = document.createElement('summary');
        readerText(chapterSummary, () => this.host!.labels().scopePages);
        chapterDetails.append(chapterSummary);
        const selectedChapterPaths = new Set(configuredScope?.kind === 'chapters' ? configuredScope.filePaths : []);
        const chapterCheckboxes: HTMLInputElement[] = [];
        this.status.scope.groups.forEach(group => {
            const groupElement = document.createElement('section');
            groupElement.className = 'reader-symbol-audit-scope-group';
            const groupTitle = document.createElement('strong');
            groupTitle.textContent = group.label;
            groupElement.append(groupTitle);
            this.status.scope.pages.filter(page => page.groupId === group.id).forEach(page => {
                const pageRow = document.createElement('label');
                pageRow.className = 'reader-symbol-audit-scope-page';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = page.filePath;
                checkbox.checked = selectedChapterPaths.has(page.filePath);
                chapterCheckboxes.push(checkbox);
                const pageTitle = document.createElement('span');
                pageTitle.textContent = page.title;
                pageRow.append(checkbox, pageTitle);
                groupElement.append(pageRow);
            });
            chapterDetails.append(groupElement);
        });
        const updateScopeVisibility = () => {
            volumeRow.hidden = scopeMode.value !== 'volume';
            chapterDetails.hidden = scopeMode.value !== 'chapters';
            if (scopeMode.value === 'chapters') chapterDetails.open = true;
        };
        scopeMode.addEventListener('change', updateScopeVisibility);
        updateScopeVisibility();
        const modelRow = document.createElement('label');
        modelRow.className = 'reader-symbol-audit-field';
        modelRow.append(readerText(document.createElement('span'), () => this.host!.labels().model));
        const model = document.createElement('select');
        model.className = 'reader-panel-search';
        model.append(readerLabel(option('', labels.codexDefault, !this.status.settings.model), () => this.host!.labels().codexDefault));
        const allModels = this.models.length ? this.models : this.status.settings.model ? [{
            model: this.status.settings.model,
            displayName: this.status.settings.model,
            description: '',
            isDefault: false,
            defaultReasoningEffort: this.status.settings.effort || '',
            supportedReasoningEfforts: this.status.settings.effort ? [{ reasoningEffort: this.status.settings.effort, description: '' }] : []
        }] : [];
        allModels.forEach(item => model.append(readerLabel(option(item.model, item.displayName + (item.isDefault ? ' · ' + labels.codexDefault : ''), item.model === this.status?.settings.model), () => item.displayName + (item.isDefault ? ' · ' + this.host!.labels().codexDefault : ''))));
        modelRow.append(model);
        const effortRow = document.createElement('label');
        effortRow.className = 'reader-symbol-audit-field';
        effortRow.append(readerText(document.createElement('span'), () => this.host!.labels().effort));
        const effort = document.createElement('select');
        effort.className = 'reader-panel-search';
        const populateEfforts = () => {
            const selectedModel = allModels.find(item => item.model === model.value);
            const current = effort.value || this.status?.settings.effort || '';
            effort.replaceChildren(readerLabel(option('', labels.codexDefault, !current), () => this.host!.labels().codexDefault));
            (selectedModel?.supportedReasoningEfforts || []).forEach(item => effort.append(option(item.reasoningEffort, item.reasoningEffort, item.reasoningEffort === current)));
            if (current && !Array.from(effort.options).some(item => item.value === current)) effort.append(option(current, current, true));
            if (!effort.value && selectedModel?.defaultReasoningEffort) effort.value = selectedModel.defaultReasoningEffort;
        };
        populateEfforts();
        model.addEventListener('change', populateEfforts);
        effortRow.append(effort);
        const selectedScope = (): ReaderSymbolAuditScope => {
            if (scopeMode.value === 'all') return { kind: 'all' };
            if (scopeMode.value === 'volume') return { kind: 'volume', groupId: volume.value };
            const filePaths = chapterCheckboxes.filter(checkbox => checkbox.checked).map(checkbox => checkbox.value);
            if (!filePaths.length) throw new Error(labels.scopeRequired);
            return { kind: 'chapters', filePaths };
        };
        const selectedSettings = (): { model?: string; effort?: string; scope?: ReaderSymbolAuditScope } => ({
            ...(model.value ? { model: model.value } : {}),
            ...(effort.value ? { effort: effort.value } : {}),
            scope: selectedScope()
        });
        const settingActions = document.createElement('div');
        settingActions.className = 'reader-symbol-audit-actions';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'reader-symbol-audit-button is-secondary';
        readerText(save, () => this.host!.labels().saveSettings);
        save.disabled = this.busy;
        save.addEventListener('click', () => void this.act(async () => {
            this.status = await host.saveSettings(selectedSettings());
        }, labels.savingSettings));
        settingActions.append(save);
        settings.append(settingsHeader, scopeRow, volumeRow, chapterDetails, modelRow, effortRow, settingActions);
        if (this.modelLoadError) settings.append(text(this.modelLoadError, 'reader-panel-summary'));
        container.append(settings);

        const job = this.status.job;
        const actions = document.createElement('div');
        actions.className = 'reader-symbol-audit-run-actions';
        if (job?.status === 'running') {
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'reader-symbol-audit-button is-secondary';
            readerText(cancel, () => this.host!.labels().cancel);
            cancel.disabled = this.busy;
            cancel.addEventListener('click', () => void this.act(async () => { this.status = await host.cancel(); }, labels.cancellingJob));
            actions.append(cancel);
        } else {
            const start = document.createElement('button');
            start.type = 'button';
            start.className = 'reader-symbol-audit-button';
            readerText(start, () => this.host!.labels().start);
            start.disabled = this.busy;
            start.addEventListener('click', () => {
                try {
                    void this.startAudit(selectedSettings(), false);
                } catch (error) {
                    this.draw(error instanceof Error ? error.message : String(error));
                }
            });
            const force = document.createElement('button');
            force.type = 'button';
            force.className = 'reader-symbol-audit-button is-secondary';
            readerText(force, () => this.host!.labels().force);
            force.disabled = this.busy;
            force.addEventListener('click', () => {
                try {
                    void this.startAudit(selectedSettings(), true);
                } catch (error) {
                    this.draw(error instanceof Error ? error.message : String(error));
                }
            });
            actions.append(start, force);
            if (job?.status === 'complete') {
                actions.append(
                    readerLabel(text(labels.complete(job.scannedFiles, job.reusedFiles), 'reader-symbol-audit-progress'), () => this.host!.labels().complete(job.scannedFiles, job.reusedFiles)),
                    readerLabel(text(labels.tokenUsage(job.tokenUsage, job.tokenUsageReportedCalls, job.modelCalls), 'reader-symbol-audit-token-usage'), () => this.host!.labels().tokenUsage(job.tokenUsage, job.tokenUsageReportedCalls, job.modelCalls))
                );
            }
            if (job?.status === 'failed') {
                actions.append(
                    readerLabel(text(labels.failed + (job.error ? '：' + job.error : ''), 'reader-symbol-audit-error'), () => this.host!.labels().failed + (job.error ? '：' + job.error : '')),
                    readerLabel(text(labels.tokenUsage(job.tokenUsage, job.tokenUsageReportedCalls, job.modelCalls), 'reader-symbol-audit-token-usage'), () => this.host!.labels().tokenUsage(job.tokenUsage, job.tokenUsageReportedCalls, job.modelCalls))
                );
            }
            if (job?.status === 'cancelled') {
                actions.append(
                    readerLabel(text(labels.cancelled, 'reader-symbol-audit-progress'), () => this.host!.labels().cancelled),
                    readerLabel(text(labels.tokenUsage(job.tokenUsage, job.tokenUsageReportedCalls, job.modelCalls), 'reader-symbol-audit-token-usage'), () => this.host!.labels().tokenUsage(job.tokenUsage, job.tokenUsageReportedCalls, job.modelCalls))
                );
            }
        }
        container.append(actions);
        container.append(this.reportView(labels));
        if (error) container.append(readerLabel(text(labels.actionFailed + '：' + error, 'reader-symbol-audit-error'), () => this.host!.labels().actionFailed + '：' + error));
        host.changed();
    }

    private jobStatusView(labels: ReaderSymbolAuditLabels): HTMLElement | undefined {
        const job = this.status?.job;
        if (!this.pendingStatus && job?.status !== 'running') return undefined;
        const section = document.createElement('section');
        section.className = 'reader-symbol-audit-job';
        if (this.pendingStatus) {
            section.append(text(this.pendingStatus, 'reader-symbol-audit-job-title'));
            return section;
        }
        if (!job) return section;
        const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(job.startedAt)) / 1000));
        const title = readerLabel(text(
            `${labels.running(job.completedFiles, job.totalFiles, job.currentFilePath)} · ${labels.activity(job.activity)} · ${labels.elapsed(elapsed)}`,
            'reader-symbol-audit-job-title'
        ), () => `${this.host!.labels().running(job.completedFiles, job.totalFiles, job.currentFilePath)} · ${this.host!.labels().activity(job.activity)} · ${this.host!.labels().elapsed(elapsed)}`);
        const progress = document.createElement('progress');
        progress.className = 'reader-symbol-audit-job-progress';
        progress.max = Math.max(1, job.totalFiles);
        progress.value = Math.min(job.completedFiles, job.totalFiles);
        progress.setAttribute('aria-label', title.textContent || '');
        section.append(title, progress, readerLabel(text(labels.tokenUsage(job.tokenUsage, job.tokenUsageReportedCalls, job.modelCalls), 'reader-symbol-audit-token-usage'), () => this.host!.labels().tokenUsage(job.tokenUsage, job.tokenUsageReportedCalls, job.modelCalls)));
        return section;
    }

    private reportView(labels: ReaderSymbolAuditLabels): HTMLElement {
        const report = this.status?.report;
        const section = document.createElement('section');
        section.className = 'reader-symbol-audit-report';
        if (!report) {
            section.append(readerLabel(text(labels.noReport, 'reader-panel-summary'), () => this.host!.labels().noReport));
            return section;
        }
        section.append(readerLabel(text(this.status?.reportState === 'current' ? labels.reportCurrent : labels.reportStale, 'reader-symbol-audit-report-state'), () => this.status?.reportState === 'current' ? this.host!.labels().reportCurrent : this.host!.labels().reportStale));
        const summary = document.createElement('div');
        summary.className = 'reader-symbol-audit-report-summary-compact';
        const hard = document.createElement('span');
        const legacyReport = !Array.isArray(report.reconciliations);
        hard.className = legacyReport ? 'is-review' : report.hardConflicts.length ? 'is-hard' : 'is-ok';
        readerText(hard, () => legacyReport ? this.host!.labels().legacyCandidates(report.hardConflicts.length) : this.host!.labels().hardConflicts(report.hardConflicts.length));
        const review = document.createElement('span');
        review.className = report.advisories.length ? 'is-review' : 'is-ok';
        readerText(review, () => this.host!.labels().possibleConfusion(report.advisories.length));
        summary.append(hard, review);
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'reader-symbol-audit-button';
        readerText(open, () => this.host!.labels().openReport);
        open.addEventListener('click', () => this.host?.openReport());
        section.append(summary, open);
        return section;
    }

    private async loadModels(): Promise<void> {
        if (!this.host || this.modelsLoading || this.modelsRequested) return;
        this.modelsRequested = true;
        this.modelsLoading = true;
        try {
            this.models = await this.host.loadModels();
            this.modelLoadError = '';
            this.draw();
        } catch (error) {
            this.modelLoadError = this.host.labels().modelLoadFailed + '：' + (error instanceof Error ? error.message : String(error));
            this.draw();
        } finally {
            this.modelsLoading = false;
        }
    }

    private async startAudit(settings: { model?: string; effort?: string; scope?: ReaderSymbolAuditScope }, force: boolean): Promise<void> {
        if (!this.host || this.busy) return;
        this.busy = true;
        try {
            this.pendingStatus = this.host.labels().savingSettings;
            this.draw();
            this.status = await this.host.saveSettings(settings);
            this.pendingStatus = this.host.labels().creatingJob;
            this.draw();
            this.status = await this.host.start(force);
        } catch (error) {
            this.pendingStatus = '';
            this.busy = false;
            this.draw(error instanceof Error ? error.message : String(error));
            return;
        }
        this.pendingStatus = '';
        this.busy = false;
        this.draw();
        if (this.status?.job?.status === 'running') this.pollTimer = window.setTimeout(() => void this.refresh(), 160);
    }

    private async act(operation: () => Promise<void>, pendingStatus = ''): Promise<void> {
        if (!this.host || this.busy) return;
        this.busy = true;
        this.pendingStatus = pendingStatus;
        this.draw();
        try {
            await operation();
        } catch (error) {
            this.pendingStatus = '';
            this.busy = false;
            this.draw(error instanceof Error ? error.message : String(error));
            return;
        } finally {
            this.busy = false;
            this.pendingStatus = '';
        }
        this.draw();
        if (this.status?.job?.status === 'running') this.pollTimer = window.setTimeout(() => void this.refresh(), 160);
    }
}
