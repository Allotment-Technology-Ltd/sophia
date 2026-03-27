/**
 * Quick Neon connectivity check (no secrets printed).
 *   pnpm db:ping
 */
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { sql } from 'drizzle-orm';

loadServerEnv();

const db = getDrizzleDb();
const r = await db.execute(sql`select 1 as ok`);
const row = (r as { rows?: { ok?: number }[] }).rows?.[0];
if (row?.ok === 1) {
  console.log('DATABASE_URL OK (select 1)');
} else {
  console.log('Unexpected result', r);
  process.exit(1);
}
