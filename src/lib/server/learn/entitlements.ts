import { FieldValue } from '$lib/server/fsCompat';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';
import { ensureBillingState } from '$lib/server/billing/store';
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
}

export interface LearnConsumeResult {
  allowed: boolean;
  reason?:
    | 'micro_lesson_limit_reached'
    | 'short_review_limit_reached'
    | 'essay_review_limit_reached';
  summary: LearnEntitlementSummary;
}

const LEARN_RULES: Record<BillingTier, LearnQuotaRules> = {
  free: {
    microLessonsMax: 2,
    shortReviewsMax: 1,
    essayReviewsMax: 0
  },
  premium: {
    microLessonsMax: Number.POSITIVE_INFINITY,
    shortReviewsMax: Number.POSITIVE_INFINITY,
    essayReviewsMax: 10
  }
};

function learnQuotaRef(uid: string) {
  return sophiaDocumentsDb.collection('users').doc(uid).collection('learn').doc('quota');
}

function defaultLearnEntitlements(): LearnEntitlementState {
  return {
    month_key: currentMonthKeyUtc(),
    micro_lessons_completed: 0,
    short_reviews_used: 0,
    essay_reviews_used: 0
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
    essay_reviews_used: Number.isFinite(obj.essay_reviews_used) ? Number(obj.essay_reviews_used) : 0
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
    essayReviewsRemaining: monthlyValue(state.essay_reviews_used, rules.essayReviewsMax)
  };
}

function ensureMonth(state: LearnEntitlementState): LearnEntitlementState {
  const currentMonth = currentMonthKeyUtc();
  if (state.month_key === currentMonth) return state;
  return {
    month_key: currentMonth,
    micro_lessons_completed: 0,
    short_reviews_used: 0,
    essay_reviews_used: 0
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
  return { allowed: false, reason: 'essay_review_limit_reached', next: state };
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

  return sophiaDocumentsDb.runTransaction(async (tx) => {
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
      summary: summarize(billing.effectiveTier, decision.next)
    };
  });
}
