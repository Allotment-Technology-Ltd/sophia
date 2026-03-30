import { estimateCost, defaultProviders } from '@restormel/keys';
import type { AAIFLatency, AAIFRequest } from '@restormel/aaif';
import type { ModelProvider } from '@restormel/contracts/providers';
import type { RestormelFallbackCandidate } from '../restormel.js';
import {
  CANONICAL_INGESTION_PRIMARY_MODELS,
  type IngestionLlmStageKey
} from '../../ingestionCanonicalPipeline.js';
import { EMBEDDING_MODEL } from '../embeddings.js';
import {
  resolveExtractionModelRoute,
  resolveReasoningModelRoute,
  type ReasoningModelRoute
} from '../vertex.js';
export type IngestionStage =
  | 'extraction'
  | 'relations'
  | 'grouping'
  | 'validation'
  | 'embedding'
  | 'json_repair';

export type IngestProviderPreference = 'auto' | 'vertex' | 'anthropic';

export interface IngestionPlanningContext {
  sourceTitle: string;
  sourceType?: string;
  estimatedTokens: number;
  sourceLengthChars?: number;
  claimCount?: number;
  relationCount?: number;
  argumentCount?: number;
  claimTextChars?: number;
  preferredProvider?: IngestProviderPreference;
}

export interface IngestionStagePlan {
  stage: IngestionStage;
  request: AAIFRequest;
  routeId?: string;
  provider: string;
  model: string;
  estimatedCostUsd: number;
  routingReason: string;
  routingSource: 'restormel' | 'requested' | 'degraded_default';
  selectedStepId?: string | null;
  selectedOrderIndex?: number | null;
  switchReasonCode?: string | null;
  matchedCriteria?: unknown;
  fallbackCandidates?: RestormelFallbackCandidate[] | null;
  route?: ReasoningModelRoute;
}

/** Pre-ingest HTTP + parse workload (not an LLM route); listed separately from extraction in cost views. */
export type PipelinePhaseStage = 'fetch' | IngestionStage;

export interface IngestionStageUsageEstimate {
  stage: PipelinePhaseStage;
  latency: AAIFLatency;
  complexity: 'low' | 'medium' | 'high';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}


function isBookSource(st?: string): boolean {
  return st === 'book';
}

function isEncyclopediaSource(st?: string): boolean {
  return st === 'sep_entry' || st === 'iep_entry';
}

function isPaperSource(st?: string): boolean {
  return st === 'paper' || st === 'journal_article';
}

function claimCountEstimate(context: IngestionPlanningContext): number {
  if (typeof context.claimCount === 'number' && context.claimCount > 0) {
    return context.claimCount;
  }
  return Math.max(6, Math.ceil(context.estimatedTokens / 100));
}

function relationCountEstimate(context: IngestionPlanningContext): number {
  if (typeof context.relationCount === 'number' && context.relationCount > 0) {
    return context.relationCount;
  }
  return Math.max(4, Math.ceil(claimCountEstimate(context) * 0.8));
}

function argumentCountEstimate(context: IngestionPlanningContext): number {
  if (typeof context.argumentCount === 'number' && context.argumentCount > 0) {
    return context.argumentCount;
  }
  return Math.max(2, Math.ceil(claimCountEstimate(context) / 8));
}

function stageLatency(stage: IngestionStage, context: IngestionPlanningContext): AAIFLatency {
  if (stage === 'json_repair') return 'low';
  if (stage === 'embedding') return 'low';
  const tokens = context.estimatedTokens;
  const claims = claimCountEstimate(context);
  if (stage === 'grouping') {
    // Single production profile: keep grouping on balanced routing depth unless the source is very large.
    if (tokens > 22_000 || claims > 70) return 'high';
    return 'balanced';
  }
  if (stage === 'validation') {
    if (isBookSource(context.sourceType) && claims > 55) return 'high';
    return claims > 60 ? 'high' : 'balanced';
  }
  if (stage === 'extraction') {
    if (isBookSource(context.sourceType)) {
      return tokens > 10_000 ? 'balanced' : 'low';
    }
    return tokens > 18_000 ? 'balanced' : 'low';
  }
  return 'balanced';
}

function stagePass(stage: Exclude<IngestionStage, 'embedding'>): 'analysis' | 'synthesis' | 'verification' | 'generic' {
  if (stage === 'grouping') return 'synthesis';
  if (stage === 'validation') return 'verification';
  if (stage === 'json_repair') return 'generic';
  return 'analysis';
}

function latencyToDepth(latency: AAIFLatency): 'quick' | 'standard' | 'deep' {
  if (latency === 'low') return 'quick';
  if (latency === 'high') return 'deep';
  return 'standard';
}

const PIN_ENV_SUFFIX: Record<Exclude<IngestionStage, 'embedding'>, string> = {
  extraction: 'EXTRACTION',
  relations: 'RELATIONS',
  grouping: 'GROUPING',
  validation: 'VALIDATION',
  json_repair: 'JSON_REPAIR'
};

/** Admin-spawned workers set `INGEST_PIN_PROVIDER_*` + `INGEST_PIN_MODEL_*` (see `modelChainLabelsToEnv`). */
function readPinnedModel(
  stage: IngestionStage,
  preferred: IngestProviderPreference
): { provider?: ModelProvider; modelId?: string } {
  if (stage === 'embedding') return {};
  const suffix = PIN_ENV_SUFFIX[stage];
  const modelId = process.env[`INGEST_PIN_MODEL_${suffix}`]?.trim();
  const provider = process.env[`INGEST_PIN_PROVIDER_${suffix}`]?.trim().toLowerCase() as ModelProvider | undefined;
  if (modelId && provider) return { provider, modelId };

  const disableCanonical = ['1', 'true', 'yes'].includes(
    (process.env.INGEST_DISABLE_CANONICAL_DEFAULTS ?? '').trim().toLowerCase()
  );
  if (disableCanonical || preferred !== 'auto') return {};

  const canon = CANONICAL_INGESTION_PRIMARY_MODELS[stage as IngestionLlmStageKey];
  if (canon) return { provider: canon.provider, modelId: canon.modelId };
  return {};
}

/**
 * Optional env pins: when set, POST /resolve includes routeId (only that route is considered).
 * When unset, resolve omits routeId; Restormel picks a published route by workload + stage
 * (dedicated ingestion_<substage> first, then shared ingestion with empty stage). Keys ≥0.2.11.
 */
function stageRouteBindingFromEnv(stage: IngestionStage): { routeId?: string } {
  if (stage === 'validation') {
    const dedicated =
      process.env.RESTORMEL_INGEST_VALIDATION_ROUTE_ID?.trim() ||
      process.env.RESTORMEL_VERIFY_ROUTE_ID?.trim();
    if (dedicated) {
      return { routeId: dedicated };
    }

    const shared =
      process.env.RESTORMEL_INGEST_ROUTE_ID?.trim() ||
      process.env.RESTORMEL_ANALYSE_ROUTE_ID?.trim();
    return shared ? { routeId: shared } : {};
  }

  const dedicated = process.env[`RESTORMEL_INGEST_${stage.toUpperCase()}_ROUTE_ID`]?.trim();
  if (dedicated) {
    return { routeId: dedicated };
  }

  const shared =
    process.env.RESTORMEL_INGEST_ROUTE_ID?.trim() ||
    process.env.RESTORMEL_ANALYSE_ROUTE_ID?.trim();
  return shared ? { routeId: shared } : {};
}

function buildStageRestormelContext(options: {
  stage: IngestionStage;
  task: AAIFRequest['task'];
  estimatedInputTokens: number;
  estimatedInputChars: number;
  complexity: 'low' | 'medium' | 'high';
  constraints: AAIFRequest['constraints'];
}) {
  return {
    workload: 'ingestion' as const,
    stage: `ingestion_${options.stage}`,
    task: options.task,
    attempt: 1,
    estimatedInputTokens: options.estimatedInputTokens,
    estimatedInputChars: options.estimatedInputChars,
    complexity: options.complexity,
    constraints: options.constraints
  };
}

function stageMaxCost(stage: IngestionStage): number | undefined {
  const upper = stage.toUpperCase();
  const raw = process.env[`INGEST_STAGE_${upper}_MAX_USD`];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function buildStageRequest(stage: IngestionStage, context: IngestionPlanningContext): AAIFRequest {
  const claims = claimCountEstimate(context);
  const relations = relationCountEstimate(context);
  const argumentsCount = argumentCountEstimate(context);
  const latency = stageLatency(stage, context);
  const task = stage === 'embedding' ? 'embedding' : 'completion';
  const input =
    stage === 'embedding'
      ? `Plan embedding for ${claims} extracted claims from "${context.sourceTitle}" (${context.sourceType ?? 'source'}).`
      : `Plan SOPHIA ingestion stage "${stage}" for "${context.sourceTitle}" (${context.sourceType ?? 'source'}) with ~${context.estimatedTokens} source tokens, ${claims} claims, ${relations} relations, and ${argumentsCount} grouped arguments.`;

  return {
    input,
    task,
    constraints: {
      latency,
      maxCost: stageMaxCost(stage)
    }
  };
}

function estimateStageUsage(stage: IngestionStage, context: IngestionPlanningContext): {
  inputTokens: number;
  outputTokens: number;
} {
  const claims = claimCountEstimate(context);
  const relations = relationCountEstimate(context);
  const argumentsCount = argumentCountEstimate(context);

  switch (stage) {
    case 'extraction':
      return {
        inputTokens: Math.ceil(context.estimatedTokens + 1_200),
        outputTokens: Math.max(700, claims * 120)
      };
    case 'relations':
      return {
        inputTokens: Math.max(1_200, claims * 140),
        outputTokens: Math.max(400, relations * 28)
      };
    case 'grouping':
      return {
        inputTokens: Math.max(1_800, claims * 130 + relations * 45),
        outputTokens: Math.max(900, argumentsCount * 260)
      };
    case 'validation':
      return {
        inputTokens: Math.max(2_000, context.estimatedTokens + claims * 90 + relations * 40),
        outputTokens: Math.max(700, claims * 32)
      };
    case 'json_repair':
      return {
        inputTokens: 1_400,
        outputTokens: 600
      };
    case 'embedding':
      // Embedding cost should scale with the amount of claim text that will be vectorized.
      // Use measured claim text volume when available, otherwise derive a conservative estimate.
      // Average claim length heuristic: ~280 chars (~70 tokens) per claim.
      const claimTextChars =
        typeof context.claimTextChars === 'number' && context.claimTextChars > 0
          ? context.claimTextChars
          : claims * 280;
      return {
        inputTokens: Math.max(200, Math.ceil(claimTextChars / 4)),
        outputTokens: 0
      };
  }
}

export function buildIngestionStageUsageEstimates(
  context: IngestionPlanningContext
): IngestionStageUsageEstimate[] {
  const stages: IngestionStage[] = [
    'extraction',
    'relations',
    'grouping',
    'validation',
    'embedding',
    'json_repair'
  ];
  // Fetch is HTTP + HTML/text normalization only — no Restormel LLM route. Token count is source-volume
  // (for sizing); extraction below keeps the full LLM input estimate for claim extraction.
  const fetchTokens = Math.max(1, Math.ceil(context.estimatedTokens));
  const fetchRow: IngestionStageUsageEstimate = {
    stage: 'fetch',
    latency: 'low',
    complexity: 'low',
    inputTokens: fetchTokens,
    outputTokens: 0,
    totalTokens: fetchTokens
  };

  const rest = stages.map((stage) => {
    const usage = estimateStageUsage(stage, context);
    const latency = stageLatency(stage, context);
    const complexity: 'low' | 'medium' | 'high' =
      latency === 'high' ? 'high' : latency === 'balanced' ? 'medium' : 'low';
    return {
      stage,
      latency,
      complexity,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens
    };
  });

  return [fetchRow, ...rest];
}

function estimateReasoningCostUsd(route: ReasoningModelRoute, inputTokens: number, outputTokens: number): number {
  const estimate = estimateCost(route.modelId, defaultProviders);
  if (!estimate) return 0;
  return (
    ((estimate.inputPerMillion ?? 0) * inputTokens + (estimate.outputPerMillion ?? 0) * outputTokens) /
    1_000_000
  );
}

function estimateEmbeddingCostUsd(context: IngestionPlanningContext): number {
  const chars =
    typeof context.claimTextChars === 'number' && context.claimTextChars > 0
      ? context.claimTextChars
      : claimCountEstimate(context) * 300;
  return (chars / 1_000_000) * 0.025;
}

export async function planIngestionStage(
  stage: IngestionStage,
  context: IngestionPlanningContext
): Promise<IngestionStagePlan> {
  const request = buildStageRequest(stage, context);

  if (stage === 'embedding') {
    return {
      stage,
      request,
      routeId: undefined,
      provider: 'vertex',
      model: EMBEDDING_MODEL,
      estimatedCostUsd: estimateEmbeddingCostUsd(context),
      routingSource: 'requested',
      selectedStepId: null,
      selectedOrderIndex: null,
      switchReasonCode: null,
      matchedCriteria: null,
      fallbackCandidates: null,
      routingReason:
        'Sophia currently executes ingestion embeddings on the Vertex embedding pipeline because Restormel execution routing for embeddings is not exposed in the published runtime.'
    };
  }

  const routeIdForResolve = stageRouteBindingFromEnv(stage).routeId?.trim() || undefined;

  const pin = readPinnedModel(stage, context.preferredProvider ?? 'auto');
  const requestedProvider = (pin.provider ?? context.preferredProvider ?? 'auto') as ModelProvider;
  const requestedModelId = pin.modelId;
  const routeIdForLog = routeIdForResolve ? '(bound)' : '(none)';
  if (process.env.INGEST_LOG_PINS === '1' || process.env.INGEST_LOG_PINS === 'true') {
    console.log(
      `[INGEST_PINS] plan stage=${stage} pin_provider=${pin.provider ?? '—'} pin_model=${pin.modelId ?? '—'} preferred=${String(context.preferredProvider ?? 'auto')} restormel_route_id=${routeIdForLog}`
    );
  }
  const route =
    stage === 'extraction'
      ? await resolveExtractionModelRoute({
          requestedProvider,
          requestedModelId,
          routeId: routeIdForResolve,
          failureMode: 'degraded_default',
          restormelContext: buildStageRestormelContext({
            stage,
            task: request.task,
            estimatedInputTokens: context.estimatedTokens,
            estimatedInputChars: context.sourceLengthChars ?? context.estimatedTokens * 4,
            complexity:
              context.estimatedTokens > 18_000 ? 'high' : context.estimatedTokens > 8_000 ? 'medium' : 'low',
            constraints: request.constraints
          })
        })
      : await resolveReasoningModelRoute({
          pass: stagePass(stage),
          depthMode: latencyToDepth(stageLatency(stage, context)),
          routeId: routeIdForResolve,
          requestedProvider,
          requestedModelId,
          failureMode: 'degraded_default',
          restormelContext: buildStageRestormelContext({
            stage,
            task: request.task,
            estimatedInputTokens: estimateStageUsage(stage, context).inputTokens,
            estimatedInputChars:
              typeof context.sourceLengthChars === 'number'
                ? context.sourceLengthChars
                : Math.max(context.estimatedTokens * 4, 0),
            complexity:
              stageLatency(stage, context) === 'high'
                ? 'high'
                : stageLatency(stage, context) === 'balanced'
                  ? 'medium'
                  : 'low',
            constraints: request.constraints
          })
        });
  const usage = estimateStageUsage(stage, context);

  return {
    stage,
    request,
    routeId: route.resolvedRouteId ?? routeIdForResolve ?? undefined,
    provider: route.provider,
    model: route.modelId,
    estimatedCostUsd: estimateReasoningCostUsd(route, usage.inputTokens, usage.outputTokens),
    routingSource: route.routingSource ?? 'restormel',
    selectedStepId: route.resolvedStepId ?? null,
    selectedOrderIndex: route.resolvedOrderIndex ?? null,
    switchReasonCode: route.resolvedSwitchReasonCode ?? null,
    matchedCriteria: route.resolvedMatchedCriteria ?? null,
    fallbackCandidates: route.resolvedFallbackCandidates ?? null,
    routingReason:
      route.resolvedExplanation ??
      (route.routingSource === 'degraded_default'
        ? 'Restormel resolve failed, so Sophia planned this stage on a degraded default route.'
        : route.routingSource === 'requested'
          ? 'Sophia used the operator-requested provider for this ingestion stage.'
          : 'Restormel selected this route for the ingestion stage.'),
    route
  };
}

/**
 * Build a plan for an explicit provider/model (used after transient failures to try the next tier
 * in {@link CANONICAL_INGESTION_MODEL_FALLBACKS}). Fails hard if credentials are missing.
 */
export async function planIngestionStageWithExplicitModel(
  stage: IngestionStage,
  context: IngestionPlanningContext,
  explicit: { provider: ModelProvider; modelId: string }
): Promise<IngestionStagePlan> {
  if (stage === 'embedding') {
    return planIngestionStage(stage, context);
  }

  const request = buildStageRequest(stage, context);
  const routeIdForResolve = stageRouteBindingFromEnv(stage).routeId?.trim() || undefined;

  const route =
    stage === 'extraction'
      ? await resolveExtractionModelRoute({
          requestedProvider: explicit.provider,
          requestedModelId: explicit.modelId,
          routeId: routeIdForResolve,
          failureMode: 'error',
          restormelContext: buildStageRestormelContext({
            stage,
            task: request.task,
            estimatedInputTokens: context.estimatedTokens,
            estimatedInputChars: context.sourceLengthChars ?? context.estimatedTokens * 4,
            complexity:
              context.estimatedTokens > 18_000 ? 'high' : context.estimatedTokens > 8_000 ? 'medium' : 'low',
            constraints: request.constraints
          })
        })
      : await resolveReasoningModelRoute({
          pass: stagePass(stage),
          depthMode: latencyToDepth(stageLatency(stage, context)),
          routeId: routeIdForResolve,
          requestedProvider: explicit.provider,
          requestedModelId: explicit.modelId,
          failureMode: 'error',
          restormelContext: buildStageRestormelContext({
            stage,
            task: request.task,
            estimatedInputTokens: estimateStageUsage(stage, context).inputTokens,
            estimatedInputChars:
              typeof context.sourceLengthChars === 'number'
                ? context.sourceLengthChars
                : Math.max(context.estimatedTokens * 4, 0),
            complexity:
              stageLatency(stage, context) === 'high'
                ? 'high'
                : stageLatency(stage, context) === 'balanced'
                  ? 'medium'
                  : 'low',
            constraints: request.constraints
          })
        });

  const usage = estimateStageUsage(stage, context);

  return {
    stage,
    request,
    routeId: route.resolvedRouteId ?? routeIdForResolve ?? undefined,
    provider: route.provider,
    model: route.modelId,
    estimatedCostUsd: estimateReasoningCostUsd(route, usage.inputTokens, usage.outputTokens),
    routingSource: 'requested',
    selectedStepId: route.resolvedStepId ?? null,
    selectedOrderIndex: route.resolvedOrderIndex ?? null,
    switchReasonCode: route.resolvedSwitchReasonCode ?? null,
    matchedCriteria: route.resolvedMatchedCriteria ?? null,
    fallbackCandidates: route.resolvedFallbackCandidates ?? null,
    routingReason: `Fallback tier: explicit ${explicit.provider}/${explicit.modelId}.`,
    route
  };
}
