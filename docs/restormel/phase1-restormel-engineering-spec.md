# Phase 1 — Restormel engineering spec (Graph + Trace + Contracts)

**Status:** Restormel has published **`@restormel/contracts`**, **`@restormel/observability`**, **`@restormel/graph-reasoning-extensions`**, **`@restormel/graph-core`**, and **`@restormel/ui-graph-svelte`**; SOPHIA consumes them from **npm** (see root `package.json`).

**Source of truth for types and implementations:** [Restormel Keys](https://github.com/Allotment-Technology-Ltd/restormel-keys) monorepo (`packages/contracts`, `packages/observability`, `packages/graph-core`, `packages/ui-graph-svelte`, `packages/graph-reasoning-extensions`).

This document remains a **checklist** for platform engineers and for verifying new publishes.

---

## 1. Package matrix

| Package | Published | Semver coupling |
|---------|-----------|-----------------|
| `@restormel/contracts` | Yes | Bump `RESTORMEL_CONTRACTS_SCHEMA_VERSION` only with migration notes |
| `@restormel/observability` | Yes | Document min `@restormel/contracts` version |
| `@restormel/graph-core` | Yes — Contract **v0** in `viewModel.ts` | **Independent** from reasoning-extensions |
| `@restormel/ui-graph-svelte` | Yes | Align with graph-core layout/trace helpers |
| `@restormel/graph-reasoning-extensions` | Yes | **Independent semver** from graph-core v0 ([versioning note](./graph-reasoning-extensions-versioning.md)) |

**Do not** fold `reasoning-object` compare/evaluate into Contract v0; minimal renderers must not take a `@restormel/contracts` dependency.

---

## 2. Contracts — hard requirements

1. **Exports:** `trace`, `trace-ingestion`, `api`, `reasoning-object`, `schema-version`, `verification`, `ingestion`, and other paths SOPHIA imports (see `npm view @restormel/contracts exports`).
2. **`RESTORMEL_CONTRACTS_SCHEMA_VERSION`** — single integer; `RunTrace.schemaVersion` and Zod defaults aligned.
3. **`ReasoningEvent` / `RunTrace`**, **`SSEEvent`**, **trace-ingestion** — live under `packages/contracts` in Restormel Keys.

**Acceptance:** SOPHIA `pnpm vitest run src/lib/restormel/contracts-schema.test.ts` passes against the published version.

---

## 3. Observability — hard requirements

1. **`eventsToTrace` / `traceToEvents`**
2. **Normalizers:** `normalizeRunTrace`, `normalizeSophiaReasoningEvents`, `normalizedTraceToReasoningObjectEvents`
3. **No backend** — pure functions only

**Acceptance:** SOPHIA `pnpm vitest run src/lib/restormel/observability-consumer.test.ts` passes.

---

## 4. Graph-core + UI — hard requirements

1. **Contract v0** — [`GRAPH_CORE_V0_SCOPE.md`](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/packages/graph-core/GRAPH_CORE_V0_SCOPE.md)
2. **`@restormel/ui-graph-svelte`** — `GraphCanvas`, `NodeDetail`, `styles.css`

**Acceptance:** SOPHIA `/dev/graph-portability` and map workspace graph behave correctly.

---

## 5. Reasoning extensions — hard requirements

- Entrypoints: `./compare`, `./diff`, `./evaluation`, `./lineage`, `./projection`, `./summary`
- **Depends on** `@restormel/contracts`

**Acceptance:** SOPHIA `pnpm vitest run src/lib/restormel/graph-reasoning-extensions-smoke.test.ts` passes; product imports use `@restormel/graph-reasoning-extensions/*`.

---

## 6. SOPHIA reintegration checklist (when bumping Restormel packages)

1. Update versions in root **`package.json`** and run **`pnpm install`**.
2. Run **`pnpm check`**, **`pnpm vitest run src/lib/restormel`**, and smoke **UI** graph flows.
3. If **`RESTORMEL_CONTRACTS_SCHEMA_VERSION`** changed: audit SSE persistence and cached traces; see [phase1-run-trace-emitter-checklist.md](./phase1-run-trace-emitter-checklist.md).

---

## 7. Reference docs in SOPHIA

| Doc | Purpose |
|-----|---------|
| [Restormel Graph — SOPHIA extraction artefacts](./04-delivery/restormel-graph-sophia-extraction-artifacts.md) | Adapter `graphDataFromSophiaGraphKit` |
| [Phase 1 RunTrace / ReasoningEvent checklist](./phase1-run-trace-emitter-checklist.md) | Emitter obligations |
| [Phase 1 structural testing MVP](./phase1-testing-mvp-structural-eval.md) | Structural eval + diff |

---

## 8. Agent prompt (archived)

See **[phase1-agent-prompt-restormel-engineering.md](./phase1-agent-prompt-restormel-engineering.md)** — used to drive the Restormel publish; keep for future package additions.
