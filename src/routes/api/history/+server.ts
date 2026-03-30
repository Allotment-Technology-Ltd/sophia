import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';
import type { ModelProvider } from '$lib/types/providers';

type HistoryEntry = {
  id: string;
  question: string;
  timestamp: string; // ISO string
  passCount: number;
  modelProvider?: ModelProvider;
  modelId?: string;
  depthMode?: 'quick' | 'standard' | 'deep';
  /** Reference URLs supplied for that inquiry run (when stored). */
  userLinks?: string[];
};

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const snapshot = await sophiaDocumentsDb
      .collection('users').doc(uid)
      .collection('queries')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const entries: HistoryEntry[] = snapshot.docs.map(doc => {
      const data = doc.data() ?? {};
      const events = Array.isArray(data.events) ? data.events : [];
      const passCount = events.filter((e: { type: string }) => e.type === 'pass_complete').length;
          const metadataEvent = events.find((e: { type?: string }) => e.type === 'metadata') as
            | {
            selected_model_provider?: ModelProvider;
            selected_model_id?: string;
            depth_mode?: 'quick' | 'standard' | 'deep';
          }
        | undefined;

      const storedLinks = data.user_links;
      const userLinks = Array.isArray(storedLinks)
        ? storedLinks.filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0)
        : undefined;

      return {
        id: doc.id,
        question: data.query ?? '',
        timestamp: data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
        passCount: Math.max(1, passCount),
        modelProvider: data.model_provider ?? metadataEvent?.selected_model_provider ?? undefined,
        modelId: data.model_id ?? metadataEvent?.selected_model_id ?? undefined,
        depthMode: data.depth_mode ?? metadataEvent?.depth_mode ?? undefined,
        userLinks: userLinks && userLinks.length > 0 ? userLinks : undefined
      };
    });

    return json({ entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[HISTORY] Fetch failed:', message);
    return json(
      {
        error: 'history_fetch_failed'
      },
      { status: 503 }
    );
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
    await sophiaDocumentsDb
      .collection('users').doc(uid)
      .collection('queries').doc(entryId)
      .delete();

    return json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[HISTORY] Delete failed; skipping:', message);
    return json({ ok: true, skipped: true });
  }
};
