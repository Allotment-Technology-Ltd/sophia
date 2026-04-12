/**
 * Audit which provider/model was used for ingestion **extraction** (Neon + logs).
 * Feeds legal/ToS review (e.g. OpenAI vs Anthropic output reuse for training).
 *
 *   pnpm ops:audit-ingest-extraction-models-neon
 *   pnpm exec tsx scripts/audit-ingest-extraction-models-neon.ts -- --days=365
 *
 * Read-only; requires DATABASE_URL.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRunLogs, ingestRuns } from '../src/lib/server/db/schema.ts';

type UnknownRecord = Record<string, unknown>;

function parseDays(): number {
	const raw = process.argv.find((a) => a.startsWith('--days='))?.slice('--days='.length);
	const n = raw ? parseInt(raw, 10) : 90;
	if (!Number.isFinite(n) || n < 1 || n > 3650) return 90;
	return n;
}

function num(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const x = Number(v);
		return Number.isFinite(x) ? x : null;
	}
	return null;
}

function str(v: unknown): string | null {
	return typeof v === 'string' && v.length > 0 ? v : null;
}

function parseLastIngestTiming(linesChronological: string[]): UnknownRecord | null {
	const prefix = '[INGEST_TIMING]';
	for (let i = linesChronological.length - 1; i >= 0; i--) {
		const raw = linesChronological[i] ?? '';
		const idx = raw.lastIndexOf(prefix);
		if (idx < 0) continue;
		const jsonPart = raw.slice(idx + prefix.length).trim();
		if (!jsonPart.startsWith('{')) continue;
		try {
			const parsed = JSON.parse(jsonPart) as unknown;
			if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
				return parsed as UnknownRecord;
			}
		} catch {
			continue;
		}
	}
	return null;
}

function extractionModelFromPayload(p: UnknownRecord): string | null {
	const sm = p.stage_models;
	if (!sm || typeof sm !== 'object' || Array.isArray(sm)) return null;
	return str((sm as UnknownRecord).extraction);
}

function bump(map: Map<string, number>, key: string, n = 1): void {
	map.set(key, (map.get(key) ?? 0) + n);
}

function printSorted(title: string, map: Map<string, number>): void {
	console.log(`── ${title} ──`);
	const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
	if (rows.length === 0) {
		console.log('  (none)');
		return;
	}
	let total = 0;
	for (const [, c] of rows) total += c;
	for (const [k, c] of rows) {
		console.log(`  ${c}\t${((100 * c) / total).toFixed(1)}%\t${k}`);
	}
	console.log(`  total distinct keys: ${rows.length}, run-weight: ${total}`);
	console.log('');
}

function classifyProvider(modelRef: string): 'openai' | 'anthropic' | 'vertex_google' | 'mistral' | 'other' {
	const s = modelRef.toLowerCase();
	if (s.startsWith('openai/')) return 'openai';
	if (s.startsWith('anthropic/')) return 'anthropic';
	if (s.startsWith('vertex/') || s.startsWith('google/')) return 'vertex_google';
	if (s.startsWith('mistral/')) return 'mistral';
	return 'other';
}

async function main(): Promise<void> {
	loadServerEnv();
	const days = parseDays();
	if (!process.env.DATABASE_URL?.trim()) {
		console.error('DATABASE_URL is required.');
		process.exit(1);
	}
	const db = getDrizzleDb();

	const envelopeRows = await db
		.select({
			id: ingestRuns.id,
			reportEnvelope: ingestRuns.reportEnvelope
		})
		.from(ingestRuns)
		.where(
			and(
				eq(ingestRuns.status, 'done'),
				eq(ingestRuns.cancelledByUser, false),
				sql`${ingestRuns.completedAt} IS NOT NULL`,
				sql`${ingestRuns.completedAt} >= NOW() - (${days}::int * INTERVAL '1 day')`,
				sql`${ingestRuns.reportEnvelope}::jsonb -> 'timingTelemetry' -> 'stage_models' ? 'extraction'`
			)
		);

	const fromEnvelope = new Map<string, number>();
	const envelopeRuns = new Set<string>();
	for (const r of envelopeRows) {
		const env = r.reportEnvelope as UnknownRecord | null;
		const tt = env?.timingTelemetry as UnknownRecord | undefined;
		const sm = tt?.stage_models as UnknownRecord | undefined;
		const ex = sm ? str(sm.extraction) : null;
		if (!ex) continue;
		bump(fromEnvelope, ex);
		envelopeRuns.add(r.id);
	}

	const logRows = await db
		.select({
			runId: ingestRunLogs.runId,
			seq: ingestRunLogs.seq,
			line: ingestRunLogs.line
		})
		.from(ingestRunLogs)
		.innerJoin(ingestRuns, eq(ingestRunLogs.runId, ingestRuns.id))
		.where(
			and(
				eq(ingestRuns.status, 'done'),
				eq(ingestRuns.cancelledByUser, false),
				sql`${ingestRuns.completedAt} IS NOT NULL`,
				sql`${ingestRuns.completedAt} >= NOW() - (${days}::int * INTERVAL '1 day')`,
				sql`position('[INGEST_TIMING]' in ${ingestRunLogs.line}) > 0`
			)
		)
		.orderBy(asc(ingestRunLogs.runId), asc(ingestRunLogs.seq));

	const byRun = new Map<string, string[]>();
	for (const row of logRows) {
		const arr = byRun.get(row.runId) ?? [];
		arr.push(row.line);
		byRun.set(row.runId, arr);
	}

	const fromLogsOnly = new Map<string, number>();
	const logExtractionByRun = new Map<string, string>();
	for (const [runId, lines] of byRun) {
		const p = parseLastIngestTiming(lines);
		const ex = p ? extractionModelFromPayload(p) : null;
		if (!ex) continue;
		logExtractionByRun.set(runId, ex);
		if (!envelopeRuns.has(runId)) bump(fromLogsOnly, ex);
	}

	const merged = new Map<string, number>();
	for (const [k, v] of fromEnvelope) bump(merged, k, v);
	for (const [k, v] of fromLogsOnly) bump(merged, k, v);

	const policy = new Map<string, number>();
	for (const [model, c] of merged) {
		bump(policy, classifyProvider(model), c);
	}

	console.log(`Ingest extraction model audit — done runs, last ${days}d (completed_at)\n`);
	console.log(
		'Canonical extraction primary (code): `CANONICAL_INGESTION_PRIMARY_MODELS.extraction` in `src/lib/ingestionCanonicalPipeline.ts` (Gemini-on-Vertex first, Mistral fallbacks; worker also applies `INGEST_FINETUNE_LABELER_*`).\n'
	);

	printSorted('report_envelope.timingTelemetry.stage_models.extraction (counts by run)', fromEnvelope);

	console.log('── `[INGEST_TIMING]` last payload per run: extraction model ──');
	console.log(`  runs with ≥1 timing log line: ${byRun.size}`);
	console.log(`  runs with stage_models.extraction in parsed last payload: ${logExtractionByRun.size}`);
	const logDist = new Map<string, number>();
	for (const ex of logExtractionByRun.values()) bump(logDist, ex);
	printSorted('  distribution (from log last line, all such runs)', logDist);

	printSorted('log-only fill-ins (envelope missing extraction in stage_models)', fromLogsOnly);
	printSorted('merged per run: envelope extraction if present, else log', merged);
	printSorted('rollup by vendor prefix (same run-weight as merged)', policy);

	console.log('── Interpretation (not legal advice) ──');
	console.log(
		'  If merged counts are dominated by `openai/` or `anthropic/`, mined JSON labels from those runs may be restricted for training another model under those vendors’ ToS — regenerate labels with a policy-clear generator (see docs/local/operations/sophia-technical-review.md Risk 1).'
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
