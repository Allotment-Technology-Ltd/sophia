import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { buildRestormelProjectModelEntriesOnly } from '$lib/ingestionModelCatalogMerge';
import { INGESTION_MODEL_CATALOG } from '$lib/ingestionModelCatalog';
import { restormelListProjectModels } from '$lib/server/restormel';
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

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);

	let remote: unknown | null = null;
	let fetchError: string | null = null;
	try {
		remote = await restormelListProjectModels();
	} catch (e) {
		fetchError = e instanceof Error ? e.message : String(e);
	}

	const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, fetchError);
	const combined = [...entries];
	const seen = new Set(combined.map((entry) => `${entry.provider}::${entry.modelId}`.toLowerCase()));
	const providersInProject = new Set(combined.map((entry) => entry.provider.toLowerCase()));

	// Ensure non-Voyage embedding options remain available in the picker even if
	// the project-scoped Restormel index omits them in a given response.
	// Only supplement providers already present in the project model set to
	// avoid offering models that are likely not usable with current key config.
	let staticEmbeddingSupplementCount = 0;
	for (const entry of INGESTION_MODEL_CATALOG) {
		if (!isEmbeddingModelId(entry.modelId)) continue;
		if (entry.provider.toLowerCase() === 'voyage') continue;
		if (!providersInProject.has(entry.provider.toLowerCase())) continue;
		const key = `${entry.provider}::${entry.modelId}`.toLowerCase();
		if (seen.has(key)) continue;
		combined.push(entry);
		seen.add(key);
		staticEmbeddingSupplementCount++;
	}

	const compactEntries = combined.map((entry) => {
		const estimate =
			estimateCost(entry.modelId, defaultProviders) ??
			estimateCost(`${entry.provider}/${entry.modelId}`, defaultProviders) ??
			estimateCost(`${entry.provider}:${entry.modelId}`, defaultProviders);
		const fallback = fallbackPricingPerMillion(entry);
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

	if (sync.status === 'unavailable') {
		console.warn('[ingestion-model-catalog] unavailable', {
			reason: sync.reason,
			remoteRowCount: sync.remoteRowCount
		});
	}

	return json({
		entries: compactEntries,
		catalogSync: sync,
		supplementation: {
			staticEmbeddingCount: staticEmbeddingSupplementCount
		}
	});
};
