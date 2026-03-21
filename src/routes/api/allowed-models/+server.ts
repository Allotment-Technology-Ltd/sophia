import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { googleProvider, resolveProviderId } from '@restormel/keys';
import {
  REASONING_PROVIDER_ORDER,
  isReasoningProvider,
  parseByokProvider,
  type ReasoningProvider
} from '@restormel/contracts/providers';
import { getEnabledReasoningProviders, isByokProviderEnabled } from '$lib/server/byok/config';
import { loadByokProviderApiKeys } from '$lib/server/byok/store';
import type { ByokProvider, ProviderApiKeys } from '$lib/server/byok/types';
import { getAvailableReasoningModels } from '$lib/server/vertex';
import { restormelEvaluatePolicies } from '$lib/server/restormel';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const POLICY_EVAL_TIMEOUT_MS = parsePositiveInt(process.env.ALLOWED_MODELS_POLICY_TIMEOUT_MS, 2500);
const POLICY_EVAL_CONCURRENCY = parsePositiveInt(process.env.ALLOWED_MODELS_POLICY_CONCURRENCY, 8);
const POLICY_EVAL_MAX_CANDIDATES = parsePositiveInt(process.env.ALLOWED_MODELS_POLICY_MAX_CANDIDATES, 48);

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`policy_eval_timeout_${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  }) as Promise<T>;
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const current = index;
      index += 1;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

function toEffectiveProviderKeys(
  allByokKeys: ProviderApiKeys,
  credentialMode: 'auto' | 'platform' | 'byok',
  byokProvider?: ByokProvider
): ProviderApiKeys {
  if (credentialMode === 'platform') return {};
  if (credentialMode === 'auto') return allByokKeys;
  if (byokProvider) {
    const key = allByokKeys[byokProvider];
    return key ? { [byokProvider]: key } : {};
  }
  return allByokKeys;
}

function toRestormelPolicyProvider(provider: ReasoningProvider): string {
  return resolveProviderId(provider, [googleProvider])?.id ?? provider;
}

function getRouteId(url: URL): string | undefined {
  const fromQuery = url.searchParams.get('route_id')?.trim();
  if (fromQuery) return fromQuery;
  const fromEnv = process.env.RESTORMEL_ANALYSE_ROUTE_ID?.trim();
  return fromEnv || undefined;
}

export const GET: RequestHandler = async ({ locals, url }) => {
  let providerApiKeys: ProviderApiKeys = {};
  const uid = locals.user?.uid;
  if (uid) {
    try {
      providerApiKeys = await loadByokProviderApiKeys(uid);
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          '[BYOK] Failed to load provider keys for allowed-models route:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  const credentialModeParam = (url.searchParams.get('credential_mode') ?? 'auto').trim().toLowerCase();
  const byokProviderParam = (url.searchParams.get('byok_provider') ?? '').trim().toLowerCase();
  const credentialMode =
    credentialModeParam === 'platform'
      ? 'platform'
      : credentialModeParam === 'byok'
        ? 'byok'
        : 'auto';
  const byokProvider = parseByokProvider(byokProviderParam) as ByokProvider | undefined;
  const enabledReasoningProviders = getEnabledReasoningProviders();
  if (credentialMode === 'byok' && byokProvider && !isByokProviderEnabled(byokProvider)) {
    return json(
      {
        defaults: { mode: 'auto' },
        models: [],
        allowed_by_provider: {},
        filtering: { active: false, degraded: false, routeId: getRouteId(url) ?? null }
      },
      { status: 400 }
    );
  }

  const effectiveProviderKeys = toEffectiveProviderKeys(providerApiKeys, credentialMode, byokProvider);
  const includePlatformProviders = credentialMode !== 'byok';
  const allowedProviders: ReasoningProvider[] | undefined =
    credentialMode === 'byok' && byokProvider
      ? (isReasoningProvider(byokProvider) ? [byokProvider] : [])
      : credentialMode === 'byok'
        ? enabledReasoningProviders
        : undefined;
  const candidateModels = getAvailableReasoningModels({
    providerApiKeys: effectiveProviderKeys,
    includePlatformProviders,
    allowedProviders
  });

  const routeId = getRouteId(url);
  const allowedByProvider: Partial<Record<ReasoningProvider, string[]>> = {};
  for (const provider of REASONING_PROVIDER_ORDER) {
    allowedByProvider[provider] = [];
  }

  const candidatesForEvaluation = candidateModels.slice(0, POLICY_EVAL_MAX_CANDIDATES);
  const skippedCandidateCount = Math.max(0, candidateModels.length - candidatesForEvaluation.length);

  const evaluationTasks = candidatesForEvaluation.map((model) => async () => {
    const provider = model.provider;
    try {
      const result = await withTimeout(
        restormelEvaluatePolicies({
          environmentId: process.env.RESTORMEL_ENVIRONMENT_ID?.trim() || 'production',
          routeId,
          modelId: model.id,
          providerType: toRestormelPolicyProvider(provider)
        }),
        POLICY_EVAL_TIMEOUT_MS
      );
      return {
        provider,
        modelId: model.id,
        allowed: result.data.allowed,
        ok: true
      } as const;
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          '[restormel] Failed evaluating allowed model candidate; skipping candidate:',
          err instanceof Error ? err.message : String(err)
        );
      }
      return {
        provider,
        modelId: model.id,
        allowed: false,
        ok: false
      } as const;
    }
  });

  const evaluations = await runWithConcurrency(evaluationTasks, POLICY_EVAL_CONCURRENCY);
  let successfulEvaluations = 0;
  for (const evaluation of evaluations) {
    if (evaluation.ok) {
      successfulEvaluations += 1;
      if (evaluation.allowed) {
        allowedByProvider[evaluation.provider]!.push(evaluation.modelId);
      }
    }
  }

  if (successfulEvaluations === 0 && candidatesForEvaluation.length > 0) {
    return json({
      defaults: { mode: 'auto' },
      models: [],
      allowed_by_provider: {},
      filtering: { active: false, degraded: true, routeId: routeId ?? null },
      error: 'Policy-filtered models are temporarily unavailable. Automatic routing remains available.'
    });
  }

  if (skippedCandidateCount > 0 && process.env.NODE_ENV !== 'test') {
    console.warn(
      `[restormel] allowed-models capped policy evaluation at ${POLICY_EVAL_MAX_CANDIDATES}; skipped ${skippedCandidateCount} candidates.`
    );
  }

  if (successfulEvaluations === 0 && candidateModels.length > 0) {
    return json({
      defaults: { mode: 'auto' },
      models: [],
      allowed_by_provider: {},
      filtering: { active: false, degraded: true, routeId: routeId ?? null },
      error: 'Policy-filtered models are temporarily unavailable. Automatic routing remains available.'
    });
  }

  const filteredModels = candidateModels.filter((model) =>
    (allowedByProvider[model.provider] ?? []).includes(model.id)
  );

  return json({
    defaults: { mode: 'auto' },
    models: filteredModels,
    allowed_by_provider: allowedByProvider,
    filtering: { active: true, degraded: false, routeId: routeId ?? null }
  });
};
