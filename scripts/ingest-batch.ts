/**
 * SOPHIA — Batch Ingestion Script
 *
 * Ingest multiple sources from the curated source list.
 *
 * Usage: npx tsx --env-file=.env scripts/ingest-batch.ts [--wave 1|2|3] [--validate] [--dry-run]
 *
 * Flags:
 *   --wave N      Only ingest sources from wave N (1, 2, or 3)
 *   --validate    Run Gemini cross-validation on all sources
 *   --dry-run     Show what would be ingested without actually doing it
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Surreal } from 'surrealdb';

// ─── Configuration ─────────────────────────────────────────────────────────
const SOURCE_LIST_PATH = './data/source-list-3a.json';
const SOURCES_DIR = './data/sources';
const INGESTED_DIR = './data/ingested';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

// ─── Types ─────────────────────────────────────────────────────────────────
interface SourceEntry {
	id: number;
	title: string;
	author: string[];
	year: number | null;
	url: string;
	source_type: string;
	priority: string;
	subdomain: string;
	wave: number;
}

interface IngestionResult {
	id: number;
	title: string;
	status: 'success' | 'skipped' | 'failed';
	reason?: string;
	claims?: number;
	relations?: number;
	arguments?: number;
	cost_gbp?: number;
}

interface BatchSummary {
	timestamp: string;
	wave_filter: number | null;
	validation_enabled: boolean;
	total_sources: number;
	successfully_ingested: number;
	skipped: number;
	failed: number;
	total_claims: number;
	total_relations: number;
	total_arguments: number;
	total_cost_gbp: number;
	results: IngestionResult[];
}

// ─── Helper Functions ──────────────────────────────────────────────────────

/**
 * Create a URL-safe slug from title
 */
function createSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.substring(0, 50);
}

/**
 * Check if a source has been fetched
 */
function isSourceFetched(slug: string): boolean {
	const txtPath = path.join(SOURCES_DIR, `${slug}.txt`);
	const metaPath = path.join(SOURCES_DIR, `${slug}.meta.json`);
	return fs.existsSync(txtPath) && fs.existsSync(metaPath);
}

/**
 * Check if a source has already been ingested (by URL)
 */
async function isSourceIngested(db: Surreal, url: string): Promise<boolean> {
	try {
		const result = await db.query<[{ id: string }[]]>(
			'SELECT id FROM source WHERE url = $url LIMIT 1',
			{ url }
		);
		const rows = Array.isArray(result) && result.length > 0 ? result[0] : [];
		return Array.isArray(rows) && rows.length > 0;
	} catch (error) {
		console.warn(
			`[WARN] Failed to check if source is ingested: ${error instanceof Error ? error.message : error}`
		);
		return false;
	}
}

/**
 * Fetch a source using fetch-source.ts script
 */
function fetchSource(url: string, sourceType: string): boolean {
	console.log(`  [FETCH] Running fetch-source.ts...`);
	const result = spawnSync(
		'npx',
		['tsx', '--env-file=.env', 'scripts/fetch-source.ts', url, sourceType],
		{
			stdio: 'inherit',
			cwd: process.cwd()
		}
	);

	if (result.error) {
		console.error(`  [ERROR] Failed to spawn fetch process: ${result.error.message}`);
		return false;
	}

	return result.status === 0;
}

/**
 * Ingest a source using ingest.ts script
 * Returns { success, claims, relations, arguments, cost_gbp }
 */
function ingestSource(
	slug: string,
	validate: boolean
): { success: boolean; claims?: number; relations?: number; arguments?: number; cost_gbp?: number } {
	const txtPath = path.join(SOURCES_DIR, `${slug}.txt`);

	console.log(`  [INGEST] Running ingest.ts...`);

	const args = ['tsx', '--env-file=.env', 'scripts/ingest.ts', txtPath];
	if (validate) {
		args.push('--validate');
	}

	const result = spawnSync('npx', args, {
		stdio: 'pipe',
		cwd: process.cwd(),
		encoding: 'utf-8'
	});

	if (result.error) {
		console.error(`  [ERROR] Failed to spawn ingest process: ${result.error.message}`);
		return { success: false };
	}

	// Parse output for metrics
	const output = result.stdout || '';
	const stderrOutput = result.stderr || '';
	console.log(output);
	if (stderrOutput) {
		console.error(stderrOutput);
	}

	if (result.status !== 0) {
		return { success: false };
	}

	// Extract metrics from output using regex
	let claims: number | undefined;
	let relations: number | undefined;
	let arguments_: number | undefined;
	let cost_gbp: number | undefined;

	const claimsMatch = output.match(/Claims:\s+(\d+)/);
	if (claimsMatch) claims = parseInt(claimsMatch[1], 10);

	const relationsMatch = output.match(/Relations:\s+(\d+)/);
	if (relationsMatch) relations = parseInt(relationsMatch[1], 10);

	const argumentsMatch = output.match(/Arguments:\s+(\d+)/);
	if (argumentsMatch) arguments_ = parseInt(argumentsMatch[1], 10);

	const costMatch = output.match(/Estimated cost:\s+£([\d.]+)/);
	if (costMatch) cost_gbp = parseFloat(costMatch[1]);

	return {
		success: true,
		claims,
		relations,
		arguments: arguments_,
		cost_gbp
	};
}

/**
 * Wait for N seconds
 */
function sleep(seconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// ─── Main Function ─────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);

	// Parse flags
	let waveFilter: number | null = null;
	let validate = false;
	let dryRun = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--wave' && i + 1 < args.length) {
			waveFilter = parseInt(args[i + 1], 10);
			i++;
		} else if (args[i] === '--validate') {
			validate = true;
		} else if (args[i] === '--dry-run') {
			dryRun = true;
		}
	}

	// Load source list
	if (!fs.existsSync(SOURCE_LIST_PATH)) {
		console.error(`[ERROR] Source list not found: ${SOURCE_LIST_PATH}`);
		process.exit(1);
	}

	const sourceList: SourceEntry[] = JSON.parse(fs.readFileSync(SOURCE_LIST_PATH, 'utf-8'));
	let sources = sourceList;

	// Filter by wave
	if (waveFilter !== null) {
		sources = sources.filter((s) => s.wave === waveFilter);
		console.log(`[FILTER] Selected wave ${waveFilter}: ${sources.length} sources`);
	}

	if (sources.length === 0) {
		console.log('[INFO] No sources to ingest');
		process.exit(0);
	}

	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║           SOPHIA — BATCH INGESTION                          ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log('');
	console.log(`Sources to process: ${sources.length}`);
	console.log(`Wave filter: ${waveFilter !== null ? waveFilter : 'None (all waves)'}`);
	console.log(`Validation: ${validate ? 'ENABLED' : 'Disabled'}`);
	console.log(`Mode: ${dryRun ? 'DRY RUN (no actual changes)' : 'LIVE'}`);
	console.log('');

	if (dryRun) {
		console.log('DRY RUN — Sources that would be processed:\n');
		for (const source of sources) {
			const slug = createSlug(source.title);
			const fetched = isSourceFetched(slug);
			console.log(
				`[${source.id}] ${source.title} (${source.source_type}, wave ${source.wave})`
			);
			console.log(`    Fetched: ${fetched ? 'YES' : 'NO (would fetch)'}`);
		}
		console.log('\nDry run complete. Use without --dry-run to actually ingest.');
		process.exit(0);
	}

	// Connect to SurrealDB
	const db = new Surreal();
	try {
		await db.connect(SURREAL_URL);
		await db.signin({ 
			username: SURREAL_USER, 
			password: SURREAL_PASS 
		} as any);
		await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
		console.log('[DB] Connected to SurrealDB\n');
	} catch (error) {
		console.error(
			`[ERROR] Failed to connect to SurrealDB: ${error instanceof Error ? error.message : error}`
		);
		process.exit(1);
	}

	// Create ingested directory
	if (!fs.existsSync(INGESTED_DIR)) {
		fs.mkdirSync(INGESTED_DIR, { recursive: true });
	}

	// Process each source
	const results: IngestionResult[] = [];
	let successCount = 0;
	let skippedCount = 0;
	let failedCount = 0;
	let totalClaims = 0;
	let totalRelations = 0;
	let totalArguments = 0;
	let totalCost = 0;

	for (let i = 0; i < sources.length; i++) {
		const source = sources[i];
		const slug = createSlug(source.title);

		console.log('─'.repeat(64));
		console.log(
			`[${i + 1}/${sources.length}] Ingesting: ${source.title}`
		);
		console.log(`    ID: ${source.id}`);
		console.log(`    URL: ${source.url}`);
		console.log(`    Type: ${source.source_type}, Wave: ${source.wave}`);
		console.log('');

		try {
			// Check if already ingested
			const alreadyIngested = await isSourceIngested(db, source.url);
			if (alreadyIngested) {
				console.log('  [SKIP] Source already ingested (URL found in database)');
				results.push({
					id: source.id,
					title: source.title,
					status: 'skipped',
					reason: 'Already ingested'
				});
				skippedCount++;
				console.log('');
				continue;
			}

			// Check if fetched
			const fetched = isSourceFetched(slug);
			if (!fetched) {
				console.log('  [INFO] Source not yet fetched locally');
				const fetchSuccess = fetchSource(source.url, source.source_type);
				if (!fetchSuccess) {
					console.error('  [FAILED] Fetch failed');
					results.push({
						id: source.id,
						title: source.title,
						status: 'failed',
						reason: 'Fetch failed'
					});
					failedCount++;
					console.log('');
					continue;
				}
			} else {
				console.log('  [INFO] Source already fetched');
			}

			// Ingest the source
			const ingestResult = ingestSource(slug, validate);

			if (!ingestResult.success) {
				console.error('  [FAILED] Ingestion failed');
				results.push({
					id: source.id,
					title: source.title,
					status: 'failed',
					reason: 'Ingestion pipeline error'
				});
				failedCount++;
			} else {
				console.log('  [SUCCESS] Ingestion complete');
				results.push({
					id: source.id,
					title: source.title,
					status: 'success',
					claims: ingestResult.claims,
					relations: ingestResult.relations,
					arguments: ingestResult.arguments,
					cost_gbp: ingestResult.cost_gbp
				});
				successCount++;

				// Update totals
				if (ingestResult.claims) totalClaims += ingestResult.claims;
				if (ingestResult.relations) totalRelations += ingestResult.relations;
				if (ingestResult.arguments) totalArguments += ingestResult.arguments;
				if (ingestResult.cost_gbp) totalCost += ingestResult.cost_gbp;
			}

			console.log('');

			// Rate limiting: wait 2 seconds between sources
			if (i < sources.length - 1) {
				console.log('  [WAIT] 2 seconds before next source...\n');
				await sleep(2);
			}
		} catch (error) {
			console.error(
				`  [ERROR] Unexpected error: ${error instanceof Error ? error.message : error}`
			);
			results.push({
				id: source.id,
				title: source.title,
				status: 'failed',
				reason: error instanceof Error ? error.message : String(error)
			});
			failedCount++;
			console.log('');
		}
	}

	// Close database
	await db.close();

	// Print summary
	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║                   BATCH INGESTION COMPLETE                  ║');
	console.log('╠══════════════════════════════════════════════════════════════╣');
	console.log(`║  Total sources:        ${String(sources.length).padEnd(35)} ║`);
	console.log(`║  Successfully ingested: ${String(successCount).padEnd(34)} ║`);
	console.log(`║  Skipped:              ${String(skippedCount).padEnd(35)} ║`);
	console.log(`║  Failed:               ${String(failedCount).padEnd(35)} ║`);
	console.log('╠══════════════════════════════════════════════════════════════╣');
	console.log(`║  Total claims:         ${String(totalClaims).padEnd(35)} ║`);
	console.log(`║  Total relations:      ${String(totalRelations).padEnd(35)} ║`);
	console.log(`║  Total arguments:      ${String(totalArguments).padEnd(35)} ║`);
	console.log(`║  Total cost:           £${String(totalCost.toFixed(4)).padEnd(34)} ║`);
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log('');

	// List failed sources if any
	if (failedCount > 0) {
		console.log('FAILED SOURCES:');
		for (const result of results) {
			if (result.status === 'failed') {
				console.log(`  [${result.id}] ${result.title}`);
				if (result.reason) {
					console.log(`      Reason: ${result.reason}`);
				}
			}
		}
		console.log('');
	}

	// Save summary
	const summary: BatchSummary = {
		timestamp: new Date().toISOString(),
		wave_filter: waveFilter,
		validation_enabled: validate,
		total_sources: sources.length,
		successfully_ingested: successCount,
		skipped: skippedCount,
		failed: failedCount,
		total_claims: totalClaims,
		total_relations: totalRelations,
		total_arguments: totalArguments,
		total_cost_gbp: totalCost,
		results
	};

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
	const summaryPath = path.join(INGESTED_DIR, `batch-summary-${timestamp}.json`);
	fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
	console.log(`[SAVE] Summary saved to: ${summaryPath}`);
	console.log('');

	process.exit(failedCount > 0 ? 1 : 0);
}

main();
