import type {
  GraphKitEdgeKind,
  GraphKitFocusMode,
  GraphKitGraphViewModel,
  GraphKitNeighborhoodDepth,
  GraphKitNodeKind,
  GraphKitScopeSummary
} from '$lib/graph-kit/types';
import {
  buildFocusSummary as buildFocusSummaryBase,
  buildReadabilityWarnings as buildReadabilityWarningsBase,
  buildSelectionPathFocus as buildSelectionPathFocusBase,
  mergePathFocuses as mergePathFocusesBase,
  reconcileKindSelection as reconcileKindSelectionBase,
  toggleKindSelection as toggleKindSelectionBase
} from '@restormel/graph-core/workspace';

export interface GraphKitPathFocus {
  nodeIds: string[];
  edges: Array<{ from: string; to: string }>;
}

export function reconcileKindSelection<T extends string>(
  current: Set<T>,
  available: Set<T>
): Set<T> {
  return reconcileKindSelectionBase(current, available);
}

export function toggleKindSelection<T extends string>(
  current: Set<T>,
  value: T,
  fallback: Set<T>
): Set<T> {
  return toggleKindSelectionBase(current, value, fallback);
}

export function buildSelectionPathFocus(
  graph: GraphKitGraphViewModel,
  selectedNodeId: string | null,
  enabled: boolean
): GraphKitPathFocus {
  return buildSelectionPathFocusBase(graph, selectedNodeId, enabled, {
    highlightEdgeKinds: ['supports', 'contradicts', 'unresolved', 'cites', 'retrieved-from']
  });
}

export function mergePathFocuses(...paths: GraphKitPathFocus[]): GraphKitPathFocus {
  return mergePathFocusesBase(...paths);
}

export function buildFocusSummary(params: {
  focusMode: GraphKitFocusMode;
  scopeNodeIds: string[];
  scopeEdgeIds: string[];
  totalNodes: number;
  totalEdges: number;
}): GraphKitScopeSummary {
  return buildFocusSummaryBase(params);
}

export function buildReadabilityWarnings(graph: GraphKitGraphViewModel): string[] {
  return buildReadabilityWarningsBase(graph, {
    sourceNodeKinds: ['source'],
    structuralEdgeKinds: ['contains', 'retrieved-from']
  });
}

export function defaultNeighborhoodDepth(): GraphKitNeighborhoodDepth {
  return 1;
}

export function sortNodeKinds(kinds: Set<GraphKitNodeKind>): GraphKitNodeKind[] {
  return [...kinds].sort();
}

export function sortEdgeKinds(kinds: Set<GraphKitEdgeKind>): GraphKitEdgeKind[] {
  return [...kinds].sort();
}
