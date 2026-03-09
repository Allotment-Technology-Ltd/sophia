# Domain Expansion Runbook

**Version:** 0.2.0
**Branch:** `domain-expansion`
**Last updated:** 2026-03-08

This is the canonical operational runbook for adding any new philosophical domain to SOPHIA's knowledge graph. Execute steps in order. Each step has a verification check before proceeding.

---

## Prerequisites

Before starting a new domain expansion:

- [ ] Phase 3d infrastructure hardening is complete on `domain-expansion` branch
- [ ] Ethics corpus re-embedding confirmed complete (`reembed-corpus.ts` ran successfully)
- [ ] Domain name chosen from `PhilosophicalDomain` type in [src/lib/types/domains.ts](../../src/lib/types/domains.ts)
- [ ] At least 10 sources identified and curated (Step 2 below)
- [ ] `.env` file is up to date with `SURREAL_URL`, `ANTHROPIC_API_KEY`, `GOOGLE_VERTEX_PROJECT`

---

## Step 0: Confirm Infrastructure

```bash
# Verify DB schema has 768-dim MTREE index
npx tsx --env-file=.env scripts/health-check.ts

# Verify retrieval works for ethics domain after re-embedding
npx tsx --env-file=.env scripts/test-retrieval.ts --domain ethics --query "What is moral duty?"
# Expected: ≥3 claims returned with confidence scores
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

---

## Step 2: Curate Each Source

Run the automated curation check on each source **before** adding it to the source list:

```bash
npx tsx --env-file=.env scripts/curate-source.ts \
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
npx tsx --env-file=.env scripts/fetch-source.ts \
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
npx tsx --env-file=.env scripts/pre-scan.ts \
  --source-list data/source-list-{domain}.json \
  --wave 1
```

**Check output:**
- Exit code must be 0 (no blockers)
- Review estimated wave cost — should be under $20 for a 10-source wave
- Any PDF or unreachable URL must be fixed before proceeding

---

## Step 5: Ingest Wave 1

```bash
npx tsx --env-file=.env scripts/ingest-batch.ts \
  --source-list data/source-list-{domain}.json \
  --wave 1 \
  --domain {domain} \
  --validate \
  --yes
```

**Flags:**
- `--domain {domain}` — stamps all claims with the correct domain (overrides Claude's extraction-time domain assignment)
- `--validate` — enables Gemini cross-validation for quality assurance
- `--yes` — skips cost confirmation prompt (pre-scan already ran above)

**Monitor progress** in a separate terminal:
```bash
npx tsx --env-file=.env scripts/monitor-wave.ts
```

**If a source fails mid-pipeline:**
```bash
# Re-run from the failed stage only (no re-processing completed stages)
npx tsx --env-file=.env scripts/ingest.ts data/sources/{slug}.txt \
  --domain {domain} \
  --force-stage {stage}
  # Valid stages: extracting, relating, grouping, embedding, validating, storing
```

---

## Step 6: Quality Report

```bash
npx tsx --env-file=.env scripts/quality-report.ts --domain {domain}
npx tsx --env-file=.env scripts/spot-check.ts --domain {domain} --sample 20
```

**Acceptance criteria (all must pass before going live):**

| Metric | Target |
|--------|--------|
| Orphan claims (no relations) | 0% |
| Argument coverage | >80% of claims assigned to an argument |
| Spot-check accuracy | >80% of sampled claims correctly attributed |
| Low-confidence claims (<0.5) | <5% |

If any criterion fails, investigate:
- Orphan claims → relation extraction stage may have failed; use `--force-stage relating`
- Low argument coverage → grouping stage may have failed; use `--force-stage grouping`
- Low accuracy → source quality issue; consider quarantining the source

---

## Step 7: Engine Live Validation

In the `domain-expansion` branch, the `MVP_DOMAIN_FILTER` has been removed. Test that the engine retrieves new domain claims:

```bash
# Run 5 hand-crafted test queries for the new domain
npx tsx --env-file=.env scripts/test-retrieval.ts \
  --domain {domain} \
  --query "Your test question here"
```

**Expected:**
- ≥3 knowledge graph claims returned per query
- Claims attributed to correct sources (check `source_title` and `source_author`)
- Retrieval latency <500ms (p95)

If engine integration needs to be tested end-to-end, temporarily set `domain` in `engine.ts` retrieval options to the new domain and run the dev server.

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

## Appendix: Troubleshooting

### DB connection timeout during ingestion
```bash
# Check SurrealDB health
npx tsx --env-file=.env scripts/health-check.ts

# Retry from the last completed stage — the pipeline is idempotent
npx tsx --env-file=.env scripts/ingest.ts data/sources/{slug}.txt \
  --domain {domain}
# (Resume is automatic — re-run picks up from ingestion_log)
```

### Source extraction produces 0 claims
```bash
# Force re-extraction from Stage 1
npx tsx --env-file=.env scripts/ingest.ts data/sources/{slug}.txt \
  --domain {domain} \
  --force-stage extracting
```

### Duplicate claims after re-run
The pipeline uses `CREATE ... IF NOT EXISTS` (upsert-style) for claims, so re-runs should not create duplicates. If duplicates appear, check that `ingestion_log.status` was not marked `complete` incorrectly.

### Cost ceiling exceeded for a source
The pre-scan will block sources with estimated cost >$2.00. Options:
1. Find a shorter HTML URL (fewer tokens)
2. Split the source into sub-sections manually
3. Raise `PER_SOURCE_COST_CEILING_USD` in `pre-scan.ts` if the source is ESSENTIAL

---

## Runbook Version History

| Version | Date | Change |
|---------|------|--------|
| 0.2.0 | 2026-03-08 | Initial runbook — Philosophy of Mind expansion |
