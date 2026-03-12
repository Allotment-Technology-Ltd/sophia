# Reingestion Cutover Plan

**Status:** Proposed  
**Last updated:** 2026-03-12  
**Scope:** Reingestion of already-fetched sources into the Phase 1 ingestion pipeline with passage grounding, claim typing, conservative relations, review workflow, and stage-specific model routing.

## Objective

Reingest the existing corpus without starting from zero, while avoiding a mixed-quality graph.

The safe unit of migration is the **source**, not the whole graph. Current ingestion rewrites one source at a time by URL, and the trusted retrieval path already prefers `accepted` records once reviewed content exists. The plan should therefore:

- reuse the local fetched source files in `data/sources/`
- reingest source-by-source with fixed stage model settings
- hold all new output in staging until review completes
- promote only fully reviewed sources into the trusted layer
- prove the pipeline on **1 SEP entry** and **1 Gutenberg entry** before any batch run

## Why Reingestion Is Required

Existing ingest output predates several schema and pipeline changes:

- argumentative passage segmentation now exists and should replace raw section-only extraction
- claims now carry passage provenance, claim-origin typing, thinker/tradition/era tags, concept tags, and contested-term flags
- relations are now restricted to the conservative ontology:
  - `supports`
  - `contradicts`
  - `responds_to`
  - `depends_on`
  - `defines`
  - `qualifies`
- claims, passages, and relations now flow through `candidate | accepted | rejected | merged | needs_review`
- the ingestion pipeline now uses stage-specific model slots and budgets instead of one generic extraction model

Any source left in the old shape will be structurally inconsistent with newly reingested sources. That is how mixed quality leaks into retrieval.

## Current Constraints From The Codebase

### 1. Source replacement is destructive per source

[`scripts/ingest.ts`](/Users/adamboon/projects/sophia/scripts/ingest.ts) currently finds an existing `source` by URL, deletes that source's claims, passages, arguments, and relation edges, then recreates them in the new format.

Implication:

- reingestion should be run in a controlled source sequence
- rollback must be handled before pilot runs
- partial batched runs are unsafe unless the batch is manifest-driven and resumable

### 2. Trusted retrieval already separates reviewed from staging content

[`src/lib/server/retrieval.ts`](/Users/adamboon/projects/sophia/src/lib/server/retrieval.ts) now switches to `review_state = 'accepted'` once any accepted claims exist.

Implication:

- this helps avoid a mixed-quality graph
- but it also means the team must treat acceptance as a deliberate cutover event
- old legacy content with no accepted review state should not be relied on after the trusted layer is activated

### 3. Existing fetched metadata is inconsistent

Older fetched source metadata in `data/sources/*.meta.json` does not consistently include:

- `canonical_url`
- `canonical_url_hash`
- `visibility_scope`
- `deletion_state`

Newer Gutenberg fetches already include these fields, but many older SEP/IEP files do not.

Implication:

- add a metadata backfill step before reingestion
- use `canonical_url_hash` as the stable source identity in the reingestion manifest

### 4. Backup and restore scripts lag the new schema

[`scripts/db-backup.ts`](/Users/adamboon/projects/sophia/scripts/db-backup.ts) and [`scripts/db-restore.ts`](/Users/adamboon/projects/sophia/scripts/db-restore.ts) currently cover `source`, `claim`, `argument`, and relation tables, but not newer tables such as `passage` and `review_audit_log`.

Implication:

- do not treat the current backup scripts as a complete rollback path for pilot cutover
- either extend them first or use a DB-level snapshot outside those scripts

## Core Decision

Build on what already exists.

Do **not** refetch the full corpus and do **not** do a full-graph wipe. Reuse local fetched text and reingest in controlled waves with explicit source-level cutover.

## Reingestion Principles

### 1. Reuse fetched text whenever the local file is valid

Use `data/sources/*.txt` and `*.meta.json` as the default input. Refetch only when:

- the local text is empty or obviously bad
- the title/author metadata is corrupted
- canonical metadata cannot be reconstructed confidently
- the source extraction rules have materially changed and local text is no longer trustworthy

### 2. Cut over per source, not per claim

For any source selected for reingestion:

- either keep the legacy source as-is
- or replace it entirely with the new source output

Never mix old claims with new claims from the same source in the trusted layer.

### 3. No trusted promotion until source review is complete

Reingested sources should remain in staging (`candidate` / `needs_review`) until review is complete for the source slice.

Promotion should be source-complete, not opportunistic claim-by-claim promotion across a half-reviewed source.

### 4. Freeze stage model settings per wave

Do not change stage profiles mid-pilot or mid-wave. For each pilot or wave, freeze:

- extraction model profile
- relation model profile
- grouping model profile
- validation model profile
- JSON repair model profile
- embedding model profile
- stage budget caps
- `INGEST_EXTRACTOR_VERSION`

This is required for auditability and for comparing pilot results.

## Proposed Source States

Track each source in a manifest with one operational status:

- `legacy_only`
- `ready_for_reingest`
- `reingest_running`
- `reingest_staging`
- `under_review`
- `trusted`
- `blocked`

This status should live outside the graph itself at first, in a manifest file or ops sheet.

## Recommended Pilot Order

Run the pilots sequentially, not in parallel.

### Pilot A: SEP entry

**Recommended source:** `Personal Identity and Ethics`  
**Local file:** [`data/sources/personal-identity-and-ethics.txt`](/Users/adamboon/projects/sophia/data/sources/personal-identity-and-ethics.txt)

Why this is the right SEP pilot:

- already fetched locally
- relatively small and fast to debug
- SEP structure is good for validating passage roles, objections, and replies
- close to the narrow Phase 1 corpus goal through Parfit-related material

### Pilot B: Gutenberg entry

**Recommended source:** `Fundamental Principles of the Metaphysic of Morals`  
**Local file:** [`data/sources/fundamental-principles-of-the-metaphysic-of-morals-00fcec3c56.txt`](/Users/adamboon/projects/sophia/data/sources/fundamental-principles-of-the-metaphysic-of-morals-00fcec3c56.txt)

Why this is the right Gutenberg pilot:

- already fetched locally
- long enough to stress passage segmentation and batching
- already identified elsewhere as the Gutenberg pilot text
- existing partial ingest output shows the old pipeline produced low-trust artifacts, so rerunning it is high value

If domain alignment is more important than full reuse, the next candidate after the mechanics pilot should be `SEP Deontological Ethics`, but that is a second step, not the first one.

## Pre-Pilot Work

### 1. Freeze the pilot ingestion profile

Document the exact stage settings that will be used for both pilot runs.

Minimum env set to freeze:

```bash
export EXTRACTION_MODEL_PROFILE="vertex:gemini-2.5-flash-lite"
export RELATION_MODEL_PROFILE="vertex:gemini-2.5-flash-lite"
export GROUPING_MODEL_PROFILE="anthropic:claude-sonnet-4-5-20250929"
export VALIDATION_MODEL_PROFILE="anthropic:claude-sonnet-4-5-20250929"
export JSON_REPAIR_MODEL_PROFILE="vertex:gemini-2.5-pro"
export EMBEDDING_MODEL_PROFILE="vertex:text-embedding-005"
export INGEST_EXTRACTOR_VERSION="phase1-reingest-pilot-v1"
export VALIDATION_BATCH_TARGET_TOKENS="70000"
```

Also freeze the stage guardrails explicitly:

- `INGEST_STAGE_EXTRACTION_MAX_*`
- `INGEST_STAGE_RELATIONS_MAX_*`
- `INGEST_STAGE_GROUPING_MAX_*`
- `INGEST_STAGE_VALIDATION_MAX_*`
- `INGEST_STAGE_EMBEDDING_MAX_*`
- `INGEST_STAGE_JSON_REPAIR_MAX_*`
- `INGEST_LOW_CONFIDENCE_REVIEW_THRESHOLD`

### 2. Backfill source metadata without refetching text

Before any reingestion run:

- normalize every local `*.meta.json`
- add `canonical_url`
- add `canonical_url_hash`
- add `visibility_scope`
- add `deletion_state`
- preserve the existing local slug so file paths remain stable

This should be done as a metadata-only backfill, not by re-downloading sources.

### 3. Build a reingestion manifest

Create a machine-readable manifest for the current fetched corpus.

Suggested fields:

- `title`
- `url`
- `canonical_url`
- `canonical_url_hash`
- `source_type`
- `local_slug`
- `local_txt_path`
- `local_meta_path`
- `current_db_source_id`
- `current_ingestion_status`
- `pilot_priority`
- `reingestion_status`
- `notes`

This manifest becomes the control plane for later batch waves.

### 4. Fix rollback before pilot

Do one of these before pilot runs:

- extend backup/restore to include `passage` and `review_audit_log`
- or use an infrastructure/database snapshot outside the repo scripts

Without that, there is no clean rollback for a destructive source rewrite.

### 5. Apply the latest schema first

Run [`scripts/setup-schema.ts`](/Users/adamboon/projects/sophia/scripts/setup-schema.ts) before pilot reingestion so the destination schema matches the new passage/review/relation fields.

## Pilot Execution

### Step 1. Pre-scan the pilot source

Create a temporary pilot-only source list and run pre-scan against that list to verify:

- text is non-empty
- metadata is sane
- section sizing is acceptable
- estimated cost is within the pilot budget

Use [`scripts/pre-scan.ts`](/Users/adamboon/projects/sophia/scripts/pre-scan.ts) with `--source-list` for this.

Example:

```bash
pnpm tsx scripts/pre-scan.ts --source-list data/source-list-reingest-pilot.json
```

### Step 2. Reingest the SEP pilot first

Run the SEP pilot as a single-source ingest using the frozen model profile.

Suggested flow:

```bash
pnpm tsx scripts/ingest.ts data/sources/personal-identity-and-ethics.txt --validate
```

Immediate checks:

- ingest completes successfully
- passages are created
- stored claims have source spans
- no invalid relation labels are stored
- claims and relations land in `candidate` or `needs_review`

### Step 3. Evaluate the SEP pilot before moving on

Run:

- [`scripts/quality-report.ts`](/Users/adamboon/projects/sophia/scripts/quality-report.ts)
- [`scripts/spot-check.ts`](/Users/adamboon/projects/sophia/scripts/spot-check.ts)
- [`scripts/verify-db.ts`](/Users/adamboon/projects/sophia/scripts/verify-db.ts)
- admin review queue at [`src/routes/admin/review/+page.svelte`](/Users/adamboon/projects/sophia/src/routes/admin/review/+page.svelte)

Minimum SEP pilot review gate:

- manual spot-check of 10-15 claims
- manual review of at least 10 relations
- duplicate suggestions reviewed
- no catastrophic passage-boundary failures
- no obvious garbage claims promoted to accepted

### Step 4. Accept or block the SEP pilot

Only move the SEP pilot to trusted if:

- source-level provenance looks correct
- objection/reply structure survives segmentation
- review queue behavior is usable
- duplicate/merge workflow is functioning

If not, keep it in staging and fix the pipeline before any Gutenberg run.

### Step 5. Reingest the Gutenberg pilot second

Run the Gutenberg pilot only after the SEP pilot passes.

Suggested flow:

```bash
pnpm tsx scripts/ingest.ts data/sources/fundamental-principles-of-the-metaphysic-of-morals-00fcec3c56.txt --validate
```

Additional Gutenberg-specific checks:

- passage batching is stable across a long text
- no nonsense "there are no philosophical claims" style artifacts survive review
- claim spans remain attached despite long-text batching
- objection/reply material is not catastrophically split away from surrounding context

### Step 6. Review the Gutenberg pilot more aggressively

Minimum Gutenberg review gate:

- manual spot-check of 20 claims
- manual review of at least 15 relations
- targeted check of Preface, one central argument section, and one later section
- duplicate suggestions triaged
- no large clusters of low-confidence claims accepted by accident

## Pilot Success Criteria

Do not start batch reingestion until both pilots satisfy all of the following:

- source rewrite succeeds cleanly on both sources
- source metadata is canonicalized and stable
- passage records are persisted and inspectable
- claim source spans and passage links are present
- relation output is limited to the six trusted types
- low-confidence claims and relations land in review, not trusted
- quality-report and spot-check workflows are usable
- reviewer workflow can accept, reject, merge, and audit cleanly
- trusted retrieval does not depend on legacy unreviewed content

## Batch Reingestion After Pilots

Do not go directly from pilot to full-corpus batch.

### Wave 0: Curated already-fetched SEP/IEP sources

Reingest only already-fetched, moderate-size SEP/IEP entries relevant to the narrow Phase 1 corpus.

Suggested batch size:

- 2 to 3 sources at a time

Wave exit gate:

- each source reviewed to source-complete acceptance or explicit block

### Wave 1: Remaining already-fetched Gutenberg texts

Reingest Gutenberg texts one at a time or in very small batches.

Suggested batch size:

- 1 source at a time for long texts

Wave exit gate:

- stable long-text batching
- manageable review queue volume
- no repeat of known long-text extraction failures

### Wave 2: Other already-fetched papers and institutional sources

Only after Waves 0 and 1 are stable should the team reingest the rest of the currently fetched corpus.

## Mixed-Quality Guardrails

These are mandatory.

### 1. No partial trusted source

Do not promote isolated claims from a source into trusted while the rest of the source remains unreviewed.

### 2. No legacy-plus-new hybrid source

Do not combine old and new records from the same source in the trusted graph.

### 3. No changing model profiles mid-wave

If the team needs to change a stage model or budget, close the current wave, update the profile version, and start a new wave.

### 4. No broad `ingest-batch.ts` run until pilots pass

Do not run batch reingestion over a whole source list just because the files are present locally.

### 5. No trust promotion without review

`candidate` and `needs_review` are staging states, not trusted states.

## Streamlining Opportunities Worth Taking

These improve speed without compromising graph quality.

### 1. Metadata-only backfill

Do this once, then reuse it for all waves.

### 2. Manifest-driven retries

Drive reingestion from a manifest keyed by `canonical_url_hash`, not by ad hoc filenames.

### 3. Reuse current quality tooling

The fastest path is to keep using:

- [`scripts/quality-report.ts`](/Users/adamboon/projects/sophia/scripts/quality-report.ts)
- [`scripts/spot-check.ts`](/Users/adamboon/projects/sophia/scripts/spot-check.ts)
- `/admin/review`

### 4. Add source-level review completion markers

This can be a manifest field at first. It does not need a full product surface immediately.

### 5. Hold off on refetching until the pipeline proves itself

The current bottleneck is graph quality and review discipline, not source acquisition.

## Concrete Next Actions

1. Extend rollback coverage so backups include `passage` and `review_audit_log`, or choose a DB-level snapshot approach.
2. Backfill canonical metadata across `data/sources/*.meta.json`.
3. Create a reingestion manifest for the fetched corpus.
4. Freeze the pilot stage model profiles and budgets.
5. Run SEP pilot: `Personal Identity and Ethics`.
6. Review and either accept or block the SEP pilot.
7. Run Gutenberg pilot: `Fundamental Principles of the Metaphysic of Morals`.
8. Review and either accept or block the Gutenberg pilot.
9. Only after both pass, start small-wave reingestion for the rest of the already-fetched curated corpus.
