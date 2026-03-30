import { json, type RequestHandler } from '@sveltejs/kit';
import type { ActionLoopTimeframe } from '$lib/server/stoa/types';
import { upsertActionItems } from '$lib/server/stoa/sessionStore';

function isTimeframe(value: unknown): value is ActionLoopTimeframe {
  return value === 'today' || value === 'tonight' || value === 'this_week';
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid payload' }, { status: 400 });
  const sessionId = String((body as Record<string, unknown>).sessionId ?? '').trim();
  const suggestions = Array.isArray((body as Record<string, unknown>).suggestions)
    ? ((body as Record<string, unknown>).suggestions as Array<Record<string, unknown>>)
    : [];
  if (!sessionId) return json({ error: 'sessionId required' }, { status: 400 });
  const normalized = suggestions
    .map((item) => ({
      text: String(item.text ?? '').trim(),
      timeframe: isTimeframe(item.timeframe) ? item.timeframe : 'this_week',
      confidenceScore:
        typeof item.confidenceScore === 'number' && Number.isFinite(item.confidenceScore)
          ? Math.max(0, Math.min(item.confidenceScore, 1))
          : 0.6,
      sourceTurnId: typeof item.sourceTurnId === 'string' ? item.sourceTurnId : null
    }))
    .filter((item) => item.text.length > 0);
  await upsertActionItems({
    userId: uid,
    sessionId,
    items: normalized.map((item) => ({ ...item, origin: 'auto_detected' as const }))
  });
  return json({ added: normalized.length });
};
