import { projectGraph, type GraphProjectionInput } from '@restormel/graph-core/projection';
import type { GraphEdge, GraphNode, GraphSnapshotMeta } from '@restormel/contracts/api';
import type { RetrievalResult } from './retrieval';

export function projectRetrievalToGraph(retrieval: RetrievalResult): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphSnapshotMeta;
} {
  const snapshot = projectGraph(retrieval as GraphProjectionInput);
  return {
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    meta: snapshot.meta ?? {}
  };
}
