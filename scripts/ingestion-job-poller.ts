/**
 * Poll Neon for running ingestion jobs and advance them (tick).
 * Run on GCP (Cloud Run job, GCE, etc.) with DATABASE_URL + same env as admin ingest workers.
 *
 * Usage: npx tsx --env-file=.env scripts/ingestion-job-poller.ts [--once] [--interval 5]
 */

import { loadServerEnv } from '../src/lib/server/env.ts';
import { tickAllRunningIngestionJobs } from '../src/lib/server/ingestionJobs.ts';
import { isNeonIngestPersistenceEnabled } from '../src/lib/server/neon/datastore.ts';

loadServerEnv();

function sleep(seconds: number): Promise<void> {
	return new Promise((r) => setTimeout(r, seconds * 1000));
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const once = args.includes('--once');
	const intervalIdx = args.indexOf('--interval');
	const intervalSec =
		intervalIdx >= 0 && args[intervalIdx + 1]
			? Math.max(2, Math.min(120, parseInt(args[intervalIdx + 1]!, 10) || 5))
			: 5;

	if (!isNeonIngestPersistenceEnabled()) {
		console.error('[poller] Neon ingest persistence not enabled (DATABASE_URL / config).');
		process.exit(1);
	}

	console.log(`[poller] Starting (interval ${intervalSec}s, once=${once})`);

	do {
		try {
			const n = await tickAllRunningIngestionJobs();
			if (n > 0) {
				console.log(`[poller] Ticked ${n} job(s)`);
			}
		} catch (e) {
			console.error('[poller]', e instanceof Error ? e.message : e);
		}
		if (once) break;
		await sleep(intervalSec);
	} while (true);
}

void main();
