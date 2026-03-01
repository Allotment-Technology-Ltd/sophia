import type { Claim } from '$lib/types/references';

/**
 * Resolves back-references in incoming claims.
 * When a claim from Pass 2/3 references a claim from an earlier pass by ID,
 * populates the `backRefIds` array on the later claim.
 */
export function resolveBackRefs(newClaims: Claim[], existingClaims: Claim[]): Claim[] {
  const existingIds = new Set(existingClaims.map(c => c.id));

  return newClaims.map(claim => {
    if (!claim.backRefIds || claim.backRefIds.length === 0) return claim;

    // Filter to only IDs that exist in previously received claims
    const resolved = claim.backRefIds.filter(id => existingIds.has(id));
    return { ...claim, backRefIds: resolved.length > 0 ? resolved : undefined };
  });
}
