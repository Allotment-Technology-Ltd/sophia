/**
 * Monorepo dogfood: stable provider surface re-exports for tests and admin wiring.
 * Prefer `@restormel/contracts` directly in new code; this package validates workspace linking.
 */
export { BYOK_PROVIDER_ORDER, isReasoningProvider, type ReasoningProvider } from '@restormel/contracts/providers';

export const RESTORMEL_PROVIDERS_WORKSPACE = '0.0.0' as const;
