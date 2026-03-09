# Phased Plan (Proposed): Two-Speed Link Analysis + Nightly Ingestion + Harvard Referencing

**Status:** Proposed (documentation sync only)
**Last updated:** 2026-03-09
**Scope:** Consumer `/api/analyse` path only (no `/api/v1/verify` request-schema change)

## Objectives
- Keep user-facing analysis fast when user links are supplied.
- Defer heavy ingestion work to a nightly batch pipeline.
- Expand corpus quality over time via approved user and grounding links.
- Standardize final scholarly attribution with Harvard-style references in Synthesis and Verification outputs.

## Non-Goals
- No behavior change is shipped in this document pass.
- No private per-user graph partition in v1.
- No OCR pipeline for image-only/scanned PDFs in v1.
- No change to `/api/v1/verify` request body in this proposal.

## Proposed Phases

### Phase 1: Fast Runtime Link Intake
- Add request fields to consumer analyse flow:
  - `resource_mode?: 'standard' | 'expanded'`
  - `user_links?: string[]` (max 5)
  - `queue_for_nightly_ingest?: boolean` (explicit per-query opt-in)
- Runtime behavior:
  - Validate/canonicalize URLs; block unsafe targets (SSRF controls).
  - Do lightweight extraction for immediate context only.
  - Continue analysis even if some links fail extraction.
- Metadata additions (proposed):
  - `resource_mode`, `user_links_count`, `runtime_links_processed`, `nightly_queue_enqueued`.

### Phase 2: Deferred Ingestion Queue
- Add a queue table for deferred ingestion entries.
- Queue policy:
  - If user opts in, enqueue both user-supplied links and grounding links from that run.
- Queue status lifecycle:
  - `queued` -> `pending_review`/`approved` -> `ingesting` -> `ingested` | `failed` | `rejected`.
- Dedupe/idempotency:
  - Upsert by canonical URL hash; track provenance counters instead of duplicating rows.

### Phase 3: Nightly Cloud Run Job + Scheduler @ 02:00 UTC
- Add a dedicated nightly ingestion job that processes approved queue entries.
- Add Cloud Scheduler trigger at 02:00 UTC daily.
- Worker responsibilities:
  - Pull queued records in bounded batches.
  - Fetch and stage source text/meta.
  - Run full ingestion pipeline.
  - Persist status, retries, and error telemetry.

### Phase 4: Harvard Referencing in Synthesis + Verification
- Enforce output policy in Synthesis and Verification:
  - In-text citations in author-year form.
  - Terminal `## References (Harvard)` section.
- Keep Analysis/Critique unchanged for this phase.
- Add guardrail behavior:
  - If references section is missing, append a normalized Harvard references block.

### Phase 5: Governance, Observability, and Rollout
- Global ingestion scope with tiered allowlist:
  - Trusted domains auto-approved.
  - Non-trusted domains go to manual review.
- Add admin review controls for pending domains/links.
- Rollout with feature flags and kill-switches.
- Track reliability/cost/latency metrics and failure thresholds.

## Proposed API Contract Deltas

### Analyse Request (consumer)
```json
{
  "query": "...",
  "resource_mode": "expanded",
  "user_links": ["https://example.edu/paper"],
  "queue_for_nightly_ingest": true
}
```

### Analyse Metadata Event (additive)
```json
{
  "resource_mode": "expanded",
  "user_links_count": 3,
  "runtime_links_processed": 2,
  "nightly_queue_enqueued": 6,
  "citation_style": "harvard"
}
```

## Feature Flags (Proposed)
- `ENABLE_USER_LINK_INPUT`
- `ENABLE_EXPANDED_RESOURCE_INTAKE`
- `ENABLE_NIGHTLY_LINK_INGESTION`
- `ENABLE_HARVARD_REFERENCING`

## Rollout Gates (Proposed)
- Runtime p95 latency increase remains within budget (defined by ops).
- Nightly ingestion failure rate below threshold for 7 consecutive runs.
- Queue backlog remains below alert threshold.
- Manual review SLA maintained for non-trusted domains.

## Risks and Rollback
- Risk: queue explosion from low-quality links.
  - Mitigation: per-query caps, dedupe, allowlist, review gate.
- Risk: ingestion cost spikes.
  - Mitigation: batch caps, retry caps, per-run budget guard.
- Risk: citation format inconsistency.
  - Mitigation: prompt constraints + post-generation references guardrail.
- Rollback:
  - Disable flags; keep core analysis path unchanged.
  - Pause scheduler while preserving queue state.

## Acceptance Criteria
- Runtime analyses remain fast and resilient with link input.
- Nightly job processes queued links end-to-end with status tracking.
- Trusted domains auto-flow; non-trusted domains require review.
- Synthesis and Verification outputs include Harvard-style references.
- All docs reflect proposal state consistently.

## Prompt Pack

### 1) Runtime Path Prompt
**Goal:** Implement fast user-link handling without full ingestion in request path.

```text
Implement consumer /api/analyse support for resource_mode, user_links, and queue_for_nightly_ingest.

Touch points:
- src/lib/types/api.ts
- src/lib/stores/conversation.svelte.ts
- src/routes/api/analyse/+server.ts
- src/routes/+page.svelte

Constraints:
- Max 5 links.
- SSRF-safe URL validation.
- Lightweight extraction only in request path.
- If extraction fails for a link, continue analysis.
- Additive metadata fields only.

Done criteria:
- New request fields validated.
- Runtime uses available link context.
- Metadata contains queue/runtime counters.
- Existing behavior unchanged when no links are provided.
```

### 2) Queue Schema Prompt
**Goal:** Add deferred ingestion queue with idempotent URL upsert and status lifecycle.

```text
Add a deferred link ingestion queue schema and queue-write flow.

Touch points:
- scripts/setup-schema.ts
- src/routes/api/analyse/+server.ts
- src/lib/server/db.ts (helpers only if needed)

Constraints:
- Upsert by canonical URL hash.
- Track submitted_by_uid, query_run_id, source_kind, status, attempt_count.
- Status lifecycle: queued/pending_review/approved/ingesting/ingested/failed/rejected.

Done criteria:
- Queue records created only when queue_for_nightly_ingest=true.
- Duplicate URLs do not create duplicate rows.
- Provenance counters update correctly.
```

### 3) Nightly Worker Prompt
**Goal:** Build a nightly queue processor that performs full ingestion.

```text
Create a nightly ingestion worker for approved queue entries.

Touch points:
- scripts/ingest-nightly-links.ts (new)
- scripts/fetch-source.ts (reuse)
- scripts/ingest.ts (reuse, no breaking changes)

Constraints:
- Batch size and retry caps from env vars.
- Mark statuses and errors per item.
- Continue batch on per-item failure.

Done criteria:
- Worker can process approved queue rows end-to-end.
- Status updates reflect success/failure/retry.
- Summary logs emitted for operations.
```

### 4) Infra Scheduler Prompt
**Goal:** Trigger nightly worker via Cloud Scheduler at 02:00 UTC.

```text
Provision Cloud Run Job + Cloud Scheduler trigger for nightly link ingestion.

Touch points:
- infra/index.ts
- infra/Pulumi.production.yaml
- docs/runbooks/nightly-link-ingestion-runbook.md

Constraints:
- Schedule exactly 02:00 UTC daily.
- Least-privilege IAM for scheduler invocation.
- Keep existing ingest job untouched.

Done criteria:
- Pulumi preview shows new job/scheduler/IAM resources.
- Runbook includes execute/pause/resume commands.
```

### 5) Harvard Prompt Update
**Goal:** Apply Harvard references policy to Synthesis and Verification only.

```text
Update prompt instructions and output guardrails for Harvard references.

Touch points:
- src/lib/server/prompts/synthesis.ts
- src/lib/server/prompts/verification.ts
- docs/prompts-reference.md

Constraints:
- Enforce in-text author-year citations.
- Require `## References (Harvard)` section.
- Do not change analysis/critique format policy.

Done criteria:
- Synthesis/Verification outputs include Harvard section reliably.
- Additive changes only; no schema breaks.
```

### 6) QA/Regression Prompt
**Goal:** Add focused tests and verify docs consistency.

```text
Add tests for runtime link intake, queue behavior, nightly worker, and citation formatting.

Touch points:
- src/lib/server/routes/analyse-route.test.ts
- new tests for queue/worker modules
- docs consistency checks via scripts/review-docs.sh --strict

Constraints:
- Do not weaken existing tests.
- Validate proposal constants: 02:00 UTC, user+grounding queue scope, global+allowlist ingestion, Harvard scope.

Done criteria:
- New tests pass.
- Strict docs review passes.
- No unrelated file changes.
```

## Notes
- This document is intentionally proposal-focused.
- Implementation should update status from "Proposed" to "In progress" and "Implemented" as work lands.
