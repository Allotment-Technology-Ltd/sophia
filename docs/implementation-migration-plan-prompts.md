# SOPHIA — Implementation Migration Plan + Execution Prompts

Updated: 2 March 2026

This document defines the **new implementation plan** for infrastructure migration, with practical prompts to execute each workstream. It is intentionally separate from `prompts-reference.md` (which remains the canonical library of stage prompts).

---

## Scope and sequencing

- Finish ingestion of the remaining 9 ethics sources using the **current ingestion pipeline**.
- Migrate **runtime architecture only** for MVP (query-time reasoning path).
- Defer ingestion architecture migration to **MVP+1** (next domain expansion).
- Fix references/sources capture + display in the same MVP window.
- Ensure history retrieval does **not** re-run expensive model queries.

---

## Implementation Plan (MVP)

### 1) Complete ethics ingestion first (no ingestion refactor yet)

- Keep current ingestion stack for the remaining 9 ethics sources.
- Avoid model/provider swaps in ingestion until that batch is complete.
- Objective: maintain embedding consistency and minimise delivery risk.

### 2) Runtime migration to Google Cloud-native AI

- Introduce Vertex runtime provider abstraction (`gemini-2.5-pro` for reasoning, `gemini-2.5-flash` for structured extraction).
- Use Vercel AI SDK as the runtime interface for streaming and structured outputs.
- Keep existing API contract and SSE event semantics stable.

### 3) References/sources reliability fix

- Add dedicated `sources` SSE event from retrieval output (real source records, not LLM-inferred source strings).
- Ensure frontend consumes and renders these records in the Sources view.
- Harden extraction failure handling so the panel still receives deterministic state.

### 4) Query replay efficiency (no re-run on history)

- Add a server-side `query_cache` table for replayable response payloads.
- On history select: replay cached payload when available, instead of re-running the 3-pass engine.
- Add local replay cache for fast UX and reduced network roundtrips.

### 5) Ethics-only MVP guardrails

- Apply retrieval/domain filters so MVP remains ethics-scoped.
- Keep UX minimal: no additional pages or major UI expansions.

---

## Additional Google Cloud services to include

These are included in the migration roadmap and can be phased without blocking MVP:

1. **Cloud Storage**
   - Persist source artifacts and ingestion intermediates.
   - Reduce dependency on local file persistence.

2. **Cloud Run Jobs + Cloud Scheduler**
   - Automate ingestion runs on schedule.
   - Replace manual triggering where appropriate.

3. **Document AI (PDF parsing path)**
   - Improve extraction quality for complex PDF sources.
   - Use as optional parsing path for noisy documents.

4. **BigQuery analytics (optional, phase-aligned)**
   - Track query metadata, cache hit rates, and cost/latency trends.

5. **Vertex grounding/tooling (optional)**
   - Explore grounded synthesis mode for future reliability uplift.

---

## Execution prompts (copy/paste)

### Prompt A — Runtime migration (Vertex + Vercel AI SDK)

Migrate runtime reasoning from Anthropic SDK to Vertex AI via Vercel AI SDK, without changing ingestion. Update engine and analyse route streaming internals while preserving existing SSE event contracts (`pass_start`, `pass_chunk`, `pass_complete`, `claims`, `relations`, `metadata`, `error`). Use Gemini 2.5 Pro for three-pass reasoning and Gemini 2.5 Flash for structured extraction after each pass. Keep continuation behavior equivalent to current implementation.

### Prompt B — References/sources capture and display fix

Fix references and sources capture/display so Sources view is driven by real retrieval data. Emit a dedicated `sources` SSE event with canonical source metadata from retrieval, wire it through conversation store handling, and render it in Sources view. Keep existing Claims view behavior, and ensure extraction failures do not silently result in empty, ambiguous UI states.

### Prompt C — History replay without re-querying

Implement query replay caching so selecting a previous query does not re-run the engine. Add server-side cache keyed by normalized query hash and store replayable payloads. On request, serve cached replay when present; otherwise run engine and persist result. Update history selection flow to replay local cached payload first, falling back to server cache path.

### Prompt D — GCP service enablement package

Add phased integrations for Cloud Storage artifact persistence, Cloud Run Jobs + Cloud Scheduler ingestion automation, optional Document AI parsing path, and optional BigQuery telemetry writes. Keep all new integrations feature-flagged and non-breaking to current runtime behavior.

### Prompt E — MVP ethics scope enforcement

Constrain MVP runtime and retrieval behavior to ethics domain only, with minimal UX impact and no additional pages. Preserve existing user flows while ensuring domain filters and provenance are consistently applied.

### Prompt F — Pass-by-pass visualization with graph context

Implement high-fidelity pass visualization with hybrid graph-circle representation, background pass refinement, WCAG 2.2 AA compliance, and randomized example prompts. Add graph snapshot SSE event that projects retrieval results (sources, claims, relations) into node/edge format. Create GraphCanvas component with orbital layout, two-click interaction (highlight→detail), full keyboard navigation, and ARIA labels. Add pass refinement gate that structures raw pass text into sections, enforces 1000-word hard cap, and emits pass_structured events. Audit and fix contrast violations in design-tokens.css. Replace hardcoded example prompts with randomized pool of 20 ethics questions. Ensure all animations respect prefers-reduced-motion.

---

## Verification checklist

- Repeated query returns from cache/replay path and does not invoke full 3-pass inference.
- Sources panel shows canonical source metadata from retrieval.
- References panel remains stable if extraction step partially fails.
- Runtime three-pass stream still works end-to-end with unchanged event contract.
- MVP remains ethics-only in retrieval behavior.
- GCP optional services are integrated behind flags and do not break baseline flow.
- Graph visualization appears during streaming with correct node/edge counts.
- Pass refinement limits each pass to ≤1000 words.
- All text meets WCAG 2.2 AA contrast requirements (4.5:1 or 3:1 for large).
- Example prompts randomize on each page load.
- Keyboard navigation and screen reader support functional.

---

## MVP+1 carry-forward

- Migrate ingestion architecture to Vertex-native flow.
- Revisit embedding strategy for a clean, single-space migration.
- Expand beyond ethics into the next philosophical domain using the new ingestion stack.
