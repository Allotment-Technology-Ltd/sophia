import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
  restormelListRouteSteps,
  restormelReplaceRouteSteps,
  type RestormelStepRecord
} from '$lib/server/restormel';
import { parseJsonBody, restormelJsonError } from '$lib/server/restormelAdmin';

export const GET: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);
  try {
    const response = await restormelListRouteSteps(params.routeId);
    return json({ steps: response.data });
  } catch (error) {
    return restormelJsonError(error);
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const raw = body ?? {};
    const stepsArray = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as Record<string, unknown>).steps)
        ? (raw as Record<string, unknown>).steps
        : null;
    if (!stepsArray) {
      return json({ error: 'Expected a JSON array of steps or { steps: [...] }' }, { status: 400 });
    }
    const response = await restormelReplaceRouteSteps(
      params.routeId,
      stepsArray as RestormelStepRecord[]
    );
    return json({ steps: response.data });
  } catch (error) {
    return restormelJsonError(error);
  }
};

