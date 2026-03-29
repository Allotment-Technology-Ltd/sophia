import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Legacy endpoint retired in Phase 7 cleanup.
 * Clients should call `/api/analyse` instead.
 */
export const POST: RequestHandler = async () => {
  return json(
    {
      error: 'deprecated_endpoint',
      detail: 'Use /api/analyse for SSE analysis responses.'
    },
    { status: 410 }
  );
};
