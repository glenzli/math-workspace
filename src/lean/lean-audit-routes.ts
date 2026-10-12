import { LeanReviewError } from './lean-evidence';
import { LeanAuditService } from './lean-audit-service';

/** Transport composition only. The Reader server owns token/project/origin and body-size guards. */
export async function handleLeanAuditRoute(service: LeanAuditService, root: string, method: string | undefined,
    pathname: string, query: { get(name: string): string | null }, body?: unknown): Promise<{ status: number; value: unknown }> {
    if (method === 'GET') {
        if (pathname === '/api/lean-audit') return { status: 200, value: await service.get(root, query.get('id')) };
        if (pathname === '/api/lean-audit/overview') return { status: 200, value: await service.overview(root) };
        if (pathname === '/api/lean-audit/report') return { status: 200, value: await service.report(root) };
    }
    if (method === 'POST' && pathname === '/api/lean-audit/action') return { status: 200, value: await service.action(root, body) };
    throw new LeanReviewError(404, 'Lean audit route not found.');
}
