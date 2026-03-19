import {
  createKeys,
  defaultProviders,
  resolveProviderId,
  type KeyRecord,
  type KeysInstance,
  type ProviderDefinition
} from '@restormel/keys';
import { parseReasoningProvider, type ReasoningProvider } from '$lib/types/providers';

export interface SophiaModelOption {
  provider: ReasoningProvider;
  id: string;
}

export interface SophiaByokProviderStatus {
  provider: string;
  configured: boolean;
  status: 'not_configured' | 'pending_validation' | 'active' | 'invalid' | 'revoked';
  fingerprint_last8: string | null;
}

export function toRestormelSelectorProviderId(providerId: string): string {
  return providerId === 'vertex' ? 'google' : providerId;
}

export function toSophiaSelectorProviderId(providerId: string): ReasoningProvider | null {
  return parseReasoningProvider(providerId === 'google' ? 'vertex' : providerId) ?? null;
}

export function createSophiaModelSelectorProviders(options: SophiaModelOption[]): ProviderDefinition[] {
  const groupedModels = new Map<string, Set<string>>();

  for (const option of options) {
    const resolved = resolveProviderId(option.provider, defaultProviders);
    if (!resolved) continue;
    const models = groupedModels.get(resolved.id) ?? new Set<string>();
    models.add(option.id);
    groupedModels.set(resolved.id, models);
  }

  const providers: ProviderDefinition[] = [];
  for (const provider of defaultProviders) {
    const models = groupedModels.get(provider.id);
    if (!models || models.size === 0) continue;
    providers.push({
      ...provider,
      models: [...models]
    });
  }

  return providers;
}

export function createSophiaModelSelectorKeys(
  byokProviders: SophiaByokProviderStatus[],
  providers: ProviderDefinition[],
  source: 'platform' | ReasoningProvider
): KeysInstance {
  const keyRecords: KeyRecord[] = byokProviders
    .filter((status) => status.configured && status.status === 'active')
    .map((status) => ({
      id: status.provider,
      provider: toRestormelSelectorProviderId(status.provider),
      label: status.fingerprint_last8 ?? undefined,
      status: 'active'
    }));

  const platformAvailableProviders = new Set(
    source === 'platform' ? providers.map((provider) => provider.id) : []
  );

  return createKeys(
    {
      keys: keyRecords,
      routing: {
        defaultProvider: providers[0]?.id ?? 'google'
      }
    },
    {
      providers,
      getPlatformKey: async (providerId) =>
        platformAvailableProviders.has(providerId) ? 'platform-available' : null
    }
  );
}
