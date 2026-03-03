import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  // Skip email check on public pages
  const publicPaths = ['/auth', '/access-denied'];
  if (publicPaths.some(p => url.pathname.startsWith(p))) {
    return {};
  }

  // User must be authenticated
  if (!locals.user) {
    throw redirect(302, '/auth');
  }

  // Check email allowlist for development gating
  const allowedEmailsEnv = process.env.ALLOWED_EMAILS || '';
  const allowedEmails = allowedEmailsEnv
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(e => e.length > 0);

  // If allowlist is configured and user email is not in it, deny access
  if (allowedEmails.length > 0 && locals.user.email) {
    const userEmail = locals.user.email.toLowerCase();
    if (!allowedEmails.includes(userEmail)) {
      throw redirect(302, '/access-denied');
    }
  }

  return {
    user: locals.user
  };
};
