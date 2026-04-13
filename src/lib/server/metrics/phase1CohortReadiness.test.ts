import { describe, expect, it } from 'vitest';
import { classifyPhase1UrlReadiness } from './phase1CohortReadiness';

describe('classifyPhase1UrlReadiness', () => {
	it('treats null envelope as incomplete pipeline', () => {
		expect(classifyPhase1UrlReadiness(null)).toBe('incomplete');
	});

	it('rejects validate=false', () => {
		expect(classifyPhase1UrlReadiness({ validate: false, timingTelemetry: {} })).toBe('no_validate');
	});

	it('accepts full pipeline timing shape', () => {
		const env = {
			validate: true,
			timingTelemetry: {
				stage_ms: {
					validating: 1200,
					remediating: 400,
					embedding: 8000,
					storing: 5000
				}
			}
		};
		expect(classifyPhase1UrlReadiness(env)).toBe('ready');
	});

	it('treats skipped surreal store as not ready', () => {
		expect(
			classifyPhase1UrlReadiness({
				validate: true,
				timingTelemetry: {
					skipped_surreal_store_no_graph_changes: true,
					stage_ms: { validating: 1, remediating: 0, embedding: 1, storing: 0 }
				}
			})
		).toBe('skipped_store');
	});

	it('requires remediating key in stage_ms', () => {
		expect(
			classifyPhase1UrlReadiness({
				validate: true,
				timingTelemetry: {
					stage_ms: { validating: 100, embedding: 50, storing: 20 }
				}
			})
		).toBe('incomplete');
	});
});
