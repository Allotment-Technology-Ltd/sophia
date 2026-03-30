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
