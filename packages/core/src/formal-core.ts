import * as path from 'node:path';
import { FORMAL_KIND_POLICIES, DEFAULT_LEAN_COVERAGE_TYPES, FORMAL_TYPES, THEOREM_COUNTER_TYPES, DEPENDENCY_NODE_TYPES, RECALL_TYPES, SECTION_TYPES, HASH_ID_RE, TMP_ID_RE, FORMAL_TYPE_PATTERN, normalizeFormalKind, formalDictionary, isPedagogicalKind, isMainlineKind } from './formal-kinds';
import { collectExerciseContent, connectExerciseSolutions, solutionTarget, type ExerciseSupportRange } from './exercise-structure';
export * from './formal-kinds';
export { associatedProofContent, exerciseSupportKind } from './exercise-structure';
import { analyzeProjectKnowledge, type ProjectKnowledgeSourceKind, type ProjectStructureAnalysis } from './project-knowledge';

export { analyzeProjectKnowledge } from './project-knowledge';
export type { ProjectKnowledgeAnalysis, ProjectKnowledgeDefinition, ProjectKnowledgeSource, ProjectKnowledgeSourceKind, ProjectStructureAnalysis } from './project-knowledge';

export interface LabelData {
    type: string;
    title: string;
    filePath: string;
    bookKey?: string;
    bookTitle?: string;
    bookOrder?: number;
    unitKind?: string;
    unitKey?: string;
    unitLabel?: string;
    unitOrder?: number;
    appendix?: string;
    chapter?: number;
    number?: number;
    volumeKey?: string;
    volumeTitle?: string;
    volumeOrder?: number;
    content?: string;
    proofContent?: string;
    supportContent?: string;
    supportRanges?: ExerciseSupportRange[];
    bodyEndLine?: number;
    solutionOf?: string;
    solutions?: string[];
    solutionExerciseNumber?: string;
    solutionExerciseTitle?: string;
    startLine?: number;
    endLine?: number;
    definitionOrigin?: DefinitionOrigin;
}

export type DefinitionOrigin = 'standard' | 'manual' | Extract<ProjectKnowledgeSourceKind, 'concept-appendix' | 'glossary'>;

export interface PageData {
    id?: string;
    kind: string;
    filePath: string;
    title: string;
    order: number;
    bookKey?: string;
    bookTitle?: string;
    bookOrder?: number;
    volumeKey?: string;
    volumeTitle?: string;
    volumeOrder?: number;
    unitKind?: string;
    unitKey?: string;
    unitLabel?: string;
    unitOrder?: number;
    chapter?: number;
    appendix?: string;
    line?: number;
    level?: number;
    integration?: PageIntegrationData;
    /**
     * Reader-only document grouping. Draft pages deliberately bypass the
     * formal scanner, so this is not a claim about formal coverage.
     */
    documentMode?: 'formal' | 'draft';
    documentCollectionId?: string;
    documentCollectionTitle?: string;
}

export type PageIntegrationStatus = 'managed' | 'segmented' | 'unmanaged' | 'attention';

/**
 * Describes whether a Markdown page has the stable structure Math Workspace
 * needs to index and address it. It is deliberately not a statement about
 * mathematical completeness, review status, or Lean coverage.
 */
export interface PageIntegrationData {
    status: PageIntegrationStatus;
    stableAnchorCount: number;
    temporaryAnchorCount: number;
    issueCount: number;
}

export interface FormalIssue {
    severity: 'error' | 'warn';
    code: string;
    file?: string;
    line?: number;
    message: string;
}

export interface FormalDefinition {
    id?: string;
    type: string;
    title: string;
    file: string;
    line: number;
    label: LabelData;
    aliases?: string[];
    origin?: DefinitionOrigin;
}

export interface RuntimeDefinitionData {
    title: string;
    aliases?: string[];
    filePath: string;
    line: number;
    content: string;
    bookKey?: string;
    bookTitle?: string;
    bookOrder?: number;
    volumeKey?: string;
    volumeTitle?: string;
    volumeOrder?: number;
    origin?: DefinitionOrigin;
}

export interface FormalSymbolInput {
    pattern: string;
    display?: string;
    meaning: string;
    scope?: string;
    source?: string;
}

export interface FormalDefinitionInput {
    term?: string;
    title?: string;
    aliases?: string[];
    source?: string;
    content?: string;
}

export interface RuntimeSymbolData {
    pattern: string;
    normalizedPattern: string;
    regex: string;
    captures: string[];
    display: string;
    meaning: string;
    scope: string;
    source?: string;
    sourceFilePath?: string;
    sourceLine?: number;
}

export interface LatexFormula {
    latex: string;
    display: boolean;
}

export interface FormalSymbolMatch {
    index: number;
    symbol: RuntimeSymbolData;
    formulaIndex: number;
}

export interface FormalReference {
    id: string;
    file: string;
    line: number;
}

export interface FormalPageReference {
    kind: 'chapter' | 'page';
    target: string;
    rawTarget: string;
    mode?: 'title' | 'full';
    file: string;
    line: number;
}

export type DependencyEdgeWhere = 'statement' | 'proof' | 'body';
export type DependencyEdgeRelation = 'strict' | 'explanatory';
export type DependencyGraphWhereFilter = DependencyEdgeWhere | 'all';
export type DependencyGraphMatrixScope = 'book' | 'volume' | 'chapter';

export interface DependencyGraphNode {
    id: string;
    kind: string;
    display: string;
    title: string;
    path: string;
    line: number;
    endLine?: number;
    bookKey?: string;
    bookTitle?: string;
    bookOrder?: number;
    volumeKey?: string;
    volumeTitle?: string;
    volumeOrder?: number;
    unitKind?: string;
    unitKey?: string;
    unitLabel?: string;
    unitOrder?: number;
    chapter?: number;
    appendix?: string;
    number?: number;
    sourceReferenceCount?: number;
}

export interface DependencyGraphEdge {
    from: string;
    to: string;
    kind: 'explicit_ref';
    where: DependencyEdgeWhere;
    relation: DependencyEdgeRelation;
    layer?: 'mathematical' | 'pedagogical';
    path: string;
    line: number;
}

export interface DependencyGraphDiagnostic {
    severity: 'info' | 'warn';
    code: string;
    file?: string;
    line?: number;
    message: string;
}

export interface DependencyGraphAmbientReference {
    to: string;
    path: string;
    line: number;
}

export interface DependencyGraphCycle {
    ids: string[];
    displays: string[];
}

export interface DependencyGraph {
    schemaVersion: 1;
    generatedBy: 'math-workspace';
    nodes: DependencyGraphNode[];
    edges: DependencyGraphEdge[];
    pedagogicalLinks?: Array<{ solution: string; exercise: string }>;
    ambientReferences: DependencyGraphAmbientReference[];
    cycles: DependencyGraphCycle[];
    diagnostics: DependencyGraphDiagnostic[];
    summary: {
        nodes: number;
        theoremLikeNodes: number;
        supplementalRemarkNodes: number;
        pedagogicalNodes?: number;
        pedagogicalEdges?: number;
        edges: number;
        theoremLikeEdges: number;
        supplementalRemarkEdges: number;
        isolated: number;
        cycles: number;
        crossBookEdges: number;
        crossVolumeEdges: number;
        crossChapterEdges: number;
        statementEdges: number;
        proofEdges: number;
        bodyEdges: number;
    };
}

export interface FormalDocument {
    filePath: string;
    content: string;
}

interface DependencySourceBlock {
    id: string;
    file: string;
    startLine: number;
    statementEndLine: number;
    proofStartLine?: number;
    proofEndLine?: number;
    endLine: number;
}

interface VolumeInfo {
    key: string;
    title: string;
    order: number;
}

interface BookInfo {
    key: string;
    title: string;
    order: number;
}

interface NumberingUnit {
    kind: 'chapter' | 'appendix';
    key: string;
    label: string;
    order: number;
    chapter?: number;
    appendix?: string;
}

interface UnitFile {
    filePath: string;
    content: string;
    book: BookInfo;
    volume?: VolumeInfo;
    unit: NumberingUnit;
    pageAnchor?: PageTitleHeading;
}

interface PageTitleHeading {
    id?: string;
    title: string;
    line: number;
    level: number;
}

export interface FormalMarker {
    type: string;
    id?: string;
    title: string;
    markerText: string;
    rest: string;
    level?: number;
    solutionOf?: string;
}

const PAGE_LABEL_TYPES = new Set(['chapter', 'intro', 'summary', 'appendix']);
const SYMBOL_PLACEHOLDER_RE = /\$\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const SYMBOL_SAMPLE_VALUES: Record<string, string> = {
    operator: 'T',
    ellipticOperator: 'D',
    parameter: '\\lambda',
    param: '\\lambda',
    time: 't',
    index: 'i',
    base: 'U',
    object: 'E',
    space: 'X',
    radius: 'R',
    mesh: 'h',
    left: 'x',
    right: 'y'
};
const STRUCTURED_NUMBERED_TYPES = new Set(['equation', 'figure', 'table']);

export const DEFAULT_CONFIG = {
    language: 'zh',
    dictionary: {
        zh: formalDictionary('zh'),
        en: formalDictionary('en')
    },
    ui: {
        zh: {
            back: '返回',
            toc: '目录',
            emptyToc: '暂无目录数据',
            units: '章节',
            chapter: '第 {number} 章',
            appendix: '附录 {label}',
            intro: '导读',
            summary: '小结',
            introBadge: '导',
            summaryBadge: '结',
            unvolumed: '未分卷',
            volume: '第 {number} 卷',
            book: '第 {number} 本',
            workspace: '工作区'
        },
        en: {
            back: 'Back',
            toc: 'Contents',
            emptyToc: 'No outline',
            units: 'Sections',
            chapter: 'Chapter {number}',
            appendix: 'Appendix {label}',
            intro: 'Intro',
            summary: 'Summary',
            introBadge: 'I',
            summaryBadge: 'S',
            unvolumed: 'Unvolumed',
            volume: 'Volume {number}',
            book: 'Book {number}',
            workspace: 'Workspace'
        }
    },
    scan: {
        exclude: [
            '.git/**',
            '.math-workspace/**',
            'node_modules/**',
            'out/**',
            'dist/**'
        ]
    },
    lookup: {
        bookDependencies: {}
    },
    lean: {
        projects: [],
        coverageTypes: DEFAULT_LEAN_COVERAGE_TYPES
    },
    render: {
        pageHeadingStyle: 'label-title'
    },
    pdf: {
        pdfEngine: 'xelatex',
        paper: 'a4',
        margin: '2.5cm',
        toc: true,
        tocDepth: 2,
        lang: '',
        tocTitle: '',
        title: '',
        subtitle: '',
        author: '',
        authorNative: '',
        authorAliases: [],
        orcid: '',
        repository: '',
        license: '',
        licenseUrl: '',
        preferredCitation: '',
        date: '',
        releaseVersion: '',
        releaseTag: '',
        releaseCommit: '',
        doi: '',
        showVersionOnCover: false,
        metadataPage: false,
        documentClass: '',
        titlePage: false,
        coverStyle: 'simple',
        titleSize: '32pt',
        subtitleSize: '18pt',
        authorSize: '12pt',
        dateSize: '12pt',
        tocPageBreak: true,
        frontMatter: [],
        variables: []
    },
    debug: {
        markerTraceIds: []
    }
};

export function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function normalizePdfFrontMatter(value: unknown): any[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(item => item && typeof item === 'object')
        .map((item: any) => ({
            title: typeof item.title === 'string' ? item.title : '',
            source: typeof item.source === 'string' ? item.source : '',
            content: typeof item.content === 'string' ? item.content : '',
            toc: item.toc === true,
            pageBreakAfter: item.pageBreakAfter === false ? false : true
        }))
        .filter(item => item.title || item.source || item.content);
}

export function mergeConfig(config: any): any {
    const existing = config && typeof config === 'object' ? config : {};
    const { preview: _legacyPreview, debug: rawDebug, ...baseConfig } = existing;
    const { previewLog: _legacyPreviewLog, ...debugConfig } = rawDebug && typeof rawDebug === 'object' ? rawDebug : {};
    return {
        ...baseConfig,
        language: existing.language === 'en' ? 'en' : 'zh',
        dictionary: {
            zh: { ...DEFAULT_CONFIG.dictionary.zh, ...(existing.dictionary?.zh || {}) },
            en: { ...DEFAULT_CONFIG.dictionary.en, ...(existing.dictionary?.en || {}) }
        },
        ui: {
            zh: { ...DEFAULT_CONFIG.ui.zh, ...(existing.ui?.zh || {}) },
            en: { ...DEFAULT_CONFIG.ui.en, ...(existing.ui?.en || {}) }
        },
        scan: {
            ...DEFAULT_CONFIG.scan,
            ...(existing.scan || {}),
            exclude: unique([
                ...DEFAULT_CONFIG.scan.exclude,
                ...(Array.isArray(existing.scan?.exclude) ? existing.scan.exclude.filter((item: unknown) => typeof item === 'string') : [])
            ])
        },
        lookup: {
            ...DEFAULT_CONFIG.lookup,
            ...(existing.lookup || {}),
            bookDependencies: existing.lookup?.bookDependencies && typeof existing.lookup.bookDependencies === 'object'
                ? existing.lookup.bookDependencies
                : {}
        },
        lean: {
            ...DEFAULT_CONFIG.lean,
            ...(existing.lean || {}),
            projects: (Array.isArray(existing.lean?.projects) ? existing.lean.projects : [])
                .filter((project: unknown) => project && typeof project === 'object')
                .map((project: any) => ({
                    ...project,
                    key: typeof project.key === 'string' ? project.key : '',
                    root: typeof project.root === 'string' ? project.root : '',
                    sourceRoots: unique((Array.isArray(project.sourceRoots) ? project.sourceRoots : ['.'])
                        .filter((item: unknown) => typeof item === 'string')),
                    target: typeof project.target === 'string' ? project.target : '',
                    anchorPrefix: typeof project.anchorPrefix === 'string' && project.anchorPrefix.trim()
                        ? project.anchorPrefix.trim()
                        : 'Math Workspace anchor:'
                })),
            coverageTypes: unique((Array.isArray(existing.lean?.coverageTypes)
                ? existing.lean.coverageTypes
                : DEFAULT_CONFIG.lean.coverageTypes)
                .filter((item: unknown) => typeof item === 'string'))
        },
        render: {
            ...DEFAULT_CONFIG.render,
            ...(existing.render || {}),
            pageHeadingStyle: ['title', 'number-title', 'label-title'].includes(existing.render?.pageHeadingStyle)
                ? existing.render.pageHeadingStyle
                : DEFAULT_CONFIG.render.pageHeadingStyle
        },
        pdf: {
            ...DEFAULT_CONFIG.pdf,
            ...(existing.pdf || {}),
            pdfEngine: typeof existing.pdf?.pdfEngine === 'string' && existing.pdf.pdfEngine ? existing.pdf.pdfEngine : DEFAULT_CONFIG.pdf.pdfEngine,
            paper: typeof existing.pdf?.paper === 'string' && existing.pdf.paper ? existing.pdf.paper : DEFAULT_CONFIG.pdf.paper,
            margin: typeof existing.pdf?.margin === 'string' && existing.pdf.margin ? existing.pdf.margin : DEFAULT_CONFIG.pdf.margin,
            toc: existing.pdf?.toc === false ? false : DEFAULT_CONFIG.pdf.toc,
            tocDepth: Number.isFinite(Number(existing.pdf?.tocDepth)) && Number(existing.pdf.tocDepth) >= 1
                ? Math.floor(Number(existing.pdf.tocDepth))
                : DEFAULT_CONFIG.pdf.tocDepth,
            lang: typeof existing.pdf?.lang === 'string' ? existing.pdf.lang : DEFAULT_CONFIG.pdf.lang,
            tocTitle: typeof existing.pdf?.tocTitle === 'string' ? existing.pdf.tocTitle : DEFAULT_CONFIG.pdf.tocTitle,
            title: typeof existing.pdf?.title === 'string' ? existing.pdf.title : DEFAULT_CONFIG.pdf.title,
            subtitle: typeof existing.pdf?.subtitle === 'string' ? existing.pdf.subtitle : DEFAULT_CONFIG.pdf.subtitle,
            author: typeof existing.pdf?.author === 'string' ? existing.pdf.author : DEFAULT_CONFIG.pdf.author,
            authorNative: typeof existing.pdf?.authorNative === 'string' ? existing.pdf.authorNative : DEFAULT_CONFIG.pdf.authorNative,
            authorAliases: unique(Array.isArray(existing.pdf?.authorAliases)
                ? existing.pdf.authorAliases.filter((item: unknown) => typeof item === 'string')
                : []),
            orcid: typeof existing.pdf?.orcid === 'string' ? existing.pdf.orcid : DEFAULT_CONFIG.pdf.orcid,
            repository: typeof existing.pdf?.repository === 'string' ? existing.pdf.repository : DEFAULT_CONFIG.pdf.repository,
            license: typeof existing.pdf?.license === 'string' ? existing.pdf.license : DEFAULT_CONFIG.pdf.license,
            licenseUrl: typeof existing.pdf?.licenseUrl === 'string' ? existing.pdf.licenseUrl : DEFAULT_CONFIG.pdf.licenseUrl,
            preferredCitation: typeof existing.pdf?.preferredCitation === 'string' ? existing.pdf.preferredCitation : DEFAULT_CONFIG.pdf.preferredCitation,
            date: typeof existing.pdf?.date === 'string' ? existing.pdf.date : DEFAULT_CONFIG.pdf.date,
            releaseVersion: typeof existing.pdf?.releaseVersion === 'string' ? existing.pdf.releaseVersion : DEFAULT_CONFIG.pdf.releaseVersion,
            releaseTag: typeof existing.pdf?.releaseTag === 'string' ? existing.pdf.releaseTag : DEFAULT_CONFIG.pdf.releaseTag,
            releaseCommit: typeof existing.pdf?.releaseCommit === 'string' ? existing.pdf.releaseCommit : DEFAULT_CONFIG.pdf.releaseCommit,
            doi: typeof existing.pdf?.doi === 'string' ? existing.pdf.doi : DEFAULT_CONFIG.pdf.doi,
            showVersionOnCover: existing.pdf?.showVersionOnCover === true,
            metadataPage: existing.pdf?.metadataPage === true,
            documentClass: typeof existing.pdf?.documentClass === 'string' ? existing.pdf.documentClass : DEFAULT_CONFIG.pdf.documentClass,
            titlePage: existing.pdf?.titlePage === true,
            coverStyle: typeof existing.pdf?.coverStyle === 'string' && existing.pdf.coverStyle ? existing.pdf.coverStyle : DEFAULT_CONFIG.pdf.coverStyle,
            titleSize: typeof existing.pdf?.titleSize === 'string' && existing.pdf.titleSize ? existing.pdf.titleSize : DEFAULT_CONFIG.pdf.titleSize,
            subtitleSize: typeof existing.pdf?.subtitleSize === 'string' && existing.pdf.subtitleSize ? existing.pdf.subtitleSize : DEFAULT_CONFIG.pdf.subtitleSize,
            authorSize: typeof existing.pdf?.authorSize === 'string' && existing.pdf.authorSize ? existing.pdf.authorSize : DEFAULT_CONFIG.pdf.authorSize,
            dateSize: typeof existing.pdf?.dateSize === 'string' && existing.pdf.dateSize ? existing.pdf.dateSize : DEFAULT_CONFIG.pdf.dateSize,
            tocPageBreak: existing.pdf?.tocPageBreak === false ? false : DEFAULT_CONFIG.pdf.tocPageBreak,
            frontMatter: normalizePdfFrontMatter(existing.pdf?.frontMatter),
            variables: unique(Array.isArray(existing.pdf?.variables)
                ? existing.pdf.variables.filter((item: unknown) => typeof item === 'string')
                : [])
        },
        debug: {
            ...DEFAULT_CONFIG.debug,
            ...debugConfig,
            markerTraceIds: unique(Array.isArray(existing.debug?.markerTraceIds)
                ? existing.debug.markerTraceIds.filter((item: unknown) => typeof item === 'string')
                : [])
        }
    };
}

function normalizeScanPath(value: string): string {
    return toPosix(String(value || ''))
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
}

function globPatternToRegExp(pattern: string): RegExp {
    let source = '';
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === '*') {
            if (pattern[i + 1] === '*') {
                source += '.*';
                i++;
            } else {
                source += '[^/]*';
            }
            continue;
        }
        if (char === '?') {
            source += '[^/]';
            continue;
        }
        source += escapeRegExp(char);
    }
    return new RegExp(`^${source}$`);
}

function scanPatternMatches(filePath: string, pattern: string): boolean {
    const file = normalizeScanPath(filePath);
    const normalizedPattern = normalizeScanPath(pattern);
    if (!file || !normalizedPattern) return false;

    if (!/[*?]/.test(normalizedPattern)) {
        if (!normalizedPattern.includes('/')) {
            return file.split('/').includes(normalizedPattern);
        }
        return file === normalizedPattern || file.startsWith(`${normalizedPattern}/`);
    }

    if (normalizedPattern.endsWith('/**')) {
        const base = normalizeScanPath(normalizedPattern.slice(0, -3));
        if (file === base || file.startsWith(`${base}/`)) return true;
    }

    const direct = globPatternToRegExp(normalizedPattern);
    if (direct.test(file)) return true;

    if (!normalizedPattern.startsWith('**/') && !normalizedPattern.includes('/')) {
        return file.split('/').some(segment => direct.test(segment));
    }

    return false;
}

export function pathPatternMatches(filePath: string, pattern: string): boolean {
    return scanPatternMatches(filePath, pattern);
}

export function scanExcludePatterns(config: any): string[] {
    const merged = mergeConfig(config);
    return Array.isArray(merged.scan?.exclude) ? merged.scan.exclude : [];
}

export function shouldExcludeScanPath(filePath: string, config: any): boolean {
    return scanExcludePatterns(config).some(pattern => scanPatternMatches(filePath, pattern));
}

export function getLanguage(config: any): 'zh' | 'en' {
    return config && config.language === 'en' ? 'en' : 'zh';
}

export function formatTemplate(template: string, values: Record<string, string> = {}): string {
    return template.replace(/\{(\w+)\}/g, (_match, key) => values[key] || '');
}

export function uiText(config: any, key: string, values: Record<string, string> = {}): string {
    const language = getLanguage(config);
    const text = config?.ui?.[language]?.[key] || DEFAULT_CONFIG.ui[language]?.[key] || DEFAULT_CONFIG.ui.zh[key] || '';
    return formatTemplate(text, values);
}

export function typeName(config: any, type: string): string {
    const language = getLanguage(config);
    return config?.dictionary?.[language]?.[type] || DEFAULT_CONFIG.dictionary[language]?.[type] || type;
}

export function normalizeFormalPagePath(target: string, sourceFilePath = ''): string {
    let value = toPosix(String(target || '').trim()).replace(/^\/+/, '');
    if (!value) return '';

    if (/^\.\.?\//.test(value)) {
        const baseDir = sourceFilePath ? path.posix.dirname(toPosix(sourceFilePath)) : '';
        value = path.posix.join(baseDir, value);
    }

    return path.posix.normalize(value).replace(/^\.\/+/, '').replace(/^\/+/, '');
}

export function formatPageReference(page: PageData, config: any, mode: 'default' | 'title' | 'full' = 'default'): string {
    const title = page.title || page.filePath;
    let label = title;

    if (page.kind === 'chapter' && page.chapter !== undefined) {
        label = uiText(config, 'chapter', { number: String(page.chapter) });
    } else if (page.kind === 'appendix' && page.appendix) {
        label = uiText(config, 'appendix', { label: page.appendix });
    } else if (page.kind === 'intro') {
        label = uiText(config, 'intro');
    } else if (page.kind === 'summary') {
        label = uiText(config, 'summary');
    }

    if (mode === 'title') return title;
    if (mode === 'full') {
        if (!title || title === label) return label;
        const colon = getLanguage(config) === 'en' ? ': ' : '：';
        return `${label}${colon}${title}`;
    }
    return label;
}

function pageHeadingStyle(config: any): 'title' | 'number-title' | 'label-title' {
    const style = config?.render?.pageHeadingStyle;
    return style === 'title' || style === 'number-title' || style === 'label-title' ? style : 'label-title';
}

function pageHeadingLabel(page: PageData, config: any, style: 'number-title' | 'label-title'): string {
    if (page.kind === 'chapter') {
        const number = page.unitLabel || (page.chapter !== undefined ? String(page.chapter) : '');
        if (!number) return '';
        return style === 'number-title' ? number : uiText(config, 'chapter', { number });
    }

    if (page.kind === 'appendix') {
        const label = page.unitLabel || page.appendix || '';
        if (!label) return '';
        return style === 'number-title' ? label : uiText(config, 'appendix', { label });
    }

    return '';
}

function startsWithPageHeadingLabel(title: string, label: string): boolean {
    const normalizedTitle = title.replace(/\s+/g, ' ').trim();
    const normalizedLabel = label.replace(/\s+/g, ' ').trim();
    if (!normalizedTitle || !normalizedLabel) return false;
    if (normalizedTitle === normalizedLabel) return true;
    if (normalizedTitle.startsWith(normalizedLabel)) {
        const next = normalizedTitle.slice(normalizedLabel.length, normalizedLabel.length + 1);
        if (!next || /[\s:：,，.．、\-]/.test(next)) return true;
    }

    const compactTitle = normalizedTitle.replace(/\s+/g, '');
    const compactLabel = normalizedLabel.replace(/\s+/g, '');
    if (!compactTitle || !compactLabel || !compactTitle.startsWith(compactLabel)) return false;
    const next = compactTitle.slice(compactLabel.length, compactLabel.length + 1);
    return !next || !/[A-Za-z0-9]/.test(next);
}

export function formatPageHeadingPrefix(page: PageData, config: any): string {
    const style = pageHeadingStyle(config);
    if (style === 'title') return '';

    const label = pageHeadingLabel(page, config, style);
    if (!label) return '';

    const title = page.title || '';
    if (startsWithPageHeadingLabel(title, label)) return '';

    return label;
}

export function formatPageHeading(page: PageData, config: any): string {
    const title = page.title || page.filePath;
    const prefix = formatPageHeadingPrefix(page, config);
    return prefix ? `${prefix} ${title}` : title;
}

export function getContentPreview(content: string, maxLength = 240): string {
    const text = content
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/^[ \t]{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+)/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}...` : text;
}

export function normalizeLatexSymbol(value: string): string {
    return String(value || '')
        .trim()
        .replace(/^\$+|\$+$/g, '')
        .replace(/\\left\s*/g, '')
        .replace(/\\right\s*/g, '')
        .replace(/\\operatorname\s*\{([^{}]+)\}/g, '\\$1')
        .replace(/\\([A-Za-z]+)\s+\{([^{}]+)\}/g, '\\$1{$2}')
        .replace(/\s+/g, '')
        .replace(/([_^])([A-Za-z0-9\\])(?![A-Za-z0-9{])/g, '$1{$2}');
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileSymbolPattern(pattern: string): { normalizedPattern: string; regex: string; captures: string[] } {
    const normalizedPattern = normalizeLatexSymbol(pattern);
    const captures: string[] = [];
    let regex = '^';
    let cursor = 0;
    let match: RegExpExecArray | null;
    SYMBOL_PLACEHOLDER_RE.lastIndex = 0;

    while ((match = SYMBOL_PLACEHOLDER_RE.exec(normalizedPattern))) {
        regex += escapeRegex(normalizedPattern.slice(cursor, match.index));
        captures.push(match[1]);
        regex += '(.+?)';
        cursor = match.index + match[0].length;
    }

    regex += escapeRegex(normalizedPattern.slice(cursor));
    regex += '$';
    return { normalizedPattern, regex, captures };
}

function isEscapedMarkdownCharacter(value: string, index: number): boolean {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor--) slashes++;
    return slashes % 2 === 1;
}

function findInlineDollarEnd(value: string, start: number): number {
    for (let cursor = start; cursor < value.length; cursor++) {
        if (value[cursor] === '$' && value[cursor + 1] !== '$' && !isEscapedMarkdownCharacter(value, cursor)) return cursor;
    }
    return -1;
}

function collectInlineLatex(value: string, formulas: LatexFormula[]): void {
    for (let cursor = 0; cursor < value.length; cursor++) {
        if (value[cursor] === '\\' && value[cursor + 1] === '(' && !isEscapedMarkdownCharacter(value, cursor)) {
            const end = value.indexOf('\\)', cursor + 2);
            if (end >= 0) {
                formulas.push({ latex: value.slice(cursor + 2, end).trim(), display: false });
                cursor = end + 1;
            }
            continue;
        }

        if (value[cursor] !== '$' || value[cursor + 1] === '$' || isEscapedMarkdownCharacter(value, cursor)) continue;
        const end = findInlineDollarEnd(value, cursor + 1);
        if (end >= 0) {
            formulas.push({ latex: value.slice(cursor + 1, end).trim(), display: false });
            cursor = end;
        }
    }
}

/** Extract only author-written LaTeX from Markdown; code fences are deliberately ignored. */
export function extractLatexFormulas(content: string): LatexFormula[] {
    const formulas: LatexFormula[] = [];
    let inFence = false;
    let blockDelimiter = '';
    let blockBuffer: string[] = [];

    for (const line of String(content || '').split(/\r?\n/)) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;

        if (blockDelimiter) {
            const close = line.indexOf(blockDelimiter);
            if (close < 0) {
                blockBuffer.push(line);
                continue;
            }
            const delimiter = blockDelimiter;
            blockBuffer.push(line.slice(0, close));
            formulas.push({ latex: blockBuffer.join('\n').trim(), display: true });
            blockDelimiter = '';
            blockBuffer = [];
            collectInlineLatex(line.slice(close + delimiter.length), formulas);
            continue;
        }

        const blockStart = line.search(/(?:\$\$|\\\[)/);
        if (blockStart < 0) {
            collectInlineLatex(line, formulas);
            continue;
        }

        const delimiter = line.slice(blockStart, blockStart + 2);
        const closeDelimiter = delimiter === '$$' ? '$$' : '\\]';
        const close = line.indexOf(closeDelimiter, blockStart + 2);
        collectInlineLatex(line.slice(0, blockStart), formulas);
        if (close >= 0) {
            formulas.push({ latex: line.slice(blockStart + 2, close).trim(), display: true });
            collectInlineLatex(line.slice(close + 2), formulas);
            continue;
        }
        blockDelimiter = closeDelimiter;
        blockBuffer = [line.slice(blockStart + 2)];
    }

    return formulas.filter(formula => formula.latex);
}

function makeUnanchoredSymbolRegex(symbol: RuntimeSymbolData): RegExp | undefined {
    const source = String(symbol.regex || '').replace(/^\^/, '').replace(/\$$/, '');
    if (!source || source === '(.+?)') return undefined;
    try {
        return new RegExp(source);
    } catch (_err) {
        return undefined;
    }
}

function symbolMatchesLatex(symbol: RuntimeSymbolData, latex: string): boolean {
    const normalized = normalizeLatexSymbol(latex);
    if (!normalized) return false;
    const regex = makeUnanchoredSymbolRegex(symbol);
    if (regex?.test(normalized)) return true;

    const pattern = normalizeLatexSymbol(symbol.pattern);
    if (pattern && !pattern.includes('${') && normalized.includes(pattern)) return true;

    const display = normalizeLatexSymbol(symbol.display);
    return Boolean(display && normalized.includes(display));
}

/** Return project-defined notation that actually occurs in the supplied Markdown page. */
export function findSymbolsInMarkdown(content: string, symbols: RuntimeSymbolData[]): FormalSymbolMatch[] {
    const formulas = extractLatexFormulas(content);
    const matches = symbols.map((symbol, index) => ({
        index,
        symbol,
        formulaIndex: formulas.findIndex(formula => symbolMatchesLatex(symbol, formula.latex))
    })).filter(match => match.formulaIndex >= 0);

    return matches.sort((left, right) => (
        left.formulaIndex - right.formulaIndex
        || `${left.symbol.sourceFilePath || ''}:${left.symbol.sourceLine || 0}`.localeCompare(`${right.symbol.sourceFilePath || ''}:${right.symbol.sourceLine || 0}`)
        || left.symbol.pattern.localeCompare(right.symbol.pattern)
    ));
}

function hasBalancedSymbolDelimiters(value: string): boolean {
    const pairs: Record<string, string> = { ')': '(', ']': '[' };
    const stack: string[] = [];
    for (const char of value) {
        if (char === '(' || char === '[') {
            stack.push(char);
            continue;
        }
        if (char === ')' || char === ']') {
            if (stack.pop() !== pairs[char]) return false;
        }
    }
    return stack.length === 0;
}

function parseSourceLocation(source: string | undefined): { sourceFilePath?: string; sourceLine?: number } {
    if (!source) return {};
    const match = String(source).match(/^(.+?)(?::(\d+))?$/);
    if (!match) return {};
    return {
        sourceFilePath: toPosix(match[1]).replace(/^\/+/, ''),
        sourceLine: match[2] ? Number(match[2]) : undefined
    };
}

function symbolSampleValue(name: string): string {
    return SYMBOL_SAMPLE_VALUES[name] || 'x';
}

function makeSymbolDisplay(pattern: string): string {
    return `$${pattern.replace(/\$\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name) => symbolSampleValue(name))}$`;
}

function normalizeSymbolDocuments(documents: Array<FormalDocument | string>): FormalDocument[] {
    return documents.map(document => typeof document === 'string'
        ? { filePath: document, content: '' }
        : document
    );
}

export function parseFormalSymbols(input: unknown, documents: Array<FormalDocument | string> = []): { symbols: RuntimeSymbolData[]; issues: FormalIssue[] } {
    const issues: FormalIssue[] = [];
    const rawSymbols = Array.isArray(input)
        ? input
        : input && typeof input === 'object' && Array.isArray((input as any).symbols)
            ? (input as any).symbols
            : [];

    if (input !== undefined && input !== null && !Array.isArray(input) && !(typeof input === 'object' && Array.isArray((input as any).symbols))) {
        issues.push({
            severity: 'error',
            code: 'invalid-symbols-file',
            file: '.math-workspace/symbols.json',
            message: '.math-workspace/symbols.json must be an array, or an object with a symbols array.'
        });
        return { symbols: [], issues };
    }

    const normalizedDocuments = normalizeSymbolDocuments(documents);
    const fileSet = new Set(normalizedDocuments.map(document => toPosix(document.filePath).replace(/^\/+/, '')));
    const lineCounts = new Map(normalizedDocuments.map(document => [
        toPosix(document.filePath).replace(/^\/+/, ''),
        document.content ? document.content.split(/\r\n|\r|\n/).length : 0
    ]));
    const seen = new Map<string, number>();
    const symbols: RuntimeSymbolData[] = [];
    rawSymbols.forEach((item: any, index: number) => {
        if (!item || typeof item !== 'object') {
            issues.push({
                severity: 'error',
                code: 'invalid-symbol-entry',
                file: '.math-workspace/symbols.json',
                line: index + 1,
                message: 'Symbol entry must be an object.'
            });
            return;
        }

        const pattern = typeof item.pattern === 'string' ? item.pattern.trim() : '';
        const meaning = typeof item.meaning === 'string' ? item.meaning.trim() : '';
        const source = typeof item.source === 'string' && item.source.trim() ? item.source.trim() : '';
        if (!pattern || !meaning || !source) {
            issues.push({
                severity: 'error',
                code: 'invalid-symbol-entry',
                file: '.math-workspace/symbols.json',
                line: index + 1,
                message: 'Symbol entry requires non-empty source, pattern, and meaning.'
            });
            return;
        }

        const compiled = compileSymbolPattern(pattern);
        const display = typeof item.display === 'string' && item.display.trim() ? item.display.trim() : makeSymbolDisplay(pattern);
        const scope = typeof item.scope === 'string' && item.scope.trim() ? item.scope.trim() : 'book';
        const parsedSource = parseSourceLocation(source);

        if (!parsedSource.sourceFilePath || parsedSource.sourceLine === undefined) {
            issues.push({
                severity: 'error',
                code: 'symbol-source-invalid',
                file: '.math-workspace/symbols.json',
                line: index + 1,
                message: `Symbol source ${source} must use path.md:line format.`
            });
            return;
        }

        if (fileSet.size > 0 && !fileSet.has(parsedSource.sourceFilePath)) {
            issues.push({
                severity: 'error',
                code: 'symbol-source-missing',
                file: '.math-workspace/symbols.json',
                line: index + 1,
                message: `Symbol source ${source} does not point to a known Markdown file.`
            });
            return;
        }

        const lineCount = lineCounts.get(parsedSource.sourceFilePath) || 0;
        if (lineCount > 0 && (parsedSource.sourceLine < 1 || parsedSource.sourceLine > lineCount)) {
            issues.push({
                severity: 'error',
                code: 'symbol-source-line-missing',
                file: '.math-workspace/symbols.json',
                line: index + 1,
                message: `Symbol source ${source} points outside the source file.`
            });
            return;
        }

        if (!new RegExp(compiled.regex).test(normalizeLatexSymbol(display))) {
            issues.push({
                severity: 'warn',
                code: 'symbol-display-mismatch',
                file: '.math-workspace/symbols.json',
                line: index + 1,
                message: `Symbol display ${display} does not match pattern ${pattern}.`
            });
        }

        if (/^\$\{[A-Za-z][A-Za-z0-9_]*\}$/.test(compiled.normalizedPattern)) {
            issues.push({
                severity: 'warn',
                code: 'symbol-pattern-too-broad',
                file: '.math-workspace/symbols.json',
                line: index + 1,
                message: `Symbol pattern ${pattern} is only a placeholder and may match unrelated formulas.`
            });
        }

        if (!hasBalancedSymbolDelimiters(compiled.normalizedPattern)) {
            issues.push({
                severity: 'warn',
                code: 'symbol-pattern-unbalanced-delimiter',
                file: '.math-workspace/symbols.json',
                line: index + 1,
                message: `Symbol pattern ${pattern} has unbalanced parentheses or brackets and may match a surrounding formula instead of the notation itself.`
            });
        }

        const duplicateKey = `${scope}:${compiled.normalizedPattern}:${parsedSource.sourceFilePath}`;
        const previousIndex = seen.get(duplicateKey);
        if (previousIndex !== undefined) {
            issues.push({
                severity: 'warn',
                code: 'duplicate-symbol-pattern',
                file: '.math-workspace/symbols.json',
                line: index + 1,
                message: `Symbol pattern duplicates entry ${previousIndex + 1} in the same scope and source file.`
            });
        }
        seen.set(duplicateKey, index);

        symbols.push({
            pattern,
            normalizedPattern: compiled.normalizedPattern,
            regex: compiled.regex,
            captures: compiled.captures,
            display,
            meaning,
            scope,
            source,
            ...parsedSource
        });
    });

    return { symbols, issues };
}

function normalizeDefinitionAliases(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return unique(value
        .filter(alias => typeof alias === 'string')
        .map(alias => alias.trim())
        .filter(Boolean));
}

function normalizeDefinitionContentForMatch(value: string): string {
    return value
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
}

export function parseFormalDefinitions(input: unknown, documents: Array<FormalDocument | string> = [], configInput: any = DEFAULT_CONFIG): { definitions: FormalDefinition[]; issues: FormalIssue[] } {
    const issues: FormalIssue[] = [];
    const rawDefinitions = Array.isArray(input)
        ? input
        : input && typeof input === 'object' && Array.isArray((input as any).definitions)
            ? (input as any).definitions
            : [];

    if (input !== undefined && input !== null && !Array.isArray(input) && !(typeof input === 'object' && Array.isArray((input as any).definitions))) {
        issues.push({
            severity: 'error',
            code: 'invalid-definitions-file',
            file: '.math-workspace/definitions.json',
            message: '.math-workspace/definitions.json must be an array, or an object with a definitions array.'
        });
        return { definitions: [], issues };
    }

    const config = mergeConfig(configInput);
    const normalizedDocuments = normalizeSymbolDocuments(documents);
    const documentMap = new Map(normalizedDocuments.map(document => [
        toPosix(document.filePath).replace(/^\/+/, ''),
        document.content || ''
    ]));
    const seen = new Map<string, number>();
    const definitions: FormalDefinition[] = [];

    rawDefinitions.forEach((item: any, index: number) => {
        if (!item || typeof item !== 'object') {
            issues.push({
                severity: 'error',
                code: 'invalid-definition-entry',
                file: '.math-workspace/definitions.json',
                line: index + 1,
                message: 'Definition entry must be an object.'
            });
            return;
        }

        const title = typeof item.term === 'string' && item.term.trim()
            ? item.term.trim()
            : typeof item.title === 'string' && item.title.trim()
                ? item.title.trim()
                : '';
        const source = typeof item.source === 'string' && item.source.trim() ? item.source.trim() : '';
        const aliases = normalizeDefinitionAliases(item.aliases).filter(alias => alias !== title);
        if (!title || !source) {
            issues.push({
                severity: 'error',
                code: 'invalid-definition-entry',
                file: '.math-workspace/definitions.json',
                line: index + 1,
                message: 'Definition entry requires non-empty term/title and source.'
            });
            return;
        }

        const parsedSource = parseSourceLocation(source);
        if (!parsedSource.sourceFilePath || parsedSource.sourceLine === undefined) {
            issues.push({
                severity: 'error',
                code: 'definition-source-invalid',
                file: '.math-workspace/definitions.json',
                line: index + 1,
                message: `Definition source ${source} must use path.md:line format.`
            });
            return;
        }

        const documentContent = documentMap.get(parsedSource.sourceFilePath);
        if (documentContent === undefined) {
            issues.push({
                severity: 'error',
                code: 'definition-source-missing',
                file: '.math-workspace/definitions.json',
                line: index + 1,
                message: `Definition source ${source} does not point to a known Markdown file.`
            });
            return;
        }

        const lines = documentContent.split(/\r\n|\r|\n/);
        if (parsedSource.sourceLine < 1 || parsedSource.sourceLine > lines.length) {
            issues.push({
                severity: 'error',
                code: 'definition-source-line-missing',
                file: '.math-workspace/definitions.json',
                line: index + 1,
                message: `Definition source ${source} points outside the source file.`
            });
            return;
        }

        const extracted = sourceLineRangeContent(lines, parsedSource.sourceLine);
        const explicitContent = typeof item.content === 'string' && item.content.trim() ? item.content.trim() : '';
        if (!explicitContent) {
            issues.push({
                severity: 'warn',
                code: 'definition-content-missing',
                file: '.math-workspace/definitions.json',
                line: index + 1,
                message: `Definition entry ${title} should include AI-maintained content; falling back to source extraction.`
            });
        } else if (!normalizeDefinitionContentForMatch(documentContent).includes(normalizeDefinitionContentForMatch(explicitContent))) {
            issues.push({
                severity: 'warn',
                code: 'definition-content-stale',
                file: '.math-workspace/definitions.json',
                line: index + 1,
                message: `Definition entry ${title} content is not found in its source file near ${source}; update content after editing the source.`
            });
        }
        const content = explicitContent || extracted.content;
        const duplicateKey = `${title}:${parsedSource.sourceFilePath}:${parsedSource.sourceLine}`;
        const previousIndex = seen.get(duplicateKey);
        if (previousIndex !== undefined) {
            issues.push({
                severity: 'warn',
                code: 'duplicate-definition-entry',
                file: '.math-workspace/definitions.json',
                line: index + 1,
                message: `Definition entry duplicates entry ${previousIndex + 1}.`
            });
        }
        seen.set(duplicateKey, index);

        const book = inferBookInfo(parsedSource.sourceFilePath, config);
        const volume = inferVolumeInfo(parsedSource.sourceFilePath, config);
        const label: LabelData = {
            type: 'def',
            title,
            filePath: parsedSource.sourceFilePath,
            bookKey: book.key,
            bookTitle: book.title,
            bookOrder: book.order,
            content,
            startLine: extracted.startLine,
            endLine: extracted.endLine
        };
        if (volume) {
            label.volumeKey = volume.key;
            label.volumeTitle = volume.title;
            label.volumeOrder = volume.order;
        }

        definitions.push({
            type: 'def',
            title,
            aliases,
            file: parsedSource.sourceFilePath,
            line: parsedSource.sourceLine,
            label
        });
    });

    return { definitions, issues };
}

export function stripIgnoredMarkdown(content: string): string {
    return content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/~~~[\s\S]*?~~~/g, '')
        .replace(/`[^`\n]*`/g, '');
}

function cleanMarkerTitle(title: string): string {
    const trimmed = title.trim();
    const strong = trimmed.match(/^(\*\*|__)\s*([\s\S]+?)\s*\1$/);
    return strong ? strong[2].trim() : trimmed;
}

function unwrapLeadingStrong(text: string): string | undefined {
    const strong = text.match(/^(\*\*|__)\s*([\s\S]+?)\s*\1([\s\S]*)$/);
    if (!strong) return undefined;
    return `${strong[2].trim()}${strong[3] || ''}`.trim();
}

function parseParenMarkerTitle(text: string, requireSeparator: boolean): string {
    const paren = text.match(/^[（(]([^）)]+)[）)]\s*([：:]?)/);
    if (!paren) return '';
    if (requireSeparator && !paren[2]) return '';
    return cleanMarkerTitle(paren[1]);
}

function extractMarkerTitle(type: string, rest: string): string {
    const trimmed = rest.trim();
    if (!trimmed) return '';

    const strongPrefix = unwrapLeadingStrong(trimmed);
    if (strongPrefix) {
        const strongTitle = parseParenMarkerTitle(strongPrefix, true);
        if (strongTitle) return strongTitle;
    }

    const parenTitle = parseParenMarkerTitle(trimmed, false);
    if (parenTitle) return parenTitle;

    if (type === 'def') {
        const term = trimmed.match(/^([^：:\n，,。.;；]+)[：:]/);
        if (term) return term[1].trim();
    }

    return '';
}

function normalizeLeadingMarkerEmphasis(text: string): string {
    const trimmed = text.trim().replace(/^(?:>\s*)+/, '').trim();
    return unwrapLeadingStrong(trimmed) || trimmed;
}

export function parseFormalMarkerLine(line: string): FormalMarker | undefined {
    const heading = line.match(/^(#{1,6})\s+#([A-Za-z0-9_-]+)\s+(.+?)\s*$/);
    if (heading) {
        return {
            type: 'section',
            id: heading[2],
            title: heading[3].trim(),
            markerText: `#${heading[2]}`,
            rest: heading[3].trim(),
            level: heading[1].length
        };
    }

    const text = normalizeLeadingMarkerEmphasis(line);
    const typePattern = FORMAL_TYPE_PATTERN;
    const typed = text.match(new RegExp(`^(${typePattern})\\s*([\\s\\S]*)$`, 'i'));
    if (!typed) return undefined;

    const type = normalizeFormalKind(typed[1]);
    if (!type) return undefined;

    if (type === 'def') {
        const rest = typed[2] || '';
        if (!/^\s*[（(]/.test(rest)) return undefined;
        const title = extractMarkerTitle(type, rest);
        if (!title) return undefined;
        return {
            type,
            title,
            markerText: typed[1],
            rest
        };
    }

    const match = text.match(new RegExp(`^(${typePattern})\\s+#([A-Za-z0-9_-]+)\\b\\s*([\\s\\S]*)$`, 'i'));
    if (!match) return undefined;

    const rest = match[3] || '';
    const parsedTitle = extractMarkerTitle(type, rest);
    const solution = type === 'solution' ? solutionTarget(parsedTitle) : undefined;
    return {
        type,
        id: match[2],
        title: solution ? solution.title : parsedTitle,
        solutionOf: solution?.id,
        markerText: `${match[1]} #${match[2]}`,
        rest
    };
}

function parseVolumeOrder(value: string): number {
    if (/^\d+$/.test(value)) return parseInt(value, 10);

    const roman = value.toUpperCase();
    if (!/^[IVXLCDM]+$/.test(roman)) return Number.MAX_SAFE_INTEGER;

    const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    let previous = 0;
    for (let i = roman.length - 1; i >= 0; i--) {
        const current = values[roman[i]] || 0;
        total += current < previous ? -current : current;
        previous = Math.max(previous, current);
    }
    return total || Number.MAX_SAFE_INTEGER;
}

function inferBookInfo(filePath: string, config: any): BookInfo {
    const segment = filePath
        .split('/')
        .find(part => /^book[-_\s]?(?:\d+|[a-z0-9]+)(?:[-_\s].*)?$/i.test(part));
    if (!segment) {
        return { key: '__workspace__', title: uiText(config, 'workspace'), order: 0 };
    }

    const match = segment.match(/^book[-_\s]?(\d+|[ivxlcdm]+)?(?:[-_\s].*)?$/i);
    const order = match && match[1] ? parseVolumeOrder(match[1]) : Number.MAX_SAFE_INTEGER;
    const title = order === Number.MAX_SAFE_INTEGER ? segment.replace(/[-_]+/g, ' ') : uiText(config, 'book', { number: String(order) });
    return { key: segment.toLowerCase(), title, order };
}

function inferVolumeInfo(filePath: string, config: any): VolumeInfo | undefined {
    const segment = filePath
        .split('/')
        .find(part => /^(?:vol|volume)[-_\s]?(?:\d+|[ivxlcdm]+)(?:[-_\s].*)?$/i.test(part));
    if (!segment) return undefined;

    const match = segment.match(/^(?:vol|volume)[-_\s]?(\d+|[ivxlcdm]+)(?:[-_\s].*)?$/i);
    const order = match ? parseVolumeOrder(match[1]) : Number.MAX_SAFE_INTEGER;
    const title = order === Number.MAX_SAFE_INTEGER ? segment.replace(/[-_]+/g, ' ') : uiText(config, 'volume', { number: String(order) });
    return { key: segment.toLowerCase(), title, order };
}

function getAlphaOrder(value: string): number {
    return value
        .toUpperCase()
        .split('')
        .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function parseNumberingUnit(basename: string): NumberingUnit | undefined {
    const chapterMatch = basename.match(/^(\d+)-.*\.md$/i);
    if (chapterMatch) {
        const chapter = parseInt(chapterMatch[1], 10);
        if (chapter === 0) return undefined;
        return {
            kind: 'chapter',
            key: `chapter-${chapter}`,
            label: String(chapter),
            order: chapter,
            chapter
        };
    }

    const appendixMatch = basename.match(/^appendix[-_\s]?([a-z]+|\d+)(?:[-_\s].*)?\.md$/i);
    if (!appendixMatch) return undefined;

    const raw = appendixMatch[1];
    const label = /^\d+$/.test(raw) ? raw : raw.toUpperCase();
    const appendixOrder = /^\d+$/.test(raw) ? parseInt(raw, 10) : getAlphaOrder(raw);
    return {
        kind: 'appendix',
        key: `appendix-${label.toLowerCase()}`,
        label,
        order: 100000 + appendixOrder,
        appendix: label
    };
}

function parseSpecialPageKind(basename: string): string | undefined {
    if (/^00[-_\s]?(?:intro|introduction)\.md$/i.test(basename)) return 'intro';
    if (/^intro\.md$/i.test(basename)) return 'intro';
    if (/^introduction\.md$/i.test(basename)) return 'intro';
    if (/^summary\.md$/i.test(basename)) return 'summary';
    return undefined;
}

function parseMarkdownHeadingLine(line: string): { level: number; id?: string; title: string } | undefined {
    const match = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)\s*$/);
    if (!match) return undefined;

    let title = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
    if (!title) return undefined;

    const idMatch = title.match(/^#([A-Za-z0-9_-]+)\b\s*(.*)$/);
    if (idMatch) {
        title = idMatch[2].trim();
        if (!title) return undefined;
        return {
            level: match[1].length,
            id: idMatch[1],
            title
        };
    }

    return {
        level: match[1].length,
        title
    };
}

function getPageTitleHeading(content: string, fallback: string): PageTitleHeading {
    const headings: PageTitleHeading[] = [];
    let inFence = false;
    let lineNumber = 0;

    for (const line of String(content || '').split(/\r?\n/)) {
        lineNumber++;
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;

        const heading = parseMarkdownHeadingLine(line);
        if (!heading) continue;
        headings.push({ ...heading, line: lineNumber });
    }

    if (headings.length === 0) {
        return { title: fallback, line: 1, level: 1 };
    }

    const topLevel = Math.min(...headings.map(heading => heading.level));
    const topHeadings = headings.filter(heading => heading.level === topLevel);
    if (topHeadings.length !== 1) {
        return { title: fallback, line: 1, level: topLevel };
    }
    return topHeadings[0];
}

function fallbackPageTitle(filePath: string): string {
    return path.posix.basename(filePath, '.md')
        .replace(/^\d+-/, '')
        .replace(/^appendix[-_\s]?[a-z0-9]+[-_\s]?/i, '')
        .replace(/[-_]+/g, ' ');
}

function getPageOrder(kind: string, unit?: NumberingUnit): number {
    if (kind === 'intro') return -100000;
    if (kind === 'summary') return 200000;
    return unit ? unit.order : 0;
}

function markerLineContent(line: string, marker: FormalMarker): string {
    if (marker.type === 'section') return marker.title;
    return line.trim().replace(marker.markerText, sourceMarkerLabel(marker)).trim();
}

function sourceMarkerLabel(marker: FormalMarker): string {
    return marker.markerText.replace(/\s+#[A-Za-z0-9_-]+\b$/, '').trim();
}

function normalizeProofBoundaryLine(line: string): string {
    return line
        .trim()
        .replace(/^>\s*/, '')
        .replace(/^\s*[-+*]\s+/, '')
        .replace(/^\*\*(.+?)\*\*/, '$1')
        .replace(/^__(.+?)__/, '$1')
        .replace(/^\*(.+?)\*/, '$1')
        .replace(/^_(.+?)_/, '$1')
        .trim();
}

function isProofBoundaryLine(line: string): boolean {
    const text = normalizeProofBoundaryLine(line);
    return /^(?:证明(?:概要|草图|思路|如下|在此略去)?|Proof(?:\s+sketch)?|Sketch of proof)\s*(?:[：:。.．.]|$|\s)/i.test(text);
}

function isProofTerminatorLine(line: string): boolean {
    const text = normalizeProofBoundaryLine(line);
    return /(?:证毕|Q\.?E\.?D\.?|∎|□)\s*[。.．.]?\s*$/i.test(text)
        || /\$\s*\\square\s*\$\s*[。.．.]?\s*$/.test(text)
        || /\\\[\s*\\square\s*\\\]\s*[。.．.]?\s*$/.test(text);
}

function isMarkerBoundaryLine(line: string): boolean {
    return /^#{1,6}\s+/.test(line) || !!parseFormalMarkerLine(line);
}

function isDisplayMathLine(line: string): boolean {
    const text = line.trim();
    return text.startsWith('$$')
        || text.startsWith('\\[')
        || text.startsWith('\\]')
        || /^\\(?:begin|end)\{(?:equation|align|alignat|gather|multline|flalign|split|aligned|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix)\*?\}/.test(text);
}

function isStructuredDefinitionContinuation(line: string): boolean {
    const text = line.trim();
    return isDisplayMathLine(line)
        || /^>\s*/.test(text)
        || /^\|.*\|$/.test(text)
        || /^[-+*]\s+/.test(text)
        || /^\d+[.)]\s+/.test(text)
        || /^(\*\*|__)?\s*[（(]?(?:[ivxlcdm]+|[a-z]|\d+)[）).、]\s*/i.test(text);
}

function isDisplayMathStartLine(line: string): boolean {
    const text = line.trim();
    return text.startsWith('$$')
        || text.startsWith('\\[')
        || /^\\begin\{(?:equation|align|alignat|gather|multline|flalign|split|aligned|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix)\*?\}/.test(text);
}

function updateDisplayMathState(line: string, inDisplayMath: boolean): boolean {
    const text = line.trim();
    const dollarCount = (text.match(/\$\$/g) || []).length;
    if (dollarCount % 2 === 1) return !inDisplayMath;
    if (text.startsWith('\\[')) return true;
    if (text.startsWith('\\]')) return false;
    if (/^\\begin\{(?:equation|align|alignat|gather|multline|flalign|split|aligned|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix)\*?\}/.test(text)) return true;
    if (/^\\end\{(?:equation|align|alignat|gather|multline|flalign|split|aligned|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix)\*?\}/.test(text)) return false;
    return inDisplayMath;
}

function trimTrailingBlankLines(lines: string[]): string[] {
    const trimmed = [...lines];
    while (trimmed.length > 0 && !trimmed[trimmed.length - 1].trim()) trimmed.pop();
    return trimmed;
}

function collectRecallMarkerContent(lines: string[], startLine: number, marker: FormalMarker): { contentLines: string[]; endLine: number } {
    const contentLines = [markerLineContent(lines[startLine], marker)];
    let endLine = startLine;
    let proofLine = -1;

    for (let i = startLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (isMarkerBoundaryLine(line)) break;
        if (isProofBoundaryLine(line)) {
            proofLine = i;
            break;
        }
    }

    if (proofLine >= 0) {
        for (let i = startLine + 1; i < proofLine; i++) {
            contentLines.push(lines[i]);
            endLine = i;
        }
        return { contentLines: trimTrailingBlankLines(contentLines), endLine };
    }

    for (let i = startLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) break;
        if (isMarkerBoundaryLine(line)) break;
        contentLines.push(line);
        endLine = i;
    }

    return { contentLines: trimTrailingBlankLines(contentLines), endLine };
}

function nextNonBlankLineIndex(lines: string[], startIndex: number): number {
    for (let i = startIndex; i < lines.length; i++) {
        if (lines[i].trim()) return i;
    }
    return -1;
}

function collectDefinitionContent(lines: string[], startLine: number, marker?: FormalMarker): { contentLines: string[]; endLine: number } {
    const contentLines = [marker ? markerLineContent(lines[startLine], marker) : lines[startLine].trim()];
    let endLine = startLine;
    let inDisplayMath = updateDisplayMathState(lines[startLine], false);
    let previousNonBlankWasDisplayMath = isDisplayMathLine(lines[startLine]);

    for (let i = startLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (isMarkerBoundaryLine(line)) break;

        if (!line.trim()) {
            const nextNonBlank = nextNonBlankLineIndex(lines, i + 1);
            if (nextNonBlank < 0 || isMarkerBoundaryLine(lines[nextNonBlank])) break;
            if (!inDisplayMath && !previousNonBlankWasDisplayMath && !isStructuredDefinitionContinuation(lines[nextNonBlank])) break;
            contentLines.push(line);
            endLine = i;
            previousNonBlankWasDisplayMath = false;
            continue;
        }

        const lineWasDisplayMath = inDisplayMath || isDisplayMathLine(line);
        contentLines.push(line);
        endLine = i;
        inDisplayMath = updateDisplayMathState(line, inDisplayMath);
        previousNonBlankWasDisplayMath = lineWasDisplayMath;
    }

    return { contentLines: trimTrailingBlankLines(contentLines), endLine };
}

function collectMarkerContent(lines: string[], startLine: number, marker: FormalMarker): { contentLines: string[]; endLine: number } {
    if (RECALL_TYPES.has(marker.type)) {
        return collectRecallMarkerContent(lines, startLine, marker);
    }

    if (marker.type === 'def') {
        return collectDefinitionContent(lines, startLine, marker);
    }

    const contentLines = [markerLineContent(lines[startLine], marker)];
    let endLine = startLine;

    for (let i = startLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) break;
        if (isMarkerBoundaryLine(line)) break;
        contentLines.push(line);
        endLine = i;
    }

    return { contentLines: trimTrailingBlankLines(contentLines), endLine };
}

function sourceLineRangeContent(lines: string[], sourceLine: number): { content: string; startLine: number; endLine: number } {
    const sourceIndex = Math.max(0, Math.min(lines.length - 1, sourceLine - 1));
    const marker = parseFormalMarkerLine(lines[sourceIndex]);
    if (marker) {
        const collected = collectMarkerContent(lines, sourceIndex, marker);
        return {
            content: collected.contentLines.join('\n'),
            startLine: sourceIndex,
            endLine: collected.endLine
        };
    }

    const isBoundary = (line: string) => !line.trim() || /^#{1,6}\s+/.test(line) || !!parseFormalMarkerLine(line);
    let startLine = sourceIndex;
    while (startLine > 0 && !isBoundary(lines[startLine - 1])) startLine--;

    const collected = collectDefinitionContent(lines, startLine);
    return {
        content: collected.contentLines.join('\n').trim(),
        startLine,
        endLine: collected.endLine
    };
}

function makeLabelData(marker: FormalMarker, unitFile: UnitFile, startLine: number, contentLines: string[], markerNumber?: number, endLine?: number): LabelData {
    const content = RECALL_TYPES.has(marker.type) ? contentLines.join('\n') : undefined;
    const label: LabelData = {
        type: marker.type,
        title: marker.title,
        filePath: unitFile.filePath,
        bookKey: unitFile.book.key,
        bookTitle: unitFile.book.title,
        bookOrder: unitFile.book.order,
        unitKind: unitFile.unit.kind,
        unitKey: unitFile.unit.key,
        unitLabel: unitFile.unit.label,
        unitOrder: unitFile.unit.order,
        startLine,
        endLine
    };

    if (content) label.content = content;
    if (unitFile.unit.chapter !== undefined) label.chapter = unitFile.unit.chapter;
    if (unitFile.unit.appendix !== undefined) label.appendix = unitFile.unit.appendix;
    if (markerNumber !== undefined) label.number = markerNumber;
    if (unitFile.volume) {
        label.volumeKey = unitFile.volume.key;
        label.volumeTitle = unitFile.volume.title;
        label.volumeOrder = unitFile.volume.order;
    }
    return label;
}

function makeDefinitionLabelData(marker: FormalMarker, document: FormalDocument, book: BookInfo, volume: VolumeInfo | undefined, startLine: number, contentLines: string[], endLine?: number): LabelData {
    const content = contentLines.join('\n');
    const label: LabelData = {
        type: marker.type,
        title: marker.title,
        filePath: document.filePath,
        bookKey: book.key,
        bookTitle: book.title,
        bookOrder: book.order,
        content,
        startLine,
        endLine
    };
    if (volume) {
        label.volumeKey = volume.key;
        label.volumeTitle = volume.title;
        label.volumeOrder = volume.order;
    }
    return label;
}

function makePageLabelData(page: PageData): LabelData {
    const label: LabelData = {
        type: page.kind,
        title: page.title,
        filePath: page.filePath,
        bookKey: page.bookKey,
        bookTitle: page.bookTitle,
        bookOrder: page.bookOrder,
        volumeKey: page.volumeKey,
        volumeTitle: page.volumeTitle,
        volumeOrder: page.volumeOrder,
        unitKind: page.unitKind,
        unitKey: page.unitKey,
        unitLabel: page.unitLabel,
        unitOrder: page.unitOrder,
        chapter: page.chapter,
        appendix: page.appendix,
        startLine: page.line !== undefined ? page.line - 1 : undefined,
        endLine: page.line !== undefined ? page.line - 1 : undefined
    };

    return label;
}

function previousNonBlankLineIndex(lines: string[], startIndex: number): number {
    for (let i = startIndex; i >= 0; i--) {
        if (lines[i].trim()) return i;
    }
    return -1;
}

function isMarkdownImageLine(line: string): boolean {
    return /!\[[^\]\n]*\]\([^)]+\)/.test(line.trim());
}

function isMarkdownTableRow(line: string): boolean {
    const text = line.trim();
    return text.includes('|') && text.split('|').filter(part => part.trim()).length >= 2;
}

function isMarkdownTableDelimiter(line: string): boolean {
    const text = line.trim();
    if (!text.includes('|')) return false;
    const cells = text.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
    return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableStart(lines: string[], lineIndex: number): boolean {
    return lineIndex >= 0
        && lineIndex + 1 < lines.length
        && isMarkdownTableRow(lines[lineIndex])
        && isMarkdownTableDelimiter(lines[lineIndex + 1]);
}

function lintStructuredNumberedMarker(marker: FormalMarker, lines: string[], lineIndex: number, filePath: string): FormalIssue[] {
    if (!STRUCTURED_NUMBERED_TYPES.has(marker.type)) return [];

    const issues: FormalIssue[] = [];
    const next = nextNonBlankLineIndex(lines, lineIndex + 1);
    const previous = previousNonBlankLineIndex(lines, lineIndex - 1);

    if (marker.type === 'equation') {
        if (next < 0 || !isDisplayMathStartLine(lines[next])) {
            issues.push({
                severity: 'error',
                code: 'equation-target-missing',
                file: filePath,
                line: lineIndex + 1,
                message: 'Equation marker must be followed by a display math block.'
            });
        }
        return issues;
    }

    if (!marker.title) {
        issues.push({
            severity: 'warn',
            code: `${marker.type}-caption-missing`,
            file: filePath,
            line: lineIndex + 1,
            message: `${marker.type === 'figure' ? 'Figure' : 'Table'} marker should include a caption title.`
        });
    }

    if (marker.type === 'figure') {
        const hasNearbyImage = (previous >= 0 && isMarkdownImageLine(lines[previous]))
            || (next >= 0 && isMarkdownImageLine(lines[next]));
        if (!hasNearbyImage) {
            issues.push({
                severity: 'error',
                code: 'figure-target-missing',
                file: filePath,
                line: lineIndex + 1,
                message: 'Figure marker should be adjacent to a Markdown image.'
            });
        }
        return issues;
    }

    if (marker.type === 'table' && (next < 0 || !isMarkdownTableStart(lines, next))) {
        issues.push({
            severity: 'error',
            code: 'table-target-missing',
            file: filePath,
            line: lineIndex + 1,
            message: 'Table marker must be followed by a Markdown table.'
        });
    }

    return issues;
}

export function scanFormalDocuments(documents: FormalDocument[], configInput: any, symbolsInput?: unknown, definitionsInput?: unknown) {
    const config = mergeConfig(configInput);
    const files = [...documents].sort((a, b) => a.filePath.localeCompare(b.filePath));
    const labels: Record<string, LabelData> = {};
    const definitions: FormalDefinition[] = [];
    const references: FormalReference[] = [];
    const pageReferences: FormalPageReference[] = [];
    const pages: PageData[] = [];
    const issues: FormalIssue[] = [];
    const unitFiles = new Map<string, UnitFile[]>();
    const anchorsByFile = new Map<string, { stable: number; temporary: number }>();

    for (const document of files) {
        const filePath = toPosix(document.filePath);
        const basename = path.posix.basename(filePath);
        const content = document.content;
        const book = inferBookInfo(filePath, config);
        const volume = inferVolumeInfo(filePath, config);
        const unit = parseNumberingUnit(basename);
        const specialKind = parseSpecialPageKind(basename);
        const pageAnchor = unit || specialKind
            ? getPageTitleHeading(content, fallbackPageTitle(filePath))
            : undefined;

        if (unit || specialKind) {
            const kind = unit ? unit.kind : specialKind as string;
            const page: PageData = {
                id: pageAnchor?.id,
                kind,
                filePath,
                title: pageAnchor?.title || fallbackPageTitle(filePath),
                order: getPageOrder(kind, unit),
                bookKey: book.key,
                bookTitle: book.title,
                bookOrder: book.order,
                line: pageAnchor?.line,
                level: pageAnchor?.level
            };
            if (volume) {
                page.volumeKey = volume.key;
                page.volumeTitle = volume.title;
                page.volumeOrder = volume.order;
            }
            if (unit) {
                page.unitKind = unit.kind;
                page.unitKey = unit.key;
                page.unitLabel = unit.label;
                page.unitOrder = unit.order;
                if (unit.chapter !== undefined) page.chapter = unit.chapter;
                if (unit.appendix !== undefined) page.appendix = unit.appendix;
            }
            pages.push(page);

            if (page.id) {
                const label = makePageLabelData(page);
                labels[page.id] = label;
                definitions.push({
                    id: page.id,
                    type: page.kind,
                    title: page.title,
                    file: filePath,
                    line: page.line || 1,
                    label
                });
            }
        }

        collectReferences(content, filePath, references, pageReferences);
        const allMarkerStarts = collectMarkerStarts(content, filePath);
        anchorsByFile.set(filePath, {
            stable: allMarkerStarts.filter(marker => typeof marker.id === 'string' && marker.id.startsWith('h-')).length,
            temporary: allMarkerStarts.filter(marker => typeof marker.id === 'string' && marker.id.startsWith('tmp-')).length
        });
        const markerStarts = allMarkerStarts
            .filter(marker => !isPageAnchorMarker(marker, pageAnchor));
        if (markerStarts.some(marker => marker.type !== 'def') && !unit) {
            issues.push({
                severity: 'warn',
                code: 'formal-marker-outside-numbered-file',
                file: filePath,
                message: 'Numbered markers are only numbered in NN-title.md or appendix-a-title.md files.'
            });
        }

        const lines = content.split(/\r?\n/);
        let inFence = false;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            if (/^\s*(```|~~~)/.test(line)) {
                inFence = !inFence;
                continue;
            }
            if (inFence) continue;
            const marker = parseFormalMarkerLine(line);
            if (!marker || marker.type !== 'def') continue;

            const collected = collectMarkerContent(lines, lineIndex, marker);
            const label = makeDefinitionLabelData(marker, { filePath, content }, book, volume, lineIndex, collected.contentLines, collected.endLine);
            definitions.push({
                type: marker.type,
                title: marker.title,
                file: filePath,
                line: lineIndex + 1,
                label
            });
        }

        if (!unit) continue;
        const volumeKey = volume?.key || '__root__';
        const scopeKey = unit.kind === 'appendix' ? `${book.key}:${volumeKey}:${unit.key}` : `${book.key}:${unit.key}`;
        if (!unitFiles.has(scopeKey)) unitFiles.set(scopeKey, []);
        unitFiles.get(scopeKey)!.push({ filePath, content, book, volume, unit, pageAnchor });
    }

    for (const groupFiles of unitFiles.values()) {
        groupFiles.sort((a, b) => a.filePath.localeCompare(b.filePath));
        const counters: Record<string, number> = {};

        for (const unitFile of groupFiles) {
            const lines = unitFile.content.split(/\r?\n/);
            let inFence = false;

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                if (/^\s*(```|~~~)/.test(line)) {
                    inFence = !inFence;
                    continue;
                }
                if (inFence) continue;
                const marker = parseFormalMarkerLine(line);
                if (!marker) continue;
                if (isPageAnchorMarker({ ...marker, line: lineIndex + 1 }, unitFile.pageAnchor)) continue;
                if (marker.type === 'def') continue;
                issues.push(...lintStructuredNumberedMarker(marker, lines, lineIndex, unitFile.filePath));

                const counter = FORMAL_KIND_POLICIES[marker.type]?.counter;
                const markerNumber = counter ? (counters[counter] = (counters[counter] || 0) + 1) : undefined;
                const exerciseContent = isPedagogicalKind(marker.type)
                    ? collectExerciseContent(lines, lineIndex, marker, parseFormalMarkerLine) : undefined;
                const content = exerciseContent || collectMarkerContent(lines, lineIndex, marker);
                const label = makeLabelData(marker, unitFile, lineIndex, content.contentLines, markerNumber, content.endLine);
                if (exerciseContent) {
                    label.bodyEndLine = exerciseContent.bodyEndLine;
                    label.supportRanges = exerciseContent.support;
                    label.supportContent = exerciseContent.support.map(range => lines.slice(range.startLine, range.endLine + 1).join('\n')).join('\n');
                    label.solutionOf = marker.solutionOf;
                    if (marker.type === 'solution') label.proofContent = lines.slice(lineIndex, exerciseContent.bodyEndLine + 1).join('\n');
                    else label.proofContent = exerciseContent.support.filter(range => range.kind === 'solution').map(range => lines.slice(range.startLine, range.endLine + 1).join('\n')).join('\n');
                } else {
                    const proof = findProofRange(lines, lineIndex + 1, content.endLine + 1);
                    if (proof.proofStartLine !== undefined && proof.proofEndLine !== undefined) {
                        label.proofContent = lines.slice(proof.proofStartLine - 1, proof.proofEndLine).join('\n');
                    }
                }
                labels[marker.id!] = label;
                definitions.push({
                    id: marker.id!,
                    type: marker.type,
                    title: marker.title,
                    file: unitFile.filePath,
                    line: lineIndex + 1,
                    label
                });
            }
        }
    }

    issues.push(...connectExerciseSolutions(definitions, labels));

    const customDefinitionResult = parseFormalDefinitions(definitionsInput, files, config);
    for (const customDefinition of customDefinitionResult.definitions) {
        customDefinition.origin = 'manual';
        customDefinition.label.definitionOrigin = 'manual';
        const existing = definitions.find(def => (
            def.type === 'def'
            && def.file === customDefinition.file
            && def.line === customDefinition.line
            && def.title === customDefinition.title
        ));
        if (existing) {
            existing.aliases = unique([...(existing.aliases || []), ...(customDefinition.aliases || [])]);
            continue;
        }
        definitions.push(customDefinition);
    }
    issues.push(...customDefinitionResult.issues);

    const projectKnowledge = analyzeProjectKnowledge(files, definitions);
    const knowledgeOrigins = new Map<string, Extract<ProjectKnowledgeSourceKind, 'concept-appendix' | 'glossary'>>(projectKnowledge.project.sources
        .filter((source): source is typeof source & { kind: Extract<ProjectKnowledgeSourceKind, 'concept-appendix' | 'glossary'> } => source.kind === 'concept-appendix' || source.kind === 'glossary')
        .map(source => [source.filePath, source.kind]));
    for (const definition of definitions) {
        if (definition.type !== 'def' || definition.origin) continue;
        const origin = knowledgeOrigins.get(definition.file);
        definition.origin = origin || 'standard';
        definition.label.definitionOrigin = definition.origin;
    }
    for (const candidate of projectKnowledge.definitions) {
        const book = inferBookInfo(candidate.filePath, config);
        const volume = inferVolumeInfo(candidate.filePath, config);
        const label: LabelData = {
            type: 'def',
            title: candidate.title,
            filePath: candidate.filePath,
            bookKey: book.key,
            bookTitle: book.title,
            bookOrder: book.order,
            content: candidate.content,
            startLine: candidate.line - 1,
            endLine: candidate.line - 1,
            definitionOrigin: candidate.origin
        };
        if (volume) {
            label.volumeKey = volume.key;
            label.volumeTitle = volume.title;
            label.volumeOrder = volume.order;
        }
        definitions.push({
            type: 'def',
            title: candidate.title,
            file: candidate.filePath,
            line: candidate.line,
            label,
            origin: candidate.origin
        });
    }

    const symbolResult = parseFormalSymbols(symbolsInput, files);
    issues.push(...symbolResult.issues);
    issues.push(...lintDefinitions(definitions));
    issues.push(...lintReferences(references, labels, definitions, config));
    issues.push(...lintPageReferences(pageReferences, pages, config));
    issues.push(...lintPages(pages));

    for (const page of pages) {
        const anchors = anchorsByFile.get(page.filePath) || { stable: 0, temporary: 0 };
        const issueCount = issues.filter(issue => issue.file === page.filePath).length;
        const hasStablePageAnchor = typeof page.id === 'string' && page.id.startsWith('h-');
        page.integration = {
            status: anchors.temporary > 0 || issueCount > 0
                ? 'attention'
                : hasStablePageAnchor
                    ? 'managed'
                    : anchors.stable > 0
                        ? 'segmented'
                        : 'unmanaged',
            stableAnchorCount: anchors.stable,
            temporaryAnchorCount: anchors.temporary,
            issueCount
        };
    }

    definitions.sort(compareDefinitionRecords);
    pages.sort(comparePages);
    const dependencyGraph = buildDependencyGraph({ config, labels, definitions, references }, files);
    return { config, files: files.map(file => file.filePath), labels, pages, definitions, references, pageReferences, symbols: symbolResult.symbols, issues, dependencyGraph, projectAnalysis: projectKnowledge.project };
}

function collectMarkerStarts(content: string, filePath: string): any[] {
    const starts = [];
    const lines = content.split(/\r?\n/);
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        const marker = parseFormalMarkerLine(line);
        if (marker) starts.push({ ...marker, file: filePath, line: i + 1 });
    }
    return starts;
}

function isPageAnchorMarker(marker: any, pageAnchor?: PageTitleHeading): boolean {
    return Boolean(
        pageAnchor?.id
        && marker?.id === pageAnchor.id
        && marker?.line === pageAnchor.line
        && marker?.type === 'section'
    );
}

function collectReferences(content: string, filePath: string, references: FormalReference[], pageReferences: FormalPageReference[]): void {
    const stripped = stripIgnoredMarkdown(content);
    const lineStarts = [0];
    for (let i = 0; i < stripped.length; i++) {
        if (stripped[i] === '\n') lineStarts.push(i + 1);
    }

    const pageRefRe = /(^|[^A-Za-z0-9_])@(chapter|page):([^\s<>"'`，。；;！？]+?\.md)(?:\.(title|full))?(?=$|[\s,，。；;:：.!！?？)\]}])/g;
    let pageMatch;
    while ((pageMatch = pageRefRe.exec(stripped))) {
        const offset = pageMatch.index + pageMatch[1].length;
        const line = findLineForOffset(lineStarts, offset);
        pageReferences.push({
            kind: pageMatch[2] as 'chapter' | 'page',
            rawTarget: pageMatch[3],
            target: normalizeFormalPagePath(pageMatch[3], filePath),
            mode: pageMatch[4] as 'title' | 'full' | undefined,
            file: filePath,
            line
        });
    }

    const refRe = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_-]+)(?:\.(?:title|full))?\b(?!:)/g;
    let match;
    while ((match = refRe.exec(stripped))) {
        const offset = match.index + match[1].length;
        const line = findLineForOffset(lineStarts, offset);
        references.push({ id: match[2], file: filePath, line });
    }
}

function findLineForOffset(lineStarts: number[], offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (lineStarts[mid] <= offset) low = mid + 1;
        else high = mid - 1;
    }
    return high + 1;
}

function lintDefinitions(definitions: FormalDefinition[]): FormalIssue[] {
    const issues: FormalIssue[] = [];
    const byId = new Map<string, FormalDefinition[]>();
    for (const def of definitions) {
        if (!def.id) continue;
        if (!byId.has(def.id)) byId.set(def.id, []);
        byId.get(def.id)!.push(def);

        if (TMP_ID_RE.test(def.id)) {
            issues.push({
                severity: 'error',
                code: 'tmp-id-left',
                file: def.file,
                line: def.line,
                message: `Temporary marker #${def.id} remains. Run npm run workspace -- finish <file>.`
            });
        } else if (!HASH_ID_RE.test(def.id)) {
            issues.push({
                severity: 'warn',
                code: 'non-hash-id',
                file: def.file,
                line: def.line,
                message: `Marker id #${def.id} is not a pure hash id.`
            });
        }
    }

    for (const [id, defs] of byId) {
        if (defs.length <= 1) continue;
        defs.forEach(def => {
            issues.push({
                severity: 'error',
                code: 'duplicate-id',
                file: def.file,
                line: def.line,
                message: `Duplicate marker id #${id}.`
            });
        });
    }
    return issues;
}

function normalizeBookDependencyKey(value: string): string {
    return String(value || '').trim().toLowerCase();
}

function directBookDependencies(config: any, sourceBookKey: string): string[] {
    const dependencies = config?.lookup?.bookDependencies;
    if (!dependencies || typeof dependencies !== 'object') return [];

    const source = normalizeBookDependencyKey(sourceBookKey);
    for (const [key, value] of Object.entries(dependencies)) {
        if (normalizeBookDependencyKey(key) !== source) continue;
        return Array.isArray(value)
            ? value.filter(item => typeof item === 'string').map(normalizeBookDependencyKey).filter(Boolean)
            : [];
    }
    return [];
}

function canReferenceBook(sourceBookKey: string, targetBookKey: string, config: any, seen = new Set<string>()): boolean {
    const source = normalizeBookDependencyKey(sourceBookKey);
    const target = normalizeBookDependencyKey(targetBookKey);
    if (!source || !target || source === target) return true;
    if (seen.has(source)) return false;
    seen.add(source);

    const dependencies = directBookDependencies(config, source);
    if (dependencies.includes(target)) return true;
    return dependencies.some(dependency => canReferenceBook(dependency, target, config, seen));
}

function lintReferences(references: FormalReference[], labels: Record<string, LabelData>, definitions: FormalDefinition[], config: any): FormalIssue[] {
    const issues: FormalIssue[] = [];
    const definedIds = new Set(Object.keys(labels));
    const tmpDefs = new Set(definitions.filter(def => def.id && TMP_ID_RE.test(def.id)).map(def => def.id as string));
    for (const ref of references) {
        if (TMP_ID_RE.test(ref.id)) {
            issues.push({
                severity: tmpDefs.has(ref.id) ? 'error' : 'error',
                code: 'tmp-ref-left',
                file: ref.file,
                line: ref.line,
                message: `Temporary reference @${ref.id} remains. Run finish before committing.`
            });
            continue;
        }
        if (!definedIds.has(ref.id)) {
            issues.push({
                severity: 'error',
                code: 'missing-ref',
                file: ref.file,
                line: ref.line,
                message: `Reference @${ref.id} has no matching marker.`
            });
            continue;
        }

        const target = labels[ref.id];
        const sourceBook = inferBookInfo(ref.file, config);
        const targetBookKey = target.bookKey || inferBookInfo(target.filePath || '', config).key;
        if (!canReferenceBook(sourceBook.key, targetBookKey, config)) {
            issues.push({
                severity: 'error',
                code: 'cross-book-ref-disallowed',
                file: ref.file,
                line: ref.line,
                message: `Reference @${ref.id} crosses from ${sourceBook.title} to ${target.bookTitle || targetBookKey}; add lookup.bookDependencies if this dependency is intentional.`
            });
        }
    }
    return issues;
}

function lintPageReferences(pageReferences: FormalPageReference[], pages: PageData[], config: any): FormalIssue[] {
    const issues: FormalIssue[] = [];
    const pageByPath = new Map(pages.map(page => [page.filePath, page]));

    for (const ref of pageReferences) {
        const target = pageByPath.get(ref.target);
        if (!target) {
            issues.push({
                severity: 'error',
                code: 'missing-page-ref',
                file: ref.file,
                line: ref.line,
                message: `Page reference @${ref.kind}:${ref.rawTarget} resolves to ${ref.target || '(empty)'}, but no scanned page matches that path.`
            });
            continue;
        }

        if (ref.kind === 'chapter' && target.kind !== 'chapter') {
            issues.push({
                severity: 'error',
                code: 'page-ref-kind-mismatch',
                file: ref.file,
                line: ref.line,
                message: `@chapter:${ref.rawTarget} points to a ${target.kind} page. Use @page:${target.filePath} for non-chapter pages.`
            });
        }

        const sourceBook = inferBookInfo(ref.file, config);
        const targetBookKey = target.bookKey || inferBookInfo(target.filePath || '', config).key;
        if (!canReferenceBook(sourceBook.key, targetBookKey, config)) {
            issues.push({
                severity: 'error',
                code: 'cross-book-page-ref-disallowed',
                file: ref.file,
                line: ref.line,
                message: `Page reference @${ref.kind}:${ref.rawTarget} crosses from ${sourceBook.title} to ${target.bookTitle || targetBookKey}; add lookup.bookDependencies if this dependency is intentional.`
            });
        }
    }

    return issues;
}

function lintPages(pages: PageData[]): FormalIssue[] {
    const issues: FormalIssue[] = [];
    const chaptersByBook = new Map<string, PageData[]>();
    const specialByScope = new Map<string, PageData[]>();

    for (const page of pages) {
        if (page.kind === 'chapter' && typeof page.chapter === 'number') {
            if (!chaptersByBook.has(page.bookKey || '')) chaptersByBook.set(page.bookKey || '', []);
            chaptersByBook.get(page.bookKey || '')!.push(page);
        }
        if (page.kind === 'intro' || page.kind === 'summary') {
            const key = `${page.bookKey}:${page.volumeKey || '__root__'}:${page.kind}`;
            if (!specialByScope.has(key)) specialByScope.set(key, []);
            specialByScope.get(key)!.push(page);
        }
    }

    for (const chapterPages of chaptersByBook.values()) {
        const sorted = [...chapterPages].sort((a, b) => (a.chapter || 0) - (b.chapter || 0));
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].chapter === sorted[i - 1].chapter) {
                issues.push({
                    severity: 'error',
                    code: 'duplicate-chapter',
                    file: sorted[i].filePath,
                    message: `Chapter ${sorted[i].chapter} is duplicated in ${sorted[i].bookTitle}.`
                });
            }
            if ((sorted[i].chapter || 0) !== (sorted[i - 1].chapter || 0) + 1) {
                issues.push({
                    severity: 'warn',
                    code: 'chapter-gap',
                    file: sorted[i].filePath,
                    message: `${sorted[i].bookTitle} jumps from chapter ${sorted[i - 1].chapter} to ${sorted[i].chapter}.`
                });
            }
        }
    }

    for (const entries of specialByScope.values()) {
        if (entries.length <= 1) continue;
        entries.slice(1).forEach(page => {
            issues.push({
                severity: 'warn',
                code: 'duplicate-special-page',
                file: page.filePath,
                message: `Duplicate ${page.kind}.md in the same book/volume scope.`
            });
        });
    }

    return issues;
}

function comparePages(a: PageData, b: PageData): number {
    if ((a.bookOrder || 0) !== (b.bookOrder || 0)) return (a.bookOrder || 0) - (b.bookOrder || 0);
    if ((a.volumeOrder || 0) !== (b.volumeOrder || 0)) return (a.volumeOrder || 0) - (b.volumeOrder || 0);
    if (a.order !== b.order) return a.order - b.order;
    return a.filePath.localeCompare(b.filePath);
}

function compareDefinitionRecords(a: FormalDefinition, b: FormalDefinition): number {
    const la = a.label;
    const lb = b.label;
    if ((la.bookOrder || 0) !== (lb.bookOrder || 0)) return (la.bookOrder || 0) - (lb.bookOrder || 0);
    if ((la.volumeOrder || 0) !== (lb.volumeOrder || 0)) return (la.volumeOrder || 0) - (lb.volumeOrder || 0);
    if ((la.unitOrder || 0) !== (lb.unitOrder || 0)) return (la.unitOrder || 0) - (lb.unitOrder || 0);
    return a.file.localeCompare(b.file) || a.line - b.line;
}

export function formatLabelNumber(label: LabelData): string {
    if (label.type === 'solution') return label.solutionExerciseNumber || '';
    if (label.type === 'remark' || PAGE_LABEL_TYPES.has(label.type)) return '';
    const prefix = label.unitLabel || (label.chapter !== undefined ? String(label.chapter) : label.appendix || '');
    return prefix && label.number !== undefined ? `${prefix}.${label.number}` : '';
}

export function formatDisplayNumber(label: LabelData): string {
    const number = formatLabelNumber(label);
    return label.type === 'equation' && number ? `(${number})` : number;
}

export function displayLabel(def: FormalDefinition, config: any): string {
    const name = typeName(config, def.type);
    if (def.type === 'solution') {
        const number = formatLabelNumber(def.label);
        return getLanguage(config) === 'en' ? `Solution to Exercise ${number}`.trim() : `习题 ${number} 的解答`;
    }
    if (def.type === 'section') {
        const number = formatLabelNumber(def.label);
        return number ? `${name} ${number}` : name;
    }

    const number = formatDisplayNumber(def.label);
    return number ? `${name} ${number}` : name;
}

export function displayNumber(def: FormalDefinition): string {
    return formatLabelNumber(def.label);
}

export function renderReferenceMap(definitions: FormalDefinition[], config: any, pages: PageData[] = []): string {
    const lines = [
        '# Reference Map',
        '',
        'Generated by `npm run workspace -- prepare`. Read this file to map human display numbers and unnumbered anchors to stable hash IDs.',
        ''
    ];

    if (pages.length > 0) {
        lines.push('## Pages', '');
        lines.push('| Display | Ref | Path Ref | Title | Location |');
        lines.push('| --- | --- | --- | --- | --- |');
        for (const page of [...pages].sort(comparePages)) {
            const prefix = page.kind === 'chapter' ? 'chapter' : 'page';
            const pathRef = `@${prefix}:${page.filePath}`;
            const ref = page.id ? `@${page.id}` : pathRef;
            lines.push(`| ${escapeTable(formatPageReference(page, config))} | \`${ref}\` | \`${pathRef}\` | ${escapeTable(page.title || '')} | \`${page.filePath}\` |`);
        }
        lines.push('');
    }

    const numberedDefinitions = definitions.filter(def => def.id && displayNumber(def));
    let currentBook = '';
    for (const def of numberedDefinitions) {
        const book = def.label.bookTitle || 'Workspace';
        if (book !== currentBook) {
            currentBook = book;
            lines.push(`## ${book}`, '');
            lines.push('| Display | ID | Title | Location |');
            lines.push('| --- | --- | --- | --- |');
        }
        const title = def.title || '';
        lines.push(`| ${displayLabel(def, config)} | \`${def.id}\` | ${escapeTable(title)} | \`${def.file}:${def.line}\` |`);
    }

    const unnumberedAnchors = definitions.filter(def => def.id && !displayNumber(def) && def.type === 'remark');
    if (unnumberedAnchors.length > 0) {
        lines.push('', '## Unnumbered Anchors', '');
        lines.push('| Display | ID | Title | Location |');
        lines.push('| --- | --- | --- | --- |');
        for (const def of unnumberedAnchors) {
            const title = def.title || '';
            lines.push(`| ${displayLabel(def, config)} | \`${def.id}\` | ${escapeTable(title)} | \`${def.file}:${def.line}\` |`);
        }
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

export function buildRuntimeDefinitions(definitions: FormalDefinition[]): RuntimeDefinitionData[] {
    return definitions
        .filter(def => def.type === 'def')
        .map(def => ({
            title: def.title,
            aliases: def.aliases && def.aliases.length > 0 ? def.aliases : undefined,
            filePath: def.file,
            line: def.line,
            content: def.label.content || '',
            bookKey: def.label.bookKey,
            bookTitle: def.label.bookTitle,
            bookOrder: def.label.bookOrder,
            volumeKey: def.label.volumeKey,
            volumeTitle: def.label.volumeTitle,
            volumeOrder: def.label.volumeOrder,
            origin: def.origin || def.label.definitionOrigin || 'standard'
        }));
}

export function buildReaderIndex(state: any) {
    return {
        entries: state.labels,
        pages: state.pages,
        definitions: buildRuntimeDefinitions(state.definitions || []),
        symbols: state.symbols || [],
        projectAnalysis: state.projectAnalysis || undefined
    };
}

export function renderProjectAnalysis(analysis: ProjectStructureAnalysis | undefined): string {
    const project = analysis || {
        schemaVersion: 1,
        generatedBy: 'math-workspace' as const,
        sources: [],
        summary: { conceptSources: 0, notationSources: 0, summaryPages: 0, extractedDefinitions: 0 }
    };
    const lines = [
        '# Project Knowledge Analysis',
        '',
        'Generated from file names, page structure, concept tables, and concept-entry headings. It is a derived reading aid, not source content.',
        '',
        `- Concept or glossary sources: ${project.summary.conceptSources}`,
        `- Notation appendix sources: ${project.summary.notationSources}`,
        `- Summary pages: ${project.summary.summaryPages}`,
        `- Supplemental definitions extracted from concept sources: ${project.summary.extractedDefinitions}`,
        ''
    ];
    if (project.sources.length === 0) {
        lines.push('No dedicated knowledge pages were detected. Standard definition markers remain indexed automatically.', '');
        return `${lines.join('\n')}\n`;
    }
    lines.push('## Detected Sources', '');
    lines.push('| Kind | File | Title | Confidence | Derived definitions |');
    lines.push('| --- | --- | --- | --- | ---: |');
    project.sources.forEach(source => lines.push(`| ${source.kind} | \`${source.filePath}\` | ${escapeTable(source.title)} | ${source.confidence} | ${source.extractedDefinitions} |`));
    lines.push('', '## Maintenance Boundary', '');
    lines.push('- The scanner and Reader refresh this analysis when Markdown or the optional definition/symbol source tables change.', '- Do not copy ordinary definitions into `.math-workspace/definitions.json` just to keep this index fresh.', '- Use `.math-workspace/definitions.json` only for deliberate lookup overrides: nonstandard wording, aliases, bilingual lookup, or a boundary the deterministic extractor cannot represent.', '- Detected notation appendices are supplied as project context; symbol patterns and meanings still require an explicit reviewed source entry.', '');
    return `${lines.join('\n')}\n`;
}

function buildDocumentMap(documents: FormalDocument[]): Map<string, string> {
    return new Map(documents.map(document => [toPosix(document.filePath), document.content || '']));
}

function findProofRange(lines: string[], startLine: number, statementEndLine: number): { proofStartLine?: number; proofEndLine?: number; endLine: number } {
    const startIndex = Math.max(0, startLine - 1);
    const statementEndIndex = Math.max(startIndex, statementEndLine - 1);
    let proofStartIndex = -1;

    for (let i = statementEndIndex + 1; i < lines.length; i++) {
        if (isMarkerBoundaryLine(lines[i])) break;
        if (isProofBoundaryLine(lines[i])) {
            proofStartIndex = i;
            break;
        }
    }

    if (proofStartIndex < 0) {
        return { endLine: statementEndLine };
    }

    let proofEndIndex = proofStartIndex;
    for (let i = proofStartIndex; i < lines.length; i++) {
        if (isMarkerBoundaryLine(lines[i])) break;
        proofEndIndex = i;
        if (isProofTerminatorLine(lines[i])) break;
    }

    return {
        proofStartLine: proofStartIndex + 1,
        proofEndLine: proofEndIndex + 1,
        endLine: proofEndIndex + 1
    };
}

function dependencySourceBlocks(definitions: FormalDefinition[], documents: FormalDocument[]): Map<string, DependencySourceBlock[]> {
    const documentMap = buildDocumentMap(documents);
    const blocksByFile = new Map<string, DependencySourceBlock[]>();

    for (const def of definitions) {
        if (!def.id || !DEPENDENCY_NODE_TYPES.has(def.type)) continue;
        const content = documentMap.get(def.file);
        if (content === undefined) continue;
        const lines = content.split(/\r?\n/);
        const startLine = def.line;
        const labelEndLine = typeof def.label.endLine === 'number' ? def.label.endLine + 1 : startLine;
        const statementEndLine = Math.max(startLine, labelEndLine);
        const pedagogical = isPedagogicalKind(def.type);
        const bodyEndLine = (def.label.bodyEndLine ?? def.label.endLine ?? startLine - 1) + 1;
        const proofRange = pedagogical ? {
            proofStartLine: def.type === 'solution' ? startLine : statementEndLine + 1,
            proofEndLine: bodyEndLine,
            endLine: bodyEndLine
        } : findProofRange(lines, startLine, statementEndLine);
        const block: DependencySourceBlock = {
            id: def.id,
            file: def.file,
            startLine,
            statementEndLine: def.type === 'solution' ? startLine - 1 : statementEndLine,
            proofStartLine: proofRange.proofStartLine,
            proofEndLine: proofRange.proofEndLine,
            endLine: Math.max(statementEndLine, proofRange.endLine)
        };
        if (!blocksByFile.has(def.file)) blocksByFile.set(def.file, []);
        blocksByFile.get(def.file)!.push(block);
    }

    for (const blocks of blocksByFile.values()) {
        blocks.sort((a, b) => a.startLine - b.startLine);
    }
    return blocksByFile;
}

function findDependencySourceBlock(blocks: DependencySourceBlock[] | undefined, line: number): DependencySourceBlock | undefined {
    if (!blocks) return undefined;
    return blocks.find(block => block.startLine <= line && line <= block.endLine);
}

function dependencyEdgeWhere(block: DependencySourceBlock, line: number): DependencyEdgeWhere {
    if (line <= block.statementEndLine) return 'statement';
    if (block.proofStartLine !== undefined && block.proofEndLine !== undefined && block.proofStartLine <= line && line <= block.proofEndLine) {
        return 'proof';
    }
    return 'body';
}

function dependencyEdgeRelation(line: string, id: string): DependencyEdgeRelation {
    const reference = `@${escapeRegExp(id)}(?:\\.(?:title|full))?`;
    const explanatoryLead = '(?:见|参见|详见|参阅|请参见|另见|see(?:\\s+also)?|cf\\.?)';
    return new RegExp(`${explanatoryLead}\\s*${reference}`, 'i').test(line)
        ? 'explanatory'
        : 'strict';
}

function dependencyGraphNode(def: FormalDefinition, config: any): DependencyGraphNode {
    const label = def.label;
    const node: DependencyGraphNode = {
        id: def.id as string,
        kind: def.type,
        display: displayLabel(def, config),
        title: def.title || '',
        path: def.file,
        line: def.line,
        endLine: typeof label.endLine === 'number' ? label.endLine + 1 : undefined,
        bookKey: label.bookKey,
        bookTitle: label.bookTitle,
        bookOrder: label.bookOrder,
        volumeKey: label.volumeKey,
        volumeTitle: label.volumeTitle,
        volumeOrder: label.volumeOrder,
        unitKind: label.unitKind,
        unitKey: label.unitKey,
        unitLabel: label.unitLabel,
        unitOrder: label.unitOrder,
        chapter: label.chapter,
        appendix: label.appendix,
        number: label.number
    };

    Object.keys(node).forEach(key => {
        if ((node as any)[key] === undefined) delete (node as any)[key];
    });
    return node;
}

function dependencyGraphCycles(nodes: DependencyGraphNode[], edges: DependencyGraphEdge[]): DependencyGraphCycle[] {
    const nodeIds = new Set(nodes.map(node => node.id));
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const adjacency = new Map<string, Set<string>>();
    for (const node of nodes) adjacency.set(node.id, new Set());
    for (const edge of edges) {
        if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
            adjacency.get(edge.from)!.add(edge.to);
        }
    }

    let index = 0;
    const indexes = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const cycles: DependencyGraphCycle[] = [];

    const strongConnect = (id: string) => {
        indexes.set(id, index);
        lowlinks.set(id, index);
        index++;
        stack.push(id);
        onStack.add(id);

        for (const next of adjacency.get(id) || []) {
            if (!indexes.has(next)) {
                strongConnect(next);
                lowlinks.set(id, Math.min(lowlinks.get(id) || 0, lowlinks.get(next) || 0));
            } else if (onStack.has(next)) {
                lowlinks.set(id, Math.min(lowlinks.get(id) || 0, indexes.get(next) || 0));
            }
        }

        if (lowlinks.get(id) !== indexes.get(id)) return;

        const component: string[] = [];
        while (stack.length > 0) {
            const item = stack.pop() as string;
            onStack.delete(item);
            component.push(item);
            if (item === id) break;
        }

        const hasSelfLoop = component.length === 1 && (adjacency.get(component[0]) || new Set()).has(component[0]);
        if (component.length > 1 || hasSelfLoop) {
            const ids = component.sort((a, b) => (nodeById.get(a)?.display || a).localeCompare(nodeById.get(b)?.display || b));
            cycles.push({
                ids,
                displays: ids.map(item => nodeById.get(item)?.display || item)
            });
        }
    };

    for (const node of nodes) {
        if (!indexes.has(node.id)) strongConnect(node.id);
    }

    return cycles.sort((a, b) => a.displays.join(' -> ').localeCompare(b.displays.join(' -> ')));
}

export function buildDependencyGraph(state: any, documents: FormalDocument[]): DependencyGraph {
    const config = state.config || mergeConfig(DEFAULT_CONFIG);
    const definitions: FormalDefinition[] = state.definitions || [];
    const references: FormalReference[] = state.references || [];
    const dependencyDefinitions = definitions
        .filter(def => def.id && DEPENDENCY_NODE_TYPES.has(def.type))
        .sort(compareDefinitionRecords);
    const nodeById = new Map(dependencyDefinitions.map(def => [def.id as string, dependencyGraphNode(def, config)]));
    const blocksByFile = dependencySourceBlocks(dependencyDefinitions, documents);
    const linesByFile = new Map(documents.map(document => [toPosix(document.filePath), (document.content || '').split(/\r?\n/)]));
    const sourceReferences = new Map<string, Set<string>>();
    const edges: DependencyGraphEdge[] = [];
    const ambientReferences: DependencyGraphAmbientReference[] = [];
    const diagnostics: DependencyGraphDiagnostic[] = [];
    const pedagogicalLinks = dependencyDefinitions
        .filter(def => def.type === 'solution' && state.labels?.[def.label.solutionOf || '']?.type === 'exercise')
        .map(def => ({ solution: def.id as string, exercise: def.label.solutionOf as string }));

    for (const ref of references) {
        const sourceBlock = findDependencySourceBlock(blocksByFile.get(ref.file), ref.line);
        // The header target identifies the question; it is not a proof premise.
        if (sourceBlock && ref.line === sourceBlock.startLine
            && pedagogicalLinks.some(link => link.solution === sourceBlock.id && link.exercise === ref.id)) continue;
        if (sourceBlock) {
            const targets = sourceReferences.get(sourceBlock.id) || new Set<string>();
            targets.add(ref.id);
            sourceReferences.set(sourceBlock.id, targets);
        }

        const target = nodeById.get(ref.id);
        if (!target) continue;
        if (!sourceBlock) {
            ambientReferences.push({ to: ref.id, path: ref.file, line: ref.line });
            diagnostics.push({
                severity: 'info',
                code: 'ambient-dependency-ref',
                file: ref.file,
                line: ref.line,
                message: `Reference @${ref.id} targets a dependency node but is outside a dependency statement/proof block.`
            });
            continue;
        }

        const sourceNode = nodeById.get(sourceBlock.id);
        const pedagogical = isPedagogicalKind(sourceNode?.kind || '') || isPedagogicalKind(target.kind);
        if (isMainlineKind(sourceNode?.kind || '') && isPedagogicalKind(target.kind)) {
            diagnostics.push({ severity: 'warn', code: 'mainline-references-exercise', file: ref.file, line: ref.line,
                message: 'A mainline result references an exercise or solution. Keep any required claim and proof in the main text.' });
        }
        const where = dependencyEdgeWhere(sourceBlock, ref.line);
        const sourceLine = linesByFile.get(ref.file)?.[ref.line - 1] || '';
        edges.push({
            from: sourceBlock.id,
            to: ref.id,
            kind: 'explicit_ref',
            layer: pedagogical ? 'pedagogical' : 'mathematical',
            where,
            relation: where === 'body' ? 'explanatory' : dependencyEdgeRelation(sourceLine, ref.id),
            path: ref.file,
            line: ref.line
        });
    }

    for (const [id, targets] of sourceReferences) {
        const node = nodeById.get(id);
        if (node) node.sourceReferenceCount = targets.size;
    }

    const nodes = [...nodeById.values()].sort((a, b) => (
        (a.bookOrder || 0) - (b.bookOrder || 0)
        || (a.volumeOrder || 0) - (b.volumeOrder || 0)
        || (a.unitOrder || 0) - (b.unitOrder || 0)
        || a.path.localeCompare(b.path)
        || a.line - b.line
    ));
    const incoming = new Map(nodes.map(node => [node.id, 0]));
    const outgoing = new Map(nodes.map(node => [node.id, 0]));
    for (const edge of edges) {
        incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
        outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + 1);
    }

    const cycles = dependencyGraphCycles(nodes, edges);
    const isCrossBook = (edge: DependencyGraphEdge) => (nodeById.get(edge.from)?.bookKey || '') !== (nodeById.get(edge.to)?.bookKey || '');
    const isCrossVolume = (edge: DependencyGraphEdge) => (nodeById.get(edge.from)?.volumeKey || '') !== (nodeById.get(edge.to)?.volumeKey || '');
    const isCrossChapter = (edge: DependencyGraphEdge) => (nodeById.get(edge.from)?.unitKey || '') !== (nodeById.get(edge.to)?.unitKey || '');
    const isSupplementalRemark = (node: DependencyGraphNode | undefined) => node?.kind === 'remark';
    const isTheoremLikeEdge = (edge: DependencyGraphEdge) => isMainlineKind(nodeById.get(edge.from)?.kind || '') && isMainlineKind(nodeById.get(edge.to)?.kind || '');

    return {
        schemaVersion: 1,
        generatedBy: 'math-workspace',
        nodes,
        edges,
        pedagogicalLinks,
        ambientReferences,
        cycles,
        diagnostics,
        summary: {
            nodes: nodes.length,
            theoremLikeNodes: nodes.filter(node => isMainlineKind(node.kind)).length,
            pedagogicalNodes: nodes.filter(node => isPedagogicalKind(node.kind)).length,
            pedagogicalEdges: edges.filter(edge => edge.layer === 'pedagogical').length,
            supplementalRemarkNodes: nodes.filter(node => node.kind === 'remark').length,
            edges: edges.length,
            theoremLikeEdges: edges.filter(isTheoremLikeEdge).length,
            supplementalRemarkEdges: edges.filter(edge => edge.layer !== 'pedagogical' && !isTheoremLikeEdge(edge)).length,
            isolated: nodes.filter(node => (incoming.get(node.id) || 0) === 0 && (outgoing.get(node.id) || 0) === 0).length,
            cycles: cycles.length,
            crossBookEdges: edges.filter(isCrossBook).length,
            crossVolumeEdges: edges.filter(isCrossVolume).length,
            crossChapterEdges: edges.filter(isCrossChapter).length,
            statementEdges: edges.filter(edge => edge.where === 'statement').length,
            proofEdges: edges.filter(edge => edge.where === 'proof').length,
            bodyEdges: edges.filter(edge => edge.where === 'body').length
        }
    };
}

function dependencyNodeById(graph: DependencyGraph): Map<string, DependencyGraphNode> {
    return new Map(graph.nodes.map(node => [node.id, node]));
}

function dependencyDegreeRows(graph: DependencyGraph, direction: 'incoming' | 'outgoing', edges: DependencyGraphEdge[] = graph.edges): Array<{ node: DependencyGraphNode; count: number }> {
    const nodeById = dependencyNodeById(graph);
    const counts = new Map(graph.nodes.map(node => [node.id, 0]));
    for (const edge of edges) {
        const id = direction === 'incoming' ? edge.to : edge.from;
        counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([id, count]) => ({ node: nodeById.get(id) as DependencyGraphNode, count }))
        .filter(row => row.node && row.count > 0)
        .sort((a, b) => b.count - a.count || a.node.display.localeCompare(b.node.display));
}

function dependencyNodeLocation(node: DependencyGraphNode): string {
    return `${node.path}:${node.line}`;
}

function dependencyNodeTitle(node: DependencyGraphNode): string {
    return `${node.display}${node.title ? ` ${node.title}` : ''}`;
}

function isSupplementalRemarkNode(node: DependencyGraphNode | undefined): boolean {
    return node?.kind === 'remark';
}

function dependencyNodeKindLabel(node: DependencyGraphNode): string {
    return isPedagogicalKind(node.kind) ? (node.kind === 'exercise' ? 'Exercise' : 'Solution') : isSupplementalRemarkNode(node) ? 'Supplemental remark' : 'Theorem-like';
}

function pushLimitedRows<T>(lines: string[], rows: T[], limit: number, render: (row: T) => string, moreRow?: (remaining: number) => string) {
    rows.slice(0, limit).forEach(row => lines.push(render(row)));
    if (rows.length > limit) {
        const remaining = rows.length - limit;
        lines.push(moreRow ? moreRow(remaining) : `| ... | ... | ${remaining} more |`);
    }
}

export function renderDependencyReport(graph: DependencyGraph): string {
    const nodeById = dependencyNodeById(graph);
    const lines = [
        '# Dependency Graph Report',
        '',
        'Generated by `npm run workspace -- prepare`. The canonical data is `.math-workspace/dependency-graph.json`.',
        '',
        '## Summary',
        '',
        `- Nodes: ${graph.summary.nodes}`,
        `- Theorem-like nodes: ${graph.summary.theoremLikeNodes}`,
        `- Supplemental fact remarks: ${graph.summary.supplementalRemarkNodes}`,
        `- Exercises and solutions: ${graph.summary.pedagogicalNodes || 0}`,
        `- Pedagogical reference edges: ${graph.summary.pedagogicalEdges || 0}`,
        `- Solution associations (excluded from proof cycles): ${graph.pedagogicalLinks?.length || 0}`,
        `- Explicit edges: ${graph.summary.edges}`,
        `- Mainline theorem-like edges: ${graph.summary.theoremLikeEdges}`,
        `- Edges involving supplemental remarks: ${graph.summary.supplementalRemarkEdges}`,
        `- Statement edges: ${graph.summary.statementEdges}`,
        `- Proof edges: ${graph.summary.proofEdges}`,
        `- Body edges: ${graph.summary.bodyEdges}`,
        `- Cross-chapter edges: ${graph.summary.crossChapterEdges}`,
        `- Cross-volume edges: ${graph.summary.crossVolumeEdges}`,
        `- Cross-book edges: ${graph.summary.crossBookEdges}`,
        `- Isolated nodes: ${graph.summary.isolated}`,
        `- Cycles: ${graph.summary.cycles}`,
        ''
    ];

    const mathematicalEdges = graph.edges.filter(edge => edge.layer !== 'pedagogical');
    const outgoing = dependencyDegreeRows(graph, 'outgoing', mathematicalEdges);
    lines.push('## High Outgoing Dependencies', '');
    if (outgoing.length === 0) {
        lines.push('No outgoing dependencies.', '');
    } else {
        lines.push('| Count | Kind | Node | Location |');
        lines.push('| ---: | --- | --- | --- |');
        pushLimitedRows(lines, outgoing, 20, row => `| ${row.count} | ${dependencyNodeKindLabel(row.node)} | ${escapeTable(row.node.display)} ${escapeTable(row.node.title || '')} | \`${dependencyNodeLocation(row.node)}\` |`);
        lines.push('');
    }

    const incoming = dependencyDegreeRows(graph, 'incoming', mathematicalEdges);
    lines.push('## High Incoming Dependencies', '');
    if (incoming.length === 0) {
        lines.push('No incoming dependencies.', '');
    } else {
        lines.push('| Count | Kind | Node | Location |');
        lines.push('| ---: | --- | --- | --- |');
        pushLimitedRows(lines, incoming, 20, row => `| ${row.count} | ${dependencyNodeKindLabel(row.node)} | ${escapeTable(row.node.display)} ${escapeTable(row.node.title || '')} | \`${dependencyNodeLocation(row.node)}\` |`);
        lines.push('');
    }

    const crossScopeEdges = graph.edges.filter(edge => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        return from && to && ((from.bookKey || '') !== (to.bookKey || '') || (from.volumeKey || '') !== (to.volumeKey || '') || (from.unitKey || '') !== (to.unitKey || ''));
    });
    lines.push('## Cross-Scope Edges', '');
    if (crossScopeEdges.length === 0) {
        lines.push('No cross-scope dependency edges.', '');
    } else {
        lines.push('| Where | From | To | Reference |');
        lines.push('| --- | --- | --- | --- |');
        pushLimitedRows(lines, crossScopeEdges, 50, edge => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            return `| ${edge.where} | ${escapeTable(from?.display || edge.from)} ${escapeTable(from?.title || '')} | ${escapeTable(to?.display || edge.to)} ${escapeTable(to?.title || '')} | \`${edge.path}:${edge.line}\` |`;
        });
        lines.push('');
    }

    lines.push('## Cycles', '');
    if (graph.cycles.length === 0) {
        lines.push('No dependency cycles found.', '');
    } else {
        lines.push('| Cycle |');
        lines.push('| --- |');
        pushLimitedRows(lines, graph.cycles, 50, cycle => `| ${escapeTable(cycle.displays.join(' -> '))} |`, remaining => `| ... ${remaining} more |`);
        lines.push('');
    }

    const incomingCounts = new Map(graph.nodes.map(node => [node.id, 0]));
    const outgoingCounts = new Map(graph.nodes.map(node => [node.id, 0]));
    for (const edge of graph.edges) {
        incomingCounts.set(edge.to, (incomingCounts.get(edge.to) || 0) + 1);
        outgoingCounts.set(edge.from, (outgoingCounts.get(edge.from) || 0) + 1);
    }
    const isolated = graph.nodes.filter(node => (incomingCounts.get(node.id) || 0) === 0 && (outgoingCounts.get(node.id) || 0) === 0);
    const isolatedTheoremLike = isolated.filter(node => isMainlineKind(node.kind));
    const isolatedRemarks = isolated.filter(isSupplementalRemarkNode);
    lines.push('## Isolated Nodes', '');
    lines.push(`- Mainline theorem-like: ${isolatedTheoremLike.length}`);
    lines.push(`- Supplemental remarks: ${isolatedRemarks.length}`, '');
    if (isolated.length === 0) {
        lines.push('No isolated dependency nodes.', '');
    } else {
        lines.push('| Kind | Node | Location |');
        lines.push('| --- | --- | --- |');
        pushLimitedRows(lines, isolated, 100, node => `| ${dependencyNodeKindLabel(node)} | ${escapeTable(node.display)} ${escapeTable(node.title || '')} | \`${dependencyNodeLocation(node)}\` |`);
        lines.push('');
    }

    if (graph.diagnostics.length > 0) {
        lines.push('## Diagnostics', '');
        lines.push('| Code | Location | Message |');
        lines.push('| --- | --- | --- |');
        pushLimitedRows(lines, graph.diagnostics, 100, diagnostic => {
            const location = diagnostic.file ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ''}` : 'workspace';
            return `| ${diagnostic.code} | \`${location}\` | ${escapeTable(diagnostic.message)} |`;
        });
        lines.push('');
    }

    return `${lines.join('\n')}\n`;
}

function dependencyWhereMatches(edge: DependencyGraphEdge, where: DependencyGraphWhereFilter = 'all'): boolean {
    return where === 'all' || edge.where === where;
}

function filteredDependencyEdges(graph: DependencyGraph, where: DependencyGraphWhereFilter = 'all'): DependencyGraphEdge[] {
    return graph.edges.filter(edge => dependencyWhereMatches(edge, where));
}

function dependencyWhereSuffix(where: DependencyGraphWhereFilter = 'all'): string {
    return where === 'all' ? '' : ` (${where} edges only)`;
}

function dependencyFilteredSummary(graph: DependencyGraph, where: DependencyGraphWhereFilter = 'all') {
    const edges = filteredDependencyEdges(graph, where);
    const incoming = new Map(graph.nodes.map(node => [node.id, 0]));
    const outgoing = new Map(graph.nodes.map(node => [node.id, 0]));
    const nodeById = dependencyNodeById(graph);
    for (const edge of edges) {
        incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
        outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + 1);
    }

    const isCrossBook = (edge: DependencyGraphEdge) => (nodeById.get(edge.from)?.bookKey || '') !== (nodeById.get(edge.to)?.bookKey || '');
    const isCrossVolume = (edge: DependencyGraphEdge) => (nodeById.get(edge.from)?.volumeKey || '') !== (nodeById.get(edge.to)?.volumeKey || '');
    const isCrossChapter = (edge: DependencyGraphEdge) => (nodeById.get(edge.from)?.unitKey || '') !== (nodeById.get(edge.to)?.unitKey || '');
    const isTheoremLikeEdge = (edge: DependencyGraphEdge) => isMainlineKind(nodeById.get(edge.from)?.kind || '') && isMainlineKind(nodeById.get(edge.to)?.kind || '');
    const cycles = dependencyGraphCycles(graph.nodes, edges);

    return {
        edges,
        incoming,
        outgoing,
        cycles,
        isolated: graph.nodes.filter(node => (incoming.get(node.id) || 0) === 0 && (outgoing.get(node.id) || 0) === 0),
        theoremLikeEdges: edges.filter(isTheoremLikeEdge).length,
        supplementalRemarkEdges: edges.filter(edge => edge.layer !== 'pedagogical' && !isTheoremLikeEdge(edge)).length,
        crossBookEdges: edges.filter(isCrossBook).length,
        crossVolumeEdges: edges.filter(isCrossVolume).length,
        crossChapterEdges: edges.filter(isCrossChapter).length,
        statementEdges: edges.filter(edge => edge.where === 'statement').length,
        proofEdges: edges.filter(edge => edge.where === 'proof').length,
        bodyEdges: edges.filter(edge => edge.where === 'body').length
    };
}

function pushDependencyEdgeTable(lines: string[], graph: DependencyGraph, edges: DependencyGraphEdge[], limit = 100) {
    const nodeById = dependencyNodeById(graph);
    if (edges.length === 0) {
        lines.push('No dependency edges.', '');
        return;
    }

    lines.push('| Where | From | To | Reference |');
    lines.push('| --- | --- | --- | --- |');
    const sorted = [...edges].sort((a, b) => (
        a.path.localeCompare(b.path)
        || a.line - b.line
        || (nodeById.get(a.from)?.display || a.from).localeCompare(nodeById.get(b.from)?.display || b.from)
        || (nodeById.get(a.to)?.display || a.to).localeCompare(nodeById.get(b.to)?.display || b.to)
    ));
    pushLimitedRows(lines, sorted, limit, edge => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        return `| ${edge.where} | ${escapeTable(from ? dependencyNodeTitle(from) : edge.from)} | ${escapeTable(to ? dependencyNodeTitle(to) : edge.to)} | \`${edge.path}:${edge.line}\` |`;
    });
    lines.push('');
}

export function renderDependencyGraphSummary(graph: DependencyGraph, where: DependencyGraphWhereFilter = 'all'): string {
    const summary = dependencyFilteredSummary(graph, where);
    const lines = [
        `# Dependency Graph Summary${dependencyWhereSuffix(where)}`,
        '',
        `- Nodes: ${graph.nodes.length}`,
        `- Theorem-like nodes: ${graph.summary.theoremLikeNodes}`,
        `- Supplemental fact remarks: ${graph.summary.supplementalRemarkNodes}`,
        `- Exercises and solutions: ${graph.summary.pedagogicalNodes || 0}`,
        `- Pedagogical reference edges: ${graph.summary.pedagogicalEdges || 0}`,
        `- Solution associations (excluded from proof cycles): ${graph.pedagogicalLinks?.length || 0}`,
        `- Explicit edges: ${summary.edges.length}`,
        `- Mainline theorem-like edges: ${summary.theoremLikeEdges}`,
        `- Edges involving supplemental remarks: ${summary.supplementalRemarkEdges}`,
        `- Statement edges: ${summary.statementEdges}`,
        `- Proof edges: ${summary.proofEdges}`,
        `- Body edges: ${summary.bodyEdges}`,
        `- Cross-chapter edges: ${summary.crossChapterEdges}`,
        `- Cross-volume edges: ${summary.crossVolumeEdges}`,
        `- Cross-book edges: ${summary.crossBookEdges}`,
        `- Isolated nodes: ${summary.isolated.length}`,
        `- Cycles: ${summary.cycles.length}`,
        ''
    ];

    const outgoing = dependencyDegreeRows(graph, 'outgoing', summary.edges);
    lines.push('## Top Outgoing', '');
    if (outgoing.length === 0) {
        lines.push('No outgoing dependencies.', '');
    } else {
        lines.push('| Count | Kind | Node | Location |');
        lines.push('| ---: | --- | --- | --- |');
        pushLimitedRows(
            lines,
            outgoing,
            10,
            row => `| ${row.count} | ${dependencyNodeKindLabel(row.node)} | ${escapeTable(dependencyNodeTitle(row.node))} | \`${dependencyNodeLocation(row.node)}\` |`,
            remaining => `| ... | ... | ... | ${remaining} more |`
        );
        lines.push('');
    }

    const incoming = dependencyDegreeRows(graph, 'incoming', summary.edges);
    lines.push('## Top Incoming', '');
    if (incoming.length === 0) {
        lines.push('No incoming dependencies.', '');
    } else {
        lines.push('| Count | Kind | Node | Location |');
        lines.push('| ---: | --- | --- | --- |');
        pushLimitedRows(
            lines,
            incoming,
            10,
            row => `| ${row.count} | ${dependencyNodeKindLabel(row.node)} | ${escapeTable(dependencyNodeTitle(row.node))} | \`${dependencyNodeLocation(row.node)}\` |`,
            remaining => `| ... | ... | ... | ${remaining} more |`
        );
        lines.push('');
    }

    return `${lines.join('\n')}\n`;
}

function dependencyReachable(graph: DependencyGraph, rootId: string, direction: 'upstream' | 'impact', where: DependencyGraphWhereFilter = 'all', maxDepth = Number.POSITIVE_INFINITY): Array<{ node: DependencyGraphNode; depth: number }> {
    const nodeById = dependencyNodeById(graph);
    if (!nodeById.has(rootId)) return [];

    const adjacency = new Map<string, Set<string>>();
    for (const node of graph.nodes) adjacency.set(node.id, new Set());
    for (const edge of filteredDependencyEdges(graph, where)) {
        if (direction === 'upstream') {
            adjacency.get(edge.from)?.add(edge.to);
        } else {
            adjacency.get(edge.to)?.add(edge.from);
        }
    }

    // Question and answer edits require mutual review; these links never enter proof-cycle analysis.
    if (direction === 'impact') for (const link of graph.pedagogicalLinks || []) {
        adjacency.get(link.exercise)?.add(link.solution);
        adjacency.get(link.solution)?.add(link.exercise);
    }

    const visited = new Map<string, number>([[rootId, 0]]);
    const queue = [rootId];
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        const currentDepth = visited.get(current) || 0;
        if (currentDepth >= maxDepth) continue;
        for (const next of adjacency.get(current) || []) {
            if (visited.has(next)) continue;
            visited.set(next, currentDepth + 1);
            queue.push(next);
        }
    }

    return [...visited.entries()]
        .filter(([id]) => id !== rootId)
        .map(([id, depth]) => ({ node: nodeById.get(id) as DependencyGraphNode, depth }))
        .filter(row => row.node)
        .sort((a, b) => a.depth - b.depth || dependencyNodeLocation(a.node).localeCompare(dependencyNodeLocation(b.node)));
}

function renderDependencyNodeHeader(title: string, graph: DependencyGraph, id: string, where: DependencyGraphWhereFilter): string[] {
    const node = dependencyNodeById(graph).get(id);
    const lines = [`# ${title}${dependencyWhereSuffix(where)}`, ''];
    if (!node) {
        lines.push(`Node \`${id}\` was not found in dependency graph.`, '');
        return lines;
    }
    lines.push(`- Node: ${dependencyNodeTitle(node)}`);
    lines.push(`- ID: \`${node.id}\``);
    lines.push(`- Location: \`${dependencyNodeLocation(node)}\``);
    lines.push('');
    return lines;
}

function pushDependencyNodeRows(lines: string[], rows: Array<{ node: DependencyGraphNode; depth: number }>) {
    if (rows.length === 0) {
        lines.push('No nodes.', '');
        return;
    }
    lines.push('| Depth | Node | Location |');
    lines.push('| ---: | --- | --- |');
    pushLimitedRows(lines, rows, 200, row => `| ${row.depth} | ${escapeTable(dependencyNodeTitle(row.node))} | \`${dependencyNodeLocation(row.node)}\` |`);
    lines.push('');
}

export function renderDependencyGraphImpact(graph: DependencyGraph, id: string, where: DependencyGraphWhereFilter = 'all'): string {
    const lines = renderDependencyNodeHeader('Dependency Impact Closure', graph, id, where);
    if (!dependencyNodeById(graph).has(id)) return `${lines.join('\n')}\n`;
    const rows = dependencyReachable(graph, id, 'impact', where);
    lines.push(`Downstream impacted nodes: ${rows.length}`, '');
    pushDependencyNodeRows(lines, rows);
    return `${lines.join('\n')}\n`;
}

export function renderDependencyGraphUpstream(graph: DependencyGraph, id: string, where: DependencyGraphWhereFilter = 'all'): string {
    const lines = renderDependencyNodeHeader('Dependency Upstream Closure', graph, id, where);
    if (!dependencyNodeById(graph).has(id)) return `${lines.join('\n')}\n`;
    const rows = dependencyReachable(graph, id, 'upstream', where);
    lines.push(`Upstream dependency nodes: ${rows.length}`, '');
    pushDependencyNodeRows(lines, rows);
    return `${lines.join('\n')}\n`;
}

export function renderDependencyGraphFocus(graph: DependencyGraph, id: string, depth = 2, where: DependencyGraphWhereFilter = 'all'): string {
    const safeDepth = Math.max(1, Math.floor(depth || 2));
    const lines = renderDependencyNodeHeader(`Dependency Focus Depth ${safeDepth}`, graph, id, where);
    if (!dependencyNodeById(graph).has(id)) return `${lines.join('\n')}\n`;

    const upstream = dependencyReachable(graph, id, 'upstream', where, safeDepth);
    const impact = dependencyReachable(graph, id, 'impact', where, safeDepth);
    lines.push('## Upstream', '');
    pushDependencyNodeRows(lines, upstream);
    lines.push('## Downstream Impact', '');
    pushDependencyNodeRows(lines, impact);

    const focusIds = new Set([id, ...upstream.map(row => row.node.id), ...impact.map(row => row.node.id)]);
    const focusEdges = filteredDependencyEdges(graph, where).filter(edge => focusIds.has(edge.from) && focusIds.has(edge.to));
    lines.push('## Local Edges', '');
    pushDependencyEdgeTable(lines, graph, focusEdges, 200);
    return `${lines.join('\n')}\n`;
}

export function renderDependencyGraphIsolated(graph: DependencyGraph, where: DependencyGraphWhereFilter = 'all'): string {
    const summary = dependencyFilteredSummary(graph, where);
    const theoremLike = summary.isolated.filter(node => isMainlineKind(node.kind));
    const remarks = summary.isolated.filter(isSupplementalRemarkNode);
    const lines = [
        `# Isolated Dependency Nodes${dependencyWhereSuffix(where)}`,
        '',
        `Isolated nodes: ${summary.isolated.length}`,
        `- Mainline theorem-like: ${theoremLike.length}`,
        `- Supplemental remarks: ${remarks.length}`,
        ''
    ];
    if (summary.isolated.length === 0) {
        lines.push('No isolated dependency nodes.', '');
        return `${lines.join('\n')}\n`;
    }
    lines.push('| Kind | Node | Location |');
    lines.push('| --- | --- | --- |');
    pushLimitedRows(lines, summary.isolated, 500, node => `| ${dependencyNodeKindLabel(node)} | ${escapeTable(dependencyNodeTitle(node))} | \`${dependencyNodeLocation(node)}\` |`);
    lines.push('');
    return `${lines.join('\n')}\n`;
}

export function renderDependencyGraphCycles(graph: DependencyGraph, where: DependencyGraphWhereFilter = 'all'): string {
    const cycles = dependencyGraphCycles(graph.nodes, filteredDependencyEdges(graph, where));
    const lines = [`# Dependency Cycles${dependencyWhereSuffix(where)}`, '', `Cycles: ${cycles.length}`, ''];
    if (cycles.length === 0) {
        lines.push('No dependency cycles found.', '');
        return `${lines.join('\n')}\n`;
    }
    lines.push('| Cycle | IDs |');
    lines.push('| --- | --- |');
    pushLimitedRows(lines, cycles, 200, cycle => `| ${escapeTable(cycle.displays.join(' -> '))} | \`${cycle.ids.join(' -> ')}\` |`);
    lines.push('');
    return `${lines.join('\n')}\n`;
}

function dependencyScopeLabel(node: DependencyGraphNode, scope: DependencyGraphMatrixScope): string {
    const book = node.bookTitle || node.bookKey || 'Workspace';
    if (scope === 'book') return book;

    const volume = node.volumeTitle || node.volumeKey || 'No volume';
    if (scope === 'volume') return `${book} / ${volume}`;

    const unit = node.unitKind === 'appendix'
        ? `Appendix ${node.unitLabel || node.appendix || '?'}`
        : node.unitLabel
            ? `Chapter ${node.unitLabel}`
            : node.unitKey || node.path;
    return `${book} / ${volume} / ${unit}`;
}

export function renderDependencyGraphMatrix(graph: DependencyGraph, scope: DependencyGraphMatrixScope, where: DependencyGraphWhereFilter = 'all'): string {
    const nodeById = dependencyNodeById(graph);
    const edges = filteredDependencyEdges(graph, where);
    const rowTotals = new Map<string, number>();
    const columnTotals = new Map<string, number>();
    const counts = new Map<string, number>();

    for (const edge of edges) {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (!from || !to) continue;
        const row = dependencyScopeLabel(from, scope);
        const column = dependencyScopeLabel(to, scope);
        rowTotals.set(row, (rowTotals.get(row) || 0) + 1);
        columnTotals.set(column, (columnTotals.get(column) || 0) + 1);
        counts.set(`${row}\t${column}`, (counts.get(`${row}\t${column}`) || 0) + 1);
    }

    const rows = [...rowTotals.keys()].sort((a, b) => a.localeCompare(b));
    const columns = [...columnTotals.keys()].sort((a, b) => a.localeCompare(b));
    const lines = [`# Dependency Matrix By ${scope}${dependencyWhereSuffix(where)}`, '', `Edges: ${edges.length}`, ''];
    if (rows.length === 0 || columns.length === 0) {
        lines.push('No dependency edges.', '');
        return `${lines.join('\n')}\n`;
    }

    lines.push(`| From \u2192 To | ${columns.map(escapeTable).join(' | ')} | Total |`);
    lines.push(`| --- | ${columns.map(() => '---:').join(' | ')} | ---: |`);
    for (const row of rows) {
        const values = columns.map(column => counts.get(`${row}\t${column}`) || 0);
        const total = values.reduce((sum, value) => sum + value, 0);
        lines.push(`| ${escapeTable(row)} | ${values.join(' | ')} | ${total} |`);
    }
    lines.push(`| Total | ${columns.map(column => columnTotals.get(column) || 0).join(' | ')} | ${edges.length} |`);
    lines.push('');
    return `${lines.join('\n')}\n`;
}

export function renderDependencyGraphBridges(graph: DependencyGraph, where: DependencyGraphWhereFilter = 'all'): string {
    const edges = filteredDependencyEdges(graph, where).filter(edge => edge.layer !== 'pedagogical');
    const nodeById = dependencyNodeById(graph);
    const incoming = new Map(graph.nodes.map(node => [node.id, 0]));
    const outgoing = new Map(graph.nodes.map(node => [node.id, 0]));
    const crossScope = new Map(graph.nodes.map(node => [node.id, 0]));

    for (const edge of edges) {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
        outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + 1);
        if (from && to && ((from.bookKey || '') !== (to.bookKey || '') || (from.volumeKey || '') !== (to.volumeKey || '') || (from.unitKey || '') !== (to.unitKey || ''))) {
            crossScope.set(edge.from, (crossScope.get(edge.from) || 0) + 1);
            crossScope.set(edge.to, (crossScope.get(edge.to) || 0) + 1);
        }
    }

    const rows = graph.nodes
        .map(node => ({
            node,
            incoming: incoming.get(node.id) || 0,
            outgoing: outgoing.get(node.id) || 0,
            crossScope: crossScope.get(node.id) || 0
        }))
        .filter(row => row.incoming > 0 && row.outgoing > 0)
        .sort((a, b) => b.crossScope - a.crossScope || (b.incoming + b.outgoing) - (a.incoming + a.outgoing) || dependencyNodeTitle(a.node).localeCompare(dependencyNodeTitle(b.node)));

    const theoremLikeRows = rows.filter(row => isMainlineKind(row.node.kind));
    const remarkRows = rows.filter(row => isSupplementalRemarkNode(row.node));
    const lines = [
        `# Bridge Candidates${dependencyWhereSuffix(where)}`,
        '',
        'A bridge candidate has both incoming and outgoing explicit dependencies. This is structural only, not a domain judgment.',
        '',
        `Candidates: ${rows.length}`,
        `- Mainline theorem-like: ${theoremLikeRows.length}`,
        `- Supplemental remarks: ${remarkRows.length}`,
        ''
    ];
    if (rows.length === 0) {
        lines.push('No bridge candidates.', '');
        return `${lines.join('\n')}\n`;
    }
    lines.push('| Cross-scope | Incoming | Outgoing | Kind | Node | Location |');
    lines.push('| ---: | ---: | ---: | --- | --- | --- |');
    pushLimitedRows(lines, rows, 200, row => `| ${row.crossScope} | ${row.incoming} | ${row.outgoing} | ${dependencyNodeKindLabel(row.node)} | ${escapeTable(dependencyNodeTitle(row.node))} | \`${dependencyNodeLocation(row.node)}\` |`);
    lines.push('');
    return `${lines.join('\n')}\n`;
}

export function renderAgentGuide(state: any): string {
    const errors = state.issues.filter((issue: FormalIssue) => issue.severity === 'error').length;
    const warnings = state.issues.filter((issue: FormalIssue) => issue.severity !== 'error').length;
    const lines = [
        '# Agent Guide',
        '',
        'Generated by `npm run workspace -- prepare`. This is the compact workflow card for AI agents.',
        '',
        `Current index: ${Object.keys(state.labels).length} formal entries, ${state.pages.length} pages, ${(state.symbols || []).length} symbols, ${errors} errors, ${warnings} warnings.`,
        '',
        '## Working Loop',
        '',
        '1. Read the target Markdown source. For an existing target outside current context, retrieve only its matching row from `.math-workspace/reference-map.md`.',
        '2. Declare new numbered objects with `#tmp-*`; reference existing objects and pages with `@h-...`, `@h-....title`, or `@h-....full`. Definitions never receive hashes or refs.',
        '3. Preserve Markdown and LaTeX. Do not write display numbers as references or hand-edit generated artifacts.',
        '4. Run `npm run workspace -- finish <file-or-dir>` after editing. It finalizes temporary IDs and verifies the workspace. Use a separate `verify` only after direct `finalize`, migration, or as an explicit release gate.',
        '5. Read `project-analysis.md` only for terminology, concept appendices, or notation work. It is derived context, not a source to maintain.',
        '',
        '## Extended Reference',
        '',
        '- Sections: `## #h-... Title` renders as the current section number plus title, and links jump to the section without hover recall.',
        '- Numbered objects: `命题 #h-...（Title）：...`, `引理 #h-...`, `定理 #h-...`, `推论 #h-...` share the theorem counter per chapter or appendix.',
        '- Equations, figures, and tables: `公式 #h-...：` binds the next display formula as a numbered equation, `图 #h-...（Title）：...` captions a nearby image, and `表 #h-...（Title）：` captions the following table. They have separate counters per chapter or appendix; equations render as `(1.1)`, appendices as `(A.1)`.',
        '- Chapter/page anchors: put `#h-...` / `#tmp-*` on the file\'s unique highest-level heading when the page needs stable refs. The hash is hidden in preview and does not create a section number. Use `@h-...`, `@h-....title`, or `@h-....full` from `reference-map.md` to reference the page.',
        '- Compatibility chapter/page refs: `@chapter:book1/02-main.md`, `@chapter:book1/02-main.md.title`, or `@chapter:book1/02-main.md.full` still work; paths are relative to the formal root that owns `.math-workspace/`. `@page:path.md` is for intro, summary, and appendix pages. Prefer page hashes when available. `finish` normalizes `./` and `../` input sugar to root-relative paths.',
        '- Theorem-like recall captures the statement before `证明` / `Proof`; keep proofs after an explicit proof marker.',
        '- Dependency graph: `.math-workspace/dependency-graph.json` is the canonical explicit reference graph. It uses only `@h-...` references between mainline claims, proof-backed hash remarks, exercises and solutions; pedagogical references carry `layer: pedagogical`, while `pedagogicalLinks` keeps solution ownership separate from proof cycles, and marks edges as `statement`, `proof`, or `body`. Edges introduced as explanatory navigation (`见 @h-...`, `参见 @h-...`, or `see @h-...`) are preserved with relation `explanatory`; the Reader relation map excludes them, body references, and self-references from its strict dependency view. `.math-workspace/dependency-report.md` separates mainline theorem-like and supplemental remark statistics. Use `npm run workspace -- graph summary`, `graph impact <h-id>`, `graph upstream <h-id>`, `graph focus <h-id> --depth 2`, `graph bridges`, `graph isolated`, `graph cycles`, or `graph matrix chapter|volume|book` for Markdown analysis. Add `--where statement|proof|body` to filter edge placement. These are structural graph tools, not domain interpretation.',
        '- Definitions and project knowledge: lookup is a tool-first, AI-exception workflow. The tool scans standard `定义（Term）：...` / `Definition (Term): ...` definitions and deliberately named concept/glossary appendices; `.math-workspace/project-analysis.md` records detected concept, notation, and summary pages. Do not refresh `.math-workspace/definitions.json` after ordinary edits. Use it only for nonstandard phrases, aliases/bilingual lookup, stable multi-paragraph previews, or a boundary the deterministic extractor cannot represent; include Markdown `content` for those entries. Reader task context carries detected sources from the current book. Full rendered lookup previews are only guaranteed for definitions in the currently previewed file; cross-file search is primarily for locating and jumping.',
        '- Exercises use `习题 #tmp-e（Title）：...` / `Exercise #tmp-e (Title): ...`, with an independent chapter counter. Solutions use a separate ID and `解答 #tmp-s（对应 @tmp-e）：...` / `Solution #tmp-s (for @tmp-e): ...`; they may live in the same book’s final appendix and retain the original exercise number. Separate hint/answer paragraphs from the prompt with a blank line. Prompt recall excludes hints and answers; exports include them. Keep stable IDs and Lean declarations when converting existing results; required mainline claims and proofs stay in the main text.',
        '- Explanatory remarks stay plain: `注（Title）：...` / `Remark (Title): ...`, without hash. Non-mainline fact remarks that need a proof or later citation use `注 #tmp-*（Title）：...`; `> 注 #tmp-*（Title）：...` is also recognized inside standard blockquotes. A hash remark is an unnumbered supplemental dependency node and supports recall; a plain remark never enters the dependency graph or Reader dependency markers. Examples stay plain by default; only explicitly cited examples use `例 #tmp-*` / `Example #tmp-*` and remain numbered.',
        '- Symbols: maintain only project-specific `source`, `pattern`, and `meaning` entries in `.math-workspace/symbols.json` when explicit notation semantics change; patterns describe the notation itself with balanced delimiters, not whole equations or open-ended formula fragments. Detected notation appendices are context only and do not infer symbol meanings. The navigation symbol table lists symbols matched in the current preview file. Symbols are not inline formula refs and are not searched through the definition search box.',
        '- Appendices use the appendix file prefix, so markers in `appendix-a-*.md` render as `A.1`, `A.2`, etc. `00-introduction.md`, `intro.md`, and `introduction.md` are intro pages, not chapter 0.',
        '- Export: do not compile formal source Markdown directly. Use `npm run workspace -- export-md <file-or-dir> --out dist/book.md` to produce one portable Markdown file, `npm run workspace -- export-md-split <file-or-dir> --out dist/public` to produce compiled Markdown files while preserving the source tree, `npm run workspace -- export-pdf <file-or-dir> --out dist/book.pdf` to call local pandoc after Markdown export, or `npm run workspace -- render-pdf dist/book.md --out dist/book.pdf` when a project release flow has already postprocessed the compiled Markdown. PDF rendering reads `.math-workspace/config.json` `pdf` defaults when present: A4, 2.5cm margins, TOC depth 2, language-aware TOC title, separate TOC page, optional title page metadata, optional publication metadata page, and optional front matter pages. `author` is the cover/PDF metadata author; fuller identity fields are `authorNative`, `authorAliases`, `orcid`, `repository`, `license`, `licenseUrl`, `preferredCitation`, `releaseTag`, `releaseCommit`, and `doi`. When `metadataPage` is true, the generated metadata page is unnumbered, unlisted, and placed after the title page but before the table of contents. Longer AI, license, citation, or provenance statements belong in `frontMatter`, placed after metadata and before the TOC; front matter entries use `source` or `content`, default to `toc: false`, and default to page breaks. Override with `--title`, `--subtitle`, `--author`, `--author-native`, `--author-alias`, `--orcid`, `--repository`, `--license`, `--license-url`, `--preferred-citation`, `--date`, `--release-version`, `--release-tag`, `--release-commit`, `--doi`, `--metadata-page`, `--front-matter`, `--front-matter-title`, `--front-matter-toc`, `--documentclass`, `--title-page`, `--margin`, `--no-toc`, `--toc-depth`, `--paper`, or Pandoc `-V key:value`. No PDF engine is bundled.',
        '',
        '## Generated Files',
        '',
        '- `.math-workspace/reference-map.md`: compact display-number, page-anchor, and unnumbered-anchor to hash-ID table.',
        '- `.math-workspace/workspace-index.json`: machine-readable formal entry, page, definition, and symbol snapshot for local reader tooling.',
        '- `.math-workspace/dependency-graph.json`: canonical graph for theorem-like objects and proof-backed hash remarks, from explicit `@h-...` references.',
        '- `.math-workspace/dependency-report.md`: human/AI dependency graph review report.',
        '- `.math-workspace/project-analysis.json` / `.math-workspace/project-analysis.md`: generated detection of concept/glossary, notation, and summary pages, plus supplemental concept entries. This is derived context, not a hand-maintained source table.',
        '- `.math-workspace/report.md`: lint/verify details.',
        '- `.math-workspace/audit.md`: advisory AI cleanup list generated by `audit`.',
        '- `.math-workspace/text-ref-migration.md`: generated only after text-reference migration.',
        '- `.math-workspace/definitions.json` / `.math-workspace/symbols.json`: optional reviewed source tables for definition lookup overrides and project-specific notation.',
        '- `.math-workspace/config.json`: explicit formal-project configuration. Use `scan.exclude` when project-root scans must ignore build, draft, context, or generated Markdown directories; use `lookup.bookDependencies` to permit intentional cross-book lookups and refs. The Reader scans project content in memory and remains opt-in through this config.',
        '',
        '## Migration',
        '',
        '- Use `npm run workspace -- migrate-text-refs <file-or-dir>` before applying old numbered prose migration; migration commands are dry-run by default.',
        '- `migrate-text-refs` rewrites typed old references such as `定理 2.1`, `命题2.2`, `Theorem 2.1`, `公式 (2.1)`, `Figure 2.1`, `表 2.1`, `§2.1`, or `第 2.1 节`. It intentionally does not rewrite bare `2.1`, bare `(2.1)`, or handwritten chapter refs such as `第 2 章`; decide those by reading context and convert chapter refs to page hashes `@h-...` when available, otherwise to compatibility `@chapter:path.md`. Matching is bounded so `2.1` is not replaced inside `2.12`, `2.1.3`, or `22.1`.',
        '- Scoped migrations update target files plus incoming references by default. Use `--target-only` only when intentionally restricting rewrites to the target files.',
        ''
    ];
    return `${lines.join('\n')}\n`;
}

function escapeTable(value: string): string {
    return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderReport(state: any): string {
    const errors = state.issues.filter((issue: FormalIssue) => issue.severity === 'error');
    const warnings = state.issues.filter((issue: FormalIssue) => issue.severity !== 'error');
    const lines = [
        '# math-workspace Report',
        '',
        `Labels: ${Object.keys(state.labels).length}`,
        `Pages: ${state.pages.length}`,
        `Symbols: ${(state.symbols || []).length}`,
        `Errors: ${errors.length}`,
        `Warnings: ${warnings.length}`,
        ''
    ];

    if (errors.length > 0) {
        lines.push('## Errors', '');
        errors.forEach((issue: FormalIssue) => lines.push(formatIssue(issue)));
        lines.push('');
    }
    if (warnings.length > 0) {
        lines.push('## Warnings', '');
        warnings.forEach((issue: FormalIssue) => lines.push(formatIssue(issue)));
        lines.push('');
    }
    if (errors.length === 0 && warnings.length === 0) {
        lines.push('No issues found.', '');
    }

    return `${lines.join('\n')}\n`;
}

export function formatIssue(issue: FormalIssue): string {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file || 'workspace';
    return `- [${issue.code}] ${location}: ${issue.message}`;
}
