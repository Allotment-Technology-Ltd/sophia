# Phase 1 — RunTrace / ReasoningEvent emitter checklist

This document aligns external and internal runtimes with **Restormel Graph** inputs: canonical types in `@restormel/contracts` (npm) and assembly helpers in `@restormel/observability` (npm).

## Canonical types (read this first)

| Type | Package | Source (Restormel Keys) |
|------|---------|-------------------------|
| `ReasoningEvent` | `@restormel/contracts` | [`packages/contracts/src/trace.ts`](https://github.com/Allotment-Technology-Ltd/restormel-keys/tree/main/packages/contracts/src/trace.ts) |
| `RunTrace` | `@restormel/contracts` | same file |
| `SSEEvent` (union member of `ReasoningEvent`) | `@restormel/contracts` | [`packages/contracts/src/api.ts`](https://github.com/Allotment-Technology-Ltd/restormel-keys/tree/main/packages/contracts/src/api.ts) |
| `NormalizedRunTrace` / trace ingestion | `@restormel/contracts` | [`packages/contracts/src/trace-ingestion.ts`](https://github.com/Allotment-Technology-Ltd/restormel-keys/tree/main/packages/contracts/src/trace-ingestion.ts) |

`ReasoningEvent` is:

- All **`SSEEvent`** variants (streaming passes, graph snapshots, metadata, errors, etc.)
- Plus **`ExtractionCompleteEvent`**, **`ReasoningScoresEvent`**, **`VerificationCompleteEvent`** for verification-style flows

## `@restormel/observability` — role and boundaries

**Role:** Pure **normalization and shaping** — turn a chronological list of events into a **`RunTrace`**, round-trip events, and optionally normalize toward trace-ingestion / reasoning-object timelines.

**Exports:** see npm `@restormel/observability` and [Restormel Keys `packages/observability`](https://github.com/Allotment-Technology-Ltd/restormel-keys/tree/main/packages/observability).

- **`eventsToTrace(events, options)`** — primary path: append-only `ReasoningEvent[]` → `RunTrace` with `snapshots` derived from `graph_snapshot` events.
- **`traceToEvents(trace)`** — replay / storage round-trip.
- **`normalizeSophiaReasoningEvents`**, **`normalizeRunTrace`**, **`normalizedTraceToReasoningObjectEvents`** — bridge legacy or vendor shapes without owning storage or UI.

**Non-goals (explicit):** no trace backend, no retention, no dashboard, no replacement for product SSE routes.

## Emitter checklist (minimum viable)

Use this when wiring a new runtime (or auditing SOPHIA’s [`engine` callbacks](../../src/lib/server/engine.ts) and [`api/analyse` SSE](../../src/routes/api/analyse/+server.ts)).

### 1. Identity and lifecycle

- Set stable **`runId`** (or accept it from upstream metadata) when calling `eventsToTrace`.
- Prefer **`schemaVersion`** = `RESTORMEL_CONTRACTS_SCHEMA_VERSION` on persisted `RunTrace` (handled by `RunTraceSchema` defaults).
- Record **`source`**: `'sse'` for live streams, `'cached'` for replay, `'snapshot'` for persisted snapshots.

### 2. Pass lifecycle (dialectical or multi-pass reasoning)

For each logical pass (analysis, critique, synthesis, verification, etc.):

- Emit **`pass_start`** (with pass id / label per contract fields).
- Stream **`pass_chunk`** as tokens arrive (if applicable).
- Emit **`pass_complete`** when the pass finishes.
- If structured sections exist, emit **`pass_structured`** once parseable.

### 3. Graph compilation (Restormel Graph core story)

- Emit **`graph_snapshot`** with `nodes`, `edges`, optional `version`, and **`meta`** (`GraphSnapshotMeta`) when the reasoning graph state changes — include **`query_run_id`** / **`snapshot_id`** / **`pass_sequence`** when available so compare/diff and workspace tooling can correlate runs.

### 4. Retrieval and cost transparency

- Emit **`metadata`** including retrieval counts, degradation flags, **`context_pack_stats`** (if using pass-specific context packs), and token/cost breakdowns when the product surface needs debugging (see SOPHIA engine `onMetadata`).

### 5. Claims and relations (when not only snapshot-based)

- Emit **`claims`** / **`relations`** when the runtime exposes incremental structured data separate from full graph snapshots.

### 6. Grounding and sources

- Emit **`sources`** and/or **`grounding_sources`** when URL/title grounding is part of the run.

### 7. Errors

- Emit **`error`** with a stable, user-safe message; avoid leaking secrets in any event payload.

### 8. Optional product-specific events

Still part of **`SSEEvent`** where used:

- **`constitution_check`**, **`constitution_delta`**, **`reasoning_quality`**, **`enrichment_status`**, **`confidence_summary`**

These are **optional for a minimal emitter** but required for parity with SOPHIA’s full debugger surface.

### 9. Verification pipeline extensions

If the run includes extraction + rubric scoring:

- Append **`ExtractionCompleteEvent`**, **`ReasoningScoresEvent`**, and/or **`VerificationCompleteEvent`** so `ReasoningEvent[]` reflects the full pipeline (see [`verification/pipeline`](../../src/lib/server/verification/pipeline.ts)).

## Assembly recipe

```ts
import type { ReasoningEvent } from '@restormel/contracts/trace';
import { eventsToTrace } from '@restormel/observability';

const trace = eventsToTrace(events, {
  source: 'sse',
  runId: '...',
  query: userQuery,
  finalOutput: optionalFinalText,
  startedAt: optionalIso,
  completedAt: optionalIso,
  metadata: optionalBag
});
```

Consumers: graph workspace adapters, diff/compare tools, trace ingestion normalizers (`trace-ingestion.ts`).

## SOPHIA reference emitter

**Reference implementation:** dialectical engine callbacks in [`src/lib/server/engine.ts`](../../src/lib/server/engine.ts) and the SSE mapper in [`src/routes/api/analyse/+server.ts`](../../src/routes/api/analyse/+server.ts). Treat these as the **behavioral spec** until a slimmer reference server is split out.

## Related docs

- [Phase 1 extraction status and index](./PHASE1-EXTRACTION-STATUS.md)
- [Restormel engineering spec (handoff)](./phase1-restormel-engineering-spec.md)
- [Restormel Graph — SOPHIA extraction artefacts](./04-delivery/restormel-graph-sophia-extraction-artifacts.md)
- [`@restormel/graph-core` Contract v0 scope](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/packages/graph-core/GRAPH_CORE_V0_SCOPE.md)
