/**
 * Compatibility shim: some production errors referenced `ingestPinNormalize.js`
 * (missing "ization"). The canonical module is `ingestPinNormalization.ts`.
 * Re-export so any stale specifier or tooling still resolves.
 */
export * from './ingestPinNormalization.js';
