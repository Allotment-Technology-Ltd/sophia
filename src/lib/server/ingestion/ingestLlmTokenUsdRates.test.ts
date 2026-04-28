import { describe, expect, it } from 'vitest';
import {
	estimateIngestLlmUsageUsd,
	getIngestLlmUsdPerMillion,
	normalizeIngestBillingModelId
} from './ingestLlmTokenUsdRates.js';

describe('normalizeIngestBillingModelId', () => {
	it('strips provider/model prefix', () => {
		expect(normalizeIngestBillingModelId('vertex/gemini-3-flash-preview')).toBe('gemini-3-flash-preview');
	});
});

describe('Vertex Gemini 3 supplement', () => {
	it('resolves gemini-3-flash-preview', () => {
		const r = getIngestLlmUsdPerMillion('gemini-3-flash-preview');
		expect(r?.inputPerMillion).toBe(0.5);
		expect(r?.outputPerMillion).toBe(3);
	});

	it('resolves vertex-prefixed ref', () => {
		const r = getIngestLlmUsdPerMillion('vertex/gemini-3.1-pro-preview');
		expect(r?.inputPerMillion).toBe(1.25);
		expect(r?.outputPerMillion).toBe(5);
	});

	it('estimates non-zero USD for flash usage', () => {
		const usd = estimateIngestLlmUsageUsd('gemini-3-flash-preview', 2_000_000, 500_000);
		expect(usd).toBeCloseTo(0.5 * 2 + 3 * 0.5, 6);
	});
});
