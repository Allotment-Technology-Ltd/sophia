import { describe, expect, it } from 'vitest';
import {
	buildRestormelProjectModelEntriesOnly,
	extractModelRowsFromRestormelPayload,
	isEmbeddingModelEntry,
	mergeCatalogWithRestormelModels,
	rowToProviderModel
} from './ingestionModelCatalogMerge';

describe('extractModelRowsFromRestormelPayload', () => {
	it('reads bare array', () => {
		const rows = extractModelRowsFromRestormelPayload([
			{ providerType: 'openai', modelId: 'gpt-4o' }
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0].modelId).toBe('gpt-4o');
	});

	it('reads data array', () => {
		const rows = extractModelRowsFromRestormelPayload({
			data: [{ provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' }]
		});
		expect(rows).toHaveLength(1);
	});

	it('reads data.models', () => {
		const rows = extractModelRowsFromRestormelPayload({
			data: { models: [{ providerType: 'google', modelId: 'gemini-2.5-flash' }] }
		});
		expect(rows).toHaveLength(1);
	});

	it('reads data.bindings (project model index)', () => {
		const rows = extractModelRowsFromRestormelPayload({
			data: {
				bindings: [{ id: 'bind_1', providerType: 'voyage', modelId: 'voyage-3', enabled: true }]
			}
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].modelId).toBe('voyage-3');
	});

	it('extracts registry bindingKind rows from data array', () => {
		const rows = extractModelRowsFromRestormelPayload({
			data: [
				{
					id: 'b_reg',
					bindingKind: 'registry',
					providerType: 'vertex',
					modelId: 'text-embedding-005',
					enabled: true,
					model: null
				}
			]
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].bindingKind).toBe('registry');
	});
});

describe('rowToProviderModel (registry / null nested model)', () => {
	it('reads top-level providerType and modelId when model is null', () => {
		const ids = rowToProviderModel({
			id: 'b1',
			bindingKind: 'registry',
			providerType: 'vertex',
			modelId: 'multimodalembedding@001',
			enabled: true,
			model: null
		});
		expect(ids).toEqual({ provider: 'vertex', modelId: 'multimodalembedding@001' });
	});
});

describe('mergeCatalogWithRestormelModels', () => {
	it('uses static catalog on fetch error', () => {
		const { entries, sync } = mergeCatalogWithRestormelModels(null, 'not_found');
		expect(sync.status).toBe('static');
		expect(entries.length).toBeGreaterThan(0);
		expect(entries.every((e) => e.catalogSource === 'static_supplement')).toBe(true);
	});

	it('merges remote rows with static annotations', () => {
		const remote = {
			data: [
				{ providerType: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
				{ providerType: 'custom', modelId: 'other-model' }
			]
		};
		const { entries, sync } = mergeCatalogWithRestormelModels(remote, null);
		expect(sync.annotatedCount).toBeGreaterThanOrEqual(1);
		expect(sync.inferredRemoteCount).toBeGreaterThanOrEqual(1);
		const sonnet = entries.find((e) => e.label.includes('claude-sonnet-4-20250514'));
		expect(sonnet?.catalogSource).toBe('annotated');
		const custom = entries.find((e) => e.modelId === 'other-model');
		expect(custom?.catalogSource).toBe('remote');
	});
});

describe('buildRestormelProjectModelEntriesOnly', () => {
	it('returns empty entries on fetch error', () => {
		const { entries, sync } = buildRestormelProjectModelEntriesOnly(null, 'unauthorized');
		expect(entries).toHaveLength(0);
		expect(sync.status).toBe('unavailable');
		expect(sync.reason).toBe('unauthorized');
	});

	it('returns only Restormel rows with no static supplement', () => {
		const remote = {
			data: [
				{ providerType: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
				{ providerType: 'vertex', modelId: 'text-embedding-005' }
			]
		};
		const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, null);
		expect(entries).toHaveLength(2);
		expect(sync.status).toBe('restormel');
		expect(sync.staticSupplementCount).toBe(0);
		expect(entries.every((e) => e.catalogSource === 'remote')).toBe(true);
	});

	it('parses snake_case and nested provider/model payloads', () => {
		const remote = {
			data: {
				models: [
					{ provider_type: 'anthropic', model_id: 'claude-sonnet-4-20250514' },
					{ provider: { type: 'openai' }, model: { id: 'gpt-4o' } }
				]
			}
		};
		const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, null);
		expect(sync.status).toBe('restormel');
		expect(entries).toHaveLength(2);
		expect(entries[0]?.provider).toBe('anthropic');
		expect(entries[0]?.modelId).toBe('claude-sonnet-4-20250514');
		expect(entries[1]?.provider).toBe('openai');
		expect(entries[1]?.modelId).toBe('gpt-4o');
	});

	it('parses object-valued providerType/modelId fields', () => {
		const remote = {
			data: [
				{ providerType: { id: 'anthropic' }, modelId: { id: 'claude-haiku-4-5-20251001' } }
			]
		};
		const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, null);
		expect(sync.status).toBe('restormel');
		expect(entries).toHaveLength(1);
		expect(entries[0]?.provider).toBe('anthropic');
		expect(entries[0]?.modelId).toBe('claude-haiku-4-5-20251001');
	});

	it('parses composite refs when provider is implicit', () => {
		const remote = {
			data: [
				{ id: 'openai/gpt-4o', canonicalName: 'openai:gpt-4o' },
				{ id: 'claude-sonnet-4-20250514', canonicalName: 'anthropic:claude-sonnet-4-20250514' }
			]
		};
		const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, null);
		expect(sync.status).toBe('restormel');
		expect(entries).toHaveLength(2);
		expect(entries[0]?.provider).toBe('openai');
		expect(entries[0]?.modelId).toBe('gpt-4o');
		expect(entries[1]?.provider).toBe('anthropic');
		expect(entries[1]?.modelId).toBe('claude-sonnet-4-20250514');
	});

	it('normalizes provider/model resource paths for embedding rows', () => {
		const remote = {
			data: [
				{
					providerType: { canonicalName: 'provider_types/google' },
					modelId: { canonicalName: 'models/text-embedding-004' }
				}
			]
		};
		const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, null);
		expect(sync.status).toBe('restormel');
		expect(entries).toHaveLength(1);
		expect(entries[0]?.provider).toBe('google');
		expect(entries[0]?.modelId).toBe('text-embedding-004');
		expect(isEmbeddingModelEntry(entries[0]!)).toBe(true);
	});

	it('returns unavailable when payload parses to zero usable models', () => {
		const { entries, sync } = buildRestormelProjectModelEntriesOnly({ data: [{ foo: 1 }] }, null);
		expect(entries).toHaveLength(0);
		expect(sync.status).toBe('unavailable');
	});

	it('skips bindings with enabled: false', () => {
		const remote = {
			data: {
				bindings: [
					{ id: 'b1', providerType: 'openai', modelId: 'gpt-4o', enabled: true },
					{ id: 'b2', providerType: 'anthropic', modelId: 'claude-haiku-4-5-20251001', enabled: false }
				]
			}
		};
		const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, null);
		expect(sync.status).toBe('restormel');
		expect(entries).toHaveLength(1);
		expect(entries[0]?.modelId).toBe('gpt-4o');
	});
});
