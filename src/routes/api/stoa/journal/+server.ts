import { json, type RequestHandler } from '@sveltejs/kit';
import { createJournalEntry, listJournalEntries, listRelevantJournalEntries } from '$lib/server/stoa/sessionStore';

export const GET: RequestHandler = async ({ locals, url }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const message = url.searchParams.get('message')?.trim();
  if (message) {
    const items = await listRelevantJournalEntries({
      userId: uid,
      message,
      limit: Number.parseInt(url.searchParams.get('limit') ?? '3', 10) || 3
    });
    return json({ items });
  }
  const items = await listJournalEntries({
    userId: uid,
    limit: Number.parseInt(url.searchParams.get('limit') ?? '30', 10) || 30
  });
  return json({ items });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid payload' }, { status: 400 });
  const entryText = String((body as Record<string, unknown>).entryText ?? '').trim();
  const sessionId = String((body as Record<string, unknown>).sessionId ?? '').trim();
  if (entryText.length < 20) {
    return json({ error: 'Please write at least 20 characters.' }, { status: 400 });
  }
  if (!sessionId) return json({ error: 'sessionId required' }, { status: 400 });
  const themes = Array.isArray((body as Record<string, unknown>).themes)
    ? ((body as Record<string, unknown>).themes as unknown[])
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
    : [];
  await createJournalEntry({ userId: uid, sessionId, entryText, themes });
  return json({ ok: true });
};
