import { estimateCost, defaultProviders } from '@restormel/keys';
import type { AAIFLatency, AAIFRequest } from '@restormel/aaif';
import type { ModelProvider } from '@restormel/contracts/providers';
import type { RestormelFallbackCandidate } from '../restormel.js';
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
type StageRouteBindingMode = 'dedicated' | 'shared' | 'none';

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
  if (stage === 'grouping') {
    return context.estimatedTokens > 12_000 || claimCountEstimate(context) > 50 ? 'high' : 'balanced';
  }
  if (stage === 'validation') {
    return claimCountEstimate(context) > 60 ? 'high' : 'balanced';
  }
  if (stage === 'extraction') {
    return context.estimatedTokens > 18_000 ? 'balanced' : 'low';
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

function stageRouteBinding(stage: IngestionStage): {
  routeId?: string;
  mode: StageRouteBindingMode;
} {
  if (stage === 'validation') {
    const dedicated =
      process.env.RESTORMEL_INGEST_VALIDATION_ROUTE_ID?.trim() ||
      process.env.RESTORMEL_VERIFY_ROUTE_ID?.trim();
    if (dedicated) {
      return {
        routeId: dedicated,
        mode: 'dedicated'
      };
    }

    const shared =
      process.env.RESTORMEL_INGEST_ROUTE_ID?.trim() ||
      process.env.RESTORMEL_ANALYSE_ROUTE_ID?.trim();
    return shared
      ? {
          routeId: shared,
          mode: 'shared'
        }
      : {
          mode: 'none'
        };
  }

  const dedicated = process.env[`RESTORMEL_INGEST_${stage.toUpperCase()}_ROUTE_ID`]?.trim();
  if (dedicated) {
    return {
      routeId: dedicated,
      mode: 'dedicated'
    };
  }

  const shared =
    process.env.RESTORMEL_INGEST_ROUTE_ID?.trim() ||
    process.env.RESTORMEL_ANALYSE_ROUTE_ID?.trim();
  return shared
    ? {
        routeId: shared,
        mode: 'shared'
      }
    : {
        mode: 'none'
      };
}

function buildStageRestormelContext(options: {
  stage: IngestionStage;
  routeMode: StageRouteBindingMode;
  task: AAIFRequest['task'];
  estimatedInputTokens: number;
  estimatedInputChars: number;
  complexity: 'low' | 'medium' | 'high';
  constraints: AAIFRequest['constraints'];
}) {
  const base = {
    task: options.task,
    attempt: 1,
    estimatedInputTokens: options.estimatedInputTokens,
    estimatedInputChars: options.estimatedInputChars,
    complexity: options.complexity,
    constraints: options.constraints
  };

  if (options.routeMode !== 'dedicated') {
    return base;
  }

  return {
    workload: 'ingestion',
    stage: `ingestion_${options.stage}`,
    ...base
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
      return {
        inputTokens: 0,
        outputTokens: 0
      };
  }
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
  const routeBinding = stageRouteBinding(stage);
  const routeId = routeBinding.routeId;

  if (stage === 'embedding') {
    return {
      stage,
      request,
      routeId,
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

  const requestedProvider = (context.preferredProvider ?? 'auto') as ModelProvider;
  const route =
    stage === 'extraction'
      ? await resolveExtractionModelRoute({
          requestedProvider,
          routeId,
          failureMode: 'degraded_default',
          restormelContext: buildStageRestormelContext({
            stage,
            routeMode: routeBinding.mode,
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
          routeId,
          requestedProvider,
          failureMode: 'degraded_default',
          restormelContext: buildStageRestormelContext({
            stage,
            routeMode: routeBinding.mode,
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
    routeId,
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
