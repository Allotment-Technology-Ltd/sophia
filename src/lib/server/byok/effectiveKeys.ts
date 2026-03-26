import { hasAdministratorRole, hasOwnerRole } from '$lib/server/authRoles';
import { loadByokProviderApiKeys } from './store';
import type { ProviderApiKeys } from './types';

type AuthLikeUser = {
  uid?: string | null;
  role?: string | null;
  roles?: string[] | null;
};

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
        `[BYOK] Failed to load provider keys for ${logContext} (uid=${uid}):`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  if (hasAnyProviderKey(userKeys)) return userKeys;

  if (!hasAdministratorRole(user) && !hasOwnerRole(user)) {
    return userKeys;
  }

  for (const ownerUid of ownerUidCandidates(uid)) {
    try {
      const ownerKeys = await loadByokProviderApiKeys(ownerUid);
      if (!hasAnyProviderKey(ownerKeys)) continue;
      if (process.env.NODE_ENV !== 'test') {
        console.info(
          `[BYOK] Using owner fallback provider keys for ${logContext} (actor=${uid}, owner=${ownerUid})`
        );
      }
      return ownerKeys;
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `[BYOK] Failed loading owner fallback keys for ${logContext} (owner=${ownerUid}):`,
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
            `[BYOK] Using OWNER_UIDS fallback provider keys for ${logContext} (owner=${ownerUid})`
          );
        }
        return ownerKeys;
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `[BYOK] Failed loading OWNER_UIDS fallback for ${logContext} (owner=${ownerUid}):`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  return keys;
}
