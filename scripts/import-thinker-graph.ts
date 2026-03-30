import { Surreal } from 'surrealdb';
import * as fs from 'fs';
import * as path from 'path';
import { startSpinner, startStageTimer } from './progress.js';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const THINKER_GRAPH_FILE = path.join(process.cwd(), 'data', 'thinker-graph', 'philosophers.json');
const REQUIRED_TABLES = ['thinker', 'influenced_by', 'student_of', 'authored'];

interface ThinkerNode {
	wikidata_id: string;
	name: string;
	birth_year: number | null;
	death_year: number | null;
	traditions: string[];
	domains: string[];
	influenced_by: string[];
	student_of: string[];
}

interface ThinkerGraphPayload {
	extracted_at: string;
	source: string;
	count: number;
	thinkers: ThinkerNode[];
}

interface SourceRow {
	id: string;
	author: unknown;
}

interface ImportFlags {
	dryRun: boolean;
	force: boolean;
	skipRelations: boolean;
	skipAuthorLinks: boolean;
}

interface ImportSummary {
	thinkersInserted: number;
	thinkersSkipped: number;
	thinkersUpdated: number;
	influencedByInserted: number;
	influencedBySkipped: number;
	studentOfInserted: number;
	studentOfSkipped: number;
	authorLinksInserted: number;
	authorLinksSkipped: number;
	unmatchedAuthors: number;
	authorSourceRowsScanned: number;
	authorNameCandidatesScanned: number;
	errors: string[];
}

interface ExistingThinkerProfile {
	birth_year: number | null;
	death_year: number | null;
	traditions_count: number;
	domains_count: number;
}

interface ThinkerAliasRow {
	canonical_name?: unknown;
	raw_name?: unknown;
	wikidata_id?: unknown;
	status?: unknown;
}

type ThinkerWriteContent = {
	wikidata_id: string;
	name: string;
	traditions: string[];
	domains: string[];
	birth_year?: number;
	death_year?: number;
};

function parseFlags(argv: string[]): ImportFlags {
	return {
		dryRun: argv.includes('--dry-run'),
		force: argv.includes('--force'),
		skipRelations: argv.includes('--skip-relations'),
		skipAuthorLinks: argv.includes('--skip-author-links')
	};
}

function normalizeName(value: string): string {
	return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizeAscii(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

function normalizePersonName(value: string): string {
	const ascii = normalizeAscii(value)
		.replace(/[`'.]/g, '')
		.replace(/[^a-z0-9,\s-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!ascii) return '';
	const commaParts = ascii.split(',').map((part) => part.trim()).filter(Boolean);
	let normalized = ascii;
	if (commaParts.length >= 2) {
		const last = commaParts[0];
		const rest = commaParts.slice(1).join(' ').trim();
		normalized = `${rest} ${last}`.trim();
	}
	normalized = normalized
		.replace(/\b(jr|sr|ii|iii|iv|phd|md)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return normalized;
}

function personNameVariants(value: string): string[] {
	const base = normalizePersonName(value);
	if (!base) return [];
	const variants = new Set<string>();
	const tokens = base.split(' ').filter(Boolean);
	variants.add(base);
	if (tokens.length >= 2) {
		const nonInitialTokens = tokens.filter((token) => token.length > 1);
		if (nonInitialTokens.length >= 2) {
			variants.add(nonInitialTokens.join(' '));
		}
		const first = tokens[0];
		const last = tokens[tokens.length - 1];
		if (first && last) {
			variants.add(`${first} ${last}`);
			variants.add(`${first[0]} ${last}`);
			variants.add(`${last} ${first}`);
		}
	}
	return Array.from(variants);
}

function unresolvedRecordId(canonicalName: string): string {
	const slug = canonicalName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 120);
	return slug || 'unknown_name';
}

function toQid(value: string): string {
	const match = value.match(/Q\d+$/);
	return match?.[0] ?? value;
}

function isQid(value: string): boolean {
	return /^Q\d+$/.test(value);
}

function isThinkerNode(value: unknown): value is ThinkerNode {
	if (typeof value !== 'object' || value === null) return false;
	const node = value as Record<string, unknown>;
	return (
		typeof node.wikidata_id === 'string' &&
		typeof node.name === 'string' &&
		(Array.isArray(node.traditions) || node.traditions === undefined) &&
		(Array.isArray(node.domains) || node.domains === undefined) &&
		(Array.isArray(node.influenced_by) || node.influenced_by === undefined) &&
		(Array.isArray(node.student_of) || node.student_of === undefined)
	);
}

function uniqueNonEmptyStrings(values: unknown[]): string[] {
	const set = new Set<string>();
	for (const value of values) {
		if (typeof value === 'string') {
			const trimmed = value.trim();
			if (trimmed) {
				set.add(trimmed);
			}
		}
	}
	const result: string[] = [];
	set.forEach((value) => result.push(value));
	return result;
}

function readThinkerGraphFile(): ThinkerGraphPayload {
	if (!fs.existsSync(THINKER_GRAPH_FILE)) {
		throw new Error(
			`Missing input file: ${THINKER_GRAPH_FILE}. Run scripts/fetch-thinker-graph.ts first.`
		);
	}

	const raw = fs.readFileSync(THINKER_GRAPH_FILE, 'utf-8');
	const parsed = JSON.parse(raw) as Partial<ThinkerGraphPayload>;

	if (!parsed || !Array.isArray(parsed.thinkers)) {
		throw new Error(
			`Invalid thinker graph payload in ${THINKER_GRAPH_FILE} (missing thinkers array).`
		);
	}

	const thinkers = parsed.thinkers.filter(isThinkerNode).map((node) => ({
		wikidata_id: toQid(node.wikidata_id),
		name: node.name.trim(),
		birth_year: typeof node.birth_year === 'number' ? node.birth_year : null,
		death_year: typeof node.death_year === 'number' ? node.death_year : null,
		traditions: Array.isArray(node.traditions)
			? uniqueNonEmptyStrings(node.traditions)
			: [],
		domains: Array.isArray(node.domains)
			? uniqueNonEmptyStrings(node.domains)
			: [],
		influenced_by: Array.isArray(node.influenced_by)
			? uniqueNonEmptyStrings(node.influenced_by).map(toQid)
			: [],
		student_of: Array.isArray(node.student_of)
			? uniqueNonEmptyStrings(node.student_of).map(toQid)
			: []
	}));

	return {
		extracted_at: parsed.extracted_at ?? '',
		source: parsed.source ?? 'wikidata',
		count: thinkers.length,
		thinkers
	};
}

async function connect(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	try {
		await db.signin({
			namespace: SURREAL_NAMESPACE,
			database: SURREAL_DATABASE,
			username: SURREAL_USER,
			password: SURREAL_PASS
		} as any);
	} catch (scopedError) {
		try {
			await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
		} catch {
			throw scopedError;
		}
	}
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

function isMissingTableError(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		message.includes('table') &&
		(message.includes('not found') || message.includes('does not exist') || message.includes('undefined'))
	);
}

async function verifyThinkerGraphTables(db: Surreal): Promise<void> {
	for (const table of REQUIRED_TABLES) {
		try {
			await db.query(`SELECT count() AS count FROM ${table} GROUP ALL`);
		} catch (error) {
			if (isMissingTableError(error)) {
				throw new Error(
					`Missing required table "${table}". Run setup-schema.ts first to create the thinker graph tables.`
				);
			}
			throw error;
		}
	}
}

function parseRecordIdToQid(recordId: unknown): string | null {
	if (typeof recordId === 'string') {
		const match = recordId.match(/Q\d+$/);
		return match?.[0] ?? null;
	}
	if (typeof recordId === 'object' && recordId !== null) {
		const maybeId = (recordId as { id?: unknown }).id;
		if (typeof maybeId === 'string') {
			const match = maybeId.match(/Q\d+$/);
			return match?.[0] ?? null;
		}
	}
	return null;
}

function normalizeRecordId(recordId: unknown): string | null {
	if (typeof recordId === 'string') return recordId;
	if (typeof recordId === 'object' && recordId !== null) {
		const value = recordId as { tb?: unknown; id?: unknown };
		if (typeof value.tb === 'string' && value.id !== undefined) {
			return `${value.tb}:${String(value.id)}`;
		}
		if (typeof value.id === 'string') return value.id;
	}
	return null;
}

function edgeKey(fromQid: string, toQid: string): string {
	return `${fromQid}::${toQid}`;
}

function buildThinkerWriteContent(thinker: ThinkerNode): ThinkerWriteContent {
	const content: ThinkerWriteContent = {
		wikidata_id: thinker.wikidata_id,
		name: thinker.name,
		traditions: thinker.traditions,
		domains: thinker.domains
	};
	if (typeof thinker.birth_year === 'number') {
		content.birth_year = thinker.birth_year;
	}
	if (typeof thinker.death_year === 'number') {
		content.death_year = thinker.death_year;
	}
	return content;
}

function estimateAuthorMatchConfidence(author: string, thinkerName: string): number {
	const authorNorm = normalizeName(author);
	const thinkerNorm = normalizeName(thinkerName);
	if (!authorNorm || !thinkerNorm) return 0;
	if (authorNorm === thinkerNorm) return 1;
	if (authorNorm.includes(thinkerNorm) || thinkerNorm.includes(authorNorm)) return 0.7;
	return 0;
}

async function loadExistingThinkers(db: Surreal): Promise<Set<string>> {
	const rows = await db.query<unknown[][]>(`SELECT VALUE id FROM thinker`);
	const values = rows?.[0] ?? [];
	const ids = new Set<string>();
	for (const value of values) {
		const qid = parseRecordIdToQid(value);
		if (qid) ids.add(qid);
	}
	return ids;
}

async function loadExistingThinkerProfiles(db: Surreal): Promise<Map<string, ExistingThinkerProfile>> {
	const rows = await db.query<
		{ id?: unknown; birth_year?: unknown; death_year?: unknown; traditions?: unknown; domains?: unknown }[][]
	>(`SELECT id, birth_year, death_year, traditions, domains FROM thinker`);
	const profiles = new Map<string, ExistingThinkerProfile>();
	for (const row of rows?.[0] ?? []) {
		const qid = parseRecordIdToQid(row.id);
		if (!qid) continue;
		profiles.set(qid, {
			birth_year: typeof row.birth_year === 'number' ? row.birth_year : null,
			death_year: typeof row.death_year === 'number' ? row.death_year : null,
			traditions_count: Array.isArray(row.traditions) ? row.traditions.length : 0,
			domains_count: Array.isArray(row.domains) ? row.domains.length : 0
		});
	}
	return profiles;
}

async function loadExistingRelations(db: Surreal, table: 'influenced_by' | 'student_of'): Promise<Set<string>> {
	const query =
		table === 'influenced_by' ? 'SELECT in, out FROM influenced_by' : 'SELECT in, out FROM student_of';
	const rows = await db.query<{ in?: unknown; out?: unknown }[][]>(query);
	const result = new Set<string>();
	for (const row of rows?.[0] ?? []) {
		const fromQid = parseRecordIdToQid(row.in);
		const toQid = parseRecordIdToQid(row.out);
		if (fromQid && toQid) {
			result.add(edgeKey(fromQid, toQid));
		}
	}
	return result;
}

async function loadExistingAuthoredRelations(db: Surreal): Promise<Set<string>> {
	const rows = await db.query<{ in?: unknown; out?: unknown }[][]>(`SELECT in, out FROM authored`);
	const result = new Set<string>();
	for (const row of rows?.[0] ?? []) {
		const thinkerQid = parseRecordIdToQid(row.in);
		let sourceId = '';
		if (typeof row.out === 'string') {
			sourceId = row.out;
		} else if (typeof row.out === 'object' && row.out !== null && typeof (row.out as any).id === 'string') {
			sourceId = (row.out as any).id;
		}
		if (thinkerQid && sourceId) {
			result.add(`${thinkerQid}::${sourceId}`);
		}
	}
	return result;
}

async function loadActiveThinkerAliases(db: Surreal): Promise<ThinkerAliasRow[]> {
	try {
		const rows =
			(await db.query<ThinkerAliasRow[][]>(
				`SELECT canonical_name, raw_name, wikidata_id, status
				 FROM thinker_alias
				 WHERE status = 'active'`
			))?.[0] ?? [];
		return rows;
	} catch {
		return [];
	}
}

function collectAuthorNames(authorValue: unknown): string[] {
	if (typeof authorValue === 'string') {
		return authorValue
			.split(/;| and /i)
			.map((item) => item.trim())
			.filter(Boolean);
	}
	if (Array.isArray(authorValue)) {
		const names: string[] = [];
		for (const entry of authorValue) {
			if (typeof entry === 'string') {
				const trimmed = entry.trim();
				if (trimmed) names.push(trimmed);
				continue;
			}
			if (entry && typeof entry === 'object') {
				const record = entry as Record<string, unknown>;
				const fromName = typeof record.name === 'string' ? record.name.trim() : '';
				const fromFullName = typeof record.full_name === 'string' ? record.full_name.trim() : '';
				const family = typeof record.family === 'string' ? record.family.trim() : '';
				const given = typeof record.given === 'string' ? record.given.trim() : '';
				if (fromName) names.push(fromName);
				else if (fromFullName) names.push(fromFullName);
				else if (family || given) names.push(`${given} ${family}`.trim());
			}
		}
		return names.filter(Boolean);
	}
	return [];
}

async function main(): Promise<void> {
	const flags = parseFlags(process.argv.slice(2));
	const summary: ImportSummary = {
		thinkersInserted: 0,
		thinkersSkipped: 0,
		thinkersUpdated: 0,
		influencedByInserted: 0,
		influencedBySkipped: 0,
		studentOfInserted: 0,
		studentOfSkipped: 0,
		authorLinksInserted: 0,
		authorLinksSkipped: 0,
		unmatchedAuthors: 0,
		authorSourceRowsScanned: 0,
		authorNameCandidatesScanned: 0,
		errors: []
	};

	console.log('\n[THINKER-IMPORT] Starting thinker graph import...');
	console.log(`[THINKER-IMPORT] Input: ${THINKER_GRAPH_FILE}`);
	console.log(`[THINKER-IMPORT] Mode: ${flags.dryRun ? 'dry-run (no DB writes)' : 'write enabled'}`);
	console.log(
		`[THINKER-IMPORT] Flags: force=${flags.force} skip-relations=${flags.skipRelations} skip-author-links=${flags.skipAuthorLinks}`
	);

	const payload = readThinkerGraphFile();
	const thinkers = payload.thinkers;

	if (flags.dryRun) {
		const influenceEdgeCount = thinkers.reduce((total, thinker) => total + thinker.influenced_by.length, 0);
		const studentEdgeCount = thinkers.reduce((total, thinker) => total + thinker.student_of.length, 0);
		console.log('\n[THINKER-IMPORT] Dry-run summary (no DB operations executed)');
		console.log(`  Thinkers in file: ${thinkers.length}`);
		console.log(`  influenced_by edges in file: ${influenceEdgeCount}`);
		console.log(`  student_of edges in file: ${studentEdgeCount}`);
		console.log(
			`  Author link pass: ${flags.skipAuthorLinks ? 'skipped by flag' : 'would run best-effort name matching'}`
		);
		return;
	}

	const db = await connect();
	const overallTimer = startStageTimer();

	try {
		await verifyThinkerGraphTables(db);
	} catch (error) {
		await db.close();
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[THINKER-IMPORT] ${message}`);
		process.exit(1);
	}

	try {
		const thinkerSpinner = startSpinner(`Preparing thinker upsert (${thinkers.length} records)`);
		const existingThinkers = await loadExistingThinkers(db);
		const existingProfiles = await loadExistingThinkerProfiles(db);
		thinkerSpinner.stop(`✓ Loaded ${existingThinkers.size} existing thinker records`);

		const thinkerWriteSpinner = startSpinner(
			flags.force ? `Upserting thinkers with --force` : `Creating thinkers (skip existing)`
		);

		for (let i = 0; i < thinkers.length; i++) {
			const thinker = thinkers[i];
			const thinkerId = thinker.wikidata_id;
			const thinkerData = buildThinkerWriteContent(thinker);

			if (!flags.force && existingThinkers.has(thinkerId)) {
				const profile = existingProfiles.get(thinkerId);
				const needsBioBackfill =
					(profile?.birth_year == null && thinker.birth_year != null) ||
					(profile?.death_year == null && thinker.death_year != null);
				const needsTaxonomyBackfill =
					(profile?.traditions_count ?? 0) === 0 && thinker.traditions.length > 0 ||
					(profile?.domains_count ?? 0) === 0 && thinker.domains.length > 0;
				if (needsBioBackfill || needsTaxonomyBackfill) {
					try {
						await db.query(
							`UPDATE type::record($id) MERGE {
								birth_year: if birth_year = NONE AND $birth_year != NONE then $birth_year else birth_year end,
								death_year: if death_year = NONE AND $death_year != NONE then $death_year else death_year end,
								traditions: if array::len(traditions) = 0 AND array::len($traditions) > 0 then $traditions else traditions end,
								domains: if array::len(domains) = 0 AND array::len($domains) > 0 then $domains else domains end,
								imported_at: time::now()
							}`,
							{
								id: `thinker:${thinkerId}`,
								birth_year: thinker.birth_year ?? undefined,
								death_year: thinker.death_year ?? undefined,
								traditions: thinker.traditions,
								domains: thinker.domains
							}
						);
						summary.thinkersUpdated += 1;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						summary.errors.push(`thinker backfill ${thinkerId}: ${message}`);
					}
				} else {
					summary.thinkersSkipped += 1;
				}
				continue;
			}

			try {
				if (flags.force) {
					await db.query(
						`UPSERT type::record('thinker', $wikidata_id) CONTENT {
							id: type::record('thinker', $wikidata_id),
							wikidata_id: $wikidata_id,
							name: $name,
							birth_year: $birth_year,
							death_year: $death_year,
							traditions: $traditions,
							domains: $domains,
							imported_at: time::now()
						}`,
						{ ...thinkerData }
					);
					if (existingThinkers.has(thinkerId)) {
						summary.thinkersUpdated += 1;
					} else {
						summary.thinkersInserted += 1;
						existingThinkers.add(thinkerId);
					}
				} else {
					await db.query(
						`CREATE ONLY type::record('thinker', $wikidata_id) CONTENT {
							id: type::record('thinker', $wikidata_id),
							wikidata_id: $wikidata_id,
							name: $name,
							birth_year: $birth_year,
							death_year: $death_year,
							traditions: $traditions,
							domains: $domains,
							imported_at: time::now()
						}`,
						{ ...thinkerData }
					);
					summary.thinkersInserted += 1;
					existingThinkers.add(thinkerId);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!flags.force && message.toLowerCase().includes('already exists')) {
					summary.thinkersSkipped += 1;
					continue;
				}
				summary.errors.push(`thinker ${thinkerId}: ${message}`);
			}

			if ((i + 1) % 100 === 0) {
				thinkerWriteSpinner.update(`Processed ${i + 1}/${thinkers.length} thinkers`);
			}
		}
		thinkerWriteSpinner.stop(`✓ Thinker pass complete (${thinkers.length} processed)`);

		if (!flags.skipRelations) {
			const relationPrepSpinner = startSpinner('Loading existing relation edges');
			const [existingInfluencedBy, existingStudentOf] = await Promise.all([
				loadExistingRelations(db, 'influenced_by'),
				loadExistingRelations(db, 'student_of')
			]);
			relationPrepSpinner.stop(
				`✓ Existing edges loaded (influenced_by=${existingInfluencedBy.size}, student_of=${existingStudentOf.size})`
			);

			const relationSpinner = startSpinner('Importing thinker relation edges');
			for (const thinker of thinkers) {
				const fromId = thinker.wikidata_id;

				for (const to of thinker.influenced_by) {
					const toId = toQid(to);
					const key = edgeKey(fromId, toId);
					if (existingInfluencedBy.has(key)) {
						summary.influencedBySkipped += 1;
						continue;
					}
					try {
						if (!isQid(fromId) || !isQid(toId)) {
							summary.errors.push(`influenced_by ${fromId}->${toId}: invalid thinker id format`);
							continue;
						}
						await db.query(
							`RELATE thinker:${fromId}->influenced_by->thinker:${toId}
							 SET relation_subtype = 'influenced_by',
							     imported_at = time::now()`
						);
						existingInfluencedBy.add(key);
						summary.influencedByInserted += 1;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						summary.errors.push(`influenced_by ${fromId}->${toId}: ${message}`);
					}
				}

				for (const to of thinker.student_of) {
					const toId = toQid(to);
					const key = edgeKey(fromId, toId);
					if (existingStudentOf.has(key)) {
						summary.studentOfSkipped += 1;
						continue;
					}
					try {
						if (!isQid(fromId) || !isQid(toId)) {
							summary.errors.push(`student_of ${fromId}->${toId}: invalid thinker id format`);
							continue;
						}
						await db.query(
							`RELATE thinker:${fromId}->student_of->thinker:${toId}
							 SET relation_subtype = 'student_of',
							     imported_at = time::now()`
						);
						existingStudentOf.add(key);
						summary.studentOfInserted += 1;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						summary.errors.push(`student_of ${fromId}->${toId}: ${message}`);
					}
				}
			}
			relationSpinner.stop('✓ Relation import pass complete');
		}

		if (!flags.skipAuthorLinks) {
			const authorSpinner = startSpinner('Linking thinkers to source authors');
			let sourceRows: SourceRow[] = [];
			try {
				const queryResult = await db.query<SourceRow[][]>(`SELECT id, author FROM source`);
				sourceRows = queryResult?.[0] ?? [];
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				summary.errors.push(`source read for author links: ${message}`);
			}

			const thinkerByNormalizedName = new Map<string, ThinkerNode[]>();
			for (const thinker of thinkers) {
				const normalized = normalizeName(thinker.name);
				const list = thinkerByNormalizedName.get(normalized) ?? [];
				list.push(thinker);
				thinkerByNormalizedName.set(normalized, list);
			}
			const thinkerByPersonVariant = new Map<string, ThinkerNode[]>();
			for (const thinker of thinkers) {
				for (const variant of personNameVariants(thinker.name)) {
					const list = thinkerByPersonVariant.get(variant) ?? [];
					if (!list.some((candidate) => candidate.wikidata_id === thinker.wikidata_id)) {
						list.push(thinker);
					}
					thinkerByPersonVariant.set(variant, list);
				}
			}
			const aliasRows = await loadActiveThinkerAliases(db);
			for (const alias of aliasRows) {
				const wikidataId = typeof alias.wikidata_id === 'string' ? toQid(alias.wikidata_id) : '';
				if (!wikidataId) continue;
				const thinker = thinkers.find((candidate) => candidate.wikidata_id === wikidataId);
				if (!thinker) continue;
				const aliasNames: string[] = [];
				if (typeof alias.canonical_name === 'string') aliasNames.push(alias.canonical_name);
				if (typeof alias.raw_name === 'string') aliasNames.push(alias.raw_name);
				for (const aliasName of aliasNames) {
					for (const variant of personNameVariants(aliasName)) {
						const list = thinkerByPersonVariant.get(variant) ?? [];
						if (!list.some((candidate) => candidate.wikidata_id === thinker.wikidata_id)) {
							list.push(thinker);
						}
						thinkerByPersonVariant.set(variant, list);
					}
				}
			}

			const existingAuthoredEdges = await loadExistingAuthoredRelations(db);
			const unmatchedAuthors = new Set<string>();

			for (const source of sourceRows) {
				summary.authorSourceRowsScanned += 1;
				const authorList = collectAuthorNames(source.author);
				if (authorList.length === 0) continue;
				summary.authorNameCandidatesScanned += authorList.length;

				const sourceId = normalizeRecordId(source.id) ?? '';
				if (!sourceId) continue;

				for (const author of authorList) {
					const normalizedAuthor = normalizeName(author);
					const exactCandidates = thinkerByNormalizedName.get(normalizedAuthor) ?? [];
					const candidates: Array<{ thinker: ThinkerNode; confidence: number }> = [];

					for (const thinker of exactCandidates) {
						candidates.push({ thinker, confidence: 1 });
					}

					if (candidates.length === 0) {
						const personVariants = personNameVariants(author);
						for (const variant of personVariants) {
							const variantMatches = thinkerByPersonVariant.get(variant) ?? [];
							for (const thinker of variantMatches) {
								candidates.push({ thinker, confidence: 0.95 });
							}
						}
					}

					if (candidates.length === 0) {
						for (const thinker of thinkers) {
							const confidence = estimateAuthorMatchConfidence(author, thinker.name);
							if (confidence >= 0.65) {
								candidates.push({ thinker, confidence });
							}
						}
					}

					if (candidates.length === 0) {
						unmatchedAuthors.add(normalizedAuthor);
						const canonicalName = normalizePersonName(author);
						if (canonicalName) {
							try {
								await db.query(
									`UPSERT type::record('unresolved_thinker_reference', $rid) SET
										raw_name = $raw_name,
										canonical_name = $canonical_name,
										status = if status = 'resolved' then status else 'queued' end,
										seen_count = if seen_count = NONE then 1 else seen_count + 1 end,
										source_ids = if source_ids = NONE
											then [$source_id]
											else array::distinct(source_ids + [$source_id])
										end,
										contexts = if contexts = NONE then [] else contexts end,
										proposed_qids = if proposed_qids = NONE then [] else proposed_qids end,
										proposed_labels = if proposed_labels = NONE then [] else proposed_labels end,
										first_seen_at = if first_seen_at = NONE then time::now() else first_seen_at end,
										last_seen_at = time::now()`,
									{
										rid: unresolvedRecordId(canonicalName),
										raw_name: author,
										canonical_name: canonicalName,
										source_id: sourceId
									}
								);
							} catch {
								// Best-effort unresolved queue capture; no hard fail.
							}
						}
						continue;
					}

					candidates.sort((a, b) => b.confidence - a.confidence);
					const bestConfidence = candidates[0].confidence;
					const bestMatches = candidates
						.filter((candidate) => candidate.confidence === bestConfidence)
						.filter(
							(candidate, index, list) =>
								list.findIndex((entry) => entry.thinker.wikidata_id === candidate.thinker.wikidata_id) === index
						);
					if (bestConfidence < 0.8) {
						unmatchedAuthors.add(normalizedAuthor);
						continue;
					}

					for (const match of bestMatches) {
						const thinkerQid = match.thinker.wikidata_id;
						const edgeKeyValue = `${thinkerQid}::${sourceId}`;
						if (existingAuthoredEdges.has(edgeKeyValue)) {
							summary.authorLinksSkipped += 1;
							continue;
						}
						try {
							await db.query(
								`RELATE thinker:${thinkerQid}->authored->${sourceId}
								 SET match_type = 'name_match',
								     confidence = $confidence,
								     linked_at = time::now()`,
								{
									confidence: bestConfidence
								}
							);
							existingAuthoredEdges.add(edgeKeyValue);
							summary.authorLinksInserted += 1;
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							summary.errors.push(`authored ${thinkerQid}->${sourceId}: ${message}`);
						}
					}
				}
			}

			summary.unmatchedAuthors = unmatchedAuthors.size;
			authorSpinner.stop('✓ Author link pass complete');
		}
	} finally {
		await db.close();
	}

	console.log('\n[THINKER-IMPORT] Summary');
	console.log(`  Thinkers inserted: ${summary.thinkersInserted}`);
	console.log(`  Thinkers updated (--force): ${summary.thinkersUpdated}`);
	console.log(`  Thinkers skipped: ${summary.thinkersSkipped}`);
	console.log(`  influenced_by inserted: ${summary.influencedByInserted}`);
	console.log(`  influenced_by skipped: ${summary.influencedBySkipped}`);
	console.log(`  student_of inserted: ${summary.studentOfInserted}`);
	console.log(`  student_of skipped: ${summary.studentOfSkipped}`);
	console.log(`  authored links inserted: ${summary.authorLinksInserted}`);
	console.log(`  authored links skipped: ${summary.authorLinksSkipped}`);
	console.log(`  Unmatched author names: ${summary.unmatchedAuthors}`);
	console.log(`  Author source rows scanned: ${summary.authorSourceRowsScanned}`);
	console.log(`  Author names scanned: ${summary.authorNameCandidatesScanned}`);
	console.log(`  Errors: ${summary.errors.length}`);
	console.log(`  Duration: ${overallTimer.end()}`);

	if (summary.errors.length > 0) {
		console.log('  Error details:');
		for (const error of summary.errors.slice(0, 30)) {
			console.log(`   - ${error}`);
		}
		if (summary.errors.length > 30) {
			console.log(`   - ...and ${summary.errors.length - 30} more`);
		}
	}
}

main().catch((error) => {
	console.error('[THINKER-IMPORT] Fatal error:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});
