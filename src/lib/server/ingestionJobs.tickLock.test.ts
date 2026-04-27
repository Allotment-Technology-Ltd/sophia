import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockPoolConnect = vi.fn();

vi.mock('./db/neon.js', () => ({
	getNeonPool: () => ({
		connect: mockPoolConnect
	}),
	getDrizzleDb: vi.fn()
}));

vi.mock('drizzle-orm/node-postgres', () => ({
	drizzle: vi.fn(() => ({}))
}));

describe('tickIngestionJob advisory locking', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		delete process.env.INGEST_JOB_TICK_DISTRIBUTED_LOCK;
		mockClientQuery.mockResolvedValue({ rows: [{ locked: false }] });
		mockClientRelease.mockReturnValue(undefined);
		mockPoolConnect.mockResolvedValue({
			query: mockClientQuery,
			release: mockClientRelease
		});
		const { __resetIngestionJobTickSerializationForTests } = await import('./ingestionJobs');
		__resetIngestionJobTickSerializationForTests();
	});

	it('skips promptly when another poller holds the distributed job lock', async () => {
		const { tickIngestionJob } = await import('./ingestionJobs');

		await tickIngestionJob('job-locked');

		expect(mockClientQuery).toHaveBeenCalledTimes(1);
		expect(mockClientQuery).toHaveBeenCalledWith(
			'SELECT pg_try_advisory_lock($1, hashtext($2::text)) AS locked',
			expect.any(Array)
		);
		expect(mockClientRelease).toHaveBeenCalledTimes(1);
	});
});
