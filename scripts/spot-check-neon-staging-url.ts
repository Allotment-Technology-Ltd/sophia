/**
 * Read-only: list ingest_staging_meta rows that match a source URL (hash, canonical url, or LIKE).
 *
 *   pnpm exec tsx --env-file=.env.local scripts/spot-check-neon-staging-url.ts "https://plato.stanford.edu/entries/plato/"
 *
 * Requires DATABASE_URL. Does not print secrets.
 */

import { sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.ts';

loadServerEnv();

const rawUrl = process.argv[2]?.trim() || 'https://plato.stanford.edu/entries/plato/';
const identity = canonicalizeAndHashSourceUrl(rawUrl);

if (!process.env.DATABASE_URL?.trim()) {
  console.error('DATABASE_URL is required (e.g. load via --env-file=.env.local).');
  process.exit(1);
}

if (!identity) {
  console.error(`Could not canonicalize URL: ${rawUrl}`);
  process.exit(1);
}

const db = getDrizzleDb();
const h = identity.canonicalUrlHash;
const u = identity.canonicalUrl;

console.log('Input URL:', rawUrl);
console.log('Canonical URL (sourceIdentity):', u);
console.log('canonical_url_hash (sha256 of canonical):', h);
console.log('');

const rows = await db.execute(sql`
  SELECT
    m.run_id AS "runId",
    m.slug,
    m.stage_completed AS "stageCompleted",
    m.updated_at AS "updatedAt",
    coalesce(jsonb_array_length(m.embeddings_json), 0) AS "embeddingsJsonLen",
    (SELECT count(*)::int FROM ingest_staging_claims c WHERE c.run_id = m.run_id) AS "claimCount",
    (m.source_text_snapshot IS NOT NULL AND length(m.source_text_snapshot) > 0) AS "hasSourceSnapshot",
    m.source_json->>'url' AS "sourceJsonUrl",
    m.source_json->>'canonical_url' AS "sourceJsonCanonicalUrl",
    m.source_json->>'canonical_url_hash' AS "sourceJsonHash"
  FROM ingest_staging_meta m
  WHERE (m.source_json->>'canonical_url_hash') = ${h}
     OR (m.source_json->>'url') = ${u}
     OR (m.source_json->>'canonical_url') = ${u}
     OR (m.source_json->>'url') LIKE ${'%' + 'plato.stanford.edu/entries/plato' + '%'}
  ORDER BY m.updated_at DESC
  LIMIT 30
`);

console.log('ingest_staging_meta matches (up to 30):');
console.table(rows.rows);

const likePat = '%plato.stanford.edu%entries%plato%';
const runRows = await db.execute(sql`
  SELECT id, status, source_url AS "sourceUrl", created_at AS "createdAt", completed_at AS "completedAt"
  FROM ingest_runs
  WHERE source_url LIKE ${likePat}
  ORDER BY completed_at DESC NULLS LAST
  LIMIT 15
`);

console.log('');
console.log('ingest_runs with URL LIKE %plato.stanford.edu%entries%plato% (up to 15, done or any status):');
console.table(runRows.rows);

const compareRuns = ['afe6a84f1d2ba44b', 'e3aab04eced70acd'];
console.log('');
console.log('Staging snapshot for known Plato run ids:');
for (const rid of compareRuns) {
  const r = await db.execute(sql`
    SELECT
      m.run_id AS "runId",
      m.slug,
      m.stage_completed AS "stageCompleted",
      coalesce(jsonb_array_length(m.embeddings_json), 0) AS "embeddingsJsonLen",
      (SELECT count(*)::int FROM ingest_staging_claims c WHERE c.run_id = m.run_id) AS "claimCount"
    FROM ingest_staging_meta m
    WHERE m.run_id = ${rid}
  `);
  console.log(rid, r.rows[0] ?? '(no ingest_staging_meta row)');
}
