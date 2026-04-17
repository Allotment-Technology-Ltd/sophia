# Fine-tuned extraction — golden A/B evidence & recommendations

**Date:** 2026-04-16  
**Scope:** Offline **golden holdout** (`golden_holdout.jsonl`) and **combined eval-compare** artefacts already on disk. **Ingest gates** (`[INGEST_TIMING]`, batch splits, live `passage_id` grounding) are **explicitly out of scope** here — see Phase 0 §3 in [`docs/local/operations/phase0-extraction-ingestion-baseline-report.md`](../local/operations/phase0-extraction-ingestion-baseline-report.md) when you need worker telemetry.

**Production routing note:** The **plan** for which model serves live extraction was updated: **Vertex is the production default** (reliable operation + outputs usable for future training under our pipeline). Offline A/B here may still use Fireworks or other OpenAI-compatible endpoints; compare reports by `modelId`, not filename alone.

**Not legal advice.**

---

## 1. Frozen inputs (do not change when pairing)

| Field | Value |
|--------|--------|
| JSONL | [`data/phase1-training-export/golden_holdout.jsonl`](../../data/phase1-training-export/golden_holdout.jsonl) (**723** rows in file) |
| Eval row cap used in all tables below | **`--limit 200`** (first 200 rows, same order as file) |
| `cohortFingerprintSha256_16` | `6ab6bd1d739097a0` |
| `goldenFingerprintSha256_16` | `98abe3de579ef460` |
| Manifest | [`data/phase1-training-export/manifest.json`](../../data/phase1-training-export/manifest.json) (`generatedAt` **2026-04-15** on export used by eval-compare) |

Primary success metric for this JSONL shape: **`subsetTextMatchRate`** (sentence-level gold `text` vs model claim `text`). **`subsetMatchRate`** (text + gold `position_in_source`) stays **low by design** — gold positions are **document-level** while each eval row is a **single-sentence** `input`; see [`scripts/eval-extraction-holdout-openai-compatible.ts`](../../scripts/eval-extraction-holdout-openai-compatible.ts) header and [`extraction-fireworks-deploy.md`](./extraction-fireworks-deploy.md) §5.

---

## 2. Machine evidence — golden **200** (paired slice)

All runs: **`golden_holdout.jsonl`**, **`--limit 200`**, **`--mismatch-diagnostics`** where noted.

| Arm | Report path | `modelId` | `schemaPassRate` | `subsetTextMatchRate` | `subsetMatchRate` | Latency p50 / p95 (ms) | Mismatch `hit` / `gold_text_wrong_position` (eligible ≈199) |
|-----|-------------|-----------|------------------|----------------------|-------------------|-------------------------|---------------------------------------------------------------|
| FT (historical spike) | [`eval-fireworks-extraction.json`](../../data/phase1-training-export/eval-fireworks-extraction.json) | `…/deployments/ytv2kq38` | 0.995 | **1** | **0** | 1856 / 2069 | **0** / **199** |
| FT (Step F, `keo1sj4o`) | [`eval-step-f-golden-200-2026-04-16.json`](../../data/phase1-training-export/eval-step-f-golden-200-2026-04-16.json) | `…/deployments/keo1sj4o` | 0.995 | **1** | **~0.01** | 1843 / 2062 | **2** / **197** |
| FT (combined eval, `hz8ot3bv`) | Embedded in [`eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json`](../../data/phase1-training-export/eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json) → `goldenHoldout.report` | `…/deployments/hz8ot3bv` | 0.995 | **1** | **~0.005** | 1847 / 2088 | **1** / **198** |

**Read-across:** On this **fixed 200-row** slice, **every** Fireworks deployment above hits **`subsetTextMatchRate = 1`** on subset-eligible rows and **`schemaPassRate ≈ 0.995`** (one schema fail per 200 rows — same failure *rate*, not yet proven to be the *same* row without row-id diffing). Latencies are **tight** (~1.8–1.9 s p50). **FT vs FT** on sentence match does **not** separate candidates — the metric is **saturated** here.

### 2.1 Custom Fireworks model vs **Gemini 3 Flash** (same model id as production Vertex)

This rows up **fine-tuned deployment `hz8ot3bv`** (SFT output served on Fireworks) against **`gemini-3-flash-preview`** on the **same** golden JSONL contract. Production ingestion uses **`vertex:gemini-3-flash-preview`** (Vertex routing); the offline run used the **Google Generative Language OpenAI-compatible** host (`https://generativelanguage.googleapis.com/v1beta/openai`) and **`GOOGLE_AI_API_KEY`** — **same model identifier**, different transport/auth than regional Vertex in Cloud Run. **Latency:** treat the table as strong evidence that **FT is much faster on this offline client** and that the flash run carried **heavy tails** (retries, rate limits, or slow responses — not proven which). That is **directional** for “can we shorten extraction wall time?” but **not** a substitute for timing **Vertex** on the real ingest path — see **Outcome** below.

| Arm | Report | Rows | `schemaPassRate` | `subsetTextMatchRate` | Subset-eligible rows | p50 / p95 (ms) |
|-----|--------|------|------------------|----------------------|----------------------|----------------|
| **Custom FT (Fireworks)** | [`eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json`](../../data/phase1-training-export/eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json) → `goldenHoldout.report` | **200** | **0.995** | **1.0** | **199** | **1847** / **2088** |
| **Gemini flash (eval)** | [`eval-golden-baseline-gemini-3-flash-merged-216.json`](../../data/phase1-training-export/eval-golden-baseline-gemini-3-flash-merged-216.json) (merged from `eval-golden-shard{0..3}.json` via [`scripts/merge-extraction-eval-reports.ts`](../../scripts/merge-extraction-eval-reports.ts)) | **216**† | **~0.741** | **~0.419** | **160** | **~31 944** / **~38 512** |

†**Shard merge caveat:** Four parallel **`--limit 50`** shard runs were merged for an **≈200-row** intent; summed **`rowsEvaluated`** is **216** (checkpoint/session overlap on shard 0). For a strict **n=200** headline vs FT, re-run one process with **`--limit 200`** (no sharding) and the same `EXTRACTION_*` profile.

**Outcome (plain language):** A major motivation for this comparison was whether we could **speed up the extraction phase** (and reduce tail behaviour) vs the **Vertex** route we use in production for reliability and **training-data reuse**.

On this slice, the **custom FT model** shows **much lower median latency** on the eval harness, **stronger schema reliability**, and **ceiling sentence match** vs **`gemini-3-flash-preview`** on the Generative Language path. Together with fewer catastrophic rows, that supports a **provisional** read: **FT is likely to be quicker and less prone to rate-limit / retry pain than this flash client** — but **production Vertex** is a **different** stack (OAuth, regional routing, quotas). **Definitive** confirmation needs **controlled test ingestions** (same slugs, pinned env) and comparison of **`stage_ms.extracting`** (and related telemetry) against **historical averages** for Vertex-backed runs.

**Operational caveat:** **Fireworks** has shown **capacity / availability** issues (`RESOURCE_EXHAUSTED`, placement constraints). Attractive offline metrics do not help if the deployment cannot be scheduled when needed — so **reliance on Fireworks as the sole extraction backend** remains a **business and SRE risk** until capacity is stable or a fallback (e.g. Vertex) is explicit in runbooks.

---

## 3. Broader slice inside same eval-compare run (`hz8ot3bv`, limit 200)

From [`eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json`](../../data/phase1-training-export/eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json) `summary`:

| Slice | `schemaPassRate` | `subsetTextMatchRate` | `subsetMatchRate` | p50 / p95 (ms) |
|-------|------------------|----------------------|-------------------|----------------|
| Golden (nested) | 0.995 | **1** | ~0.005 | 1847 / 2088 |
| Remit multi-domain (`eval_remit_multidomain.jsonl`) | **0.985** | **1** | ~0.005 | 1946 / 2377 |

**Read-across:** Remit is **slightly** harder on **schema** (0.985 vs 0.995) but **sentence match stays at ceiling** for this sample. Good sign for **breadth**, still **n = 200** per slice.

---

## 4. Non–FT baseline pairing — **required to finish “vs initial bar”**

You asked to set ingest gates aside but still **pair against a non–FT baseline**. Use a **different** output filename per baseline so you do not overwrite FT-tagged reports.

**Env gotcha:** `.env.local` is loaded with **`override: true`** in `loadServerEnv()`. If **`EXTRACTION_BASE_URL` / `EXTRACTION_MODEL`** are set there, they **win** over shell-prefixed values for the eval process. For a clean baseline run, **comment out** those lines in `.env.local` (as you did) or pass the same routing only via `.env.local` for that session.

### Option A — OpenAI (`gpt-4o-mini` or other)

Requires **`OPENAI_API_KEY`** (or **`EXTRACTION_API_KEY`**) in the env file you pass to `tsx`.

```bash
cd /Users/adamboon/projects/sophia
EXTRACTION_BASE_URL=https://api.openai.com/v1 \
EXTRACTION_MODEL=gpt-4o-mini \
pnpm exec tsx --env-file=.env.local scripts/eval-extraction-holdout-openai-compatible.ts -- \
  --jsonl data/phase1-training-export/golden_holdout.jsonl \
  --limit 200 \
  --mismatch-diagnostics \
  --out data/phase1-training-export/eval-golden-baseline-gpt4o-mini-200.json
```

### Option B — Google **Generative Language API**, OpenAI-compatible ( **`GOOGLE_AI_API_KEY`** )

This path is **`https://generativelanguage.googleapis.com/v1beta/openai`** — the same family of **API-key** access as “Google AI Studio” / Generative Language, **not** the Vertex AI regional REST URL your Cloud Run job may use with **GCP workload identity**. Sophia’s prod **`vertex:gemini-3-flash-preview`** route still names the **same model id**; here you pass that id into the OpenAI-compatible chat surface.

**Will my key work?** Keys created in **Vertex AI Studio → Settings → API keys** often look like **`AQ…`** (not `AIza…`). They are **Gemini API** keys and match the console **`curl`** pattern: **`https://aiplatform.googleapis.com/v1/publishers/google/models/…?key=…`** — the **publisher** REST surface. **Option B** below uses a **different** host: **`generativelanguage.googleapis.com/v1beta/openai`** with the **OpenAI** SDK (`createOpenAI`). Google may accept the same key on both; if you get **401/403**, treat it as a **host/auth mismatch** (key is valid for **publisher** / AI SDK **Google** provider, but not for that OpenAI-compat URL) and use **OAuth + Vertex OpenAI base URL** per [Vertex OpenAI compatibility](https://cloud.google.com/vertex-ai/generative-ai/docs/start/openai) (not wired into `eval-extraction-holdout-openai-compatible.ts` yet).

### How Sophia uses **`GOOGLE_AI_API_KEY`** today (vs your screenshot)

| Surface | Code | What the key authenticates |
|--------|------|-----------------------------|
| **Catalog `vertex` routes** (e.g. prod relations / validation / pinned **`gemini-3-flash-preview`**) | `createGoogleGenerativeAI({ apiKey })` in [`src/lib/server/vertex.ts`](../../src/lib/server/vertex.ts) | Google **Generative AI** / Gemini **API key** flow used by the AI SDK’s Google provider (same env var name as in `.env.local`). |
| **Validation helper** | `@google/generative-ai` `GoogleGenerativeAI(apiKey)` in [`src/lib/server/gemini.ts`](../../src/lib/server/gemini.ts) | Same **`GOOGLE_AI_API_KEY`**. |
| **Embeddings (`vertex`)** | [`src/lib/server/embeddings.ts`](../../src/lib/server/embeddings.ts) | **OAuth Bearer** to **`{region}-aiplatform.googleapis.com/.../predict`** — **not** this API key; uses ADC / project + location. |
| **Holdout eval Option B** | `createOpenAI` + **`EXTRACTION_*`** in [`scripts/eval-extraction-holdout-openai-compatible.ts`](../../scripts/eval-extraction-holdout-openai-compatible.ts) via [`buildExtractionOpenAiCompatibleRoute`](../../src/lib/server/vertex.ts) | **OpenAI-compatible** Gemini HTTP; **`readExtractionOpenAiCompatibleOverride`** supplies the key (including **`GOOGLE_AI_API_KEY`** for `generativelanguage.googleapis.com` hosts). |

Your screenshot is the **Vertex AI Studio** key UI for project **SOPHIA** (`sophia-488807`), key restricted to **Gemini API**, bound to **`vertex-express@…`**. That is the **right class of secret** for the **first two rows** in the table. Option B is **row four** — try it; if it fails, the gap is **OpenAI-compat base URL vs publisher**, not “wrong project.”

**Official Vertex inference reference:** Google’s guide [Generate content with the Gemini API in Vertex AI (model reference / inference)](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference) documents **`generateContent`** / **`streamGenerateContent`**, **Express mode** REST (`v1` / `v1beta1`) vs **`projects.locations…`** publisher and endpoint resources — i.e. the same family of HTTP surfaces as the Studio **`curl`** example (`aiplatform.googleapis.com/v1/publishers/google/models/...`). Use it when reconciling **API key + `?key=`** publisher calls with our **OpenAI-compat** eval path above.

Align with prod flash id (see `INGEST_VERTEX_GEMINI_FLASH_MODEL_ID` in `src/lib/server/ingestPinNormalization.ts`):

```bash
cd /Users/adamboon/projects/sophia
EXTRACTION_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai \
EXTRACTION_MODEL=gemini-3-flash-preview \
pnpm exec tsx --env-file=.env.local scripts/eval-extraction-holdout-openai-compatible.ts -- \
  --jsonl data/phase1-training-export/golden_holdout.jsonl \
  --limit 200 \
  --mismatch-diagnostics \
  --out data/phase1-training-export/eval-golden-baseline-gemini-3-flash-preview-200.json
```

**Troubleshooting `400` — auth:** *Multiple authentication credentials* usually means **Bearer + something else** (e.g. **`x-goog-api-key`** or **`?key=`** on the URL). `getOpenAIForExtractionOverride` (`src/lib/server/vertex.ts`) strips **only** those extras and keeps **`Authorization: Bearer`** (Google rejects the call if Bearer is missing). If errors persist, check for a **global fetch** wrapper or duplicate query keys.

**Verify the report:** open the JSON and confirm **`modelId`** / host match the baseline you intended (an earlier run saved as `eval-golden-baseline-gpt4o-mini-200.json` accidentally recorded **Fireworks** `hz8ot3bv` because `.env.local` still had **`EXTRACTION_*`** set).

**Gemini flash headline metrics** for the golden slice are already recorded in **§2.1** (merged shard JSON). For **OpenAI** (`gpt-4o-mini`), still produce a report whose **`modelId`** / host match OpenAI — **if** `subsetTextMatchRate` and `schemaPassRate` are **non-inferior** to FT on the same row count, the **economic** decision shifts to **cost/latency** and **ingest** behaviour (out of scope here). **If** baseline **beats** FT on schema or text match, **pause** further FT spend until you diagnose (data, prompt fold, temperature, deployment).

---

## 5. Recommendations

1. **Treat current FT evidence as “meets Step F–style golden/remit bars on n=200”** — aligned with the existing **Go** narrative in [`extraction-vendor-ft-spike-eval-record.md`](../local/operations/extraction-vendor-ft-spike-eval-record.md) (schema pilot ~0.995, **`subsetTextMatchRate` 1** on eligible rows). **Do not** claim **strict** `subsetMatchRate` gains; the eval contract makes that metric misleading.

2. **Do not use golden-200 alone to pick between `ytv2kq38` / `keo1sj4o` / `hz8ot3bv`** — sentence-level match is **flat**; choose on **ops** (deployment stability, cost, ingest policy) or **narrower** probes (schema-failure row inspection).

3. **Gemini flash vs FT** on the golden slice is **documented in §2.1** (merged eval). Still run a **valid OpenAI baseline** (or a single-pass **`--limit 200`** Gemini run) before any **prompt** or **training-data** change intended to “beat baseline” — otherwise you cannot attribute deltas across hosts.

4. **Additional testing (recommended order):**
   - **Full golden 723** — same command pair, `--limit 723`, same two `EXTRACTION_*` profiles (baseline + chosen FT). Low incremental ambiguity vs 200 if rates stay stable.
   - **Schema failure archaeology** — `EXTRACTION_EVAL_LOG_FIRST_FAILURE=1` with `--limit 50` on the arm that fails **one** row per 200; confirm whether failures **coincide** across models.
   - **Re-run `pnpm ops:eval-extraction-compare`** after any manifest / `golden_holdout` regeneration (fingerprints **must** match for trend lines).

5. **When ingest gates return:** re-use the same **FT vs baseline** decision only after you add **`[INGEST_TIMING]`** / log-metrics pairs on a **small** fixed URL set (see [`extraction-offline-regression-pack.md`](./extraction-offline-regression-pack.md) §0 / §3a).

6. **Speed + reliability trade-off:** Offline numbers support **faster extraction** and **fewer bad rows** for **FT vs flash on the eval path**; **ingest A/B** validates extraction wall time vs history. **Fireworks availability** is the current gating concern — treat **Vertex** as the dependable default until FT hosting is provably always reachable or a **fallback** is automated. **Concrete hosting options** (Vertex custom endpoint, GKE/vLLM, other GPU APIs, primary+fallback): [extraction-fireworks-deploy.md](./extraction-fireworks-deploy.md) § *Availability, capacity, and alternative hosting*.

---

## 6. Related docs

| Topic | Path |
|-------|------|
| Vendor spike table + commands | [`docs/local/operations/extraction-vendor-ft-spike-eval-record.md`](../local/operations/extraction-vendor-ft-spike-eval-record.md) (under `docs/local/` — **gitignored** in this repo; copy table rows there only if your fork tracks it) |
| A/B protocol (prompt freeze, golden-first commands) | [`extraction-offline-regression-pack.md`](./extraction-offline-regression-pack.md) §0 |
| Step F audit log | [`docs/local/operations/phase2-step-f-local-verification-log.md`](../local/operations/phase2-step-f-local-verification-log.md) |
| Combined eval driver | [`scripts/eval-extraction-compare.ts`](../../scripts/eval-extraction-compare.ts) |
| Fireworks capacity, fallback, alternative hosting | [extraction-fireworks-deploy.md](./extraction-fireworks-deploy.md) § *Availability, capacity, and alternative hosting* |
| Vertex Gemini inference (REST, Express, `generateContent` / `streamGenerateContent`) | [Model reference — inference](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference) |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-16 | Initial report: golden-200 evidence table (three FT deployments), eval-compare summary, catalog baseline command, recommendations, follow-up tests. |
| 2026-04-16 | §4: OpenAI vs **Gemini (Google AI OpenAI-compatible)** baseline commands; `loadServerEnv` override note; wrong-filename incident called out. Code: **`GOOGLE_AI_API_KEY`** fallback for `generativelanguage.googleapis.com` extraction override in `vertex.ts`. |
| 2026-04-16 | §4 Option B: **`gemini-3-flash-preview`** + Studio vs **Vertex-only** key caveat (prod model id, different auth surface). |
| 2026-04-16 | §4: **Vertex AI Studio `AQ…` API keys** — table mapping `GOOGLE_AI_API_KEY` to `vertex.ts` / `gemini.ts` / embeddings / holdout eval; publisher `aiplatform…?key=` vs `generativelanguage…/openai`. |
| 2026-04-16 | Link [Vertex inference model reference](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference) (Express vs regional REST, `generateContent` / `streamGenerateContent`). |
| 2026-04-16 | Troubleshooting: **Multiple authentication credentials** on `generativelanguage…/openai` + `vertex.ts` fetch normalization note. |
| 2026-04-16 | Scope: **production extraction** pinned to **Vertex** (plan change); offline FT A/B may still use Fireworks — see [extraction-ft-lean-plan.md](./extraction-ft-lean-plan.md) § *Production extraction model — Vertex*. |
| 2026-04-16 | **§2.1:** Custom Fireworks **`hz8ot3bv`** vs **`gemini-3-flash-preview`** (merged shard eval, [`eval-golden-baseline-gemini-3-flash-merged-216.json`](../../data/phase1-training-export/eval-golden-baseline-gemini-3-flash-merged-216.json)) — outcome table vs [`eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json`](../../data/phase1-training-export/eval-compare-2026-04-16-fireworks-hz8ot3bv-limit200.json); prod Vertex same model id, different host/auth. |
| 2026-04-16 | §2.1 outcome: **speed hypothesis** (extraction phase); provisional **FT faster / fewer tails** vs Generative Language flash path; **ingest timing** needed vs Vertex history; **Fireworks capacity** as reliability caveat. |
| 2026-04-16 | §5.6 + related docs: link to [extraction-fireworks-deploy.md](./extraction-fireworks-deploy.md) § *Availability, capacity, and alternative hosting* (fallback, Vertex/GKE, other providers). |
