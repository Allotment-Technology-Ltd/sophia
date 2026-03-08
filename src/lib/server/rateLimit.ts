import { adminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const DAILY_QUERY_LIMIT = 20;

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
