import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { extractModelRowsFromRestormelPayload } from '$lib/ingestionModelCatalogMerge';
import { adminDb } from '$lib/server/firebase-admin';
import type { RestormelProjectModelBindingInput } from '$lib/server/restormel';
import {
	restormelListGlobalDashboardModels,
	restormelListProjectModels
} from '$lib/server/restormel';
import {
	catalogRefEligibleForSurfaces,
	catalogRowEligibleForAppUserModels,
	catalogRowToKeysProviderModel,
	catalogSurfaceStableKey,
	listCatalogSurfaceCandidatesWithEmbeddingSupplement,
	listCatalogSurfaceRowsWithEmbeddingSupplement,
	normalizeKeysProviderType,
	type CatalogSurfaceRow
} from '$lib/server/restormelCatalogRows';
import { isReasoningProvider, type ReasoningProvider } from '@restormel/contracts/providers';

const COLLECTION = 'admin_config';
const DOC_ID = 'model_surfaces';

export const modelSurfaceModes = z.enum(['default', 'explicit']);
export type ModelSurfaceMode = z.infer<typeof modelSurfaceModes>;

/** Where a catalog model is used: Restormel project index (ingestion), embedding routes, and/or app inquiry pickers. */
export const surfaceRoleSchema = z.enum([
	'off',
	'ingestion_only',
	'embeddings_only',
	'app_inquiries_only',
	'ingestion_and_inquiries'
]);
export type SurfaceRole = z.infer<typeof surfaceRoleSchema>;

export const modelRefSchema = z.object({
	providerType: z.string().min(1),
	modelId: z.string().min(1)
});
export type ModelRef = z.infer<typeof modelRefSchema>;

export const modelSurfacesPutBodySchema = z.object({
	surfaceAssignments: z.record(z.string(), surfaceRoleSchema)
});

export const modelSurfacesStoredSchema = z.object({
	surfaceAssignments: z.record(z.string(), surfaceRoleSchema).optional(),
	operationsMode: modelSurfaceModes.default('default'),
	operationsExplicit: z.array(modelRefSchema).optional(),
	userQueriesMode: modelSurfaceModes.default('default'),
	userQueriesExplicit: z.array(modelRefSchema).optional(),
	updatedByUid: z.string().optional(),
	lastRestormelSyncError: z.string().nullable().optional()
});

export type ModelSurfacesStored = z.infer<typeof modelSurfacesStoredSchema>;

const DEFAULT_STORED: ModelSurfacesStored = {
	operationsMode: 'default',
	userQueriesMode: 'default',
	lastRestormelSyncError: null
};

function docRef() {
	return adminDb.collection(COLLECTION).doc(DOC_ID);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export async function loadModelSurfacesConfig(): Promise<ModelSurfacesStored> {
	const snap = await docRef().get();
	if (!snap.exists) return { ...DEFAULT_STORED };
	const d = snap.data();
	if (!isRecord(d)) return { ...DEFAULT_STORED };
	const parsed = modelSurfacesStoredSchema.safeParse({
		surfaceAssignments: parseSurfaceAssignmentsFromDoc(d.surfaceAssignments),
		operationsMode: d.operationsMode,
		operationsExplicit: d.operationsExplicit,
		userQueriesMode: d.userQueriesMode,
		userQueriesExplicit: d.userQueriesExplicit,
		updatedByUid: typeof d.updatedByUid === 'string' ? d.updatedByUid : undefined,
		lastRestormelSyncError:
			d.lastRestormelSyncError === null || typeof d.lastRestormelSyncError === 'string'
				? d.lastRestormelSyncError
				: undefined
	});
	if (!parsed.success) return { ...DEFAULT_STORED };
	return { ...DEFAULT_STORED, ...parsed.data };
}

function parseSurfaceAssignmentsFromDoc(raw: unknown): Record<string, SurfaceRole> | undefined {
	if (!isRecord(raw) || Array.isArray(raw)) return undefined;
	const out: Record<string, SurfaceRole> = {};
	for (const [k, v] of Object.entries(raw)) {
		const p = surfaceRoleSchema.safeParse(v);
		if (p.success) out[k] = p.data;
	}
	return Object.keys(out).length ? out : undefined;
}

/** True when Firestore has no per-row assignment map (use legacy ops/user-query fields). */
export function legacySurfaceAssignmentsEmpty(config: ModelSurfacesStored): boolean {
	if (!config.surfaceAssignments) return true;
	return Object.keys(config.surfaceAssignments).length === 0;
}

function legacyOpsAllowed(row: CatalogSurfaceRow, config: ModelSurfacesStored): boolean {
	if (config.operationsMode !== 'explicit' || !config.operationsExplicit?.length) {
		return config.operationsMode === 'default';
	}
	const allow = new Set(
		config.operationsExplicit.map((e) =>
			catalogSurfaceStableKey(normalizeKeysProviderType(e.providerType), e.modelId)
		)
	);
	return catalogRefEligibleForSurfaces({ providerType: row.providerType, modelId: row.modelId }, allow);
}

function legacyUserQueryAllowed(row: CatalogSurfaceRow, config: ModelSurfacesStored): boolean {
	if (!catalogRowEligibleForAppUserModels(row)) return false;
	if (config.userQueriesMode !== 'explicit' || !config.userQueriesExplicit?.length) {
		return config.userQueriesMode === 'default';
	}
	const allow = buildUserQueryExplicitKeySet(config.userQueriesExplicit);
	const rp = catalogRefToReasoningProvider(row.providerType);
	if (!rp) return false;
	return userQueryMatchesExplicitSet(rp, row.modelId, allow);
}

/**
 * Derive a surface role from legacy default/explicit operations + user-query fields (when `surfaceAssignments` is absent).
 */
export function migrateLegacySurfaceRole(row: CatalogSurfaceRow, config: ModelSurfacesStored): SurfaceRole {
	if (!row.eligibleForSurfaces) return 'off';
	if (!legacyOpsAllowed(row, config)) return 'off';
	if (row.isEmbedding) return 'embeddings_only';
	if (!catalogRowEligibleForAppUserModels(row)) return 'ingestion_only';
	return legacyUserQueryAllowed(row, config) ? 'ingestion_and_inquiries' : 'ingestion_only';
}

/**
 * Effective role for a catalog row: stored assignment, or legacy migration, or `off` when assignments exist but this key is missing.
 */
export function resolveSurfaceRole(row: CatalogSurfaceRow, config: ModelSurfacesStored): SurfaceRole {
	const key = catalogSurfaceStableKey(row.providerType, row.modelId);
	const stored = config.surfaceAssignments?.[key];
	if (stored && surfaceRoleSchema.safeParse(stored).success) {
		return stored;
	}
	if (!legacySurfaceAssignmentsEmpty(config)) {
		return 'off';
	}
	return migrateLegacySurfaceRole(row, config);
}

export async function saveModelSurfacesConfig(
	config: ModelSurfacesStored,
	meta?: { clearRestormelError?: boolean }
): Promise<void> {
	const payload: Record<string, unknown> = {
		surfaceAssignments: config.surfaceAssignments ?? null,
		operationsMode: FieldValue.delete(),
		operationsExplicit: FieldValue.delete(),
		userQueriesMode: FieldValue.delete(),
		userQueriesExplicit: FieldValue.delete(),
		updatedAt: FieldValue.serverTimestamp(),
		updatedByUid: config.updatedByUid ?? null
	};
	if (meta?.clearRestormelError) {
		payload.lastRestormelSyncError = null;
		payload.lastRestormelSyncedAt = FieldValue.serverTimestamp();
	} else if (config.lastRestormelSyncError !== undefined) {
		payload.lastRestormelSyncError = config.lastRestormelSyncError;
	}
	await docRef().set(payload, { merge: true });
}

export async function recordModelSurfacesRestormelError(message: string): Promise<void> {
	await docRef().set(
		{
			lastRestormelSyncError: message,
			updatedAt: FieldValue.serverTimestamp()
		},
		{ merge: true }
	);
}

/** Normalize user-query refs so `google` matches Vertex-backed options in allowed-models. */
export function normalizeUserQueryModelRef(ref: ModelRef): ModelRef {
	const pt = ref.providerType.trim().toLowerCase();
	const mid = ref.modelId.trim();
	const keysPt = pt === 'google' ? 'vertex' : pt;
	return { providerType: keysPt, modelId: mid };
}

export function userQueryExplicitKey(providerType: string, modelId: string): string {
	return catalogSurfaceStableKey(normalizeUserQueryModelRef({ providerType, modelId }).providerType, modelId);
}

export function userQueryMatchesExplicitSet(
	provider: ReasoningProvider,
	modelId: string,
	explicitKeys: Set<string>
): boolean {
	const normalizedVertex = normalizeUserQueryModelRef({ providerType: provider, modelId });
	const k1 = catalogSurfaceStableKey(normalizedVertex.providerType, modelId);
	if (explicitKeys.has(k1)) return true;
	const k2 = catalogSurfaceStableKey(provider, modelId);
	return explicitKeys.has(k2);
}

export function buildUserQueryExplicitKeySet(explicit: ModelRef[]): Set<string> {
	const set = new Set<string>();
	for (const ref of explicit) {
		const n = normalizeUserQueryModelRef(ref);
		set.add(catalogSurfaceStableKey(n.providerType, n.modelId));
	}
	return set;
}

/**
 * Canonical provider slugs for **`bindingKind: "execution"`** (or omitted) on the project model index.
 * Keys requires the model id to exist in its catalog and to pass variant rules when variants exist.
 *
 * **`bindingKind: "registry"`** does not use this list: arbitrary `providerType` / `modelId` strings
 * (e.g. `mistral`, `deepseek`) are valid for index metadata / host merge and pickers; Keys does not
 * treat them as first-class execution providers (resolve, routes, cost) until the product extends there.
 *
 * Aliases like `google` → `vertex` use {@link normalizeUserQueryModelRef}.
 */
export const RESTORMEL_PROJECT_MODEL_PUT_PROVIDER_IDS = new Set([
	'openai',
	'anthropic',
	'vertex',
	'openrouter',
	'vercel',
	'portkey',
	'voyage'
]);

export function isRestormelProjectModelPutProvider(providerTypeNormalized: string): boolean {
	return RESTORMEL_PROJECT_MODEL_PUT_PROVIDER_IDS.has(providerTypeNormalized.trim().toLowerCase());
}

/**
 * Model ids Keys rejects on project model PUT (catalog variant / integration mismatch). Extend when Keys confirms.
 */
const PROJECT_MODEL_PUT_MODEL_ID_DENYLIST = new Set(['gpt-35-turbo']);

export function isDeniedProjectModelPutModelId(modelId: string): boolean {
	return PROJECT_MODEL_PUT_MODEL_ID_DENYLIST.has(modelId.trim().toLowerCase());
}

/**
 * When true, Model availability sync may send `bindingKind: "registry"` for rows that are not
 * execution-catalog-backed (Restormel Keys OpenAPI 1.3.2+, migration 021). Registry rows are
 * metadata for merge/pickers; they do not imply Keys resolve or routing understands those providers.
 * Default off for older hosts.
 */
export function isRestormelProjectModelRegistryBindingsEnabled(): boolean {
	const v = process.env.RESTORMEL_PROJECT_MODEL_REGISTRY_BINDINGS?.trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Add a stable `providerType::modelId` key for one Restormel row if it parses as a catalog ref.
 * Uses the same normalization as project model PUT (`google` → `vertex`).
 */
function addKeysBindableKeyFromRow(row: Record<string, unknown>, set: Set<string>): void {
	const ids = catalogRowToKeysProviderModel(row);
	if (!ids) return;
	const n = normalizeUserQueryModelRef(ids);
	if (!isRestormelProjectModelPutProvider(n.providerType)) return;
	set.add(catalogSurfaceStableKey(n.providerType, n.modelId));
}

/**
 * Union of **execution** provider/model pairs from global `GET /models` and `GET …/projects/{id}/models`
 * (nested `model` included). Only rows whose provider is in {@link RESTORMEL_PROJECT_MODEL_PUT_PROVIDER_IDS}
 * appear here. Used to decide which surface assignments sync as **execution** vs **registry**; not a
 * guarantee that arbitrary providers exist in Keys.
 */
export function buildKeysBindableModelKeySet(
	globalDashboardPayload: unknown,
	projectModelsPayload: unknown
): Set<string> {
	const set = new Set<string>();
	for (const payload of [globalDashboardPayload, projectModelsPayload]) {
		const rows = extractModelRowsFromRestormelPayload(payload);
		for (const row of rows) {
			if (!isRecord(row)) continue;
			addKeysBindableKeyFromRow(row, set);
			const nested = row.model;
			if (isRecord(nested)) addKeysBindableKeyFromRow(nested, set);
		}
	}
	return set;
}

/** Loads bindable keys from Restormel (global catalog + current project index). */
export async function fetchKeysBindableModelKeySet(): Promise<Set<string>> {
	const [globalPayload, projectPayload] = await Promise.all([
		restormelListGlobalDashboardModels(),
		restormelListProjectModels()
	]);
	return buildKeysBindableModelKeySet(globalPayload, projectPayload);
}

/**
 * Keys `GET /models` often omits Vertex (Google) embedding ids that the v5 catalog still lists and that ingestion uses.
 * Use this only to **widen which rows appear** in Model availability. When
 * `RESTORMEL_PROJECT_MODEL_REGISTRY_BINDINGS` is off, do not use for `computeEffectiveOperationsBindings` /
 * PUT (execution-only hosts reject unknown embedding ids). When registry bindings are enabled, PUT may send
 * `bindingKind: registry` for those rows instead.
 */
export function supplementBindableKeysWithCatalogVertexEmbeddings(
	base: Set<string>,
	catalogPayload: unknown
): Set<string> {
	const rows = listCatalogSurfaceRowsWithEmbeddingSupplement(catalogPayload);
	const out = new Set(base);
	for (const r of rows) {
		if (!r.isEmbedding) continue;
		const n = normalizeUserQueryModelRef({ providerType: r.providerType, modelId: r.modelId });
		if (n.providerType !== 'vertex') continue;
		out.add(catalogSurfaceStableKey(n.providerType, n.modelId));
	}
	return out;
}

/**
 * Builds the `models` array for `PUT …/projects/{id}/models` from catalog surface roles.
 *
 * **Registry mode** (env or option): rows that match Keys’ execution bindable set and pass the
 * denylist use execution (field omitted); everything else uses `bindingKind: "registry"` (extra
 * providers, off-catalog ids, embeddings not on GET /models, etc.) — valid index metadata without a
 * Keys catalog row for that id.
 *
 * **Legacy mode**: non-embedding, canonical providers only, intersected with bindable keys (pre-021 behaviour).
 */
export function computeEffectiveOperationsBindings(
	catalogPayload: unknown,
	config: ModelSurfacesStored,
	/**
	 * When set, only include bindings whose normalized `providerType::modelId` appears in Keys’
	 * bindable registry (global + project index). Omit in tests or when bindable fetch is unavailable.
	 */
	keysBindableModelKeys?: Set<string>,
	options?: { registryBindings?: boolean }
): RestormelProjectModelBindingInput[] {
	const registryBindings =
		options?.registryBindings ?? isRestormelProjectModelRegistryBindingsEnabled();

	const rows = listCatalogSurfaceRowsWithEmbeddingSupplement(catalogPayload);
	const rolesInRestormelIndex = new Set<SurfaceRole>([
		'ingestion_only',
		'embeddings_only',
		'ingestion_and_inquiries'
	]);
	const candidates = rows.filter((r) => rolesInRestormelIndex.has(resolveSurfaceRole(r, config)));

	if (!registryBindings) {
		const mapped = candidates
			.filter((r) => !r.isEmbedding)
			.map((r) => {
				const n = normalizeUserQueryModelRef({ providerType: r.providerType, modelId: r.modelId });
				return { providerType: n.providerType, modelId: n.modelId, enabled: true as const };
			})
			.filter((b) => isRestormelProjectModelPutProvider(b.providerType))
			.filter((b) => !isDeniedProjectModelPutModelId(b.modelId));
		if (keysBindableModelKeys === undefined) {
			return mapped;
		}
		return mapped.filter((b) =>
			keysBindableModelKeys.has(catalogSurfaceStableKey(b.providerType, b.modelId))
		);
	}

	const executionKeys = new Set<string>();
	for (const r of candidates) {
		const n = normalizeUserQueryModelRef({ providerType: r.providerType, modelId: r.modelId });
		if (!n.providerType.trim() || !n.modelId.trim()) continue;
		if (!isRestormelProjectModelPutProvider(n.providerType)) continue;
		const key = catalogSurfaceStableKey(n.providerType, n.modelId);
		const inBindable =
			keysBindableModelKeys !== undefined && keysBindableModelKeys.has(key);
		if (inBindable && !isDeniedProjectModelPutModelId(n.modelId)) {
			executionKeys.add(key);
		}
	}

	const out: RestormelProjectModelBindingInput[] = [];
	const seen = new Set<string>();

	for (const r of candidates) {
		const n = normalizeUserQueryModelRef({ providerType: r.providerType, modelId: r.modelId });
		if (!n.providerType.trim() || !n.modelId.trim()) continue;
		const key = catalogSurfaceStableKey(n.providerType, n.modelId);
		if (seen.has(key)) continue;
		seen.add(key);

		if (executionKeys.has(key)) {
			out.push({ providerType: n.providerType, modelId: n.modelId, enabled: true });
		} else {
			out.push({
				providerType: n.providerType,
				modelId: n.modelId,
				enabled: true,
				bindingKind: 'registry'
			});
		}
	}

	return out;
}

function catalogRefToReasoningProvider(providerType: string): ReasoningProvider | null {
	const n = providerType.trim().toLowerCase();
	const mapped = n === 'google' ? 'vertex' : n;
	return isReasoningProvider(mapped) ? mapped : null;
}

export function computeEffectiveUserQueryRefs(
	catalogPayload: unknown,
	config: ModelSurfacesStored
): ModelRef[] {
	const rows = listCatalogSurfaceRowsWithEmbeddingSupplement(catalogPayload);
	const appRoles = new Set<SurfaceRole>(['ingestion_and_inquiries', 'app_inquiries_only']);
	return rows
		.filter(
			(r) => appRoles.has(resolveSurfaceRole(r, config)) && catalogRowEligibleForAppUserModels(r)
		)
		.map((r) => ({ providerType: r.providerType, modelId: r.modelId }));
}

/**
 * Whether a model may appear in `/api/allowed-models` (app inquiry pickers). Uses surface assignments when present;
 * otherwise legacy user-query default/explicit rules.
 */
export function modelAllowedForInquiries(
	surfaces: ModelSurfacesStored,
	provider: ReasoningProvider,
	modelId: string
): boolean {
	const key = userQueryExplicitKey(provider, modelId);
	const stored = surfaces.surfaceAssignments?.[key];
	if (stored === 'ingestion_and_inquiries' || stored === 'app_inquiries_only') return true;
	if (
		stored === 'off' ||
		stored === 'ingestion_only' ||
		stored === 'embeddings_only'
	) {
		return false;
	}
	if (!legacySurfaceAssignmentsEmpty(surfaces)) {
		return false;
	}
	if (surfaces.userQueriesMode === 'explicit' && surfaces.userQueriesExplicit?.length) {
		const allow = buildUserQueryExplicitKeySet(surfaces.userQueriesExplicit);
		return userQueryMatchesExplicitSet(provider, modelId, allow);
	}
	return true;
}

export type SurfaceAssignmentsValidationError =
	| { code: 'surface_assignments_incomplete'; missingKeys: string[] }
	| { code: 'surface_assignments_unknown_keys'; keys: string[] }
	| { code: 'surface_role_ineligible_row'; key: string; role: SurfaceRole }
	| { code: 'surface_role_embedding_mismatch'; key: string; role: SurfaceRole }
	| { code: 'surface_role_inquiries_ineligible'; key: string; role: SurfaceRole };

/** Validate PUT body: full key coverage and role semantics vs catalog rows. */
export function validateSurfaceAssignmentsPut(
	catalogPayload: unknown,
	assignments: Record<string, SurfaceRole>
): { ok: true } | { ok: false; error: SurfaceAssignmentsValidationError } {
	const candidates = listCatalogSurfaceCandidatesWithEmbeddingSupplement(catalogPayload);
	const byKey = new Map(candidates.map((r) => [catalogSurfaceStableKey(r.providerType, r.modelId), r]));
	const expectedKeys = [...byKey.keys()];
	const missing = expectedKeys.filter((k) => assignments[k] === undefined);
	if (missing.length) {
		return { ok: false, error: { code: 'surface_assignments_incomplete', missingKeys: missing.slice(0, 48) } };
	}
	const unknown = Object.keys(assignments).filter((k) => !byKey.has(k));
	if (unknown.length) {
		return { ok: false, error: { code: 'surface_assignments_unknown_keys', keys: unknown.slice(0, 48) } };
	}
	for (const [key, role] of Object.entries(assignments)) {
		const row = byKey.get(key);
		if (!row) continue;
		if (!row.eligibleForSurfaces && role !== 'off') {
			return { ok: false, error: { code: 'surface_role_ineligible_row', key, role } };
		}
		if (row.isEmbedding) {
			if (role !== 'off' && role !== 'embeddings_only') {
				return { ok: false, error: { code: 'surface_role_embedding_mismatch', key, role } };
			}
			continue;
		}
		if (role === 'embeddings_only') {
			return { ok: false, error: { code: 'surface_role_embedding_mismatch', key, role } };
		}
		if (
			(role === 'ingestion_and_inquiries' || role === 'app_inquiries_only') &&
			!catalogRowEligibleForAppUserModels(row)
		) {
			return { ok: false, error: { code: 'surface_role_inquiries_ineligible', key, role } };
		}
	}
	return { ok: true };
}

/** Resolved role per catalog row for editors (legacy + `surfaceAssignments` + missing-key rules). */
export function mergeSurfaceAssignmentsWithDefaults(
	catalogPayload: unknown,
	stored: ModelSurfacesStored
): Record<string, SurfaceRole> {
	const rows = listCatalogSurfaceCandidatesWithEmbeddingSupplement(catalogPayload);
	const out: Record<string, SurfaceRole> = {};
	for (const row of rows) {
		const key = catalogSurfaceStableKey(row.providerType, row.modelId);
		out[key] = resolveSurfaceRole(row, stored);
	}
	return out;
}
