/**
 * SOPHIA — Ingestion Log Schema Setup
 *
 * Adds the ingestion_log table for tracking pipeline progress and enabling resume.
 *
 * Run with: npx tsx --env-file=.env scripts/setup-ingestion-log.ts
 */

import { Surreal } from 'surrealdb';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

async function main() {
	const db = new Surreal();

	try {
		console.log('[SETUP] Connecting to SurrealDB...');
		await db.connect(SURREAL_URL);
		await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
		await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
		console.log(`[SETUP] Connected to ${SURREAL_URL}`);

		console.log('[SETUP] Creating ingestion_log schema...');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS ingestion_log SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS source_url ON ingestion_log TYPE string;
			DEFINE FIELD IF NOT EXISTS source_title ON ingestion_log TYPE string;
			DEFINE FIELD IF NOT EXISTS status ON ingestion_log TYPE string
				ASSERT $value IN ['fetching', 'extracting', 'relating', 'grouping', 'embedding', 'validating', 'storing', 'complete', 'failed'];
			DEFINE FIELD IF NOT EXISTS stage_completed ON ingestion_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS claims_extracted ON ingestion_log TYPE option<int>;
			DEFINE FIELD IF NOT EXISTS relations_extracted ON ingestion_log TYPE option<int>;
			DEFINE FIELD IF NOT EXISTS arguments_grouped ON ingestion_log TYPE option<int>;
			DEFINE FIELD IF NOT EXISTS validation_score ON ingestion_log TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS error_message ON ingestion_log TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS cost_usd ON ingestion_log TYPE option<float>;
			DEFINE FIELD IF NOT EXISTS started_at ON ingestion_log TYPE datetime DEFAULT time::now();
			DEFINE FIELD IF NOT EXISTS completed_at ON ingestion_log TYPE option<datetime>;
			DEFINE INDEX IF NOT EXISTS ingestion_log_url ON ingestion_log FIELDS source_url UNIQUE;
		`);

		console.log('[SETUP] ✓ Table: ingestion_log');

		// Verify
		const result = await db.query(`SELECT count() AS count FROM ingestion_log GROUP ALL`);
		const count = (result as any)?.[0]?.[0]?.count ?? 0;
		console.log(`[SETUP] ✓ Verified: ${count} existing records`);

		console.log('\n✅ Ingestion log schema created successfully.\n');

		await db.close();
		process.exit(0);
	} catch (error) {
		console.error('[SETUP] Error:', error);
		await db.close();
		process.exit(1);
	}
}

main();
