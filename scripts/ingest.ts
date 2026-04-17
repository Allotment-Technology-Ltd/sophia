/**
 * SOPHIA — Main Ingestion Pipeline
 *
 * Processes a philosophical source through the complete pipeline:
 * Extract → Relate → Group → Embed → Validate → Store
 *
 * Usage: npx tsx --env-file=.env scripts/ingest.ts <source-file-path> [--validate]
 *
 * The source-file-path should be a .txt file in data/sources/ with a matching .meta.json
 *
 * Resume: The pipeline is automatically resumable. If a previous run failed or was
 * interrupted, re-running with the same source will pick up where it left off.
 * Progress is tracked in the ingestion_log table in SurrealDB.
 *
 * Self-healing (optional): set INGEST_RECOVERY_AGENT=1 to consult a small routed model after
 * normal per-stage retries exhaust, for bounded backoff + one extra attempt on transient errors only.
 */

import { createHash } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Surreal } from 'surrealdb';
import { signinSurrealWithFallback } from './lib/surrealSignin.js';
import { resolveSurrealRpcUrl } from '../src/lib/server/surrealEnv.ts';
import { generateObject, generateText } from 'ai';
import {
	estimateIngestLlmUsageUsd,
	INGEST_EMBED_USD_PER_MILLION_CHARS
} from '../src/lib/server/ingestion/ingestLlmTokenUsdRates.ts';
import {
	embedTexts,
	EMBEDDING_DIMENSIONS,
	EMBEDDING_MODEL,
	getEmbeddingProvider
} from '../src/lib/server/embeddings.js';
import { withEmbedPhaseSlot } from '../src/lib/server/ingestion/ingestPhaseSlot.js';
import {
	emitIngestTelemetry,
	runWithIngestTelemetryHeartbeat
} from '../src/lib/server/ingestion/ingestionTelemetry.js';
import { buildIngestMetricsAdvisory } from '../src/lib/server/ingestion/ingestRunMetricsAdvisor.js';
import { shouldOmitGenerateTextTemperature } from '../src/lib/server/ingestion/ingestGenerateTextTemperature.ts';
import {
	parseExtractionJsonFromModelResponse,
	parseJsonFromModelResponse
} from '../src/lib/server/ingestion/extractionModelJsonParse.ts';
import {
	assertSepPresetDiscipline,
	buildSepPresetFingerprint,
	parsePresetDisciplineMode
} from '../src/lib/server/ingestion/presetDiscipline.js';
import {
	resolvePostStoreClaimReviewState,
	resolvePostStoreVerificationState,
	type ReviewState as PostStoreReviewState
} from '../src/lib/server/ingestion/postStoreReview.js';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.js';
import {
	isGoogleGenerativePlanProvider,
	isGoogleGenerativeThroughputEnabled
} from '../src/lib/server/googleGenerativeIngestThroughput.js';
import { z } from 'zod';
import {
	estimateStageUsage,
	planIngestionStage,
	planIngestionStageWithExplicitModel,
	type IngestionStage,
	type IngestionStagePlan,
	type IngestProviderPreference,
	type IngestionPlanningContext
} from '../src/lib/server/aaif/ingestion-plan.js';
import {
	canonicalModelChainForStage,
	type IngestionLlmStageKey
} from '../src/lib/ingestionCanonicalPipeline.js';
import {
	filterModelTiersForFinetunePolicy,
	ingestFinetuneLabelerStrictEnabled,
	isFinetuneSensitiveLlmStage,
	parseFinetuneLabelerAllowedProviders
} from '../src/lib/ingestionFinetuneLabelerPolicy.js';
import {
	normalizePinnedModelId,
	summarizeIngestPinsForLog
} from '../src/lib/server/ingestPinNormalization.js';
import {
	findDoneIngestRunIdsWithStagingMetaForCanonicalUrl,
	findNeonStagingRunIdForValidationTailBySlug,
	findNeonStagingRunIdsForValidationTailByCanonicalUrlHash,
	findNeonStagingRunIdsForValidationTailBySlugOrUrl,
	loadIngestPartialFromNeon,
	saveIngestPartialToNeon
} from '../src/lib/server/db/ingestStaging.js';
import {
	capIngestBatchTargetForPlan,
	isContextLengthExceededError
} from '../src/lib/server/ingestion/modelBatchCaps.js';
import type { IngestCatalogRoutingJson } from '../src/lib/server/ingestCatalogRouting.js';
import {
	bumpIngestModelFailureInDb,
	bumpIngestStageModelFailureInDb,
	loadIngestLlmFailureCountsFromDb,
	loadIngestLlmStageFailureCountsFromDb,
	noteIngestModelSuccessInDb,
	noteIngestStageModelSuccessInDb
} from '../src/lib/server/db/ingestModelHealth.js';
import {
	getSourceTrainingGovernanceExcluded,
	resolveExcludeSourceFromModelTrainingForIngest,
	upsertSourceTrainingGovernanceOnIngestComplete
} from '../src/lib/server/db/sourceTrainingGovernance.js';
import { INGEST_EXIT_FORCE_STAGE_CHECKPOINT_MISSING } from '../src/lib/server/ingestion/ingestProcessExitCodes.js';
import {
	INGEST_PIPELINE_STAGES_ORDER as STAGES_ORDER,
	completedStageOrderRank,
	ingestionLogStatusReflectingCheckpoint,
	laterCompletedStage,
	validationOnlyEmbeddingCheckpointMet
} from '../src/lib/server/ingestion/ingestResumeStage.ts';
import { isNeonIngestPersistenceEnabled } from '../src/lib/server/neon/datastore.ts';
import {
	SOURCE_ID_STRING_ARRAY_ONE_SQL,
	SOURCE_ID_STRING_SQL,
	normalizeBareWikidataQidToThinkerRecordId,
	recordKeyForTable,
	splitRecordTableAndKey,
	toSurrealRecordIdStr
} from '../src/lib/server/surrealRecordSql.js';
import { createIngestProviderTpmGuard } from './lib/ingestProviderTpm.js';
import { paceDeepseekChatCompletion } from './lib/ingestDeepseekRpsPace.js';
import { paceGroqChatCompletion } from './lib/ingestGroqRpsPace.js';
import { paceMistralChatCompletion } from './lib/ingestMistralRpsPace.js';
import { collectErrorMessageChain, isTpmOrRateLimitInError } from '../src/lib/ingestionErrorChain.js';
import {
	consultIngestionRecoveryAgent,
	effectiveRecoverySleepMs,
	ingestRecoveryAgentEnabled,
	isRetryableIngestModelError,
	parseRetryAfterMsFromProviderMessage
} from '../src/lib/server/ingestion/recoveryAgent.js';
import { formatIngestSelfHealLine } from '../src/lib/server/ingestion/selfHealLog.js';
import { formatDuration, startSpinner } from './progress.js';

// ─── Prompt imports (relative paths for standalone script) ─────────────────
import {
	EXTRACTION_SYSTEM,
	EXTRACTION_USER,
	ExtractionOutputSchema,
	type ExtractionClaim,
	type ExtractionOutput
} from '../src/lib/server/prompts/extraction.js';

import {
	RELATIONS_SYSTEM,
	RELATIONS_USER,
	RelationsOutputSchema,
	type Relation,
	type RelationsOutput
} from '../src/lib/server/prompts/relations.js';

import {
	GROUPING_SYSTEM,
	GROUPING_USER,
	GroupingOutputSchema,
	GroupingStructuredRootSchema,
	type Argument,
	type GroupingOutput
} from '../src/lib/server/prompts/grouping.js';
import {
	analyzeGroupingReferenceHealth,
	filterGroupingOutputToKnownClaimPositions,
	normalizeGroupingPayload
} from '../src/lib/server/ingestion/stages/grouping-helpers.js';
import { resolveGroupingAutoBatchTarget } from '../src/lib/server/ingestion/resolveGroupingAutoBatchTarget.js';
import { resolveRelationsAutoBatchTarget } from '../src/lib/server/ingestion/resolveRelationsAutoBatchTarget.js';
import { normalizeExtractionPayload } from '../src/lib/server/ingestion/stages/extraction-helpers.js';
import {
	summarizeRemediationRevalidationDiff,
	type RemediationRevalidationDiff
} from '../src/lib/server/ingestion/stages/validation-helpers.js';
import { coerceIngestDomainLabel } from '../src/lib/server/prompts/domainZod.js';

import {
	VALIDATION_SYSTEM,
	VALIDATION_USER,
	normalizeValidationOutput,
	type ValidationOutput
} from '../src/lib/server/prompts/validation.js';
import {
	REMEDIATION_REPAIR_SYSTEM,
	REMEDIATION_REPAIR_USER,
	normalizeRemediationRepairOutput
} from '../src/lib/server/prompts/remediation.js';
import {
	dropRelationsByValidation,
	filterValidationBatchesTouchingClaimPositions,
	selectRemediationPositions,
	sliceSourceAroundClaim,
	shouldRerunRelationsAfterRemediation
} from '../src/lib/server/ingestion/remediationLogic.js';
import { parseRemediationPolicyJson } from '../src/lib/server/ingestion/remediationPolicy.js';
import { rerunRelationsAndGroupingForRemediation } from './ingestRemediationRerunHelper.js';
import {
	buildPassageBatches,
	renderPassageBatch,
	segmentArgumentativePassages,
	splitPassageRecordForExtractionRetry,
	filterBoilerplatePassages
} from '../src/lib/server/ingestion/passageSegmentation.js';
import {
	buildValidationSourceSnippet,
	splitClaimsForValidationSnippetBudget
} from '../src/lib/server/ingestion/buildValidationSourceSnippet.js';
import { deriveClaimTypingMetadata } from '../src/lib/server/ingestion/claimTyping.js';
import {
	canonicalizeThinkerName,
	estimateThinkerNameConfidence,
	pickThinkerAutoLinkCandidate,
	type ThinkerIdentityCandidate
} from '../src/lib/server/thinkerIdentity.js';
import type {
	PassageRecord,
	PhaseOneClaimMetadata,
	PhaseOneRelationMetadata,
	ReviewState
} from '../src/lib/server/ingestion/contracts.js';

type StageKey =
	| 'extraction'
	| 'relations'
	| 'grouping'
	| 'validation'
	| 'remediation'
	| 'embedding'
	| 'json_repair';

// ─── Configuration ─────────────────────────────────────────────────────────
const ingestTpmGuard = createIngestProviderTpmGuard();

const INGEST_PROVIDER_DEFAULT = (process.env.INGEST_PROVIDER || 'auto').toLowerCase();

const SURREAL_URL = resolveSurrealRpcUrl();
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';
const GOOGLE_VERTEX_PROJECT = process.env.GOOGLE_VERTEX_PROJECT || process.env.GCP_PROJECT_ID || '';
const GOOGLE_VERTEX_LOCATION = process.env.GOOGLE_VERTEX_LOCATION || process.env.GCP_LOCATION || 'us-central1';
const DB_CONNECT_MAX_RETRIES = Number(process.env.DB_CONNECT_MAX_RETRIES || '4');
const DB_CONNECT_RETRY_BASE_MS = Number(process.env.DB_CONNECT_RETRY_BASE_MS || '750');
/** Default 6m for most LLM stages; extraction uses a shorter per-call default in `makeStageBudget` (see there). */
const INGEST_MODEL_TIMEOUT_MS = Number(process.env.INGEST_MODEL_TIMEOUT_MS || '360000');
/** When `INGEST_STAGE_EXTRACTION_TIMEOUT_MS` is unset: fail fast on stalled serverless extraction (split widens batches on timeout). */
const INGEST_EXTRACTION_TIMEOUT_FALLBACK_MS = Number(process.env.INGEST_EXTRACTION_TIMEOUT_FALLBACK_MS || '180000');
const VALIDATION_MODEL_TIMEOUT_MS = Number(process.env.VALIDATION_MODEL_TIMEOUT_MS || '300000');

/** Fallback when `INGEST_STAGE_EXTRACTION_MAX_OUTPUT_TOKENS` is unset (assert-only cap still uses env). */
const DEFAULT_INGEST_STAGE_EXTRACTION_MAX_OUTPUT_TOKENS = 8192;
/**
 * Fallback when `INGEST_STAGE_JSON_REPAIR_MAX_OUTPUT_TOKENS` is unset — tight cap so repair does not
 * request 32k completions by default (see `maxOutputTokensForJsonRepair`).
 */
const DEFAULT_INGEST_STAGE_JSON_REPAIR_MAX_OUTPUT_TOKENS = 8192;

const INGEST_MODEL_JSON_LOG_HEAD_CHARS = 400;
const INGEST_MODEL_JSON_LOG_TAIL_CHARS = 160;

const INGESTED_DIR = './data/ingested';
const INGEST_PREFILTER_ENABLED = process.env.INGEST_PREFILTER_ENABLED !== 'false';
const INGEST_VALIDATION_SAMPLE_RATE = Math.max(0, Math.min(1,
	Number(process.env.INGEST_VALIDATION_SAMPLE_RATE || '1.0')
));

function parseUint32Env(raw: string | undefined): number | null {
	const t = (raw ?? '').trim();
	if (!t) return null;
	const n = Number(t);
	if (!Number.isFinite(n)) return null;
	return n >>> 0;
}

/** When set with `INGEST_VALIDATION_SAMPLE_RATE` below 1, batch subsampling order is deterministic (BML / regression). */
const INGEST_VALIDATION_SAMPLE_SEED = parseUint32Env(process.env.INGEST_VALIDATION_SAMPLE_SEED);

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a += 0x6d2b79f5;
		let t = Math.imul(a ^ (a >>> 15), a | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Default `cli` respects `--validate`; `off` skips validation; `full`/`sampled` force validation (sampled uses INGEST_VALIDATION_SAMPLE_RATE). */
function resolveShouldValidate(cliFlag: boolean): boolean {
	const mode = (process.env.INGEST_VALIDATION_MODE ?? 'cli').trim().toLowerCase();
	if (mode === 'off' || mode === 'none' || mode === 'skip') return false;
	if (mode === 'full' || mode === 'on' || mode === 'always' || mode === 'sampled') return true;
	return cliFlag;
}

/** Aliases so operators can set INGEST_EMBED_* without remembering VERTEX_* names. */
function applyIngestEmbeddingEnvOverrides(): void {
	const bs = process.env.INGEST_EMBED_BATCH_SIZE?.trim();
	if (bs) process.env.VERTEX_EMBED_BATCH_SIZE = bs;
	const bd = process.env.INGEST_EMBED_BATCH_DELAY_MS?.trim();
	if (bd) process.env.VERTEX_EMBED_BATCH_DELAY_MS = bd;
}

/** Post-store: queue low faithfulness claims for human review (see docs/local/operations/ingestion-sep-preset-discipline.md). */
const INGEST_POST_STORE_LOW_VALIDATION_THRESHOLD = (() => {
	const raw = process.env.INGEST_POST_STORE_LOW_VALIDATION_REVIEW_THRESHOLD?.trim();
	if (!raw) return null;
	const n = Number(raw);
	if (!Number.isFinite(n)) return null;
	return Math.max(0, Math.min(100, n));
})();
const INGEST_POST_STORE_LOW_VALIDATION_SAMPLE_RATE = Math.max(
	0,
	Math.min(1, Number(process.env.INGEST_POST_STORE_LOW_VALIDATION_SAMPLE_RATE || '1'))
);
const INGEST_POST_STORE_FLAG_VERIFICATION_LOW_VALIDATION =
	(process.env.INGEST_POST_STORE_FLAG_VERIFICATION_LOW_VALIDATION ?? '').trim() === '1' ||
	(process.env.INGEST_POST_STORE_FLAG_VERIFICATION_LOW_VALIDATION ?? '').trim().toLowerCase() === 'true';

/** Persist SHA-256 of raw source text on Surreal `source` (optional field; helps idempotency audits). */
const INGEST_STORE_RECORD_TEXT_HASH = (() => {
	const v = (process.env.INGEST_STORE_RECORD_TEXT_HASH ?? '1').trim().toLowerCase();
	return v !== '0' && v !== 'false' && v !== 'no';
})();
/** Abort store if an existing row has a different text hash (same canonical URL). */
const INGEST_STORE_ENFORCE_TEXT_HASH =
	(process.env.INGEST_STORE_ENFORCE_TEXT_HASH ?? '').trim() === '1' ||
	(process.env.INGEST_STORE_ENFORCE_TEXT_HASH ?? '').trim().toLowerCase() === 'true';
/** When false, skip DEFINE FIELD IF NOT EXISTS on `source` during store (schema assumed applied; less DDL contention on Surreal Cloud). */
function ingestStoreEnsureSurrealSourceFields(): boolean {
	const v = (process.env.INGEST_STORE_ENSURE_SURREAL_SOURCE_FIELDS ?? '1').trim().toLowerCase();
	return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}
/** Prefer one compound Surreal query for source cleanup (LET claim ids + deletes). Set 0 for legacy per-table round-trips. */
function ingestStoreCleanupUseBatchedSurreal(): boolean {
	const v = (process.env.INGEST_STORE_CLEANUP_BATCHED ?? '1').trim().toLowerCase();
	return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}
const INGEST_EXTRACTOR_VERSION =
	process.env.INGEST_EXTRACTOR_VERSION || 'phase1-passage-grounding-v1';
const LOW_CONFIDENCE_REVIEW_THRESHOLD = Number(
	process.env.INGEST_LOW_CONFIDENCE_REVIEW_THRESHOLD || '0.65'
);
const THINKER_AUTO_LINK_MIN_CONFIDENCE = Number(
	process.env.THINKER_AUTO_LINK_MIN_CONFIDENCE || '0.86'
);
const THINKER_AUTO_LINK_MIN_DELTA = Number(process.env.THINKER_AUTO_LINK_MIN_DELTA || '0.08');
// Keep sections small enough that Claude's extraction output fits within max_tokens (32768).
// Each claim is ~150 tokens of JSON. At 10 claims/1k input tokens:
//   5_000 tokens input → ~50 claims → ~7_500 tokens output → fits in 32768 limit with safety margin.
const MAX_TOKENS_PER_SECTION = Number(process.env.INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION || '5000');
const BOOK_MAX_TOKENS_PER_SECTION = Number(process.env.BOOK_MAX_TOKENS_PER_SECTION || '3000');
/** Default lowered (2026-04) after fleet advisories: large batches hit output/truncation limits; smaller batches trade calls for stability. */
const GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS =
	parsePositiveInt(process.env.GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS) ?? 72_000;
const GROUPING_ANTHROPIC_TOKEN_ESTIMATE_MULTIPLIER = Math.max(
	1,
	Number(process.env.GROUPING_ANTHROPIC_TOKEN_ESTIMATE_MULTIPLIER || '2.2')
);
/** Heuristic: structured grouping JSON output vs claim JSON input (tune if you see truncation before pre-split triggers). */
const GROUPING_OUTPUT_VS_INPUT_FACTOR = Math.max(
	1,
	Math.min(4, Number(process.env.INGEST_GROUPING_OUTPUT_VS_INPUT_FACTOR ?? '1.85') || 1.85)
);
/** Fraction of maxOutputTokens used as ceiling for {@link estimatedGroupingStructuredOutputTokens} pre-split. */
const GROUPING_OUTPUT_HEADROOM = Math.max(
	0.5,
	Math.min(0.95, Number(process.env.INGEST_GROUPING_OUTPUT_HEADROOM ?? '0.82') || 0.82)
);
const VALIDATION_BATCH_TARGET_TOKENS =
	parsePositiveInt(process.env.VALIDATION_BATCH_TARGET_TOKENS) ?? 100_000;
const VALIDATION_BATCH_SOURCE_MAX_CHARS =
	parsePositiveInt(process.env.VALIDATION_BATCH_SOURCE_MAX_CHARS) ?? 24_000;
const VALIDATION_BATCH_SOURCE_CONTEXT_CHARS =
	parsePositiveInt(process.env.VALIDATION_BATCH_SOURCE_CONTEXT_CHARS) ?? 800;
/** Default 3: BML (2026-04) on Descartes lowered total wall vs 2.2 with same validation batch count — override with VALIDATION_TOKEN_ESTIMATE_MULTIPLIER. */
const VALIDATION_TOKEN_ESTIMATE_MULTIPLIER = Math.max(
	1,
	Number(process.env.VALIDATION_TOKEN_ESTIMATE_MULTIPLIER || '3')
);
/** Post-validation repair: enabled when --validate unless INGEST_REMEDIATION=0 */
function ingestRemediationEnabled(): boolean {
	const v = (process.env.INGEST_REMEDIATION ?? '').trim().toLowerCase();
	if (v === '0' || v === 'false' || v === 'no') return false;
	return true;
}
/** Default 85 (2026-04): stricter repair queue vs legacy 80 — override with INGEST_REMEDIATION_FAITHFULNESS_MIN. */
const INGEST_REMEDIATION_FAITHFULNESS_MIN = Math.max(
	0,
	Math.min(100, Number(process.env.INGEST_REMEDIATION_FAITHFULNESS_MIN ?? '85') || 85)
);
/** Default 8: latency/cost guardrail (BML 2026-04); raise via INGEST_REMEDIATION_MAX_CLAIMS when more repairs are worth the spend. */
const INGEST_REMEDIATION_MAX_CLAIMS = (() => {
	const raw = Number(process.env.INGEST_REMEDIATION_MAX_CLAIMS ?? '8');
	if (!Number.isFinite(raw) || raw <= 0) return 24;
	return Math.max(1, Math.trunc(raw));
})();
/** Default 85 (2026-04): align with stricter validation — override with INGEST_REMEDIATION_VALIDITY_MIN. */
const INGEST_REMEDIATION_VALIDITY_MIN = Math.max(
	0,
	Math.min(100, Number(process.env.INGEST_REMEDIATION_VALIDITY_MIN ?? '85') || 85)
);
/** Full second validation pass on the post-repair graph (expensive). */
const INGEST_REMEDIATION_REVALIDATE =
	(process.env.INGEST_REMEDIATION_REVALIDATE ?? '').trim().toLowerCase() === '1' ||
	(process.env.INGEST_REMEDIATION_REVALIDATE ?? '').trim().toLowerCase() === 'true' ||
	(process.env.INGEST_REMEDIATION_REVALIDATE ?? '').trim().toLowerCase() === 'full';
/**
 * When true (default), after claim repair re-run only validation batches that touch repaired positions,
 * then merge — not a full-graph second pass. Set `INGEST_REMEDIATION_TARGETED_REVALIDATE=0` to skip.
 * Superseded when `INGEST_REMEDIATION_REVALIDATE` / `force_revalidate` (full pass) is on.
 */
const INGEST_REMEDIATION_TARGETED_REVALIDATE = (() => {
	const v = (process.env.INGEST_REMEDIATION_TARGETED_REVALIDATE ?? '').trim().toLowerCase();
	if (v === '0' || v === 'false' || v === 'no') return false;
	return true;
})();
/** Per-claim/relation/argument lines after `[METRIC] remediation_revalidation_diff`. */
const INGEST_REMEDIATION_REVALIDATION_DETAIL =
	(process.env.INGEST_REMEDIATION_REVALIDATION_DETAIL ?? '').trim().toLowerCase() === '1' ||
	(process.env.INGEST_REMEDIATION_REVALIDATION_DETAIL ?? '').trim().toLowerCase() === 'true';
const INGEST_REMEDIATION_FORCE_RELATIONS_RERUN =
	(process.env.INGEST_REMEDIATION_FORCE_RELATIONS_RERUN ?? '').trim().toLowerCase() === '1' ||
	(process.env.INGEST_REMEDIATION_FORCE_RELATIONS_RERUN ?? '').trim().toLowerCase() === 'true';
const INGEST_REMEDIATION_RERUN_SHARE = Math.max(
	0,
	Math.min(1, Number(process.env.INGEST_REMEDIATION_RERUN_SHARE ?? '0.12') || 0.12)
);
// Relations can be expensive and trigger quota/rate exhaustion on large claim graphs.
// Chunking is enabled when RELATIONS_BATCH_TARGET_TOKENS > 0 (set to 0 to disable).
const RELATIONS_BATCH_TARGET_TOKENS = (() => {
	const raw = process.env.RELATIONS_BATCH_TARGET_TOKENS;
	// Lower default reduces TPM blowups / split storms on dense claim graphs (Neon advisory theme).
	if (raw == null || raw.trim() === '') return 10_000;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.trunc(n);
})();
const RELATIONS_BATCH_OVERLAP_CLAIMS =
	parsePositiveInt(process.env.RELATIONS_BATCH_OVERLAP_CLAIMS) ?? 3;
/** When >1, run independent extraction batches in parallel (ordered merge). Splits mid-batch disable parallelism for remaining work. */
const INGEST_EXTRACTION_CONCURRENCY = Math.max(
	1,
	parsePositiveInt(process.env.INGEST_EXTRACTION_CONCURRENCY) ?? 2
);
const INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE =
	(process.env.INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE || 'true').toLowerCase() !== 'false';
/**
 * When false, Stage 4 probes Surreal for any existing claim embedding dim and throws if it ≠ configured output (e.g. legacy 768 vs Voyage 1024).
 * Default true so ingest is not blocked if Cloud Run env is stale; set INGEST_EMBEDDING_IGNORE_LEGACY_CORPUS_DIM=0 after the corpus is uniformly re-embedded.
 */
const INGEST_EMBEDDING_IGNORE_LEGACY_CORPUS_DIM = (() => {
	const raw = (process.env.INGEST_EMBEDDING_IGNORE_LEGACY_CORPUS_DIM ?? '').trim().toLowerCase();
	if (raw === '0' || raw === 'false' || raw === 'no') return false;
	if (raw === '1' || raw === 'true' || raw === 'yes') return true;
	return true;
})();
const INGEST_SAVE_GROUPING_RAW =
	(process.env.INGEST_SAVE_GROUPING_RAW || 'false').toLowerCase() === 'true';

/**
 * When true with `--validate`, skip Surreal Stage 6 if remediation dropped no edges, changed no claim text,
 * did not re-run relations/grouping, and did not re-embed repaired claims — and a `source` row already exists.
 * Opt-in: faithfulness-only updates (e.g. remediation revalidation) are not written to Surreal when store is skipped.
 */
function ingestSkipStoreWhenNoGraphChanges(): boolean {
	const raw = (process.env.INGEST_SKIP_STORE_WHEN_NO_GRAPH_CHANGES ?? '').trim().toLowerCase();
	return raw === '1' || raw === 'true' || raw === 'yes';
}

// ─── Stage ordering for resume logic (STAGES_ORDER from ingestResumeStage.ts) ──

/** Validation-only tail (`--force-stage validating` / `INGEST_FORCE_STAGE=validating`) must never fall back to full extraction. */
function validationOnlyIngestIntent(forceStage: string | null | undefined): boolean {
	return forceStage === 'validating';
}

/** When set to `skip`, `1`, or `true`, missing Neon tail for validation-only exits **0** (batch-friendly) instead of **3**. */
function exitValidationOnlyNoCheckpoint(): never {
	const v = process.env.INGEST_VALIDATION_ONLY_NO_CHECKPOINT?.trim().toLowerCase();
	if (v === 'skip' || v === '1' || v === 'true') {
		console.log(
			'[SKIP] Validation-only: no Neon tail checkpoint for this source — exiting 0 (INGEST_VALIDATION_ONLY_NO_CHECKPOINT=skip). Run full ingest through embedding once if checkpoints were expected.'
		);
		process.exit(0);
	}
	process.exit(INGEST_EXIT_FORCE_STAGE_CHECKPOINT_MISSING);
}

/** When `--force-stage` / `INGEST_FORCE_STAGE` cannot be satisfied (missing tail or validation-only gate). */
function parseForceStageMissingCheckpointMode(forceStageHint?: string | null): 'error' | 'full' | 'resume' {
	const raw = (process.env.INGEST_FORCE_STAGE_MISSING_CHECKPOINT ?? '').trim().toLowerCase();
	if (raw === 'full' || raw === 'complete' || raw === 'complete_pipeline') return 'full';
	if (raw === 'resume' || raw === 'best_partial' || raw === 'partial') return 'resume';
	if (raw === 'error' || raw === 'strict') return 'error';
	if (raw.length > 0) return 'error';
	/** Unset: match `sanitizeIngestionJobWorkerDefaults` — validation tail should not hard-fail on a fresh orchestration id. */
	const hint = (forceStageHint ?? process.env.INGEST_FORCE_STAGE ?? '').trim().toLowerCase();
	if (hint === 'validating') return 'resume';
	return 'error';
}

function shouldRunStage(stage: string, lastCompleted: string | null | undefined): boolean {
	if (!lastCompleted) return true;
	const completedIdx = STAGES_ORDER.indexOf(lastCompleted);
	const stageIdx = STAGES_ORDER.indexOf(stage);
	if (completedIdx === -1) return true; // unknown stage = run everything
	return stageIdx > completedIdx;
}

// ─── Cost tracking ─────────────────────────────────────────────────────────
interface CostTracker {
	totalInputTokens: number;
	totalOutputTokens: number;
	vertexChars: number;
	totalUsd: number;
}

const costs: CostTracker = {
	totalInputTokens: 0,
	totalOutputTokens: 0,
	vertexChars: 0,
	totalUsd: 0
};

function estimateCost(): string {
	return (costs.totalUsd * 0.79).toFixed(4);
}

function estimateCostUsd(): string {
	return costs.totalUsd.toFixed(4);
}

function estimateUsageCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
	return estimateIngestLlmUsageUsd(modelId, inputTokens, outputTokens);
}

function trackReasoningCost(modelId: string, inputTokens: number, outputTokens: number): number {
	const usageCostUsd = estimateUsageCostUsd(modelId, inputTokens, outputTokens);
	costs.totalInputTokens += inputTokens;
	costs.totalOutputTokens += outputTokens;
	costs.totalUsd += usageCostUsd;
	return usageCostUsd;
}

function trackEmbeddingCost(totalChars: number): number {
	const usageCostUsd = (totalChars / 1_000_000) * INGEST_EMBED_USD_PER_MILLION_CHARS;
	costs.vertexChars += totalChars;
	costs.totalUsd += usageCostUsd;
	return usageCostUsd;
}

function logStageCost(label: string, tracker: StageUsageTracker, plan: IngestionStagePlan) {
	const inputDelta = currentInputTokens() - tracker.startInputTokens;
	const outputDelta = currentOutputTokens() - tracker.startOutputTokens;
	const usdDelta = Number(estimateCostUsd()) - tracker.startUsd;
	if (plan.stage === 'embedding') {
		console.log(
			`  [COST] ${label}: ${plan.provider}/${plan.model} chars=${costs.vertexChars.toLocaleString()} stage=$${usdDelta.toFixed(4)} total=$${estimateCostUsd()}`
		);
		return;
	}
	console.log(
		`  [COST] ${label}: ${plan.provider}/${plan.model} input=${inputDelta.toLocaleString()} output=${outputDelta.toLocaleString()} stage=$${usdDelta.toFixed(4)} total=$${estimateCostUsd()}`
	);
}

function estimateTokens(text: string): number {
	return Math.ceil(text.split(/\s+/).length * 1.3);
}

/** Per-run timing for [INGEST_TIMING] JSON line (parsed into Firestore reports). */
interface IngestTimingPayload {
	/** Wall-clock start of this worker process for this source (for total_wall_ms). */
	run_started_at_ms: number;
	planning_initial_ms: number;
	planning_post_extraction_ms: number;
	planning_post_relations_ms: number;
	stage_ms: Record<string, number>;
	model_calls: Record<string, number>;
	model_call_wall_ms: Record<string, number>;
	/**
	 * Last successful `provider/model` per pipeline stage (batch N overwrites — comparable when pins prevent fallback).
	 * Used for analytics; e.g. `stage_models.validation` for faithfulness score comparability.
	 */
	stage_models: Record<string, string>;
	model_retries: number;
	retry_backoff_ms_total: number;
	batch_splits: number;
	json_repair_invocations: number;
	/** Extraction stage: JSON.parse or Zod failed on raw model output before `json_repair`. */
	extraction_json_first_pass_failures: number;
	/** Sum of claim counts accepted after extraction-time JSON repair (per batch). */
	extraction_claims_recovered_via_json_repair: number;
	/** Recovery agent consults (INGEST_RECOVERY_AGENT=1). */
	recovery_agent_invocations: number;
	/** Extra backoff ms from recovery agent-sponsored sleeps. */
	recovery_agent_backoff_ms_total: number;
	embed_wall_ms: number;
	store_wall_ms: number;
	/** Sum of provider-reported input + output tokens across all `generateText` calls in this run (LLM stages only). */
	total_input_tokens: number;
	total_output_tokens: number;
	/** Per-stage sums of input/output tokens (same keys as `model_calls`, e.g. `extraction`, `relations`). */
	stage_input_tokens: Record<string, number>;
	stage_output_tokens: Record<string, number>;
	/** Vertex embedding path: characters counted for billing (`trackEmbeddingCost`); not LLM tokens. */
	vertex_embed_chars: number;
	/** Set when logging the final summary line (wall clock for entire run). */
	total_wall_ms?: number;
	/** Stage 6 skipped: see `INGEST_SKIP_STORE_WHEN_NO_GRAPH_CHANGES` + `skipped_surreal_store_reason`. */
	skipped_surreal_store_no_graph_changes?: boolean;
	skipped_surreal_store_reason?: string;
}

let activeIngestTiming: IngestTimingPayload | null = null;

/** Full source text for Neon `ingest_staging_meta.source_text_snapshot` (not written to local *-partial.json). */
let ingestSourceTextBodyForCheckpoint: string | undefined;

/** Per-run failure counts for catalog-ordered fallback deprioritization (provider::model). */
const ingestModelFailureCounts = new Map<string, number>();
/** Per-stage failure counts (stage::provider::model) — merged from Neon at startup + in-run bumps. */
const ingestStageModelFailureCounts = new Map<string, number>();

/** Consecutive failures per stage+model in this process; opens soft circuit at threshold. */
const ingestCircuitFailureCounts = new Map<string, number>();
const ingestCircuitBlocked = new Set<string>();

function ingestModelFailureKey(provider: string, model: string): string {
	return `${provider.trim().toLowerCase()}::${model.trim()}`;
}

function ingestStageModelFailureKey(stage: StageKey, provider: string, model: string): string {
	return `${stage}::${provider.trim().toLowerCase()}::${model.trim()}`;
}

function stageModelCircuitKey(stage: StageKey, provider: string, model: string): string {
	return ingestStageModelFailureKey(stage, provider, model);
}

function ingestCircuitFailureThreshold(): number {
	const raw = parseInt(process.env.INGEST_CIRCUIT_FAILURE_THRESHOLD ?? '0', 10);
	return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function recordIngestModelFailure(stage: StageKey, provider: string, model: string): void {
	const gk = ingestModelFailureKey(provider, model);
	ingestModelFailureCounts.set(gk, (ingestModelFailureCounts.get(gk) ?? 0) + 1);
	void bumpIngestModelFailureInDb(provider, model);

	const sk = ingestStageModelFailureKey(stage, provider, model);
	ingestStageModelFailureCounts.set(sk, (ingestStageModelFailureCounts.get(sk) ?? 0) + 1);
	void bumpIngestStageModelFailureInDb(stage, provider, model);

	const ck = stageModelCircuitKey(stage, provider, model);
	const prev = ingestCircuitFailureCounts.get(ck) ?? 0;
	const next = prev + 1;
	ingestCircuitFailureCounts.set(ck, next);
	const thr = ingestCircuitFailureThreshold();
	if (thr > 0 && next >= thr && !ingestCircuitBlocked.has(ck)) {
		ingestCircuitBlocked.add(ck);
		console.log(
			formatIngestSelfHealLine({
				v: 1,
				signal: 'circuit_open',
				stage,
				provider,
				model,
				outcome: 'skip_tier',
				detail: `failures_in_run=${next} threshold=${thr}`
			})
		);
	}
}

function clearIngestCircuitSuccess(stage: StageKey, provider: string, model: string): void {
	const ck = stageModelCircuitKey(stage, provider, model);
	ingestCircuitFailureCounts.delete(ck);
	ingestCircuitBlocked.delete(ck);
}

function loadIngestCatalogRoutingFromEnv(): IngestCatalogRoutingJson | null {
	const raw = process.env.INGEST_CATALOG_ROUTING_JSON_B64?.trim();
	if (!raw) return null;
	try {
		const json = Buffer.from(raw, 'base64url').toString('utf8');
		const data = JSON.parse(json) as IngestCatalogRoutingJson;
		return data && typeof data === 'object' ? data : null;
	} catch {
		return null;
	}
}

function tierFitsEstimatedContext(
	stage: IngestionStage,
	tier: { provider: string; modelId: string },
	ctx: IngestionPlanningContext
): boolean {
	const u = estimateStageUsage(stage, ctx);
	const estIn = u.inputTokens + 2_000;
	const m = tier.modelId.toLowerCase();
	// Conservative ceilings (tokens) — avoids obvious context blowups before planning.
	let maxIn = 200_000;
	if (m.includes('gpt-4o-mini') || m.includes('gpt-3.5')) maxIn = 120_000;
	else if (m.includes('haiku') && !m.includes('sonnet')) maxIn = 190_000;
	else if (m.includes('gemini') && m.includes('flash')) maxIn = 950_000;
	else if (m.includes('gemini')) maxIn = 950_000;
	else if (m.includes('gpt-4')) maxIn = 120_000;
	else if (m.includes('claude')) maxIn = 190_000;
	else if (m.includes('mistral') || m.includes('ministral')) maxIn = 120_000;
	else if (m.includes('deepseek')) maxIn = 120_000;
	return estIn <= maxIn;
}

/**
 * Ordered fallback chain: catalog (cheapest suitable first, failure-deprioritized) ∪ canonical defaults, deduped.
 */
function buildEffectiveModelChainForStage(
	stage: StageKey,
	plan: IngestionStagePlan,
	ctx: IngestionPlanningContext,
	catalogRouting: IngestCatalogRoutingJson | null
): { provider: string; modelId: string }[] {
	const llmStage = stage as IngestionLlmStageKey;
	const canonical = canonicalModelChainForStage(llmStage);
	const out: { provider: string; modelId: string }[] = [];
	const seen = new Set<string>();

	const pushTier = (t: { provider: string; modelId: string }, front = false) => {
		const prov = t.provider.trim().toLowerCase();
		const mid = t.modelId.trim();
		if (!prov || !mid) return;
		const k = `${prov}::${mid}`;
		if (seen.has(k)) return;
		if (!tierFitsEstimatedContext(stage as IngestionStage, { provider: prov, modelId: mid }, ctx)) return;
		seen.add(k);
		if (front) out.unshift({ provider: prov, modelId: mid });
		else out.push({ provider: prov, modelId: mid });
	};

	// 1) Restormel primary (may differ from canonical)
	pushTier({ provider: plan.provider, modelId: plan.model }, true);

	const catList = catalogRouting?.[llmStage];
	if (Array.isArray(catList) && catList.length > 0) {
		const scored = catList
			.filter((t) => t && typeof t.provider === 'string' && typeof t.modelId === 'string')
			.map((t) => {
				const provider = t.provider.trim().toLowerCase();
				const modelId = t.modelId.trim();
				const gk = ingestModelFailureKey(provider, modelId);
				const sk = ingestStageModelFailureKey(stage as StageKey, provider, modelId);
				const fails =
					(ingestStageModelFailureCounts.get(sk) ?? 0) + (ingestModelFailureCounts.get(gk) ?? 0);
				return { provider, modelId, fails };
			})
			.filter((t) => t.provider && t.modelId);

		scored.sort((a, b) => {
			if (a.fails !== b.fails) return a.fails - b.fails;
			return a.provider.localeCompare(b.provider) || a.modelId.localeCompare(b.modelId);
		});

		for (const t of scored) {
			pushTier({ provider: t.provider, modelId: t.modelId });
		}
	}

	for (const t of canonical) {
		pushTier({ provider: t.provider, modelId: t.modelId });
	}

	const filtered = filterModelTiersForFinetunePolicy(stage, out, process.env);
	if (
		ingestFinetuneLabelerStrictEnabled(process.env) &&
		filtered.length < out.length &&
		isFinetuneSensitiveLlmStage(stage)
	) {
		const allow = parseFinetuneLabelerAllowedProviders(process.env).join(',');
		console.warn(
			`  [INGEST_FINETUNE_POLICY] ${stage}: dropped ${out.length - filtered.length} model tier(s) not in allowed providers (${allow}); Restormel/catalog/OpenAI fallbacks cannot bypass this.`
		);
	}
	if (filtered.length === 0) {
		const allow = parseFinetuneLabelerAllowedProviders(process.env).join(',');
		throw new Error(
			`[INGEST_FINETUNE_POLICY] ${stage}: no models left after provider filter (allowed=${allow}). Set Mistral-capable Restormel routes, INGEST_PIN_* for this stage, or temporarily INGEST_FINETUNE_LABELER_STRICT=0 for local experiments only.`
		);
	}
	return filtered;
}

function createEmptyTiming(): IngestTimingPayload {
	return {
		run_started_at_ms: Date.now(),
		planning_initial_ms: 0,
		planning_post_extraction_ms: 0,
		planning_post_relations_ms: 0,
		stage_ms: {},
		model_calls: {},
		model_call_wall_ms: {},
		stage_models: {},
		model_retries: 0,
		retry_backoff_ms_total: 0,
		batch_splits: 0,
		json_repair_invocations: 0,
		extraction_json_first_pass_failures: 0,
		extraction_claims_recovered_via_json_repair: 0,
		recovery_agent_invocations: 0,
		recovery_agent_backoff_ms_total: 0,
		embed_wall_ms: 0,
		store_wall_ms: 0,
		total_input_tokens: 0,
		total_output_tokens: 0,
		stage_input_tokens: {},
		stage_output_tokens: {},
		vertex_embed_chars: 0
	};
}

function bumpStageMs(key: string, ms: number): void {
	if (!activeIngestTiming) return;
	activeIngestTiming.stage_ms[key] = (activeIngestTiming.stage_ms[key] ?? 0) + ms;
}

function bumpStageTokens(stage: string, inputTokens: number, outputTokens: number): void {
	if (!activeIngestTiming) return;
	const inn = Math.max(0, Math.trunc(inputTokens));
	const outt = Math.max(0, Math.trunc(outputTokens));
	activeIngestTiming.total_input_tokens += inn;
	activeIngestTiming.total_output_tokens += outt;
	activeIngestTiming.stage_input_tokens[stage] = (activeIngestTiming.stage_input_tokens[stage] ?? 0) + inn;
	activeIngestTiming.stage_output_tokens[stage] = (activeIngestTiming.stage_output_tokens[stage] ?? 0) + outt;
}

function ingestElapsedWallMs(): number {
	if (!activeIngestTiming) return 0;
	return Date.now() - activeIngestTiming.run_started_at_ms;
}

/** One-line progress for operators and log UIs; cumulative elapsed is wall clock since run start. */
function reportIngestPhaseTiming(phase: string, segmentWallMs: number): void {
	if (!activeIngestTiming) return;
	const elapsed = ingestElapsedWallMs();
	console.log(
		`  [TIMING] ${phase}: ${formatDuration(segmentWallMs)} (elapsed since run start ${formatDuration(elapsed)})`
	);
	emitIngestTelemetry({
		event: 'phase_timing',
		phase,
		phase_wall_ms: Math.round(segmentWallMs),
		elapsed_wall_ms: Math.round(elapsed)
	});
}

function logIngestTimingHumanBlock(t: IngestTimingPayload, totalWallMs: number): void {
	const sm = t.stage_ms;
	const row = (label: string, ms: number) =>
		ms > 0 || label.startsWith('Planning') ? `    ${label.padEnd(26)} ${formatDuration(ms)}` : '';
	const lines = [
		'  ─── Ingestion timing (wall clock) ───',
		row('Planning (initial)', t.planning_initial_ms),
		row('Planning (post-extract)', t.planning_post_extraction_ms),
		row('Planning (post-relations)', t.planning_post_relations_ms),
		row('Stage 1 · extracting', sm.extracting ?? 0),
		row('Stage 2 · relating', sm.relating ?? 0),
		row('Stage 3 · grouping', sm.grouping ?? 0),
		row('Stage 4 · embedding', sm.embedding ?? t.embed_wall_ms ?? 0),
		row('Stage 5 · validating', sm.validating ?? 0),
		row('Stage 5b · remediating', sm.remediating ?? 0),
		row('Stage 6 · storing', sm.storing ?? t.store_wall_ms ?? 0),
		`    ${'Total (this run)'.padEnd(26)} ${formatDuration(totalWallMs)}`,
		`    ${'LLM tokens (in / out)'.padEnd(26)} ${t.total_input_tokens.toLocaleString()} / ${t.total_output_tokens.toLocaleString()}`,
		t.extraction_json_first_pass_failures > 0 || t.extraction_claims_recovered_via_json_repair > 0
			? `    ${'Extraction JSON repair'.padEnd(26)} failures=${t.extraction_json_first_pass_failures} claims_recovered=${t.extraction_claims_recovered_via_json_repair}`
			: '',
		t.vertex_embed_chars > 0
			? `    ${'Vertex embed chars'.padEnd(26)} ${t.vertex_embed_chars.toLocaleString()}`
			: ''
	].filter((l) => l.length > 0 && !l.match(/^[\s]*$/));
	console.log(lines.join('\n'));
}

function logIngestTimingSummary(): void {
	if (!activeIngestTiming) return;
	const totalWallMs = Date.now() - activeIngestTiming.run_started_at_ms;
	activeIngestTiming.vertex_embed_chars = costs.vertexChars;
	const payload: IngestTimingPayload = { ...activeIngestTiming, total_wall_ms: totalWallMs };
	logIngestTimingHumanBlock(payload, totalWallMs);
	console.log(`[INGEST_TIMING] ${JSON.stringify(payload)}`);
	const metricsAdvisory = buildIngestMetricsAdvisory(payload as unknown as Record<string, unknown>, {});
	console.log(`[INGEST_METRICS_ADVISORY] ${JSON.stringify(metricsAdvisory)}`);
	emitIngestTelemetry({ event: 'ingest_timing_complete', ...payload });
	emitIngestTelemetry({
		event: 'ingest_metrics_advisory',
		severity: metricsAdvisory.severity,
		recommendation_count: metricsAdvisory.recommendations.length
	});
	activeIngestTiming = null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timeoutId: NodeJS.Timeout | null = null;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timeoutId) clearTimeout(timeoutId);
	});
}

function parseModelList(envValue: string | undefined, defaults: string[]): string[] {
	const fromEnv = (envValue || '')
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean);

	const combined = [...fromEnv, ...defaults];
	const unique: string[] = [];
	for (const model of combined) {
		if (!unique.includes(model)) unique.push(model);
	}
	return unique;
}

function isRetryableDbError(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		message.includes('econnrefused') ||
		message.includes('econnreset') ||
		message.includes('etimedout') ||
		message.includes('ehostunreach') ||
		message.includes('socket hang up') ||
		message.includes('timeout') ||
		message.includes('temporarily unavailable') ||
		message.includes('service unavailable') ||
		message.includes('503') ||
		message.includes('502') ||
		message.includes('429') ||
		message.includes('iam') ||
		message.includes('permissions') ||
		message.includes('authentication') ||
		message.includes('unauthorized')
	);
}

async function reconnectDbWithRetry(db: Surreal, reason: string): Promise<void> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= DB_CONNECT_MAX_RETRIES; attempt++) {
		try {
			try {
				await db.close();
			} catch {
				// ignore stale socket close errors
			}

			await db.connect(SURREAL_URL);
			await signinSurrealWithFallback(db);
			await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });

			if (attempt > 1) {
				console.log(`  [OK] SurrealDB reconnected after retry ${attempt}/${DB_CONNECT_MAX_RETRIES}`);
			}
			return;
		} catch (error) {
			lastError = error;
			const msg = error instanceof Error ? error.message : String(error);
			if (attempt >= DB_CONNECT_MAX_RETRIES || !isRetryableDbError(error)) {
				throw new Error(`SurrealDB reconnect failed (${reason}): ${msg}`);
			}

			const waitMs = DB_CONNECT_RETRY_BASE_MS * Math.pow(2, attempt - 1);
			console.warn(
				`  [WARN] SurrealDB reconnect attempt ${attempt}/${DB_CONNECT_MAX_RETRIES} failed (${msg}). Retrying in ${waitMs}ms...`
			);
			await sleep(waitMs);
		}
	}

	throw new Error(
		`SurrealDB reconnect failed (${reason}): ${lastError instanceof Error ? lastError.message : String(lastError)}`
	);
}

async function dbQueryWithRetry<T>(
	db: Surreal,
	query: string,
	vars?: Record<string, unknown>,
	maxAttempts = 3
): Promise<T> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return (await db.query(query, vars)) as T;
		} catch (error) {
			lastError = error;
			if (attempt >= maxAttempts || !isRetryableDbError(error)) {
				throw error;
			}

			const msg = error instanceof Error ? error.message : String(error);
			const waitMs = DB_CONNECT_RETRY_BASE_MS * Math.pow(2, attempt - 1);
			console.warn(
				`  [WARN] DB query failed (attempt ${attempt}/${maxAttempts}): ${msg}. Reconnecting...`
			);
			await reconnectDbWithRetry(db, `query retry attempt ${attempt}`);
			await sleep(waitMs);
		}
	}

	throw new Error(
		`DB query failed after ${maxAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
	);
}
/** Extra detail for provider errors (AI SDK / fetch) — avoids losing nested causes in logs. */
function formatModelCallErrorDetails(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const parts = [error.message];
	const anyErr = error as Error & {
		cause?: unknown;
		responseBody?: unknown;
		statusCode?: number;
	};
	if (anyErr.cause instanceof Error) {
		parts.push(`cause: ${anyErr.cause.message}`);
	} else if (anyErr.cause != null && typeof anyErr.cause !== 'object') {
		parts.push(`cause: ${String(anyErr.cause)}`);
	}
	if (typeof anyErr.statusCode === 'number') {
		parts.push(`http: ${anyErr.statusCode}`);
	}
	if (anyErr.responseBody != null) {
		const raw =
			typeof anyErr.responseBody === 'string'
				? anyErr.responseBody
				: JSON.stringify(anyErr.responseBody);
		parts.push(`body: ${raw.slice(0, 2000)}`);
	}
	return parts.join(' | ');
}

function isModelUnavailableError(error: unknown): boolean {
	const raw = error instanceof Error ? error.message : String(error);
	const message = raw.toLowerCase();
	// Anthropic sometimes returns a terse single-line invalid model message; do not use broad `model:`
	// substring (it appears inside many unrelated errors and skips retries incorrectly).
	if (/^model:\s*[\w.-]+$/.test(raw.trim())) return true;
	return (
		message.includes('not_found') ||
		message.includes('model_not_found') ||
		message.includes('not available') ||
		message.includes('unsupported model') ||
		message.includes('invalid model') ||
		message.includes('unknown model') ||
		message.includes('no longer available') ||
		message.includes('has been retired') ||
		message.includes('invalid_request_error')
	);
}

type IngestProvider = IngestProviderPreference;

interface StageBudget {
	maxInputTokens?: number;
	maxOutputTokens?: number;
	maxUsd?: number;
	maxRetries: number;
	timeoutMs: number;
}

interface StageUsageTracker {
	stage: StageKey;
	startInputTokens: number;
	startOutputTokens: number;
	startUsd: number;
	retries: number;
}

function parseIngestProvider(value: string | undefined): IngestProvider {
	if (!value) return 'auto';
	const normalized = value.toLowerCase().trim();
	if (normalized === 'auto') return 'auto';
	if (normalized === 'anthropic') return 'anthropic';
	if (normalized === 'vertex' || normalized === 'google') return 'vertex';
	if (normalized === 'mistral') return 'mistral';
	return 'auto';
}

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return Math.trunc(parsed);
}

function parsePositiveFloat(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return parsed;
}

/** Parallel single-passage extraction batches: raise floor only when extraction is routed to Vertex / Gemini. */
function effectiveExtractionParallelConcurrency(extractionPlanProvider: string): number {
	const base = INGEST_EXTRACTION_CONCURRENCY;
	if (!isGoogleGenerativeThroughputEnabled()) return base;
	if (!isGoogleGenerativePlanProvider(extractionPlanProvider)) return base;
	const floor = parsePositiveInt(process.env.INGEST_GOOGLE_EXTRACTION_CONCURRENCY_FLOOR) ?? 6;
	return Math.min(12, Math.max(base, floor));
}

/**
 * Providers routed via `createOpenAI(...).chat(model)` map `system` to role `developer`
 * (AI SDK v2 compatibility). Mistral and several other strict Chat Completions APIs only
 * accept system | user | assistant | tool — folding avoids HTTP 422 on validation/repair.
 */
const OPENAI_COMPAT_CHAT_PROVIDERS_FOLD_SYSTEM = new Set([
	'mistral',
	'groq',
	'deepseek',
	'together',
	'cohere',
	'openrouter',
	'perplexity'
]);

function shouldFoldSystemPromptIntoUserForProvider(provider: string | undefined): boolean {
	if (!provider) return false;
	const p = provider.toLowerCase();
	if (OPENAI_COMPAT_CHAT_PROVIDERS_FOLD_SYSTEM.has(p)) return true;
	const extractionBase = process.env.EXTRACTION_BASE_URL?.trim().toLowerCase() ?? '';
	// `buildExtractionOpenAiCompatibleRoute` uses `provider: 'openai'` for Fireworks/Together/etc., or
	// `provider: 'vertex'` for `generativelanguage.googleapis.com` (native Gemini). Fireworks
	// deployment templates return 400 ("roles must alternate…") when `system` is sent separately;
	// Together SFT eval defaults to the same folded shape (see `EXTRACTION_EVAL_FOLD_SYSTEM`).
	if (p === 'openai' && extractionBase) {
		if (extractionBase.includes('fireworks.ai') || extractionBase.includes('together.xyz')) {
			return true;
		}
	}
	return false;
}

function makeStageBudget(stage: StageKey): StageBudget {
	const upper = stage.toUpperCase();
	const timeoutFallback =
		stage === 'validation' || stage === 'remediation'
			? VALIDATION_MODEL_TIMEOUT_MS
			: stage === 'extraction'
				? INGEST_EXTRACTION_TIMEOUT_FALLBACK_MS
				: INGEST_MODEL_TIMEOUT_MS;
	return {
		maxInputTokens: parsePositiveInt(process.env[`INGEST_STAGE_${upper}_MAX_INPUT_TOKENS`]),
		maxOutputTokens: parsePositiveInt(process.env[`INGEST_STAGE_${upper}_MAX_OUTPUT_TOKENS`]),
		maxUsd: parsePositiveFloat(process.env[`INGEST_STAGE_${upper}_MAX_USD`]),
		maxRetries: parsePositiveInt(process.env[`INGEST_STAGE_${upper}_MAX_RETRIES`]) ?? 3,
		timeoutMs: parsePositiveInt(process.env[`INGEST_STAGE_${upper}_TIMEOUT_MS`]) ?? timeoutFallback
	};
}

function maxOutputTokensForExtraction(budget: StageBudget): number {
	return budget.maxOutputTokens ?? DEFAULT_INGEST_STAGE_EXTRACTION_MAX_OUTPUT_TOKENS;
}

/** Replace one extraction batch with two smaller batches (passage list bisect or single-passage text bisect). */
function replaceExtractionBatchWithSplitHalves(batch: PassageRecord[]): PassageRecord[][] | null {
	if (batch.length > 1) {
		const mid = Math.ceil(batch.length / 2);
		return [batch.slice(0, mid), batch.slice(mid)];
	}
	const only = batch[0];
	if (!only) return null;
	const bisected = splitPassageRecordForExtractionRetry(only);
	if (!bisected) return null;
	return [[bisected[0]], [bisected[1]]];
}

function maxOutputTokensForJsonRepair(budget: StageBudget): number {
	return budget.maxOutputTokens ?? DEFAULT_INGEST_STAGE_JSON_REPAIR_MAX_OUTPUT_TOKENS;
}

/**
 * Caps extraction batch packing.
 * For `sep_entry`, defaults to ~58% of the section token limit when no env overrides are set
 * (finetuned / low-output models handle smaller batches better). Opt out with
 * `INGEST_EXTRACTION_DISABLE_SEP_DEFAULT_SMALL_BATCH=1`.
 */
function resolveIngestExtractionBatchTokenLimit(sectionTokenLimit: number, sourceType: string): number {
	const cap = parsePositiveInt(process.env.INGEST_EXTRACTION_MAX_TOKENS_PER_BATCH);
	const fracRaw = (process.env.INGEST_EXTRACTION_BATCH_TOKEN_FRACTION ?? '').trim();
	const sepDefaultOff =
		(process.env.INGEST_EXTRACTION_DISABLE_SEP_DEFAULT_SMALL_BATCH ?? '').trim() === '1';
	const useSepDefault =
		!fracRaw &&
		cap === undefined &&
		!sepDefaultOff &&
		sourceType.trim().toLowerCase() === 'sep_entry';

	let limit = sectionTokenLimit;
	if (useSepDefault) {
		limit = Math.max(400, Math.floor(sectionTokenLimit * 0.58));
	} else if (fracRaw) {
		const f = Number(fracRaw);
		if (Number.isFinite(f) && f > 0 && f <= 1) {
			limit = Math.max(400, Math.floor(sectionTokenLimit * f));
		}
	}
	if (cap !== undefined) {
		limit = Math.min(limit, cap);
	}
	limit = Math.min(limit, sectionTokenLimit);
	return Math.max(400, limit);
}

function currentInputTokens(): number {
	return costs.totalInputTokens;
}

function currentOutputTokens(): number {
	return costs.totalOutputTokens;
}

function startStageUsage(stage: StageKey): StageUsageTracker {
	return {
		stage,
		startInputTokens: currentInputTokens(),
		startOutputTokens: currentOutputTokens(),
		startUsd: Number(estimateCostUsd()),
		retries: 0
	};
}

function assertStageBudget(stageBudget: StageBudget, tracker: StageUsageTracker): void {
	const inputDelta = currentInputTokens() - tracker.startInputTokens;
	const outputDelta = currentOutputTokens() - tracker.startOutputTokens;
	const usdDelta = Number(estimateCostUsd()) - tracker.startUsd;

	if (stageBudget.maxInputTokens !== undefined && inputDelta > stageBudget.maxInputTokens) {
		throw new Error(
			`[BUDGET] ${tracker.stage} exceeded input token cap (${inputDelta} > ${stageBudget.maxInputTokens})`
		);
	}
	if (stageBudget.maxOutputTokens !== undefined && outputDelta > stageBudget.maxOutputTokens) {
		throw new Error(
			`[BUDGET] ${tracker.stage} exceeded output token cap (${outputDelta} > ${stageBudget.maxOutputTokens})`
		);
	}
	if (stageBudget.maxUsd !== undefined && usdDelta > stageBudget.maxUsd) {
		throw new Error(`[BUDGET] ${tracker.stage} exceeded USD cap (${usdDelta.toFixed(4)} > ${stageBudget.maxUsd})`);
	}
}

function getSectionTokenLimit(sourceType: string): number {
	if (sourceType === 'book') {
		return BOOK_MAX_TOKENS_PER_SECTION;
	}
	return MAX_TOKENS_PER_SECTION;
}

function splitChunkByParagraphs(chunk: string, maxTokensPerSection: number): string[] {
	if (estimateTokens(chunk) <= maxTokensPerSection) return [chunk];

	const paragraphs = chunk
		.split(/\n\s*\n/g)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);

	if (paragraphs.length <= 1) {
		const charChunkSize = maxTokensPerSection * 4;
		const direct: string[] = [];
		for (let i = 0; i < chunk.length; i += charChunkSize) {
			const sub = chunk.substring(i, i + charChunkSize).trim();
			if (sub.length > 100) direct.push(sub);
		}
		return direct;
	}

	const grouped: string[] = [];
	let buffer = '';

	for (const paragraph of paragraphs) {
		const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
		if (estimateTokens(candidate) > maxTokensPerSection && buffer.length > 0) {
			grouped.push(buffer.trim());
			buffer = paragraph;
		} else {
			buffer = candidate;
		}
	}

	if (buffer.length > 0) {
		grouped.push(buffer.trim());
	}

	return grouped;
}

/**
 * Split large source text into sections based on headings
 */
function splitIntoSections(text: string, maxTokensPerSection = MAX_TOKENS_PER_SECTION): string[] {
	// Split on common heading patterns
	const sections: string[] = [];
	const lines = text.split('\n');
	let currentSection: string[] = [];

	for (const line of lines) {
		// Detect headings: numbered sections, ALL CAPS lines, lines followed by === or ---
		const isHeading =
			/^\d+\.\s+[A-Z]/.test(line) || // "1. Introduction"
			/^#{1,3}\s/.test(line) || // Markdown headings
			/^[A-Z][A-Z\s]{10,}$/.test(line.trim()) || // ALL CAPS
			/^(?:Chapter|Section|Part)\s+\d/i.test(line); // Chapter/Section/Part

		if (isHeading && currentSection.length > 0) {
			const sectionText = currentSection.join('\n').trim();
			if (sectionText.length > 100) {
				sections.push(sectionText);
			}
			currentSection = [line];
		} else {
			currentSection.push(line);
		}
	}

	// Push final section
	if (currentSection.length > 0) {
		const sectionText = currentSection.join('\n').trim();
		if (sectionText.length > 100) {
			sections.push(sectionText);
		}
	}

	// If we couldn't split meaningfully, return chunks by character count
	if (sections.length <= 1) {
		const chunkSize = maxTokensPerSection * 4; // ~4 chars/token
		const chunks: string[] = [];
		for (let i = 0; i < text.length; i += chunkSize) {
			chunks.push(text.substring(i, i + chunkSize));
		}
		return chunks;
	}

	// Merge small sections so each chunk is reasonably sized
	const merged: string[] = [];
	let buffer = '';
	for (const section of sections) {
		if (estimateTokens(buffer + '\n\n' + section) > maxTokensPerSection && buffer.length > 0) {
			merged.push(buffer.trim());
			buffer = section;
		} else {
			buffer = buffer ? buffer + '\n\n' + section : section;
		}
	}
	if (buffer.length > 0) {
		merged.push(buffer.trim());
	}

	// Post-process: sub-split any merged chunk that's still larger than the threshold.
	// This happens when a single heading-based section (e.g., Kant's Section II) exceeds
	// maxTokensPerSection on its own.
	const final: string[] = [];
	for (const chunk of merged) {
		if (estimateTokens(chunk) > maxTokensPerSection) {
			final.push(...splitChunkByParagraphs(chunk, maxTokensPerSection));
		} else {
			final.push(chunk);
		}
	}

	return final;
}

/** Parse JSON from model response (fences stripped). Extraction batches use {@link parseExtractionJsonFromModelResponse}. */
function parseJsonResponse(text: string): unknown {
	return parseJsonFromModelResponse(text);
}

function ingestModelJsonFailureHints(raw: string, errMsg: string): string[] {
	const hints: string[] = [];
	const head = raw.slice(0, 160);
	if (/```(?:json)?/i.test(head)) hints.push('markdown_fence_prefix');
	const low = errMsg.toLowerCase();
	if (low.includes('truncat') || low.includes('max_tokens')) hints.push('truncation_or_cap');
	if (/unexpected end|unterminated|eof/i.test(errMsg)) hints.push('parse_incomplete');
	if (/non-whitespace character after json|unexpected token/i.test(low)) {
		hints.push('concat_or_trailing_json');
	}
	// Avoid matching the substring "expected" inside "Unexpected …" (JSON.parse trailing garbage).
	if (
		/required|invalid_type|too_(small|big)|unrecognized_keys|zoderror|\bexpected\b/i.test(errMsg)
	) {
		hints.push('schema_validation');
	}
	const tr = raw.trim();
	if (
		tr.length > 0 &&
		!tr.endsWith(']') &&
		!tr.endsWith('}') &&
		!tr.endsWith('"') &&
		!tr.endsWith("'")
	) {
		hints.push('suffix_not_closed');
	}
	return hints;
}

function logIngestModelJsonParseFailure(opts: { scope: string; rawResponse: string; error: unknown }): void {
	const msg = opts.error instanceof Error ? opts.error.message : String(opts.error);
	const hints = ingestModelJsonFailureHints(opts.rawResponse, msg);
	const raw = opts.rawResponse;
	const head = raw.slice(0, INGEST_MODEL_JSON_LOG_HEAD_CHARS);
	const tail =
		raw.length > INGEST_MODEL_JSON_LOG_HEAD_CHARS + INGEST_MODEL_JSON_LOG_TAIL_CHARS
			? raw.slice(-INGEST_MODEL_JSON_LOG_TAIL_CHARS)
			: undefined;
	console.warn(`  [JSON_FAIL] ${opts.scope}: ${msg}`);
	console.warn(
		`  [JSON_FAIL] ${opts.scope} · chars=${raw.length} hints=[${hints.join(', ') || '—'}] head=${JSON.stringify(head)}` +
			(tail ? ` tail=${JSON.stringify(tail)}` : '')
	);
}

function normalizeGroupingRole(value: unknown): string {
	if (typeof value !== 'string') return 'key_premise';
	const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, '_');
	if (normalized.includes('conclusion') || normalized.includes('thesis')) return 'conclusion';
	if (normalized.includes('supporting') && normalized.includes('premise')) return 'supporting_premise';
	if (normalized.includes('premise')) return 'key_premise';
	if (normalized.includes('assumption')) return 'assumption';
	if (
		normalized.includes('objection') ||
		normalized.includes('counter') ||
		normalized.includes('critique')
	)
		return 'objection';
	if (
		normalized.includes('response') ||
		normalized.includes('reply') ||
		normalized.includes('rebut') ||
		normalized.includes('defense') ||
		normalized.includes('defence')
	)
		return 'response';
	return 'key_premise';
}

function normalizePositivePosition(value: unknown): number {
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue)) return 1;
	return Math.max(1, Math.trunc(numberValue));
}

type GroupingBatch = {
	claims: PhaseOneClaim[];
	relations: PhaseOneRelation[];
};

type ValidationBatch = {
	claims: PhaseOneClaim[];
	relations: PhaseOneRelation[];
	arguments: GroupingOutput;
	sourceText: string;
	estimatedPromptTokens: number;
};

function splitClaimsIntoGroupingBatches(
	claims: PhaseOneClaim[],
	targetTokens: number
): PhaseOneClaim[][] {
	if (claims.length <= 1) return [claims];
	const estimatedTotalTokens = Math.ceil(
		estimateTokens(JSON.stringify(claims, null, 2)) * GROUPING_ANTHROPIC_TOKEN_ESTIMATE_MULTIPLIER
	);
	if (estimatedTotalTokens <= targetTokens) return [claims];

	const batches: PhaseOneClaim[][] = [];
	let currentBatch: PhaseOneClaim[] = [];
	let currentBatchTokens = 0;

	for (const claim of claims) {
		const claimTokens = Math.ceil(
			estimateTokens(JSON.stringify(claim, null, 2)) * GROUPING_ANTHROPIC_TOKEN_ESTIMATE_MULTIPLIER
		);
		const wouldExceed = currentBatch.length > 0 && currentBatchTokens + claimTokens > targetTokens;
		if (wouldExceed) {
			batches.push(currentBatch);
			currentBatch = [claim];
			currentBatchTokens = claimTokens;
			continue;
		}

		currentBatch.push(claim);
		currentBatchTokens += claimTokens;
	}

	if (currentBatch.length > 0) {
		batches.push(currentBatch);
	}

	return batches.length > 0 ? batches : [claims];
}

function buildGroupingBatches(
	claims: PhaseOneClaim[],
	relations: PhaseOneRelation[],
	targetTokens: number
): GroupingBatch[] {
	const claimBatches = splitClaimsIntoGroupingBatches(claims, targetTokens);
	return claimBatches.map((batchClaims) => {
		const claimPositions = new Set(batchClaims.map((claim) => claim.position_in_source));
		const batchRelations = relations.filter(
			(relation) =>
				claimPositions.has(relation.from_position) && claimPositions.has(relation.to_position)
		);
		return {
			claims: batchClaims,
			relations: batchRelations
		};
	});
}

function splitGroupingBatchInHalf(batch: GroupingBatch): [GroupingBatch, GroupingBatch] | null {
	if (batch.claims.length <= 1) return null;
	const mid = Math.ceil(batch.claims.length / 2);
	const firstClaims = batch.claims.slice(0, mid);
	const secondClaims = batch.claims.slice(mid);
	const rels = batch.relations;
	const sub = (batchClaims: PhaseOneClaim[]): GroupingBatch => {
		const claimPositions = new Set(batchClaims.map((c) => c.position_in_source));
		const batchRelations = rels.filter(
			(r) => claimPositions.has(r.from_position) && claimPositions.has(r.to_position)
		);
		return { claims: batchClaims, relations: batchRelations };
	};
	return [sub(firstClaims), sub(secondClaims)];
}

function resolveGroupingMaxOutputTokens(plan: IngestionStagePlan): number {
	const raw = parsePositiveInt(process.env.INGEST_GROUPING_MAX_OUTPUT_TOKENS);
	if (raw != null) return Math.min(200_000, Math.max(4_096, raw));
	const p = (plan.provider ?? '').trim().toLowerCase();
	const m = (plan.model ?? '').trim().toLowerCase();
	if ((p === 'vertex' || p === 'google') && m.includes('gemini')) {
		return 65_536;
	}
	return 32_768;
}

function estimatedGroupingStructuredOutputTokens(batch: GroupingBatch): number {
	const claimsJson = JSON.stringify(batch.claims, null, 2);
	return Math.ceil(estimateTokens(claimsJson) * GROUPING_OUTPUT_VS_INPUT_FACTOR);
}

function groupingBatchLikelyExceedsMaxOutput(
	batch: GroupingBatch,
	maxOutputTokens: number,
	outputHeadroomFraction: number = GROUPING_OUTPUT_HEADROOM
): boolean {
	const maxClaims = parsePositiveInt(process.env.INGEST_GROUPING_MAX_CLAIMS_PER_BATCH);
	if (maxClaims != null && batch.claims.length > maxClaims) return true;
	const estOut = estimatedGroupingStructuredOutputTokens(batch);
	return estOut > Math.floor(maxOutputTokens * outputHeadroomFraction);
}

/**
 * Split wide grouping batches before the first model call so JSON output is unlikely to hit max_output.
 */
function subdivideGroupingBatchesForOutputHeadroom(
	batches: GroupingBatch[],
	maxOutputTokens: number,
	outputHeadroomFraction: number = GROUPING_OUTPUT_HEADROOM
): GroupingBatch[] {
	const preemptOff = (process.env.INGEST_GROUPING_PREEMPT_OUTPUT_SPLITS ?? '1').trim();
	if (preemptOff === '0' || preemptOff.toLowerCase() === 'false' || preemptOff.toLowerCase() === 'off') {
		return batches;
	}
	let out = [...batches];
	for (let guard = 0; guard < 400; guard++) {
		const i = out.findIndex((b) =>
			groupingBatchLikelyExceedsMaxOutput(b, maxOutputTokens, outputHeadroomFraction)
		);
		if (i === -1) break;
		const halves = splitGroupingBatchInHalf(out[i]!);
		if (!halves) break;
		const est = estimatedGroupingStructuredOutputTokens(out[i]!);
		const budget = Math.floor(maxOutputTokens * outputHeadroomFraction);
		console.log(
			`  [PREEMPT] Splitting grouping batch ${i + 1}/${out.length} before model call — est. structured output ~${est.toLocaleString()} tok > ${budget.toLocaleString()} tok budget (${out[i]!.claims.length} claims)`
		);
		out.splice(i, 1, halves[0], halves[1]);
	}
	return out;
}

/** Mid–Stage 3 tuning: tighten batching after truncation / repair / collapse without restarting finished batches. */
type GroupingAdaptiveState = {
	effectiveTargetTokens: number;
	effectiveOutputHeadroom: number;
	truncationSplits: number;
	jsonRepairBatches: number;
	collapseSplits: number;
	regroupEvents: number;
	timeoutExtensions: number;
};

function ingestGroupingAdaptiveEnabled(): boolean {
	const v = (process.env.INGEST_GROUPING_ADAPTIVE ?? '1').trim().toLowerCase();
	return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

/** Default on: Stage 3 may lower batch target using claim-graph heuristics (see `resolveGroupingAutoBatchTarget`). Set `INGEST_GROUPING_AUTO_TUNE=0` to disable. */
function ingestGroupingAutoTuneEnabled(): boolean {
	const v = (process.env.INGEST_GROUPING_AUTO_TUNE ?? '1').trim().toLowerCase();
	return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

function ingestGroupingAutoCapTokens(): number {
	return parsePositiveInt(process.env.INGEST_GROUPING_AUTO_CAP_TOKENS) ?? 24_000;
}

function ingestGroupingAutoLargeClaimThreshold(): number {
	return parsePositiveInt(process.env.INGEST_GROUPING_AUTO_LARGE_CLAIM_THRESHOLD) ?? 100;
}

/** Default on: Stage 2 may lower relations batch target on large graphs (see `resolveRelationsAutoBatchTarget`). Set `INGEST_RELATIONS_AUTO_TUNE=0` to disable. */
function ingestRelationsAutoTuneEnabled(): boolean {
	const v = (process.env.INGEST_RELATIONS_AUTO_TUNE ?? '1').trim().toLowerCase();
	return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

function ingestRelationsAutoCapTokens(): number {
	return parsePositiveInt(process.env.INGEST_RELATIONS_AUTO_CAP_TOKENS) ?? 8_000;
}

function ingestRelationsAutoLargeClaimThreshold(): number {
	return parsePositiveInt(process.env.INGEST_RELATIONS_AUTO_LARGE_CLAIM_THRESHOLD) ?? 80;
}

function ingestRelationsAutoLargeTotalClaimJsonTokensThreshold(): number {
	return parsePositiveInt(process.env.INGEST_RELATIONS_AUTO_LARGE_TOTAL_JSON_TOKENS) ?? 60_000;
}

function ingestRelationsAutoMinTargetTokens(): number {
	return parsePositiveInt(process.env.INGEST_RELATIONS_AUTO_MIN_TARGET_TOKENS) ?? 4_000;
}

function createGroupingAdaptiveState(initialTargetTokens: number): GroupingAdaptiveState {
	return {
		effectiveTargetTokens: initialTargetTokens,
		effectiveOutputHeadroom: GROUPING_OUTPUT_HEADROOM,
		truncationSplits: 0,
		jsonRepairBatches: 0,
		collapseSplits: 0,
		regroupEvents: 0,
		timeoutExtensions: 0
	};
}

function groupingAdaptiveShrinkRatio(): number {
	const r = Number(process.env.INGEST_GROUPING_ADAPT_SHRINK_RATIO ?? '0.72');
	if (!Number.isFinite(r) || r <= 0.2 || r >= 1) return 0.72;
	return r;
}

function groupingAdaptiveHeadroomStep(): number {
	const r = Number(process.env.INGEST_GROUPING_ADAPT_HEADROOM_STEP ?? '0.06');
	if (!Number.isFinite(r) || r <= 0 || r > 0.2) return 0.06;
	return r;
}

function groupingAdaptiveMinTargetTokens(): number {
	return parsePositiveInt(process.env.INGEST_GROUPING_ADAPT_MIN_TARGET_TOKENS) ?? 8_000;
}

function groupingAdaptiveMinOutputHeadroom(): number {
	const r = Number(process.env.INGEST_GROUPING_ADAPT_MIN_HEADROOM ?? '0.58');
	if (!Number.isFinite(r) || r < 0.35 || r > 0.92) return 0.58;
	return r;
}

function groupingAdaptiveSlowCallMs(): number {
	return parsePositiveInt(process.env.INGEST_GROUPING_ADAPT_SLOW_CALL_MS) ?? 240_000;
}

function groupingAdaptiveTimeoutGrowMs(): number {
	return parsePositiveInt(process.env.INGEST_GROUPING_ADAPT_TIMEOUT_GROW_MS) ?? 120_000;
}

function groupingAdaptiveMaxTimeoutExtensions(): number {
	return parsePositiveInt(process.env.INGEST_GROUPING_ADAPT_MAX_TIMEOUT_EXTENSIONS) ?? 3;
}

function groupingAdaptiveMaxRegroups(): number {
	return parsePositiveInt(process.env.INGEST_GROUPING_ADAPT_MAX_REGROUPS) ?? 24;
}

function claimsUnionFromGroupingBatches(batches: GroupingBatch[], fromIndex: number): PhaseOneClaim[] {
	const byPos = new Map<number, PhaseOneClaim>();
	for (let i = fromIndex; i < batches.length; i++) {
		for (const c of batches[i]!.claims) {
			byPos.set(c.position_in_source, c);
		}
	}
	return [...byPos.values()].sort((a, b) => a.position_in_source - b.position_in_source);
}

function relationsSubsetForClaims(
	relations: PhaseOneRelation[],
	claims: PhaseOneClaim[]
): PhaseOneRelation[] {
	const pos = new Set(claims.map((c) => c.position_in_source));
	return relations.filter(
		(r) => pos.has(r.from_position) && pos.has(r.to_position)
	);
}

function tightenGroupingAdaptiveAfterStress(state: GroupingAdaptiveState, reason: string): void {
	const prevTarget = state.effectiveTargetTokens;
	const prevHeadroom = state.effectiveOutputHeadroom;
	state.effectiveTargetTokens = Math.max(
		groupingAdaptiveMinTargetTokens(),
		Math.floor(state.effectiveTargetTokens * groupingAdaptiveShrinkRatio())
	);
	state.effectiveOutputHeadroom = Math.max(
		groupingAdaptiveMinOutputHeadroom(),
		state.effectiveOutputHeadroom - groupingAdaptiveHeadroomStep()
	);
	console.log(
		`  [ADAPT] Grouping batch plan tightened (${reason}): target ${Math.round(prevTarget).toLocaleString()} → ${Math.round(state.effectiveTargetTokens).toLocaleString()} tok; output headroom ${prevHeadroom.toFixed(2)} → ${state.effectiveOutputHeadroom.toFixed(2)}`
	);
}

function maybeExtendGroupingTimeoutAfterSlowCall(
	groupingBudget: StageBudget,
	state: GroupingAdaptiveState,
	wallMs: number
): void {
	const slowMs = groupingAdaptiveSlowCallMs();
	const grow = groupingAdaptiveTimeoutGrowMs();
	const maxExt = groupingAdaptiveMaxTimeoutExtensions();
	if (wallMs < slowMs || grow <= 0 || state.timeoutExtensions >= maxExt) return;
	state.timeoutExtensions += 1;
	groupingBudget.timeoutMs += grow;
	console.log(
		`  [ADAPT] Slow grouping call (${Math.round(wallMs / 1000)}s wall) — extended stage timeout by +${Math.round(grow / 1000)}s (cap ${maxExt} extensions per run)`
	);
}

function rebuildPendingGroupingBatches(args: {
	allClaims: PhaseOneClaim[];
	relations: PhaseOneRelation[];
	groupingBatches: GroupingBatch[];
	fromBatchIndex: number;
	groupingPlan: IngestionStagePlan;
	groupingMaxOut: number;
	adaptive: GroupingAdaptiveState;
}): GroupingBatch[] {
	const { relations, groupingBatches, fromBatchIndex, groupingPlan, groupingMaxOut, adaptive } = args;
	const pendingClaims =
		fromBatchIndex >= groupingBatches.length
			? []
			: claimsUnionFromGroupingBatches(groupingBatches, fromBatchIndex);
	if (pendingClaims.length === 0) return groupingBatches;

	const capped = capIngestBatchTargetForPlan({
		stage: 'grouping',
		requested: Math.round(adaptive.effectiveTargetTokens),
		provider: groupingPlan.provider,
		model: groupingPlan.model
	});
	let rebuilt = buildGroupingBatches(
		pendingClaims,
		relationsSubsetForClaims(relations, pendingClaims),
		capped.value
	);
	rebuilt = subdivideGroupingBatchesForOutputHeadroom(
		rebuilt,
		groupingMaxOut,
		adaptive.effectiveOutputHeadroom
	);
	const head = groupingBatches.slice(0, fromBatchIndex);
	const merged = [...head, ...rebuilt];
	adaptive.regroupEvents += 1;
	console.log(
		`  [ADAPT] Regrouped pending work from batch ${fromBatchIndex + 1}: ${groupingBatches.length - fromBatchIndex} → ${rebuilt.length} pending batch(es) (${merged.length} total)`
	);
	return merged;
}

function isGroupingMaxTokensTruncation(err: unknown): boolean {
	const msg = collectErrorMessageChain(err instanceof Error ? err : new Error(String(err)));
	return /truncated|max_tokens reached|max_tokens|finish.?reason.*length/i.test(msg);
}

function buildRelationsBatches(
	claims: PhaseOneClaim[],
	targetTokens: number,
	overlapClaims: number
): PhaseOneClaim[][] {
	if (targetTokens <= 0 || claims.length <= 1) return [claims];

	const overlap = Math.max(0, Math.min(overlapClaims, claims.length - 1));
	const tokensPerClaim = claims.map((claim) => Math.ceil(estimateTokens(JSON.stringify(claim, null, 2))));
	const batches: PhaseOneClaim[][] = [];

	let start = 0;
	while (start < claims.length) {
		let tokens = 0;
		let end = start;

		while (end < claims.length) {
			const claimTokens = tokensPerClaim[end] ?? 0;
			const wouldExceed = end > start && tokens + claimTokens > targetTokens;
			if (wouldExceed) break;
			tokens += claimTokens;
			end += 1;
		}

		if (end === start) end = start + 1;

		batches.push(claims.slice(start, end));

		if (end >= claims.length) break;
		const nextStart = Math.max(end - overlap, start + 1);
		start = nextStart;
	}

	return batches.length > 0 ? batches : [claims];
}

function relationDedupeKey(relation: PhaseOneRelation): string {
	return `${relation.from_position}:${relation.to_position}:${relation.relation_type}`;
}

function estimateRelationsClaimsJsonTokens(claims: PhaseOneClaim[]): number {
	return estimateTokens(JSON.stringify(claims, null, 2));
}

function mergeRelationsDedup(
	existing: PhaseOneRelation[],
	incoming: PhaseOneRelation[]
): PhaseOneRelation[] {
	const merged = new Map<string, PhaseOneRelation>();

	for (const r of existing) {
		merged.set(relationDedupeKey(r), { ...r, evidence_passage_ids: [...new Set(r.evidence_passage_ids)] });
	}

	for (const r of incoming) {
		const key = relationDedupeKey(r);
		const prev = merged.get(key);
		if (!prev) {
			merged.set(key, { ...r, evidence_passage_ids: [...new Set(r.evidence_passage_ids)] });
			continue;
		}

		const evidence_passage_ids = [...new Set([...(prev.evidence_passage_ids ?? []), ...(r.evidence_passage_ids ?? [])])];
		const prevHasNote = typeof prev.note === 'string' && prev.note.trim().length > 0;
		const nextHasNote = typeof r.note === 'string' && r.note.trim().length > 0;

		// Keep the higher-confidence relation, but preserve richer evidence/note when possible.
		const pickHigher = (r.relation_confidence ?? 0) > (prev.relation_confidence ?? 0) ? r : prev;
		const other = pickHigher === r ? prev : r;

		merged.set(key, {
			...pickHigher,
			evidence_passage_ids,
			note: (typeof pickHigher.note === 'string' && pickHigher.note.trim().length > 0)
				? pickHigher.note
				: nextHasNote && !prevHasNote
					? other.note
					: pickHigher.note
		});
	}

	return Array.from(merged.values()).sort((a, b) => {
		if (a.from_position !== b.from_position) return a.from_position - b.from_position;
		if (a.to_position !== b.to_position) return a.to_position - b.to_position;
		return a.relation_type.localeCompare(b.relation_type);
	});
}

function mergeGroupingOutputs(outputs: GroupingOutput[]): GroupingOutput {
	const merged = new Map<string, GroupingOutput[number]>();

	for (const output of outputs) {
		for (const argument of output) {
			const key = `${argument.name.trim().toLowerCase()}::${argument.domain}`;
			const existing = merged.get(key);
			if (!existing) {
				merged.set(key, {
					...argument,
					claims: [...argument.claims]
				});
				continue;
			}

			const claimRefs = new Map<string, GroupingOutput[number]['claims'][number]>();
			for (const claimRef of existing.claims) {
				claimRefs.set(`${claimRef.position_in_source}:${claimRef.role}`, claimRef);
			}
			for (const claimRef of argument.claims) {
				claimRefs.set(`${claimRef.position_in_source}:${claimRef.role}`, claimRef);
			}

			existing.claims = Array.from(claimRefs.values()).sort(
				(a, b) => a.position_in_source - b.position_in_source
			);
			if (!existing.tradition && argument.tradition) {
				existing.tradition = argument.tradition;
			}
			if ((!existing.summary || existing.summary.trim().length === 0) && argument.summary) {
				existing.summary = argument.summary;
			}
		}
	}

	return Array.from(merged.values());
}

function buildValidationBatch(
	batchClaims: PhaseOneClaim[],
	relations: PhaseOneRelation[],
	arguments_: GroupingOutput,
	sourceText: string,
	sourceTitle: string
): ValidationBatch {
	const claimPositions = new Set(batchClaims.map((claim) => claim.position_in_source));
	const batchRelations = relations.filter(
		(relation) =>
			claimPositions.has(relation.from_position) && claimPositions.has(relation.to_position)
	);
	const batchArguments = arguments_
		.map((argument) => {
			const claims = argument.claims.filter((claimRef) =>
				claimPositions.has(claimRef.position_in_source)
			);
			if (claims.length === 0) return null;
			return {
				...argument,
				claims
			};
		})
		.filter((argument): argument is Argument => Boolean(argument));
	const batchSourceText = buildValidationSourceSnippet(batchClaims, sourceText, {
		maxChars: VALIDATION_BATCH_SOURCE_MAX_CHARS,
		contextChars: VALIDATION_BATCH_SOURCE_CONTEXT_CHARS
	});

	const claimsJson = JSON.stringify(batchClaims, null, 2);
	const relationsJson = JSON.stringify(batchRelations, null, 2);
	const argumentsJson = JSON.stringify(batchArguments, null, 2);
	const promptText =
		VALIDATION_SYSTEM +
		'\n\n' +
		VALIDATION_USER({
			sourceTitle,
			sourceText: batchSourceText,
			claimsJson,
			relationsJson,
			argumentsJson
		});
	const estimatedPromptTokens = Math.ceil(
		estimateTokens(promptText) * VALIDATION_TOKEN_ESTIMATE_MULTIPLIER
	);

	return {
		claims: batchClaims,
		relations: batchRelations,
		arguments: batchArguments,
		sourceText: batchSourceText,
		estimatedPromptTokens
	};
}

function buildValidationBatches(
	claims: PhaseOneClaim[],
	relations: PhaseOneRelation[],
	arguments_: GroupingOutput,
	sourceText: string,
	sourceTitle: string,
	targetTokens: number
): ValidationBatch[] {
	const tokenSeedBatches = splitClaimsIntoGroupingBatches(claims, targetTokens);
	const snippetOpts = {
		maxChars: VALIDATION_BATCH_SOURCE_MAX_CHARS,
		contextChars: VALIDATION_BATCH_SOURCE_CONTEXT_CHARS
	};
	const tokenBatchCount = tokenSeedBatches.length;
	const seedBatches = tokenSeedBatches.flatMap((batch) =>
		splitClaimsForValidationSnippetBudget(batch, sourceText, snippetOpts)
	);
	if (seedBatches.length > tokenBatchCount) {
		console.log(
			`  [INFO] Validation span-window split: ${tokenBatchCount} token batch(es) → ${seedBatches.length} batch(es) (source window ≤${snippetOpts.maxChars.toLocaleString()} chars per batch)`
		);
	}
	const queue = [...seedBatches];
	const result: ValidationBatch[] = [];

	while (queue.length > 0) {
		const nextClaims = queue.shift()!;
		const batch = buildValidationBatch(nextClaims, relations, arguments_, sourceText, sourceTitle);
		if (batch.estimatedPromptTokens > targetTokens && nextClaims.length > 1) {
			const midpoint = Math.ceil(nextClaims.length / 2);
			const firstHalf = nextClaims.slice(0, midpoint);
			const secondHalf = nextClaims.slice(midpoint);
			if (secondHalf.length > 0) {
				queue.unshift(secondHalf);
			}
			if (firstHalf.length > 0) {
				queue.unshift(firstHalf);
			}
			continue;
		}
		result.push(batch);
	}

	return result.length > 0 ? result : [buildValidationBatch(claims, relations, arguments_, sourceText, sourceTitle)];
}

function mergeValidationIssueText(existing?: string, incoming?: string): string | undefined {
	const parts = new Set<string>();
	for (const value of [existing, incoming]) {
		if (!value) continue;
		for (const token of value.split('|').map((token) => token.trim())) {
			if (token) parts.add(token);
		}
	}
	if (parts.size === 0) return undefined;
	return [...parts].join(' | ');
}

function mergeValidationOutputs(outputs: ValidationOutput[]): ValidationOutput {
	const claimMap = new Map<number, NonNullable<ValidationOutput['claims']>[number]>();
	const relationMap = new Map<string, NonNullable<ValidationOutput['relations']>[number]>();
	const argumentMap = new Map<string, NonNullable<ValidationOutput['arguments']>[number]>();
	const quarantineItems = new Set<string>();
	const summaries: string[] = [];

	for (const [index, output] of outputs.entries()) {
		if (output.summary?.trim()) {
			summaries.push(`Batch ${index + 1}: ${output.summary.trim()}`);
		}
		for (const item of output.quarantine_items ?? []) {
			if (item) quarantineItems.add(item);
		}

		for (const claim of output.claims ?? []) {
			const existing = claimMap.get(claim.position_in_source);
			if (!existing) {
				claimMap.set(claim.position_in_source, { ...claim });
			} else {
				existing.faithfulness_score = Math.min(existing.faithfulness_score, claim.faithfulness_score);
				existing.quarantine = Boolean(existing.quarantine || claim.quarantine);
				existing.faithfulness_issue = mergeValidationIssueText(
					existing.faithfulness_issue,
					claim.faithfulness_issue
				);
				existing.atomicity_issue = mergeValidationIssueText(
					existing.atomicity_issue,
					claim.atomicity_issue
				);
				existing.classification_issue = mergeValidationIssueText(
					existing.classification_issue,
					claim.classification_issue
				);
				existing.domain_issue = mergeValidationIssueText(existing.domain_issue, claim.domain_issue);
			}
			if (claim.quarantine) quarantineItems.add(`claim:${claim.position_in_source}`);
		}

		for (const relation of output.relations ?? []) {
			const key = `${relation.from_position}->${relation.to_position}`;
			const existing = relationMap.get(key);
			if (!existing) {
				relationMap.set(key, { ...relation });
			} else {
				existing.validity_score = Math.min(existing.validity_score, relation.validity_score);
				existing.quarantine = Boolean(existing.quarantine || relation.quarantine);
				existing.validity_issue = mergeValidationIssueText(
					existing.validity_issue,
					relation.validity_issue
				);
				existing.type_issue = mergeValidationIssueText(existing.type_issue, relation.type_issue);
			}
			if (relation.quarantine) quarantineItems.add(`relation:${key}`);
		}

		for (const argumentIssue of output.arguments ?? []) {
			const key = argumentIssue.argument_name.trim().toLowerCase();
			const existing = argumentMap.get(key);
			if (!existing) {
				argumentMap.set(key, { ...argumentIssue });
			} else {
				existing.coherence_score = Math.min(existing.coherence_score, argumentIssue.coherence_score);
				existing.quarantine = Boolean(existing.quarantine || argumentIssue.quarantine);
				existing.coherence_issue = mergeValidationIssueText(
					existing.coherence_issue,
					argumentIssue.coherence_issue
				);
				existing.role_issues = mergeValidationIssueText(existing.role_issues, argumentIssue.role_issues);
			}
			if (argumentIssue.quarantine) quarantineItems.add(`argument:${argumentIssue.argument_name}`);
		}
	}

	const merged: ValidationOutput = {
		claims: [...claimMap.values()].sort((a, b) => a.position_in_source - b.position_in_source),
		relations: [...relationMap.values()].sort((a, b) =>
			a.from_position === b.from_position
				? a.to_position - b.to_position
				: a.from_position - b.from_position
		),
		arguments: [...argumentMap.values()].sort((a, b) => a.argument_name.localeCompare(b.argument_name)),
		quarantine_items: [...quarantineItems].sort(),
		summary: summaries.join(' ').trim() || 'Validation completed across batched prompts.'
	};

	return normalizeValidationOutput(merged);
}

function assertEmbeddingVectorsMatchConfig(vectors: number[][], label: string): void {
	const prov = getEmbeddingProvider();
	for (let i = 0; i < vectors.length; i++) {
		const v = vectors[i];
		if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS) {
			throw new Error(
				`[INTEGRITY] ${label}: vector at index ${i} has length ${Array.isArray(v) ? v.length : 'n/a'}, expected ${EMBEDDING_DIMENSIONS} (${prov.name}:${EMBEDDING_MODEL}). Re-embed with a consistent model or clear checkpoints.`
			);
		}
	}
}

function normalizeExtractionDomain(value: unknown): string {
	return coerceIngestDomainLabel(value);
}

function normalizeExtractionClaimType(value: unknown): string {
	if (typeof value !== 'string') return 'premise';
	const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, '_');
	const typeMap: Record<string, string> = {
		thesis: 'thesis',
		premise: 'premise',
		objection: 'objection',
		counterargument: 'objection',
		counter_argument: 'objection',
		response: 'response',
		reply: 'response',
		rebuttal: 'response',
		definition: 'definition',
		thought_experiment: 'thought_experiment',
		thoughtexperiment: 'thought_experiment',
		empirical: 'empirical',
		methodological: 'methodological'
	};
	return typeMap[normalized] ?? 'premise';
}

function reviewStateForConfidence(confidence: number): ReviewState {
	return confidence < LOW_CONFIDENCE_REVIEW_THRESHOLD ? 'needs_review' : 'candidate';
}

function relationConfidenceFromStrength(strength?: string): number {
	if (strength === 'strong') return 0.9;
	if (strength === 'weak') return 0.58;
	return 0.74;
}

function findFallbackPassage(
	claim: Pick<ExtractionClaim, 'section_context' | 'position_in_source'>,
	passages: PassageRecord[]
): PassageRecord {
	const bySection = passages.find(
		(passage) =>
			passage.section_title &&
			claim.section_context &&
			passage.section_title.toLowerCase() === claim.section_context.toLowerCase()
	);
	if (bySection) return bySection;
	const index = Math.min(
		passages.length - 1,
		Math.max(0, (claim.position_in_source ?? 1) - 1)
	);
	return passages[index] ?? passages[0]!;
}

function attachPassageMetadataToClaims(
	claims: ExtractionOutput,
	passages: PassageRecord[],
	positionOffset = 0,
	sourceMeta?: Pick<SourceMeta, 'title' | 'author' | 'year'>
): PhaseOneClaim[] {
	const passageById = new Map(passages.map((passage) => [passage.id, passage]));
	return claims.map((claim, index) => {
		const position = positionOffset + index + 1;
		const byId =
			typeof claim.passage_id === 'string' ? passageById.get(claim.passage_id) : undefined;
		let matchedPassage: PassageRecord | undefined = byId;
		if (!matchedPassage && passages.length === 1) {
			matchedPassage = passages[0];
		}
		if (!matchedPassage) {
			matchedPassage = findFallbackPassage(claim, passages);
			if (passages.length > 1) {
				const pid =
					typeof claim.passage_id === 'string' && claim.passage_id.trim()
						? `"${claim.passage_id}"`
						: '(missing)';
				console.warn(
					`  [WARN] Extraction claim ${position}: passage_id ${pid} did not resolve; grounded to passage ${matchedPassage.id} (${matchedPassage.section_title ?? 'section unknown'})`
				);
			}
		}
		// Do not trust model-supplied positions; make ordering deterministic per batch.
		const typingMetadata = deriveClaimTypingMetadata(
			{
				text: claim.text,
				claim_type: claim.claim_type,
				claim_origin: claim.claim_origin,
				subdomain: claim.subdomain,
				thinker: claim.thinker,
				tradition: claim.tradition,
				era: claim.era,
				claim_scope: claim.claim_scope,
				concept_tags: claim.concept_tags,
				domain: claim.domain
			},
			{
				sourceTitle: sourceMeta?.title ?? '',
				sourceAuthors: sourceMeta?.author ?? [],
				sourceYear: sourceMeta?.year,
				passageRole: matchedPassage?.role
			}
		);
		return {
			...claim,
			position_in_source: position,
			passage_id: matchedPassage?.id,
			passage_order: matchedPassage?.order_in_source,
			passage_role: matchedPassage?.role,
			section_context: claim.section_context ?? matchedPassage?.section_title ?? undefined,
			source_span_start: matchedPassage?.span.start,
			source_span_end: matchedPassage?.span.end,
			claim_origin: typingMetadata.claim_origin,
			subdomain: typingMetadata.subdomain,
			thinker: typingMetadata.thinker,
			tradition: typingMetadata.tradition,
			era: typingMetadata.era,
			claim_scope: typingMetadata.claim_scope,
			attributed_to: typingMetadata.attributed_to,
			concept_tags: typingMetadata.concept_tags,
			verification_state: 'unverified' as const,
			review_state: reviewStateForConfidence(claim.confidence),
			extractor_version: INGEST_EXTRACTOR_VERSION,
			contested_terms: typingMetadata.contested_terms
		};
	});
}

function normalizeSequentialClaimPositions(claims: PhaseOneClaim[]): PhaseOneClaim[] {
	return claims.map((claim, index) => {
		const expected = index + 1;
		if (claim.position_in_source === expected) return claim;
		return { ...claim, position_in_source: expected };
	});
}

function ensurePhaseOneClaims(
	claims: PhaseOneClaim[] | ExtractionOutput,
	passages: PassageRecord[],
	sourceMeta?: Pick<SourceMeta, 'title' | 'author' | 'year'>
): PhaseOneClaim[] {
	return claims.map((claim) => {
		if ('claim_origin' in claim && typeof claim.claim_origin === 'string') {
			return claim as PhaseOneClaim;
		}
		const fallbackPassage = findFallbackPassage(claim, passages);
		const typingMetadata = deriveClaimTypingMetadata(
			{
				text: (claim as ExtractionClaim).text,
				claim_type: (claim as ExtractionClaim).claim_type,
				claim_origin: (claim as ExtractionClaim).claim_origin,
				subdomain: (claim as ExtractionClaim).subdomain,
				thinker: (claim as ExtractionClaim).thinker,
				tradition: (claim as ExtractionClaim).tradition,
				era: (claim as ExtractionClaim).era,
				claim_scope: (claim as ExtractionClaim).claim_scope,
				concept_tags: (claim as ExtractionClaim).concept_tags,
				domain: (claim as ExtractionClaim).domain
			},
			{
				sourceTitle: sourceMeta?.title ?? '',
				sourceAuthors: sourceMeta?.author ?? [],
				sourceYear: sourceMeta?.year,
				passageRole: fallbackPassage.role
			}
		);
		return {
			...(claim as ExtractionClaim),
			passage_id: fallbackPassage.id,
			passage_order: fallbackPassage.order_in_source,
			passage_role: fallbackPassage.role,
			source_span_start: fallbackPassage.span.start,
			source_span_end: fallbackPassage.span.end,
			claim_origin: typingMetadata.claim_origin,
			subdomain: typingMetadata.subdomain,
			thinker: typingMetadata.thinker,
			tradition: typingMetadata.tradition,
			era: typingMetadata.era,
			claim_scope: typingMetadata.claim_scope,
			attributed_to: typingMetadata.attributed_to,
			concept_tags: typingMetadata.concept_tags,
			verification_state: 'unverified' as const,
			review_state: reviewStateForConfidence((claim as ExtractionClaim).confidence ?? 0.8),
			extractor_version: INGEST_EXTRACTOR_VERSION,
			contested_terms: typingMetadata.contested_terms
		};
	});
}

function attachRelationMetadata(relations: RelationsOutput, claims: PhaseOneClaim[]): PhaseOneRelation[] {
	const claimByPosition = new Map(claims.map((claim) => [claim.position_in_source, claim]));
	return relations.map((relation) => {
		const fromClaim = claimByPosition.get(relation.from_position);
		const toClaim = claimByPosition.get(relation.to_position);
		const evidencePassageIds = Array.from(
			new Set([fromClaim?.passage_id, toClaim?.passage_id].filter((value): value is string => Boolean(value)))
		);
		const explicit =
			(fromClaim?.passage_id && fromClaim.passage_id === toClaim?.passage_id) ||
			(relation.relation_type === 'responds_to' &&
				fromClaim?.claim_type === 'response' &&
				toClaim?.claim_type === 'objection');
		const relationConfidence = relationConfidenceFromStrength(relation.strength);
		return {
			...relation,
			evidence_passage_ids: evidencePassageIds,
			relation_confidence: relationConfidence,
			relation_inference_mode: (explicit ? 'explicit' : 'inferred') as 'explicit' | 'inferred',
			verification_state: 'unverified' as const,
			review_state: reviewStateForConfidence(relationConfidence),
			extractor_version: INGEST_EXTRACTOR_VERSION
		};
	});
}

function assertValidSourceMetadata(sourceMeta: SourceMeta): void {
	if (!sourceMeta.title?.trim() || sourceMeta.title.trim().toLowerCase() === 'unknown') {
		throw new Error('[INTEGRITY] Source metadata missing usable title');
	}
	if (!sourceMeta.url?.trim()) {
		throw new Error('[INTEGRITY] Source metadata missing URL');
	}
	const identity = canonicalizeAndHashSourceUrl(sourceMeta.canonical_url || sourceMeta.url);
	if (!identity) {
		throw new Error('[INTEGRITY] Source metadata URL cannot be canonicalized');
	}
	sourceMeta.canonical_url = identity.canonicalUrl;
	sourceMeta.canonical_url_hash = identity.canonicalUrlHash;
	sourceMeta.visibility_scope = sourceMeta.visibility_scope || 'public_shared';
	sourceMeta.deletion_state = sourceMeta.deletion_state || 'active';
}

function assertFiniteCostEstimate(): void {
	const estimatedUsd = Number(estimateCostUsd());
	if (!Number.isFinite(estimatedUsd)) {
		throw new Error('[INTEGRITY] Cost estimate is non-finite');
	}
}

function assertClaimIntegrity(claims: PhaseOneClaim[]): void {
	if (claims.length === 0) {
		throw new Error('[INTEGRITY] Stage 1 produced 0 claims');
	}

	const seenPositions = new Set<number>();
	let previousPosition = 0;
	for (const claim of [...claims].sort((a, b) => a.position_in_source - b.position_in_source)) {
		if (seenPositions.has(claim.position_in_source)) {
			throw new Error(`[INTEGRITY] Duplicate claim position detected: ${claim.position_in_source}`);
		}
		if (claim.position_in_source <= previousPosition) {
			throw new Error(
				`[INTEGRITY] Non-monotonic claim positions detected around ${claim.position_in_source}`
			);
		}
		if (
			typeof claim.source_span_start !== 'number' ||
			typeof claim.source_span_end !== 'number' ||
			claim.source_span_end < claim.source_span_start
		) {
			throw new Error(
				`[INTEGRITY] Claim ${claim.position_in_source} missing valid source span provenance`
			);
		}
		if (!claim.claim_origin || !claim.claim_scope) {
			throw new Error(
				`[INTEGRITY] Claim ${claim.position_in_source} missing Stage 1.2 typing metadata`
			);
		}
		seenPositions.add(claim.position_in_source);
		previousPosition = claim.position_in_source;
	}
}

function assertRelationIntegrity(relations: PhaseOneRelation[], claims: PhaseOneClaim[]): void {
	const knownPositions = new Set(claims.map((claim) => claim.position_in_source));
	const missingEndpoints = relations.filter(
		(relation) =>
			!knownPositions.has(relation.from_position) || !knownPositions.has(relation.to_position)
	);
	if (missingEndpoints.length > 0) {
		const sample = missingEndpoints
			.slice(0, 5)
			.map((relation) => `${relation.from_position}->${relation.to_position}`)
			.join(', ');
		throw new Error(
			`[INTEGRITY] ${missingEndpoints.length} relations reference missing claim positions (${sample})`
		);
	}
}

function planMatchesCanonicalTier(
	plan: IngestionStagePlan,
	tier: { provider: string; modelId: string }
): boolean {
	return plan.provider === tier.provider && plan.model === tier.modelId;
}

const PIN_SUFFIX_BY_STAGE: Partial<Record<StageKey, string>> = {
	extraction: 'EXTRACTION',
	relations: 'RELATIONS',
	grouping: 'GROUPING',
	validation: 'VALIDATION',
	remediation: 'REMEDIATION',
	json_repair: 'JSON_REPAIR'
};

function isStageModelPinned(stage: StageKey): boolean {
	const suf = PIN_SUFFIX_BY_STAGE[stage];
	if (!suf) return false;
	const p = process.env[`INGEST_PIN_PROVIDER_${suf}`]?.trim();
	const m = process.env[`INGEST_PIN_MODEL_${suf}`]?.trim();
	return Boolean(p && m);
}

function ingestModelFallbackDisabled(): boolean {
	const v = (process.env.INGEST_NO_MODEL_FALLBACK ?? '').trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes';
}

async function callStageModel(params: {
	stage: StageKey;
	plan: IngestionStagePlan;
	budget: StageBudget;
	tracker: StageUsageTracker;
	systemPrompt: string;
	userMessage: string;
	maxTokens?: number;
	/** Used to replan explicit fallback tiers after transient failures. */
	planningContext: IngestionPlanningContext;
}): Promise<string> {
	const {
		stage,
		plan,
		budget,
		tracker,
		systemPrompt,
		userMessage,
		maxTokens = 32768,
		planningContext
	} = params;

	const catalogRouting = loadIngestCatalogRoutingFromEnv();
	const effectiveChain = buildEffectiveModelChainForStage(stage, plan, planningContext, catalogRouting);
	const noFallback = ingestModelFallbackDisabled() || isStageModelPinned(stage);

	/** When pins are set, `noFallback` uses a single `plan` — but finetune policy must still block disallowed vendors (e.g. Anthropic) on sensitive stages. */
	let planForNoFallback = plan;
	if (
		noFallback &&
		isStageModelPinned(stage) &&
		isFinetuneSensitiveLlmStage(stage) &&
		ingestFinetuneLabelerStrictEnabled(process.env)
	) {
		const allowed = new Set(parseFinetuneLabelerAllowedProviders(process.env));
		const pinProv = plan.provider.trim().toLowerCase();
		if (!allowed.has(pinProv) && effectiveChain.length > 0) {
			const tier = effectiveChain[0]!;
			if (!planMatchesCanonicalTier(plan, tier)) {
				planForNoFallback = await planIngestionStageWithExplicitModel(stage, planningContext, tier);
				console.warn(
					`  [INGEST_FINETUNE_POLICY] ${stage}: operator pin ${plan.provider}/${plan.model} is not in allowed providers — using ${tier.provider}/${tier.modelId} (no cross-model fallback)`
				);
			}
		}
	}

	let lastError: Error | null = null;

	async function runInnerRetries(activePlan: IngestionStagePlan): Promise<string | null> {
		async function invokeModelCallOnce(): Promise<string> {
			if (!activePlan.route) {
				throw new Error(`No executable route available for ${stage}`);
			}

			const callStarted = Date.now();
			const routingProvider = activePlan.route.provider ?? activePlan.provider;
			const foldSystem = shouldFoldSystemPromptIntoUserForProvider(routingProvider);
			const estTpmTokens =
				estimateTokens(systemPrompt) + estimateTokens(userMessage) + maxTokens;
			await ingestTpmGuard.waitForBudget(routingProvider, estTpmTokens);
			if (routingProvider.trim().toLowerCase() === 'mistral') {
				await paceMistralChatCompletion(activePlan.model);
			}
			if (routingProvider.trim().toLowerCase() === 'deepseek') {
				await paceDeepseekChatCompletion(activePlan.model);
			}
			if (routingProvider.trim().toLowerCase() === 'groq') {
				await paceGroqChatCompletion(activePlan.model);
			}
			emitIngestTelemetry({
				event: 'model_call_start',
				stage,
				provider: routingProvider,
				model: activePlan.model
			});
			const omitTemperature = shouldOmitGenerateTextTemperature(
				stage,
				routingProvider,
				activePlan.model
			);
			const textGenBase = foldSystem
				? {
						model: activePlan.route.model,
						messages: [
							{
								role: 'user' as const,
								content: `${systemPrompt}\n\n${userMessage}`
							}
						],
						maxOutputTokens: maxTokens
					}
				: {
						model: activePlan.route.model,
						system: systemPrompt,
						messages: [{ role: 'user' as const, content: userMessage }],
						maxOutputTokens: maxTokens
					};
			const textGenParams = omitTemperature
				? textGenBase
				: { ...textGenBase, temperature: 0.1 as const };
			// Abort in-flight HTTP when the stage budget elapses. Plain `Promise.race` does not cancel
			// `generateText`, so a stalled provider could sit until TCP idle — abortSignal tears down the fetch.
			const abortController = new AbortController();
			const abortTimer = setTimeout(() => {
				abortController.abort();
			}, budget.timeoutMs);
			try {
				if (stage === 'grouping') {
					const structuredSuffix = `\n\nReturn a single JSON object (no markdown) with exactly this structure: {"named_arguments":[ ... ]} where "named_arguments" is the array of named-argument objects matching the system specification.`;
					const structuredUser = `${userMessage}${structuredSuffix}`;
					const structuredBase = foldSystem
						? {
								model: activePlan.route.model,
								messages: [
									{
										role: 'user' as const,
										content: `${systemPrompt}\n\n${structuredUser}`
									}
								],
								maxOutputTokens: maxTokens,
								schema: GroupingStructuredRootSchema,
								abortSignal: abortController.signal
							}
						: {
								model: activePlan.route.model,
								system: systemPrompt,
								messages: [{ role: 'user' as const, content: structuredUser }],
								maxOutputTokens: maxTokens,
								schema: GroupingStructuredRootSchema,
								abortSignal: abortController.signal
							};
					const structParams = omitTemperature
						? structuredBase
						: { ...structuredBase, temperature: 0.1 as const };
					try {
						const objResult = await runWithIngestTelemetryHeartbeat({
							stage,
							work: () => generateObject(structParams as Parameters<typeof generateObject>[0])
						});
						if (objResult.finishReason === 'length') {
							throw new Error('Model output was truncated (max_tokens reached)');
						}
						if (activeIngestTiming) {
							const wall = Date.now() - callStarted;
							activeIngestTiming.model_calls[stage] =
								(activeIngestTiming.model_calls[stage] ?? 0) + 1;
							activeIngestTiming.model_call_wall_ms[stage] =
								(activeIngestTiming.model_call_wall_ms[stage] ?? 0) + wall;
							activeIngestTiming.stage_models[stage] = `${routingProvider}/${activePlan.model}`;
						}
						const wallMs = Date.now() - callStarted;
						emitIngestTelemetry({
							event: 'model_call_end',
							stage,
							provider: routingProvider,
							model: activePlan.model,
							duration_ms: wallMs,
							input_tokens: objResult.usage?.inputTokens ?? 0,
							output_tokens: objResult.usage?.outputTokens ?? 0
						});
						const inputTokens = objResult.usage?.inputTokens ?? 0;
						const outputTokens = objResult.usage?.outputTokens ?? 0;
						if (activeIngestTiming) {
							bumpStageTokens(stage, inputTokens, outputTokens);
						}
						ingestTpmGuard.recordUsage(routingProvider, inputTokens + outputTokens);
						const usageCostUsd = trackReasoningCost(activePlan.model, inputTokens, outputTokens);
						console.log(
							`  [ROUTE] ${stage} (structured): ${activePlan.provider}/${activePlan.model} source=${activePlan.routingSource} step=${activePlan.selectedStepId ?? '—'} order=${activePlan.selectedOrderIndex ?? '—'} switch=${activePlan.switchReasonCode ?? '—'} cost~$${usageCostUsd.toFixed(4)}`
						);
						if ((process.env.INGEST_LLM_HEALTH_RECORD_SUCCESS || '').trim() === '1') {
							void noteIngestModelSuccessInDb(activePlan.provider, activePlan.model);
							void noteIngestStageModelSuccessInDb(stage, activePlan.provider, activePlan.model);
						}
						clearIngestCircuitSuccess(stage, activePlan.provider, activePlan.model);
						assertStageBudget(budget, tracker);
						return JSON.stringify(objResult.object.named_arguments);
					} catch (structuredErr) {
						console.warn(
							`  [WARN] Grouping structured object generation failed (${structuredErr instanceof Error ? formatModelCallErrorDetails(structuredErr) : String(structuredErr)}) — falling back to JSON text`
						);
					}
				}

				let result: Awaited<ReturnType<typeof generateText>>;
				result = await runWithIngestTelemetryHeartbeat({
					stage,
					work: () => generateText({ ...textGenParams, abortSignal: abortController.signal })
				});
				if (activeIngestTiming) {
					const wall = Date.now() - callStarted;
					activeIngestTiming.model_calls[stage] = (activeIngestTiming.model_calls[stage] ?? 0) + 1;
					activeIngestTiming.model_call_wall_ms[stage] =
						(activeIngestTiming.model_call_wall_ms[stage] ?? 0) + wall;
					activeIngestTiming.stage_models[stage] = `${routingProvider}/${activePlan.model}`;
				}
				const wallMs = Date.now() - callStarted;
				emitIngestTelemetry({
					event: 'model_call_end',
					stage,
					provider: routingProvider,
					model: activePlan.model,
					duration_ms: wallMs,
					input_tokens: result.usage?.inputTokens ?? 0,
					output_tokens: result.usage?.outputTokens ?? 0
				});
				const inputTokens = result.usage?.inputTokens ?? 0;
				const outputTokens = result.usage?.outputTokens ?? 0;
				if (activeIngestTiming) {
					bumpStageTokens(stage, inputTokens, outputTokens);
				}
				ingestTpmGuard.recordUsage(routingProvider, inputTokens + outputTokens);
				const usageCostUsd = trackReasoningCost(activePlan.model, inputTokens, outputTokens);
				if (result.finishReason === 'length') {
					throw new Error('Model output was truncated (max_tokens reached)');
				}
				console.log(
					`  [ROUTE] ${stage}: ${activePlan.provider}/${activePlan.model} source=${activePlan.routingSource} step=${activePlan.selectedStepId ?? '—'} order=${activePlan.selectedOrderIndex ?? '—'} switch=${activePlan.switchReasonCode ?? '—'} cost~$${usageCostUsd.toFixed(4)}`
				);
				if ((process.env.INGEST_LLM_HEALTH_RECORD_SUCCESS || '').trim() === '1') {
					void noteIngestModelSuccessInDb(activePlan.provider, activePlan.model);
					void noteIngestStageModelSuccessInDb(stage, activePlan.provider, activePlan.model);
				}
				clearIngestCircuitSuccess(stage, activePlan.provider, activePlan.model);
				assertStageBudget(budget, tracker);
				return result.text;
			} catch (e) {
				if (abortController.signal.aborted) {
					throw new Error(
						`${stage} ${activePlan.provider}:${activePlan.model} timed out after ${budget.timeoutMs}ms (aborted)`
					);
				}
				throw e;
			} finally {
				clearTimeout(abortTimer);
			}
		}

		for (let attempt = 0; attempt <= budget.maxRetries; attempt++) {
			try {
				if (attempt > 0) {
					if (tracker.retries >= budget.maxRetries) {
						throw new Error(`[BUDGET] ${stage} exceeded retry cap (${budget.maxRetries})`);
					}
					tracker.retries += 1;
					const delayMs = 1000 * Math.pow(2, attempt - 1);
					if (activeIngestTiming) {
						activeIngestTiming.model_retries += 1;
						activeIngestTiming.retry_backoff_ms_total += delayMs;
					}
					console.log(
						`  [RETRY] ${stage} ${activePlan.provider}:${activePlan.model} attempt ${attempt + 1}/${budget.maxRetries + 1} (${delayMs}ms backoff)`
					);
					await sleep(delayMs);
				}

				return await invokeModelCallOnce();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				const msg = collectErrorMessageChain(lastError);
				const retryable =
					msg.includes('429') ||
					msg.includes('529') ||
					msg.includes('500') ||
					msg.includes('502') ||
					msg.includes('503') ||
					msg.includes('504') ||
					msg.includes('overloaded') ||
					msg.includes('timeout') ||
					msg.includes('aborted') ||
					lastError.name === 'AbortError' ||
					msg.includes('prompt_too_long') ||
					msg.includes('context_length') ||
					/resource exhausted/i.test(msg) ||
					/rate limit|quota|too many requests/i.test(msg) ||
					/\btpm\b|tokens per min|token.?per.?min/i.test(msg);
				console.warn(
					`  [WARN] ${stage} ${activePlan.provider}:${activePlan.model} failed: ${formatModelCallErrorDetails(error)}`
				);
				if (isModelUnavailableError(lastError)) break;
				if (!retryable) break;
			}
		}

		if (ingestRecoveryAgentEnabled() && lastError && isRetryableIngestModelError(lastError)) {
			console.log(
				formatIngestSelfHealLine({
					v: 1,
					signal: 'recovery_agent',
					stage,
					provider: activePlan.provider,
					model: activePlan.model,
					outcome: 'consult',
					detail: 'after inner retries exhausted'
				})
			);
			const errorChain = collectErrorMessageChain(lastError);
			const decision = await consultIngestionRecoveryAgent({
				stage,
				provider: activePlan.provider,
				model: activePlan.model,
				errorMessage: errorChain,
				suggestedRetryAfterMs: parseRetryAfterMsFromProviderMessage(errorChain)
			});
			if (activeIngestTiming) {
				activeIngestTiming.recovery_agent_invocations += 1;
			}
			const sleepMs = effectiveRecoverySleepMs(decision);
			const outcomeLabel =
				decision.action === 'sleep_and_retry_once' ? 'sleep_retry' : 'proceed_to_fallback';
			console.log(
				formatIngestSelfHealLine({
					v: 1,
					signal: 'recovery_agent',
					stage,
					provider: activePlan.provider,
					model: activePlan.model,
					outcome: outcomeLabel,
					detail: decision.rationale?.slice(0, 500)
				})
			);
			if (decision.action === 'sleep_and_retry_once') {
				if (activeIngestTiming) {
					activeIngestTiming.recovery_agent_backoff_ms_total += sleepMs;
					activeIngestTiming.retry_backoff_ms_total += sleepMs;
				}
				if (sleepMs > 0) {
					console.log(
						`  [RECOVERY_AGENT] ${stage} ${activePlan.provider}:${activePlan.model} sleeping ${sleepMs}ms before one sponsored retry`
					);
					await sleep(sleepMs);
				}
				try {
					return await invokeModelCallOnce();
				} catch (agentRetryErr) {
					lastError =
						agentRetryErr instanceof Error ? agentRetryErr : new Error(String(agentRetryErr));
					console.warn(
						`  [WARN] ${stage} ${activePlan.provider}:${activePlan.model} recovery retry failed: ${formatModelCallErrorDetails(agentRetryErr)}`
					);
				}
			}
		}

		recordIngestModelFailure(stage, activePlan.provider, activePlan.model);
		return null;
	}

	if (noFallback) {
		const only = await runInnerRetries(planForNoFallback);
		if (only !== null) return only;
		const detail =
			lastError != null ? formatModelCallErrorDetails(lastError) : 'Unknown error';
		throw new Error(
			`[${stage}] Model call failed and cross-model fallback is disabled (operator model pin or INGEST_NO_MODEL_FALLBACK): ${detail}`
		);
	}

	if (catalogRouting && effectiveChain.length > 1) {
		console.log(
			`  [ROUTING] ${stage}: catalog-aware chain (${effectiveChain.length} candidate(s)) — cheapest suitable first, failure-deprioritized`
		);
	}

	for (let ci = 0; ci < effectiveChain.length; ci++) {
		const tier = effectiveChain[ci]!;
		const circuitCk = stageModelCircuitKey(stage, tier.provider, tier.modelId);
		if (ingestCircuitBlocked.has(circuitCk)) {
			console.warn(
				`  [CIRCUIT] ${stage}: skipping ${tier.provider}/${tier.modelId} (soft circuit open for this process)`
			);
			continue;
		}
		let activePlan: IngestionStagePlan;
		if (planMatchesCanonicalTier(plan, tier)) {
			activePlan = plan;
		} else {
			try {
				activePlan = await planIngestionStageWithExplicitModel(stage, planningContext, tier);
				console.warn(
					`  [FALLBACK] ${stage}: trying ${activePlan.provider}/${activePlan.model} (${ci + 1}/${effectiveChain.length} in chain)`
				);
			} catch (planErr) {
				console.warn(
					`  [FALLBACK] ${stage}: could not plan ${tier.provider}/${tier.modelId} — ${
						planErr instanceof Error ? planErr.message : String(planErr)
					}`
				);
				lastError = planErr instanceof Error ? planErr : new Error(String(planErr));
				continue;
			}
		}
		const t = await runInnerRetries(activePlan);
		if (t !== null) return t;
	}

	const detail =
		lastError != null ? formatModelCallErrorDetails(lastError) : 'Unknown error';
	throw new Error(
		`[${stage}] Planned route and fallback chain exhausted (${plan.provider}:${plan.model}): ${detail}. If this is Anthropic, check the model id is not retired (see https://docs.anthropic.com/en/docs/about-claude/model-deprecations).`
	);
}

async function callStageModelWithProgress(params: {
	stage: StageKey;
	plan: IngestionStagePlan;
	budget: StageBudget;
	tracker: StageUsageTracker;
	systemPrompt: string;
	userMessage: string;
	label: string;
	maxTokens?: number;
	planningContext: IngestionPlanningContext;
}): Promise<string> {
	const spinner = startSpinner(params.label);
	try {
		const result = await callStageModel(params);
		spinner.stop();
		return result;
	} catch (error) {
		spinner.stop();
		throw error;
	}
}

async function fixJsonWithModel(
	repairPlan: IngestionStagePlan,
	repairBudget: StageBudget,
	repairTracker: StageUsageTracker,
	originalJson: string,
	parseError: string,
	schema: string,
	planningContext: IngestionPlanningContext
): Promise<string> {
	if (activeIngestTiming) activeIngestTiming.json_repair_invocations += 1;
	console.log(`  [FIX] Repair route: ${repairPlan.provider}:${repairPlan.model}`);

	const fixPrompt = `The following JSON output was malformed. Please fix it so it is valid JSON matching this schema:

Schema: ${schema}

Error: ${parseError}

Malformed JSON:
${originalJson}

Respond ONLY with the corrected JSON array. No explanation, no markdown backticks.`;

	return callStageModelWithProgress({
		stage: 'json_repair',
		plan: repairPlan,
		budget: repairBudget,
		tracker: repairTracker,
		systemPrompt:
			'You are a JSON repair assistant. Fix the malformed JSON to be valid. Respond with only the corrected JSON.',
		userMessage: fixPrompt,
		label: 'Fixing malformed JSON',
		maxTokens: maxOutputTokensForJsonRepair(repairBudget),
		planningContext
	});
}

const MAX_VALIDATION_CONTEXT_SPLIT_DEPTH = 8;

type ValidationBatchExecContext = {
	validationPlan: IngestionStagePlan;
	validationBudget: StageBudget;
	validationTracker: StageUsageTracker;
	jsonRepairPlan: IngestionStagePlan;
	jsonRepairBudget: StageBudget;
	repairTracker: StageUsageTracker;
	relations: PhaseOneRelation[];
	arguments_: GroupingOutput;
	sourceText: string;
	sourceTitle: string;
	planningContext: IngestionPlanningContext;
};

async function executeValidationBatchModelCall(
	batch: ValidationBatch,
	ctx: ValidationBatchExecContext
): Promise<string> {
	const claimsJson = JSON.stringify(batch.claims, null, 2);
	const relationsJson = JSON.stringify(batch.relations, null, 2);
	const argumentsJson = JSON.stringify(batch.arguments, null, 2);
	const validationPrompt =
		VALIDATION_SYSTEM +
		'\n\n' +
		VALIDATION_USER({
			sourceTitle: ctx.sourceTitle,
			sourceText: batch.sourceText,
			claimsJson,
			relationsJson,
			argumentsJson
		});
	return callStageModel({
		stage: 'validation',
		plan: ctx.validationPlan,
		budget: ctx.validationBudget,
		tracker: ctx.validationTracker,
		systemPrompt: 'You are a strict validation assistant. Return JSON only.',
		userMessage: validationPrompt,
		planningContext: ctx.planningContext
	});
}

async function parseValidationResponseWithRepair(
	responseText: string,
	batchLabel: string,
	ctx: ValidationBatchExecContext
): Promise<ValidationOutput> {
	try {
		const parsed = parseJsonResponse(responseText);
		return normalizeValidationOutput(parsed);
	} catch (parseError) {
		logIngestModelJsonParseFailure({
			scope: `validation ${batchLabel}`,
			rawResponse: responseText,
			error: parseError
		});
		console.warn(`  [WARN] JSON parse/validation failed for ${batchLabel}. Attempting fix...`);
		const fixedResponse = await fixJsonWithModel(
			ctx.jsonRepairPlan,
			ctx.jsonRepairBudget,
			ctx.repairTracker,
			responseText,
			parseError instanceof Error ? parseError.message : String(parseError),
			'Object with { claims?, relations?, arguments?, quarantine_items?, summary }',
			ctx.planningContext
		);
		const fixedParsed = parseJsonResponse(fixedResponse);
		return normalizeValidationOutput(fixedParsed);
	}
}

async function runValidationBatchWithContextSplitting(
	batch: ValidationBatch,
	ctx: ValidationBatchExecContext,
	depth: number,
	batchLabel: string
): Promise<ValidationOutput | null> {
	try {
		const responseText = await executeValidationBatchModelCall(batch, ctx);
		const validated = await parseValidationResponseWithRepair(responseText, batchLabel, ctx);
		console.log(
			`  [OK] ${batchLabel} complete (${validated.claims?.length || 0} claim checks)`
		);
		return validated;
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		const canSplit =
			isContextLengthExceededError(e) &&
			batch.claims.length > 1 &&
			depth < MAX_VALIDATION_CONTEXT_SPLIT_DEPTH;
		if (!canSplit) {
			console.warn(`  [WARN] ${batchLabel} failed after model fallbacks. Continuing.`);
			console.warn(`  Error: ${e.message}`);
			return null;
		}
		console.warn(
			`  [WARN] Validation context window exceeded — splitting ${batch.claims.length} claim(s) (${batchLabel}, split depth ${depth + 1}/${MAX_VALIDATION_CONTEXT_SPLIT_DEPTH})`
		);
		const mid = Math.ceil(batch.claims.length / 2);
		const b1 = buildValidationBatch(
			batch.claims.slice(0, mid),
			ctx.relations,
			ctx.arguments_,
			ctx.sourceText,
			ctx.sourceTitle
		);
		const b2 = buildValidationBatch(
			batch.claims.slice(mid),
			ctx.relations,
			ctx.arguments_,
			ctx.sourceText,
			ctx.sourceTitle
		);
		const left = await runValidationBatchWithContextSplitting(b1, ctx, depth + 1, `${batchLabel} (left)`);
		const right = await runValidationBatchWithContextSplitting(b2, ctx, depth + 1, `${batchLabel} (right)`);
		if (!left && !right) return null;
		if (!left) return right;
		if (!right) return left;
		return mergeValidationOutputs([left, right]);
	}
}

// ─── Source Metadata ───────────────────────────────────────────────────────
interface SourceMeta {
	title: string;
	author: string[];
	year?: number;
	source_type: string;
	url: string;
	canonical_url?: string;
	canonical_url_hash?: string;
	visibility_scope?: string;
	deletion_state?: string;
	fetched_at: string;
	word_count: number;
	char_count: number;
	estimated_tokens: number;
}

type PhaseOneClaim = ExtractionClaim & PhaseOneClaimMetadata;
type PhaseOneRelation = Relation & PhaseOneRelationMetadata;

// ─── Partial Results (for crash recovery) ──────────────────────────────────
interface PartialResults {
	source: SourceMeta;
	/** Full cleaned source text (Neon checkpoints only) — allows resume when data/sources is missing on the worker. */
	source_text_snapshot?: string;
	claims?: PhaseOneClaim[];
	relations?: PhaseOneRelation[];
	arguments?: GroupingOutput;
	embeddings?: number[][];
	validation?: ValidationOutput | null;
	stage_completed: string;
	/** Cumulative estimated USD at last save; used to seed cost tracker when resuming after failure. */
	cost_usd_snapshot?: number;
	// Mid-extraction checkpoint: if extraction crashes mid-batch, resume from here
	extraction_progress?: {
		claims_so_far: PhaseOneClaim[];
		remaining_batches?: PassageRecord[][];
		remaining_sections?: string[];
	};
	// Mid-grouping checkpoint: resume from next unfinished grouping batch
	grouping_progress?: {
		grouped_outputs_so_far: GroupingOutput[];
		next_batch_index: number;
		total_batches: number;
	};
	// Mid-validation checkpoint: resume from next unfinished validation batch
	validation_progress?: {
		batch_outputs_so_far: ValidationOutput[];
		next_batch_index: number;
		total_batches: number;
		should_validate: boolean;
	};
	// Mid-relations checkpoint: resume from next unfinished relations batch
	relations_progress?: {
		relations_so_far: PhaseOneRelation[];
		next_batch_index: number;
		total_batches: number;
		/** Adaptive TPM splits: linear queue of claim batches (replaces rebuild from RELATIONS_BATCH_TARGET_TOKENS when present). */
		batch_claim_slices?: PhaseOneClaim[][];
	};
	// Mid-embedding checkpoint: resume after each successful Vertex batch (see embedTexts onBatchComplete)
	embedding_progress?: {
		embeddings_so_far: number[][];
		next_index: number;
	};
	/** Mid-remediation checkpoint: ordered claim positions to repair */
	remediation_progress?: {
		positions: number[];
		next_index: number;
	};
}

async function savePartialResults(slug: string, results: PartialResults) {
	const runId = process.env.INGEST_ORCHESTRATION_RUN_ID?.trim();
	if (runId && process.env.DATABASE_URL?.trim()) {
		try {
			const snapshot = parseFloat(estimateCostUsd());
			const body = ingestSourceTextBodyForCheckpoint;
			const withSnapshot: PartialResults = {
				...results,
				cost_usd_snapshot: Number.isFinite(snapshot) && snapshot >= 0 ? snapshot : results.cost_usd_snapshot,
				...(typeof body === 'string' && body.length > 0 ? { source_text_snapshot: body } : {})
			};
			await saveIngestPartialToNeon({
				runId,
				slug,
				partial: withSnapshot as unknown as Record<string, unknown>
			});
			console.log(`  [SAVE] Partial results saved to Neon (orchestration run ${runId})`);
			return;
		} catch (e) {
			console.warn(
				`  [WARN] Neon staging save failed; falling back to disk: ${e instanceof Error ? e.message : String(e)}`
			);
		}
	}
	if (!fs.existsSync(INGESTED_DIR)) {
		fs.mkdirSync(INGESTED_DIR, { recursive: true });
	}
	const partialPath = path.join(INGESTED_DIR, `${slug}-partial.json`);
	const tmpPath = `${partialPath}.tmp`;
	const snapshot = parseFloat(estimateCostUsd());
	const { source_text_snapshot: _omitSnap, ...forDisk } = results;
	const withSnapshot: PartialResults = {
		...forDisk,
		cost_usd_snapshot: Number.isFinite(snapshot) && snapshot >= 0 ? snapshot : results.cost_usd_snapshot
	};
	// Write to temp file first, then atomic rename — prevents corruption on crash mid-write
	fs.writeFileSync(tmpPath, JSON.stringify(withSnapshot, null, 2), 'utf-8');
	fs.renameSync(tmpPath, partialPath);
	console.log(`  [SAVE] Partial results saved to: ${partialPath}`);
}

function saveGroupingDebugRaw(slug: string, batchIndex: number, rawResponse: string): void {
	if (!INGEST_SAVE_GROUPING_RAW) return;
	if (!fs.existsSync(INGESTED_DIR)) {
		fs.mkdirSync(INGESTED_DIR, { recursive: true });
	}
	const safeSlug = slug.replace(/[^a-zA-Z0-9-_]/g, '_');
	const filePath = path.join(INGESTED_DIR, `${safeSlug}-grouping-batch-${batchIndex + 1}.raw.txt`);
	fs.writeFileSync(filePath, rawResponse, 'utf-8');
	console.log(`  [DEBUG] Saved grouping raw batch ${batchIndex + 1} to ${filePath}`);
}

type LoadPartialResultsOpts = {
	forceStage?: string | null;
	/** Used with `--force-stage validating` to locate staging written under an earlier orchestration run id. */
	canonicalSourceUrl?: string;
	/** Matches Neon `source_json.canonical_url_hash` when slug/URL text drifted between runs. */
	canonicalUrlHash?: string;
	/** Extra URLs (e.g. `canonical_url` in meta) to derive alternate `canonical_url_hash` for Neon lookup. */
	extraUrlsForHashLookup?: string[];
};

async function loadPartialResults(
	slug: string,
	opts?: LoadPartialResultsOpts
): Promise<PartialResults | null> {
	const runId = process.env.INGEST_ORCHESTRATION_RUN_ID?.trim();
	const force = opts?.forceStage ?? null;
	const canonical = opts?.canonicalSourceUrl?.trim();
	const urlHash = opts?.canonicalUrlHash?.trim();
	const extraUrls = opts?.extraUrlsForHashLookup?.filter((u) => typeof u === 'string' && u.trim()) ?? [];
	const wantsEmbeddingCheckpoint =
		force === 'embedding' ||
		force === 'validating' ||
		force === 'remediating' ||
		force === 'storing';

	const embeddingTailLooksComplete = (p: PartialResults): boolean => {
		const claims = p.claims;
		const emb = p.embeddings;
		if (!Array.isArray(claims) || claims.length === 0) return false;
		if (!Array.isArray(emb) || emb.length === 0) return false;
		return emb.length >= claims.length;
	};

	const tryNeon = async (rid: string): Promise<PartialResults | null> => {
		try {
			const fromNeon = await loadIngestPartialFromNeon(rid, slug);
			if (fromNeon) return fromNeon as PartialResults;
		} catch (e) {
			console.warn(`  [WARN] Failed to load Neon partial results (${rid}): ${e}`);
		}
		return null;
	};

	if (runId && process.env.DATABASE_URL?.trim()) {
		const direct = await tryNeon(runId);
		if (direct) return direct;

		if (wantsEmbeddingCheckpoint) {
			/** Prefer stable identity over slug/URL text (avoids ingest_runs URL vs staging drift across many URLs). */
			const hashesToTry: string[] = [];
			const pushHash = (h: string | undefined) => {
				const t = h?.trim();
				if (t && !hashesToTry.includes(t)) hashesToTry.push(t);
			};
			pushHash(urlHash);
			if (canonical) pushHash(canonicalizeAndHashSourceUrl(canonical)?.canonicalUrlHash);
			for (const u of extraUrls) {
				const alt = canonicalizeAndHashSourceUrl(u.trim());
				if (alt) pushHash(alt.canonicalUrlHash);
			}

			for (const h of hashesToTry) {
				const hashCandidates = await findNeonStagingRunIdsForValidationTailByCanonicalUrlHash(h, 20);
				for (const rid of hashCandidates) {
					if (rid === runId) continue;
					const p = await tryNeon(rid);
					if (p && embeddingTailLooksComplete(p)) {
						console.log(
							`  [RESUME] Loaded Neon staging from prior run ${rid} (canonical_url_hash on ingest_staging_meta; current orchestration run ${runId})`
						);
						return p;
					}
				}
			}

			if (canonical) {
				const slugUrlCandidates = await findNeonStagingRunIdsForValidationTailBySlugOrUrl(
					{ slug, canonicalSourceUrl: canonical },
					20
				);
				for (const rid of slugUrlCandidates) {
					if (rid === runId) continue;
					const p = await tryNeon(rid);
					if (p && embeddingTailLooksComplete(p)) {
						console.log(
							`  [RESUME] Loaded Neon staging from prior run ${rid} (slug/url/canonical_url on ingest_staging_meta; current orchestration run ${runId})`
						);
						return p;
					}
				}
				const candidates = await findDoneIngestRunIdsWithStagingMetaForCanonicalUrl(canonical, 500);
				for (const rid of candidates) {
					if (rid === runId) continue;
					const p = await tryNeon(rid);
					if (p && embeddingTailLooksComplete(p)) {
						console.log(
							`  [RESUME] Loaded Neon staging from prior done run ${rid} (canonical URL scan; current orchestration run ${runId})`
						);
						return p;
					}
				}
			} else {
				const slugOnly = await findNeonStagingRunIdsForValidationTailBySlugOrUrl({ slug }, 20);
				for (const rid of slugOnly) {
					if (rid === runId) continue;
					const p = await tryNeon(rid);
					if (p && embeddingTailLooksComplete(p)) {
						console.log(
							`  [RESUME] Loaded Neon staging from prior run ${rid} (slug-only tail lookup; current orchestration run ${runId})`
						);
						return p;
					}
				}
			}
		}
	}

	const partialPath = path.join(INGESTED_DIR, `${slug}-partial.json`);
	if (!fs.existsSync(partialPath)) {
		return null;
	}
	try {
		const data = fs.readFileSync(partialPath, 'utf-8');
		return JSON.parse(data) as PartialResults;
	} catch (error) {
		console.warn(`  [WARN] Failed to load partial results: ${error}`);
		return null;
	}
}

type ThinkerAliasDbRow = {
	canonical_name?: string;
	wikidata_id?: string;
	label?: string;
	confidence?: number;
	status?: string;
};

function slugifyGraphLabel(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 96);
}

const RELATE_GRAPH_ALLOWED_TABLES = new Set([
	'about_subject',
	'in_period',
	'cites_work',
	'authored_work'
]);

async function upsertGraphNamedNode(db: Surreal, table: 'subject' | 'period', name: string): Promise<string | null> {
	const trimmed = name.trim();
	if (!trimmed) return null;
	const slug = slugifyGraphLabel(trimmed);
	if (!slug) return null;
	await db.query(
		`UPSERT type::record('${table}', $slug) CONTENT {
			name: $name,
			slug: $slug,
			imported_at: time::now()
		}`,
		{ slug, name: trimmed }
	);
	return slug;
}

async function relateGraphIfAbsent(
	db: Surreal,
	table: string,
	fromId: unknown,
	toId: unknown,
	setClause: string
): Promise<boolean> {
	if (!RELATE_GRAPH_ALLOWED_TABLES.has(table)) {
		console.warn(`  [WARN] relateGraphIfAbsent: disallowed relation table ${table}`);
		return false;
	}
	const from = splitRecordTableAndKey(fromId);
	const to = splitRecordTableAndKey(toId);
	if (!from || !to) {
		console.warn(
			`  [WARN] relateGraphIfAbsent: could not parse record ids from=${toSurrealRecordIdStr(fromId)} to=${toSurrealRecordIdStr(toId)}`
		);
		return false;
	}
	// SurrealDB 2.x: `type::thing` is invalid; `type::record` works in LET but not as the first token
	// after `RELATE` (parser: "Unexpected token `::`"). Match the `authored` pattern: LET … then
	// `RELATE $from->table->$to`. Slugs with underscores stay safe via split table/key params.
	const edgeVars = {
		from_tb: from.tb,
		from_key: from.key,
		to_tb: to.tb,
		to_key: to.key
	};
	const existing = await db.query<Array<{ id: string }[]>>(
		`LET $from = type::record($from_tb, $from_key);
		 LET $to = type::record($to_tb, $to_key);
		 SELECT id FROM ${table} WHERE in = $from AND out = $to LIMIT 1`,
		edgeVars
	);
	const selectRows = Array.isArray(existing) ? existing[existing.length - 1] : undefined;
	const hasExisting = Array.isArray(selectRows) && selectRows.length > 0;
	if (hasExisting) return false;
	await db.query(
		`LET $from = type::record($from_tb, $from_key);
		 LET $to = type::record($to_tb, $to_key);
		 RELATE $from->${table}->$to ${setClause}`,
		edgeVars
	);
	return true;
}

type ThinkerDbRow = {
	id?: unknown;
	name?: string;
};

async function runThinkerIdentityLinking(args: {
	db: Surreal;
	sourceId: string;
	sourceMeta: SourceMeta;
	claims: PhaseOneClaim[];
}): Promise<{ authoredInserted: number; queued: number; skippedAmbiguous: number }> {
	const { db, sourceId, sourceMeta, claims } = args;
	const authorNames = new Set<string>();
	for (const author of sourceMeta.author ?? []) {
		if (typeof author === 'string' && author.trim()) authorNames.add(author.trim());
	}
	for (const claim of claims) {
		if (typeof claim.thinker === 'string' && claim.thinker.trim()) authorNames.add(claim.thinker.trim());
		for (const name of claim.attributed_to ?? []) {
			if (typeof name === 'string' && name.trim()) authorNames.add(name.trim());
		}
	}
	if (authorNames.size === 0) return { authoredInserted: 0, queued: 0, skippedAmbiguous: 0 };

	const authorNameList = [...authorNames];
	const thinkerLinkProgress = authorNameList.length >= 12;

	const aliasRows = await db.query<ThinkerAliasDbRow[][]>(
		`SELECT canonical_name, wikidata_id, label, confidence, status
		 FROM thinker_alias
		 WHERE status = 'active'`
	);
	const aliasMap = new Map<string, ThinkerAliasDbRow>();
	for (const row of aliasRows?.[0] ?? []) {
		const canonical = typeof row.canonical_name === 'string' ? row.canonical_name : '';
		const qid = typeof row.wikidata_id === 'string' ? row.wikidata_id.trim() : '';
		if (canonical && qid) aliasMap.set(canonical, row);
	}

	const thinkerRows = await db.query<ThinkerDbRow[][]>(`SELECT id, name FROM thinker`);
	const thinkers: { wikidata_id: string; name: string }[] = [];
	const thinkersByCanonical = new Map<string, { wikidata_id: string; name: string }>();
	for (const row of thinkerRows?.[0] ?? []) {
		const rawId =
			typeof row.id === 'string'
				? row.id
				: typeof row.id === 'object' && row.id !== null && typeof (row.id as { id?: unknown }).id === 'string'
					? (row.id as { id: string }).id
					: '';
		const qidMatch = rawId.match(/Q\d+$/);
		const qid = qidMatch?.[0] ?? '';
		const name = typeof row.name === 'string' ? row.name.trim() : '';
		if (!qid || !name) continue;
		const thinker = { wikidata_id: qid, name };
		thinkers.push(thinker);
		thinkersByCanonical.set(canonicalizeThinkerName(name), thinker);
	}

	let authoredInserted = 0;
	let queued = 0;
	let skippedAmbiguous = 0;
	for (let ni = 0; ni < authorNameList.length; ni++) {
		const rawName = authorNameList[ni];
		if (thinkerLinkProgress && (ni % 4 === 0 || ni === authorNameList.length - 1)) {
			process.stdout.write(
				`\r  [THINKER_LINK] ${ni + 1}/${authorNameList.length} author name(s)…`
			);
		}
		const canonical = canonicalizeThinkerName(rawName);
		if (!canonical) continue;
		let winner: ThinkerIdentityCandidate | null = null;
		const alias = aliasMap.get(canonical);
		if (alias && typeof alias.wikidata_id === 'string' && alias.wikidata_id.trim()) {
			winner = {
				wikidata_id: alias.wikidata_id.trim(),
				name: typeof alias.label === 'string' && alias.label.trim() ? alias.label.trim() : rawName,
				confidence: typeof alias.confidence === 'number' ? alias.confidence : 0.95
			};
		} else {
			const exact = thinkersByCanonical.get(canonical);
			if (exact) {
				winner = {
					wikidata_id: exact.wikidata_id,
					name: exact.name,
					confidence: 1
				};
			} else {
				const candidates: ThinkerIdentityCandidate[] = [];
				for (const thinker of thinkers) {
					const confidence = estimateThinkerNameConfidence(rawName, thinker.name);
					if (confidence > 0) {
						candidates.push({
							wikidata_id: thinker.wikidata_id,
							name: thinker.name,
							confidence
						});
					}
				}
				const decision = pickThinkerAutoLinkCandidate(
					candidates,
					THINKER_AUTO_LINK_MIN_CONFIDENCE,
					THINKER_AUTO_LINK_MIN_DELTA
				);
				if (decision.best) {
					winner = decision.best;
				} else if (decision.reason === 'ambiguous') {
					skippedAmbiguous += 1;
					await db.query(
						`CREATE thinker_resolution_audit_log CONTENT {
							raw_name: $raw_name,
							canonical_name: $canonical_name,
							action: 'auto_skip_ambiguous',
							source_id: ${SOURCE_ID_STRING_SQL},
							notes: $notes,
							created_at: time::now()
						}`,
						{
							raw_name: rawName,
							canonical_name: canonical,
							source_row_key: recordKeyForTable(sourceId, 'source'),
							notes: `Ambiguous match (min_delta=${THINKER_AUTO_LINK_MIN_DELTA})`
						}
					);
				}
			}
		}

		if (winner) {
			await db.query(
				`UPSERT type::record('thinker_alias', $rid) CONTENT {
					canonical_name: $canonical_name,
					raw_name: $raw_name,
					wikidata_id: $wikidata_id,
					label: $label,
					confidence: $confidence,
					resolved_by: 'heuristic',
					status: 'active',
					source_contexts: ${SOURCE_ID_STRING_ARRAY_ONE_SQL},
					updated_at: time::now(),
					created_at: time::now()
				}`,
				{
					rid: canonical.replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 96) || 'name',
					canonical_name: canonical,
					raw_name: rawName,
					wikidata_id: winner.wikidata_id,
					label: winner.name,
					confidence: winner.confidence,
					source_row_key: recordKeyForTable(sourceId, 'source')
				}
			);
			await db.query(
				`LET $from = type::record('thinker', $wikidata_id);
				 LET $to = type::record('source', $source_row_key);
				 LET $existing = (SELECT id FROM authored WHERE in = $from AND out = $to LIMIT 1);
				 IF array::len($existing) = 0 {
				 	RELATE $from->authored->$to
				 		SET match_type = 'ingest_identity_resolver',
				 		    confidence = $confidence,
				 		    linked_at = time::now();
				 }`,
				{
					wikidata_id: winner.wikidata_id,
					source_row_key: recordKeyForTable(sourceId, 'source'),
					confidence: winner.confidence
				}
			);
			await db.query(
				`CREATE thinker_resolution_audit_log CONTENT {
					raw_name: $raw_name,
					canonical_name: $canonical_name,
					wikidata_id: $wikidata_id,
					label: $label,
					action: 'auto_resolve',
					confidence: $confidence,
					source_id: ${SOURCE_ID_STRING_SQL},
					created_at: time::now()
				}`,
				{
					raw_name: rawName,
					canonical_name: canonical,
					wikidata_id: winner.wikidata_id,
					label: winner.name,
					confidence: winner.confidence,
					source_row_key: recordKeyForTable(sourceId, 'source')
				}
			);
			authoredInserted += 1;
			continue;
		}

		const queueId = canonical.replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 96) || 'name';
		await db.query(
			`UPSERT type::record('unresolved_thinker_reference', $rid) CONTENT {
				raw_name: $raw_name,
				canonical_name: $canonical_name,
				source_ids: ${SOURCE_ID_STRING_ARRAY_ONE_SQL},
				contexts: ${SOURCE_ID_STRING_ARRAY_ONE_SQL},
				status: 'queued',
				seen_count: 1,
				proposed_qids: [],
				proposed_labels: [],
				last_seen_at: time::now(),
				first_seen_at: time::now()
			}`,
			{
				rid: queueId,
				raw_name: rawName,
				canonical_name: canonical,
				source_row_key: recordKeyForTable(sourceId, 'source')
			}
		);
		await db.query(
			`CREATE thinker_resolution_audit_log CONTENT {
				raw_name: $raw_name,
				canonical_name: $canonical_name,
				action: 'auto_queue',
				source_id: ${SOURCE_ID_STRING_SQL},
				queue_record_id: $queue_record_id,
				created_at: time::now()
			}`,
			{
				raw_name: rawName,
				canonical_name: canonical,
				source_row_key: recordKeyForTable(sourceId, 'source'),
				queue_record_id: queueId
			}
		);
		queued += 1;
	}
	if (thinkerLinkProgress) console.log('');
	return { authoredInserted, queued, skippedAmbiguous };
}

// ─── Ingestion Log (DB-based tracking) ────────────────────────────────────
interface IngestionLogRecord {
	id?: string;
	source_url: string;
	canonical_url?: string;
	canonical_url_hash?: string;
	source_title: string;
	status: string;
	stage_completed?: string;
	claims_extracted?: number;
	relations_extracted?: number;
	arguments_grouped?: number;
	validation_score?: number;
	error_message?: string;
	cost_usd?: number;
	started_at?: string;
	completed_at?: string;
}

let ingestionLogCanonicalFieldsSupported: boolean | null = null;

function isMissingIngestionLogFieldError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		/ingestion_log/i.test(message) &&
		/no such field exists/i.test(message)
	);
}

async function initializeIngestionLogCompatibility(db: Surreal | null): Promise<void> {
	if (!db || ingestionLogCanonicalFieldsSupported !== null) return;
	try {
		await db.query(`
			DEFINE FIELD IF NOT EXISTS canonical_url ON ingestion_log TYPE string;
			DEFINE FIELD IF NOT EXISTS canonical_url_hash ON ingestion_log TYPE string;
			DEFINE INDEX IF NOT EXISTS ingestion_log_canonical_hash ON ingestion_log FIELDS canonical_url_hash;
		`);
		ingestionLogCanonicalFieldsSupported = true;
		return;
	} catch (error) {
		// Some deployments use restricted DB roles. Fall through to capability probe.
		if (!isMissingIngestionLogFieldError(error)) {
			console.warn(
				`  [WARN] Could not auto-upgrade ingestion_log schema for canonical URL fields: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	try {
		await db.query('SELECT canonical_url_hash FROM ingestion_log LIMIT 1;');
		ingestionLogCanonicalFieldsSupported = true;
	} catch (error) {
		if (isMissingIngestionLogFieldError(error)) {
			ingestionLogCanonicalFieldsSupported = false;
			console.warn(
				'  [WARN] ingestion_log lacks canonical_url/canonical_url_hash fields; using legacy source_url-only logging compatibility mode.'
			);
			return;
		}
		throw error;
	}
}

function supportsIngestionLogCanonicalFields(): boolean {
	return ingestionLogCanonicalFieldsSupported !== false;
}

function buildSourceUrlCandidates(sourceUrl: string): string[] {
	const identity = canonicalizeAndHashSourceUrl(sourceUrl);
	if (!identity) return [sourceUrl];

	const candidates = new Set<string>([identity.canonicalUrl]);
	try {
		const parsed = new URL(identity.canonicalUrl);
		if (parsed.pathname.length > 1 && !parsed.pathname.endsWith('/')) {
			const withSlash = new URL(identity.canonicalUrl);
			withSlash.pathname = `${withSlash.pathname}/`;
			candidates.add(withSlash.toString());
		} else if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
			const withoutSlash = new URL(identity.canonicalUrl);
			withoutSlash.pathname = withoutSlash.pathname.replace(/\/+$/, '');
			candidates.add(withoutSlash.toString());
		}
	} catch {
		// ignore malformed fallback variants
	}

	return [...candidates];
}

async function getIngestionLog(db: Surreal | null, sourceUrl: string): Promise<IngestionLogRecord | null> {
	if (!db) return null;
	const identity = canonicalizeAndHashSourceUrl(sourceUrl);
	if (!supportsIngestionLogCanonicalFields()) {
		const legacyResult = await db.query<IngestionLogRecord[][]>(
			`SELECT * FROM ingestion_log
			 WHERE source_url INSIDE $source_urls
			 LIMIT 1`,
			{
				source_urls: buildSourceUrlCandidates(sourceUrl)
			}
		);
		const legacyRows = Array.isArray(legacyResult?.[0]) ? legacyResult[0] : [];
		return legacyRows.length > 0 ? legacyRows[0] : null;
	}
	const result = await db.query<IngestionLogRecord[][]>(
		`SELECT * FROM ingestion_log
		 WHERE source_url INSIDE $source_urls
		    OR canonical_url_hash = $canonical_url_hash
		 LIMIT 1`,
		{
			source_urls: buildSourceUrlCandidates(sourceUrl),
			canonical_url_hash: identity?.canonicalUrlHash ?? sourceUrl
		}
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	return rows.length > 0 ? rows[0] : null;
}

async function createIngestionLog(db: Surreal | null, sourceUrl: string, sourceTitle: string): Promise<void> {
	if (!db) return;
	const identity = canonicalizeAndHashSourceUrl(sourceUrl);
	if (!identity) {
		throw new Error(`[INTEGRITY] Cannot create ingestion log for invalid source URL: ${sourceUrl}`);
	}
	if (!supportsIngestionLogCanonicalFields()) {
		await db.query(
			`CREATE ingestion_log CONTENT {
				source_url: $url,
				source_title: $title,
				status: 'extracting',
				started_at: time::now()
			}`,
			{
				url: identity.canonicalUrl,
				title: sourceTitle
			}
		);
		return;
	}
	await db.query(
		`CREATE ingestion_log CONTENT {
			source_url: $url,
			canonical_url: $canonical_url,
			canonical_url_hash: $canonical_url_hash,
			source_title: $title,
			status: 'extracting',
			started_at: time::now()
		}`,
		{
			url: identity.canonicalUrl,
			canonical_url: identity.canonicalUrl,
			canonical_url_hash: identity.canonicalUrlHash,
			title: sourceTitle
		}
	);
}

async function updateIngestionLog(
	db: Surreal | null,
	sourceUrl: string,
	updates: Record<string, unknown>
): Promise<void> {
	if (!db || Object.keys(updates).length === 0) return;

	const identity = canonicalizeAndHashSourceUrl(sourceUrl);
	if (!identity) {
		throw new Error(`[INTEGRITY] Cannot update ingestion log for invalid source URL: ${sourceUrl}`);
	}
	if (!supportsIngestionLogCanonicalFields()) {
		const legacySetClauses = Object.keys(updates)
			.map((key) => `${key} = $${key}`)
			.join(', ');
		const legacySql = `UPDATE ingestion_log
			SET source_url = $canonical_url,
				${legacySetClauses}
			WHERE source_url INSIDE $source_urls`;
		const legacyVars = {
			...updates,
			canonical_url: identity.canonicalUrl,
			source_urls: buildSourceUrlCandidates(sourceUrl)
		};
		await dbQueryWithRetry(db, legacySql, legacyVars, 3);
		return;
	}
	const setClauses = Object.keys(updates)
		.map((key) => `${key} = $${key}`)
		.join(', ');
	const sql = `UPDATE ingestion_log
		SET source_url = $canonical_url,
			canonical_url = $canonical_url,
			canonical_url_hash = $canonical_url_hash,
			${setClauses}
		WHERE source_url INSIDE $source_urls OR canonical_url_hash = $canonical_url_hash`;
	const vars = {
		...updates,
		canonical_url: identity.canonicalUrl,
		source_urls: buildSourceUrlCandidates(sourceUrl),
		canonical_url_hash: identity.canonicalUrlHash
	};
	await dbQueryWithRetry(db, sql, vars, 3);
}

/**
 * Verify DB connection is alive; re-authenticate if the session has expired.
 * Call this before any stage that performs DB writes after a long gap.
 */
async function ensureDbConnected(db: Surreal): Promise<void> {
	try {
		await db.query('INFO FOR DB;');
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (isRetryableDbError(error)) {
			console.warn(`  [WARN] DB health check failed (${msg}) — reconnecting...`);
			await reconnectDbWithRetry(db, 'health check');
			await dbQueryWithRetry(db, 'INFO FOR DB;', undefined, 2);
			console.log('  [OK] SurrealDB connection restored');
		} else {
			throw new Error(`DB connection check failed: ${msg}`);
		}
	}
}

async function closeSurrealIfOpen(db: Surreal | null): Promise<void> {
	if (!db) return;
	try {
		await db.close();
	} catch {
		// ignore double-close / connection errors
	}
}

/** True when Neon/disk partial has work beyond a cold start (Surreal `stage_completed` is often empty mid-extract). */
function partialHasDurableNeonOrDiskProgress(p: PartialResults): boolean {
	const ep = p.extraction_progress;
	if (ep && Array.isArray(ep.claims_so_far) && ep.claims_so_far.length > 0) return true;
	if (Array.isArray(p.claims) && p.claims.length > 0) return true;
	if (Array.isArray(p.relations) && p.relations.length > 0) return true;
	if (Array.isArray(p.arguments) && p.arguments.length > 0) return true;
	if (Array.isArray(p.embeddings) && p.embeddings.length > 0) return true;
	const st = (p.stage_completed ?? '').trim();
	if (st && st !== 'none') return true;
	return false;
}

function normalizeResumeStage(
	lastCompleted: string | null,
	partial: PartialResults
): string | null {
	if (!lastCompleted) return null;

	const hasClaims = Array.isArray(partial.claims) && partial.claims.length > 0;
	const hasRelations = Array.isArray(partial.relations);
	const hasArguments = Array.isArray(partial.arguments);
	const hasEmbeddings =
		Array.isArray(partial.embeddings) && partial.embeddings.length > 0;

	if (!hasClaims) return null;
	if (!hasRelations && ['relating', 'grouping', 'embedding', 'validating', 'storing', 'stored'].includes(lastCompleted)) {
		return 'extracting';
	}
	if (!hasArguments && ['grouping', 'embedding', 'validating', 'storing', 'stored'].includes(lastCompleted)) {
		return 'relating';
	}
	// Surreal stage_completed stays at 'grouping' until all claim embeddings exist (see embedding checkpoints).
	const emb = partial.embeddings;
	const embPartial =
		Array.isArray(emb) &&
		Array.isArray(partial.claims) &&
		emb.length > 0 &&
		emb.length < partial.claims.length;
	if (
		embPartial &&
		['embedding', 'validating', 'remediating', 'storing', 'stored'].includes(lastCompleted)
	) {
		return 'grouping';
	}

	if (
		!hasEmbeddings &&
		['embedding', 'validating', 'remediating', 'storing', 'stored'].includes(lastCompleted)
	) {
		return 'grouping';
	}

	return lastCompleted;
}

// ─── MAIN PIPELINE ─────────────────────────────────────────────────────────

/** Admin spawn passes base64url JSON so INGEST_PIN_* survives dotenv / env-file ordering. */
function applyIngestPinsJsonArg(argv: string[]): void {
	const prefix = '--ingest-pins-json=';
	const raw = argv.find((a) => a.startsWith(prefix));
	if (!raw) return;
	const b64 = raw.slice(prefix.length);
	if (!b64.trim()) return;
	try {
		const json = Buffer.from(b64, 'base64url').toString('utf8');
		const data = JSON.parse(json) as Record<string, { provider?: string; model?: string }>;
		let applied = 0;
		for (const [suffix, v] of Object.entries(data)) {
			if (
				v &&
				typeof v.provider === 'string' &&
				typeof v.model === 'string' &&
				v.provider.trim() &&
				v.model.trim()
			) {
				const prov = v.provider.trim();
				process.env[`INGEST_PIN_PROVIDER_${suffix}`] = prov;
				process.env[`INGEST_PIN_MODEL_${suffix}`] = normalizePinnedModelId(prov, v.model.trim());
				applied++;
			}
		}
		if (applied > 0) {
			console.log(`[INGEST_PINS] --ingest-pins-json applied ${applied} stage pin(s)`);
		}
	} catch {
		console.warn('[ingest] Ignoring invalid --ingest-pins-json');
	}
}

function collectIngestPinEnvFromProcess(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const k of Object.keys(process.env)) {
		if (!k.startsWith('INGEST_PIN_')) continue;
		const v = process.env[k];
		if (typeof v === 'string' && v.length) out[k] = v;
	}
	return out;
}

/** Set INGEST_LOG_PINS=1 for full pin + routing lines from ingestion-plan. */
function logIngestPinsWorkerSnapshot(phase: string, argv: string[]): void {
	const cli = argv.some((a) => a.startsWith('--ingest-pins-json='));
	const env = collectIngestPinEnvFromProcess();
	const summary = summarizeIngestPinsForLog(env);
	const verbose = process.env.INGEST_LOG_PINS === '1' || process.env.INGEST_LOG_PINS === 'true';
	if (!cli && Object.keys(env).length === 0 && !verbose) return;
	const pairCount = Object.keys(env).length;
	console.log(
		`[INGEST_PINS] ${phase}: cli_arg=${cli ? 'yes' : 'no'} env_vars=${pairCount} ${summary}`
	);
	if (verbose) {
		console.log(`[INGEST_PINS] ${phase} verbose:`, env);
	}
}

function logIngestFinetunePolicySnapshot(): void {
	const strict = ingestFinetuneLabelerStrictEnabled(process.env);
	const allowed = parseFinetuneLabelerAllowedProviders(process.env);
	console.log(
		`[INGEST_FINETUNE_POLICY] strict=${strict ? '1' : '0'} allowed_providers=${allowed.join('|')} (sensitive stages: extraction, relations, grouping, remediation, json_repair; validation unchanged)`
	);
}

async function loadSourceTextAndMeta(
	filePathArg: string,
	opts?: { validationStagingFallback?: boolean }
): Promise<{ txtPath: string; sourceText: string; sourceMeta: SourceMeta; slug: string }> {
	const runId = process.env.INGEST_ORCHESTRATION_RUN_ID?.trim();
	const resolvedArg = path.resolve(filePathArg);
	let txtPath = resolvedArg;
	let sourceText: string;
	let sourceMeta: SourceMeta;
	const hintSlug = path.basename(resolvedArg, '.txt');

	if (fs.existsSync(txtPath)) {
		const metaPath = txtPath.replace(/\.txt$/, '.meta.json');
		if (!fs.existsSync(metaPath)) {
			console.error(`[ERROR] Source metadata not found: ${metaPath}`);
			process.exit(1);
		}
		sourceText = fs.readFileSync(txtPath, 'utf-8');
		sourceMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SourceMeta;
	} else if (runId && process.env.DATABASE_URL?.trim()) {
		let fromNeon = await loadIngestPartialFromNeon(runId, hintSlug);
		const metaPathBesideTxt = resolvedArg.replace(/\.txt$/i, '.meta.json');
		let canonicalHint: string | undefined;
		let canonicalUrlHashHint: string | undefined;
		if (fs.existsSync(metaPathBesideTxt)) {
			try {
				const rawMeta = JSON.parse(fs.readFileSync(metaPathBesideTxt, 'utf-8')) as {
					url?: unknown;
					canonical_url_hash?: unknown;
				};
				if (typeof rawMeta.url === 'string' && rawMeta.url.trim()) {
					canonicalHint = rawMeta.url.trim();
				}
				if (typeof rawMeta.canonical_url_hash === 'string' && rawMeta.canonical_url_hash.trim()) {
					canonicalUrlHashHint = rawMeta.canonical_url_hash.trim();
				}
			} catch {
				// ignore malformed meta beside a missing .txt
			}
		}
		if (!canonicalUrlHashHint && fromNeon?.source && typeof fromNeon.source === 'object' && !Array.isArray(fromNeon.source)) {
			const h = (fromNeon.source as Record<string, unknown>).canonical_url_hash;
			if (typeof h === 'string' && h.trim()) {
				canonicalUrlHashHint = h.trim();
			}
		}
		let snap = fromNeon?.source_text_snapshot;
		let src = fromNeon?.source;
		let usedPriorStagingForSource = false;
		if (
			opts?.validationStagingFallback &&
			(typeof snap !== 'string' ||
				snap.length === 0 ||
				!src ||
				typeof src !== 'object' ||
				Array.isArray(src))
		) {
			const legacy = await findNeonStagingRunIdForValidationTailBySlug({
				slug: hintSlug,
				...(canonicalHint ? { canonicalSourceUrl: canonicalHint } : {}),
				...(canonicalUrlHashHint ? { canonicalUrlHash: canonicalUrlHashHint } : {})
			});
			if (legacy && legacy !== runId) {
				const alt = await loadIngestPartialFromNeon(legacy, hintSlug);
				if (
					alt &&
					typeof alt.source_text_snapshot === 'string' &&
					alt.source_text_snapshot.length > 0 &&
					alt.source &&
					typeof alt.source === 'object' &&
					!Array.isArray(alt.source)
				) {
					fromNeon = alt;
					snap = alt.source_text_snapshot;
					src = alt.source;
					usedPriorStagingForSource = true;
					console.log(
						`  [RESUME] Loaded source body from prior Neon staging run ${legacy} (validation-tail fallback; local file missing)`
					);
				}
			}
		}
		if (typeof snap !== 'string' || snap.length === 0 || !src || typeof src !== 'object' || Array.isArray(src)) {
			console.error(`[ERROR] Source text not found: ${txtPath}`);
			console.error(
				'  Hint: On serverless workers the fetch output may be gone. Re-run fetch or ensure the latest deploy persists source_text_snapshot in Neon (ingest_staging_meta).'
			);
			process.exit(1);
		}
		sourceText = snap;
		sourceMeta = src as SourceMeta;
		txtPath = path.join(process.cwd(), 'data/sources', `${hintSlug}.txt`);
		if (!usedPriorStagingForSource) {
			console.log(
				`  [RESUME] Loaded source body from Neon checkpoint (local file missing) — slug ${hintSlug}`
			);
		}
	} else {
		console.error(`[ERROR] Source text not found: ${txtPath}`);
		process.exit(1);
	}

	const slug = path.basename(txtPath, '.txt');
	return { txtPath, sourceText, sourceMeta, slug };
}

/** Existing Surreal `source` row for this URL/hash, if any (Stage 6 idempotency / store-skip probe). */
async function findExistingSourceRecordIdForUrl(db: Surreal, sourceMeta: SourceMeta): Promise<string | null> {
	const existingSources = await db.query<[{ id: string }[]]>(
		'SELECT id FROM source WHERE canonical_url_hash = $canonical_url_hash OR url = $url LIMIT 1',
		{ canonical_url_hash: sourceMeta.canonical_url_hash, url: sourceMeta.url }
	);
	const head = Array.isArray(existingSources) && existingSources.length > 0 ? existingSources[0] : null;
	if (Array.isArray(head)) return head[0]?.id?.trim() || null;
	if (head && typeof head === 'object' && 'id' in head) {
		const id = (head as { id?: unknown }).id;
		return typeof id === 'string' && id.trim() ? id.trim() : null;
	}
	return null;
}

const STORE_RELATION_TABLES_ALL = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'defines',
	'qualifies',
	'refines',
	'exemplifies'
] as const;

/** Remove an existing `source` row and all dependent graph rows (Stage 6 idempotent re-store). */
async function surrealStoreCleanupRemoveExistingSource(db: Surreal, existingSourceId: string): Promise<void> {
	const t0 = Date.now();
	if (ingestStoreCleanupUseBatchedSurreal()) {
		const stmts: string[] = ['LET $claim_ids = (SELECT VALUE id FROM claim WHERE source = $sid);'];
		for (const relTable of STORE_RELATION_TABLES_ALL) {
			stmts.push(`DELETE ${relTable} WHERE in IN $claim_ids OR out IN $claim_ids;`);
		}
		stmts.push('DELETE part_of WHERE in IN $claim_ids;');
		stmts.push('DELETE claim WHERE source = $sid;');
		stmts.push('DELETE passage WHERE source = $sid;');
		stmts.push('DELETE argument WHERE source = $sid;');
		stmts.push('DELETE source WHERE id = $sid;');
		console.log(`  [CLEANUP] Batched Surreal cleanup (${stmts.length} statements, one round-trip)…`);
		try {
			await db.query(stmts.join('\n'), { sid: existingSourceId });
			console.log(`  [CLEANUP] Batched cleanup finished in ${Date.now() - t0}ms`);
			return;
		} catch (e) {
			console.warn(
				'  [WARN] Batched Surreal cleanup failed; falling back to per-table deletes:',
				e instanceof Error ? e.message : String(e)
			);
		}
	}
	for (const relTable of STORE_RELATION_TABLES_ALL) {
		const t = Date.now();
		await db.query(
			`DELETE ${relTable} WHERE in IN (SELECT id FROM claim WHERE source = $sid) OR out IN (SELECT id FROM claim WHERE source = $sid)`,
			{ sid: existingSourceId }
		);
		console.log(`  [CLEANUP] ${relTable} edges removed in ${Date.now() - t}ms`);
	}
	const tPart = Date.now();
	await db.query('DELETE part_of WHERE in IN (SELECT id FROM claim WHERE source = $sid)', { sid: existingSourceId });
	console.log(`  [CLEANUP] part_of removed in ${Date.now() - tPart}ms`);
	const tClaim = Date.now();
	await db.query('DELETE claim WHERE source = $sid', { sid: existingSourceId });
	console.log(`  [CLEANUP] claims removed in ${Date.now() - tClaim}ms`);
	const tPass = Date.now();
	await db.query('DELETE passage WHERE source = $sid', { sid: existingSourceId });
	console.log(`  [CLEANUP] passages removed in ${Date.now() - tPass}ms`);
	const tArg = Date.now();
	await db.query('DELETE argument WHERE source = $sid', { sid: existingSourceId });
	console.log(`  [CLEANUP] arguments removed in ${Date.now() - tArg}ms`);
	const tSrc = Date.now();
	await db.query('DELETE source WHERE id = $sid', { sid: existingSourceId });
	console.log(`  [CLEANUP] source row removed in ${Date.now() - tSrc}ms (legacy path total ${Date.now() - t0}ms)`);
}

/** Cold re-run Stage 1: drop disk/Neon-synced extraction resume + any accumulated claims for this slug. */
function ingestFreshExtractionEnabled(): boolean {
	const v = (process.env.INGEST_FRESH_EXTRACTION ?? '').trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes';
}

/** Strip Stage 1+ checkpoint fields so a new extraction run cannot inherit stale claims or mid-stage queues from Neon/disk. */
function applyIngestFreshExtractionPartialReset(partial: PartialResults): void {
	partial.claims = [];
	partial.extraction_progress = undefined;
	partial.relations = undefined;
	partial.relations_progress = undefined;
	partial.arguments = undefined;
	partial.grouping_progress = undefined;
	partial.embeddings = undefined;
	partial.embedding_progress = undefined;
	partial.validation = undefined;
	partial.validation_progress = undefined;
	partial.remediation_progress = undefined;
	partial.stage_completed = 'none';
}

async function main() {
	const args = process.argv.slice(2);
	applyIngestEmbeddingEnvOverrides();
	applyIngestPinsJsonArg(args);
	logIngestPinsWorkerSnapshot('after_cli_json', args);
	logIngestFinetunePolicySnapshot();
	const filePath = args.find((a) => !a.startsWith('--'));
	const shouldValidate = resolveShouldValidate(args.includes('--validate'));
	const ingestProviderFlagIdx = args.findIndex((a) => a === '--ingest-provider');
	const ingestProviderFlag = ingestProviderFlagIdx !== -1 ? args[ingestProviderFlagIdx + 1] : undefined;
	const ingestProvider = parseIngestProvider(ingestProviderFlag ?? INGEST_PROVIDER_DEFAULT);
	const extractionBudget = makeStageBudget('extraction');
	const relationBudget = makeStageBudget('relations');
	const groupingBudget = makeStageBudget('grouping');
	const validationBudget = makeStageBudget('validation');
	const remediationBudget = makeStageBudget('remediation');
	const embeddingBudget = makeStageBudget('embedding');
	const jsonRepairBudget = makeStageBudget('json_repair');
	// Pipeline mode: exit after stages 1-4 so the batch can start the next source's
	// Claude extraction while Gemini validation runs for this source in a separate process.
	const stopAfterEmbedding = args.includes('--stop-after-embedding');
	// Admin UI: exit after Stage 5 so the operator explicitly resumes for Stage 6 (SurrealDB store).
	const stopBeforeStore = args.includes('--stop-before-store');
	/** Exit after Stage 1 (claim extraction) checkpoints; skip relations onward. Local / FT debugging. */
	const stopAfterExtraction = args.includes('--stop-after-extraction');
	// Domain override: when set, all claims from this source are tagged with this domain,
	// overriding whatever domain Claude assigns during extraction.
	const domainOverrideIdx = args.findIndex((a) => a === '--domain');
	const domainOverride = domainOverrideIdx !== -1 ? args[domainOverrideIdx + 1] : null;

	// Force-stage: re-run from a specific stage, ignoring saved progress.
	// e.g. --force-stage embedding re-runs Stage 4 onwards.
	const forceStageIdx = args.findIndex((a) => a === '--force-stage');
	let forceStage = forceStageIdx !== -1 ? args[forceStageIdx + 1] : null;
	if (forceStage && !STAGES_ORDER.includes(forceStage)) {
		console.error(`[ERROR] Unknown --force-stage value: ${forceStage}`);
		console.error(`Valid stages: ${STAGES_ORDER.join(', ')}`);
		process.exit(1);
	}
	const envForceStage = process.env.INGEST_FORCE_STAGE?.trim();
	if (
		!forceStage &&
		envForceStage &&
		(STAGES_ORDER as readonly string[]).includes(envForceStage)
	) {
		forceStage = envForceStage;
		console.log(
			`[FORCE] INGEST_FORCE_STAGE=${envForceStage} (mirrors durable-job spawn when argv flags are missing)`
		);
	}
	const ingestForceReingest =
		process.env.INGEST_FORCE_REINGEST === '1' || process.env.INGEST_FORCE_REINGEST === 'true';
	if (!forceStage && ingestForceReingest) {
		forceStage = 'extracting';
		console.log(
			'[FORCE] INGEST_FORCE_REINGEST=1 → same as --force-stage extracting (bypass ingestion_log complete skip; re-run from extraction)'
		);
	}

	if (!filePath) {
		console.error('Usage: npx tsx --env-file=.env scripts/ingest.ts <source-file-path> [--validate] [--domain <domain>]');
		console.error('\nThe source-file-path should be a .txt file in data/sources/');
		console.error('\nFlags:');
		console.error('  --validate              Optional spot-check: run Gemini cross-model validation');
		console.error('  --domain <domain>       Override claim domain tag (e.g. philosophy_of_mind)');
		console.error('  --ingest-provider <p>   Provider hint: auto | vertex | anthropic (default: auto)');
		console.error('  --force-stage <stage>   Re-run from this stage onwards, ignoring saved progress');
		console.error(`                          Valid stages: ${STAGES_ORDER.join(', ')}`);
		console.error('  --stop-before-store     Exit after validation; re-run the same source to execute Stage 6 (store)');
		console.error(
			'  --stop-after-extraction Exit after Stage 1 (claims checkpointed); skip relations/embedding/validation. If Stage 1 was already done this run, flag is ignored with a warning. With INGEST_ORCHESTRATION_RUN_ID + DATABASE_URL, Surreal is skipped like --stop-before-store.'
		);
		console.error('\nEnv (optional):');
		console.error('  INGEST_VALIDATION_MODE=off|cli|full|sampled   Default cli; off ignores --validate; full/sampled forces validation');
		console.error('  INGEST_EMBED_BATCH_SIZE / INGEST_EMBED_BATCH_DELAY_MS   Aliases for VERTEX_EMBED_* (embedding throughput)');
		console.error(
			'  INGEST_STAGE_EXTRACTION_TIMEOUT_MS / INGEST_EXTRACTION_TIMEOUT_FALLBACK_MS   Per extraction HTTP call (default 180s if unset); INGEST_MODEL_TIMEOUT_MS applies to other LLM stages (default 360s)'
		);
		console.error(
			'  INGEST_GROUPING_ADAPTIVE=1 (default)   Mid–Stage 3: shrink batch targets + preempt headroom after truncation / JSON repair / collapse; INGEST_GROUPING_ADAPT_* knobs tune shrink ratio, floors, regroup cap, slow-call timeout growth'
		);
		console.error('\nRestormel route env vars (optional):');
		console.error('  RESTORMEL_INGEST_ROUTE_ID, RESTORMEL_INGEST_VALIDATION_ROUTE_ID');
		console.error('  RESTORMEL_INGEST_EXTRACTION_ROUTE_ID, RESTORMEL_INGEST_RELATIONS_ROUTE_ID, RESTORMEL_INGEST_GROUPING_ROUTE_ID, RESTORMEL_INGEST_JSON_REPAIR_ROUTE_ID');
		console.error('\nAdmin Expand pins (optional; set by server when using stage picks):');
		console.error('  INGEST_PIN_PROVIDER_EXTRACTION, INGEST_PIN_MODEL_EXTRACTION (same for RELATIONS, GROUPING, VALIDATION, JSON_REPAIR)');
		console.error('  --ingest-pins-json=<base64url JSON>  Preferred when spawned from admin (survives dotenv)');
		console.error('  INGEST_LOG_PINS=1            Log pin + routing diagnostics (per-stage planning, dotenv restore)');
		console.error('  INGEST_NO_MODEL_FALLBACK=1   When set, do not escalate to other providers/models after retries (pins imply strict mode)');
		console.error('  INGEST_RECOVERY_AGENT=1      Optional: after inner retries, consult routed model for bounded backoff + one extra attempt (transient errors)');
		console.error('  INGEST_RECOVERY_AGENT_MAX_SLEEP_MS, INGEST_RECOVERY_AGENT_TIMEOUT_MS');
		console.error('  INGEST_CIRCUIT_FAILURE_THRESHOLD   Soft circuit: after N failures on same stage+model in one run, skip tier (0=disabled)');
		console.error(
			'  INGEST_FORCE_REINGEST=1          Durable-job / operator re-ingest: treat as --force-stage extracting (skip early exit when ingestion_log is complete)'
		);
		console.error(
			'  INGEST_FRESH_EXTRACTION=1        With --force-stage extracting: after Neon/disk merge, reset resume floor + clear partial Stage 1–5 checkpoints (avoids partial.stage_completed undoing force-stage)'
		);
		console.error(
			`  INGEST_FORCE_STAGE=<stage>       Same as --force-stage when argv is not passed (valid: ${STAGES_ORDER.join(', ')})`
		);
		console.error(
			'  INGEST_FORCE_STAGE_MISSING_CHECKPOINT=error|full|resume   When force-stage needs Neon/disk checkpoints that are missing (or validation-only gate fails): error=exit (default for non-validation tails), full=clear force and run from extraction, resume=clear force and best partial without embedding-complete gate. If unset and INGEST_FORCE_STAGE / --force-stage is validating, defaults to resume (same as durable job worker sanitization).'
		);
		console.error(
			'  INGEST_EXCLUDE_SOURCE_FROM_MODEL_TRAINING=1   Mark stored source as excluded from model-training exports (Neon + Surreal); Neon upsert is sticky-OR'
		);
		console.error('\nResume is automatic — re-run the same source to pick up where it left off.');
		process.exit(1);
	}

	const configuredEmbeddingProvider = getEmbeddingProvider();

	// Validate environment
	if (configuredEmbeddingProvider.name === 'vertex' && !GOOGLE_VERTEX_PROJECT) {
		console.error(
			'[ERROR] GOOGLE_VERTEX_PROJECT (or GCP_PROJECT_ID) is required when EMBEDDING_PROVIDER=vertex'
		);
		process.exit(1);
	}
	if (shouldValidate && !GOOGLE_VERTEX_PROJECT) {
		console.error('[ERROR] --validate flag requires GOOGLE_VERTEX_PROJECT (or GCP_PROJECT_ID) — uses Vertex AI ADC');
		process.exit(1);
	}

	// Load source files (or full text from Neon when the worker has no local data/sources copy)
	const { txtPath, sourceText, sourceMeta, slug } = await loadSourceTextAndMeta(filePath, {
		validationStagingFallback: validationOnlyIngestIntent(forceStage)
	});
	ingestSourceTextBodyForCheckpoint = sourceText;
	if (process.env.DATABASE_URL?.trim()) {
		const persistedFails = await loadIngestLlmFailureCountsFromDb();
		for (const [k, v] of persistedFails) {
			ingestModelFailureCounts.set(k, v);
		}
		const persistedStageFails = await loadIngestLlmStageFailureCountsFromDb();
		for (const [k, v] of persistedStageFails) {
			ingestStageModelFailureCounts.set(k, v);
		}
	}
	assertValidSourceMetadata(sourceMeta);
	const excludeFromModelTraining = resolveExcludeSourceFromModelTrainingForIngest();
	assertSepPresetDiscipline({
		sourceType: sourceMeta.source_type,
		mode: parsePresetDisciplineMode(process.env.INGEST_PRESET_DISCIPLINE),
		profile: process.env.INGEST_PRESET_PROFILE,
		fingerprint: buildSepPresetFingerprint(process.env),
		logLine: (line) => console.log(line)
	});
	const sectionTokenLimit = getSectionTokenLimit(sourceMeta.source_type);
	const rawPassages = segmentArgumentativePassages(sourceText, {
		maxTokensPerPassage: Math.min(sectionTokenLimit, 900)
	});

	let passages = rawPassages;
	if (INGEST_PREFILTER_ENABLED) {
		const { filtered, removedCount, removedTokens } = filterBoilerplatePassages(rawPassages);
		if (removedCount > 0) {
			console.log(
				`  [PREFILTER] Removed ${removedCount}/${rawPassages.length} boilerplate passages (~${removedTokens.toLocaleString()} tokens saved)`
			);
		}
		passages = filtered;
	}

	const extractionBatchTokenLimit = resolveIngestExtractionBatchTokenLimit(
		sectionTokenLimit,
		sourceMeta.source_type
	);
	if (extractionBatchTokenLimit < sectionTokenLimit) {
		console.log(
			`  [INFO] Extraction batch cap: ~${extractionBatchTokenLimit.toLocaleString()} tokens/batch (section limit ${sectionTokenLimit.toLocaleString()}; sep_entry uses a smaller default unless INGEST_EXTRACTION_DISABLE_SEP_DEFAULT_SMALL_BATCH=1, or set INGEST_EXTRACTION_MAX_TOKENS_PER_BATCH / INGEST_EXTRACTION_BATCH_TOKEN_FRACTION)`
		);
	}
	const extractionBatches = buildPassageBatches(passages, extractionBatchTokenLimit);
	const cu = sourceMeta.canonical_url?.trim();
	const su = sourceMeta.url?.trim();
	const partialLoadOpts: LoadPartialResultsOpts = {
		forceStage,
		canonicalSourceUrl: sourceMeta.url,
		canonicalUrlHash: sourceMeta.canonical_url_hash,
		...(cu && cu !== su ? { extraUrlsForHashLookup: [cu] } : {})
	};

	// Admin orchestration + Neon: stages 1–5 use `--stop-before-store`; checkpoints live in Neon.
	// Skip Surreal until Sync (Stage 6), so local runs do not need a live SurrealDB for pipeline tests.
	const skipSurrealForOrchestratedPhases =
		Boolean(
			process.env.INGEST_ORCHESTRATION_RUN_ID?.trim() && process.env.DATABASE_URL?.trim()
		) && (stopBeforeStore || stopAfterExtraction);

	// ─── Connect to SurrealDB (ingestion_log + Stage 6) ───
	let db: Surreal | null = null;
	if (!skipSurrealForOrchestratedPhases) {
		db = new Surreal();
		try {
			await reconnectDbWithRetry(db, 'initial startup');
			await initializeIngestionLogCompatibility(db);
		} catch (error) {
			console.error(`[ERROR] Failed to connect to SurrealDB: ${error instanceof Error ? error.message : String(error)}`);
			console.error(
				'The pipeline needs SurrealDB for ingestion_log and Stage 6. For runs that stop before store or after extraction only, use DATABASE_URL + INGEST_ORCHESTRATION_RUN_ID (Neon checkpoints), or start Surreal (e.g. docker compose up -d surrealdb).'
			);
			process.exit(1);
		}
	} else {
		console.log(
			'  [INFO] Neon orchestration + --stop-before-store/--stop-after-extraction: skipping SurrealDB for covered stages (checkpoints in Neon / disk). Stage 6 still requires Surreal when you Sync.'
		);
	}

	// ─── Check ingestion log for resume status ─────────────────────────────
	let resumeFromStage: string | null = null;
	const existingLog = await getIngestionLog(db, sourceMeta.url);
	const surrealStageCompletedAtStart =
		existingLog && typeof existingLog.stage_completed === 'string'
			? existingLog.stage_completed.trim() || null
			: null;

	if (existingLog) {
		if (existingLog.status === 'complete' && !forceStage) {
			console.log(`[SKIP] "${sourceMeta.title}" already ingested (status: complete)`);
			await closeSurrealIfOpen(db);
			process.exit(0);
		}

		// Failed or partial — attempt resume
		resumeFromStage = existingLog.stage_completed || null;
		console.log('╔══════════════════════════════════════════════════════════════╗');
		console.log('║         SOPHIA — INGESTION PIPELINE (RESUMING)              ║');
		console.log('╚══════════════════════════════════════════════════════════════╝');
		console.log('');
		console.log(`[RESUME] Previous status: ${existingLog.status}`);
		console.log(`[RESUME] Last completed stage: ${resumeFromStage || 'none'}`);
		if (existingLog.error_message) {
			console.log(`[RESUME] Previous error: ${existingLog.error_message}`);
		}
		console.log('');
	} else {
		// Fresh start
		await createIngestionLog(db, sourceMeta.url, sourceMeta.title);
	}

	// --force-stage sets a *floor* (re-run from the stage after the prior one). Surreal `stage_completed`
	// can be *ahead* of that floor (e.g. deploy mid-store while still `remediating` + `--force-stage validating`);
	// never rewind past the checkpoint — pick the later of (log checkpoint, force floor).
	if (forceStage) {
		const forceIdx = STAGES_ORDER.indexOf(forceStage);
		if (forceIdx === -1) {
			// unreachable: forceStage validated earlier
			resumeFromStage = null;
		} else if (forceIdx === 0) {
			resumeFromStage = null;
			console.log(`[FORCE] --force-stage ${forceStage}: full pipeline from start`);
		} else {
			const floorAfter = STAGES_ORDER[forceIdx - 1];
			const fromLog = resumeFromStage;
			const merged = laterCompletedStage(fromLog, floorAfter);
			resumeFromStage = merged;
			if (fromLog && merged !== fromLog && completedStageOrderRank(fromLog) > completedStageOrderRank(floorAfter)) {
				console.log(
					`[FORCE] --force-stage ${forceStage}: floor after "${floorAfter}"; ingestion_log checkpoint "${fromLog}" is ahead → resume after "${merged}"`
				);
			} else {
				console.log(`[FORCE] --force-stage ${forceStage}: resume after "${merged ?? 'none'}"`);
			}
		}
	}

	// Load partial results from Neon/disk whenever present — Surreal `stage_completed` is often
	// unset mid-extract, so skipping load when `resumeFromStage` is null dropped mid-extraction checkpoints.
	const stageBeforeValidate = STAGES_ORDER[STAGES_ORDER.indexOf('validating') - 1];
	let partial: PartialResults;

	async function tryRelaxForceStageMissingCheckpoint(
		kind: 'no_partial' | 'embedding_gate',
		gatePartial: PartialResults | null
	): Promise<boolean> {
		const mode = parseForceStageMissingCheckpointMode(forceStage);
		if (mode === 'error' || !forceStage) return false;

		const label =
			kind === 'no_partial'
				? 'no Neon/disk checkpoint for this forced tail'
				: 'checkpoint does not include full embeddings required for validation-only tail';
		console.warn(
			`[RESUME] INGEST_FORCE_STAGE_MISSING_CHECKPOINT=${mode}: ${label}. Clearing --force-stage / INGEST_FORCE_STAGE for this run.`
		);
		forceStage = null;

		if (mode === 'full') {
			resumeFromStage = null;
			partial = { source: sourceMeta, stage_completed: 'none' };
			console.warn(
				kind === 'no_partial'
					? '[RESUME] full fallback: starting pipeline from Stage 1 (extraction).'
					: '[RESUME] full fallback: discarding incompatible partial; starting from Stage 1 (extraction).'
			);
			return true;
		}

		const relaxed =
			gatePartial ??
			(await loadPartialResults(slug, {
				canonicalSourceUrl: sourceMeta.url,
				canonicalUrlHash: sourceMeta.canonical_url_hash,
				...(cu && cu !== su ? { extraUrlsForHashLookup: [cu] } : {})
			}));

		if (relaxed && partialHasDurableNeonOrDiskProgress(relaxed)) {
			partial = relaxed;
			Object.assign(partial.source as object, sourceMeta as object);
			const pSt = (partial.stage_completed ?? '').trim();
			const merged = laterCompletedStage(surrealStageCompletedAtStart, pSt && pSt !== 'none' ? pSt : null);
			resumeFromStage = merged ? normalizeResumeStage(merged, partial) : null;
			console.log(
				`[RESUME] resume fallback: best partial loaded (resume after last completed: "${resumeFromStage ?? 'none'}")`
			);
			return true;
		}

		console.warn('[RESUME] resume fallback: no durable partial found — starting from Stage 1 (extraction).');
		resumeFromStage = null;
		partial = { source: sourceMeta, stage_completed: 'none' };
		return true;
	}

	const loadedPartial = await loadPartialResults(slug, partialLoadOpts);

	if (resumeFromStage) {
		if (loadedPartial) {
			partial = loadedPartial;
			Object.assign(partial.source as object, sourceMeta as object);
			const normalized = normalizeResumeStage(resumeFromStage, partial);
			if (normalized !== resumeFromStage) {
				console.log(
					`[RESUME] Partial data incomplete for stage "${resumeFromStage}" — rolling back resume point to "${normalized ?? 'none'}"`
				);
				resumeFromStage = normalized;
			}
			if (validationOnlyIngestIntent(forceStage) && !validationOnlyEmbeddingCheckpointMet(resumeFromStage)) {
				if (await tryRelaxForceStageMissingCheckpoint('embedding_gate', partial)) {
					// force cleared; continue as standard pipeline from normalized resume
				} else {
					console.error(
						`[ERROR] Validation-only ingest requires Neon checkpoints through "${stageBeforeValidate}" (claims + relations + grouping + full embeddings). Current resume point: "${resumeFromStage ?? 'none'}".`
					);
					console.error(
						`[ERROR] Set INGEST_FORCE_STAGE_MISSING_CHECKPOINT=full to re-run from extraction, or =resume to load the best partial without the validation-only tail gate (or fix Neon staging).`
					);
					await closeSurrealIfOpen(db);
					process.exit(INGEST_EXIT_FORCE_STAGE_CHECKPOINT_MISSING);
				}
			}
			console.log(`[RESUME] Loaded partial results (stage: ${loadedPartial.stage_completed})`);
		} else {
			console.log(
				'[RESUME] No checkpoint (Neon ingest_staging_* or data/ingested/*-partial.json) — restarting from scratch'
			);
			const strictMissing = parseForceStageMissingCheckpointMode(forceStage) === 'error';
			if (validationOnlyIngestIntent(forceStage) && strictMissing) {
				console.warn(
					`  [RESUME] Hint: no tail-compatible ingest_staging_meta for slug=${slug} url=${su || '(none)'} canonical_url=${cu || '(none)'} hash=${sourceMeta.canonical_url_hash ?? '(none)'}. ` +
						`Sources that never finished through embedding (or only have empty staging shells) cannot validation-only resume. ` +
						`Set INGEST_VALIDATION_ONLY_NO_CHECKPOINT=skip for exit 0 in batch jobs when skipping is OK, ` +
						`or INGEST_FORCE_STAGE_MISSING_CHECKPOINT=full|resume to continue without this tail gate.`
				);
			}
			if (forceStage) {
				if (await tryRelaxForceStageMissingCheckpoint('no_partial', null)) {
					// force cleared; partial + resume set for full or best-partial path
				} else {
					const rid = process.env.INGEST_ORCHESTRATION_RUN_ID?.trim() ?? '';
					const validationExtra = validationOnlyIngestIntent(forceStage)
						? ' Re-run the full pipeline through embedding with DATABASE_URL so Neon staging is written, or fix slug/URL/hash metadata. Surreal "complete" alone does not supply embeddings checkpoints for a new orchestration run id.'
						: '';
					console.error(
						`[ERROR] --force-stage ${forceStage} requires existing checkpoints through the prior pipeline stage ` +
							`(expected resume point "${resumeFromStage ?? 'none'}" from Neon ingest_staging_* for this run, or a local data/ingested/*-partial.json). ` +
							`None were found (orchestration run id: ${rid || 'unset'}). Refusing to re-run earlier stages silently.${validationExtra}`
					);
					console.error(
						`[ERROR] Set INGEST_FORCE_STAGE_MISSING_CHECKPOINT=full to re-run from extraction, or =resume to load the best available partial (no embedding-complete gate).`
					);
					await closeSurrealIfOpen(db);
					if (validationOnlyIngestIntent(forceStage)) {
						exitValidationOnlyNoCheckpoint();
					}
					process.exit(INGEST_EXIT_FORCE_STAGE_CHECKPOINT_MISSING);
				}
			} else {
				resumeFromStage = null;
				partial = { source: sourceMeta, stage_completed: 'none' };
			}
		}
	} else if (loadedPartial && partialHasDurableNeonOrDiskProgress(loadedPartial)) {
		partial = loadedPartial;
		Object.assign(partial.source as object, sourceMeta as object);
		const st = (loadedPartial.stage_completed ?? '').trim();
		if (st && st !== 'none') {
			resumeFromStage = st;
			const normalized = normalizeResumeStage(resumeFromStage, partial);
			if (normalized !== resumeFromStage) {
				console.log(
					`[RESUME] Partial data incomplete for stage "${resumeFromStage}" — rolling back resume point to "${normalized ?? 'none'}"`
				);
				resumeFromStage = normalized;
			}
			if (validationOnlyIngestIntent(forceStage) && !validationOnlyEmbeddingCheckpointMet(resumeFromStage)) {
				if (await tryRelaxForceStageMissingCheckpoint('embedding_gate', partial)) {
					// force cleared
				} else {
					console.error(
						`[ERROR] Validation-only ingest requires Neon checkpoints through "${stageBeforeValidate}" (claims + relations + grouping + full embeddings). Current resume point: "${resumeFromStage ?? 'none'}".`
					);
					console.error(
						`[ERROR] Set INGEST_FORCE_STAGE_MISSING_CHECKPOINT=full to re-run from extraction, or =resume to reload best partial without the validation-only tail gate.`
					);
					await closeSurrealIfOpen(db);
					process.exit(INGEST_EXIT_FORCE_STAGE_CHECKPOINT_MISSING);
				}
			}
		}
		console.log(
			'[RESUME] Loaded Neon/disk checkpoint without Surreal stage_completed (mid-pipeline resume)'
		);
	} else {
		partial = { source: sourceMeta, stage_completed: 'none' };
	}

	// Neon/disk merge can set `resumeFromStage` from `partial.stage_completed`, undoing `--force-stage extracting`
	// (e.g. extract-only finished Stage 1 → partial says "extracting" while log status advanced). Fresh extraction must
	// reset the resume floor before `shouldRunStage` / ingestion_log alignment.
	if (ingestFreshExtractionEnabled() && forceStage === 'extracting') {
		resumeFromStage = null;
		applyIngestFreshExtractionPartialReset(partial);
		console.log(
			'  [FRESH] INGEST_FRESH_EXTRACTION=1 — reset resume floor + cleared partial Stage 1–5 checkpoints for cold Stage 1'
		);
		await savePartialResults(slug, partial);
	}

	// After merge + partial normalization: align ingestion_log.status with the real resume point
	// (avoids showing "extracting" while validation-only / store-only resumes).
	if (existingLog) {
		const resumeStatus = ingestionLogStatusReflectingCheckpoint(resumeFromStage);
		await updateIngestionLog(db, sourceMeta.url, {
			status: resumeStatus,
			error_message: undefined
		});
		console.log(
			`[RESUME] ingestion_log status → ${resumeStatus} (resume after last completed: "${resumeFromStage ?? 'none'}")`
		);
	}

	const estimatedSourceTokens = estimateTokens(sourceText);
	const basePlanningContext = {
		sourceTitle: sourceMeta.title,
		sourceType: sourceMeta.source_type,
		estimatedTokens: estimatedSourceTokens,
		sourceLengthChars: sourceText.length,
		preferredProvider: ingestProvider
	} as const;
	activeIngestTiming = createEmptyTiming();
	let extractionPlan: IngestionStagePlan;
	let relationPlan: IngestionStagePlan;
	let groupingPlan: IngestionStagePlan;
	let validationPlan: IngestionStagePlan;
	let remediationPlan: IngestionStagePlan;
	let embeddingPlan: IngestionStagePlan;
	let jsonRepairPlan: IngestionStagePlan;
	const planInitialStart = Date.now();
	logIngestPinsWorkerSnapshot('before_initial_plan', args);
	[
		extractionPlan,
		relationPlan,
		groupingPlan,
		validationPlan,
		remediationPlan,
		embeddingPlan,
		jsonRepairPlan
	] = await Promise.all([
		planIngestionStage('extraction', basePlanningContext),
		planIngestionStage('relations', basePlanningContext),
		planIngestionStage('grouping', basePlanningContext),
		planIngestionStage('validation', basePlanningContext),
		planIngestionStage('remediation', basePlanningContext),
		planIngestionStage('embedding', basePlanningContext),
		planIngestionStage('json_repair', basePlanningContext)
	]);
	if (activeIngestTiming) activeIngestTiming.planning_initial_ms = Date.now() - planInitialStart;

	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║              SOPHIA — INGESTION PIPELINE                    ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log('');
	console.log(`Source: "${sourceMeta.title}"`);
	console.log(`Author: ${sourceMeta.author.join(', ') || 'Unknown'}`);
	console.log(`Type:   ${sourceMeta.source_type}`);
	console.log(`Words:  ${sourceMeta.word_count.toLocaleString()}`);
	console.log(`Est. tokens: ~${estimatedSourceTokens.toLocaleString()}`);
	console.log(`Passages: ${passages.length} (${extractionBatches.length} extraction batch${extractionBatches.length === 1 ? '' : 'es'})`);
	console.log(`Ingest provider hint: ${ingestProvider}`);
	console.log(`Extraction route: ${extractionPlan.provider}:${extractionPlan.model} (${extractionPlan.routingSource}) step=${extractionPlan.selectedStepId ?? '—'} switch=${extractionPlan.switchReasonCode ?? '—'}`);
	console.log(`Relations route:  ${relationPlan.provider}:${relationPlan.model} (${relationPlan.routingSource}) step=${relationPlan.selectedStepId ?? '—'} switch=${relationPlan.switchReasonCode ?? '—'}`);
	console.log(`Grouping route:   ${groupingPlan.provider}:${groupingPlan.model} (${groupingPlan.routingSource}) step=${groupingPlan.selectedStepId ?? '—'} switch=${groupingPlan.switchReasonCode ?? '—'}`);
	console.log(`Validation route: ${validationPlan.provider}:${validationPlan.model} (${validationPlan.routingSource}) step=${validationPlan.selectedStepId ?? '—'} switch=${validationPlan.switchReasonCode ?? '—'}`);
	console.log(`Remediation route: ${remediationPlan.provider}:${remediationPlan.model} (${remediationPlan.routingSource}) step=${remediationPlan.selectedStepId ?? '—'} switch=${remediationPlan.switchReasonCode ?? '—'}`);
	console.log(`Embedding route:  ${embeddingPlan.provider}:${embeddingPlan.model} (${embeddingPlan.routingSource}) step=${embeddingPlan.selectedStepId ?? '—'} switch=${embeddingPlan.switchReasonCode ?? '—'}`);
	console.log(`Repair route:     ${jsonRepairPlan.provider}:${jsonRepairPlan.model} (${jsonRepairPlan.routingSource}) step=${jsonRepairPlan.selectedStepId ?? '—'} switch=${jsonRepairPlan.switchReasonCode ?? '—'}`);
	console.log(
		`Validate: ${shouldValidate ? `YES (${validationPlan.provider}:${validationPlan.model})` : 'No'}`
	);
	if (resumeFromStage) {
		console.log(`Resume from: ${resumeFromStage}`);
	}
	const extractionParallelConcurrency = effectiveExtractionParallelConcurrency(extractionPlan.provider);
	if (extractionParallelConcurrency > INGEST_EXTRACTION_CONCURRENCY) {
		console.log(
			`  [INFO] Google/Vertex extraction throughput: parallel single-passage concurrency ${extractionParallelConcurrency} (env INGEST_EXTRACTION_CONCURRENCY=${INGEST_EXTRACTION_CONCURRENCY}; floor INGEST_GOOGLE_EXTRACTION_CONCURRENCY_FLOOR=${process.env.INGEST_GOOGLE_EXTRACTION_CONCURRENCY_FLOOR ?? '6'})`
		);
	}
	console.log('');

	try {
		// Resume: restore spend from partial checkpoint so [COST] totals/deltas stay cumulative across process restarts.
		if (resumeFromStage && partial.cost_usd_snapshot != null && partial.cost_usd_snapshot > 0) {
			costs.totalUsd = partial.cost_usd_snapshot;
			console.log(
				`  [COST_RESUME] Carried forward prior spend total=$${partial.cost_usd_snapshot.toFixed(4)} from checkpoint`
			);
		}

		// ═══════════════════════════════════════════════════════════════
		// STAGE 1: CLAIM EXTRACTION
		// ═══════════════════════════════════════════════════════════════
			let allClaims: PhaseOneClaim[] = [];
			/** True when this process finished Stage 1 work (not when Stage 1 was skipped as already complete). */
			let extractionFinishedThisProcess = false;
			const extractionTracker = startStageUsage('extraction');
			const repairTracker = startStageUsage('json_repair');

			if (validationOnlyIngestIntent(forceStage) && shouldRunStage('extracting', resumeFromStage)) {
				console.error(
					'[ERROR] Validation-only ingest would run Stage 1 (extraction); refusing (checkpoint/resume guard).'
				);
				await closeSurrealIfOpen(db);
				exitValidationOnlyNoCheckpoint();
			}

			if (shouldRunStage('extracting', resumeFromStage)) {
				const stageExtractStart = Date.now();
				await updateIngestionLog(db, sourceMeta.url, { status: 'extracting' });

				console.log('┌──────────────────────────────────────────────────────────┐');
				console.log('│ STAGE 1: CLAIM EXTRACTION                               │');
				console.log('└──────────────────────────────────────────────────────────┘');
				if (passages.length === 0 || extractionBatches.length === 0) {
					throw new Error('[INTEGRITY] Passage segmentation produced 0 extraction batches');
				}
				console.log(
					`  [INFO] Segmented into ${passages.length} argumentative passages across ${extractionBatches.length} extraction batch(es)`
				);

				let batchQueue: PassageRecord[][] = extractionBatches.map((batch) => [...batch]);
				let batchLabel = 0;

				if (partial.extraction_progress?.claims_so_far.length > 0) {
					if (Array.isArray(partial.extraction_progress.remaining_batches)) {
						const remainingBatches = partial.extraction_progress.remaining_batches;
						console.log(
							`  [RESUME] Mid-extraction checkpoint — ${partial.extraction_progress.claims_so_far.length} claims already extracted`
						);
						console.log(
							`  [RESUME] Skipping ${extractionBatches.length - remainingBatches.length} completed batches`
						);
						allClaims = ensurePhaseOneClaims(
							partial.extraction_progress.claims_so_far,
							passages,
							sourceMeta
						);
						allClaims = normalizeSequentialClaimPositions(allClaims);
						batchQueue = remainingBatches;
						batchLabel = extractionBatches.length - batchQueue.length;
						if (batchQueue.length === 0) {
							console.log(
								`  [RESUME] All ${extractionBatches.length} batches already extracted; skipping to stage completion`
							);
						}
					} else {
						console.log(
							'  [RESUME] Legacy extraction checkpoint detected without passage batches; restarting Stage 1 from scratch'
						);
						partial.extraction_progress = undefined;
					}
				}

				let i = 0;
				while (i < batchQueue.length) {
					const batch = batchQueue[i]!;
					const queueTotal = batchQueue.length;
					const passagesTotalSegmented = passages.length;

					const runSequentialSingleBatch = async (): Promise<'done' | 'split'> => {
						batchLabel++;
						const renderedBatch = renderPassageBatch(batch);
						const queuePos = i + 1;
						const passagesAfterThisBatch = batchQueue
							.slice(i + 1)
							.reduce((sum, b) => sum + b.length, 0);
						const extractionProgressSuffix = ` · ${passagesAfterThisBatch} passage(s) left after this batch · ${passagesTotalSegmented} segmented total`;
						console.log(
							`\n  [BATCH ${batchLabel}] (${queuePos}/${queueTotal}) ${batch.length} passage(s) (~${estimateTokens(renderedBatch).toLocaleString()} tokens)${extractionProgressSuffix}`
						);

						const userMsg = EXTRACTION_USER(
							`${sourceMeta.title} (Batch ${batchLabel})`,
							sourceMeta.author.join(', ') || 'Unknown',
							renderedBatch
						);

						let rawResponse: string;
						try {
							rawResponse = await callStageModelWithProgress({
								stage: 'extraction',
								plan: extractionPlan,
								budget: extractionBudget,
								tracker: extractionTracker,
								systemPrompt: EXTRACTION_SYSTEM,
								userMessage: userMsg,
								label: `Extracting batch ${batchLabel} (${queuePos}/${queueTotal})`,
								maxTokens: maxOutputTokensForExtraction(extractionBudget),
								planningContext: basePlanningContext
							});
						} catch (apiError) {
							const apiMsg = apiError instanceof Error ? apiError.message : String(apiError);
							const m = apiMsg.toLowerCase();
							const wallClockFail =
								m.includes('timed out') ||
								m.includes('(aborted)') ||
								m.includes('aborterror') ||
								(m.includes('timeout') && m.includes('extraction'));
							if (apiMsg.includes('truncated (max_tokens reached)')) {
								const halves = replaceExtractionBatchWithSplitHalves(batch);
								if (halves) {
									if (activeIngestTiming) activeIngestTiming.batch_splits += 1;
									batchQueue.splice(i, 1, halves[0]!, halves[1]!);
									const passagesInQueue = batchQueue.reduce((sum, b) => sum + b.length, 0);
									console.warn(
										`  [SPLIT] Batch ${batchLabel} truncated — splitting into 2 smaller passage batches (queue now ${batchQueue.length} batch(es), ${passagesInQueue} passage(s) in queue)`
									);
									batchLabel--;
									return 'split';
								}
							}
							if (wallClockFail) {
								const halves = replaceExtractionBatchWithSplitHalves(batch);
								if (halves) {
									if (activeIngestTiming) activeIngestTiming.batch_splits += 1;
									batchQueue.splice(i, 1, halves[0]!, halves[1]!);
									const passagesInQueue = batchQueue.reduce((sum, b) => sum + b.length, 0);
									console.warn(
										`  [SPLIT] Batch ${batchLabel} stalled (timeout/abort) — splitting into 2 smaller passage batches (queue now ${batchQueue.length} batch(es), ${passagesInQueue} passage(s) in queue)`
									);
									batchLabel--;
									return 'split';
								}
							}
							throw apiError;
						}
						logStageCost('Extraction', extractionTracker, extractionPlan);

						try {
							const parsed = parseExtractionJsonFromModelResponse(rawResponse);
							const validated = ExtractionOutputSchema.parse(
								normalizeExtractionPayload(parsed, domainOverride)
							);
							const offsetClaims = attachPassageMetadataToClaims(
								validated,
								batch,
								allClaims.length,
								sourceMeta
							);

							allClaims.push(...offsetClaims);
							console.log(
								`  [OK] Extracted ${validated.length} claims from batch ${batchLabel} (${queuePos}/${queueTotal} in queue)`
							);

							partial.extraction_progress = {
								claims_so_far: [...allClaims],
								remaining_batches: batchQueue.slice(i + 1)
							};
							await savePartialResults(slug, partial);
						} catch (parseError) {
							if (activeIngestTiming) activeIngestTiming.extraction_json_first_pass_failures += 1;
							emitIngestTelemetry({
								event: 'ingest_model_json_parse_failed',
								stage: 'extraction',
								batch_label: batchLabel,
								response_chars: rawResponse.length,
								hints: ingestModelJsonFailureHints(
									rawResponse,
									parseError instanceof Error ? parseError.message : String(parseError)
								)
							});
							logIngestModelJsonParseFailure({
								scope: `extraction batch ${batchLabel}`,
								rawResponse,
								error: parseError
							});
							console.warn(
								`  [WARN] JSON parse/validation failed for batch ${batchLabel}. Attempting fix...`
							);

							let fixedResponse: string;
							try {
								fixedResponse = await fixJsonWithModel(
									jsonRepairPlan,
									jsonRepairBudget,
									repairTracker,
									rawResponse,
									parseError instanceof Error ? parseError.message : String(parseError),
									'Array of { text, claim_type, domain, passage_id, section_context, position_in_source, confidence }',
									basePlanningContext
								);
							} catch (fixError) {
								const fixMsg = fixError instanceof Error ? fixError.message : String(fixError);
								if (fixMsg.includes('truncated (max_tokens reached)')) {
									const halves = replaceExtractionBatchWithSplitHalves(batch);
									if (halves) {
										if (activeIngestTiming) activeIngestTiming.batch_splits += 1;
										batchQueue.splice(i, 1, halves[0]!, halves[1]!);
										const passagesInQueue = batchQueue.reduce((sum, b) => sum + b.length, 0);
										console.warn(
											`  [SPLIT] Batch ${batchLabel} repair response truncated — splitting into 2 smaller passage batches (queue now ${batchQueue.length} batch(es), ${passagesInQueue} passage(s) in queue)`
										);
										batchLabel--;
										return 'split';
									}
								}
								throw fixError;
							}

							const fixedParsed = parseExtractionJsonFromModelResponse(fixedResponse);
							const fixedValidated = ExtractionOutputSchema.parse(
								normalizeExtractionPayload(fixedParsed, domainOverride)
							);
							const fixedClaims = attachPassageMetadataToClaims(
								fixedValidated,
								batch,
								allClaims.length,
								sourceMeta
							);
							allClaims.push(...fixedClaims);
							if (activeIngestTiming) {
								activeIngestTiming.extraction_claims_recovered_via_json_repair += fixedValidated.length;
							}
							console.log(
								`  [OK] Fixed and extracted ${fixedValidated.length} claims from batch ${batchLabel} (${queuePos}/${queueTotal} in queue)`
							);

							partial.extraction_progress = {
								claims_so_far: [...allClaims],
								remaining_batches: batchQueue.slice(i + 1)
							};
							await savePartialResults(slug, partial);
						}
						return 'done';
					};

					if (extractionParallelConcurrency > 1 && batch.length === 1) {
						const groupIndices: number[] = [];
						let j = i;
						while (
							j < batchQueue.length &&
							batchQueue[j]!.length === 1 &&
							groupIndices.length < extractionParallelConcurrency
						) {
							groupIndices.push(j);
							j++;
						}
						if (groupIndices.length >= 2) {
							const parallelStartLabel = batchLabel + 1;
							console.log(
								`\n  [PARALLEL] Extracting ${groupIndices.length} single-passage batches concurrently (max ${extractionParallelConcurrency})`
							);
							type ParResult = {
								order: number;
								validated: ExtractionOutput;
								batch: PassageRecord[];
								batchOrd: number;
								queuePos: number;
							};
							const parResults = await Promise.all(
								groupIndices.map(async (qi, gidx) => {
									const b = batchQueue[qi]!;
									const batchOrd = parallelStartLabel + gidx;
									const renderedBatch = renderPassageBatch(b);
									const queuePos = qi + 1;
									const passagesAfter = batchQueue
										.slice(qi + 1)
										.reduce((sum, bb) => sum + bb.length, 0);
									const suffix = ` · ${passagesAfter} passage(s) left after this batch · ${passagesTotalSegmented} segmented total`;
									console.log(
										`\n  [BATCH ${batchOrd}] (${queuePos}/${queueTotal}) 1 passage(s) (~${estimateTokens(renderedBatch).toLocaleString()} tokens)${suffix}`
									);
									const userMsg = EXTRACTION_USER(
										`${sourceMeta.title} (Batch ${batchOrd})`,
										sourceMeta.author.join(', ') || 'Unknown',
										renderedBatch
									);
									const rawResponse = await callStageModelWithProgress({
										stage: 'extraction',
										plan: extractionPlan,
										budget: extractionBudget,
										tracker: extractionTracker,
										systemPrompt: EXTRACTION_SYSTEM,
										userMessage: userMsg,
										label: `Extracting batch ${batchOrd} (${queuePos}/${queueTotal})`,
										maxTokens: maxOutputTokensForExtraction(extractionBudget),
										planningContext: basePlanningContext
									});
									logStageCost('Extraction', extractionTracker, extractionPlan);
									let validated: ExtractionOutput;
									try {
										const parsed = parseExtractionJsonFromModelResponse(rawResponse);
										validated = ExtractionOutputSchema.parse(
											normalizeExtractionPayload(parsed, domainOverride)
										);
									} catch (parseError) {
										if (activeIngestTiming) activeIngestTiming.extraction_json_first_pass_failures += 1;
										emitIngestTelemetry({
											event: 'ingest_model_json_parse_failed',
											stage: 'extraction',
											batch_label: batchOrd,
											response_chars: rawResponse.length,
											hints: ingestModelJsonFailureHints(
												rawResponse,
												parseError instanceof Error ? parseError.message : String(parseError)
											)
										});
										logIngestModelJsonParseFailure({
											scope: `extraction batch ${batchOrd}`,
											rawResponse,
											error: parseError
										});
										console.warn(
											`  [WARN] JSON parse/validation failed for batch ${batchOrd}. Attempting fix...`
										);
										const fixedResponse = await fixJsonWithModel(
											jsonRepairPlan,
											jsonRepairBudget,
											repairTracker,
											rawResponse,
											parseError instanceof Error ? parseError.message : String(parseError),
											'Array of { text, claim_type, domain, passage_id, section_context, position_in_source, confidence }',
											basePlanningContext
										);
										const fixedParsed = parseExtractionJsonFromModelResponse(fixedResponse);
										validated = ExtractionOutputSchema.parse(
											normalizeExtractionPayload(fixedParsed, domainOverride)
										);
										if (activeIngestTiming) {
											activeIngestTiming.extraction_claims_recovered_via_json_repair +=
												validated.length;
										}
									}
									const order = b[0]?.order_in_source ?? qi;
									return {
										order,
										validated,
										batch: b,
										batchOrd,
										queuePos
									} satisfies ParResult;
								})
							);
							parResults.sort((a, b) =>
								a.order !== b.order ? a.order - b.order : a.queuePos - b.queuePos
							);
							for (const pr of parResults) {
								const offsetClaims = attachPassageMetadataToClaims(
									pr.validated,
									pr.batch,
									allClaims.length,
									sourceMeta
								);
								allClaims.push(...offsetClaims);
								console.log(
									`  [OK] Extracted ${pr.validated.length} claims from batch ${pr.batchOrd} (${pr.queuePos}/${queueTotal} in queue)`
								);
							}
							batchLabel = parallelStartLabel + groupIndices.length - 1;
							partial.extraction_progress = {
								claims_so_far: [...allClaims],
								remaining_batches: batchQueue.slice(i + groupIndices.length)
							};
							await savePartialResults(slug, partial);
							i += groupIndices.length;
							continue;
						}
					}

					const seqOutcome = await runSequentialSingleBatch();
					if (seqOutcome === 'split') continue;
					i += 1;
				}

				allClaims = normalizeSequentialClaimPositions(allClaims);

				// Print breakdown
				const claimTypeBreakdown: Record<string, number> = {};
			for (const claim of allClaims) {
				claimTypeBreakdown[claim.claim_type] = (claimTypeBreakdown[claim.claim_type] || 0) + 1;
			}
			console.log(`\n  Claims by type:`);
				for (const [type, count] of Object.entries(claimTypeBreakdown).sort((a, b) => b[1] - a[1])) {
					console.log(`    ${type}: ${count}`);
				}
				assertClaimIntegrity(allClaims);
				assertFiniteCostEstimate();

				partial.claims = allClaims;
				partial.stage_completed = 'extracting';
			partial.extraction_progress = undefined; // Clear mid-stage progress — extraction is now complete
			await savePartialResults(slug, partial);
			await updateIngestionLog(db, sourceMeta.url, {
				status: ingestionLogStatusReflectingCheckpoint('extracting'),
				stage_completed: 'extracting',
				claims_extracted: allClaims.length,
				cost_usd: parseFloat(estimateCostUsd())
			});
				bumpStageMs('extracting', Date.now() - stageExtractStart);
				extractionFinishedThisProcess = true;
			} else {
				console.log('  [SKIP] Stage 1: Extraction (already completed)\n');
				if (!Array.isArray(partial.claims) || partial.claims.length === 0) {
					throw new Error('Resume data missing claims for skipped Stage 1; rerun without resume or regenerate partial results');
				}
				allClaims = ensurePhaseOneClaims(partial.claims, passages, sourceMeta);
				allClaims = normalizeSequentialClaimPositions(allClaims);
			}

			assertClaimIntegrity(allClaims);

			if (stopAfterExtraction) {
				if (!extractionFinishedThisProcess) {
					console.warn(
						'  [WARN] --stop-after-extraction: Stage 1 was not executed in this process (already complete). Continuing with Stage 2+. Re-run with --force-stage extracting to re-extract, or omit this flag.'
					);
				} else {
					console.log(
						'\n  [LOCAL] --stop-after-extraction: Stage 1 complete; checkpoints saved. Exiting before Stage 2 (relations).'
					);
					console.log(
						`  [LOCAL] claims=${allClaims.length}. Continue: same command without this flag, or --force-stage relating after relations labels exist in partial.`
					);
					await savePartialResults(slug, partial);
					await closeSurrealIfOpen(db);
					logIngestTimingSummary();
					process.exit(0);
				}
			}

			const planPostExStart = Date.now();
			[relationPlan, groupingPlan, validationPlan, remediationPlan, embeddingPlan] = await Promise.all([
				planIngestionStage('relations', {
					...basePlanningContext,
					claimCount: allClaims.length
				}),
				planIngestionStage('grouping', {
					...basePlanningContext,
					claimCount: allClaims.length
				}),
				planIngestionStage('validation', {
					...basePlanningContext,
					claimCount: allClaims.length
				}),
				planIngestionStage('remediation', {
					...basePlanningContext,
					claimCount: allClaims.length,
					claimTextChars: allClaims.reduce((sum, claim) => sum + claim.text.length, 0)
				}),
				planIngestionStage('embedding', {
					...basePlanningContext,
					claimCount: allClaims.length,
					claimTextChars: allClaims.reduce((sum, claim) => sum + claim.text.length, 0)
				})
			]);
			if (activeIngestTiming) {
				activeIngestTiming.planning_post_extraction_ms = Date.now() - planPostExStart;
				reportIngestPhaseTiming(
					'Planning (post-extraction)',
					activeIngestTiming.planning_post_extraction_ms
				);
			}

		// ═══════════════════════════════════════════════════════════════
		// STAGE 2: RELATION EXTRACTION
		// ═══════════════════════════════════════════════════════════════
			let relations: PhaseOneRelation[] = [];
		const relationsTracker = startStageUsage('relations');

		if (shouldRunStage('relating', resumeFromStage)) {
			const stageRelateStart = Date.now();
			await updateIngestionLog(db, sourceMeta.url, { status: 'relating' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 2: RELATION EXTRACTION                            │');
			console.log('└──────────────────────────────────────────────────────────┘');

			let relationsBatchTarget = RELATIONS_BATCH_TARGET_TOKENS;
			if (RELATIONS_BATCH_TARGET_TOKENS > 0) {
				const relationsAuto = resolveRelationsAutoBatchTarget({
					claims: allClaims,
					batchTargetFromEnv: RELATIONS_BATCH_TARGET_TOKENS,
					overlapClaims: RELATIONS_BATCH_OVERLAP_CLAIMS,
					autoTuneEnabled: ingestRelationsAutoTuneEnabled(),
					autoCapTokens: ingestRelationsAutoCapTokens(),
					largeClaimThreshold: ingestRelationsAutoLargeClaimThreshold(),
					largeTotalClaimJsonTokensThreshold: ingestRelationsAutoLargeTotalClaimJsonTokensThreshold(),
					minTargetTokens: ingestRelationsAutoMinTargetTokens()
				});
				if (relationsAuto.logLine) {
					console.log(`  [INFO] ${relationsAuto.logLine}`);
				}
				const relationsCap = capIngestBatchTargetForPlan({
					stage: 'relations',
					requested: relationsAuto.effectiveBatchTarget,
					provider: relationPlan.provider,
					model: relationPlan.model
				});
				relationsBatchTarget = relationsCap.value;
				if (relationsCap.capped) {
					console.log(
						`  [INFO] Relations batch target capped for ${relationPlan.provider}/${relationPlan.model}: ${relationsCap.requested.toLocaleString()} → ${relationsCap.value.toLocaleString()} (model ceiling ${relationsCap.modelCeiling.toLocaleString()})`
					);
				}
			}

			const relationsBatches = buildRelationsBatches(
				allClaims,
				relationsBatchTarget,
				RELATIONS_BATCH_OVERLAP_CLAIMS
			);

			let workQueue: PhaseOneClaim[][] = relationsBatches.map((b) => [...b]);
			let startBatchIndex = 0;

			const savedSlices = partial.relations_progress?.batch_claim_slices;
			if (Array.isArray(savedSlices) && savedSlices.length > 0) {
				workQueue = savedSlices.map((b) => [...b]);
				relations = Array.isArray(partial.relations_progress?.relations_so_far)
					? partial.relations_progress.relations_so_far
					: [];
				startBatchIndex = Math.min(
					partial.relations_progress?.next_batch_index ?? 0,
					workQueue.length
				);
				console.log(
					`  [RESUME] Mid-relations checkpoint (adaptive queue) — ${relations.length} relations; batch ${startBatchIndex + 1}/${workQueue.length}`
				);
			} else if (
				partial.relations_progress &&
				Array.isArray(partial.relations_progress.relations_so_far) &&
				partial.relations_progress.total_batches === relationsBatches.length &&
				partial.relations_progress.next_batch_index > 0
			) {
				relations = partial.relations_progress.relations_so_far;
				startBatchIndex = Math.min(partial.relations_progress.next_batch_index, relationsBatches.length);
				workQueue = relationsBatches.map((b) => [...b]);
				console.log(
					`  [RESUME] Mid-relations checkpoint — ${relations.length} relations so far; resuming at batch ${startBatchIndex + 1}/${relationsBatches.length}`
				);
			}

			console.log(
				`  [INFO] Relations in ${workQueue.length} batch(es), target ~${relationsBatchTarget.toLocaleString()} tokens (overlap ${RELATIONS_BATCH_OVERLAP_CLAIMS} claim(s)); TPM splits may increase batch count`
			);

			const relationsPlanningContext = {
				...basePlanningContext,
				claimCount: allClaims.length
			};

			for (let batchIndex = startBatchIndex; batchIndex < workQueue.length; batchIndex++) {
					// Inner loop: on TPM/rate-limit, split this queue slot into two smaller slices before escalating provider.
					while (true) {
					const batchClaims = workQueue[batchIndex]!;
					const claimsJson = JSON.stringify(batchClaims, null, 2);
					const relUserMsg = RELATIONS_USER(claimsJson);
					const tokEst = estimateRelationsClaimsJsonTokens(batchClaims);

					console.log(
						`  [BATCH ${batchIndex + 1}/${workQueue.length}] ${batchClaims.length} claims (~${tokEst.toLocaleString()} tokens claim JSON)`
					);

					let relRawResponse: string;
					try {
						relRawResponse = await callStageModel({
							stage: 'relations',
							plan: relationPlan,
							budget: relationBudget,
							tracker: relationsTracker,
							systemPrompt: RELATIONS_SYSTEM,
							userMessage: relUserMsg,
							planningContext: relationsPlanningContext
						});
					} catch (relErr) {
						if (batchClaims.length > 1 && isTpmOrRateLimitInError(relErr)) {
							const mid = Math.ceil(batchClaims.length / 2);
							workQueue.splice(
								batchIndex,
								1,
								batchClaims.slice(0, mid),
								batchClaims.slice(mid)
							);
							console.warn(
								`  [SPLIT] Relations batch hit TPM/rate limit — splitting into 2 slices (queue now ${workQueue.length} batch(es))`
							);
							partial.relations = relations;
							partial.relations_progress = {
								relations_so_far: relations,
								next_batch_index: batchIndex,
								total_batches: workQueue.length,
								batch_claim_slices: workQueue
							};
							partial.stage_completed = 'relating';
							await savePartialResults(slug, partial);
							continue;
						}
						throw relErr;
					}

					logStageCost('Relations', relationsTracker, relationPlan);

					let batchRelations: PhaseOneRelation[] = [];
					try {
						const parsed = parseJsonResponse(relRawResponse);
						batchRelations = attachRelationMetadata(RelationsOutputSchema.parse(parsed), allClaims);
						console.log(`  [OK] Identified ${batchRelations.length} relations in batch ${batchIndex + 1}`);
					} catch (parseError) {
						logIngestModelJsonParseFailure({
							scope: `relations batch ${batchIndex + 1}`,
							rawResponse: relRawResponse,
							error: parseError
						});
						console.warn('  [WARN] JSON parse/validation failed. Attempting fix...');
						const fixedResponse = await fixJsonWithModel(
							jsonRepairPlan,
							jsonRepairBudget,
							repairTracker,
							relRawResponse,
							parseError instanceof Error ? parseError.message : String(parseError),
							'Array of { from_position, to_position, relation_type, strength, note? }',
							relationsPlanningContext
						);
						const fixedParsed = parseJsonResponse(fixedResponse);
						batchRelations = attachRelationMetadata(RelationsOutputSchema.parse(fixedParsed), allClaims);
						console.log(
							`  [OK] Fixed and identified ${batchRelations.length} relations in batch ${batchIndex + 1}`
						);
					}

					relations = mergeRelationsDedup(relations, batchRelations);

					partial.relations = relations;
					partial.relations_progress = {
						relations_so_far: relations,
						next_batch_index: batchIndex + 1,
						total_batches: workQueue.length,
						batch_claim_slices: workQueue
					};
					partial.stage_completed = 'relating';
					await savePartialResults(slug, partial);
					break;
				}
			}

			// Print breakdown
			const relTypeBreakdown: Record<string, number> = {};
			for (const rel of relations) {
				relTypeBreakdown[rel.relation_type] = (relTypeBreakdown[rel.relation_type] || 0) + 1;
			}
			console.log(`\n  Relations by type:`);
			for (const [type, count] of Object.entries(relTypeBreakdown).sort((a, b) => b[1] - a[1])) {
				console.log(`    ${type}: ${count}`);
			}

			assertRelationIntegrity(relations, allClaims);
			assertFiniteCostEstimate();

			partial.relations = relations;
			partial.relations_progress = undefined;
			partial.stage_completed = 'relating';
			await savePartialResults(slug, partial);

			await updateIngestionLog(db, sourceMeta.url, {
				status: ingestionLogStatusReflectingCheckpoint('relating'),
				stage_completed: 'relating',
				relations_extracted: relations.length,
				cost_usd: parseFloat(estimateCostUsd())
			});
			bumpStageMs('relating', Date.now() - stageRelateStart);
		} else {
			console.log('  [SKIP] Stage 2: Relations (already completed)\n');
			if (!Array.isArray(partial.relations)) {
				throw new Error('Resume data missing relations for skipped Stage 2; rerun from Stage 2');
			}
			relations = partial.relations;
		}

			const planPostRelStart = Date.now();
			[groupingPlan, validationPlan] = await Promise.all([
				planIngestionStage('grouping', {
					...basePlanningContext,
					claimCount: allClaims.length,
					relationCount: relations.length
				}),
				planIngestionStage('validation', {
					...basePlanningContext,
					claimCount: allClaims.length,
					relationCount: relations.length
				})
			]);
			if (activeIngestTiming) {
				activeIngestTiming.planning_post_relations_ms = Date.now() - planPostRelStart;
			}

		// ═══════════════════════════════════════════════════════════════
		// STAGE 3: ARGUMENT GROUPING
		// ═══════════════════════════════════════════════════════════════
		let arguments_: GroupingOutput = [];
		const groupingTracker = startStageUsage('grouping');

		if (shouldRunStage('grouping', resumeFromStage)) {
			const stageGroupStart = Date.now();
			await updateIngestionLog(db, sourceMeta.url, { status: 'grouping' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 3: ARGUMENT GROUPING                              │');
			console.log('└──────────────────────────────────────────────────────────┘');

				const groupingMaxOut = resolveGroupingMaxOutputTokens(groupingPlan);
				const groupingAutoBatch = resolveGroupingAutoBatchTarget({
					claims: allClaims,
					relationCount: relations.length,
					batchTargetFromEnv: GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS,
					tokenEstimateMultiplier: GROUPING_ANTHROPIC_TOKEN_ESTIMATE_MULTIPLIER,
					outputVsInputFactor: GROUPING_OUTPUT_VS_INPUT_FACTOR,
					outputHeadroom: GROUPING_OUTPUT_HEADROOM,
					maxOutputTokens: groupingMaxOut,
					autoTuneEnabled: ingestGroupingAutoTuneEnabled(),
					autoCapTokens: ingestGroupingAutoCapTokens(),
					largeClaimThreshold: ingestGroupingAutoLargeClaimThreshold()
				});
				if (groupingAutoBatch.logLine) {
					console.log(`  [INFO] ${groupingAutoBatch.logLine}`);
				}

				const groupingCap = capIngestBatchTargetForPlan({
					stage: 'grouping',
					requested: groupingAutoBatch.effectiveBatchTarget,
					provider: groupingPlan.provider,
					model: groupingPlan.model
				});
				const groupingBatchTarget = groupingCap.value;
				if (groupingCap.capped) {
					console.log(
						`  [INFO] Grouping batch target capped for ${groupingPlan.provider}/${groupingPlan.model}: ${groupingCap.requested.toLocaleString()} → ${groupingCap.value.toLocaleString()} (model ceiling ${groupingCap.modelCeiling.toLocaleString()})`
					);
				}
				let groupingBatches = buildGroupingBatches(allClaims, relations, groupingBatchTarget);
				let groupingAdaptive: GroupingAdaptiveState | null = null;
				if (ingestGroupingAdaptiveEnabled()) {
					groupingAdaptive = createGroupingAdaptiveState(groupingBatchTarget);
					groupingBatches = subdivideGroupingBatchesForOutputHeadroom(
						groupingBatches,
						groupingMaxOut,
						groupingAdaptive.effectiveOutputHeadroom
					);
				} else {
					groupingBatches = subdivideGroupingBatchesForOutputHeadroom(groupingBatches, groupingMaxOut);
				}
				console.log(
					`  [INFO] Grouping in ${groupingBatches.length} batch(es), target ~${groupingBatchTarget.toLocaleString()} tokens (max_output ${groupingMaxOut.toLocaleString()} for ${groupingPlan.provider}/${groupingPlan.model})`
				);
				let groupedOutputs: GroupingOutput[] = [];
				let startGroupingBatchIndex = 0;
				if (
					partial.grouping_progress &&
					partial.grouping_progress.total_batches !== groupingBatches.length
				) {
					console.warn(
						`  [WARN] Grouping checkpoint batch count (${partial.grouping_progress.total_batches}) does not match current plan (${groupingBatches.length}) — restarting Stage 3 grouping from scratch`
					);
					partial.grouping_progress = undefined;
				}
				if (
					partial.grouping_progress?.grouped_outputs_so_far &&
					partial.grouping_progress.next_batch_index > 0 &&
					partial.grouping_progress.next_batch_index <= groupingBatches.length
				) {
					groupedOutputs = partial.grouping_progress.grouped_outputs_so_far;
					startGroupingBatchIndex = partial.grouping_progress.next_batch_index;
					console.log(
						`  [RESUME] Mid-grouping checkpoint — resuming at batch ${startGroupingBatchIndex + 1}/${groupingBatches.length}`
					);
				}

				const groupingPlanningContext = {
					...basePlanningContext,
					claimCount: allClaims.length,
					relationCount: relations.length
				};
				let batchIndex = startGroupingBatchIndex;
				const groupingSplitOnTruncation = !['0', 'false', 'off', 'no'].includes(
					(process.env.INGEST_GROUPING_SPLIT_ON_TRUNCATION ?? '1').trim().toLowerCase()
				);
				while (batchIndex < groupingBatches.length) {
					const batch = groupingBatches[batchIndex]!;
					const claimsJson = JSON.stringify(batch.claims, null, 2);
					const relationsJson = JSON.stringify(batch.relations, null, 2);
					console.log(
						`  [BATCH ${batchIndex + 1}/${groupingBatches.length}] ${batch.claims.length} claims, ${batch.relations.length} relations (~${estimateTokens(claimsJson).toLocaleString()} claim tokens)`
					);
					if (batch.claims.length >= 12 && batch.relations.length === 0) {
						console.log(
							`  [INFO] Grouping batch has no within-batch relations — expect sparse arguments only (no invented cross-claim structure).`
						);
					}
					const grpUserMsg = GROUPING_USER(claimsJson, relationsJson);
					let grpRawResponse: string;
					const groupingCallStarted = Date.now();
					try {
						grpRawResponse = await callStageModel({
							stage: 'grouping',
							plan: groupingPlan,
							budget: groupingBudget,
							tracker: groupingTracker,
							systemPrompt: GROUPING_SYSTEM,
							userMessage: grpUserMsg,
							maxTokens: groupingMaxOut,
							planningContext: groupingPlanningContext
						});
					} catch (groupingCallErr) {
						if (groupingSplitOnTruncation && isGroupingMaxTokensTruncation(groupingCallErr)) {
							const halves = splitGroupingBatchInHalf(batch);
							if (halves) {
								console.warn(
									`  [SPLIT] Grouping batch ${batchIndex + 1}/${groupingBatches.length} hit max_output / truncation — splitting into two smaller batches and retrying`
								);
								if (
									groupingAdaptive &&
									groupingAdaptive.regroupEvents < groupingAdaptiveMaxRegroups()
								) {
									groupingAdaptive.truncationSplits += 1;
									tightenGroupingAdaptiveAfterStress(groupingAdaptive, 'truncation');
									groupingBatches = rebuildPendingGroupingBatches({
										allClaims,
										relations,
										groupingBatches,
										fromBatchIndex: batchIndex,
										groupingPlan,
										groupingMaxOut,
										adaptive: groupingAdaptive
									});
								} else {
									groupingBatches.splice(batchIndex, 1, halves[0], halves[1]);
								}
								partial.grouping_progress = {
									grouped_outputs_so_far: groupedOutputs,
									next_batch_index: batchIndex,
									total_batches: groupingBatches.length
								};
								await savePartialResults(slug, partial);
								continue;
							}
						}
						throw groupingCallErr;
					}
					if (groupingAdaptive) {
						maybeExtendGroupingTimeoutAfterSlowCall(
							groupingBudget,
							groupingAdaptive,
							Date.now() - groupingCallStarted
						);
					}
					saveGroupingDebugRaw(slug, batchIndex, grpRawResponse);
					logStageCost('Grouping', groupingTracker, groupingPlan);

					let batchArguments: GroupingOutput;
					let groupingUsedJsonRepair = false;
					try {
						const parsed = parseJsonResponse(grpRawResponse);
						batchArguments = GroupingOutputSchema.parse(normalizeGroupingPayload(parsed));
						console.log(
							`  [OK] Identified ${batchArguments.length} arguments in batch ${batchIndex + 1}`
						);
					} catch (parseError) {
						logIngestModelJsonParseFailure({
							scope: `grouping batch ${batchIndex + 1}`,
							rawResponse: grpRawResponse,
							error: parseError
						});
						console.warn(
							`  [WARN] JSON parse/validation failed for grouping batch ${batchIndex + 1}. Attempting fix...`
						);
						const fixedResponse = await fixJsonWithModel(
							jsonRepairPlan,
							jsonRepairBudget,
							repairTracker,
							grpRawResponse,
							parseError instanceof Error ? parseError.message : String(parseError),
							'Array of { name, tradition?, domain, summary, claims: [{ position_in_source, role }] }',
							groupingPlanningContext
						);
						const fixedParsed = parseJsonResponse(fixedResponse);
						batchArguments = GroupingOutputSchema.parse(normalizeGroupingPayload(fixedParsed));
						groupingUsedJsonRepair = true;
						console.log(
							`  [OK] Fixed and identified ${batchArguments.length} arguments in batch ${batchIndex + 1}`
						);
					}
					if (
						groupingAdaptive &&
						groupingUsedJsonRepair &&
						groupingAdaptive.regroupEvents < groupingAdaptiveMaxRegroups()
					) {
						groupingAdaptive.jsonRepairBatches += 1;
						tightenGroupingAdaptiveAfterStress(groupingAdaptive, 'json_repair');
						groupingBatches = rebuildPendingGroupingBatches({
							allClaims,
							relations,
							groupingBatches,
							fromBatchIndex: batchIndex + 1,
							groupingPlan,
							groupingMaxOut,
							adaptive: groupingAdaptive
						});
					}

					const allowedClaimPositions = new Set(
						batch.claims.map((c) => c.position_in_source)
					);
					const groupingRefsBeforeFilter = batchArguments.reduce(
						(n, a) => n + a.claims.length,
						0
					);
					batchArguments = filterGroupingOutputToKnownClaimPositions(
						batchArguments,
						allowedClaimPositions
					);
					const groupingRefsAfterFilter = batchArguments.reduce(
						(n, a) => n + a.claims.length,
						0
					);
					if (groupingRefsBeforeFilter > groupingRefsAfterFilter) {
						console.warn(
							`  [WARN] Grouping batch ${batchIndex + 1}: dropped ${groupingRefsBeforeFilter - groupingRefsAfterFilter} claim ref(s) not in this batch's claim position set (out-of-batch positions).`
						);
					}

					const batchHealth = analyzeGroupingReferenceHealth(batchArguments);
					if (batchHealth.collapsed) {
						const halves = splitGroupingBatchInHalf(batch);
						if (halves) {
							console.warn(
								`  [SPLIT] Grouping batch ${batchIndex + 1} collapsed claim references (${batchHealth.uniquePositions} unique positions / ${batchHealth.totalReferences} refs) — splitting into two smaller batches`
							);
							if (
								groupingAdaptive &&
								groupingAdaptive.regroupEvents < groupingAdaptiveMaxRegroups()
							) {
								groupingAdaptive.collapseSplits += 1;
								tightenGroupingAdaptiveAfterStress(groupingAdaptive, 'reference_collapse');
								groupingBatches = rebuildPendingGroupingBatches({
									allClaims,
									relations,
									groupingBatches,
									fromBatchIndex: batchIndex,
									groupingPlan,
									groupingMaxOut,
									adaptive: groupingAdaptive
								});
							} else {
								groupingBatches.splice(batchIndex, 1, halves[0], halves[1]);
							}
							partial.grouping_progress = {
								grouped_outputs_so_far: groupedOutputs,
								next_batch_index: batchIndex,
								total_batches: groupingBatches.length
							};
							await savePartialResults(slug, partial);
							continue;
						}
					}

					groupedOutputs.push(batchArguments);
					partial.grouping_progress = {
						grouped_outputs_so_far: groupedOutputs,
						next_batch_index: batchIndex + 1,
						total_batches: groupingBatches.length
					};
					await savePartialResults(slug, partial);
					batchIndex += 1;
				}

				arguments_ = mergeGroupingOutputs(groupedOutputs);
				console.log(`  [OK] Merged into ${arguments_.length} unique arguments`);
				const groupingHealth = analyzeGroupingReferenceHealth(arguments_);
				console.log(
					`  [CHECK] Grouping refs: ${groupingHealth.totalReferences} refs across ${groupingHealth.uniquePositions} unique claim positions`
				);
				if (groupingHealth.collapsed) {
					const collapseMessage =
						`[INTEGRITY] Stage 3 grouping claim references collapsed (position=1 refs: ${groupingHealth.positionOneReferences}/${groupingHealth.totalReferences}, unique positions: ${groupingHealth.uniquePositions}). ` +
						`Likely model output degeneration or malformed position references.`;
					if (INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE) {
						throw new Error(collapseMessage);
					}
					console.warn(`  [WARN] ${collapseMessage}`);
				}

				console.log(`\n  Named arguments:`);
			for (const arg of arguments_) {
				console.log(`    • ${arg.name} (${arg.domain}, ${arg.claims.length} claims)`);
			}

			partial.arguments = arguments_;
			partial.grouping_progress = undefined;
			partial.stage_completed = 'grouping';
			await savePartialResults(slug, partial);
			await updateIngestionLog(db, sourceMeta.url, {
				status: ingestionLogStatusReflectingCheckpoint('grouping'),
				stage_completed: 'grouping',
				arguments_grouped: arguments_.length,
				cost_usd: parseFloat(estimateCostUsd())
			});
			bumpStageMs('grouping', Date.now() - stageGroupStart);
		} else {
			console.log('  [SKIP] Stage 3: Grouping (already completed)\n');
			if (!Array.isArray(partial.arguments)) {
				throw new Error('Resume data missing arguments for skipped Stage 3; rerun from Stage 3');
			}
			arguments_ = partial.arguments;
			}
			validationPlan = await planIngestionStage('validation', {
				...basePlanningContext,
				claimCount: allClaims.length,
				relationCount: relations.length,
				argumentCount: arguments_.length
			});

		// ═══════════════════════════════════════════════════════════════
		// STAGE 4: EMBEDDING
		// ═══════════════════════════════════════════════════════════════
		let allEmbeddings: number[][] = [];
		const embeddingTracker = startStageUsage('embedding');

		if (shouldRunStage('embedding', resumeFromStage)) {
			const stageEmbedStart = Date.now();
			await updateIngestionLog(db, sourceMeta.url, { status: 'embedding' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log(
				`│ STAGE 4: EMBEDDING (${configuredEmbeddingProvider.name}:${EMBEDDING_MODEL})`
					.padEnd(59, ' ') + '│'
			);
			console.log('└──────────────────────────────────────────────────────────┘');

			const claimTexts = allClaims.map((c) => c.text);
			if (db && !INGEST_EMBEDDING_IGNORE_LEGACY_CORPUS_DIM) {
				const dimProbe = await db.query<Array<{ dim?: number }> | { dim?: number }[]>(
					'SELECT array::len(embedding) AS dim FROM claim WHERE embedding IS NOT NONE LIMIT 1'
				);
				const existingDim = Array.isArray(dimProbe?.[0]) ? (dimProbe[0][0]?.dim ?? null) : null;
				if (typeof existingDim === 'number' && existingDim > 0 && existingDim !== EMBEDDING_DIMENSIONS) {
					throw new Error(
						`[INTEGRITY] Existing claim embeddings are ${existingDim}-dim, but configured embedding output is ${EMBEDDING_DIMENSIONS}-dim (${configuredEmbeddingProvider.name}:${EMBEDDING_MODEL}). ` +
							`Run a full corpus re-embed / index migration (see docs/local/operations/ingestion-embedding-lock.md), or unset strict mode: leave INGEST_EMBEDDING_IGNORE_LEGACY_CORPUS_DIM unset/default during migration.`
					);
				}
			}
			if (embeddingPlan.provider !== configuredEmbeddingProvider.name) {
				console.warn(
					`  [WARN] Embedding plan provider (${embeddingPlan.provider}) differs from configured provider (${configuredEmbeddingProvider.name}).`
				);
			}

			const priorEmbeddings =
				partial.embedding_progress?.embeddings_so_far ??
				(Array.isArray(partial.embeddings) ? partial.embeddings : []);
			if (priorEmbeddings.length > claimTexts.length) {
				throw new Error(
					'[INTEGRITY] Partial embedding vectors exceed claim count — clear Neon staging / remove *-partial.json or use --force-stage embedding'
				);
			}
			if (priorEmbeddings.length > 0) {
				assertEmbeddingVectorsMatchConfig(priorEmbeddings, 'Restored embedding checkpoint');
			}
			if (priorEmbeddings.length === claimTexts.length && priorEmbeddings.length > 0) {
				console.log(
					`  [RESUME] Embedding already complete on disk (${priorEmbeddings.length} vectors) — skipping API calls`
				);
				allEmbeddings = priorEmbeddings;
			} else {
				const prefix = priorEmbeddings.slice();
				const remainingTexts = claimTexts.slice(prefix.length);
				if (prefix.length > 0) {
					console.log(
						`  [RESUME] Mid-embedding checkpoint — ${prefix.length}/${claimTexts.length} vectors on disk; embedding ${remainingTexts.length} remaining`
					);
				}
				console.log(
					`  Embedding ${claimTexts.length} claims via ${embeddingPlan.model} (${EMBEDDING_DIMENSIONS}-dim)${
						prefix.length > 0 ? ` (${prefix.length} restored)` : ''
					}...`
				);

				const newVectors = await withEmbedPhaseSlot(async () => {
					const embedPromise = embedTexts(remainingTexts, {
						onBatchComplete: async ({ cumulativeEmbeddings }) => {
							partial.embeddings = [...prefix, ...cumulativeEmbeddings];
							partial.embedding_progress = {
								embeddings_so_far: partial.embeddings,
								next_index: partial.embeddings.length
							};
							// Keep stage_completed at 'grouping' until every claim has a vector (Surreal log uses stage_completed for resume).
							await savePartialResults(slug, partial);
							console.log(
								`  [SAVE] Embedding checkpoint: ${partial.embeddings.length}/${claimTexts.length} vectors`
							);
						}
					});

					return await withTimeout(
						embedPromise,
						embeddingBudget.timeoutMs,
						`embedding ${embeddingPlan.model}`
					);
				});
				allEmbeddings = [...prefix, ...newVectors];
			}

			assertEmbeddingVectorsMatchConfig(allEmbeddings, 'Claim embeddings');

			const embedMs = Date.now() - stageEmbedStart;
			if (activeIngestTiming) {
				activeIngestTiming.embed_wall_ms += embedMs;
				bumpStageMs('embedding', embedMs);
				reportIngestPhaseTiming('Stage 4 · embedding', embedMs);
			}

			const newCharCount = claimTexts
				.slice(priorEmbeddings.length)
				.reduce((sum, t) => sum + t.length, 0);
			if (newCharCount > 0) {
				trackEmbeddingCost(newCharCount);
			}
			assertStageBudget(embeddingBudget, embeddingTracker);

			console.log(`  [OK] Generated ${allEmbeddings.length} embeddings (${EMBEDDING_DIMENSIONS} dimensions)`);
			logStageCost('Embedding', embeddingTracker, embeddingPlan);

			partial.embeddings = allEmbeddings;
			partial.embedding_progress = undefined;
			partial.stage_completed = 'embedding';
			await savePartialResults(slug, partial);
			await updateIngestionLog(db, sourceMeta.url, {
				status: ingestionLogStatusReflectingCheckpoint('embedding'),
				stage_completed: 'embedding',
				cost_usd: parseFloat(estimateCostUsd())
			});
		} else {
			console.log('  [SKIP] Stage 4: Embedding (already completed)\n');
			if (!Array.isArray(partial.embeddings)) {
				throw new Error('Resume data missing embeddings for skipped Stage 4; rerun from Stage 4');
			}
			allEmbeddings = partial.embeddings;
		}

		// ── Pipeline handoff point ─────────────────────────────────────
		// When running in pipelined mode, stop here so the batch can start
		// the next source's Claude extraction while Gemini validates this one.
		if (stopAfterEmbedding) {
			console.log('\n  [PIPELINE] Stages 1-4 complete. Handing off to Gemini+Store phase.');
			await updateIngestionLog(db, sourceMeta.url, {
				status: 'validating',
				stage_completed: 'embedding',
				cost_usd: parseFloat(estimateCostUsd())
			});
			await closeSurrealIfOpen(db);
			logIngestTimingSummary();
			process.exit(0);
		}

		// ═══════════════════════════════════════════════════════════════
		// STAGE 5: CROSS-MODEL VALIDATION (optional)
		// ═══════════════════════════════════════════════════════════════
		let validationResult: ValidationOutput | null = null;
		/** True after Stage 5b body runs in this process (required for opt-in store-skip eligibility). */
		let postValidationGraphEvaluatedForStoreSkip = false;
		let postValidationGraphMutatedForStoreSkip = false;

		if (shouldRunStage('validating', resumeFromStage)) {
			const stageValStart = Date.now();
			if (shouldValidate) {
				await updateIngestionLog(db, sourceMeta.url, { status: 'validating' });

				console.log('\n┌──────────────────────────────────────────────────────────┐');
				console.log('│ STAGE 5: CROSS-MODEL VALIDATION                         │');
				console.log('└──────────────────────────────────────────────────────────┘');
				const validationTracker = startStageUsage('validation');

				const validationCap = capIngestBatchTargetForPlan({
					stage: 'validation',
					requested: VALIDATION_BATCH_TARGET_TOKENS,
					provider: validationPlan.provider,
					model: validationPlan.model
				});
				const validationBatchTarget = validationCap.value;
				if (validationCap.capped) {
					console.log(
						`  [INFO] Validation batch target capped for ${validationPlan.provider}/${validationPlan.model}: ${validationCap.requested.toLocaleString()} → ${validationCap.value.toLocaleString()} (model ceiling ${validationCap.modelCeiling.toLocaleString()})`
					);
				}
				if (VALIDATION_BATCH_TARGET_TOKENS < 100_000) {
					console.log(
						`  [INFO] VALIDATION_BATCH_TARGET_TOKENS=${VALIDATION_BATCH_TARGET_TOKENS} is below default 100000 — BML showed validation wall can drop while remediation tokens rise; tune with relations/grouping together (docs/local/operations/ingest-validation-remediation-knobs-bml.md).`
					);
				}
				if (VALIDATION_BATCH_SOURCE_MAX_CHARS < 20_000) {
					console.warn(
						`  [WARN] VALIDATION_BATCH_SOURCE_MAX_CHARS=${VALIDATION_BATCH_SOURCE_MAX_CHARS} is tight — faithfulness may suffer if excerpts miss evidence; QA before fleet-wide use (ingest-validation-remediation-knobs-bml.md).`
					);
				}

			let validationBatches = buildValidationBatches(
				allClaims,
				relations,
				arguments_,
				sourceText,
				sourceMeta.title,
				validationBatchTarget
			);

			if (INGEST_VALIDATION_SAMPLE_RATE < 1.0 && validationBatches.length > 1) {
				const totalBatches = validationBatches.length;
				const sampleCount = Math.max(1, Math.round(totalBatches * INGEST_VALIDATION_SAMPLE_RATE));
				const rng = INGEST_VALIDATION_SAMPLE_SEED != null ? mulberry32(INGEST_VALIDATION_SAMPLE_SEED) : null;
				const scored = validationBatches.map((batch, idx) => ({
					batch,
					idx,
					key: rng ? rng() : Math.random()
				}));
				scored.sort((a, b) => (a.key === b.key ? a.idx - b.idx : a.key - b.key));
				validationBatches = scored.slice(0, sampleCount).map((e) => e.batch);
				console.log(
					`  [SAMPLE] Spot-check validation: ${sampleCount}/${totalBatches} batches selected (${(INGEST_VALIDATION_SAMPLE_RATE * 100).toFixed(0)}% sample rate)${INGEST_VALIDATION_SAMPLE_SEED != null ? ` seed=${INGEST_VALIDATION_SAMPLE_SEED}` : ''}`
				);
			}

			console.log(
				`  [INFO] Validation in ${validationBatches.length} batch(es), target ~${validationBatchTarget.toLocaleString()} tokens`
			);
				let batchOutputs: ValidationOutput[] = [];
				let startValidationBatchIndex = 0;
				if (
					partial.validation_progress?.should_validate &&
					partial.validation_progress.batch_outputs_so_far &&
					partial.validation_progress.next_batch_index > 0 &&
					partial.validation_progress.next_batch_index <= validationBatches.length
				) {
					batchOutputs = partial.validation_progress.batch_outputs_so_far;
					startValidationBatchIndex = partial.validation_progress.next_batch_index;
					console.log(
						`  [RESUME] Mid-validation checkpoint — resuming at batch ${startValidationBatchIndex + 1}/${validationBatches.length}`
					);
				}

				const validationPlanningContext: IngestionPlanningContext = {
					...basePlanningContext,
					claimCount: allClaims.length,
					relationCount: relations.length,
					argumentCount: arguments_.length,
					claimTextChars: allClaims.reduce(
						(sum, c) => sum + (typeof c.text === 'string' ? c.text.length : 0),
						0
					)
				};
				const validationExecCtx: ValidationBatchExecContext = {
					validationPlan,
					validationBudget,
					validationTracker,
					jsonRepairPlan,
					jsonRepairBudget,
					repairTracker,
					relations,
					arguments_,
					sourceText,
					sourceTitle: sourceMeta.title,
					planningContext: validationPlanningContext
				};

				for (let batchIndex = startValidationBatchIndex; batchIndex < validationBatches.length; batchIndex++) {
					const batch = validationBatches[batchIndex];
					console.log(
						`  [BATCH ${batchIndex + 1}/${validationBatches.length}] ${batch.claims.length} claims, ${batch.relations.length} relations, ${batch.arguments.length} arguments (~${batch.estimatedPromptTokens.toLocaleString()} est tokens)`
					);
					const batchLabel = `Validation batch ${batchIndex + 1}`;
					const merged = await runValidationBatchWithContextSplitting(
						batch,
						validationExecCtx,
						0,
						batchLabel
					);
					if (merged) {
						batchOutputs.push(merged);
					}
					partial.validation_progress = {
						batch_outputs_so_far: batchOutputs,
						next_batch_index: batchIndex + 1,
						total_batches: validationBatches.length,
						should_validate: true
					};
					await savePartialResults(slug, partial);
				}

				logStageCost('Validation', validationTracker, validationPlan);

				if (batchOutputs.length > 0) {
					validationResult = mergeValidationOutputs(batchOutputs);
				} else {
					console.warn('  [WARN] Validation produced no successful batch outputs; continuing without validation.');
				}

				if (validationResult) {
					const claimScores = validationResult.claims?.map((c) => c.faithfulness_score) || [];
					const avgScore =
						claimScores.length > 0
							? Math.round(claimScores.reduce((a, b) => a + b, 0) / claimScores.length)
							: 0;
					const quarantined = validationResult.quarantine_items?.length || 0;

					console.log(`  [OK] Validation complete`);
					console.log(`  Average faithfulness score: ${avgScore}/100`);
					console.log(`  Quarantined items: ${quarantined}`);
					console.log(`  Summary: ${validationResult.summary}`);

					if (avgScore < 60) {
						console.warn('\n  ⚠️  WARNING: Quality score below 60. Manual review recommended.');
					}
				}
			} else {
				console.log('\n  [SKIP] Stage 5: Validation (use --validate flag to enable)');
				partial.validation_progress = undefined;
			}

			partial.validation = validationResult;
			partial.validation_progress = undefined;
			partial.stage_completed = 'validating';
			await savePartialResults(slug, partial);

			const valScore = validationResult?.claims?.length
				? validationResult.claims.reduce((a, b) => a + b.faithfulness_score, 0) / validationResult.claims.length
				: undefined;

			await updateIngestionLog(db, sourceMeta.url, {
				status: 'validating',
				stage_completed: 'validating',
				validation_score: valScore,
				cost_usd: parseFloat(estimateCostUsd())
			});
			bumpStageMs('validating', Date.now() - stageValStart);
			if (activeIngestTiming) {
				reportIngestPhaseTiming('Stage 5 · validation', activeIngestTiming.stage_ms['validating'] ?? 0);
			}
		} else {
			console.log('  [SKIP] Stage 5: Validation (already completed)\n');
			validationResult = partial.validation ?? null;
		}

		// ═══════════════════════════════════════════════════════════════
		// STAGE 5b: REMEDIATION (optional — between validation and store)
		// ═══════════════════════════════════════════════════════════════
		if (shouldRunStage('remediating', resumeFromStage)) {
			const stageRemStart = Date.now();
			postValidationGraphEvaluatedForStoreSkip = true;
			const policy = parseRemediationPolicyJson(process.env.INGEST_REMEDIATION_POLICY_JSON);
			const remediatedPositions = new Set<number>();
			let droppedBefore = relations.length;

			if (shouldValidate && validationResult) {
				droppedBefore = relations.length;
				relations = dropRelationsByValidation(
					relations,
					validationResult,
					INGEST_REMEDIATION_VALIDITY_MIN
				) as PhaseOneRelation[];
				if (droppedBefore !== relations.length) {
					postValidationGraphMutatedForStoreSkip = true;
					console.log(
						`  [REMEDIATION] Dropped ${droppedBefore - relations.length} relation edge(s) (quarantine or validity < ${INGEST_REMEDIATION_VALIDITY_MIN})`
					);
				}
				assertRelationIntegrity(relations, allClaims);
			}

			if (
				shouldValidate &&
				validationResult &&
				ingestRemediationEnabled() &&
				!policy?.skip_repair
			) {
				console.log('\n┌──────────────────────────────────────────────────────────┐');
				console.log('│ STAGE 5b: REMEDIATION (passage-bounded repair)          │');
				console.log('└──────────────────────────────────────────────────────────┘');
				console.log('STAGE 5b: REMEDIATION');
				const remediationTracker = startStageUsage('remediation');
				const preRemediationValidation = validationResult;

				let positions = selectRemediationPositions(validationResult, {
					faithfulnessMin: INGEST_REMEDIATION_FAITHFULNESS_MIN,
					maxClaims: INGEST_REMEDIATION_MAX_CLAIMS
				});
				let startIdx = 0;
				if (
					partial.remediation_progress?.positions?.length &&
					typeof partial.remediation_progress.next_index === 'number'
				) {
					positions = partial.remediation_progress.positions;
					startIdx = partial.remediation_progress.next_index;
					console.log(
						`  [RESUME] Mid-remediation — ${startIdx}/${positions.length} claim(s) already repaired`
					);
				}

				const remediationPlanningContext: IngestionPlanningContext = {
					...basePlanningContext,
					claimCount: allClaims.length,
					relationCount: relations.length,
					argumentCount: arguments_.length,
					claimTextChars: allClaims.reduce((sum, c) => sum + (c.text?.length ?? 0), 0)
				};

				for (let i = startIdx; i < positions.length; i++) {
					const pos = positions[i]!;
					if (i === startIdx || (i + 1) % 3 === 0 || i === positions.length - 1) {
						console.log(
							`  [REMEDIATION] Claim ${i + 1}/${positions.length} (position_in_source=${pos})…`
						);
					}
					const claim = allClaims.find((c) => c.position_in_source === pos);
					if (!claim) continue;
					const excerpt = sliceSourceAroundClaim(
						sourceText,
						claim.source_span_start,
						claim.source_span_end
					);
					const vc = validationResult?.claims?.find((c) => c.position_in_source === pos);
					const issues: string[] = [];
					for (const label of [
						['faithfulness', vc?.faithfulness_issue],
						['atomicity', vc?.atomicity_issue],
						['classification', vc?.classification_issue],
						['domain', vc?.domain_issue]
					] as const) {
						if (label[1]) issues.push(`${label[0]}: ${label[1]}`);
					}
					if (vc?.quarantine) issues.push('quarantine: true');
					const claimSubset = {
						position_in_source: claim.position_in_source,
						text: claim.text,
						claim_type: claim.claim_type,
						domain: claim.domain
					};
					const userMsg = REMEDIATION_REPAIR_USER({
						position_in_source: pos,
						passage_excerpt: excerpt,
						claim_json: JSON.stringify(claimSubset, null, 2),
						validation_issues: issues
					});
					const raw = await callStageModel({
						stage: 'remediation',
						plan: remediationPlan,
						budget: remediationBudget,
						tracker: remediationTracker,
						systemPrompt: REMEDIATION_REPAIR_SYSTEM,
						userMessage: userMsg,
						maxTokens: 8192,
						planningContext: remediationPlanningContext
					});
					const parsed = parseJsonResponse(raw);
					const out = normalizeRemediationRepairOutput(parsed, pos);
					const prevClaimText = claim.text;
					claim.text = out.revised_claim_text;
					if (prevClaimText !== out.revised_claim_text) {
						postValidationGraphMutatedForStoreSkip = true;
					}
					remediatedPositions.add(pos);
					partial.remediation_progress = { positions, next_index: i + 1 };
					await savePartialResults(slug, partial);
				}
				partial.remediation_progress = undefined;

				if (remediatedPositions.size > 0) {
					const pairs: { idx: number; text: string }[] = [];
					for (const pos of remediatedPositions) {
						const idx = allClaims.findIndex((c) => c.position_in_source === pos);
						if (idx >= 0 && idx < allEmbeddings.length) {
							pairs.push({ idx, text: allClaims[idx]!.text });
						}
					}
					if (pairs.length > 0) {
						postValidationGraphMutatedForStoreSkip = true;
						const vecs = await embedTexts(
							pairs.map((p) => p.text),
							{}
						);
						for (let j = 0; j < pairs.length; j++) {
							allEmbeddings[pairs[j]!.idx] = vecs[j]!;
							trackEmbeddingCost(pairs[j]!.text.length);
						}
					}
				}

				const wantFullPostRepairRevalidate =
					Boolean(validationResult) &&
					(INGEST_REMEDIATION_REVALIDATE || policy?.force_revalidate === true);
				const wantTargetedPostRepairRevalidate =
					Boolean(validationResult) &&
					!wantFullPostRepairRevalidate &&
					INGEST_REMEDIATION_TARGETED_REVALIDATE &&
					remediatedPositions.size > 0;

				if (wantFullPostRepairRevalidate || wantTargetedPostRepairRevalidate) {
					const validationCapRem = capIngestBatchTargetForPlan({
						stage: 'validation',
						requested: VALIDATION_BATCH_TARGET_TOKENS,
						provider: validationPlan.provider,
						model: validationPlan.model
					});
					const validationBatchesRem = buildValidationBatches(
						allClaims,
						relations,
						arguments_,
						sourceText,
						sourceMeta.title,
						validationCapRem.value
					);
					const batchesToRun = wantFullPostRepairRevalidate
						? validationBatchesRem
						: filterValidationBatchesTouchingClaimPositions(
								validationBatchesRem,
								remediatedPositions
							);
					const revalMode: 'full' | 'targeted' = wantFullPostRepairRevalidate ? 'full' : 'targeted';
					if (batchesToRun.length === 0) {
						console.warn(
							`  [WARN] Post-remediation ${revalMode} revalidation: no validation batches intersect repaired positions — skipping.`
						);
					} else {
						if (revalMode === 'targeted') {
							console.log(
								`  [INFO] Targeted post-remediation validation: ${batchesToRun.length}/${validationBatchesRem.length} batch(es), ${remediatedPositions.size} repaired position(s) (set INGEST_REMEDIATION_REVALIDATE=1 for full second pass).`
							);
						}
						const validationTracker2 = startStageUsage('validation');
						const validationPlanningContext: IngestionPlanningContext = {
							...basePlanningContext,
							claimCount: allClaims.length,
							relationCount: relations.length,
							argumentCount: arguments_.length,
							claimTextChars: allClaims.reduce((sum, c) => sum + (c.text?.length ?? 0), 0)
						};
						const validationExecCtx: ValidationBatchExecContext = {
							validationPlan,
							validationBudget,
							validationTracker: validationTracker2,
							jsonRepairPlan,
							jsonRepairBudget,
							repairTracker,
							relations,
							arguments_,
							sourceText,
							sourceTitle: sourceMeta.title,
							planningContext: validationPlanningContext
						};
						const batchOutputs2: ValidationOutput[] = [];
						const batchLabelPrefix =
							revalMode === 'full' ? 'Remediation revalidation' : 'Remediation targeted revalidate';
						for (let bi = 0; bi < batchesToRun.length; bi++) {
							const merged = await runValidationBatchWithContextSplitting(
								batchesToRun[bi]!,
								validationExecCtx,
								0,
								`${batchLabelPrefix} ${bi + 1}/${batchesToRun.length}`
							);
							if (merged) batchOutputs2.push(merged);
						}
						if (batchOutputs2.length > 0) {
							const secondPass = mergeValidationOutputs(batchOutputs2);
							const revalDiff = summarizeRemediationRevalidationDiff(
								preRemediationValidation,
								secondPass,
								{ includePerEntityRows: INGEST_REMEDIATION_REVALIDATION_DETAIL }
							);
							const revalDiffForLog: Omit<
								RemediationRevalidationDiff,
								'perClaim' | 'perRelation' | 'perArgument'
							> = {
								version: revalDiff.version,
								claims: revalDiff.claims,
								relations: revalDiff.relations,
								arguments: revalDiff.arguments
							};
							console.log(
								`  [METRIC] remediation_revalidation_mode=${JSON.stringify({
									mode: revalMode,
									batches_run: batchesToRun.length,
									batches_total: validationBatchesRem.length,
									remediated_positions: remediatedPositions.size
								})}`
							);
							console.log(
								`  [METRIC] remediation_revalidation_diff=${JSON.stringify(revalDiffForLog)}`
							);
							if (INGEST_REMEDIATION_REVALIDATION_DETAIL) {
								for (const row of revalDiff.perClaim ?? []) {
									console.log(
										`  [METRIC] remediation_revalidation_claim pos=${row.position_in_source} min=${row.min_faithfulness} s1=${row.faithfulness_pass1} s2=${row.faithfulness_pass2} lowered=${row.second_pass_lowered_min} q1=${row.quarantine_pass1} q2=${row.quarantine_pass2} q_tight=${row.quarantine_tightened_by_second}`
									);
								}
								for (const row of revalDiff.perRelation ?? []) {
									console.log(
										`  [METRIC] remediation_revalidation_relation key=${row.key} min=${row.min_validity} v1=${row.validity_pass1} v2=${row.validity_pass2} lowered=${row.second_pass_lowered_min} q_tight=${row.quarantine_tightened_by_second}`
									);
								}
								for (const row of revalDiff.perArgument ?? []) {
									console.log(
										`  [METRIC] remediation_revalidation_argument name=${JSON.stringify(row.argument_name)} min=${row.min_coherence} c1=${row.coherence_pass1} c2=${row.coherence_pass2} lowered=${row.second_pass_lowered_min} q_tight=${row.quarantine_tightened_by_second}`
									);
								}
							}
							validationResult = mergeValidationOutputs([preRemediationValidation, secondPass]);
						}
						logStageCost(
							revalMode === 'full'
								? 'Validation (remediation revalidate)'
								: 'Validation (remediation targeted revalidate)',
							validationTracker2,
							validationPlan
						);
					}
				}

				const droppedRelationEdges = droppedBefore - relations.length;
				const needsRerun = shouldRerunRelationsAfterRemediation({
					remediatedPositions,
					droppedRelationCount: droppedRelationEdges,
					claimCount: allClaims.length,
					forceEnv: INGEST_REMEDIATION_FORCE_RELATIONS_RERUN || policy?.force_relations_rerun === true,
					remediatedShareThreshold: INGEST_REMEDIATION_RERUN_SHARE
				});
				if (needsRerun) {
					console.log(
						`  [INFO] Relations+grouping rerun after remediation (upstream quality matters more than micro-tuning validation alone — ingest-validation-remediation-knobs-bml.md §6): remediated_positions=${remediatedPositions.size}/${allClaims.length} dropped_relation_edges=${droppedRelationEdges} rerun_share_threshold=${INGEST_REMEDIATION_RERUN_SHARE}`
					);
					postValidationGraphMutatedForStoreSkip = true;
					const relationsRt = startStageUsage('relations');
					const groupingRt = startStageUsage('grouping');
					let relationsBatchTargetForRemediation = RELATIONS_BATCH_TARGET_TOKENS;
					if (RELATIONS_BATCH_TARGET_TOKENS > 0) {
						const relationsAutoRem = resolveRelationsAutoBatchTarget({
							claims: allClaims,
							batchTargetFromEnv: RELATIONS_BATCH_TARGET_TOKENS,
							overlapClaims: RELATIONS_BATCH_OVERLAP_CLAIMS,
							autoTuneEnabled: ingestRelationsAutoTuneEnabled(),
							autoCapTokens: ingestRelationsAutoCapTokens(),
							largeClaimThreshold: ingestRelationsAutoLargeClaimThreshold(),
							largeTotalClaimJsonTokensThreshold: ingestRelationsAutoLargeTotalClaimJsonTokensThreshold(),
							minTargetTokens: ingestRelationsAutoMinTargetTokens()
						});
						if (relationsAutoRem.logLine) {
							console.log(`  [INFO] ${relationsAutoRem.logLine}`);
						}
						relationsBatchTargetForRemediation = relationsAutoRem.effectiveBatchTarget;
					}
					const groupingMaxOutRem = resolveGroupingMaxOutputTokens(groupingPlan);
					const groupingAutoRem = resolveGroupingAutoBatchTarget({
						claims: allClaims,
						relationCount: relations.length,
						batchTargetFromEnv: GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS,
						tokenEstimateMultiplier: GROUPING_ANTHROPIC_TOKEN_ESTIMATE_MULTIPLIER,
						outputVsInputFactor: GROUPING_OUTPUT_VS_INPUT_FACTOR,
						outputHeadroom: GROUPING_OUTPUT_HEADROOM,
						maxOutputTokens: groupingMaxOutRem,
						autoTuneEnabled: ingestGroupingAutoTuneEnabled(),
						autoCapTokens: ingestGroupingAutoCapTokens(),
						largeClaimThreshold: ingestGroupingAutoLargeClaimThreshold()
					});
					if (groupingAutoRem.logLine) {
						console.log(`  [INFO] ${groupingAutoRem.logLine}`);
					}
					const groupingCapRem = capIngestBatchTargetForPlan({
						stage: 'grouping',
						requested: groupingAutoRem.effectiveBatchTarget,
						provider: groupingPlan.provider,
						model: groupingPlan.model
					});
					const out = await rerunRelationsAndGroupingForRemediation({
						allClaims,
						relationPlan,
						groupingPlan,
						relationBudget,
						groupingBudget,
						jsonRepairPlan,
						jsonRepairBudget,
						repairTracker,
						relationsTracker: relationsRt,
						groupingTracker: groupingRt,
						basePlanningContext,
						relationsBatchTarget: relationsBatchTargetForRemediation,
						relationsOverlap: RELATIONS_BATCH_OVERLAP_CLAIMS,
						groupingBatchTarget: groupingCapRem.value,
						attachRelationMetadata,
						callStageModel,
						fixJsonWithModel,
						logStageCost,
						ingestFailOnGroupingPositionCollapse: INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE,
						saveGroupingDebugRaw,
						slug
					});
					relations = out.relations;
					arguments_ = out.arguments_;
					assertRelationIntegrity(relations, allClaims);
				}

				partial.validation = validationResult;
				partial.relations = relations;
				partial.arguments = arguments_;
				partial.embeddings = allEmbeddings;
				console.log(`  [OK] Remediation complete (${remediatedPositions.size} claim(s) repaired)`);
			} else if (shouldValidate && validationResult && policy?.skip_repair) {
				console.log('\n  [SKIP] Remediation: INGEST_REMEDIATION_POLICY_JSON skip_repair');
			}

			bumpStageMs('remediating', Date.now() - stageRemStart);
			partial.stage_completed = 'remediating';
			await savePartialResults(slug, partial);
			await updateIngestionLog(db, sourceMeta.url, {
				status: 'validating',
				stage_completed: 'remediating',
				cost_usd: parseFloat(estimateCostUsd())
			});
		}

		let skippedStoreNoGraphChanges = false;

		if (stopBeforeStore) {
			console.log(
				'\n  [PHASE] Stages 1–5 complete. Resume this source without --stop-before-store (or use admin Sync) to run Stage 6 (SurrealDB).'
			);
			console.log('[UI] Pipeline phases 1–5 finished; awaiting SurrealDB sync (Stage 6).');
			await savePartialResults(slug, partial);
			await updateIngestionLog(db, sourceMeta.url, {
				status: 'validating',
				stage_completed: 'remediating',
				cost_usd: parseFloat(estimateCostUsd())
			});
			await closeSurrealIfOpen(db);
			logIngestTimingSummary();
			process.exit(0);
		}

		if (
			ingestSkipStoreWhenNoGraphChanges() &&
			shouldValidate &&
			postValidationGraphEvaluatedForStoreSkip &&
			!postValidationGraphMutatedForStoreSkip &&
			db &&
			shouldRunStage('storing', resumeFromStage)
		) {
			await ensureDbConnected(db);
			const existingSid = await findExistingSourceRecordIdForUrl(db, sourceMeta);
			if (existingSid) {
				skippedStoreNoGraphChanges = true;
				console.log(
					'\n  [STORE] Skipping SurrealDB write: INGEST_SKIP_STORE_WHEN_NO_GRAPH_CHANGES=1, `--validate` on, post-validation graph unchanged (no relation drops, no claim text edits, no relations+grouping rerun, no post-remediation re-embed), and a `source` row already exists. Note: faithfulness-only updates (e.g. from remediation revalidation) are not written to Surreal when store is skipped.'
				);
				partial.stage_completed = 'remediating';
				partial.validation = validationResult ?? null;
				partial.relations = relations;
				partial.arguments = arguments_;
				partial.embeddings = allEmbeddings;
				await savePartialResults(slug, partial);
			}
		}

		// ═══════════════════════════════════════════════════════════════
		// STAGE 6: STORE IN SURREALDB
		// ═══════════════════════════════════════════════════════════════
		if (shouldRunStage('storing', resumeFromStage) && !skippedStoreNoGraphChanges) {
			const stageStoreStart = Date.now();
			if (!db) {
				throw new Error(
					'[INTEGRITY] Stage 6 requires SurrealDB but no connection is open. Re-run without --stop-before-store only after Surreal is reachable, or use admin “Sync to SurrealDB”.'
				);
			}
			// Orchestrator treats store as non-LLM: advance currentStageKey early so job concurrency
			// and the global ingest gate can release before slow Surreal I/O.
			console.log('[ROUTE] storing');
			// ── Pre-stage 6 health check ──────────────────────────────
			// Stages 1–5 can take 20+ minutes; verify the DB session is still
			// alive before beginning the critical write phase.
			console.log('\n  [CHECK] Verifying DB connection before store...');
			await ensureDbConnected(db);

			await updateIngestionLog(db, sourceMeta.url, { status: 'storing' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 6: STORE IN SURREALDB                             │');
			console.log('└──────────────────────────────────────────────────────────┘');

			// DB connection already established at startup — reuse it
			console.log('  [OK] Using existing SurrealDB connection');

			// 6a. Remove any existing source data for this URL (idempotent re-run safety)
			console.log('  Checking for existing source data...');
			const sourceTextSha256 = createHash('sha256').update(sourceText, 'utf8').digest('hex');
			if (ingestStoreEnsureSurrealSourceFields()) {
				try {
					await db.query(
						'DEFINE FIELD IF NOT EXISTS ingest_source_text_sha256 ON source TYPE option<string>'
					);
				} catch (e) {
					console.warn(
						'  [WARN] Could not DEFINE FIELD ingest_source_text_sha256 on source (set INGEST_STORE_RECORD_TEXT_HASH=0 to skip):',
						e instanceof Error ? e.message : String(e)
					);
				}
				try {
					await db.query(
						'DEFINE FIELD IF NOT EXISTS exclude_from_model_training ON source TYPE bool DEFAULT false'
					);
				} catch (e) {
					console.warn(
						'  [WARN] Could not DEFINE FIELD exclude_from_model_training on source:',
						e instanceof Error ? e.message : String(e)
					);
				}
			} else {
				console.log('  [OK] Skipping DEFINE FIELD on source (INGEST_STORE_ENSURE_SURREAL_SOURCE_FIELDS=0)');
			}
			const existingSources = await db.query<[{ id: string }[]]>(
				'SELECT id FROM source WHERE canonical_url_hash = $canonical_url_hash OR url = $url LIMIT 1',
				{ canonical_url_hash: sourceMeta.canonical_url_hash, url: sourceMeta.url }
			);
			const existingSourceId = Array.isArray(existingSources) && existingSources.length > 0
				? Array.isArray(existingSources[0]) ? existingSources[0][0]?.id : (existingSources[0] as any)?.id
				: null;
				if (existingSourceId && INGEST_STORE_ENFORCE_TEXT_HASH) {
					const prevHashRows = await db.query<[{ ingest_source_text_sha256?: string }[]]>(
						'SELECT ingest_source_text_sha256 FROM source WHERE id = $sid LIMIT 1',
						{ sid: existingSourceId }
					);
					const prevRow =
						Array.isArray(prevHashRows) && prevHashRows.length > 0
							? Array.isArray(prevHashRows[0])
								? prevHashRows[0][0]
								: (prevHashRows[0] as { ingest_source_text_sha256?: string })
							: null;
					const prevHash =
						prevRow && typeof prevRow === 'object' && 'ingest_source_text_sha256' in prevRow
							? (prevRow as { ingest_source_text_sha256?: string }).ingest_source_text_sha256
							: undefined;
					if (typeof prevHash === 'string' && prevHash.length > 0 && prevHash !== sourceTextSha256) {
						throw new Error(
							'[INTEGRITY] INGEST_STORE_ENFORCE_TEXT_HASH: existing source row has a different ingest_source_text_sha256 than the current source text. Resolve the mismatch before re-store.'
						);
					}
				}
				if (existingSourceId) {
					console.log(`  [CLEANUP] Removing existing source (${existingSourceId}) and its claims/arguments...`);
					await surrealStoreCleanupRemoveExistingSource(db, existingSourceId);
					console.log('  [CLEANUP] Existing data removed — proceeding with fresh store');
				} else {
					console.log('  [OK] No existing data found — fresh store');
				}

			// 6b. Create source record
			console.log('  Creating source record...');
			let surrealExcludeFromModelTraining = excludeFromModelTraining;
			if (isNeonIngestPersistenceEnabled()) {
				const neonExcluded = await getSourceTrainingGovernanceExcluded(sourceMeta.canonical_url_hash);
				surrealExcludeFromModelTraining = surrealExcludeFromModelTraining || neonExcluded;
			}
			const sourceContentFields = INGEST_STORE_RECORD_TEXT_HASH
				? `,
					ingest_source_text_sha256: $ingest_source_text_sha256`
				: '';
			const sourceRecord = await db.query<[{ id: string }[]]>(
				`CREATE source CONTENT {
					title: $title,
					author: $author,
					year: $year,
					source_type: $source_type,
					url: $url,
					canonical_url: $canonical_url,
					canonical_url_hash: $canonical_url_hash,
					visibility_scope: $visibility_scope,
					deletion_state: $deletion_state,
					ingested_at: time::now(),
					claim_count: $claim_count,
					status: $status,
					exclude_from_model_training: $exclude_from_model_training${sourceContentFields}
				}`,
				{
					title: sourceMeta.title,
					author: sourceMeta.author,
					year: sourceMeta.year ?? undefined,
					source_type: sourceMeta.source_type,
					url: sourceMeta.url,
					canonical_url: sourceMeta.canonical_url ?? undefined,
					canonical_url_hash: sourceMeta.canonical_url_hash ?? undefined,
					visibility_scope: sourceMeta.visibility_scope ?? undefined,
					deletion_state: sourceMeta.deletion_state ?? undefined,
					claim_count: allClaims.length,
					status: shouldValidate ? 'validated' : 'ingested',
					exclude_from_model_training: surrealExcludeFromModelTraining,
					...(INGEST_STORE_RECORD_TEXT_HASH ? { ingest_source_text_sha256: sourceTextSha256 } : {})
				}
			);

			const sourceId =
				Array.isArray(sourceRecord) && sourceRecord.length > 0
					? Array.isArray(sourceRecord[0])
						? sourceRecord[0][0]?.id
						: (sourceRecord[0] as any)?.id
					: null;

			if (!sourceId) {
				throw new Error('Failed to create source record — no ID returned');
				}
				console.log(`  [OK] Source record: ${sourceId}`);

				// work.source_id is SCHEMAFULL option<string> — see surrealRecordSql.ts
				const workSlug = slugifyGraphLabel(sourceMeta.canonical_url_hash || sourceMeta.url || sourceMeta.title);
				const workRecordResult = await db.query<[{ id: string }[]]>(
					`UPSERT type::record('work', $rid) CONTENT {
						title: $title,
						source_id: ${SOURCE_ID_STRING_SQL},
						source_url: $source_url,
						imported_at: time::now()
					} RETURN AFTER`,
					{
						rid: workSlug || `source_${Date.now()}`,
						title: sourceMeta.title,
						source_row_key: recordKeyForTable(sourceId, 'source'),
						source_url: sourceMeta.url
					}
				);
				const workId =
					Array.isArray(workRecordResult) && workRecordResult.length > 0
						? Array.isArray(workRecordResult[0])
							? workRecordResult[0][0]?.id
							: (workRecordResult[0] as any)?.id
						: null;
				if (workId) {
					console.log(`  [OK] Work node: ${workId}`);
				}

				// 6c. Create passage records (limited parallelism to reduce round-trip latency)
				console.log(`  Creating ${passages.length} passage records...`);
				const passageRecordIdMap: Map<string, string> = new Map();
				const PASSAGE_INSERT_CONCURRENCY = Math.max(
					1,
					Math.min(12, parseInt(process.env.INGEST_PASSAGE_INSERT_CONCURRENCY || '8', 10) || 8)
				);

				for (let i = 0; i < passages.length; i += PASSAGE_INSERT_CONCURRENCY) {
					if (i > 0 && i % 48 === 0) {
						await ensureDbConnected(db);
					}
					const chunk = passages.slice(i, i + PASSAGE_INSERT_CONCURRENCY);
					await Promise.all(
						chunk.map(async (passage) => {
							const result = await db.query<[{ id: string }[]]>(
								`CREATE passage CONTENT {
									source: $source,
									text: $text,
									summary: $summary,
									section_title: $section_title,
									order_in_source: $order_in_source,
									span_start: $span_start,
									span_end: $span_end,
									role: $role,
									role_confidence: $role_confidence,
									review_state: $review_state,
									verification_state: $verification_state,
									extractor_version: $extractor_version
								}`,
								{
									source: sourceId,
									text: passage.text,
									summary: passage.summary,
									section_title: passage.section_title ?? undefined,
									order_in_source: passage.order_in_source,
									span_start: passage.span.start,
									span_end: passage.span.end,
									role: passage.role,
									role_confidence: passage.role_confidence,
									review_state:
										passage.role_confidence < LOW_CONFIDENCE_REVIEW_THRESHOLD
											? 'needs_review'
											: 'candidate',
									verification_state: 'unverified',
									extractor_version: INGEST_EXTRACTOR_VERSION
								}
							);
							const passageRecordId =
								Array.isArray(result) && result.length > 0
									? Array.isArray(result[0])
										? result[0][0]?.id
										: (result[0] as any)?.id
									: null;
							if (passageRecordId) {
								passageRecordIdMap.set(passage.id, passageRecordId);
							}
						})
					);
				}
				console.log(`  [OK] Created ${passageRecordIdMap.size} passage records`);

				// 6d. Create claim records with embeddings
				console.log(`  Creating ${allClaims.length} claim records...`);
				const claimIdMap: Map<number, string> = new Map(); // position_in_source → claim ID
				const validationRanForPostStore = Boolean(shouldValidate && validationResult);
				let postStoreAuditCount = 0;
				const CLAIM_INSERT_CONCURRENCY = Math.max(
					1,
					Math.min(24, parseInt(process.env.INGEST_CLAIM_INSERT_CONCURRENCY || '8', 10) || 8)
				);

				for (let i = 0; i < allClaims.length; i += CLAIM_INSERT_CONCURRENCY) {
					if (i > 0 && i % 48 === 0) {
						await ensureDbConnected(db);
					}
					const chunk = allClaims.slice(i, i + CLAIM_INSERT_CONCURRENCY);
					await Promise.all(
						chunk.map(async (claim, chunkIdx) => {
							const idx = i + chunkIdx;
							const embedding = allEmbeddings[idx] || null;
							const validationClaim = validationResult?.claims?.find(
								(c) => c.position_in_source === claim.position_in_source
							);

							const faithAt80 =
								validationClaim != null && validationClaim.faithfulness_score >= 80;
							const postStore = resolvePostStoreClaimReviewState({
								baseReviewState: claim.review_state as PostStoreReviewState,
								faithfulnessScore: validationRanForPostStore
									? validationClaim?.faithfulness_score
									: undefined,
								threshold: INGEST_POST_STORE_LOW_VALIDATION_THRESHOLD,
								sampleRate: INGEST_POST_STORE_LOW_VALIDATION_SAMPLE_RATE,
								slug,
								position: claim.position_in_source
							});
							if (postStore.auditApplied) postStoreAuditCount += 1;
							const effectiveVerificationState = resolvePostStoreVerificationState({
								baseVerificationState: claim.verification_state,
								faithfulnessAtLeast80: faithAt80,
								auditApplied: postStore.auditApplied,
								flagOnLowValidation: INGEST_POST_STORE_FLAG_VERIFICATION_LOW_VALIDATION
							});

							const result = await db.query<[{ id: string }[]]>(
								`CREATE claim CONTENT {
							text: $text,
							claim_type: $claim_type,
							domain: $domain,
							source: $source,
							passage: $passage,
							passage_order: $passage_order,
							passage_role: $passage_role,
							section_context: $section_context,
							position_in_source: $position_in_source,
							source_span_start: $source_span_start,
							source_span_end: $source_span_end,
							confidence: $confidence,
							embedding: $embedding,
							validation_score: $validation_score,
							claim_origin: $claim_origin,
							subdomain: $subdomain,
							thinker: $thinker,
							tradition: $tradition,
							era: $era,
							claim_scope: $claim_scope,
							attributed_to: $attributed_to,
							concept_tags: $concept_tags,
							review_state: $review_state,
							verification_state: $verification_state,
							extractor_version: $extractor_version,
							contested_terms: $contested_terms
						}`,
								{
									text: claim.text,
									claim_type: claim.claim_type,
									domain: domainOverride ?? claim.domain,
									source: sourceId,
									passage: claim.passage_id
										? passageRecordIdMap.get(claim.passage_id) ?? undefined
										: undefined,
									passage_order: claim.passage_order ?? undefined,
									passage_role: claim.passage_role ?? undefined,
									section_context: claim.section_context ?? undefined,
									position_in_source: claim.position_in_source,
									source_span_start: claim.source_span_start ?? undefined,
									source_span_end: claim.source_span_end ?? undefined,
									confidence: claim.confidence,
									embedding: embedding,
									validation_score: validationClaim?.faithfulness_score ?? undefined,
									claim_origin: claim.claim_origin,
									subdomain: claim.subdomain ?? undefined,
									thinker: claim.thinker ?? undefined,
									tradition: claim.tradition ?? undefined,
									era: claim.era ?? undefined,
									claim_scope: claim.claim_scope,
									attributed_to: claim.attributed_to.length > 0 ? claim.attributed_to : undefined,
									concept_tags: claim.concept_tags.length > 0 ? claim.concept_tags : undefined,
									review_state: postStore.reviewState,
									verification_state: effectiveVerificationState,
									extractor_version: claim.extractor_version,
									contested_terms: claim.contested_terms.length > 0 ? claim.contested_terms : undefined
								}
							);

							const claimId =
								Array.isArray(result) && result.length > 0
									? Array.isArray(result[0])
										? result[0][0]?.id
										: (result[0] as any)?.id
									: null;

							if (claimId) {
								claimIdMap.set(claim.position_in_source, claimId);
							}
						})
					);

					const done = Math.min(i + chunk.length, allClaims.length);
					if (done % 20 === 0 || done === allClaims.length) {
						process.stdout.write(`\r  [CLAIMS] ${done}/${allClaims.length}`);
					}
				}
				console.log('');
				console.log(`  [OK] Created ${claimIdMap.size} claim records`);
				if (
					postStoreAuditCount > 0 &&
					INGEST_POST_STORE_LOW_VALIDATION_THRESHOLD != null
				) {
					const pct =
						INGEST_POST_STORE_LOW_VALIDATION_SAMPLE_RATE < 1
							? ` (sampled ${(INGEST_POST_STORE_LOW_VALIDATION_SAMPLE_RATE * 100).toFixed(0)}%)`
							: '';
					console.log(
						`  [POST_STORE_AUDIT] ${postStoreAuditCount} claim(s) → needs_review (faithfulness < ${INGEST_POST_STORE_LOW_VALIDATION_THRESHOLD}${pct}). Admin quarantine queue: GET /api/admin/quarantine/queue`
					);
				}

				// 6d2. Connect claims to subject/period/work graph nodes (bounded parallelism +
				// subject/period slug cache — sequential per-claim round-trips dominated wall time here).
				const GRAPH_JOIN_CONCURRENCY = Math.max(
					1,
					Math.min(
						16,
						parseInt(process.env.INGEST_GRAPH_JOIN_CONCURRENCY || '8', 10) || 8
					)
				);
				const subjectSlugByDomain = new Map<string, string | null>();
				const periodSlugByEra = new Map<string, string | null>();
				let claimGraphEdges = 0;
				const graphJoinProgress = allClaims.length >= 24;

				async function subjectSlugFor(domainRaw: string): Promise<string | null> {
					const k = domainRaw.trim();
					if (!k) return null;
					const hit = subjectSlugByDomain.get(k);
					if (hit !== undefined) return hit;
					const slug = await upsertGraphNamedNode(db, 'subject', k);
					subjectSlugByDomain.set(k, slug);
					return slug;
				}
				async function periodSlugFor(eraRaw: string): Promise<string | null> {
					const k = eraRaw.trim();
					if (!k) return null;
					const hit = periodSlugByEra.get(k);
					if (hit !== undefined) return hit;
					const slug = await upsertGraphNamedNode(db, 'period', k);
					periodSlugByEra.set(k, slug);
					return slug;
				}

				for (let gi = 0; gi < allClaims.length; gi += GRAPH_JOIN_CONCURRENCY) {
					const chunk = allClaims.slice(gi, gi + GRAPH_JOIN_CONCURRENCY);
					const deltas = await Promise.all(
						chunk.map(async (claim) => {
							let local = 0;
							const claimId = claimIdMap.get(claim.position_in_source);
							if (!claimId) return 0;

							if (claim.domain && claim.domain.trim()) {
								const subjectSlug = await subjectSlugFor(claim.domain);
								if (subjectSlug) {
									const inserted = await relateGraphIfAbsent(
										db,
										'about_subject',
										claimId,
										`subject:${subjectSlug}`,
										`SET confidence = 0.95, imported_at = time::now()`
									);
									if (inserted) local += 1;
								}
							}
							if (claim.era && claim.era.trim()) {
								const periodSlug = await periodSlugFor(claim.era);
								if (periodSlug) {
									const inserted = await relateGraphIfAbsent(
										db,
										'in_period',
										claimId,
										`period:${periodSlug}`,
										`SET confidence = 0.9, imported_at = time::now()`
									);
									if (inserted) local += 1;
								}
							}
							if (workId) {
								const inserted = await relateGraphIfAbsent(
									db,
									'cites_work',
									claimId,
									workId,
									`SET confidence = 0.8, imported_at = time::now()`
								);
								if (inserted) local += 1;
							}
							return local;
						})
					);
					claimGraphEdges += deltas.reduce((a, b) => a + b, 0);
					const done = Math.min(gi + chunk.length, allClaims.length);
					if (graphJoinProgress && (done % 24 === 0 || done === allClaims.length)) {
						process.stdout.write(`\r  [GRAPH_JOIN] claims ${done}/${allClaims.length}`);
					}
				}
				if (graphJoinProgress) console.log('');
				if (claimGraphEdges > 0) {
					console.log(`  [OK] Claim graph joins created: ${claimGraphEdges}`);
				}

				// 6e. Create relation records
			console.log(`  Creating ${relations.length} relation records...`);
			let relationsCreated = 0;
			const relationProgress = relations.length >= 30;
			const RELATE_STORE_CONCURRENCY = Math.max(
				1,
				Math.min(
					32,
					parseInt(process.env.INGEST_RELATE_STORE_CONCURRENCY || '8', 10) || 8
				)
			);

			async function createOneRelationRecord(rel: (typeof relations)[number]): Promise<boolean> {
				const fromId = claimIdMap.get(rel.from_position);
				const toId = claimIdMap.get(rel.to_position);

				if (!fromId || !toId) {
					console.warn(
						`  [SKIP] Relation ${rel.from_position}->${rel.to_position}: missing claim ID`
					);
					return false;
				}

				try {
					let relQuery = `RELATE $from->${rel.relation_type}->$to`;
					const assignments = [
						'relation_confidence = $relation_confidence',
						'evidence_passages = $evidence_passages',
						'relation_inference_mode = $relation_inference_mode',
						'verification_state = $verification_state',
						'review_state = $review_state',
						'extractor_version = $extractor_version'
					];
					const vars: Record<string, unknown> = {
						from: fromId,
						to: toId,
						relation_confidence: rel.relation_confidence,
						evidence_passages: rel.evidence_passage_ids
							.map((passageId) => passageRecordIdMap.get(passageId))
							.filter((value): value is string => Boolean(value)),
						relation_inference_mode: rel.relation_inference_mode,
						verification_state: rel.verification_state,
						review_state: rel.review_state,
						extractor_version: rel.extractor_version
					};

					switch (rel.relation_type) {
						case 'supports':
						case 'contradicts': {
							assignments.unshift('strength = $strength');
							if (rel.note) assignments.push('note = $note');
							vars.strength = rel.strength;
							if (rel.note) vars.note = rel.note;
							break;
						}
						case 'depends_on': {
							const necessityMap: Record<string, string> = {
								strong: 'essential',
								moderate: 'supporting',
								weak: 'contextual'
							};
							assignments.unshift('necessity = $necessity');
							vars.necessity = necessityMap[rel.strength] || 'supporting';
							break;
						}
						case 'responds_to': {
							const responseMap: Record<string, string> = {
								strong: 'direct_rebuttal',
								moderate: 'undermining',
								weak: 'concession'
							};
							assignments.unshift('response_type = $response_type');
							vars.response_type = responseMap[rel.strength] || 'refinement';
							break;
						}
						case 'refines': {
							const refinementMap: Record<string, string> = {
								strong: 'strengthens',
								moderate: 'clarifies',
								weak: 'qualifies'
							};
							assignments.unshift('refinement_type = $refinement_type');
							vars.refinement_type = refinementMap[rel.strength] || 'clarifies';
							break;
						}
						case 'exemplifies': {
							if (rel.note) {
								assignments.push('note = $note');
								vars.note = rel.note;
							}
							break;
						}
						case 'defines': {
							if (rel.note) {
								assignments.push('note = $note');
								vars.note = rel.note;
							}
							break;
						}
						case 'qualifies': {
							const qualificationMap: Record<string, string> = {
								strong: 'restrictive',
								moderate: 'conditional',
								weak: 'clarifying'
							};
							assignments.unshift('qualification_type = $qualification_type');
							vars.qualification_type = qualificationMap[rel.strength] || 'conditional';
							if (rel.note) {
								assignments.push('note = $note');
								vars.note = rel.note;
							}
							break;
						}
						default:
							break;
					}

					relQuery += ` SET ${assignments.join(', ')}`;
					await db.query(relQuery, vars);
					return true;
				} catch (error) {
					console.warn(
						`  [SKIP] Failed to create relation ${rel.relation_type}: ${error instanceof Error ? error.message : String(error)}`
					);
					return false;
				}
			}

			for (let ri = 0; ri < relations.length; ri += RELATE_STORE_CONCURRENCY) {
				const chunk = relations.slice(ri, ri + RELATE_STORE_CONCURRENCY);
				if (relationProgress) {
					const done = Math.min(ri + chunk.length, relations.length);
					process.stdout.write(`\r  [RELATIONS] ${done}/${relations.length}`);
				}
				const chunkResults = await Promise.all(chunk.map((rel) => createOneRelationRecord(rel)));
				relationsCreated += chunkResults.filter(Boolean).length;
			}
			if (relationProgress) console.log('');
			console.log(`  [OK] Created ${relationsCreated} relation records`);

				// 6f. Create argument records and part_of relations
			console.log(`  Creating ${arguments_.length} argument records...`);
			let argumentsCreated = 0;
			let partOfCreated = 0;

			for (const arg of arguments_) {
				try {
					const argResult = await db.query<[{ id: string }[]]>(
						`CREATE argument CONTENT {
							name: $name,
							summary: $summary,
							tradition: $tradition,
							domain: $domain,
							source: $source
						}`,
						{
							name: arg.name,
							summary: arg.summary,
							tradition: arg.tradition ?? undefined,
							domain: arg.domain,
							source: sourceId
						}
					);

					const argId =
						Array.isArray(argResult) && argResult.length > 0
							? Array.isArray(argResult[0])
								? argResult[0][0]?.id
								: (argResult[0] as any)?.id
							: null;

					if (!argId) {
						console.warn(`  [SKIP] No ID returned for argument: ${arg.name}`);
						continue;
					}

					argumentsCreated++;

					// Create part_of relations for claims in this argument
					for (const claimRef of arg.claims) {
						const claimId = claimIdMap.get(claimRef.position_in_source);
						if (!claimId) continue;

						try {
							await db.query(
								`RELATE $from->part_of->$to SET role = $role, position = $position`,
								{
									from: claimId,
									to: argId,
									role: claimRef.role,
									position: claimRef.position_in_source
								}
							);
							partOfCreated++;
						} catch {
							// Silently skip failed part_of relations
						}
					}
				} catch (error) {
					console.warn(
						`  [SKIP] Failed to create argument "${arg.name}": ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
			console.log(`  [OK] Created ${argumentsCreated} argument records`);
			console.log(`  [OK] Created ${partOfCreated} part_of relations`);

			// 6f. Update source record
			await db.query(`UPDATE $source SET claim_count = $count, status = $status`, {
				source: sourceId,
				count: allClaims.length,
				status: shouldValidate ? 'validated' : 'ingested'
			});
			console.log('  [OK] Source record updated');

			// 6g. Ingestion-time thinker identity resolution and authored linking.
			try {
				const identity = await runThinkerIdentityLinking({
					db,
					sourceId,
					sourceMeta,
					claims: allClaims
				});
				console.log(
					`  [OK] Thinker linking: authored=${identity.authoredInserted}, queued=${identity.queued}, ambiguous=${identity.skippedAmbiguous}`
				);

				if (workId) {
					const authoredEdges = await db.query<{ in?: unknown }[][]>(
						`SELECT in FROM authored WHERE out = $source`,
						{ source: sourceId }
					);
					let authoredWorkEdges = 0;
					for (const edge of authoredEdges?.[0] ?? []) {
						const inField = edge.in;
						let thinkerIdRaw = '';
						if (typeof inField === 'string') {
							thinkerIdRaw = inField.trim();
						} else if (inField && typeof inField === 'object') {
							const o = inField as { tb?: unknown; id?: unknown };
							if (typeof o.tb === 'string' && o.id !== undefined) {
								thinkerIdRaw = toSurrealRecordIdStr(inField).trim();
							} else if (typeof o.id === 'string') {
								thinkerIdRaw = o.id.trim();
							}
						}
						const thinkerId = normalizeBareWikidataQidToThinkerRecordId(thinkerIdRaw);
						if (!thinkerId) continue;
						const inserted = await relateGraphIfAbsent(
							db,
							'authored_work',
							thinkerId,
							workId,
							`SET confidence = 0.85, imported_at = time::now()`
						);
						if (inserted) authoredWorkEdges += 1;
					}
					if (authoredWorkEdges > 0) {
						console.log(`  [OK] Authored-work links created: ${authoredWorkEdges}`);
					}
				}
			} catch (identityError) {
				console.warn(
					`  [WARN] Thinker identity linking failed: ${
						identityError instanceof Error ? identityError.message : String(identityError)
					}`
				);
			}

			// ── Post-store verification ───────────────────────────────
			// Query DB to confirm expected counts are actually stored.
				console.log('  Verifying stored data...');
				const verifyPassageResult = await db.query<[{ count: number }[]]>(
					`SELECT count() AS count FROM passage WHERE source = $sid GROUP ALL`,
					{ sid: sourceId }
				);
				const verifyClaimResult = await db.query<[{ count: number }[]]>(
					`SELECT count() AS count FROM claim WHERE source = $sid GROUP ALL`,
					{ sid: sourceId }
			);
			const verifyArgResult = await db.query<[{ count: number }[]]>(
				`SELECT count() AS count FROM argument WHERE source = $sid GROUP ALL`,
				{ sid: sourceId }
			);
				const storedClaims =
					Array.isArray(verifyClaimResult?.[0]) ? (verifyClaimResult[0][0]?.count ?? 0) : 0;
				const storedPassages =
					Array.isArray(verifyPassageResult?.[0]) ? (verifyPassageResult[0][0]?.count ?? 0) : 0;
				const storedArgs =
					Array.isArray(verifyArgResult?.[0]) ? (verifyArgResult[0][0]?.count ?? 0) : 0;

				if (storedPassages !== passageRecordIdMap.size) {
					console.warn(
						`  [WARN] Passage count mismatch: expected ${passageRecordIdMap.size} in DB, found ${storedPassages}`
					);
				} else {
					console.log(`  [OK] Verified: ${storedPassages} passages in DB`);
				}
				if (storedClaims !== claimIdMap.size) {
					console.warn(
						`  [WARN] Claim count mismatch: expected ${claimIdMap.size} in DB, found ${storedClaims}`
				);
			} else {
				console.log(`  [OK] Verified: ${storedClaims} claims in DB`);
			}
			if (storedArgs !== argumentsCreated) {
				console.warn(
					`  [WARN] Argument count mismatch: expected ${argumentsCreated} in DB, found ${storedArgs}`
				);
			} else {
				console.log(`  [OK] Verified: ${storedArgs} arguments in DB`);
			}

			partial.stage_completed = 'stored';
			await savePartialResults(slug, partial);
			if (activeIngestTiming) {
				const storeMs = Date.now() - stageStoreStart;
				activeIngestTiming.store_wall_ms += storeMs;
				bumpStageMs('storing', storeMs);
			}
		} else if (skippedStoreNoGraphChanges) {
			console.log(
				'  [SKIP] Stage 6: SurrealDB store (INGEST_SKIP_STORE_WHEN_NO_GRAPH_CHANGES=1; no graph mutations after validation)\n'
			);
		} else {
			console.log('  [SKIP] Stage 6: Storage (already completed)\n');
		}

		// ═══════════════════════════════════════════════════════════════
		// MARK COMPLETE IN INGESTION LOG
		// ═══════════════════════════════════════════════════════════════
		const validationAvg = validationResult?.claims?.length
			? Math.round(
					(validationResult.claims.reduce((a, b) => a + b.faithfulness_score, 0) /
						validationResult.claims.length)
				)
			: null;

		if (isNeonIngestPersistenceEnabled()) {
			try {
				await upsertSourceTrainingGovernanceOnIngestComplete({
					canonicalUrlHash: sourceMeta.canonical_url_hash,
					sourceUrl: sourceMeta.url,
					excludeFromModelTraining: excludeFromModelTraining
				});
			} catch (governanceError) {
				console.warn(
					`  [WARN] Neon source_training_governance upsert failed: ${
						governanceError instanceof Error ? governanceError.message : String(governanceError)
					}`
				);
			}
		}

		if (skippedStoreNoGraphChanges) {
			await updateIngestionLog(db, sourceMeta.url, {
				status: 'validating',
				stage_completed: 'remediating',
				claims_extracted: allClaims.length,
				relations_extracted: relations.length,
				arguments_grouped: arguments_.length,
				validation_score: validationAvg ?? undefined,
				cost_usd: parseFloat(estimateCostUsd()),
				completed_at: new Date()
			});
		} else {
			await updateIngestionLog(db, sourceMeta.url, {
				status: 'complete',
				stage_completed: 'storing',
				claims_extracted: allClaims.length,
				relations_extracted: relations.length,
				arguments_grouped: arguments_.length,
				validation_score: validationAvg ?? undefined,
				cost_usd: parseFloat(estimateCostUsd()),
				completed_at: new Date()
			});
		}

		await closeSurrealIfOpen(db);
		console.log('  [OK] Database connection closed');

		// ═══════════════════════════════════════════════════════════════
		// SUMMARY
		// ═══════════════════════════════════════════════════════════════
		console.log('\n╔══════════════════════════════════════════════════════════════╗');
		console.log('║                   INGESTION COMPLETE                        ║');
		console.log('╠══════════════════════════════════════════════════════════════╣');
		console.log(`║  Source:           ${sourceMeta.title.substring(0, 40).padEnd(40)} ║`);
		console.log(`║  Claims:           ${String(allClaims.length).padEnd(40)} ║`);
		console.log(`║  Relations:        ${String(relations.length).padEnd(40)} ║`);
		console.log(`║  Arguments:        ${String(arguments_.length).padEnd(40)} ║`);
		console.log(`║  Embeddings:       ${String(allEmbeddings.length).padEnd(40)} ║`);
		console.log(
			`║  Validation score: ${(validationAvg !== null ? `${validationAvg}/100` : 'skipped').padEnd(40)} ║`
		);
		if (skippedStoreNoGraphChanges) {
			console.log(
				`║  Surreal store:    ${'skipped (no graph changes)'.padEnd(40)} ║`
			);
		}
		console.log('╠══════════════════════════════════════════════════════════════╣');
		console.log(
			`║  Reasoning tokens: ${`${costs.totalInputTokens.toLocaleString()} in / ${costs.totalOutputTokens.toLocaleString()} out`.padEnd(40)} ║`
		);
		console.log(
			`║  Vertex chars:     ${costs.vertexChars.toLocaleString().padEnd(40)} ║`
		);
		console.log(
			`║  Estimated cost:   £${estimateCost()} ($${estimateCostUsd()})${' '.repeat(Math.max(0, 37 - estimateCost().length - estimateCostUsd().length))} ║`
		);
		console.log('╚══════════════════════════════════════════════════════════════╝');
		console.log('');

		if (skippedStoreNoGraphChanges && activeIngestTiming) {
			activeIngestTiming.skipped_surreal_store_no_graph_changes = true;
			activeIngestTiming.skipped_surreal_store_reason = 'post_validation_graph_unchanged_existing_source';
		}

		logIngestTimingSummary();
		process.exit(0);
	} catch (error) {
		logIngestTimingSummary();
		console.error('\n[FATAL ERROR]', error instanceof Error ? error.message : String(error));
		if (error instanceof Error && error.stack) {
			console.error(error.stack);
		}

		// Update ingestion log with failure
		try {
			await updateIngestionLog(db, sourceMeta.url, {
				status: 'failed',
				error_message: error instanceof Error ? error.message : String(error),
				cost_usd: parseFloat(estimateCostUsd())
			});
		} catch {
			// If we can't update the log, we still want to save partial results
		}

		await savePartialResults(slug, partial);

		await closeSurrealIfOpen(db);

		process.exit(1);
	}
}

main();
