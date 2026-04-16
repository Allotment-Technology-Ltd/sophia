/**
 * List completed Neon ingest runs where extraction needed JSON repair (telemetry),
 * to curate a **G1-cleared** offline regression JSONL pack (same row shape as golden_holdout).
 *
 * Read-only. Requires `DATABASE_URL` (via `loadServerEnv` / `--env-file`).
 *
 * Output: NDJSON lines suitable for a manifest spreadsheet — **not** training-ready text
 * (no `source_text_snapshot`; operators must redact before committing any prod-derived `input`).
 *
 *   pnpm ops:neon-extraction-json-repair-candidates
 *   pnpm exec tsx --env-file=.env scripts/neon-extraction-json-repair-candidates.ts -- --limit=50 --days=180
 */

import { sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';

function parseLimit(): number {
	const raw = process.argv.find((a) => a.startsWith('--limit='))?.slice('--limit='.length);
	const n = raw ? parseInt(raw, 10) : 40;
	if (!Number.isFinite(n) || n < 1 || n > 500) return 40;
	return n;
}

function parseDays(): number {
	const raw = process.argv.find((a) => a.startsWith('--days='))?.slice('--days='.length);
	const n = raw ? parseInt(raw, 10) : 365;
	if (!Number.isFinite(n) || n < 1 || n > 3650) return 365;
	return n;
}

type Row = {
	id: string;
	source_url: string | null;
	completed_at: string | null;
	json_first_pass_failures: string | null;
	claims_recovered_via_json_repair: string | null;
	json_repair_invocations: string | null;
	batch_splits: string | null;
};

loadServerEnv();
const db = getDrizzleDb();
const limit = parseLimit();
const days = parseDays();

const res = await db.execute(sql`
  SELECT ir.id,
         ir.source_url,
         ir.completed_at::text AS completed_at,
         ir.report_envelope->'timingTelemetry'->>'extraction_json_first_pass_failures' AS json_first_pass_failures,
         ir.report_envelope->'timingTelemetry'->>'extraction_claims_recovered_via_json_repair' AS claims_recovered_via_json_repair,
         ir.report_envelope->'timingTelemetry'->>'json_repair_invocations' AS json_repair_invocations,
         ir.report_envelope->'timingTelemetry'->>'batch_splits' AS batch_splits
  FROM ingest_runs ir
  WHERE ir.status = 'completed'
    AND ir.report_envelope IS NOT NULL
    AND ir.completed_at >= NOW() - (${days} * interval '1 day')
    AND (
      COALESCE((ir.report_envelope->'timingTelemetry'->>'extraction_json_first_pass_failures')::int, 0) > 0
      OR COALESCE((ir.report_envelope->'timingTelemetry'->>'extraction_claims_recovered_via_json_repair')::int, 0) > 0
    )
  ORDER BY ir.completed_at DESC NULLS LAST
  LIMIT ${limit}
`);

const rows = (res as { rows?: Row[] }).rows ?? [];

for (const r of rows) {
	const line = {
		kind: 'extraction_json_repair_candidate',
		run_id: r.id,
		source_url: r.source_url ?? '',
		completed_at: r.completed_at ?? '',
		json_first_pass_failures: Number(r.json_first_pass_failures ?? 0) || 0,
		claims_recovered_via_json_repair: Number(r.claims_recovered_via_json_repair ?? 0) || 0,
		json_repair_invocations: Number(r.json_repair_invocations ?? 0) || 0,
		batch_splits: Number(r.batch_splits ?? 0) || 0,
		hint: 'Redact + replace source_url before exporting input; use fixtures contract tests; see docs/sophia/extraction-offline-regression-pack.md'
	};
	process.stdout.write(`${JSON.stringify(line)}\n`);
}

console.error(`[neon-extraction-json-repair-candidates] rows=${rows.length} limit=${limit} days=${days}`);
