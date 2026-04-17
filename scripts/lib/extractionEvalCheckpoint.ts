/**
 * NDJSON checkpoint lines for `eval-extraction-holdout-openai-compatible.ts` — one line per completed row.
 * Enables resume after crashes and accurate merges across shards / partial runs.
 */

import { existsSync, readFileSync } from 'node:fs';

export const EXTRACTION_EVAL_CHECKPOINT_VERSION = 1 as const;

export type SubsetMismatchBucketName =
	| 'hit'
	| 'split_across_claims'
	| 'gold_text_wrong_position'
	| 'gold_position_wrong_text'
	| 'neither_literal';

export type ExtractionEvalCheckpointLineV1 = {
	v: typeof EXTRACTION_EVAL_CHECKPOINT_VERSION;
	/** 0-based index among non-empty `input` lines in the JSONL file (file order). */
	g: number;
	latencyMs: number;
	schemaOk: boolean;
	subsetEligible: boolean;
	subsetTextHit: boolean;
	subsetStrictHit: boolean;
	goldLabelEqInput: boolean;
	mismatchBucket: SubsetMismatchBucketName | null;
	mismatchClaimCount: number | null;
};

export type ExtractionEvalCheckpointAggregate = {
	completed: Set<number>;
	latencies: number[];
	okSchema: number;
	rows: number;
	subsetMatch: number;
	subsetTextMatch: number;
	subsetEligible: number;
	goldLabelTextEqualsInput: number;
	mismatchBuckets: Record<SubsetMismatchBucketName, number>;
	mismatchClaimCounts: number[];
};

export function emptyMismatchBuckets(): Record<SubsetMismatchBucketName, number> {
	return {
		hit: 0,
		split_across_claims: 0,
		gold_text_wrong_position: 0,
		gold_position_wrong_text: 0,
		neither_literal: 0
	};
}

export function createEmptyCheckpointAggregate(): ExtractionEvalCheckpointAggregate {
	return {
		completed: new Set(),
		latencies: [],
		okSchema: 0,
		rows: 0,
		subsetMatch: 0,
		subsetTextMatch: 0,
		subsetEligible: 0,
		goldLabelTextEqualsInput: 0,
		mismatchBuckets: emptyMismatchBuckets(),
		mismatchClaimCounts: []
	};
}

/** Load NDJSON checkpoint; skips duplicate `g` (warns on stderr). */
export function loadCheckpointNdjson(path: string): ExtractionEvalCheckpointAggregate {
	const agg = createEmptyCheckpointAggregate();
	if (!existsSync(path)) return agg;
	const raw = readFileSync(path, 'utf8');
	for (const line of raw.split('\n')) {
		const t = line.trim();
		if (!t) continue;
		let rec: ExtractionEvalCheckpointLineV1;
		try {
			rec = JSON.parse(t) as ExtractionEvalCheckpointLineV1;
		} catch {
			continue;
		}
		if (rec.v !== EXTRACTION_EVAL_CHECKPOINT_VERSION || typeof rec.g !== 'number') continue;
		if (agg.completed.has(rec.g)) {
			console.warn(`[eval:checkpoint] duplicate g=${rec.g}, skipping line`);
			continue;
		}
		agg.completed.add(rec.g);
		agg.latencies.push(rec.latencyMs);
		agg.rows++;
		if (rec.schemaOk) agg.okSchema++;
		if (rec.subsetEligible) {
			agg.subsetEligible++;
			if (rec.subsetTextHit) agg.subsetTextMatch++;
			if (rec.subsetStrictHit) agg.subsetMatch++;
			if (rec.goldLabelEqInput) agg.goldLabelTextEqualsInput++;
			if (rec.mismatchBucket) {
				agg.mismatchBuckets[rec.mismatchBucket]++;
				if (
					rec.mismatchBucket !== 'hit' &&
					typeof rec.mismatchClaimCount === 'number'
				) {
					agg.mismatchClaimCounts.push(rec.mismatchClaimCount);
				}
			}
		}
	}
	return agg;
}
