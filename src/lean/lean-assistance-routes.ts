import { LeanReviewError } from './lean-evidence';
import { LeanAssistanceService } from './lean-assistance-service';

/** The Reader server owns token/project/origin/body-size guards. MCP alone exposes candidate submission. */
export async function handleLeanAssistanceRoute(service: LeanAssistanceService, root: string, method: string | undefined,
    pathname: string, query: { get(name: string): string | null }, body?: any): Promise<{ status: number; value: unknown }> {
    if (method === 'GET' && pathname === '/api/lean-assistance') return { status: 200, value: await service.get(root, query.get('id'), query.get('task') || 'statement') };
    if (method === 'POST' && pathname === '/api/lean-assistance/action' && body?.action === 'dismiss') return { status: 200, value: await service.dismiss(root, body) };
    throw new LeanReviewError(404, 'Lean assistance route not found.');
}
