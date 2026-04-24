import { hasOwnerRole, isSeedOwnerEmail, syncAuthenticatedUserRole, type UserRoleRecord } from '$lib/server/authRoles';
import { verifyBearerTokenForApi } from '$lib/server/bearerAuthVerification';
import { problemJson, resolveRequestId } from '$lib/server/problem';
import type { Handle, RequestEvent } from '@sveltejs/kit';

/** Avoid CDN / browser caching of API responses (stale 404s after deploys; auth varies by caller). */
function withApiCacheHeaders(event: RequestEvent, response: Response): Response {
  if (event.url.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  }
  return response;
}

export const handle: Handle = async ({ event, resolve }) => {
  // Only enforce Bearer token auth on protected API routes.
  // Page navigation doesn't send Bearer tokens — auth for pages is handled
  // client-side via onAuthStateChanged in the layout.
  const isProtectedApi =
    event.url.pathname.startsWith('/api/') &&
    !event.url.pathname.startsWith('/api/health') &&
    !event.url.pathname.startsWith('/api/v1/verify') &&
    !event.url.pathname.startsWith('/api/billing/webhook') &&
    !event.url.pathname.startsWith('/api/early-access/');

  if (isProtectedApi) {
    const requestId = resolveRequestId(event.request);
    const authHeader = event.request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return withApiCacheHeaders(
        event,
        problemJson({
          status: 401,
          title: 'Authentication required',
          detail: 'Provide a valid Neon Auth JWT in the Authorization header.',
          requestId
        })
      );
    }

    try {
      const token = authHeader.slice(7);
      const profile = await verifyBearerTokenForApi(token);
      let roleRecord: UserRoleRecord = {
        role: 'user',
        roles: ['user']
      };

      try {
        roleRecord = await syncAuthenticatedUserRole({
          uid: profile.uid,
          email: profile.email,
          displayName: profile.displayName,
          photoURL: profile.photoURL,
          authProvider: profile.authProvider
        });
      } catch (roleSyncError) {
        console.warn(
          '[AUTH] role sync failed, falling back to seeded role:',
          roleSyncError instanceof Error ? roleSyncError.message : String(roleSyncError)
        );
      }

      event.locals.user = {
        uid: profile.uid,
        email: profile.email,
        displayName: profile.displayName,
        photoURL: profile.photoURL,
        role: roleRecord.role,
        roles: roleRecord.roles
      };
    } catch (err) {
      console.warn(
        '[AUTH] bearer verification failed:',
        err instanceof Error ? err.message : String(err)
      );
      return withApiCacheHeaders(
        event,
        problemJson({
          status: 401,
          title: 'Authentication failed',
          detail: 'The provided bearer token is invalid or expired.',
          requestId
        })
      );
    }

    const isOwnerRestrictedApi =
      event.url.pathname.startsWith('/api/stoa') || event.url.pathname.startsWith('/api/learn');
    if (isOwnerRestrictedApi && !hasOwnerRole(event.locals.user)) {
      return withApiCacheHeaders(
        event,
        problemJson({
          status: 403,
          title: 'Forbidden',
          detail: 'Owner access is required for this module.',
          requestId
        })
      );
    }
  }

  return withApiCacheHeaders(event, await resolve(event));
};
