/**
 * SOPHIA — Replay/Remediation Tool (canonical_url_hash keyed)
 *
 * Replays ingestion for a single source by canonical URL hash.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/replay-ingest.ts --canonical-url-hash <hash>
 *   npx tsx --env-file=.env scripts/replay-ingest.ts --canonical-url-hash <hash> --force-stage relating --validate
 *   npx tsx --env-file=.env scripts/replay-ingest.ts --list-failed
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Surreal } from 'surrealdb';
import { deriveCanonicalSourceIdentity } from './source-identity.js';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';
const SOURCES_DIR = './data/sources';

const STAGES_ORDER = ['extracting', 'relating', 'grouping', 'embedding', 'validating', 'storing'];

type IngestionLogRow = {
	canonical_url_hash?: string;
	canonical_url?: string;
	source_url: string;
	source_title: string;
	status: string;
	stage_completed?: string;
	error_message?: string;
	run_attempt_count?: number;
	retry_count_total?: number;
};

function usage(): void {
	console.log('Usage: npx tsx --env-file=.env scripts/replay-ingest.ts [options]');
	console.log('');
	console.log('Options:');
	console.log('  --canonical-url-hash <hash>   Target source canonical hash (required unless --list-failed)');
	console.log('  --force-stage <stage>         Stage to replay from (extracting|relating|grouping|embedding|validating|storing)');
	console.log('  --ingest-provider <provider>  vertex|anthropic (optional)');
	console.log('  --domain <domain>             Domain override passed to ingest.ts');
	console.log('  --validate                    Enable validation stage');
	console.log('  --dry-run                     Print replay command without executing');
	console.log('  --list-failed                 List failed/retriable rows from ingestion_log');
	console.log('  --help, -h                    Show help');
}

function getArg(args: string[], flag: string): string | null {
	const idx = args.indexOf(flag);
	if (idx === -1 || idx + 1 >= args.length) return null;
	return args[idx + 1];
}

async function connectDb(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

async function findIngestionLogByHash(db: Surreal, hash: string): Promise<IngestionLogRow | null> {
	const result = await db.query<IngestionLogRow[][]>(
		`SELECT canonical_url_hash, canonical_url, source_url, source_title, status, stage_completed, error_message, run_attempt_count, retry_count_total
		 FROM ingestion_log
		 WHERE canonical_url_hash = $canonical_url_hash
		 LIMIT 1`,
		{ canonical_url_hash: hash }
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	return rows.length > 0 ? rows[0] : null;
}

function listMetaFiles(): string[] {
	if (!fs.existsSync(SOURCES_DIR)) return [];
	return fs
		.readdirSync(SOURCES_DIR)
		.filter((f) => f.endsWith('.meta.json'))
		.map((f) => path.join(SOURCES_DIR, f));
}

function findSourceTextPathByHash(hash: string, sourceUrlFromLog?: string): string | null {
	for (const metaPath of listMetaFiles()) {
		try {
			const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
				url?: string;
				canonical_url_hash?: string;
			};
			if (meta.canonical_url_hash === hash) {
				const txtPath = metaPath.replace(/\.meta\.json$/, '.txt');
				return fs.existsSync(txtPath) ? txtPath : null;
			}

			if (sourceUrlFromLog && meta.url === sourceUrlFromLog) {
				const txtPath = metaPath.replace(/\.meta\.json$/, '.txt');
				return fs.existsSync(txtPath) ? txtPath : null;
			}
		} catch {
			// skip malformed metadata
		}
	}

	if (sourceUrlFromLog) {
		const identity = deriveCanonicalSourceIdentity(sourceUrlFromLog);
		if (identity) {
			for (const metaPath of listMetaFiles()) {
				try {
					const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { url?: string };
					const metaIdentity = deriveCanonicalSourceIdentity(meta.url ?? '');
					if (metaIdentity?.canonicalUrlHash === identity.canonicalUrlHash) {
						const txtPath = metaPath.replace(/\.meta\.json$/, '.txt');
						return fs.existsSync(txtPath) ? txtPath : null;
					}
				} catch {
					// skip malformed metadata
				}
			}
		}
	}

	return null;
}

async function listFailedRows(db: Surreal): Promise<void> {
	const result = await db.query<IngestionLogRow[][]>(
		`SELECT canonical_url_hash, source_url, source_title, status, stage_completed, error_message, run_attempt_count, retry_count_total
		 FROM ingestion_log
		 WHERE status = 'failed' OR (status != 'complete' AND run_attempt_count > 1)
		 ORDER BY run_attempt_count DESC, retry_count_total DESC`
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	if (rows.length === 0) {
		console.log('[REPLAY] No failed/retriable rows found.');
		return;
	}

	console.log(`[REPLAY] ${rows.length} failed/retriable row(s):`);
	for (const row of rows.slice(0, 100)) {
		console.log(
			`- ${row.canonical_url_hash ?? 'missing-hash'} | ${row.status} | stage=${row.stage_completed ?? 'none'} | attempts=${row.run_attempt_count ?? 0} | retries=${row.retry_count_total ?? 0} | ${row.source_title}`
		);
		if (row.error_message) {
			console.log(`    error: ${row.error_message}`);
		}
	}
}

async function main() {
	const args = process.argv.slice(2);
	if (args.includes('--help') || args.includes('-h')) {
		usage();
		process.exit(0);
	}

	const listFailed = args.includes('--list-failed');
	const dryRun = args.includes('--dry-run');
	const validate = args.includes('--validate');
	const canonicalUrlHash = getArg(args, '--canonical-url-hash');
	const forceStage = getArg(args, '--force-stage');
	const ingestProvider = getArg(args, '--ingest-provider');
	const domain = getArg(args, '--domain');

	if (forceStage && !STAGES_ORDER.includes(forceStage)) {
		console.error(`[REPLAY] Invalid --force-stage value: ${forceStage}`);
		console.error(`Valid stages: ${STAGES_ORDER.join(', ')}`);
		process.exit(1);
	}

	const db = await connectDb();
	try {
		if (listFailed) {
			await listFailedRows(db);
			process.exit(0);
		}

		if (!canonicalUrlHash) {
			usage();
			process.exit(1);
		}

		const row = await findIngestionLogByHash(db, canonicalUrlHash);
		if (!row) {
			console.error(`[REPLAY] No ingestion_log row found for canonical_url_hash=${canonicalUrlHash}`);
			process.exit(1);
		}

		const txtPath = findSourceTextPathByHash(canonicalUrlHash, row.source_url);
		if (!txtPath) {
			console.error(
				`[REPLAY] Could not locate local source text for canonical_url_hash=${canonicalUrlHash}. Fetch the source first.`
			);
			process.exit(1);
		}

		const commandArgs = ['tsx', '--env-file=.env', 'scripts/ingest.ts', txtPath];
		if (forceStage) {
			commandArgs.push('--force-stage', forceStage);
		}
		if (ingestProvider) {
			commandArgs.push('--ingest-provider', ingestProvider);
		}
		if (domain) {
			commandArgs.push('--domain', domain);
		}
		if (validate) {
			commandArgs.push('--validate');
		}

		console.log(`[REPLAY] Target: ${row.source_title}`);
		console.log(`[REPLAY] canonical_url_hash: ${canonicalUrlHash}`);
		console.log(`[REPLAY] status=${row.status}, stage=${row.stage_completed ?? 'none'}, attempts=${row.run_attempt_count ?? 0}, retries=${row.retry_count_total ?? 0}`);
		console.log(`[REPLAY] source file: ${txtPath}`);
		console.log(`[REPLAY] command: npx ${commandArgs.join(' ')}`);

		if (dryRun) {
			console.log('[REPLAY] Dry run complete (command not executed).');
			process.exit(0);
		}

		const result = spawnSync('npx', commandArgs, {
			stdio: 'inherit',
			cwd: process.cwd()
		});

		if (result.error) {
			console.error(`[REPLAY] Failed to spawn replay process: ${result.error.message}`);
			process.exit(1);
		}
		process.exit(result.status ?? 1);
	} finally {
		await db.close();
	}
}

main().catch((error) => {
	console.error(`[REPLAY] Fatal error: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
