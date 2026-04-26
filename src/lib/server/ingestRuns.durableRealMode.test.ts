import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CHAIN_FULL, type IngestRunPayload, ingestRunUsesRealChildProcessForPayload } from './ingestRuns.js';

function minimalPayload(overrides: Partial<IngestRunPayload> = {}): IngestRunPayload {
	return {
		source_url: 'https://example.com/p',
		source_type: 'institutional',
		validate: false,
		model_chain: { ...DEFAULT_MODEL_CHAIN_FULL },
		...overrides
	};
}

describe('ingestRunUsesRealChildProcessForPayload', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('is true when ADMIN_INGEST_RUN_REAL=1 even without job id', () => {
		vi.stubEnv('ADMIN_INGEST_RUN_REAL', '1');
		expect(ingestRunUsesRealChildProcessForPayload(minimalPayload())).toBe(true);
	});

	it('is true for durable job payload when ADMIN_INGEST_RUN_REAL is unset', () => {
		vi.stubEnv('ADMIN_INGEST_RUN_REAL', '');
		expect(
			ingestRunUsesRealChildProcessForPayload(
				minimalPayload({ ingestion_job_id: 'job-uuid-123' })
			)
		).toBe(true);
	});

	it('is false for ad-hoc admin run when ADMIN_INGEST_RUN_REAL is unset', () => {
		vi.stubEnv('ADMIN_INGEST_RUN_REAL', '');
		expect(ingestRunUsesRealChildProcessForPayload(minimalPayload())).toBe(false);
	});
});
