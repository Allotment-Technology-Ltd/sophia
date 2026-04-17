/**
 * Default worker / batch UI values aligned with `scripts/ingest.ts` defaults and the
 * `sophia-ingest-worker` Cloud Run profile (ADMIN_INGEST_MAX_CONCURRENT=3, general LLM stage timeouts 360s, extraction 180s; conservative batch defaults to reduce 429 / TPM / truncation pressure).
 * Used by Admin → Ingest (single run + durable jobs) so operators start from a known-good baseline.
 */
export const ADMIN_INGEST_WORKER_UI_DEFAULTS = {
	extractionConcurrency: '2',
	extractionMaxTokensPerSection: '5000',
	passageInsertConcurrency: '8',
	claimInsertConcurrency: '8',
	remediationMaxClaims: '8',
	relationsBatchOverlapClaims: '3',
	googleExtractionConcurrencyFloor: '6',
	groupingTargetTokens: '72000',
	validationTargetTokens: '100000',
	relationsTargetTokens: '10000',
	/** Default on for large-scale ingest; set worker env `INGEST_RELATIONS_AUTO_TUNE=0` to disable. */
	relationsAutoTune: '1',
	/** Default on for large-scale ingest; set worker env `INGEST_GROUPING_AUTO_TUNE=0` to disable. */
	groupingAutoTune: '1',
	embedBatchSize: '250',
	/** Matches typical worker `INGEST_MODEL_TIMEOUT_MS` / stage caps (ms). */
	ingestModelTimeoutMs: '360000',
	validationModelTimeoutMs: '360000',
	validationStageTimeoutMs: '360000',
	extractionStageTimeoutMs: '180000',
	relationsStageTimeoutMs: '360000',
	groupingStageTimeoutMs: '360000',
	embeddingStageTimeoutMs: '360000',
	jsonRepairStageTimeoutMs: '360000'
};
// Intentionally not `as const`: Svelte `$state(W.*)` must infer `string`, not literal unions, for bound inputs.

/** Native `title` tooltips (hover) — keep under ~600 chars where possible for readability. */
export const ADMIN_INGEST_WORKER_UI_TOOLTIPS = {
	extractionConcurrency:
		'Maps to INGEST_EXTRACTION_CONCURRENCY (batch_overrides.extractionConcurrency). Max parallel single-passage extraction batches when the pipeline can parallelize. Raising it can shorten wall time on many short passages but stacks more concurrent LLM calls; combine with a low durable job concurrency (URLs in parallel) to avoid 429s. If extraction is Vertex/Gemini and Google throughput mode is on, INGEST_GOOGLE_EXTRACTION_CONCURRENCY_FLOOR can raise the effective cap—then prefer lowering job concurrency or this base value first before pushing floor above ~8. For Mistral chat stages, the ingest script also enforces per-model-family RPS spacing (see ingestMistralRpsPace.ts); parallel slots queue on that gate—raising concurrency mainly helps non-Mistral primaries.',

	extractionMaxTokensPerSection:
		'Maps to INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION. Larger sections mean fewer extraction calls but bigger prompts and higher truncation / JSON repair risk. Lower if you see truncation or repair loops; raise only when passages are stable and under context limits.',

	passageInsertConcurrency:
		'Maps to INGEST_PASSAGE_INSERT_CONCURRENCY (Surreal Stage 6). Higher = faster store but more DB pressure and contention. If you raise this, keep claim insert concurrency moderate first; if Surreal shows timeouts, lower both.',

	claimInsertConcurrency:
		'Maps to INGEST_CLAIM_INSERT_CONCURRENCY (Surreal Stage 6). Higher = faster claim writes. If you raise passage + claim inserts together, watch for DB rate limits; if ingest is slow on the model side, raising store concurrency alone will not help.',

	remediationMaxClaims:
		'Maps to INGEST_REMEDIATION_MAX_CLAIMS. Caps how many low-faithfulness claims get a remediation pass when validation is on. Raising increases cost and time; lowering speeds completion but may leave more claims un-remediated.',

	relationsBatchOverlapClaims:
		'Maps to RELATIONS_BATCH_OVERLAP_CLAIMS. Overlap preserves context between adjacent relation batches. Increasing overlap increases tokens per batch; if you raise overlap, consider lowering relations batch target tokens so TPM stays manageable.',

	ingestProvider:
		'Maps to INGEST_PROVIDER. auto: use canonical pipeline (Gemini-on-Vertex first, Mistral fallbacks) + Restormel routing. vertex / anthropic / mistral bias the resolver; mistral can help free-tier Gemini experiments but hits **per-model RPS and TPM** caps quickly (e.g. medium ~0.42 RPS, many chat models ~1 RPS, some SKUs ~50k TPM). Forced mistral runs apply built-in RPS pacing between chat calls; add INGEST_PROVIDER_TPM_BUDGET=mistral:42000 if your dashboard shows a 50k-class TPM ceiling. Disable pacing only with INGEST_MISTRAL_RPS_PACING=off when you have paid headroom.',

	googleThroughput:
		'Maps to INGEST_GOOGLE_GENERATIVE_THROUGHPUT (1=on). When on: Vertex embedding path uses zero inter-batch delay unless VERTEX_EMBED_BATCH_DELAY_MS is explicitly set; parallel Vertex/Gemini extraction can use a higher floor. Turn off to revert to conservative pacing if you see 429 / RESOURCE_EXHAUSTED. Durable jobs pin Voyage embeddings—this toggle still affects extraction parallelism for Gemini routes.',

	googleExtractionFloor:
		'Maps to INGEST_GOOGLE_EXTRACTION_CONCURRENCY_FLOOR (1–12, only when extraction is Vertex/Gemini and throughput mode is on). Raising reduces extraction time for single-passage batches but multiplies concurrent Gemini calls; if you increase floor, lower durable job concurrency or INGEST_EXTRACTION_CONCURRENCY to stay inside RPM/TPM.',

	forceReingest:
		'Maps to INGEST_FORCE_REINGEST. When on, re-runs from extraction even if Surreal ingestion_log is complete (same as --force-stage extracting). Leave off for normal durable batches so checkpoint resumes after cancel/deploy are not overridden—the worker forces INGEST_FORCE_REINGEST=0 on resume-from-failure spawns. Turn on only when you intentionally want full re-churn of URLs that already show complete in Surreal.',

	failOnGroupingCollapse:
		'Maps to INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE. Strict (on) fails the run on integrity issues; off only warns. If you turn off strict grouping, review downstream validation and store quality manually.',

	ingestLogPins:
		'Maps to INGEST_LOG_PINS. Extra [INGEST_PINS] lines in logs for Restormel routing—useful for debugging, noisier in production. Turn off once routing is stable.',

	remediationEnabled:
		'When validation is on: maps to INGEST_REMEDIATION. Disabling skips remediation (faster, cheaper) but leaves low-faithfulness claims as-is unless you handle them elsewhere.',

	remediationRevalidate:
		'Maps to INGEST_REMEDIATION_REVALIDATE (`1` / `true` / `full`). **Full** second validation on the post-repair graph — roughly doubles validation calls vs a single pass. By default ingest runs **targeted** revalidation (only batches that touch repaired claims) unless you set INGEST_REMEDIATION_TARGETED_REVALIDATE=0. If 429s spike after remediation, disable full revalidate and/or targeted revalidate before lowering concurrency.',

	remediationTargetedRevalidate:
		'Maps to INGEST_REMEDIATION_TARGETED_REVALIDATE (default on). After claim repair, re-run only validation batches intersecting repaired positions, then merge — cheaper than a full second pass. Set `0` / `false` to skip entirely when you accept pre-repair validation scores for untouched claims.',

	watchdogPhaseIdleJson:
		'Maps to INGEST_WATCHDOG_PHASE_IDLE_JSON (JSON, ms per phase). Per-phase idle limits before Neon watchdog marks a run stuck. Tighter values fail faster on hangs but risk false positives on slow stages; if you tighten here, consider raising INGEST_WATCHDOG_PHASE_BASELINE_MULT slightly only if legitimate slow stages get killed.',

	watchdogBaselineMult:
		'Maps to INGEST_WATCHDOG_PHASE_BASELINE_MULT. Multiplier on phase baselines for slow sources. Raising reduces false watchdog kills on heavy books; lowering catches stuck runs sooner.',

	jobConcurrency:
		`Parallel URLs per durable job (clamped to MAX_DURABLE_INGEST_JOB_CONCURRENCY, typically 3). Counts only runs that are still in LLM phases; once a child enters Surreal Stage 6 (store), its LLM slot frees for another pending URL while store I/O continues. When every active child is in store, the job poller still starts at most one new URL per tick so pending items do not all launch in one burst. Raising ingests more sources at once but competes with ADMIN_INGEST_MAX_CONCURRENT on the worker and Surreal write load—if you see launch throttling or 429s, lower job concurrency before raising per-URL extraction parallelism.`,

	validateLlm:
		'Runs cross-model validation and optional remediation—higher quality and cost. If validation is off, remediation toggles below are ignored.',

	validationTailOnly:
		'Passes `--force-stage validating` to `scripts/ingest.ts`: skips extract / relate / group / embed only if this **same** `INGEST_ORCHESTRATION_RUN_ID` already has checkpoints through embedding (Neon staging + partial). `INGEST_FORCE_REINGEST` is stripped in this mode. Durable jobs also set `INGEST_FORCE_STAGE_MISSING_CHECKPOINT=resume` by default (best partial if checkpoints are missing); override with `error` or `full` in worker defaults JSON if you need strict failure or a full re-extract. On a **brand-new** durable job item the child run id is new, so the **first** start has no such checkpoints — leave this off until that URL has finished through embedding once (or use `scripts/replay-ingest.ts` / admin resume on an existing run). Remediation re-embeds only edited claims. If Surreal `ingestion_log.stage_completed` is already past embedding (e.g. `remediating` after remediation, or deploy mid-store), ingest **does not rewind** to validation — it resumes after the later of the force floor and that checkpoint (store-only when remediation is done). Optional: set worker env `INGEST_SKIP_STORE_WHEN_NO_GRAPH_CHANGES=1` with `--validate` to skip Surreal Stage 6 when post-validation graph mutations are absent and a `source` row already exists (ingestion_log stays at validating/remediating until a full store).',

	mergeIntoRunningJob:
		'When starting a durable ingest job: if a job is already running, append these URLs to that job’s pending queue instead of creating a second job. Fewer concurrent schedulers compete for ADMIN_INGEST_MAX_CONCURRENT worker slots. Turn off when you want a separate job (different notes, isolation, or parallel batches).',

	phase1ValidationTailPresets:
		'Loads frozen golden URLs plus the Neon training-acceptable cohort (same window as “Cohort days”, `payload.validate=true` only), dedupes by canonical URL, fills the URL list, turns on “Run LLM validation stage” and “Validation tail only”, and clears full re-ingest. The training side uses the same governance + `timingTelemetry.stage_models` lineage rules as Admin → Dataset coverage “training acceptable” (it does **not** require `stage_ms` in the envelope; Phase 0 cost scripts still filter to `stage_ms` only). Use after each URL has completed through embedding at least once for the child run you care about (or replay an existing run); first start on a brand-new item id still has no checkpoints for `--force-stage validating`.',

	ingestionAdvisorMode:
		'Source pre-scan only (not the full ingest worker). Off: heuristic advisor without an extra model call. Shadow: runs the advisor model and shows suggestions in the UI without applying. Auto: may apply changes when the auto-apply checkboxes below are enabled—extra latency and token cost per pre-scan.',

	ingestionAdvisorAutoApplyPreset:
		'When advisor mode is Auto: after pre-scan, overwrite per-stage model picks with AI-suggested production defaults. Turn off if you hand-tuned routing and only want to read shadow suggestions.',

	ingestionAdvisorAutoApplyValidation:
		'When advisor mode is Auto: after pre-scan, overwrite the validation-stage enablement the advisor recommends. If you are intentionally running without validation for speed or quota, turn this off so pre-scan does not flip validation back on.',

	groupingTargetTokens:
		'Maps to GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS. Larger batches = fewer grouping calls but heavier requests; lower if grouping timeouts or rate limits appear. The ingest script pre-splits when estimated JSON output would exceed max_output (INGEST_GROUPING_OUTPUT_VS_INPUT_FACTOR, INGEST_GROUPING_OUTPUT_HEADROOM) and when a batch exceeds the claim cap (INGEST_GROUPING_MAX_CLAIMS_PER_BATCH — default 72 when unset; dense SEP-style sources can pack many short claims under a token budget, which inflates structured-generation wall time). Raises Gemini max_output unless INGEST_GROUPING_MAX_OUTPUT_TOKENS is set. Disable pre-split with INGEST_GROUPING_PREEMPT_OUTPUT_SPLITS=0 if you intentionally run one huge batch.',

	groupingAutoTune:
		'Maps to INGEST_GROUPING_AUTO_TUNE. Default **1** (on): ingest may lower the effective grouping batch target on risky graphs before model caps — see resolveGroupingAutoBatchTarget.ts. Set to 0 to disable.',

	validationTargetTokens:
		'Maps to VALIDATION_BATCH_TARGET_TOKENS (when validation is on). Larger batches bundle more claims per validation call—watch TPM; lower if validation retries spike.',

	relationsTargetTokens:
		'Maps to RELATIONS_BATCH_TARGET_TOKENS. Default in code is 10000 for TPM safety. Raising can reduce relation batch count but risks rate limits; if you raise target tokens, consider lowering relations overlap claims.',

	relationsAutoTune:
		'Maps to INGEST_RELATIONS_AUTO_TUNE. Default **1** (on): ingest lowers the effective relations batch target on large claim graphs (before model ceiling caps) to reduce TPM splits and 429s — see resolveRelationsAutoBatchTarget.ts. Pair with INGEST_RELATIONS_AUTO_CAP_TOKENS (default 8000) and thresholds. Set to 0 to disable.',

	embedBatchSize:
		'Maps to VERTEX_EMBED_BATCH_SIZE (embedding API chunk size). Larger batches mean fewer round trips but larger bursts toward quota; for Voyage, same chunking applies in embedTexts. If you raise batch size, set VERTEX_EMBED_BATCH_DELAY_MS > 0 or disable Google throughput mode to add pacing when on Vertex embeddings.',

	ingestModelTimeoutMs:
		'Maps to INGEST_MODEL_TIMEOUT_MS. Wall time per generic model call budget. Raising avoids premature timeouts on huge sources; lowering fails fast but may abort recoverable slow calls.',

	validationModelTimeoutMs:
		'Maps to VALIDATION_MODEL_TIMEOUT_MS. Per-call ceiling when INGEST_STAGE_VALIDATION_TIMEOUT_MS is unset. If you raise batch validation target tokens, raise this or the stage timeout together or you will see mid-batch timeouts before the stage budget is hit.',

	validationStageTimeoutMs:
		'Maps to INGEST_STAGE_VALIDATION_TIMEOUT_MS. Whole-stage budget for validation. If you raise VALIDATION_BATCH_TARGET_TOKENS, raise this (or per-call VALIDATION_MODEL_TIMEOUT_MS) so batches do not hit mid-stage timeouts.',

	extractionStageTimeoutMs:
		'Maps to INGEST_STAGE_EXTRACTION_TIMEOUT_MS (default 180000 in worker UI; unset in shell uses ingest.ts 180s fallback). Increase for very large books; decrease to surface stuck extraction sooner — timed-out batches split (including single-passage text bisect).',

	relationsStageTimeoutMs:
		'Maps to INGEST_STAGE_RELATIONS_TIMEOUT_MS. Whole-stage budget for relation discovery. If you raise RELATIONS_BATCH_TARGET_TOKENS or RELATIONS_BATCH_OVERLAP_CLAIMS, allow more time here or lower batch targets to avoid timing out late in the stage.',

	groupingStageTimeoutMs:
		'Maps to INGEST_STAGE_GROUPING_TIMEOUT_MS. Whole-stage budget for grouping. If you raise GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS, fewer calls but heavier payloads—raise this timeout or lower target tokens if grouping starts failing near the end of long sources.',

	embeddingStageTimeoutMs:
		'Maps to INGEST_STAGE_EMBEDDING_TIMEOUT_MS. Large corpora may need a higher ceiling; if embedding completes but slowly, raise before raising batch size.',

	jsonRepairStageTimeoutMs:
		'Maps to INGEST_STAGE_JSON_REPAIR_TIMEOUT_MS. Short repair calls rarely need huge values unless prompts are enormous.'
} as const;
