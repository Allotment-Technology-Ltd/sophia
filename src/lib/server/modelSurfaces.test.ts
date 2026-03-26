import { describe, expect, it } from 'vitest';
import {
	buildKeysBindableModelKeySet,
	computeEffectiveOperationsBindings,
	isDeniedProjectModelPutModelId,
	isRestormelProjectModelPutProvider,
	supplementBindableKeysWithCatalogVertexEmbeddings,
	type ModelSurfacesStored,
	type SurfaceRole
} from './modelSurfaces';
import { catalogSurfaceStableKey } from './restormelCatalogRows';

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
			data: [{ providerType: 'openai', modelId: 'gpt-4o' }, { providerType: 'google', modelId: 'gemini-2.0-flash' }]
		};
		const project = { data: [] as unknown[] };
		const set = buildKeysBindableModelKeySet(global, project);
		expect(set.has(catalogSurfaceStableKey('openai', 'gpt-4o'))).toBe(true);
		expect(set.has(catalogSurfaceStableKey('vertex', 'gemini-2.0-flash'))).toBe(true);
	});

	it('reads nested model on bindings', () => {
		const project = {
			data: [
				{
					providerType: 'anthropic',
					modelId: 'claude-3-5-haiku-20241022',
					model: { providerType: 'anthropic', modelId: 'claude-3-5-haiku-20241022' }
				}
			]
		};
		const set = buildKeysBindableModelKeySet({ data: [] }, project);
		expect(set.has(catalogSurfaceStableKey('anthropic', 'claude-3-5-haiku-20241022'))).toBe(true);
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
