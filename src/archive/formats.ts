import * as path from 'node:path';
import { canonical, digest, parseJson, relative, sha256 } from './io';
import { validIdentity } from './sigstore';
import type { ArchiveFormat, ArchiveFormatContext, ArchiveProjection, ArchiveScope } from './types';
const crypto = require('node:crypto');

export function validScope(value: any): ArchiveScope {
    if (!value || !Array.isArray(value.paths) || !value.paths.length || value.paths.length > 128
        || !Array.isArray(value.extensions) || !value.extensions.length
        || value.extensions.some(item => typeof item !== 'string' || !/^\.[a-zA-Z0-9]+$/.test(item))) throw new Error('An explicit archive file scope is required.');
    const paths = value.paths.map(relative);
    if (new Set(paths).size !== paths.length) throw new Error('Archive scope paths must be unique.');
    if (value.maxDepth !== undefined && (!Number.isSafeInteger(value.maxDepth) || value.maxDepth < 1 || value.maxDepth > 100)) throw new Error('Invalid archive scope depth.');
    if (value.exclude !== undefined && (!Array.isArray(value.exclude) || value.exclude.length > 128)) throw new Error('Invalid archive exclusions.');
    return { paths: [...paths].sort(), extensions: [...new Set<string>(value.extensions)].sort(),
        ...(value.maxDepth !== undefined ? { maxDepth: value.maxDepth } : {}),
        ...(value.exclude !== undefined ? { exclude: [...new Set<string>(value.exclude.map(relative))].sort() } : {}) };
}
export function fileMap(value: any): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 30000) throw new Error('Invalid archive file map.');
    return Object.fromEntries(Object.entries(value).map(([name, hash]) => [relative(name), digest(hash)]));
}
function inScope(name: string, scope: ArchiveScope): boolean {
    if (name.split('/').some(part => part === '.git' || part === '.math-archive')
        || scope.exclude?.some(prefix => name === prefix || name.startsWith(prefix + '/'))) return false;
    return scope.paths.some(prefix => name === prefix || name.startsWith(prefix + '/')
        && scope.extensions.includes(path.extname(name).toLowerCase())
        && name.slice(prefix.length + 1).split('/').length <= (scope.maxDepth || 100)
        && !name.slice(prefix.length + 1).split('/').some(part => part.startsWith('.')));
}
function pointer(value: any, recordKey = 'record', bundleKey = 'bundle') {
    return value === null ? null : { record: digest(value?.[recordKey]), bundle: digest(value?.[bundleKey]) };
}
function workId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error('Invalid stable work identifier.');
    return value;
}
async function checkFiles(context: ArchiveFormatContext, files: Record<string, string>): Promise<void> {
    for (const hash of new Set(Object.values(files))) await context.object(hash);
}

const nativeFormat: ArchiveFormat = {
    id: 'math-workspace.archive-record/v1',
    async project(context) {
        const record = parseJson(context.payload, true);
        if (record.schema !== this.id || !Number.isSafeInteger(record.sequence) || record.sequence < 1
            || typeof record.label !== 'string' || record.label.length > 200 || typeof record.preparedAt !== 'string'
            || !Array.isArray(record.imports) || record.imports.some(item => typeof item !== 'string')) throw new Error('Invalid native archive record.');
        const scope = validScope(record.scope);
        const previous = pointer(record.previous);
        if ((record.sequence === 1) !== (previous === null)) throw new Error('Invalid archive sequence predecessor.');
        const files = fileMap(record.files);
        if (!Object.keys(files).length) throw new Error('An archive snapshot cannot be empty.');
        if (Object.keys(files).some(name => !inScope(name, scope))) throw new Error('A snapshot file is outside its signed scope.');
        await checkFiles(context, files);
        for (const hash of record.imports) {
            const imported = parseJson(await context.object(digest(hash)), true);
            if (imported.schema !== 'math-workspace.archive-import/v1' || imported.workId !== record.workId
                || !Array.isArray(imported.objects)) throw new Error('A native archive import binding is invalid.');
            for (const objectHash of imported.objects) await context.object(digest(objectHash));
        }
        return { workId: workId(record.workId), label: record.label, kind: 'snapshot', files, missing: [],
            sequence: record.sequence, previous, imports: record.imports.map(digest), signer: validIdentity(record.signer),
            ...(record.sourceLocator ? { sourceLocator: record.sourceLocator } : {}) };
    }
};

interface ManifestMember { path: string; hashes: Record<string, string> }
const HASHES = [['SHA-256', 'sha256', 64], ['SHA-512', 'sha512', 128], ['BLAKE2b', 'blake2b512', 128]] as const;
function manifestMembers(data: any): ManifestMember[] {
    const blocks = data.toString('utf8').split(/^## /m).slice(1);
    if (!blocks.length) throw new Error('OET manifest has no members.');
    const seen = new Set<string>();
    return blocks.map(block => {
        const name = relative(block.split('\n')[0].replace(/^\[(Root Component|Volume Bundle)\] /, '').replace(/^\.\//, '').trimEnd());
        if (seen.has(name)) throw new Error('OET manifest repeats a member path.'); seen.add(name);
        const hashes: Record<string, string> = {};
        for (const [label, , length] of HASHES) {
            const matches = [...block.matchAll(new RegExp('^' + label + ':\\s+([0-9a-f]+)\\s*$', 'gm'))];
            if (matches.length !== 1 || matches[0][1].length !== length) throw new Error(`Invalid ${label} in OET manifest.`);
            hashes[label] = matches[0][1];
        }
        return { path: name, hashes };
    });
}
function verifyMember(data: any, member: ManifestMember): void {
    for (const [label, algorithm] of HASHES) if (crypto.createHash(algorithm).update(data).digest('hex') !== member.hashes[label]) {
        throw new Error(`OET manifest hash mismatch: ${member.path}`);
    }
}
async function walkManifest(context: ArchiveFormatContext, rootManifest: string, files: Record<string, string>, allowedMissing: any[] = []) {
    const visited = new Set<string>(), missing: Array<{ path: string; expected: string }> = [];
    const rootDirectory = path.posix.dirname(rootManifest);
    const visit = async (name: string) => {
        if (visited.has(name)) return; visited.add(name);
        const data = await context.object(files[name]);
        if (!name.endsWith('MANIFEST.txt')) return;
        for (const member of manifestMembers(data)) {
            const target = relative(path.posix.join(path.posix.dirname(name), member.path));
            if (rootDirectory !== '.' && !target.startsWith(rootDirectory + '/')) throw new Error('OET manifest escapes its signed scope.');
            if (!Object.hasOwn(files, target)) {
                const declared = allowedMissing.find(row => row.path === target);
                if (!declared || !canonical(declared.expected_hashes).equals(canonical(member.hashes))) throw new Error(`Missing OET evidence: ${target}`);
                missing.push({ path: target, expected: member.hashes['SHA-256'] });
                continue;
            }
            const content = await context.object(files[target]); verifyMember(content, member); await visit(target);
        }
    };
    await visit(rootManifest);
    if (missing.length !== allowedMissing.length) throw new Error('OET unresolved references do not match the signed manifests.');
    return { visited, missing };
}

const oetLegacyFormat: ArchiveFormat = {
    id: 'oet.legacy-signatures/v1',
    async project(context) {
        const indexHash = digest(context.input.metadata?.index);
        const index = parseJson(await context.object(indexHash), true);
        if (index.schema !== this.id || !Array.isArray(index.records)) throw new Error('Invalid OET legacy archive index.');
        const candidates = index.records.filter(record => record.bundle_sha256 === context.input.bundle);
        if (candidates.length !== 1 || candidates[0].manifest_sha256 !== context.input.payload) throw new Error('OET archive record does not identify the original signature.');
        const record = candidates[0];
        const rootManifest = relative(record.origin.bundle_path.replace(/\.bundle$/, '.txt'));
        const files = fileMap(record.closure.files);
        if (files[rootManifest] !== context.input.payload) throw new Error('OET closure omits its signed manifest.');
        const { visited, missing } = await walkManifest(context, rootManifest, files, record.closure.unresolved);
        if (visited.size !== Object.keys(files).length || record.closure.complete !== !missing.length) throw new Error('OET closure includes unbound files or an incorrect completeness claim.');
        for (const item of [...record.closure.recovered, ...record.closure.unresolved]) {
            for (const key of ['original_object_sha256', 'observed_object_sha256']) if (item[key]) await context.object(digest(item[key]));
        }
        const roots = index.historical_project_paths.map(relative);
        const sourceRoot = roots.find(root => rootManifest.startsWith(root + '/'));
        if (!sourceRoot) throw new Error('OET source locator is outside its declared project.');
        const sourceFiles = Object.fromEntries(Object.entries(files).filter(([name]) => name.endsWith('.md')));
        return { workId: workId(index.work_id), label: path.posix.dirname(rootManifest), kind: record.kind === 'root' ? 'root' : 'volume',
            files: sourceFiles, missing, sourceLocator: { ...record.origin, historicalProjectPath: sourceRoot, binding: 'imported Git locator; file bytes are checked against original manifests' } };
    }
};

const oetRecordFormat: ArchiveFormat = {
    id: 'oet.sign-record/v1',
    async project(context) {
        const record = parseJson(context.payload, true);
        if (record.schema !== this.id || !Number.isSafeInteger(record.sequence) || record.sequence < 1
            || record.snapshot?.scope !== 'root-markdown-and-direct-child-markdown/v1') throw new Error('Invalid OET continuation record.');
        const files = fileMap(record.snapshot.files);
        if (files['MANIFEST.txt'] !== digest(record.snapshot.root_manifest_sha256)) throw new Error('OET continuation root manifest differs.');
        await checkFiles(context, files);
        const { visited, missing } = await walkManifest(context, 'MANIFEST.txt', files);
        const additionalSignatures: Array<{ payload: string; bundle: string }> = [];
        const allowedFiles = new Set(visited);
        for (const name of visited) {
            if (!name.endsWith('MANIFEST.txt')) continue;
            const bundlePath = name.replace(/\.txt$/, '.bundle');
            if (!Object.hasOwn(files, bundlePath)) throw new Error('OET continuation lacks a manifest bundle.');
            allowedFiles.add(bundlePath);
            additionalSignatures.push({ payload: files[name], bundle: files[bundlePath] });
        }
        if (Object.keys(files).some(name => !allowedFiles.has(name))) throw new Error('OET continuation has unbound source files.');
        const markdown = Object.keys(files).filter(name => name.endsWith('.md'));
        const directories = new Set(['.', ...markdown.map(name => path.posix.dirname(name))]);
        const expectedFiles = new Set(markdown);
        for (const directory of directories) {
            const prefix = directory === '.' ? '' : directory + '/';
            expectedFiles.add(prefix + 'MANIFEST.txt'); expectedFiles.add(prefix + 'MANIFEST.bundle');
            const expectedMembers = directory === '.'
                ? [...markdown.filter(name => !name.includes('/')), ...[...directories].filter(name => name !== '.').map(name => name + '/MANIFEST.txt')]
                : markdown.filter(name => path.posix.dirname(name) === directory).map(name => path.posix.basename(name));
            const members = manifestMembers(await context.object(files[prefix + 'MANIFEST.txt'])).map(member => member.path).sort();
            if (!canonical(members).equals(canonical(expectedMembers.sort()))) throw new Error('OET manifest membership differs from its declared snapshot.');
        }
        if (Object.keys(files).length !== expectedFiles.size || Object.keys(files).some(name => !expectedFiles.has(name))) throw new Error('OET continuation scope includes unsupported files.');
        for (const name of markdown) {
            const parts = name.split('/');
            if (parts.length > 2 || parts.some(part => part.startsWith('.')) || parts.length === 2 && ['tools', 'scripts', 'release', 'formal-oet'].includes(parts[0])) throw new Error('OET source is outside its declared scope.');
            const content = (await context.object(files[name])).toString('utf8');
            const footer = content.match(/\*\[OE\][^\n]*⊢ \[([0-9a-f]{16})\]\*\s*$/);
            const body = content.replace(/(?:\n*(?:-{3,}\s*\n)?\*\[(?:IDFS|OE)\][^*\n]*\*\s*)+$/, '').replace(/\n+$/, '') + '\n';
            if (!footer || sha256(Buffer.from(body)).slice(0, 16) !== footer[1]) throw new Error('OET content footer does not match the archived source.');
        }
        const previous = pointer(record.previous, 'record_sha256', 'bundle_sha256');
        if ((record.sequence === 1) !== (previous === null)) throw new Error('Invalid OET continuation sequence.');
        if (record.sequence === 1) {
            const legacy = parseJson(await context.object(digest(record.legacy_archive_sha256)), true);
            if (legacy.schema !== 'oet.legacy-signatures/v1' || legacy.work_id !== record.work_id) throw new Error('OET continuation references another legacy archive.');
        } else if (record.legacy_archive_sha256 !== null) throw new Error('Only the first OET continuation can bind a legacy archive.');
        const prefix = relative(record.source_locator?.project_path);
        const locatedFiles = Object.fromEntries(Object.entries(files).filter(([name]) => name.endsWith('.md')).map(([name, hash]) => [prefix + '/' + name, hash]));
        return { workId: workId(record.work_id), label: `OET #${record.sequence}`, kind: 'snapshot', files: locatedFiles, missing,
            sequence: record.sequence, previous, signer: validIdentity(record.signer), additionalSignatures,
            ...(record.sequence === 1 ? { legacyArchive: record.legacy_archive_sha256 } : {}), sourceLocator: record.source_locator };
    }
};

/** Explicit source registration; projects cannot load arbitrary converter code into the Reader. */
export const archiveFormats: ReadonlyMap<string, ArchiveFormat> = new Map(
    [nativeFormat, oetLegacyFormat, oetRecordFormat].map(format => [format.id, format])
);
export async function projectArchiveRecord(context: ArchiveFormatContext): Promise<ArchiveProjection> {
    digest(context.input.payload); digest(context.input.bundle);
    if (sha256(context.payload) !== context.input.payload) throw new Error('Archive payload digest differs.');
    const format = archiveFormats.get(context.input.format);
    if (!format) throw new Error(`Unsupported archive format: ${context.input.format}`);
    return format.project(context);
}
