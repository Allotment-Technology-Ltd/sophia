import { adaptLegacyCanvasToReagraph } from '$lib/graph-kit/adapters/reagraphCanvasAdapter';
import type {
  GraphCanvasEdgeSemanticStyle,
  GraphCanvasNodeSemanticStyle
} from '$lib/components/visualization/semanticStyles';
import type { GraphEdge, GraphGhostEdge, GraphGhostNode, GraphNode } from '$lib/types/api';
import { useEffect, useMemo, useRef } from 'react';
import {
  GraphCanvas as ReagraphGraphCanvas,
  type GraphCanvasRef
} from 'reagraph';

interface ViewportCommand {
  type: 'fit' | 'reset-layout';
  nonce: number;
}

interface PathEdge {
  from: string;
  to: string;
}

export interface ReagraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  ghostNodes?: GraphGhostNode[];
  ghostEdges?: GraphGhostEdge[];
  showGhostLayer?: boolean;
  viewportCommand?: ViewportCommand | null;
  nodeSemanticStyles?: Record<string, GraphCanvasNodeSemanticStyle>;
  edgeSemanticStyles?: Record<string, GraphCanvasEdgeSemanticStyle>;
  pinnedNodeIds?: string[];
  pathNodeIds?: string[];
  pathEdges?: PathEdge[];
  focusNodeIds?: string[];
  focusEdgeIds?: string[];
  dimOutOfScope?: boolean;
  selectedNodeId?: string | null;
  onSelectedNodeChange?: (nodeId: string | null) => void;
  onNodeSelect?: (nodeId: string) => void;
  onJumpToReferences?: (nodeId: string) => void;
}

export default function ReagraphCanvasReact({
  nodes = [],
  edges = [],
  ghostNodes = [],
  ghostEdges = [],
  showGhostLayer = true,
  viewportCommand = null,
  nodeSemanticStyles = {},
  edgeSemanticStyles = {},
  pinnedNodeIds = [],
  pathNodeIds = [],
  pathEdges = [],
  focusNodeIds = [],
  focusEdgeIds = [],
  dimOutOfScope = false,
  selectedNodeId = null,
  onSelectedNodeChange,
  onNodeSelect,
  onJumpToReferences
}: ReagraphCanvasProps) {
  const graphRef = useRef(null as GraphCanvasRef | null);
  const graph = useMemo(() => adaptLegacyCanvasToReagraph({
    nodes,
    edges,
    ghostNodes,
    ghostEdges,
    showGhostLayer,
    nodeSemanticStyles,
    edgeSemanticStyles,
    pinnedNodeIds,
    pathNodeIds,
    pathEdges,
    focusNodeIds,
    focusEdgeIds,
    dimOutOfScope,
    selectedNodeId
  }), [
    nodes,
    edges,
    ghostNodes,
    ghostEdges,
    showGhostLayer,
    nodeSemanticStyles,
    edgeSemanticStyles,
    pinnedNodeIds,
    pathNodeIds,
    pathEdges,
    focusNodeIds,
    focusEdgeIds,
    dimOutOfScope,
    selectedNodeId
  ]);

  useEffect(() => {
    if (!viewportCommand || !graphRef.current) return;
    if (viewportCommand.type === 'fit' || viewportCommand.type === 'reset-layout') {
      graphRef.current.fitNodesInView();
    }
  }, [viewportCommand]);

  return (
    <ReagraphGraphCanvas
      ref={graphRef}
      nodes={graph.nodes}
      edges={graph.edges}
      selections={graph.selections}
      actives={graph.actives}
      layoutType="forceatlas2"
      draggable
      animated
      labelType="all"
      edgeInterpolation="curved"
      edgeArrowPosition="end"
      minDistance={300}
      maxDistance={25000}
      minZoom={1}
      maxZoom={100}
      onCanvasClick={() => onSelectedNodeChange?.(null)}
      onNodeClick={(node) => {
        const nodeId = node.id;
        const isGhost = Boolean(node.data?.isGhost);
        if (isGhost) return;
        onSelectedNodeChange?.(nodeId);
        onNodeSelect?.(nodeId);
      }}
      onNodeDoubleClick={(node) => {
        const nodeId = node.id;
        const isGhost = Boolean(node.data?.isGhost);
        if (!isGhost) onJumpToReferences?.(nodeId);
      }}
    />
  );
}
