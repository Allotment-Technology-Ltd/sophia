import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
  getRestormelRecommendationSupport,
  requestRestormelRecommendation,
  RestormelRecommendationUnavailableError,
  type RestormelRecommendationActionType
} from '$lib/server/restormelRecommendations';
import { parseJsonBody } from '$lib/server/restormelAdmin';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  const payload = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const actionType = payload.actionType;
  if (typeof actionType !== 'string') {
    return json({ error: 'actionType is required' }, { status: 400 });
  }

  try {
    const response = await requestRestormelRecommendation({
      ...payload,
      routeId: params.routeId,
      actionType: actionType as RestormelRecommendationActionType
    });

    return json(response);
  } catch (error) {
    if (error instanceof RestormelRecommendationUnavailableError) {
      return json(
        {
          error: error.code,
          detail: error.detail,
          support: getRestormelRecommendationSupport(),
          recommendation: null
        },
        { status: error.status }
      );
    }

    return json(
      {
        error: 'recommendation_request_failed',
        detail: error instanceof Error ? error.message : 'Unknown error',
        support: getRestormelRecommendationSupport(),
        recommendation: null
      },
      { status: 500 }
    );
  }
};
