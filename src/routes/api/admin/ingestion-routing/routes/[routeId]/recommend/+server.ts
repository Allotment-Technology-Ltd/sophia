import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
  getRestormelRecommendationSupport,
  requestRestormelRecommendation,
  RestormelRecommendationUnavailableError,
  type RestormelRecommendationActionType
} from '$lib/server/restormelRecommendations';
import { parseJsonBody } from '$lib/server/restormelAdmin';
import {
  RESTORMEL_ENVIRONMENT_ID,
  restormelListRouteSteps,
  restormelSimulateRoute,
  type RestormelStepRecord
} from '$lib/server/restormel';

function modelMetadata(modelLabel: string): {
  contextWindow: string;
  costTier: 'low' | 'medium' | 'high';
  speed: 'fast' | 'balanced' | 'thorough';
} {
  const label = modelLabel.toLowerCase();
  if (label.includes('flash') || label.includes('mini')) {
    return { contextWindow: '128k', costTier: 'low', speed: 'fast' };
  }
  if (label.includes('opus') || label.includes('gpt-5') || label.includes('sonnet')) {
    return { contextWindow: '200k', costTier: 'high', speed: 'thorough' };
  }
  return { contextWindow: '128k', costTier: 'medium', speed: 'balanced' };
}

function costFromTokens(tokens: number, rank: number): number {
  const base = Math.max(tokens, 12000) / 1000;
  const multiplier = rank === 0 ? 0.012 : rank === 1 ? 0.009 : 0.007;
  return Number((base * multiplier).toFixed(2));
}

function buildRecommendedAction(
  actionType: RestormelRecommendationActionType,
  topChoice: string,
  fallbackCount: number
): string {
  switch (actionType) {
    case 'use_cheaper_route':
      return `Use the cheaper model path headed by ${topChoice}. ${fallbackCount} fallback candidate(s) remain available.`;
    case 'use_more_reliable_route':
      return `Use the more reliable path headed by ${topChoice}. Keep at least one fallback active.`;
    case 'fix_automatically':
      return `Apply the ranked fallback chain headed by ${topChoice}.`;
    case 'rerun_phase':
      return `Re-run the phase with ${topChoice} as primary and keep the fallback chain in place.`;
    default:
      return `Recommended primary model is ${topChoice}.`;
  }
}

async function buildFallbackRecommendation(
  routeId: string,
  payload: Record<string, unknown>,
  actionType: RestormelRecommendationActionType
) {
  const stepsResponse = await restormelListRouteSteps(routeId);
  const steps = (stepsResponse.data ?? []) as RestormelStepRecord[];

  const rankings = steps
    .filter((step) => step.enabled !== false && step.modelId)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map((step, index) => {
      const model = step.modelId?.trim() ?? 'unknown-model';
      const provider = step.providerPreference?.trim() ?? 'auto';
      const display = `${provider} · ${model}`;
      const meta = modelMetadata(display);
      const estimatedInputTokens =
        typeof payload.estimatedInputTokens === 'number' ? payload.estimatedInputTokens : 14000;
      return {
        rank: index + 1,
        providerType: provider,
        modelId: model,
        display,
        confidence: Number(Math.max(0.55, 0.9 - index * 0.11).toFixed(2)),
        rationale:
          index === 0
            ? 'Best available fit from the current route step order.'
            : index === 1
              ? 'First fallback if the primary step fails or rate limits.'
              : 'Additional fallback to preserve continuity under failure.',
        contextWindow: meta.contextWindow,
        costTier: meta.costTier,
        speed: meta.speed,
        estimatedCostUsd: costFromTokens(estimatedInputTokens, index)
      };
    });

  let simulation: Record<string, unknown> | null = null;
  try {
    simulation = (
      await restormelSimulateRoute(routeId, {
        environmentId:
          typeof payload.environmentId === 'string' ? payload.environmentId : RESTORMEL_ENVIRONMENT_ID,
        routeId,
        workload: typeof payload.workload === 'string' ? payload.workload : 'ingestion',
        stage: typeof payload.stage === 'string' ? payload.stage : undefined,
        task: typeof payload.task === 'string' ? payload.task : 'completion',
        attempt: typeof payload.attempt === 'number' ? payload.attempt : 1,
        estimatedInputTokens:
          typeof payload.estimatedInputTokens === 'number' ? payload.estimatedInputTokens : 14000,
        estimatedInputChars:
          typeof payload.estimatedInputChars === 'number' ? payload.estimatedInputChars : 56000,
        complexity: typeof payload.complexity === 'string' ? payload.complexity : 'medium'
      })
    ).data;
  } catch {
    simulation = null;
  }

  const topChoice = rankings[0]?.display ?? 'the current route default';
  const estimatedCost =
    typeof simulation?.estimatedCostUsd === 'number'
      ? simulation.estimatedCostUsd
      : rankings.reduce((sum, item) => sum + (typeof item.estimatedCostUsd === 'number' ? item.estimatedCostUsd : 0), 0);

  return {
    support: {
      available: false,
      reason: 'Restormel recommendation API is unavailable in this environment. Sophia generated a fallback recommendation from route steps and simulation data.',
      actionTypes: getRestormelRecommendationSupport().actionTypes
    },
    recommendation: {
      source: 'sophia_fallback',
      recommendedAction: buildRecommendedAction(actionType, topChoice, Math.max(rankings.length - 1, 0)),
      reason: 'Fallback recommendation generated from the configured route chain.',
      estimatedImpact: `Estimated run cost ~$${Number(estimatedCost || 0).toFixed(2)}.`,
      rankings,
      simulation
    }
  };
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  const payload = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const actionType = payload.actionType;
  if (typeof actionType !== 'string') {
    return json({ error: 'actionType is required' }, { status: 400 });
  }

  try {
    const response = await requestRestormelRecommendation({
      ...payload,
      routeId: params.routeId,
      actionType: actionType as RestormelRecommendationActionType
    });

    return json(response);
  } catch (error) {
    if (error instanceof RestormelRecommendationUnavailableError) {
      const fallback = await buildFallbackRecommendation(params.routeId, payload, actionType as RestormelRecommendationActionType);
      return json(fallback, { status: 200 });
    }

    return json(
      {
        error: 'recommendation_request_failed',
        detail: error instanceof Error ? error.message : 'Unknown error',
        support: getRestormelRecommendationSupport(),
        recommendation: null
      },
      { status: 500 }
    );
  }
};
