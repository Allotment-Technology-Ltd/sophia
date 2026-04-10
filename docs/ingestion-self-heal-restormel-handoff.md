# Ingestion self-heal — Restormel upstream handoff (when needed)

Sophia implements self-healing ingestion **locally**:

- Structured `[INGEST_SELF_HEAL]` log lines and issue kinds (`recovery_agent`, `circuit_open`, `stage_health_bump`).
- Optional **recovery agent** (`INGEST_RECOVERY_AGENT=1`) using `resolveReasoningModelRoute` in [`src/lib/server/vertex.ts`](../src/lib/server/vertex.ts) with bounded JSON actions only.
- **Stage-scoped** LLM health in Neon (`ingest_llm_stage_model_health`) plus global `ingest_llm_model_health`.
- **Soft circuit breaker** per process (`INGEST_CIRCUIT_FAILURE_THRESHOLD`).

## When to involve Restormel Keys

Per [`.cursor/rules/restormel-integration-upstream-first.mdc`](../.cursor/rules/restormel-integration-upstream-first.mdc), open a Restormel change **only if**:

- Shared **cross-product** “blocked model” or **stage policy** must live in the control plane (not only Sophia’s DB), **and**
- The behavior should be documented in **Dashboard/OpenAPI** for other integrators.

Until then, keep routing policy in Sophia (catalog merge, env, Neon health tables) and avoid undocumented Restormel mutations.

## Relay

Operator feedback for the Keys product can be filed via the Sophia dogfood relay ([`docs/restormel-dogfood-relay.md`](restormel-dogfood-relay.md)) with label `restormel-feedback`.
