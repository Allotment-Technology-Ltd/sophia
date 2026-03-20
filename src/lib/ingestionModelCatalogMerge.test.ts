import { describe, expect, it } from 'vitest';
import {
	extractModelRowsFromRestormelPayload,
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
