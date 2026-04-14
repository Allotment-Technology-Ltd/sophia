/**
 * Admin helper: remove URLs from a pasted list that are already covered by training / golden / DLQ rules.
 */

import { and, eq, or } from 'drizzle-orm';
import { getDrizzleDb } from '../db/neon';
import { ingestionJobItems } from '../db/schema';
import { isNeonIngestPersistenceEnabled } from '../neon/datastore';
import { loadGoldenExtractionEval } from './goldenExtractionEval';
import {
	listTrainingAcceptableUrlsFromNeon,
	omitUrlsWithCompletedValidationTelemetry
} from './trainingAcceptableCohortNeon';
import { canonicalizeSourceUrl } from '../sourceIdentity';

export type JobUrlListTrimOpts = {
	days: number;
	/** Remove URLs whose latest Neon run is training-acceptable (governance + lineage). */
	stripTrainingAcceptable: boolean;
	/** Remove golden-set URLs that already have completed validation telemetry in the window. */
	stripGoldenValidationDone: boolean;
	/** Remove URLs that appear on any job item as exhausted permanent failure (DLQ). */
	stripDlqPermanent: boolean;
};

export type JobUrlListTrimResult = {
	kept: string[];
	removed: {
		trainingAcceptable: string[];
		goldenValidationDone: string[];
		dlqPermanent: string[];
	};
};

function keyForUrl(u: string): string {
	const c = canonicalizeSourceUrl(u.trim());
	return (c ?? u.trim()).toLowerCase();
}

/** Distinct canonical-ish URLs from job items classified as permanent failure. */
async function loadPermanentFailureUrlKeys(): Promise<Set<string>> {
	const db = getDrizzleDb();
	const rows = await db
		.select({ url: ingestionJobItems.url })
		.from(ingestionJobItems)
		.where(
			and(
				eq(ingestionJobItems.status, 'error'),
				or(
					eq(ingestionJobItems.failureClass, 'permanent'),
					eq(ingestionJobItems.lastFailureKind, 'permanent')
				)
			)
		);
	const keys = new Set<string>();
	for (const r of rows) {
		const k = keyForUrl(r.url);
		if (k) keys.add(k);
	}
	return keys;
}

/**
 * Trims `urls` (one canonical URL per line semantics — deduped by canonical key) using Neon-backed sets.
 */
export async function trimJobUrlListForNewRun(
	urls: string[],
	opts: JobUrlListTrimOpts
): Promise<JobUrlListTrimResult> {
	const capDays = Math.min(730, Math.max(1, Math.trunc(opts.days) || 90));
	const removed = {
		trainingAcceptable: [] as string[],
		goldenValidationDone: [] as string[],
		dlqPermanent: [] as string[]
	};

	const inputOrder: string[] = [];
	const seenInput = new Set<string>();
	for (const raw of urls) {
		const t = typeof raw === 'string' ? raw.trim() : '';
		if (!t) continue;
		const k = keyForUrl(t);
		if (!k || seenInput.has(k)) continue;
		seenInput.add(k);
		inputOrder.push(t);
	}

	let keysRemaining = new Set(inputOrder.map((u) => keyForUrl(u)));

	if (opts.stripTrainingAcceptable && isNeonIngestPersistenceEnabled()) {
		const { urls: cohort } = await listTrainingAcceptableUrlsFromNeon({
			days: capDays,
			limit: 5000,
			validateOnly: false,
			omitValidatedTelemetry: false
		});
		const trainKeys = new Set(cohort.map((r) => keyForUrl(r.url)));
		for (const u of inputOrder) {
			const k = keyForUrl(u);
			if (!keysRemaining.has(k)) continue;
			if (trainKeys.has(k)) {
				keysRemaining.delete(k);
				removed.trainingAcceptable.push(u);
			}
		}
	}

	if (opts.stripGoldenValidationDone && isNeonIngestPersistenceEnabled()) {
		const data = loadGoldenExtractionEval();
		const goldenUrls = data.items.map((it) => it.url.trim()).filter(Boolean);
		if (goldenUrls.length > 0) {
			const stillNeedValidation = await omitUrlsWithCompletedValidationTelemetry(goldenUrls, capDays);
			const stillSet = new Set(stillNeedValidation.map((u) => keyForUrl(u)));
			for (const u of inputOrder) {
				const k = keyForUrl(u);
				if (!keysRemaining.has(k)) continue;
				if (!goldenUrls.some((g) => keyForUrl(g) === k)) continue;
				if (!stillSet.has(k)) {
					keysRemaining.delete(k);
					removed.goldenValidationDone.push(u);
				}
			}
		}
	}

	if (opts.stripDlqPermanent && isNeonIngestPersistenceEnabled()) {
		const permKeys = await loadPermanentFailureUrlKeys();
		for (const u of inputOrder) {
			const k = keyForUrl(u);
			if (!keysRemaining.has(k)) continue;
			if (permKeys.has(k)) {
				keysRemaining.delete(k);
				removed.dlqPermanent.push(u);
			}
		}
	}

	const kept = inputOrder.filter((u) => keysRemaining.has(keyForUrl(u)));
	return { kept, removed };
}
