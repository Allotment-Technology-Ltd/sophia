/**
 * Apply SQL files in drizzle/ to Neon in lexical order, tracked in schema_migrations.
 * Usage: pnpm db:migrate  (requires DATABASE_URL)
 *
 * Uses `pg` (TCP) instead of `@neondatabase/serverless` so migrations work in GitHub Actions
 * and other Node environments where the serverless driver's WebSocket path fails.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const drizzleDir = path.join(process.cwd(), 'drizzle');
  const files = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 60_000,
    idleTimeoutMillis: 10_000
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const applied = new Set(
      (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
    );
    for (const f of files) {
      if (applied.has(f)) {
        console.log(`[skip] ${f}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(drizzleDir, f), 'utf8');
      console.log(`[apply] ${f}`);
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    }
    console.log('Done.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
