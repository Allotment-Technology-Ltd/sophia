/**
 * Merges Restormel GET /projects/{id}/models responses with the static ingestion catalog.
 * Remote payload shapes may vary; we accept common patterns.
 */

import type { IngestionModelCatalogEntry } from './ingestionModelCatalog';
import {
	catalogEntryForLabel,
	INGESTION_MODEL_CATALOG
} from './ingestionModelCatalog';

export type CatalogEntrySource = 'annotated' | 'remote' | 'static_supplement';

export type IngestionModelCatalogEntryMerged = IngestionModelCatalogEntry & {
	catalogSource?: CatalogEntrySource;
};

export interface CatalogSyncMeta {
	/** How entries were assembled */
	status: 'restormel' | 'static' | 'merged';
	/** Human-readable when Restormel fetch failed or returned nothing usable */
	reason?: string;
	remoteRowCount: number;
	annotatedCount: number;
	inferredRemoteCount: number;
	staticSupplementCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Accept { data: [...] }, { data: { models: [...] } }, { models: [...] }, or a bare array */
export function extractModelRowsFromRestormelPayload(payload: unknown): Record<string, unknown>[] {
	if (payload === null || payload === undefined) return [];
	if (Array.isArray(payload)) {
		return payload.filter(isRecord);
	}
	if (!isRecord(payload)) return [];

	const topModels = payload.models;
	if (Array.isArray(topModels)) {
		return topModels.filter(isRecord);
	}

	const data = payload.data;
	if (Array.isArray(data)) {
		return data.filter(isRecord);
	}
	if (isRecord(data)) {
		const inner = data.models;
		if (Array.isArray(inner)) {
			return inner.filter(isRecord);
		}
		if (Array.isArray((data as { items?: unknown }).items)) {
			return ((data as { items: unknown[] }).items).filter(isRecord);
		}
	}

	return [];
}

function inferEntry(providerRaw: string, modelIdRaw: string): IngestionModelCatalogEntry {
	const provider = providerRaw.trim() || 'unknown';
	const modelId = modelIdRaw.trim();
	const label = `${provider} · ${modelId}`;
	const low = modelId.toLowerCase();

	let costTier: IngestionModelCatalogEntry['costTier'] = 'medium';
	let qualityTier: IngestionModelCatalogEntry['qualityTier'] = 'strong';
	let speed: IngestionModelCatalogEntry['speed'] = 'balanced';
	let contextWindow = '128k';

	if (low.includes('flash') || low.includes('mini') || low.includes('haiku') || low.includes('lite')) {
		costTier = 'low';
		qualityTier = 'capable';
		speed = 'fast';
	}
	if (low.includes('opus') || low.includes('gpt-5') || low.includes('sonnet-4') || low.includes('reasoner')) {
		costTier = 'high';
		qualityTier = 'frontier';
		speed = 'thorough';
	}
	if (provider.toLowerCase() === 'deepseek' && low.includes('chat')) {
		costTier = 'low';
		qualityTier = 'strong';
		speed = 'balanced';
	}
	if (provider.toLowerCase() === 'voyage' || low.includes('voyage-') || low.includes('embedding')) {
		costTier = 'low';
		qualityTier = 'capable';
		speed = 'fast';
		contextWindow = low.includes('voyage-2') ? '4k' : '32k';
	}
	if (low.includes('gemini') && (low.includes('1m') || low.includes('pro') || low.includes('2.5'))) {
		contextWindow = '1M';
	}
	if (low.includes('claude') || low.includes('gpt-4')) {
		contextWindow = '200k';
	}

	return {
		label,
		provider,
		modelId,
		costTier,
		qualityTier,
		speed,
		contextWindow,
		bestFor: 'Listed in your Restormel project model index; tiers are heuristic until annotated in the static catalog.'
	};
}

function rowToProviderModel(row: Record<string, unknown>): { provider: string; modelId: string } | null {
	const provider = String(
		row.providerType ?? row.provider ?? row.providerId ?? row.vendor ?? ''
	).trim();
	const modelId = String(row.modelId ?? row.id ?? row.name ?? row.slug ?? '').trim();
	if (!provider || !modelId) return null;
	return { provider, modelId };
}

/**
 * @param remoteResponse — full JSON body from Restormel, or null if the request failed
 * @param fetchError — optional error message when the HTTP call failed
 */
export function mergeCatalogWithRestormelModels(
	remoteResponse: unknown | null,
	fetchError?: string | null
): { entries: IngestionModelCatalogEntryMerged[]; sync: CatalogSyncMeta } {
	if (fetchError) {
		return {
			entries: INGESTION_MODEL_CATALOG.map((e) => ({ ...e, catalogSource: 'static_supplement' as const })),
			sync: {
				status: 'static',
				reason: fetchError,
				remoteRowCount: 0,
				annotatedCount: 0,
				inferredRemoteCount: 0,
				staticSupplementCount: INGESTION_MODEL_CATALOG.length
			}
		};
	}

	const rows = extractModelRowsFromRestormelPayload(remoteResponse);
	if (rows.length === 0) {
		const hadPayload = remoteResponse !== null && remoteResponse !== undefined;
		return {
			entries: INGESTION_MODEL_CATALOG.map((e) => ({ ...e, catalogSource: 'static_supplement' as const })),
			sync: {
				status: 'static',
				reason: hadPayload
					? 'Restormel models list is empty. Showing static catalog.'
					: 'Could not parse models from Restormel response (unknown shape). Showing static catalog.',
				remoteRowCount: 0,
				annotatedCount: 0,
				inferredRemoteCount: 0,
				staticSupplementCount: INGESTION_MODEL_CATALOG.length
			}
		};
	}

	const seen = new Set<string>();
	const entries: IngestionModelCatalogEntryMerged[] = [];
	let annotatedCount = 0;
	let inferredRemoteCount = 0;

	for (const row of rows) {
		const ids = rowToProviderModel(row);
		if (!ids) continue;
		const label = `${ids.provider} · ${ids.modelId}`;
		if (seen.has(label)) continue;
		seen.add(label);

		const staticHit = catalogEntryForLabel(label);
		if (staticHit) {
			entries.push({ ...staticHit, catalogSource: 'annotated' });
			annotatedCount++;
			continue;
		}

		const inferred = inferEntry(ids.provider, ids.modelId);
		entries.push({ ...inferred, catalogSource: 'remote' });
		inferredRemoteCount++;
	}

	let staticSupplementCount = 0;
	for (const staticEntry of INGESTION_MODEL_CATALOG) {
		if (seen.has(staticEntry.label)) continue;
		entries.push({ ...staticEntry, catalogSource: 'static_supplement' });
		staticSupplementCount++;
	}

	const status: CatalogSyncMeta['status'] =
		staticSupplementCount > 0 && entries.some((e) => e.catalogSource === 'remote' || e.catalogSource === 'annotated')
			? 'merged'
			: staticSupplementCount > 0
				? 'merged'
				: 'restormel';

	return {
		entries,
		sync: {
			status,
			remoteRowCount: rows.length,
			annotatedCount,
			inferredRemoteCount,
			staticSupplementCount
		}
	};
}
