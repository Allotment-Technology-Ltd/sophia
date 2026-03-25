import { describe, expect, it } from 'vitest';
import {
	buildRestormelProjectModelEntriesOnly,
	extractModelRowsFromRestormelPayload,
	isEmbeddingModelEntry,
	mergeCatalogWithRestormelModels
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
			data: [{ provider: 'anthropic', modelId: 'claude-3-5-haiku-20241022' }]
		});
		expect(rows).toHaveLength(1);
	});

	it('reads data.models', () => {
		const rows = extractModelRowsFromRestormelPayload({
			data: { models: [{ providerType: 'google', modelId: 'gemini-2.5-flash' }] }
		});
		expect(rows).toHaveLength(1);
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
				{ providerType: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' },
				{ providerType: 'custom', modelId: 'other-model' }
			]
		};
		const { entries, sync } = mergeCatalogWithRestormelModels(remote, null);
		expect(sync.annotatedCount).toBeGreaterThanOrEqual(1);
		expect(sync.inferredRemoteCount).toBeGreaterThanOrEqual(1);
		const sonnet = entries.find((e) => e.label.includes('claude-3-5-sonnet-20241022'));
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
				{ providerType: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' },
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
					{ provider_type: 'anthropic', model_id: 'claude-3-5-sonnet-20241022' },
					{ provider: { type: 'openai' }, model: { id: 'gpt-4o' } }
				]
			}
		};
		const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, null);
		expect(sync.status).toBe('restormel');
		expect(entries).toHaveLength(2);
		expect(entries[0]?.provider).toBe('anthropic');
		expect(entries[0]?.modelId).toBe('claude-3-5-sonnet-20241022');
		expect(entries[1]?.provider).toBe('openai');
		expect(entries[1]?.modelId).toBe('gpt-4o');
	});

	it('parses object-valued providerType/modelId fields', () => {
		const remote = {
			data: [
				{ providerType: { id: 'anthropic' }, modelId: { id: 'claude-3-5-haiku-20241022' } }
			]
		};
		const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, null);
		expect(sync.status).toBe('restormel');
		expect(entries).toHaveLength(1);
		expect(entries[0]?.provider).toBe('anthropic');
		expect(entries[0]?.modelId).toBe('claude-3-5-haiku-20241022');
	});

	it('parses composite refs when provider is implicit', () => {
		const remote = {
			data: [
				{ id: 'openai/gpt-4o', canonicalName: 'openai:gpt-4o' },
				{ id: 'claude-3-5-sonnet-20241022', canonicalName: 'anthropic:claude-3-5-sonnet-20241022' }
			]
		};
		const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, null);
		expect(sync.status).toBe('restormel');
		expect(entries).toHaveLength(2);
		expect(entries[0]?.provider).toBe('openai');
		expect(entries[0]?.modelId).toBe('gpt-4o');
		expect(entries[1]?.provider).toBe('anthropic');
		expect(entries[1]?.modelId).toBe('claude-3-5-sonnet-20241022');
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
});
