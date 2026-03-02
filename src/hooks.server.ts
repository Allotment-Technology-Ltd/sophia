import { adminAuth } from '$lib/server/firebase-admin';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  // Public routes that don't require auth
  const publicPaths = ['/api/health', '/auth'];

  if (publicPaths.some(p => event.url.pathname.startsWith(p))) {
    return resolve(event);
  }

  const authHeader = event.request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    // For page requests, redirect to auth page
    if (event.request.headers.get('Accept')?.includes('text/html')) {
      return new Response(null, { status: 302, headers: { Location: '/auth' } });
    }
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

  return resolve(event);
};
