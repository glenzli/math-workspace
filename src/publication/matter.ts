import type { PublicationProfile, PublicationPage, PublicationMatter } from './types';

/** Use explicit structural roles and the chosen work/volumes; never guess a role from prose. */
export function discoverPublicationMatter(profile: PublicationProfile, pages: PublicationPage[]) {
    const chosen = pages.filter(page => profile.chapters.includes(page.path) && page.kind !== 'appendix');
    const anchors = chosen.length ? chosen : pages.filter(page => profile.chapters.includes(page.path));
    const excluded = new Set(profile.matter?.exclude || []);
    const manual = profile.matter?.automatic ? [] : [...(profile.frontMatter || []), ...(profile.backMatter || [])];
    const explicit = new Set(manual.map(entry => entry.file).filter(Boolean));
    if (!profile.matter?.automatic && profile.continued?.file) explicit.add(profile.continued.file);
    const inScope = (page: PublicationPage) => {
        if (!anchors.length || explicit.has(page.path) || excluded.has(page.path)) return false;
        const scope = profile.scope;
        if (scope && (scope.books?.length || scope.volumes?.length || scope.paths?.length)) {
            if (!(scope.books?.includes(page.book) || scope.volumes?.includes(page.volume) || scope.paths?.some(name => page.path === name || page.path.startsWith(`${name}/`)))) return false;
        }
        return anchors.some(anchor => page.book === anchor.book && (page.volume === undefined || page.volume === anchor.volume));
    };
    const found = pages.filter(inScope);
    return {
        frontMatter: found.filter(page => page.volume === undefined && ['front-matter', 'intro'].includes(page.kind)),
        backMatter: found.filter(page => page.volume === undefined && ['back-matter', 'summary', 'continued'].includes(page.kind)),
        volumeMatter: found.filter(page => page.volume !== undefined && ['front-matter', 'intro', 'back-matter', 'summary', 'continued'].includes(page.kind)),
        appendices: found.filter(page => page.kind === 'appendix'),
        continued: found.filter(page => page.kind === 'continued')
    };
}
/** A source-owned ending, even when excluded, must not produce a fallback declaration. */
export function hasPublicationContinuedManuscript(profile: PublicationProfile, pages: PublicationPage[]): boolean {
    if (profile.matter?.automatic) return discoverPublicationMatter({ ...profile, matter: { ...profile.matter, exclude: [] } }, pages).continued.length > 0;
    const manuscripts = new Set([...profile.chapters, ...(profile.backMatter || []).map(entry => entry.file)]);
    return !profile.continued?.file && pages.some(page => page.kind === 'continued' && manuscripts.has(page.path));
}
export function resolvePublicationMatter(profile: PublicationProfile, pages: PublicationPage[]): PublicationProfile {
    if (!profile.matter?.automatic) return profile;
    const found = discoverPublicationMatter(profile, pages);
    const entry = (page: PublicationPage): PublicationMatter => ({ file: page.path, includeInToc: true });
    const available = profile.matter.exclude?.length ? discoverPublicationMatter({ ...profile, matter: { ...profile.matter, exclude: [] } }, pages) : found;
    const included = (page: PublicationPage) => page.kind !== 'continued' || profile.continued?.enabled !== false;
    const assigned = new Set([...available.frontMatter, ...available.backMatter, ...available.volumeMatter].map(page => page.path));
    // A continued manuscript is back matter, including within its owning volume.
    const continued = { enabled: profile.continued?.enabled };
    // Manual entries remain in the saved overrides, but only one source is printed.
    return { ...profile, frontMatter: found.frontMatter.map(entry), backMatter: found.backMatter.filter(included).map(entry), chapters: [...new Set([...profile.chapters.filter(file => !assigned.has(file)), ...found.volumeMatter.filter(included).map(page => page.path), ...found.appendices.map(page => page.path)])], continued };
}
