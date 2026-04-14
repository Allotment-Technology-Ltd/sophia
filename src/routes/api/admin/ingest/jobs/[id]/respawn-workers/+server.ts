import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getDrizzleDb } from '$lib/server/db/neon';
import { ingestionJobItems } from '$lib/server/db/schema';
import { ingestRunManager } from '$lib/server/ingestRuns';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

/**
 * POST — for each **running** job item with a `child_run_id`, call {@link ingestRunManager.respawnWorkerFromCheckpoint}
 * so workers lost after a **deploy** can be re-attached without cancelling the job.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	assertAdminAccess(locals);
	if (!isNeonIngestPersistenceEnabled()) {
		return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
	}
	const jobId = params.id?.trim();
	if (!jobId) {
		return json({ error: 'Missing job id' }, { status: 400 });
	}

	const db = getDrizzleDb();
	const rows = await db
		.select({ childRunId: ingestionJobItems.childRunId })
		.from(ingestionJobItems)
		.where(and(eq(ingestionJobItems.jobId, jobId), eq(ingestionJobItems.status, 'running')));

	const seen = new Set<string>();
	const results: { childRunId: string; ok: boolean; error?: string }[] = [];

	for (const r of rows) {
		const rid = r.childRunId?.trim();
		if (!rid || seen.has(rid)) continue;
		seen.add(rid);
		const out = await ingestRunManager.respawnWorkerFromCheckpoint(rid);
		if (out.ok) {
			results.push({ childRunId: rid, ok: true });
		} else {
			results.push({ childRunId: rid, ok: false, error: out.error });
		}
	}

	const failures = results.filter((x) => !x.ok);
	return json({
		ok: failures.length === 0,
		job_id: jobId,
		touched: results.length,
		results,
		...(failures.length > 0 ? { warning: `${failures.length} respawn(s) failed (see results).` } : {})
	});
};
