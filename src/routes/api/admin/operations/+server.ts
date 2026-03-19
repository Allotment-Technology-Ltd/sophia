import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ZodError } from 'zod';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
  createAdminOperation,
  listAdminOperations
} from '$lib/server/adminOperations';

export const GET: RequestHandler = async ({ locals, url }) => {
  assertAdminAccess(locals);
  const limitRaw = Number(url.searchParams.get('limit') ?? '25');
  const limit = Number.isFinite(limitRaw) ? limitRaw : 25;
  const operations = await listAdminOperations(limit);
  return json({ operations });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const actor = assertAdminAccess(locals);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const operation = await createAdminOperation(actor, body);
    return json({ operation }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(
        {
          error: 'Invalid admin operation payload',
          issues: error.issues
        },
        { status: 400 }
      );
    }
    throw error;
  }
};
