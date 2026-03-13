---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Supporting operational reference only.

# Gutenberg Pilot Runbook (Kant Groundwork)

## Purpose
- Execute the dedicated Phase 2 Gutenberg pilot on Kant's *Groundwork*.
- Standardize the long-text ingestion profile that must be applied to subsequent waves (PoM reruns, multi-domain rollout, SEP batches).

## Canonical Pilot Source
- Title: *Groundwork of the Metaphysics of Morals*
- URL: `https://www.gutenberg.org/files/5682/5682-h/5682-h.htm`
- Source type: `book`

## Policy-Compliant Acquisition
- Use direct Gutenberg HTML endpoints only (`/files/...-h/...-h.htm`).
- Respect robots/terms and avoid high-concurrency scraping.
- Use SOPHIA fetch path (`scripts/fetch-source.ts`) with deterministic user-agent and metadata capture.

## Long-Text Ingestion Profile (Mandatory)
- `source_type=book` always enables long-text mode.
- Section sizing:
  - `MAX_TOKENS_PER_SECTION=5000` (default)
  - `BOOK_MAX_TOKENS_PER_SECTION=3000` (book override)
- Segmentation policy:
  - Chapter-aware heading detection (`BOOK|CHAPTER|SECTION|PART`, numeric and Roman numeral forms).
  - Paragraph fallback splitting for oversized sections.
- Retry and fallback policy:
  - Exponential backoff retries for model calls.
  - Auto split-and-retry when extraction/fix responses truncate.
  - Long-text relation/grouping chunking with overlap:
    - `LONG_TEXT_RELATION_CHUNK_SIZE=90`, `LONG_TEXT_RELATION_CHUNK_OVERLAP=20`
    - `LONG_TEXT_GROUPING_CHUNK_SIZE=120`, `LONG_TEXT_GROUPING_CHUNK_OVERLAP=20`
  - Checkpoint persistence keyed by `canonical_url_hash`.
- Quality gates (enforced in `ingest.ts` when long-text mode is active):
  - Claims > 0.
  - Relations > 0.
  - Arguments > 0.
  - Failing any gate marks ingestion as failed for rerun/remediation.

## Pilot Execution Commands
```bash
npx tsx --env-file=.env scripts/fetch-source.ts \
  "https://www.gutenberg.org/files/5682/5682-h/5682-h.htm" \
  book

npx tsx --env-file=.env scripts/pre-scan.ts \
  --source-list data/source-list-3a.json \
  --wave 1

# Replace <slug> with the fetched slug from data/sources/*.meta.json for the canonical URL hash.
npx tsx --env-file=.env scripts/ingest.ts \
  data/sources/<slug>.txt \
  --ingest-provider vertex
```

## Pilot Acceptance Gates
- Fetch succeeds with non-empty text and non-unknown title.
- Pre-scan reports finite cost and non-zero section count.
- Full ingest completes with:
  - non-zero claims,
  - non-zero relations,
  - non-zero arguments,
  - `ingestion_log.status='complete'` keyed by `canonical_url_hash`.
- Rerun behavior:
  - resume works from checkpoint keyed by canonical hash,
  - retries tracked via `ingestion_log.retry_count`,
  - no source identity collisions.

## Output Artifacts
- Source files: `data/sources/<slug>.txt` + `.meta.json`
- Checkpoint: `data/ingested/<canonical_url_hash>-partial.json`
- Log record: `ingestion_log` row keyed by `canonical_url_hash`

## Pilot Result (Executed 2026-03-11)
- Canonical hash: `00fcec3c568ee0738f9399c9ece1b1c827a7348540669b7395fcce01a7cb175b`
- Final status: `complete`
- Stage completion: `storing`
- Claims: `638`
- Relations: `375`
- Arguments: `69`
- Cost (`ingestion_log.cost_usd`): `$0.0499`
- Retry count: `3` (failed relation-stage retries before chunk policy stabilization)
- Outcome: acceptance gates passed (`claims>0`, `relations>0`, `arguments>0`) with canonical-hash checkpointing/resume verified.
