# Phase 1 Closeout Baseline (2026-03-12)

## Scope

This checkpoint locks the post-hardening state for Phase 1 ingestion integrity on production SurrealDB.

Hardening actions executed:

- Legacy required-field normalization for claims (`claim_origin`, `claim_scope`, review/verification defaults)
- Claim-to-passage linkage backfill for all records missing `passage`
- Accepted-claim verification-state migration (`unverified` -> `validated`) for claims passing provenance/linkage gates
- Phase 1 closeout audit/gates rerun

## Final Gate Results

All Phase 1 closeout gates are passing.

- `source_integrity_no_claim_without_passage`: PASS
  - `claims_without_passage=0`, `total_sources=48`
- `claim_span_attachment_on_promoted`: PASS
  - `promoted_with_span=3274/3274 (100.00%)`
- `promoted_claim_unverifiable_rate`: PASS
  - `unverifiable_promoted=0/3274 (0.00%)`
- `trusted_relation_partition_no_legacy_edges`: PASS
  - `accepted_refines=0`, `accepted_exemplifies=0`
- `promotion_rules_claims`: PASS
  - `accepted_claim_violations=0`
- `promotion_rules_relations`: PASS
  - `accepted_relation_blockers=0`
- `low_confidence_relations_not_accepted`: PASS
  - `low_confidence_accepted_relations=0` (threshold `0.78`)
- `audit_trail_present`: PASS
  - `review_audit_log_rows=4`

## Baseline Notes

- Phase 1 trusted/staging promotion rules are now enforced with clean state defaults.
- Relation trust partition is preserved (no accepted legacy `refines`/`exemplifies` edges in trusted layer).
- This baseline should be treated as the rollback/compare point before Phase 2 changes.
