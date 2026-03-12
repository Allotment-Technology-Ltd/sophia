import { Surreal } from 'surrealdb';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { setupSchema } from './setup-schema.js';

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
	'defines',
	'qualifies',
	'refines',
	'exemplifies',
	'part_of'
];

const DATA_TABLES = ['source', 'passage', 'claim', 'argument', 'review_audit_log'];

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
	await setupSchema(db);
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
