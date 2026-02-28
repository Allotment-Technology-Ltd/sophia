import { Surreal } from 'surrealdb';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

async function run() {
	const db = new Surreal();

	try {
		console.log('[MIGRATE] Connecting to SurrealDB...');
		await db.connect(SURREAL_URL);
		await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
		await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
		console.log('[MIGRATE] Connected and authenticated');

		const relationTables = [
			'supports',
			'contradicts',
			'depends_on',
			'responds_to',
			'refines',
			'exemplifies',
			'part_of'
		];

		for (const table of relationTables) {
			try {
				await db.query(`REMOVE TABLE ${table};`);
				console.log(`[MIGRATE] Removed table: ${table}`);
			} catch {
				console.log(`[MIGRATE] Table not removed (may not exist): ${table}`);
			}
		}

		await db.query(`
			DEFINE TABLE supports TYPE RELATION IN claim OUT claim SCHEMAFULL;
			DEFINE FIELD strength ON supports TYPE string
				ASSERT $value IN ['strong', 'moderate', 'weak'];
			DEFINE FIELD note ON supports TYPE option<string>;
		`);
		console.log('[MIGRATE] Recreated relation table: supports');

		await db.query(`
			DEFINE TABLE contradicts TYPE RELATION IN claim OUT claim SCHEMAFULL;
			DEFINE FIELD strength ON contradicts TYPE string
				ASSERT $value IN ['strong', 'moderate', 'weak'];
			DEFINE FIELD note ON contradicts TYPE option<string>;
		`);
		console.log('[MIGRATE] Recreated relation table: contradicts');

		await db.query(`
			DEFINE TABLE depends_on TYPE RELATION IN claim OUT claim SCHEMAFULL;
			DEFINE FIELD necessity ON depends_on TYPE string
				ASSERT $value IN ['essential', 'supporting', 'contextual'];
		`);
		console.log('[MIGRATE] Recreated relation table: depends_on');

		await db.query(`
			DEFINE TABLE responds_to TYPE RELATION IN claim OUT claim SCHEMAFULL;
			DEFINE FIELD response_type ON responds_to TYPE string
				ASSERT $value IN ['direct_rebuttal', 'undermining', 'concession', 'refinement'];
		`);
		console.log('[MIGRATE] Recreated relation table: responds_to');

		await db.query(`
			DEFINE TABLE refines TYPE RELATION IN claim OUT claim SCHEMAFULL;
			DEFINE FIELD refinement_type ON refines TYPE string
				ASSERT $value IN ['strengthens', 'qualifies', 'extends', 'clarifies'];
		`);
		console.log('[MIGRATE] Recreated relation table: refines');

		await db.query(`
			DEFINE TABLE exemplifies TYPE RELATION IN claim OUT claim SCHEMAFULL;
		`);
		console.log('[MIGRATE] Recreated relation table: exemplifies');

		await db.query(`
			DEFINE TABLE part_of TYPE RELATION IN claim OUT argument SCHEMAFULL;
			DEFINE FIELD role ON part_of TYPE string
				ASSERT $value IN ['conclusion', 'key_premise', 'supporting_premise', 'assumption', 'objection', 'response'];
			DEFINE FIELD position ON part_of TYPE option<int>;
		`);
		console.log('[MIGRATE] Recreated relation table: part_of');

		console.log('\n✅ Relation table migration complete');
		await db.close();
	} catch (error) {
		console.error('[MIGRATE] Error:', error);
		try {
			await db.close();
		} catch {
			// ignore
		}
		process.exit(1);
	}
}

run();
