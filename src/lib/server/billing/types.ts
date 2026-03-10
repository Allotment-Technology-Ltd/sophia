export type BillingTier = 'free' | 'pro' | 'premium';

export type BillingStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'inactive';

export type CurrencyCode = 'GBP' | 'USD';

export type IngestVisibilityScope = 'public_shared' | 'private_user_only';

export interface TierIngestionRules {
  publicMax: number;
  privateMax: number;
  publicMaxWhenPrivateUsed: number;
}

export const TIER_INGESTION_RULES: Record<BillingTier, TierIngestionRules> = {
  free: {
    publicMax: 2,
    privateMax: 0,
    publicMaxWhenPrivateUsed: 0
  },
  pro: {
    publicMax: 3,
    privateMax: 1,
    publicMaxWhenPrivateUsed: 2
  },
  premium: {
    publicMax: 5,
    privateMax: 1,
    publicMaxWhenPrivateUsed: 3
  }
};

export const BYOK_HANDLING_FEE_RATE = 0.10;

export type IngestionEntitlementDenyReason =
  | 'private_not_allowed'
  | 'public_limit_reached'
  | 'private_limit_reached'
  | 'combo_limit_reached'
  | 'billing_inactive';

export interface BillingProfile {
  tier: BillingTier;
  status: BillingStatus;
  currency: CurrencyCode;
  paddle_customer_id?: string | null;
  paddle_subscription_id?: string | null;
  period_end_at?: string | null;
  legal_terms_version?: string | null;
  legal_privacy_version?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface EntitlementState {
  month_key: string;
  public_ingest_used: number;
  private_ingest_used: number;
  byok_fee_charged_cents: number;
  updated_at?: string | null;
}

export interface WalletState {
  currency: CurrencyCode;
  available_cents: number;
  lifetime_purchased_cents: number;
  lifetime_spent_cents: number;
  updated_at?: string | null;
}

export interface EntitlementSummary {
  tier: BillingTier;
  status: BillingStatus;
  currency: CurrencyCode;
  monthKey: string;
  publicUsed: number;
  privateUsed: number;
  publicRemaining: number;
  privateRemaining: number;
  effectivePublicMax: number;
  privateMax: number;
  byokFeeChargedCents: number;
}

export interface IngestionConsumeResult {
  allowed: boolean;
  reason?: IngestionEntitlementDenyReason;
  summary: EntitlementSummary;
}

export interface BillingEntitlementSnapshot {
  month_key: string;
  public_used: number;
  private_used: number;
  public_remaining: number;
  private_remaining: number;
  effective_public_max: number;
  private_max: number;
}

export interface ByokWalletSnapshot {
  currency: CurrencyCode;
  available_cents: number;
  lifetime_purchased_cents: number;
  lifetime_spent_cents: number;
}

export type BillingLedgerEventType =
  | 'byok_fee'
  | 'topup'
  | 'subscription'
  | 'adjustment';

export interface BillingLedgerEvent {
  type: BillingLedgerEventType;
  idempotency_key: string;
  amount_cents: number;
  currency: CurrencyCode;
  uid: string;
  provider?: 'paddle' | 'manual' | null;
  provider_event_id?: string | null;
  query_run_id?: string | null;
  fee_rate?: number | null;
  estimated_run_cost_usd?: number | null;
  note?: string | null;
  created_at?: string | null;
}

export function normalizeCurrency(value: unknown): CurrencyCode {
  if (typeof value !== 'string') return 'GBP';
  const normalized = value.trim().toUpperCase();
  return normalized === 'USD' ? 'USD' : 'GBP';
}

export function normalizeTier(value: unknown): BillingTier {
  if (typeof value !== 'string') return 'free';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'pro' || normalized === 'premium') return normalized;
  return 'free';
}

export function normalizeBillingStatus(value: unknown): BillingStatus {
  if (typeof value !== 'string') return 'inactive';
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'active' ||
    normalized === 'trialing' ||
    normalized === 'past_due' ||
    normalized === 'canceled'
  ) {
    return normalized;
  }
  return 'inactive';
}

export function currentMonthKeyUtc(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function deriveEffectiveTier(profile: BillingProfile): BillingTier {
  if (profile.tier === 'free') return 'free';
  if (profile.status === 'active' || profile.status === 'trialing') return profile.tier;
  return 'free';
}

export function summarizeEntitlements(
  tier: BillingTier,
  status: BillingStatus,
  currency: CurrencyCode,
  entitlements: EntitlementState
): EntitlementSummary {
  const rules = TIER_INGESTION_RULES[tier];
  const effectivePublicMax =
    entitlements.private_ingest_used > 0 ? rules.publicMaxWhenPrivateUsed : rules.publicMax;
  return {
    tier,
    status,
    currency,
    monthKey: entitlements.month_key,
    publicUsed: entitlements.public_ingest_used,
    privateUsed: entitlements.private_ingest_used,
    publicRemaining: Math.max(0, effectivePublicMax - entitlements.public_ingest_used),
    privateRemaining: Math.max(0, rules.privateMax - entitlements.private_ingest_used),
    effectivePublicMax,
    privateMax: rules.privateMax,
    byokFeeChargedCents: entitlements.byok_fee_charged_cents
  };
}
