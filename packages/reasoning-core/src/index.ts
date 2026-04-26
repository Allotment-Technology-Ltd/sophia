/**
 * Monorepo dogfood: thin re-exports for Restormel “reasoning core” experiments in Sophia.
 * Keep logic in app code; this package exists to prove workspace wiring and contracts alignment.
 */
export type { Claim, RelationBundle } from '@restormel/contracts/references';
export { RelationBundleSchema } from '@restormel/contracts/references';

export const RESTORMEL_REASONING_CORE_WORKSPACE = '0.0.0' as const;
