import {
  BYOK_PROVIDER_ORDER,
  REASONING_PROVIDER_ORDER,
  type ByokProvider,
  type ReasoningProvider
} from '$lib/types/providers';

export function getEnabledByokProviders(): ByokProvider[] {
  // BYOK should expose every provider supported by Restormel contracts.
  // Do not hard-gate providers via local env allowlists.
  return [...BYOK_PROVIDER_ORDER];
}

export function isByokProviderEnabled(provider: ByokProvider | null | undefined): boolean {
  if (!provider) return false;
  return getEnabledByokProviders().includes(provider);
}

export function getEnabledReasoningProviders(): ReasoningProvider[] {
  const enabledByok = new Set<ByokProvider>(getEnabledByokProviders());
  return REASONING_PROVIDER_ORDER.filter((provider) => enabledByok.has(provider));
}

export function isReasoningProviderEnabled(provider: ReasoningProvider | null | undefined): boolean {
  if (!provider) return false;
  return getEnabledReasoningProviders().includes(provider);
}
