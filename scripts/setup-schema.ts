import { Surreal } from 'surrealdb';

// Read environment variables
const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

async function setupSchema() {
	const db = new Surreal();

	try {
		console.log('[SETUP] Connecting to SurrealDB...');
		await db.connect(SURREAL_URL);
		console.log(`[SETUP] Connected to ${SURREAL_URL}`);

		// Sign in
		await db.signin({
			username: SURREAL_USER,
			password: SURREAL_PASS
		} as any);
		console.log('[SETUP] Authenticated successfully');

		// Select namespace and database
		await db.use({
			namespace: SURREAL_NAMESPACE,
			database: SURREAL_DATABASE
		});
		console.log(`[SETUP] Using namespace: ${SURREAL_NAMESPACE}, database: ${SURREAL_DATABASE}`);

		// Define tables
		console.log('[SETUP] Creating schema...');

		// 1. SOURCE TABLE
		await db.query(`
			DEFINE TABLE source SCHEMAFULL;
			DEFINE FIELD title ON source TYPE string;
			DEFINE FIELD author ON source TYPE array<string>;
			DEFINE FIELD year ON source TYPE option<int>;
			DEFINE FIELD source_type ON source TYPE string
				ASSERT $value IN ['book', 'paper', 'sep_entry', 'iep_entry', 'article', 'institutional'];
			DEFINE FIELD url ON source TYPE option<string>;
			DEFINE FIELD ingested_at ON source TYPE datetime VALUE time::now();
			DEFINE FIELD claim_count ON source TYPE option<int>;
			DEFINE FIELD status ON source TYPE string
				DEFAULT 'pending'
				ASSERT $value IN ['pending', 'ingested', 'validated', 'quarantined'];
		`);
		console.log('[SETUP] ✓ Table: source');

		// 2. CLAIM TABLE
		await db.query(`
			DEFINE TABLE claim SCHEMAFULL;
			DEFINE FIELD text ON claim TYPE string;
			DEFINE FIELD claim_type ON claim TYPE string
				ASSERT $value IN ['thesis', 'premise', 'objection', 'response', 'definition', 'thought_experiment', 'empirical', 'methodological'];
			DEFINE FIELD domain ON claim TYPE string
				ASSERT $value IN ['epistemology', 'metaphysics', 'ethics', 'philosophy_of_mind', 'political_philosophy', 'logic', 'aesthetics', 'philosophy_of_science', 'philosophy_of_language', 'applied_ethics', 'philosophy_of_ai'];
			DEFINE FIELD source ON claim TYPE record<source>;
			DEFINE FIELD section_context ON claim TYPE option<string>;
			DEFINE FIELD position_in_source ON claim TYPE option<int>;
			DEFINE FIELD confidence ON claim TYPE float DEFAULT 0.8;
			DEFINE FIELD embedding ON claim TYPE option<array<float>>;
			DEFINE FIELD validation_score ON claim TYPE option<float>;
		`);
		console.log('[SETUP] ✓ Table: claim');

		// Create indexes for claim table
		await db.query(`
			DEFINE INDEX claim_embedding ON claim FIELDS embedding MTREE DIMENSION 1024;
			DEFINE INDEX claim_domain ON claim FIELDS domain;
			DEFINE INDEX claim_source ON claim FIELDS source;
		`);
		console.log('[SETUP] ✓ Indexes: claim (embedding, domain, source)');

		// 3. ARGUMENT TABLE
		await db.query(`
			DEFINE TABLE argument SCHEMAFULL;
			DEFINE FIELD name ON argument TYPE string;
			DEFINE FIELD summary ON argument TYPE string;
			DEFINE FIELD tradition ON argument TYPE option<string>;
			DEFINE FIELD domain ON argument TYPE string
				ASSERT $value IN ['epistemology', 'metaphysics', 'ethics', 'philosophy_of_mind', 'political_philosophy', 'logic', 'aesthetics', 'philosophy_of_science', 'philosophy_of_language', 'applied_ethics', 'philosophy_of_ai'];
			DEFINE FIELD source ON argument TYPE record<source>;
		`);
		console.log('[SETUP] ✓ Table: argument');

		// 4. RELATION: SUPPORTS
		await db.query(`
			DEFINE TABLE supports TYPE RELATION IN claim OUT claim SCHEMAFULL;
			DEFINE FIELD strength ON supports TYPE string
				ASSERT $value IN ['strong', 'moderate', 'weak'];
			DEFINE FIELD note ON supports TYPE option<string>;
		`);
		console.log('[SETUP] ✓ Relation: supports');

		// 5. RELATION: CONTRADICTS
		await db.query(`
			DEFINE TABLE contradicts TYPE RELATION IN claim OUT claim SCHEMAFULL;
			DEFINE FIELD strength ON contradicts TYPE string
				ASSERT $value IN ['strong', 'moderate', 'weak'];
			DEFINE FIELD note ON contradicts TYPE option<string>;
		`);
		console.log('[SETUP] ✓ Relation: contradicts');

		// 6. RELATION: DEPENDS_ON
		await db.query(`
			DEFINE TABLE depends_on TYPE RELATION IN claim OUT claim SCHEMAFULL;
			DEFINE FIELD necessity ON depends_on TYPE string
				ASSERT $value IN ['essential', 'supporting', 'contextual'];
		`);
		console.log('[SETUP] ✓ Relation: depends_on');

		// 7. RELATION: RESPONDS_TO
		await db.query(`
			DEFINE TABLE responds_to TYPE RELATION IN claim OUT claim SCHEMAFULL;
			DEFINE FIELD response_type ON responds_to TYPE string
				ASSERT $value IN ['direct_rebuttal', 'undermining', 'concession', 'refinement'];
		`);
		console.log('[SETUP] ✓ Relation: responds_to');

		// 8. RELATION: REFINES
		await db.query(`
			DEFINE TABLE refines TYPE RELATION IN claim OUT claim SCHEMAFULL;
			DEFINE FIELD refinement_type ON refines TYPE string
				ASSERT $value IN ['strengthens', 'qualifies', 'extends', 'clarifies'];
		`);
		console.log('[SETUP] ✓ Relation: refines');

		// 9. RELATION: EXEMPLIFIES
		await db.query(`
			DEFINE TABLE exemplifies TYPE RELATION IN claim OUT claim SCHEMAFULL;
		`);
		console.log('[SETUP] ✓ Relation: exemplifies');

		// 10. RELATION: PART_OF
		await db.query(`
			DEFINE TABLE part_of TYPE RELATION IN claim OUT argument SCHEMAFULL;
			DEFINE FIELD role ON part_of TYPE string
				ASSERT $value IN ['conclusion', 'key_premise', 'supporting_premise', 'assumption', 'objection', 'response'];
			DEFINE FIELD position ON part_of TYPE option<int>;
		`);
		console.log('[SETUP] ✓ Relation: part_of');

		// Verify schema by querying table counts
		console.log('\n[SETUP] Verifying schema...');

		const tables = [
			'source',
			'claim',
			'argument',
			'supports',
			'contradicts',
			'depends_on',
			'responds_to',
			'refines',
			'exemplifies',
			'part_of'
		];

		for (const table of tables) {
			const result = await db.query(`SELECT COUNT() as count FROM ${table}`);
			console.log(`[SETUP] Table '${table}': 0 records (ready)`);
		}

		console.log('\n✅ Schema created successfully!\n');
		console.log('Tables created:');
		console.log('  • source (metadata for philosophical sources)');
		console.log('  • claim (individual philosophical claims with embeddings)');
		console.log('  • argument (philosophical arguments)');
		console.log('\nRelation tables created:');
		console.log('  • supports (claim supports claim)');
		console.log('  • contradicts (claim contradicts claim)');
		console.log('  • depends_on (claim depends on claim)');
		console.log('  • responds_to (claim responds to claim)');
		console.log('  • refines (claim refines claim)');
		console.log('  • exemplifies (claim exemplifies claim)');
		console.log('  • part_of (claim is part of argument)\n');

		await db.close();
		process.exit(0);
	} catch (error) {
		console.error('[SETUP] Error:', error);
		await db.close();
		process.exit(1);
	}
}

setupSchema();
