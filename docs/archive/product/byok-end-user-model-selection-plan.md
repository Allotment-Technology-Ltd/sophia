---
status: superseded
owner: adam
source_of_truth: false
replaced_by: docs/sophia/current-state.md
last_reviewed: 2026-03-13
---

> Superseded during the 2026-03-13 documentation rationalisation. Use docs/sophia/current-state.md for the current product/runtime view.

# BYOK End-User Model Selection Plan

**Status:** Planned backlog item (post-provider-integration optimization stream)  
**Scope:** Documentation only; no implementation changes in this document

---

## Context and Goal

Define the target-state model-selection strategy for end users running SOPHIA's three-pass dialectical flow via `/api/analyse`.

The plan focuses on:
- Better default model outcomes for real user questions.
- Clear tradeoff handling across quality, speed, and cost.
- Deterministic fallback behavior when providers/models fail.
- Rollout gates that prevent regressions.

This is a backlog strategy document. It does not change current runtime contracts or routing behavior.

---

## Decision Model: Tiered Presets

Use three user-facing model profiles:
- `balanced`
- `quality`
- `fast`

Rationale:
- End users have materially different priorities.
- A single universal model default underperforms across all use-cases.
- Presets keep UX simple while still allowing advanced overrides.

Default preset for new users: `balanced`.

---

## Recommended Default Stack

### `balanced`
- `gemini-2.5-flash`
- `gpt-4.1-mini`
- `claude-sonnet-4.6`

### `quality`
- `claude-sonnet-4.6`
- `gpt-4.1`
- `gemini-2.5-pro`

### `fast`
- `gemini-2.5-flash-lite`
- `mistral-small-latest`
- `deepseek-chat`

Each list is ordered primary to final fallback.

---

## Selection and Fallback Policy (Planned)

- Select model chain from preset first.
- If user explicitly sets provider/model, explicit override wins.
- Fail over to next model when provider/model is unavailable.
- Fail over to next model when a pass times out.
- Fail over to next model on transient 5xx errors.
- Fail over to next model on throttling/rate-limit responses when retry budget is exhausted.
- Keep per-pass retry caps and pass-specific timeout budgets.
- Emit structured telemetry for every fallback decision and reason.

---

## Public API and Interface Notes (Backlog, Not Implemented)

Planned additive request metadata:
- `model_profile: balanced|quality|fast`
- Extended provider union beyond `auto|vertex|anthropic`

Planned additive `/api/models` capability tags:
- `cost_tier`
- `latency_tier`
- `quality_tier`
- `recommended_profiles`

These are target-state backlog interfaces only and should not be treated as currently shipped runtime contracts.

---

## Evaluation Gates

A model/preset change is promotable only if all gates pass on the SOPHIA benchmark suite:
- Quality gate: no regression on argument structure, counterargument coverage, synthesis coherence, and philosophical grounding.
- Latency gate: p95 latency remains within agreed depth-mode envelopes (`quick`, `standard`, `deep`).
- Cost gate: cost-per-run remains within product budget bands for the preset.
- Reliability gate: fallback rate and hard-failure rate stay within agreed incident thresholds.

---

## Rollout Phases

1. Offline benchmark and ranking on fixed prompt set.
2. Shadow routing (`would-have-selected`) with no user-visible behavior change.
3. Canary rollout to a limited traffic cohort.
4. Full rollout after canary stability and gate pass confirmation.

---

## Dependency Note

If full multi-provider BYOK support is not merged in the active branch/environment, execute Phase 0 first:
- widen provider/type unions across API, UI, telemetry, and history surfaces,
- update runtime routing and model catalog exposure,
- preserve backward compatibility for existing `auto|vertex|anthropic` requests.

Only then proceed with preset-driven selection rollout.

---

## Assumptions and Defaults

- Docs-only backlog planning step; no code changes.
- Strategy is target-state guidance for multi-provider BYOK environments.
- Default preset remains `balanced` until benchmark evidence justifies a change.
