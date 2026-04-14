import { describe, it, expect } from 'vitest';
import { mergeJobWorkerDefaultsIntoPayload } from './hydrateIngestPayloadJobDefaults.js';
import type { IngestRunPayload } from '../ingestRuns.js';

function basePayload(over: Partial<IngestRunPayload> = {}): IngestRunPayload {
	return {
		source_url: 'https://example.com/p',
		source_type: 'institutional',
		validate: true,
		model_chain: { extract: 'auto', relate: 'auto', group: 'auto', validate: 'auto' },
		ingestion_job_id: 'ingest_job_test',
		...over
	};
}

describe('mergeJobWorkerDefaultsIntoPayload', () => {
	it('fills missing forceStage from job worker_defaults', () => {
		const p = basePayload({
			batch_overrides: { ingestProvider: 'vertex' }
		});
		const out = mergeJobWorkerDefaultsIntoPayload(p, { forceStage: 'validating' });
		expect(out.batch_overrides?.forceStage).toBe('validating');
		expect(out.batch_overrides?.ingestProvider).toBe('vertex');
	});

	it('keeps run-level forceStage over job default', () => {
		const p = basePayload({
			batch_overrides: { forceStage: 'embedding', ingestProvider: 'mistral' }
		});
		const out = mergeJobWorkerDefaultsIntoPayload(p, { forceStage: 'validating' });
		expect(out.batch_overrides?.forceStage).toBe('embedding');
	});
});
