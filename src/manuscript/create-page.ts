import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { mergeConfig, scanFormalDocuments, shouldExcludeScanPath, type FormalDocument, type PageData } from '@math-workspace/core';
import { documentCollectionForPath, isHardIgnoredDirectory } from '../reader/document-state';
import type { CreatePageInput, CreatePageKind, CreatedManuscriptPage, ManuscriptCreationScope, ManuscriptPagePlan } from './create-page-types';
export type { CreatePageInput, CreatePageKind, CreatedManuscriptPage, ManuscriptCreationScope, ManuscriptPagePlan } from './create-page-types';

const fs = require('node:fs/promises');
const nodeFs = require('node:fs');

interface Entry { filePath: string; kind: 'directory' | 'file' | 'symlink' | 'other' }
interface Snapshot {
    root: string;
    config: any;
    documents: FormalDocument[];
    pages: PageData[];
    entries: Entry[];
    scopes: ManuscriptCreationScope[];
    stateToken: string;
}
const kinds = new Set<CreatePageKind>(['chapter', 'front-matter', 'back-matter', 'continued']);
const controls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const folded = (value: string): string => value.normalize('NFC').toLowerCase();
const inMatterDirectory = (value: string): boolean => value.split('/').some(part => /^(?:front|back)-matter$/i.test(part));
const parent = (file: string): string => path.posix.dirname(file);
const inSameScope = (left: { bookKey?: string; volumeKey?: string }, right: { bookKey?: string; volumeKey?: string }): boolean =>
    left.bookKey === right.bookKey && left.volumeKey === right.volumeKey;

function relativeDirectory(value: unknown): string {
    if (value === '.') return '.';
    if (typeof value !== 'string' || !value || controls.test(value) || value.includes('\\') || path.isAbsolute(value)
        || /^[A-Za-z]:/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error('The manuscript container must be an exact project-relative directory, or . for the project root.');
    }
    return value;
}

/** No existing path component, including the metadata directory, may redirect creation through a symlink. */
async function safePath(root: string, relative: string): Promise<string> {
    relativeDirectory(relative);
    let current = root;
    if ((await fs.lstat(current)).isSymbolicLink() || !(await fs.stat(current)).isDirectory()) {
        throw new Error('The manuscript project root must be a real directory.');
    }
    if (relative === '.') return current;
    const parts = relative.split('/');
    for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        try {
            const stat = await fs.lstat(current);
            if (stat.isSymbolicLink()) throw new Error('Manuscript paths cannot follow symbolic links.');
            if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('A manuscript parent path is not a directory.');
        } catch (error: any) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return current;
}

async function readSource(root: string, relative: string): Promise<string> {
    const file = await safePath(root, relative);
    const handle = await fs.open(file, nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW || 0));
    try {
        if (!(await handle.stat()).isFile()) throw new Error('Manuscript inputs must be regular files.');
        return await handle.readFile('utf8');
    } finally { await handle.close(); }
}

async function projectRoot(rootPath: string): Promise<string> {
    const root = path.resolve(rootPath);
    await safePath(root, '.');
    return fs.realpath(root);
}

function probePage(directory: string, config: any): PageData {
    const filePath = directory === '.' ? '01-manuscript-probe.md' : `${directory}/01-manuscript-probe.md`;
    return scanFormalDocuments([{ filePath, content: '# Manuscript probe\n' }], config).pages[0];
}

function scopesFor(entries: Entry[], pages: PageData[], config: any): ManuscriptCreationScope[] {
    const root = probePage('.', config);
    const scopes: ManuscriptCreationScope[] = [{ container: '.', kind: 'project', title: root.bookTitle || 'Workspace',
        label: `${root.bookTitle || 'Workspace'} (.)`, bookKey: root.bookKey }];
    const directories = entries.filter(entry => entry.kind === 'directory' && !inMatterDirectory(entry.filePath))
        .map(entry => ({ entry, page: probePage(entry.filePath, config), above: probePage(parent(entry.filePath), config) }));
    const formalContainers = new Set(pages.map(page => parent(page.filePath)));
    for (const page of pages) {
        const parts = page.filePath.split('/');
        const matter = parts.findIndex(part => /^(?:front|back)-matter$/i.test(part));
        if (matter >= 0) formalContainers.add(parts.slice(0, matter).join('/') || '.');
    }
    for (const { entry, page, above } of directories) {
        if (page.volumeKey && page.volumeKey !== above.volumeKey) formalContainers.add(parent(entry.filePath));
    }
    for (const { entry, page, above } of directories) {
        const kind = page.volumeKey !== above.volumeKey ? 'volume'
            : page.bookKey !== above.bookKey ? 'book'
                : formalContainers.has(entry.filePath) ? 'formal' : undefined;
        if (!kind) continue;
        const title = kind === 'volume' ? page.volumeTitle || entry.filePath
            : kind === 'book' ? page.bookTitle || entry.filePath : path.posix.basename(entry.filePath);
        scopes.push({ container: entry.filePath, kind, title, label: `${title} (${entry.filePath})`,
            bookKey: page.bookKey, ...(page.volumeKey ? { volumeKey: page.volumeKey } : {}) });
    }
    return scopes;
}

async function readSnapshot(rootPath: string): Promise<Snapshot> {
    const root = await projectRoot(rootPath);
    let configText: string;
    try { configText = await readSource(root, '.math-workspace/config.json'); }
    catch (error: any) {
        if (error.code === 'ENOENT') throw new Error('Create pages only in a prepared project with .math-workspace/config.json.');
        throw error;
    }
    const config = mergeConfig(JSON.parse(configText));
    const entries: Entry[] = [];
    const documents: FormalDocument[] = [];
    const visit = async (directory: string): Promise<void> => {
        const absolute = await safePath(root, directory);
        const children = (await fs.readdir(absolute, { withFileTypes: true })).sort((a: any, b: any) => a.name.localeCompare(b.name));
        for (const child of children) {
            const filePath = directory === '.' ? child.name : `${directory}/${child.name}`;
            if (shouldExcludeScanPath(filePath, config) || isHardIgnoredDirectory(child.name)) continue;
            const kind = child.isSymbolicLink() ? 'symlink' : child.isDirectory() ? 'directory' : child.isFile() ? 'file' : 'other';
            entries.push({ filePath, kind });
            if (kind === 'directory') {
                if (!documentCollectionForPath(`${filePath}/01-manuscript-probe.md`, config)) await visit(filePath);
            } else if (kind === 'file' && /\.md$/i.test(child.name) && !documentCollectionForPath(filePath, config)) {
                documents.push({ filePath, content: await readSource(root, filePath) });
            }
        }
    };
    await visit('.');
    const pages = scanFormalDocuments(documents, config).pages;
    const scopes = scopesFor(entries.filter(entry => !documentCollectionForPath(`${entry.filePath}/01-manuscript-probe.md`, config)), pages, config);
    const stateToken = sha256(JSON.stringify({ root, config: configText, entries, documents: documents.map(document => [document.filePath, sha256(document.content)]) }));
    return { root, config, entries, documents, pages, scopes, stateToken };
}

/** Read-only discovery: no prepare, configuration migration, cache, source or ID writes. */
export async function manuscriptCreationScopes(rootPath: string): Promise<ManuscriptCreationScope[]> {
    return (await readSnapshot(rootPath)).scopes;
}

function normalizedInput(input: CreatePageInput): CreatePageInput {
    if (!input || !kinds.has(input.kind)) throw new Error('Page kind must be chapter, front-matter, back-matter, or continued.');
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 240 || controls.test(input.title)) throw new Error('The page title must be a nonempty single line of at most 240 characters.');
    if (input.kind === 'continued' && input.slug !== undefined) throw new Error('Continued pages use the canonical filename to-be-continued.md; omit --slug.');
    let slug = input.slug;
    if (slug !== undefined) {
        if (typeof slug !== 'string' || !slug || slug !== slug.trim() || controls.test(slug) || /[<>:"/\\|?*]/.test(slug)
            || /^[.]/.test(slug) || /[. ]$/.test(slug) || /\.md$/i.test(slug) || Buffer.byteLength(slug, 'utf8') > 160) {
            throw new Error('The slug must be one filename stem, without a path, .md extension, control characters, or reserved filename punctuation.');
        }
        slug = slug.normalize('NFC');
    }
    return { kind: input.kind, title, container: relativeDirectory(input.container), ...(slug === undefined ? {} : { slug }) };
}

function titleSlug(title: string): string {
    const slug = title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '');
    // Keep generated names bounded in UTF-8 as well as characters.
    let bounded = slug || 'page';
    while (Buffer.byteLength(bounded, 'utf8') > 140) bounded = Array.from(bounded).slice(0, -1).join('');
    return bounded === 'to-be-continued' ? `${bounded}-page` : bounded;
}

function ensureFormalTarget(filePath: string, config: any): void {
    if (shouldExcludeScanPath(filePath, config) || documentCollectionForPath(filePath, config)) {
        throw new Error('The page would be excluded from the formal scan or placed in a draft collection.');
    }
}

async function planFromSnapshot(snapshot: Snapshot, rawInput: CreatePageInput): Promise<ManuscriptPagePlan> {
    const input = normalizedInput(rawInput);
    await safePath(snapshot.root, input.container);
    const scope = snapshot.scopes.find(scope => scope.container === input.container);
    if (!scope) throw new Error('Choose an existing manuscript container returned by manuscriptCreationScopes; matter, excluded and draft directories are not containers.');
    let directory = input.kind === 'front-matter' || input.kind === 'back-matter'
        ? input.container === '.' ? input.kind : `${input.container}/${input.kind}` : input.container;
    if (input.kind === 'front-matter' || input.kind === 'back-matter') {
        const existingDirectories = snapshot.entries.filter(entry => folded(entry.filePath) === folded(directory));
        if (existingDirectories.length > 1) throw new Error('The matter directory has ambiguous filename casing or Unicode normalization.');
        if (existingDirectories.length) directory = existingDirectories[0].filePath;
    }
    await safePath(snapshot.root, directory);
    const stem = input.slug ?? titleSlug(input.title);
    const siblings = snapshot.entries.filter(entry => parent(entry.filePath) === directory);
    let basename = 'to-be-continued.md';
    if (input.kind !== 'continued') {
        const orderedEntries = input.kind === 'chapter'
            ? snapshot.pages.filter(page => page.kind === 'chapter' && page.bookKey === scope.bookKey).map(page => page.filePath)
            : siblings.map(entry => entry.filePath);
        let next = 1, width = 2;
        for (const file of orderedEntries) {
            const prefix = path.posix.basename(file).match(/^(\d+)[-_\s]+/);
            if (prefix) { next = Math.max(next, Number(prefix[1]) + 1); width = Math.max(width, prefix[1].length); }
        }
        if (!Number.isSafeInteger(next)) throw new Error('The manuscript filename sequence exceeds the supported integer range.');
        basename = `${String(next).padStart(width, '0')}-${stem}.md`;
    }
    const filePath = directory === '.' ? basename : `${directory}/${basename}`;
    ensureFormalTarget(filePath, snapshot.config);
    await safePath(snapshot.root, filePath);
    const probe = scanFormalDocuments([{ filePath, content: `# #h-0000000000000000 ${input.title}\n\n` }], snapshot.config).pages[0];
    if (!probe || probe.kind !== input.kind || !inSameScope(probe, scope)) throw new Error('This filename does not describe the requested page kind and manuscript scope. Choose another slug or container.');
    if (probe.title !== input.title) throw new Error('The title must remain one Markdown heading; remove closing heading hashes or other heading delimiters.');
    const continued = input.kind === 'continued' ? snapshot.pages.find(page => page.kind === 'continued' && inSameScope(page, scope)) : undefined;
    const collision = siblings.find(entry => folded(entry.filePath) === folded(filePath)
        || (input.kind !== 'continued' && /\.md$/i.test(entry.filePath)
            && folded(path.posix.basename(entry.filePath).replace(/^\d+[-_\s]+/, '').replace(/\.md$/i, '')) === folded(stem)));
    const existingFile = continued?.filePath || collision?.filePath;
    if (existingFile) {
        const absolute = await safePath(snapshot.root, existingFile);
        if (!(await fs.lstat(absolute)).isFile()) throw new Error('The manuscript filename is already occupied by a non-file path.');
    }
    return { kind: input.kind, title: input.title, container: input.container, filePath, exists: Boolean(existingFile),
        ...(existingFile ? { existingFile, existingTitle: snapshot.pages.find(page => page.filePath === existingFile)?.title } : {}),
        scope, stateToken: snapshot.stateToken };
}

/** Plan against current source/configuration without reserving an ID or changing any file. */
export async function planManuscriptPage(rootPath: string, input: CreatePageInput): Promise<ManuscriptPagePlan> {
    return planFromSnapshot(await readSnapshot(rootPath), input);
}

/** Serialize helper creations, recheck a handed-off plan, then atomically add a complete source file without replacing anything. */
export async function createManuscriptPage(rootPath: string, input: CreatePageInput, options: { expectedStateToken?: string } = {}): Promise<CreatedManuscriptPage> {
    if (options.expectedStateToken !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedStateToken)) throw new Error('Invalid manuscript plan state token.');
    normalizedInput(input);
    const root = await projectRoot(rootPath);
    // Require the prepared project before creating even a temporary lock.
    try { await readSource(root, '.math-workspace/config.json'); }
    catch (error: any) {
        if (error.code === 'ENOENT') throw new Error('Create pages only in a prepared project with .math-workspace/config.json.');
        throw error;
    }
    const lockPath = await safePath(root, '.math-workspace/create-page.lock');
    let lock: any;
    for (let attempt = 0; !lock; attempt++) {
        try { lock = await fs.open(lockPath, 'wx', 0o600); }
        catch (error: any) {
            if (error.code !== 'EEXIST') throw error;
            if (attempt >= 150) throw new Error('Another page creation owns .math-workspace/create-page.lock. Retry after it finishes; inspect the lock after an interrupted operation.');
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }
    try {
        await lock.writeFile(`${JSON.stringify({ pid: process.pid })}\n`);
        const snapshot = await readSnapshot(root);
        const plan = await planFromSnapshot(snapshot, input);
        if (options.expectedStateToken && options.expectedStateToken !== plan.stateToken) throw new Error('The manuscript or configuration changed after this plan. Request a fresh plan before creating the page.');
        if (plan.exists) throw new Error(`A manuscript page already exists: ${plan.existingFile}. Open it or choose another title/slug.`);
        const existingIds = new Set(snapshot.documents.flatMap(document => document.content.match(/\bh-[a-f0-9]{16}\b/g) || []));
        let id: string;
        do { id = `h-${randomBytes(8).toString('hex')}`; } while (existingIds.has(id));
        const content = `# #${id} ${plan.title}\n\n`;
        const checked = scanFormalDocuments([...snapshot.documents, { filePath: plan.filePath, content }], snapshot.config);
        const created = checked.pages.find(page => page.filePath === plan.filePath);
        const issues = checked.issues.filter(issue => issue.file === plan.filePath && issue.severity === 'error');
        if (!created || created.id !== id || issues.length) throw new Error(`The new heading failed formal validation${issues.length ? `: ${issues.map(issue => issue.code).join(', ')}` : '.'}`);
        if ((await readSnapshot(root)).stateToken !== plan.stateToken) throw new Error('The manuscript changed during creation. Request a fresh plan before retrying.');
        const directory = parent(plan.filePath);
        const absoluteDirectory = await safePath(root, directory);
        if (directory !== '.') {
            try { await fs.mkdir(absoluteDirectory); }
            catch (error: any) { if (error.code !== 'EEXIST') throw error; }
            if (!(await fs.lstat(await safePath(root, directory))).isDirectory()) throw new Error('The manuscript destination is not a directory.');
        }
        const destination = await safePath(root, plan.filePath);
        const temporary = path.join(absoluteDirectory, `.create-page-${randomBytes(12).toString('hex')}.tmp`);
        try {
            await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o644 });
            await safePath(root, plan.filePath);
            // link is an atomic, no-replace publication of the fully written temporary file.
            await fs.link(temporary, destination);
        } finally { await fs.rm(temporary, { force: true }); }
        return { ...plan, created: true, id };
    } finally { await lock.close(); await fs.rm(lockPath, { force: true }); }
}
