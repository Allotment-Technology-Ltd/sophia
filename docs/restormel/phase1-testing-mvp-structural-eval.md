# Phase 1 — Restormel Testing MVP (structural, no LLM)

**Goal:** Give integrators a **deterministic** evaluation and regression path that does not depend on Vertex, AAIF, or LLM-as-judge. This is the lowest-friction “Restormel Testing” story alongside optional rubric scoring in SOPHIA.

## Packages (current SOPHIA workspace)

| Capability | Package | Entry |
|------------|---------|--------|
| Structural graph evaluation | `@restormel/graph-reasoning-extensions` (npm) | `/evaluation` → `evaluateReasoningGraph` |
| Reasoning snapshot diff | same | `/compare` → `diffReasoningSnapshots` |
| Input type | `@restormel/contracts` | `/reasoning-object` → `ReasoningObjectSnapshot` |

## `evaluateReasoningGraph`

- **Input:** `Pick<ReasoningObjectSnapshot, 'graph' | 'outputs'>` (see Restormel Keys [`packages/graph-reasoning-extensions/src/evaluation.ts`](https://github.com/Allotment-Technology-Ltd/restormel-keys/tree/main/packages/graph-reasoning-extensions/src/evaluation.ts)).
- **Output:** `ReasoningGraphEvaluationResult` — summary counts + structured **findings** (unsupported claims, missing evidence, etc.).
- **Use cases:** CI gate on snapshot fixtures, pre-publish checks on compiled reasoning objects, dashboard “health” without calling a model.

## Cross-run comparison

- Build **two** `ReasoningObjectSnapshot` instances (e.g. baseline vs candidate route).
- Run **`diffReasoningSnapshots`** from `@restormel/graph-reasoning-extensions/compare` (see [`src/lib/graph-kit/state/compare.ts`](../../src/lib/graph-kit/state/compare.ts)).
- Map diff result to UI or report markdown (SOPHIA workspace already consumes this shape).

## Scriptable regression (SOPHIA today)

- **With/without graph context (LLM-heavy):** [`scripts/test-with-without-graph.ts`](../../scripts/test-with-without-graph.ts) — not part of this MVP; keep as optional quality gate.
- **Structural-only path:** extend [`src/lib/restormel/graph-reasoning-extensions-smoke.test.ts`](../../src/lib/restormel/graph-reasoning-extensions-smoke.test.ts) or add fixtures beside it; upstream tests live in Restormel Keys.

## When Restormel owns the package

SOPHIA pins **`@restormel/graph-reasoning-extensions`** in root `package.json`. Semver is **independent** of `@restormel/graph-core` Contract v0 — see [graph-reasoning-extensions-versioning.md](./graph-reasoning-extensions-versioning.md).

## Related

- [Phase 1 RunTrace / ReasoningEvent checklist](./phase1-run-trace-emitter-checklist.md)
- [Restormel Graph — SOPHIA extraction artefacts](./04-delivery/restormel-graph-sophia-extraction-artifacts.md)
