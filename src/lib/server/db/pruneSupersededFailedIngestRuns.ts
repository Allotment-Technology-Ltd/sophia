/**
 * Safely remove terminal `ingest_runs` rows in `error` state when the same source
 * already has a **later** successful (`done`) completion — reduces Neon storage and
 * operator noise without dropping the only durable checkpoint for a URL.
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { canonicalizeAndHashSourceUrl } from '../sourceIdentity';
import { getDrizzleDb } from './neon';
import {
	ingestRuns,
	ingestionJobItems,
	sophiaDocuments
} from './schema';

export function ingestRunSourceIdentityKey(sourceUrl: string): string {
	const id = canonicalizeAndHashSourceUrl(sourceUrl);
	if (id) return `h:${id.canonicalUrlHash}`;
	const t = sourceUrl.trim();
	return t ? `u:${t}` : 'u:';
}

/**
 * `errors` / `successes` must be terminal rows (`status` filtered by caller).
 * Returns run ids to delete: each error has `completed_at` strictly before the latest
 * `done.completed_at` for the same identity key.
 */
export function pickSupersededFailedIngestRunIds(
	errors: Array<{ id: string; sourceUrl: string; completedAt: Date | null }>,
	successes: Array<{ id: string; sourceUrl: string; completedAt: Date | null }>
): string[] {
	const maxDoneMsByKey = new Map<string, number>();
	for (const s of successes) {
		if (!s.completedAt) continue;
		const k = ingestRunSourceIdentityKey(s.sourceUrl);
		const t = s.completedAt.getTime();
		const prev = maxDoneMsByKey.get(k) ?? 0;
		if (t > prev) maxDoneMsByKey.set(k, t);
	}
	const out: string[] = [];
	for (const e of errors) {
		if (!e.completedAt) continue;
		const k = ingestRunSourceIdentityKey(e.sourceUrl);
		const maxDone = maxDoneMsByKey.get(k);
		if (maxDone != null && e.completedAt.getTime() < maxDone) {
			out.push(e.id);
		}
	}
	return out;
}

export type PruneSupersededFailedIngestRunsResult = {
	candidateRunIds: string[];
	jobItemsDetached: number;
	sophiaDocumentsDeleted: number;
	ingestRunsDeleted: number;
	dryRun: boolean;
};

/**
 * Deletes `ingest_runs` (cascade: logs, issues, staging*) and mirrored
 * `sophia_documents` paths `ingestion_run_reports/<id>`. Clears `ingestion_job_items.child_run_id`
 * when it points at a deleted run (no FK).
 */
export async function pruneSupersededFailedIngestRuns(opts: {
	dryRun: boolean;
	/** Max runs to delete in one invocation (safety). */
	limit: number;
}): Promise<PruneSupersededFailedIngestRunsResult> {
	const db = getDrizzleDb();
	const limit = Math.min(10_000, Math.max(1, opts.limit));

	const errorRows = await db
		.select({
			id: ingestRuns.id,
			sourceUrl: ingestRuns.sourceUrl,
			completedAt: ingestRuns.completedAt
		})
		.from(ingestRuns)
		.where(and(eq(ingestRuns.status, 'error'), isNotNull(ingestRuns.completedAt)));

	const doneRows = await db
		.select({
			id: ingestRuns.id,
			sourceUrl: ingestRuns.sourceUrl,
			completedAt: ingestRuns.completedAt
		})
		.from(ingestRuns)
		.where(and(eq(ingestRuns.status, 'done'), isNotNull(ingestRuns.completedAt)));

	const allCandidates = pickSupersededFailedIngestRunIds(errorRows, doneRows);
	const candidateRunIds = allCandidates.slice(0, limit);

	if (opts.dryRun || candidateRunIds.length === 0) {
		return {
			candidateRunIds,
			jobItemsDetached: 0,
			sophiaDocumentsDeleted: 0,
			ingestRunsDeleted: 0,
			dryRun: opts.dryRun
		};
	}

	const reportPaths = candidateRunIds.map((id) => `ingestion_run_reports/${id}`);

	const { jobItemsDetached, sophiaDocumentsDeleted } = await db.transaction(async (tx) => {
		const detached = await tx
			.update(ingestionJobItems)
			.set({ childRunId: null, updatedAt: new Date() })
			.where(inArray(ingestionJobItems.childRunId, candidateRunIds))
			.returning({ id: ingestionJobItems.id });

		const docDel = await tx
			.delete(sophiaDocuments)
			.where(
				and(eq(sophiaDocuments.topCollection, 'ingestion_run_reports'), inArray(sophiaDocuments.path, reportPaths))
			)
			.returning({ path: sophiaDocuments.path });

		await tx.delete(ingestRuns).where(inArray(ingestRuns.id, candidateRunIds));

		return {
			jobItemsDetached: detached.length,
			sophiaDocumentsDeleted: docDel.length
		};
	});

	return {
		candidateRunIds,
		jobItemsDetached,
		sophiaDocumentsDeleted,
		ingestRunsDeleted: candidateRunIds.length,
		dryRun: false
	};
}
