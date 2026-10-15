import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';

export const version = '4.1.3';
export const format = 'math-workspace.formula-reflow/v1';
export interface FormulaRenderInput { latex: string; widthPx: number; fontSizePx: number }
export interface FormulaRenderOutput { markup: string; widthPx: number; heightPx: number }

const MAX_INPUT = 16_384;
const MAX_OUTPUT = 1_048_576;
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
// No loader, autoload, require, HTML, menus, or document-wide scanning is installed.
mathjax.asyncLoad = () => { throw new Error('Additional formula resources are unavailable.'); };
let sequence = 0;

function dimensions(input: FormulaRenderInput): void {
    if (typeof input?.latex !== 'string' || !input.latex.trim() || input.latex.length > MAX_INPUT
        || !Number.isFinite(input.widthPx) || input.widthPx < 48 || input.widthPx > 8192
        || !Number.isFinite(input.fontSizePx) || input.fontSizePx < 8 || input.fontSizePx > 64) {
        throw new Error('This formula cannot be adapted at the requested size.');
    }
}
function fail(error: any): never { throw new Error(error?.message || 'This formula cannot be adapted.'); }

/** Render one untouched source expression; TeX state is private to this conversion. */
export function renderFormula(input: FormulaRenderInput): FormulaRenderOutput {
    dimensions(input);
    if (mathjax.version !== version || Object.keys((MathJaxTexFont as any).dynamicFiles).length) {
        throw new Error('The bundled formula runtime is incompatible.');
    }
    const tex = new TeX({ packages: ['base', 'ams', 'newcommand'], tags: 'none', maxBuffer: MAX_INPUT * 4, maxMacros: 2000,
        formatError: (_jax: unknown, error: unknown) => fail(error) });
    const tags = tex.parseOptions.tags, start = tags.start.bind(tags), tag = tags.tag.bind(tags);
    // Observe parsed environments/macros so tags cannot disappear behind macro expansion.
    tags.start = (environment, taggable, numbered) => {
        if (numbered) throw new Error('Numbered formulas retain their original layout.');
        start(environment, taggable, numbered);
    };
    tags.tag = (value, noFormat) => {
        if (value) throw new Error('Tagged formulas retain their original layout.');
        tag(value, noFormat);
    };
    const svg = new SVG({ fontData: MathJaxTexFont, fontCache: 'local', localID: 'mwfr-' + (++sequence),
        displayOverflow: 'linebreak', linebreaks: { inline: false, width: '100%', lineleading: .35 } });
    const page = mathjax.document('', { InputJax: tex, OutputJax: svg,
        compileError: (_page: unknown, _math: unknown, error: unknown) => fail(error),
        typesetError: (_page: unknown, _math: unknown, error: unknown) => fail(error) });
    const container = page.convert(input.latex, { display: true, em: input.fontSizePx, ex: input.fontSizePx * .442,
        containerWidth: input.widthPx });
    const images = adaptor.tags(container, 'svg');
    if (images.length !== 1) throw new Error('This formula needs an unsupported display layout.');
    const image = images[0];
    // A system-font fallback has no reliable offline metrics in the lite adaptor.
    if (adaptor.tags(image, 'text').length) throw new Error('This formula uses glyphs unavailable in the bundled font.');
    const viewBox = String(adaptor.getAttribute(image, 'viewBox') || '').trim().split(/\s+/).map(Number);
    if (viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
        throw new Error('This formula needs an unsupported display layout.');
    }
    const widthPx = viewBox[2] * input.fontSizePx / 1000, heightPx = viewBox[3] * input.fontSizePx / 1000;
    if (widthPx > input.widthPx + 1 || heightPx > 8192 || widthPx * heightPx > 8_000_000) {
        throw new Error('This formula cannot fit without changing its structure.');
    }
    // Block layout does not use the inline baseline style or font-dependent ex dimensions.
    adaptor.removeAttribute(image, 'style');
    adaptor.setAttribute(image, 'width', String(widthPx)); adaptor.setAttribute(image, 'height', String(heightPx));
    const markup = adaptor.outerHTML(image);
    if (markup.length > MAX_OUTPUT) throw new Error('This formula is too large to adapt.');
    return { markup, widthPx, heightPx };
}
