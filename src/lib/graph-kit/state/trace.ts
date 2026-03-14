import type {
  GraphKitGraphViewModel,
  GraphKitTraceEvent
} from '$lib/graph-kit/types';

function firstVisibleNodeId(nodeIds: string[], graph: GraphKitGraphViewModel): string | null {
  if (nodeIds.length === 0) return null;
  const visible = new Set(graph.nodes.map((node) => node.id));
  return nodeIds.find((nodeId) => visible.has(nodeId)) ?? null;
}

export function getDefaultTraceEventId(events: GraphKitTraceEvent[]): string | null {
  if (events.length === 0) return null;
  const preferred =
    events.find((event) => event.status === 'active') ??
    events.find((event) => event.status === 'warning') ??
    events.at(-1);
  return preferred?.id ?? null;
}

export function findTraceEvent(
  events: GraphKitTraceEvent[],
  eventId: string | null
): GraphKitTraceEvent | null {
  if (!eventId) return null;
  return events.find((event) => event.id === eventId) ?? null;
}

export function stepTraceEvent(
  events: GraphKitTraceEvent[],
  currentEventId: string | null,
  direction: -1 | 1
): string | null {
  if (events.length === 0) return null;
  const currentIndex = currentEventId
    ? events.findIndex((event) => event.id === currentEventId)
    : -1;
  const startIndex = currentIndex === -1 ? (direction > 0 ? 0 : events.length - 1) : currentIndex;
  const nextIndex = Math.max(0, Math.min(events.length - 1, startIndex + direction));
  return events[nextIndex]?.id ?? null;
}

export function resolveTraceFocusSelection(
  event: GraphKitTraceEvent | null,
  graph: GraphKitGraphViewModel
): {
  selectedNodeId: string | null;
  focusedSection: 'evidence' | 'provenance' | 'validation' | null;
} {
  if (!event?.focus) {
    return { selectedNodeId: null, focusedSection: null };
  }

  const preferredNodeId = event.focus.primaryNodeId
    ? firstVisibleNodeId([event.focus.primaryNodeId], graph)
    : null;
  const selectedNodeId =
    preferredNodeId ?? firstVisibleNodeId(event.focus.relatedNodeIds, graph) ?? null;

  return {
    selectedNodeId,
    focusedSection:
      event.focus.inspectorSection === 'evidence' ||
      event.focus.inspectorSection === 'provenance' ||
      event.focus.inspectorSection === 'validation'
        ? event.focus.inspectorSection
        : null
  };
}

export function buildTracePathFocus(
  event: GraphKitTraceEvent | null,
  graph: GraphKitGraphViewModel
): { nodeIds: string[]; edges: Array<{ from: string; to: string }> } {
  if (!event?.focus) {
    return { nodeIds: [], edges: [] };
  }

  const visibleNodeIds = new Set(graph.nodes.map((node) => node.id));
  const focusNodeIds = event.focus.relatedNodeIds.filter((nodeId) => visibleNodeIds.has(nodeId));
  const focusEdgeIds = new Set(event.focus.edgeIds ?? []);

  const edges = graph.edges
    .filter((edge) => {
      if (focusEdgeIds.size > 0) return focusEdgeIds.has(edge.id);
      return focusNodeIds.includes(edge.from) && focusNodeIds.includes(edge.to);
    })
    .map((edge) => ({ from: edge.from, to: edge.to }));

  const nodeIds = new Set<string>(focusNodeIds);
  for (const edge of edges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }

  return { nodeIds: [...nodeIds], edges };
}
