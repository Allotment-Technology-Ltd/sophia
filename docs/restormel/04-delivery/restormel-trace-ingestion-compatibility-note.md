# Restormel Trace-Ingestion Compatibility

## Classification
- Compatibility layer, not a proprietary tracing backend.
- Shared platform contract and adapter work.
- Incremental hardening of the reasoning-object input seam.

## Reuse candidates
- `@restormel/contracts/trace-ingestion`
- `@restormel/observability/normalize`
- `@restormel/observability/fixtures`

## Build scope
- Added canonical normalized trace contracts for spans, events, producers, and ingested run traces.
- Added normalizers for current SOPHIA `ReasoningEvent[]` streams and `RunTrace` payloads.
- Added a minimal foreign-producer example using an OpenInference-like span payload.
- Updated the reasoning-object adapter so it can consume canonical normalized traces, cached `RunTrace`, or raw SOPHIA events when available.

## Why it matters to Restormel
- Restormel Graph should compile reasoning activity into reasoning objects, not require a Restormel-native tracing stack.
- This keeps Restormel aligned with existing telemetry ecosystems while preserving the differentiated reasoning-object layer.
- It gives future Graph and GraphRAG surfaces a stable ingestion boundary for trace-derived reasoning context.

## Risk of overbuilding / incumbent collision
- The new layer does not store traces, stream traces, or compete with observability vendors.
- The normalized format is intentionally small: enough for reasoning-object compilation and timeline context, not a full telemetry data model.
- OpenTelemetry and OpenInference support remains adapter-oriented; this pass only proves the contract shape and mapping path.

## Current SOPHIA trace reality
- Richer than the target model in a few product-specific areas:
  - `graph_snapshot` carries graph payloads plus retrieval-specific metadata.
  - `constitution_delta` and `reasoning_quality` capture reasoning-evaluation signals directly.
- Poorer than the target model in other areas:
  - most events do not carry durable trace/span IDs
  - timestamps are incomplete outside snapshot metadata
  - pass duration and nested span structure are mostly implicit
  - the workspace path often has only the latest graph snapshot, not a persisted event-by-event replay log

## Compatibility targets
- Current:
  - SOPHIA SSE `ReasoningEvent[]`
  - SOPHIA cached `RunTrace`
- Future adapter targets:
  - OpenTelemetry span/event exports
  - OpenInference-style inference traces
  - other app-local event streams that can map onto the normalized run trace contract

## Integration notes
- The graph workspace still falls back to snapshot-derived timeline synthesis when no normalized trace or run trace is available.
- When a normalized trace is available, the reasoning-object layer now uses that canonical input instead of assuming SOPHIA-native event structures.
- Foreign trace producers can be mapped at the observability layer without changing Graph Kit or inspector code.

## Example mapping direction
- OpenInference-like `reasoning run` span -> normalized `run-start` / run span
- retrieval span -> normalized retrieval/pass span
- verification span -> normalized verification span + reasoning-object validation timeline event
- SOPHIA `graph_snapshot` event -> normalized `graph-snapshot` event with node/edge refs

## Remaining gaps
- The normalized trace contract is intentionally coarse and does not yet model token accounting or vendor-specific span attributes in detail.
- Cached UI history does not yet persist normalized traces directly.
- Timeline semantics are still conservative for foreign producers; many non-SOPHIA events map to `note` until richer cross-ecosystem semantics are proven.
