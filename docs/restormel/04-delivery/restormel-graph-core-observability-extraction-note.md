# Restormel Graph Core and Observability Extraction Note

## Purpose

Extract renderer-agnostic graph logic and shared run-trace handling so Restormel Graph can evolve independently from the SOPHIA app shell.

## `@restormel/graph-core`

Package-owned now:

- graph projection from retrieval-like inputs
- graph layout helper
- graph diff helper
- graph summary helper
- graph trace-tag helper

Current exports:

- `projectGraph(input)`
- `diffGraphs(before, after)`
- `summarizeGraph(snapshot)`
- `computeLayout(nodes, edges, width, height)`
- `getNodeTraceTags(node)`
- `getNodeTraceLabel(node)`
- `formatTraceTag(tag)`

Still app-local:

- Graph Kit UI state
- renderer-specific semantic styling
- inspector and panel behavior

## `@restormel/observability`

Package-owned now:

- `RunTrace` and `ReasoningEvent` handling
- event stream to run-trace conversion
- run-trace back to event replay conversion
- normalized trace-ingestion contracts for compatibility adapters
- SOPHIA event/run-trace normalization
- OpenInference-like trace normalization example
- SSE frame serialization and parsing helpers
- sample SOPHIA event fixture for replay tests

Current exports:

- `eventsToTrace(events, options)`
- `traceToEvents(trace)`
- `normalizeSophiaReasoningEvents(events, options)`
- `normalizeRunTrace(trace)`
- `normalizeOpenInferenceLikeTrace(trace)`
- `normalizedTraceToReasoningObjectEvents(trace)`
- `serializeReasoningEvent(event)`
- `parseReasoningEventBlock(block)`

Still app-local:

- store mutation and panel updates in `sseHandler`
- fallback Graph Kit trace synthesis from SOPHIA-specific workspace context when no normalized trace is available

## Integration notes

- `src/lib/server/graphProjection.ts`, `src/lib/utils/graphLayout.ts`, and `src/lib/utils/graphTrace.ts` are now compatibility veneers over `@restormel/graph-core`
- analyse and verify SSE routes now serialize events through `@restormel/observability`
- the conversation store now parses SSE frames through `@restormel/observability`
- analyse cache writes now also capture a package-owned `RunTrace`
- reasoning-object adapters can now ingest canonical normalized traces instead of assuming SOPHIA-native event shapes

## Remaining gaps

- graph projection input is still retrieval-shaped rather than a fully generic platform retrieval contract
- Graph Kit timeline construction still lives in SOPHIA because it depends on current workspace view models
- replay uses event streams and graph snapshots, not per-frame graph playback

## Recommended next step

Move Graph Kit’s generic query/filter/focus helpers into `@restormel/graph-core`, then converge the Graph Workspace trace builder onto `RunTrace` instead of rebuilding timeline context directly from SOPHIA snapshot metadata.
