import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminDb } from '$lib/server/firebase-admin';

interface FeedbackPayload {
  queryId: string;
  passType: 'analysis' | 'critique' | 'synthesis';
  rating: 'up' | 'down';
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: FeedbackPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (!payload.queryId || !['analysis', 'critique', 'synthesis'].includes(payload.passType)) {
    return json({ error: 'Invalid feedback fields' }, { status: 400 });
  }

  if (!['up', 'down'].includes(payload.rating)) {
    return json({ error: 'Invalid rating' }, { status: 400 });
  }

  await adminDb
    .collection('feedback')
    .doc(payload.queryId)
    .collection('passes')
    .doc(payload.passType)
    .set(
      {
        uid,
        rating: payload.rating,
        passType: payload.passType,
        queryId: payload.queryId,
        updatedAt: new Date()
      },
      { merge: true }
    );

  return json({ ok: true });
};
