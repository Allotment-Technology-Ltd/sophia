import { adminAuth } from '$lib/server/firebase-admin';
import { isSeedAdministratorEmail, syncAuthenticatedUserRole, type UserRoleRecord } from '$lib/server/authRoles';
import { problemJson, resolveRequestId } from '$lib/server/problem';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  // Only enforce Bearer token auth on protected API routes.
  // Page navigation doesn't send Bearer tokens — auth for pages is handled
  // client-side via onAuthStateChanged in the layout.
  const isProtectedApi =
    event.url.pathname.startsWith('/api/') &&
    !event.url.pathname.startsWith('/api/health') &&
    !event.url.pathname.startsWith('/api/v1/verify') &&
    !event.url.pathname.startsWith('/api/billing/webhook');

  if (isProtectedApi) {
    const requestId = resolveRequestId(event.request);
    const authHeader = event.request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return problemJson({
        status: 401,
        title: 'Authentication required',
        detail: 'Provide a valid Firebase bearer token in Authorization header.',
        requestId
      });
    }

    try {
      const token = authHeader.slice(7);
      const decoded = await adminAuth.verifyIdToken(token);
      const fallbackRole = isSeedAdministratorEmail(decoded.email) ? 'administrator' : 'user';
      let roleRecord: UserRoleRecord = {
        role: fallbackRole,
        roles: [fallbackRole]
      };

      try {
        roleRecord = await syncAuthenticatedUserRole({
          uid: decoded.uid,
          email: decoded.email ?? null,
          displayName: decoded.name ?? null,
          photoURL: decoded.picture ?? null
        });
      } catch (roleSyncError) {
        console.warn(
          '[AUTH] role sync failed, falling back to seeded role:',
          roleSyncError instanceof Error ? roleSyncError.message : String(roleSyncError)
        );
      }

      event.locals.user = {
        uid: decoded.uid,
        email: decoded.email ?? null,
        displayName: decoded.name ?? null,
        photoURL: decoded.picture ?? null,
        role: roleRecord.role,
        roles: roleRecord.roles
      };
    } catch (err) {
      console.warn(
        '[AUTH] verifyIdToken failed:',
        err instanceof Error ? err.message : String(err)
      );
      return problemJson({
        status: 401,
        title: 'Authentication failed',
        detail: 'The provided Firebase bearer token is invalid.',
        requestId
      });
    }

  }

  return resolve(event);
};
