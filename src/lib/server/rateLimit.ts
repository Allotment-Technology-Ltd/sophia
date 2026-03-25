import { adminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const DAILY_QUERY_LIMIT = 20;
export type PlatformBudgetPlan = 'free' | 'founder' | 'pro' | 'premium';

export const PLATFORM_STANDARD_SEARCH_LIMITS: Record<PlatformBudgetPlan, number> = {
  free: 5,
  founder: 10,
  pro: 10,
  premium: 20
};
export const PLATFORM_DEEP_SEARCH_LIMITS: Record<PlatformBudgetPlan, number> = {
  free: 0,
  founder: 3,
  pro: 3,
  premium: 3
};
export const PLATFORM_PREMIUM_SEARCH_LIMITS: Record<PlatformBudgetPlan, number> = {
  free: 0,
  founder: 1,
  pro: 1,
  premium: 1
};
export const PLATFORM_DAILY_BUDGET_CREDITS = 12; // 12 half-units = 6 standard-equivalent queries
export const PLATFORM_QUICK_QUERY_CREDITS = 1; // 0.5 standard
export const PLATFORM_STANDARD_QUERY_CREDITS = 2; // 1.0 standard

export type QueryKind = 'new' | 'follow_up' | 'rerun';
export type PlatformBudgetDenyReason =
  | 'deep_requires_byok'
  | 'deep_limit_reached'
  | 'premium_limit_reached'
  | 'standard_limit_reached'
  | 'follow_up_limit_reached'
  | 'budget_exhausted';

interface PlatformBudgetRecord {
  date?: string;
  budget_credits_used?: number;
  standard_queries?: number;
  follow_up_queries?: number;
  deep_queries?: number;
  premium_queries?: number;
}

export interface PlatformBudgetResult {
  allowed: boolean;
  remainingCredits: number;
  standardQueries: number;
  followUpQueries: number;
  deepQueries: number;
  premiumQueries: number;
  standardLimit: number;
  deepLimit: number;
  premiumLimit: number;
  reason?: PlatformBudgetDenyReason;
}

export function resolvePlatformStandardSearchLimit(plan: PlatformBudgetPlan = 'free'): number {
  return PLATFORM_STANDARD_SEARCH_LIMITS[plan] ?? PLATFORM_STANDARD_SEARCH_LIMITS.free;
}
export function resolvePlatformDeepSearchLimit(plan: PlatformBudgetPlan = 'free'): number {
  return PLATFORM_DEEP_SEARCH_LIMITS[plan] ?? PLATFORM_DEEP_SEARCH_LIMITS.free;
}
export function resolvePlatformPremiumSearchLimit(plan: PlatformBudgetPlan = 'free'): number {
  return PLATFORM_PREMIUM_SEARCH_LIMITS[plan] ?? PLATFORM_PREMIUM_SEARCH_LIMITS.free;
}

/** Returns today's date as YYYY-MM-DD in UTC. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Check and increment the per-user daily query counter.
 * Uses a Firestore transaction so concurrent requests cannot both slip past the limit.
 */
export async function checkRateLimit(uid: string): Promise<{ allowed: boolean; remaining: number }> {
  const ref = adminDb.collection('users').doc(uid).collection('rateLimits').doc('daily');
  const today = todayUtc();

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();

    const currentDate: string = data?.date ?? '';
    const currentCount: number = currentDate === today ? (data?.count ?? 0) : 0;

    if (currentCount >= DAILY_QUERY_LIMIT) {
      return { allowed: false, remaining: 0 };
    }

    if (currentDate === today) {
      tx.update(ref, { count: FieldValue.increment(1) });
    } else {
      tx.set(ref, { date: today, count: 1 });
    }

    return { allowed: true, remaining: DAILY_QUERY_LIMIT - currentCount - 1 };
  });
}

function toRemainingCredits(used: number): number {
  return Math.max(0, PLATFORM_DAILY_BUDGET_CREDITS - used);
}

function queryCredits(depthMode: 'quick' | 'standard' | 'deep'): number {
  if (depthMode === 'quick') return PLATFORM_QUICK_QUERY_CREDITS;
  return PLATFORM_STANDARD_QUERY_CREDITS;
}

/**
 * Consume daily platform-funded query budget for users without BYOK.
 * Deep mode is always denied here; caller should require BYOK for deep queries.
 */
export async function consumePlatformBudget(
  uid: string,
  options: {
    depthMode: 'quick' | 'standard' | 'deep';
    resourceMode?: 'standard' | 'expanded';
    queryKind?: QueryKind;
    plan?: PlatformBudgetPlan;
    /** When true, do not read or write platform daily budget counters (application owner). */
    bypassQuota?: boolean;
  }
): Promise<PlatformBudgetResult> {
  const standardLimit = resolvePlatformStandardSearchLimit(options.plan ?? 'free');
  const deepLimit = resolvePlatformDeepSearchLimit(options.plan ?? 'free');
  const premiumLimit = resolvePlatformPremiumSearchLimit(options.plan ?? 'free');

  if (options.bypassQuota) {
    return {
      allowed: true,
      remainingCredits: PLATFORM_DAILY_BUDGET_CREDITS,
      standardQueries: 0,
      followUpQueries: 0,
      deepQueries: 0,
      premiumQueries: 0,
      standardLimit,
      deepLimit,
      premiumLimit
    };
  }

  if (options.depthMode === 'deep' && deepLimit <= 0) {
    return {
      allowed: false,
      reason: 'deep_requires_byok',
      remainingCredits: 0,
      standardQueries: 0,
      followUpQueries: 0,
      deepQueries: 0,
      premiumQueries: 0,
      standardLimit,
      deepLimit,
      premiumLimit
    };
  }

  const ref = adminDb.collection('users').doc(uid).collection('rateLimits').doc('platformDaily');
  const today = todayUtc();
  const isFollowUp = options.queryKind === 'follow_up';
  const isStandardNewQuery = !isFollowUp && options.depthMode === 'standard';
  const isDeepQuery = options.depthMode === 'deep';
  const isPremiumQuery = options.resourceMode === 'expanded';
  const creditsToConsume = queryCredits(options.depthMode);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() ?? {}) as PlatformBudgetRecord;
    const activeDate = data.date === today ? data.date : today;
    const budgetCreditsUsed = data.date === today ? (data.budget_credits_used ?? 0) : 0;
    const standardQueries = data.date === today ? (data.standard_queries ?? 0) : 0;
    const followUpQueries = data.date === today ? (data.follow_up_queries ?? 0) : 0;
    const deepQueries = data.date === today ? (data.deep_queries ?? 0) : 0;
    const premiumQueries = data.date === today ? (data.premium_queries ?? 0) : 0;

    if (isDeepQuery && deepQueries >= deepLimit) {
      return {
        allowed: false,
        reason: 'deep_limit_reached' as const,
        remainingCredits: toRemainingCredits(budgetCreditsUsed),
        standardQueries,
        followUpQueries,
        deepQueries,
        premiumQueries,
        standardLimit,
        deepLimit,
        premiumLimit
      };
    }

    if (isPremiumQuery && premiumQueries >= premiumLimit) {
      return {
        allowed: false,
        reason: 'premium_limit_reached' as const,
        remainingCredits: toRemainingCredits(budgetCreditsUsed),
        standardQueries,
        followUpQueries,
        deepQueries,
        premiumQueries,
        standardLimit,
        deepLimit,
        premiumLimit
      };
    }

    if (isStandardNewQuery && standardQueries >= standardLimit) {
      return {
        allowed: false,
        reason: 'standard_limit_reached' as const,
        remainingCredits: toRemainingCredits(budgetCreditsUsed),
        standardQueries,
        followUpQueries,
        deepQueries,
        premiumQueries,
        standardLimit,
        deepLimit,
        premiumLimit
      };
    }

    if (isFollowUp && followUpQueries >= standardQueries) {
      return {
        allowed: false,
        reason: 'follow_up_limit_reached' as const,
        remainingCredits: toRemainingCredits(budgetCreditsUsed),
        standardQueries,
        followUpQueries,
        deepQueries,
        premiumQueries,
        standardLimit,
        deepLimit,
        premiumLimit
      };
    }

    if (budgetCreditsUsed + creditsToConsume > PLATFORM_DAILY_BUDGET_CREDITS) {
      return {
        allowed: false,
        reason: 'budget_exhausted' as const,
        remainingCredits: toRemainingCredits(budgetCreditsUsed),
        standardQueries,
        followUpQueries,
        deepQueries,
        premiumQueries,
        standardLimit,
        deepLimit,
        premiumLimit
      };
    }

    const nextBudgetCreditsUsed = budgetCreditsUsed + creditsToConsume;
    const nextStandardQueries = standardQueries + (isStandardNewQuery ? 1 : 0);
    const nextFollowUpQueries = followUpQueries + (isFollowUp ? 1 : 0);
    const nextDeepQueries = deepQueries + (isDeepQuery ? 1 : 0);
    const nextPremiumQueries = premiumQueries + (isPremiumQuery ? 1 : 0);

    tx.set(
      ref,
      {
        date: activeDate,
        budget_credits_used: nextBudgetCreditsUsed,
        standard_queries: nextStandardQueries,
        follow_up_queries: nextFollowUpQueries,
        deep_queries: nextDeepQueries,
        premium_queries: nextPremiumQueries,
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      allowed: true,
      remainingCredits: toRemainingCredits(nextBudgetCreditsUsed),
      standardQueries: nextStandardQueries,
      followUpQueries: nextFollowUpQueries,
      deepQueries: nextDeepQueries,
      premiumQueries: nextPremiumQueries,
      standardLimit,
      deepLimit,
      premiumLimit
    };
  });
}
