import { FieldValue, Timestamp } from '$lib/server/fsCompat';
import { adminDb } from '$lib/server/firebase-admin';

export const APP_USER_ROLE_VALUES = ['user', 'owner'] as const;
export type AppUserRole = (typeof APP_USER_ROLE_VALUES)[number];

export interface AuthenticatedUserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  authProvider?: 'neon';
}

export interface UserRoleRecord {
  role: AppUserRole;
  roles: AppUserRole[];
}

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function getSeedOwnerEmails(): Set<string> {
  const configured = process.env.OWNER_EMAILS?.trim();
  const emails = configured
    ? configured.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
    : [];
  return new Set(emails);
}

const SEEDED_OWNER_EMAILS = getSeedOwnerEmails();

export function isSeedOwnerEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return SEEDED_OWNER_EMAILS.has(normalized);
}

/** Legacy Firestore / JWT fallback may still contain `administrator`; treat as owner. */
export function migrateLegacyRoleToken(role: unknown): AppUserRole | null {
  if (role === 'owner' || role === 'administrator') return 'owner';
  if (role === 'user') return 'user';
  return null;
}

function normalizeRoles(input: unknown, fallback: AppUserRole): AppUserRole[] {
  if (!Array.isArray(input)) return [fallback];
  const roles = input
    .map((value) => migrateLegacyRoleToken(value))
    .filter((value): value is AppUserRole => value === 'user' || value === 'owner');
  return roles.length > 0 ? roles : [fallback];
}

function resolvePrimaryRole(data: Record<string, unknown> | undefined, email: string | null): AppUserRole {
  if (email && SEEDED_OWNER_EMAILS.has(email)) {
    return 'owner';
  }
  const migrated = migrateLegacyRoleToken(data?.role);
  if (migrated) return migrated;
  return 'user';
}

export function hasOwnerRole(user: { role?: string | null; roles?: string[] | null } | null | undefined): boolean {
  if (!user) return false;
  if (migrateLegacyRoleToken(user.role) === 'owner') return true;
  return (
    Array.isArray(user.roles) && user.roles.some((r) => migrateLegacyRoleToken(r) === 'owner')
  );
}

/**
 * When the same person signs in with Neon Auth, `sub` differs from the old Firebase `uid`.
 * Merge app roles from other `users/*` docs that share the normalized email (Firebase-era rows).
 */
async function legacyAppRolesFromOtherUserDocsByEmail(
  email: string | null,
  currentUid: string
): Promise<AppUserRole[]> {
  if (!email) return [];
  try {
    const snap = await adminDb.collection('users').where('email', '==', email).limit(25).get();
    const found: AppUserRole[] = [];
    for (const doc of snap.docs) {
      if (doc.id === currentUid) continue;
      const d = doc.data() as Record<string, unknown>;
      const single = migrateLegacyRoleToken(d.role);
      if (single) found.push(single);
      for (const r of normalizeRoles(d.roles, 'user')) {
        found.push(r);
      }
    }
    return found;
  } catch (err) {
    console.warn(
      '[AUTH] legacy user role lookup by email failed:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

export async function syncAuthenticatedUserRole(
  profile: AuthenticatedUserProfile
): Promise<UserRoleRecord> {
  const email = normalizeEmail(profile.email);
  const ref = adminDb.collection('users').doc(profile.uid);
  const snapshot = await ref.get();
  const existing = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined;

  const primaryRole = resolvePrimaryRole(existing, email);
  const existingRoles = normalizeRoles(existing?.roles, primaryRole);
  const legacyFromFirebaseUid =
    profile.authProvider === 'neon' ? await legacyAppRolesFromOtherUserDocsByEmail(email, profile.uid) : [];
  const roles = Array.from(
    new Set<AppUserRole>([
      ...existingRoles,
      primaryRole,
      ...legacyFromFirebaseUid,
      ...(email && SEEDED_OWNER_EMAILS.has(email) ? (['owner'] as AppUserRole[]) : [])
    ])
  );
  const role: AppUserRole = roles.includes('owner') ? 'owner' : 'user';

  await ref.set(
    {
      email,
      display_name: profile.displayName,
      photo_url: profile.photoURL,
      role,
      roles,
      auth: {
        provider: 'neon_auth',
        last_authenticated_at: Timestamp.now()
      },
      updated_at: Timestamp.now(),
      last_login_at: Timestamp.now(),
      created_at: snapshot.exists ? existing?.created_at ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return { role, roles };
}

/** True if this Firestore user document represents an owner (includes legacy `administrator`). */
export function isOwnerUserDoc(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  if (migrateLegacyRoleToken(data.role) === 'owner') return true;
  const arr = data.roles;
  if (!Array.isArray(arr)) return false;
  return arr.some((r) => migrateLegacyRoleToken(r) === 'owner');
}

/** True when changing this target to `user` would remove the last owner account. */
export function isLastOwnerDemotion(params: {
  newRole: AppUserRole;
  targetWasOwner: boolean;
  ownerCount: number;
}): boolean {
  if (params.newRole !== 'user' || !params.targetWasOwner) return false;
  return params.ownerCount <= 1;
}

export async function countOwnerUsersInFirestore(): Promise<number> {
  const snap = await adminDb.collection('users').get();
  let n = 0;
  for (const doc of snap.docs) {
    if (isOwnerUserDoc(doc.data() as Record<string, unknown>)) n += 1;
  }
  return n;
}

export async function assignOwnerRoleByEmail(email: string): Promise<{ uid: string | null; role: AppUserRole; roles: AppUserRole[] }> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('A valid email is required to assign owner role.');
  }

  const snapshot = await adminDb
    .collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return { uid: null, role: 'owner', roles: ['owner'] };
  }

  const doc = snapshot.docs[0];
  const data = doc.data() as Record<string, unknown>;
  const roles = Array.from(new Set<AppUserRole>([...normalizeRoles(data.roles, 'owner'), 'owner']));

  await doc.ref.set(
    {
      role: 'owner',
      roles,
      updated_at: Timestamp.now()
    },
    { merge: true }
  );

  return { uid: doc.id, role: 'owner', roles };
}
