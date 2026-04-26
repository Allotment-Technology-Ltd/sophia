/**
 * Parse Restormel Keys live catalog (`GET /catalog`, contract v5 or v6) model rows for admin model surfaces
 * (operations vs user queries). Row shape aligns with `readModelRows` usage in restormel.ts.
 */

import { INGESTION_MODEL_CATALOG } from '../ingestionModelCatalog';
import { isExcludedXaiGrokCatalogRef } from '../modelCatalogEthics';
import { isEmbeddingModelByProviderAndId } from '../modelKind';
import type { ReasoningProvider } from '@restormel/contracts/providers';
import { isReasoningProvider } from '@restormel/contracts/providers';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Shallow snapshot of a catalog row for admin JSON (nested objects stay live references; do not mutate). */
export function snapshotCatalogRowRaw(row: Record<string, unknown>): Record<string, unknown> {
	return { ...row };
}

/**
 * Non-model-array catalog fields for admin inspection (`providers`, nested `data` metadata, etc.).
 * Omits the model list itself to avoid huge duplication (each row already carries `raw`).
 */
export function extractCatalogAdminEnvelope(payload: unknown): Record<string, unknown> {
	const obj = isRecord(payload) ? payload : null;
	if (!obj) return {};
	const out: Record<string, unknown> = {};
	if (Array.isArray(obj.providers)) out.providers = obj.providers;
	if (typeof obj.contractVersion === 'string') out.contractVersion = obj.contractVersion;
	const data = obj.data;
	if (isRecord(data) && !Array.isArray(data)) {
		const meta: Record<string, unknown> = {};
		if (typeof data.contractVersion === 'string') meta.contractVersion = data.contractVersion;
		if (data.externalSignals !== undefined) meta.externalSignals = data.externalSignals;
		if (Object.keys(meta).length) out.dataMeta = meta;
	}
	return out;
}

/**
 * Extract model rows from `GET /catalog` (dashboard or canonical).
 * Keys may ship: `{ data: ModelRow[] }` (integrator guide), `{ data: { models: [] } }`, or `{ models: [] }`.
 */
export function readRestormelCatalogDataModels(payload: unknown): Array<Record<string, unknown>> {
	const obj = isRecord(payload) ? payload : null;
	if (!obj) return [];

	if (Array.isArray(obj.data)) {
		return obj.data.filter(isRecord);
	}

	const data = isRecord(obj.data) ? obj.data : null;
	if (data) {
		const nested = data.models ?? data.items ?? data.bindings;
		if (Array.isArray(nested)) return nested.filter(isRecord);
	}

	if (Array.isArray(obj.models)) return obj.models.filter(isRecord);

	return [];
}

export function parseCatalogContractVersionFromPayload(payload: unknown): string {
	const obj = isRecord(payload) ? payload : null;
	const data = isRecord(obj?.data) ? obj.data : null;
	const fromData = typeof data?.contractVersion === 'string' ? data.contractVersion.trim() : '';
	if (fromData) return fromData;
	const fromTop = typeof obj?.contractVersion === 'string' ? obj.contractVersion.trim() : '';
	return fromTop;
}

/**
 * When Keys omits `externalSignals.freshness` (common on local / older builds), treat as "unknown" and
 * do not block admin save — see `signalsPresent`.
 */
export function parseCatalogFreshnessFromPayload(payload: unknown): {
	allFresh: boolean;
	signalsPresent: boolean;
} {
	const obj = isRecord(payload) ? payload : null;
	const data = isRecord(obj?.data) ? obj.data : null;
	const externalSignals = isRecord(data?.externalSignals) ? data.externalSignals : null;
	const freshness = isRecord(externalSignals?.freshness) ? externalSignals.freshness : null;
	if (!freshness) {
		return { allFresh: true, signalsPresent: false };
	}
	return {
		allFresh: freshness.allFresh === true,
		signalsPresent: true
	};
}

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

/** Normalize provider labels from Restormel catalog rows or admin refs (exported for explicit-mode validation). */
export function normalizeKeysProviderType(raw: string): string {
	let provider = raw.trim().toLowerCase();
	if (!provider) return '';
	if (provider.includes('/')) provider = provider.split('/').pop() ?? provider;
	if (provider.includes(':')) provider = provider.split(':').pop() ?? provider;
	if (provider === 'vertexai' || provider === 'googlevertex' || provider === 'google-vertex') {
		return 'vertex';
	}
	if (provider === 'openai_compatible') return 'openai';
	if (provider === 'mistralai' || provider === 'mistral_ai') return 'mistral';
	return provider;
}

function normalizeCatalogModelId(rawModelId: string): string {
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
	const low = normalizeCatalogModelId(modelId).toLowerCase().trim();
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
	if (low.startsWith('aizolo-') || low === 'aizolo') return 'aizolo';
	if (
		low.startsWith('mistral') ||
		low.startsWith('ministral') ||
		low.startsWith('codestral') ||
		low.startsWith('mixtral')
	) {
		return 'mistral';
	}
	return '';
}

/**
 * Extract provider + model id from a v5 catalog row (same field fallbacks as parseCatalogAllowlist).
 */
export function catalogRowToKeysProviderModel(
	row: Record<string, unknown>
): { providerType: string; modelId: string } | null {
	const providerRaw =
		row.providerType ??
		(row as { provider_type?: unknown }).provider_type ??
		row.providerId ??
		(row as { provider_id?: unknown }).provider_id ??
		row.provider ??
		'';
	const modelRaw =
		row.providerModelId ??
		(row as { provider_model_id?: unknown }).provider_model_id ??
		row.modelId ??
		(row as { model_id?: unknown }).model_id ??
		row.model ??
		row.modelVariant ??
		row.variant ??
		row.id ??
		'';

	let provider = typeof providerRaw === 'string' ? normalizeKeysProviderType(providerRaw) : '';
	const modelId =
		typeof modelRaw === 'string'
			? normalizeCatalogModelId(modelRaw)
			: normalizeCatalogModelId(coerceId(modelRaw));

	if (!modelId) return null;

	if (!provider) {
		const inferred = inferProviderFromModelId(modelId);
		if (!inferred) return null;
		provider = inferred;
	}

	return { providerType: provider, modelId };
}

function normalizeLifecycleToken(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Whether Keys marks the catalog row as suitable for production surfaces (not preview-only, retired, etc.).
 * When lifecycle/status/availability are omitted, sparse payloads still pass — only explicit negative (or
 * unknown non-empty lifecycle) signals block.
 */
export function isCatalogRowCatalogUsable(row: Record<string, unknown>): boolean {
	if (row.retired === true) return false;
	if (row.inactive === true) return false;
	if (row.suspended === true) return false;
	if (row.enabled === false) return false;
	if (row.active === false) return false;

	const lcRaw = typeof row.lifecycle === 'string' ? row.lifecycle : '';
	if (lcRaw.trim()) {
		const lc = normalizeLifecycleToken(lcRaw);
		const negative = new Set([
			'retired',
			'deprecated',
			'preview',
			'beta',
			'alpha',
			'experimental',
			'sunset',
			'eol',
			'end_of_life',
			'disabled',
			'hidden',
			'maintenance'
		]);
		const positive = new Set([
			'active',
			'ga',
			'generally_available',
			'live',
			'stable',
			'released',
			'production',
			'general_availability'
		]);
		if (negative.has(lc)) return false;
		if (positive.has(lc)) return true;
		return false;
	}

	const statusRaw = typeof row.status === 'string' ? row.status : '';
	if (statusRaw.trim()) {
		const status = normalizeLifecycleToken(statusRaw);
		const neg = new Set([
			'deprecated',
			'retired',
			'suspended',
			'disabled',
			'preview',
			'beta',
			'alpha',
			'inactive'
		]);
		const pos = new Set(['active', 'available', 'live', 'ga', 'stable']);
		if (neg.has(status)) return false;
		if (pos.has(status)) return true;
		// Unknown status tokens: do not treat as proof either way; fall through.
	}

	const stateRaw = typeof (row as { state?: unknown }).state === 'string' ? (row as { state: string }).state : '';
	if (stateRaw.trim()) {
		const state = normalizeLifecycleToken(stateRaw);
		const neg = new Set([
			'inactive',
			'retired',
			'deprecated',
			'suspended',
			'disabled',
			'preview',
			'beta'
		]);
		if (neg.has(state)) return false;
	}

	const availabilityRaw =
		typeof (row as { availability?: unknown }).availability === 'string'
			? (row as { availability: string }).availability
			: '';
	if (availabilityRaw.trim()) {
		const av = normalizeLifecycleToken(availabilityRaw);
		const neg = new Set(['deprecated', 'unavailable', 'disabled']);
		const pos = new Set(['active', 'available', 'ga']);
		if (neg.has(av)) return false;
		if (pos.has(av)) return true;
		// Unknown availability: fall through.
	}

	const vis = typeof row.catalogVisibility === 'string' ? row.catalogVisibility.toLowerCase() : '';
	if (vis === 'hidden') return false;
	return true;
}

/** @deprecated Use {@link isCatalogRowCatalogUsable}; kept for tests and older call sites. */
export const isCatalogRowActive = isCatalogRowCatalogUsable;

function rowHasExplicitCatalogProvider(row: Record<string, unknown>): boolean {
	const p = row.providerType ?? (row as { provider_type?: unknown }).provider_type;
	if (typeof p === 'string' && p.trim()) return true;
	const pid = row.providerId ?? (row as { provider_id?: unknown }).provider_id;
	if (typeof pid === 'string' && pid.trim()) return true;
	const prov = row.provider;
	if (typeof prov === 'string' && prov.trim()) return true;
	if (isRecord(prov)) return true;
	return false;
}

function rowHasExplicitCatalogModelRef(row: Record<string, unknown>): boolean {
	const a = row.providerModelId ?? (row as { provider_model_id?: unknown }).provider_model_id;
	if (typeof a === 'string' && a.trim()) return true;
	const b = row.modelId ?? (row as { model_id?: unknown }).model_id;
	if (typeof b === 'string' && b.trim()) return true;
	const mv = row.modelVariant ?? row.variant;
	if (typeof mv === 'string' && mv.trim()) return true;
	if (isRecord(row.model)) return true;
	return false;
}

const UUID_LIKE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Whether we have enough stable provider/model identity to offer the row as a routing option.
 * Blocks UUID-only placeholders and inferred-provider rows with opaque numeric ids.
 */
export function isCatalogRowOperationallyViable(
	row: Record<string, unknown>,
	ids: { providerType: string; modelId: string }
): boolean {
	const mid = ids.modelId.trim();
	if (mid.length < 2) return false;

	const explicitModel = rowHasExplicitCatalogModelRef(row);
	if (!explicitModel && UUID_LIKE.test(mid)) return false;

	const explicitProv = rowHasExplicitCatalogProvider(row);
	if (!explicitProv) {
		if (/^\d+$/.test(mid)) return false;
		if (mid.length < 4) return false;
	}

	return true;
}

export type CatalogSurfaceRow = {
	providerType: string;
	modelId: string;
	isEmbedding: boolean;
	catalogUsable: boolean;
	detailsSufficient: boolean;
	eligibleForSurfaces: boolean;
	/** Full Restormel catalog model row (shallow copy of parsed record). */
	raw: Record<string, unknown>;
};

export type CatalogUnparsedModelRow = {
	raw: Record<string, unknown>;
};

/** Model-shaped rows Keys sent that we could not map to provider + model id. */
export function listCatalogUnparsedModelRows(payload: unknown): CatalogUnparsedModelRow[] {
	const rows = readRestormelCatalogDataModels(payload);
	const out: CatalogUnparsedModelRow[] = [];
	for (const row of rows) {
		if (catalogRowToKeysProviderModel(row)) continue;
		out.push({ raw: snapshotCatalogRowRaw(row) });
	}
	return out;
}

export function catalogSurfaceStableKey(providerType: string, modelId: string): string {
	return `${providerType.trim().toLowerCase()}::${modelId.trim()}`;
}

/** True when `ref` matches a catalog row key that is eligible for surfaces (after provider normalization). */
export function catalogRefEligibleForSurfaces(
	ref: { providerType: string; modelId: string },
	eligibleKeys: Set<string>
): boolean {
	const mid = ref.modelId.trim();
	if (!mid) return false;
	const pt = normalizeKeysProviderType(ref.providerType);
	const keys = [
		catalogSurfaceStableKey(pt, mid),
		pt === 'google' ? catalogSurfaceStableKey('vertex', mid) : '',
		pt === 'vertex' ? catalogSurfaceStableKey('google', mid) : ''
	].filter((k) => k.length > 0);
	return keys.some((k) => eligibleKeys.has(k));
}

/** Every parseable catalog row with eligibility flags (admin UI). */
export function listCatalogSurfaceCandidates(payload: unknown): CatalogSurfaceRow[] {
	const rows = readRestormelCatalogDataModels(payload);
	const seen = new Set<string>();
	const out: CatalogSurfaceRow[] = [];

	for (const row of rows) {
		const ids = catalogRowToKeysProviderModel(row);
		if (!ids) continue;
		if (isExcludedXaiGrokCatalogRef(ids.providerType, ids.modelId)) continue;
		const catalogUsable = isCatalogRowCatalogUsable(row);
		const detailsSufficient = isCatalogRowOperationallyViable(row, ids);
		const eligibleForSurfaces = catalogUsable && detailsSufficient;
		const key = catalogSurfaceStableKey(ids.providerType, ids.modelId);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			providerType: ids.providerType,
			modelId: ids.modelId,
			isEmbedding: isEmbeddingModelByProviderAndId(ids.providerType, ids.modelId),
			catalogUsable,
			detailsSufficient,
			eligibleForSurfaces,
			raw: snapshotCatalogRowRaw(row)
		});
	}

	return out;
}

/**
 * Synthetic rows for embedding-specialist entries from {@link INGESTION_MODEL_CATALOG} when Restormel’s live
 * `GET /catalog` omits them (common for Vertex text-embedding-* / multilingual lines).
 */
function buildIngestionEmbeddingCatalogSupplementRows(): CatalogSurfaceRow[] {
	const out: CatalogSurfaceRow[] = [];
	for (const e of INGESTION_MODEL_CATALOG) {
		if (!isEmbeddingModelByProviderAndId(e.provider, e.modelId)) continue;
		if (isExcludedXaiGrokCatalogRef(e.provider, e.modelId)) continue;
		out.push({
			providerType: e.provider,
			modelId: e.modelId,
			isEmbedding: true,
			catalogUsable: true,
			detailsSufficient: true,
			eligibleForSurfaces: true,
			raw: {
				providerType: e.provider,
				modelId: e.modelId,
				lifecycle: 'active',
				sophiaCatalogSupplement: true,
				sophiaCatalogSupplementNote: e.bestFor
			}
		});
	}
	return out;
}

/**
 * Live Restormel catalog rows plus missing **embedding-specialist** rows from Sophia’s static ingestion catalog.
 * Use this for admin model surfaces (availability UI + PUT validation) so Google/Vertex `text-embedding-*` and
 * Voyage retrieval models appear even when Keys’ published catalog is incomplete.
 */
export function listCatalogSurfaceCandidatesWithEmbeddingSupplement(payload: unknown): CatalogSurfaceRow[] {
	const live = listCatalogSurfaceCandidates(payload);
	const seen = new Set(live.map((r) => catalogSurfaceStableKey(r.providerType, r.modelId)));
	const merged = [...live];
	for (const row of buildIngestionEmbeddingCatalogSupplementRows()) {
		const k = catalogSurfaceStableKey(row.providerType, row.modelId);
		if (seen.has(k)) continue;
		seen.add(k);
		merged.push(row);
	}
	merged.sort((a, b) => {
		const pc = a.providerType.localeCompare(b.providerType);
		if (pc !== 0) return pc;
		return a.modelId.localeCompare(b.modelId);
	});
	return merged;
}

/** Eligible surface rows including embedding supplements (see {@link listCatalogSurfaceCandidatesWithEmbeddingSupplement}). */
export function listCatalogSurfaceRowsWithEmbeddingSupplement(payload: unknown): CatalogSurfaceRow[] {
	return listCatalogSurfaceCandidatesWithEmbeddingSupplement(payload).filter((r) => r.eligibleForSurfaces);
}

/** Rows that may be synced to Restormel or offered as defaults (usable in Keys + sufficient routing detail). */
export function listCatalogSurfaceRows(payload: unknown): CatalogSurfaceRow[] {
	return listCatalogSurfaceCandidates(payload).filter((r) => r.eligibleForSurfaces);
}

/** Map Keys-style provider to ReasoningProvider for matching allowed-models options (google → vertex). */
export function reasoningProviderForCatalogProvider(providerType: string): ReasoningProvider | null {
	const p = providerType.trim().toLowerCase();
	const mapped = p === 'google' ? 'vertex' : p;
	return isReasoningProvider(mapped) ? mapped : null;
}

/**
 * Rows that can appear in the app `/api/allowed-models` path (non-embedding + maps to a contracts reasoning provider).
 */
export function catalogRowEligibleForAppUserModels(row: CatalogSurfaceRow): boolean {
	if (!row.eligibleForSurfaces) return false;
	if (row.isEmbedding) return false;
	return reasoningProviderForCatalogProvider(row.providerType) !== null;
}

