import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { query as surrealQuery } from '$lib/server/db';
import { getStoredRouteIdForBindingKey } from '$lib/server/ingestionRouteBindings';
import { resolveRouteForStage } from '$lib/utils/ingestionRouting';
import {
  RESTORMEL_ENVIRONMENT_ID,
  restormelListRouteSteps,
  restormelListRoutes
} from '$lib/server/restormel';
import { getEmbeddingDimensions, getEmbeddingProvider } from '$lib/server/embeddings';

type RouteStepSummary = {
  routeId: string | null;
  provider: string | null;
  modelId: string | null;
};

function inferExpectedDimensions(providerRaw: string | null, modelIdRaw: string | null): number | null {
  const provider = (providerRaw ?? '').trim().toLowerCase();
  const modelId = (modelIdRaw ?? '').trim().toLowerCase();

  if (!provider) return null;
  if (provider === 'voyage') return 1024;
  if (provider === 'google' || provider === 'vertex') return 768;
  if (provider === 'openai') {
    if (modelId.includes('text-embedding-3-large')) return 3072;
    if (modelId.includes('text-embedding-3-small')) return 1536;
    if (modelId.includes('text-embedding-ada-002')) return 1536;
    return null;
  }
  return null;
}

function summarizePrimaryEmbeddingRouteStep(
  routes: Array<{ id: string; stage?: string | null; enabled?: boolean | null }>,
  steps: Array<{ orderIndex?: number | null; enabled?: boolean | null; providerPreference?: string | null; modelId?: string | null }>
): RouteStepSummary {
  const route = resolveRouteForStage(routes, 'ingestion_embedding');
  if (!route?.id) return { routeId: null, provider: null, modelId: null };

  const orderedEnabled = [...steps]
    .filter((step) => step.enabled !== false)
    .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
  const primary = orderedEnabled[0];

  return {
    routeId: route.id,
    provider: typeof primary?.providerPreference === 'string' ? primary.providerPreference.trim() : null,
    modelId: typeof primary?.modelId === 'string' ? primary.modelId.trim() : null
  };
}

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);

  const warnings: string[] = [];

  const runtimeProvider = getEmbeddingProvider();
  const runtimeExpectedDimensions = getEmbeddingDimensions();

  let routeSummary: RouteStepSummary = {
    routeId: null,
    provider: runtimeProvider.name,
    modelId: runtimeProvider.documentModel
  };

  try {
    const routesResp = await restormelListRoutes({
      environmentId: RESTORMEL_ENVIRONMENT_ID || undefined,
      workload: 'ingestion'
    });
    const routes = Array.isArray(routesResp?.data) ? routesResp.data : [];
    const prefEmbed = await getStoredRouteIdForBindingKey('ingestion_embedding');
    const embeddingRoute = resolveRouteForStage(routes, 'ingestion_embedding', prefEmbed);
    if (embeddingRoute?.id) {
      const stepsResp = await restormelListRouteSteps(embeddingRoute.id);
      const steps = Array.isArray(stepsResp?.data) ? stepsResp.data : [];
      routeSummary = summarizePrimaryEmbeddingRouteStep(routes, steps);
    } else {
      warnings.push('No ingestion_embedding route found; using runtime embedding provider.');
    }
  } catch (error) {
    warnings.push(
      `Failed to load embedding route from Restormel (${error instanceof Error ? error.message : 'unknown error'}).`
    );
  }

  const expectedDimensions =
    inferExpectedDimensions(routeSummary.provider, routeSummary.modelId) ?? runtimeExpectedDimensions ?? null;

  let detectedDbVectorDimension: number | null = null;
  let detectedDbDimensions: number[] = [];
  let sampleCount = 0;

  try {
    const rows = await surrealQuery<Array<{ embedding?: unknown }>>(
      'SELECT embedding FROM claim WHERE embedding != NONE LIMIT 64;'
    );

    const dimCounts = new Map<number, number>();
    for (const row of rows ?? []) {
      const vector = row?.embedding;
      if (!Array.isArray(vector)) continue;
      const dim = vector.length;
      if (!Number.isFinite(dim) || dim <= 0) continue;
      sampleCount += 1;
      dimCounts.set(dim, (dimCounts.get(dim) ?? 0) + 1);
    }

    detectedDbDimensions = [...dimCounts.keys()].sort((a, b) => a - b);
    detectedDbVectorDimension =
      [...dimCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  } catch (error) {
    warnings.push(
      `Failed to sample vector dimensions from DB (${error instanceof Error ? error.message : 'unknown error'}).`
    );
  }

  const drift =
    typeof expectedDimensions === 'number' && typeof detectedDbVectorDimension === 'number'
      ? expectedDimensions !== detectedDbVectorDimension
      : null;

  return json({
    embeddingHealth: {
      activeProvider: routeSummary.provider ?? runtimeProvider.name,
      activeModel: routeSummary.modelId ?? runtimeProvider.documentModel,
      expectedDimensions,
      detectedDbVectorDimension,
      detectedDbDimensions,
      sampledVectors: sampleCount,
      drift
    },
    warnings
  });
};
