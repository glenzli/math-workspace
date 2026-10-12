import {
    ArrowLeft,
    BookOpenText,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    createElement,
    ChevronUp,
    Copy,
    Download,
    Eraser,
    File,
    GitBranch,
    GitCompareArrows,
    History,
    ListTree,
    ListOrdered,
    Link2,
    Link2Off,
    LocateFixed,
    MousePointer2,
    MessageSquareQuote,
    Bookmark,
    PenLine,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    RefreshCw,
    ScanSearch,
    Search,
    Sigma,
    ShieldCheck,
    Star,
    TextCursor,
    Trash2,
    TriangleAlert,
    X,
    type IconNode
} from 'lucide';

export type ReaderIconName =
    | 'arrow-left'
    | 'locate'
    | 'copy'
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
    | 'line-numbers'
    | 'eraser'
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
    | 'search'
    | 'verify'
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
    definition: BookOpenText,
    'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight,
    'copy-source': Copy,
    'copy-line': Copy,
    marker: Bookmark,
    quote: MessageSquareQuote,
    'marker-pen': PenLine,
    'marker-select': TextCursor,
    'marker-formal': MousePointer2,
    propositions: GitBranch,
    contents: ListTree,
    history: History,
    'line-numbers': ListOrdered,
    eraser: Eraser,
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
    search: Search,
    verify: ShieldCheck,
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
    if (name === 'copy-source') icon.classList.add('is-source-copy');
    if (name === 'copy-line') icon.classList.add('is-line-copy');
    return icon;
}

export function replaceReaderButtonIcon(button: HTMLElement, name: ReaderIconName, size = 16): void {
    button.replaceChildren(readerIcon(name, size));
}
