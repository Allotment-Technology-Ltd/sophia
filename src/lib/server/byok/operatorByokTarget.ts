import { hasOwnerRole } from '$lib/server/authRoles';

/**
 * Operator BYOK keys are stored on the `sophia_documents` user row identified by OWNER_UIDS
 * (comma-separated Neon Auth user ids, JWT `sub`). The first id is the primary operator key bucket.
 */
export function getOperatorByokTargetUid(): string | null {
  const configured =
    process.env.OWNER_UIDS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  return configured[0] ?? null;
}

export function getOperatorByokTargetSummary(): { targetUid: string | null; configuredCount: number } {
  const uids =
    process.env.OWNER_UIDS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  return { targetUid: uids[0] ?? null, configuredCount: uids.length };
}

/**
 * User-facing BYOK CRUD (`/api/byok/*`) uses the signed-in JWT `sub` by default.
 * Owners share the operator bucket (`OWNER_UIDS` first id) so Settings BYOK matches Admin → Operator BYOK.
 */
export function resolveByokStoreUidForSession(
  sessionUid: string,
  user: { uid: string; email?: string | null; role?: string | null; roles?: string[] | null } | null | undefined
): string {
  if (!user || sessionUid !== user.uid) return sessionUid;
  const operatorUid = getOperatorByokTargetUid();
  if (!operatorUid) return sessionUid;
  return hasOwnerRole(user) ? operatorUid : sessionUid;
}
