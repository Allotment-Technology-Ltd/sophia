/**
 * @internal
 * SOPHIA-only implementation detail for {@link graphDataFromSophiaGraphKit}.
 * Do not import from application or Restormel integration code — use that function as the sole adapter entry.
 */
import type {
  GraphEdge,
  GraphGhostEdge,
  GraphGhostNode,
  GraphNode
} from '@restormel/graph-core/viewModel';
import type {
  GraphKitEdge,
  GraphKitGhostEdge,
  GraphKitGhostNode,
  GraphKitGraphViewModel,
  GraphKitNode
} from '$lib/graph-kit/types';

function toLegacyNodeType(node: GraphKitNode): GraphNode['type'] {
  return node.kind === 'source' ? 'source' : 'claim';
}

function toLegacyConflictStatus(node: GraphKitNode): GraphNode['conflict_status'] {
  switch (node.status) {
    case 'verified':
      return 'resolved';
    case 'unresolved':
      return 'unresolved';
    case 'contradicted':
      return 'contested';
    default:
      return 'none';
  }
}

function toLegacyEdgeConflictStatus(edge: GraphKitEdge): GraphEdge['conflict_status'] {
  switch (edge.status) {
    case 'verified':
      return 'resolved';
    case 'unresolved':
      return 'unresolved';
    case 'contradicted':
      return 'contested';
    default:
      return 'none';
  }
}

function toLegacyNode(node: GraphKitNode): GraphNode {
  return {
    id: node.id,
    type: toLegacyNodeType(node),
    label: node.title,
    phase: node.phase,
    domain: node.metadata.domain,
    sourceTitle: node.sourceLabel ?? node.metadata.sourceTitle,
    traversalDepth: node.metadata.traversalDepth,
    relevance: node.metadata.relevance,
    isSeed: node.isSeed,
    isTraversed: node.isTraversed,
    confidenceBand: node.metadata.confidenceBand,
    depth_level: node.metadata.extra.depth_level as number | undefined,
    evidence_strength: node.evidenceStrength,
    novelty_score: node.metadata.noveltyScore,
    derived_from: node.metadata.derivedFromIds,
    pass_origin: node.metadata.passOrigin ?? node.phase,
    conflict_status: toLegacyConflictStatus(node),
    unresolved_tension_id: node.metadata.unresolvedTensionId,
    provenance_id: node.metadata.provenanceId
  };
}

function toLegacyEdge(edge: GraphKitEdge): GraphEdge {
  return {
    from: edge.from,
    to: edge.to,
    type: edge.kind as GraphEdge['type'],
    phaseOrigin: edge.phase,
    depth_level: edge.metadata.depthLevel,
    evidence_strength: edge.confidence,
    derived_from: edge.metadata.derivedFromIds,
    pass_origin: edge.metadata.passOrigin ?? edge.phase,
    conflict_status: toLegacyEdgeConflictStatus(edge),
    unresolved_tension_id: edge.metadata.unresolvedTensionId,
    provenance_id: edge.metadata.provenanceId,
    relation_rationale: edge.rationale,
    relation_confidence: edge.confidence,
    evidence_count: edge.evidenceCount,
    evidence_sources: edge.metadata.evidenceSources
  };
}

function toLegacyGhostNode(node: GraphKitGhostNode): GraphGhostNode {
  return {
    id: node.id,
    label: node.title,
    reasonCode: node.reasonCode,
    sourceTitle: node.sourceTitle,
    confidence: node.confidence,
    anchorNodeId: node.anchorNodeId,
    pass_origin: node.phase
  };
}

function toLegacyGhostEdge(edge: GraphKitGhostEdge): GraphGhostEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: edge.kind as GraphGhostEdge['type'],
    reasonCode: edge.reasonCode,
    relation_confidence: edge.confidence,
    rationale_source: edge.rationale,
    pass_origin: edge.phase
  };
}

export function adaptGraphViewModelToLegacyCanvas(graph: GraphKitGraphViewModel): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  ghostNodes: GraphGhostNode[];
  ghostEdges: GraphGhostEdge[];
} {
  // Implementation of Graph Kit → Contract v0 (`GraphData`). Callers outside this folder should use graphDataFromSophiaGraphKit only.
  return {
    nodes: graph.nodes.map(toLegacyNode),
    edges: graph.edges.map(toLegacyEdge),
    ghostNodes: graph.ghostNodes.map(toLegacyGhostNode),
    ghostEdges: graph.ghostEdges.map(toLegacyGhostEdge)
  };
}
