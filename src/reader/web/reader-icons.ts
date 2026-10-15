import {
    ArrowLeft,
    BookOpenText,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    createElement,
    ChevronUp,
    Copy,
    CodeXml,
    Columns2,
    Download,
    Eraser,
    Eye,
    EyeOff,
    File,
    FileCode2,
    FileOutput,
    FileWarning,
    FoldVertical,
    FoldHorizontal,
    GitCompareArrows,
    History,
    Layers,
    ListTree,
    ListOrdered,
    ListChecks,
    ListPlus,
    Link2,
    Link2Off,
    LocateFixed,
    MousePointer2,
    MessageSquareQuote,
    Maximize,
    Bookmark,
    PenLine,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    Play,
    RefreshCw,
    RotateCcw,
    Save,
    ScanSearch,
    ScanText,
    Search,
    Sigma,
    ShieldCheck,
    SlidersHorizontal,
    Star,
    Square,
    TextCursor,
    TextSelect,
    Trash2,
    TriangleAlert,
    UnfoldVertical,
    Workflow,
    X,
    type IconNode
} from 'lucide';

export type ReaderIconName =
    | 'arrow-left'
    | 'locate'
    | 'copy'
    | 'fit-width'
    | 'chevron-down'
    | 'definition'
    | 'chevron-up'
    | 'chevron-left'
    | 'chevron-right'
    | 'copy-source'
    | 'copy-line'
    | 'marker'
    | 'quote'
    | 'marker-formal'
    | 'marker-pen'
    | 'marker-select'
    | 'propositions'
    | 'contents'
    | 'history'
    | 'publication'
    | 'reference-tools'
    | 'review-tools'
    | 'edition-tools'
    | 'display-tools'
    | 'line-numbers'
    | 'eraser'
    | 'visible'
    | 'hidden'
    | 'navigation-close'
    | 'navigation-open'
    | 'plus'
    | 'reload'
    | 'sigma'
    | 'scan'
    | 'star'
    | 'trash'
    | 'download'
    | 'compare'
    | 'lean-compare'
    | 'expand'
    | 'search'
    | 'verify'
    | 'save'
    | 'reset'
    | 'play'
    | 'stop'
    | 'fold'
    | 'unfold'
    | 'list-plus'
    | 'assumptions'
    | 'proof-scope'
    | 'issue'
    | 'locate-lean'
    | 'stage-draft'
    | 'stage-revising'
    | 'stage-stable'
    | 'stage-checkpoint'
    | 'integration-managed'
    | 'integration-segmented'
    | 'integration-unmanaged'
    | 'integration-attention'
    | 'x';

// Every stage keeps the same document silhouette; only its interior mark changes.
function documentStageIcon(mark: NonNullable<IconNode[2]> = []): IconNode {
    return [File[0], File[1], [...(File[2] || []), ...mark]];
}

// The unfinished half stays visible, but its dashed outline and missing connector
// distinguish partial integration without implying a numeric completion rate.
const PARTIAL_LINK: IconNode = ['svg', Link2[1], [
    ['path', { d: 'M9 17H7A5 5 0 0 1 7 7h2' }],
    ['path', { d: 'M15 7h2a5 5 0 1 1 0 10h-2', 'stroke-dasharray': '2 2', opacity: '0.6' }],
    ['line', { x1: '8', x2: '12', y1: '12', y2: '12' }]
]];

const ICONS: Record<ReaderIconName, IconNode> = {
    'chevron-down': ChevronDown,
    'arrow-left': ArrowLeft,
    'chevron-up': ChevronUp,
    locate: LocateFixed,
    copy: Copy,
    'fit-width': FoldHorizontal,
    definition: BookOpenText,
    'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight,
    'copy-source': CodeXml,
    'copy-line': TextSelect,
    marker: Bookmark,
    quote: MessageSquareQuote,
    'marker-pen': PenLine,
    'marker-select': TextCursor,
    'marker-formal': MousePointer2,
    propositions: Workflow,
    contents: ListTree,
    history: History,
    publication: FileOutput,
    'reference-tools': BookOpenText,
    'review-tools': ListChecks,
    'edition-tools': Layers,
    'display-tools': SlidersHorizontal,
    'line-numbers': ListOrdered,
    eraser: Eraser,
    visible: Eye,
    hidden: EyeOff,
    'navigation-close': PanelLeftClose,
    'navigation-open': PanelLeftOpen,
    plus: Plus,
    reload: RefreshCw,
    sigma: Sigma,
    scan: ScanSearch,
    star: Star,
    trash: Trash2,
    download: Download,
    compare: GitCompareArrows,
    'lean-compare': Columns2,
    expand: Maximize,
    search: Search,
    verify: ShieldCheck,
    save: Save,
    reset: RotateCcw,
    play: Play,
    stop: Square,
    fold: FoldVertical,
    unfold: UnfoldVertical,
    'list-plus': ListPlus,
    assumptions: ListChecks,
    'proof-scope': ScanText,
    issue: FileWarning,
    'locate-lean': FileCode2,
    'stage-draft': documentStageIcon(),
    'stage-revising': documentStageIcon([
        ['path', { d: 'm8 18 .8-3.2 5.4-5.4 2.4 2.4-5.4 5.4L8 18Z' }]
    ]),
    'stage-stable': documentStageIcon([
        ['path', { d: 'm8 15 3 3 5-6' }]
    ]),
    'stage-checkpoint': documentStageIcon([
        ['path', { d: 'M8 19v-8h8l-2 3 2 3H8' }]
    ]),
    'integration-managed': Link2,
    'integration-segmented': PARTIAL_LINK,
    'integration-unmanaged': Link2Off,
    'integration-attention': TriangleAlert,
    x: X
};

export function readerIcon(name: ReaderIconName, size = 16): SVGSVGElement {
    const icon = createElement(ICONS[name]) as SVGSVGElement;
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.setAttribute('height', String(size));
    icon.setAttribute('width', String(size));
    icon.setAttribute('stroke-width', '1.8');
    icon.classList.add('reader-icon');
    return icon;
}

export function replaceReaderButtonIcon(button: HTMLElement, name: ReaderIconName, size = 16): void {
    button.replaceChildren(readerIcon(name, size));
}

/** Update accessible state without replacing the action's glyph. */
export function describeReaderIconAction(button: HTMLButtonElement, label: string, reason = ''): void {
    const description = reason ? `${label} · ${reason}` : label;
    button.dataset.readerActionLabel = label;
    button.setAttribute('title', description);
    button.setAttribute('aria-label', description);
    if (button.dataset.tooltip !== undefined) button.dataset.tooltip = description;
    else button.dataset.readerTooltip = description;
}

export function readerIconAction(icon: ReaderIconName, label: string, tooltip: 'viewport' | 'local' = 'viewport'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'reader-icon-action';
    if (tooltip === 'local') button.dataset.tooltip = '';
    replaceReaderButtonIcon(button, icon); describeReaderIconAction(button, label);
    return button;
}
