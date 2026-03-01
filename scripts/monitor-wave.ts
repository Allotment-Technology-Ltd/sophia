/**
 * SOPHIA — Wave Monitoring Script
 *
 * Polls ingestion_log for early failure detection and progress visibility.
 *
 * Usage examples:
 *   npx tsx --env-file=.env scripts/monitor-wave.ts --once
 *   npx tsx --env-file=.env scripts/monitor-wave.ts --wave 1 --interval-sec 120
 *   npx tsx --env-file=.env scripts/monitor-wave.ts --wave 1 --interval-sec 120 --fail-on-alert
 *
 * Optional env vars:
 *   MONITOR_SLACK_WEBHOOK_URL   Slack incoming webhook URL for alerts
 *   MONITOR_STUCK_MINUTES       Override stuck threshold (default 20)
 */

import * as fs from 'fs';
import { Surreal } from 'surrealdb';

const SOURCE_LIST_PATH = './data/source-list-3a.json';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const SLACK_WEBHOOK_URL = process.env.MONITOR_SLACK_WEBHOOK_URL || '';
const DEFAULT_STUCK_MINUTES = Number(process.env.MONITOR_STUCK_MINUTES || '20');

type SourceEntry = {
	id: number;
	title: string;
	url: string;
	wave: number;
	source_type: string;
};

type IngestionLogRecord = {
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
};

type MonitorOptions = {
	wave: number | null;
	intervalSec: number;
	stuckMinutes: number;
	once: boolean;
	maxCycles: number | null;
	failOnAlert: boolean;
};

type MonitorSummary = {
	timestamp: string;
	targetSources: number;
	complete: number;
	failed: number;
	inProgress: number;
	missing: number;
	alerts: string[];
	failingSources: Array<{ title: string; stage?: string; reason?: string }>;
	stuckSources: Array<{ title: string; status: string; minutesRunning: number }>;
};

function parseArgs(argv: string[]): MonitorOptions {
	const options: MonitorOptions = {
		wave: null,
		intervalSec: 120,
		stuckMinutes: DEFAULT_STUCK_MINUTES,
		once: false,
		maxCycles: null,
		failOnAlert: false
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--wave' && argv[i + 1]) {
			options.wave = Number(argv[++i]);
		} else if (arg === '--interval-sec' && argv[i + 1]) {
			options.intervalSec = Math.max(10, Number(argv[++i]));
		} else if (arg === '--stuck-minutes' && argv[i + 1]) {
			options.stuckMinutes = Math.max(1, Number(argv[++i]));
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

	return options;
}

function printUsage(): void {
	console.log('SOPHIA Wave Monitor');
	console.log('');
	console.log('Usage: npx tsx --env-file=.env scripts/monitor-wave.ts [options]');
	console.log('');
	console.log('Options:');
	console.log('  --wave N           Monitor only one wave (1/2/3)');
	console.log('  --interval-sec N   Polling interval in seconds (default: 120)');
	console.log('  --stuck-minutes N  Alert threshold for long-running non-terminal records (default: 20)');
	console.log('  --max-cycles N     Stop after N polling cycles');
	console.log('  --once             Run one check then exit');
	console.log('  --fail-on-alert    Exit non-zero when alerts are found');
	console.log('  --help, -h         Show this help text');
	console.log('');
	console.log('Environment:');
	console.log('  MONITOR_SLACK_WEBHOOK_URL   Send alerts to Slack webhook when set');
}

function loadSources(wave: number | null): SourceEntry[] {
	if (!fs.existsSync(SOURCE_LIST_PATH)) {
		throw new Error(`Source list not found: ${SOURCE_LIST_PATH}`);
	}

	const raw = fs.readFileSync(SOURCE_LIST_PATH, 'utf-8');
	const all = JSON.parse(raw) as SourceEntry[];
	return wave == null ? all : all.filter((s) => s.wave === wave);
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
	stuckMinutes: number
): MonitorSummary {
	const logByUrl = new Map(logRows.map((r) => [r.source_url, r]));

	let complete = 0;
	let failed = 0;
	let inProgress = 0;
	let missing = 0;

	const alerts: string[] = [];
	const failingSources: Array<{ title: string; stage?: string; reason?: string }> = [];
	const stuckSources: Array<{ title: string; status: string; minutesRunning: number }> = [];

	for (const source of sources) {
		const row = logByUrl.get(source.url);
		if (!row) {
			missing++;
			continue;
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
		if (runningMinutes >= stuckMinutes) {
			stuckSources.push({
				title: row.source_title || source.title,
				status: row.status,
				minutesRunning: runningMinutes
			});
			alerts.push(
				`Stuck candidate: "${row.source_title || source.title}" status=${row.status} running ${runningMinutes}m`
			);
		}
	}

	if (missing > 0) {
		alerts.push(`Visibility warning: ${missing} source(s) have no ingestion_log record yet`);
	}

	return {
		timestamp: new Date().toISOString(),
		targetSources: sources.length,
		complete,
		failed,
		inProgress,
		missing,
		alerts,
		failingSources,
		stuckSources
	};
}

function printSummary(summary: MonitorSummary, wave: number | null): void {
	const scope = wave == null ? 'all waves' : `wave ${wave}`;
	console.log('');
	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║                 SOPHIA WAVE MONITOR                         ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log(`[MONITOR] ${summary.timestamp} — scope: ${scope}`);
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

async function sendSlackAlert(summary: MonitorSummary, wave: number | null): Promise<void> {
	if (!SLACK_WEBHOOK_URL || summary.alerts.length === 0) return;

	const scope = wave == null ? 'all waves' : `wave ${wave}`;
	const headline = `SOPHIA monitor alert (${scope})`;
	const bodyLines = [
		`complete=${summary.complete}, failed=${summary.failed}, in_progress=${summary.inProgress}, missing=${summary.missing}`,
		...summary.alerts.slice(0, 12)
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

async function runCycle(db: Surreal, sources: SourceEntry[], options: MonitorOptions): Promise<MonitorSummary> {
	const urls = sources.map((s) => s.url);
	const result = await db.query<IngestionLogRecord[][]>(
		`SELECT source_url, source_title, status, stage_completed, claims_extracted, relations_extracted, arguments_grouped, validation_score, error_message, cost_usd, started_at, completed_at
		 FROM ingestion_log
		 WHERE source_url INSIDE $urls`,
		{ urls }
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	const summary = summarize(sources, rows, options.stuckMinutes);
	printSummary(summary, options.wave);
	await sendSlackAlert(summary, options.wave);
	return summary;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const sources = loadSources(options.wave);

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
			const summary = await runCycle(db, sources, options);
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
