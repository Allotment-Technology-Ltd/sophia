import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '$lib/server/firebase-admin';
import {
  currentMonthKeyUtc,
  summarizeEntitlements,
  TIER_INGESTION_RULES,
  normalizeBillingStatus,
  normalizeCurrency,
  normalizeTier,
  type EntitlementSummary,
  type EntitlementState,
  type IngestionConsumeResult,
  type IngestVisibilityScope
} from './types';
import {
  defaultEntitlements,
  defaultBillingProfile,
  billingEntitlementsRef,
  billingProfileRef,
  ensureBillingState
} from './store';

function evaluateIngestionConsume(
  tier: 'free' | 'pro' | 'premium',
  publicUsed: number,
  privateUsed: number,
  visibility: IngestVisibilityScope
): { allowed: boolean; reason?: IngestionConsumeResult['reason'] } {
  const rules = TIER_INGESTION_RULES[tier];
  const publicMax = privateUsed > 0 ? rules.publicMaxWhenPrivateUsed : rules.publicMax;

  if (visibility === 'private_user_only') {
    if (rules.privateMax === 0) {
      return { allowed: false, reason: 'private_not_allowed' };
    }
    if (privateUsed >= rules.privateMax) {
      return { allowed: false, reason: 'private_limit_reached' };
    }
    if (publicUsed > rules.publicMaxWhenPrivateUsed) {
      return { allowed: false, reason: 'combo_limit_reached' };
    }
    return { allowed: true };
  }

  if (publicUsed >= publicMax) {
    return { allowed: false, reason: 'public_limit_reached' };
  }
  return { allowed: true };
}

export async function getEntitlementSummary(uid: string): Promise<EntitlementSummary> {
  const snapshot = await ensureBillingState(uid);
  return summarizeEntitlements(
    snapshot.effectiveTier,
    snapshot.profile.status,
    snapshot.profile.currency,
    snapshot.entitlements
  );
}

export async function consumeIngestionEntitlement(
  uid: string,
  visibility: IngestVisibilityScope
): Promise<IngestionConsumeResult> {
  const profileRef = billingProfileRef(uid);
  const entitlementsRef = billingEntitlementsRef(uid);

  return adminDb.runTransaction(async (tx) => {
    const [profileSnap, entitlementSnap] = await Promise.all([
      tx.get(profileRef),
      tx.get(entitlementsRef)
    ]);

    const profileData = (profileSnap.exists ? profileSnap.data() : {}) as Record<string, unknown>;
    const profile = {
      ...defaultBillingProfile(),
      tier: normalizeTier(profileData?.tier),
      status: normalizeBillingStatus(profileData?.status),
      currency: normalizeCurrency(profileData?.currency)
    };
    const effectiveTier = profile.tier === 'free'
      ? 'free'
      : profile.status === 'active' || profile.status === 'trialing'
        ? profile.tier
        : 'free';

    const defaultEnt = defaultEntitlements();
    const entData = (entitlementSnap.exists ? entitlementSnap.data() : {}) as Record<string, unknown>;
    const entitlements: EntitlementState = {
      month_key: typeof entData?.month_key === 'string' ? entData.month_key : defaultEnt.month_key,
      public_ingest_used: Number.isFinite(entData?.public_ingest_used)
        ? Number(entData.public_ingest_used)
        : 0,
      private_ingest_used: Number.isFinite(entData?.private_ingest_used)
        ? Number(entData.private_ingest_used)
        : 0,
      byok_fee_charged_cents: Number.isFinite(entData?.byok_fee_charged_cents)
        ? Number(entData.byok_fee_charged_cents)
        : 0
    };

    const currentMonth = currentMonthKeyUtc();
    const activeEntitlements =
      entitlements.month_key === currentMonth
        ? entitlements
        : {
            ...defaultEnt,
            month_key: currentMonth
          };

    // Paid tier without active/trialing status cannot consume paid quotas.
    if (profile.tier !== 'free' && effectiveTier === 'free') {
      return {
        allowed: false,
        reason: 'billing_inactive',
        summary: summarizeEntitlements(
          effectiveTier,
          profile.status,
          profile.currency,
          activeEntitlements
        )
      };
    }

    const decision = evaluateIngestionConsume(
      effectiveTier,
      activeEntitlements.public_ingest_used,
      activeEntitlements.private_ingest_used,
      visibility
    );

    if (!decision.allowed) {
      return {
        allowed: false,
        reason: decision.reason,
        summary: summarizeEntitlements(
          effectiveTier,
          profile.status,
          profile.currency,
          activeEntitlements
        )
      };
    }

    const nextPublic =
      visibility === 'public_shared'
        ? activeEntitlements.public_ingest_used + 1
        : activeEntitlements.public_ingest_used;
    const nextPrivate =
      visibility === 'private_user_only'
        ? activeEntitlements.private_ingest_used + 1
        : activeEntitlements.private_ingest_used;

    tx.set(
      entitlementsRef,
      {
        month_key: activeEntitlements.month_key,
        public_ingest_used: nextPublic,
        private_ingest_used: nextPrivate,
        byok_fee_charged_cents: activeEntitlements.byok_fee_charged_cents,
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      allowed: true,
      summary: summarizeEntitlements(
        effectiveTier,
        profile.status,
        profile.currency,
        {
          ...activeEntitlements,
          public_ingest_used: nextPublic,
          private_ingest_used: nextPrivate
        }
      )
    };
  });
}

export async function consumeIngestionEntitlements(
  uid: string,
  visibilities: IngestVisibilityScope[]
): Promise<IngestionConsumeResult> {
  if (visibilities.length === 0) {
    return {
      allowed: true,
      summary: await getEntitlementSummary(uid)
    };
  }

  const profileRef = billingProfileRef(uid);
  const entitlementsRef = billingEntitlementsRef(uid);

  return adminDb.runTransaction(async (tx) => {
    const [profileSnap, entitlementSnap] = await Promise.all([
      tx.get(profileRef),
      tx.get(entitlementsRef)
    ]);

    const profileData = (profileSnap.exists ? profileSnap.data() : {}) as Record<string, unknown>;
    const profile = {
      ...defaultBillingProfile(),
      tier: normalizeTier(profileData?.tier),
      status: normalizeBillingStatus(profileData?.status),
      currency: normalizeCurrency(profileData?.currency)
    };
    const effectiveTier = profile.tier === 'free'
      ? 'free'
      : profile.status === 'active' || profile.status === 'trialing'
        ? profile.tier
        : 'free';

    const defaultEnt = defaultEntitlements();
    const entData = (entitlementSnap.exists ? entitlementSnap.data() : {}) as Record<string, unknown>;
    let publicUsed = Number.isFinite(entData?.public_ingest_used)
      ? Number(entData.public_ingest_used)
      : 0;
    let privateUsed = Number.isFinite(entData?.private_ingest_used)
      ? Number(entData.private_ingest_used)
      : 0;
    const byokFeeCharged = Number.isFinite(entData?.byok_fee_charged_cents)
      ? Number(entData.byok_fee_charged_cents)
      : 0;
    const monthKeyRaw = typeof entData?.month_key === 'string' ? entData.month_key : defaultEnt.month_key;
    const monthKey = monthKeyRaw === currentMonthKeyUtc() ? monthKeyRaw : currentMonthKeyUtc();
    if (monthKey !== monthKeyRaw) {
      publicUsed = 0;
      privateUsed = 0;
    }

    if (profile.tier !== 'free' && effectiveTier === 'free') {
      return {
        allowed: false,
        reason: 'billing_inactive',
        summary: summarizeEntitlements(effectiveTier, profile.status, profile.currency, {
          month_key: monthKey,
          public_ingest_used: publicUsed,
          private_ingest_used: privateUsed,
          byok_fee_charged_cents: byokFeeCharged
        })
      };
    }

    for (const visibility of visibilities) {
      const decision = evaluateIngestionConsume(
        effectiveTier,
        publicUsed,
        privateUsed,
        visibility
      );
      if (!decision.allowed) {
        return {
          allowed: false,
          reason: decision.reason,
          summary: summarizeEntitlements(effectiveTier, profile.status, profile.currency, {
            month_key: monthKey,
            public_ingest_used: publicUsed,
            private_ingest_used: privateUsed,
            byok_fee_charged_cents: byokFeeCharged
          })
        };
      }

      if (visibility === 'public_shared') publicUsed += 1;
      if (visibility === 'private_user_only') privateUsed += 1;
    }

    tx.set(
      entitlementsRef,
      {
        month_key: monthKey,
        public_ingest_used: publicUsed,
        private_ingest_used: privateUsed,
        byok_fee_charged_cents: byokFeeCharged,
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      allowed: true,
      summary: summarizeEntitlements(effectiveTier, profile.status, profile.currency, {
        month_key: monthKey,
        public_ingest_used: publicUsed,
        private_ingest_used: privateUsed,
        byok_fee_charged_cents: byokFeeCharged
      })
    };
  });
}

export async function applyByokFeeUsage(
  uid: string,
  amountCents: number
): Promise<void> {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return;
  const entitlementsRef = billingEntitlementsRef(uid);
  await adminDb.runTransaction(async (tx) => {
    const entSnap = await tx.get(entitlementsRef);
    const baseline = defaultEntitlements();
    const currentMonth = currentMonthKeyUtc();
    const entData = (entSnap.exists ? entSnap.data() : {}) as Record<string, unknown>;
    const monthKeyRaw = typeof entData.month_key === 'string' ? entData.month_key : baseline.month_key;
    const isCurrentMonth = monthKeyRaw === currentMonth;
    const existingByok = Number.isFinite(entData.byok_fee_charged_cents)
      ? Number(entData.byok_fee_charged_cents)
      : 0;
    const existingPublic = Number.isFinite(entData.public_ingest_used)
      ? Number(entData.public_ingest_used)
      : 0;
    const existingPrivate = Number.isFinite(entData.private_ingest_used)
      ? Number(entData.private_ingest_used)
      : 0;

    tx.set(
      entitlementsRef,
      {
        month_key: currentMonth,
        public_ingest_used: isCurrentMonth ? existingPublic : 0,
        private_ingest_used: isCurrentMonth ? existingPrivate : 0,
        byok_fee_charged_cents: (isCurrentMonth ? existingByok : 0) + Math.floor(amountCents),
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  });
}
