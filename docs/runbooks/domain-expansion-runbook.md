# Domain Expansion Runbook

**Version:** 0.3.0
**Branch:** `domain-expansion`
**Last updated:** 2026-03-09

This is the canonical operational runbook for adding any new philosophical domain to SOPHIA's knowledge graph. Execute steps in order. Each step has a verification check before proceeding.

---

## Production Database Access

All ingestion runs directly against the production SurrealDB instance on GCE. There is no local Docker database workflow — it was retired after Phase 3e Wave 1.

**Open the IAP SSH tunnel before any ingestion command:**

```bash
gcloud compute ssh sophia-db \
  --zone=europe-west2-b \
  --project=sophia-488807 \
  --tunnel-through-iap \
  -- -L 8800:localhost:8000 -N
```

Leave this terminal open. The tunnel maps `localhost:8800` → production SurrealDB. If it drops, all DB operations will hang until you restart it.

**Get the production DB password:**

```bash
gcloud secrets versions access latest \
  --secret="surreal-db-pass" \
  --project=sophia-488807
```

**All ingestion commands must prefix the DB connection:**

```bash
SURREAL_URL=http://localhost:8800 \
SURREAL_USER=root \
SURREAL_PASS='<password>' \
npx tsx --env-file=.env --env-file=.env.local scripts/ingest-batch.ts ...
```

> **Note on env files:** `ANTHROPIC_API_KEY` lives in `.env.local`; infrastructure vars live in `.env`. Both files must be passed to `npx tsx` so child processes inherit the full environment. The batch script automatically detects and forwards both files to child processes.

**Performance tip:** Install NumPy to improve IAP tunnel TCP throughput:

```bash
pip3 install numpy
```

---

## Prerequisites

Before starting a new domain expansion:

- [ ] IAP SSH tunnel established and tested (curl health check passes — see above)
- [ ] `gcloud` authenticated with access to `sophia-488807`
- [ ] Domain name chosen from `PhilosophicalDomain` type in [src/lib/types/domains.ts](../../src/lib/types/domains.ts)
- [ ] At least 10 sources identified and curated (Step 2 below)
- [ ] `.env` and `.env.local` files present with `ANTHROPIC_API_KEY`, `GOOGLE_VERTEX_PROJECT`

---

## Step 0: Confirm Infrastructure

```bash
# Verify production DB is reachable via tunnel
curl -s -X POST http://localhost:8800/sql \
  -H "Content-Type: text/plain" \
  -H "Accept: application/json" \
  -u "root:<password>" \
  -H "surreal-ns: sophia" \
  -H "surreal-db: sophia" \
  -d "RETURN 1;"
# Expected: [{"result":[1],"status":"OK",...}]

# Verify claim counts by domain
curl -s -X POST http://localhost:8800/sql \
  -H "Content-Type: text/plain" \
  -H "Accept: application/json" \
  -u "root:<password>" \
  -H "surreal-ns: sophia" \
  -H "surreal-db: sophia" \
  -d "SELECT count() FROM claim GROUP ALL; SELECT array::distinct(domain) FROM claim GROUP ALL;"
```

---

## Step 1: Create Source List

**File:** `data/source-list-{domain}.json`

Use the existing `data/source-list-pom.json` as the template. Each entry must include:

```json
{
  "id": 101,
  "title": "Source Title",
  "author": ["Author Name"],
  "year": 1974,
  "url": "https://...",
  "source_type": "paper|book|sep_entry|iep_entry|article",
  "priority": "ESSENTIAL|HIGH|MEDIUM",
  "subdomain": "short-label",
  "wave": 1,
  "domain": "{domain}",
  "notes": "Optional: URL issues, alternatives, pre-scan notes"
}
```

**IDs:** Start from 101+ for each new domain (or use `curate-source.ts` which auto-assigns the next ID).

**Wave 1 target:** 8–12 sources covering the most canonical texts for the domain. Aim for:

- 2–3 ESSENTIAL primary sources (defining papers / canonical texts)
- 3–4 SEP/IEP overview entries (provide broad context for retrieval)
- 2–3 HIGH priority secondary sources or contemporary debates

> **Slug collision warning:** If two sources share the same title (e.g. two "Consciousness" entries), the pipeline will now correctly resolve each by URL. Do not rely on title uniqueness — always verify URLs are distinct.

---

## Step 2: Curate Each Source

Run the automated curation check on each source **before** adding it to the source list:

```bash
npx tsx --env-file=.env --env-file=.env.local scripts/curate-source.ts \
  --url "https://example.com/paper" \
  --title "Paper Title" \
  --author "Author Name" \
  --year 1974 \
  --domain {domain} \
  --source-type paper \
  --wave 1
```

**Checks performed automatically:**

1. URL reachability (HEAD request)
2. PDF detection → blocked (find HTML equivalent)
3. Duplicate detection (URL + title similarity vs. all existing source lists)
4. Token size estimate → warn >100k, block >200k
5. Domain validation against `PhilosophicalDomain` type
6. Low-quality domain blocklist (Wikipedia, Britannica, Reddit, Quora)

On pass, the script outputs a ready-to-paste JSON entry. Copy it into your source list.

**PDF handling:** If the canonical source is only available as PDF, find an HTML equivalent:

- Try [PhilArchive](https://philarchive.org)
- Try [SEP](https://plato.stanford.edu) for overview articles
- Try institutional or personal hosting (e.g. `consc.net` for Chalmers papers)
- Try [Project Gutenberg](https://gutenberg.org) for historical texts

---

## Step 3: Fetch Source Text

Download the HTML text for all locally-missing sources:

```bash
npx tsx --env-file=.env --env-file=.env.local scripts/fetch-source.ts \
  --source-list data/source-list-{domain}.json \
  --wave 1
```

Each source gets:

- `data/sources/{slug}.txt` — cleaned plain text
- `data/sources/{slug}.meta.json` — metadata including domain

Verify files are created:

```bash
ls data/sources/*.txt | wc -l
# Should match number of wave 1 sources
```

---

## Step 4: Pre-Scan Gate

Always run pre-scan before ingestion. It will run automatically as part of `ingest-batch`, but you can run it standalone first to review the cost estimate:

```bash
npx tsx --env-file=.env --env-file=.env.local scripts/pre-scan.ts \
  --source-list data/source-list-{domain}.json \
  --wave 1
```

**Check output:**

- Exit code must be 0 (no blockers)
- Review estimated wave cost — should be under $20 for a 10-source wave
- Any PDF or unreachable URL must be fixed before proceeding

> **Note:** Cost estimates in pre-scan assume fresh extraction. Sources with existing checkpoint files (`data/ingested/{slug}-partial.json`) will skip Claude extraction and only pay for embedding, which is ~$0.001/source.

---

## Step 5: Ingest Wave 1

With the IAP tunnel running on port 8800:

```bash
SURREAL_URL=http://localhost:8800 \
SURREAL_USER=root \
SURREAL_PASS='<password>' \
npx tsx --env-file=.env --env-file=.env.local scripts/ingest-batch.ts \
  --source-list data/source-list-{domain}.json \
  --wave 1 \
  --domain {domain} \
  --yes
```

**Flags:**

- `--domain {domain}` — stamps all claims with the correct domain (overrides Claude's extraction-time domain assignment)
- `--yes` — skips cost confirmation prompt (pre-scan already ran above)
- `--validate` — enables Gemini cross-validation; requires `GOOGLE_AI_API_KEY` in `.env.local`

**Monitor DB write progress** in a separate terminal while the batch runs:

```bash
curl -s -X POST http://localhost:8800/sql \
  -H "Content-Type: text/plain" \
  -H "Accept: application/json" \
  -u "root:<password>" \
  -H "surreal-ns: sophia" \
  -H "surreal-db: sophia" \
  -d "SELECT count() FROM claim WHERE domain = '{domain}' GROUP ALL;"
```

**If a source fails mid-pipeline:**

```bash
# Re-run from the failed stage only (no re-processing completed stages)
SURREAL_URL=http://localhost:8800 \
SURREAL_USER=root \
SURREAL_PASS='<password>' \
npx tsx --env-file=.env --env-file=.env.local scripts/ingest.ts \
  data/sources/{slug}.txt \
  --domain {domain} \
  --force-stage {stage}
  # Valid stages: extracting, relating, grouping, embedding, validating, storing
```

**If a previously-failed source needs retry via batch:**

```bash
# Add --retry to reprocess sources marked as previously failed
SURREAL_URL=http://localhost:8800 \
SURREAL_USER=root \
SURREAL_PASS='<password>' \
npx tsx --env-file=.env --env-file=.env.local scripts/ingest-batch.ts \
  --source-list data/source-list-{domain}.json \
  --domain {domain} \
  --retry
```

---

## Step 6: Quality Report

After ingestion, verify quality metrics via the DB:

```bash
# Claims per source
curl -s -X POST http://localhost:8800/sql \
  -H "Content-Type: text/plain" -H "Accept: application/json" \
  -u "root:<password>" \
  -H "surreal-ns: sophia" -H "surreal-db: sophia" \
  -d "SELECT source.title AS title, count() AS claims FROM claim WHERE domain = '{domain}' GROUP BY source ORDER BY claims DESC;"
```

**Acceptance criteria (all must pass before going live):**

| Metric | Target | Wave 1 PoM actual |
|--------|--------|-------------------|
| Orphan claims (no relations) | 0% | Not yet measured |
| Argument coverage | >80% of claims assigned | ~35–65% (see weaknesses below) |
| Spot-check accuracy | >80% correctly attributed | Not yet measured |
| Low-confidence claims (<0.5) | <5% | Not yet measured |

> **Known Wave 1 weakness:** Argument coverage is below target for several sources (especially Chalmers "Facing Up" at 12 arguments for 336 claims). The grouping stage may need prompt tuning for highly argumentative primary texts. See Wave 1 Quality Analysis below.

---

## Step 7: Engine Live Validation

Run the retrieval validation script against production:

```bash
SURREAL_URL=http://localhost:8800 \
SURREAL_USER=root \
SURREAL_PASS='<password>' \
npx tsx --env-file=.env --env-file=.env.local scripts/validate-retrieval.ts \
  --domain {domain}
```

**Expected:**

- ≥3 knowledge graph claims returned per query
- Claims attributed to correct sources (check `source_title` and `source_author`)
- All 5 test queries pass

---

## Step 8: Update ROADMAP.md

Mark the ingestion wave as complete and update metrics:

```markdown
### Phase 3e: Philosophy of Mind — Wave 1 ✅

- [x] `data/source-list-pom.json` — N sources ingested
- [x] Quality gate passed: 0% orphans, X% argument coverage
- [x] Engine validation: 5 PoM test queries return knowledge graph claims
```

Update the metrics table:

| Metric | Update |
|--------|--------|
| Sources ingested | +N (total: N) |
| Claims in graph | +N (total: ~N) |

---

## Step 9: Wave 2 (when ready)

Repeat Steps 1–8 with `--wave 2`. Wave 2 expands coverage to secondary traditions and sub-topics:

For Philosophy of Mind Wave 2:

- Mind-body problem: Descartes (excerpts), Smart (1959), Fodor (1974), Kim (1992)
- Personal identity: Parfit (Reasons and Persons Part III), Locke (excerpts), Olson (SEP)
- Extended cognition: Clark & Chalmers (1998), Hutchins

---

## Wave 1 Quality Analysis (Philosophy of Mind)

### Results summary

| Source | Claims | Relations | Arguments | Density | Notes |
| --- | --- | --- | --- | --- | --- |
| IEP Consciousness (101) | 547 | 153 | 62 | 0.28 | Low relation density |
| Chalmers "Facing Up" (103) | 336 | 124 | 12 | 0.37 | Very low argument count for claim volume |
| SEP Qualia (104) | 273 | 135 | 27 | 0.49 | OK |
| SEP Physicalism (105) | 375 | 222 | 29 | 0.59 | OK |
| SEP Functionalism (106) | 349 | 192 | 35 | 0.55 | OK |
| Turing 1950 (107) | 264 | 108 | 15 | 0.41 | OK |
| SEP Chinese Room (108) | 495 | 128 | 25 | 0.26 | Low relation density |
| SEP Phil AI (109) | 428 | 227 | 19 | 0.53 | Low argument count |
| SEP Turing Test (110) | 302 | 223 | 33 | 0.74 | Best quality |
| **Total** | **3,369** | **1,512** | **257** | **0.45 avg** | |

### Identified weaknesses

**1. Low relation density on sources 101 and 108 (0.26–0.28)**
IEP Consciousness and Chinese Room both have high claim counts but relatively few extracted relations. This limits graph traversal depth during retrieval. Consider re-running the relation extraction stage (`--force-stage relating`) for these sources in Wave 2 cleanup.

**2. Low argument coverage on source 103 (Chalmers)**
12 arguments for 336 claims suggests grouping stage assigned only ~36% of claims to an argument. Chalmers' paper is a tightly structured argument; the grouping prompt may have struggled with its dialectical density. Candidate for `--force-stage grouping` re-run.

**3. No Gemini cross-validation**
`--validate` was not run for Wave 1 because `GOOGLE_AI_API_KEY` was not configured. This means no independent quality check was performed on extracted claims. Configure `GOOGLE_AI_API_KEY` in `.env.local` before Wave 2 and run with `--validate`.

**4. Source 109 re-ran Claude extraction unnecessarily**
A slug mismatch (`artificial-intelligence` vs `philosophy-of-artificial-intelligence`) caused the checkpoint file to not be found, so Stage 1 (extraction) ran from scratch at a cost of ~$1.34. This bug has been fixed in the batch script (URL-first slug resolution).

**5. Source 102 silently skipped (slug collision)**
Two sources both titled "Consciousness" shared the title-derived slug `consciousness`. The script found source 101's file when processing source 102 and skipped it as "already ingested". This has been fixed; future runs will resolve by URL, not title slug.

**6. No formal spot-check accuracy run**
`spot-check.ts` and `quality-report.ts` are referenced in this runbook but not yet implemented. Wave 2 should include implementing these scripts before ingestion.

### Recommended remediation before Wave 2

1. Re-run relation extraction for sources 101 and 108: `--force-stage relating`
2. Re-run argument grouping for source 103: `--force-stage grouping`
3. Configure `GOOGLE_AI_API_KEY` and run `--validate` for Wave 2
4. Implement `quality-report.ts` with the acceptance criteria checks

---

## Appendix: Troubleshooting

### IAP tunnel dropped during ingestion

Symptom: DB operations hang indefinitely, or `[WARN] Failed to check if source is ingested: IAM error` appears.

```bash
# Check tunnel terminal — if the SSH session shows nothing or disconnected:
# 1. Ctrl+C the ingestion script
# 2. Restart the tunnel:
gcloud compute ssh sophia-db \
  --zone=europe-west2-b \
  --project=sophia-488807 \
  --tunnel-through-iap \
  -- -L 8800:localhost:8000 -N
# 3. Re-run ingest-batch — the pipeline will skip completed sources and resume
```

The ingestion_log in production tracks completion per source. Re-running after a tunnel drop is safe — completed sources are skipped, failed sources resume from their last checkpoint stage.

### DB connection timeout during ingestion

```bash
# Check SurrealDB health via tunnel
curl -s http://localhost:8800/health

# Retry from the last completed stage — the pipeline is idempotent
SURREAL_URL=http://localhost:8800 SURREAL_USER=root SURREAL_PASS='<password>' \
npx tsx --env-file=.env --env-file=.env.local scripts/ingest.ts \
  data/sources/{slug}.txt --domain {domain}
# (Resume is automatic — re-run picks up from ingestion_log)
```

### Vertex AI 429 during embedding

Embedding large sources (>300 claims) in two batches of 250 can hit Vertex AI rate limits. Wait 60–90 seconds and re-run with `--force-stage embedding`. The extraction checkpoint is already saved so only the embedding stage re-runs.

### Source extraction produces 0 claims

```bash
# Force re-extraction from Stage 1
SURREAL_URL=http://localhost:8800 SURREAL_USER=root SURREAL_PASS='<password>' \
npx tsx --env-file=.env --env-file=.env.local scripts/ingest.ts \
  data/sources/{slug}.txt --domain {domain} --force-stage extracting
```

### Cost ceiling exceeded for a source

The pre-scan will block sources with estimated cost >$2.00. Options:

1. Find a shorter HTML URL (fewer tokens)
2. Split the source into sub-sections manually
3. Raise `PER_SOURCE_COST_CEILING_USD` in `pre-scan.ts` if the source is ESSENTIAL

---

## Runbook Version History

| Version | Date | Change |
| --- | --- | --- |
| 0.3.0 | 2026-03-09 | Production DB access (IAP tunnel); retire local Docker workflow; Wave 1 quality analysis; slug collision and .env.local fixes |
| 0.2.0 | 2026-03-08 | Initial runbook — Philosophy of Mind expansion |
