import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyIngestionJobTickSecret } from './internalIngestionJobTickAuth.js';

describe('verifyIngestionJobTickSecret', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('returns true when bearer matches INGESTION_JOB_TICK_SECRET', () => {
		vi.stubEnv('INGESTION_JOB_TICK_SECRET', 'test-secret-xyz');
		expect(verifyIngestionJobTickSecret('Bearer test-secret-xyz')).toBe(true);
	});

	it('returns false when wrong token', () => {
		vi.stubEnv('INGESTION_JOB_TICK_SECRET', 'a');
		expect(verifyIngestionJobTickSecret('Bearer b')).toBe(false);
	});

	it('returns false when secret not set', () => {
		vi.stubEnv('INGESTION_JOB_TICK_SECRET', '');
		expect(verifyIngestionJobTickSecret('Bearer any')).toBe(false);
	});

	it('accepts match when env has trailing newline (UI paste) and token does not', () => {
		vi.stubEnv('INGESTION_JOB_TICK_SECRET', 'abc\n');
		expect(verifyIngestionJobTickSecret('Bearer abc')).toBe(true);
	});
});
