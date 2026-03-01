import { Surreal } from 'surrealdb';
import * as fs from 'fs';
import * as path from 'path';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const BACKUP_ROOT = path.join(process.cwd(), 'data', 'backups');
const MAX_BACKUPS = 5;

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

async function fetchTable(db: Surreal, table: string): Promise<unknown[]> {
	const result = await db.query<unknown[][]>(`SELECT * FROM ${table}`);
	if (Array.isArray(result) && Array.isArray(result[0])) {
		return result[0];
	}
	return [];
}

async function countTable(db: Surreal, table: string): Promise<number> {
	const result = await db.query<{ count: number }[][]>(
		`SELECT count() AS count FROM ${table} GROUP ALL`
	);
	return result?.[0]?.[0]?.count ?? 0;
}

function pruneOldBackups(): void {
	if (!fs.existsSync(BACKUP_ROOT)) return;

	const entries = fs
		.readdirSync(BACKUP_ROOT, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort(); // ISO timestamp strings sort chronologically

	const excess = entries.length - MAX_BACKUPS + 1; // +1 to make room for the new one
	if (excess > 0) {
		for (const dir of entries.slice(0, excess)) {
			const fullPath = path.join(BACKUP_ROOT, dir);
			fs.rmSync(fullPath, { recursive: true, force: true });
			console.log(`[BACKUP] Pruned old backup: ${dir}`);
		}
	}
}

async function main() {
	console.log('\n╔══════════════════════════════════════════════════════╗');
	console.log('║             SOPHIA — DATABASE BACKUP                ║');
	console.log('╚══════════════════════════════════════════════════════╝\n');

	console.log(`[BACKUP] Connecting to ${SURREAL_URL}...`);
	const db = await connect();
	console.log('[BACKUP] Connected.\n');

	// Create timestamped backup directory
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	pruneOldBackups();

	const backupDir = path.join(BACKUP_ROOT, timestamp);
	fs.mkdirSync(backupDir, { recursive: true });
	console.log(`[BACKUP] Writing to: ${backupDir}\n`);

	const summary: Record<string, number> = {};
	const fullBackup: Record<string, unknown[]> = {};

	// Export data tables
	for (const table of DATA_TABLES) {
		process.stdout.write(`[BACKUP] Exporting ${table}...`);
		const rows = await fetchTable(db, table);
		summary[table] = rows.length;
		fullBackup[table] = rows;

		const filePath = path.join(backupDir, `${table}.json`);
		fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
		console.log(` ${rows.length} records`);
	}

	// Export relation tables (combined into relations.json)
	const allRelations: Record<string, unknown[]> = {};
	for (const table of RELATION_TABLES) {
		process.stdout.write(`[BACKUP] Exporting ${table}...`);
		const rows = await fetchTable(db, table);
		summary[table] = rows.length;
		allRelations[table] = rows;
		fullBackup[table] = rows;
		console.log(` ${rows.length} records`);
	}

	const relationsPath = path.join(backupDir, 'relations.json');
	fs.writeFileSync(relationsPath, JSON.stringify(allRelations, null, 2));

	// Write full backup
	const fullBackupPath = path.join(backupDir, 'full-backup.json');
	fs.writeFileSync(fullBackupPath, JSON.stringify(fullBackup, null, 2));

	await db.close();

	// Print summary
	const totalRecords = Object.values(summary).reduce((a, b) => a + b, 0);
	const backupBytes = fs.statSync(fullBackupPath).size;
	const backupMb = (backupBytes / 1024 / 1024).toFixed(2);

	console.log('\n╔══════════════════════════════════════════════════════╗');
	console.log('║                   BACKUP SUMMARY                    ║');
	console.log('╚══════════════════════════════════════════════════════╝\n');

	for (const [table, count] of Object.entries(summary)) {
		console.log(`  ${table.padEnd(15)}: ${count} records`);
	}

	console.log(`\n  Total records : ${totalRecords}`);
	console.log(`  Backup size   : ${backupMb} MB`);
	console.log(`  Location      : ${backupDir}`);
	console.log('\n✅ Backup complete.\n');
}

main().catch((err) => {
	console.error('[BACKUP] Fatal error:', err);
	process.exit(1);
});
