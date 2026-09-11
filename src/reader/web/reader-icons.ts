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
    GitBranch,
    GitCompareArrows,
    History,
    ListTree,
    ListOrdered,
    LocateFixed,
    MousePointer2,
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
    | 'x';

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
