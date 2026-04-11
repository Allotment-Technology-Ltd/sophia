/**
 * Parse a `gcloud logging read --format=json` export and print Phase 0–style
 * aggregates for `[INGEST_TIMING]` lines (same payload as Neon `timingTelemetry`).
 *
 * Usage (after authenticating — see docs/operations/phase0-extraction-ingestion-baseline-report.md):
 *
 *   gcloud logging read '...filter...' --project=sophia-488807 --format=json > /tmp/ingest-timing.json
 *   pnpm exec tsx scripts/aggregate-phase0-ingest-timing-gcp-export.ts /tmp/ingest-timing.json
 *
 * Or pipe: gcloud logging read '...' --format=json | pnpm exec tsx scripts/aggregate-phase0-ingest-timing-gcp-export.ts
 *
 * No secrets; read-only on local files / stdin.
 */

import { readFileSync } from 'node:fs';

type UnknownRecord = Record<string, unknown>;

function logLineText(entry: UnknownRecord): string {
	const tp = entry.textPayload;
	if (typeof tp === 'string') return tp;
	const msg = entry.jsonPayload;
	if (msg && typeof msg === 'object' && 'message' in msg && typeof (msg as { message?: unknown }).message === 'string') {
		return (msg as { message: string }).message;
	}
	return '';
}

function parseIngestTimingPayload(line: string): UnknownRecord | null {
	const idx = line.lastIndexOf('[INGEST_TIMING]');
	if (idx < 0) return null;
	const rest = line.slice(idx + '[INGEST_TIMING]'.length).trim();
	if (!rest.startsWith('{')) return null;
	try {
		return JSON.parse(rest) as UnknownRecord;
	} catch {
		return null;
	}
}

function num(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function stageMs(p: UnknownRecord, key: string): number {
	const sm = p.stage_ms;
	if (!sm || typeof sm !== 'object') return 0;
	return num((sm as UnknownRecord)[key]) ?? 0;
}

function percentile(sorted: number[], p: number): number {
	const n = sorted.length;
	if (n === 0) return NaN;
	const idx = Math.min(n - 1, Math.max(0, Math.floor((n - 1) * p)));
	return sorted[idx]!;
}

function mean(xs: number[]): number {
	if (xs.length === 0) return NaN;
	return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pearson(a: number[], b: number[]): number | null {
	const n = Math.min(a.length, b.length);
	if (n < 2) return null;
	let sumA = 0;
	let sumB = 0;
	for (let i = 0; i < n; i++) {
		sumA += a[i]!;
		sumB += b[i]!;
	}
	const meanA = sumA / n;
	const meanB = sumB / n;
	let nume = 0;
	let denA = 0;
	let denB = 0;
	for (let i = 0; i < n; i++) {
		const da = a[i]! - meanA;
		const db = b[i]! - meanB;
		nume += da * db;
		denA += da * da;
		denB += db * db;
	}
	const den = Math.sqrt(denA * denB);
	return den === 0 ? null : nume / den;
}

function main(): void {
	const path = process.argv[2];
	const raw = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
	let entries: unknown[];
	try {
		entries = JSON.parse(raw) as unknown[];
	} catch {
		console.error('Expected JSON array (gcloud logging read --format=json).');
		process.exit(1);
	}
	if (!Array.isArray(entries)) {
		console.error('Top-level JSON must be an array of log entries.');
		process.exit(1);
	}

	const seenInsert = new Set<string>();
	const payloads: UnknownRecord[] = [];

	for (const e of entries) {
		if (!e || typeof e !== 'object') continue;
		const ent = e as UnknownRecord;
		const insertId = typeof ent.insertId === 'string' ? ent.insertId : '';
		if (insertId && seenInsert.has(insertId)) continue;
		if (insertId) seenInsert.add(insertId);

		const text = logLineText(ent);
		const p = parseIngestTimingPayload(text);
		if (p) payloads.push(p);
	}

	const withTotal = payloads.filter((p) => {
		const t = num(p.total_wall_ms);
		return t !== null && t > 0;
	});

	const fracExtract = withTotal.map((p) => {
		const tw = num(p.total_wall_ms)!;
		const ex = stageMs(p, 'extracting');
		return ex / tw;
	});

	const sortedFrac = [...fracExtract].sort((a, b) => a - b);

	console.log('── Phase 0 aggregate from GCP `[INGEST_TIMING]` export ──');
	console.log(`log entries in file:     ${entries.length}`);
	console.log(`[INGEST_TIMING] parsed:  ${payloads.length}`);
	console.log(`with total_wall_ms > 0:  ${withTotal.length}`);
	console.log('');

	if (withTotal.length === 0) {
		console.log('No rows with total_wall_ms; widen filter or check payload shape.');
		return;
	}

	console.log('Fraction extracting / total_wall_ms (cohort with total):');
	console.log(`  mean:  ${mean(fracExtract).toFixed(4)}  (~${(100 * mean(fracExtract)).toFixed(1)}% of E2E)`);
	console.log(`  p50:   ${percentile(sortedFrac, 0.5).toFixed(4)}`);
	console.log(`  p90:   ${percentile(sortedFrac, 0.9).toFixed(4)}  (~${(100 * percentile(sortedFrac, 0.9)).toFixed(1)}% at p90)`);
	console.log('');

	const meanFracValidating = mean(
		withTotal.map((p) => stageMs(p, 'validating') / num(p.total_wall_ms)!)
	);
	const meanFracRemediating = mean(
		withTotal.map((p) => stageMs(p, 'remediating') / num(p.total_wall_ms)!)
	);
	const meanFracStoring = mean(withTotal.map((p) => stageMs(p, 'storing') / num(p.total_wall_ms)!));

	console.log('Mean stage_ms / total_wall_ms (same cohort):');
	console.log(`  extracting:   ${mean(fracExtract).toFixed(4)}`);
	console.log(`  validating:   ${meanFracValidating.toFixed(4)}`);
	console.log(`  remediating:  ${meanFracRemediating.toFixed(4)}`);
	console.log(`  storing:      ${meanFracStoring.toFixed(4)}`);
	console.log('');

	const withModelWall = withTotal.filter(
		(p) =>
			p.model_call_wall_ms &&
			typeof p.model_call_wall_ms === 'object' &&
			num((p.model_call_wall_ms as UnknownRecord).extraction) != null
	);
	const exMs = withModelWall.map((p) => stageMs(p, 'extracting'));
	const wallMs = withModelWall.map((p) => num((p.model_call_wall_ms as UnknownRecord).extraction)!);
	const c = pearson(exMs, wallMs);
	console.log(
		`corr(extracting_ms, model_call_wall_ms.extraction)  n=${withModelWall.length}${c != null ? `:  ${c.toFixed(3)}` : ''}`
	);

	const withCalls = withModelWall.filter(
		(p) => p.model_calls && typeof p.model_calls === 'object' && num((p.model_calls as UnknownRecord).extraction) != null
	);
	if (withCalls.length > 0) {
		const calls = withCalls.map((p) => num((p.model_calls as UnknownRecord).extraction)!);
		const perCall = withCalls.map((p) => {
			const w = num((p.model_call_wall_ms as UnknownRecord).extraction)!;
			const c0 = Math.max(1, num((p.model_calls as UnknownRecord).extraction)!);
			return w / c0;
		});
		const sortedCalls = [...calls].sort((a, b) => a - b);
		const sortedPerCall = [...perCall].sort((a, b) => a - b);
		console.log(`extraction model_calls:  p50=${percentile(sortedCalls, 0.5)}  p90=${percentile(sortedCalls, 0.9)}`);
		console.log(
			`ms per extraction call:  p50=${Math.round(percentile(sortedPerCall, 0.5))}  p90=${Math.round(percentile(sortedPerCall, 0.9))}`
		);
	}
}

main();
