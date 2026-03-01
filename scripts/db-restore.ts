import { Surreal } from 'surrealdb';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const RELATION_TABLES = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'refines',
	'exemplifies',
	'part_of'
];

const DATA_TABLES = ['source', 'claim', 'argument'];

async function connect(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

async function applySchema(db: Surreal): Promise<void> {
	console.log('[RESTORE] Applying schema (idempotent)...');

	await db.query(`
		DEFINE TABLE IF NOT EXISTS source SCHEMAFULL;
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

	await db.query(`
		DEFINE TABLE IF NOT EXISTS claim SCHEMAFULL;
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

	await db.query(`
		DEFINE INDEX IF NOT EXISTS claim_embedding ON claim FIELDS embedding MTREE DIMENSION 1024;
		DEFINE INDEX IF NOT EXISTS claim_domain ON claim FIELDS domain;
		DEFINE INDEX IF NOT EXISTS claim_source ON claim FIELDS source;
	`);

	await db.query(`
		DEFINE TABLE IF NOT EXISTS argument SCHEMAFULL;
		DEFINE FIELD name ON argument TYPE string;
		DEFINE FIELD summary ON argument TYPE string;
		DEFINE FIELD tradition ON argument TYPE option<string>;
		DEFINE FIELD domain ON argument TYPE string
			ASSERT $value IN ['epistemology', 'metaphysics', 'ethics', 'philosophy_of_mind', 'political_philosophy', 'logic', 'aesthetics', 'philosophy_of_science', 'philosophy_of_language', 'applied_ethics', 'philosophy_of_ai'];
		DEFINE FIELD source ON argument TYPE record<source>;
	`);

	await db.query(`
		DEFINE TABLE IF NOT EXISTS supports TYPE RELATION IN claim OUT claim SCHEMAFULL;
		DEFINE FIELD strength ON supports TYPE string
			ASSERT $value IN ['strong', 'moderate', 'weak'];
		DEFINE FIELD note ON supports TYPE option<string>;

		DEFINE TABLE IF NOT EXISTS contradicts TYPE RELATION IN claim OUT claim SCHEMAFULL;
		DEFINE FIELD strength ON contradicts TYPE string
			ASSERT $value IN ['strong', 'moderate', 'weak'];
		DEFINE FIELD note ON contradicts TYPE option<string>;

		DEFINE TABLE IF NOT EXISTS depends_on TYPE RELATION IN claim OUT claim SCHEMAFULL;
		DEFINE FIELD necessity ON depends_on TYPE string
			ASSERT $value IN ['essential', 'supporting', 'contextual'];

		DEFINE TABLE IF NOT EXISTS responds_to TYPE RELATION IN claim OUT claim SCHEMAFULL;
		DEFINE FIELD response_type ON responds_to TYPE string
			ASSERT $value IN ['direct_rebuttal', 'undermining', 'concession', 'refinement'];

		DEFINE TABLE IF NOT EXISTS refines TYPE RELATION IN claim OUT claim SCHEMAFULL;
		DEFINE FIELD refinement_type ON refines TYPE string
			ASSERT $value IN ['strengthens', 'qualifies', 'extends', 'clarifies'];

		DEFINE TABLE IF NOT EXISTS exemplifies TYPE RELATION IN claim OUT claim SCHEMAFULL;

		DEFINE TABLE IF NOT EXISTS part_of TYPE RELATION IN claim OUT argument SCHEMAFULL;
		DEFINE FIELD role ON part_of TYPE string
			ASSERT $value IN ['conclusion', 'key_premise', 'supporting_premise', 'assumption', 'objection', 'response'];
		DEFINE FIELD position ON part_of TYPE option<int>;
	`);

	console.log('[RESTORE] Schema applied.\n');
}

async function clearAllData(db: Surreal): Promise<void> {
	const allTables = [...DATA_TABLES, ...RELATION_TABLES];
	for (const table of allTables) {
		await db.query(`DELETE ${table}`);
		process.stdout.write(`[RESTORE] Cleared ${table}\n`);
	}
}

async function insertBatch(db: Surreal, table: string, records: unknown[]): Promise<void> {
	if (records.length === 0) return;

	// Insert in chunks to avoid overwhelming the connection
	const CHUNK_SIZE = 100;
	for (let i = 0; i < records.length; i += CHUNK_SIZE) {
		const chunk = records.slice(i, i + CHUNK_SIZE);
		await db.query(`INSERT INTO ${table} $records`, { records: chunk });
	}
}

async function countTable(db: Surreal, table: string): Promise<number> {
	const result = await db.query<{ count: number }[][]>(
		`SELECT count() AS count FROM ${table} GROUP ALL`
	);
	return result?.[0]?.[0]?.count ?? 0;
}

async function main() {
	const backupPath = process.argv[2];

	if (!backupPath) {
		console.error('Usage: npx tsx --env-file=.env scripts/db-restore.ts <backup-path>');
		console.error('Example: npx tsx --env-file=.env scripts/db-restore.ts data/backups/2026-02-28T12-00-00-000Z');
		process.exit(1);
	}

	const resolvedPath = path.resolve(backupPath);

	if (!fs.existsSync(resolvedPath)) {
		console.error(`[RESTORE] Backup path not found: ${resolvedPath}`);
		process.exit(1);
	}

	// Determine source: prefer full-backup.json, fall back to individual files
	const fullBackupFile = path.join(resolvedPath, 'full-backup.json');
	const relationsFile = path.join(resolvedPath, 'relations.json');

	let backupData: Record<string, unknown[]>;

	if (fs.existsSync(fullBackupFile)) {
		backupData = JSON.parse(fs.readFileSync(fullBackupFile, 'utf-8'));
	} else {
		// Reconstruct from individual files
		backupData = {};
		for (const table of DATA_TABLES) {
			const f = path.join(resolvedPath, `${table}.json`);
			backupData[table] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : [];
		}
		if (fs.existsSync(relationsFile)) {
			const relations = JSON.parse(fs.readFileSync(relationsFile, 'utf-8'));
			Object.assign(backupData, relations);
		}
	}

	// Show what we found
	console.log('\n╔══════════════════════════════════════════════════════╗');
	console.log('║             SOPHIA — DATABASE RESTORE               ║');
	console.log('╚══════════════════════════════════════════════════════╝\n');
	console.log(`[RESTORE] Backup path: ${resolvedPath}\n`);
	console.log('[RESTORE] Records found in backup:');

	const backupCounts: Record<string, number> = {};
	for (const table of [...DATA_TABLES, ...RELATION_TABLES]) {
		const count = (backupData[table] ?? []).length;
		backupCounts[table] = count;
		console.log(`  ${table.padEnd(15)}: ${count}`);
	}

	const totalBackupRecords = Object.values(backupCounts).reduce((a, b) => a + b, 0);
	console.log(`\n  Total: ${totalBackupRecords} records`);

	// Confirmation prompt
	console.log('\n⚠️  WARNING: This will DELETE all existing data in the database.');
	const answer = await prompt("Type 'confirm' to proceed: ");

	if (answer !== 'confirm') {
		console.log('[RESTORE] Aborted. No changes made.');
		process.exit(0);
	}

	console.log(`\n[RESTORE] Connecting to ${SURREAL_URL}...`);
	const db = await connect();
	console.log('[RESTORE] Connected.\n');

	// 1. Clear existing data
	console.log('[RESTORE] Clearing existing data...');
	await clearAllData(db);
	console.log('');

	// 2. Apply schema (idempotent)
	await applySchema(db);

	// 3. Insert in dependency order: sources → claims → arguments → relations
	console.log('[RESTORE] Inserting records...');

	for (const table of DATA_TABLES) {
		const records = backupData[table] ?? [];
		process.stdout.write(`[RESTORE] Inserting ${table} (${records.length} records)...`);
		await insertBatch(db, table, records);
		console.log(' done');
	}

	for (const table of RELATION_TABLES) {
		const records = backupData[table] ?? [];
		if (records.length === 0) continue;
		process.stdout.write(`[RESTORE] Inserting ${table} (${records.length} records)...`);
		await insertBatch(db, table, records);
		console.log(' done');
	}

	// 4. Verify counts
	console.log('\n[RESTORE] Verifying record counts...');
	let allMatch = true;

	for (const table of [...DATA_TABLES, ...RELATION_TABLES]) {
		const expected = backupCounts[table];
		const actual = await countTable(db, table);
		const match = actual === expected;
		if (!match) allMatch = false;
		const status = match ? '✓' : '✗';
		console.log(`  ${status} ${table.padEnd(15)}: ${actual}/${expected}`);
	}

	await db.close();

	// 5. Summary
	console.log('\n╔══════════════════════════════════════════════════════╗');
	console.log('║                  RESTORE SUMMARY                    ║');
	console.log('╚══════════════════════════════════════════════════════╝\n');
	console.log(`  Backup source : ${resolvedPath}`);
	console.log(`  Total records : ${totalBackupRecords}`);

	if (allMatch) {
		console.log('\n✅ Restore complete — all counts match.\n');
	} else {
		console.log('\n⚠️  Restore complete with count mismatches — review above.\n');
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('[RESTORE] Fatal error:', err);
	process.exit(1);
});
