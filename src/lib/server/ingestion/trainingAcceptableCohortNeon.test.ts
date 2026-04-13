import { describe, expect, it } from 'vitest';
import { envelopeShowsCompletedValidation } from './trainingAcceptableCohortNeon';

describe('envelopeShowsCompletedValidation', () => {
	it('returns false when envelope is null or missing timing', () => {
		expect(envelopeShowsCompletedValidation(null)).toBe(false);
		expect(envelopeShowsCompletedValidation({})).toBe(false);
	});

	it('detects validation from stage_models.validation', () => {
		expect(
			envelopeShowsCompletedValidation({
				timingTelemetry: { stage_models: { validation: 'mistral/mistral-large-latest' } }
			})
		).toBe(true);
	});

	it('detects validation from stage_ms.validating', () => {
		expect(
			envelopeShowsCompletedValidation({
				timingTelemetry: { stage_ms: { validating: 42 } }
			})
		).toBe(true);
	});

	it('returns false when validating stage_ms is zero', () => {
		expect(
			envelopeShowsCompletedValidation({
				timingTelemetry: { stage_ms: { validating: 0 }, stage_models: { extraction: 'vertex/x' } }
			})
		).toBe(false);
	});
});
