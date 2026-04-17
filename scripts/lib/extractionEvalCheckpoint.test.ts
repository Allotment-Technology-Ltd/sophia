import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCheckpointNdjson } from './extractionEvalCheckpoint.js';

let tmpDir = '';

afterEach(() => {
	try {
		if (tmpDir) rmSync(tmpDir, { recursive: true });
	} catch {
		/* ignore */
	}
	tmpDir = '';
});

describe('loadCheckpointNdjson', () => {
	it('aggregates rows and ignores duplicate g', () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'eval-ck-test-'));
		const p = join(tmpDir, 'ck.ndjson');
		writeFileSync(
			p,
			[
				JSON.stringify({
					v: 1,
					g: 0,
					latencyMs: 100,
					schemaOk: true,
					subsetEligible: true,
					subsetTextHit: true,
					subsetStrictHit: false,
					goldLabelEqInput: true,
					mismatchBucket: 'gold_text_wrong_position',
					mismatchClaimCount: 3
				}),
				JSON.stringify({
					v: 1,
					g: 0,
					latencyMs: 200,
					schemaOk: true,
					subsetEligible: true,
					subsetTextHit: true,
					subsetStrictHit: false,
					goldLabelEqInput: true,
					mismatchBucket: 'hit',
					mismatchClaimCount: null
				}),
				''
			].join('\n'),
			'utf8'
		);
		const agg = loadCheckpointNdjson(p);
		expect(agg.completed.size).toBe(1);
		expect(agg.rows).toBe(1);
		expect(agg.latencies).toEqual([100]);
		expect(agg.mismatchBuckets.gold_text_wrong_position).toBe(1);
	});
});
