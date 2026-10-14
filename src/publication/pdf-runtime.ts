import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { safePath } from './store';

const fs = require('node:fs/promises');
export const PUBLICATION_PDF_RUNTIME_VERSION = '6.4.299';
const MAX_RUNTIME_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MODULES = ['pdf.mjs', 'pdf.worker.mjs'];
const LICENSES = ['LICENSE', 'cmaps/LICENSE', 'standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION'];
const sha256 = (bytes: any): string => crypto.createHash('sha256').update(bytes).digest('hex');
const allowedAsset = (name: string): boolean => MODULES.includes(name)
    || /^cmaps\/[A-Za-z0-9_-]+\.bcmap$/.test(name)
    || /^standard_fonts\/[A-Za-z0-9_-]+\.(?:pfb|ttf)$/.test(name);

export class PublicationPdfRuntimeError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}
async function boundedRead(root: string, name: string, limit: number): Promise<any> {
    const file = await safePath(root, name), stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > limit) throw new Error('Invalid PDF preview runtime asset size.');
    const bytes = await fs.readFile(file);
    if (bytes.length !== stat.size || bytes.length > limit) throw new Error('PDF preview runtime changed while reading.');
    return bytes;
}

/** Build-time vendoring only; runtime reads never copy, install, or contact a provider. */
export async function copyPublicationPdfRuntime(packageRoot: string, readerOutput: string): Promise<void> {
    const metadata = JSON.parse((await boundedRead(packageRoot, 'package.json', MAX_MANIFEST_BYTES)).toString('utf8'));
    if (metadata.name !== 'pdfjs-dist' || metadata.version !== PUBLICATION_PDF_RUNTIME_VERSION) throw new Error(`PDF preview requires the pinned pdfjs-dist ${PUBLICATION_PDF_RUNTIME_VERSION}.`);
    const assets: Array<{ source: string; file: string }> = MODULES.map(file => ({ source: `build/${file}`, file }));
    for (const directory of ['cmaps', 'standard_fonts']) {
        const entries = await fs.readdir(await safePath(packageRoot, directory), { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const name = `${directory}/${entry.name}`;
            if (LICENSES.includes(name)) continue;
            if (!entry.isFile() || entry.isSymbolicLink() || !allowedAsset(name)) throw new Error(`Unexpected PDF preview package asset: ${name}`);
            assets.push({ source: name, file: name });
        }
    }
    const output = path.resolve(readerOutput), source = path.resolve(packageRoot);
    if (output === source || output.startsWith(`${source}${path.sep}`)) throw new Error('PDF preview build output cannot replace its package source.');
    await fs.mkdir(output, { recursive: true });
    const destination = await safePath(output, 'pdfjs'), stagingName = `.pdfjs-${crypto.randomBytes(12).toString('hex')}`, staging = await safePath(output, stagingName);
    await fs.mkdir(staging);
    try {
        const files: Record<string, { bytes: number; sha256: string }> = {}, licenses = {};
        for (const asset of [...assets, ...LICENSES.map(file => ({ source: file, file }))]) {
            const bytes = await boundedRead(packageRoot, asset.source, MAX_RUNTIME_BYTES), target = await safePath(staging, asset.file);
            await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes, { flag: 'wx' });
            const item = { bytes: bytes.length, sha256: sha256(bytes) };
            if (LICENSES.includes(asset.file)) licenses[asset.file] = item; else files[asset.file] = item;
        }
        await fs.writeFile(path.join(staging, 'runtime.json'), `${JSON.stringify({ schema: 'math-workspace.publication-pdf-runtime/v1', version: PUBLICATION_PDF_RUNTIME_VERSION, files, licenses }, null, 2)}\n`, { flag: 'wx' });
        await safePath(output, 'pdfjs'); await fs.rm(destination, { recursive: true, force: true }); await fs.rename(staging, destination);
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

/** Only named, hash-bound files from the bundled Reader runtime are requestable. */
export async function readPublicationPdfRuntime(staticRoot: string, requested: string): Promise<{ bytes: any; contentType: string }> {
    if (!allowedAsset(requested) || requested.length > 180) throw new PublicationPdfRuntimeError('Choose a known PDF preview runtime asset.', 400);
    try {
        const manifest = JSON.parse((await boundedRead(staticRoot, 'pdfjs/runtime.json', MAX_MANIFEST_BYTES)).toString('utf8'));
        if (manifest.schema !== 'math-workspace.publication-pdf-runtime/v1' || manifest.version !== PUBLICATION_PDF_RUNTIME_VERSION) throw new Error('Invalid PDF preview runtime identity.');
        const entry = Object.hasOwn(manifest.files || {}, requested) ? manifest.files[requested] : undefined;
        if (!entry) throw new PublicationPdfRuntimeError('PDF preview runtime asset not found.', 404);
        if (!Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_RUNTIME_BYTES || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid PDF preview runtime entry.');
        const bytes = await boundedRead(staticRoot, `pdfjs/${requested}`, MAX_RUNTIME_BYTES);
        if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error('PDF preview runtime asset changed.');
        return { bytes, contentType: MODULES.includes(requested) ? 'text/javascript; charset=utf-8' : 'application/octet-stream' };
    } catch (error: any) {
        if (error instanceof PublicationPdfRuntimeError) throw error;
        throw new PublicationPdfRuntimeError('The bundled PDF preview runtime is unavailable or changed. Reopen the Reader after updating its local plugin.', 503);
    }
}
