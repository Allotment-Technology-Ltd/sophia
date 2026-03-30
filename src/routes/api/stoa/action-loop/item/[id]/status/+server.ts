import { json, type RequestHandler } from '@sveltejs/kit';
import type { ActionItemStatus } from '$lib/server/stoa/types';
import { updateActionItemStatus } from '$lib/server/stoa/sessionStore';

function isStatus(value: unknown): value is ActionItemStatus {
  return value === 'pending' || value === 'done' || value === 'archived' || value === 'carried_forward';
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const status = isStatus((body as Record<string, unknown> | null)?.status)
    ? ((body as Record<string, unknown>).status as ActionItemStatus)
    : null;
  if (!status) return json({ error: 'Invalid status' }, { status: 400 });
  const itemId = params.id;
  if (!itemId) return json({ error: 'item id required' }, { status: 400 });
  await updateActionItemStatus({ userId: uid, itemId, status });
  return json({ ok: true });
};
