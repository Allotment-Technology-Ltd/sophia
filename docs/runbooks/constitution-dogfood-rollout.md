# Constitution Dogfood Rollout

## Purpose

Roll out constitution evaluation into consumer analysis safely while keeping latency and cost within budget.

## Feature flag

- Flag: `ENABLE_CONSTITUTION_IN_ANALYSE`
- Default: `false`
- Rollback: set `ENABLE_CONSTITUTION_IN_ANALYSE=false` and redeploy

## Rollout stages

1. Stage 0: Flag off in production, validate in local/staging.
2. Stage 1: Enable for 10% canary traffic (or one canary revision).
3. Stage 2: Increase to 50% if budgets hold for 24h.
4. Stage 3: 100% rollout after 7 stable days.

## Guardrails

- Latency budget:
  - `constitution_duration_ms` p95 <= 2500 ms
  - End-to-end analysis p95 increase <= 15%
- Cost budget:
  - `constitution_input_tokens + constitution_output_tokens` mean <= 1200 tokens/request
  - No more than 20% cost increase per analysis request
- Quality budget:
  - `constitution_rule_violations` distribution should be stable week-over-week (no abrupt spikes without model/prompt changes)

## Required telemetry fields

- `constitution_duration_ms`
- `constitution_input_tokens`
- `constitution_output_tokens`
- `constitution_rule_violations`

## Suggested Cloud Logging query

```text
resource.type="cloud_run_revision"
jsonPayload.message:"[CONSTITUTION][ANALYSE]"
```

## Rollback criteria

- Two consecutive 15-minute windows exceeding latency budget
- Daily cost budget exceeded by >20%
- Error spike tied to constitution evaluation path

If any trigger fires:

1. Disable the flag.
2. Redeploy.
3. Capture before/after metrics.
4. File follow-up issue with request IDs and logs.
