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
	errors: string[];
}

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

function toQid(value: string): string {
	const match = value.match(/Q\d+$/);
	return match?.[0] ?? value;
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
	await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
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

function edgeKey(fromQid: string, toQid: string): string {
	return `${fromQid}::${toQid}`;
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
		thinkerSpinner.stop(`✓ Loaded ${existingThinkers.size} existing thinker records`);

		const thinkerWriteSpinner = startSpinner(
			flags.force ? `Upserting thinkers with --force` : `Creating thinkers (skip existing)`
		);

		for (let i = 0; i < thinkers.length; i++) {
			const thinker = thinkers[i];
			const thinkerId = thinker.wikidata_id;
			const recordId = `thinker:${thinkerId}`;
			const thinkerData = {
				id: recordId,
				wikidata_id: thinkerId,
				name: thinker.name,
				birth_year: thinker.birth_year,
				death_year: thinker.death_year,
				traditions: thinker.traditions,
				domains: thinker.domains
			};

			if (!flags.force && existingThinkers.has(thinkerId)) {
				summary.thinkersSkipped += 1;
				continue;
			}

			try {
				if (flags.force) {
					await db.query(
						`UPSERT $id CONTENT { 
							id: $id,
							wikidata_id: $wikidata_id,
							name: $name,
							birth_year: $birth_year,
							death_year: $death_year,
							traditions: $traditions,
							domains: $domains,
							imported_at: time::now()
						}`,
						{ ...thinkerData, id: recordId }
					);
					if (existingThinkers.has(thinkerId)) {
						summary.thinkersUpdated += 1;
					} else {
						summary.thinkersInserted += 1;
						existingThinkers.add(thinkerId);
					}
				} else {
					await db.query(
						`CREATE ONLY $id CONTENT {
							id: $id,
							wikidata_id: $wikidata_id,
							name: $name,
							birth_year: $birth_year,
							death_year: $death_year,
							traditions: $traditions,
							domains: $domains,
							imported_at: time::now()
						}`,
						{ ...thinkerData, id: recordId }
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
						await db.query(
							`RELATE $from->influenced_by->$to
							 SET relation_subtype = 'influenced_by',
							     imported_at = time::now()`,
							{ from: `thinker:${fromId}`, to: `thinker:${toId}` }
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
						await db.query(
							`RELATE $from->student_of->$to
							 SET relation_subtype = 'student_of',
							     imported_at = time::now()`,
							{ from: `thinker:${fromId}`, to: `thinker:${toId}` }
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

			const existingAuthoredEdges = await loadExistingAuthoredRelations(db);
			const unmatchedAuthors = new Set<string>();

			for (const source of sourceRows) {
				const authorList = Array.isArray(source.author)
					? source.author.filter((name): name is string => typeof name === 'string')
					: [];
				if (authorList.length === 0) continue;

				const sourceId = typeof source.id === 'string' ? source.id : '';
				if (!sourceId) continue;

				for (const author of authorList) {
					const normalizedAuthor = normalizeName(author);
					const exactCandidates = thinkerByNormalizedName.get(normalizedAuthor) ?? [];
					const candidates: Array<{ thinker: ThinkerNode; confidence: number }> = [];

					for (const thinker of exactCandidates) {
						candidates.push({ thinker, confidence: 1 });
					}

					if (candidates.length === 0) {
						for (const thinker of thinkers) {
							const confidence = estimateAuthorMatchConfidence(author, thinker.name);
							if (confidence > 0) {
								candidates.push({ thinker, confidence });
							}
						}
					}

					if (candidates.length === 0) {
						unmatchedAuthors.add(normalizedAuthor);
						continue;
					}

					candidates.sort((a, b) => b.confidence - a.confidence);
					const bestConfidence = candidates[0].confidence;
					const bestMatches = candidates.filter((candidate) => candidate.confidence === bestConfidence);

					for (const match of bestMatches) {
						const thinkerQid = match.thinker.wikidata_id;
						const edgeKeyValue = `${thinkerQid}::${sourceId}`;
						if (existingAuthoredEdges.has(edgeKeyValue)) {
							summary.authorLinksSkipped += 1;
							continue;
						}
						try {
							await db.query(
								`RELATE $from->authored->$to
								 SET match_type = 'name_match',
								     confidence = $confidence,
								     linked_at = time::now()`,
								{
									from: `thinker:${thinkerQid}`,
									to: sourceId,
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
