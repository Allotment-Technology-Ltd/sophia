import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
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
import {
  RESTORMEL_CATALOG_V5_CONTRACT_VERSION,
  restormelGetLiveReasoningAllowlist
} from '$lib/server/restormel';

/**
 * Allowed-models lists candidates from the contracts catalog + BYOK/platform rules.
 * We intentionally do not call Restormel policy evaluate here while Keys is early-stage;
 * stepped routing for the actual run stays on the analyse API / resolve path.
 */

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

  let liveAllowlist: Partial<Record<ReasoningProvider, Set<string>>> | null = null;
  try {
    const catalog = await restormelGetLiveReasoningAllowlist();
    if (catalog.contractVersion !== RESTORMEL_CATALOG_V5_CONTRACT_VERSION) {
      throw new Error(
        `catalog_contract_mismatch:${catalog.contractVersion} expected=${RESTORMEL_CATALOG_V5_CONTRACT_VERSION}`
      );
    }
    if (!catalog.allFresh) {
      return json({
        defaults: { mode: 'auto' },
        models: [],
        allowed_by_provider: {},
        filtering: { active: false, degraded: true, routeId: getRouteId(url) ?? null },
        error:
          'Model catalog freshness signals are stale. Automatic routing remains available while external health recovers.'
      });
    }
    liveAllowlist = catalog.allowlist;
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[restormel] Failed loading live catalog v5 for allowed-models:',
        err instanceof Error ? err.message : String(err)
      );
    }
    return json({
      defaults: { mode: 'auto' },
      models: [],
      allowed_by_provider: {},
      filtering: { active: false, degraded: true, routeId: getRouteId(url) ?? null },
      error:
        'Live model catalog is temporarily unavailable. Automatic routing remains available.'
    });
  }

  const filteredModels = candidateModels.filter((model) =>
    liveAllowlist?.[model.provider]?.has(model.id) === true
  );

  const routeId = getRouteId(url);
  const allowedByProvider: Partial<Record<ReasoningProvider, string[]>> = {};
  for (const provider of REASONING_PROVIDER_ORDER) {
    allowedByProvider[provider] = [];
  }

  for (const model of filteredModels) {
    const bucket = allowedByProvider[model.provider];
    if (bucket && !bucket.includes(model.id)) {
      bucket.push(model.id);
    }
  }

  return json({
    defaults: { mode: 'auto' },
    models: filteredModels,
    allowed_by_provider: allowedByProvider,
    filtering: { active: false, degraded: false, routeId: routeId ?? null }
  });
};
