import { describe, expect, it } from 'vitest';
import { computeIngestCostUsdFromReportEnvelope } from './ingestRunTimingTelemetryCostUsd.js';

describe('computeIngestCostUsdFromReportEnvelope', () => {
	it('returns null without timingTelemetry', () => {
		expect(computeIngestCostUsdFromReportEnvelope({})).toBeNull();
		expect(computeIngestCostUsdFromReportEnvelope(null)).toBeNull();
	});

	it('sums LLM + embedding for Vertex Gemini 3 flash', () => {
		const envelope = {
			timingTelemetry: {
				stage_input_tokens: { extraction: 1_000_000 },
				stage_output_tokens: { extraction: 500_000 },
				stage_models: { extraction: 'vertex/gemini-3-flash-preview' },
				vertex_embed_chars: 2_000_000
			}
		};
		const usd = computeIngestCostUsdFromReportEnvelope(envelope);
		// LLM: 0.5 * 1 + 3 * 0.5 = 2.0; embed: 2M * 0.025/M = 0.05
		expect(usd).toBeCloseTo(2.05, 5);
	});
});
