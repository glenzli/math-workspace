import { readerIcon } from './reader-icons';
import type { ReaderDependencyMarker } from './formal-renderer';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MAP_WIDTH = 720;
const NODE_RADIUS = 21;
const GRAPH_ROW_HEIGHT = 76;
const GRAPH_NODE_Y_OFFSET = 42;
const GRAPH_GROUP_GAP = 14;

type NodeStatus = 'hub' | 'linked' | 'terminal' | 'isolated';
type GraphGroupKind = 'cluster' | 'terminal' | 'isolated';

export interface ReaderPropositionReviewItem {
    id: string;
    display: string;
    compactDisplay: string;
    title: string;
    marker: ReaderDependencyMarker;
}

export interface ReaderPropositionReviewLabels {
    graphTitle: string;
    graphHint: string;
    empty: string;
    hub: string;
    linked: string;
    terminal: string;
    isolated: string;
    terminalPropositions: string;
    terminalPropositionSummary: (count: number) => string;
    terminalPropositionHint: string;
    nodeLabel: (display: string, upstream: number, downstream: number, ambientReferences: number, leanDeclarations: number, status: string) => string;
}

export interface ReaderPropositionReviewHost {
    labels(): ReaderPropositionReviewLabels;
    openProposition(id: string): void;
}

interface PositionedItem {
    item: ReaderPropositionReviewItem;
    x: number;
    y: number;
}

interface GraphGroup {
    kind: GraphGroupKind;
    items: ReaderPropositionReviewItem[];
    compactChain?: boolean;
}

interface PositionedGraphGroup extends GraphGroup {
    x: number;
    y: number;
    width: number;
    height: number;
    positions: PositionedItem[];
}

interface GraphLayout {
    width: number;
    height: number;
    positions: PositionedItem[];
    groups: PositionedGraphGroup[];
}

function svgElement(name: string): SVGElement {
    return document.createElementNS(SVG_NAMESPACE, name);
}

function isIsolated(item: ReaderPropositionReviewItem): boolean {
    return item.marker.directDependencies === 0 && item.marker.directDependents === 0;
}

function nodeStatus(item: ReaderPropositionReviewItem): NodeStatus {
    if (isIsolated(item)) return 'isolated';
    if (item.marker.directDependents === 0) return 'terminal';
    if (item.marker.directDependents >= 3 || item.marker.impactCount >= 4) return 'hub';
    return 'linked';
}

function statusLabel(status: NodeStatus, labels: ReaderPropositionReviewLabels): string {
    return labels[status];
}

function localComponents(items: ReaderPropositionReviewItem[]): ReaderPropositionReviewItem[][] {
    const itemById = new Map(items.map(item => [item.id, item]));
    const indexById = new Map(items.map((item, index) => [item.id, index]));
    const adjacency = new Map(items.map(item => [item.id, new Set<string>()]));
    items.forEach(item => item.marker.upstream.forEach(neighbor => {
        if (!itemById.has(neighbor.id)) return;
        adjacency.get(item.id)?.add(neighbor.id);
        adjacency.get(neighbor.id)?.add(item.id);
    }));
    const visited = new Set<string>();
    const components: ReaderPropositionReviewItem[][] = [];
    items.forEach(item => {
        if (visited.has(item.id)) return;
        const pending = [item.id];
        const component: ReaderPropositionReviewItem[] = [];
        visited.add(item.id);
        while (pending.length > 0) {
            const id = pending.pop() as string;
            const member = itemById.get(id);
            if (member) component.push(member);
            (adjacency.get(id) || new Set()).forEach(neighbor => {
                if (visited.has(neighbor)) return;
                visited.add(neighbor);
                pending.push(neighbor);
            });
        }
        component.sort((left, right) => (indexById.get(left.id) || 0) - (indexById.get(right.id) || 0));
        components.push(component);
    });
    return components;
}

function graphGroups(items: ReaderPropositionReviewItem[]): GraphGroup[] {
    const isolated = items.filter(isIsolated);
    const isolatedIds = new Set(isolated.map(item => item.id));
    const terminal: ReaderPropositionReviewItem[] = [];
    const continuing: ReaderPropositionReviewItem[] = [];
    const clusters: GraphGroup[] = [];
    localComponents(items.filter(item => !isolatedIds.has(item.id))).forEach(component => {
        if (component.length > 1) {
            clusters.push({ kind: 'cluster', items: component, compactChain: isCompactChain(component) });
            return;
        }
        const item = component[0];
        if (item.marker.directDependents === 0) terminal.push(item);
        else continuing.push(item);
    });
    const groups: GraphGroup[] = [];
    if (continuing.length > 0) groups.push({ kind: 'cluster', items: continuing });
    groups.push(...clusters);
    if (terminal.length > 0) groups.push({ kind: 'terminal', items: terminal });
    if (isolated.length > 0) groups.push({ kind: 'isolated', items: isolated });
    return groups;
}

function localNeighbors(item: ReaderPropositionReviewItem, itemById: Map<string, ReaderPropositionReviewItem>): string[] {
    return [...item.marker.upstream, ...item.marker.downstream]
        .map(neighbor => neighbor.id)
        .filter(id => itemById.has(id));
}

function isCompactChain(items: ReaderPropositionReviewItem[]): boolean {
    if (items.length < 2) return false;
    const itemById = new Map(items.map(item => [item.id, item]));
    const uniqueEdges = new Set<string>();
    let starts = 0;
    let ends = 0;
    for (const item of items) {
        const upstream = item.marker.upstream.filter(neighbor => itemById.has(neighbor.id));
        const downstream = item.marker.downstream.filter(neighbor => itemById.has(neighbor.id));
        if (upstream.length > 1 || downstream.length > 1) return false;
        if (upstream.length === 0) starts++;
        if (downstream.length === 0) ends++;
        item.marker.upstream.forEach(neighbor => {
            if (!itemById.has(neighbor.id)) return;
            uniqueEdges.add([item.id, neighbor.id].sort().join(':'));
        });
    }
    return uniqueEdges.size === items.length - 1 && starts === 1 && ends === 1;
}

function compactChainOrder(items: ReaderPropositionReviewItem[]): ReaderPropositionReviewItem[] {
    const itemById = new Map(items.map(item => [item.id, item]));
    const start = items.find(item => item.marker.upstream.filter(neighbor => itemById.has(neighbor.id)).length === 0)
        || items.find(item => localNeighbors(item, itemById).length === 1)
        || items[0];
    const ordered: ReaderPropositionReviewItem[] = [];
    const visited = new Set<string>();
    let current: ReaderPropositionReviewItem | undefined = start;
    while (current && !visited.has(current.id)) {
        ordered.push(current);
        visited.add(current.id);
        current = current.marker.downstream
            .map(neighbor => itemById.get(neighbor.id))
            .find((neighbor): neighbor is ReaderPropositionReviewItem => !!neighbor && !visited.has(neighbor.id));
        if (!current) {
            current = localNeighbors(ordered[ordered.length - 1], itemById)
                .map(id => itemById.get(id))
                .find((neighbor): neighbor is ReaderPropositionReviewItem => !!neighbor && !visited.has(neighbor.id));
        }
    }
    return ordered.length === items.length ? ordered : items;
}

function levelsFor(items: ReaderPropositionReviewItem[]): Map<string, number> {
    const itemById = new Map(items.map(item => [item.id, item]));
    const levelById = new Map<string, number>();
    const visiting = new Set<string>();
    const levelFor = (item: ReaderPropositionReviewItem): number => {
        const known = levelById.get(item.id);
        if (known !== undefined) return known;
        if (visiting.has(item.id)) return 0;
        visiting.add(item.id);
        const upstream = item.marker.upstream
            .map(neighbor => itemById.get(neighbor.id))
            .filter((neighbor): neighbor is ReaderPropositionReviewItem => !!neighbor);
        const level = upstream.length === 0 ? 0 : Math.max(...upstream.map(levelFor)) + 1;
        visiting.delete(item.id);
        levelById.set(item.id, level);
        return level;
    };
    items.forEach(levelFor);
    return levelById;
}

function layoutItems(items: ReaderPropositionReviewItem[]): GraphLayout {
    const width = MAP_WIDTH;
    let cursor = 12;
    const groups = graphGroups(items).map(group => {
        if (group.compactChain) {
            const chain = compactChainOrder(group.items);
            const positioned: PositionedGraphGroup = {
                ...group,
                x: 12,
                y: cursor,
                width: width - 24,
                height: GRAPH_ROW_HEIGHT,
                positions: chain.map((item, index) => ({
                    item,
                    x: 44 + (index + .5) * ((width - 88) / chain.length),
                    y: cursor + GRAPH_NODE_Y_OFFSET
                }))
            };
            cursor += positioned.height + GRAPH_GROUP_GAP;
            return positioned;
        }
        const levelById = levelsFor(group.items);
        const levels = new Map<number, ReaderPropositionReviewItem[]>();
        group.items.forEach(item => {
            const level = levelById.get(item.id) || 0;
            const members = levels.get(level) || [];
            members.push(item);
            levels.set(level, members);
        });
        const sortedLevels = [...levels.keys()].sort((left, right) => left - right);
        const positions: PositionedItem[] = [];
        sortedLevels.forEach((level, levelIndex) => {
            const members = levels.get(level) || [];
            members.forEach((item, index) => positions.push({
                item,
                x: 44 + (index + .5) * ((width - 88) / members.length),
                y: cursor + GRAPH_NODE_Y_OFFSET + levelIndex * GRAPH_ROW_HEIGHT
            }));
        });
        const height = GRAPH_ROW_HEIGHT + Math.max(0, sortedLevels.length - 1) * GRAPH_ROW_HEIGHT;
        const positioned: PositionedGraphGroup = {
            ...group,
            x: 12,
            y: cursor,
            width: width - 24,
            height,
            positions
        };
        cursor += height + GRAPH_GROUP_GAP;
        return positioned;
    });
    return {
        width,
        height: Math.max(90, cursor - 4),
        positions: groups.flatMap(group => group.positions),
        groups
    };
}

function nodeColor(item: ReaderPropositionReviewItem): { fill: string; stroke: string; glow: string } {
    const status = nodeStatus(item);
    const degree = Math.min(6, item.marker.directDependencies + item.marker.directDependents);
    const palette: Record<NodeStatus, { hue: number; saturation: number; lightness: number }> = {
        hub: { hue: 145, saturation: 56, lightness: 92 },
        linked: { hue: 220, saturation: 48, lightness: 94 },
        terminal: { hue: 34, saturation: 70, lightness: 94 },
        isolated: { hue: 41, saturation: 62, lightness: 91 }
    };
    const base = palette[status];
    const lightness = Math.max(73, base.lightness - degree * 2.6);
    return {
        fill: `hsl(${base.hue} ${base.saturation}% ${lightness}%)`,
        stroke: `hsl(${base.hue} ${Math.min(85, base.saturation + 16)}% ${Math.max(31, 52 - degree * 1.6)}%)`,
        glow: `hsl(${base.hue} ${Math.min(88, base.saturation + 18)}% 48% / ${.14 + degree * .045})`
    };
}

function shortenedLine(from: PositionedItem, to: PositionedItem): { x1: number; y1: number; x2: number; y2: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = NODE_RADIUS + 2;
    return {
        x1: from.x + dx / length * offset,
        y1: from.y + dy / length * offset,
        x2: to.x - dx / length * offset,
        y2: to.y - dy / length * offset
    };
}

function appendLine(svg: SVGElement, from: { x: number; y: number }, to: { x: number; y: number }, dashed = false): void {
    const line = svgElement('line');
    line.setAttribute('x1', String(from.x));
    line.setAttribute('y1', String(from.y));
    line.setAttribute('x2', String(to.x));
    line.setAttribute('y2', String(to.y));
    line.setAttribute('class', dashed ? 'reader-proposition-map-edge is-external' : 'reader-proposition-map-edge');
    line.setAttribute('marker-end', 'url(#reader-proposition-map-arrow)');
    svg.append(line);
}

function appendExternalRelation(
    svg: SVGElement,
    x: number,
    y: number,
    direction: 'upstream' | 'downstream',
    count: number
): void {
    const toward = direction === 'upstream' ? -1 : 1;
    const startOffset = direction === 'upstream' ? NODE_RADIUS + 22 : NODE_RADIUS + 2;
    const endOffset = direction === 'upstream' ? NODE_RADIUS + 2 : NODE_RADIUS + 22;
    appendLine(
        svg,
        { x, y: y + toward * startOffset },
        { x, y: y + toward * endOffset },
        true
    );
    const countLabel = svgElement('text');
    countLabel.setAttribute('class', 'reader-proposition-map-external-count');
    countLabel.setAttribute('x', String(x + 7));
    countLabel.setAttribute('y', String(y + toward * (NODE_RADIUS + 11) + (toward < 0 ? 3 : 0)));
    countLabel.textContent = String(count);
    svg.append(countLabel);
}

function appendSupplementalReferenceBadge(
    svg: SVGElement,
    x: number,
    y: number,
    count: number
): void {
    const badge = svgElement('g');
    badge.setAttribute('class', 'reader-proposition-map-reference-badge');
    badge.setAttribute('aria-hidden', 'true');
    const background = svgElement('rect');
    background.setAttribute('x', String(x + 8));
    background.setAttribute('y', String(y - 22));
    background.setAttribute('width', '12');
    background.setAttribute('height', '12');
    background.setAttribute('rx', '6');
    const label = svgElement('text');
    label.setAttribute('x', String(x + 14));
    label.setAttribute('y', String(y - 13.8));
    label.setAttribute('text-anchor', 'middle');
    label.textContent = String(count);
    badge.append(background, label);
    svg.append(badge);
}

function appendLeanAnchorBadge(svg: SVGElement, x: number, y: number): void {
    const badge = svgElement('g');
    badge.setAttribute('class', 'reader-proposition-map-lean-badge');
    badge.setAttribute('aria-hidden', 'true');
    const background = svgElement('circle');
    background.setAttribute('cx', String(x + 15));
    background.setAttribute('cy', String(y + 15));
    background.setAttribute('r', '6');
    const label = svgElement('text');
    label.setAttribute('x', String(x + 15));
    label.setAttribute('y', String(y + 17.2));
    label.setAttribute('text-anchor', 'middle');
    label.textContent = 'L';
    badge.append(background, label);
    svg.append(badge);
}

/**
 * Owns the chapter-local graph projection, visual semantics, and terminal-node
 * necessity-review
 * affordance. It renders strict formal-graph edges plus count-only outside-map
 * references; components are grouped by their in-chapter weak connectivity and
 * never infer new edges.
 */
export class ReaderPropositionReview {
    constructor(private readonly host: ReaderPropositionReviewHost) {}

    render(container: HTMLElement, items: ReaderPropositionReviewItem[]): void {
        const labels = this.host.labels();
        container.replaceChildren();

        if (items.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'reader-panel-empty';
            empty.textContent = labels.empty;
            container.append(empty);
            return;
        }

        container.append(this.renderMap(items, labels), this.renderTerminalPropositions(items, labels));
    }

    private renderMap(items: ReaderPropositionReviewItem[], labels: ReaderPropositionReviewLabels): HTMLElement {
        const section = document.createElement('section');
        section.className = 'reader-proposition-review-map';
        const hint = document.createElement('p');
        hint.className = 'reader-proposition-review-map-hint';
        hint.textContent = labels.graphHint;
        const legend = document.createElement('div');
        legend.className = 'reader-proposition-review-legend';
        (['hub', 'linked', 'terminal', 'isolated'] as NodeStatus[]).forEach(status => {
            const item = document.createElement('span');
            item.className = 'reader-proposition-review-legend-item is-' + status;
            const dot = document.createElement('i');
            dot.setAttribute('aria-hidden', 'true');
            const text = document.createElement('span');
            text.textContent = statusLabel(status, labels);
            item.append(dot, text);
            legend.append(item);
        });

        const layout = layoutItems(items);
        const positionsById = new Map(layout.positions.map(position => [position.item.id, position]));
        const surface = document.createElement('div');
        surface.className = 'reader-proposition-map-surface';
        const svg = svgElement('svg');
        svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
        svg.setAttribute('role', 'group');
        svg.setAttribute('aria-label', labels.graphTitle);

        const defs = svgElement('defs');
        const arrow = svgElement('marker');
        arrow.setAttribute('id', 'reader-proposition-map-arrow');
        arrow.setAttribute('viewBox', '0 0 8 8');
        arrow.setAttribute('refX', '6.5');
        arrow.setAttribute('refY', '4');
        arrow.setAttribute('markerWidth', '5');
        arrow.setAttribute('markerHeight', '5');
        arrow.setAttribute('orient', 'auto-start-reverse');
        const arrowPath = svgElement('path');
        arrowPath.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z');
        arrowPath.setAttribute('class', 'reader-proposition-map-arrow');
        arrow.append(arrowPath);
        defs.append(arrow);
        svg.append(defs);

        layout.groups.forEach(group => {
            const background = svgElement('rect');
            background.setAttribute('class', 'reader-proposition-map-group is-' + group.kind);
            background.setAttribute('x', String(group.x));
            background.setAttribute('y', String(group.y));
            background.setAttribute('width', String(group.width));
            background.setAttribute('height', String(group.height));
            background.setAttribute('rx', '8');
            svg.append(background);
        });

        layout.positions.forEach(position => {
            const internalUpstream = position.item.marker.upstream
                .map(neighbor => positionsById.get(neighbor.id))
                .filter((neighbor): neighbor is PositionedItem => !!neighbor);
            internalUpstream.forEach(neighbor => {
                const line = shortenedLine(neighbor, position);
                appendLine(svg, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 });
            });
            const externalUpstream = position.item.marker.upstream.filter(neighbor => !positionsById.has(neighbor.id));
            const externalDownstream = position.item.marker.downstream.filter(neighbor => !positionsById.has(neighbor.id));
            if (externalUpstream.length > 0) appendExternalRelation(svg, position.x, position.y, 'upstream', externalUpstream.length);
            if (externalDownstream.length > 0) appendExternalRelation(svg, position.x, position.y, 'downstream', externalDownstream.length);
        });

        layout.positions.forEach(position => {
            const item = position.item;
            const status = nodeStatus(item);
            const color = nodeColor(item);
            const node = svgElement('g');
            node.setAttribute('class', 'reader-proposition-map-node is-' + status);
            node.style.setProperty('--reader-proposition-node-fill', color.fill);
            node.style.setProperty('--reader-proposition-node-stroke', color.stroke);
            node.style.setProperty('--reader-proposition-node-glow', color.glow);
            node.setAttribute('tabindex', '0');
            node.setAttribute('role', 'button');
            node.setAttribute('aria-label', labels.nodeLabel(
                item.display,
                item.marker.directDependencies,
                item.marker.directDependents,
                item.marker.ambientReferenceCount || 0,
                item.marker.leanDeclarationCount || 0,
                statusLabel(status, labels)
            ));
            const title = svgElement('title');
            title.textContent = item.display + (item.title ? ' · ' + item.title : '') + ' · ' + statusLabel(status, labels)
                + ((item.marker.leanDeclarationCount || 0) > 0 ? ` · Lean ×${item.marker.leanDeclarationCount}` : '');
            const circle = svgElement('circle');
            circle.setAttribute('cx', String(position.x));
            circle.setAttribute('cy', String(position.y));
            circle.setAttribute('r', String(NODE_RADIUS));
            const text = svgElement('text');
            text.setAttribute('x', String(position.x));
            text.setAttribute('y', String(position.y + 3.2));
            text.setAttribute('text-anchor', 'middle');
            text.textContent = item.compactDisplay;
            node.append(title, circle, text);
            node.addEventListener('click', () => this.host.openProposition(item.id));
            node.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                this.host.openProposition(item.id);
            });
            svg.append(node);
        });

        // Draw these last so each count reads as a badge attached to its node,
        // while all dependency lines remain visually behind it.
        layout.positions.forEach(position => {
            if (position.item.marker.ambientReferenceCount > 0) {
                appendSupplementalReferenceBadge(svg, position.x, position.y, position.item.marker.ambientReferenceCount);
            }
            if ((position.item.marker.leanDeclarationCount || 0) > 0) {
                appendLeanAnchorBadge(svg, position.x, position.y);
            }
        });

        surface.append(svg);
        section.append(hint, legend, surface);
        return section;
    }

    private renderTerminalPropositions(items: ReaderPropositionReviewItem[], labels: ReaderPropositionReviewLabels): HTMLElement {
        const terminal = items.filter(item => item.marker.directDependents === 0);
        const section = document.createElement('section');
        section.className = 'reader-proposition-terminal-summary';
        section.setAttribute('aria-label', labels.terminalPropositions);
        const summary = document.createElement('div');
        summary.className = 'reader-proposition-terminal-summary-copy';
        const label = document.createElement('strong');
        label.textContent = labels.terminalPropositionSummary(terminal.length);
        const hint = document.createElement('p');
        hint.textContent = labels.terminalPropositionHint;
        summary.append(label, hint);
        section.append(summary);

        return section;
    }
}
