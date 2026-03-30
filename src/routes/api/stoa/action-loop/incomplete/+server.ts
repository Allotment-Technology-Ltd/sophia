import { json, type RequestHandler } from '@sveltejs/kit';
import { listIncompleteActionItems } from '$lib/server/stoa/sessionStore';

export const GET: RequestHandler = async ({ locals, url }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const lookbackDays = Number.parseInt(url.searchParams.get('lookbackDays') ?? '14', 10);
  const items = await listIncompleteActionItems({
    userId: uid,
    lookbackDays: Number.isFinite(lookbackDays) ? lookbackDays : 14
  });
  return json({ items });
};
