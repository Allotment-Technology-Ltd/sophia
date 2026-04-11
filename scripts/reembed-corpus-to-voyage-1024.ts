/**
 * Corpus re-embed toward the current runtime embedding dimension (Voyage = 1024 when EMBEDDING_PROVIDER=voyage).
 * Uses the same Neon job + tick implementation as the admin Issue Resolution UI.
 *
 * Usage:
 *   tsx --env-file=.env scripts/reembed-corpus-to-voyage-1024.ts --dry-run
 *   tsx --env-file=.env scripts/reembed-corpus-to-voyage-1024.ts --follow
 *
 * Without --follow, creates the job and exits (ingestion-job-poller advances it).
 */

import { loadServerEnv } from '../src/lib/server/env.ts';
import { getEmbeddingDimensions } from '../src/lib/server/embeddings.ts';
import {
	createReembedJob,
	getReembedJob,
	tickReembedJob
} from '../src/lib/server/ingestion/reembedCorpusJob.ts';
import { getReembedCorpusInventory } from '../src/lib/server/ingestion/reembedCorpusInventory.ts';
import { isNeonIngestPersistenceEnabled } from '../src/lib/server/neon/datastore.ts';

loadServerEnv();

function argInt(name: string, fallback: number): number {
	const raw = process.argv.find((a) => a.startsWith(`${name}=`));
	if (!raw) return fallback;
	const n = parseInt(raw.split('=')[1] ?? '', 10);
	return Number.isFinite(n) ? n : fallback;
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');
	const follow = process.argv.includes('--follow');
	const targetDim = getEmbeddingDimensions();

	if (dryRun) {
		const inv = await getReembedCorpusInventory(targetDim);
		console.log(JSON.stringify({ targetDim, inventory: inv }, null, 2));
		return;
	}

	if (!isNeonIngestPersistenceEnabled()) {
		console.error('[reembed] DATABASE_URL / Neon persistence is not enabled.');
		process.exit(1);
	}

	const batchSize = argInt('--batch-size', 50);
	const created = await createReembedJob({
		actorEmail: 'cli@reembed-corpus-to-voyage-1024',
		batchSize
	});
	if (!created) {
		console.error('[reembed] Failed to create job.');
		process.exit(1);
	}
	console.log(`[reembed] Created job ${created.id} (targetDim=${targetDim}, batchSize=${batchSize})`);

	if (!follow) {
		console.log('[reembed] Exiting without --follow; use ingestion-job-poller or admin “Advance one step”.');
		return;
	}

	let guard = 0;
	while (guard++ < 500_000) {
		await tickReembedJob(created.id);
		const j = await getReembedJob(created.id);
		if (!j) break;
		if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') {
			console.log(`[reembed] Terminal status: ${j.status} stage=${j.stage} lastError=${j.lastError ?? ''}`);
			process.exit(j.status === 'done' ? 0 : 1);
		}
	}
	console.error('[reembed] Aborted: iteration limit');
	process.exit(1);
}

void main().catch((e) => {
	console.error(e);
	process.exit(1);
});
