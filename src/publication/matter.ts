import type { PublicationProfile, PublicationPage, PublicationMatter } from './types';

/** Use explicit structural roles and the chosen work/volumes; never guess a role from prose. */
export function discoverPublicationMatter(profile: PublicationProfile, pages: PublicationPage[]) {
    const chosen = pages.filter(page => profile.chapters.includes(page.path) && page.kind !== 'appendix');
    const anchors = chosen.length ? chosen : pages.filter(page => profile.chapters.includes(page.path));
    const excluded = new Set(profile.matter?.exclude || []);
    const explicit = new Set([...(profile.frontMatter || []), ...(profile.backMatter || [])].map(entry => entry.file).filter(Boolean));
    if (profile.continued?.file) explicit.add(profile.continued.file);
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
        backMatter: found.filter(page => page.volume === undefined && ['back-matter', 'summary'].includes(page.kind)),
        volumeMatter: found.filter(page => page.volume !== undefined && ['front-matter', 'intro', 'back-matter', 'summary'].includes(page.kind)),
        appendices: found.filter(page => page.kind === 'appendix'),
        continued: found.filter(page => page.kind === 'continued')
    };
}
export function resolvePublicationMatter(profile: PublicationProfile, pages: PublicationPage[]): PublicationProfile {
    if (!profile.matter?.automatic) return profile;
    const found = discoverPublicationMatter(profile, pages);
    const entry = (page: PublicationPage): PublicationMatter => ({ file: page.path, includeInToc: true });
    const continued = !profile.continued?.file && found.continued.length === 1 ? { ...profile.continued, file: found.continued[0].path } : profile.continued;
    return { ...profile, frontMatter: [...(profile.frontMatter || []), ...found.frontMatter.map(entry)], backMatter: [...(profile.backMatter || []), ...found.backMatter.map(entry)], chapters: [...new Set([...profile.chapters, ...found.volumeMatter.map(page => page.path), ...found.appendices.map(page => page.path)])], continued };
}
