import { generateText } from 'ai';
import { defaultProviders, estimateCost } from '@restormel/keys';
import type { AAIFLatency, AAIFRequest, AAIFResponse } from '@restormel/aaif';
import type { ModelProvider } from '@restormel/contracts/providers';
import type { ProviderApiKeys } from '$lib/server/byok/types';
import { EMBEDDING_MODEL, embedQuery } from '$lib/server/embeddings';
import { resolveReasoningModelRoute, trackTokens, type ReasoningModelRoute } from '$lib/server/vertex';

const DEFAULT_REASONING_OUTPUT_TOKENS: Record<'low' | 'balanced' | 'high', number> = {
  low: 700,
  balanced: 1200,
  high: 2200
};

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function latencyToDepth(latency?: AAIFLatency): 'quick' | 'standard' | 'deep' {
  if (latency === 'low') return 'quick';
  if (latency === 'high') return 'deep';
  return 'standard';
}

function latencyToOutputBudget(latency?: AAIFLatency): number {
  if (latency === 'low') return DEFAULT_REASONING_OUTPUT_TOKENS.low;
  if (latency === 'high') return DEFAULT_REASONING_OUTPUT_TOKENS.high;
  return DEFAULT_REASONING_OUTPUT_TOKENS.balanced;
}

function estimateReasoningCostUsd(
  route: Pick<ReasoningModelRoute, 'modelId'>,
  inputTokens: number,
  outputTokens: number
): number {
  const estimate = estimateCost(route.modelId, defaultProviders);
  if (!estimate) return 0;
  return (
    ((estimate.inputPerMillion ?? 0) * inputTokens +
      (estimate.outputPerMillion ?? 0) * outputTokens) /
    1_000_000
  );
}

function estimateEmbeddingCostUsd(input: string): number {
  const estimatedChars = input.length;
  return (estimatedChars / 1_000_000) * 0.025;
}

function enforceMaxCost(maxCost: number | undefined, estimatedCostUsd: number): void {
  if (typeof maxCost !== 'number') return;
  if (estimatedCostUsd <= maxCost) return;
  throw new Error(
    `AAIF maxCost constraint blocked execution. Estimated cost ${estimatedCostUsd.toFixed(6)} exceeds ${maxCost.toFixed(6)}.`
  );
}

async function resolveAaifReasoningRoute(
  request: AAIFRequest,
  options?: {
    providerApiKeys?: ProviderApiKeys;
    routeId?: string;
    requestedProvider?: ModelProvider;
    requestedModelId?: string;
    failureMode?: 'degraded_default' | 'error';
  }
): Promise<ReasoningModelRoute> {
  const estimatedInputTokens = estimateTextTokens(request.input);
  return resolveReasoningModelRoute({
    pass: request.task === 'completion' ? 'verification' : 'analysis',
    depthMode: latencyToDepth(request.constraints?.latency),
    routeId: options?.routeId,
    requestedProvider: options?.requestedProvider,
    requestedModelId: options?.requestedModelId,
    providerApiKeys: options?.providerApiKeys,
    failureMode: options?.failureMode ?? 'error',
    restormelContext: {
      task: request.task ?? 'chat',
      attempt: 1,
      estimatedInputTokens,
      estimatedInputChars: request.input.length,
      constraints: request.constraints
    }
  });
}

export async function executeAAIFRequest(
  request: AAIFRequest,
  options?: {
    providerApiKeys?: ProviderApiKeys;
    routeId?: string;
    requestedProvider?: ModelProvider;
    requestedModelId?: string;
    failureMode?: 'degraded_default' | 'error';
  }
): Promise<AAIFResponse> {
  const task = request.task ?? 'chat';

  if (task === 'embedding') {
    const estimatedCostUsd = estimateEmbeddingCostUsd(request.input);
    enforceMaxCost(request.constraints?.maxCost, estimatedCostUsd);
    const embedding = await embedQuery(request.input);
    return {
      output: JSON.stringify(embedding),
      provider: 'vertex',
      model: EMBEDDING_MODEL,
      cost: estimatedCostUsd,
      routing: {
        reason:
          'Sophia currently executes AAIF embedding requests on the Vertex embedding pipeline because Restormel AAIF runtime routing is not yet published.'
      }
    };
  }

  const route = await resolveAaifReasoningRoute(request, options);
  const estimatedInputTokens = estimateTextTokens(request.input);
  const estimatedOutputTokens = latencyToOutputBudget(request.constraints?.latency);
  const estimatedCostUsd = estimateReasoningCostUsd(route, estimatedInputTokens, estimatedOutputTokens);
  enforceMaxCost(request.constraints?.maxCost, estimatedCostUsd);

  const result = await generateText({
    model: route.model,
    prompt: request.input,
    maxOutputTokens: estimatedOutputTokens
  });

  const inputTokens = result.usage?.inputTokens ?? estimatedInputTokens;
  const outputTokens = result.usage?.outputTokens ?? 0;
  trackTokens(inputTokens, outputTokens);

  return {
    output: result.text,
    provider: route.provider,
    model: route.modelId,
    cost: estimateReasoningCostUsd(route, inputTokens, outputTokens),
    routing: {
      reason:
        route.resolvedExplanation ??
        (route.routingSource === 'requested'
          ? 'Execution used the caller-selected provider/model.'
          : route.routingSource === 'degraded_default'
            ? 'Restormel resolve failed, so Sophia used its degraded default route.'
            : 'Execution used the Restormel-selected route.')
    }
  };
}
