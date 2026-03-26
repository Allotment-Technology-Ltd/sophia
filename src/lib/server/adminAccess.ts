import { error, redirect } from '@sveltejs/kit';
import { hasOwnerRole } from '$lib/server/authRoles';

export interface AdminActor {
  uid: string;
  email?: string | null;
}

/** Admin APIs and operator UI: owners only. */
export function assertAdminAccess(locals: App.Locals): AdminActor {
  if (!locals.user) {
    throw redirect(302, '/auth');
  }

  if (!hasOwnerRole(locals.user)) {
    throw error(403, 'Forbidden: Owner access required');
  }

  return {
    uid: locals.user.uid,
    email: locals.user.email ?? null
  };
}

export function isOwnerLocals(locals: App.Locals): boolean {
  return hasOwnerRole(locals.user);
}
