# Agent prompt — Restormel Graph, trace, and contracts (for Restormel engineering)

Copy everything below the line into your Restormel Keys / platform agent or ticket.

---

You are implementing the **Restormel platform packages** that the SOPHIA reference app consumes for **graph rendering**, **run trace assembly**, and **shared contracts**. SOPHIA has already aligned its codebase to this architecture; your job is to **own and publish** these packages from the Restormel monorepo so consumers can **pin semver** and reintegrate without copying SOPHIA source.

## Objectives

1. **Contracts (`@restormel/contracts`)**  
   - Publish types and Zod schemas for: `ReasoningEvent`, `RunTrace`, `SSEEvent`, trace-ingestion normalisation types, `ReasoningObjectSnapshot` and related diff/eval DTOs, `RESTORMEL_CONTRACTS_SCHEMA_VERSION`.  
   - Preserve **export subpaths** used by consumers (e.g. `@restormel/contracts/trace`, `@restormel/contracts/api`, `@restormel/contracts/reasoning-object`, `@restormel/contracts/trace-ingestion`, `@restormel/contracts/schema-version`).  
   - Any change to `RESTORMEL_CONTRACTS_SCHEMA_VERSION` must ship with migration notes for persisted traces.

2. **Observability (`@restormel/observability`)**  
   - Implement **pure** helpers: `eventsToTrace`, `traceToEvents`, and the normalizers that turn producer-specific event streams into canonical `RunTrace` / reasoning-object timelines.  
   - **No** trace storage, **no** dashboard — only library functions.  
   - Declare compatible `@restormel/contracts` peer or direct dependency range.

3. **Graph Contract v0 (`@restormel/graph-core`)**  
   - Freeze **DTO-only** `GraphData` / node / edge / ghost / viewport types per **Contract v0** (no imports from `@restormel/contracts` in the v0 surface).  
   - Ship layout, trace label, and workspace-style helpers required by the Svelte canvas.  
   - Version **independently** from reasoning-heavy packages.

4. **UI (`@restormel/ui-graph-svelte`)**  
   - Ship `GraphCanvas`, `NodeDetail`, semantic styling helpers, and `styles.css` so apps can render `GraphData` with parity to SOPHIA’s `/dev/graph-portability` page.

5. **Reasoning extensions (`@restormel/graph-reasoning-extensions` or agreed name)**  
   - **Lift** implementation from the SOPHIA repo package `packages/graph-reasoning-extensions`: `compare` (`diffReasoningSnapshots`), `diff`, `evaluation` (`evaluateReasoningGraph`), `lineage`, `projection`, `summary`.  
   - Depends on `@restormel/contracts` (including `reasoning-object`).  
   - **Semver is independent** of graph-core Contract v0 — do not tie major bumps together.  
   - Port tests; CI must run them on publish.

## Acceptance criteria

- A minimal **external** Svelte app can depend only on `@restormel/graph-core` + `@restormel/ui-graph-svelte` + mock `GraphData` and pass interaction smoke (pan, zoom, select).  
- A **Node** script can build `ReasoningEvent[]`, call `eventsToTrace`, and round-trip with `traceToEvents`.  
- `evaluateReasoningGraph` and `diffReasoningSnapshots` run on fixture `ReasoningObjectSnapshot` JSON without LLM calls.  
- Release notes list **breaking** contract or export-path changes and the new schema version if applicable.

## Non-goals

- Do not rebuild SOPHIA’s Surreal retrieval, ingestion CLI, or dialectical engine.  
- Do not merge reasoning-extensions into Contract v0.  
- Do not ship a generic observability platform — only trace **shaping** libraries.

## Reference (SOPHIA — read-only spec)

Use the SOPHIA repository as **behavioural spec** for the app shell: `docs/restormel/phase1-restormel-engineering-spec.md`, `docs/restormel/04-delivery/restormel-graph-sophia-extraction-artifacts.md`, `docs/restormel/phase1-run-trace-emitter-checklist.md`, and consumer tests under `src/lib/restormel/*.test.ts`. Canonical package source: Restormel Keys monorepo.

---

_End of prompt._
