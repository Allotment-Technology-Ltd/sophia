import { json, type RequestHandler } from '@sveltejs/kit';
import { listRelevantJournalEntries } from '$lib/server/stoa/sessionStore';

export const GET: RequestHandler = async ({ locals, url }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const message = (url.searchParams.get('message') ?? '').trim();
  if (!message) return json({ items: [] });
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '3', 10);
  const items = await listRelevantJournalEntries({
    userId: uid,
    message,
    limit: Number.isFinite(limit) ? limit : 3
  });
  return json({ items });
};
