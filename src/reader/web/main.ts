import { readerPreferences } from './reader-preferences';
import { readerLabel, readerText, readerAttribute, refreshReaderLabels, readerWords } from './reader-ui-labels';
import { revealExerciseTarget } from './reader-exercises';
import './styles.css';
import { readerFetch, readerEvents, isReaderEmbedded } from './reader-route';
import { initializeReaderHost, isReaderPageRestored, expandReader, readerHistory, readerSearch, canReferenceReaderInConversation, referenceReaderInConversation, type ReaderEvents } from './reader-host';
import { readerReference } from './reader-references';
import { mountReaderAssets } from './reader-assets';
import { mountReaderEmbeddedView, readerViewStateChanged } from './reader-embed';
import { mountReaderFigures } from './reader-figures';
import { mountReaderFormulaLayout, type ReaderFormulaLayout } from './reader-formula-layout';
import { ReaderArchive } from './reader-archive';
import { ReaderPublication } from './reader-publication';
import { ReaderCreatePage } from './reader-create-page';
import {
    createFormalRenderer,
    bindFormalInterfaceLabels,
    renderFormalDocument,
    renderFormalInline,
    renderFormalMarkdown,
    type ReaderDependencyMarker,
    type ReaderFormula,
    type ReaderPageIntegration,
    type ReaderLabel,
    type ReaderPage
} from './formal-renderer';
import {
    ReaderSourceActions,
    type ReaderDefinitionMatch
} from './source-actions';
import { ReaderRecallPopover } from './recall-popover';
import { ReaderDependencyPopover } from './reader-dependency-popover';
import { ReaderLeanPopover, type ReaderLeanAnchorPayload } from './reader-lean-popover';
import { leanAssistanceUpdatePaths, ReaderLeanReview } from './reader-lean-review';
import { readerIcon, replaceReaderButtonIcon, type ReaderIconName } from './reader-icons';
import { ReaderToolbarPanel } from './reader-toolbar-panel';
import { ReaderToolbarMenu } from './reader-toolbar-menu';
import { ReaderPropositionReview, type ReaderPropositionReviewItem } from './reader-proposition-review';
import { ReaderTooltip } from './reader-tooltip';
import {
    ReaderSymbolAudit,
    type ReaderSymbolAuditModel,
    type ReaderSymbolAuditStatus
} from './reader-symbol-audit';
import { ReaderSymbolAuditReportView } from './reader-symbol-audit-report';

type Language = 'zh' | 'en';

interface DefinitionSummary {
    index: number;
    title: string;
    aliases?: string[];
    filePath: string;
    line: number;
}

interface ReaderState {
    projectId?: string;
    available?: boolean;
    revision: number;
    rootName: string;
    language: Language;
    pages: ReaderPage[];
    definitions: DefinitionSummary[];
    issues: Array<{ severity: string; code: string; message: string }>;
    leanSummary?: Record<string, number>;
    requestToken?: string;
    recentProjects?: Array<{ index: number; rootName: string; openedAt: string }>;
}

interface ReaderPagePayload {
    revision: number;
    filePath: string;
    page?: ReaderPage;
    content: string;
    labels: Record<string, ReaderLabel>;
    dependencyMarkers?: Record<string, ReaderDependencyMarker>;
    formulas?: ReaderFormula[];
    symbols: Array<{
        index: number;
        pattern: string;
        display: string;
        meaning: string;
        sourceFilePath?: string;
        sourceLine?: number;
    }>;
}

const words = {
    zh: {
        contents: '目录',
        volumeChapters: '本卷章节',
        bookChapters: '本书章节',
        collectionPages: '本草稿区篇目',
        readerTools: '阅读工具',
        toolsReference: '查阅',
        toolsReview: '审阅',
        toolsEdition: '版本与出版',
        toolsDisplay: '显示',
        interfaceLanguage: '界面语言',
        appearance: '外观',
        automatic: '自动',
        chinese: '中文',
        english: 'English',
        light: '浅色',
        dark: '深色',
        projectNavigation: '项目导航',
        versionHistory: '版本记录',
        pdfPublication: 'PDF 出版',
        sourceLineNumbers: '源码行号',
        definitions: '定义',
        symbols: '符号',
        propositions: '命题审阅',
        symbolAudit: '符号审计',
        symbolAuditIntro: '仅在点击开始后调用 Codex。它先提取各章记号并机械发现同形候选，再统一辨别同义复述、特化、兼容复用与真正冲突。',
        draftFormalToolsUnavailable: '探索稿中不可用',
        symbolAuditCache: (reusable: number, total: number, missing: number) => `缓存：${reusable}/${total} 个文件可复用；本次需提取 ${missing} 个。`,
        symbolAuditConfiguredModel: '模型',
        symbolAuditConfiguredEffort: '强度',
        symbolAuditCodexDefault: '跟随 Codex 默认',
        symbolAuditModel: '模型',
        symbolAuditEffort: '推理强度',
        symbolAuditScope: '审计范围',
        symbolAuditScopeAll: '全部内容',
        symbolAuditScopeVolume: '单卷',
        symbolAuditScopeChapters: '自选章节',
        symbolAuditScopeVolumePicker: '卷',
        symbolAuditScopePages: '选择章节',
        symbolAuditScopeSummary: (files: number, externalSpecials: number) => `范围：${files} 页；与 ${externalSpecials} 项范围外专用记号交叉比对。`,
        symbolAuditScopeRequired: '请至少选择一个章节。',
        symbolAuditSavingSettings: '正在保存审计设置…',
        symbolAuditCreatingJob: '正在创建审计任务…',
        symbolAuditCancellingJob: '正在取消审计任务…',
        symbolAuditActivity: (activity: string | undefined) => ({
            'connecting-server': '正在连接 Codex Server',
            'creating-task': '正在创建只读任务',
            'waiting-response': 'Codex 正在处理',
            'receiving-response': 'Codex 已开始生成结构化结果',
            'saving-result': '正在校验并缓存本章提取结果',
            'comparing-conflicts': '正在发现同形符号候选',
            'reviewing-candidates': 'Codex 正在归并并判别候选关系',
            'finalizing-report': '正在校验并保存审计报告'
        }[activity || ''] || 'Codex 正在处理'),
        symbolAuditElapsed: (seconds: number) => `已运行 ${seconds} 秒`,
        symbolAuditTokenUsage: (usage: NonNullable<ReaderSymbolAuditStatus['job']>['tokenUsage'], reportedCalls: number, modelCalls: number) => {
            if (modelCalls === 0) return '用量：尚未调用 Codex（若全程命中缓存则为 0）。';
            if (!usage) return `用量：Codex Server 未提供精确统计（${modelCalls} 个任务）。`;
            const details = [`输入 ${usage.inputTokens.toLocaleString()}`, `输出 ${usage.outputTokens.toLocaleString()}`];
            if (usage.reasoningOutputTokens) details.push(`推理 ${usage.reasoningOutputTokens.toLocaleString()}`);
            if (usage.cachedInputTokens) details.push(`缓存输入 ${usage.cachedInputTokens.toLocaleString()}`);
            return `用量：${usage.totalTokens.toLocaleString()} tokens（${details.join(' · ')}；${reportedCalls}/${modelCalls} 个任务已回报）。`;
        },
        symbolAuditSaveSettings: '保存设置',
        symbolAuditStart: '开始审计',
        symbolAuditForce: '重新审计全部',
        symbolAuditCancel: '取消',
        symbolAuditRunning: (completed: number, total: number, filePath?: string) => `正在审计 ${completed}/${total}${filePath ? ` · ${filePath}` : ''}`,
        symbolAuditComplete: (scanned: number, reused: number) => `本次提取 ${scanned} 个文件，复用缓存 ${reused} 个。`,
        symbolAuditFailed: '审计未完成',
        symbolAuditCancelled: '审计已取消',
        symbolAuditReportCurrent: '当前审计结果',
        symbolAuditReportStale: '上次结果已过期：源文件或模型设置已变化。',
        symbolAuditNoReport: '尚未生成审计结果。',
        symbolAuditHardConflicts: (count: number) => `高置信冲突 ${count} 项`,
        symbolAuditLegacyCandidates: (count: number) => `旧版未归并候选 ${count} 项`,
        symbolAuditPossibleConfusion: (count: number) => `待核对 ${count} 项`,
        symbolAuditNoHardConflicts: '语义归并后未发现高置信冲突。',
        symbolAuditNoAdvisories: '未留下需要人工核对的候选。',
        symbolAuditOpenReport: '打开审计报告',
        symbolAuditLocate: '定位来源',
        symbolAuditLoading: '正在读取审计状态…',
        symbolAuditModelLoadFailed: '无法读取可用模型',
        symbolAuditActionFailed: '符号审计操作失败',
        reference: '引用到 Codex',
        referenceAdded: '已加入当前会话输入框',
        referenceUnavailable: '请在 Codex 会话中的 Math Workspace 面板使用引用',
        sourceActionFailed: '当前操作未完成，请重试。',
        back: '返回',
        forward: '前进',
        showNavigation: '展开书籍导航',
        hideNavigation: '折叠书籍导航',
        showSourceLineNumbers: '显示源码行号',
        hideSourceLineNumbers: '隐藏源码行号',
        search: '筛选章节',
        searchDefinitions: '搜索定义',
        searchAllDefinitions: '全书检索',
        showChapterDefinitions: '返回本章定义',
        noDefinitions: '没有匹配的定义',
        noChapterDefinitions: '本章没有提及可检索定义',
        noSymbols: '当前页没有已索引的项目符号',
        propositionReviewGraphTitle: '本章关系图',
        propositionReviewGraphHint: '实线为严格依赖；数字虚线为图外严格关系；数字徽章表示正文补充提及，Lean 徽章表示存在 Lean 锚点。颜色与快审只看严格下游。',
        propositionReviewEmpty: '当前章没有命题、引理、定理或推论。',
        propositionReviewHub: '支撑枢纽',
        propositionReviewLinked: '一般关联',
        propositionReviewTerminal: '终端命题',
        propositionReviewIsolated: '孤立命题',
        propositionReviewTerminalPropositions: '终端命题',
        propositionReviewTerminalPropositionSummary: (count: number) => `终端命题 ${count} 项`,
        propositionReviewTerminalPropositionHint: '这些命题当前在严格依赖图中没有下游引用；其章节作用与形式化锚点可按需审阅。',
        propositionReviewNodeLabel: (display: string, upstream: number, downstream: number, ambientReferences: number, leanDeclarations: number, status: string) => `${display}；严格上游 ${upstream} 项，严格下游 ${downstream} 项，正文补充提及 ${ambientReferences} 处${leanDeclarations > 0 ? `，Lean 锚点 ${leanDeclarations} 个声明` : ''}；${status}`,
        source: '来源',
        jump: '定位',
        recall: '引用回溯',
        statementDependency: '命题依赖',
        remarkDependency: '注释依赖',
        upstreamDependencies: '上游依赖',
        downstreamDependencies: '下游依赖',
        noUpstreamDependencies: '没有直接引用的依赖对象',
        noDownstreamDependencies: '尚未被其他依赖对象引用',
        otherFormalReferences: (count: number) => `另引用 ${count} 项章节、定义或其他 formal 对象`,
        live: '实时同步',
        noContents: '当前页面没有标题',
        close: '关闭',
        copyLatex: '复制 LaTeX',
        adaptFormula: '适应宽度',
        restoreFormula: '恢复原公式排版',
        adaptingFormula: '正在调整公式排版…',
        copySelectedMarkdown: '复制选中 Markdown',
        copySourceLines: '复制所在行 Markdown',
        lookupDefinition: '查定义',
        copied: '已复制',
        refineDefinitionQuery: '请选择完整的术语',
        decreaseFont: '减小字号',
        increaseFont: '增大字号',
        fontSize: '正文大小',
        chooseProject: '选择项目目录',
        recentProjects: '最近打开的项目',
        noRecentProjects: '还没有最近打开的项目。',
        noMainPages: '项目中暂无正文页面。可展开目录中的草稿区，选择草稿。',
        noMarkdownPages: '项目中暂无 Markdown 页面。',
        projectLauncherTitle: '打开 Math Workspace',
        projectLauncherDescription: '选择一个已包含 .math-workspace/config.json 的项目目录。',
        projectSelectionCancelled: '尚未选择项目。',
        leanAlignment: 'Lean 对齐',
        leanReview: 'Lean 对照',
        leanLoading: '正在读取 Lean 对齐信息…',
        leanUnavailable: '暂时无法读取 Lean 对齐信息。',
        leanContract: '契约',
        leanBuild: '构建',
        leanDependencies: '依赖',
        leanDeclarations: 'Lean 声明',
        leanMarkdownOnly: '正文声明但 Lean 未观察到',
        leanOnly: '额外 Lean 支撑',
        leanNone: '没有可显示的条目',
        integrationManaged: '结构接入完成',
        integrationSegmented: '分段接入',
        integrationUnmanaged: '未接入',
        integrationAttention: '需要收束',
        documentStage: '文档阶段',
        documentStageUnset: '设置阶段',
        documentStageDraft: '初稿',
        documentStageRevising: '修订中',
        documentStageStable: '稳定稿',
        documentStageChanged: '有改动',
        documentStageSaved: '已更新文档阶段',
        documentStageMilestone: '版本里程碑',
        documentStageMilestoneHint: '例如 RC1 或 v1',
        documentStageRecord: '记录里程碑',
        documentStageClear: '清除里程碑',
        draftCollectionSummary: (total: number) => total + ' 篇',
        expandDraftCollection: '展开草稿区',
        collapseDraftCollection: '收起草稿区',
        documentStageMenu: '修改状态',
        documentStageSelection: (count: number) => `已选 ${count} 篇文档`,
        documentStageBatch: (count: number) => count === 1 ? '修改文档阶段' : `修改 ${count} 篇文档阶段`,
        documentStageBatchSaved: (count: number) => count === 1 ? '已更新文档阶段' : `已更新 ${count} 篇文档阶段`,
        documentStageBatchNoFormal: '探索稿不使用文档阶段',
        integrationGroupSummary: (managed: number, total: number) => `接入 ${managed}/${total}`,
        integrationManagedDetail: (anchors: number) => `唯一页锚点已建立；稳定锚点 ${anchors} 个`,
        integrationSegmentedDetail: (anchors: number) => `已有 ${anchors} 个稳定锚点，但尚无唯一页锚点`,
        integrationUnmanagedDetail: '尚未发现稳定锚点',
        integrationAttentionDetail: (temporary: number, issues: number) => `临时锚点 ${temporary} 个；扫描提示 ${issues} 项`
    },
    en: {
        contents: 'Contents',
        volumeChapters: 'Volume chapters',
        bookChapters: 'Book chapters',
        collectionPages: 'Draft collection pages',
        readerTools: 'Reader tools',
        toolsReference: 'Reference',
        toolsReview: 'Review',
        toolsEdition: 'Versions & publication',
        toolsDisplay: 'Display',
        interfaceLanguage: 'Interface language',
        appearance: 'Appearance',
        automatic: 'Auto',
        chinese: '中文',
        english: 'English',
        light: 'Light',
        dark: 'Dark',
        projectNavigation: 'Project navigation',
        versionHistory: 'Version history',
        pdfPublication: 'PDF publication',
        sourceLineNumbers: 'Source line numbers',
        definitions: 'Definitions',
        symbols: 'Symbols',
        propositions: 'Proposition review',
        symbolAudit: 'Symbol audit',
        symbolAuditIntro: 'Codex is called only after you start an audit. It extracts notation, discovers same-surface candidates mechanically, then reconciles restatements, specializations, compatible reuse, and genuine conflicts.',
        draftFormalToolsUnavailable: 'Unavailable for exploratory drafts',
        symbolAuditCache: (reusable: number, total: number, missing: number) => `Cache: ${reusable}/${total} files reusable; ${missing} need extraction.`,
        symbolAuditConfiguredModel: 'Model',
        symbolAuditConfiguredEffort: 'Effort',
        symbolAuditCodexDefault: 'Follow Codex default',
        symbolAuditModel: 'Model',
        symbolAuditEffort: 'Reasoning effort',
        symbolAuditScope: 'Audit scope',
        symbolAuditScopeAll: 'All content',
        symbolAuditScopeVolume: 'One volume',
        symbolAuditScopeChapters: 'Selected chapters',
        symbolAuditScopeVolumePicker: 'Volume',
        symbolAuditScopePages: 'Choose chapters',
        symbolAuditScopeSummary: (files: number, externalSpecials: number) => `Scope: ${files} pages; compared against ${externalSpecials} out-of-scope declared symbols.`,
        symbolAuditScopeRequired: 'Choose at least one chapter.',
        symbolAuditSavingSettings: 'Saving audit settings…',
        symbolAuditCreatingJob: 'Creating audit job…',
        symbolAuditCancellingJob: 'Cancelling audit job…',
        symbolAuditActivity: (activity: string | undefined) => ({
            'connecting-server': 'Connecting to Codex Server',
            'creating-task': 'Creating read-only task',
            'waiting-response': 'Codex is processing',
            'receiving-response': 'Codex has started generating the structured result',
            'saving-result': 'Validating and caching the extracted result',
            'comparing-conflicts': 'Discovering same-surface notation candidates',
            'reviewing-candidates': 'Codex is reconciling candidate relationships',
            'finalizing-report': 'Validating and saving the audit report'
        }[activity || ''] || 'Codex is processing'),
        symbolAuditElapsed: (seconds: number) => `Running for ${seconds}s`,
        symbolAuditTokenUsage: (usage: NonNullable<ReaderSymbolAuditStatus['job']>['tokenUsage'], reportedCalls: number, modelCalls: number) => {
            if (modelCalls === 0) return 'Usage: Codex has not been called; this stays at 0 when every result is cached.';
            if (!usage) return `Usage: Codex Server did not provide an exact count for ${modelCalls} task${modelCalls === 1 ? '' : 's'}.`;
            const details = [`input ${usage.inputTokens.toLocaleString()}`, `output ${usage.outputTokens.toLocaleString()}`];
            if (usage.reasoningOutputTokens) details.push(`reasoning ${usage.reasoningOutputTokens.toLocaleString()}`);
            if (usage.cachedInputTokens) details.push(`cached input ${usage.cachedInputTokens.toLocaleString()}`);
            return `Usage: ${usage.totalTokens.toLocaleString()} tokens (${details.join(' · ')}; reported by ${reportedCalls}/${modelCalls} task${modelCalls === 1 ? '' : 's'}).`;
        },
        symbolAuditSaveSettings: 'Save settings',
        symbolAuditStart: 'Start audit',
        symbolAuditForce: 'Re-audit all',
        symbolAuditCancel: 'Cancel',
        symbolAuditRunning: (completed: number, total: number, filePath?: string) => `Auditing ${completed}/${total}${filePath ? ` · ${filePath}` : ''}`,
        symbolAuditComplete: (scanned: number, reused: number) => `Extracted ${scanned} files and reused ${reused} cached results.`,
        symbolAuditFailed: 'Audit did not finish',
        symbolAuditCancelled: 'Audit cancelled',
        symbolAuditReportCurrent: 'Current audit result',
        symbolAuditReportStale: 'The previous result is stale because source files or model settings changed.',
        symbolAuditNoReport: 'No audit result yet.',
        symbolAuditHardConflicts: (count: number) => `${count} high-confidence conflict${count === 1 ? '' : 's'}`,
        symbolAuditLegacyCandidates: (count: number) => `${count} unreconciled legacy candidate${count === 1 ? '' : 's'}`,
        symbolAuditPossibleConfusion: (count: number) => `${count} item${count === 1 ? '' : 's'} to review`,
        symbolAuditNoHardConflicts: 'No high-confidence conflict remains after semantic reconciliation.',
        symbolAuditNoAdvisories: 'No candidate remains for manual review.',
        symbolAuditOpenReport: 'Open audit report',
        symbolAuditLocate: 'Locate source',
        symbolAuditLoading: 'Reading audit status…',
        symbolAuditModelLoadFailed: 'Could not load available models',
        symbolAuditActionFailed: 'Symbol audit action failed',
        reference: 'Quote in Codex',
        referenceAdded: 'Added to the current conversation input',
        referenceUnavailable: 'Quote from the Math Workspace panel inside a Codex conversation',
        sourceActionFailed: 'The action did not complete. Please try again.',
        back: 'Back',
        forward: 'Forward',
        showNavigation: 'Show book navigation',
        hideNavigation: 'Hide book navigation',
        showSourceLineNumbers: 'Show source line numbers',
        hideSourceLineNumbers: 'Hide source line numbers',
        search: 'Filter pages',
        searchDefinitions: 'Search definitions',
        searchAllDefinitions: 'Search all definitions',
        showChapterDefinitions: 'Back to chapter definitions',
        noDefinitions: 'No matching definitions',
        noChapterDefinitions: 'No indexed definitions are mentioned in this chapter',
        noSymbols: 'No indexed project notation occurs on this page',
        propositionReviewGraphTitle: 'Chapter relation map',
        propositionReviewGraphHint: 'Solid lines are strict dependencies; numbered dashed lines are outside-map strict relations; numbered badges count supplemental text mentions, and a Lean badge marks a Lean anchor. Color and review use strict downstream only.',
        propositionReviewEmpty: 'No proposition, lemma, theorem, or corollary occurs in this chapter.',
        propositionReviewHub: 'Support hub',
        propositionReviewLinked: 'Linked',
        propositionReviewTerminal: 'Terminal proposition',
        propositionReviewIsolated: 'Isolated proposition',
        propositionReviewTerminalPropositions: 'Terminal propositions',
        propositionReviewTerminalPropositionSummary: (count: number) => `${count} terminal proposition${count === 1 ? '' : 's'}`,
        propositionReviewTerminalPropositionHint: 'These propositions currently have no downstream reference in the strict dependency graph; their chapter role and formalization anchors can be reviewed when useful.',
        propositionReviewNodeLabel: (display: string, upstream: number, downstream: number, ambientReferences: number, leanDeclarations: number, status: string) => `${display}; ${upstream} strict upstream, ${downstream} strict downstream, ${ambientReferences} supplemental text mention${ambientReferences === 1 ? '' : 's'}${leanDeclarations > 0 ? `, Lean anchor with ${leanDeclarations} declaration${leanDeclarations === 1 ? '' : 's'}` : ''}; ${status}`,
        source: 'Source',
        jump: 'Locate',
        recall: 'Recall',
        statementDependency: 'Statement dependencies',
        remarkDependency: 'Supplemental remark dependencies',
        upstreamDependencies: 'Upstream dependencies',
        downstreamDependencies: 'Downstream dependencies',
        noUpstreamDependencies: 'No directly referenced dependency nodes',
        noDownstreamDependencies: 'Not referenced by other dependency nodes',
        otherFormalReferences: (count: number) => `${count} additional section, definition, or other formal reference${count === 1 ? '' : 's'}`,
        live: 'Live',
        noContents: 'No headings on this page',
        close: 'Close',
        copyLatex: 'Copy LaTeX',
        adaptFormula: 'Adapt formula',
        restoreFormula: 'Restore original formula layout',
        adaptingFormula: 'Adapting formula…',
        copySelectedMarkdown: 'Copy selected Markdown',
        copySourceLines: 'Copy source lines',
        lookupDefinition: 'Find definition',
        copied: 'Copied',
        refineDefinitionQuery: 'Select a fuller term',
        decreaseFont: 'Decrease text size',
        increaseFont: 'Increase text size',
        fontSize: 'Text size',
        chooseProject: 'Choose project folder',
        recentProjects: 'Recent projects',
        noRecentProjects: 'No recent projects yet.',
        noMainPages: 'No main pages in this project. Expand Drafts in the contents to choose a draft.',
        noMarkdownPages: 'No Markdown pages were found in this project.',
        projectLauncherTitle: 'Open Math Workspace',
        projectLauncherDescription: 'Choose a project folder containing .math-workspace/config.json.',
        projectSelectionCancelled: 'No project was selected.',
        leanAlignment: 'Lean alignment',
        leanReview: 'Lean comparison',
        leanLoading: 'Loading Lean alignment…',
        leanUnavailable: 'Lean alignment details are unavailable.',
        leanContract: 'Contract',
        leanBuild: 'Build',
        leanDependencies: 'Dependencies',
        leanDeclarations: 'Lean declarations',
        leanMarkdownOnly: 'Markdown-only review',
        leanOnly: 'Additional Lean support',
        leanNone: 'Nothing to show',
        integrationManaged: 'Structure integrated',
        integrationSegmented: 'Segmented integration',
        integrationUnmanaged: 'Not integrated',
        integrationAttention: 'Needs consolidation',
        documentStage: 'Document stage',
        documentStageUnset: 'Set stage',
        documentStageDraft: 'Initial draft',
        documentStageRevising: 'Revising',
        documentStageStable: 'Stable draft',
        documentStageChanged: 'Changed',
        documentStageSaved: 'Document stage updated',
        documentStageMilestone: 'Version milestone',
        documentStageMilestoneHint: 'For example RC1 or v1',
        documentStageRecord: 'Record milestone',
        documentStageClear: 'Clear milestone',
        draftCollectionSummary: (total: number) => String(total),
        expandDraftCollection: 'Expand drafts',
        collapseDraftCollection: 'Collapse drafts',
        documentStageMenu: 'Change stage',
        documentStageSelection: (count: number) => `${count} document${count === 1 ? '' : 's'} selected`,
        documentStageBatch: (count: number) => count === 1 ? 'Change document stage' : `Change stage for ${count} documents`,
        documentStageBatchSaved: (count: number) => count === 1 ? 'Document stage updated' : `Updated stage for ${count} documents`,
        documentStageBatchNoFormal: 'Draft collections do not use document stages',
        integrationGroupSummary: (managed: number, total: number) => `Integrated ${managed}/${total}`,
        integrationManagedDetail: (anchors: number) => `A unique page anchor is available; ${anchors} stable anchor${anchors === 1 ? '' : 's'}`,
        integrationSegmentedDetail: (anchors: number) => `${anchors} stable anchor${anchors === 1 ? '' : 's'} found, but no unique page anchor`,
        integrationUnmanagedDetail: 'No stable anchor was found',
        integrationAttentionDetail: (temporary: number, issues: number) => `${temporary} temporary anchor${temporary === 1 ? '' : 's'}; ${issues} scanner notice${issues === 1 ? '' : 's'}`
    }
} as const;

function escapeHtml(value: string): string {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function queryPath(): string {
    return new URLSearchParams(readerSearch()).get('path') || '';
}

interface ReaderSourceLocation {
    line: number;
    column?: number;
}

function querySourceLocation(): ReaderSourceLocation | undefined {
    const query = new URLSearchParams(readerSearch());
    const line = Number(query.get('line'));
    const column = Number(query.get('column'));
    if (!Number.isInteger(line) || line < 1) return undefined;
    return {
        line,
        ...(Number.isInteger(column) && column >= 1 ? { column } : {})
    };
}

function queryView(): string {
    return new URLSearchParams(readerSearch()).get('view') || '';
}

function normalizeQuery(value: string): string {
    return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function compactPropositionDisplay(display: string): string {
    return display.match(/\d+(?:\.\d+)+/)?.[0] || display;
}

function leanStatusLabel(language: Language, kind: 'contract' | 'build' | 'dependencies', value: string | undefined): string {
    const zh = language === 'zh';
    if (kind === 'contract') {
        if (value === 'current') return zh ? '已记录，当前未变更' : 'captured and current';
        if (value === 'markdown-drifted') return zh ? '正文已变更，需复核' : 'Markdown changed; review needed';
        if (value === 'declaration-drifted') return zh ? 'Lean 声明已变更，需复核' : 'Lean declaration changed; review needed';
        if (value === 'drifted') return zh ? '正文与 Lean 均已变更，需复核' : 'both sides changed; review needed';
        return zh ? '尚未记录' : 'not captured';
    }
    if (kind === 'build') {
        if (value === 'passed') return zh ? '最近一次通过' : 'last build passed';
        if (value === 'failed') return zh ? '最近一次失败' : 'last build failed';
        if (value === 'stale') return zh ? '结果已过期' : 'result is stale';
        return zh ? '尚未验证' : 'not verified';
    }
    if (value === 'matched') return zh ? '严格边已观察到' : 'strict edges observed';
    if (value === 'markdown-gap') return zh ? '存在正文边待复核' : 'Markdown edges need review';
    if (value === 'supplemental') return zh ? '存在额外 Lean 支撑' : 'additional Lean support';
    if (value === 'stale') return zh ? '比对已过期' : 'comparison is stale';
    return zh ? '尚未比对' : 'not compared';
}

function pageIntegration(page?: ReaderPage): ReaderPageIntegration {
    return page?.integration || {
        status: 'unmanaged',
        stableAnchorCount: 0,
        temporaryAnchorCount: 0,
        issueCount: 0
    };
}

function pageIntegrationStatusLabel(integration: ReaderPageIntegration, language: Language): string {
    const dictionary = words[language];
    switch (integration.status) {
        case 'managed': return dictionary.integrationManaged;
        case 'segmented': return dictionary.integrationSegmented;
        case 'attention': return dictionary.integrationAttention;
        default: return dictionary.integrationUnmanaged;
    }
}

function pageIntegrationDetail(integration: ReaderPageIntegration, language: Language): string {
    const dictionary = words[language];
    switch (integration.status) {
        case 'managed': return dictionary.integrationManagedDetail(integration.stableAnchorCount);
        case 'segmented': return dictionary.integrationSegmentedDetail(integration.stableAnchorCount);
        case 'attention': return dictionary.integrationAttentionDetail(integration.temporaryAnchorCount, integration.issueCount);
        default: return dictionary.integrationUnmanagedDetail;
    }
}

function pageIntegrationTooltip(page: ReaderPage | undefined, language: Language): string {
    const integration = pageIntegration(page);
    return `${pageIntegrationStatusLabel(integration, language)} · ${pageIntegrationDetail(integration, language)}`;
}

const DOCUMENT_STAGE_OPTIONS = [
    { stage: 'draft', label: 'documentStageDraft', icon: 'stage-draft' },
    { stage: 'revising', label: 'documentStageRevising', icon: 'stage-revising' },
    { stage: 'stable', label: 'documentStageStable', icon: 'stage-stable' }
] as const;

type DocumentStage = typeof DOCUMENT_STAGE_OPTIONS[number]['stage'];

function documentStageLabel(page: ReaderPage | undefined, language: Language): string {
    const option = DOCUMENT_STAGE_OPTIONS.find(option => option.stage === page?.lifecycle?.stage);
    return option ? words[language][option.label] : words[language].documentStageUnset;
}

function documentStageContent(stage: DocumentStage | undefined, language: Language, compact = false): HTMLElement {
    const content = document.createElement('span');
    content.className = 'reader-document-stage';
    const option = DOCUMENT_STAGE_OPTIONS.find(option => option.stage === stage);
    if (option) content.append(readerIcon(option.icon, 16));
    if (!compact) {
        const label = document.createElement('span'); label.className = 'reader-document-stage-label';
        readerText(label, () => { const locale = readerPreferences.snapshot().language;
            return option ? words[locale][option.label] : words[locale].documentStageUnset; });
        content.append(label);
    }
    return content;
}

function documentStatusText(page: ReaderPage | undefined, language: Language): string {
    const stage = documentStageLabel(page, language);
    const checkpoint = page?.lifecycle?.checkpoint;
    return [stage, checkpoint?.label, checkpoint && page?.lifecycle?.changedSinceCheckpoint ? words[language].documentStageChanged : ''].filter(Boolean).join(' · ');
}

function documentStatusBadge(page: ReaderPage | undefined, language: Language, interactive = false): HTMLElement | undefined {
    const lifecycle = page?.lifecycle;
    if (page?.documentMode === 'draft') return undefined;
    const hasState = !!lifecycle?.stage || !!lifecycle?.checkpoint;
    if (!interactive && !hasState) return undefined;
    const element = interactive ? document.createElement('button') : document.createElement('span');
    element.className = 'reader-document-status' + (interactive ? ' is-interactive' : '') + (lifecycle?.checkpoint && lifecycle.changedSinceCheckpoint ? ' is-changed' : '');
    const status = documentStatusText(page, language);
    const description = words[language].documentStage + (language === 'en' ? ': ' : '：') + status;
    const describe = () => { const locale = readerPreferences.snapshot().language;
        return words[locale].documentStage + (locale === 'en' ? ': ' : '：') + documentStatusText(page, locale); };
    readerAttribute(element, 'data-reader-tooltip', describe);
    if (!lifecycle?.stage && lifecycle?.checkpoint) element.append(readerIcon('stage-checkpoint', 16));
    if (lifecycle?.stage || interactive) element.append(documentStageContent(lifecycle?.stage, language, !interactive));
    if (interactive) {
        (element as HTMLButtonElement).type = 'button';
        element.dataset.documentStatus = 'true';
        readerAttribute(element, 'aria-label', describe);
        if (lifecycle?.checkpoint) {
            const checkpoint = document.createElement('span'); checkpoint.className = 'reader-document-checkpoint';
            checkpoint.textContent = '· ' + lifecycle.checkpoint.label; element.append(checkpoint);
            if (lifecycle.changedSinceCheckpoint) {
                const changed = document.createElement('span'); changed.className = 'reader-document-changed';
                readerText(changed, () => '· ' + words[readerPreferences.snapshot().language].documentStageChanged); element.append(changed);
            }
        }
    } else {
        element.classList.add('is-compact');
        element.setAttribute('aria-hidden', 'true');
    }
    return element;
}

function pageIntegrationGlyph(page: ReaderPage | undefined, language: Language): HTMLSpanElement {
    const glyph = document.createElement('span');
    if (page?.documentMode === 'draft') {
        glyph.className = 'reader-page-integration is-hidden';
        return glyph;
    }
    const integration = pageIntegration(page);
    glyph.className = 'reader-page-integration is-' + integration.status;
    readerAttribute(glyph, 'data-reader-tooltip', () => pageIntegrationTooltip(page, readerPreferences.snapshot().language));
    glyph.setAttribute('aria-hidden', 'true');
    glyph.append(readerIcon(`integration-${integration.status}`, 16));
    return glyph;
}

const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 24;
const FONT_SIZE_STORAGE_KEY = 'math-workspace.font-size';
const DRAFT_COLLECTIONS_STORAGE_KEY = 'math-workspace.expanded-draft-collections';
const NAVIGATION_STORAGE_KEY = 'math-workspace.navigation-collapsed';
const SOURCE_LINE_NUMBERS_STORAGE_KEY = 'math-workspace.source-line-numbers';

function storedFontSize(): number {
    try {
        const value = Number.parseInt(localStorage.getItem(FONT_SIZE_STORAGE_KEY) || '', 10);
        return Number.isInteger(value) ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value)) : DEFAULT_FONT_SIZE;
    } catch (_error) {
        return DEFAULT_FONT_SIZE;
    }
}

function storedNavigationCollapsed(): boolean {
    try {
        return localStorage.getItem(NAVIGATION_STORAGE_KEY) === 'true';
    } catch (_error) {
        return false;
    }
}

function storedSourceLineNumbers(): boolean {
    try {
        return localStorage.getItem(SOURCE_LINE_NUMBERS_STORAGE_KEY) === 'true';
    } catch (_error) {
        return false;
    }
}

function storedExpandedDraftCollections(): Set<string> {
    try {
        const value = JSON.parse(localStorage.getItem(DRAFT_COLLECTIONS_STORAGE_KEY) || '[]');
        return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
    } catch (_error) {
        return new Set();
    }
}


class ReaderApplication {
    private disposeFigures: () => void = () => {};
    private disposeAssets: () => void = () => {};
    private formulaLayout: ReaderFormulaLayout | undefined;
    private readonly root = document.getElementById('reader-app') as HTMLElement;
    private readonly markdown = createFormalRenderer();
    private state: ReaderState | undefined;
    private page: ReaderPagePayload | undefined;
    private currentPath = '';
    private selectedPagePaths: string[] = [];
    private selectionAnchorPath = '';
    private navigationContextMenu: HTMLElement | undefined;
    private navigationContextMenuCleanup: (() => void) | undefined;
    private historyPaths: string[] = [];
    private historyIndex = -1;
    private pageRequestId = 0;
    private fontSize = storedFontSize();
    private navigationCollapsed = storedNavigationCollapsed();
    private sourceLineNumbersVisible = storedSourceLineNumbers();
    private sourceLineNumberAlignmentFrame = 0;
    private main!: HTMLElement;
    private expandedDraftCollections = storedExpandedDraftCollections();
    private article!: HTMLElement;
    private pageTitle!: HTMLElement;
    private liveStatus!: HTMLElement;
    private sourceActions!: ReaderSourceActions;
    private recallPopover!: ReaderRecallPopover;
    private dependencyPopover!: ReaderDependencyPopover;
    private leanPopover!: ReaderLeanPopover;
    private leanReview!: ReaderLeanReview;
    private toolbarPanel!: ReaderToolbarPanel;
    private toolbarMenu!: ReaderToolbarMenu;
    private tooltip!: ReaderTooltip;
    private propositionReview!: ReaderPropositionReview;
    private archive!: ReaderArchive;
    private publication!: ReaderPublication;
    private createPage!: ReaderCreatePage;
    private symbolAudit!: ReaderSymbolAudit;
    private symbolAuditReport!: ReaderSymbolAuditReportView;
    private symbolAuditReportOpen = false;
    private realtimeEvents: ReaderEvents | undefined;
    private clearSourceLocationHighlight: (() => void) | undefined;
    private disposePreferences: (() => void) | undefined;

    async start(): Promise<void> {
        this.buildShell();
        mountReaderEmbeddedView(this.main);
        try { await this.startReading(); } catch (error) { this.disposePreferences?.(); throw error; }
    }

    private async startReading(): Promise<void> {
        await this.refreshState();
        this.installHandlers();
        if (!this.state?.available) {
            this.renderProjectLauncher();
            return;
        }
        await this.openInitialPage();
        this.installRealtimeUpdates();
    }

    private async openInitialPage(): Promise<void> {
        const initialView = queryView();
        const requested = this.pageForPath(queryPath());
        const initialPath = requested && (!isReaderPageRestored() || requested.documentMode !== 'draft')
            ? requested.filePath : this.defaultPagePath();
        if (!initialPath) {
            this.formulaLayout?.dispose();
            this.page = undefined;
            this.currentPath = '';
            this.pageTitle.replaceChildren();
            readerText(this.article, () => this.state?.pages.length ? this.dictionary().noMainPages : this.dictionary().noMarkdownPages);
            return;
        }
        this.selectedPagePaths = [initialPath];
        this.selectionAnchorPath = initialPath;
        await this.openPage(initialPath, 'replace', '', false, querySourceLocation());
        if (initialView === 'symbol-audit-report') await this.openSymbolAuditReport('replace');
    }

    private buildShell(): void {
        this.root.innerHTML = [
            '<div class="reader-shell' + (this.navigationCollapsed ? ' is-navigation-collapsed' : '') + '">',
            '<aside id="reader-sidebar" class="reader-sidebar" aria-label="Project navigation">',
            '<div class="reader-navigation-actions">',
            '<label class="reader-filter"><span class="sr-only">Filter pages</span><input id="reader-page-filter" type="search" autocomplete="off" /></label>',
            '<button id="reader-create-page" class="icon-button" type="button"></button>',
            '</div>',
            '<nav id="reader-page-nav" class="reader-page-nav"></nav>',
            '</aside>',
            '<main id="reader-main" class="reader-main">',
            '<header class="reader-toolbar">',
            '<button id="reader-navigation-toggle" class="icon-button reader-navigation-toggle" type="button"></button>',
            '<div class="reader-history"><button id="reader-back" class="icon-button" aria-label="Back"></button><button id="reader-forward" class="icon-button" aria-label="Forward"></button></div>',
            '<div id="reader-page-title" class="reader-page-title"></div>',
            '<div class="reader-tools" role="group" aria-label="Reader tools">',
            '<button id="reader-lean-review" class="tool-button" type="button" aria-label="Lean comparison"></button>',
            '<button class="tool-button" type="button" data-panel="contents" aria-label="Contents"></button>',
            '<button id="reader-reference-tools" class="tool-button" type="button" data-tool-menu="reference" aria-label="Reference"></button>',
            '<button id="reader-review-tools" class="tool-button" type="button" data-tool-menu="review" aria-label="Review"></button>',
            '<button id="reader-edition-tools" class="tool-button" type="button" data-tool-menu="edition" aria-label="Versions and publication"></button>',
            '<button id="reader-display-tools" class="tool-button" type="button" data-tool-menu="display" aria-label="Display"></button>',
            (isReaderEmbedded() ? '<button id="reader-expand" class="tool-button" type="button" aria-label="Full screen"></button>' : ''),
            '</div>',
            '<span id="reader-live" class="reader-live" aria-live="polite"></span>',
            '</header><article id="reader-article" class="reader-article"></article></main>',
            '</div>'
        ].join('');
        this.main = this.root.querySelector('#reader-main') as HTMLElement;
        this.article = this.root.querySelector('#reader-article') as HTMLElement;
        this.pageTitle = this.root.querySelector('#reader-page-title') as HTMLElement;
        this.liveStatus = this.root.querySelector('#reader-live') as HTMLElement;
        this.toolbarMenu = new ReaderToolbarMenu(this.root, () => this.dictionary(), () => this.prepareToolbarView('menu'), readerPreferences);
        this.tooltip = new ReaderTooltip();
        this.tooltip.bind(this.root);
        window.addEventListener('pagehide', () => { this.formulaLayout?.dispose(); this.createPage?.close(false); });
        window.addEventListener('pageshow', event => { if (event.persisted && this.page && !this.symbolAuditReportOpen) this.mountArticleFormulaLayout(); });
        this.installToolbarIcons();
        this.root.querySelector('#reader-expand')?.addEventListener('click', expandReader);
        this.updateFontSize(this.fontSize, false);
        this.setSourceLineNumbers(this.sourceLineNumbersVisible, false);
        window.addEventListener('resize', () => this.queueSourceLineNumberAlignment());
        (this.root.querySelector('#reader-page-filter') as HTMLInputElement).addEventListener('input', event => {
            this.renderNavigation((event.target as HTMLInputElement).value);
        });
        this.sourceActions = new ReaderSourceActions({
            getDefinitions: query => this.findDefinitions(query, 7),
            fetchDefinition: index => this.fetchJson<any>('/api/definition?index=' + index),
            renderDefinition: definition => this.renderDefinitionContent(definition),
            locateDefinition: definition => this.locateDefinition(definition),
            canReference: canReferenceReaderInConversation,
            canAdaptFormula: formula => this.formulaLayout?.canAdapt(formula) || false,
            isFormulaAdapted: formula => this.formulaLayout?.isAdapted(formula) || false,
            toggleFormulaLayout: formula => this.formulaLayout?.toggle(formula) || Promise.resolve(),
            reference: async (location, markdown) => {
                try {
                    const page = this.page, projectId = this.state?.projectId;
                    if (!page || page.filePath !== location.filePath) throw new Error('The reference page has changed.');
                    const context = await this.fetchJson<{ projectRoot: string }>('/api/plugin-context');
                    if (page !== this.page || projectId !== this.state?.projectId) throw new Error('The reference page has changed.');
                    await referenceReaderInConversation([readerReference({ source: page.content,
                        projectRoot: context.projectRoot, title: page.page?.title || location.filePath }, location, markdown)]);
                    this.reportLive(this.dictionary().referenceAdded);
                } catch (error) {
                    this.reportLive(this.dictionary().sourceActionFailed);
                    throw error;
                }
            },
            labels: () => {
                const dictionary = this.dictionary();
                return {
                    copyLatex: dictionary.copyLatex,
                    adaptFormula: dictionary.adaptFormula,
                    restoreFormula: dictionary.restoreFormula,
                    adaptingFormula: dictionary.adaptingFormula,
                    copySelectedMarkdown: dictionary.copySelectedMarkdown,
                    copySourceLines: dictionary.copySourceLines,
                    lookupDefinition: dictionary.lookupDefinition,
                    locate: dictionary.jump,
                    copied: dictionary.copied,
                    noDefinitions: dictionary.noDefinitions,
                    refineDefinitionQuery: dictionary.refineDefinitionQuery,
                    reference: dictionary.reference,
                    failed: dictionary.sourceActionFailed,
                    referenceUnavailable: dictionary.referenceUnavailable
                };
            }
        });
        this.recallPopover = new ReaderRecallPopover({
            fetchRecall: id => this.fetchJson<any>('/api/recall?id=' + encodeURIComponent(id)),
            renderRecall: recall => renderFormalMarkdown(this.markdown, recall.content || '', this.renderOptions(recall.filePath, recall.labels || {})),
            labels: () => ({ recall: this.dictionary().recall })
        });
        this.dependencyPopover = new ReaderDependencyPopover({
            markerFor: id => this.page?.dependencyMarkers?.[id],
            openTarget: target => this.openDependencyTarget(target.filePath, target.id),
            labels: () => {
                const dictionary = this.dictionary();
                return {
                    dependencyTitle: kind => kind === 'remark' ? dictionary.remarkDependency : dictionary.statementDependency,
                    upstream: dictionary.upstreamDependencies,
                    downstream: dictionary.downstreamDependencies,
                    noUpstream: dictionary.noUpstreamDependencies,
                    noDownstream: dictionary.noDownstreamDependencies,
                    otherFormalReferences: dictionary.otherFormalReferences
                };
            }
        });
        this.leanReview = new ReaderLeanReview(this.main, {
            context: () => ({ projectId: this.state?.projectId || '', filePath: this.currentPath,
                language: this.uiLanguage, manuscriptLanguage: this.state?.language || 'zh', token: this.state?.requestToken || '', revision: this.state?.revision || 0 }),
            request: readerFetch,
            renderProse: source => renderFormalMarkdown(this.markdown, source.content, this.renderOptions(source.filePath)),
            mountProse: container => {
                container.lang = this.state?.language || 'zh';
                const figures = mountReaderFigures(container, () => this.uiLanguage);
                const assets = mountReaderAssets(container);
                return () => { figures(); assets(); };
            },
            locate: source => {
                this.leanReview.close(false);
                void this.openPage(source.filePath, 'push', '', false, { line: source.startLine });
            },
            navigatePage: filePath => this.openPage(filePath, 'push'),
            canAssist: canReferenceReaderInConversation,
            assist: referenceReaderInConversation,
            report: message => this.reportLive(message)
        });
        this.root.querySelector('#reader-lean-review')?.addEventListener('click', event => {
            this.prepareToolbarView('lean'); void this.leanReview.openPageQueue(event.currentTarget as HTMLElement);
        });
        this.leanPopover = new ReaderLeanPopover({
            fetchAnchor: id => this.fetchJson<ReaderLeanAnchorPayload>('/api/lean?id=' + encodeURIComponent(id)),
            openReview: (id, marker) => { this.prepareToolbarView('lean'); void this.leanReview.open(id, marker); },
            labels: () => {
                const dictionary = this.dictionary();
                return {
                    title: dictionary.leanAlignment,
                    openReview: dictionary.leanReview,
                    loading: dictionary.leanLoading,
                    unavailable: dictionary.leanUnavailable,
                    contract: dictionary.leanContract,
                    build: dictionary.leanBuild,
                    dependencies: dictionary.leanDependencies,
                    declarations: dictionary.leanDeclarations,
                    markdownOnly: dictionary.leanMarkdownOnly,
                    leanOnly: dictionary.leanOnly,
                    none: dictionary.leanNone,
                    status: (kind, value) => leanStatusLabel(this.uiLanguage, kind, value)
                };
            }
        });
        this.archive = new ReaderArchive(() => ({ language: this.uiLanguage, manuscriptLanguage: this.state?.language || 'zh', currentPath: this.currentPath, token: this.state?.requestToken || '', project: this.state?.projectId || '' }));
        this.root.querySelector('#reader-archive')?.addEventListener('click', () => { this.prepareToolbarView('archive'); void this.archive.open(); });
        this.publication = new ReaderPublication(() => ({ language: this.uiLanguage, manuscriptLanguage: this.state?.language || 'zh', token: this.state?.requestToken || '', project: this.state?.projectId || '' }));
        this.root.querySelector('#reader-publication')?.addEventListener('click', () => { this.prepareToolbarView('publication'); void this.publication.open(); });
        this.createPage = new ReaderCreatePage(this.root.querySelector<HTMLButtonElement>('#reader-create-page')!, {
            context: () => ({ projectId: this.state?.projectId || null, requestToken: this.state?.requestToken,
                language: this.uiLanguage, manuscriptLanguage: this.state?.language || 'zh', currentPath: this.currentPath, revision: this.state?.revision }),
            request: readerFetch,
            beforeOpen: () => this.prepareToolbarView('create-page'),
            canAssist: canReferenceReaderInConversation,
            assist: referenceReaderInConversation,
            openPage: async (filePath, isCurrent) => {
                const projectId = this.state?.projectId, token = this.state?.requestToken;
                const state = await this.fetchJson<ReaderState>('/api/state');
                if (!isCurrent() || projectId !== this.state?.projectId || token !== this.state?.requestToken
                    || state.projectId !== projectId || state.requestToken !== token
                    || !state.pages.some(page => page.filePath === filePath)) return false;
                this.applyState(state);
                await this.openPage(filePath, 'push'); return true;
            },
            report: message => this.reportLive(message)
        });
        this.toolbarPanel = new ReaderToolbarPanel(() => ({ close: this.dictionary().close }));
        this.propositionReview = new ReaderPropositionReview({
            labels: () => {
                const dictionary = this.dictionary();
                return {
                    graphTitle: dictionary.propositionReviewGraphTitle,
                    graphHint: dictionary.propositionReviewGraphHint,
                    empty: dictionary.propositionReviewEmpty,
                    hub: dictionary.propositionReviewHub,
                    linked: dictionary.propositionReviewLinked,
                    terminal: dictionary.propositionReviewTerminal,
                    isolated: dictionary.propositionReviewIsolated,
                    terminalPropositions: dictionary.propositionReviewTerminalPropositions,
                    terminalPropositionSummary: dictionary.propositionReviewTerminalPropositionSummary,
                    terminalPropositionHint: dictionary.propositionReviewTerminalPropositionHint,
                    nodeLabel: dictionary.propositionReviewNodeLabel
                };
            },
            openProposition: id => this.openCurrentProposition(id)
        });
        this.symbolAudit = new ReaderSymbolAudit();
        this.symbolAuditReport = new ReaderSymbolAuditReportView();
        let interfaceLanguage = this.uiLanguage;
        const disposePreferences = readerPreferences.subscribe(snapshot => {
            this.toolbarMenu.updatePreferences();
            if (snapshot.language === interfaceLanguage) return;
            interfaceLanguage = snapshot.language;
            this.updateInterfaceLanguage();
        });
        this.disposePreferences = disposePreferences;
        window.addEventListener('pagehide', event => { if (!event.persisted) disposePreferences(); });
        this.updateToolbarLabels();

    }

    private get uiLanguage(): Language { return readerPreferences.snapshot().language; }

    private dictionary() {
        return readerWords(() => words[this.uiLanguage]);
    }

    private updateInterfaceLanguage(): void {
        this.updateToolbarLabels();
        this.archive?.contextChanged();
        this.publication?.contextChanged();
        this.leanReview?.contextChanged();
        this.formulaLayout?.setLanguage(this.uiLanguage);
        if (this.symbolAuditReportOpen) { this.article.lang = this.uiLanguage; document.title = this.dictionary().symbolAuditOpenReport + ' — Math Workspace'; }
        refreshReaderLabels(document.body);
        this.toolbarPanel?.reposition();
    }

    private async fetchJson<T>(url: string): Promise<T> {
        const response = await readerFetch(url, {
            cache: 'no-store',
            headers: (url === '/api/document-state' || url.startsWith('/api/symbol-audit')) && this.state?.requestToken
                ? { 'x-math-workspace-token': this.state.requestToken }
                : undefined
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<T>;
    }

    private async postJson<T>(url: string, value: unknown = {}): Promise<T> {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (url.startsWith('/api/symbol-audit') && this.state?.requestToken) {
            headers['x-math-workspace-token'] = this.state.requestToken;
        }
        if (url === '/api/document-state' && this.state?.requestToken) {
            headers['x-math-workspace-token'] = this.state.requestToken;
        }
        const response = await readerFetch(url, {
            method: 'POST',
            cache: 'no-store',
            headers,
            body: JSON.stringify(value)
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<T>;
    }

    private async deleteJson<T>(url: string): Promise<T> {
        const headers: Record<string, string> = {};
        if (url.startsWith('/api/symbol-audit') && this.state?.requestToken) {
            headers['x-math-workspace-token'] = this.state.requestToken;
        }
        const response = await readerFetch(url, { method: 'DELETE', cache: 'no-store', headers });
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<T>;
    }

    private async refreshState(): Promise<void> {
        this.applyState(await this.fetchJson<ReaderState>('/api/state'));
    }

    private applyState(state: ReaderState): void {
        const projectChanged = this.state?.projectId !== state.projectId;
        const formulaContextChanged = projectChanged || this.state?.requestToken !== state.requestToken || this.state?.language !== state.language;
        if (this.toolbarPanel?.isActive('chapters')) this.toolbarPanel.close(this.titleNavigationHasFocus());
        if (projectChanged) this.toolbarMenu?.close();
        if (formulaContextChanged) this.formulaLayout?.dispose();
        this.state = state;
        if (formulaContextChanged && !projectChanged && this.page && !this.symbolAuditReportOpen) this.mountArticleFormulaLayout();
        this.archive?.contextChanged();
        this.publication?.contextChanged();
        this.leanReview?.contextChanged();
        this.createPage?.contextChanged();
        const dictionary = this.dictionary();
        readerAttribute((this.root.querySelector('#reader-page-filter') as HTMLInputElement), 'placeholder', () => this.dictionary().search);
        this.renderNavigation((this.root.querySelector('#reader-page-filter') as HTMLInputElement).value);
        this.updateToolbarLabels();
        readerViewStateChanged();
    }

    private renderProjectLauncher(message: string | (() => string) = ''): void {
        this.formulaLayout?.dispose();
        const shell = this.root.querySelector('.reader-shell') as HTMLElement;
        shell.classList.add('is-project-launcher');
        this.article.replaceChildren();
        const dictionary = this.dictionary();
        const panel = document.createElement('section');
        panel.className = 'reader-project-launcher';
        const title = document.createElement('h1');
        readerText(title, () => this.dictionary().projectLauncherTitle);
        const description = document.createElement('p');
        readerText(description, () => (typeof message === 'function' ? message() : message) || this.dictionary().projectLauncherDescription);
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'reader-project-choose';
        choose.dataset.projectPicker = 'true';
        readerText(choose, () => this.dictionary().chooseProject);
        const recentHeading = document.createElement('h2');
        readerText(recentHeading, () => this.dictionary().recentProjects);
        const recent = document.createElement('div');
        recent.className = 'reader-recent-projects';
        const projects = this.state?.recentProjects || [];
        if (!projects.length) {
            const empty = document.createElement('p');
            empty.className = 'reader-project-empty';
            readerText(empty, () => this.dictionary().noRecentProjects);
            recent.append(empty);
        } else {
            projects.forEach(project => {
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.recentProject = String(project.index);
                const name = document.createElement('strong');
                name.textContent = project.rootName;
                const opened = document.createElement('span');
                const date = new Date(project.openedAt);
                opened.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
                button.append(name, opened);
                recent.append(button);
            });
        }
        panel.append(title, description, choose, recentHeading, recent);
        this.article.append(panel);
    }

    private async chooseProject(url: string, value: unknown = {}): Promise<void> {
        try {
            const state = await this.postJson<ReaderState>(url, value);
            this.applyState(state);
            if (!state.available) {
                this.renderProjectLauncher(() => this.dictionary().projectSelectionCancelled);
                return;
            }
            this.root.querySelector('.reader-shell')?.classList.remove('is-project-launcher');
            this.page = undefined;
            this.currentPath = '';
            this.historyPaths = [];
            this.historyIndex = -1;
            readerHistory('replace', {}, window.location.pathname);
            await this.openInitialPage();
            this.installRealtimeUpdates();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.renderProjectLauncher(message);
        }
    }

    private updateToolbarLabels(): void {
        const dictionary = this.dictionary();
        this.toolbarMenu?.updateLabels();
        readerAttribute(this.root.querySelector('#reader-sidebar'), 'aria-label', () => this.dictionary().projectNavigation);
        const filter = this.root.querySelector<HTMLInputElement>('#reader-page-filter');
        if (filter) { readerAttribute(filter, 'placeholder', () => this.dictionary().search); readerAttribute(filter, 'aria-label', () => this.dictionary().search); }
        const filterLabel = this.root.querySelector('.reader-filter .sr-only');
        if (filterLabel) readerText(filterLabel, () => this.dictionary().search);
        this.createPage?.contextChanged();
        readerAttribute(this.root.querySelector('.reader-tools'), 'aria-label', () => this.dictionary().readerTools);
        const expand = this.root.querySelector<HTMLElement>('#reader-expand');
        if (expand) { const label = this.uiLanguage === 'en' ? 'Full screen' : '全屏阅读'; replaceReaderButtonIcon(expand, 'expand'); expand.dataset.readerTooltip = label; expand.setAttribute('aria-label', label); }
        const back = this.root.querySelector('#reader-back') as HTMLElement;
        const forward = this.root.querySelector('#reader-forward') as HTMLElement;
        back.dataset.tooltip = dictionary.back;
        readerAttribute(back, 'aria-label', () => this.dictionary().back);
        forward.dataset.tooltip = dictionary.forward;
        readerAttribute(forward, 'aria-label', () => this.dictionary().forward);
        this.root.querySelectorAll<HTMLElement>('[data-panel]').forEach(button => {
            const panel = button.dataset.panel || '';
            const view = (panel === 'symbol-audit' ? 'symbolAudit' : panel) as keyof typeof dictionary;
            const label = typeof dictionary[view] === 'string' ? dictionary[view] : '';
            button.dataset.readerTooltip = label;
            button.setAttribute('aria-label', label);
        });
        const fontSize = this.root.querySelector('.reader-type-control') as HTMLElement;
        readerAttribute(fontSize, 'aria-label', () => this.dictionary().fontSize);
        const decrease = this.root.querySelector<HTMLElement>('[data-font-size="-1"]') as HTMLElement;
        const increase = this.root.querySelector<HTMLElement>('[data-font-size="1"]') as HTMLElement;
        decrease.dataset.readerTooltip = dictionary.decreaseFont;
        delete decrease.dataset.tooltip;
        readerAttribute(decrease, 'aria-label', () => this.dictionary().decreaseFont);
        increase.dataset.readerTooltip = dictionary.increaseFont;
        delete increase.dataset.tooltip;
        readerAttribute(increase, 'aria-label', () => this.dictionary().increaseFont);
        this.updateNavigationToggle();
        this.updateSourceLineNumberToggle();
        this.updateDraftToolbarAvailability();
        const leanReviewButton = this.root.querySelector<HTMLButtonElement>('#reader-lean-review');
        if (leanReviewButton) {
            replaceReaderButtonIcon(leanReviewButton, 'lean-compare');
        }
        const archiveButton = this.root.querySelector<HTMLButtonElement>('#reader-archive');
        if (archiveButton) {
            const label = dictionary.versionHistory;
            archiveButton.setAttribute('aria-label', label);
            archiveButton.dataset.readerTooltip = label;
        }
        const publicationButton = this.root.querySelector<HTMLButtonElement>('#reader-publication');
        if (publicationButton) {
            const label = dictionary.pdfPublication;
            publicationButton.setAttribute('aria-label', label);
            publicationButton.dataset.readerTooltip = label;
            publicationButton.disabled = !this.state?.projectId;
        }
        this.toolbarMenu?.refreshFocus();
    }

    private updateDraftToolbarAvailability(): void {
        const isDraft = this.page?.page.documentMode === 'draft';
        const unavailablePanels = new Set(['definitions', 'symbols', 'propositions', 'symbol-audit']);
        const dictionary = this.dictionary();
        const leanReviewButton = this.root.querySelector<HTMLButtonElement>('#reader-lean-review');
        if (leanReviewButton) {
            leanReviewButton.disabled = isDraft || !this.currentPath;
            const label = isDraft ? dictionary.draftFormalToolsUnavailable : dictionary.leanReview;
            leanReviewButton.dataset.readerTooltip = label; leanReviewButton.setAttribute('aria-label', label);
        }
        this.root.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(button => {
            const panel = button.dataset.panel || '';
            const unavailable = isDraft && unavailablePanels.has(panel);
            button.disabled = unavailable;
            button.classList.toggle('is-unavailable', unavailable);
            const titleKey = panel === 'symbol-audit' ? 'symbolAudit' : panel;
            const candidate = dictionary[titleKey as keyof typeof dictionary];
            const label = unavailable
                ? dictionary.draftFormalToolsUnavailable
                : (typeof candidate === 'string' ? candidate : panel);
            button.dataset.readerTooltip = label;
            button.setAttribute('aria-label', label);
        });
        this.toolbarMenu?.refreshFocus();
    }

    private updateFontSize(value: number, persist = true): void {
        this.fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value));
        this.root.style.setProperty('--reader-font-size', this.fontSize + 'px');
        const output = this.root.querySelector('#reader-font-size') as HTMLOutputElement | null;
        if (output) output.textContent = this.fontSize + 'px';
        const decrease = this.root.querySelector<HTMLButtonElement>('[data-font-size="-1"]');
        const increase = this.root.querySelector<HTMLButtonElement>('[data-font-size="1"]');
        if (decrease) decrease.disabled = this.fontSize <= MIN_FONT_SIZE;
        if (increase) increase.disabled = this.fontSize >= MAX_FONT_SIZE;
        this.toolbarMenu?.refreshFocus();
        this.queueSourceLineNumberAlignment();
        if (!persist) return;
        try {
            localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(this.fontSize));
        } catch (_error) {
            // A restrictive browser context can disable persistence without affecting reading.
        }
    }

    private setNavigationCollapsed(value: boolean, persist = true): void {
        this.navigationCollapsed = value;
        this.root.querySelector('.reader-shell')?.classList.toggle('is-navigation-collapsed', value);
        this.updateNavigationToggle();
        this.queueSourceLineNumberAlignment();
        if (!persist) return;
        try {
            localStorage.setItem(NAVIGATION_STORAGE_KEY, String(value));
        } catch (_error) {
            // Navigation remains usable when browser storage is unavailable.
        }
    }

    private updateNavigationToggle(): void {
        const toggle = this.root.querySelector('#reader-navigation-toggle') as HTMLButtonElement | null;
        if (!toggle) return;
        const label = this.navigationCollapsed ? this.dictionary().showNavigation : this.dictionary().hideNavigation;
        toggle.dataset.tooltip = label;
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('aria-expanded', String(!this.navigationCollapsed));
        replaceReaderButtonIcon(toggle, this.navigationCollapsed ? 'navigation-open' : 'navigation-close', 18);
    }

    private setSourceLineNumbers(value: boolean, persist = true): void {
        this.sourceLineNumbersVisible = value;
        this.article.classList.toggle('shows-source-line-numbers', value);
        this.updateSourceLineNumberToggle();
        this.queueSourceLineNumberAlignment();
        if (!persist) return;
        try {
            localStorage.setItem(SOURCE_LINE_NUMBERS_STORAGE_KEY, String(value));
        } catch (_error) {
            // The in-memory view remains usable when browser storage is unavailable.
        }
    }

    private updateSourceLineNumberToggle(): void {
        const toggle = this.root.querySelector<HTMLButtonElement>('#reader-line-numbers');
        if (!toggle) return;
        const label = this.sourceLineNumbersVisible
            ? this.dictionary().hideSourceLineNumbers
            : this.dictionary().showSourceLineNumbers;
        toggle.dataset.readerTooltip = label;
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('aria-checked', String(this.sourceLineNumbersVisible));
        toggle.classList.toggle('is-active', this.sourceLineNumbersVisible);
    }

    private queueSourceLineNumberAlignment(): void {
        if (!this.sourceLineNumbersVisible) return;
        if (this.sourceLineNumberAlignmentFrame) cancelAnimationFrame(this.sourceLineNumberAlignmentFrame);
        this.sourceLineNumberAlignmentFrame = requestAnimationFrame(() => {
            this.sourceLineNumberAlignmentFrame = 0;
            const articleBounds = this.article.getBoundingClientRect();
            const articleStyles = getComputedStyle(this.article);
            const contentLeft = articleBounds.left + (Number.parseFloat(articleStyles.paddingLeft) || 0);
            this.article.querySelectorAll<HTMLElement>('.reader-source-line-entry').forEach(element => {
                const indent = Math.max(0, element.getBoundingClientRect().left - contentLeft);
                const elementLineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 0;
                const markerLineHeight = Number.parseFloat(getComputedStyle(element, '::before').lineHeight) || 0;
                const firstLineTop = Math.max(0, (elementLineHeight - markerLineHeight) / 2);
                element.style.setProperty('--reader-source-line-indent', indent.toFixed(2) + 'px');
                element.style.setProperty('--reader-source-line-top', firstLineTop.toFixed(2) + 'px');
            });
        });
    }

    private draftCollectionKey(collectionId: string): string {
        return (this.state?.projectId || this.state?.rootName || '') + ':' + collectionId;
    }

    private setDraftCollectionCollapsed(collectionId: string, value: boolean): void {
        const key = this.draftCollectionKey(collectionId);
        if (value) this.expandedDraftCollections.delete(key);
        else this.expandedDraftCollections.add(key);
        try {
            localStorage.setItem(DRAFT_COLLECTIONS_STORAGE_KEY, JSON.stringify([...this.expandedDraftCollections].sort()));
        } catch (_error) {
            // The in-memory setting still works in restricted browser contexts.
        }
        const filter = this.root.querySelector('#reader-page-filter') as HTMLInputElement | null;
        this.renderNavigation(filter?.value || '');
    }
    private pageForPath(filePath: string): ReaderPage | undefined {
        return this.state?.pages.find(page => page.filePath === filePath);
    }

    private defaultPagePath(): string {
        return this.state?.pages.find(page => page.documentMode !== 'draft')?.filePath || '';
    }

    private formalSelectedPagePaths(): string[] {
        return this.selectedPagePaths.filter(filePath => this.pageForPath(filePath)?.documentMode !== 'draft');
    }

    private setNavigationSelection(filePaths: string[], anchor = filePaths[0] || ''): void {
        const known = new Set(this.state?.pages.map(page => page.filePath) || []);
        this.selectedPagePaths = [...new Set(filePaths)].filter(filePath => known.has(filePath));
        this.selectionAnchorPath = this.selectedPagePaths.includes(anchor) ? anchor : (this.selectedPagePaths[0] || '');
        this.renderNavigation((this.root.querySelector('#reader-page-filter') as HTMLInputElement | null)?.value || '');
    }

    private selectNavigationPage(filePath: string, event: MouseEvent): void {
        if (!this.state || !this.pageForPath(filePath)) return;
        const additive = event.metaKey || event.ctrlKey;
        let next: string[];
        if (event.shiftKey && this.selectionAnchorPath && this.pageForPath(this.selectionAnchorPath)) {
            const paths = this.state.pages.map(page => page.filePath);
            const start = paths.indexOf(this.selectionAnchorPath);
            const end = paths.indexOf(filePath);
            const [from, to] = start <= end ? [start, end] : [end, start];
            const range = paths.slice(from, to + 1);
            next = [this.selectionAnchorPath, ...range.filter(path => path !== this.selectionAnchorPath)];
        } else if (additive) {
            next = this.selectedPagePaths.includes(filePath)
                ? this.selectedPagePaths.filter(path => path !== filePath)
                : [...this.selectedPagePaths, filePath];
            if (next.length === 0) next = [filePath];
            this.selectionAnchorPath = filePath;
        } else {
            next = [filePath];
            this.selectionAnchorPath = filePath;
        }
        this.setNavigationSelection(next, this.selectionAnchorPath || filePath);
        const primary = this.selectedPagePaths[0];
        if (primary && primary !== this.currentPath) void this.openPage(primary, 'push');
    }

    private closeNavigationContextMenu(): void {
        this.navigationContextMenuCleanup?.();
        this.navigationContextMenuCleanup = undefined;
        this.navigationContextMenu?.remove();
        this.navigationContextMenu = undefined;
    }

    private openNavigationContextMenuForPage(filePath: string, clientX: number, clientY: number): void {
        if (!this.selectedPagePaths.includes(filePath)) {
            this.selectionAnchorPath = filePath;
            this.setNavigationSelection([filePath], filePath);
            if (filePath !== this.currentPath) void this.openPage(filePath, 'push');
        }
        this.openNavigationContextMenu(clientX, clientY);
    }

    private openNavigationContextMenu(clientX: number, clientY: number): void {
        this.closeNavigationContextMenu();
        const filePaths = this.formalSelectedPagePaths();
        if (filePaths.length === 0) {
            this.reportLive(this.dictionary().documentStageBatchNoFormal);
            return;
        }
        const menu = document.createElement('section');
        menu.className = 'reader-nav-context-menu';
        menu.setAttribute('role', 'menu');
        readerAttribute(menu, 'aria-label', () => this.dictionary().documentStageBatch(filePaths.length));
        const title = document.createElement('div');
        title.className = 'reader-nav-context-menu-title';
        readerText(title, () => this.dictionary().documentStageSelection(filePaths.length));
        menu.append(title);
        const stageBranch = document.createElement('div');
        stageBranch.className = 'reader-nav-context-menu-branch';
        const stageTrigger = document.createElement('button');
        stageTrigger.type = 'button';
        stageTrigger.className = 'reader-nav-context-menu-trigger';
        stageTrigger.setAttribute('role', 'menuitem');
        stageTrigger.setAttribute('aria-haspopup', 'menu');
        stageTrigger.setAttribute('aria-expanded', 'false');
        const stageLabel = document.createElement('span');
        readerText(stageLabel, () => this.dictionary().documentStageMenu);
        stageTrigger.append(stageLabel, readerIcon('chevron-right', 13));
        const stageMenu = document.createElement('div');
        stageMenu.className = 'reader-nav-context-submenu';
        stageMenu.setAttribute('role', 'menu');
        const setStageMenuOpen = (open: boolean) => {
            menu.classList.toggle('is-stage-submenu-open', open);
            stageTrigger.setAttribute('aria-expanded', String(open));
        };
        stageTrigger.addEventListener('click', () => setStageMenuOpen(!menu.classList.contains('is-stage-submenu-open')));
        stageTrigger.addEventListener('mouseenter', () => setStageMenuOpen(true));
        stageTrigger.addEventListener('keydown', event => {
            if (event.key !== 'ArrowRight') return;
            event.preventDefault();
            setStageMenuOpen(true);
            stageMenu.querySelector<HTMLButtonElement>('button')?.focus();
        });
        stageBranch.addEventListener('mouseleave', () => setStageMenuOpen(false));
        DOCUMENT_STAGE_OPTIONS.forEach(({ stage }) => {
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'reader-nav-context-menu-item';
            action.setAttribute('role', 'menuitem');
            action.append(documentStageContent(stage, this.uiLanguage));
            action.addEventListener('click', () => void this.saveNavigationStages(filePaths, stage));
            stageMenu.append(action);
        });
        stageBranch.append(stageTrigger, stageMenu);
        menu.append(stageBranch);
        menu.style.left = clientX + 'px';
        menu.style.top = clientY + 'px';
        document.body.append(menu);
        window.requestAnimationFrame(() => {
            const bounds = menu.getBoundingClientRect();
            menu.style.left = Math.max(8, Math.min(clientX, window.innerWidth - bounds.width - 8)) + 'px';
            menu.style.top = Math.max(8, Math.min(clientY, window.innerHeight - bounds.height - 8)) + 'px';
        });
        const dismissPointer = (event: PointerEvent) => {
            if (!menu.contains(event.target as Node)) this.closeNavigationContextMenu();
        };
        const dismissKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') this.closeNavigationContextMenu();
        };
        document.addEventListener('pointerdown', dismissPointer, true);
        document.addEventListener('keydown', dismissKey);
        this.navigationContextMenu = menu;
        this.navigationContextMenuCleanup = () => {
            document.removeEventListener('pointerdown', dismissPointer, true);
            document.removeEventListener('keydown', dismissKey);
        };
    }

    private async saveNavigationStages(filePaths: string[], stage: 'draft' | 'revising' | 'stable'): Promise<void> {
        this.closeNavigationContextMenu();
        try {
            for (const filePath of filePaths) {
                await this.postJson('/api/document-state', { filePath, stage });
            }
            await this.refreshState();
            const primary = this.selectedPagePaths[0];
            if (primary) await this.openPage(primary, 'replace', '', true);
            this.reportLive(this.dictionary().documentStageBatchSaved(filePaths.length));
        } catch (error: any) {
            this.reportLive(error instanceof Error ? error.message : String(error));
        }
    }

    private installToolbarIcons(): void {
        const icons: Array<[string, ReaderIconName]> = [
            ['#reader-create-page', 'plus'],
            ['#reader-back', 'chevron-left'],
            ['#reader-forward', 'chevron-right'],
            ['[data-panel="contents"]', 'contents']
        ];
        icons.forEach(([selector, icon]) => {
            const button = this.root.querySelector<HTMLElement>(selector);
            if (button) replaceReaderButtonIcon(button, icon);
        });
        this.updateNavigationToggle();
    }

    private renderNavigation(query = ''): void {
        if (!this.state) return;
        const normalized = normalizeQuery(query);
        const groups: Array<{ key: string; name: string; pages: ReaderPage[] }> = [];
        this.state.pages.filter(page => (
            !normalized || normalizeQuery((page.displayHeading || page.title) + ' ' + page.filePath).includes(normalized)
        )).forEach(page => {
            const book = page.bookTitle || page.bookKey || this.state?.rootName || '';
            const groupName = page.documentMode === 'draft'
                ? (page.documentCollectionTitle || this.dictionary().documentStageDraft)
                : (page.volumeTitle ? book + ' · ' + page.volumeTitle : book);
            const key = page.documentMode === 'draft'
                ? JSON.stringify(['draft', page.documentCollectionId])
                : JSON.stringify(['formal', page.bookKey, page.volumeKey]);
            let group = groups[groups.length - 1];
            if (!group || group.key !== key) {
                group = { key, name: groupName, pages: [] };
                groups.push(group);
            }
            group.pages.push(page);
        });

        const navigation = this.root.querySelector('#reader-page-nav') as HTMLElement;
        navigation.replaceChildren();
        groups.forEach(({ pages, name: groupName }) => {
            const group = document.createElement('section');
            group.className = 'reader-nav-group';
            const heading = document.createElement('h2');
            const headingText = document.createElement('span');
            headingText.innerHTML = renderFormalInline(this.markdown, groupName, this.renderOptions('', {}));
            const isDraftCollection = pages[0]?.documentMode === 'draft';
            const integrated = pages.filter(page => pageIntegration(page).status === 'managed').length;
            const draftCollectionId = pages[0]?.documentCollectionId;
            const summaryText = () => isDraftCollection
                ? this.dictionary().draftCollectionSummary(pages.length)
                : this.dictionary().integrationGroupSummary(integrated, pages.length);
            const summary = document.createElement('span');
            summary.className = 'reader-nav-integration-summary';
            readerText(summary, summaryText);
            readerAttribute(summary, 'title', summaryText);
            const isCollapsed = Boolean(isDraftCollection && draftCollectionId && !normalized && !this.expandedDraftCollections.has(this.draftCollectionKey(draftCollectionId)));
            if (isDraftCollection && draftCollectionId) {
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'reader-nav-group-toggle' + (isCollapsed ? ' is-collapsed' : '');
                toggle.dataset.draftCollectionToggle = draftCollectionId;
                toggle.setAttribute('aria-expanded', String(!isCollapsed));
                readerAttribute(toggle, 'aria-label', () => isCollapsed ? this.dictionary().expandDraftCollection : this.dictionary().collapseDraftCollection);
                toggle.append(readerIcon(isCollapsed ? 'chevron-down' : 'chevron-up', 13));
                heading.append(headingText, summary, toggle);
            } else {
                heading.append(headingText, summary);
            }
            group.append(heading);
            if (isCollapsed) {
                navigation.append(group);
                return;
            }
            pages.forEach(page => {
                const button = document.createElement('button');
                button.type = 'button';
                const selectedIndex = this.selectedPagePaths.indexOf(page.filePath);
                button.className = 'reader-nav-page'
                    + (selectedIndex >= 0 ? ' is-selected' : '')
                    + (selectedIndex === 0 ? ' is-active' : '');
                button.dataset.pagePath = page.filePath;
                button.setAttribute('aria-selected', String(selectedIndex >= 0));
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.selectNavigationPage(page.filePath, event);
                });
                button.addEventListener('contextmenu', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.openNavigationContextMenuForPage(page.filePath, event.clientX, event.clientY);
                });
                const title = page.displayHeading || page.title;
                const label = document.createElement('span');
                label.className = 'reader-nav-page-label';
                label.innerHTML = renderFormalInline(this.markdown, title, this.renderOptions(page.filePath, {}));
                button.append(label);
                const status = documentStatusBadge(page, this.uiLanguage);
                if (status) button.append(status);
                button.append(pageIntegrationGlyph(page, this.uiLanguage));
                readerAttribute(button, 'aria-label', () => [title,
                    status && words[this.uiLanguage].documentStage + (this.uiLanguage === 'en' ? ': ' : '：') + documentStatusText(page, this.uiLanguage),
                    pageIntegrationTooltip(page, this.uiLanguage)].filter(Boolean).join(' — '));
                group.append(button);
            });
            navigation.append(group);
        });
    }

    private async openPage(
        filePath: string,
        historyMode: 'push' | 'replace' | 'pop',
        anchor = '',
        preserveScroll = false,
        sourceLocation?: ReaderSourceLocation
    ): Promise<void> {
        if (!this.state || !this.state.pages.some(page => page.filePath === filePath)) return;
        if (!this.selectedPagePaths.includes(filePath)) {
            this.selectedPagePaths = [filePath];
            this.selectionAnchorPath = filePath;
        }
        const effectiveHistoryMode = this.symbolAuditReportOpen && historyMode === 'push' && filePath === this.currentPath
            ? 'replace'
            : historyMode;
        const requestId = ++this.pageRequestId;
        this.formulaLayout?.invalidate();
        this.clearSourceLocationHighlight?.();
        this.leanReview.navigationStarted(filePath);
        this.createPage?.navigationStarted();
        this.toolbarMenu.close();
        this.toolbarPanel.close();
        this.symbolAuditReportOpen = false;
        this.article.classList.remove('is-symbol-audit-report');
        const previousScroll = this.main.scrollTop;
        this.article.classList.add('is-loading');
        try {
            const page = await this.fetchJson<ReaderPagePayload>('/api/page?path=' + encodeURIComponent(filePath));
            if (requestId !== this.pageRequestId) return;
            this.page = page;
            this.currentPath = filePath;
            this.updateHistory(filePath, effectiveHistoryMode, sourceLocation);
            this.renderNavigation((this.root.querySelector('#reader-page-filter') as HTMLInputElement).value);
            this.renderArticle();
            this.updateDraftToolbarAvailability();
            if (anchor) {
                window.requestAnimationFrame(() => this.scrollToAnchor(anchor));
            } else if (sourceLocation) {
                window.requestAnimationFrame(() => {
                    if (requestId === this.pageRequestId) this.scrollToSourceLocation(sourceLocation);
                });
            } else {
                this.main.scrollTop = preserveScroll ? previousScroll : 0;
            }
            readerViewStateChanged();
        } finally {
            if (requestId === this.pageRequestId) this.article.classList.remove('is-loading');
        }
    }

    private updateHistory(filePath: string, mode: 'push' | 'replace' | 'pop', sourceLocation?: ReaderSourceLocation): void {
        const query = new URLSearchParams({ path: filePath });
        if (sourceLocation) {
            query.set('line', String(sourceLocation.line));
            if (sourceLocation.column) query.set('column', String(sourceLocation.column));
        }
        const url = `?${query.toString()}`;
        if (mode === 'push' && this.historyPaths[this.historyIndex] !== filePath) {
            this.historyPaths = this.historyPaths.slice(0, this.historyIndex + 1);
            this.historyPaths.push(filePath);
            this.historyIndex = this.historyPaths.length - 1;
            readerHistory('push', { filePath }, url);
        } else if (mode === 'replace') {
            if (this.historyIndex < 0) {
                this.historyPaths = [filePath];
                this.historyIndex = 0;
            } else {
                this.historyPaths[this.historyIndex] = filePath;
            }
            readerHistory('replace', { filePath }, url);
        }
        (this.root.querySelector('#reader-back') as HTMLButtonElement).disabled = this.historyIndex <= 0;
        (this.root.querySelector('#reader-forward') as HTMLButtonElement).disabled = this.historyIndex >= this.historyPaths.length - 1;
    }

    private renderArticle(): void {
        if (!this.page || !this.state) return;
        const restoreTitleFocus = this.titleNavigationHasFocus();
        if (this.toolbarPanel?.isActive('chapters')) this.toolbarPanel.close();
        this.clearSourceLocationHighlight?.();
        const title = this.page.page?.displayHeading || this.page.page?.title || this.page.filePath;
        const titleLabel = document.createElement('span');
        titleLabel.className = 'reader-page-title-label';
        titleLabel.innerHTML = renderFormalInline(this.markdown, title, this.renderOptions(this.page.filePath, this.page.labels));
        const documentStatus = documentStatusBadge(this.page.page, this.uiLanguage, true);
        const navigation = this.titleNavigationScope();
        let titleTrigger: HTMLButtonElement | undefined;
        if (navigation) {
            this.unwrapNavigationTitleLinks(titleLabel);
            titleTrigger = document.createElement('button');
            titleTrigger.type = 'button';
            titleTrigger.className = 'reader-page-title-trigger';
            titleTrigger.dataset.titleNavigation = 'true';
            const describe = () => title + ' — ' + (this.titleNavigationScope()?.title || navigation.title);
            readerAttribute(titleTrigger, 'data-reader-tooltip', describe);
            readerAttribute(titleTrigger, 'aria-label', describe);
            titleTrigger.setAttribute('aria-haspopup', 'dialog');
            titleTrigger.setAttribute('aria-controls', 'reader-chapter-navigation');
            titleTrigger.setAttribute('aria-expanded', 'false');
            titleTrigger.append(titleLabel, readerIcon('chevron-down', 12));
        }
        const titleParts: Node[] = [titleTrigger || titleLabel];
        if (documentStatus) titleParts.push(documentStatus);
        titleParts.push(pageIntegrationGlyph(this.page.page, this.uiLanguage));
        this.pageTitle.replaceChildren(...titleParts);
        if (restoreTitleFocus) (titleTrigger || this.pageTitle.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
        const descriptor = this.page.page?.documentMode === 'draft'
            ? (this.page.page?.documentCollectionTitle || 'Draft collection')
            : pageIntegrationTooltip(this.page.page, this.uiLanguage);
        readerAttribute(this.pageTitle, 'aria-label', () => title + ' — ' + (this.page?.page?.documentMode === 'draft'
            ? (this.page.page.documentCollectionTitle || 'Draft collection') : pageIntegrationTooltip(this.page?.page, this.uiLanguage)));
        document.title = title + ' — Math Workspace';
        const rendered = renderFormalDocument(this.markdown, this.page.content, {
            currentFilePath: this.page.filePath,
            labels: this.page.labels,
            pages: this.state.pages,
            language: this.state.language,
            dependencyMarkers: this.page.dependencyMarkers
        });
        this.page.formulas = rendered.formulas;
        this.disposeFigures();
        this.disposeAssets();
        this.formulaLayout?.dispose();
        this.article.lang = this.state.language;
        this.article.innerHTML = rendered.html;
        bindFormalInterfaceLabels(this.article, this.page.dependencyMarkers || {}, () => this.uiLanguage);
        this.disposeFigures = mountReaderFigures(this.article, () => this.uiLanguage);
        this.disposeAssets = mountReaderAssets(this.article);
        this.mountArticleFormulaLayout();
        this.article.querySelectorAll<HTMLElement>('[data-source-start-line]').forEach(element => {
            if (!element.parentElement?.closest('[data-source-start-line]')) element.classList.add('reader-source-line-entry');
        });
        this.queueSourceLineNumberAlignment();
        this.article.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading, index) => {
            if (!heading.id) heading.id = 'reader-heading-' + index;
        });
        this.sourceActions.bind(this.article, {
            filePath: this.page.filePath,
            source: this.page.content,
            formulas: rendered.formulas
        });
        this.recallPopover.bind(this.article);
        this.dependencyPopover.bind(this.article);
        this.leanPopover.bind(this.article);
        this.leanReview.contextChanged();
    }

    private mountArticleFormulaLayout(): void {
        const page = this.page, state = this.state;
        if (!page || !state) return;
        this.formulaLayout?.dispose();
        const projectId = state.projectId, token = state.requestToken;
        const current = () => this.page === page && this.state?.projectId === projectId && this.state?.requestToken === token;
        this.formulaLayout = mountReaderFormulaLayout(this.article, this.uiLanguage, {
            formulas: page.formulas || [],
            request: (route, options) => {
                if (!current()) return Promise.reject(new Error('The formula page has changed.'));
                const headers = new Headers(options?.headers);
                if (token) headers.set('x-math-workspace-token', token);
                if (projectId) headers.set('x-math-workspace-project', projectId);
                return readerFetch(route, { ...options, cache: 'no-store', headers });
            },
            report: message => { if (current()) this.reportLive(message); }
        });
    }

    private openDependencyTarget(filePath: string, id: string): void {
        const anchor = 'formal-' + id;
        if (filePath === this.currentPath) {
            this.scrollToAnchor(anchor);
            return;
        }
        void this.openPage(filePath, 'push', anchor);
    }

    private scrollToAnchor(anchor: string): void {
        const id = anchor.replace(/^#/, '');
        const target = this.article.querySelector('#' + CSS.escape(id));
        revealExerciseTarget(target);
        target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    private scrollToSourceLocation(location: ReaderSourceLocation): void {
        this.clearSourceLocationHighlight?.();
        const candidates = Array.from(this.article.querySelectorAll<HTMLElement>('[data-source-line], [data-source-start-line]'));
        const exact = this.article.querySelector<HTMLElement>(`[data-source-line="${location.line}"]`);
        const containing = candidates.find(element => {
            const start = Number(element.dataset.sourceStartLine || element.dataset.sourceLine);
            const end = Number(element.dataset.sourceEndLine || element.dataset.sourceLine);
            return Number.isFinite(start) && Number.isFinite(end) && start <= location.line && location.line <= end;
        });
        const nearest = candidates
            .map(element => ({ element, line: Number(element.dataset.sourceLine || element.dataset.sourceStartLine) }))
            .filter(item => Number.isFinite(item.line))
            .sort((left, right) => Math.abs(left.line - location.line) - Math.abs(right.line - location.line))[0]?.element;
        const target = exact || containing || nearest;
        if (!target) return;
        revealExerciseTarget(target);
        target.classList.add('is-source-location-target');
        let timer: number | undefined;
        const clearHighlight = () => {
            window.clearTimeout(timer);
            target.classList.remove('is-source-location-target');
            this.main.removeEventListener('scroll', keepHighlight);
            this.clearSourceLocationHighlight = undefined;
        };
        const keepHighlight = () => {
            window.clearTimeout(timer);
            // Leave time to recognize the target after a long smooth scroll has settled.
            timer = window.setTimeout(clearHighlight, 1800);
        };
        this.clearSourceLocationHighlight = clearHighlight;
        this.main.addEventListener('scroll', keepHighlight, { passive: true });
        keepHighlight();
        target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }

    private navigateHistory(direction: -1 | 1): void {
        if (this.symbolAuditReportOpen && direction === -1) {
            this.closeSymbolAuditReport();
            return;
        }
        const index = this.historyIndex + direction;
        if (index < 0 || index >= this.historyPaths.length) return;
        this.historyIndex = index;
        const path = this.historyPaths[index];
        readerHistory('replace', { filePath: path }, '?path=' + encodeURIComponent(path));
        void this.openPage(path, 'pop');
    }

    private openPanel(view: string, trigger: HTMLElement): void {
        if (!this.state) return;
        if (this.page?.page.documentMode === 'draft'
            && ['definitions', 'symbols', 'propositions', 'symbol-audit'].includes(view)) return;
        this.prepareToolbarView('panel');
        const dictionary = this.dictionary();
        const titleKey = view === 'symbol-audit' ? 'symbolAudit' : view;
        const candidate = dictionary[titleKey as keyof typeof dictionary];
        const title = typeof candidate === 'string' ? candidate : view;
        this.toolbarPanel.open(view, trigger, () => { const label = this.dictionary()[titleKey as keyof ReturnType<ReaderApplication['dictionary']>]; return typeof label === 'string' ? label : view; }, content => {
            if (view === 'contents') this.renderContents(content);
            if (view === 'definitions') this.renderDefinitions(content);
            if (view === 'symbols') this.renderSymbols(content);
            if (view === 'propositions') this.propositionReview.render(content, this.currentPropositionReviewItems());
            if (view === 'symbol-audit') this.renderSymbolAudit(content);
        }, this.toolbarMenu.anchorFor(trigger));
    }

    private titleNavigationScope(): { title: string; pages: ReaderPage[] } | undefined {
        if (!this.state || !this.page || this.symbolAuditReportOpen) return;
        const current = this.pageForPath(this.page.filePath);
        if (!current) return;
        const dictionary = this.dictionary();
        if (current.documentMode === 'draft') {
            if (typeof current.documentCollectionId !== 'string') return;
            return {
                title: dictionary.collectionPages,
                pages: this.state.pages.filter(page => page.documentMode === 'draft'
                    && page.documentCollectionId === current.documentCollectionId)
            };
        }
        if (typeof current.bookKey !== 'string') return;
        return {
            title: typeof current.volumeKey === 'string' ? dictionary.volumeChapters : dictionary.bookChapters,
            pages: this.state.pages.filter(page => page.documentMode !== 'draft'
                && page.bookKey === current.bookKey && page.volumeKey === current.volumeKey)
        };
    }

    private titleNavigationHasFocus(): boolean {
        return this.pageTitle.contains(document.activeElement)
            || Boolean(document.body.querySelector('#reader-chapter-navigation')?.contains(document.activeElement));
    }

    private unwrapNavigationTitleLinks(container: HTMLElement): void {
        container.querySelectorAll('a').forEach(link => link.replaceWith(...Array.from(link.childNodes)));
    }

    private openTitleNavigation(trigger: HTMLElement): void {
        const navigation = this.titleNavigationScope();
        if (!navigation) return;
        this.prepareToolbarView('panel');
        const content = this.toolbarPanel.open('chapters', trigger, () => this.titleNavigationScope()?.title || navigation.title, container => {
            const list = document.createElement('nav');
            list.className = 'reader-chapter-list';
            readerAttribute(list, 'aria-label', () => this.titleNavigationScope()?.title || navigation.title);
            navigation.pages.forEach(page => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'reader-chapter-entry';
                button.dataset.chapterPath = page.filePath;
                const title = page.displayHeading || page.title;
                button.innerHTML = renderFormalInline(this.markdown, title, this.renderOptions(page.filePath, {}));
                this.unwrapNavigationTitleLinks(button);
                button.setAttribute('aria-label', title);
                if (page.filePath === this.page?.filePath) button.setAttribute('aria-current', 'page');
                button.addEventListener('click', () => {
                    this.toolbarPanel.close();
                    const projectId = this.state?.projectId;
                    const opened = this.openPage(page.filePath, 'push');
                    const requestId = this.pageRequestId;
                    void opened.then(() => {
                        const focused = document.activeElement;
                        const restoreTitleFocus = !focused || focused === document.body || !focused.isConnected || this.pageTitle.contains(focused);
                        if (restoreTitleFocus && requestId === this.pageRequestId && projectId === this.state?.projectId
                            && this.currentPath === page.filePath && !this.symbolAuditReportOpen) {
                            this.pageTitle.querySelector<HTMLElement>('[data-title-navigation]')?.focus({ preventScroll: true });
                        }
                    }).catch(error => this.reportLive(error instanceof Error ? error.message : String(error)));
                });
                list.append(button);
            });
            list.addEventListener('keydown', event => {
                const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('button'));
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
                    : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length
                    : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
                if (next < 0) return;
                event.preventDefault();
                buttons[next]?.focus();
            });
            container.append(list);
        });
        if (content) {
            content.parentElement!.id = 'reader-chapter-navigation';
            const current = content.querySelector<HTMLElement>('[aria-current="page"]') || content.querySelector<HTMLElement>('.reader-chapter-entry');
            current?.focus({ preventScroll: true });
            current?.scrollIntoView({ block: 'nearest' });
        }
    }

    private prepareToolbarView(view: 'menu' | 'panel' | 'lean' | 'archive' | 'publication' | 'create-page'): void {
        if (view !== 'menu') this.toolbarMenu?.close();
        if (view !== 'panel') this.toolbarPanel?.close();
        if (view !== 'lean') this.leanReview?.close(false);
        if (view !== 'archive') this.archive?.close();
        if (view !== 'publication') this.publication?.close();
        if (view !== 'create-page') this.createPage?.close(false);
    }

    private openDocumentStage(trigger: HTMLElement): void {
        const page = this.page?.page;
        if (!page || !this.state) return;
        if (page.documentMode === 'draft') return;
        this.prepareToolbarView('panel');
        const dictionary = this.dictionary();
        this.toolbarPanel.open('document-stage', trigger, () => this.dictionary().documentStage, content => {
            const summary = document.createElement('p');
            summary.className = 'reader-document-stage-summary';
            readerText(summary, () => documentStatusText(page, this.uiLanguage));
            const stages = document.createElement('div');
            stages.className = 'reader-document-stage-actions';
            DOCUMENT_STAGE_OPTIONS.forEach(({ stage }) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'reader-symbol-audit-button';
                button.append(documentStageContent(stage, this.uiLanguage));
                button.addEventListener('click', () => void this.saveDocumentStage({ stage }));
                stages.append(button);
            });
            const checkpoint = document.createElement('div');
            checkpoint.className = 'reader-document-stage-checkpoint';
            const input = document.createElement('input');
            input.className = 'reader-panel-search';
            readerAttribute(input, 'placeholder', () => this.dictionary().documentStageMilestoneHint);
            input.value = page.lifecycle?.checkpoint?.label || '';
            const record = document.createElement('button');
            record.type = 'button';
            record.className = 'reader-symbol-audit-button';
            readerText(record, () => this.dictionary().documentStageRecord);
            record.addEventListener('click', () => void this.saveDocumentStage({ checkpointLabel: input.value }));
            checkpoint.append(input, record);
            content.append(summary, stages, checkpoint);
            if (page.lifecycle?.checkpoint) {
                const clear = document.createElement('button');
                clear.type = 'button';
                clear.className = 'reader-document-stage-clear';
                readerText(clear, () => this.dictionary().documentStageClear);
                clear.addEventListener('click', () => void this.saveDocumentStage({ clearCheckpoint: true }));
                content.append(clear);
            }
        });
    }

    private async saveDocumentStage(update: { stage?: 'draft' | 'revising' | 'stable'; checkpointLabel?: string; clearCheckpoint?: boolean }): Promise<void> {
        if (!this.page) return;
        const filePath = this.page.filePath;
        try {
            await this.postJson('/api/document-state', { filePath, ...update });
            this.toolbarPanel.close();
            await this.refreshState();
            await this.openPage(filePath, 'replace', '', true);
            this.reportLive(this.dictionary().documentStageSaved);
        } catch (error: any) {
            this.reportLive(error instanceof Error ? error.message : String(error));
        }
    }

    private reportLive(message: string): void {
        this.liveStatus.textContent = message;
        window.setTimeout(() => {
            if (this.liveStatus.textContent === message) this.liveStatus.textContent = '';
        }, 2200);
    }

    private currentPropositionReviewItems(): ReaderPropositionReviewItem[] {
        if (!this.page) return [];
        return Object.entries(this.page.dependencyMarkers || {})
            .filter(([, marker]) => marker.kind === 'theorem-like')
            .map(([id, marker]) => {
                const label = this.page?.labels[id];
                return {
                    id,
                    display: label?.display || id,
                    compactDisplay: compactPropositionDisplay(label?.display || id),
                    title: label?.title || '',
                    marker
                };
            });
    }

    private openCurrentProposition(id: string): void {
        const target = this.article.querySelector<HTMLElement>('#formal-' + id);
        if (!target) return;
        this.toolbarPanel.close();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('is-proposition-highlighted');
        window.setTimeout(() => target.classList.remove('is-proposition-highlighted'), 1800);
    }

    private renderContents(container: HTMLElement): void {
        // One selector keeps headings, definitions and formal objects in source order without duplicates.
        const targets = Array.from(this.article.querySelectorAll<HTMLElement>(
            'h1, h2, h3, h4, h5, h6, [id^="formal-"], [data-reader-definition]'
        ));
        const list = document.createElement('div');
        list.className = 'reader-panel-list reader-outline-list';
        let headingLevel = 1;
        targets.forEach(target => {
            const isHeading = /^H[1-6]$/.test(target.tagName);
            const label = this.page?.labels[target.id.slice('formal-'.length)];
            const definitionTitle = target.dataset.readerDefinition;
            if (!isHeading && !label && !definitionTitle) return;
            if (isHeading) headingLevel = Number(target.tagName.slice(1));
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'reader-outline level-' + (isHeading ? headingLevel : Math.min(headingLevel + 1, 6));
            if (isHeading) {
                const title = target.cloneNode(true) as HTMLElement;
                title.querySelectorAll('button').forEach(element => element.remove());
                title.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
                title.querySelectorAll('a').forEach(element => element.replaceWith(...Array.from(element.childNodes)));
                button.innerHTML = title.innerHTML;
            } else if (definitionTitle) {
                button.innerHTML = renderFormalInline(this.markdown,
                    definitionTitle, this.renderOptions(this.currentPath));
            } else {
                const title = label!.title
                    ? (this.state.language === 'en' ? ` (${label!.title})` : `（${label!.title}）`)
                    : '';
                button.innerHTML = renderFormalInline(this.markdown,
                    (label!.display || '') + title, this.renderOptions(this.currentPath));
            }
            button.addEventListener('click', () => {
                revealExerciseTarget(target);
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                this.toolbarPanel.close();
            });
            list.append(button);
        });
        container.append(list.childElementCount ? list : readerLabel(this.emptyState(this.dictionary().noContents), () => this.dictionary().noContents));
    }

    private renderDefinitions(container: HTMLElement): void {
        container.replaceChildren();
        let scope: 'chapter' | 'all' = 'chapter';
        const controls = document.createElement('div');
        controls.className = 'reader-definition-controls';
        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'reader-panel-search';
        readerAttribute(search, 'placeholder', () => this.dictionary().searchDefinitions);
        const scopeButton = document.createElement('button');
        scopeButton.type = 'button';
        scopeButton.className = 'reader-definition-scope';
        const results = document.createElement('div');
        results.className = 'reader-panel-list';
        const renderResults = () => {
            results.replaceChildren();
            readerText(scopeButton, () => scope === 'chapter'
                ? this.dictionary().searchAllDefinitions
                : this.dictionary().showChapterDefinitions);
            scopeButton.classList.toggle('is-active', scope === 'all');
            const matches = this.findDefinitions(search.value, 80, scope === 'chapter' ? this.chapterDefinitions() : undefined);
            if (matches.length === 0) {
                results.append(readerLabel(this.emptyState(scope === 'chapter' && !search.value.trim()
                    ? this.dictionary().noChapterDefinitions
                    : this.dictionary().noDefinitions), () => scope === 'chapter' && !search.value.trim()
                    ? this.dictionary().noChapterDefinitions
                    : this.dictionary().noDefinitions));
                return;
            }
            matches.forEach(definition => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'reader-definition-entry';
                const title = document.createElement('strong');
                title.textContent = definition.title;
                button.append(title);
                button.addEventListener('click', () => void this.showDefinition(container, definition.index));
                results.append(button);
            });
            this.toolbarPanel.reposition();
        };
        search.addEventListener('input', renderResults);
        scopeButton.addEventListener('click', () => {
            scope = scope === 'chapter' ? 'all' : 'chapter';
            renderResults();
            search.focus();
        });
        controls.append(search, scopeButton);
        container.append(controls, results);
        renderResults();
        window.requestAnimationFrame(() => search.focus());
    }

    private async showDefinition(container: HTMLElement, index: number): Promise<void> {
        const definition = await this.fetchJson<any>('/api/definition?index=' + index);
        if (!container.isConnected) return;
        container.replaceChildren();
        const header = document.createElement('div');
        header.className = 'reader-detail-header';
        const title = document.createElement('strong');
        title.className = 'reader-detail-title';
        title.textContent = definition.title;
        const actions = document.createElement('div');
        actions.className = 'reader-detail-actions';
        actions.append(
            readerLabel(this.panelIconButton('arrow-left', this.dictionary().definitions, () => this.renderDefinitions(container)), () => this.dictionary().definitions),
            readerLabel(this.panelIconButton('locate', this.dictionary().jump, () => {
                this.toolbarPanel.close();
                this.locateDefinition(definition);
            }), () => this.dictionary().jump)
        );
        const content = document.createElement('div');
        content.className = 'reader-panel-prose';
        content.innerHTML = this.renderDefinitionContent(definition);
        header.append(title, actions);
        container.append(header, content);
        this.toolbarPanel.reposition();
    }

    private chapterDefinitions(): DefinitionSummary[] {
        if (!this.state || !this.page) return [];
        const source = normalizeQuery(this.page.content);
        if (!source) return [];
        return this.state.definitions.filter(definition => (
            [definition.title, ...(definition.aliases || [])].some(name => {
                const normalized = normalizeQuery(name);
                if (!normalized) return false;
                if (/^[a-z0-9 _-]+$/i.test(normalized)) {
                    return new RegExp('(^|[^a-z0-9_])' + normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z0-9_])', 'i').test(source);
                }
                return source.includes(normalized);
            })
        ));
    }

    private findDefinitions(query: string, limit = Number.POSITIVE_INFINITY, candidates = this.state?.definitions || []): DefinitionSummary[] {
        if (!this.state) return [];
        const normalized = normalizeQuery(query);
        const matches = candidates.filter(definition => (
            !normalized || [definition.title, ...(definition.aliases || [])].map(normalizeQuery).some(value => value.includes(normalized))
        ));
        if (!normalized) return matches.slice(0, limit);
        return matches.sort((left, right) => {
            const leftNames = [left.title, ...(left.aliases || [])].map(normalizeQuery);
            const rightNames = [right.title, ...(right.aliases || [])].map(normalizeQuery);
            const leftExact = leftNames.includes(normalized) ? 0 : 1;
            const rightExact = rightNames.includes(normalized) ? 0 : 1;
            if (leftExact !== rightExact) return leftExact - rightExact;
            const leftLength = Math.min(...leftNames.filter(name => name.includes(normalized)).map(name => name.length));
            const rightLength = Math.min(...rightNames.filter(name => name.includes(normalized)).map(name => name.length));
            return leftLength - rightLength || left.title.localeCompare(right.title);
        }).slice(0, limit);
    }

    private renderDefinitionContent(definition: any): string {
        return renderFormalMarkdown(this.markdown, definition.content || '', this.renderOptions(definition.filePath, definition.labels || {}));
    }

    private locateDefinition(definition: ReaderDefinitionMatch): void {
        void this.openPage(definition.filePath, 'push', '', false, { line: definition.line });
    }

    private renderSymbols(container: HTMLElement): void {
        const symbols = this.page?.symbols || [];
        if (symbols.length === 0) {
            container.append(readerLabel(this.emptyState(this.dictionary().noSymbols), () => this.dictionary().noSymbols));
            return;
        }
        const grid = document.createElement('div');
        grid.className = 'reader-symbol-grid';
        const detail = document.createElement('section');
        detail.className = 'reader-symbol-detail';
        const show = (symbol: ReaderPagePayload['symbols'][number]) => {
            detail.replaceChildren();
            const display = document.createElement('div');
            display.className = 'reader-symbol-display';
            display.innerHTML = renderFormalInline(this.markdown, symbol.display, this.renderOptions(this.currentPath));
            const meaning = document.createElement('div');
            meaning.className = 'reader-panel-prose';
            meaning.innerHTML = renderFormalMarkdown(this.markdown, symbol.meaning, this.renderOptions(this.currentPath));
            detail.append(display, meaning);
            if (symbol.sourceFilePath && symbol.sourceLine) {
                detail.append(readerLabel(this.panelIconButton('locate', this.dictionary().jump, () => {
                    this.toolbarPanel.close();
                    void this.openPage(symbol.sourceFilePath as string, 'push', '', false, { line: symbol.sourceLine as number });
                }), () => this.dictionary().jump));
            }
            this.toolbarPanel.reposition();
        };
        symbols.forEach(symbol => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'reader-symbol-chip';
            button.innerHTML = renderFormalInline(this.markdown, symbol.display, this.renderOptions(this.currentPath));
            button.addEventListener('click', () => show(symbol));
            grid.append(button);
        });
        container.append(grid, detail);
        show(symbols[0]);
    }

    private renderSymbolAudit(container: HTMLElement): void {
        this.symbolAudit.render(container, {
            labels: () => {
                const dictionary = this.dictionary();
                return {
                    intro: dictionary.symbolAuditIntro,
                    cache: dictionary.symbolAuditCache,
                    configuredModel: dictionary.symbolAuditConfiguredModel,
                    configuredEffort: dictionary.symbolAuditConfiguredEffort,
                    codexDefault: dictionary.symbolAuditCodexDefault,
                    model: dictionary.symbolAuditModel,
                    effort: dictionary.symbolAuditEffort,
                    scope: dictionary.symbolAuditScope,
                    scopeAll: dictionary.symbolAuditScopeAll,
                    scopeVolume: dictionary.symbolAuditScopeVolume,
                    scopeChapters: dictionary.symbolAuditScopeChapters,
                    scopeVolumePicker: dictionary.symbolAuditScopeVolumePicker,
                    scopePages: dictionary.symbolAuditScopePages,
                    scopeSummary: dictionary.symbolAuditScopeSummary,
                    scopeRequired: dictionary.symbolAuditScopeRequired,
                    savingSettings: dictionary.symbolAuditSavingSettings,
                    creatingJob: dictionary.symbolAuditCreatingJob,
                    cancellingJob: dictionary.symbolAuditCancellingJob,
                    activity: dictionary.symbolAuditActivity,
                    elapsed: dictionary.symbolAuditElapsed,
                    tokenUsage: dictionary.symbolAuditTokenUsage,
                    saveSettings: dictionary.symbolAuditSaveSettings,
                    start: dictionary.symbolAuditStart,
                    force: dictionary.symbolAuditForce,
                    cancel: dictionary.symbolAuditCancel,
                    running: dictionary.symbolAuditRunning,
                    complete: dictionary.symbolAuditComplete,
                    failed: dictionary.symbolAuditFailed,
                    cancelled: dictionary.symbolAuditCancelled,
                    reportCurrent: dictionary.symbolAuditReportCurrent,
                    reportStale: dictionary.symbolAuditReportStale,
                    noReport: dictionary.symbolAuditNoReport,
                    hardConflicts: dictionary.symbolAuditHardConflicts,
                    legacyCandidates: dictionary.symbolAuditLegacyCandidates,
                    possibleConfusion: dictionary.symbolAuditPossibleConfusion,
                    noHardConflicts: dictionary.symbolAuditNoHardConflicts,
                    noAdvisories: dictionary.symbolAuditNoAdvisories,
                    openReport: dictionary.symbolAuditOpenReport,
                    locate: dictionary.symbolAuditLocate,
                    loading: dictionary.symbolAuditLoading,
                    modelLoadFailed: dictionary.symbolAuditModelLoadFailed,
                    actionFailed: dictionary.symbolAuditActionFailed
                };
            },
            getStatus: () => this.fetchJson<ReaderSymbolAuditStatus>('/api/symbol-audit'),
            loadModels: async () => {
                const response = await this.fetchJson<{ models: ReaderSymbolAuditModel[] }>('/api/symbol-audit/models');
                return response.models || [];
            },
            saveSettings: async settings => {
                const response = await this.postJson<{ status: ReaderSymbolAuditStatus }>('/api/symbol-audit', { action: 'settings', settings });
                return response.status;
            },
            start: async force => {
                const response = await this.postJson<{ status: ReaderSymbolAuditStatus }>('/api/symbol-audit', { action: 'run', force });
                return response.status;
            },
            cancel: async () => {
                const response = await this.postJson<{ status: ReaderSymbolAuditStatus }>('/api/symbol-audit', { action: 'cancel' });
                return response.status;
            },
            openReport: () => void this.openSymbolAuditReport('push'),
            locate: (filePath, line) => {
                this.toolbarPanel.close();
                void this.openPage(filePath, 'push', '', false, { line });
            },
            currentFilePath: () => this.page?.filePath,
            changed: () => this.toolbarPanel.reposition()
        });
    }

    private async openSymbolAuditReport(historyMode: 'push' | 'replace' | 'pop' = 'push'): Promise<void> {
        this.formulaLayout?.invalidate();
        this.leanReview.close(false);
        if (!this.state?.available || !this.currentPath) return;
        const requestId = ++this.pageRequestId, page = this.page, projectId = this.state.projectId;
        this.article.classList.remove('is-loading');
        const status = await this.fetchJson<ReaderSymbolAuditStatus>('/api/symbol-audit');
        if (requestId !== this.pageRequestId || page !== this.page || projectId !== this.state?.projectId) return;
        if (!status.report) return;
        this.formulaLayout?.dispose();
        this.toolbarPanel.close();
        this.symbolAudit.dispose();
        this.symbolAuditReportOpen = true;
        this.article.lang = this.uiLanguage;
        this.article.classList.add('is-symbol-audit-report');
        const title = this.dictionary().symbolAuditOpenReport;
        const titleLabel = document.createElement('span');
        titleLabel.className = 'reader-page-title-label';
        readerText(titleLabel, () => this.dictionary().symbolAuditOpenReport);
        this.pageTitle.replaceChildren(titleLabel);
        readerAttribute(this.pageTitle, 'aria-label', () => this.dictionary().symbolAuditOpenReport);
        document.title = title + ' — Math Workspace';
        if (historyMode !== 'pop') {
            const url = '?path=' + encodeURIComponent(this.currentPath) + '&view=symbol-audit-report';
            const state = { filePath: this.currentPath, view: 'symbol-audit-report' };
            if (historyMode === 'push') readerHistory('push', state, url);
            else readerHistory('replace', state, url);
        }
        this.symbolAuditReport.render(this.article, status, {
            language: this.uiLanguage,
            uiLanguage: () => this.uiLanguage,
            sourceTitle: filePath => {
                const page = this.state?.pages.find(candidate => candidate.filePath === filePath);
                return page?.displayHeading || page?.title || filePath.split('/').pop() || filePath;
            },
            locate: (filePath, line) => {
                void this.openPage(filePath, 'push', '', false, { line });
            },
            close: () => this.closeSymbolAuditReport()
        });
        this.main.scrollTop = 0;
    }

    private closeSymbolAuditReport(): void {
        if (!this.page) return;
        this.symbolAuditReportOpen = false;
        readerHistory('replace', { filePath: this.currentPath }, '?path=' + encodeURIComponent(this.currentPath));
        this.article.classList.remove('is-symbol-audit-report');
        this.renderArticle();
        this.renderNavigation((this.root.querySelector('#reader-page-filter') as HTMLInputElement).value);
        this.main.scrollTop = 0;
    }

    private emptyState(value: string): HTMLElement {
        const element = document.createElement('p');
        element.className = 'reader-panel-empty';
        element.textContent = value;
        return element;
    }

    private panelIconButton(icon: ReaderIconName, label: string, action: (button: HTMLButtonElement) => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reader-panel-action';
        button.append(readerIcon(icon));
        button.dataset.tooltip = label;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', () => action(button));
        return button;
    }

    private renderOptions(currentFilePath: string, labels = this.page?.labels || {}) {
        return {
            currentFilePath,
            labels,
            pages: this.state?.pages || [],
            language: this.state?.language || 'zh'
        } as const;
    }

    private installHandlers(): void {
        this.root.addEventListener('click', event => {
            const target = event.target as HTMLElement | null;
            if (!target) return;
            const projectPicker = target.closest<HTMLElement>('[data-project-picker]');
            const draftCollectionToggle = target.closest<HTMLElement>('[data-draft-collection-toggle]');
            if (draftCollectionToggle?.dataset.draftCollectionToggle) {
                const collectionId = draftCollectionToggle.dataset.draftCollectionToggle;
                this.setDraftCollectionCollapsed(collectionId, draftCollectionToggle.getAttribute('aria-expanded') !== 'false');
                return;
            }
            if (projectPicker) {
                void this.chooseProject('/api/projects/pick');
                return;
            }
            const recentProject = target.closest<HTMLElement>('[data-recent-project]');
            if (recentProject?.dataset.recentProject) {
                void this.chooseProject('/api/projects/recent', { index: Number(recentProject.dataset.recentProject) });
                return;
            }
            const documentStatus = target.closest<HTMLElement>('[data-document-status]');
            if (documentStatus && this.page) {
                this.openDocumentStage(documentStatus);
                return;
            }
            const titleNavigation = target.closest<HTMLElement>('[data-title-navigation]');
            if (titleNavigation) {
                this.openTitleNavigation(titleNavigation);
                return;
            }
            const panelButton = target.closest<HTMLElement>('[data-panel]');
            if (panelButton?.dataset.panel && !(panelButton as HTMLButtonElement).disabled) {
                this.openPanel(panelButton.dataset.panel, panelButton);
                return;
            }
            const sourceLineNumbers = target.closest<HTMLElement>('#reader-line-numbers');
            if (sourceLineNumbers) {
                this.setSourceLineNumbers(!this.sourceLineNumbersVisible);
                return;
            }
            const navigationToggle = target.closest<HTMLElement>('#reader-navigation-toggle');
            if (navigationToggle) {
                this.setNavigationCollapsed(!this.navigationCollapsed);
                return;
            }
            const fontSizeButton = target.closest<HTMLButtonElement>('[data-font-size]');
            if (fontSizeButton?.dataset.fontSize) {
                this.updateFontSize(this.fontSize + Number(fontSizeButton.dataset.fontSize));
                return;
            }
            const link = target.closest<HTMLAnchorElement>('a[data-reader-page], a[data-formal-ref]');
            if (!link) return;
            const filePath = link.dataset.readerPage;
            if (!filePath) return;
            event.preventDefault();
            if (link.closest('.reader-lean-review')) this.leanReview.close(false);
            const anchor = link.hash.replace(/^#/, '');
            if (filePath === this.currentPath && anchor) {
                this.scrollToAnchor(anchor);
                return;
            }
            void this.openPage(filePath, 'push', anchor);
        });
        window.addEventListener('popstate', () => {
            const filePath = queryPath();
            if (!filePath) return;
            if (queryView() === 'symbol-audit-report') {
                if (filePath !== this.currentPath) {
                    void this.openPage(filePath, 'pop').then(() => this.openSymbolAuditReport('pop'));
                } else {
                    void this.openSymbolAuditReport('pop');
                }
                return;
            }
            void this.openPage(filePath, 'pop');
        });
        (this.root.querySelector('#reader-back') as HTMLButtonElement).addEventListener('click', () => this.navigateHistory(-1));
        (this.root.querySelector('#reader-forward') as HTMLButtonElement).addEventListener('click', () => this.navigateHistory(1));
    }

    private installRealtimeUpdates(): void {
        if (this.realtimeEvents) return;
        this.realtimeEvents = readerEvents();
        this.realtimeEvents.addEventListener('reader-reconnect', event => {
            // Refresh session metadata without replacing an in-flight navigation or its scroll position.
            this.applyState(JSON.parse(event.data) as ReaderState);
        });
        this.realtimeEvents.addEventListener('workspace-update', event => {
            let changedPaths: string[] = [];
            let revision: number | undefined;
            let initial = false;
            let assistancePaths: string[] | undefined;
            try {
                const update = JSON.parse((event as MessageEvent<string>).data);
                changedPaths = Array.isArray(update.changedPaths) && update.changedPaths.every((value: unknown) => typeof value === 'string') ? update.changedPaths : [];
                revision = update.revision;
                initial = update.initial === true;
                assistancePaths = leanAssistanceUpdatePaths(update, this.state);
            } catch (_error) {
                // Missing event metadata falls back to a conservative page refresh.
            }
            if (initial && revision === this.state?.revision) return;
            if (assistancePaths) {
                // Candidates have their own store; the event proves this exact revision
                // contains only candidate metadata. Gaps and mixed changes keep the full path.
                this.state = { ...this.state!, revision: revision! };
                this.leanReview.contextChanged(assistancePaths);
                return;
            }
            const requestId = this.pageRequestId;
            const current = this.currentPath;
            const previousRevision = this.state?.revision;
            void this.refreshState().then(async () => {
                if (requestId !== this.pageRequestId) return;
                if (this.state?.revision === previousRevision) this.leanReview.metadataChanged(changedPaths);
                readerText(this.liveStatus, () => this.dictionary().live);
                window.setTimeout(() => { this.liveStatus.textContent = ''; }, 1200);
                const next = this.state?.pages.some(page => page.filePath === current) ? current : this.defaultPagePath();
                if (!next) return this.openInitialPage();
                const projectMetadataChanged = changedPaths.some(filePath => (
                    filePath === '.math-workspace/config.json'
                    || filePath === '.math-workspace/definitions.json'
                    || filePath === '.math-workspace/symbols.json'
                ));
                const reloadCurrent = changedPaths.length === 0 || changedPaths.includes(current) || projectMetadataChanged;
                if (next && (next !== current || reloadCurrent)) return this.openPage(next, 'pop', '', next === current);
                return undefined;
            }).catch(error => console.error('[math-workspace] Math Workspace update failed', error));
        });
        this.realtimeEvents.addEventListener('reader-navigate', event => {
            try {
                const location = JSON.parse((event as MessageEvent<string>).data);
                if (typeof location?.filePath !== 'string') return;
                const line = Number(location.line);
                const column = Number(location.column);
                const sourceLocation = Number.isInteger(line) && line >= 1
                    ? { line, ...(Number.isInteger(column) && column >= 1 ? { column } : {}) }
                    : undefined;
                void this.openPage(location.filePath, 'push', '', false, sourceLocation);
            } catch (error) {
                console.error('[math-workspace] Reader location event was invalid', error);
            }
        });
    }
}

function startReader(): void {
    void initializeReaderHost().then(() => new ReaderApplication().start()).catch(error => {
        const root = document.getElementById('reader-app');
        if (!root) return;
        const message = error instanceof Error ? error.message : String(error);
        root.innerHTML = '<main class="reader-failure"><h1>Math Workspace</h1><pre>' + escapeHtml(message) + '</pre></main>';
        const retry = document.createElement('button');
        retry.className = 'tool-button';
        readerText(retry, () => readerPreferences.snapshot().language === 'zh' ? '重试' : 'Retry');
        const dispose = readerPreferences.subscribe(() => refreshReaderLabels(retry));
        retry.addEventListener('click', dispose, { once: true });
        retry.addEventListener('click', startReader); root.firstElementChild?.append(retry);
    });
}
startReader();
