# Phase 1 extraction — status and doc index (SOPHIA)

**Phase 1 consumer integration:** **Complete** — SOPHIA depends on npm **`@restormel/contracts`** (`^0.1.0`), **`@restormel/observability`** (`^0.1.1`), **`@restormel/graph-core`** (`^0.1.1`), **`@restormel/ui-graph-svelte`** (`^0.1.1`), and **`@restormel/graph-reasoning-extensions`** (`^0.1.0`). Local `packages/contracts`, `packages/observability`, and `packages/graph-reasoning-extensions` were **removed** to avoid shadowing npm.

**Vite / SvelteKit:** only **`@restormel/aaif`** remains workspace-aliased to `packages/aaif` (not yet on npm).

## Document index

| Document | Purpose |
|----------|---------|
| [phase1-restormel-engineering-spec.md](./phase1-restormel-engineering-spec.md) | Historical package matrix and acceptance criteria (Restormel Keys is source of truth) |
| [phase1-agent-prompt-restormel-engineering.md](./phase1-agent-prompt-restormel-engineering.md) | Prompt used for Restormel publish (archived reference) |
| [phase1-run-trace-emitter-checklist.md](./phase1-run-trace-emitter-checklist.md) | `ReasoningEvent` → `RunTrace` emitter obligations |
| [phase1-testing-mvp-structural-eval.md](./phase1-testing-mvp-structural-eval.md) | Deterministic `evaluateReasoningGraph` + snapshot diff MVP |
| [graph-reasoning-extensions-versioning.md](./graph-reasoning-extensions-versioning.md) | Extensions semver vs Contract v0 |
| [04-delivery/restormel-graph-sophia-extraction-artifacts.md](./04-delivery/restormel-graph-sophia-extraction-artifacts.md) | File map, adapter `graphDataFromSophiaGraphKit`, portability QA |
| [04-delivery/restormel-graph-core-observability-extraction-note.md](./04-delivery/restormel-graph-core-observability-extraction-note.md) | graph-core vs observability split |

## SOPHIA consumer tests (npm)

| File | Role |
|------|------|
| [`src/lib/restormel/contracts-schema.test.ts`](../../src/lib/restormel/contracts-schema.test.ts) | Zod / schema parity with `@restormel/contracts` |
| [`src/lib/restormel/observability-consumer.test.ts`](../../src/lib/restormel/observability-consumer.test.ts) | Trace round-trip + normalizers |
| [`src/lib/restormel/graph-reasoning-extensions-smoke.test.ts`](../../src/lib/restormel/graph-reasoning-extensions-smoke.test.ts) | `evaluateReasoningGraph` smoke |

## Next action (ongoing)

- Bump **`^0.1.x`** when Restormel publishes fixes; watch **`RESTORMEL_CONTRACTS_SCHEMA_VERSION`** in release notes.
- Phase 2 (optional): extract context packs to a shared package per roadmap.
