import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '$lib/server/firebase-admin';
import {
  currentMonthKeyUtc,
  deriveEffectiveTier,
  normalizeBillingStatus,
  normalizeCurrency,
  normalizeTier,
  type BillingProfile,
  type EntitlementState,
  type WalletState
} from './types';

function userRef(uid: string) {
  return adminDb.collection('users').doc(uid);
}

export function billingProfileRef(uid: string) {
  return userRef(uid).collection('billing').doc('profile');
}

export function billingEntitlementsRef(uid: string) {
  return userRef(uid).collection('billing').doc('entitlements');
}

export function billingWalletRef(uid: string) {
  return userRef(uid).collection('billing').doc('wallet');
}

export function billingLedgerRef(uid: string, key: string) {
  return userRef(uid).collection('billingLedger').doc(key);
}

export function defaultBillingProfile(): BillingProfile {
  return {
    tier: 'free',
    status: 'active',
    currency: 'GBP'
  };
}

export function defaultEntitlements(): EntitlementState {
  return {
    month_key: currentMonthKeyUtc(),
    public_ingest_used: 0,
    private_ingest_used: 0,
    byok_fee_charged_cents: 0
  };
}

export function defaultWallet(): WalletState {
  return {
    currency: 'GBP',
    available_cents: 0,
    lifetime_purchased_cents: 0,
    lifetime_spent_cents: 0
  };
}

function normalizeProfile(input: unknown): BillingProfile {
  const obj = (input ?? {}) as Record<string, unknown>;
  return {
    tier: normalizeTier(obj.tier),
    status: normalizeBillingStatus(obj.status),
    currency: normalizeCurrency(obj.currency),
    paddle_customer_id: typeof obj.paddle_customer_id === 'string' ? obj.paddle_customer_id : null,
    paddle_subscription_id:
      typeof obj.paddle_subscription_id === 'string' ? obj.paddle_subscription_id : null,
    period_end_at: typeof obj.period_end_at === 'string' ? obj.period_end_at : null,
    legal_terms_version:
      typeof obj.legal_terms_version === 'string' ? obj.legal_terms_version : null,
    legal_privacy_version:
      typeof obj.legal_privacy_version === 'string' ? obj.legal_privacy_version : null
  };
}

function normalizeEntitlements(input: unknown): EntitlementState {
  const obj = (input ?? {}) as Record<string, unknown>;
  const currentMonth = currentMonthKeyUtc();
  return {
    month_key: typeof obj.month_key === 'string' ? obj.month_key : currentMonth,
    public_ingest_used: Number.isFinite(obj.public_ingest_used) ? Number(obj.public_ingest_used) : 0,
    private_ingest_used: Number.isFinite(obj.private_ingest_used) ? Number(obj.private_ingest_used) : 0,
    byok_fee_charged_cents: Number.isFinite(obj.byok_fee_charged_cents)
      ? Number(obj.byok_fee_charged_cents)
      : 0
  };
}

function normalizeWallet(input: unknown): WalletState {
  const obj = (input ?? {}) as Record<string, unknown>;
  return {
    currency: normalizeCurrency(obj.currency),
    available_cents: Number.isFinite(obj.available_cents) ? Number(obj.available_cents) : 0,
    lifetime_purchased_cents: Number.isFinite(obj.lifetime_purchased_cents)
      ? Number(obj.lifetime_purchased_cents)
      : 0,
    lifetime_spent_cents: Number.isFinite(obj.lifetime_spent_cents)
      ? Number(obj.lifetime_spent_cents)
      : 0
  };
}

export async function ensureBillingState(uid: string): Promise<{
  profile: BillingProfile;
  entitlements: EntitlementState;
  wallet: WalletState;
  effectiveTier: BillingProfile['tier'];
}> {
  const profileRef = billingProfileRef(uid);
  const entitlementsRef = billingEntitlementsRef(uid);
  const walletRef = billingWalletRef(uid);

  return adminDb.runTransaction(async (tx) => {
    const [profileSnap, entSnap, walletSnap] = await Promise.all([
      tx.get(profileRef),
      tx.get(entitlementsRef),
      tx.get(walletRef)
    ]);

    const profile = profileSnap.exists
      ? normalizeProfile(profileSnap.data())
      : defaultBillingProfile();
    const entitlements = entSnap.exists
      ? normalizeEntitlements(entSnap.data())
      : defaultEntitlements();
    const wallet = walletSnap.exists ? normalizeWallet(walletSnap.data()) : defaultWallet();

    let entitlementsToWrite = entitlements;
    if (entitlements.month_key !== currentMonthKeyUtc()) {
      entitlementsToWrite = {
        ...defaultEntitlements(),
        month_key: currentMonthKeyUtc()
      };
    }

    if (!profileSnap.exists) {
      tx.set(profileRef, {
        ...profile,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp()
      });
    }

    if (!entSnap.exists || entitlementsToWrite !== entitlements) {
      tx.set(entitlementsRef, {
        ...entitlementsToWrite,
        updated_at: FieldValue.serverTimestamp()
      });
    }

    if (!walletSnap.exists) {
      tx.set(walletRef, {
        ...wallet,
        updated_at: FieldValue.serverTimestamp()
      });
    }

    return {
      profile,
      entitlements: entitlementsToWrite,
      wallet,
      effectiveTier: deriveEffectiveTier(profile)
    };
  });
}

export async function upsertBillingProfile(
  uid: string,
  patch: Partial<BillingProfile>
): Promise<void> {
  const sanitized: Record<string, unknown> = {};
  if (patch.tier) sanitized.tier = normalizeTier(patch.tier);
  if (patch.status) sanitized.status = normalizeBillingStatus(patch.status);
  if (patch.currency) sanitized.currency = normalizeCurrency(patch.currency);
  if (patch.paddle_customer_id !== undefined) sanitized.paddle_customer_id = patch.paddle_customer_id;
  if (patch.paddle_subscription_id !== undefined) {
    sanitized.paddle_subscription_id = patch.paddle_subscription_id;
  }
  if (patch.period_end_at !== undefined) sanitized.period_end_at = patch.period_end_at;
  if (patch.legal_terms_version !== undefined) sanitized.legal_terms_version = patch.legal_terms_version;
  if (patch.legal_privacy_version !== undefined) {
    sanitized.legal_privacy_version = patch.legal_privacy_version;
  }

  sanitized.updated_at = FieldValue.serverTimestamp();
  sanitized.created_at = FieldValue.serverTimestamp();

  await billingProfileRef(uid).set(sanitized, { merge: true });
}
