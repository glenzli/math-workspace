import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export const FORMULA_RUNTIME_VERSION = '4.1.3';
export const FORMULA_RUNTIME_FILE = 'mathjax-tex-svg.mjs';
const SCHEMA = 'math-workspace.formula-runtime/v1';
const MAX_MODULE_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024;
const sha256 = (bytes: any): string => createHash('sha256').update(bytes).digest('hex');

export class FormulaRuntimeError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}

async function boundedRead(root: string, relative: string, maximum: number): Promise<any> {
    const resolvedRoot = await fs.realpath(root);
    const file = await fs.realpath(path.join(root, relative));
    if (!file.startsWith(resolvedRoot + path.sep)) throw new Error('Formula runtime asset leaves its bundle.');
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw new Error('Invalid formula runtime asset size.');
    const bytes = await fs.readFile(file);
    if (bytes.length !== stat.size || bytes.length > maximum) throw new Error('Formula runtime asset changed while reading.');
    return bytes;
}

/** Build-only metadata and notices for the independently bundled optional renderer. */
export async function finalizeFormulaRuntime(readerOutput: string, packagesRoot: string, fontNoticePath: string): Promise<void> {
    const directory = path.join(readerOutput, 'mathjax');
    const bytes = await boundedRead(directory, FORMULA_RUNTIME_FILE, MAX_MODULE_BYTES);
    const licenses: Record<string, { bytes: number; sha256: string }> = {};
    for (const [name, notice] of [['@mathjax/src', 'LICENSE-mathjax'], ['@mathjax/mathjax-tex-font', 'LICENSE-tex-font']]) {
        const packageRoot = path.join(packagesRoot, name);
        const metadata = JSON.parse((await boundedRead(packageRoot, 'package.json', MAX_MANIFEST_BYTES)).toString('utf8'));
        if (metadata.name !== name || metadata.version !== FORMULA_RUNTIME_VERSION) throw new Error(`Formula reflow requires pinned ${name}@${FORMULA_RUNTIME_VERSION}.`);
        if (metadata.license !== 'Apache-2.0') throw new Error('Unexpected formula renderer code license.');
        // The font package declares Apache-2.0 for its code but omits the standard text.
        const license = await boundedRead(path.join(packagesRoot, '@mathjax/src'), 'LICENSE', MAX_MANIFEST_BYTES);
        await fs.writeFile(path.join(directory, notice), license);
        licenses[notice] = { bytes: license.length, sha256: sha256(license) };
    }
    const fontNotice = await boundedRead(path.dirname(fontNoticePath), path.basename(fontNoticePath), MAX_MANIFEST_BYTES);
    await fs.writeFile(path.join(directory, 'LICENSE-tex-font-OFL'), fontNotice);
    licenses['LICENSE-tex-font-OFL'] = { bytes: fontNotice.length, sha256: sha256(fontNotice) };
    await fs.writeFile(path.join(directory, 'runtime.json'), JSON.stringify({ schema: SCHEMA, version: FORMULA_RUNTIME_VERSION,
        files: { [FORMULA_RUNTIME_FILE]: { bytes: bytes.length, sha256: sha256(bytes) } }, licenses }, null, 2) + '\n');
}

/** A deliberate reflow action may request only the hash-bound bundled renderer. */
export async function readFormulaRuntime(staticRoot: string, requested: string): Promise<{ bytes: any; contentType: string }> {
    if (requested !== FORMULA_RUNTIME_FILE) throw new FormulaRuntimeError('Choose the bundled formula renderer.', 400);
    try {
        const manifest = JSON.parse((await boundedRead(staticRoot, 'mathjax/runtime.json', MAX_MANIFEST_BYTES)).toString('utf8'));
        const entry = manifest.files?.[FORMULA_RUNTIME_FILE];
        if (manifest.schema !== SCHEMA || manifest.version !== FORMULA_RUNTIME_VERSION || !entry
            || !Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_MODULE_BYTES || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
            throw new Error('Invalid formula runtime manifest.');
        }
        const bytes = await boundedRead(staticRoot, 'mathjax/' + FORMULA_RUNTIME_FILE, MAX_MODULE_BYTES);
        if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error('Formula runtime identity changed.');
        return { bytes, contentType: 'text/javascript; charset=utf-8' };
    } catch (error) {
        throw new FormulaRuntimeError('The bundled formula renderer is unavailable or changed. Reopen the Reader after updating its local plugin.', 503);
    }
}
