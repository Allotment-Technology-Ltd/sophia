import { createHash } from 'node:crypto';
import { hasOwnerRole } from '$lib/server/authRoles';
import { loadByokProviderApiKeys } from './store';
import type { ProviderApiKeys } from './types';

/** Short stable fingerprint for logs — avoids logging raw user ids (CodeQL / privacy). */
function uidLogFingerprint(uid: string): string {
  return createHash('sha256').update(uid, 'utf8').digest('hex').slice(0, 12);
}

type AuthLikeUser = {
  uid?: string | null;
  role?: string | null;
  roles?: string[] | null;
};

function toOwnerRoleInput(
  user: AuthLikeUser | null | undefined
): { uid?: string; role?: string | null; roles?: string[] | null } | null | undefined {
  if (!user) return user;
  return {
    uid: user.uid ?? undefined,
    role: user.role,
    roles: user.roles
  };
}

function hasAnyProviderKey(keys: ProviderApiKeys): boolean {
  return Object.keys(keys).length > 0;
}

function ownerUidCandidates(currentUid?: string): string[] {
  const configured =
    process.env.OWNER_UIDS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  if (!currentUid) return configured;
  return configured.filter((uid) => uid !== currentUid);
}

/**
 * Inquiry-time BYOK resolver:
 * 1) current user BYOK
 * 2) owner fallback BYOK (admin/owner users only; OWNER_UIDS env)
 * 3) empty keyset (caller may use platform keys / degraded default)
 */
export async function loadInquiryEffectiveProviderApiKeys(
  user: AuthLikeUser | null | undefined,
  logContext: string
): Promise<ProviderApiKeys> {
  const uid = user?.uid?.trim();
  if (!uid) return {};

  let userKeys: ProviderApiKeys = {};
  try {
    userKeys = await loadByokProviderApiKeys(uid);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        `[BYOK] Failed to load provider keys for ${logContext} (uid#=${uidLogFingerprint(uid)}):`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  if (hasAnyProviderKey(userKeys)) return userKeys;

  if (!hasOwnerRole(toOwnerRoleInput(user))) {
    return userKeys;
  }

  for (const ownerUid of ownerUidCandidates(uid)) {
    try {
      const ownerKeys = await loadByokProviderApiKeys(ownerUid);
      if (!hasAnyProviderKey(ownerKeys)) continue;
      if (process.env.NODE_ENV !== 'test') {
        console.info(
          `[BYOK] Using owner fallback provider keys for ${logContext} (actor#=${uidLogFingerprint(uid)}, owner#=${uidLogFingerprint(ownerUid)})`
        );
      }
      return ownerKeys;
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `[BYOK] Failed loading owner fallback keys for ${logContext} (owner#=${uidLogFingerprint(ownerUid)}):`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  return userKeys;
}

/**
 * When a server-side context has no BYOK keys for a tenant (e.g. API-key auth on /api/v1/*),
 * merge keys from OWNER_UIDS so operational keys still apply.
 */
export async function mergeOwnerEnvFallbackIfEmpty(
  keys: ProviderApiKeys,
  logContext: string
): Promise<ProviderApiKeys> {
  if (Object.keys(keys).length > 0) return keys;

  const configured =
    process.env.OWNER_UIDS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  for (const ownerUid of configured) {
    try {
      const ownerKeys = await loadByokProviderApiKeys(ownerUid);
      if (Object.keys(ownerKeys).length > 0) {
        if (process.env.NODE_ENV !== 'test') {
          console.info(
            `[BYOK] Using OWNER_UIDS fallback provider keys for ${logContext} (owner#=${uidLogFingerprint(ownerUid)})`
          );
        }
        return ownerKeys;
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `[BYOK] Failed loading OWNER_UIDS fallback for ${logContext} (owner#=${uidLogFingerprint(ownerUid)}):`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  return keys;
}
