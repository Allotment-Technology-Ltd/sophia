import {
  graphCanvasEdgeKey,
  type GraphCanvasEdgeSemanticStyle,
  type GraphCanvasNodeSemanticStyle
} from '$lib/components/visualization/semanticStyles';
import type { GraphEdge, GraphGhostEdge, GraphGhostNode, GraphNode } from '$lib/types/api';
import type { GraphEdge as ReagraphEdge, GraphNode as ReagraphNode } from 'reagraph';

interface PathEdge {
  from: string;
  to: string;
}

export interface ReagraphCanvasAdapterInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  ghostNodes: GraphGhostNode[];
  ghostEdges: GraphGhostEdge[];
  showGhostLayer: boolean;
  nodeSemanticStyles: Record<string, GraphCanvasNodeSemanticStyle>;
  edgeSemanticStyles: Record<string, GraphCanvasEdgeSemanticStyle>;
  pinnedNodeIds: string[];
  pathNodeIds: string[];
  pathEdges: PathEdge[];
  focusNodeIds: string[];
  focusEdgeIds: string[];
  dimOutOfScope: boolean;
  selectedNodeId: string | null;
}

export interface ReagraphCanvasGraph {
  nodes: ReagraphNode[];
  edges: ReagraphEdge[];
  selections: string[];
  actives: string[];
}

const DIMMED_FILL = 'color-mix(in srgb, var(--color-surface) 86%, var(--color-border))';
const DIMMED_EDGE = 'color-mix(in srgb, var(--color-dim) 62%, transparent)';

function getDefaultNodeFill(node: GraphNode): string {
  if (node.type === 'source') return 'var(--color-sage)';
  switch (node.phase) {
    case 'retrieval':
      return 'var(--color-amber)';
    case 'analysis':
      return 'var(--color-sage)';
    case 'critique':
      return 'var(--color-copper)';
    case 'synthesis':
      return 'var(--color-blue)';
    default:
      return 'var(--color-muted)';
  }
}

function getDefaultNodeSize(node: GraphNode): number {
  if (node.type === 'source') return 18;
  return 14;
}

function getDefaultEdgeFill(edge: GraphEdge): string {
  if (edge.conflict_status === 'contested') return 'var(--color-coral)';
  if (edge.conflict_status === 'resolved') return 'var(--color-teal)';
  return 'var(--color-dim)';
}

function parseDashArray(value: string | undefined): [number, number] | undefined {
  if (!value) return undefined;
  const parts = value
    .trim()
    .split(/\s+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part) && part > 0);

  if (parts.length < 2) return undefined;
  return [parts[0], parts[1]];
}

function isEdgeInPath(edge: PathEdge, pathEdges: Set<string>): boolean {
  return pathEdges.has(`${edge.from}->${edge.to}`);
}

function isNodeDimmed(nodeId: string, input: ReagraphCanvasAdapterInput): boolean {
  const { dimOutOfScope, focusNodeIds, pathNodeIds, selectedNodeId, edges } = input;
  if (dimOutOfScope && focusNodeIds.length > 0) return !focusNodeIds.includes(nodeId);
  if (pathNodeIds.length > 0) return !pathNodeIds.includes(nodeId);
  if (!selectedNodeId) return false;
  if (selectedNodeId === nodeId) return false;
  return !edges.some((edge) => edge.from === selectedNodeId && edge.to === nodeId)
    && !edges.some((edge) => edge.to === selectedNodeId && edge.from === nodeId);
}

function isEdgeDimmed(edgeId: string, edge: PathEdge, input: ReagraphCanvasAdapterInput): boolean {
  const { dimOutOfScope, focusEdgeIds, pathEdges, selectedNodeId } = input;
  if (dimOutOfScope && focusEdgeIds.length > 0) return !focusEdgeIds.includes(edgeId);
  if (pathEdges.length > 0) {
    const pathSet = new Set(pathEdges.map((candidate) => `${candidate.from}->${candidate.to}`));
    return !isEdgeInPath(edge, pathSet);
  }
  if (!selectedNodeId) return false;
  return edge.from !== selectedNodeId && edge.to !== selectedNodeId;
}

export function adaptLegacyCanvasToReagraph(input: ReagraphCanvasAdapterInput): ReagraphCanvasGraph {
  const pathEdgeSet = new Set(input.pathEdges.map((edge) => `${edge.from}->${edge.to}`));
  const reagraphNodes: ReagraphNode[] = input.nodes.map((node) => {
    const semanticStyle = input.nodeSemanticStyles[node.id];
    const dimmed = isNodeDimmed(node.id, input);
    return {
      id: node.id,
      label: node.label,
      subLabel: semanticStyle?.glyph,
      size: semanticStyle?.radius ?? getDefaultNodeSize(node),
      fill: dimmed ? DIMMED_FILL : (semanticStyle?.fill ?? getDefaultNodeFill(node)),
      data: {
        isGhost: false,
        node
      }
    };
  });

  const ghostNodes: ReagraphNode[] = input.showGhostLayer
    ? input.ghostNodes.map((node) => ({
      id: node.id,
      label: node.label,
      subLabel: 'ghost',
      size: 11,
      fill: 'color-mix(in srgb, var(--color-amber-bg) 74%, var(--color-surface-raised))',
      data: {
        isGhost: true,
        node
      }
    }))
    : [];

  const reagraphEdges: ReagraphEdge[] = input.edges.map((edge) => {
    const edgeId = graphCanvasEdgeKey(edge);
    const semanticStyle = input.edgeSemanticStyles[edgeId];
    const dimmed = isEdgeDimmed(edgeId, edge, input);
    const dashArray = parseDashArray(semanticStyle?.dasharray);
    return {
      id: edgeId,
      source: edge.from,
      target: edge.to,
      label: edge.type,
      fill: dimmed ? DIMMED_EDGE : (semanticStyle?.stroke ?? getDefaultEdgeFill(edge)),
      size: semanticStyle?.strokeWidth ?? 1.2,
      dashed: Boolean(dashArray),
      dashArray,
      arrowPlacement: semanticStyle?.marker === 'none' ? 'none' : 'end',
      data: {
        isGhost: false,
        edge,
        inPath: isEdgeInPath(edge, pathEdgeSet)
      }
    };
  });

  const ghostEdges: ReagraphEdge[] = input.showGhostLayer
    ? input.ghostEdges.map((edge) => ({
      id: `ghost:${edge.id}`,
      source: edge.from,
      target: edge.to,
      label: edge.type,
      fill: 'var(--color-amber)',
      size: 1.1,
      dashed: true,
      dashArray: [3, 5],
      arrowPlacement: 'end',
      data: {
        isGhost: true,
        edge
      }
    }))
    : [];

  const selections = input.selectedNodeId ? [input.selectedNodeId] : [];
  const activeIds = new Set<string>([
    ...input.pinnedNodeIds,
    ...input.pathNodeIds,
    ...input.focusNodeIds,
    ...input.focusEdgeIds
  ]);

  if (input.selectedNodeId) {
    activeIds.add(input.selectedNodeId);
    for (const edge of input.edges) {
      const edgeId = graphCanvasEdgeKey(edge);
      if (edge.from === input.selectedNodeId || edge.to === input.selectedNodeId) {
        activeIds.add(edge.from);
        activeIds.add(edge.to);
        activeIds.add(edgeId);
      }
    }
  }

  for (const edge of input.edges) {
    if (pathEdgeSet.has(`${edge.from}->${edge.to}`)) {
      activeIds.add(graphCanvasEdgeKey(edge));
    }
  }

  return {
    nodes: [...reagraphNodes, ...ghostNodes],
    edges: [...reagraphEdges, ...ghostEdges],
    selections,
    actives: [...activeIds]
  };
}
