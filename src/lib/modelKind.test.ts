import { describe, expect, it } from 'vitest';
import { isEmbeddingModelByProviderAndId } from './modelKind';

describe('modelKind', () => {
	it('treats voyage as embedding surface', () => {
		expect(isEmbeddingModelByProviderAndId('voyage', 'voyage-3-lite')).toBe(true);
	});

	it('detects embedding by model id pattern', () => {
		expect(isEmbeddingModelByProviderAndId('openai', 'text-embedding-3-small')).toBe(true);
		expect(isEmbeddingModelByProviderAndId('openai', 'gpt-4o')).toBe(false);
	});
});
