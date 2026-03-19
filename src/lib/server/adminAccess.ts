import { error, redirect } from '@sveltejs/kit';
import { hasAdministratorRole } from '$lib/server/authRoles';

export interface AdminActor {
  uid: string;
  email?: string | null;
}

export function assertAdminAccess(locals: App.Locals): AdminActor {
  if (!locals.user) {
    throw redirect(302, '/auth');
  }

  if (!hasAdministratorRole(locals.user)) {
    throw error(403, 'Forbidden: Admin access required');
  }

  return {
    uid: locals.user.uid,
    email: locals.user.email ?? null
  };
}

export function isAdminLocals(locals: App.Locals): boolean {
  return hasAdministratorRole(locals.user);
}
