import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user?.uid) return json({ error: 'Authentication required' }, { status: 401 });
  await request.arrayBuffer();
  return json({ error: 'wallet_topups_removed' }, { status: 410 });
};
