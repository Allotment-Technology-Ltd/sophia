/**
 * Poll Neon for running ingestion jobs and advance them (tick).
 * Run as a long-lived process (Railway second service, GCE, etc.) with DATABASE_URL + the same
 * env as admin ingest workers. Unattended production on Railway: see docs/sophia/deployment-railway.md
 * (HTTP tick via INGESTION_JOB_TICK_SECRET, or this script). Legacy: GCP Cloud Run job.
 *
 * Usage: npx tsx --env-file=.env scripts/ingestion-job-poller.ts [--once] [--interval 5]
 */

import { loadServerEnv } from '../src/lib/server/env.ts';
import { tickAllRunningIngestionJobs } from '../src/lib/server/ingestionJobs.ts';
import { tickAllRunningReembedJobs } from '../src/lib/server/ingestion/reembedCorpusJob.ts';
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
				console.log(`[poller] Ticked ${n} ingestion job(s)`);
			}
			const r = await tickAllRunningReembedJobs();
			if (r > 0) {
				console.log(`[poller] Ticked ${r} re-embed job(s)`);
			}
		} catch (e) {
			console.error('[poller]', e instanceof Error ? e.message : e);
		}
		if (once) break;
		await sleep(intervalSec);
	} while (true);
}

void main();
