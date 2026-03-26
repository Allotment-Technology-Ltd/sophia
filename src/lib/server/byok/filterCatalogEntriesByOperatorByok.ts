import { parseByokProvider, type ByokProvider } from '$lib/types/providers';

import { getOperatorByokTargetUid } from './operatorByokTarget';
import { listByokProviderStatuses } from './store';

export type OperatorByokCatalogGate =
  | { applied: false; reason: 'no_owner_uids' }
  | {
      applied: true;
      /** Providers with `status === 'active'` on the operator BYOK target. */
      activeProviders: string[];
      entryCountBefore: number;
      entryCountAfter: number;
    };

/** Normalize Restormel/catalog provider slugs to BYOK provider ids. */
export function normalizeCatalogProviderForByok(provider: string): ByokProvider | undefined {
  const p = provider.trim().toLowerCase();
  const mapped =
    p === 'google' || p === 'google_ai' || p === 'vertex_ai' ? 'vertex' : p;
  return parseByokProvider(mapped);
}

/**
 * Admin ingestion pickers: only surface models whose provider has an **active**
 * Operator BYOK credential (`users/{OWNER_UIDS[0]}/byokProviders/{provider}`).
 *
 * When `OWNER_UIDS` is unset, returns entries unchanged (local/dev without operator bucket).
 */
export async function filterCatalogEntriesByOperatorByokActive<T extends { provider: string }>(
  entries: T[]
): Promise<{ entries: T[]; gate: OperatorByokCatalogGate }> {
  const uid = getOperatorByokTargetUid();
  if (!uid) {
    return { entries, gate: { applied: false, reason: 'no_owner_uids' } };
  }

  const statuses = await listByokProviderStatuses(uid);
  const active = new Set(
    statuses.filter((s) => s.status === 'active').map((s) => s.provider)
  );

  const before = entries.length;
  const filtered = entries.filter((e) => {
    const id = normalizeCatalogProviderForByok(e.provider);
    return id != null && active.has(id);
  });

  return {
    entries: filtered,
    gate: {
      applied: true,
      activeProviders: [...active].sort(),
      entryCountBefore: before,
      entryCountAfter: filtered.length
    }
  };
}
