/**
 * Merge multiple JSON reports from `eval-extraction-holdout-openai-compatible.ts` (e.g. shard or tail runs)
 * into one combined report with summed counts, recomputed rates, and merged latency percentiles.
 *
 * Usage:
 *   pnpm exec tsx scripts/merge-extraction-eval-reports.ts --out merged.json part-a.json part-b.json
 *   pnpm exec tsx scripts/merge-extraction-eval-reports.ts --out merged.json --inputs part-a.json part-b.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type Report = Record<string, unknown>;

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
	return sorted[idx]!;
}

function parseArgs(argv: string[]): { out: string | null; inputs: string[] } {
	let out: string | null = null;
	const inputs: string[] = [];
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--out' && argv[i + 1]) {
			out = argv[++i]!;
		} else if (a === '--inputs') {
			while (argv[i + 1] && !argv[i + 1]!.startsWith('--')) {
				inputs.push(argv[++i]!);
			}
		} else if (!a.startsWith('--')) {
			rest.push(a);
		}
	}
	return { out, inputs: inputs.length > 0 ? inputs : rest };
}

function readReport(path: string): Report {
	const raw = readFileSync(path, 'utf8');
	return JSON.parse(raw) as Report;
}

function main() {
	const { out, inputs } = parseArgs(process.argv.slice(2));
	if (inputs.length < 2 || !out) {
		console.error(
			'Usage: --out <merged.json> <report1.json> <report2.json> [...]\n   or: --out <merged.json> --inputs <a.json> <b.json> [...]'
		);
		process.exit(2);
	}

	const reports = inputs.map((p) => ({ path: p, report: readReport(p) }));
	const jsonl = reports[0]!.report.jsonl;
	const modelId = reports[0]!.report.modelId;
	for (const { path, report } of reports) {
		if (report.jsonl !== jsonl) {
			console.warn(`[merge] jsonl mismatch: ${path} has ${String(report.jsonl)} vs baseline ${String(jsonl)}`);
		}
		if (report.modelId !== modelId) {
			console.warn(`[merge] modelId mismatch: ${path} has ${String(report.modelId)} vs baseline ${String(modelId)}`);
		}
	}

	let rowsEvaluated = 0;
	let schemaOkRows = 0;
	let subsetEligible = 0;
	let subsetTextMatch = 0;
	let subsetMatch = 0;
	let goldLabelTextEqualsInput = 0;
	const latencies: number[] = [];
	const mismatchBuckets: Record<string, number> = {
		hit: 0,
		split_across_claims: 0,
		gold_text_wrong_position: 0,
		gold_position_wrong_text: 0,
		neither_literal: 0
	};
	const mismatchClaimCounts: number[] = [];
	const mismatchSamples: unknown[] = [];
	let mismatchDiag = false;

	for (const { path, report } of reports) {
		rowsEvaluated += Number(report.rowsEvaluated ?? 0);
		schemaOkRows += Number(report.schemaOkRows ?? 0);
		subsetEligible += Number(report.subsetEligibleRows ?? 0);
		const r = report as {
			subsetTextMatchRate?: number | null;
			subsetMatchRate?: number | null;
			subsetEligibleRows?: number;
			subsetEligibleRowsWhereInputEqualsGoldText?: number;
			latencyMsSamples?: number[];
			mismatchDiagnostics?: {
				mismatchBucketCounts?: Record<string, number>;
				mismatchSamples?: unknown[];
				meanClaimCountOnMismatch?: number | null;
			};
		};
		const se = Number(r.subsetEligibleRows ?? 0);
		if (se > 0 && r.subsetTextMatchRate != null) {
			subsetTextMatch += r.subsetTextMatchRate * se;
		}
		if (se > 0 && r.subsetMatchRate != null) {
			subsetMatch += r.subsetMatchRate * se;
		}
		goldLabelTextEqualsInput += Number(r.subsetEligibleRowsWhereInputEqualsGoldText ?? 0);

		const samples = r.latencyMsSamples;
		if (Array.isArray(samples)) {
			for (const x of samples) {
				if (typeof x === 'number' && Number.isFinite(x)) latencies.push(x);
			}
		} else {
			console.warn(
				`[merge] ${path}: no latencyMsSamples — p50/p95 will omit this shard unless you re-run eval with a current script that emits samples.`
			);
		}

		const md = r.mismatchDiagnostics;
		if (md?.mismatchBucketCounts) {
			mismatchDiag = true;
			for (const k of Object.keys(mismatchBuckets)) {
				mismatchBuckets[k] = (mismatchBuckets[k] ?? 0) + Number(md.mismatchBucketCounts[k] ?? 0);
			}
		}
		if (md?.mismatchSamples && Array.isArray(md.mismatchSamples)) {
			mismatchSamples.push(...md.mismatchSamples);
		}
	}

	latencies.sort((a, b) => a - b);

	const merged: Report = {
		generatedAt: new Date().toISOString(),
		mergeOf: inputs,
		mergeNote:
			'Summed scalar counters from inputs; subset match rates recomputed from weighted sums; latency percentiles from concatenated latencyMsSamples when present.',
		jsonl,
		modelId,
		rowsEvaluated,
		schemaOkRows,
		schemaFailRows: rowsEvaluated - schemaOkRows,
		schemaPassRate: rowsEvaluated ? schemaOkRows / rowsEvaluated : 0,
		latencyMs: {
			p50: percentile(latencies, 0.5),
			p95: percentile(latencies, 0.95)
		},
		latencyMsSamples: latencies,
		subsetEligibleRows: subsetEligible,
		subsetTextMatchRate: subsetEligible ? subsetTextMatch / subsetEligible : null,
		subsetMatchRate: subsetEligible ? subsetMatch / subsetEligible : null,
		subsetEligibleRowsWhereInputEqualsGoldText: goldLabelTextEqualsInput,
		singleSentenceGoldEvalAllEligibleRows:
			subsetEligible > 0 && goldLabelTextEqualsInput === subsetEligible
	};

	if (mismatchDiag && subsetEligible > 0) {
		mismatchClaimCounts.sort((a, b) => a - b);
		merged.mismatchDiagnostics = {
			note: 'Merged from shard/partial reports. Mismatch samples concatenated (may exceed original cap).',
			subsetEligibleRows: subsetEligible,
			goldLabelTextEqualsInputRate: goldLabelTextEqualsInput / subsetEligible,
			mismatchBucketCounts: mismatchBuckets,
			meanClaimCountOnMismatch:
				mismatchClaimCounts.length > 0
					? mismatchClaimCounts.reduce((a, b) => a + b, 0) / mismatchClaimCounts.length
					: null,
			medianClaimCountOnMismatch:
				mismatchClaimCounts.length > 0 ? percentile(mismatchClaimCounts, 0.5) : null,
			mismatchSamples: mismatchSamples.slice(0, 40)
		};
	}

	console.log(JSON.stringify(merged, null, 2));
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
	console.error(`[merge] wrote ${out}`);
}

main();
