import { adminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const DAILY_QUERY_LIMIT = 20;
export const PLATFORM_STANDARD_SEARCH_LIMIT = 3;
export const PLATFORM_DAILY_BUDGET_CREDITS = 12; // 12 half-units = 6 standard-equivalent queries
export const PLATFORM_QUICK_QUERY_CREDITS = 1; // 0.5 standard
export const PLATFORM_STANDARD_QUERY_CREDITS = 2; // 1.0 standard

export type QueryKind = 'new' | 'follow_up' | 'rerun';
export type PlatformBudgetDenyReason =
  | 'deep_requires_byok'
  | 'standard_limit_reached'
  | 'follow_up_limit_reached'
  | 'budget_exhausted';

interface PlatformBudgetRecord {
  date?: string;
  budget_credits_used?: number;
  standard_queries?: number;
  follow_up_queries?: number;
}

export interface PlatformBudgetResult {
  allowed: boolean;
  remainingCredits: number;
  standardQueries: number;
  followUpQueries: number;
  reason?: PlatformBudgetDenyReason;
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
    queryKind?: QueryKind;
  }
): Promise<PlatformBudgetResult> {
  if (options.depthMode === 'deep') {
    return {
      allowed: false,
      reason: 'deep_requires_byok',
      remainingCredits: 0,
      standardQueries: 0,
      followUpQueries: 0
    };
  }

  const ref = adminDb.collection('users').doc(uid).collection('rateLimits').doc('platformDaily');
  const today = todayUtc();
  const isFollowUp = options.queryKind === 'follow_up';
  const isStandardNewQuery = !isFollowUp && options.depthMode === 'standard';
  const creditsToConsume = queryCredits(options.depthMode);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() ?? {}) as PlatformBudgetRecord;
    const activeDate = data.date === today ? data.date : today;
    const budgetCreditsUsed = data.date === today ? (data.budget_credits_used ?? 0) : 0;
    const standardQueries = data.date === today ? (data.standard_queries ?? 0) : 0;
    const followUpQueries = data.date === today ? (data.follow_up_queries ?? 0) : 0;

    if (isStandardNewQuery && standardQueries >= PLATFORM_STANDARD_SEARCH_LIMIT) {
      return {
        allowed: false,
        reason: 'standard_limit_reached' as const,
        remainingCredits: toRemainingCredits(budgetCreditsUsed),
        standardQueries,
        followUpQueries
      };
    }

    if (isFollowUp && followUpQueries >= standardQueries) {
      return {
        allowed: false,
        reason: 'follow_up_limit_reached' as const,
        remainingCredits: toRemainingCredits(budgetCreditsUsed),
        standardQueries,
        followUpQueries
      };
    }

    if (budgetCreditsUsed + creditsToConsume > PLATFORM_DAILY_BUDGET_CREDITS) {
      return {
        allowed: false,
        reason: 'budget_exhausted' as const,
        remainingCredits: toRemainingCredits(budgetCreditsUsed),
        standardQueries,
        followUpQueries
      };
    }

    const nextBudgetCreditsUsed = budgetCreditsUsed + creditsToConsume;
    const nextStandardQueries = standardQueries + (isStandardNewQuery ? 1 : 0);
    const nextFollowUpQueries = followUpQueries + (isFollowUp ? 1 : 0);

    tx.set(
      ref,
      {
        date: activeDate,
        budget_credits_used: nextBudgetCreditsUsed,
        standard_queries: nextStandardQueries,
        follow_up_queries: nextFollowUpQueries,
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      allowed: true,
      remainingCredits: toRemainingCredits(nextBudgetCreditsUsed),
      standardQueries: nextStandardQueries,
      followUpQueries: nextFollowUpQueries
    };
  });
}
