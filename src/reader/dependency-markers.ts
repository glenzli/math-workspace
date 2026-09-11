import { isPedagogicalKind } from '../../packages/core/src/formal-kinds';
export interface ReaderDependencyGraph {
    nodes?: Array<{
        id?: string;
        display?: string;
        title?: string;
        path?: string;
        kind?: string;
        sourceReferenceCount?: number;
    }>;
    edges?: Array<{
        from?: string;
        to?: string;
        where?: 'statement' | 'proof' | 'body';
        relation?: 'strict' | 'explanatory';
        layer?: 'mathematical' | 'pedagogical';
    }>;
    ambientReferences?: Array<{
        to?: string;
        path?: string;
        line?: number;
    }>;
}

export type ReaderDependencyMarkerRole = 'leaf' | 'referenced' | 'bridge';
export type ReaderDependencyMarkerKind = 'theorem-like' | 'remark' | 'pedagogical';

export interface ReaderDependencyNeighbor {
    id: string;
    display: string;
    title: string;
    filePath: string;
    kind: ReaderDependencyMarkerKind;
}

export interface ReaderDependencyMarker {
    directDependencies: number;
    sourceReferenceCount: number;
    directDependents: number;
    impactCount: number;
    ambientReferenceCount: number;
    role: ReaderDependencyMarkerRole;
    kind: ReaderDependencyMarkerKind;
    leanDeclarationCount?: number;
    leanStatus?: {
        contract?: string;
        build?: string;
        dependencies?: string;
    };
    upstream: ReaderDependencyNeighbor[];
    downstream: ReaderDependencyNeighbor[];
}

interface ReaderLeanIndex {
    anchors?: Record<string, {
        declarations?: unknown[];
        status?: {
            contract?: string;
            build?: string;
            dependencies?: string;
        };
    }>;
}

function addAdjacent(adjacency: Map<string, Set<string>>, from: string, to: string): void {
    const neighbors = adjacency.get(from) || new Set<string>();
    neighbors.add(to);
    adjacency.set(from, neighbors);
}

function reachableCount(adjacency: Map<string, Set<string>>, start: string): number {
    const visited = new Set<string>([start]);
    const pending = [start];
    for (let index = 0; index < pending.length; index++) {
        const current = pending[index];
        for (const next of adjacency.get(current) || []) {
            if (visited.has(next)) continue;
            visited.add(next);
            pending.push(next);
        }
    }
    return visited.size - 1;
}

function dependencyNeighbor(node: NonNullable<ReaderDependencyGraph['nodes']>[number]): ReaderDependencyNeighbor | undefined {
    if (!node?.id || !node.path) return undefined;
    return {
        id: node.id,
        display: node.display || node.title || node.id,
        title: node.title || '',
        filePath: node.path,
        kind: isPedagogicalKind(node.kind || '') ? 'pedagogical' : node.kind === 'remark' ? 'remark' : 'theorem-like'
    };
}

function dependencyNeighbors(
    ids: Set<string> | undefined,
    nodeById: Map<string, NonNullable<ReaderDependencyGraph['nodes']>[number]>
): ReaderDependencyNeighbor[] {
    return [...(ids || [])]
        .map(id => dependencyNeighbor(nodeById.get(id) as NonNullable<ReaderDependencyGraph['nodes']>[number]))
        .filter((node): node is ReaderDependencyNeighbor => !!node)
        .sort((left, right) => left.display.localeCompare(right.display, 'zh-Hans-CN'));
}

function isStrictDependencyEdge(edge: NonNullable<ReaderDependencyGraph['edges']>[number]): boolean {
    return edge.layer !== 'pedagogical' && edge.relation !== 'explanatory' && (edge.where === 'statement' || edge.where === 'proof');
}

/**
 * Produces the small, page-local strict-dependency projection used by Math Workspace
 * markers. It admits only explicit strict references in a proposition's
 * statement or proof, and deliberately excludes explanatory/body references
 * and self-references. Graph direction is source formal claim -> referenced formal claim, so reverse
 * adjacency describes the later dependency nodes affected by a node.
 * sourceReferenceCount is separate context: it includes explicit formal
 * references to sections and definitions as well as dependency nodes.
 */
export function projectReaderDependencyMarkers(
    graph: ReaderDependencyGraph | undefined,
    filePath: string,
    leanIndex?: ReaderLeanIndex
): Record<string, ReaderDependencyMarker> {
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph?.edges) ? graph.edges : [];
    const ambientReferences = Array.isArray(graph?.ambientReferences) ? graph.ambientReferences : [];
    const nodeIds = new Set(nodes.map(node => node.id).filter((id): id is string => typeof id === 'string' && id.length > 0));
    const nodeById = new Map(nodes
        .filter((node): node is NonNullable<ReaderDependencyGraph['nodes']>[number] & { id: string } => typeof node?.id === 'string' && node.id.length > 0)
        .map(node => [node.id, node]));
    const dependencies = new Map<string, Set<string>>();
    const dependents = new Map<string, Set<string>>();
    const ambientReferenceCounts = new Map<string, number>();

    for (const edge of edges) {
        const from = edge?.from;
        const to = edge?.to;
        if (!isStrictDependencyEdge(edge)
            || typeof from !== 'string'
            || typeof to !== 'string'
            || from === to
            || !nodeIds.has(from)
            || !nodeIds.has(to)) continue;
        addAdjacent(dependencies, from, to);
        addAdjacent(dependents, to, from);
    }

    for (const reference of ambientReferences) {
        const target = reference?.to;
        if (typeof target !== 'string' || !nodeIds.has(target)) continue;
        ambientReferenceCounts.set(target, (ambientReferenceCounts.get(target) || 0) + 1);
    }

    const markers: Record<string, ReaderDependencyMarker> = {};
    for (const node of nodes) {
        if (!node?.id || node.path !== filePath) continue;
        const directDependencies = (dependencies.get(node.id) || new Set()).size;
        const directDependents = (dependents.get(node.id) || new Set()).size;
        const sourceReferenceCount = Math.max(0, node.sourceReferenceCount || 0);
        const leanDeclarationCount = Array.isArray(leanIndex?.anchors?.[node.id]?.declarations)
            ? leanIndex?.anchors?.[node.id]?.declarations?.length || 0
            : 0;
        const leanStatus = leanIndex?.anchors?.[node.id]?.status;
        markers[node.id] = {
            directDependencies,
            sourceReferenceCount,
            directDependents,
            impactCount: reachableCount(dependents, node.id),
            ambientReferenceCount: ambientReferenceCounts.get(node.id) || 0,
            role: directDependents === 0 ? 'leaf' : directDependencies > 0 ? 'bridge' : 'referenced',
            kind: isPedagogicalKind(node.kind || '') ? 'pedagogical' : node.kind === 'remark' ? 'remark' : 'theorem-like',
            ...(leanDeclarationCount > 0 ? { leanDeclarationCount } : {}),
            ...(leanDeclarationCount > 0 && leanStatus ? { leanStatus } : {}),
            upstream: dependencyNeighbors(dependencies.get(node.id), nodeById),
            downstream: dependencyNeighbors(dependents.get(node.id), nodeById)
        };
    }
    return markers;
}
