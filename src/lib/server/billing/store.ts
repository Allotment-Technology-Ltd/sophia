import { FieldValue } from '$lib/server/fsCompat';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';
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
import {
  normalizeFounderOffer,
  founderOfferEligible,
  FOUNDER_BONUS_CENTS,
  FOUNDER_OFFER_LIMIT,
  FOUNDER_PREMIUM_MONTHS,
  FOUNDER_PROGRAM_ID,
  addMonthsIso
} from './founder';

function userRef(uid: string) {
  return sophiaDocumentsDb.collection('users').doc(uid);
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

function founderProgramRef() {
  return sophiaDocumentsDb.collection('billingPrograms').doc(FOUNDER_PROGRAM_ID);
}

export function defaultBillingProfile(): BillingProfile {
  return {
    tier: 'free',
    status: 'active',
    currency: 'GBP',
    founder_offer: null
  };
}

export function defaultEntitlements(): EntitlementState {
  return {
    month_key: currentMonthKeyUtc(),
    public_ingest_used: 0,
    private_ingest_used: 0
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
    founder_offer: normalizeFounderOffer(obj.founder_offer),
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
    private_ingest_used: Number.isFinite(obj.private_ingest_used) ? Number(obj.private_ingest_used) : 0
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

  return sophiaDocumentsDb.runTransaction(async (tx) => {
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
    let profileToWrite = profile;
    let walletToWrite = wallet;

    if (founderOfferEligible(profile)) {
      const programRef = founderProgramRef();
      const programSnap = await tx.get(programRef);
      const programData = (programSnap.exists ? programSnap.data() : {}) as Record<string, unknown>;
      const assignedCountRaw = Number(programData.assigned_count);
      const assignedCount = Number.isFinite(assignedCountRaw)
        ? Math.max(0, Math.floor(assignedCountRaw))
        : 0;

      if (assignedCount < FOUNDER_OFFER_LIMIT) {
        const now = new Date();
        const slot = assignedCount + 1;
        const expiresAt = addMonthsIso(now, FOUNDER_PREMIUM_MONTHS);

        profileToWrite = {
          ...profile,
          tier: 'premium',
          status: 'active',
          currency: 'GBP',
          period_end_at: expiresAt,
          founder_offer: {
            program_id: FOUNDER_PROGRAM_ID,
            slot,
            granted_at: now.toISOString(),
            expires_at: expiresAt,
            bonus_wallet_cents: FOUNDER_BONUS_CENTS,
            notice_pending: true,
            notice_seen_at: null
          }
        };

        walletToWrite = {
          ...wallet,
          currency: 'GBP',
          available_cents: wallet.available_cents + FOUNDER_BONUS_CENTS,
          lifetime_purchased_cents: wallet.lifetime_purchased_cents + FOUNDER_BONUS_CENTS
        };

        tx.set(
          programRef,
          {
            program_id: FOUNDER_PROGRAM_ID,
            limit: FOUNDER_OFFER_LIMIT,
            premium_months: FOUNDER_PREMIUM_MONTHS,
            bonus_wallet_cents: FOUNDER_BONUS_CENTS,
            assigned_count: slot,
            last_assigned_uid: uid,
            last_assigned_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        tx.set(
          billingLedgerRef(uid, `founder:${FOUNDER_PROGRAM_ID}`),
          {
            type: 'adjustment',
            idempotency_key: `founder:${FOUNDER_PROGRAM_ID}`,
            uid,
            amount_cents: FOUNDER_BONUS_CENTS,
            currency: 'GBP',
            provider: 'manual',
            provider_event_id: `founder:${FOUNDER_PROGRAM_ID}`,
            query_run_id: null,
            fee_rate: null,
            estimated_run_cost_usd: null,
            note: `Founder promotion slot ${slot}`,
            created_at: FieldValue.serverTimestamp()
          },
          { merge: false }
        );
      }
    }

    let entitlementsToWrite = entitlements;
    if (entitlements.month_key !== currentMonthKeyUtc()) {
      entitlementsToWrite = {
        ...defaultEntitlements(),
        month_key: currentMonthKeyUtc()
      };
    }

    if (!profileSnap.exists || profileToWrite !== profile) {
      tx.set(profileRef, {
        ...profileToWrite,
        ...(profileSnap.exists ? {} : { created_at: FieldValue.serverTimestamp() }),
        updated_at: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    if (!entSnap.exists || entitlementsToWrite !== entitlements) {
      tx.set(entitlementsRef, {
        ...entitlementsToWrite,
        updated_at: FieldValue.serverTimestamp()
      });
    }

    if (!walletSnap.exists || walletToWrite !== wallet) {
      tx.set(walletRef, {
        ...walletToWrite,
        updated_at: FieldValue.serverTimestamp()
      });
    }

    return {
      profile: profileToWrite,
      entitlements: entitlementsToWrite,
      wallet: walletToWrite,
      effectiveTier: deriveEffectiveTier(profileToWrite)
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
  if (patch.founder_offer !== undefined) sanitized.founder_offer = patch.founder_offer;
  if (patch.legal_terms_version !== undefined) sanitized.legal_terms_version = patch.legal_terms_version;
  if (patch.legal_privacy_version !== undefined) {
    sanitized.legal_privacy_version = patch.legal_privacy_version;
  }

  sanitized.updated_at = FieldValue.serverTimestamp();
  sanitized.created_at = FieldValue.serverTimestamp();

  await billingProfileRef(uid).set(sanitized, { merge: true });
}

export async function acknowledgeFounderOfferNotice(uid: string): Promise<void> {
  await billingProfileRef(uid).set(
    {
      'founder_offer.notice_pending': false,
      'founder_offer.notice_seen_at': new Date().toISOString(),
      updated_at: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}
