/** Shared bibliographic values. Edition identity, dates and source selection belong to a publication. */
export interface WorkAuthor {
    name: string;
    nativeName?: string;
    aliases?: string[];
    orcid?: string;
    affiliation?: string;
}
export interface WorkMetadata {
    title?: string;
    subtitle?: string;
    authors?: WorkAuthor[];
    language?: string;
    description?: string;
    license?: string;
    licenseUrl?: string;
    website?: string;
    repository?: string;
    preferredCitation?: string;
    keywords?: string[];
    doi?: { conceptDoi?: string; provenance?: string };
}
export const WORK_METADATA_TEXT_FIELDS = ['title', 'subtitle', 'language', 'description', 'license', 'licenseUrl', 'website', 'repository', 'preferredCitation'] as const;
const text = (value: unknown, field: string, limit = 100000): string => {
    if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error(`Invalid metadata ${field}.`);
    return value.trim();
};
export function metadataDoi(value: unknown): string | undefined {
    if (value === undefined) return;
    const normalized = text(value, 'DOI', 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
    if (normalized && !/^10\.\d{4,9}\/[^\s<>]+$/i.test(normalized)) throw new Error('Enter a DOI such as 10.1234/example.');
    return normalized;
}
function url(value: unknown, field: string): string {
    const result = text(value, field, 3000);
    if (result && !/^https?:\/\/[^\s<>]+$/i.test(result)) throw new Error(`Metadata ${field} must be an HTTP or HTTPS URL.`);
    if (result) {
        let parsed: any;
        try { parsed = new (globalThis as any).URL(result); } catch { throw new Error(`Invalid metadata ${field} URL.`); }
        if (!parsed.hostname || parsed.username || parsed.password) throw new Error(`Invalid metadata ${field} URL.`);
    }
    return result;
}
function strings(input: unknown, field: string, limit = 100): string[] {
    if (!Array.isArray(input) || input.length > limit) throw new Error(`Invalid metadata ${field}.`);
    return [...new Set(input.map(value => text(value, field, 3000)).filter(Boolean))];
}
/** Presence is significant: absent inherits, empty text/list explicitly clears an optional value. */
export function normalizeWorkMetadata(input: unknown): WorkMetadata {
    if (input === undefined) return {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Metadata must be an object.');
    const value = input as any, result: WorkMetadata = {};
    for (const field of WORK_METADATA_TEXT_FIELDS) if (value[field] !== undefined) {
        result[field] = ['website', 'repository', 'licenseUrl'].includes(field) ? url(value[field], field) : text(value[field], field);
    }
    if (value.authors !== undefined) {
        if (!Array.isArray(value.authors) || value.authors.length > 100) throw new Error('Invalid metadata authors.');
        result.authors = value.authors.map((author: any) => {
            if (!author || typeof author !== 'object' || Array.isArray(author)) throw new Error('Invalid metadata author.');
            const name = text(author.name, 'author name', 1000); if (!name) throw new Error('Every publication author needs a name.');
            const result: WorkAuthor = { name };
            for (const field of ['nativeName', 'affiliation'] as const) if (author[field] !== undefined) result[field] = text(author[field], field, 3000);
            if (author.aliases !== undefined) result.aliases = strings(author.aliases, 'author aliases');
            if (author.orcid !== undefined) {
                const orcid = text(author.orcid, 'ORCID', 1000).replace(/^https?:\/\/orcid\.org\//i, '');
                if (orcid && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(orcid)) throw new Error('Enter an ORCID such as 0000-0002-1825-0097.');
                result.orcid = orcid ? `https://orcid.org/${orcid.toUpperCase()}` : '';
            }
            return result;
        });
    }
    if (value.keywords !== undefined) result.keywords = strings(value.keywords, 'keywords');
    if (value.doi !== undefined) {
        if (!value.doi || typeof value.doi !== 'object' || Array.isArray(value.doi)) throw new Error('Invalid metadata DOI.');
        result.doi = {};
        if (value.doi.conceptDoi !== undefined) result.doi.conceptDoi = metadataDoi(value.doi.conceptDoi);
        if (value.doi.provenance !== undefined) result.doi.provenance = text(value.doi.provenance, 'DOI provenance', 3000);
    }
    return result;
}
export function mergeWorkMetadata(project: WorkMetadata, overrides: WorkMetadata): WorkMetadata {
    return { ...project, ...overrides, ...(project.doi || overrides.doi ? { doi: { ...project.doi, ...overrides.doi } } : {}) };
}
/** Old pdf identity fields remain a read-only fallback; explicit common metadata takes precedence. */
export function projectMetadata(config: any): WorkMetadata {
    const pdf = config?.pdf || {}, legacy: any = {};
    for (const field of WORK_METADATA_TEXT_FIELDS) if (pdf[field]) legacy[field] = pdf[field];
    if (pdf.lang) legacy.language = pdf.lang;
    if (Array.isArray(pdf.authors) && pdf.authors.length) legacy.authors = pdf.authors;
    else if (pdf.author) legacy.authors = [{ name: pdf.author, ...(pdf.authorNative ? { nativeName: pdf.authorNative } : {}), ...(pdf.authorAliases?.length ? { aliases: pdf.authorAliases } : {}), ...(pdf.orcid ? { orcid: pdf.orcid } : {}) }];
    if (pdf.keywords) legacy.keywords = pdf.keywords;
    if (pdf.workDoi) legacy.doi = { conceptDoi: pdf.workDoi };
    return mergeWorkMetadata(normalizeWorkMetadata(legacy), normalizeWorkMetadata(config?.metadata));
}
