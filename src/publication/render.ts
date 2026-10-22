import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { mergeConfig, scanFormalDocuments, shouldExcludeScanPath, formatPageHeading, formatPageReference, stripIgnoredMarkdown, toPosix, sortManuscriptPages, normalizeWorkMetadata, metadataDoi, projectMetadata } from '@math-workspace/core';
import { resolvePublicationMetadata } from './metadata';
import { resolvePublicationMatter, hasPublicationContinuedManuscript } from './matter';
import { PublicationStore, safePath, relativeInput, publicationId, canonical, sha256, atomicJson } from './store';
import type { PublicationProfile, PublicationPlan, PublicationPage, PublicationInput, PublicationTools, PublicationTool, PublicationServiceOptions, PublicationDoiBinding, PublicationBuild, PublicationBuildOptions, PublicationManifest, PublicationResolvedMatter } from './types';

const fs = require('node:fs/promises');
const childProcess = require('node:child_process');
const optionalText = (value: any, name: string, limit = 20000): string | undefined => {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error(`Invalid publication ${name}.`);
    return value.trim() || undefined;
};
const list = (value: any, name: string, limit = 1000): any[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > limit) throw new Error(`Invalid publication ${name}.`);
    return value;
};
export function normalizeDoi(value: unknown): string | undefined {
    return metadataDoi(value) || undefined;
}
export function normalizeProfile(input: PublicationProfile): PublicationProfile {
    if (!input || typeof input !== 'object') throw new Error('A publication profile is required.');
    const automatic = input.matter?.automatic === true;
    const matter = (items: any, role: string) => list(items, role, 100).map(item => {
        if (!item || typeof item !== 'object') throw new Error(`Invalid ${role} entry.`);
        const value = { title: optionalText(item.title, `${role} title`, 1000), file: item.file === undefined ? undefined : relativeInput(item.file), content: optionalText(item.content, `${role} content`, 1000000), includeInToc: item.includeInToc === true };
        if (value.file && !/\.md$/i.test(value.file)) throw new Error('Publication matter files must be Markdown files.');
        if (!automatic && !value.file && !value.content && !value.title) throw new Error(`An empty ${role} entry cannot be published.`);
        return value;
    });
    const metadata = normalizeWorkMetadata(input);
    const chapters = [...new Set<string>(list(input.chapters, 'chapter selection', 10000).map(relativeInput))];
    if (!chapters.length) throw new Error('Select at least one chapter or page.');
    if (chapters.some(file => !/\.md$/i.test(file))) throw new Error('Publication chapters must be Markdown files.');
    const version = optionalText(input.version, 'version', 200);
    if (!version) throw new Error('Publication version is required.');
    const engine = input.pdf?.engine || 'xelatex';
    if (!['xelatex', 'lualatex', 'pdflatex', 'tectonic'].includes(engine)) throw new Error('Unsupported publication PDF engine.');
    const paper = input.pdf?.paper || 'a4', margin = input.pdf?.margin || '2.5cm';
    if (!/^[a-zA-Z0-9-]{1,30}$/.test(paper) || !/^\d+(?:\.\d+)?(?:cm|mm|in|pt)$/.test(margin)) throw new Error('Invalid publication paper or margin.');
    const documentClass = optionalText(input.pdf?.documentClass, 'document class', 80);
    if (documentClass && !/^[a-zA-Z0-9_-]+$/.test(documentClass)) throw new Error('Invalid publication document class.');
    const depth = input.toc?.depth ?? 2;
    if (!Number.isInteger(depth) || depth < 1 || depth > 6) throw new Error('Contents depth must be between 1 and 6.');
    const tokenEnv = input.zenodo?.tokenEnv || 'ZENODO_TOKEN';
    if (!/^[A-Z_][A-Z0-9_]{0,100}$/.test(tokenEnv)) throw new Error('Invalid Zenodo token environment variable name.');
    const environment = input.zenodo?.environment || 'sandbox';
    if (!['sandbox', 'production'].includes(environment)) throw new Error('Invalid Zenodo environment.');
    const scope = input.scope ? {
        books: list(input.scope.books, 'book scope', 100).map(value => optionalText(value, 'book key', 200) || ''),
        volumes: list(input.scope.volumes, 'volume scope', 100).map(value => optionalText(value, 'volume key', 200) || ''),
        paths: list(input.scope.paths, 'work scope', 10000).map(relativeInput)
    } : undefined;
    const continuedFile = input.continued?.file ? relativeInput(input.continued.file) : undefined;
    if (continuedFile && !/\.md$/i.test(continuedFile)) throw new Error('Publication continued notice files must be Markdown files.');
    const frontMatter = matter(input.frontMatter, 'front matter'), backMatter = matter(input.backMatter, 'back matter');
    const matterFiles = [...(automatic ? [] : [...frontMatter, ...backMatter]), ...(input.continued?.enabled === false || !continuedFile ? [] : [{ file: continuedFile }])].map(entry => entry.file).filter(Boolean);
    if (new Set(matterFiles).size !== matterFiles.length) throw new Error('A publication file can only fill one matter role.');
    return JSON.parse(canonical({
        ...metadata, id: publicationId(input.id), workId: publicationId(input.workId), version, chapters, scope,
        edition: optionalText(input.edition, 'edition', 300), publicationDate: optionalText(input.publicationDate, 'publication date', 100),
        releaseTag: optionalText(input.releaseTag, 'release tag', 300), releaseCommit: optionalText(input.releaseCommit, 'release commit', 300),
        cover: { image: input.cover?.image ? relativeInput(input.cover.image) : undefined, showVersion: input.cover?.showVersion !== false },
        frontMatter, backMatter,
        matter: input.matter ? { automatic: input.matter.automatic === true, exclude: [...new Set(list(input.matter.exclude, 'excluded matter', 10000).map(relativeInput))] } : undefined,
        toc: { enabled: input.toc?.enabled !== false, depth, title: optionalText(input.toc?.title, 'contents title', 500) },
        continued: { enabled: typeof input.continued?.enabled === 'boolean' ? input.continued.enabled : undefined, file: continuedFile, title: optionalText(input.continued?.title, 'continued title', 1000), text: optionalText(input.continued?.text, 'continued notice', 100000) },
        pdf: { engine, paper, margin, documentClass },
        doi: { ...metadata.doi, versionDoi: input.doi?.versionDoi === '' ? '' : normalizeDoi(input.doi?.versionDoi) },
        zenodo: { environment, tokenEnv }
    }));
}
export async function probeTool(command: string): Promise<PublicationTool> {
    return new Promise(resolve => {
        let child: any, output = '', done = false;
        const finish = (available: boolean) => { if (done) return; done = true; clearTimeout(timer); resolve({ available, ...(available ? { identity: output.trim().split('\n').slice(0, 2).join('\n') } : {}) }); };
        const timer = setTimeout(() => { child?.kill('SIGTERM'); finish(false); }, 5000);
        try {
            child = childProcess.spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
            const collect = (bytes: any) => { output = (output + bytes.toString()).slice(0, 65536); };
            child.stdout.on('data', collect); child.stderr.on('data', collect); child.on('error', () => finish(false)); child.on('close', (code: number) => finish(code === 0));
        } catch { finish(false); }
    });
}
export async function publicationTools(profile?: PublicationProfile, options: PublicationServiceOptions = {}): Promise<PublicationTools> {
    const probe = options.toolProbe || probeTool, engineName = profile?.pdf?.engine || 'xelatex';
    const [pandoc, engine] = await Promise.all([probe('pandoc'), probe(engineName)]);
    const tools: PublicationTools = { pandoc, engine, engineName };
    if (process.platform === 'darwin' && profile?.language?.toLowerCase().startsWith('zh') && !profile.pdf?.documentClass) {
        // Reuse an already installed, readable system font. No font installation or copying.
        const file = '/System/Library/Fonts/Supplemental/Songti.ttc';
        try {
            await fs.access(file, require('node:fs').constants.R_OK); const stat = await fs.stat(file);
            if (stat.isFile()) tools.chineseFonts = { family: 'Songti SC', source: 'macos', bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
        } catch { /* Other environments retain the portable TeX font set. */ }
    }
    return tools;
}
interface Snapshot { state: any; pages: PublicationPage[]; files: Map<string, any>; inputs: PublicationInput[]; config: any }
async function readSnapshot(root: string): Promise<Snapshot> {
    const files = new Map<string, any>(), inputs: PublicationInput[] = [];
    const capture = async (name: string, role: PublicationInput['role'], required = false) => {
        try { const bytes = await fs.readFile(await safePath(root, name)); files.set(name, bytes); inputs.push({ path: name, sha256: sha256(bytes), role }); return bytes; }
        catch (error: any) { if (!required && error.code === 'ENOENT') return undefined; throw error; }
    };
    const rawConfig = await capture('.math-workspace/config.json', 'config');
    const config = mergeConfig(rawConfig ? JSON.parse(rawConfig.toString('utf8')) : {});
    const documents = [];
    const walk = async (directory: string, relative = '') => {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const name = relative ? `${relative}/${entry.name}` : entry.name;
            if (shouldExcludeScanPath(name, config)) continue;
            if (entry.isSymbolicLink()) { if (/\.md$/i.test(entry.name) || entry.isDirectory()) throw new Error(`Publication input cannot be a symbolic link: ${name}`); continue; }
            if (entry.isDirectory()) await walk(await safePath(root, name), name);
            else if (entry.isFile() && /\.md$/i.test(name)) documents.push({ filePath: name, content: (await capture(name, 'source', true)).toString('utf8') });
        }
    };
    await walk(root);
    const symbols = await capture('.math-workspace/symbols.json', 'metadata'), definitions = await capture('.math-workspace/definitions.json', 'metadata');
    const state = scanFormalDocuments(documents, config, symbols ? JSON.parse(symbols.toString('utf8')) : undefined, definitions ? JSON.parse(definitions.toString('utf8')) : undefined);
    const pages = sortManuscriptPages(state.pages, 'export').map(page => ({ path: page.filePath, title: formatPageHeading(page, config), kind: page.kind, number: formatPageReference(page, config), book: page.bookKey, bookTitle: page.bookTitle, volume: page.volumeKey, volumeTitle: page.volumeTitle }));
    // Plain pages remain deliberately selectable; they do not acquire formal numbering.
    for (const document of documents) if (!pages.some(page => page.path === document.filePath)) pages.push({ path: document.filePath, title: /^#\s+(.+)$/m.exec(document.content)?.[1] || path.basename(document.filePath), kind: 'page', number: undefined, book: undefined, bookTitle: undefined, volume: undefined, volumeTitle: undefined });
    return { state, pages, files, inputs, config };
}
export async function publicationCatalog(root: string) { const snapshot = await readSnapshot(root); return { pages: snapshot.pages, language: snapshot.config.language === 'en' ? 'en-US' : 'zh-CN' }; }

function resourceTargets(content: string): Array<{ target: string; image: boolean }> {
    const targets: Array<{ target: string; image: boolean }> = [], definitions = new Map<string, string>();
    const key = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
    for (const match of content.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) if ((match[1] || match[2]) && (!/\.md(?:[?#]|$)/i.test(match[1] || match[2]))) targets.push({ target: match[1] || match[2], image: false });
    for (const match of content.matchAll(/!\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) targets.push({ target: match[1] || match[2], image: true });
    for (const match of content.matchAll(/^\s*\[([^\]]+)\]:\s*(?:<([^>]+)>|([^\s]+))/gm)) {
        definitions.set(key(match[1]), match[2] || match[3]);
        if (!/\.md(?:[?#]|$)/i.test(match[2] || match[3])) targets.push({ target: match[2] || match[3], image: false });
    }
    for (const match of content.matchAll(/!\[([^\]\n]*)\](?:\[([^\]\n]*)\])?/g)) {
        if (content[match.index + match[0].length] === '(') continue;
        const target = definitions.get(key(match[2] || match[1])); if (target) targets.push({ target, image: true });
    }
    for (const match of content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) targets.push({ target: match[1], image: true });
    return targets;
}
export async function makePublicationPlan(root: string, input: PublicationProfile, doiInput: PublicationDoiBinding | ((profile: PublicationProfile) => Promise<PublicationDoiBinding>), options: PublicationServiceOptions = {}): Promise<{ plan: PublicationPlan; snapshot: Snapshot }> {
    const profileOverrides = normalizeProfile(input), snapshot = await readSnapshot(root);
    const profile = normalizeProfile(resolvePublicationMatter(resolvePublicationMetadata(profileOverrides, snapshot.config), snapshot.pages)), selectedPaths = new Set(profile.chapters);
    const doi = typeof doiInput === 'function' ? await doiInput(profile) : doiInput;
    for (const name of selectedPaths) if (!snapshot.files.has(name) || !snapshot.pages.some(page => page.path === name)) throw new Error(`Selected publication page is unavailable or excluded: ${name}`);
    const matters = new Set<string>();
    const resolveMatter = async (entry: any, role: 'front-matter' | 'back-matter' | 'continued'): Promise<PublicationResolvedMatter> => {
        let content = entry.content || '';
        if (entry.file) {
            await safePath(root, entry.file);
            if (!/\.md$/i.test(entry.file)) throw new Error('Publication matter files must be Markdown files.');
            if (!snapshot.files.has(entry.file) || !snapshot.pages.some(page => page.path === entry.file)) throw new Error(`Publication matter file is unavailable or excluded: ${entry.file}`);
            if (matters.has(entry.file)) throw new Error(`A publication file can only fill one matter role: ${entry.file}`);
            matters.add(entry.file); selectedPaths.delete(entry.file);
            snapshot.inputs.find(item => item.path === entry.file).role = role;
            content = snapshot.files.get(entry.file).toString('utf8');
        }
        const pageTitle = entry.file ? snapshot.state.pages.find(page => page.filePath === entry.file)?.title : undefined;
        return { file: entry.file, title: entry.title || (entry.file ? pageTitle || firstHeadingTitle(content) : undefined), content, includeInToc: entry.includeInToc === true };
    };
    const frontMatter: PublicationResolvedMatter[] = [], backMatter: PublicationResolvedMatter[] = [];
    for (const entry of profile.frontMatter) frontMatter.push(await resolveMatter(entry, 'front-matter'));
    for (const entry of profile.backMatter) backMatter.push(await resolveMatter(entry, 'back-matter'));
    const continuedFile = profile.continued.file && profile.continued.enabled !== false
        ? await resolveMatter({ file: profile.continued.file }, 'continued') : undefined;
    const selected = snapshot.pages.filter(page => selectedPaths.has(page.path));
    if (!selected.length) throw new Error('Select at least one chapter or page outside the referenced front matter, back matter, and continued notice.');
    const selectedBooks = new Set(selected.map(page => page.book).filter(Boolean));
    const scope = profile.scope;
    const inWork = (page: PublicationPage) => {
        if (scope && (scope.books?.length || scope.volumes?.length || scope.paths?.length)) return !!(scope.books?.includes(page.book) || scope.volumes?.includes(page.volume) || scope.paths?.some(item => page.path === item || page.path.startsWith(`${item}/`)));
        return selectedBooks.size ? selectedBooks.has(page.book) : true;
    };
    if (selected.some(page => !inWork(page))) throw new Error('Selected pages must belong to the declared work scope.');
    const omitted = snapshot.pages.filter(page => inWork(page) && !selectedPaths.has(page.path) && !matters.has(page.path));
    const externalReferences = [];
    const inspectReferences = (state: any, onlySelected = false) => {
        for (const reference of state.references) {
            if (onlySelected && !selectedPaths.has(reference.file)) continue;
            const label = snapshot.state.labels[reference.id];
            if (!label) throw new Error(`Unresolved publication reference in ${reference.file}:${reference.line}: @${reference.id}`);
            if (!selectedPaths.has(label.filePath) && !matters.has(label.filePath)) externalReferences.push({ source: reference.file, line: reference.line, target: label.filePath, label: reference.id, kind: 'formal' as const });
        }
        for (const reference of state.pageReferences) {
            if (onlySelected && !selectedPaths.has(reference.file)) continue;
            if (!snapshot.pages.some(page => page.path === reference.target)) throw new Error(`Unresolved publication page reference in ${reference.file}:${reference.line}: ${reference.target}`);
            if (!selectedPaths.has(reference.target) && !matters.has(reference.target)) externalReferences.push({ source: reference.file, line: reference.line, target: reference.target, label: reference.rawTarget, kind: 'page' as const });
        }
    };
    inspectReferences(snapshot.state, true);
    const addInput = async (name: string, role: PublicationInput['role']) => {
        if (snapshot.files.has(name)) return;
        const bytes = await fs.readFile(await safePath(root, name));
        snapshot.files.set(name, bytes); snapshot.inputs.push({ path: name, sha256: sha256(bytes), role });
    };
    const scannedResources = new Set<string>();
    const addResources = async (content: string, source: string) => {
        if (/\.md$/i.test(source)) content = stripIgnoredMarkdown(content);
        for (const { target, image } of resourceTargets(content)) {
            if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) {
                if (image && !target.startsWith('#')) throw new Error('Publication images must be local frozen resources.');
                continue;
            }
            const clean = decodeURIComponent(target.split(/[?#]/)[0]);
            if (path.posix.isAbsolute(clean)) throw new Error('Publication resources must stay inside the project.');
            const name = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(source), clean)));
            relativeInput(name); await addInput(name, 'asset');
        }
        for (const match of content.matchAll(/\\(includegraphics|input|include|bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
            if (/[\\#$]/.test(match[2])) throw new Error('Publication resources must use explicit local paths; dynamic LaTeX resource paths cannot be frozen.');
            let name = relativeInput(match[2]);
            if (!path.extname(name)) {
                const extensions = match[1] === 'includegraphics' ? ['.pdf', '.png', '.jpg', '.jpeg', '.svg'] : match[1] === 'bibliography' || match[1] === 'addbibresource' ? ['.bib'] : ['.tex'];
                let resolved: string;
                for (const extension of extensions) { try { await fs.access(await safePath(root, `${name}${extension}`)); resolved = `${name}${extension}`; break; } catch (error: any) { if (error.code !== 'ENOENT') throw error; } }
                if (!resolved) throw new Error(`Publication resource is unavailable: ${name}`); name = resolved;
            }
            await addInput(name, 'asset');
            if (/\.tex$/i.test(name) && !scannedResources.has(name)) { scannedResources.add(name); await addResources(snapshot.files.get(name).toString('utf8'), name); }
        }
    };
    for (const page of selected) {
        const content = snapshot.files.get(page.path).toString('utf8'); await addResources(content, page.path);
        for (const match of content.matchAll(/\[[^\]\n]*\]\(\s*(?:<([^>]+\.md(?:#[^>]*)?)>|([^\s)]+\.md(?:#[^\s)]*)?))/g)) {
            const target = match[1] || match[2]; if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
            const name = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(page.path), target.split('#')[0])));
            if (!selectedPaths.has(name) && !matters.has(name)) externalReferences.push({ source: page.path, line: content.slice(0, match.index).split('\n').length, target: name, kind: 'link' as const });
        }
    }
    for (const [entries, role] of [[frontMatter, 'front-matter'], [backMatter, 'back-matter'], [continuedFile ? [continuedFile] : [], 'continued']] as const) for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const content = entry.content;
        inspectReferences(scanFormalDocuments([{ filePath: entry.file || `${role}-${index + 1}.md`, content }], snapshot.config));
        await addResources(content, entry.file || 'inline.md');
        for (const match of stripIgnoredMarkdown(content).matchAll(/\[[^\]\n]*\]\(\s*(?:<([^>]+\.md(?:#[^>]*)?)>|([^\s)]+\.md(?:#[^\s)]*)?))/g)) {
            const target = match[1] || match[2]; if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
            const name = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(entry.file || 'inline.md'), target.split('#')[0])));
            relativeInput(name);
            if (!selectedPaths.has(name) && !matters.has(name)) externalReferences.push({ source: entry.file || `${role}-${index + 1}.md`, line: 0, target: name, kind: 'link' as const });
        }
    }
    if (profile.cover.image) await addInput(profile.cover.image, 'asset');
    const english = (profile.language || snapshot.config.language).startsWith('en');
    const continuedNotice = { enabled: !hasPublicationContinuedManuscript(profile, snapshot.pages) && (profile.continued.enabled ?? (!!continuedFile || omitted.length > 0)), file: continuedFile?.file, title: continuedFile?.title || profile.continued.title || (english ? 'To be continued' : '未完待续'), text: continuedFile?.content ?? (profile.continued.text || (english ? 'This is a partial edition of a continuing work. Further chapters and revisions will appear in later versions of the same work.' : '本版为持续更新作品的部分内容。后续章节与修订将在同一作品的后续版本中继续发布。')) };
    const warnings = externalReferences.length ? [`${externalReferences.length} reference(s) point outside this edition; omitted pages are not added automatically.`] : [];
    const tools = await publicationTools(profile, options);
    const content = { schema: 'math-workspace.publication-plan/v1' as const, profile, profileOverrides, projectMetadata: projectMetadata(snapshot.config), selected, omitted, externalReferences, partial: omitted.length > 0, frontMatter, backMatter, continuedNotice, doi, inputs: snapshot.inputs.sort((a, b) => a.path.localeCompare(b.path)), tools, warnings };
    return { plan: { ...content, fingerprint: sha256(canonical(content)) }, snapshot };
}
function firstHeadingTitle(content: string): string | undefined {
    return /^#\s+(.+?)\s*$/m.exec(stripIgnoredMarkdown(content))?.[1].replace(/[ \t]+#+[ \t]*$/, '').replace(/^#h-[a-f0-9]{16}\s+/i, '').replace(/\s+\{[^}]*\}\s*$/, '').trim();
}
function unnumbered(content: string, listed: boolean, clearTitleMarks = false): string {
    let fence = false, clearedTitleMarks = false;
    return content.split(/\r?\n/).map(line => {
        if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; } if (fence) return line;
        const heading = line.replace(/^(#{1,6}\s+)(.+?)\s*$/, (_match, prefix, title) => {
            const attributes = /\s*\{([^}]*)\}\s*$/.exec(title), body = attributes ? title.slice(0, attributes.index) : title;
            const kept = (attributes?.[1] || '').split(/\s+/).filter(item => item && item !== '.unnumbered' && item !== '.unlisted' && item !== '-');
            return `${prefix}${body} {${[...kept, '.unnumbered', ...(!listed ? ['.unlisted'] : [])].join(' ')}}`;
        });
        if (clearTitleMarks && !clearedTitleMarks && /^#\s+/.test(line)) {
            clearedTitleMarks = true;
            return `${heading}\n\n\\markboth{}{}\n`;
        }
        return heading;
    }).join('\n');
}
export async function runPublicationCli(cliPath: string, args: string[], options: { cwd: string; onProgress?: (message: string) => void; credentialEnv?: string }): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const environment = { ...process.env }; delete environment.ZENODO_TOKEN; if (options.credentialEnv) delete environment[options.credentialEnv];
        const child = childProcess.spawn(process.execPath, [cliPath, ...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: environment });
        let stdout = '', stderr = '', done = false;
        const timer = setTimeout(() => { child.kill('SIGTERM'); }, 10 * 60 * 1000);
        const collect = (channel: 'stdout' | 'stderr', value: any) => { if (channel === 'stdout') stdout = (stdout + value.toString()).slice(-1024 * 1024); else stderr = (stderr + value.toString()).slice(-1024 * 1024); };
        child.stdout.on('data', value => collect('stdout', value)); child.stderr.on('data', value => collect('stderr', value));
        child.on('error', () => { if (done) return; done = true; clearTimeout(timer); reject(new Error('Unable to start the bundled PDF export runtime.')); });
        child.on('close', code => { if (done) return; done = true; clearTimeout(timer); if (code !== 0) reject(new Error(`Publication export failed: ${(stderr || stdout || `process exit ${code}`).trim().slice(-12000)}`)); else resolve({ stdout, stderr }); });
    });
}
export async function renderPublication(store: PublicationStore, plan: PublicationPlan, snapshot: Snapshot, recheck: () => Promise<PublicationPlan>, options: PublicationServiceOptions, progress: PublicationBuildOptions = {}): Promise<PublicationBuild> {
    return store.locked(plan.profile.id, async () => {
        if ((await recheck().catch(() => null))?.fingerprint !== plan.fingerprint) throw new Error('Publication sources changed. Review a fresh plan before building.');
        const id = crypto.randomBytes(16).toString('hex'), profile = plan.profile, createdAt = new Date().toISOString();
        const temporary = await store.directory(`pending/${profile.id}-${id}`); await fs.mkdir(temporary, { recursive: true });
        const frozen = path.join(temporary, 'inputs'); await fs.mkdir(frozen);
        try {
            progress.onProgress?.('Freezing selected sources, formal numbering inputs, and local resources');
            const configName = '.math-workspace/config.json';
            for (const [name, bytes] of snapshot.files) { if (name === configName) continue; const destination = await safePath(frozen, name); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes, { flag: 'wx' }); }
            // The plan retains the original config bytes/hash; Markdown export must not scan unfrozen Lean projects.
            const sourceConfig = snapshot.files.has(configName) ? JSON.parse(snapshot.files.get(configName).toString('utf8')) : snapshot.config;
            const exportConfig = { ...sourceConfig, lean: { ...sourceConfig?.lean, projects: [] } };
            await fs.mkdir(path.join(frozen, '.math-workspace'), { recursive: true }); await fs.writeFile(path.join(frozen, configName), canonical(exportConfig), { flag: 'wx' });
            const invoke = options.runCli || ((args, runtimeOptions) => runPublicationCli(options.cliPath || path.resolve(__dirname, 'math-workspace.js'), args, { ...runtimeOptions, credentialEnv: profile.zenodo.tokenEnv }));
            progress.onProgress?.('Compiling selected chapters with their original formal numbering');
            await invoke(['export-md', ...plan.selected.map(page => page.path), '--out=../compiled.md', '--read-only'], { cwd: frozen, onProgress: progress.onProgress });
            const markdownPath = path.join(temporary, 'compiled.md'); let markdown = await fs.readFile(markdownPath, 'utf8');
            const matterContent = async (entry: any, key: string, fallbackTitle?: string, clearTitleMarks = false) => {
                const raw = entry.file ? snapshot.files.get(entry.file).toString('utf8') : entry.content || '';
                const inputName = `.math-workspace/publication-${key}-raw.md`, outputName = `.math-workspace/publication-${key}.md`;
                await fs.writeFile(await safePath(frozen, inputName), raw, { flag: 'wx' });
                await invoke(['_publication-fragment', inputName, entry.file || 'inline.md', outputName], { cwd: frozen, onProgress: progress.onProgress });
                let compiled = await fs.readFile(await safePath(frozen, outputName), 'utf8');
                if (entry.file) {
                    let found = false, fence = false;
                    const pageId = snapshot.state.pages.find(page => page.filePath === entry.file)?.id;
                    compiled = compiled.split(/\r?\n/).map(line => {
                        if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; }
                        if (fence || found || !/^#\s+/.test(line)) return line;
                        found = true;
                        const attributes = /\s*\{([^}]*)\}\s*$/.exec(line);
                        const heading = (attributes ? line.slice(0, attributes.index) : line).replace(/^#\s+/, '');
                        let kept = attributes?.[1] || '';
                        if (pageId && !/(?:^|\s)#[^\s]+/.test(kept)) kept = `${kept} #${pageId}`.trim();
                        return `# ${entry.title || heading}${kept ? ` {${kept}}` : ''}`;
                    }).join('\n');
                    if (!found && (entry.title || fallbackTitle)) compiled = `# ${entry.title || fallbackTitle}\n\n${compiled}`;
                }
                return unnumbered(compiled, entry.includeInToc, clearTitleMarks);
            };
            for (let index = 0; index < profile.backMatter.length; index++) {
                const entry = profile.backMatter[index];
                const title = !entry.file && entry.title ? `# ${entry.title} {.unnumbered${entry.includeInToc ? '' : ' .unlisted'}}\n\n\\markboth{}{}\n\n` : '';
                markdown += `\n\n\\clearpage\n\\markboth{}{}\n\n${title}${await matterContent(entry, `back-${index}`, undefined, !title)}\n`;
            }
            if (plan.continuedNotice.enabled) {
                const notice = plan.continuedNotice;
                const content = notice.file ? await matterContent({ file: notice.file, includeInToc: false }, 'continued', notice.title)
                    : `# ${notice.title} {.unnumbered .unlisted}\n\n${notice.text}`;
                markdown += `\n\n\\clearpage\n\\markboth{}{}\n\n${content}\n`;
            }
            await fs.writeFile(markdownPath, markdown, 'utf8');
            const language = profile.language || (snapshot.config.language === 'en' ? 'en-US' : 'zh-CN');
            const defaultChineseClass = !profile.pdf.documentClass && language.toLowerCase().startsWith('zh');
            const documentClass = profile.pdf.documentClass || (defaultChineseClass ? 'ctexart' : undefined);
            const args = ['render-pdf', '../compiled.md', '--out=../publication.pdf', '--no-project-pdf-defaults', '--title-page', '--metadata-page', '--toc-page-break', `--title=${profile.title}`, `--release-version=${profile.version}`, `--author=${profile.authors.map(author => author.name).join('; ')}`, `--pdf-engine=${profile.pdf.engine}`, `--paper=${profile.pdf.paper}`, `--margin=${profile.pdf.margin}`, `--lang=${language}`, `--toc-depth=${profile.toc.depth}`, `--toc-title=${profile.toc.title || (snapshot.config.language === 'en' ? 'Contents' : '目录')}`];
            args.push(`--authors-json=${JSON.stringify(profile.authors)}`);
            args.push(profile.toc.enabled ? '--toc' : '--no-toc', profile.cover.showVersion ? '--show-version-on-cover' : '--no-show-version-on-cover');
            if (profile.subtitle || profile.edition) args.push(`--subtitle=${[profile.subtitle, profile.edition].filter(Boolean).join(' · ')}`);
            if (profile.cover.image) args.push(`--cover-image=${profile.cover.image}`);
            if (documentClass) args.push(`--documentclass=${documentClass}`);
            if (defaultChineseClass) {
                const family = plan.tools.chineseFonts?.family;
                if (family) args.push('--variable=classoption:fontset=none', `--variable=CJKmainfont:${family}`, `--variable=CJKsansfont:${family}`, `--variable=CJKmonofont:${family}`);
                else args.push('--variable=classoption:fontset=fandol');
            }
            if (profile.license) args.push(`--license=${profile.license}`);
            if (profile.repository) args.push(`--repository=${profile.repository}`);
            if (profile.website) args.push(`--website=${profile.website}`);
            if (profile.licenseUrl) args.push(`--license-url=${profile.licenseUrl}`);
            if (profile.preferredCitation) args.push(`--preferred-citation=${profile.preferredCitation}`);
            if (profile.releaseTag) args.push(`--release-tag=${profile.releaseTag}`);
            if (profile.releaseCommit) args.push(`--release-commit=${profile.releaseCommit}`);
            if (profile.description) args.push(`--description=${profile.description}`);
            for (const keyword of profile.keywords || []) args.push(`--keyword=${keyword}`);
            const publicationDate = profile.publicationDate || createdAt.slice(0, 10);
            args.push(`--date=${publicationDate}`);
            if (plan.doi.versionDoi) args.push(`--doi=${plan.doi.versionDoi}`);
            if (plan.doi.conceptDoi) args.push(`--work-doi=${plan.doi.conceptDoi}`);
            if (plan.doi.versionDoi || plan.doi.conceptDoi) {
                const chinese = (profile.language || snapshot.config.language).toLowerCase().startsWith('zh');
                const note = plan.doi.source === 'manual'
                    ? chinese ? 'DOI 由作者提供；注册信息以 DOI 服务平台记录为准。' : 'DOI supplied by the author; registration details follow the DOI provider record.'
                    : plan.doi.source === 'zenodo'
                        ? chinese ? 'DOI 由 Zenodo 分配；注册信息以 DOI 服务平台记录为准。' : 'DOI assigned through Zenodo; registration details follow the DOI provider record.'
                        : chinese ? 'DOI 信息以 DOI 服务平台记录为准。' : 'DOI information follows the DOI provider record.';
                args.push(`--doi-state=${[note, profile.doi?.provenance].filter(Boolean).join(' ')}`);
            }
            for (let index = 0; index < profile.frontMatter.length; index++) {
                const entry = profile.frontMatter[index], name = `.math-workspace/publication-front-${index}.md`;
                const normalized = await matterContent(entry, `front-${index}`);
                await fs.writeFile(await safePath(frozen, name), normalized, 'utf8');
                args.push(`--front-matter=${name}`); if (!entry.file && entry.title) args.push(`--front-matter-title=${entry.title}`); if (entry.includeInToc) args.push('--front-matter-toc');
            }
            progress.onProgress?.('Rendering cover, publication pages, contents, chapters, and conclusion');
            await invoke(args, { cwd: frozen, onProgress: progress.onProgress });
            const pdf = await fs.readFile(path.join(temporary, 'publication.pdf'));
            if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('The PDF renderer did not produce a valid PDF file.');
            if ((await recheck().catch(() => null))?.fingerprint !== plan.fingerprint) throw new Error('Publication sources changed during PDF rendering. This build was not saved.');
            const pdfSha256 = sha256(pdf), markdownBytes = Buffer.from(markdown);
            const citation = {
                type: 'book', title: profile.title, subtitle: profile.subtitle,
                author: profile.authors.map(author => ({ literal: author.name, ORCID: author.orcid, affiliation: author.affiliation, nativeName: author.nativeName, aliases: author.aliases })),
                language: profile.language, abstract: profile.description,
                URL: profile.website || profile.repository, website: profile.website, repository: profile.repository,
                license: profile.license, licenseUrl: profile.licenseUrl, keyword: profile.keywords?.join(', '), note: profile.preferredCitation,
                ...(/^\d{4}-\d{2}-\d{2}$/.test(publicationDate) ? { issued: { 'date-parts': [publicationDate.split('-').map(Number)] } } : {}),
                version: profile.version, edition: profile.edition, sourceTag: profile.releaseTag, sourceCommit: profile.releaseCommit,
                DOI: plan.doi.versionDoi, conceptDOI: plan.doi.conceptDoi, doiProvenance: plan.doi,
                workId: profile.workId, partial: plan.partial, selectedPages: plan.selected.map(page => page.path)
            };
            await fs.writeFile(path.join(temporary, 'citation.json'), canonical(citation), { flag: 'wx' });
            const citationBytes = await fs.readFile(path.join(temporary, 'citation.json'));
            const manifest: PublicationManifest = { schema: 'math-workspace.publication-manifest/v1', buildId: id, createdAt, plan, artifacts: { 'publication.pdf': { sha256: pdfSha256, bytes: pdf.length }, 'compiled.md': { sha256: sha256(markdownBytes), bytes: markdownBytes.length }, 'citation.json': { sha256: sha256(citationBytes), bytes: citationBytes.length } }, layout: ['cover', 'publication metadata', 'front matter', ...(profile.toc.enabled ? ['generated table of contents'] : []), 'selected chapters in original order and numbering', 'back matter', ...(plan.continuedNotice.enabled ? ['to be continued'] : [])], mathematicalCorrectnessAssessed: false, sourceArchiveSignatureAsserted: false };
            const manifestBytes = canonical(manifest); await fs.writeFile(path.join(temporary, 'manifest.json'), manifestBytes, { flag: 'wx' });
            const build: PublicationBuild = { schema: 'math-workspace.publication-build/v1', id, profileId: profile.id, workId: profile.workId, version: profile.version, fingerprint: plan.fingerprint, createdAt, pdfSha256, markdownSha256: sha256(markdownBytes), manifestSha256: sha256(manifestBytes), files: { pdf: 'publication.pdf', markdown: 'compiled.md', manifest: 'manifest.json', citation: 'citation.json' } };
            await fs.writeFile(path.join(temporary, 'build.json'), canonical(build), { flag: 'wx' });
            await fs.writeFile(path.join(temporary, 'checksums.sha256'), `${Object.entries({ ...manifest.artifacts, 'manifest.json': { sha256: build.manifestSha256 } }).map(([name, value]) => `${value.sha256}  ${name}`).join('\n')}\n`, { flag: 'wx' });
            const destination = await store.directory(`builds/${profile.id}/${id}`); await fs.mkdir(path.dirname(destination), { recursive: true });
            await fs.rename(temporary, destination); progress.onProgress?.('Immutable PDF edition saved'); return build;
        } finally { await fs.rm(temporary, { recursive: true, force: true }); }
    });
}
