import {
  RESTORMEL_CONTRACTS_SCHEMA_VERSION,
  type GraphSnapshot,
  type ReasoningEvent,
  type RunTrace,
  type RunTraceSource
} from '@restormel/contracts';

function isGraphSnapshotEvent(event: ReasoningEvent): event is Extract<ReasoningEvent, { type: 'graph_snapshot' }> {
  return event.type === 'graph_snapshot';
}

function isMetadataEvent(event: ReasoningEvent): event is Extract<ReasoningEvent, { type: 'metadata' }> {
  return event.type === 'metadata';
}

export function eventsToTrace(
  events: ReasoningEvent[],
  options: {
    source: RunTraceSource;
    runId?: string;
    query?: string;
    finalOutput?: string;
    startedAt?: string;
    completedAt?: string;
    metadata?: Record<string, unknown>;
  }
): RunTrace {
  const snapshots: GraphSnapshot[] = events
    .filter(isGraphSnapshotEvent)
    .map((event) => ({
      version: event.version,
      nodes: event.nodes,
      edges: event.edges,
      meta: event.meta
    }));

  const latestMetadata = [...events].reverse().find(isMetadataEvent);

  return {
    schemaVersion: RESTORMEL_CONTRACTS_SCHEMA_VERSION,
    source: options.source,
    runId: options.runId ?? latestMetadata?.query_run_id,
    query: options.query,
    finalOutput: options.finalOutput,
    startedAt: options.startedAt ?? snapshots[0]?.meta?.retrievalTimestamp,
    completedAt: options.completedAt,
    events: [...events],
    snapshots,
    metadata: options.metadata
  };
}

export function traceToEvents(trace: RunTrace): ReasoningEvent[] {
  return [...trace.events];
}
