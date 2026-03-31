import { error, redirect } from '@sveltejs/kit';
import { hasOwnerRole } from '$lib/server/authRoles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const enabled = (process.env.ENABLE_LEARN_MODULE ?? 'false').toLowerCase() === 'true';
  if (!enabled) {
    throw error(404, 'Learn module is disabled');
  }
  if (locals.user && !hasOwnerRole(locals.user)) {
    throw redirect(302, '/access-denied');
  }
  return {
    enabled,
    publicLearnEnabled: (process.env.PUBLIC_ENABLE_LEARN_MODULE ?? 'false').toLowerCase() === 'true'
  };
};
