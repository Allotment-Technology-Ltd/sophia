import { describe, expect, it } from 'vitest';
import {
	CANONICAL_INGESTION_PRIMARY_MODELS,
	canonicalModelChainForStage
} from './ingestionCanonicalPipeline';

describe('ingestionCanonicalPipeline', () => {
	it('uses Vertex Gemini for extraction, relations, grouping, and validation primaries', () => {
		const v = CANONICAL_INGESTION_PRIMARY_MODELS;
		expect(v.extraction.provider).toBe('vertex');
		expect(v.relations).toEqual(v.extraction);
		expect(v.grouping).toEqual(v.extraction);
		expect(v.validation).toEqual(v.extraction);
	});

	it('builds validation chain with distinct ordered tiers', () => {
		const chain = canonicalModelChainForStage('validation');
		expect(chain[0]).toEqual({ provider: 'vertex', modelId: 'gemini-3-flash-preview' });
		const keys = chain.map((t) => `${t.provider}/${t.modelId}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
