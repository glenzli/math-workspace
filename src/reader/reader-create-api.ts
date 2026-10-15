import * as path from 'node:path';
import {
    manuscriptCreationScopes,
    planManuscriptPage,
    type CreatePageInput
} from '../manuscript/create-page';

export class ReaderCreatePageError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}

/** Read-only projection. The Reader server owns the local origin, project and token guards. */
export async function handleReaderCreatePageRoute(root: string, method: string | undefined,
    pathname: string, query: { get(name: string): string | null }): Promise<unknown> {
    if (method !== 'GET') throw new ReaderCreatePageError(405, 'Page creation previews support GET only.');
    if (pathname === '/api/create-page/scopes') {
        const scopes = await manuscriptCreationScopes(root);
        const filePath = query.get('filePath') || '';
        const containing = scopes.filter(scope => scope.container !== '.' && filePath.startsWith(scope.container + '/'));
        const books = containing.filter(scope => scope.kind === 'book' || scope.kind === 'volume');
        const selected = (books.length ? books : containing).sort((left, right) => right.container.length - left.container.length)[0];
        return { projectRoot: root, scopes, defaultContainer: selected?.container || '.' };
    }
    if (pathname === '/api/create-page/plan') {
        try {
            const input: CreatePageInput = {
                kind: query.get('kind') as CreatePageInput['kind'], title: query.get('title') || '',
                container: query.get('container') || '.', ...(query.get('slug') === null ? {} : { slug: query.get('slug')! })
            };
            const plan = await planManuscriptPage(root, input);
            return { projectRoot: root, plan, assistantCommand: { executable: process.execPath, cwd: root,
                args: [path.resolve(__dirname, 'math-workspace.js'), 'create-page', '--kind', plan.kind, '--container', plan.container,
                    '--title', plan.title, ...(input.slug === undefined ? [] : ['--slug', input.slug]), '--expect-state', plan.stateToken, '--json'] } };
        } catch (error) {
            throw new ReaderCreatePageError(400, error instanceof Error ? error.message : String(error));
        }
    }
    throw new ReaderCreatePageError(404, 'Page creation preview route not found.');
}
