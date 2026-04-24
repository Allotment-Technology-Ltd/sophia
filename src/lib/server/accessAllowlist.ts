/**
 * Early-access gate for `ALLOWED_EMAILS` (no import of authRoles / sophiaDocumentsDb — safe in vitest).
 */

/** Comma-separated early-access allowlist (`ALLOWED_EMAILS`). Empty = no gating. */
export function parseAllowedEmailsEnv(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

function parseCommaEnv(key: string): string[] {
  const raw = process.env[key];
  return (typeof raw === 'string' ? raw : '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function migrateLegacyRoleToken(role: unknown): 'owner' | 'user' | null {
  if (role === 'owner' || role === 'administrator' || role === 'admin') return 'owner';
  if (role === 'user') return 'user';
  return null;
}

/** Mirrors `hasOwnerRole` in authRoles.ts (env + JWT-backed fields only). */
function userHasOwnerPrivileges(
  user: { uid?: string; role?: string | null; roles?: string[] | null }
): boolean {
  if (migrateLegacyRoleToken(user.role) === 'owner') return true;
  if (Array.isArray(user.roles) && user.roles.some((r) => migrateLegacyRoleToken(r) === 'owner')) {
    return true;
  }
  return false;
}

/**
 * When `ALLOWED_EMAILS` is non-empty, only those addresses may use the app unless the user
 * is an owner (role).
 * Requires an authenticated user (`uid`) for non-allowlist paths.
 */
export function passesEarlyAccessAllowlist(params: {
  email: string | null | undefined;
  user: { uid?: string; role?: string | null; roles?: string[] | null } | null;
}): boolean {
  const allowed = parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS);
  if (allowed.length === 0) return true;

  const email = params.email?.trim().toLowerCase();
  if (!email) return false;
  if (allowed.includes(email)) return true;

  const u = params.user;
  if (!u?.uid) return false;
  if (userHasOwnerPrivileges(u)) return true;

  return false;
}
