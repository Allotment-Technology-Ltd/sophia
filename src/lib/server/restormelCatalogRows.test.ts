import { describe, expect, it } from 'vitest';
import {
	catalogRowToKeysProviderModel,
	extractCatalogAdminEnvelope,
	isCatalogRowActive,
	listCatalogSurfaceCandidates,
	listCatalogSurfaceCandidatesWithEmbeddingSupplement,
	listCatalogSurfaceRows,
	listCatalogUnparsedModelRows,
	parseCatalogFreshnessFromPayload,
	readRestormelCatalogDataModels,
	reasoningProviderForCatalogProvider
} from './restormelCatalogRows';

describe('restormelCatalogRows', () => {
	it('reads models from data.models envelope', () => {
		const payload = {
			data: {
				models: [{ providerType: 'openai', modelId: 'gpt-4o', active: true }]
			}
		};
		expect(readRestormelCatalogDataModels(payload)).toHaveLength(1);
	});

	it('reads models when data is a direct array (canonical catalog)', () => {
		const payload = {
			contractVersion: '2026-03-23.catalog.v1',
			data: [
				{ providerType: 'anthropic', providerModelId: 'claude-sonnet-4-20250514' },
				{ providerType: 'openai', modelId: 'gpt-4o' }
			]
		};
		expect(readRestormelCatalogDataModels(payload)).toHaveLength(2);
	});

	it('treats missing freshness block as signals absent and not stale', () => {
		const fr = parseCatalogFreshnessFromPayload({ data: { models: [] } });
		expect(fr.signalsPresent).toBe(false);
		expect(fr.allFresh).toBe(true);
	});

	it('marks retired rows inactive', () => {
		const row = { providerType: 'openai', modelId: 'gpt-4o', retired: true };
		expect(isCatalogRowActive(row)).toBe(false);
	});

	it('extracts provider and model from catalog row', () => {
		const row = { providerType: 'anthropic', modelId: 'claude-sonnet-4-20250514' };
		expect(catalogRowToKeysProviderModel(row)).toEqual({
			providerType: 'anthropic',
			modelId: 'claude-sonnet-4-20250514'
		});
	});

	it('infers mistral provider from model id when providerType is absent', () => {
		expect(
			catalogRowToKeysProviderModel({ providerModelId: 'mistral-large-latest' })
		).toEqual({ providerType: 'mistral', modelId: 'mistral-large-latest' });
		expect(catalogRowToKeysProviderModel({ modelId: 'ministral-8b-latest' })).toEqual({
			providerType: 'mistral',
			modelId: 'ministral-8b-latest'
		});
		expect(reasoningProviderForCatalogProvider('mistral')).toBe('mistral');
	});

	it('normalizes mistralai vendor label to mistral', () => {
		expect(
			catalogRowToKeysProviderModel({
				providerType: 'mistralai',
				providerModelId: 'mistral-large-latest'
			})
		).toEqual({ providerType: 'mistral', modelId: 'mistral-large-latest' });
	});

	it('lists surface rows with embedding flag', () => {
		const payload = {
			data: {
				models: [
					{ providerType: 'openai', modelId: 'gpt-4o' },
					{ providerType: 'voyage', modelId: 'voyage-3-lite' }
				]
			}
		};
		const rows = listCatalogSurfaceRows(payload);
		expect(rows).toHaveLength(2);
		const emb = rows.find((r) => r.providerType === 'voyage');
		expect(emb?.isEmbedding).toBe(true);
		const chat = rows.find((r) => r.modelId === 'gpt-4o');
		expect(chat?.isEmbedding).toBe(false);
		expect(rows.every((r) => r.eligibleForSurfaces)).toBe(true);
		expect(chat?.raw?.modelId).toBe('gpt-4o');
	});

	it('includes raw snapshot on candidates', () => {
		const payload = {
			data: [{ providerType: 'openai', modelId: 'gpt-4o', lifecycle: 'ga', customField: 42 }]
		};
		const c = listCatalogSurfaceCandidates(payload)[0];
		expect(c?.raw.lifecycle).toBe('ga');
		expect(c?.raw.customField).toBe(42);
	});

	it('lists unparsed rows when provider/model cannot be resolved', () => {
		const payload = {
			data: [{ providerType: 'openai', modelId: 'gpt-4o' }, { foo: 'bar' }]
		};
		const u = listCatalogUnparsedModelRows(payload);
		expect(u).toHaveLength(1);
		expect(u[0].raw.foo).toBe('bar');
	});

	it('extracts catalog envelope without model arrays', () => {
		const env = extractCatalogAdminEnvelope({
			contractVersion: 'v1',
			providers: [{ id: 'openai' }],
			data: {
				contractVersion: 'nested',
				externalSignals: { freshness: { allFresh: true } },
				models: []
			}
		});
		expect(env.providers).toHaveLength(1);
		expect((env.dataMeta as { contractVersion?: string }).contractVersion).toBe('nested');
	});

	it('excludes preview lifecycle from default surface list but keeps row in candidates', () => {
		const payload = {
			data: {
				models: [
					{ providerType: 'openai', modelId: 'gpt-4o' },
					{ providerType: 'openai', modelId: 'gpt-5', lifecycle: 'preview' }
				]
			}
		};
		expect(listCatalogSurfaceRows(payload)).toHaveLength(1);
		const cand = listCatalogSurfaceCandidates(payload).find((r) => r.modelId === 'gpt-5');
		expect(cand?.catalogUsable).toBe(false);
		expect(cand?.eligibleForSurfaces).toBe(false);
	});

	it('excludes uuid-only model id when no explicit model fields', () => {
		const uuid = '550e8400-e29b-41d4-a716-446655440000';
		const payload = {
			data: {
				models: [{ providerType: 'openai', id: uuid }]
			}
		};
		expect(listCatalogSurfaceRows(payload)).toHaveLength(0);
		const cand = listCatalogSurfaceCandidates(payload)[0];
		expect(cand?.detailsSufficient).toBe(false);
		expect(cand?.eligibleForSurfaces).toBe(false);
	});

	it('treats unknown status as not blocking when lifecycle is absent', () => {
		expect(
			isCatalogRowActive({
				providerType: 'openai',
				modelId: 'gpt-4o',
				status: 'pending_review'
			})
		).toBe(true);
	});

	it('merges embedding-specialist static rows when absent from live catalog', () => {
		const payload = { data: { models: [] as unknown[] } };
		const merged = listCatalogSurfaceCandidatesWithEmbeddingSupplement(payload);
		const google005 = merged.find((r) => r.providerType === 'google' && r.modelId === 'text-embedding-005');
		expect(google005).toBeDefined();
		expect(google005?.raw.sophiaCatalogSupplement).toBe(true);
		expect(google005?.isEmbedding).toBe(true);
		const ml002 = merged.find(
			(r) => r.providerType === 'vertex' && r.modelId === 'text-multilingual-embedding-002'
		);
		expect(ml002).toBeDefined();
	});

	it('does not duplicate rows when live catalog already lists a supplemented model', () => {
		const payload = {
			data: {
				models: [{ providerType: 'google', modelId: 'text-embedding-005', lifecycle: 'ga' }]
			}
		};
		const merged = listCatalogSurfaceCandidatesWithEmbeddingSupplement(payload);
		const hits = merged.filter((r) => r.providerType === 'google' && r.modelId === 'text-embedding-005');
		expect(hits).toHaveLength(1);
		expect(hits[0]?.raw.sophiaCatalogSupplement).toBeUndefined();
	});
});
