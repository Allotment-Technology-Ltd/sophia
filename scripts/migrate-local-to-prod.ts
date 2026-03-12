import { Surreal } from 'surrealdb';

const LOCAL_URL = process.env.LOCAL_SURREAL_URL || 'http://localhost:8000/rpc';
const LOCAL_USER = process.env.LOCAL_SURREAL_USER || 'root';
const LOCAL_PASS = process.env.LOCAL_SURREAL_PASS || 'root';
const PROD_URL = process.env.SURREAL_URL || 'http://localhost:8800/rpc';
const PROD_USER = process.env.SURREAL_USER || 'root';
const PROD_PASS = process.env.SURREAL_PASS || '';
const NS = process.env.SURREAL_NAMESPACE || 'sophia';
const DB = process.env.SURREAL_DATABASE || 'sophia';

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
] as const;

type SourceRecord = {
	id: string;
	title?: string;
	url?: string;
	canonical_url_hash?: string;
	[key: string]: unknown;
};

function splitRecordId(recordId: string): { table: string; idPart: string } | null {
	const [table, idPart] = recordId.split(':');
	if (!table || !idPart) return null;
	return { table, idPart };
}

function stripId<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
	const { id: _id, ...rest } = record;
	return rest;
}

async function connect(url: string, username: string, password: string): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(url);
	await db.signin({ username, password } as any);
	await db.use({ namespace: NS, database: DB });
	return db;
}

async function upsertRecords(db: Surreal, records: Record<string, unknown>[]): Promise<void> {
	for (const record of records) {
		const id = String(record.id || '');
		if (!id) continue;
		const parsed = splitRecordId(id);
		if (!parsed) continue;
		await db.query('UPSERT type::thing($table, $idPart) CONTENT $content', {
			table: parsed.table,
			idPart: parsed.idPart,
			content: stripId(record)
		});
	}
}

async function insertRelationRecords(
	db: Surreal,
	table: (typeof RELATION_TABLES)[number],
	records: Record<string, unknown>[]
): Promise<void> {
	for (const record of records) {
		const inId = String(record.in || '');
		const outId = String(record.out || '');
		if (!inId || !outId) continue;
		if (!/^[a-z_]+:[a-zA-Z0-9_-]+$/.test(inId) || !/^[a-z_]+:[a-zA-Z0-9_-]+$/.test(outId)) {
			continue;
		}
		const { id: _id, in: _in, out: _out, ...content } = record;
		await db.query(`RELATE ${inId}->${table}->${outId} CONTENT $content`, { content });
	}
}

async function fetchRows<T = Record<string, unknown>>(
	db: Surreal,
	query: string,
	vars: Record<string, unknown>
): Promise<T[]> {
	const result = await db.query<T[][]>(query, vars);
	return Array.isArray(result?.[0]) ? result[0] : [];
}

async function cleanupProdSource(prod: Surreal, source: SourceRecord): Promise<void> {
	const rows = await fetchRows<{ id: string }>(
		prod,
		'SELECT id FROM source WHERE canonical_url_hash = $hash OR url = $url',
		{ hash: source.canonical_url_hash ?? null, url: source.url ?? null }
	);

	for (const row of rows) {
		const sid = row.id;
		for (const relTable of RELATION_TABLES) {
			await prod.query(
				`DELETE ${relTable} WHERE in IN (SELECT id FROM claim WHERE source = $sid) OR out IN (SELECT id FROM claim WHERE source = $sid)`,
				{ sid }
			);
		}
		await prod.query('DELETE part_of WHERE in IN (SELECT id FROM argument WHERE source = $sid)', { sid });
		await prod.query('DELETE part_of WHERE out IN (SELECT id FROM claim WHERE source = $sid)', { sid });
		await prod.query('DELETE claim WHERE source = $sid', { sid });
		await prod.query('DELETE passage WHERE source = $sid', { sid });
		await prod.query('DELETE argument WHERE source = $sid', { sid });
		await prod.query('DELETE source WHERE id = $sid', { sid });
	}
}

async function migrateSource(local: Surreal, prod: Surreal, source: SourceRecord): Promise<void> {
	console.log(`\n[MIGRATE] ${source.title || source.id}`);
	await cleanupProdSource(prod, source);
	console.log('[MIGRATE] Cleanup complete');

	const passages = await fetchRows(local, 'SELECT * FROM passage WHERE source = $sid', { sid: source.id });
	const claims = await fetchRows(local, 'SELECT * FROM claim WHERE source = $sid', { sid: source.id });
	const arguments_ = await fetchRows(local, 'SELECT * FROM argument WHERE source = $sid', { sid: source.id });
	console.log(
		`[MIGRATE] Loaded local rows passages=${passages.length} claims=${claims.length} arguments=${arguments_.length}`
	);

	const claimIds = claims.map((record: any) => record.id).filter(Boolean);
	const argIds = arguments_.map((record: any) => record.id).filter(Boolean);
	const ids = [...new Set([...claimIds, ...argIds])];

	const relationRows: Record<string, Record<string, unknown>[]> = {};
	for (const table of RELATION_TABLES) {
		if (ids.length === 0) {
			relationRows[table] = [];
			continue;
		}
		relationRows[table] = await fetchRows(
			local,
			`SELECT * FROM ${table} WHERE in INSIDE $ids OR out INSIDE $ids`,
			{ ids }
		);
	}

	await upsertRecords(prod, [source as Record<string, unknown>]);
	console.log('[MIGRATE] Upserted source');
	await upsertRecords(prod, passages as Record<string, unknown>[]);
	console.log('[MIGRATE] Upserted passages');
	await upsertRecords(prod, claims as Record<string, unknown>[]);
	console.log('[MIGRATE] Upserted claims');
	await upsertRecords(prod, arguments_ as Record<string, unknown>[]);
	console.log('[MIGRATE] Upserted arguments');
	for (const table of RELATION_TABLES) {
		await insertRelationRecords(prod, table, relationRows[table] ?? []);
		console.log(`[MIGRATE] Upserted ${table} (${relationRows[table]?.length ?? 0})`);
	}

	console.log(
		`[MIGRATE] Copied source=1 passages=${passages.length} claims=${claims.length} arguments=${arguments_.length} relations=${Object.values(
			relationRows
		).reduce((sum, rows) => sum + rows.length, 0)}`
	);
}

async function main() {
	const args = process.argv.slice(2);
	const sinceArgIndex = args.indexOf('--since');
	const since = sinceArgIndex >= 0 && args[sinceArgIndex + 1] ? args[sinceArgIndex + 1] : '2026-03-12T00:00:00Z';
	const titleArgIndex = args.indexOf('--title');
	const titleFilter = titleArgIndex >= 0 && args[titleArgIndex + 1] ? args[titleArgIndex + 1] : '';
	const hashArgIndex = args.indexOf('--canonical-hash');
	const canonicalHashFilter = hashArgIndex >= 0 && args[hashArgIndex + 1] ? args[hashArgIndex + 1] : '';
	const sourceIdArgIndex = args.indexOf('--source-id');
	const sourceIdFilter = sourceIdArgIndex >= 0 && args[sourceIdArgIndex + 1] ? args[sourceIdArgIndex + 1] : '';
	const forceArg = args.includes('--force');

	if (!PROD_PASS) {
		throw new Error('SURREAL_PASS is required for production migration target');
	}

	console.log(`[MIGRATE] Local: ${LOCAL_URL}  ->  Prod: ${PROD_URL}`);
	console.log(`[MIGRATE] Since: ${since}`);

	const local = await connect(LOCAL_URL, LOCAL_USER, LOCAL_PASS);
	const prod = await connect(PROD_URL, PROD_USER, PROD_PASS);

	const localSources = await fetchRows<SourceRecord>(
		local,
		`SELECT * FROM source WHERE ingested_at >= <datetime>$since ORDER BY ingested_at DESC`,
		{ since }
	);
	const filteredSources = localSources.filter((source) => {
		if (titleFilter && source.title?.toString() !== titleFilter) return false;
		if (canonicalHashFilter && source.canonical_url_hash?.toString() !== canonicalHashFilter) return false;
		if (sourceIdFilter && source.id?.toString() !== sourceIdFilter) return false;
		return true;
	});

	let migrated = 0;
	for (const source of filteredSources) {
		const existing = await fetchRows<SourceRecord>(
			prod,
			'SELECT id,title,ingested_at FROM source WHERE canonical_url_hash = $hash OR url = $url LIMIT 1',
			{ hash: source.canonical_url_hash ?? null, url: source.url ?? null }
		);
		if (existing.length > 0 && !forceArg) {
			console.log(`[SKIP] ${source.title || source.id} already exists in prod (use --force to replace)`);
			continue;
		}
		await migrateSource(local, prod, source);
		migrated += 1;
	}

	await local.close();
	await prod.close();
	console.log(`\n[MIGRATE] Completed. Sources migrated: ${migrated}`);
}

main().catch((error) => {
	console.error('[MIGRATE] Fatal:', error);
	process.exit(1);
});
