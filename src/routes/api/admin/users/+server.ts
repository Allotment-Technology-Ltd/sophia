import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { adminDb } from '$lib/server/firebase-admin';
import { migrateLegacyRoleToken } from '$lib/server/authRoles';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);

  const snap = await adminDb.collection('users').get();
  const users = snap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    const role = migrateLegacyRoleToken(x.role) ?? 'user';
    return {
      uid: d.id,
      email: typeof x.email === 'string' ? x.email : null,
      display_name: typeof x.display_name === 'string' ? x.display_name : null,
      role
    };
  });

  users.sort((a, b) => {
    const ea = (a.email ?? '').toLowerCase();
    const eb = (b.email ?? '').toLowerCase();
    return ea.localeCompare(eb);
  });

  return json({ users });
};
