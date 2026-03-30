import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Surreal } from 'surrealdb';

loadEnv();

/*
 * Stoa immersive schema extension. Run after setup-schema.ts. Do not merge into setup-schema.ts.
 */

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

async function signInWithScopeFallback(db: Surreal): Promise<void> {
	try {
		await db.signin({
			namespace: SURREAL_NAMESPACE,
			database: SURREAL_DATABASE,
			username: SURREAL_USER,
			password: SURREAL_PASS
		} as any);
	} catch (scopedError) {
		try {
			await db.signin({
				username: SURREAL_USER,
				password: SURREAL_PASS
			} as any);
		} catch {
			throw scopedError;
		}
	}
}

export async function setupStoaSchema(existingDb?: Surreal) {
	const db = existingDb ?? new Surreal();
	const ownsConnection = !existingDb;

	try {
		if (ownsConnection) {
			console.log('[STOA-SETUP] Connecting to SurrealDB...');
			await db.connect(SURREAL_URL);
			console.log(`[STOA-SETUP] Connected to ${SURREAL_URL}`);

			await signInWithScopeFallback(db);
			console.log('[STOA-SETUP] Authenticated successfully');

			await db.use({
				namespace: SURREAL_NAMESPACE,
				database: SURREAL_DATABASE
			});
			console.log(
				`[STOA-SETUP] Using namespace: ${SURREAL_NAMESPACE}, database: ${SURREAL_DATABASE}`
			);
		}

		console.log('[STOA-SETUP] Creating Stoa schema extension...');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS stoa_student_progress SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS user_id ON stoa_student_progress TYPE record<user>;
			DEFINE FIELD IF NOT EXISTS xp ON stoa_student_progress TYPE int DEFAULT 0;
			DEFINE FIELD IF NOT EXISTS level ON stoa_student_progress TYPE int DEFAULT 1;
			DEFINE FIELD IF NOT EXISTS unlocked_thinkers ON stoa_student_progress TYPE array<string> DEFAULT [];
			DEFINE FIELD IF NOT EXISTS mastered_frameworks ON stoa_student_progress TYPE array<string> DEFAULT [];
			DEFINE FIELD IF NOT EXISTS active_quest_ids ON stoa_student_progress TYPE array<string> DEFAULT [];
			DEFINE FIELD IF NOT EXISTS completed_quest_ids ON stoa_student_progress TYPE array<string> DEFAULT [];
			DEFINE FIELD IF NOT EXISTS created_at ON stoa_student_progress TYPE datetime DEFAULT time::now();
			DEFINE FIELD IF NOT EXISTS updated_at ON stoa_student_progress TYPE datetime DEFAULT time::now();
			DEFINE INDEX IF NOT EXISTS idx_stoa_progress_user ON stoa_student_progress COLUMNS user_id UNIQUE;
		`);
		console.log('[STOA-SETUP] ✓ Table: stoa_student_progress');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS stoa_quest_completion SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS user_id ON stoa_quest_completion TYPE record<user>;
			DEFINE FIELD IF NOT EXISTS quest_id ON stoa_quest_completion TYPE string;
			DEFINE FIELD IF NOT EXISTS completed_at ON stoa_quest_completion TYPE datetime DEFAULT time::now();
			DEFINE FIELD IF NOT EXISTS xp_awarded ON stoa_quest_completion TYPE int;
			DEFINE FIELD IF NOT EXISTS unlock_awarded ON stoa_quest_completion TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS session_evidence ON stoa_quest_completion TYPE array<string>;
		`);
		console.log('[STOA-SETUP] ✓ Table: stoa_quest_completion');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS stoa_reasoning_assessment SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS session_id ON stoa_reasoning_assessment TYPE string;
			DEFINE FIELD IF NOT EXISTS user_id ON stoa_reasoning_assessment TYPE record<user>;
			DEFINE FIELD IF NOT EXISTS turn_index ON stoa_reasoning_assessment TYPE int;
			DEFINE FIELD IF NOT EXISTS quality_score ON stoa_reasoning_assessment TYPE float;
			DEFINE FIELD IF NOT EXISTS dimensions ON stoa_reasoning_assessment TYPE object;
			DEFINE FIELD IF NOT EXISTS frameworks_applied ON stoa_reasoning_assessment TYPE array<string>;
			DEFINE FIELD IF NOT EXISTS assessed_at ON stoa_reasoning_assessment TYPE datetime DEFAULT time::now();
			DEFINE INDEX IF NOT EXISTS idx_reasoning_user ON stoa_reasoning_assessment COLUMNS user_id;
			DEFINE INDEX IF NOT EXISTS idx_reasoning_session ON stoa_reasoning_assessment COLUMNS session_id;
		`);
		console.log('[STOA-SETUP] ✓ Table: stoa_reasoning_assessment');

		await db.query(`
			DEFINE TABLE IF NOT EXISTS stoa_framework_exposure SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS user_id ON stoa_framework_exposure TYPE record<user>;
			DEFINE FIELD IF NOT EXISTS framework_id ON stoa_framework_exposure TYPE string;
			DEFINE FIELD IF NOT EXISTS exposure_count ON stoa_framework_exposure TYPE int DEFAULT 0;
			DEFINE FIELD IF NOT EXISTS correct_application_count ON stoa_framework_exposure TYPE int DEFAULT 0;
			DEFINE FIELD IF NOT EXISTS last_used ON stoa_framework_exposure TYPE datetime;
			DEFINE INDEX IF NOT EXISTS idx_framework_user ON stoa_framework_exposure COLUMNS user_id, framework_id UNIQUE;
		`);
		console.log('[STOA-SETUP] ✓ Table: stoa_framework_exposure');

		console.log('\n[STOA-SETUP] ✅ Stoa schema extension created successfully!\n');

		if (ownsConnection) {
			await db.close();
		}
	} catch (error) {
		console.error('[STOA-SETUP] Error:', error);
		if (ownsConnection) {
			await db.close();
		}
		throw error;
	}
}

async function main(): Promise<void> {
	await setupStoaSchema();
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
	main().catch(() => {
		process.exit(1);
	});
}
