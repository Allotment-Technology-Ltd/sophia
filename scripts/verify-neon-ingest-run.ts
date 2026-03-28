/**
 * Summarize Neon rows for one admin ingest orchestration run.
 *
 *   pnpm verify:neon-ingest-run -- 7af94186543e7461
 *
 * Requires DATABASE_URL (loadServerEnv: .env then .env.local). No secrets printed.
 */

import { eq, sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import {
  ingestRunIssues,
  ingestRunLogs,
  ingestRuns,
  ingestStagingArguments,
  ingestStagingClaims,
  ingestStagingMeta,
  ingestStagingRelations,
  ingestStagingValidation
} from '../src/lib/server/db/schema.ts';

loadServerEnv();

function parseRunId(argv: string[]): string | null {
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--run-id=')) return a.slice('--run-id='.length).trim() || null;
    if (!a.startsWith('-') && /^[a-f0-9]{16}$/i.test(a)) return a;
  }
  return null;
}

const runId = parseRunId(process.argv);
if (!runId) {
  console.error('Usage: pnpm verify:neon-ingest-run -- <16-char-hex-run-id>');
  console.error('   or: pnpm verify:neon-ingest-run -- --run-id=7af94186543e7461');
  process.exit(1);
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const db = getDrizzleDb();

const [run] = await db.select().from(ingestRuns).where(eq(ingestRuns.id, runId)).limit(1);
if (!run) {
  console.error(`No ingest_runs row for id=${runId}`);
  process.exit(2);
}

const [logAgg] = await db
  .select({
    n: sql<number>`count(*)::int`.mapWith(Number),
    maxSeq: sql<number>`coalesce(max(${ingestRunLogs.seq}), 0)::int`.mapWith(Number)
  })
  .from(ingestRunLogs)
  .where(eq(ingestRunLogs.runId, runId));

const [issueN] = await db
  .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
  .from(ingestRunIssues)
  .where(eq(ingestRunIssues.runId, runId));

const [claimsN] = await db
  .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
  .from(ingestStagingClaims)
  .where(eq(ingestStagingClaims.runId, runId));

/** pgvector + Drizzle: use raw SQL for IS NOT NULL counts. */
const embCountRes = await db.execute(
  sql`select count(*)::int as n from ingest_staging_claims where run_id = ${runId} and embedding is not null`
);
const claimsEmbN = {
  n: Number((embCountRes as { rows?: { n?: number }[] }).rows?.[0]?.n ?? 0)
};

const [relN] = await db
  .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
  .from(ingestStagingRelations)
  .where(eq(ingestStagingRelations.runId, runId));

const [argN] = await db
  .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
  .from(ingestStagingArguments)
  .where(eq(ingestStagingArguments.runId, runId));

const [valN] = await db
  .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
  .from(ingestStagingValidation)
  .where(eq(ingestStagingValidation.runId, runId));

const [meta] = await db.select().from(ingestStagingMeta).where(eq(ingestStagingMeta.runId, runId)).limit(1);

console.log('── Neon ingest run audit ──');
console.log(`run_id:              ${runId}`);
console.log(`ingest_runs.status:  ${run.status}`);
console.log(`source_url:          ${run.sourceUrl}`);
console.log(`source_type:         ${run.sourceType}`);
console.log(`completed_at:        ${run.completedAt?.toISOString() ?? '(null)'}`);
console.log(`ingest_run_logs:     ${logAgg?.n ?? 0} rows (max seq ${logAgg?.maxSeq ?? 0})`);
console.log(`ingest_run_issues:   ${issueN?.n ?? 0}`);
console.log(`staging_meta:        ${meta ? 'yes' : 'no'}`);
if (meta) {
  console.log(`  stage_completed:   ${meta.stageCompleted || '(empty)'}`);
  console.log(`  cost_usd_snapshot: ${meta.costUsdSnapshot ?? '(null)'}`);
  const ej = meta.embeddingsJson;
  const embLen = Array.isArray(ej) ? ej.length : 0;
  console.log(`  embeddings_json:   ${embLen} vector(s) in meta (parallel to per-claim embedding column)`);
}
console.log(
  `staging_claims:      ${claimsN?.n ?? 0} (pgvector column non-null: ${claimsEmbN.n}; see meta.embeddings_json above)`
);
console.log(`staging_relations:   ${relN?.n ?? 0}`);
console.log(`staging_arguments:   ${argN?.n ?? 0}`);
console.log(`staging_validation:  ${valN?.n ?? 0}  (expect 0 if validation was skipped/failed)`);

const metaEmbLen = meta && Array.isArray(meta.embeddingsJson) ? meta.embeddingsJson.length : 0;
const embOk =
  claimsN &&
  claimsN.n > 0 &&
  (claimsEmbN.n === claimsN.n || metaEmbLen === claimsN.n);
console.log('');
if (claimsN && claimsN.n > 0 && embOk) {
  console.log(
    'OK: embedding coverage matches claim count (pgvector column and/or meta.embeddings_json).'
  );
} else if (claimsN && claimsN.n > 0) {
  console.log('WARN: claim count vs embeddings unclear (check column + meta.embeddings_json).');
}
if ((valN?.n ?? 0) === 0) {
  console.log('NOTE: no validation rows — matches "Validation score: skipped" in logs.');
}
console.log('');
console.log('Compare staging counts to SurrealDB / final log summary (e.g. 38 claims, 14 relations).');
console.log('If you re-ran stages, staging should reflect the last successful checkpoint before/after sync.');
