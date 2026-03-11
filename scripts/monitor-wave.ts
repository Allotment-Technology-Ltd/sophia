/**
 * SOPHIA — Wave Monitoring Script
 *
 * Polls ingestion_log for early failure detection and progress visibility.
 *
 * Usage examples:
 *   npx tsx --env-file=.env scripts/monitor-wave.ts --once
 *   npx tsx --env-file=.env scripts/monitor-wave.ts --source-list ./data/source-list-ethics.json --wave 2 --once
 *   npx tsx --env-file=.env scripts/monitor-wave.ts --all-source-lists --once
 *
 * Optional env vars:
 *   MONITOR_SLACK_WEBHOOK_URL       Slack incoming webhook URL for alerts
 *   MONITOR_STUCK_MINUTES           Override stuck threshold (default 20)
 *   MONITOR_RETRY_TOTAL_THRESHOLD   Alert when retry_count_total >= this (default 8)
 *   MONITOR_RUN_ATTEMPT_THRESHOLD   Alert when run_attempt_count >= this (default 3)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Surreal } from 'surrealdb';
import { deriveCanonicalSourceIdentity } from './source-identity.js';

const DEFAULT_SOURCE_LIST_PATH = './data/source-list-3a.json';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const SLACK_WEBHOOK_URL = process.env.MONITOR_SLACK_WEBHOOK_URL || '';
const DEFAULT_STUCK_MINUTES = Number(process.env.MONITOR_STUCK_MINUTES || '20');
const DEFAULT_RETRY_TOTAL_THRESHOLD = Number(process.env.MONITOR_RETRY_TOTAL_THRESHOLD || '8');
const DEFAULT_RUN_ATTEMPT_THRESHOLD = Number(process.env.MONITOR_RUN_ATTEMPT_THRESHOLD || '3');

type SourceEntry = {
	id: number;
	title: string;
	url: string;
	wave: number;
	source_type: string;
};

type IngestionLogRecord = {
	canonical_url_hash?: string;
	canonical_url?: string;
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
	started_at?: string;
	completed_at?: string;
	retry_count_total?: number;
	run_attempt_count?: number;
	stage_telemetry?: Record<string, unknown>;
};

type MonitorOptions = {
	wave: number | null;
	intervalSec: number;
	stuckMinutes: number;
	once: boolean;
	maxCycles: number | null;
	failOnAlert: boolean;
	retryTotalThreshold: number;
	runAttemptThreshold: number;
	sourceListPaths: string[];
	allSourceLists: boolean;
};

type MonitorSummary = {
	timestamp: string;
	scope: string;
	targetSources: number;
	complete: number;
	failed: number;
	inProgress: number;
	missing: number;
	alerts: string[];
	failingSources: Array<{ title: string; stage?: string; reason?: string }>;
	stuckSources: Array<{ title: string; status: string; minutesRunning: number }>;
	retryLoopSources: Array<{ title: string; retryCount: number; runAttempts: number }>;
};

function parseArgs(argv: string[]): MonitorOptions {
	let hasCustomSourceList = false;
	const options: MonitorOptions = {
		wave: null,
		intervalSec: 120,
		stuckMinutes: DEFAULT_STUCK_MINUTES,
		once: false,
		maxCycles: null,
		failOnAlert: false,
		retryTotalThreshold: DEFAULT_RETRY_TOTAL_THRESHOLD,
		runAttemptThreshold: DEFAULT_RUN_ATTEMPT_THRESHOLD,
		sourceListPaths: [DEFAULT_SOURCE_LIST_PATH],
		allSourceLists: false
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--wave' && argv[i + 1]) {
			options.wave = Number(argv[++i]);
		} else if (arg === '--source-list' && argv[i + 1]) {
			if (!hasCustomSourceList) {
				options.sourceListPaths = [];
				hasCustomSourceList = true;
			}
			const next = argv[++i].trim();
			if (next) options.sourceListPaths.push(next);
		} else if (arg === '--all-source-lists') {
			options.allSourceLists = true;
		} else if (arg === '--interval-sec' && argv[i + 1]) {
			options.intervalSec = Math.max(10, Number(argv[++i]));
		} else if (arg === '--stuck-minutes' && argv[i + 1]) {
			options.stuckMinutes = Math.max(1, Number(argv[++i]));
		} else if (arg === '--retry-total-threshold' && argv[i + 1]) {
			options.retryTotalThreshold = Math.max(1, Number(argv[++i]));
		} else if (arg === '--run-attempt-threshold' && argv[i + 1]) {
			options.runAttemptThreshold = Math.max(1, Number(argv[++i]));
		} else if (arg === '--max-cycles' && argv[i + 1]) {
			options.maxCycles = Math.max(1, Number(argv[++i]));
		} else if (arg === '--once') {
			options.once = true;
		} else if (arg === '--fail-on-alert') {
			options.failOnAlert = true;
		} else if (arg === '--help' || arg === '-h') {
			printUsage();
			process.exit(0);
		}
	}

	// De-duplicate while preserving order.
	options.sourceListPaths = options.sourceListPaths.filter((p, idx, all) => all.indexOf(p) === idx);
	return options;
}

function printUsage(): void {
	console.log('SOPHIA Wave Monitor');
	console.log('');
	console.log('Usage: npx tsx --env-file=.env scripts/monitor-wave.ts [options]');
	console.log('');
	console.log('Options:');
	console.log('  --source-list <path>      Add a source list path (repeatable)');
	console.log('  --all-source-lists        Load all ./data/source-list*.json files');
	console.log('  --wave N                  Monitor only one wave from selected lists');
	console.log('  --interval-sec N          Polling interval in seconds (default: 120)');
	console.log('  --stuck-minutes N         Alert threshold for long-running records (default: 20)');
	console.log('  --retry-total-threshold N Alert threshold for retry_count_total (default: 8)');
	console.log('  --run-attempt-threshold N Alert threshold for run_attempt_count (default: 3)');
	console.log('  --max-cycles N            Stop after N polling cycles');
	console.log('  --once                    Run one check then exit');
	console.log('  --fail-on-alert           Exit non-zero when alerts are found');
	console.log('  --help, -h                Show this help text');
	console.log('');
	console.log('Environment:');
	console.log('  MONITOR_SLACK_WEBHOOK_URL Send alerts to Slack webhook when set');
}

function listAllSourceListPaths(): string[] {
	const dataDir = './data';
	if (!fs.existsSync(dataDir)) return [];

	return fs
		.readdirSync(dataDir)
		.filter((file) => /^source-list.*\.json$/i.test(file))
		.map((file) => path.join(dataDir, file))
		.sort();
}

function loadSources(options: MonitorOptions): { sources: SourceEntry[]; scopeLabel: string } {
	const paths = options.allSourceLists
		? listAllSourceListPaths()
		: options.sourceListPaths;

	if (paths.length === 0) {
		throw new Error('No source-list files found for monitor scope');
	}

	const merged = new Map<string, SourceEntry>();
	for (const sourceListPath of paths) {
		if (!fs.existsSync(sourceListPath)) {
			throw new Error(`Source list not found: ${sourceListPath}`);
		}

		const raw = fs.readFileSync(sourceListPath, 'utf-8');
		const entries = JSON.parse(raw) as SourceEntry[];
		for (const entry of entries) {
			if (options.wave != null && entry.wave !== options.wave) continue;
			const identity = deriveCanonicalSourceIdentity(entry.url);
			if (!identity) continue;
			if (!merged.has(identity.canonicalUrlHash)) {
				merged.set(identity.canonicalUrlHash, entry);
			}
		}
	}

	const scopeLabel = options.allSourceLists
		? options.wave == null
			? 'all source-lists, all waves'
			: `all source-lists, wave ${options.wave}`
		: options.wave == null
			? `${paths.length} source-list file(s), all waves`
			: `${paths.length} source-list file(s), wave ${options.wave}`;

	return { sources: [...merged.values()], scopeLabel };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectDb(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

function minutesSince(dateString?: string): number {
	if (!dateString) return 0;
	const ts = Date.parse(dateString);
	if (Number.isNaN(ts)) return 0;
	return Math.floor((Date.now() - ts) / 60_000);
}

function summarize(
	sources: SourceEntry[],
	logRows: IngestionLogRecord[],
	options: MonitorOptions,
	scopeLabel: string
): MonitorSummary {
	const logByCanonicalHash = new Map<string, IngestionLogRecord>();
	for (const row of logRows) {
		const identity = row.canonical_url_hash || deriveCanonicalSourceIdentity(row.source_url)?.canonicalUrlHash;
		if (identity) logByCanonicalHash.set(identity, row);
	}

	let complete = 0;
	let failed = 0;
	let inProgress = 0;
	let missing = 0;

	const alerts: string[] = [];
	const failingSources: Array<{ title: string; stage?: string; reason?: string }> = [];
	const stuckSources: Array<{ title: string; status: string; minutesRunning: number }> = [];
	const retryLoopSources: Array<{ title: string; retryCount: number; runAttempts: number }> = [];

	for (const source of sources) {
		const identity = deriveCanonicalSourceIdentity(source.url);
		if (!identity) {
			missing++;
			alerts.push(`Identity warning: could not canonicalize source URL for "${source.title}"`);
			continue;
		}

		const row = logByCanonicalHash.get(identity.canonicalUrlHash);
		if (!row) {
			missing++;
			continue;
		}

		const retryCount = row.retry_count_total ?? 0;
		const runAttempts = row.run_attempt_count ?? 0;
		if (retryCount >= options.retryTotalThreshold || runAttempts >= options.runAttemptThreshold) {
			retryLoopSources.push({
				title: row.source_title || source.title,
				retryCount,
				runAttempts
			});
			alerts.push(
				`Retry-loop alert: "${row.source_title || source.title}" retry_count_total=${retryCount}, run_attempt_count=${runAttempts}`
			);
		}

		if (row.status === 'complete') {
			complete++;
			if ((row.claims_extracted ?? 0) > 0 && (row.relations_extracted ?? 0) === 0) {
				alerts.push(`Quality alert: 0 relations for completed source "${row.source_title}"`);
			}
			if ((row.claims_extracted ?? 0) > 0 && (row.arguments_grouped ?? 0) === 0) {
				alerts.push(`Quality alert: 0 arguments for completed source "${row.source_title}"`);
			}
			continue;
		}

		if (row.status === 'failed') {
			failed++;
			failingSources.push({
				title: row.source_title || source.title,
				stage: row.stage_completed,
				reason: row.error_message
			});
			alerts.push(
				`Failure: "${row.source_title || source.title}" failed at ${row.stage_completed || 'unknown stage'}`
			);
			continue;
		}

		inProgress++;
		const runningMinutes = minutesSince(row.started_at);
		if (runningMinutes >= options.stuckMinutes) {
			stuckSources.push({
				title: row.source_title || source.title,
				status: row.status,
				minutesRunning: runningMinutes
			});
			alerts.push(
				`Stuck-stage alert: "${row.source_title || source.title}" status=${row.status} running ${runningMinutes}m`
			);
		}
	}

	if (missing > 0) {
		alerts.push(`Visibility warning: ${missing} source(s) have no ingestion_log record yet`);
	}

	return {
		timestamp: new Date().toISOString(),
		scope: scopeLabel,
		targetSources: sources.length,
		complete,
		failed,
		inProgress,
		missing,
		alerts,
		failingSources,
		stuckSources,
		retryLoopSources
	};
}

function printSummary(summary: MonitorSummary): void {
	console.log('');
	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║                 SOPHIA WAVE MONITOR                         ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log(`[MONITOR] ${summary.timestamp} — scope: ${summary.scope}`);
	console.log(
		`[MONITOR] complete=${summary.complete} failed=${summary.failed} in_progress=${summary.inProgress} missing=${summary.missing} total=${summary.targetSources}`
	);

	if (summary.alerts.length === 0) {
		console.log('[MONITOR] ✓ No alerts');
		return;
	}

	console.log(`[MONITOR] ⚠ ${summary.alerts.length} alert(s)`);
	for (const alert of summary.alerts) {
		console.log(`  - ${alert}`);
	}
}

async function sendSlackAlert(summary: MonitorSummary): Promise<void> {
	if (!SLACK_WEBHOOK_URL || summary.alerts.length === 0) return;

	const headline = `SOPHIA monitor alert (${summary.scope})`;
	const bodyLines = [
		`complete=${summary.complete}, failed=${summary.failed}, in_progress=${summary.inProgress}, missing=${summary.missing}`,
		...summary.alerts.slice(0, 15)
	];

	const payload = {
		text: `${headline}\n${bodyLines.join('\n')}`
	};

	try {
		const response = await fetch(SLACK_WEBHOOK_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			console.warn(`[MONITOR] Slack webhook returned ${response.status}`);
		}
	} catch (error) {
		console.warn(
			`[MONITOR] Failed to send Slack alert: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

async function runCycle(
	db: Surreal,
	sources: SourceEntry[],
	options: MonitorOptions,
	scopeLabel: string
): Promise<MonitorSummary> {
	if (sources.length === 0) {
		return {
			timestamp: new Date().toISOString(),
			scope: scopeLabel,
			targetSources: 0,
			complete: 0,
			failed: 0,
			inProgress: 0,
			missing: 0,
			alerts: [],
			failingSources: [],
			stuckSources: [],
			retryLoopSources: []
		};
	}

	const canonicalHashes = sources
		.map((s) => deriveCanonicalSourceIdentity(s.url)?.canonicalUrlHash)
		.filter((h): h is string => Boolean(h));

	const result = await db.query<IngestionLogRecord[][]>(
		`SELECT canonical_url_hash, canonical_url, source_url, source_title, status, stage_completed,
			claims_extracted, relations_extracted, arguments_grouped, validation_score,
			error_message, cost_usd, started_at, completed_at,
			retry_count_total, run_attempt_count, stage_telemetry
		 FROM ingestion_log
		 WHERE canonical_url_hash INSIDE $canonical_hashes OR source_url INSIDE $source_urls`,
		{ canonical_hashes: canonicalHashes, source_urls: sources.map((s) => s.url) }
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	const summary = summarize(sources, rows, options, scopeLabel);
	printSummary(summary);
	await sendSlackAlert(summary);
	return summary;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const { sources, scopeLabel } = loadSources(options);

	if (sources.length === 0) {
		console.log('[MONITOR] No sources match the selected scope.');
		process.exit(0);
	}

	const db = await connectDb();
	let cycles = 0;
	let hadAlerts = false;

	try {
		while (true) {
			cycles++;
			const summary = await runCycle(db, sources, options, scopeLabel);
			hadAlerts = hadAlerts || summary.alerts.length > 0;

			if (options.once) break;
			if (options.maxCycles !== null && cycles >= options.maxCycles) break;
			await sleep(options.intervalSec * 1000);
		}
	} finally {
		await db.close();
	}

	if (options.failOnAlert && hadAlerts) {
		process.exit(2);
	}

	process.exit(0);
}

main().catch((error) => {
	console.error(`[MONITOR] Fatal error: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
