import { redirect } from '@sveltejs/kit';
import { hasOwnerRole } from '$lib/server/authRoles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user && !hasOwnerRole(locals.user)) {
    throw redirect(302, '/access-denied');
  }
  return {};
};
