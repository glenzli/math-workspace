import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const nodeFs = require('node:fs');

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (_error) {
        return false;
    }
}

async function cleanDir(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src: string, dest: string): Promise<void> {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
}

async function copyDir(src: string, dest: string): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else if (entry.isFile()) {
            await copyFile(srcPath, destPath);
        }
    }
}

async function readJson(filePath: string): Promise<any> {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function copyPluginRuntime(rootPath: string, pluginRoot: string): Promise<void> {
    const runtimeRoot = path.join(pluginRoot, 'out');
    await cleanDir(runtimeRoot);
    await copyFile(
        path.join(rootPath, 'out', 'cli', 'math-workspace.js'),
        path.join(runtimeRoot, 'cli', 'math-workspace.js')
    );
    await copyDir(path.join(rootPath, 'out', 'reader'), path.join(runtimeRoot, 'reader'));
    await nodeFs.promises.chmod(path.join(pluginRoot, 'scripts', 'launch_math_workspace_mcp'), 0o755);
}

export async function stageSourcePluginRuntime(rootPath: string): Promise<string> {
    const pluginRoot = path.join(rootPath, 'plugins', 'math-workspace');
    await copyPluginRuntime(rootPath, pluginRoot);
    return pluginRoot;
}

export async function assemblePluginSnapshot(rootPath: string, destination: string): Promise<string> {
    const sourceRoot = path.join(rootPath, 'plugins', 'math-workspace');
    await cleanDir(destination);
    await copyDir(sourceRoot, destination);
    await copyPluginRuntime(rootPath, destination);
    await copyFile(path.join(rootPath, 'LICENSE'), path.join(destination, 'LICENSE'));
    return destination;
}

export async function syncPluginToMarketplace(snapshotRoot: string, marketplaceRoot: string): Promise<string> {
    const catalogPath = path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json');
    if (!(await pathExists(catalogPath))) {
        throw new Error(`Marketplace catalog is missing: ${catalogPath}`);
    }
    const catalog = await readJson(catalogPath);
    const entry = (catalog.plugins || []).find((candidate: any) => candidate.name === 'math-workspace');
    if (!entry || entry.source?.source !== 'local' || entry.source?.path !== './plugins/math-workspace') {
        throw new Error('Marketplace must contain a local ./plugins/math-workspace catalog entry before publishing.');
    }

    const destination = path.join(marketplaceRoot, 'plugins', 'math-workspace');
    await cleanDir(destination);
    await copyDir(snapshotRoot, destination);
    return destination;
}
