import { describe, expect, it } from 'vitest';
import {
	buildKeysBindableModelKeySet,
	canonicalizeSurfaceAssignmentsForPut,
	computeEffectiveOperationsBindings,
	isDeniedProjectModelPutModelId,
	isRestormelProjectModelPutProvider,
	mergeSurfaceAssignmentsWithDefaults,
	resolveSurfaceRole,
	supplementBindableKeysWithCatalogVertexEmbeddings,
	type ModelSurfacesStored,
	type SurfaceRole
} from './modelSurfaces';
import { catalogSurfaceStableKey, type CatalogSurfaceRow } from './restormelCatalogRows';

describe('isDeniedProjectModelPutModelId', () => {
	it('flags known Keys catalog variant gaps', () => {
		expect(isDeniedProjectModelPutModelId('gpt-35-turbo')).toBe(true);
		expect(isDeniedProjectModelPutModelId('gpt-4o')).toBe(false);
	});
});

describe('isRestormelProjectModelPutProvider', () => {
	it('matches Keys PUT canonical execution providers (OpenAPI / catalog; perplexity off-list)', () => {
		expect(isRestormelProjectModelPutProvider('openai')).toBe(true);
		expect(isRestormelProjectModelPutProvider('vertex')).toBe(true);
		expect(isRestormelProjectModelPutProvider('mistral')).toBe(true);
		expect(isRestormelProjectModelPutProvider('deepseek')).toBe(true);
		expect(isRestormelProjectModelPutProvider('together')).toBe(true);
		expect(isRestormelProjectModelPutProvider('perplexity')).toBe(false);
	});
});

describe('supplementBindableKeysWithCatalogVertexEmbeddings', () => {
	it('adds Vertex embedding rows from v5 catalog when missing from Keys GET', () => {
		const base = new Set<string>();
		const catalogPayload = {
			data: {
				models: [{ providerType: 'vertex', modelId: 'text-multilingual-embedding-002' }]
			}
		};
		const out = supplementBindableKeysWithCatalogVertexEmbeddings(base, catalogPayload);
		expect(out.has(catalogSurfaceStableKey('vertex', 'text-multilingual-embedding-002'))).toBe(true);
	});
});

describe('buildKeysBindableModelKeySet', () => {
	it('merges global and project payloads and normalizes google→vertex', () => {
		const global = {
			data: [{ providerType: 'openai', modelId: 'gpt-4o' }, { providerType: 'google', modelId: 'gemini-3-flash-preview' }]
		};
		const project = { data: [] as unknown[] };
		const set = buildKeysBindableModelKeySet(global, project);
		expect(set.has(catalogSurfaceStableKey('openai', 'gpt-4o'))).toBe(true);
		expect(set.has(catalogSurfaceStableKey('vertex', 'gemini-3-flash-preview'))).toBe(true);
	});

	it('reads nested model on bindings', () => {
		const project = {
			data: [
				{
					providerType: 'anthropic',
					modelId: 'claude-haiku-4-5-20251001',
					model: { providerType: 'anthropic', modelId: 'claude-haiku-4-5-20251001' }
				}
			]
		};
		const set = buildKeysBindableModelKeySet({ data: [] }, project);
		expect(set.has(catalogSurfaceStableKey('anthropic', 'claude-haiku-4-5-20251001'))).toBe(true);
	});
});

describe('computeEffectiveOperationsBindings + bindable filter', () => {
	const catalogPayload = {
		data: {
			models: [
				{ providerType: 'openai', modelId: 'gpt-4o' },
				{ providerType: 'perplexity', modelId: 'sonar-pro' }
			]
		}
	};

	const keyOpenai = catalogSurfaceStableKey('openai', 'gpt-4o');
	const keyPerplexity = catalogSurfaceStableKey('perplexity', 'sonar-pro');

	const assignments: Record<string, SurfaceRole> = {
		[keyOpenai]: 'ingestion_only',
		[keyPerplexity]: 'ingestion_only'
	};

	const config: ModelSurfacesStored = {
		operationsMode: 'default',
		userQueriesMode: 'default',
		surfaceAssignments: assignments,
		lastRestormelSyncError: null
	};

	it('without bindable set drops non-canonical PUT providers (e.g. perplexity)', () => {
		const out = computeEffectiveOperationsBindings(catalogPayload, config, undefined, {
			registryBindings: false
		});
		expect(out).toEqual([{ providerType: 'openai', modelId: 'gpt-4o', enabled: true }]);
	});

	it('with bindable set keeps only intersecting refs', () => {
		const bindable = new Set([keyOpenai]);
		const out = computeEffectiveOperationsBindings(catalogPayload, config, bindable, {
			registryBindings: false
		});
		expect(out).toEqual([
			{ providerType: 'openai', modelId: 'gpt-4o', enabled: true }
		]);
	});

	it('excludes embedding models from PUT payload', () => {
		const embPayload = {
			data: {
				models: [
					{ providerType: 'vertex', modelId: 'text-embedding-005' },
					{ providerType: 'openai', modelId: 'gpt-4o' }
				]
			}
		};
		const kEmb = catalogSurfaceStableKey('vertex', 'text-embedding-005');
		const kChat = catalogSurfaceStableKey('openai', 'gpt-4o');
		const cfg: ModelSurfacesStored = {
			operationsMode: 'default',
			userQueriesMode: 'default',
			surfaceAssignments: {
				[kEmb]: 'embeddings_only',
				[kChat]: 'ingestion_only'
			},
			lastRestormelSyncError: null
		};
		const out = computeEffectiveOperationsBindings(embPayload, cfg, new Set([kEmb, kChat]), {
			registryBindings: false
		});
		expect(out).toEqual([{ providerType: 'openai', modelId: 'gpt-4o', enabled: true }]);
	});

	it('drops denylisted model ids', () => {
		const denyPayload = {
			data: { models: [{ providerType: 'openai', modelId: 'gpt-35-turbo' }] }
		};
		const k = catalogSurfaceStableKey('openai', 'gpt-35-turbo');
		const cfg: ModelSurfacesStored = {
			operationsMode: 'default',
			userQueriesMode: 'default',
			surfaceAssignments: { [k]: 'ingestion_only' },
			lastRestormelSyncError: null
		};
		expect(
			computeEffectiveOperationsBindings(denyPayload, cfg, new Set([k]), { registryBindings: false })
		).toEqual([]);
	});
});

describe('computeEffectiveOperationsBindings (registry bindings mode)', () => {
	const catalogPayload = {
		data: {
			models: [
				{ providerType: 'openai', modelId: 'gpt-4o' },
				{ providerType: 'perplexity', modelId: 'sonar-pro' }
			]
		}
	};
	const keyOpenai = catalogSurfaceStableKey('openai', 'gpt-4o');
	const keyPerplexity = catalogSurfaceStableKey('perplexity', 'sonar-pro');
	const config: ModelSurfacesStored = {
		operationsMode: 'default',
		userQueriesMode: 'default',
		surfaceAssignments: {
			[keyOpenai]: 'ingestion_only',
			[keyPerplexity]: 'ingestion_only'
		},
		lastRestormelSyncError: null
	};

	it('emits registry for non-bindable providers (e.g. perplexity) and execution for bindable chat', () => {
		const bindable = new Set([keyOpenai]);
		const out = computeEffectiveOperationsBindings(catalogPayload, config, bindable, {
			registryBindings: true
		});
		expect(out).toEqual(
			expect.arrayContaining([
				{ providerType: 'openai', modelId: 'gpt-4o', enabled: true },
				{
					providerType: 'perplexity',
					modelId: 'sonar-pro',
					enabled: true,
					bindingKind: 'registry'
				}
			])
		);
		expect(out).toHaveLength(2);
	});

	it('emits registry for Vertex embeddings not in bindable set', () => {
		const embPayload = {
			data: {
				models: [
					{ providerType: 'vertex', modelId: 'text-embedding-005' },
					{ providerType: 'openai', modelId: 'gpt-4o' }
				]
			}
		};
		const kEmb = catalogSurfaceStableKey('vertex', 'text-embedding-005');
		const kChat = catalogSurfaceStableKey('openai', 'gpt-4o');
		const cfg: ModelSurfacesStored = {
			operationsMode: 'default',
			userQueriesMode: 'default',
			surfaceAssignments: {
				[kEmb]: 'embeddings_only',
				[kChat]: 'ingestion_only'
			},
			lastRestormelSyncError: null
		};
		const out = computeEffectiveOperationsBindings(embPayload, cfg, new Set([kChat]), {
			registryBindings: true
		});
		expect(out).toEqual(
			expect.arrayContaining([
				{ providerType: 'openai', modelId: 'gpt-4o', enabled: true },
				{
					providerType: 'vertex',
					modelId: 'text-embedding-005',
					enabled: true,
					bindingKind: 'registry'
				}
			])
		);
		expect(out).toHaveLength(2);
	});

	it('emits registry for embeddings even when bindable set lists them (avoid Keys execution unknown-model on PUT)', () => {
		const embPayload = {
			data: {
				models: [
					{ providerType: 'vertex', modelId: 'text-embedding-005' },
					{ providerType: 'voyage', modelId: 'voyage-3-large' },
					{ providerType: 'openai', modelId: 'gpt-4o' }
				]
			}
		};
		const kEmb = catalogSurfaceStableKey('vertex', 'text-embedding-005');
		const kVoy = catalogSurfaceStableKey('voyage', 'voyage-3-large');
		const kChat = catalogSurfaceStableKey('openai', 'gpt-4o');
		const cfg: ModelSurfacesStored = {
			operationsMode: 'default',
			userQueriesMode: 'default',
			surfaceAssignments: {
				[kEmb]: 'embeddings_only',
				[kVoy]: 'embeddings_only',
				[kChat]: 'ingestion_only'
			},
			lastRestormelSyncError: null
		};
		const bindable = new Set([kEmb, kVoy, kChat]);
		const out = computeEffectiveOperationsBindings(embPayload, cfg, bindable, {
			registryBindings: true
		});
		expect(out).toEqual(
			expect.arrayContaining([
				{ providerType: 'openai', modelId: 'gpt-4o', enabled: true },
				{
					providerType: 'vertex',
					modelId: 'text-embedding-005',
					enabled: true,
					bindingKind: 'registry'
				},
				{
					providerType: 'voyage',
					modelId: 'voyage-3-large',
					enabled: true,
					bindingKind: 'registry'
				}
			])
		);
		expect(out).toHaveLength(3);
	});

	it('emits registry for legacy Mistral ids not in Keys seed (avoid execution PUT variant errors)', () => {
		const payload = {
			data: {
				models: [
					{ providerType: 'mistral', modelId: 'mixtral-8x7b-32768' },
					{ providerType: 'mistral', modelId: 'mistral-large-latest' }
				]
			}
		};
		const kLegacy = catalogSurfaceStableKey('mistral', 'mixtral-8x7b-32768');
		const kSeeded = catalogSurfaceStableKey('mistral', 'mistral-large-latest');
		const cfg: ModelSurfacesStored = {
			operationsMode: 'default',
			userQueriesMode: 'default',
			surfaceAssignments: {
				[kLegacy]: 'ingestion_only',
				[kSeeded]: 'ingestion_only'
			},
			lastRestormelSyncError: null
		};
		const bindable = new Set([kLegacy, kSeeded]);
		const out = computeEffectiveOperationsBindings(payload, cfg, bindable, { registryBindings: true });
		expect(out).toEqual(
			expect.arrayContaining([
				{
					providerType: 'mistral',
					modelId: 'mixtral-8x7b-32768',
					enabled: true,
					bindingKind: 'registry'
				},
				{ providerType: 'mistral', modelId: 'mistral-large-latest', enabled: true }
			])
		);
		expect(out).toHaveLength(2);
	});

	it('emits registry for denylisted ids when present in bindable set', () => {
		const denyPayload = {
			data: { models: [{ providerType: 'openai', modelId: 'gpt-35-turbo' }] }
		};
		const k = catalogSurfaceStableKey('openai', 'gpt-35-turbo');
		const cfg: ModelSurfacesStored = {
			operationsMode: 'default',
			userQueriesMode: 'default',
			surfaceAssignments: { [k]: 'ingestion_only' },
			lastRestormelSyncError: null
		};
		expect(
			computeEffectiveOperationsBindings(denyPayload, cfg, new Set([k]), { registryBindings: true })
		).toEqual([
			{
				providerType: 'openai',
				modelId: 'gpt-35-turbo',
				enabled: true,
				bindingKind: 'registry'
			}
		]);
	});
});

describe('canonicalizeSurfaceAssignmentsForPut', () => {
	const catalogPayload = {
		data: {
			models: [
				{ providerType: 'openai', modelId: 'gpt-4o' },
				{ providerType: 'google', modelId: 'gemini-3-flash-preview' }
			]
		}
	};

	it('keeps google:: stable key and still reads vertex:: alias from the PUT body', () => {
		const kGoogle = catalogSurfaceStableKey('google', 'gemini-3-flash-preview');
		const kVertex = catalogSurfaceStableKey('vertex', 'gemini-3-flash-preview');
		const raw = {
			[kGoogle]: 'off' as SurfaceRole,
			[catalogSurfaceStableKey('openai', 'gpt-4o')]: 'ingestion_only' as SurfaceRole
		};
		const out = canonicalizeSurfaceAssignmentsForPut(catalogPayload, raw);
		expect(out[kGoogle]).toBe('off');
		expect(out[catalogSurfaceStableKey('openai', 'gpt-4o')]).toBe('ingestion_only');

		const fromVertexOnly = canonicalizeSurfaceAssignmentsForPut(catalogPayload, {
			[kVertex]: 'ingestion_only' as SurfaceRole,
			[catalogSurfaceStableKey('openai', 'gpt-4o')]: 'off' as SurfaceRole
		});
		expect(fromVertexOnly[kGoogle]).toBe('ingestion_only');
		expect(fromVertexOnly[kVertex]).toBeUndefined();
	});

	it('forces retired Anthropic snapshots to off even when the client sends ingestion roles', () => {
		const kRetired = catalogSurfaceStableKey('anthropic', 'claude-3-5-sonnet-20241022');
		const payload = {
			data: {
				models: [{ providerType: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' }]
			}
		};
		const out = canonicalizeSurfaceAssignmentsForPut(payload, {
			[kRetired]: 'ingestion_only',
			[catalogSurfaceStableKey('openai', 'gpt-4o')]: 'ingestion_only'
		});
		expect(out[kRetired]).toBe('off');
	});
});

describe('Sophia ingestion denylist (retired Anthropic API ids)', () => {
	const retiredAnthropicRow = (modelId: string): CatalogSurfaceRow => ({
		providerType: 'anthropic',
		modelId,
		isEmbedding: false,
		catalogUsable: true,
		detailsSufficient: true,
		eligibleForSurfaces: true,
		raw: { providerType: 'anthropic', modelId }
	});

	it('resolveSurfaceRole returns off for denylisted ids even when Firestore had ingestion', () => {
		const row = retiredAnthropicRow('claude-3-5-sonnet-20241022');
		const k = catalogSurfaceStableKey('anthropic', 'claude-3-5-sonnet-20241022');
		const config: ModelSurfacesStored = {
			operationsMode: 'default',
			userQueriesMode: 'default',
			surfaceAssignments: { [k]: 'ingestion_only' },
			lastRestormelSyncError: null
		};
		expect(resolveSurfaceRole(row, config)).toBe('off');
	});

	it('mergeSurfaceAssignmentsWithDefaults surfaces denylisted rows as off', () => {
		const payload = {
			data: {
				models: [{ providerType: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' }]
			}
		};
		const k = catalogSurfaceStableKey('anthropic', 'claude-3-5-sonnet-20241022');
		const stored: ModelSurfacesStored = {
			operationsMode: 'default',
			userQueriesMode: 'default',
			surfaceAssignments: { [k]: 'ingestion_only' },
			lastRestormelSyncError: null
		};
		const merged = mergeSurfaceAssignmentsWithDefaults(payload, stored);
		expect(merged[k]).toBe('off');
	});
});
