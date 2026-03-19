import {
  canonicalizeProviderId,
  createKeys,
  defaultProviders,
  resolveProviderId,
  type KeyRecord,
  type KeysInstance,
  type ProviderDefinition
} from '@restormel/keys';
import { parseByokProvider, type ByokProvider } from '$lib/types/providers';
import type { ByokProviderStatus } from '$lib/server/byok/types';

export function createSophiaKeyManagerProviders(enabledProviders: ByokProvider[]): ProviderDefinition[] {
  const seen = new Set<string>();
  const providers: ProviderDefinition[] = [];

  for (const enabledProvider of enabledProviders) {
    const resolved = resolveProviderId(enabledProvider, defaultProviders);
    if (!resolved || seen.has(resolved.id)) continue;
    seen.add(resolved.id);
    providers.push(resolved);
  }

  return providers;
}

export function canonicalizeSophiaProviderId(providerId: string, providers: ProviderDefinition[]): string {
  return canonicalizeProviderId(providerId, providers);
}

export function toSophiaStorageByokProviderId(providerId: string, providers: ProviderDefinition[]): ByokProvider | null {
  const canonical = canonicalizeProviderId(providerId, providers);
  if (canonical === 'google') return 'vertex';
  return parseByokProvider(canonical) ?? null;
}

export function toSophiaKeyRecord(status: ByokProviderStatus, providers: ProviderDefinition[]): KeyRecord | null {
  if (!status.configured || status.status === 'not_configured' || status.status === 'revoked') {
    return null;
  }

  const canonicalProviderId = canonicalizeProviderId(status.provider, providers);

  return {
    id: status.provider,
    provider: canonicalProviderId,
    label: status.fingerprint_last8 ?? canonicalProviderId,
    status: status.status,
    validatedAt: status.validated_at ?? undefined,
    updatedAt: status.updated_at ?? undefined,
    lastError: status.last_error ?? undefined,
    fingerprint: status.fingerprint_last8 ?? undefined
  };
}

export function createSophiaKeysInstance(statuses: ByokProviderStatus[], providers: ProviderDefinition[]): KeysInstance {
  const keys = statuses
    .map((status) => toSophiaKeyRecord(status, providers))
    .filter((record): record is KeyRecord => Boolean(record));

  return createKeys(
    {
      keys,
      routing: {
        defaultProvider: providers[0]?.id ?? 'google'
      }
    },
    {
      providers
    }
  );
}
