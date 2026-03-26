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
	it('matches Keys PUT canonical list', () => {
		expect(isRestormelProjectModelPutProvider('openai')).toBe(true);
		expect(isRestormelProjectModelPutProvider('vertex')).toBe(true);
		expect(isRestormelProjectModelPutProvider('xai')).toBe(false);
		expect(isRestormelProjectModelPutProvider('mistral')).toBe(false);
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
				{ providerType: 'xai', modelId: 'grok-3' }
			]
		}
	};

	const keyOpenai = catalogSurfaceStableKey('openai', 'gpt-4o');
	const keyXai = catalogSurfaceStableKey('xai', 'grok-3');

	const assignments: Record<string, SurfaceRole> = {
		[keyOpenai]: 'ingestion_only',
		[keyXai]: 'ingestion_only'
	};

	const config: ModelSurfacesStored = {
		operationsMode: 'default',
		userQueriesMode: 'default',
		surfaceAssignments: assignments,
		lastRestormelSyncError: null
	};

	it('without bindable set drops non-canonical PUT providers (e.g. xai)', () => {
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
				{ providerType: 'xai', modelId: 'grok-3' }
			]
		}
	};
	const keyOpenai = catalogSurfaceStableKey('openai', 'gpt-4o');
	const keyXai = catalogSurfaceStableKey('xai', 'grok-3');
	const config: ModelSurfacesStored = {
		operationsMode: 'default',
		userQueriesMode: 'default',
		surfaceAssignments: {
			[keyOpenai]: 'ingestion_only',
			[keyXai]: 'ingestion_only'
		},
		lastRestormelSyncError: null
	};

	it('emits registry for non-bindable providers (e.g. xai) and execution for bindable chat', () => {
		const bindable = new Set([keyOpenai]);
		const out = computeEffectiveOperationsBindings(catalogPayload, config, bindable, {
			registryBindings: true
		});
		expect(out).toEqual(
			expect.arrayContaining([
				{ providerType: 'openai', modelId: 'gpt-4o', enabled: true },
				{
					providerType: 'xai',
					modelId: 'grok-3',
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
