import { Compartment, EditorState, EditorSelection } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, hoverTooltip, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { foldGutter, foldService, foldKeymap, foldAll, unfoldAll, foldedRanges, unfoldEffect } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import type { LeanLanguageDiagnostic, LeanPosition, LeanRange, LeanSemanticToken, LeanLanguageResponse } from '../../lean/lean-language';
import { leanFoldRanges, leanOffsetPosition, leanPositionOffset, normalizeLeanSource, type LeanSyntaxSpan } from './reader-lean-source-model';
import { leanHoverText } from './reader-lean-semantic';

export interface LeanSourceEditorHost {
    positionChanged(position: LeanPosition, range: LeanRange): void;
    hoverAt(position: LeanPosition): Promise<LeanLanguageResponse['hover']>;
    definitionAt(position: LeanPosition): void;
}

/** The editor is only a display/selection surface. Both native editing and doc transactions are disabled. */
export function leanReadonlyExtensions() {
    return [EditorState.readOnly.of(true), EditorView.editable.of(false), EditorState.changeFilter.of(() => false)];
}

export class LeanSourceEditor {
    readonly view: EditorView;
    private syntax = new Compartment();
    private semantic = new Compartment();
    private diagnostics = new Compartment();
    private focus = new Compartment();
    private folds = new Compartment();
    private locale = new Compartment();
    private destroyed = false;
    private readonly content: string;

    constructor(parent: HTMLElement, content: string, private readonly host: LeanSourceEditorHost, label: string, language: 'zh' | 'en' = 'en') {
        this.content = normalizeLeanSource(content);
        this.view = new EditorView({ parent, state: EditorState.create({ doc: this.content, extensions: [
            ...leanReadonlyExtensions(), lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(),
            EditorView.cspNonce.of(document.querySelector<HTMLMetaElement>('meta[name="math-workspace-style-nonce"]')?.content || ''),
            search({ top: true }), foldGutter(), keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap,
                { key: 'F12', run: view => { host.definitionAt(leanOffsetPosition(this.content, view.state.selection.main.head)); return true; } }]),
            this.syntax.of([]), this.semantic.of([]), this.diagnostics.of([]), this.focus.of([]), this.folds.of([]), this.locale.of(this.phrases(language)),
            EditorView.contentAttributes.of({ tabindex: '0', role: 'textbox', 'aria-readonly': 'true', 'aria-label': label, spellcheck: 'false' }),
            EditorView.updateListener.of(update => {
                if (!update.selectionSet) return;
                const selection = update.state.selection.main;
                host.positionChanged(leanOffsetPosition(this.content, selection.head), {
                    start: leanOffsetPosition(this.content, selection.from), end: leanOffsetPosition(this.content, selection.to) });
            }),
            EditorView.domEventHandlers({ mousedown: (event, view) => {
                if (!event.metaKey && !event.ctrlKey) return false;
                const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (position === null) return false;
                event.preventDefault(); host.definitionAt(leanOffsetPosition(this.content, position)); return true;
            } }),
            hoverTooltip(async (_view, offset) => {
                const hover = await host.hoverAt(leanOffsetPosition(this.content, offset));
                if (!hover || this.destroyed) return null;
                const from = hover.range ? leanPositionOffset(this.content, hover.range.start) : offset;
                const to = hover.range ? leanPositionOffset(this.content, hover.range.end) : offset;
                return { pos: from, end: Math.max(from, to), above: true, create: () => {
                    const dom = document.createElement('div'); dom.className = 'reader-lean-source-hover';
                    const code = document.createElement('pre'); code.textContent = leanHoverText(hover.contents); dom.append(code); return { dom };
                } };
            }, { hoverTime: 350 }),
            EditorView.theme({
                '&': { fontSize: '12px', backgroundColor: 'var(--lean-surface, #fff)', color: 'var(--lean-ink, #33414c)' },
                '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', overflow: 'auto', maxHeight: '540px', lineHeight: '1.7' },
                '.cm-content': { padding: '12px 0', minHeight: '160px', cursor: 'text' },
                '.cm-line': { padding: '0 12px' },
                '.cm-gutters': { backgroundColor: 'var(--lean-subtle, #f5f6f7)', border: 'none', color: 'var(--lean-muted, #65727e)' },
                '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#8793c014' },
                '.cm-selectionBackground': { backgroundColor: '#8290d83b !important' },
                '.cm-panels': { backgroundColor: 'var(--lean-subtle, #f5f6f7)', color: 'inherit' },
                '.cm-tooltip': { backgroundColor: 'var(--lean-surface, #fff)', color: 'var(--lean-ink, #33414c)', border: '1px solid var(--lean-border, #ddd)' }
            })
        ] }) });
    }

    private phrases(language: 'zh' | 'en') {
        return language === 'zh' ? EditorState.phrases.of({
            'Find': '查找', 'Find:': '查找：', 'next': '下一处', 'previous': '上一处', 'all': '全选匹配',
            'match case': '区分大小写', 'regexp': '正则表达式', 'by word': '整词匹配', 'close': '关闭查找',
            'No matches': '没有匹配', 'Search': '搜索', 'Fold line': '折叠行', 'Unfold line': '展开行',
            'Fold': '折叠', 'Unfold': '展开', 'folded code': '已折叠源码', 'unfold': '展开'
        }) : [];
    }
    setLanguage(language: 'zh' | 'en', label: string): void {
        if (this.destroyed) return;
        this.view.dispatch({ effects: this.locale.reconfigure(this.phrases(language)) });
        this.view.contentDOM.setAttribute('aria-label', label);
    }

    setSyntax(spans: LeanSyntaxSpan[]): void {
        if (this.destroyed) return;
        const ranges = spans.filter(span => span.className).map(span => Decoration.mark({ class: span.className }).range(span.from, span.to));
        const folds = leanFoldRanges(this.content, spans);
        this.view.dispatch({ effects: [this.syntax.reconfigure(EditorView.decorations.of(Decoration.set(ranges, true))),
            this.folds.reconfigure(foldService.of((_state, start, end) => folds.find(fold => fold.from >= start && fold.from <= end) || null))] });
    }

    setSemantics(tokens: LeanSemanticToken[], diagnostics: LeanLanguageDiagnostic[]): void {
        if (this.destroyed) return;
        const ranges = tokens.flatMap(token => {
            const from = leanPositionOffset(this.content, token.range.start), to = leanPositionOffset(this.content, token.range.end);
            return from < to ? [Decoration.mark({ class: 'lean-semantic-' + token.type.replace(/[^a-zA-Z0-9_-]/g, ''), attributes: { 'data-lean-semantic-token': token.type } }).range(from, to)] : [];
        });
        const warnings = diagnostics.flatMap(diagnostic => {
            const from = leanPositionOffset(this.content, diagnostic.range.start), to = leanPositionOffset(this.content, diagnostic.range.end);
            return from < to ? [Decoration.mark({ class: diagnostic.severity === 1 ? 'lean-diagnostic-error' : 'lean-diagnostic-warning', attributes: { title: diagnostic.message } }).range(from, to)] : [];
        });
        this.view.dispatch({ effects: [this.semantic.reconfigure(EditorView.decorations.of(Decoration.set(ranges, true))),
            this.diagnostics.reconfigure(EditorView.decorations.of(Decoration.set(warnings, true)))] });
    }

    focusRange(range: LeanRange, scroll = true): void {
        if (this.destroyed) return;
        const from = leanPositionOffset(this.content, range.start), to = leanPositionOffset(this.content, range.end), effects = [];
        foldedRanges(this.view.state).between(from, Math.max(from, to), (start, end) => { effects.push(unfoldEffect.of({ from: start, to: end })); });
        effects.push(this.focus.reconfigure(from < to ? EditorView.decorations.of(Decoration.set([Decoration.mark({ class: 'lean-source-focus-range' }).range(from, to)])) : []));
        if (scroll) effects.push(EditorView.scrollIntoView(from, { y: 'center' }));
        this.view.dispatch({ selection: EditorSelection.range(from, to), effects });
    }

    focusPosition(position: LeanPosition): void { this.focusRange({ start: position, end: position }); this.view.focus(); }
    find(): void { openSearchPanel(this.view); }
    fold(): void { foldAll(this.view); }
    unfold(): void { unfoldAll(this.view); }
    refreshLayout(): void { if (!this.destroyed) this.view.requestMeasure(); }
    destroy(): void { if (!this.destroyed) { this.destroyed = true; this.view.destroy(); } }
}
