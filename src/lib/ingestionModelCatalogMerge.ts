/**
 * Merges Restormel `GET /projects/{id}/models` (**project model index**: bindings + nested catalog model)
 * with the static ingestion catalog. Rows with `enabled: false` are ignored for pickers.
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

/** True when a catalog row should use embedding-style pickers (Restormel project models). */
export function isEmbeddingModelEntry(e: Pick<IngestionModelCatalogEntry, 'provider' | 'modelId'>): boolean {
	const p = e.provider.toLowerCase();
	if (p === 'voyage') return true;
	if (/embedding|embed|vector|textembedding|gecko|e5-|bge-/i.test(e.modelId)) return true;
	return false;
}

export interface CatalogSyncMeta {
	/** How entries were assembled */
	status: 'restormel' | 'static' | 'merged' | 'unavailable';
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

/** Accept bindings index, { data: { models | bindings } }, { models }, or a bare array */
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

	const topBindings = (payload as { bindings?: unknown }).bindings;
	if (Array.isArray(topBindings)) {
		return topBindings.filter(isRecord);
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
		const bindings = (data as { bindings?: unknown }).bindings;
		if (Array.isArray(bindings)) {
			return bindings.filter(isRecord);
		}
		if (Array.isArray((data as { items?: unknown }).items)) {
			return ((data as { items: unknown[] }).items).filter(isRecord);
		}
	}

	return [];
}

/** Restormel project index bindings may set `enabled: false` for soft-off rows. */
export function isRestormelBindingRowEnabled(row: Record<string, unknown>): boolean {
	return row.enabled !== false;
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

	if (
		low.includes('flash') ||
		low.includes('mini') ||
		low.includes('haiku') ||
		low.includes('lite') ||
		low.includes('nano')
	) {
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
		bestFor: 'Model from your Restormel project index; tiers are heuristic estimates only.'
	};
}

function rowToProviderModel(row: Record<string, unknown>): { provider: string; modelId: string } | null {
	const providerNested =
		isRecord(row.provider) ? (row.provider as Record<string, unknown>) : null;
	const modelNested =
		isRecord(row.model) ? (row.model as Record<string, unknown>) : null;
	const providerTypeNested =
		isRecord(row.providerType) ? (row.providerType as Record<string, unknown>) : null;
	const modelIdNested =
		isRecord(row.modelId) ? (row.modelId as Record<string, unknown>) : null;

	function coerceId(value: unknown): string {
		if (typeof value === 'string') return value.trim();
		if (!isRecord(value)) return '';
		const hit =
			value.id ??
			(value as { modelId?: unknown }).modelId ??
			(value as { model_id?: unknown }).model_id ??
			(value as { providerType?: unknown }).providerType ??
			(value as { provider_type?: unknown }).provider_type ??
			value.canonicalName ??
			value.type ??
			value.slug ??
			value.name ??
			'';
		return typeof hit === 'string' ? hit.trim() : '';
	}

	function normalizeProvider(rawProvider: string): string {
		let provider = rawProvider.trim().toLowerCase();
		if (!provider) return '';
		if (provider.includes('/')) provider = provider.split('/').pop() ?? provider;
		if (provider.includes(':')) provider = provider.split(':').pop() ?? provider;
		if (provider === 'vertexai' || provider === 'googlevertex' || provider === 'google-vertex') {
			return 'vertex';
		}
		if (provider === 'openai_compatible') return 'openai';
		return provider;
	}

	function normalizeModelId(rawModelId: string): string {
		let modelId = rawModelId.trim();
		if (!modelId) return '';
		const low = modelId.toLowerCase();
		if (low.startsWith('publishers/google/models/')) {
			modelId = modelId.slice('publishers/google/models/'.length);
		} else if (low.startsWith('models/')) {
			modelId = modelId.slice('models/'.length);
		}
		return modelId;
	}

	function inferProviderFromModelId(modelId: string): string {
		const low = normalizeModelId(modelId).toLowerCase().trim();
		if (!low) return '';
		if (low.startsWith('claude')) return 'anthropic';
		if (
			low.startsWith('gpt') ||
			low.startsWith('o1') ||
			low.startsWith('o3') ||
			low.startsWith('o4') ||
			low.startsWith('text-embedding-3')
		) {
			return 'openai';
		}
		if (low.startsWith('gemini')) return 'google';
		if (low.startsWith('text-embedding-00') || low.startsWith('text-multilingual-embedding-')) {
			return 'google';
		}
		if (low.startsWith('voyage')) return 'voyage';
		if (low.startsWith('deepseek')) return 'deepseek';
		if (low.startsWith('grok')) return 'xai';
		return '';
	}

	function parseCompositeModelRef(value: unknown): { provider: string; modelId: string } | null {
		if (typeof value !== 'string') return null;
		const raw = value.trim();
		if (!raw) return null;

		const slash = raw.indexOf('/');
		if (slash > 0 && slash < raw.length - 1) {
			const provider = raw.slice(0, slash).trim().toLowerCase();
			const modelId = raw.slice(slash + 1).trim();
			if (provider && modelId) return { provider, modelId };
		}

		const colon = raw.indexOf(':');
		if (colon > 0 && colon < raw.length - 1) {
			const provider = raw.slice(0, colon).trim().toLowerCase();
			const modelId = raw.slice(colon + 1).trim();
			if (provider && modelId) return { provider, modelId };
		}

		const inferredProvider = inferProviderFromModelId(raw);
		if (inferredProvider) return { provider: inferredProvider, modelId: raw };
		return null;
	}

	const providerRaw =
		row.providerType ??
		(row as { provider_type?: unknown }).provider_type ??
		row.providerId ??
		(row as { provider_id?: unknown }).provider_id ??
		row.vendor ??
		providerNested?.type ??
		providerNested?.id ??
		providerNested?.providerType ??
		providerNested?.provider_type ??
		providerTypeNested?.type ??
		providerTypeNested?.id ??
		row.provider ??
		'';

	const modelRaw =
		row.modelId ??
		(row as { model_id?: unknown }).model_id ??
		modelNested?.id ??
		modelNested?.modelId ??
		modelNested?.model_id ??
		modelIdNested?.id ??
		modelIdNested?.modelId ??
		modelIdNested?.model_id ??
		row.model ??
		row.variant ??
		row.slug ??
		row.name ??
		row.id ??
		'';

	const provider = normalizeProvider(coerceId(providerRaw));
	const modelId = normalizeModelId(coerceId(modelRaw));
	if (provider && modelId) return { provider, modelId };

	const compositeCandidates = [
		row.canonicalName,
		row.id,
		row.modelId,
		(row as { model_id?: unknown }).model_id,
		row.model,
		row.slug,
		row.name
	];
	for (const candidate of compositeCandidates) {
		const parsed = parseCompositeModelRef(candidate);
		if (!parsed) continue;
		if (provider && !modelId) return { provider, modelId: parsed.modelId };
		if (!provider && modelId) {
			const inferred = inferProviderFromModelId(modelId);
			if (inferred) return { provider: inferred, modelId };
		}
		return parsed;
	}

	if (!provider && modelId) {
		const inferred = inferProviderFromModelId(modelId);
		if (inferred) return { provider: inferred, modelId };
	}

	return null;
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
		if (!isRestormelBindingRowEnabled(row)) continue;
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

/**
 * Models available for operator pickers: **only** rows returned by Restormel project models.
 * No static catalog supplement or fallback list.
 */
export function buildRestormelProjectModelEntriesOnly(
	remoteResponse: unknown | null,
	fetchError?: string | null
): { entries: IngestionModelCatalogEntryMerged[]; sync: CatalogSyncMeta } {
	if (fetchError) {
		return {
			entries: [],
			sync: {
				status: 'unavailable',
				reason: fetchError,
				remoteRowCount: 0,
				annotatedCount: 0,
				inferredRemoteCount: 0,
				staticSupplementCount: 0
			}
		};
	}

	const rows = extractModelRowsFromRestormelPayload(remoteResponse);
	if (rows.length === 0) {
		const hadPayload = remoteResponse !== null && remoteResponse !== undefined;
		return {
			entries: [],
			sync: {
				status: 'unavailable',
				reason: hadPayload
					? 'Restormel returned no usable models (empty or unrecognized response shape).'
					: 'Restormel models response was empty.',
				remoteRowCount: 0,
				annotatedCount: 0,
				inferredRemoteCount: 0,
				staticSupplementCount: 0
			}
		};
	}

	const seen = new Set<string>();
	const entries: IngestionModelCatalogEntryMerged[] = [];

	for (const row of rows) {
		if (!isRestormelBindingRowEnabled(row)) continue;
		const ids = rowToProviderModel(row);
		if (!ids) continue;
		const key = `${ids.provider} · ${ids.modelId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		entries.push({ ...inferEntry(ids.provider, ids.modelId), catalogSource: 'remote' });
	}

	if (entries.length === 0) {
		return {
			entries: [],
			sync: {
				status: 'unavailable',
				reason: 'Restormel returned model rows, but none contained a usable provider/model pair.',
				remoteRowCount: rows.length,
				annotatedCount: 0,
				inferredRemoteCount: 0,
				staticSupplementCount: 0
			}
		};
	}

	return {
		entries,
		sync: {
			status: 'restormel',
			remoteRowCount: rows.length,
			annotatedCount: 0,
			inferredRemoteCount: entries.length,
			staticSupplementCount: 0
		}
	};
}
