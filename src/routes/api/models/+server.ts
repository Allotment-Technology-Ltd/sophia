import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAvailableReasoningModels } from '$lib/server/vertex';
import { loadByokProviderApiKeys } from '$lib/server/byok/store';
import type { ByokProvider, ProviderApiKeys } from '$lib/server/byok/types';
import { isReasoningProvider, parseByokProvider, type ReasoningProvider } from '$lib/types/providers';

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

export const GET: RequestHandler = async ({ locals, url }) => {
  let providerApiKeys: ProviderApiKeys = {};
  const uid = locals.user?.uid;
  if (uid) {
    try {
      providerApiKeys = await loadByokProviderApiKeys(uid);
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[BYOK] Failed to load provider keys for models route:', err instanceof Error ? err.message : String(err));
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

  const effectiveProviderKeys = toEffectiveProviderKeys(providerApiKeys, credentialMode, byokProvider);
  const includePlatformProviders = credentialMode !== 'byok';
  const allowedProviders: ReasoningProvider[] | undefined =
    credentialMode === 'byok' && byokProvider
      ? (isReasoningProvider(byokProvider) ? [byokProvider] : [])
      : undefined;
  const models = getAvailableReasoningModels({
    providerApiKeys: effectiveProviderKeys,
    includePlatformProviders,
    allowedProviders
  });
  return json({
    defaults: {
      mode: 'auto'
    },
    models
  });
};
