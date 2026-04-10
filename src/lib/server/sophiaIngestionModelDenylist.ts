/**
 * Sophia policy: provider/model pairs we never expose for ingestion or Restormel operations sync,
 * even if Restormel’s catalog still lists them (retired API ids, deprecated snapshots).
 *
 * Sources: Anthropic public deprecation table + history — see
 * https://docs.claude.com/en/docs/resources/model-deprecations
 */
import { catalogSurfaceStableKey } from '$lib/server/restormelCatalogRows';

const SOPHIA_INGESTION_OPERATIONS_DENYLIST = new Set(
	[
		// Retired Claude 1 / Instant (2024)
		'anthropic::claude-1.0',
		'anthropic::claude-1.1',
		'anthropic::claude-1.2',
		'anthropic::claude-1.3',
		'anthropic::claude-instant-1.0',
		'anthropic::claude-instant-1.1',
		'anthropic::claude-instant-1.2',
		// Retired Claude 2 / Sonnet 3 (2025)
		'anthropic::claude-2.0',
		'anthropic::claude-2.1',
		'anthropic::claude-3-sonnet-20240229',
		// Retired Opus 3 (2026)
		'anthropic::claude-3-opus-20240229',
		// Retired Sonnet 3.5 (2025)
		'anthropic::claude-3-5-sonnet-20240620',
		'anthropic::claude-3-5-sonnet-20241022',
		'anthropic::claude-3-5-sonnet-latest',
		// Retired Sonnet 3.7 (2026)
		'anthropic::claude-3-7-sonnet-20250219',
		// Retired Haiku 3.5 (2026)
		'anthropic::claude-3-5-haiku-20241022',
		'anthropic::claude-3-5-haiku-latest',
		// Deprecated → retiring Haiku 3 (policy: do not offer for new ingestion)
		'anthropic::claude-3-haiku-20240307',
		'anthropic::claude-3-haiku-latest'
	].map((k) => k.toLowerCase())
);

/**
 * Hard block for catalog surfaces + ingest routing (non-embedding chat / ops).
 * Does not apply to embedding-only rows.
 */
export function isSophiaIngestionOperationsDenylisted(providerType: string, modelId: string): boolean {
	return SOPHIA_INGESTION_OPERATIONS_DENYLIST.has(
		catalogSurfaceStableKey(providerType, modelId).toLowerCase()
	);
}
