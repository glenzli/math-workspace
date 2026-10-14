export type ProjectKnowledgeSourceKind = 'concept-appendix' | 'glossary' | 'notation-appendix' | 'summary-page';

export interface ProjectKnowledgeSource {
    kind: ProjectKnowledgeSourceKind;
    /** All detected roles; optional when reading analysis produced by older versions. */
    kinds?: ProjectKnowledgeSourceKind[];
    filePath: string;
    title: string;
    confidence: 'high' | 'medium';
    extractedDefinitions: number;
}

export interface ProjectKnowledgeDefinition {
    title: string;
    filePath: string;
    line: number;
    content: string;
    origin: 'concept-appendix' | 'glossary';
}

export interface ProjectStructureAnalysis {
    schemaVersion: 1;
    generatedBy: 'math-workspace';
    sources: ProjectKnowledgeSource[];
    summary: {
        conceptSources: number;
        notationSources: number;
        summaryPages: number;
        extractedDefinitions: number;
    };
}

export interface ProjectKnowledgeAnalysis {
    project: ProjectStructureAnalysis;
    definitions: ProjectKnowledgeDefinition[];
}

interface ProjectDocument {
    filePath: string;
    content: string;
}

interface Heading {
    level: number;
    line: number;
    title: string;
}

const GLOSSARY_NAME_RE = /(?:^|[^a-z])(?:glossary|terminology)(?:$|[^a-z])|术语/i;
const SUMMARY_NAME_RE = /(?:^|[-_])summary(?:$|[-_])|总结|小结/i;
const GENERIC_HEADING_RE = /^(?:附录\s*[A-Z0-9]*\s*[:：-]?\s*)?(?:概念|术语|定义|符号|记号|约定|目录|索引|说明|范围|总览|概览|引言|导言|参考文献|references?|introduction|overview|scope|notes?)$/i;
const APPENDIX_PREFIX_RE = /^(?:appendix(?=$|[\s_:：.、–—-])|附录)[\s_:：.、–—-]*/i;
const CONCEPT_TITLE_RE = /^(?:(?:core|key|basic|fundamental|main|common|project|mathematical)\s+)*(?:concepts?|definitions?)(?:\s+(?:index|table|list|overview|summary|reference))?$|^(?:(?:核心|基本|基础|关键|主要|常用|本书|全书|全卷|项目)\s*)*(?:概念|定义)(?:表|总表|一览表?|汇总|索引|总览|概览|速查表?|说明|清单)?$/i;
const NOTATION_TITLE_RE = /^(?:(?:core|key|basic|fundamental|main|common|project|mathematical)\s+)*(?:symbols?|notations?|conventions?)(?:\s+(?:index|table|list|overview|summary|reference|conventions))?$|^(?:table|list|index)\s+of\s+(?:symbols?|notation|conventions?)$|^(?:(?:核心|基本|基础|关键|主要|常用|本书|全书|全卷|项目)\s*)*(?:符号|记号|约定|符号约定|记号约定)(?:表|总表|一览表?|汇总|索引|总览|概览|速查表?|说明|清单)?$/i;

interface KnowledgeRoles {
    concept: boolean;
    glossary: boolean;
    notation: boolean;
}

function normalizePath(value: string): string {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function fileStem(filePath: string): string {
    const basename = normalizePath(filePath).split('/').pop() || '';
    return basename.replace(/\.md$/i, '');
}

function normalizeTerm(value: string): string {
    return String(value || '')
        .replace(/#[-A-Za-z0-9_]+\b/g, '')
        .replace(/\{#[^}]+\}/g, '')
        .replace(/[`*_~]/g, '')
        .replace(/^\s*(?:\d+(?:\.\d+)*|[A-Z])\s*[.、:：-]\s*/, '')
        .replace(/^\s*(?:定义|Definition)\s*[（(]([^）)]+)[）)]\s*[:：]?\s*$/i, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

function unfencedLines(content: string): string[] {
    let fence: { marker: string; length: number } | undefined;
    return String(content || '').split(/\r?\n/).map(line => {
        const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (fence) {
            if (match && match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) fence = undefined;
            return '';
        }
        if (match) {
            fence = { marker: match[1][0], length: match[1].length };
            return '';
        }
        return line;
    });
}

function parseHeadings(content: string): Heading[] {
    const headings: Heading[] = [];
    unfencedLines(content).forEach((line, index) => {
        const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
        if (!match) return;
        const title = normalizeTerm(match[2].replace(/\s+#+\s*$/, ''));
        if (title) headings.push({ level: match[1].length, line: index + 1, title });
    });
    return headings;
}

function knowledgeRoles(value: string): KnowledgeRoles {
    const name = normalizeTerm(value.replace(/_/g, ' '));
    const appendix = APPENDIX_PREFIX_RE.test(name);
    const descriptor = name.replace(APPENDIX_PREFIX_RE, '').replace(/[-_:：.–—]+/g, ' ').replace(/^\d+\s+/, '').trim();
    const candidates = appendix ? [descriptor, descriptor.replace(/^[^\s、]+[\s、]+/, '')] : [descriptor];
    const roles: KnowledgeRoles = { concept: false, glossary: false, notation: false };
    for (const candidate of candidates) {
        // Glossary and terminology names may include a domain, such as "Operator glossary".
        const glossary = GLOSSARY_NAME_RE.test(candidate);
        const parts = candidate.split(/\s+(?:and|with)\s+|[&/+,、与和及暨]/i).map(part => part.trim()).filter(Boolean);
        const partRoles = parts.map(part => ({ concept: CONCEPT_TITLE_RE.test(part) || GLOSSARY_NAME_RE.test(part), notation: NOTATION_TITLE_RE.test(part) }));
        const dedicated = partRoles.length > 0 && partRoles.every(part => part.concept || part.notation);
        roles.glossary ||= glossary;
        roles.concept ||= glossary || (dedicated && partRoles.some(part => part.concept));
        roles.notation ||= dedicated && partRoles.some(part => part.notation);
    }
    return roles;
}

function sourceKind(document: ProjectDocument, headings: Heading[]): Omit<ProjectKnowledgeSource, 'extractedDefinitions'> | undefined {
    const stem = fileStem(document.filePath);
    const topTitle = headings.length > 0
        ? headings.filter(heading => heading.level === Math.min(...headings.map(item => item.level)))[0]?.title || ''
        : '';
    const appendix = APPENDIX_PREFIX_RE.test(stem) || APPENDIX_PREFIX_RE.test(topTitle) || /(?:^|\/)附录/.test(normalizePath(document.filePath));
    const names = [knowledgeRoles(stem), knowledgeRoles(topTitle)];
    const concept = names.some(name => name.concept);
    const glossary = names.some(name => name.glossary);
    const notation = names.some(name => name.notation);
    const summary = SUMMARY_NAME_RE.test(stem) || SUMMARY_NAME_RE.test(topTitle);
    const kinds: ProjectKnowledgeSourceKind[] = [];
    // Preserve historical primary kinds while allowing the same file to supply more roles.
    const historicalGlossary = /glossary|术语/i.test(`${stem} ${topTitle}`) || (!appendix && (glossary || /概念表|核心概念/.test(`${stem} ${topTitle}`)));
    if (concept) kinds.push(historicalGlossary ? 'glossary' : 'concept-appendix');
    if (notation) kinds.push('notation-appendix');
    if (summary) kinds.push('summary-page');
    if (!kinds.length) return undefined;
    if (summary && !appendix && !historicalGlossary) kinds.unshift(...kinds.splice(kinds.indexOf('summary-page'), 1));
    return { kind: kinds[0], kinds, filePath: normalizePath(document.filePath), title: topTitle || stem, confidence: appendix && (concept || notation) ? 'high' : 'medium' };
}

/** Retain concept sections and line numbers while excluding notation-only sections and code examples. */
function conceptDocument(document: ProjectDocument): ProjectDocument {
    const lines = unfencedLines(document.content);
    const headings = parseHeadings(document.content);
    const sections: Array<{ level: number; include: boolean }> = [];
    headings.forEach((heading, index) => {
        while (sections.length && sections[sections.length - 1].level >= heading.level) sections.pop();
        const roles = knowledgeRoles(heading.title);
        const include = roles.concept || (!roles.notation && (sections[sections.length - 1]?.include ?? true));
        sections.push({ level: heading.level, include });
        if (!include) lines.fill('', heading.line - 1, headings[index + 1] ? headings[index + 1].line - 1 : lines.length);
    });
    return { ...document, content: lines.join('\n') };
}

function tableCells(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed.includes('|')) return [];
    const body = trimmed.replace(/^\|/, '').replace(/\|$/, '');
    const cells: string[] = [];
    let current = '';
    let escaped = false;
    for (const char of body) {
        if (escaped) {
            current += char;
            escaped = false;
        } else if (char === '\\') {
            current += char;
            escaped = true;
        } else if (char === '|') {
            cells.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current.trim());
    return cells;
}

function isTableDivider(cells: string[]): boolean {
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function isTermColumn(value: string): boolean {
    return /^(?:术语|概念|名称|名词|term|concept|name)$/i.test(normalizeTerm(value));
}

function isDefinitionColumn(value: string): boolean {
    return /^(?:定义|说明|释义|描述|definition|meaning|description|note)$/i.test(normalizeTerm(value));
}

function candidateContent(lines: string[], heading: Heading, nextHeading: Heading | undefined): string {
    const end = nextHeading ? nextHeading.line - 1 : lines.length;
    const content = lines.slice(heading.line, end)
        .filter(line => !/^\s{0,3}#{1,6}\s+/.test(line))
        .join('\n')
        .trim();
    return content;
}

function headingDefinitions(document: ProjectDocument, source: ProjectKnowledgeSource): ProjectKnowledgeDefinition[] {
    const lines = String(document.content || '').split(/\r?\n/);
    const headings = parseHeadings(document.content);
    if (headings.length < 2) return [];
    const pageLevel = Math.min(...headings.map(heading => heading.level));
    const entryHeadings = headings.filter(heading => {
        const roles = knowledgeRoles(heading.title);
        return heading.level > pageLevel && !GENERIC_HEADING_RE.test(heading.title) && !roles.concept && !roles.notation;
    });
    const itemLevel = Math.max(...entryHeadings.map(heading => heading.level));
    if (!Number.isFinite(itemLevel)) return [];

    return entryHeadings
        .filter(heading => heading.level === itemLevel)
        .flatMap(heading => {
            const title = normalizeTerm(heading.title);
            if (!title || GENERIC_HEADING_RE.test(title)) return [];
            const nextHeading = headings.find(candidate => candidate.line > heading.line && candidate.level <= heading.level);
            const content = candidateContent(lines, heading, nextHeading);
            if (content.replace(/\s+/g, '').length < 16) return [];
            return [{
                title,
                filePath: source.filePath,
                line: heading.line,
                content,
                origin: source.kind === 'glossary' ? 'glossary' : 'concept-appendix'
            }];
        });
}

function tableDefinitions(document: ProjectDocument, source: ProjectKnowledgeSource): ProjectKnowledgeDefinition[] {
    const lines = unfencedLines(document.content);
    const definitions: ProjectKnowledgeDefinition[] = [];
    for (let index = 0; index < lines.length - 2; index++) {
        const headers = tableCells(lines[index]);
        const divider = tableCells(lines[index + 1]);
        if (/^(?: {4}|\t)/.test(lines[index]) || !headers.length || headers.length !== divider.length || !isTableDivider(divider)) continue;
        const termIndex = headers.findIndex(isTermColumn);
        const definitionIndex = headers.findIndex(isDefinitionColumn);
        if (termIndex < 0 || definitionIndex < 0 || termIndex === definitionIndex) continue;
        for (let row = index + 2; row < lines.length; row++) {
            const cells = tableCells(lines[row]);
            if (cells.length !== headers.length) break;
            const title = normalizeTerm(cells[termIndex]);
            const content = cells[definitionIndex]?.trim() || '';
            if (!title || !content || isTableDivider(cells)) continue;
            definitions.push({
                title,
                filePath: source.filePath,
                line: row + 1,
                content,
                origin: source.kind === 'glossary' ? 'glossary' : 'concept-appendix'
            });
        }
        index++;
    }
    return definitions;
}

function definitionKey(definition: Pick<ProjectKnowledgeDefinition, 'filePath' | 'title'>): string {
    return `${normalizePath(definition.filePath)}:${normalizeTerm(definition.title).toLocaleLowerCase()}`;
}

function uniqueDefinitions(definitions: ProjectKnowledgeDefinition[], existing: Array<{ title?: string; file?: string }> = []): ProjectKnowledgeDefinition[] {
    const existingKeys = new Set(existing.map(definition => definitionKey({ filePath: definition.file || '', title: definition.title || '' })));
    const seen = new Set<string>();
    return definitions.filter(definition => {
        const key = definitionKey(definition);
        if (!definition.title || existingKeys.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Discovers deliberately named knowledge pages and extracts only their most
 * structural concept entries. It never infers terminology from ordinary prose.
 */
export function analyzeProjectKnowledge(documents: ProjectDocument[], existingDefinitions: Array<{ title?: string; file?: string }> = []): ProjectKnowledgeAnalysis {
    const sourceDocuments = documents
        .map(document => ({ document, headings: parseHeadings(document.content) }))
        .map(({ document, headings }) => ({ document, source: sourceKind(document, headings) }))
        .filter((item): item is { document: ProjectDocument; source: Omit<ProjectKnowledgeSource, 'extractedDefinitions'> } => !!item.source)
        .sort((left, right) => left.source.filePath.localeCompare(right.source.filePath));

    const rawDefinitions = sourceDocuments.flatMap(({ document, source }) => {
        const completed = { ...source, extractedDefinitions: 0 } as ProjectKnowledgeSource;
        if (!(completed.kinds || [completed.kind]).some(kind => kind === 'concept-appendix' || kind === 'glossary')) return [];
        const concepts = conceptDocument(document);
        return [...tableDefinitions(concepts, completed), ...headingDefinitions(concepts, completed)];
    });
    const definitions = uniqueDefinitions(rawDefinitions, existingDefinitions);
    const definitionCountBySource = new Map<string, number>();
    definitions.forEach(definition => definitionCountBySource.set(definition.filePath, (definitionCountBySource.get(definition.filePath) || 0) + 1));
    const sources = sourceDocuments.map(({ source }) => ({
        ...source,
        extractedDefinitions: definitionCountBySource.get(source.filePath) || 0
    }));
    const summary = {
        conceptSources: sources.filter(source => (source.kinds || [source.kind]).some(kind => kind === 'concept-appendix' || kind === 'glossary')).length,
        notationSources: sources.filter(source => (source.kinds || [source.kind]).includes('notation-appendix')).length,
        summaryPages: sources.filter(source => (source.kinds || [source.kind]).includes('summary-page')).length,
        extractedDefinitions: definitions.length
    };
    return {
        project: { schemaVersion: 1, generatedBy: 'math-workspace', sources, summary },
        definitions
    };
}
