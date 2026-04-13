import { describe, expect, it } from 'vitest';
import {
	CANONICAL_INGESTION_PRIMARY_MODELS,
	canonicalModelChainForStage
} from './ingestionCanonicalPipeline';

describe('ingestionCanonicalPipeline', () => {
	it('uses a different default primary for validation than for extraction', () => {
		const ext = CANONICAL_INGESTION_PRIMARY_MODELS.extraction;
		const val = CANONICAL_INGESTION_PRIMARY_MODELS.validation;
		expect(`${ext.provider}/${ext.modelId}`).not.toBe(`${val.provider}/${val.modelId}`);
	});

	it('builds validation chain with distinct ordered tiers', () => {
		const chain = canonicalModelChainForStage('validation');
		expect(chain[0]).toEqual({ provider: 'mistral', modelId: 'mistral-large-latest' });
		const keys = chain.map((t) => `${t.provider}/${t.modelId}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
