---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Supporting operational reference only.

# Vertex Ingestion Cutover Runbook (PoM Wave 2 Cost Validation)

**Version:** 1.0.0  
**Last updated:** 2026-03-10  
**Scope:** Operational validation for direct ingestion migration to Vertex (no A/B pilot)

---

## Purpose

Use **Philosophy of Mind Wave 2** as the first post-cutover test run for Vertex ingestion.

This runbook defines how to:

1. execute Wave 2 ingestion under Vertex-default extraction,
2. compute **average cost per ingestion** for PoM Wave 2,
3. compare against the **PoM Wave 1** baseline from previous ingestion runs.

---

## Inputs and assumptions

- Source list: `data/source-list-pom.json`
- Domain: `philosophy_of_mind`
- Baseline for comparison: PoM sources with `wave = 1`
- Test set: PoM sources with `wave = 2`
- Cost metric: `ingestion_log.cost_usd` for `status = 'complete'`
- No archive docs are modified by this process.

---

## Step 1: Prepare database access

Use the production DB tunnel workflow from the domain expansion runbook.

```bash
gcloud compute ssh sophia-db \
  --zone=europe-west2-b \
  --project=sophia-488807 \
  --tunnel-through-iap \
  -- -L 8800:localhost:8000 -N
```

```bash
gcloud secrets versions access latest \
  --secret="surreal-db-pass" \
  --project=sophia-488807
```

---

## Step 2: Run PoM Wave 2 ingestion (Vertex cutover run)

Run Wave 2 ingestion for Philosophy of Mind:

```bash
SURREAL_URL=http://localhost:8800 \
SURREAL_USER=root \
SURREAL_PASS='<password>' \
npx tsx --env-file=.env --env-file=.env.local scripts/ingest-batch.ts \
  --source-list data/source-list-pom.json \
  --wave 2 \
  --ingest-provider vertex \
  --domain philosophy_of_mind \
  --yes
```

Validation policy for this cutover:

- Do **not** run cross-model validation by default (skip `--validate`) to keep Vertex cost measurement clean.
- Use `--validate` only for explicit spot-check runs.

Provider note:

- `vertex` is the default ingestion provider.
- `anthropic` remains available as manual rollback only (`--ingest-provider anthropic`).

---

## Step 3: Build Wave 1 and Wave 2 URL sets

List URLs used for each wave from `data/source-list-pom.json`:

```bash
jq -r '.[] | select(.domain=="philosophy_of_mind" and .wave==1) | .url' data/source-list-pom.json
```

```bash
jq -r '.[] | select(.domain=="philosophy_of_mind" and .wave==2) | .url' data/source-list-pom.json
```

Copy each set into a SurrealQL array literal for the next step.

---

## Step 4: Compute average cost per ingestion

Run the following query twice: once for Wave 1 URLs and once for Wave 2 URLs.

```bash
curl -s -X POST http://localhost:8800/sql \
  -H "Content-Type: text/plain" \
  -H "Accept: application/json" \
  -u "root:<password>" \
  -H "surreal-ns: sophia" \
  -H "surreal-db: sophia" \
  -d "SELECT count() AS completed_sources, math::sum(cost_usd) AS total_cost_usd, math::mean(cost_usd) AS avg_cost_usd FROM ingestion_log WHERE status = 'complete' AND cost_usd IS NOT NONE AND source_url INSIDE [\"<url1>\",\"<url2>\",\"<url3>\"] GROUP ALL;"
```

Record:

- `completed_sources`
- `total_cost_usd`
- `avg_cost_usd`

---

## Step 5: Calculate cost delta

Use:

- `wave1_avg` = PoM Wave 1 `avg_cost_usd`
- `wave2_avg` = PoM Wave 2 `avg_cost_usd`

Formulas:

- `delta_avg_usd = wave2_avg - wave1_avg`
- `percent_change = ((wave2_avg - wave1_avg) / wave1_avg) * 100`

Interpretation:

- Negative `delta_avg_usd` or negative `percent_change` means Wave 2 average cost is lower than baseline.

---

## Reporting template

Use this table in status updates:

| Wave | Completed sources | Total cost (USD) | Avg cost per ingestion (USD) |
| --- | --- | --- | --- |
| PoM Wave 1 (baseline) | `<n1>` | `<sum1>` | `<avg1>` |
| PoM Wave 2 (Vertex test) | `<n2>` | `<sum2>` | `<avg2>` |

| Metric | Value |
| --- | --- |
| `delta_avg_usd (wave2 - wave1)` | `<delta>` |
| `percent_change` | `<pct>%` |

---

## Operational notes

- This runbook validates production economics for the migration path; it is not an A/B quality experiment.
- Keep `source_url` lists used in calculations in your execution notes for auditability.
- For quality checks after ingestion, run:

```bash
npx tsx --env-file=.env --env-file=.env.local scripts/quality-report.ts --all
```
