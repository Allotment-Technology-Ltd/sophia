/**
 * SOPHIA — Batch Ingestion Script
 *
 * Ingest multiple sources from the curated source list.
 *
 * Usage: npx tsx --env-file=.env scripts/ingest-batch.ts [--wave 1|2|3] [--validate] [--dry-run] [--status] [--retry] [--fast] [--fail-fast] [--domain <domain>] [--source-list <path>] [--yes]
 *
 * Flags:
 *   --wave N                Only ingest sources from wave N (1, 2, or 3)
 *   --validate              Run Gemini cross-validation on all sources
 *   --dry-run               Show what would be ingested without actually doing it
 *   --status                Print current ingestion progress and exit (no ingestion)
 *   --retry                 Retry sources that previously failed
 *   --fast                  Fast extraction mode (no validation, detailed error logging)
 *   --fail-fast             Stop launching new sources after first failure
 *   --domain <domain>       Override claim domain tag for all sources (e.g. philosophy_of_mind)
 *   --source-list <path>    Path to source list JSON (default: ./data/source-list-3a.json)
 *   --yes                   Skip cost confirmation prompt (for CI / automated runs)
 *
 * Pipeline mode (default):
 *   Phase A (stages 1-4, Claude + Voyage) runs in parallel — up to PHASE_A_CONCURRENCY.
 *   Phase B (stage 5 Gemini + stage 6 Store) runs async — up to GEMINI_CONCURRENCY in parallel.
 *   When each Phase A finishes, Phase B starts in the background.
 *   Set PHASE_A_CONCURRENCY env var to control parallel extraction workers (default: 4).
 *   Set GEMINI_CONCURRENCY env var to control parallel Gemini processes (default: 2).
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { Surreal } from 'surrealdb';
import { runPreScan } from './pre-scan.js';

// ─── Configuration ─────────────────────────────────────────────────────────
const DEFAULT_SOURCE_LIST_PATH = './data/source-list-3a.json';
const SOURCES_DIR = './data/sources';
const INGESTED_DIR = './data/ingested';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';
const GEMINI_CONCURRENCY = parseInt(process.env.GEMINI_CONCURRENCY || '2', 10);
const PHASE_A_CONCURRENCY = parseInt(process.env.PHASE_A_CONCURRENCY || '4', 10);

// Pass --env-file args to child tsx processes so they inherit the same env.
// Supports split env files (e.g. .env for infra, .env.local for API keys).
// On Cloud Run, env vars are injected by the platform so no file is needed.
const _envFileArgs: string[] = [];
if (fs.existsSync('.env')) _envFileArgs.push('--env-file=.env');
if (fs.existsSync('.env.local')) _envFileArgs.push('--env-file=.env.local');
const TSX_ENV_ARGS: string[] = ['tsx', ..._envFileArgs];

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

interface IngestionLogRecord {
	source_url: string;
	source_title: string;
	status: string;
	stage_completed?: string;
	claims_extracted?: number;
	relations_extracted?: number;
	arguments_grouped?: number;
	validation_score?: number;
	error_message?: string;
	cost_usd?: number;
}

// ─── Semaphore for concurrency control ────────────────────────────────────
class Semaphore {
	private count: number;
	private queue: Array<() => void> = [];

	constructor(n: number) {
		this.count = n;
	}

	acquire(): Promise<void> {
		return new Promise((resolve) => {
			if (this.count > 0) {
				this.count--;
				resolve();
			} else {
				this.queue.push(resolve);
			}
		});
	}

	release(): void {
		if (this.queue.length > 0) {
			this.queue.shift()!();
		} else {
			this.count++;
		}
	}
}

// ─── Helper Functions ──────────────────────────────────────────────────────

function createSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.substring(0, 50);
}

function isSourceFetched(slug: string): boolean {
	const txtPath = path.join(SOURCES_DIR, `${slug}.txt`);
	const metaPath = path.join(SOURCES_DIR, `${slug}.meta.json`);
	return fs.existsSync(txtPath) && fs.existsSync(metaPath);
}

/**
 * Find the slug actually saved by fetch-source.ts by matching URL in meta.json files.
 */
function findFetchedSlug(url: string): string | null {
	try {
		const files = fs.readdirSync(SOURCES_DIR);
		for (const file of files) {
			if (!file.endsWith('.meta.json')) continue;
			const metaPath = path.join(SOURCES_DIR, file);
			try {
				const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { url?: string };
				if (meta.url === url) return file.replace('.meta.json', '');
			} catch {
				// skip unreadable meta files
			}
		}
	} catch {
		// directory read failed
	}
	return null;
}

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
 * Fetch a source using fetch-source.ts (synchronous — fast network call)
 */
function fetchSource(url: string, sourceType: string): boolean {
	console.log(`  [FETCH] Running fetch-source.ts...`);
	const result = spawnSync(
		'npx',
		[...TSX_ENV_ARGS, 'scripts/fetch-source.ts', url, sourceType],
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
 * Async subprocess runner — captures stdout/stderr, resolves when process exits.
 */
function spawnAsync(
	args: string[],
	label: string
): Promise<{ status: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		const proc = spawn('npx', args, { stdio: 'pipe', cwd: process.cwd() });

		proc.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d));
		proc.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));

		proc.on('close', (code) => {
			resolve({
				status: code ?? 1,
				stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
				stderr: Buffer.concat(stderrChunks).toString('utf-8')
			});
		});

		proc.on('error', (err) => {
			resolve({ status: 1, stdout: '', stderr: err.message });
		});
	});
}

/**
 * Run ingest.ts Phase A: stages 1-4 (Claude extraction + Voyage embedding).
 * Exits after embedding via --stop-after-embedding flag.
 * Enhanced with detailed error detection for fast-mode diagnostics.
 */
async function runPhaseA(slug: string, validate: boolean, label: string, fastMode = false, domain: string | null = null): Promise<boolean> {
	const txtPath = path.join(SOURCES_DIR, `${slug}.txt`);
	const args = [
		...TSX_ENV_ARGS,
		'scripts/ingest.ts',
		txtPath,
		'--stop-after-embedding'
	];
	if (validate) args.push('--validate');
	if (domain) { args.push('--domain'); args.push(domain); }

	console.log(`  [PHASE A] Running stages 1-4 (Claude+Voyage): ${label}`);
	const phaseStart = Date.now();
	const result = await spawnAsync(args, slug);

	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);

	const phaseTime = Math.round((Date.now() - phaseStart) / 1000);

	if (result.status !== 0) {
		// Enhanced error detection in fast mode
		if (fastMode) {
			const errorLines = result.stderr.split('\n').filter(l => l.includes('[ERROR]') || l.includes('Error') || l.includes('FAILED'));
			if (errorLines.length > 0) {
				console.error(`  [PHASE A ERROR] Last error lines:`);
				errorLines.slice(-3).forEach(line => console.error(`    ${line}`));
			}
			console.error(`  ⚠️  Phase A failed after ${phaseTime}s — investigate above error before proceeding`);
		}
		return false;
	}

	if (fastMode) {
		console.log(`  ✓ Phase A complete in ${phaseTime}s`);
	}

	return true;
}

/**
 * Run ingest.ts Phase B: stage 5 (Gemini validation) + stage 6 (Store).
 * Resumes from wherever Phase A left off (stage_completed: 'embedding').
 */
async function runPhaseB(
	slug: string,
	validate: boolean,
	label: string,
	domain: string | null = null
): Promise<{ success: boolean; claims?: number; relations?: number; arguments?: number; cost_gbp?: number }> {
	const txtPath = path.join(SOURCES_DIR, `${slug}.txt`);
	const args = [...TSX_ENV_ARGS, 'scripts/ingest.ts', txtPath];
	if (validate) args.push('--validate');
	if (domain) { args.push('--domain'); args.push(domain); }

	console.log(`  [PHASE B] Running stages 5-6 (Gemini+Store): ${label}`);
	const result = await spawnAsync(args, slug);

	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);

	if (result.status !== 0) return { success: false };

	const claimsMatch = result.stdout.match(/Claims:\s+(\d+)/);
	const relationsMatch = result.stdout.match(/Relations:\s+(\d+)/);
	const argumentsMatch = result.stdout.match(/Arguments:\s+(\d+)/);
	const costMatch = result.stdout.match(/Estimated cost:\s+£([\d.]+)/);

	return {
		success: true,
		claims: claimsMatch ? parseInt(claimsMatch[1], 10) : undefined,
		relations: relationsMatch ? parseInt(relationsMatch[1], 10) : undefined,
		arguments: argumentsMatch ? parseInt(argumentsMatch[1], 10) : undefined,
		cost_gbp: costMatch ? parseFloat(costMatch[1]) : undefined
	};
}

/**
 * Run the full ingest pipeline in one pass (no phase split).
 * Used as fallback when Phase A/B split is not needed (e.g. --validate not set and source is small).
 */
async function ingestSourceFull(
	slug: string,
	validate: boolean,
	domain: string | null = null
): Promise<{ success: boolean; claims?: number; relations?: number; arguments?: number; cost_gbp?: number }> {
	const txtPath = path.join(SOURCES_DIR, `${slug}.txt`);
	const args = [...TSX_ENV_ARGS, 'scripts/ingest.ts', txtPath];
	if (validate) args.push('--validate');
	if (domain) { args.push('--domain'); args.push(domain); }

	const result = await spawnAsync(args, slug);
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);

	if (result.status !== 0) return { success: false };

	const claimsMatch = result.stdout.match(/Claims:\s+(\d+)/);
	const relationsMatch = result.stdout.match(/Relations:\s+(\d+)/);
	const argumentsMatch = result.stdout.match(/Arguments:\s+(\d+)/);
	const costMatch = result.stdout.match(/Estimated cost:\s+£([\d.]+)/);

	return {
		success: true,
		claims: claimsMatch ? parseInt(claimsMatch[1], 10) : undefined,
		relations: relationsMatch ? parseInt(relationsMatch[1], 10) : undefined,
		arguments: argumentsMatch ? parseInt(argumentsMatch[1], 10) : undefined,
		cost_gbp: costMatch ? parseFloat(costMatch[1]) : undefined
	};
}

async function getIngestionLogMap(db: Surreal): Promise<Map<string, IngestionLogRecord>> {
	try {
		const result = await db.query<IngestionLogRecord[][]>('SELECT * FROM ingestion_log');
		const rows = Array.isArray(result?.[0]) ? result[0] : [];
		const map = new Map<string, IngestionLogRecord>();
		for (const row of rows) {
			map.set(row.source_url, row);
		}
		return map;
	} catch {
		return new Map();
	}
}

function printProgress(sources: SourceEntry[], logMap: Map<string, IngestionLogRecord>): void {
	let complete = 0;
	let failed = 0;
	let inProgress = 0;
	let remaining = 0;

	for (const source of sources) {
		const log = logMap.get(source.url);
		if (!log) {
			remaining++;
		} else if (log.status === 'complete') {
			complete++;
		} else if (log.status === 'failed') {
			failed++;
		} else {
			inProgress++;
		}
	}

	console.log(
		`[PROGRESS] ${complete}/${sources.length} sources complete, ${failed} failed, ${inProgress} in-progress, ${remaining} remaining`
	);
}

function printStatusTable(sources: SourceEntry[], logMap: Map<string, IngestionLogRecord>): void {
	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║           SOPHIA — INGESTION STATUS                         ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log('');

	const statusGroups = {
		complete: [] as string[],
		failed: [] as string[],
		'in-progress': [] as string[],
		remaining: [] as string[]
	};

	for (const source of sources) {
		const log = logMap.get(source.url);
		const label = `[${source.id}] ${source.title} (wave ${source.wave})`;
		if (!log) {
			statusGroups.remaining.push(label);
		} else if (log.status === 'complete') {
			const claims = log.claims_extracted ?? '?';
			const cost = log.cost_usd != null ? `$${log.cost_usd.toFixed(4)}` : '';
			statusGroups.complete.push(`${label} — ${claims} claims ${cost}`);
		} else if (log.status === 'failed') {
			const err = log.error_message ? `: ${log.error_message.substring(0, 60)}` : '';
			statusGroups.failed.push(
				`${label} — FAILED at ${log.stage_completed ?? 'start'}${err}`
			);
		} else {
			statusGroups['in-progress'].push(
				`${label} — ${log.status} (last: ${log.stage_completed ?? 'none'})`
			);
		}
	}

	if (statusGroups.complete.length > 0) {
		console.log(`COMPLETE (${statusGroups.complete.length}):`);
		for (const s of statusGroups.complete) console.log(`  ✓ ${s}`);
		console.log('');
	}

	if (statusGroups.failed.length > 0) {
		console.log(`FAILED (${statusGroups.failed.length}):`);
		for (const s of statusGroups.failed) console.log(`  ✗ ${s}`);
		console.log('');
	}

	if (statusGroups['in-progress'].length > 0) {
		console.log(`IN PROGRESS (${statusGroups['in-progress'].length}):`);
		for (const s of statusGroups['in-progress']) console.log(`  → ${s}`);
		console.log('');
	}

	if (statusGroups.remaining.length > 0) {
		console.log(`REMAINING (${statusGroups.remaining.length}):`);
		for (const s of statusGroups.remaining) console.log(`  · ${s}`);
		console.log('');
	}

	const totalCost = Array.from(logMap.values())
		.filter((l) => l.cost_usd != null)
		.reduce((sum, l) => sum + (l.cost_usd ?? 0), 0);

	const totalClaims = Array.from(logMap.values())
		.filter((l) => l.claims_extracted != null)
		.reduce((sum, l) => sum + (l.claims_extracted ?? 0), 0);

	console.log('─'.repeat(64));
	console.log(`Total claims extracted: ${totalClaims}`);
	console.log(`Total cost: $${totalCost.toFixed(4)}`);
}

function sleep(seconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function logBatchFailure(
	source: SourceEntry,
	phase: string,
	reason: string,
	extra?: Record<string, unknown>
): void {
	console.error(
		`[BATCH_ERROR] ${JSON.stringify({
			timestamp: new Date().toISOString(),
			source_id: source.id,
			source_title: source.title,
			phase,
			reason,
			...extra
		})}`
	);
}

// ─── Main Function ─────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);

	let waveFilter: number | null = null;
	let validate = false;
	let dryRun = false;
	let statusOnly = false;
	let retryFailed = false;
	let fastMode = false;
	let failFast = false;
	let domainOverride: string | null = null;
	let sourceListPath = DEFAULT_SOURCE_LIST_PATH;
	let skipConfirm = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--wave' && i + 1 < args.length) {
			waveFilter = parseInt(args[i + 1], 10);
			i++;
		} else if (args[i] === '--validate') {
			validate = true;
		} else if (args[i] === '--dry-run') {
			dryRun = true;
		} else if (args[i] === '--status') {
			statusOnly = true;
		} else if (args[i] === '--retry') {
			retryFailed = true;
		} else if (args[i] === '--fast') {
			fastMode = true;
			validate = false; // Fast mode disables validation
		} else if (args[i] === '--fail-fast') {
			failFast = true;
		} else if (args[i] === '--domain' && i + 1 < args.length) {
			domainOverride = args[++i];
		} else if (args[i] === '--source-list' && i + 1 < args.length) {
			sourceListPath = args[++i];
		} else if (args[i] === '--yes') {
			skipConfirm = true;
		}
	}

	if (!fs.existsSync(sourceListPath)) {
		console.error(`[ERROR] Source list not found: ${sourceListPath}`);
		process.exit(1);
	}

	const sourceList: SourceEntry[] = JSON.parse(fs.readFileSync(sourceListPath, 'utf-8'));
	let sources = sourceList;

	if (waveFilter !== null) {
		sources = sources.filter((s) => s.wave === waveFilter);
		console.log(`[FILTER] Selected wave ${waveFilter}: ${sources.length} sources`);
	}

	// ─── PDF guard ──────────────────────────────────────────────────────────
	// Skip any source whose URL is a raw PDF — we can't extract text from them.
	const pdfSources = sources.filter((s) => s.url.toLowerCase().endsWith('.pdf'));
	if (pdfSources.length > 0) {
		for (const s of pdfSources) {
			console.warn(`[SKIP] Source #${s.id} "${s.title}" has a PDF URL — skipping (replace with an HTML URL to ingest): ${s.url}`);
		}
		sources = sources.filter((s) => !s.url.toLowerCase().endsWith('.pdf'));
	}

	// ─── Custom skip list ────────────────────────────────────────────────────
	// Environment variable to skip specific sources: SKIP_SOURCE_IDS=5,6,9
	const skipListStr = process.env.SKIP_SOURCE_IDS || '';
	const skipList = skipListStr
		.split(',')
		.map((id) => parseInt(id.trim(), 10))
		.filter((id) => !isNaN(id));
	
	if (skipList.length > 0) {
		const skippedBefore = sources.length;
		sources = sources.filter((s) => !skipList.includes(s.id));
		const skippedCount = skippedBefore - sources.length;
		console.warn(`[SKIP] Skipping ${skippedCount} source(s) from SKIP_SOURCE_IDS: ${skipList.join(', ')}`);
	}

	if (sources.length === 0) {
		console.log('[INFO] No sources to ingest');
		process.exit(0);
	}

	// ─── Pre-scan phase (mandatory) ─────────────────────────────────────────
	// Always runs before any API calls to catch URL/token/PDF/cost issues early.
	if (!statusOnly && !dryRun) {
		console.log('[PRE-SCAN] Scanning all targets for issues before ingestion...\n');
		const { results: scanResults, hasBlockers } = await runPreScan(sources, waveFilter);
		if (hasBlockers) {
			console.error('[PRE-SCAN] Blockers found — fix the issues above before running ingestion.');
			process.exit(1);
		}
		// Cost confirmation
		const totalCost = scanResults.reduce((sum, r) => sum + (r.costEstimate?.totalCostUsd ?? 0), 0);
		if (totalCost > 0 && !skipConfirm) {
			console.log(`\n[PRE-SCAN] Estimated total wave cost: $${totalCost.toFixed(2)}`);
			console.log('[PRE-SCAN] Proceed? Press Enter to continue or Ctrl+C to abort.');
			await new Promise<void>((resolve) => {
				process.stdin.once('data', () => resolve());
			});
		}
		console.log('[PRE-SCAN] No blockers found. Proceeding with ingestion...\n');
	}

	const db = new Surreal();
	try {
		await db.connect(SURREAL_URL);
		await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
		await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
		console.log('[DB] Connected to SurrealDB');
	} catch (error) {
		console.error(
			`[ERROR] Failed to connect to SurrealDB: ${error instanceof Error ? error.message : error}`
		);
		process.exit(1);
	}

	const logMap = await getIngestionLogMap(db);

	if (statusOnly) {
		printStatusTable(sources, logMap);
		await db.close();
		process.exit(0);
	}

	console.log('');
	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║           SOPHIA — BATCH INGESTION                          ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log('');

	printProgress(sources, logMap);
	console.log('');

	console.log(`Sources to process: ${sources.length}`);
	console.log(`Wave filter: ${waveFilter !== null ? waveFilter : 'None (all waves)'}`);
	console.log(`Mode: ${fastMode ? '⚡ FAST (extraction only, no validation)' : dryRun ? 'DRY RUN (no actual changes)' : 'LIVE'}`);
	console.log(`Validation: ${validate ? 'ENABLED' : 'Disabled'}`);
	console.log(`Pre-scan: MANDATORY (ran above)`);
	if (domainOverride) console.log(`Domain override: ${domainOverride}`);
	console.log(`Retry failed: ${retryFailed ? 'YES' : 'No'}`);
	console.log(`Fail fast: ${failFast ? 'ENABLED' : 'Disabled'}`);
	if (validate) {
		console.log(`Gemini concurrency: ${GEMINI_CONCURRENCY} (set GEMINI_CONCURRENCY to change)`);
		console.log(`Phase A concurrency: ${PHASE_A_CONCURRENCY} (set PHASE_A_CONCURRENCY to change)`);
	}
	if (fastMode) {
		console.log(`⚡ Fast mode: extraction + embedding only (no Gemini validation). Est. time: 5-10 min.`);
	}
	console.log('');

	if (dryRun) {
		console.log('DRY RUN — Sources that would be processed:\n');
		for (const source of sources) {
			const slug = createSlug(source.title);
			const fetched = isSourceFetched(slug);
			const log = logMap.get(source.url);
			const logStatus = log ? ` [ingestion_log: ${log.status}]` : '';
			console.log(
				`[${source.id}] ${source.title} (${source.source_type}, wave ${source.wave})${logStatus}`
			);
			console.log(`    Fetched: ${fetched ? 'YES' : 'NO (would fetch)'}`);
		}
		console.log('\nDry run complete. Use without --dry-run to actually ingest.');
		await db.close();
		process.exit(0);
	}

	if (!fs.existsSync(INGESTED_DIR)) {
		fs.mkdirSync(INGESTED_DIR, { recursive: true });
	}

	// ─── Pipelined ingestion ────────────────────────────────────────────────
	// Phase A (Claude+Voyage, stages 1-4) runs in parallel via phaseASem.
	// Phase B (Gemini+Store, stages 5-6) runs async, up to GEMINI_CONCURRENCY via sem.
	const sem = new Semaphore(GEMINI_CONCURRENCY);
	const phaseASem = new Semaphore(PHASE_A_CONCURRENCY);
	const results: IngestionResult[] = [];
	const phaseBTasks: Array<Promise<void>> = [];
	const phaseATasks: Array<Promise<void>> = [];

	let successCount = 0;
	let skippedCount = 0;
	let failedCount = 0;
	let totalClaims = 0;
	let totalRelations = 0;
	let totalArguments = 0;
	let totalCost = 0;
	const batchStartTime = Date.now();
	let stopLaunchingNewSources = false;

	console.log('[BATCH] Starting ingestion loop...\n');

	for (let i = 0; i < sources.length; i++) {
		if (stopLaunchingNewSources) {
			console.warn('[BATCH] Fail-fast is enabled — skipping remaining sources after first failure.');
			break;
		}

		const source = sources[i];
		const slug = createSlug(source.title);
		const label = `[${i + 1}/${sources.length}] ${source.title}`;

		console.log('─'.repeat(64));
		console.log(`[${i + 1}/${sources.length}] Ingesting: ${source.title}`);
		console.log(`    ID: ${source.id}`);
		console.log(`    URL: ${source.url}`);
		console.log(`    Type: ${source.source_type}, Wave: ${source.wave}`);
		console.log('');

		try {
			// Check ingestion_log status
			const log = logMap.get(source.url);

			if (log?.status === 'complete') {
				console.log('  [SKIP] Source already complete (ingestion_log)');
				results.push({
					id: source.id,
					title: source.title,
					status: 'skipped',
					reason: 'Already complete',
					claims: log.claims_extracted,
					relations: log.relations_extracted,
					arguments: log.arguments_grouped
				});
				skippedCount++;
				console.log('');
				continue;
			}

			if (log?.status === 'failed' && !retryFailed) {
				console.log(`  [SKIP] Source previously failed (use --retry to retry)`);
				results.push({
					id: source.id,
					title: source.title,
					status: 'skipped',
					reason: `Previously failed: ${log.error_message ?? 'unknown'}`
				});
				skippedCount++;
				console.log('');
				continue;
			}

			if (log?.status === 'failed' && retryFailed) {
				console.log('  [RETRY] Retrying previously failed source...');
			}

			if (!log) {
				const alreadyIngested = await isSourceIngested(db, source.url);
				if (alreadyIngested) {
					console.log('  [SKIP] Source already ingested (URL found in database)');
					results.push({
						id: source.id,
						title: source.title,
						status: 'skipped',
						reason: 'Already ingested (no log entry)'
					});
					skippedCount++;
					console.log('');
					continue;
				}
			}

			// Ensure source is fetched locally.
			// Always resolve by URL first (findFetchedSlug) before falling back to the
			// title-derived slug — prevents slug collision where two sources share the
			// same title and the second incorrectly reuses the first source's file.
			let ingestSlug = slug;
			const fetchedSlugByUrl = findFetchedSlug(source.url);
			if (fetchedSlugByUrl) {
				ingestSlug = fetchedSlugByUrl;
				if (fetchedSlugByUrl !== slug) {
					console.log(`  [INFO] Source already fetched as '${fetchedSlugByUrl}' (slug mismatch resolved)`);
				} else {
					console.log('  [INFO] Source already fetched');
				}
			} else {
				console.log('  [INFO] Source not yet fetched locally');
				const fetchSuccess = fetchSource(source.url, source.source_type);
				if (!fetchSuccess) {
					console.error('  [FAILED] Fetch failed');
					logBatchFailure(source, 'fetch', 'Fetch failed');
					results.push({ id: source.id, title: source.title, status: 'failed', reason: 'Fetch failed' });
					failedCount++;
					if (failFast) {
						stopLaunchingNewSources = true;
					}
					console.log('');
					continue;
				}
				ingestSlug = findFetchedSlug(source.url) ?? slug;
				if (ingestSlug !== slug) {
					console.log(`  [INFO] Fetch saved as '${ingestSlug}' (title-derived slug was '${slug}')`);
				}
			}

			if (validate) {
				const capturedSource = source;
				const capturedSlug = ingestSlug;
				const capturedLabel = label;

				const phaseATask = (async () => {
					await phaseASem.acquire();
					try {
						const phaseAOk = await runPhaseA(capturedSlug, validate, capturedLabel, fastMode, domainOverride);

						if (!phaseAOk) {
							console.error(`  [FAILED] Phase A failed for: ${capturedSource.title}`);
							logBatchFailure(capturedSource, 'phase-a', 'Phase A (extract/embed) failed');
							results.push({
								id: capturedSource.id,
								title: capturedSource.title,
								status: 'failed',
								reason: 'Phase A (extract/embed) failed'
							});
							failedCount++;
							if (failFast) {
								stopLaunchingNewSources = true;
							}
							return;
						}

						console.log(`  [PIPELINE] Phase A complete — handing off to Phase B (background)`);

						await sem.acquire();
						const phaseBTask = runPhaseB(capturedSlug, validate, capturedLabel, domainOverride)
							.then((result) => {
								if (result.success) {
									successCount++;
									results.push({
										id: capturedSource.id,
										title: capturedSource.title,
										status: 'success',
										claims: result.claims,
										relations: result.relations,
										arguments: result.arguments,
										cost_gbp: result.cost_gbp
									});
									if (result.claims) totalClaims += result.claims;
									if (result.relations) totalRelations += result.relations;
									if (result.arguments) totalArguments += result.arguments;
									if (result.cost_gbp) totalCost += result.cost_gbp;
									console.log(
										`\n  ✓ DONE: ${capturedSource.title} — ${result.claims ?? '?'} claims, £${result.cost_gbp?.toFixed(4) ?? '?'}`
									);
								} else {
									failedCount++;
									logBatchFailure(capturedSource, 'phase-b', 'Phase B (validate/store) failed');
									if (failFast) {
										stopLaunchingNewSources = true;
									}
									results.push({
										id: capturedSource.id,
										title: capturedSource.title,
										status: 'failed',
										reason: 'Phase B (validate/store) failed'
									});
									console.error(`\n  ✗ FAILED (Phase B): ${capturedSource.title}`);
								}
							})
							.finally(() => sem.release());

						phaseBTasks.push(phaseBTask);
					} finally {
						phaseASem.release();
					}
				})();

				phaseATasks.push(phaseATask);
			} else {
				// ── Non-pipelined mode (no Gemini) ──────────────────────────
				// No Gemini validation, so no benefit to pipelining — run sequentially.
				const ingestResult = await ingestSourceFull(ingestSlug, validate, domainOverride);

				if (!ingestResult.success) {
					console.error('  [FAILED] Ingestion failed');
					logBatchFailure(source, 'full-ingest', 'Ingestion pipeline error');
					results.push({ id: source.id, title: source.title, status: 'failed', reason: 'Ingestion pipeline error' });
					failedCount++;
					if (failFast) {
						stopLaunchingNewSources = true;
					}
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
					if (ingestResult.claims) totalClaims += ingestResult.claims;
					if (ingestResult.relations) totalRelations += ingestResult.relations;
					if (ingestResult.arguments) totalArguments += ingestResult.arguments;
					if (ingestResult.cost_gbp) totalCost += ingestResult.cost_gbp;
				}

				console.log('');

				if (i < sources.length - 1) {
					console.log('  [WAIT] 2 seconds before next source...\n');
					await sleep(2);
				}
			}
		} catch (error) {
			console.error(
				`  [ERROR] Unexpected error: ${error instanceof Error ? error.message : error}`
			);
			logBatchFailure(source, 'batch-loop', error instanceof Error ? error.message : String(error));
			results.push({
				id: source.id,
				title: source.title,
				status: 'failed',
				reason: error instanceof Error ? error.message : String(error)
			});
			failedCount++;
			if (failFast) {
				stopLaunchingNewSources = true;
			}
			console.log('');
		}
	}

	if (phaseATasks.length > 0) {
		console.log(`\n[PIPELINE] Waiting for ${phaseATasks.length} Phase A task(s) to complete...`);
		await Promise.all(phaseATasks);
	}

	// Wait for all Phase B (Gemini+Store) tasks to complete
	if (phaseBTasks.length > 0) {
		console.log(`\n[PIPELINE] Waiting for ${phaseBTasks.length} background Phase B task(s) to complete...`);
		await Promise.all(phaseBTasks);
		console.log('[PIPELINE] All Phase B tasks complete.');
	}

	await db.close();

	// ─── Summary ──────────────────────────────────────────────────────────
	const totalTimeMs = Date.now() - batchStartTime;
	const totalTimeSec = Math.round(totalTimeMs / 1000);
	const avgTimePerSource = successCount > 0 ? totalTimeSec / successCount : 0;
	const timeStr = totalTimeSec < 60 ? `${totalTimeSec}s` : `${Math.floor(totalTimeSec / 60)}m ${totalTimeSec % 60}s`;

	console.log('\n╔══════════════════════════════════════════════════════════════╗');
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
	console.log('╠══════════════════════════════════════════════════════════════╣');
	console.log(`║  Total time:           ${String(timeStr).padEnd(35)} ║`);
	if (successCount > 0) {
		console.log(`║  Avg per source:       ${String(Math.round(avgTimePerSource) + 's').padEnd(35)} ║`);
	}
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log('');

	if (failedCount > 0) {
		console.log('FAILED SOURCES:');
		for (const result of results) {
			if (result.status === 'failed') {
				console.log(`  [${result.id}] ${result.title}`);
				if (result.reason) console.log(`      Reason: ${result.reason}`);
			}
		}
		console.log('');
	}

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
