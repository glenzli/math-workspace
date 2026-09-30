import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { findMathWorkspaceRoot } from '../project-root';
import { ReaderAppGateway } from './reader-app-gateway';
import { readerAppHtml } from './reader-app-html';

const RESOURCE_URI = 'ui://math-workspace/reader-v2.html';

/** Register the two host entrypoints and app-only view lifecycle on one Reader resource. */
export function registerReaderApp(server: McpServer, defaultRoot?: string): ReaderAppGateway {
    const gateway = new ReaderAppGateway(defaultRoot);
    server.registerResource('math-workspace-reader', RESOURCE_URI, {
        title: 'Math Workspace', mimeType: 'text/html;profile=mcp-app',
        description: 'The local Math Workspace Reader, shared by sidebar and conversation entrypoints.'
    }, async () => {
        return { contents: [{
            uri: RESOURCE_URI, mimeType: 'text/html;profile=mcp-app', text: await readerAppHtml(),
            _meta: {
                ui: { csp: { frameDomains: ['blob:'], connectDomains: [], resourceDomains: ['data:', 'blob:'] }, prefersBorder: false },
                'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'fullscreen' },
                'openai/widgetPrefersBorder': false
            }
        }] };
    });
    const projectRoot = z.string().optional().describe('Prepared Math Workspace project to open. Otherwise use the local project chooser.');
    const pagePath = z.string().optional().describe('Project-relative Markdown page.');
    for (const entrypoint of ['global', 'thread'] as const) {
        server.registerTool(entrypoint === 'global' ? 'open_workspace' : 'open_reader', {
            title: 'Math Workspace',
            description: entrypoint === 'global'
                ? 'Open Math Workspace from the sidebar, choose a local project, or resume reading.'
                : 'Open the existing Math Workspace Reader beside this conversation. Each panel keeps its own project and reading position.',
            inputSchema: { projectRoot, pagePath },
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            _meta: {
                ui: { resourceUri: RESOURCE_URI },
                'openai/ui': { entrypoints: [{ type: entrypoint }] }
            }
        }, async input => {
            try {
                const requested = input.projectRoot || (entrypoint === 'thread' ? defaultRoot : undefined);
                const root = requested ? await findMathWorkspaceRoot(path.resolve(requested)) : undefined;
                if (input.projectRoot && !root) throw new Error('Choose a prepared Math Workspace project.');
                const reader = { launcher: entrypoint === 'global',
                    ...(root ? { projectRoot: root } : {}), ...(input.pagePath ? { pagePath: input.pagePath } : {}) };
                return {
                    content: [{ type: 'text' as const, text: 'Math Workspace Reader is ready.' }],
                    structuredContent: { ready: true }, _meta: { reader }
                };
            } catch (error) {
                return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
            }
        });
    }
    server.registerTool('reader_view', {
        title: 'Open a Reader view',
        description: 'Create or resume this MCP App instance’s independent local Reader.',
        inputSchema: { viewKey: z.string().regex(/^[a-f0-9]{32}$/), projectRoot, pagePath, scrollTop: z.number().nonnegative().optional(), launcher: z.boolean().optional() },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        _meta: { ui: { visibility: ['app'] } }
    }, async ({ viewKey, projectRoot, pagePath, scrollTop, launcher }) => {
        try {
            return { content: [], structuredContent: await gateway.open(viewKey, projectRoot, launcher) };
        } catch (error) {
            return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
        }
    });
    server.registerTool('reader_request', {
        title: 'Read or update this Reader view',
        description: 'Use the existing protected Reader API within this app instance.',
        inputSchema: { viewKey: z.string().regex(/^[a-f0-9]{32}$/), route: z.string().max(8192),
            method: z.enum(['GET', 'POST', 'DELETE']).default('GET'), headers: z.record(z.string()).optional(),
            body: z.string().max(2 * 1024 * 1024).optional() },
        annotations: { destructiveHint: false, openWorldHint: false },
        _meta: { ui: { visibility: ['app'] } }
    }, async ({ viewKey, route, method, headers, body }) => {
        try { return { content: [], structuredContent: await gateway.request(viewKey, route, method, headers, body) }; }
        catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }; }
    });
    server.registerTool('reader_updates', {
        title: 'Watch this Reader view', description: 'Receive local file updates and source navigation for this app instance.',
        inputSchema: { viewKey: z.string().regex(/^[a-f0-9]{32}$/), cursor: z.number().int().nonnegative(),
            waitMs: z.number().int().min(0).max(15000).default(15000) },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        _meta: { ui: { visibility: ['app'] } }
    }, async ({ viewKey, cursor, waitMs }) => {
        try { return { content: [], structuredContent: await gateway.updates(viewKey, cursor, waitMs) }; }
        catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }; }
    });
    server.registerTool('close_reader_view', {
        title: 'Close a Reader view', description: 'Release this MCP App instance’s local Reader.',
        inputSchema: { viewKey: z.string().regex(/^[a-f0-9]{32}$/) },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        _meta: { ui: { visibility: ['app'] } }
    }, async ({ viewKey }) => {
        await gateway.closeView(viewKey);
        return { content: [], structuredContent: { closed: true } };
    });
    return gateway;
}
