# Together fine-tune — extraction (Gutenberg + SEP)

This doc captures a **training loop for Stage 1 (extraction)** on **Together**, explicitly targeting the failure modes seen in the prior Fireworks deployment:

- **Under-recall** (sparse extraction: very few claims per passage)
- **Schema drift** (prefix/suffix chatter, truncated/concatenated JSON)
- **Bad grounding** (missing/invalid `passage_id`)

It is intentionally scoped to **extraction only**. Keep relations/grouping on existing routed models until extraction is stable.

## 1) What “good” looks like (gates)

Track these on the ingest path (not just offline JSONL eval):

- **claimsPerPassage**: \( \text{claims} / \text{passages} \) per batch and per source.
- **passageIdValidityRate**: % claims where `passage_id` is present and points at a passage in the batch.
- **jsonFirstPassRate**: % batches that parse/validate without repair.
- **repairRate**: how often a model-based repair is needed (and how often it succeeds).

In this repo, ingestion now enforces:

- **Smaller default extraction batches for `source_type='book'`**
- **Sparse-batch split retry** (prevents checkpointing under-recalled batches)
- **Strict `passage_id` contract** (missing/invalid ids fail the batch and trigger repair/split)

## 2) Collect training examples (the “sparse batch” set)

### 2.1 Capture the exact batch inputs

For Gutenberg + SEP, you want training examples where the model **must** emit multiple claims across a small number of passages.

On a reproduction ingest, set:

- `INGEST_SAVE_EXTRACTION_RAW=true`

This writes, per batch, in `data/ingested/`:

- `*-extraction-batch-N.prompt.txt` (the `<passage …>` batch payload)
- `*-extraction-batch-N.raw.txt` (the model response as received)

Start with the batches that were previously flagged as sparse (or that now repeatedly split).

### 2.2 Label: multi-claim gold JSON with strict ids

For each selected batch:

- Produce a gold output that is **JSON-only** and matches your `ExtractionOutputSchema`.
- Each claim must include a valid `passage_id` from the batch (e.g. `p0007`).
- Prefer **atomic, non-overlapping** claims:
  - definitions
  - theses
  - premises
  - objections/replies where explicitly present

Keep a consistent claim style across gold examples (concise, declarative).

## 3) Build Together SFT JSONL (prompt → completion)

Use a JSONL shape compatible with Together’s SFT jobs (chat-style is fine). Each row should mirror the **real extraction prompt shape** used in ingestion:

- `system`: the extraction system prompt (`EXTRACTION_SYSTEM`)
- `user`: the extraction user prompt (`EXTRACTION_USER(...)`) including the rendered `<passage …>` XML-ish block
- `assistant`: **only** the JSON array output (no preamble)

Recommended dataset composition (initial):

- 60–70% **sparse-batch fixes** (the failure mode you’re correcting)
- 20–30% normal “dense” SEP batches (to avoid regression on SEP)
- 10–20% Gutenberg book batches (chapter headings, hard wraps, footnotes)

## 4) Train on Together (first pass)

Training objective: **increase recall** while preserving schema discipline.

Operational guidance:

- Start with a small SFT run (tens to low hundreds of examples) focusing on “sparse-batch fixes”.
- Keep temperature low during eval/inference; enforce JSON-only output.

## 5) Evaluate (offline + ingest path)

### 5.1 Offline quick check

Run your existing OpenAI-compatible eval harness against the Together endpoint to sanity-check:

- schema pass rate
- “subset text match” (where applicable)

### 5.2 Ingest-path check (required)

Run a fixed micro-pack (SEP + Gutenberg) using:

- the same slugs/URLs
- pinned extraction model (Together FT)

Compare:

- batch split count
- sparse-batch frequency
- total extracted claim count
- repair rate

## 6) Iteration loop

If you still see under-recall:

- add more “multi-claim-per-passage” gold labels (3–8 claims from 1–2 passages)
- add explicit negative filtering (remove any examples where the assistant includes non-JSON)
- consider shrinking extraction batches further (books) so the model’s task is narrower per call

If you see grounding problems:

- increase the density of examples where multiple passage ids are used correctly
- add a few “hard” examples (similar passages; ids must still be correct)

## 7) Notes on long-term portability

Together FT is chosen here because it keeps the inference path and weight export story more flexible than Fireworks-trained-only deployments.

