import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { passesEarlyAccessAllowlist } from '$lib/server/accessAllowlist';

/**
 * Bearer-authenticated check for the early-access allowlist (`ALLOWED_EMAILS`).
 * Used by the root layout after sign-in; owners / OWNER_EMAILS bypass.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const user = locals.user;
  if (!user?.uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!passesEarlyAccessAllowlist({ email: user.email, user })) {
    return json({ error: 'early_access_denied' }, { status: 403 });
  }

  return json({ ok: true });
};
