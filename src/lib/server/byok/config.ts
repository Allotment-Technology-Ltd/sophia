import {
  BYOK_PROVIDER_ORDER,
  REASONING_PROVIDER_ORDER,
  type ByokProvider,
  type ReasoningProvider
} from '$lib/types/providers';

const DEFAULT_ENABLED_BYOK_PROVIDERS: ByokProvider[] = ['vertex', 'anthropic'];

function parseEnabledByokProviders(raw: string | undefined): ByokProvider[] {
  const source = raw?.trim();
  const values = source
    ? source.split(',').map((value) => value.trim().toLowerCase())
    : DEFAULT_ENABLED_BYOK_PROVIDERS;

  const allowed = new Set<string>(BYOK_PROVIDER_ORDER);
  const seen = new Set<ByokProvider>();
  const providers: ByokProvider[] = [];

  for (const value of values) {
    if (!value || !allowed.has(value)) continue;
    const provider = value as ByokProvider;
    if (seen.has(provider)) continue;
    seen.add(provider);
    providers.push(provider);
  }

  return providers.length > 0 ? providers : [...DEFAULT_ENABLED_BYOK_PROVIDERS];
}

export function getEnabledByokProviders(): ByokProvider[] {
  return parseEnabledByokProviders(process.env.BYOK_ENABLED_PROVIDERS);
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
