export type UnnumberedPageKind = 'intro' | 'summary' | 'front-matter' | 'back-matter' | 'continued';
export type ManuscriptPageKind = 'chapter' | 'appendix' | UnnumberedPageKind;

export interface ManuscriptPage {
    kind: string;
    filePath: string;
    bookKey?: string;
    bookOrder?: number;
    volumeKey?: string;
    volumeOrder?: number;
    order?: number;
    unitOrder?: number;
}

export function isPageLabelType(type: unknown): type is ManuscriptPageKind {
    return typeof type === 'string' && ['chapter', 'appendix', 'intro', 'summary', 'front-matter', 'back-matter', 'continued'].includes(type);
}

export function isManuscriptMatterKind(kind: unknown): kind is 'front-matter' | 'back-matter' | 'continued' {
    return kind === 'front-matter' || kind === 'back-matter' || kind === 'continued';
}

export function unnumberedPageKind(filePath: string): UnnumberedPageKind | undefined {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const basename = parts.pop() || '';
    if (!/\.md$/i.test(basename)) return;
    if (/^(?:\d+[-_\s]+)?to-be-continued\.md$/i.test(basename)) return 'continued';
    const directory = [...parts].reverse().find(part => /^(?:front|back)-matter$/i.test(part));
    if (directory) return directory.toLowerCase() as 'front-matter' | 'back-matter';
    if (/^(?:00[-_\s]?)?(?:intro|introduction)\.md$/i.test(basename)) return 'intro';
    if (/^summary\.md$/i.test(basename)) return 'summary';
}

function compareNumber(a: number | undefined, b: number | undefined, missing: number): number {
    const left = Number.isFinite(a) ? a! : missing;
    const right = Number.isFinite(b) ? b! : missing;
    return left === right ? 0 : left - right;
}

function legacyPageOrder(page: ManuscriptPage, context: 'reader' | 'export'): number | undefined {
    if (context === 'reader') return page.order;
    if (page.kind === 'intro') return -100000;
    if (page.kind === 'summary') return 90000;
    if (page.kind === 'appendix') return page.unitOrder ?? 100000;
    return page.unitOrder ?? page.order;
}

/** Keep ordinary pages' existing relative order; place new matter around its exact book/volume. */
export function sortManuscriptPages<T extends ManuscriptPage>(pages: readonly T[], context: 'reader' | 'export' | 'workspace' = 'reader'): T[] {
    const missing = context === 'reader' ? 0 : Number.MAX_SAFE_INTEGER;
    const compareLegacy = (a: T, b: T) => context === 'workspace' ? a.filePath.localeCompare(b.filePath)
        : compareNumber(a.bookOrder, b.bookOrder, missing)
        || compareNumber(a.volumeOrder, b.volumeOrder, missing)
        || compareNumber(legacyPageOrder(a, context), legacyPageOrder(b, context), missing)
        || a.filePath.localeCompare(b.filePath);
    let ordered = [...pages].sort(compareLegacy);
    const scopes = new Map<string, T[]>();
    for (const page of ordered) {
        if (!isManuscriptMatterKind(page.kind)) continue;
        const key = JSON.stringify([page.bookKey, page.volumeKey]);
        if (!scopes.has(key)) scopes.set(key, []);
        scopes.get(key)!.push(page);
    }
    // Place volume matter first so book endings also follow matter-only volumes.
    const groups = [...scopes.values()].sort((a, b) => Number(a[0].volumeKey === undefined) - Number(b[0].volumeKey === undefined));
    for (const matter of groups) {
        const scope = matter[0];
        const withinScope = (page: T) => page.bookKey === scope.bookKey && (scope.volumeKey === undefined || page.volumeKey === scope.volumeKey);
        const group = new Set(matter);
        const remaining = ordered.filter(page => !group.has(page));
        const first = remaining.findIndex(withinScope);
        let last = -1;
        for (let index = 0; index < remaining.length; index++) if (withinScope(remaining[index])) last = index;
        const rank = (page: T) => page.kind === 'front-matter' ? 0 : page.kind === 'back-matter' ? 1 : 2;
        const sortedMatter = [...matter].sort((a, b) => rank(a) - rank(b)
            || compareNumber(a.order, b.order, Number.MAX_SAFE_INTEGER) || a.filePath.localeCompare(b.filePath));
        if (first < 0) {
            const next = remaining.findIndex(page => compareLegacy(scope, page) < 0);
            remaining.splice(next < 0 ? remaining.length : next, 0, ...sortedMatter);
            ordered = remaining;
            continue;
        }
        const front = sortedMatter.filter(page => page.kind === 'front-matter');
        const back = sortedMatter.filter(page => page.kind !== 'front-matter');
        ordered = [...remaining.slice(0, first), ...front, ...remaining.slice(first, last + 1), ...back, ...remaining.slice(last + 1)];
    }
    return ordered;
}
