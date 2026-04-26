/**
 * Monorepo dogfood: minimal graph-shaped helpers for shared Restormel graph–RAG direction.
 */
import type { GraphData } from '@restormel/graph-core/viewModel';

export function emptyGraphData(): GraphData {
  return { nodes: [], edges: [], ghostNodes: [], ghostEdges: [] };
}

export type { GraphData } from '@restormel/graph-core/viewModel';
export const RESTORMEL_GRAPHRAG_CORE_WORKSPACE = '0.0.0' as const;
