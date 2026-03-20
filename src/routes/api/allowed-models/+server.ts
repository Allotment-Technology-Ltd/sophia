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
  let successfulEvaluations = 0;

  for (const provider of REASONING_PROVIDER_ORDER) {
    allowedByProvider[provider] = [];
    const providerModels = candidateModels.filter((model) => model.provider === provider);

    for (const model of providerModels) {
      try {
        const result = await restormelEvaluatePolicies({
          environmentId: process.env.RESTORMEL_ENVIRONMENT_ID?.trim() || 'production',
          routeId,
          modelId: model.id,
          providerType: toRestormelPolicyProvider(provider)
        });
        successfulEvaluations += 1;
        if (result.data.allowed) {
          allowedByProvider[provider]!.push(model.id);
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(
            '[restormel] Failed evaluating allowed model candidate; skipping candidate:',
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    }
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
