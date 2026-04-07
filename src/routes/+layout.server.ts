import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { passesEarlyAccessAllowlist } from '$lib/server/accessAllowlist';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  // Skip email check on public pages
  const publicPaths = [
    '/',
    '/landing',
    '/pricing',
    '/privacy',
    '/terms',
    '/legal/changelog',
    '/auth',
    '/early-access',
    '/access-denied',
    '/api-access',
    '/developer'
  ];
  if (publicPaths.some(p => url.pathname.startsWith(p))) {
    return {};
  }

  // Early access (ALLOWED_EMAILS): owners / OWNER_EMAILS bypass — see accessAllowlist.ts + /api/access/allow
  if (locals.user?.email && !passesEarlyAccessAllowlist({ email: locals.user.email, user: locals.user })) {
    throw redirect(302, '/access-denied');
  }

  return {
    user: locals.user ?? null
  };
};
