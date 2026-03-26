import { json } from '@sveltejs/kit';
import { Timestamp } from 'firebase-admin/firestore';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { adminDb } from '$lib/server/firebase-admin';
import {
  countOwnerUsersInFirestore,
  isLastOwnerDemotion,
  isOwnerUserDoc,
  type AppUserRole
} from '$lib/server/authRoles';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);

  const uid = params.uid?.trim();
  if (!uid) {
    return json({ error: 'uid required' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const roleRaw = (body as { role?: string })?.role;
  if (roleRaw !== 'owner' && roleRaw !== 'user') {
    return json({ error: 'role must be owner or user' }, { status: 400 });
  }
  const nextRole = roleRaw as AppUserRole;

  const ref = adminDb.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    return json({ error: 'User not found' }, { status: 404 });
  }

  const data = snap.data() as Record<string, unknown>;
  const wasOwner = isOwnerUserDoc(data);

  if (nextRole === 'user' && wasOwner) {
    const owners = await countOwnerUsersInFirestore();
    if (isLastOwnerDemotion({ newRole: nextRole, targetWasOwner: wasOwner, ownerCount: owners })) {
      return json(
        {
          error:
            'At least one owner is required. Promote another user to owner before demoting this account.'
        },
        { status: 400 }
      );
    }
  }

  await ref.set(
    {
      role: nextRole,
      roles: [nextRole],
      updated_at: Timestamp.now()
    },
    { merge: true }
  );

  return json({ ok: true, uid, role: nextRole });
};
