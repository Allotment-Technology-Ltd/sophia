# Ingestion preset evidence (operator)

This doc supports **Phase 1** of ingestion preset tuning: turning `ingestion_run_reports` into actionable signals.

## Prior study (quality baseline)

See **Wave 1 Quality Analysis (Philosophy of Mind)** in [domain-expansion-runbook.md](../reference/operations/runbooks/domain-expansion-runbook.md) — relation density and grouping coverage failures that inform preset floors.

## Firestore shape

Each completed run stores `sourceType`, `pipelinePreset` (budget / balanced / complexity — populated for admin runs started after this field shipped; older rows appear under `unknown` in preset breakdowns), `issueSummary`, and per-issue `issues[]` with `kind` and `stageHint`.

## Admin API aggregation

`GET /api/admin/ingest/analytics?limit=80` returns:

- `byStatus`, `issueKindTotals` (legacy summary)
- `bySourceType` — run counts and issue kinds per `source_type`
- `byPipelinePreset` — same per preset (unknown bucket for older reports)
- `issueKindByStageHint` — nested counts for `kind` → `stageHint` (empty `stageHint` keyed as `none`)

## Interpreting signals (heuristic)

| Pattern | Likely lever |
|--------|----------------|
| Many `retry` + `warning` | Concurrency / rate limits (`ADMIN_INGEST_MAX_CONCURRENT`, `VERTEX_EMBED_BATCH_DELAY_MS`) |
| `json_repair`, `batch_split` | Prompt / batch token pressure; consider balanced+ JSON repair floor or smaller batches |
| `grouping_integrity`, high `group` stageHint | Grouping model tier or prompt; complexity preset |
| `truncation` | max_tokens / model context |
| Low relation density (offline quality report) | Relation stage model tier; see Wave 1 remediation |

## Related

- [ingestion-benchmarks.md](./ingestion-benchmarks.md) — wall time and release-style comparisons
- [docs/sophia/roadmap.md](../sophia/roadmap.md) — deferred stability knobs and golden-set gates
