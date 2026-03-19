import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getAdminOperation } from '$lib/server/adminOperations';

export const GET: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);
  const operation = await getAdminOperation(params.id);
  if (!operation) {
    return json({ error: 'Operation not found' }, { status: 404 });
  }
  return json({ operation });
};
