import { Surreal } from 'surrealdb';
import * as fs from 'node:fs';
import * as path from 'node:path';

type Row = Record<string, unknown>;

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const table = process.argv[2];
const outFile = process.argv[3];
const limit = Number(process.argv[4] || 250);

if (!table || !outFile) {
	console.error(
		'Usage: npx tsx --env-file=.env scripts/db-export-table-paged.ts <table> <output-json> [batch-size]'
	);
	process.exit(1);
}

if (!Number.isFinite(limit) || limit <= 0) {
	console.error('Batch size must be a positive number.');
	process.exit(1);
}

async function connectDb(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

async function queryPage(db: Surreal, start: number): Promise<Row[]> {
	const query = `SELECT * FROM ${table} LIMIT ${limit} START ${start}`;
	const result = await db.query<Row[][]>(query);
	if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
	return [];
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
	console.log(`[EXPORT:${table}] Connecting to ${SURREAL_URL}...`);
	let db = await connectDb();
	console.log(`[EXPORT:${table}] Connected. Batch size: ${limit}`);

	let start = 0;
	const rows: Row[] = [];

	while (true) {
		let page: Row[] | null = null;
		let lastError: unknown = null;

		for (let attempt = 1; attempt <= 8; attempt++) {
			try {
				page = await queryPage(db, start);
				break;
			} catch (err) {
				lastError = err;
				console.warn(
					`[EXPORT:${table}] Query failed at offset ${start} (attempt ${attempt}/8): ${
						err instanceof Error ? err.message : String(err)
					}`
				);
				try {
					await db.close();
				} catch {
					// no-op
				}
				await delay(1000 * attempt);
				db = await connectDb();
			}
		}

		if (!page) {
			throw lastError instanceof Error ? lastError : new Error(String(lastError));
		}

		if (page.length === 0) break;
		rows.push(...page);
		start += page.length;
		console.log(`[EXPORT:${table}] Exported ${rows.length} rows so far...`);
		if (page.length < limit) break;
	}

	const resolvedOut = path.resolve(outFile);
	fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
	fs.writeFileSync(resolvedOut, JSON.stringify(rows, null, 2));
	console.log(`[EXPORT:${table}] Done. Wrote ${rows.length} rows -> ${resolvedOut}`);

	await db.close();
}

main().catch((err) => {
	console.error(`[EXPORT:${table}] Fatal error:`, err);
	process.exit(1);
});
