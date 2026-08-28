import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const nodeFs = require('node:fs');

export async function isMathWorkspaceProject(rootPath: string): Promise<boolean> {
    try {
        return (await fs.stat(path.join(rootPath, '.math-workspace', 'config.json'))).isFile();
    } catch (_error) {
        return false;
    }
}

export async function findMathWorkspaceRoot(startPath: string): Promise<string | undefined> {
    let current = path.resolve(startPath);
    try {
        const stat = await fs.stat(current);
        if (!stat.isDirectory()) current = path.dirname(current);
    } catch (_error) {
        return undefined;
    }

    while (true) {
        if (await isMathWorkspaceProject(current)) return nodeFs.promises.realpath(current);
        const parent = path.dirname(current);
        if (parent === current) return undefined;
        current = parent;
    }
}
