import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAvailableReasoningModels } from '$lib/server/vertex';

export const GET: RequestHandler = async () => {
  const models = getAvailableReasoningModels();
  return json({
    defaults: {
      mode: 'auto'
    },
    models
  });
};
