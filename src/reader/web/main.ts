import { revealExerciseTarget } from './reader-exercises';
import './styles.css';
import { ReaderArchive } from './reader-archive';
import {
    createFormalRenderer,
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
import { readerIcon, replaceReaderButtonIcon, type ReaderIconName } from './reader-icons';
import { ReaderToolbarPanel } from './reader-toolbar-panel';
import { ReaderPropositionReview, type ReaderPropositionReviewItem } from './reader-proposition-review';
import { ReaderTooltip } from './reader-tooltip';
import {
    ReaderSymbolAudit,
    type ReaderSymbolAuditModel,
    type ReaderSymbolAuditStatus
} from './reader-symbol-audit';
import { ReaderSymbolAuditReportView } from './reader-symbol-audit-report';
import {
    ReaderDiscussionMarks,
    type ReaderDiscussionMark,
    type ReaderDiscussionMarkLocation
} from './reader-discussion-marks';

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

interface ReaderDiscussionMarksResponse {
    marks: ReaderDiscussionMark[];
}

const words = {
    zh: {
        contents: '目录',
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
        discussionTools: '标记工具',
        closeDiscussionTools: '清除并退出标记',
        discussionSelectTool: '选区',
        discussionLassoTool: '圈选',
        discussionFormalTool: '命题',
        discussionEraseTool: '擦除',
        discussionSelectHint: '拖拽选择正文后自动标记',
        discussionLassoHint: '在正文圈住一组来源块',
        discussionFormalHint: '点击命题以标记整条陈述',
        discussionEraseHint: '点击已标记内容以移除',
        markSelection: '标记选区',
        markFormula: '标记公式',
        markFormal: '标记整条命题',
        markAdded: (count: number) => count === 1 ? '已添加讨论标记' : `已添加 ${count} 条讨论标记`,
        noSourcesCircled: '没有圈到可定位的来源块',
        marksCleared: '已清除讨论标记',
        removeDiscussionMark: '移除此标记',
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
        propositionReviewGraphHint: '实线为严格依赖；数字虚线为图外严格关系；数字徽章表示正文补充提及，L 表示存在 Lean 锚点。颜色与快审只看严格下游。',
        propositionReviewEmpty: '当前章没有命题、引理、定理或推论。',
        propositionReviewHub: '支撑枢纽',
        propositionReviewLinked: '一般关联',
        propositionReviewTerminal: '终端命题',
        propositionReviewIsolated: '孤立命题',
        propositionReviewTerminalPropositions: '终端命题',
        propositionReviewTerminalPropositionSummary: (count: number) => `终端命题 ${count} 项`,
        propositionReviewTerminalPropositionHint: '这些命题当前在严格依赖图中没有下游引用；其章节作用与形式化锚点可按需审阅。',
        propositionReviewMarkTerminal: '标记终端命题',
        propositionReviewMarkTerminalHint: '把本章终端命题加入讨论标记；随后可在原生 Codex 任务中一次性审阅。',
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
        projectLauncherTitle: '打开 Math Workspace',
        projectLauncherDescription: '选择一个已包含 .math-workspace/config.json 的项目目录。',
        projectSelectionCancelled: '尚未选择项目。',
        leanAlignment: 'Lean 对齐',
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
        discussionTools: 'Marking tools',
        closeDiscussionTools: 'Clear and exit marking',
        discussionSelectTool: 'Select',
        discussionLassoTool: 'Lasso',
        discussionFormalTool: 'Proposition',
        discussionEraseTool: 'Erase',
        discussionSelectHint: 'Select text to mark it',
        discussionLassoHint: 'Circle a group of source blocks',
        discussionFormalHint: 'Click a proposition to mark its whole statement',
        discussionEraseHint: 'Click marked content to remove it',
        markSelection: 'Mark selection',
        markFormula: 'Mark formula',
        markFormal: 'Mark formal object',
        markAdded: (count: number) => count === 1 ? 'Discussion mark added' : `${count} discussion marks added`,
        noSourcesCircled: 'No source blocks were inside that circle',
        marksCleared: 'Discussion marks cleared',
        removeDiscussionMark: 'Remove mark',
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
        propositionReviewGraphHint: 'Solid lines are strict dependencies; numbered dashed lines are outside-map strict relations; numbered badges count supplemental text mentions, and L marks a Lean anchor. Color and review use strict downstream only.',
        propositionReviewEmpty: 'No proposition, lemma, theorem, or corollary occurs in this chapter.',
        propositionReviewHub: 'Support hub',
        propositionReviewLinked: 'Linked',
        propositionReviewTerminal: 'Terminal proposition',
        propositionReviewIsolated: 'Isolated proposition',
        propositionReviewTerminalPropositions: 'Terminal propositions',
        propositionReviewTerminalPropositionSummary: (count: number) => `${count} terminal proposition${count === 1 ? '' : 's'}`,
        propositionReviewTerminalPropositionHint: 'These propositions currently have no downstream reference in the strict dependency graph; their chapter role and formalization anchors can be reviewed when useful.',
        propositionReviewMarkTerminal: 'Mark terminal propositions',
        propositionReviewMarkTerminalHint: 'Add this chapter’s terminal propositions to discussion marks, then review them together in a native Codex task.',
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
        projectLauncherTitle: 'Open Math Workspace',
        projectLauncherDescription: 'Choose a project folder containing .math-workspace/config.json.',
        projectSelectionCancelled: 'No project was selected.',
        leanAlignment: 'Lean alignment',
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
    return new URLSearchParams(window.location.search).get('path') || '';
}

interface ReaderSourceLocation {
    line: number;
    column?: number;
}

function querySourceLocation(): ReaderSourceLocation | undefined {
    const query = new URLSearchParams(window.location.search);
    const line = Number(query.get('line'));
    const column = Number(query.get('column'));
    if (!Number.isInteger(line) || line < 1) return undefined;
    return {
        line,
        ...(Number.isInteger(column) && column >= 1 ? { column } : {})
    };
}

function queryView(): string {
    return new URLSearchParams(window.location.search).get('view') || '';
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

function documentStageLabel(page: ReaderPage | undefined, language: Language): string {
    const dictionary = words[language];
    switch (page?.lifecycle?.stage) {
        case 'draft': return dictionary.documentStageDraft;
        case 'revising': return dictionary.documentStageRevising;
        case 'stable': return dictionary.documentStageStable;
        default: return dictionary.documentStageUnset;
    }
}

function documentStatusText(page: ReaderPage | undefined, language: Language): string {
    const stage = documentStageLabel(page, language);
    const checkpoint = page?.lifecycle?.checkpoint;
    if (!checkpoint) return stage;
    return `${checkpoint.label} · ${page?.lifecycle?.changedSinceCheckpoint ? words[language].documentStageChanged : stage}`;
}

function documentStatusBadge(page: ReaderPage | undefined, language: Language, interactive = false): HTMLElement | undefined {
    const lifecycle = page?.lifecycle;
    if (page?.documentMode === 'draft') return undefined;
    const hasState = !!lifecycle?.stage || !!lifecycle?.checkpoint;
    if (!interactive && !hasState) return undefined;
    const element = interactive ? document.createElement('button') : document.createElement('span');
    element.className = 'reader-document-status' + (interactive ? ' is-interactive' : '') + (lifecycle?.changedSinceCheckpoint ? ' is-changed' : '');
    element.textContent = documentStatusText(page, language);
    element.title = words[language].documentStage + '：' + documentStatusText(page, language);
    if (interactive) {
        (element as HTMLButtonElement).type = 'button';
        element.dataset.documentStatus = 'true';
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
    glyph.dataset.readerTooltip = pageIntegrationTooltip(page, language);
    glyph.setAttribute('aria-hidden', 'true');
    return glyph;
}

const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 24;
const FONT_SIZE_STORAGE_KEY = 'math-workspace.font-size';
const DRAFT_COLLECTIONS_STORAGE_KEY = 'math-workspace.collapsed-draft-collections';
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

function storedCollapsedDraftCollections(): Set<string> {
    try {
        const value = JSON.parse(localStorage.getItem(DRAFT_COLLECTIONS_STORAGE_KEY) || '[]');
        return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
    } catch (_error) {
        return new Set();
    }
}


class ReaderApplication {
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
    private collapsedDraftCollections = storedCollapsedDraftCollections();
    private article!: HTMLElement;
    private pageTitle!: HTMLElement;
    private liveStatus!: HTMLElement;
    private sourceActions!: ReaderSourceActions;
    private recallPopover!: ReaderRecallPopover;
    private dependencyPopover!: ReaderDependencyPopover;
    private leanPopover!: ReaderLeanPopover;
    private toolbarPanel!: ReaderToolbarPanel;
    private tooltip!: ReaderTooltip;
    private propositionReview!: ReaderPropositionReview;
    private archive!: ReaderArchive;
    private symbolAudit!: ReaderSymbolAudit;
    private symbolAuditReport!: ReaderSymbolAuditReportView;
    private symbolAuditReportOpen = false;
    private discussionMarks!: ReaderDiscussionMarks;
    private realtimeEvents: EventSource | undefined;

    async start(): Promise<void> {
        this.buildShell();
        await this.refreshState();
        await this.refreshDiscussionMarks();
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
        const initialPath = queryPath() || this.state?.pages[0]?.filePath || '';
        if (!initialPath) {
            this.article.textContent = 'No Markdown pages were found in the bound project.';
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
            '<label class="reader-filter"><span class="sr-only">Filter pages</span><input id="reader-page-filter" type="search" autocomplete="off" /></label>',
            '<nav id="reader-page-nav" class="reader-page-nav"></nav>',
            '</aside>',
            '<main id="reader-main" class="reader-main">',
            '<header class="reader-toolbar">',
            '<button id="reader-navigation-toggle" class="icon-button reader-navigation-toggle" type="button"></button>',
            '<div class="reader-history"><button id="reader-back" class="icon-button" aria-label="Back"></button><button id="reader-forward" class="icon-button" aria-label="Forward"></button></div>',
            '<div id="reader-page-title" class="reader-page-title"></div>',
            '<div class="reader-tools"><button id="reader-archive" class="tool-button" type="button" aria-label="Version history" aria-haspopup="dialog"></button><button class="tool-button" data-panel="contents" aria-label="Contents"></button><button class="tool-button" data-panel="definitions" aria-label="Definitions"></button><button class="tool-button" data-panel="symbols" aria-label="Symbols"></button><button class="tool-button" data-panel="propositions" aria-label="Proposition review"></button><button class="tool-button" data-panel="symbol-audit" aria-label="Symbol audit"></button><button id="reader-discussion-tools" class="tool-button" type="button" aria-label="Marking tools"></button><button id="reader-line-numbers" class="tool-button" type="button" aria-label="Show source line numbers" aria-pressed="false"></button></div>',
            '<div class="reader-type-control"><button type="button" class="type-size-button" data-font-size="-1" aria-label="Decrease text size">A−</button><output id="reader-font-size" aria-live="polite">' + this.fontSize + 'px</output><button type="button" class="type-size-button" data-font-size="1" aria-label="Increase text size">A+</button></div>',
            '<span id="reader-live" class="reader-live" aria-live="polite"></span>',
            '</header><article id="reader-article" class="reader-article"></article></main>',
            '</div>'
        ].join('');
        this.main = this.root.querySelector('#reader-main') as HTMLElement;
        this.article = this.root.querySelector('#reader-article') as HTMLElement;
        this.pageTitle = this.root.querySelector('#reader-page-title') as HTMLElement;
        this.liveStatus = this.root.querySelector('#reader-live') as HTMLElement;
        this.tooltip = new ReaderTooltip();
        this.tooltip.bind(this.root);
        this.installToolbarIcons();
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
            markDiscussionLocation: async location => {
                await this.addDiscussionMarks([location]);
            },
            labels: () => {
                const dictionary = this.dictionary();
                return {
                    copyLatex: dictionary.copyLatex,
                    copySelectedMarkdown: dictionary.copySelectedMarkdown,
                    copySourceLines: dictionary.copySourceLines,
                    lookupDefinition: dictionary.lookupDefinition,
                    locate: dictionary.jump,
                    copied: dictionary.copied,
                    noDefinitions: dictionary.noDefinitions,
                    refineDefinitionQuery: dictionary.refineDefinitionQuery,
                    markSelection: dictionary.markSelection,
                    markFormula: dictionary.markFormula,
                    marked: dictionary.markAdded(1)
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
        this.leanPopover = new ReaderLeanPopover({
            fetchAnchor: id => this.fetchJson<ReaderLeanAnchorPayload>('/api/lean?id=' + encodeURIComponent(id)),
            labels: () => {
                const dictionary = this.dictionary();
                return {
                    title: dictionary.leanAlignment,
                    loading: dictionary.leanLoading,
                    unavailable: dictionary.leanUnavailable,
                    contract: dictionary.leanContract,
                    build: dictionary.leanBuild,
                    dependencies: dictionary.leanDependencies,
                    declarations: dictionary.leanDeclarations,
                    markdownOnly: dictionary.leanMarkdownOnly,
                    leanOnly: dictionary.leanOnly,
                    none: dictionary.leanNone,
                    status: (kind, value) => leanStatusLabel(this.state?.language || 'zh', kind, value)
                };
            }
        });
        this.archive = new ReaderArchive(() => ({ language: this.state?.language || 'zh', currentPath: this.currentPath, token: this.state?.requestToken || '', project: this.state?.projectId || '' }));
        this.root.querySelector('#reader-archive')?.addEventListener('click', () => void this.archive.open());
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
                    markTerminal: dictionary.propositionReviewMarkTerminal,
                    markTerminalHint: dictionary.propositionReviewMarkTerminalHint,
                    nodeLabel: dictionary.propositionReviewNodeLabel
                };
            },
            openProposition: id => this.openCurrentProposition(id),
            markTerminalPropositions: items => this.markTerminalPropositions(items)
        });
        this.symbolAudit = new ReaderSymbolAudit();
        this.symbolAuditReport = new ReaderSymbolAuditReportView();
        this.discussionMarks = new ReaderDiscussionMarks({
            addMarks: locations => this.addDiscussionMarks(locations),
            removeMark: id => this.removeDiscussionMark(id),
            clearMarks: () => this.clearDiscussionMarks(),
            report: message => this.reportLive(message),
            toolsChanged: () => {
                this.updateDiscussionMarkControls();
            },
            labels: () => {
                const dictionary = this.dictionary();
                return {
                    openTools: dictionary.discussionTools,
                    closeTools: dictionary.closeDiscussionTools,
                    selectTool: dictionary.discussionSelectTool,
                    lassoTool: dictionary.discussionLassoTool,
                    formalTool: dictionary.discussionFormalTool,
                    eraseTool: dictionary.discussionEraseTool,
                    selectHint: dictionary.discussionSelectHint,
                    lassoHint: dictionary.discussionLassoHint,
                    formalHint: dictionary.discussionFormalHint,
                    eraseHint: dictionary.discussionEraseHint,
                    markAdded: dictionary.markAdded,
                    marksCleared: dictionary.marksCleared,
                    remove: dictionary.removeDiscussionMark,
                    noSourcesCircled: dictionary.noSourcesCircled
                };
            }
        });
    }

    private dictionary() {
        return words[this.state?.language || 'zh'];
    }

    private async fetchJson<T>(url: string): Promise<T> {
        const response = await fetch(url, {
            cache: 'no-store',
            headers: (url === '/api/discussion-marks' || url === '/api/document-state' || url.startsWith('/api/symbol-audit')) && this.state?.requestToken
                ? { 'x-math-workspace-token': this.state.requestToken }
                : undefined
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<T>;
    }

    private async postJson<T>(url: string, value: unknown = {}): Promise<T> {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if ((url === '/api/discussion-marks' || url.startsWith('/api/symbol-audit')) && this.state?.requestToken) {
            headers['x-math-workspace-token'] = this.state.requestToken;
        }
        if (url === '/api/document-state' && this.state?.requestToken) {
            headers['x-math-workspace-token'] = this.state.requestToken;
        }
        const response = await fetch(url, {
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
        if ((url.startsWith('/api/discussion-marks') || url.startsWith('/api/symbol-audit')) && this.state?.requestToken) {
            headers['x-math-workspace-token'] = this.state.requestToken;
        }
        const response = await fetch(url, { method: 'DELETE', cache: 'no-store', headers });
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<T>;
    }

    private async refreshState(): Promise<void> {
        this.applyState(await this.fetchJson<ReaderState>('/api/state'));
    }

    private applyState(state: ReaderState): void {
        this.state = state;
        this.archive?.contextChanged();
        const dictionary = this.dictionary();
        (this.root.querySelector('#reader-page-filter') as HTMLInputElement).placeholder = dictionary.search;
        this.renderNavigation((this.root.querySelector('#reader-page-filter') as HTMLInputElement).value);
        this.updateToolbarLabels();
    }

    private renderProjectLauncher(message = ''): void {
        const shell = this.root.querySelector('.reader-shell') as HTMLElement;
        shell.classList.add('is-project-launcher');
        this.article.replaceChildren();
        const dictionary = this.dictionary();
        const panel = document.createElement('section');
        panel.className = 'reader-project-launcher';
        const title = document.createElement('h1');
        title.textContent = dictionary.projectLauncherTitle;
        const description = document.createElement('p');
        description.textContent = message || dictionary.projectLauncherDescription;
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'reader-project-choose';
        choose.dataset.projectPicker = 'true';
        choose.textContent = dictionary.chooseProject;
        const recentHeading = document.createElement('h2');
        recentHeading.textContent = dictionary.recentProjects;
        const recent = document.createElement('div');
        recent.className = 'reader-recent-projects';
        const projects = this.state?.recentProjects || [];
        if (!projects.length) {
            const empty = document.createElement('p');
            empty.className = 'reader-project-empty';
            empty.textContent = dictionary.noRecentProjects;
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
                this.renderProjectLauncher(this.dictionary().projectSelectionCancelled);
                return;
            }
            this.root.querySelector('.reader-shell')?.classList.remove('is-project-launcher');
            this.page = undefined;
            this.currentPath = '';
            this.historyPaths = [];
            this.historyIndex = -1;
            window.history.replaceState({}, '', window.location.pathname);
            await this.refreshDiscussionMarks();
            await this.openInitialPage();
            this.installRealtimeUpdates();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.renderProjectLauncher(message);
        }
    }

    private updateToolbarLabels(): void {
        const dictionary = this.dictionary();
        const back = this.root.querySelector('#reader-back') as HTMLElement;
        const forward = this.root.querySelector('#reader-forward') as HTMLElement;
        back.dataset.tooltip = dictionary.back;
        back.setAttribute('aria-label', dictionary.back);
        forward.dataset.tooltip = dictionary.forward;
        forward.setAttribute('aria-label', dictionary.forward);
        this.root.querySelectorAll<HTMLElement>('[data-panel]').forEach(button => {
            const panel = button.dataset.panel || '';
            const view = (panel === 'symbol-audit' ? 'symbolAudit' : panel) as keyof typeof dictionary;
            const label = typeof dictionary[view] === 'string' ? dictionary[view] : '';
            button.dataset.tooltip = label;
            button.setAttribute('aria-label', label);
        });
        const fontSize = this.root.querySelector('.reader-type-control') as HTMLElement;
        fontSize.setAttribute('aria-label', dictionary.fontSize);
        const decrease = this.root.querySelector<HTMLElement>('[data-font-size="-1"]') as HTMLElement;
        const increase = this.root.querySelector<HTMLElement>('[data-font-size="1"]') as HTMLElement;
        decrease.dataset.tooltip = dictionary.decreaseFont;
        decrease.setAttribute('aria-label', dictionary.decreaseFont);
        increase.dataset.tooltip = dictionary.increaseFont;
        increase.setAttribute('aria-label', dictionary.increaseFont);
        this.updateNavigationToggle();
        this.updateSourceLineNumberToggle();
        this.updateDiscussionMarkControls();
        this.updateDraftToolbarAvailability();
        const archiveButton = this.root.querySelector<HTMLButtonElement>('#reader-archive');
        if (archiveButton) {
            const label = this.state?.language === 'en' ? 'Version history' : '版本记录';
            replaceReaderButtonIcon(archiveButton, 'history');
            archiveButton.setAttribute('aria-label', label);
            archiveButton.dataset.tooltip = label;
        }
    }

    private updateDraftToolbarAvailability(): void {
        const isDraft = this.page?.page.documentMode === 'draft';
        const unavailablePanels = new Set(['definitions', 'symbols', 'propositions', 'symbol-audit']);
        const dictionary = this.dictionary();
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
            button.dataset.tooltip = label;
            button.setAttribute('aria-label', label);
        });
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
        toggle.dataset.tooltip = label;
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('aria-pressed', String(this.sourceLineNumbersVisible));
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

    private setDraftCollectionCollapsed(collectionId: string, value: boolean): void {
        if (value) this.collapsedDraftCollections.add(collectionId);
        else this.collapsedDraftCollections.delete(collectionId);
        try {
            localStorage.setItem(DRAFT_COLLECTIONS_STORAGE_KEY, JSON.stringify([...this.collapsedDraftCollections].sort()));
        } catch (_error) {
            // The in-memory setting still works in restricted browser contexts.
        }
        const filter = this.root.querySelector('#reader-page-filter') as HTMLInputElement | null;
        this.renderNavigation(filter?.value || '');
    }
    private pageForPath(filePath: string): ReaderPage | undefined {
        return this.state?.pages.find(page => page.filePath === filePath);
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
        menu.setAttribute('aria-label', this.dictionary().documentStageBatch(filePaths.length));
        const title = document.createElement('div');
        title.className = 'reader-nav-context-menu-title';
        title.textContent = this.dictionary().documentStageSelection(filePaths.length);
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
        stageLabel.textContent = this.dictionary().documentStageMenu;
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
        ([
            ['draft', this.dictionary().documentStageDraft],
            ['revising', this.dictionary().documentStageRevising],
            ['stable', this.dictionary().documentStageStable]
        ] as const).forEach(([stage, label]) => {
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'reader-nav-context-menu-item';
            action.setAttribute('role', 'menuitem');
            action.textContent = label;
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

    private updateDiscussionMarkControls(): void {
        const tools = this.root.querySelector<HTMLButtonElement>('#reader-discussion-tools');
        if (!tools) return;
        const count = this.discussionMarks?.count() || 0;
        const open = this.discussionMarks?.isToolsOpen() || false;
        const labelBase = open ? this.dictionary().closeDiscussionTools : this.dictionary().discussionTools;
        const label = count ? `${labelBase} (${count})` : labelBase;
        tools.dataset.tooltip = label;
        tools.dataset.markCount = count ? String(count) : '';
        tools.setAttribute('aria-label', label);
        tools.classList.toggle('has-discussion-marks', count > 0);
        tools.classList.toggle('is-active', open);
    }

    private installToolbarIcons(): void {
        const icons: Array<[string, ReaderIconName]> = [
            ['#reader-back', 'chevron-left'],
            ['#reader-forward', 'chevron-right'],
            ['[data-panel="contents"]', 'contents'],
            ['[data-panel="definitions"]', 'definition'],
            ['[data-panel="symbols"]', 'sigma'],
            ['[data-panel="propositions"]', 'propositions'],
            ['[data-panel="symbol-audit"]', 'scan'],
            ['#reader-discussion-tools', 'marker'],
            ['#reader-line-numbers', 'line-numbers']
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
        const groups = new Map<string, ReaderPage[]>();
        this.state.pages.filter(page => (
            !normalized || normalizeQuery((page.displayHeading || page.title) + ' ' + page.filePath).includes(normalized)
        )).forEach(page => {
            const data = page as ReaderPage & { bookTitle?: string; bookKey?: string; volumeTitle?: string };
            const book = data.bookTitle || data.bookKey || this.state?.rootName || '';
            const groupName = page.documentMode === 'draft'
                ? (page.documentCollectionTitle || this.dictionary().documentStageDraft)
                : (data.volumeTitle ? book + ' · ' + data.volumeTitle : book);
            if (!groups.has(groupName)) groups.set(groupName, []);
            groups.get(groupName)?.push(page);
        });

        const navigation = this.root.querySelector('#reader-page-nav') as HTMLElement;
        navigation.replaceChildren();
        groups.forEach((pages, groupName) => {
            const group = document.createElement('section');
            group.className = 'reader-nav-group';
            const heading = document.createElement('h2');
            const headingText = document.createElement('span');
            headingText.innerHTML = renderFormalInline(this.markdown, groupName, this.renderOptions('', {}));
            const isDraftCollection = pages[0]?.documentMode === 'draft';
            const integrated = pages.filter(page => pageIntegration(page).status === 'managed').length;
            const draftCollectionId = pages[0]?.documentCollectionId;
            const summaryText = isDraftCollection
                ? this.dictionary().draftCollectionSummary(pages.length)
                : this.dictionary().integrationGroupSummary(integrated, pages.length);
            const summary = document.createElement('span');
            summary.className = 'reader-nav-integration-summary';
            summary.textContent = summaryText;
            summary.title = summaryText;
            const isCollapsed = Boolean(isDraftCollection && draftCollectionId && !normalized && this.collapsedDraftCollections.has(draftCollectionId));
            if (isDraftCollection && draftCollectionId) {
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'reader-nav-group-toggle' + (isCollapsed ? ' is-collapsed' : '');
                toggle.dataset.draftCollectionToggle = draftCollectionId;
                toggle.setAttribute('aria-expanded', String(!isCollapsed));
                toggle.setAttribute('aria-label', isCollapsed ? this.dictionary().expandDraftCollection : this.dictionary().collapseDraftCollection);
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
                const status = documentStatusBadge(page, this.state!.language);
                if (status) button.append(status);
                button.append(pageIntegrationGlyph(page, this.state!.language));
                button.setAttribute('aria-label', `${title} — ${pageIntegrationTooltip(page, this.state!.language)}`);
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
                window.requestAnimationFrame(() => this.scrollToSourceLocation(sourceLocation));
            } else {
                this.main.scrollTop = preserveScroll ? previousScroll : 0;
            }
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
            history.pushState({ filePath }, '', url);
        } else if (mode === 'replace') {
            if (this.historyIndex < 0) {
                this.historyPaths = [filePath];
                this.historyIndex = 0;
            } else {
                this.historyPaths[this.historyIndex] = filePath;
            }
            history.replaceState({ filePath }, '', url);
        }
        (this.root.querySelector('#reader-back') as HTMLButtonElement).disabled = this.historyIndex <= 0;
        (this.root.querySelector('#reader-forward') as HTMLButtonElement).disabled = this.historyIndex >= this.historyPaths.length - 1;
    }

    private renderArticle(): void {
        if (!this.page || !this.state) return;
        const title = this.page.page?.displayHeading || this.page.page?.title || this.page.filePath;
        const titleLabel = document.createElement('span');
        titleLabel.className = 'reader-page-title-label';
        titleLabel.innerHTML = renderFormalInline(this.markdown, title, this.renderOptions(this.page.filePath, this.page.labels));
        const documentStatus = documentStatusBadge(this.page.page, this.state.language, true);
        const titleParts: Node[] = [titleLabel];
        if (documentStatus) titleParts.push(documentStatus);
        titleParts.push(pageIntegrationGlyph(this.page.page, this.state.language));
        this.pageTitle.replaceChildren(...titleParts);
        const descriptor = this.page.page?.documentMode === 'draft'
            ? (this.page.page?.documentCollectionTitle || 'Draft collection')
            : pageIntegrationTooltip(this.page.page, this.state.language);
        this.pageTitle.setAttribute('aria-label', title + ' — ' + descriptor);
        document.title = title + ' — Math Workspace';
        const rendered = renderFormalDocument(this.markdown, this.page.content, {
            currentFilePath: this.page.filePath,
            labels: this.page.labels,
            pages: this.state.pages,
            language: this.state.language,
            dependencyMarkers: this.page.dependencyMarkers
        });
        this.page.formulas = rendered.formulas;
        this.article.innerHTML = rendered.html;
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
        const formalRanges = Object.fromEntries(Object.entries(this.page.labels)
            .filter(([id, label]) => this.page?.dependencyMarkers?.[id]?.kind === 'theorem-like'
                && label.filePath === this.page?.filePath
                && typeof (label as any).startLine === 'number'
                && typeof (label as any).endLine === 'number')
            .map(([id, label]) => [id, {
                startLine: (label as any).startLine + 1,
                endLine: (label as any).endLine + 1
            }]));
        this.discussionMarks.bind(this.article, { filePath: this.page.filePath, formalRanges });
        this.recallPopover.bind(this.article);
        this.dependencyPopover.bind(this.article);
        this.leanPopover.bind(this.article);
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
        this.article.querySelectorAll('.is-source-location-target').forEach(element => element.classList.remove('is-source-location-target'));
        revealExerciseTarget(target);
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.classList.add('is-source-location-target');
        window.setTimeout(() => target.classList.remove('is-source-location-target'), 1800);
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
        history.replaceState({ filePath: path }, '', '?path=' + encodeURIComponent(path));
        void this.openPage(path, 'pop');
    }

    private openPanel(view: string, trigger: HTMLElement): void {
        if (!this.state) return;
        if (this.page?.page.documentMode === 'draft'
            && ['definitions', 'symbols', 'propositions', 'symbol-audit'].includes(view)) return;
        const dictionary = this.dictionary();
        const titleKey = view === 'symbol-audit' ? 'symbolAudit' : view;
        const candidate = dictionary[titleKey as keyof typeof dictionary];
        const title = typeof candidate === 'string' ? candidate : view;
        this.toolbarPanel.open(view, trigger, title, content => {
            if (view === 'contents') this.renderContents(content);
            if (view === 'definitions') this.renderDefinitions(content);
            if (view === 'symbols') this.renderSymbols(content);
            if (view === 'propositions') this.propositionReview.render(content, this.currentPropositionReviewItems());
            if (view === 'symbol-audit') this.renderSymbolAudit(content);
        });
    }

    private openDocumentStage(trigger: HTMLElement): void {
        const page = this.page?.page;
        if (!page || !this.state) return;
        if (page.documentMode === 'draft') return;
        const dictionary = this.dictionary();
        this.toolbarPanel.open('document-stage', trigger, dictionary.documentStage, content => {
            const summary = document.createElement('p');
            summary.className = 'reader-document-stage-summary';
            summary.textContent = documentStatusText(page, this.state!.language);
            const stages = document.createElement('div');
            stages.className = 'reader-document-stage-actions';
            ([
                ['draft', dictionary.documentStageDraft],
                ['revising', dictionary.documentStageRevising],
                ['stable', dictionary.documentStageStable]
            ] as const).forEach(([stage, label]) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'reader-symbol-audit-button';
                button.textContent = label;
                button.addEventListener('click', () => void this.saveDocumentStage({ stage }));
                stages.append(button);
            });
            const checkpoint = document.createElement('div');
            checkpoint.className = 'reader-document-stage-checkpoint';
            const input = document.createElement('input');
            input.className = 'reader-panel-search';
            input.placeholder = dictionary.documentStageMilestoneHint;
            input.value = page.lifecycle?.checkpoint?.label || '';
            const record = document.createElement('button');
            record.type = 'button';
            record.className = 'reader-symbol-audit-button';
            record.textContent = dictionary.documentStageRecord;
            record.addEventListener('click', () => void this.saveDocumentStage({ checkpointLabel: input.value }));
            checkpoint.append(input, record);
            content.append(summary, stages, checkpoint);
            if (page.lifecycle?.checkpoint) {
                const clear = document.createElement('button');
                clear.type = 'button';
                clear.className = 'reader-document-stage-clear';
                clear.textContent = dictionary.documentStageClear;
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

    private async refreshDiscussionMarks(): Promise<ReaderDiscussionMark[]> {
        if (!this.state?.available) return [];
        const response = await this.fetchJson<ReaderDiscussionMarksResponse>('/api/discussion-marks');
        this.discussionMarks.setMarks(response.marks || []);
        this.updateDiscussionMarkControls();
        return response.marks || [];
    }

    private async addDiscussionMarks(locations: ReaderDiscussionMarkLocation[]): Promise<ReaderDiscussionMark[]> {
        if (!locations.length) return this.refreshDiscussionMarks();
        await this.postJson('/api/discussion-marks', { marks: locations });
        return this.refreshDiscussionMarks();
    }

    private async removeDiscussionMark(id: string): Promise<void> {
        await this.deleteJson('/api/discussion-marks?id=' + encodeURIComponent(id));
        await this.refreshDiscussionMarks();
    }

    private async clearDiscussionMarks(): Promise<void> {
        await this.deleteJson('/api/discussion-marks');
        await this.refreshDiscussionMarks();
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

    private propositionDiscussionLocation(id: string): ReaderDiscussionMarkLocation | undefined {
        if (!this.page) return undefined;
        const label = this.page.labels[id] as any;
        const target = this.article.querySelector<HTMLElement>('#formal-' + id);
        const startLine = typeof label?.startLine === 'number' ? label.startLine + 1 : Number(target?.dataset.sourceStartLine);
        const endLine = typeof label?.endLine === 'number' ? label.endLine + 1 : Number(target?.dataset.sourceEndLine);
        if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) return undefined;
        return {
            filePath: this.page.filePath,
            startLine,
            endLine,
            kind: 'formal',
            formalId: id
        };
    }

    private markTerminalPropositions(items: ReaderPropositionReviewItem[]): void {
        const locations = items
            .filter(item => item.marker.directDependents === 0)
            .map(item => this.propositionDiscussionLocation(item.id))
            .filter((location): location is ReaderDiscussionMarkLocation => !!location);
        if (!locations.length) return;
        this.toolbarPanel.close();
        void this.addDiscussionMarks(locations).then(() => this.reportLive(this.dictionary().markAdded(locations.length)));
    }

    private renderContents(container: HTMLElement): void {
        const headings = Array.from(this.article.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
        if (headings.length === 0) {
            container.append(this.emptyState(this.dictionary().noContents));
            return;
        }
        const list = document.createElement('div');
        list.className = 'reader-panel-list reader-outline-list';
        headings.forEach(heading => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'reader-outline level-' + heading.tagName.slice(1);
            button.innerHTML = heading.innerHTML;
            button.addEventListener('click', () => {
                heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                this.toolbarPanel.close();
            });
            list.append(button);
        });
        container.append(list);
    }

    private renderDefinitions(container: HTMLElement): void {
        container.replaceChildren();
        let scope: 'chapter' | 'all' = 'chapter';
        const controls = document.createElement('div');
        controls.className = 'reader-definition-controls';
        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'reader-panel-search';
        search.placeholder = this.dictionary().searchDefinitions;
        const scopeButton = document.createElement('button');
        scopeButton.type = 'button';
        scopeButton.className = 'reader-definition-scope';
        const results = document.createElement('div');
        results.className = 'reader-panel-list';
        const renderResults = () => {
            results.replaceChildren();
            scopeButton.textContent = scope === 'chapter'
                ? this.dictionary().searchAllDefinitions
                : this.dictionary().showChapterDefinitions;
            scopeButton.classList.toggle('is-active', scope === 'all');
            const matches = this.findDefinitions(search.value, 80, scope === 'chapter' ? this.chapterDefinitions() : undefined);
            if (matches.length === 0) {
                results.append(this.emptyState(scope === 'chapter' && !search.value.trim()
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
            this.panelIconButton('arrow-left', this.dictionary().definitions, () => this.renderDefinitions(container)),
            this.panelIconButton('locate', this.dictionary().jump, () => {
                this.toolbarPanel.close();
                void this.openPage(definition.filePath, 'push').then(() => {
                    this.article.querySelector<HTMLElement>('[data-source-line="' + definition.line + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
            })
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
        void this.openPage(definition.filePath, 'push').then(() => {
            this.article.querySelector<HTMLElement>('[data-source-line="' + definition.line + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    private renderSymbols(container: HTMLElement): void {
        const symbols = this.page?.symbols || [];
        if (symbols.length === 0) {
            container.append(this.emptyState(this.dictionary().noSymbols));
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
                detail.append(this.panelIconButton('locate', this.dictionary().jump, () => {
                    this.toolbarPanel.close();
                    void this.openPage(symbol.sourceFilePath as string, 'push').then(() => {
                        this.article.querySelector<HTMLElement>('[data-source-line="' + symbol.sourceLine + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                }));
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
                void this.openPage(filePath, 'push').then(() => {
                    this.article.querySelector<HTMLElement>('[data-source-line="' + line + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
            },
            currentFilePath: () => this.page?.filePath,
            changed: () => this.toolbarPanel.reposition()
        });
    }

    private async openSymbolAuditReport(historyMode: 'push' | 'replace' | 'pop' = 'push'): Promise<void> {
        if (!this.state?.available || !this.currentPath) return;
        const status = await this.fetchJson<ReaderSymbolAuditStatus>('/api/symbol-audit');
        if (!status.report) return;
        this.toolbarPanel.close();
        this.symbolAudit.dispose();
        if (this.discussionMarks.isToolsOpen()) this.discussionMarks.toggleTools();
        this.symbolAuditReportOpen = true;
        this.article.classList.add('is-symbol-audit-report');
        const title = this.dictionary().symbolAuditOpenReport;
        const titleLabel = document.createElement('span');
        titleLabel.className = 'reader-page-title-label';
        titleLabel.textContent = title;
        this.pageTitle.replaceChildren(titleLabel);
        this.pageTitle.setAttribute('aria-label', title);
        document.title = title + ' — Math Workspace';
        if (historyMode !== 'pop') {
            const url = '?path=' + encodeURIComponent(this.currentPath) + '&view=symbol-audit-report';
            const state = { filePath: this.currentPath, view: 'symbol-audit-report' };
            if (historyMode === 'push') history.pushState(state, '', url);
            else history.replaceState(state, '', url);
        }
        this.symbolAuditReport.render(this.article, status, {
            language: this.state.language,
            sourceTitle: filePath => {
                const page = this.state?.pages.find(candidate => candidate.filePath === filePath);
                return page?.displayHeading || page?.title || filePath.split('/').pop() || filePath;
            },
            locate: (filePath, line) => {
                void this.openPage(filePath, 'push').then(() => {
                    this.article.querySelector<HTMLElement>('[data-source-line="' + line + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
            },
            close: () => this.closeSymbolAuditReport()
        });
        this.main.scrollTop = 0;
    }

    private closeSymbolAuditReport(): void {
        if (!this.page) return;
        this.symbolAuditReportOpen = false;
        history.replaceState({ filePath: this.currentPath }, '', '?path=' + encodeURIComponent(this.currentPath));
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
            const panelButton = target.closest<HTMLElement>('[data-panel]');
            if (panelButton?.dataset.panel) {
                this.openPanel(panelButton.dataset.panel, panelButton);
                return;
            }
            const discussionTools = target.closest<HTMLElement>('#reader-discussion-tools');
            if (discussionTools && this.page) {
                this.toolbarPanel.close();
                this.discussionMarks.toggleTools();
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
        this.realtimeEvents = new EventSource('/api/events');
        this.realtimeEvents.addEventListener('workspace-update', event => {
            let changedPaths: string[] = [];
            let revision: number | undefined;
            let initial = false;
            try {
                const update = JSON.parse((event as MessageEvent<string>).data);
                changedPaths = update.changedPaths || [];
                revision = update.revision;
                initial = update.initial === true;
            } catch (_error) {
                // Missing event metadata falls back to a conservative page refresh.
            }
            if (initial && revision === this.state?.revision) return;
            const current = this.currentPath;
            void this.refreshState().then(async () => {
                await this.refreshDiscussionMarks();
                this.liveStatus.textContent = this.dictionary().live;
                window.setTimeout(() => { this.liveStatus.textContent = ''; }, 1200);
                const next = this.state?.pages.some(page => page.filePath === current) ? current : this.state?.pages[0]?.filePath;
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

void new ReaderApplication().start().catch(error => {
    const root = document.getElementById('reader-app');
    if (!root) return;
    const message = error instanceof Error ? error.message : String(error);
    root.innerHTML = '<main class="reader-failure"><h1>Math Workspace</h1><pre>' + escapeHtml(message) + '</pre></main>';
});
