import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	computeEffectiveOperationsBindings,
	computeEffectiveUserQueryRefs,
	canonicalizeSurfaceAssignmentsForPut,
	fetchKeysBindableModelKeySet,
	isRestormelProjectModelPutProvider,
	isRestormelProjectModelRegistryBindingsEnabled,
	loadModelSurfacesConfig,
	supplementBindableKeysWithCatalogVertexEmbeddings,
	mergeSurfaceAssignmentsWithDefaults,
	modelSurfacesPutBodySchema,
	normalizeUserQueryModelRef,
	recordModelSurfacesRestormelError,
	saveModelSurfacesConfig,
	validateSurfaceAssignmentsPut,
	type ModelSurfacesStored
} from '$lib/server/modelSurfaces';
import {
	catalogRowEligibleForAppUserModels,
	catalogSurfaceStableKey,
	extractCatalogAdminEnvelope,
	listCatalogSurfaceCandidatesWithEmbeddingSupplement,
	listCatalogUnparsedModelRows,
	parseCatalogContractVersionFromPayload,
	parseCatalogFreshnessFromPayload,
	type CatalogSurfaceRow
} from '$lib/server/restormelCatalogRows';
import {
	isRestormelCatalogContractSupported,
	RESTORMEL_CATALOG_SUPPORTED_CONTRACT_VERSIONS,
	restormelFetchCatalogPayloadUncached,
	restormelReplaceProjectModelAllowlist
} from '$lib/server/restormel';
import { parseJsonBody, serializeRestormelError } from '$lib/server/restormelAdmin';
import { computeIngestionPhaseSuitability } from '$lib/ingestionPipelineModelRequirements';

async function loadCatalogContext(): Promise<{
	payload: unknown;
	contractVersion: string;
	allFresh: boolean;
	freshnessSignalsPresent: boolean;
}> {
	const payload = await restormelFetchCatalogPayloadUncached();
	const fr = parseCatalogFreshnessFromPayload(payload);
	return {
		payload,
		contractVersion: parseCatalogContractVersionFromPayload(payload),
		allFresh: fr.allFresh,
		freshnessSignalsPresent: fr.signalsPresent
	};
}

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);
	const stored = await loadModelSurfacesConfig();
	let catalogPayload: unknown = null;
	let contractVersion = '';
	let allFresh = false;
	let freshnessSignalsPresent = false;
	let catalogError: string | null = null;
	try {
		const ctx = await loadCatalogContext();
		catalogPayload = ctx.payload;
		contractVersion = ctx.contractVersion;
		allFresh = ctx.allFresh;
		freshnessSignalsPresent = ctx.freshnessSignalsPresent;
		if (!isRestormelCatalogContractSupported(contractVersion)) {
			catalogError = `catalog_contract_mismatch:${contractVersion || 'missing'} supported=${RESTORMEL_CATALOG_SUPPORTED_CONTRACT_VERSIONS.join('|')}`;
		}
	} catch (e) {
		catalogError = e instanceof Error ? e.message : String(e);
	}

	const catalogRowsRaw = catalogPayload
		? listCatalogSurfaceCandidatesWithEmbeddingSupplement(catalogPayload)
		: [];
	const catalogRowsUnparsed = catalogPayload ? listCatalogUnparsedModelRows(catalogPayload) : [];
	const catalogEnvelope = catalogPayload ? extractCatalogAdminEnvelope(catalogPayload) : {};
	const catalogTotalRowCount = catalogRowsRaw.length;
	let catalogRows = catalogRowsRaw.map((r: CatalogSurfaceRow) => ({
		...r,
		/** Canonical key for surfaceAssignments (matches save/resolve; use instead of raw provider::model). */
		surfaceRowKey: catalogSurfaceStableKey(r.providerType, r.modelId),
		userQueryable: catalogRowEligibleForAppUserModels(r),
		ingestionPhaseSuitability: computeIngestionPhaseSuitability(
			r.providerType,
			r.modelId,
			r.isEmbedding,
			r.raw
		)
	}));
	let keysBindableModelsError: string | null = null;
	let bindableKeysForPut: Set<string> | undefined;
	let keysForCatalogDisplay: Set<string> | undefined;
	try {
		bindableKeysForPut = await fetchKeysBindableModelKeySet();
		if (catalogPayload && bindableKeysForPut) {
			keysForCatalogDisplay = supplementBindableKeysWithCatalogVertexEmbeddings(
				bindableKeysForPut,
				catalogPayload
			);
		} else {
			keysForCatalogDisplay = bindableKeysForPut;
		}
	} catch (e) {
		keysBindableModelsError = e instanceof Error ? e.message : String(e);
	}
	const registryBindings = isRestormelProjectModelRegistryBindingsEnabled();
	/** Registry mode: show full v5 catalog (Mistral, DeepSeek, …); they sync as bindingKind registry. Legacy: ∩ Keys bindable + execution providers only. */
	catalogRows = catalogRows.filter((r) => {
		const n = normalizeUserQueryModelRef({ providerType: r.providerType, modelId: r.modelId });
		if (registryBindings) return true;
		if (!isRestormelProjectModelPutProvider(n.providerType)) return false;
		if (keysForCatalogDisplay === undefined) return true;
		return keysForCatalogDisplay.has(catalogSurfaceStableKey(n.providerType, n.modelId));
	});
	const effectiveOperations = catalogPayload
		? computeEffectiveOperationsBindings(catalogPayload, stored, bindableKeysForPut, {
				registryBindings
			})
		: [];
	const effectiveUserQueries = catalogPayload
		? computeEffectiveUserQueryRefs(catalogPayload, stored)
		: [];
	const surfaceAssignments = catalogPayload
		? mergeSurfaceAssignmentsWithDefaults(catalogPayload, stored)
		: {};

	return json({
		stored,
		surfaceAssignments,
		registryProjectModelBindings: registryBindings,
		catalog: {
			contractVersion: contractVersion || null,
			allFresh,
			freshnessSignalsPresent,
			error: catalogError,
			rowCount: catalogRows.length,
			...(bindableKeysForPut !== undefined ? { totalRowCount: catalogTotalRowCount } : {}),
			unparsedCount: catalogRowsUnparsed.length
		},
		catalogEnvelope,
		catalogRowsUnparsed,
		effectiveOperations,
		effectiveUserQueries,
		keysBindableModelsError,
		catalogRows
	});
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	const registryBindings = isRestormelProjectModelRegistryBindingsEnabled();
	const actor = assertAdminAccess(locals);
	let body: unknown;
	try {
		body = await parseJsonBody(request);
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Invalid JSON body' }, { status: 400 });
	}
	const parsed = modelSurfacesPutBodySchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.flatten() }, { status: 400 });
	}

	let catalogPayload: unknown;
	let allFresh: boolean;
	let freshnessSignalsPresent: boolean;
	let contractVersion: string;
	try {
		const ctx = await loadCatalogContext();
		catalogPayload = ctx.payload;
		allFresh = ctx.allFresh;
		freshnessSignalsPresent = ctx.freshnessSignalsPresent;
		contractVersion = ctx.contractVersion;
	} catch (e) {
		return json(
			{
				error: 'restormel_catalog_unavailable',
				detail: e instanceof Error ? e.message : String(e)
			},
			{ status: 502 }
		);
	}

	if (!isRestormelCatalogContractSupported(contractVersion)) {
		console.warn('[model-surfaces] catalog contract not supported by Sophia', {
			received: contractVersion || 'missing',
			supported: [...RESTORMEL_CATALOG_SUPPORTED_CONTRACT_VERSIONS]
		});
	}

	if (freshnessSignalsPresent && !allFresh) {
		return json(
			{
				error: 'catalog_not_fresh',
				detail:
					'Restormel catalog freshness signals are not healthy; refusing to replace the project model index.'
			},
			{ status: 409 }
		);
	}

	const surfaceAssignments = canonicalizeSurfaceAssignmentsForPut(
		catalogPayload,
		parsed.data.surfaceAssignments
	);
	const validated = validateSurfaceAssignmentsPut(catalogPayload, surfaceAssignments);
	if (!validated.ok) {
		return json({ error: validated.error.code, detail: validated.error }, { status: 400 });
	}

	let bindableKeys: Set<string>;
	try {
		bindableKeys = await fetchKeysBindableModelKeySet();
	} catch (e) {
		return json(
			{
				error: 'restormel_keys_bindable_models_unavailable',
				detail: e instanceof Error ? e.message : String(e)
			},
			{ status: 502 }
		);
	}
	if (bindableKeys.size === 0 && !registryBindings) {
		return json(
			{
				error: 'restormel_keys_bindable_models_empty',
				detail:
					'Restormel returned no bindable models from GET /models and the project model index; cannot validate PUT.'
			},
			{ status: 502 }
		);
	}

	const next: ModelSurfacesStored = {
		operationsMode: 'default',
		userQueriesMode: 'default',
		surfaceAssignments,
		updatedByUid: actor.uid,
		lastRestormelSyncError: null
	};

	const effectiveOps = computeEffectiveOperationsBindings(catalogPayload, next, bindableKeys, {
		registryBindings
	});
	if (effectiveOps.length === 0) {
		return json(
			{
				error: 'empty_operations_selection',
				detail: registryBindings
					? 'No models are assigned to ingestion, embeddings, or ingestion+inquiries for the Restormel project index. Adjust surface roles; refusing to clear the index.'
					: 'No non-embedding chat bindings remain that Keys accepts for the project model index (surface selections ∩ GET /models + project index bindable set). Adjust assignments upstream; refusing to clear the index.'
			},
			{ status: 400 }
		);
	}

	try {
		await restormelReplaceProjectModelAllowlist(effectiveOps);
	} catch (e) {
		const s = serializeRestormelError(e);
		await recordModelSurfacesRestormelError(s.detail);
		return json(
			{
				error: 'restormel_project_models_sync_failed',
				restormel: s
			},
			{ status: s.status }
		);
	}

	await saveModelSurfacesConfig(next, { clearRestormelError: true });

	const effectiveUserQueries = computeEffectiveUserQueryRefs(catalogPayload, next);

	const storedAfter = await loadModelSurfacesConfig();
	return json({
		ok: true,
		stored: storedAfter,
		surfaceAssignments: mergeSurfaceAssignmentsWithDefaults(catalogPayload, storedAfter),
		effectiveOperations: effectiveOps,
		effectiveUserQueries
	});
};
