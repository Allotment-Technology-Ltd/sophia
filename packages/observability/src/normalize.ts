import {
  RESTORMEL_CONTRACTS_SCHEMA_VERSION,
  type NormalizedRunTrace,
  type NormalizedTraceEvent,
  type NormalizedTraceEventKind,
  type TraceIngestionPhase,
  type NormalizedTraceSpan,
  type ReasoningEvent,
  type RunTrace,
  type TraceIngestionSource,
  type ReasoningObjectTraceEvent,
  type ReasoningObjectTraceEventKind
} from '@restormel/contracts';

function inferPhaseFromPass(pass?: string): TraceIngestionPhase | undefined {
  if (
    pass === 'retrieval' ||
    pass === 'analysis' ||
    pass === 'critique' ||
    pass === 'synthesis' ||
    pass === 'verification'
  ) {
    return pass;
  }
  return undefined;
}

function inferEventKind(event: ReasoningEvent): NormalizedTraceEventKind {
  switch (event.type) {
    case 'pass_start':
      return 'pass-start';
    case 'pass_complete':
      return 'pass-complete';
    case 'pass_structured':
      return 'pass-structured';
    case 'graph_snapshot':
      return 'graph-snapshot';
    case 'claims':
      return 'claims-emitted';
    case 'relations':
      return 'relations-emitted';
    case 'sources':
      return 'sources-emitted';
    case 'grounding_sources':
      return 'grounding-sources-emitted';
    case 'confidence_summary':
      return 'confidence-summary';
    case 'metadata':
      return 'metadata';
    case 'reasoning_quality':
    case 'reasoning_scores':
      return 'reasoning-quality';
    case 'constitution_delta':
      return 'constitution-delta';
    case 'constitution_check':
      return 'constitution-check';
    case 'verification_complete':
      return 'verification-complete';
    case 'extraction_complete':
      return 'extraction-complete';
    case 'error':
      return 'error';
    default:
      return 'annotation';
  }
}

function inferTraceStatus(event: ReasoningEvent): NormalizedTraceEvent['status'] {
  switch (event.type) {
    case 'error':
      return 'error';
    case 'constitution_delta':
      return event.overall_compliance === 'fail'
        ? 'error'
        : event.overall_compliance === 'partial'
          ? 'warning'
          : 'ok';
    case 'metadata':
      return event.retrieval_degraded ? 'warning' : 'ok';
    default:
      return 'ok';
  }
}

function buildPayloadSummary(event: ReasoningEvent): string | undefined {
  switch (event.type) {
    case 'graph_snapshot':
      return `${event.nodes.length} nodes, ${event.edges.length} edges`;
    case 'claims':
      return `${event.claims.length} claims`;
    case 'relations':
      return `${event.relations.length} relation bundles`;
    case 'sources':
      return `${event.sources.length} sources`;
    case 'grounding_sources':
      return `${event.sources.length} grounding sources`;
    case 'pass_structured':
      return `${event.sections.length} sections`;
    case 'confidence_summary':
      return `${event.totalClaims} claims, ${event.lowConfidenceCount} low-confidence`;
    case 'reasoning_quality':
    case 'reasoning_scores':
      return `overall ${(event.reasoning_quality.overall_score * 100).toFixed(0)}%`;
    case 'constitution_delta':
      return `${event.unresolved_violations.length} unresolved violations`;
    case 'error':
      return event.message;
    case 'verification_complete':
      return `${event.result.extracted_claims.length} extracted claims`;
    case 'extraction_complete':
      return `${event.claims.length} extracted claims`;
    default:
      return undefined;
  }
}

function inferObjectRefs(event: ReasoningEvent): NormalizedTraceEvent['objectRefs'] {
  switch (event.type) {
    case 'graph_snapshot':
      return [
        ...event.nodes.map((node) => ({ kind: 'node' as const, id: node.id })),
        ...event.edges.map((edge) => ({ kind: 'edge' as const, id: `${edge.from}:${edge.type}:${edge.to}` }))
      ];
    case 'claims':
      return event.claims.map((claim) => ({ kind: 'claim' as const, id: claim.id }));
    case 'relations':
      return event.relations.map((bundle) => ({ kind: 'claim' as const, id: bundle.claimId }));
    case 'sources':
      return event.sources.map((source) => ({ kind: 'source' as const, id: source.id }));
    case 'grounding_sources':
      return event.sources.map((source) => ({ kind: 'source' as const, id: source.url }));
    default:
      return [];
  }
}

function buildEventAttributes(event: ReasoningEvent): Record<string, unknown> {
  switch (event.type) {
    case 'pass_start':
      return {
        pass: event.pass,
        model_provider: event.model_provider,
        model_id: event.model_id
      };
    case 'pass_complete':
      return { pass: event.pass };
    case 'pass_structured':
      return { pass: event.pass, wordCount: event.wordCount };
    case 'metadata':
      return {
        query_run_id: event.query_run_id,
        duration_ms: event.duration_ms,
        retrieval_degraded: event.retrieval_degraded ?? false,
        selected_domain: event.selected_domain,
        selected_domain_mode: event.selected_domain_mode
      };
    case 'graph_snapshot':
      return {
        version: event.version,
        snapshot_id: event.meta?.snapshot_id,
        parent_snapshot_id: event.meta?.parent_snapshot_id,
        query_run_id: event.meta?.query_run_id
      };
    case 'reasoning_quality':
    case 'reasoning_scores':
      return {
        overall_score: event.reasoning_quality.overall_score
      };
    case 'constitution_delta':
      return {
        pass: event.pass,
        overall_compliance: event.overall_compliance
      };
    case 'verification_complete':
      return {
        request_id: event.result.request_id,
        extracted_claims: event.result.extracted_claims.length
      };
    case 'extraction_complete':
      return {
        extraction_model: event.metadata.extraction_model,
        source_length: event.metadata.source_length
      };
    case 'error':
      return { message: event.message };
    default:
      return {};
  }
}

function buildTimestamp(
  event: ReasoningEvent,
  options: { fallbackTimestamp?: string; index: number }
): string {
  if (event.type === 'graph_snapshot' && event.meta?.retrievalTimestamp) {
    return event.meta.retrievalTimestamp;
  }
  return options.fallbackTimestamp ?? new Date(0 + options.index).toISOString();
}

export function normalizeSophiaReasoningEvents(
  events: ReasoningEvent[],
  options?: {
    traceId?: string;
    runId?: string;
    query?: string;
    source?: TraceIngestionSource;
    startedAt?: string;
    completedAt?: string;
    producerName?: string;
    producerVersion?: string;
    fallbackTimestamp?: string;
  }
): NormalizedRunTrace {
  const traceId = options?.traceId ?? options?.runId ?? `trace:sophia:${events.length}`;
  const normalizedEvents: NormalizedTraceEvent[] = events.map((event, index) => ({
    id: `${traceId}:event:${index + 1}`,
    traceId,
    kind: inferEventKind(event),
    name: event.type,
    timestamp: buildTimestamp(event, {
      fallbackTimestamp: options?.fallbackTimestamp,
      index
    }),
    phase:
      'pass' in event
        ? inferPhaseFromPass(event.pass)
        : event.type === 'graph_snapshot'
          ? inferPhaseFromPass(event.meta?.pass_sequence ? 'synthesis' : undefined)
          : undefined,
    status: inferTraceStatus(event),
    sequence: index + 1,
    attributes: buildEventAttributes(event),
    objectRefs: inferObjectRefs(event),
    payloadSummary: buildPayloadSummary(event)
  }));

  const openPasses = new Map<string, { id: string; pass: string; startTime: string }>();
  const spans: NormalizedTraceSpan[] = [];

  for (const event of normalizedEvents) {
    if (event.kind === 'pass-start' && typeof event.attributes.pass === 'string') {
      openPasses.set(event.attributes.pass, {
        id: `${traceId}:span:${event.attributes.pass}`,
        pass: event.attributes.pass,
        startTime: event.timestamp
      });
      continue;
    }

    if (event.kind === 'pass-complete' && typeof event.attributes.pass === 'string') {
      const open = openPasses.get(event.attributes.pass);
      if (!open) continue;
      spans.push({
        id: open.id,
        traceId,
        name: `${open.pass} pass`,
        kind: open.pass === 'verification' ? 'verification' : 'pass',
        phase: inferPhaseFromPass(open.pass),
        status: event.status,
        startTime: open.startTime,
        endTime: event.timestamp,
        attributes: { pass: open.pass }
      });
      openPasses.delete(event.attributes.pass);
    }
  }

  return {
    schemaVersion: RESTORMEL_CONTRACTS_SCHEMA_VERSION,
    source: options?.source ?? 'sophia-sse',
    producer: {
      ecosystem: options?.source ?? 'sophia-sse',
      name: options?.producerName ?? 'sophia',
      version: options?.producerVersion,
      transport: options?.source === 'sophia-run-trace' ? 'cached' : 'sse'
    },
    traceId,
    runId: options?.runId,
    query: options?.query,
    startedAt: options?.startedAt ?? normalizedEvents[0]?.timestamp,
    completedAt: options?.completedAt ?? normalizedEvents.at(-1)?.timestamp,
    spans,
    events: normalizedEvents
  };
}

export function normalizeRunTrace(trace: RunTrace): NormalizedRunTrace {
  return normalizeSophiaReasoningEvents(trace.events, {
    traceId: trace.runId ?? `trace:${trace.source}:${trace.events.length}`,
    runId: trace.runId,
    query: trace.query,
    source: trace.source === 'sse' ? 'sophia-sse' : 'sophia-run-trace',
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    producerName: 'sophia'
  });
}

export interface OpenInferenceLikeSpanInput {
  id: string;
  name: string;
  parentId?: string;
  startTime: string;
  endTime?: string;
  status?: 'ok' | 'error' | 'warning' | 'unknown';
  attributes?: Record<string, unknown>;
}

export interface OpenInferenceLikeTraceInput {
  traceId: string;
  runId?: string;
  query?: string;
  spans: OpenInferenceLikeSpanInput[];
}

export function normalizeOpenInferenceLikeTrace(
  trace: OpenInferenceLikeTraceInput
): NormalizedRunTrace {
  const spans: NormalizedTraceSpan[] = trace.spans.map((span) => ({
    id: span.id,
    traceId: trace.traceId,
    parentSpanId: span.parentId,
    name: span.name,
    kind: span.name.toLowerCase().includes('retriev')
      ? 'retrieval'
      : span.name.toLowerCase().includes('verif')
        ? 'verification'
        : span.name.toLowerCase().includes('pass')
          ? 'pass'
          : 'reasoning',
    phase:
      typeof span.attributes?.phase === 'string'
        ? inferPhaseFromPass(span.attributes.phase)
        : undefined,
    status: span.status ?? 'unknown',
    startTime: span.startTime,
    endTime: span.endTime,
    attributes: span.attributes ?? {}
  }));

  const events: NormalizedTraceEvent[] = spans.map((span, index) => ({
    id: `${trace.traceId}:event:${index + 1}`,
    traceId: trace.traceId,
    spanId: span.id,
    parentSpanId: span.parentSpanId,
    kind: index === 0 ? 'run-start' : span.kind === 'verification' ? 'verification-complete' : 'annotation',
    name: span.name,
    timestamp: span.startTime,
    phase: span.phase,
    status: span.status,
    sequence: index + 1,
    attributes: span.attributes,
    objectRefs: [],
    payloadSummary: `Mapped from ${span.name}`
  }));

  return {
    schemaVersion: RESTORMEL_CONTRACTS_SCHEMA_VERSION,
    source: 'openinference',
    producer: {
      ecosystem: 'openinference',
      name: 'openinference-compatible',
      transport: 'ingested'
    },
    traceId: trace.traceId,
    runId: trace.runId,
    query: trace.query,
    startedAt: spans[0]?.startTime,
    completedAt: spans.at(-1)?.endTime ?? spans.at(-1)?.startTime,
    spans,
    events
  };
}

function toReasoningTraceKind(event: NormalizedTraceEvent): ReasoningObjectTraceEventKind {
  switch (event.kind) {
    case 'run-start':
      return 'query-received';
    case 'graph-snapshot':
      return 'snapshot-captured';
    case 'sources-emitted':
    case 'grounding-sources-emitted':
      return 'evidence-added';
    case 'claims-emitted':
      return 'claim-created';
    case 'relations-emitted':
    case 'pass-structured':
      return 'inference-produced';
    case 'constitution-delta':
      return 'contradiction-detected';
    case 'reasoning-quality':
    case 'constitution-check':
    case 'verification-complete':
      return 'validation-run';
    case 'run-complete':
      return 'final-output-created';
    case 'pass-complete':
      return event.phase === 'synthesis' ? 'synthesis-completed' : 'note';
    default:
      return 'note';
  }
}

export function normalizedTraceToReasoningObjectEvents(
  trace: NormalizedRunTrace
): ReasoningObjectTraceEvent[] {
  return trace.events.map((event) => ({
    id: event.id,
    kind: toReasoningTraceKind(event),
    title: event.name,
    summary:
      event.payloadSummary ??
      `Normalized ${event.kind} event from ${trace.producer.ecosystem}.`,
    phase: event.phase === 'verification' ? 'synthesis' : event.phase,
    status:
      event.status === 'error'
        ? 'warning'
        : event.status === 'warning'
          ? 'warning'
          : 'complete',
    source:
      trace.source === 'opentelemetry' || trace.source === 'openinference'
        ? 'placeholder'
        : trace.source === 'sophia-run-trace' || trace.source === 'sophia-sse'
          ? 'run-stream'
          : 'graph-derived',
    sequence: event.sequence,
    timestamp: event.timestamp,
    facts: Object.entries(event.attributes).slice(0, 4).map(([label, value]) => ({
      label,
      value: typeof value === 'string' ? value : (JSON.stringify(value) ?? 'n/a')
    })),
    focus: event.objectRefs.length > 0
      ? {
          primaryNodeId: event.objectRefs.find((ref) => ref.kind === 'node' || ref.kind === 'claim')?.id,
          relatedNodeIds: event.objectRefs
            .filter((ref) => ref.kind === 'node' || ref.kind === 'claim')
            .map((ref) => ref.id),
          edgeIds: event.objectRefs
            .filter((ref) => ref.kind === 'edge')
            .map((ref) => ref.id)
        }
      : undefined
  }));
}
