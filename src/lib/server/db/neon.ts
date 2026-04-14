import { Pool } from '@neondatabase/serverless';
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getNeonPool(): Pool {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!pool) {
    const max = process.env.NEON_POOL_MAX?.trim() ?? process.env.DATABASE_POOL_MAX?.trim();
    const maxConnections = max ? Number(max) : undefined;
    pool = new Pool({
      connectionString: url,
      ...(maxConnections != null && Number.isFinite(maxConnections) && maxConnections > 0
        ? { max: Math.min(64, Math.trunc(maxConnections)) }
        : {})
    });
  }
  return pool;
}

export function getDrizzleDb() {
  if (!db) {
    db = drizzle(getNeonPool(), { schema });
  }
  return db;
}

/** Drizzle instance (pool-backed default or a dedicated `PoolClient` from {@link getNeonPool}.connect()). */
export type SophiaDrizzleDb = NeonDatabase<typeof schema>;

export function resetNeonClientsForTests(): void {
  void pool?.end();
  pool = null;
  db = null;
}
