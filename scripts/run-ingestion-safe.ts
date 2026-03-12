import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Surreal } from 'surrealdb';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.js';

type Mode = 'local-then-migrate' | 'direct-prod';

type DbConfig = {
	url: string;
	user: string;
	pass: string;
	namespace: string;
	database: string;
};

type SourceSnapshot = {
	sourceId: string;
	title: string;
	claimCount: number;
	passageCount: number;
	status?: string;
	stageCompleted?: string;
};

function readArg(args: string[], key: string): string | undefined {
	const i = args.indexOf(key);
	if (i < 0) return undefined;
	return args[i + 1];
}

function hasFlag(args: string[], key: string): boolean {
	return args.includes(key);
}

function parseArgs() {
	const args = process.argv.slice(2);
	const mode = (readArg(args, '--mode') || 'local-then-migrate') as Mode;
	const sourceFile = readArg(args, '--source-file');
	const dryRun = hasFlag(args, '--dry-run');
	const forceMigrate = hasFlag(args, '--force-migrate');
	const allowLocalReingest = hasFlag(args, '--allow-local-reingest');
	const confirmDirectProd = hasFlag(args, '--confirm-direct-prod');
	const skipBackup = hasFlag(args, '--skip-backup');

	if (mode !== 'local-then-migrate' && mode !== 'direct-prod') {
		throw new Error(`Invalid --mode: ${mode}. Use local-then-migrate or direct-prod`);
	}
	if (!sourceFile) {
		throw new Error('Missing required --source-file <path-to-txt>');
	}

	return {
		mode,
		sourceFile: path.resolve(sourceFile),
		dryRun,
		forceMigrate,
		allowLocalReingest,
		confirmDirectProd,
		skipBackup
	};
}

function envWithDb(base: NodeJS.ProcessEnv, db: DbConfig): NodeJS.ProcessEnv {
	return {
		...base,
		SURREAL_URL: db.url,
		SURREAL_USER: db.user,
		SURREAL_PASS: db.pass,
		SURREAL_NAMESPACE: db.namespace,
		SURREAL_DATABASE: db.database
	};
}

function assertFile(filePath: string): void {
	if (!fs.existsSync(filePath)) {
		throw new Error(`File not found: ${filePath}`);
	}
}

function loadCanonicalIdentity(sourceFile: string): {
	canonicalUrl: string;
	canonicalUrlHash: string;
	title?: string;
} {
	const metaFile = sourceFile.replace(/\.txt$/i, '.meta.json');
	assertFile(metaFile);
	const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8')) as {
		url?: string;
		canonical_url?: string;
		title?: string;
	};
	const identity = canonicalizeAndHashSourceUrl(meta.canonical_url || meta.url || '');
	if (!identity) {
		throw new Error(`Cannot canonicalize URL in metadata: ${metaFile}`);
	}
	return {
		canonicalUrl: identity.canonicalUrl,
		canonicalUrlHash: identity.canonicalUrlHash,
		title: meta.title
	};
}

async function connectDb(config: DbConfig): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(config.url);
	await db.signin({ username: config.user, password: config.pass } as any);
	await db.use({ namespace: config.namespace, database: config.database });
	return db;
}

async function getSourceSnapshot(
	db: Surreal,
	canonicalHash: string,
	canonicalUrl: string
): Promise<SourceSnapshot | null> {
	const sourceRows =
		(await db.query<any[][]>(
			`SELECT id,title,status FROM source
			 WHERE canonical_url_hash = $hash OR url = $url OR canonical_url = $url
			 ORDER BY ingested_at DESC
			 LIMIT 1`,
			{ hash: canonicalHash, url: canonicalUrl }
		))?.[0] ?? [];

	if (sourceRows.length === 0) return null;
	const source = sourceRows[0];
	const sourceId = String(source.id);

	const claimRows =
		(await db.query<any[][]>('SELECT count() AS count FROM claim WHERE source = $sid GROUP ALL', {
			sid: sourceId
		}))?.[0] ?? [];
	const passageRows =
		(await db.query<any[][]>('SELECT count() AS count FROM passage WHERE source = $sid GROUP ALL', {
			sid: sourceId
		}))?.[0] ?? [];

	const logRows =
		(await db.query<any[][]>(
			`SELECT status, stage_completed
			 FROM ingestion_log
			 WHERE canonical_url_hash = $hash OR source_url = $url
			 ORDER BY started_at DESC
			 LIMIT 1`,
			{ hash: canonicalHash, url: canonicalUrl }
		))?.[0] ?? [];

	return {
		sourceId,
		title: source.title || 'Unknown title',
		claimCount: claimRows[0]?.count ?? claimRows.length,
		passageCount: passageRows[0]?.count ?? passageRows.length,
		status: logRows[0]?.status,
		stageCompleted: logRows[0]?.stage_completed
	};
}

function runCommand(cmd: string, args: string[], env: NodeJS.ProcessEnv): void {
	const display = [cmd, ...args].join(' ');
	console.log(`[RUN] ${display}`);
	const result = spawnSync(cmd, args, {
		stdio: 'inherit',
		env,
		shell: false
	});
	if (result.status !== 0) {
		throw new Error(`Command failed (${result.status}): ${display}`);
	}
}

function localDbConfig(): DbConfig {
	return {
		url: process.env.LOCAL_SURREAL_URL || 'http://localhost:8000/rpc',
		user: process.env.LOCAL_SURREAL_USER || 'root',
		pass: process.env.LOCAL_SURREAL_PASS || 'root',
		namespace: process.env.SURREAL_NAMESPACE || 'sophia',
		database: process.env.SURREAL_DATABASE || 'sophia'
	};
}

function prodDbConfig(): DbConfig {
	const pass = process.env.SURREAL_PASS || '';
	if (!pass) throw new Error('SURREAL_PASS is required for production runs.');
	return {
		url: process.env.SURREAL_URL || 'http://localhost:8800/rpc',
		user: process.env.SURREAL_USER || 'root',
		pass,
		namespace: process.env.SURREAL_NAMESPACE || 'sophia',
		database: process.env.SURREAL_DATABASE || 'sophia'
	};
}

function isLocalComplete(snapshot: SourceSnapshot | null): boolean {
	if (!snapshot) return false;
	return (
		snapshot.claimCount > 0 &&
		snapshot.passageCount > 0 &&
		snapshot.status === 'complete' &&
		snapshot.stageCompleted === 'storing'
	);
}

async function verifyPostMigration(
	localDb: Surreal,
	prodDb: Surreal,
	canonicalHash: string,
	canonicalUrl: string
): Promise<void> {
	const [local, prod] = await Promise.all([
		getSourceSnapshot(localDb, canonicalHash, canonicalUrl),
		getSourceSnapshot(prodDb, canonicalHash, canonicalUrl)
	]);
	if (!local || !prod) {
		throw new Error('Post-migration verification failed: source missing on local or prod.');
	}
	if (prod.claimCount !== local.claimCount || prod.passageCount !== local.passageCount) {
		throw new Error(
			`Post-migration mismatch local(claims=${local.claimCount},passages=${local.passageCount}) vs prod(claims=${prod.claimCount},passages=${prod.passageCount})`
		);
	}
	console.log(
		`[VERIFY] Migration counts match claims=${prod.claimCount}, passages=${prod.passageCount}`
	);
}

async function main() {
	const {
		mode,
		sourceFile,
		dryRun,
		forceMigrate,
		allowLocalReingest,
		confirmDirectProd,
		skipBackup
	} = parseArgs();
	assertFile(sourceFile);
	const identity = loadCanonicalIdentity(sourceFile);

	console.log(`[PLAN] Mode=${mode}`);
	console.log(`[PLAN] Source=${sourceFile}`);
	console.log(`[PLAN] Canonical hash=${identity.canonicalUrlHash}`);

	const localCfg = localDbConfig();
	const prodCfg = prodDbConfig();

	if (mode === 'local-then-migrate') {
		const localDb = await connectDb(localCfg);
		const prodDb = await connectDb(prodCfg);
		try {
			const [localSnapshot, prodSnapshot] = await Promise.all([
				getSourceSnapshot(localDb, identity.canonicalUrlHash, identity.canonicalUrl),
				getSourceSnapshot(prodDb, identity.canonicalUrlHash, identity.canonicalUrl)
			]);

			console.log(
				`[CHECK] Local: ${localSnapshot ? `claims=${localSnapshot.claimCount}, passages=${localSnapshot.passageCount}, status=${localSnapshot.status}, stage=${localSnapshot.stageCompleted}` : 'missing'}`
			);
			console.log(
				`[CHECK] Prod: ${prodSnapshot ? `claims=${prodSnapshot.claimCount}, passages=${prodSnapshot.passageCount}` : 'missing'}`
			);

			if (prodSnapshot && !forceMigrate) {
				throw new Error(
					'Source already exists in production. Use --force-migrate only when replacing a known-bad row.'
				);
			}

			if (!isLocalComplete(localSnapshot)) {
				if (!allowLocalReingest) {
					throw new Error(
						'Local source is not complete. Re-run with --allow-local-reingest to run local ingestion once, then migrate.'
					);
				}
				if (!dryRun) {
					runCommand(
						'npx',
						['tsx', '--env-file=.env', 'scripts/ingest.ts', sourceFile],
						envWithDb(process.env, localCfg)
					);
				}
			}

			if (!dryRun) {
				const migrationArgs = [
					'tsx',
					'--env-file=.env',
					'scripts/migrate-local-to-prod.ts',
					'--canonical-hash',
					identity.canonicalUrlHash
				];
				if (forceMigrate) migrationArgs.push('--force');
				runCommand('npx', migrationArgs, {
					...process.env,
					LOCAL_SURREAL_URL: localCfg.url,
					LOCAL_SURREAL_USER: localCfg.user,
					LOCAL_SURREAL_PASS: localCfg.pass,
					SURREAL_URL: prodCfg.url,
					SURREAL_USER: prodCfg.user,
					SURREAL_PASS: prodCfg.pass,
					SURREAL_NAMESPACE: prodCfg.namespace,
					SURREAL_DATABASE: prodCfg.database
				});

				await verifyPostMigration(localDb, prodDb, identity.canonicalUrlHash, identity.canonicalUrl);
			}

			console.log('[DONE] local-then-migrate completed with no duplicate model invocation on prod.');
		} finally {
			await localDb.close();
			await prodDb.close();
		}
		return;
	}

	if (!confirmDirectProd) {
		throw new Error('Direct prod mode requires --confirm-direct-prod.');
	}

	const prodDb = await connectDb(prodCfg);
	try {
		const prodSnapshot = await getSourceSnapshot(prodDb, identity.canonicalUrlHash, identity.canonicalUrl);
		if (prodSnapshot && !forceMigrate) {
			throw new Error('Source already exists in production. Refusing direct prod re-ingestion without --force-migrate.');
		}
	} finally {
		await prodDb.close();
	}

	if (!skipBackup) {
		if (!dryRun) {
			runCommand('npx', ['tsx', '--env-file=.env', 'scripts/db-backup.ts'], envWithDb(process.env, prodCfg));
		} else {
			console.log('[DRY-RUN] Would run production backup before direct ingest.');
		}
	}

	if (!dryRun) {
		runCommand(
			'npx',
			['tsx', '--env-file=.env', 'scripts/ingest.ts', sourceFile],
			envWithDb(process.env, prodCfg)
		);
	}

	console.log('[DONE] direct-prod completed.');
}

main().catch((error) => {
	console.error('[SAFE-INGEST] Fatal:', error instanceof Error ? error.message : error);
	process.exit(1);
});
