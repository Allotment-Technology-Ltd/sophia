import * as fs from 'fs';
import * as path from 'path';
import { startSpinner, startStageTimer } from './progress.js';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'thinker-graph');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'philosophers.json');
const PAGE_SIZE = 500;
const QUERY_DELAY_MS = 2_000;
const USER_AGENT =
	'SOPHIA-thinker-graph-extractor/1.0 (https://usesophia.app; contact@allotment.tech)';

const INFLUENCE_QUERY = `
SELECT ?philosopher ?philosopherLabel ?influence ?influenceLabel WHERE {
  ?philosopher wdt:P31 wd:Q5;
               wdt:P106 wd:Q4964182;
               wdt:P737 ?influence.
  ?influence   wdt:P31 wd:Q5;
               wdt:P106 wd:Q4964182.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`;

const STUDENT_TEACHER_QUERY = `
SELECT ?philosopher ?philosopherLabel ?teacher ?teacherLabel WHERE {
  ?philosopher wdt:P31 wd:Q5;
               wdt:P106 wd:Q4964182;
               wdt:P1066 ?teacher.
  ?teacher     wdt:P31 wd:Q5;
               wdt:P106 wd:Q4964182.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`;

const BIO_QUERY = `
SELECT ?philosopher ?philosopherLabel ?birth ?death ?movementLabel ?domainLabel WHERE {
  ?philosopher wdt:P31 wd:Q5;
               wdt:P106 wd:Q4964182.
  OPTIONAL { ?philosopher wdt:P569 ?birth. }
  OPTIONAL { ?philosopher wdt:P570 ?death. }
  OPTIONAL { ?philosopher wdt:P135 ?movement. }
  OPTIONAL { ?philosopher wdt:P101 ?domain. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`;

interface SparqlBindingCell {
	type: string;
	value: string;
}

interface SparqlResultRow {
	[key: string]: SparqlBindingCell | undefined;
}

interface SparqlJsonResult {
	results?: {
		bindings?: SparqlResultRow[];
	};
}

interface ThinkerNodeAggregate {
	wikidata_id: string;
	name: string;
	birth_year: number | null;
	death_year: number | null;
	traditions: Set<string>;
	domains: Set<string>;
	influenced_by: Set<string>;
	student_of: Set<string>;
	query_presence: Set<string>;
}

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

interface ThinkerGraphOutput {
	extracted_at: string;
	source: 'wikidata';
	count: number;
	thinkers: ThinkerNode[];
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDryRunFlag(): boolean {
	return process.argv.includes('--dry-run');
}

function extractQid(uriOrValue: string | undefined): string | null {
	if (!uriOrValue) return null;
	const match = uriOrValue.match(/Q\d+$/);
	return match?.[0] ?? null;
}

function parseYear(dateValue: string | undefined): number | null {
	if (!dateValue) return null;
	const match = dateValue.match(/^(-?\d{1,6})-/);
	if (!match) return null;
	const year = Number.parseInt(match[1], 10);
	return Number.isFinite(year) ? year : null;
}

function getCellValue(row: SparqlResultRow, key: string): string | null {
	return row[key]?.value ?? null;
}

function ensureNode(
	store: Map<string, ThinkerNodeAggregate>,
	wikidataId: string,
	name: string
): ThinkerNodeAggregate {
	const existing = store.get(wikidataId);
	if (existing) {
		if (!existing.name && name) {
			existing.name = name;
		}
		return existing;
	}
	const created: ThinkerNodeAggregate = {
		wikidata_id: wikidataId,
		name,
		birth_year: null,
		death_year: null,
		traditions: new Set<string>(),
		domains: new Set<string>(),
		influenced_by: new Set<string>(),
		student_of: new Set<string>(),
		query_presence: new Set<string>()
	};
	store.set(wikidataId, created);
	return created;
}

async function fetchSparqlPage(query: string, limit: number, offset: number): Promise<SparqlResultRow[]> {
	const params = new URLSearchParams();
	params.set('query', `${query}\nLIMIT ${limit}\nOFFSET ${offset}`);

	const response = await fetch(`${SPARQL_ENDPOINT}?${params.toString()}`, {
		method: 'GET',
		headers: {
			Accept: 'application/sparql-results+json',
			'User-Agent': USER_AGENT
		}
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`);
	}

	const payload = (await response.json()) as SparqlJsonResult;
	return payload.results?.bindings ?? [];
}

async function runPaginatedQuery(queryName: string, query: string): Promise<SparqlResultRow[]> {
	const stageTimer = startStageTimer();
	const spinner = startSpinner(`Fetching ${queryName} page 1`);
	const allRows: SparqlResultRow[] = [];
	let offset = 0;
	let page = 1;

	try {
		while (true) {
			spinner.update(`Fetching ${queryName} page ${page} (${allRows.length} rows)`);
			const rows = await fetchSparqlPage(query, PAGE_SIZE, offset);
			allRows.push(...rows);
			if (rows.length < PAGE_SIZE) break;
			offset += PAGE_SIZE;
			page += 1;
		}
		spinner.stop(`✓ ${queryName}: ${allRows.length} rows in ${stageTimer.end()}`);
		return allRows;
	} catch (error) {
		spinner.stop(`✗ ${queryName} failed after ${stageTimer.end()}`);
		throw error;
	}
}

function finalizeNodes(store: Map<string, ThinkerNodeAggregate>): ThinkerNode[] {
	const thinkers: ThinkerNode[] = [];
	const setToSortedArray = (input: Set<string>): string[] => {
		const values: string[] = [];
		input.forEach((value) => values.push(value));
		values.sort((a, b) => a.localeCompare(b));
		return values;
	};

	store.forEach((node) => {
		const edgeCount = node.influenced_by.size + node.student_of.size;
		const appearsInMultipleQueries = node.query_presence.size > 1;
		if (edgeCount === 0 && !appearsInMultipleQueries) {
			return;
		}

		thinkers.push({
			wikidata_id: node.wikidata_id,
			name: node.name || node.wikidata_id,
			birth_year: node.birth_year,
			death_year: node.death_year,
			traditions: setToSortedArray(node.traditions),
			domains: setToSortedArray(node.domains),
			influenced_by: setToSortedArray(node.influenced_by),
			student_of: setToSortedArray(node.student_of)
		});
	});

	thinkers.sort((a, b) => a.name.localeCompare(b.name));
	return thinkers;
}

async function main(): Promise<void> {
	const dryRun = isDryRunFlag();
	const nodes = new Map<string, ThinkerNodeAggregate>();
	const queryErrors: string[] = [];

	let influenceEdgeCount = 0;
	let studentEdgeCount = 0;

	console.log('\n[THINKER-GRAPH] Starting Wikidata extraction...');
	console.log(`[THINKER-GRAPH] Endpoint: ${SPARQL_ENDPOINT}`);
	console.log(`[THINKER-GRAPH] Mode: ${dryRun ? 'dry-run (no file write)' : 'write output file'}`);

	let influenceRows: SparqlResultRow[] = [];
	let studentRows: SparqlResultRow[] = [];
	let bioRows: SparqlResultRow[] = [];

	try {
		influenceRows = await runPaginatedQuery('influence edges', INFLUENCE_QUERY);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		queryErrors.push(`influence edges: ${message}`);
	}

	await sleep(QUERY_DELAY_MS);

	try {
		studentRows = await runPaginatedQuery('student/teacher edges', STUDENT_TEACHER_QUERY);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		queryErrors.push(`student/teacher edges: ${message}`);
	}

	await sleep(QUERY_DELAY_MS);

	try {
		bioRows = await runPaginatedQuery('biographical metadata', BIO_QUERY);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		queryErrors.push(`biographical metadata: ${message}`);
	}

	for (const row of influenceRows) {
		const philosopherId = extractQid(getCellValue(row, 'philosopher') ?? undefined);
		const influenceId = extractQid(getCellValue(row, 'influence') ?? undefined);
		if (!philosopherId || !influenceId) continue;

		const philosopherName = getCellValue(row, 'philosopherLabel') ?? philosopherId;
		const influenceName = getCellValue(row, 'influenceLabel') ?? influenceId;

		const philosopherNode = ensureNode(nodes, philosopherId, philosopherName);
		const influenceNode = ensureNode(nodes, influenceId, influenceName);
		philosopherNode.query_presence.add('influence');
		influenceNode.query_presence.add('influence');
		philosopherNode.influenced_by.add(influenceId);
		influenceEdgeCount += 1;
	}

	for (const row of studentRows) {
		const philosopherId = extractQid(getCellValue(row, 'philosopher') ?? undefined);
		const teacherId = extractQid(getCellValue(row, 'teacher') ?? undefined);
		if (!philosopherId || !teacherId) continue;

		const philosopherName = getCellValue(row, 'philosopherLabel') ?? philosopherId;
		const teacherName = getCellValue(row, 'teacherLabel') ?? teacherId;

		const philosopherNode = ensureNode(nodes, philosopherId, philosopherName);
		const teacherNode = ensureNode(nodes, teacherId, teacherName);
		philosopherNode.query_presence.add('student');
		teacherNode.query_presence.add('student');
		philosopherNode.student_of.add(teacherId);
		studentEdgeCount += 1;
	}

	for (const row of bioRows) {
		const philosopherId = extractQid(getCellValue(row, 'philosopher') ?? undefined);
		if (!philosopherId) continue;

		const philosopherName = getCellValue(row, 'philosopherLabel') ?? philosopherId;
		const node = ensureNode(nodes, philosopherId, philosopherName);
		node.query_presence.add('bio');

		const birthYear = parseYear(getCellValue(row, 'birth') ?? undefined);
		const deathYear = parseYear(getCellValue(row, 'death') ?? undefined);

		if (birthYear !== null && node.birth_year === null) {
			node.birth_year = birthYear;
		}
		if (deathYear !== null && node.death_year === null) {
			node.death_year = deathYear;
		}

		const movementLabel = getCellValue(row, 'movementLabel');
		if (movementLabel) node.traditions.add(movementLabel.trim());

		const domainLabel = getCellValue(row, 'domainLabel');
		if (domainLabel) node.domains.add(domainLabel.trim());
	}

	const thinkers = finalizeNodes(nodes);
	const payload: ThinkerGraphOutput = {
		extracted_at: new Date().toISOString(),
		source: 'wikidata',
		count: thinkers.length,
		thinkers
	};

	if (dryRun) {
		console.log('\n[THINKER-GRAPH] Dry-run preview (first 5):');
		console.log(JSON.stringify(thinkers.slice(0, 5), null, 2));
	} else {
		fs.mkdirSync(OUTPUT_DIR, { recursive: true });
		fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2));
		console.log(`\n[THINKER-GRAPH] Wrote ${OUTPUT_FILE}`);
	}

	console.log('\n[THINKER-GRAPH] Summary');
	console.log(`  Thinkers: ${thinkers.length}`);
	console.log(`  Influence edges: ${influenceEdgeCount}`);
	console.log(`  Student_of edges: ${studentEdgeCount}`);

	if (queryErrors.length > 0) {
		console.log('  Query errors:');
		for (const error of queryErrors) {
			console.log(`   - ${error}`);
		}
	} else {
		console.log('  Query errors: none');
	}
}

main().catch((error) => {
	console.error('[THINKER-GRAPH] Fatal error:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});
