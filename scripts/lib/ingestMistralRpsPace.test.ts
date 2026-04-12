import { describe, expect, it } from 'vitest';
import { mistralPaceBucketForModel } from './ingestMistralRpsPace.js';

describe('mistralPaceBucketForModel', () => {
	it('classifies medium tiers', () => {
		expect(mistralPaceBucketForModel('mistral-medium-latest')).toBe('medium');
		expect(mistralPaceBucketForModel('Mistral-Medium-2505')).toBe('medium');
	});

	it('classifies large tiers', () => {
		expect(mistralPaceBucketForModel('mistral-large-latest')).toBe('large');
		expect(mistralPaceBucketForModel('mistral/mistral-large-2411')).toBe('large');
	});

	it('classifies moderation', () => {
		expect(mistralPaceBucketForModel('mistral-moderation-2411')).toBe('moderation');
	});

	it('classifies code models', () => {
		expect(mistralPaceBucketForModel('codestral-2508')).toBe('code');
		expect(mistralPaceBucketForModel('devstral-2512')).toBe('code');
	});

	it('classifies small / nemo', () => {
		expect(mistralPaceBucketForModel('mistral-small-latest')).toBe('small');
		expect(mistralPaceBucketForModel('open-mistral-nemo')).toBe('small');
	});

	it('defaults unknown ids conservatively', () => {
		expect(mistralPaceBucketForModel('custom-mistral-foo')).toBe('other');
	});
});
