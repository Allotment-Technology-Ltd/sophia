import { describe, expect, it } from 'vitest';
import {
	CANONICAL_VOYAGE_EMBEDDING_FINGERPRINT,
	CANONICAL_VOYAGE_EMBEDDING_MODEL_LABEL
} from './ingestionCanonicalPipeline';

describe('ingestionCanonicalPipeline', () => {
	it('fixes Voyage embedding labels for the corpus', () => {
		expect(CANONICAL_VOYAGE_EMBEDDING_MODEL_LABEL).toContain('voyage');
		expect(CANONICAL_VOYAGE_EMBEDDING_FINGERPRINT).toMatch(/1024/);
	});
});
