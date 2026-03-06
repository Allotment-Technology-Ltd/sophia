import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminDb } from '$lib/server/firebase-admin';

type HistoryEntry = {
  id: string;
  question: string;
  timestamp: string; // ISO string
  passCount: number;
};

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const snapshot = await adminDb
      .collection('users').doc(uid)
      .collection('queries')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const entries: HistoryEntry[] = snapshot.docs.map(doc => {
      const data = doc.data();
      const events = Array.isArray(data.events) ? data.events : [];
      const passCount = events.filter((e: { type: string }) => e.type === 'pass_complete').length;

      return {
        id: doc.id,
        question: data.query ?? '',
        timestamp: data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
        passCount: Math.max(1, passCount),
      };
    });

    return json({ entries });
  } catch (err) {
    console.error('[HISTORY] Fetch failed:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Failed to load history' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const entryId = url.searchParams.get('id');
  if (!entryId) {
    return json({ error: 'id query param is required' }, { status: 400 });
  }

  try {
    await adminDb
      .collection('users').doc(uid)
      .collection('queries').doc(entryId)
      .delete();

    return json({ ok: true });
  } catch (err) {
    console.error('[HISTORY] Delete failed:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Failed to delete entry' }, { status: 500 });
  }
};
