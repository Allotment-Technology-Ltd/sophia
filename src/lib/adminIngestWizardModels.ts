/**
 * Standalone `/admin/ingest` wizard options derived from the shared ingestion catalog.
 * Chat vs embedding split keeps Voyage (and Vertex embedding IDs) out of extract/relate/group pickers.
 */

import {
	type IngestionModelCatalogEntry,
	INGESTION_MODEL_CATALOG
} from './ingestionModelCatalog';

export type AdminIngestWizardTier = 'fast' | 'balanced' | 'powerful';

export interface AdminIngestWizardModelOption {
	/** Stable id for form state / API payload fragments */
	id: string;
	/** Same as Restormel-style `provider · modelId` */
	label: string;
	provider: string;
	tier: AdminIngestWizardTier;
	/** Rough $/1k tokens for UI comparison only */
	costPer1k: number;
	quality: number;
	speed: number;
	bestFor: string;
	badge?: string;
}

const PROVIDER_SECTION_ORDER: string[] = [
	'anthropic',
	'openai',
	'google',
	'vertex',
	'deepseek',
	'xai',
	'groq',
	'mistral',
	'together',
	'openrouter',
	'perplexity',
	'cohere',
	'voyage',
	'other'
];

function catalogEmbeddingEntry(e: IngestionModelCatalogEntry): boolean {
	if (e.provider === 'voyage') return true;
	if (/embedding|embed/i.test(e.modelId)) return true;
	return false;
}

export function catalogEntryToWizardOption(e: IngestionModelCatalogEntry): AdminIngestWizardModelOption {
	const id = `${e.provider}__${e.modelId}`.replace(/\//g, '-');
	const tier: AdminIngestWizardTier =
		e.costTier === 'low' ? 'fast' : e.costTier === 'medium' ? 'balanced' : 'powerful';
	const costPer1k = e.costTier === 'low' ? 0.00035 : e.costTier === 'medium' ? 0.003 : 0.014;
	const quality = e.qualityTier === 'capable' ? 3 : e.qualityTier === 'strong' ? 4 : 5;
	const speed = e.speed === 'fast' ? 5 : e.speed === 'balanced' ? 4 : 2;
	return {
		id,
		label: e.label,
		provider: e.provider,
		tier,
		costPer1k,
		quality,
		speed,
		bestFor: e.bestFor
	};
}

export const ADMIN_INGEST_WIZARD_MODELS: AdminIngestWizardModelOption[] =
	INGESTION_MODEL_CATALOG.map(catalogEntryToWizardOption);

export const ADMIN_INGEST_WIZARD_CHAT_MODELS: AdminIngestWizardModelOption[] =
	INGESTION_MODEL_CATALOG.filter((e) => !catalogEmbeddingEntry(e)).map(catalogEntryToWizardOption);

export const ADMIN_INGEST_WIZARD_EMBEDDING_MODELS: AdminIngestWizardModelOption[] =
	INGESTION_MODEL_CATALOG.filter(catalogEmbeddingEntry).map(catalogEntryToWizardOption);

export const ADMIN_INGEST_WIZARD_ALL_MODELS: AdminIngestWizardModelOption[] = [
	...ADMIN_INGEST_WIZARD_CHAT_MODELS,
	...ADMIN_INGEST_WIZARD_EMBEDDING_MODELS
];

export function getWizardModelById(id: string): AdminIngestWizardModelOption | undefined {
	return ADMIN_INGEST_WIZARD_ALL_MODELS.find((m) => m.id === id);
}

function providerRank(p: string): number {
	const i = PROVIDER_SECTION_ORDER.indexOf(p);
	return i === -1 ? PROVIDER_SECTION_ORDER.length : i;
}

export function groupWizardModelsByProvider(
	models: AdminIngestWizardModelOption[]
): { provider: string; models: AdminIngestWizardModelOption[] }[] {
	const map = new Map<string, AdminIngestWizardModelOption[]>();
	for (const m of models) {
		const list = map.get(m.provider) ?? [];
		list.push(m);
		map.set(m.provider, list);
	}
	return [...map.entries()]
		.sort(([a], [b]) => providerRank(a) - providerRank(b) || a.localeCompare(b))
		.map(([provider, rows]) => ({
			provider,
			models: rows.sort((x, y) => x.label.localeCompare(y.label))
		}));
}

function pickDefaultChatId(predicate: (m: AdminIngestWizardModelOption) => boolean): string {
	const hit = ADMIN_INGEST_WIZARD_CHAT_MODELS.find(predicate);
	return hit?.id ?? ADMIN_INGEST_WIZARD_CHAT_MODELS[0]?.id ?? 'anthropic__claude-3-5-sonnet-20241022';
}

/** Sensible defaults when the catalog changes */
export const DEFAULT_WIZARD_EXTRACT_ID = pickDefaultChatId(
	(m) => m.provider === 'anthropic' && m.label.includes('claude-3-5-sonnet-20241022')
);
export const DEFAULT_WIZARD_GROUP_ID = pickDefaultChatId(
	(m) => m.provider === 'anthropic' && m.label.includes('haiku')
);
export const DEFAULT_WIZARD_VALIDATE_ID = pickDefaultChatId(
	(m) => (m.provider === 'google' || m.provider === 'vertex') && m.label.includes('gemini-2.5-pro')
);
export const DEFAULT_WIZARD_EMBED_ID =
	ADMIN_INGEST_WIZARD_EMBEDDING_MODELS.find((m) => m.label.includes('text-embedding-005'))?.id ??
	ADMIN_INGEST_WIZARD_EMBEDDING_MODELS.find((m) => m.provider === 'voyage' && m.label.includes('voyage-4'))?.id ??
	ADMIN_INGEST_WIZARD_EMBEDDING_MODELS[0]?.id ??
	'vertex__text-embedding-005';

/** Pre-grouped for admin ingest UI sections */
export const CHAT_MODELS_BY_PROVIDER = groupWizardModelsByProvider(ADMIN_INGEST_WIZARD_CHAT_MODELS);
export const EMBEDDING_MODELS_BY_PROVIDER = groupWizardModelsByProvider(ADMIN_INGEST_WIZARD_EMBEDDING_MODELS);
