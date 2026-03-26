import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '$lib/server/firebase-admin';
import { billingWalletRef, ensureBillingState } from '$lib/server/billing/store';
import { currentMonthKeyUtc, type BillingTier } from '$lib/server/billing/types';

export type LearnAction = 'micro_lesson' | 'short_review' | 'essay_review';

interface LearnQuotaRules {
  microLessonsMax: number;
  shortReviewsMax: number;
  essayReviewsMax: number;
}

interface LearnEntitlementState {
  month_key: string;
  micro_lessons_completed: number;
  short_reviews_used: number;
  essay_reviews_used: number;
  scholar_credits_balance: number;
  scholar_credits_spent: number;
}

export interface LearnEntitlementSummary {
  tier: BillingTier;
  monthKey: string;
  microLessonsUsed: number;
  shortReviewsUsed: number;
  essayReviewsUsed: number;
  microLessonsRemaining: number | null;
  shortReviewsRemaining: number | null;
  essayReviewsRemaining: number | null;
  scholarCreditsBalance: number;
  scholarCreditsSpent: number;
}

export interface LearnConsumeResult {
  allowed: boolean;
  reason?:
    | 'micro_lesson_limit_reached'
    | 'short_review_limit_reached'
    | 'essay_review_limit_reached'
    | 'insufficient_scholar_credits';
  usedScholarCredit?: boolean;
  summary: LearnEntitlementSummary;
}

const LEARN_RULES: Record<BillingTier, LearnQuotaRules> = {
  free: {
    microLessonsMax: 2,
    shortReviewsMax: 1,
    essayReviewsMax: 0
  },
  pro: {
    microLessonsMax: 50,
    shortReviewsMax: Number.POSITIVE_INFINITY,
    essayReviewsMax: 3
  },
  premium: {
    microLessonsMax: Number.POSITIVE_INFINITY,
    shortReviewsMax: Number.POSITIVE_INFINITY,
    essayReviewsMax: 10
  }
};

export const SCHOLAR_CREDIT_PRICE_CENTS = Number.parseInt(process.env.SCHOLAR_CREDIT_PRICE_CENTS ?? '100', 10) || 100;

function learnQuotaRef(uid: string) {
  return adminDb.collection('users').doc(uid).collection('learn').doc('quota');
}

function defaultLearnEntitlements(): LearnEntitlementState {
  return {
    month_key: currentMonthKeyUtc(),
    micro_lessons_completed: 0,
    short_reviews_used: 0,
    essay_reviews_used: 0,
    scholar_credits_balance: 0,
    scholar_credits_spent: 0
  };
}

function normalizeLearnEntitlements(input: unknown): LearnEntitlementState {
  const base = defaultLearnEntitlements();
  const obj = (input ?? {}) as Record<string, unknown>;
  return {
    month_key: typeof obj.month_key === 'string' ? obj.month_key : base.month_key,
    micro_lessons_completed: Number.isFinite(obj.micro_lessons_completed)
      ? Number(obj.micro_lessons_completed)
      : 0,
    short_reviews_used: Number.isFinite(obj.short_reviews_used) ? Number(obj.short_reviews_used) : 0,
    essay_reviews_used: Number.isFinite(obj.essay_reviews_used) ? Number(obj.essay_reviews_used) : 0,
    scholar_credits_balance: Number.isFinite(obj.scholar_credits_balance)
      ? Number(obj.scholar_credits_balance)
      : 0,
    scholar_credits_spent: Number.isFinite(obj.scholar_credits_spent) ? Number(obj.scholar_credits_spent) : 0
  };
}

function monthlyValue(current: number, max: number): number | null {
  if (!Number.isFinite(max)) return null;
  return Math.max(0, Math.floor(max - current));
}

function summarize(tier: BillingTier, state: LearnEntitlementState): LearnEntitlementSummary {
  const rules = LEARN_RULES[tier];
  return {
    tier,
    monthKey: state.month_key,
    microLessonsUsed: state.micro_lessons_completed,
    shortReviewsUsed: state.short_reviews_used,
    essayReviewsUsed: state.essay_reviews_used,
    microLessonsRemaining: monthlyValue(state.micro_lessons_completed, rules.microLessonsMax),
    shortReviewsRemaining: monthlyValue(state.short_reviews_used, rules.shortReviewsMax),
    essayReviewsRemaining: monthlyValue(state.essay_reviews_used, rules.essayReviewsMax),
    scholarCreditsBalance: Math.max(0, state.scholar_credits_balance),
    scholarCreditsSpent: Math.max(0, state.scholar_credits_spent)
  };
}

function ensureMonth(state: LearnEntitlementState): LearnEntitlementState {
  const currentMonth = currentMonthKeyUtc();
  if (state.month_key === currentMonth) return state;
  return {
    month_key: currentMonth,
    micro_lessons_completed: 0,
    short_reviews_used: 0,
    essay_reviews_used: 0,
    scholar_credits_balance: state.scholar_credits_balance,
    scholar_credits_spent: 0
  };
}

function consumeFromState(
  tier: BillingTier,
  state: LearnEntitlementState,
  action: LearnAction
): { allowed: boolean; reason?: LearnConsumeResult['reason']; usedScholarCredit?: boolean; next: LearnEntitlementState } {
  const rules = LEARN_RULES[tier];

  if (action === 'micro_lesson') {
    if (Number.isFinite(rules.microLessonsMax) && state.micro_lessons_completed >= rules.microLessonsMax) {
      return { allowed: false, reason: 'micro_lesson_limit_reached', next: state };
    }
    return {
      allowed: true,
      next: {
        ...state,
        micro_lessons_completed: state.micro_lessons_completed + 1
      }
    };
  }

  if (action === 'short_review') {
    if (Number.isFinite(rules.shortReviewsMax) && state.short_reviews_used >= rules.shortReviewsMax) {
      return { allowed: false, reason: 'short_review_limit_reached', next: state };
    }
    return {
      allowed: true,
      next: {
        ...state,
        short_reviews_used: state.short_reviews_used + 1
      }
    };
  }

  if (!Number.isFinite(rules.essayReviewsMax) || state.essay_reviews_used < rules.essayReviewsMax) {
    return {
      allowed: true,
      next: {
        ...state,
        essay_reviews_used: state.essay_reviews_used + 1
      }
    };
  }

  if (state.scholar_credits_balance <= 0) {
    return { allowed: false, reason: 'insufficient_scholar_credits', next: state };
  }

  return {
    allowed: true,
    usedScholarCredit: true,
    next: {
      ...state,
      essay_reviews_used: state.essay_reviews_used + 1,
      scholar_credits_balance: state.scholar_credits_balance - 1,
      scholar_credits_spent: state.scholar_credits_spent + 1
    }
  };
}

export async function getLearnEntitlementSummary(
  uid: string,
  options?: { ownerBypass?: boolean }
): Promise<LearnEntitlementSummary> {
  const [billing, quotaSnap] = await Promise.all([
    ensureBillingState(uid),
    learnQuotaRef(uid).get()
  ]);

  const normalized = ensureMonth(normalizeLearnEntitlements(quotaSnap.exists ? quotaSnap.data() : null));
  if (!quotaSnap.exists || normalized.month_key !== normalizeLearnEntitlements(quotaSnap.data()).month_key) {
    await learnQuotaRef(uid).set({ ...normalized, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  }

  const tier = options?.ownerBypass ? 'premium' : billing.effectiveTier;
  return summarize(tier, normalized);
}

export async function consumeLearnEntitlement(
  uid: string,
  action: LearnAction,
  options?: { bypassQuota?: boolean }
): Promise<LearnConsumeResult> {
  if (options?.bypassQuota) {
    return {
      allowed: true,
      summary: await getLearnEntitlementSummary(uid)
    };
  }

  const billing = await ensureBillingState(uid);
  const quotaRef = learnQuotaRef(uid);

  return adminDb.runTransaction(async (tx) => {
    const quotaSnap = await tx.get(quotaRef);

    const normalized = ensureMonth(normalizeLearnEntitlements(quotaSnap.exists ? quotaSnap.data() : null));
    const decision = consumeFromState(billing.effectiveTier, normalized, action);

    if (!decision.allowed) {
      return {
        allowed: false,
        reason: decision.reason,
        summary: summarize(billing.effectiveTier, normalized)
      };
    }

    tx.set(
      quotaRef,
      {
        ...decision.next,
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      allowed: true,
      usedScholarCredit: decision.usedScholarCredit,
      summary: summarize(billing.effectiveTier, decision.next)
    };
  });
}

export async function convertWalletToScholarCredits(
  uid: string,
  requestedCredits: number
): Promise<{ converted: boolean; credits_added: number; summary: LearnEntitlementSummary; wallet_available_cents: number }> {
  const billing = await ensureBillingState(uid);
  const credits = Math.max(1, Math.floor(requestedCredits));
  const requiredCents = credits * SCHOLAR_CREDIT_PRICE_CENTS;
  const quotaRef = learnQuotaRef(uid);
  const walletRef = billingWalletRef(uid);

  return adminDb.runTransaction(async (tx) => {
    const [quotaSnap, walletSnap] = await Promise.all([tx.get(quotaRef), tx.get(walletRef)]);

    const quotaState = ensureMonth(normalizeLearnEntitlements(quotaSnap.exists ? quotaSnap.data() : null));
    const walletData = (walletSnap.exists ? walletSnap.data() : {}) as Record<string, unknown>;
    const available = Number.isFinite(walletData.available_cents) ? Number(walletData.available_cents) : 0;

    if (available < requiredCents) {
      return {
        converted: false,
        credits_added: 0,
        summary: summarize(billing.effectiveTier, quotaState),
        wallet_available_cents: available
      };
    }

    const nextQuota: LearnEntitlementState = {
      ...quotaState,
      scholar_credits_balance: quotaState.scholar_credits_balance + credits
    };

    tx.set(
      walletRef,
      {
        available_cents: available - requiredCents,
        lifetime_spent_cents: FieldValue.increment(requiredCents),
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    tx.set(
      quotaRef,
      {
        ...nextQuota,
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      converted: true,
      credits_added: credits,
      summary: summarize(billing.effectiveTier, nextQuota),
      wallet_available_cents: available - requiredCents
    };
  });
}
