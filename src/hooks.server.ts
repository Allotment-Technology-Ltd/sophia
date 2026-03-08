import { adminAuth } from '$lib/server/firebase-admin';
import { checkRateLimit, DAILY_QUERY_LIMIT } from '$lib/server/rateLimit';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  // Only enforce Bearer token auth on protected API routes.
  // Page navigation doesn't send Bearer tokens — auth for pages is handled
  // client-side via onAuthStateChanged in the layout.
  const isProtectedApi =
    event.url.pathname.startsWith('/api/') &&
    !event.url.pathname.startsWith('/api/health');

  if (isProtectedApi) {
    const authHeader = event.request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      const token = authHeader.slice(7);
      const decoded = await adminAuth.verifyIdToken(token);
      event.locals.user = {
        uid: decoded.uid,
        email: decoded.email ?? null,
        displayName: decoded.name ?? null,
        photoURL: decoded.picture ?? null
      };
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Rate limit only applies to the analyse endpoint (the expensive AI call).
    if (event.url.pathname === '/api/analyse' && event.locals.user) {
      try {
        const { allowed, remaining } = await checkRateLimit(event.locals.user.uid);
        if (!allowed) {
          return new Response(
            JSON.stringify({ error: 'Daily query limit reached. Try again tomorrow.' }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'X-RateLimit-Limit': String(DAILY_QUERY_LIMIT),
                'X-RateLimit-Remaining': '0',
                'Retry-After': '86400',
              }
            }
          );
        }
        // Attach remaining count so route handlers can surface it if needed
        event.locals.rateLimitRemaining = remaining;
      } catch (err) {
        // Rate limit check failure is non-fatal — log and allow the request through
        console.error('[RATE_LIMIT] Check failed:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  return resolve(event);
};
