import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { retryAdminOperation } from '$lib/server/adminOperations';

export const POST: RequestHandler = async ({ locals, params }) => {
  const actor = assertAdminAccess(locals);
  const operation = await retryAdminOperation(params.id, actor);
  if (!operation) {
    return json({ error: 'Operation not found' }, { status: 404 });
  }
  return json({ operation });
};
