# Restormel Graph Kit v1: Trace And Playback Note

## Current SOPHIA Data Reality

The current dogfood workspace has access to several real trace-adjacent signals, but they do not yet form a canonical replay log.

Available now:

- `GraphSnapshotMeta.retrievalTrace`
  - retrieval framing
  - seed selection counts
  - traversal stats
  - pruning counts
  - closure telemetry
- `GraphSnapshotMeta`
  - `query_run_id`
  - retrieval timestamp
  - seed and traversed node IDs
  - rejected nodes and edges
- `EnrichmentStatusEvent`
  - staged/promoted/failed enrichment state
- conversation-run state in SOPHIA
  - streamed `pass_start` / `pass_complete`
  - cached pass outputs
  - final assistant output
  - reasoning-quality results
  - constitution deltas
- query cache and history storage
  - cached graph snapshot
  - cached per-pass claims and relations
  - historical query metadata

## What The Graph Kit Uses Today

The Graph Kit workspace now builds a typed timeline from:

- live query text where available
- latest graph snapshot metadata
- enrichment status
- latest assistant output
- reasoning-quality and constitution results when present

This produces a stable `GraphKitTraceEvent[]` plus a `playback` descriptor.

The timeline distinguishes:

- `sophia-stream`
- `snapshot-meta`
- `graph-derived`
- `placeholder`

That separation is important because some events are truly emitted by SOPHIA, while others are currently inferred from the latest graph state.

## What Is Real Vs Inferred

Real today:

- query received
- evidence added from retrieval trace
- traversal/pruning telemetry
- enrichment updates
- final output text when the active conversation has it
- validation results when the active conversation has them

Inferred today:

- claim created
- contradiction detected
- synthesis completed
- some inference-produced events

Placeholder today:

- full replay controls
- frame-by-frame graph state restore
- scrubber-linked graph playback

## Why Full Playback Is Not Yet Possible

The current workspace usually receives only the latest graph snapshot, not an ordered set of graph frames.

Missing for true playback:

1. persisted event sequence with stable timestamps
2. per-event or per-pass graph frames
3. normalized run-history loading for prior queries
4. graph diff or frame-reconstruction helpers

Without those, the honest mode is `event-focus`, not true replay.

## Extraction Boundary

Future package extraction should separate:

- Graph Kit trace contracts and timeline UI
- generic event-focus and playback helpers
- SOPHIA trace adapter
- SOPHIA conversation/history bridge

Recommended package direction:

- `graph-kit-core`
  - trace event contracts
  - playback descriptor contracts
  - event focus helpers
- `graph-kit-ui`
  - timeline panel
  - playback shell
- `graph-kit-adapter-sophia`
  - mapping from SOPHIA snapshot, conversation, and history state into Graph Kit trace contracts

## Next Step

The next credible playback step is not a richer UI control bar. It is a normalized SOPHIA run-history adapter that can load:

- stored SSE-like event sequences
- pass timestamps
- graph frames or deterministic graph diffs

Once that exists, the current event-selection timeline can evolve into real scrubbing with minimal UI churn.
