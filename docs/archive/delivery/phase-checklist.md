---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# SOPHIA Phase 3b: DB Persistence + Ingestion Checklist

## Infrastructure
- [x] GCE VM (sophia-db) running SurrealDB with persistent storage
- [x] Firewall rules configured (DB port restricted)
- [x] VPC connector created (Cloud Run → GCE internal networking)
- [x] Production schema applied
- [x] DB password in Secret Manager
- [x] Voyage AI key in Secret Manager
- [x] Gemini key in Secret Manager
- [x] deploy.yml updated with all secrets and VPC connector
- [x] Health check endpoint returning source/claim/argument counts
- [x] Backup script tested

## Wave 1 Ingestion (8 foundational sources)
- [x] All 8 sources fetched to data/sources/
- [x] Batch ingestion run with --validate flag
- [ ] Ingestion log shows all 8 complete _(ingestion_log table created in Phase 3b; Wave 1 pre-dates it — run `setup-ingestion-log.ts` then verify, or re-ingest with --retry to populate log)_
- [ ] Quality report generated _(run: `npx tsx --env-file=.env scripts/quality-report.ts --all`)_
- [x] Spot-check: ≥10 claims per source reviewed manually
- [x] Accuracy ≥80% on spot-checked claims
- [x] Prompt adjustments documented in tuning log _(accuracy gate passed; no adjustments required)_
- [x] Backup taken after Wave 1

## Wave 1 Prompt Tuning (if accuracy < 80%)
> **N/A** — Phase 3a spot-check confirmed accuracy >80%. Prompt tuning loop was not required.

- [x] Error patterns identified _(none — accuracy gate passed)_
- [x] Extraction prompt updated _(no changes required)_
- [x] Re-run failed/low-quality sources _(no failures)_
- [x] Re-spot-check shows improvement _(not applicable)_

## Wave 2 Ingestion (10 sources)
- [ ] All 10 sources fetched
- [ ] Batch ingestion run (with updated prompts from Wave 1 tuning)
- [ ] Spot-check 10% of claims
- [ ] Quality report shows no regression
- [ ] Backup taken after Wave 2

## Wave 3 Ingestion (11 sources)
- [ ] All 11 sources fetched
- [ ] Batch ingestion run
- [ ] Full Gemini validation on all 29 sources
- [ ] Quarantined items reviewed manually
- [ ] Backup taken after Wave 3

## Retrieval Validation
- [ ] Retrieval test: ≥7/10 ethics queries return GOOD context
- [ ] Non-ethics queries correctly return EMPTY (expected)
- [ ] Graph traversal working: trolley problem retrieves Foot + DDE + utilitarian counterargs

## Quality Gate (ALL must pass)
- [ ] Three-pass with graph beats without on ≥6/10 test cases
- [ ] Total claims in graph: >200 (across 29 sources)
- [ ] Total named arguments: >30
- [ ] Cross-argument traversal verified
- [ ] Production deployment updated and health check green
- [ ] Backup of complete knowledge base stored

## Production Deploy
- [ ] App redeployed with DB connection
- [ ] Health check on production returns 'healthy' with correct counts
- [ ] Live test: submit ethics query on production URL, verify graph context appears in output
