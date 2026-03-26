import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	buildRestormelProjectModelEntriesOnly,
	inferIngestionEntryFromProviderModel,
	type CatalogSyncMeta
} from '$lib/ingestionModelCatalogMerge';
import {
	computeEffectiveOperationsBindings,
	fetchKeysBindableModelKeySet,
	isRestormelProjectModelRegistryBindingsEnabled,
	loadModelSurfacesConfig
} from '$lib/server/modelSurfaces';
import {
	parseCatalogContractVersionFromPayload,
	parseCatalogFreshnessFromPayload
} from '$lib/server/restormelCatalogRows';
import { restormelFetchCatalogPayloadUncached, restormelListProjectModels } from '$lib/server/restormel';
import { filterCatalogEntriesByOperatorByokActive } from '$lib/server/byok/filterCatalogEntriesByOperatorByok';
import { defaultProviders, estimateCost } from '@restormel/keys';

type FallbackPricedEntry = {
	costTier: 'low' | 'medium' | 'high';
	modelId: string;
};

function isEmbeddingModelId(modelId: string): boolean {
	const low = modelId.toLowerCase();
	return /(embedding|embed|vector|textembedding|gecko|e5-|bge-)/i.test(low);
}

function fallbackPricingPerMillion(entry: FallbackPricedEntry): {
	inputPerMillion: number;
	outputPerMillion: number;
} {
	const embedding = isEmbeddingModelId(entry.modelId);
	if (embedding) {
		if (entry.costTier === 'low') return { inputPerMillion: 0.04, outputPerMillion: 0 };
		if (entry.costTier === 'medium') return { inputPerMillion: 0.12, outputPerMillion: 0 };
		return { inputPerMillion: 0.3, outputPerMillion: 0 };
	}
	if (entry.costTier === 'low') return { inputPerMillion: 0.2, outputPerMillion: 0.8 };
	if (entry.costTier === 'medium') return { inputPerMillion: 1.0, outputPerMillion: 4.0 };
	return { inputPerMillion: 4.0, outputPerMillion: 16.0 };
}

function compactFromEntries(
	entries: Array<{
		label: string;
		provider: string;
		modelId: string;
		contextWindow: string;
		costTier: FallbackPricedEntry['costTier'] | string;
		qualityTier: string;
		speed: string;
	}>
) {
	return entries.map((entry) => {
		const estimate =
			estimateCost(entry.modelId, defaultProviders) ??
			estimateCost(`${entry.provider}/${entry.modelId}`, defaultProviders) ??
			estimateCost(`${entry.provider}:${entry.modelId}`, defaultProviders);
		const tier =
			entry.costTier === 'low' || entry.costTier === 'medium' || entry.costTier === 'high'
				? entry.costTier
				: 'medium';
		const fallback = fallbackPricingPerMillion({ costTier: tier, modelId: entry.modelId });
		return {
			label: entry.label,
			provider: entry.provider,
			modelId: entry.modelId,
			contextWindow: entry.contextWindow,
			costTier: entry.costTier,
			qualityTier: entry.qualityTier,
			speed: entry.speed,
			pricing: {
				inputPerMillion: estimate?.inputPerMillion ?? fallback.inputPerMillion,
				outputPerMillion: estimate?.outputPerMillion ?? fallback.outputPerMillion
			}
		};
	});
}

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);

	try {
		const [catalogPayload, surfacesConfig, bindableKeys] = await Promise.all([
			restormelFetchCatalogPayloadUncached(),
			loadModelSurfacesConfig(),
			fetchKeysBindableModelKeySet().catch(() => undefined as Set<string> | undefined)
		]);
		const contractVersion = parseCatalogContractVersionFromPayload(catalogPayload);
		const fr = parseCatalogFreshnessFromPayload(catalogPayload);
		const bindings = computeEffectiveOperationsBindings(catalogPayload, surfacesConfig, bindableKeys, {
			registryBindings: isRestormelProjectModelRegistryBindingsEnabled()
		});
		if (bindings.length > 0) {
			const inferred = bindings.map((b) =>
				inferIngestionEntryFromProviderModel(b.providerType, b.modelId)
			);
			const compactEntries = compactFromEntries(inferred);
			const { entries: gatedEntries, gate: operatorByokGate } =
				await filterCatalogEntriesByOperatorByokActive(compactEntries);
			const surfaceSync: CatalogSyncMeta = {
				status: 'restormel',
				remoteRowCount: bindings.length,
				annotatedCount: 0,
				inferredRemoteCount: bindings.length,
				staticSupplementCount: 0
			};
			return json({
				entries: gatedEntries,
				operatorByokGate,
				catalogSync: surfaceSync,
				supplementation: { staticEmbeddingCount: 0 },
				catalogSource: 'catalog_surfaces' as const,
				catalogContractVersion: contractVersion || null,
				catalogFresh: fr.allFresh,
				catalogFreshnessSignalsPresent: fr.signalsPresent
			});
		}
	} catch (e) {
		if (process.env.NODE_ENV !== 'test') {
			console.warn('[ingestion-model-catalog] catalog surfaces path failed, falling back', {
				message: e instanceof Error ? e.message : String(e)
			});
		}
	}

	let remote: unknown | null = null;
	let fetchError: string | null = null;
	try {
		remote = await restormelListProjectModels();
	} catch (e) {
		fetchError = e instanceof Error ? e.message : String(e);
	}

	const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, fetchError);
	const compactEntries = compactFromEntries(entries);
	const { entries: gatedEntries, gate: operatorByokGate } =
		await filterCatalogEntriesByOperatorByokActive(compactEntries);

	if (sync.status === 'unavailable') {
		console.warn('[ingestion-model-catalog] unavailable', {
			reason: sync.reason,
			remoteRowCount: sync.remoteRowCount
		});
	}

	return json({
		entries: gatedEntries,
		operatorByokGate,
		catalogSync: sync,
		supplementation: {
			staticEmbeddingCount: 0
		},
		catalogSource: 'project_index' as const,
		catalogFresh: null
	});
};
