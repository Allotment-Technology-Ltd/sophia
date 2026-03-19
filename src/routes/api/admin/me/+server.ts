import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hasAdministratorRole } from '$lib/server/authRoles';

export const GET: RequestHandler = async ({ locals }) => {
  const user = locals.user;
  if (!user?.uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  return json({
    user: {
      uid: user.uid,
      email: user.email,
      role: user.role,
      roles: user.roles
    },
    is_admin: hasAdministratorRole(user)
  });
};
