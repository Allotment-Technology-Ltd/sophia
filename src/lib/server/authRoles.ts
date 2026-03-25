import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '$lib/server/firebase-admin';

export const APP_USER_ROLE_VALUES = ['user', 'administrator', 'owner'] as const;
export type AppUserRole = typeof APP_USER_ROLE_VALUES[number];

export interface AuthenticatedUserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface UserRoleRecord {
  role: AppUserRole;
  roles: AppUserRole[];
}

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function getSeedAdministratorEmails(): Set<string> {
  const configured = process.env.ADMINISTRATOR_EMAILS?.trim();
  const emails = configured
    ? configured.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
    : ['adam.boon1984@googlemail.com'];
  return new Set(emails);
}

const SEEDED_ADMINISTRATOR_EMAILS = getSeedAdministratorEmails();

function getSeedOwnerEmails(): Set<string> {
  const configured = process.env.OWNER_EMAILS?.trim();
  const emails = configured
    ? configured.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
    : [];
  return new Set(emails);
}

const SEEDED_OWNER_EMAILS = getSeedOwnerEmails();

export function isSeedAdministratorEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return SEEDED_ADMINISTRATOR_EMAILS.has(normalized);
}

export function isSeedOwnerEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return SEEDED_OWNER_EMAILS.has(normalized);
}

function normalizeRoles(input: unknown, fallback: AppUserRole): AppUserRole[] {
  if (!Array.isArray(input)) return [fallback];
  const roles = input.filter(
    (value): value is AppUserRole => value === 'user' || value === 'administrator' || value === 'owner'
  );
  return roles.length > 0 ? roles : [fallback];
}

function resolvePrimaryRole(data: Record<string, unknown> | undefined, email: string | null): AppUserRole {
  if (email && SEEDED_OWNER_EMAILS.has(email)) {
    return 'owner';
  }
  const storedRole = data?.role;
  if (storedRole === 'owner' || storedRole === 'administrator' || storedRole === 'user') {
    return storedRole;
  }
  if (email && SEEDED_ADMINISTRATOR_EMAILS.has(email)) {
    return 'administrator';
  }
  return 'user';
}

export function hasOwnerRole(user: { role?: string | null; roles?: string[] | null } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return Array.isArray(user.roles) && user.roles.includes('owner');
}

export function hasAdministratorRole(user: { role?: string | null; roles?: string[] | null } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'administrator' || user.role === 'owner') return true;
  return (
    Array.isArray(user.roles) &&
    (user.roles.includes('administrator') || user.roles.includes('owner'))
  );
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
  const roles = Array.from(
    new Set<AppUserRole>([
      ...existingRoles,
      primaryRole,
      ...(email && SEEDED_OWNER_EMAILS.has(email) ? (['owner'] as AppUserRole[]) : []),
      ...(email && SEEDED_ADMINISTRATOR_EMAILS.has(email) ? (['administrator'] as AppUserRole[]) : [])
    ])
  );
  const role: AppUserRole = roles.includes('owner')
    ? 'owner'
    : roles.includes('administrator')
      ? 'administrator'
      : primaryRole;

  await ref.set(
    {
      email,
      display_name: profile.displayName,
      photo_url: profile.photoURL,
      role,
      roles,
      auth: {
        provider: 'google',
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

export async function assignAdministratorRoleByEmail(email: string): Promise<{ uid: string | null; role: AppUserRole; roles: AppUserRole[] }> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('A valid email is required to assign administrator role.');
  }

  const snapshot = await adminDb
    .collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return { uid: null, role: 'administrator', roles: ['administrator'] };
  }

  const doc = snapshot.docs[0];
  const data = doc.data() as Record<string, unknown>;
  const roles = Array.from(new Set<AppUserRole>([
    ...normalizeRoles(data.roles, 'administrator'),
    'administrator'
  ]));

  await doc.ref.set(
    {
      role: 'administrator',
      roles,
      updated_at: Timestamp.now()
    },
    { merge: true }
  );

  return { uid: doc.id, role: 'administrator', roles };
}
