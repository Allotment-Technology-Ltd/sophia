import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getNeonPool(): Pool {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!pool) {
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

export function getDrizzleDb() {
  if (!db) {
    db = drizzle(getNeonPool(), { schema });
  }
  return db;
}

export function resetNeonClientsForTests(): void {
  void pool?.end();
  pool = null;
  db = null;
}
