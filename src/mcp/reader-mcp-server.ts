import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findMathWorkspaceRoot } from '../project-root';
import { startReaderServer, type FormalReaderServer } from '../reader/server';
import { WorkspaceQueries } from './workspace-queries';
import { registerReaderApp } from './reader-app';
import { registerLeanAssistanceTools } from './lean-assistance-tools';
import workspaceIcon from '../../media/plugin/math-workspace-file-handler-icon.png';

export interface ReaderMcpServerOptions {
    rootPath?: string;
    port?: number;
}

interface ReaderLaunch extends Record<string, unknown> {
    rootPath?: string;
    pagePath?: string;
    url: string;
}

function normalizePagePath(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const normalized = value.trim().replaceAll('\\', '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').some(part => part === '..') || !normalized.toLowerCase().endsWith('.md')) {
        throw new Error('pagePath must be a project-relative Markdown path.');
    }
    return normalized;
}

class ReaderServerRegistry {
    private readonly servers = new Map<string, FormalReaderServer>();

    constructor(private readonly options: ReaderMcpServerOptions) {}

    async open(projectRoot?: string, pagePath?: string): Promise<ReaderLaunch> {
        const requestedRoot = projectRoot || this.options.rootPath || process.cwd();
        const rootPath = await findMathWorkspaceRoot(path.resolve(requestedRoot));
        const page = normalizePagePath(pagePath);

        if (!rootPath) {
            if (projectRoot || this.options.rootPath) {
                throw new Error('No Math Workspace project was found at or above that path. Run `math-workspace init` first.');
            }
            return this.openLauncher();
        }

        const key = `project:${rootPath}`;
        let reader = this.servers.get(key);
        if (!reader) {
            reader = await startReaderServer({ rootPath, port: this.options.port || 0 });
            this.servers.set(key, reader);
        }
        const url = page ? `${reader.url}/?path=${encodeURIComponent(page)}` : reader.url;
        return { rootPath, pagePath: page, url };
    }

    async close(): Promise<void> {
        const servers = Array.from(this.servers.values());
        this.servers.clear();
        await Promise.all(servers.map(server => server.close()));
    }

    private async openLauncher(): Promise<ReaderLaunch> {
        const key = 'launcher';
        let reader = this.servers.get(key);
        if (!reader) {
            reader = await startReaderServer({ port: this.options.port || 0 });
            this.servers.set(key, reader);
        }
        return { url: reader.url };
    }
}

export async function runReaderMcpServer(options: ReaderMcpServerOptions = {}): Promise<void> {
    const registry = new ReaderServerRegistry(options);
    const queries = new WorkspaceQueries({ rootPath: options.rootPath });
    const server = new McpServer({
        name: 'math-workspace',
        version: '0.1.0',
        icons: [{ src: workspaceIcon, mimeType: 'image/png', sizes: ['128x128'] }]
    }, {
        instructions: 'Use Math Workspace for local formal Markdown and Lean context. Queries are read-only; submit_lean_review_candidates is an explicit exception that writes only AI candidate metadata, never source or human decisions. Reader selections are quoted as source attachments in the current conversation. Use the attached Markdown and source locations as context; discussion and editing stay in the native conversation. Use narrow lookup, project-knowledge, cached-audit, dependency, Lean, and validation tools only when the task needs their evidence instead of asking the user to paste broad project context. Dependency and audit results do not decide edits automatically.'
    });

    const projectRoot = z.string().optional().describe('Absolute or relative root of a project containing .math-workspace/config.json. Defaults to the MCP working directory.');
    const query = async (work: () => Promise<Record<string, unknown>>, success: string) => {
        try {
            const result = await work();
            return {
                content: [{
                    type: 'text' as const,
                    text: `${success}\n\n${JSON.stringify(result, null, 2)}`
                }],
                structuredContent: { result }
            };
        } catch (error) {
            return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
    };

    server.registerTool('read_archives', {
        title: 'Read academic archives',
        description: 'Read original academic archive records, source lines, or stable-ID history. Report signature verification separately from source completeness and mathematical proof status; a recorded occurrence does not establish original authorship.',
        inputSchema: { projectRoot, action: z.enum(['list', 'source', 'history']).optional(), record: z.string().optional(),
            filePath: z.string().optional(), formalId: z.string().optional(), includeHidden: z.boolean().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(50).optional() },
        outputSchema: { result: z.object({}).passthrough() },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    }, async ({ projectRoot: root, ...input }) => query(() => queries.archiveRead(input, root), 'Academic archive source evidence.'));

    server.registerTool('lookup_formal_object', {
        title: 'Look up a formal Markdown object',
        description: 'Return one formal object’s stable location, source excerpt, and Lean-anchor summary by h- id.',
        inputSchema: { id: z.string().describe('An h- id, with or without @ or #.'), projectRoot },
        outputSchema: { result: z.object({}).passthrough() },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    }, ({ id, projectRoot: root }) => query(() => queries.formalLookup(id, root), `Math Workspace formal object ${id} loaded.`));

    server.registerTool('inspect_dependencies', {
        title: 'Inspect strict formal dependencies',
        description: 'Return a bounded, strict-only upstream and/or downstream dependency slice for one formal object.',
        inputSchema: {
            id: z.string().describe('An h- id, with or without @ or #.'),
            direction: z.enum(['upstream', 'downstream', 'both']).optional().describe('Defaults to both.'),
            depth: z.number().int().min(1).max(4).optional().describe('Graph hops, from 1 to 4. Defaults to 1.'),
            projectRoot
        },
        outputSchema: { result: z.object({}).passthrough() },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    }, ({ id, direction, depth, projectRoot: root }) => query(() => queries.dependencySlice(id, direction, depth, root), `Math Workspace dependency slice for ${id} loaded.`));

    server.registerTool('inspect_lean_alignment', {
        title: 'Inspect Lean alignment',
        description: 'Return observed Lean anchors, declaration status, build evidence, and dependency comparison for one formal object.',
        inputSchema: { id: z.string().describe('An h- id, with or without @ or #.'), projectRoot },
        outputSchema: { result: z.object({}).passthrough() },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    }, ({ id, projectRoot: root }) => query(() => queries.leanAlignment(id, root), `Math Workspace Lean alignment for ${id} loaded.`));

    server.registerTool('lookup_knowledge', {
        title: 'Look up project definitions and notation',
        description: 'Search current project definitions, aliases, maintained notation, and deliberately named project-knowledge sources. Returns narrow source locators and short previews, not inferred mathematical claims.',
        inputSchema: {
            query: z.string().describe('A term, alias, LaTeX symbol, or maintained project-knowledge source name.'),
            limit: z.number().int().min(1).max(40).optional().describe('Maximum matches. Defaults to 12.'),
            projectRoot
        },
        outputSchema: { result: z.object({}).passthrough() },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    }, ({ query: search, limit, projectRoot: root }) => query(
        () => queries.knowledgeLookup(search, limit, root),
        `Project knowledge matching ${search} loaded.`
    ));

    server.registerTool('read_symbol_audit', {
        title: 'Read the cached symbol-audit report',
        description: 'Return the current or stale cached symbol-audit findings with source locations. This read-only tool never starts an audit or calls a model.',
        inputSchema: {
            limit: z.number().int().min(1).max(100).optional().describe('Maximum actionable findings. Defaults to 40.'),
            projectRoot
        },
        outputSchema: { result: z.object({}).passthrough() },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    }, ({ limit, projectRoot: root }) => query(
        () => queries.symbolAuditReport(limit, root),
        'Cached symbol-audit state loaded.'
    ));

    server.registerTool('verify', {
        title: 'Run a read-only Math Workspace validation scan',
        description: 'Scan formal Markdown and Lean alignment in memory. It does not generate artifacts, run Lean builds, or modify source files.',
        inputSchema: { strictChapters: z.boolean().optional().describe('Treat chapter-gap warnings as blocking.'), projectRoot },
        outputSchema: { result: z.object({}).passthrough() },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    }, ({ strictChapters, projectRoot: root }) => query(() => queries.verify(strictChapters, root), 'Math Workspace read-only validation completed.'));

    server.registerTool('open', {
        title: 'Open Math Workspace',
        description: 'Start or reuse the local Math Workspace for a prepared project, optionally opening one Markdown page.',
        inputSchema: {
            projectRoot: z.string().optional().describe('Absolute or relative root of a project containing .math-workspace/config.json. Defaults to the MCP working directory.'),
            pagePath: z.string().optional().describe('Project-relative Markdown path to open, such as book/01-foundations.md.')
        },
        outputSchema: {
            url: z.string(),
            rootPath: z.string().optional(),
            pagePath: z.string().optional()
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false
        },
    }, async ({ projectRoot, pagePath }) => {
        try {
            const launch = await registry.open(projectRoot, pagePath);
            const target = launch.pagePath ? ` for ${launch.pagePath}` : '';
            return {
                content: [{
                    type: 'text',
                    text: `Math Workspace is ready${target}. Open it in Codex's local browser or any browser: ${launch.url}`
                }],
                structuredContent: launch
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: error instanceof Error ? error.message : String(error)
                }],
                isError: true
            };
        }
    });

    registerLeanAssistanceTools(server);
    const readerApp = registerReaderApp(server, options.rootPath || process.cwd());
    const transport = new StdioServerTransport();
    let closing = false;
    const close = async () => {
        if (closing) return;
        closing = true;
        await readerApp.close();
        await registry.close();
        await server.close();
    };
    const shutdown = () => {
        void close().finally(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    await server.connect(transport);
}
