import {
  BYOK_PROVIDER_ORDER,
  parseByokProvider as parseSharedByokProvider,
  type ByokProvider
} from '$lib/types/providers';

export const BYOK_PROVIDERS = BYOK_PROVIDER_ORDER;
export type { ByokProvider };

export type ProviderApiKeys = Partial<Record<ByokProvider, string>>;

export type ByokCredentialStatus = 'pending_validation' | 'active' | 'invalid' | 'revoked';

export interface ByokProviderStatus {
  provider: ByokProvider;
  configured: boolean;
  status: ByokCredentialStatus | 'not_configured';
  fingerprint_last8: string | null;
  validated_at: string | null;
  updated_at: string | null;
  last_error: string | null;
}

export function parseByokProvider(value: string | null | undefined): ByokProvider | null {
  return parseSharedByokProvider(value) ?? null;
}
