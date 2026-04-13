/**
 * Prune Neon `ingest_runs` rows in terminal **error** when the same source identity
 * already has a **later** **done** run — safe default that preserves checkpoints for
 * URLs that never succeeded.
 *
 * Also removes mirrored `sophia_documents` (`ingestion_run_reports/<runId>`) and
 * clears `ingestion_job_items.child_run_id` when it referenced a deleted run.
 *
 * Usage:
 *   pnpm ops:prune-neon-failed-ingest-runs -- --dry-run
 *   pnpm ops:prune-neon-failed-ingest-runs -- --apply
 *   pnpm ops:prune-neon-failed-ingest-runs -- --apply --limit=200
 *
 * Requires DATABASE_URL (e.g. `tsx --env-file=.env.local` via package script).
 */

import { loadServerEnv } from '../src/lib/server/env.ts';
import { isNeonIngestPersistenceEnabled } from '../src/lib/server/neon/datastore.ts';
import { pruneSupersededFailedIngestRuns } from '../src/lib/server/db/pruneSupersededFailedIngestRuns.ts';

loadServerEnv();

function parseLimit(): number {
	const raw = process.argv.find((a) => a.startsWith('--limit='))?.slice('--limit='.length);
	const n = raw ? parseInt(raw, 10) : 500;
	if (!Number.isFinite(n) || n < 1) return 500;
	return n;
}

const apply = process.argv.includes('--apply');
const dryRun = !apply;
const limit = parseLimit();

if (!process.env.DATABASE_URL?.trim()) {
	console.error('DATABASE_URL is required.');
	process.exit(1);
}
if (!isNeonIngestPersistenceEnabled()) {
	console.error('Neon ingest persistence is not enabled (DATABASE_URL missing or disabled).');
	process.exit(1);
}

console.log(
	`[prune-neon-failed-ingest-runs] mode=${dryRun ? 'dry-run' : 'APPLY'} limit=${limit} (superseded error runs only)`
);

const result = await pruneSupersededFailedIngestRuns({ dryRun, limit });

console.log(`  candidate_run_ids: ${result.candidateRunIds.length}`);
if (result.candidateRunIds.length > 0 && result.candidateRunIds.length <= 40) {
	for (const id of result.candidateRunIds) console.log(`    ${id}`);
} else if (result.candidateRunIds.length > 40) {
	for (const id of result.candidateRunIds.slice(0, 20)) console.log(`    ${id}`);
	console.log(`    … +${result.candidateRunIds.length - 20} more`);
}

if (!dryRun) {
	console.log(
		`  detached_job_items: ${result.jobItemsDetached}  deleted_sophia_documents: ${result.sophiaDocumentsDeleted}  deleted_ingest_runs: ${result.ingestRunsDeleted}`
	);
} else {
	console.log('  (dry-run: no rows deleted; pass --apply to execute)');
}
