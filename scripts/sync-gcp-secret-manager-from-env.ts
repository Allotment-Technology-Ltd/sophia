#!/usr/bin/env npx tsx
/**
 * Push selected values from `.env` / `.env.local` to Google Secret Manager.
 *
 * Behaviour:
 * - For each mapped key present in env files: if the secret does not exist, create it and add a version;
 *   if the latest version differs from the local value, add a new version; if it already matches, skip.
 * - Keys missing from `.env` are skipped — nothing is deleted or cleared in Secret Manager.
 * - Env keys not in the allowlist are ignored entirely.
 *
 * Secret names match Cloud Run deploy: `.github/workflows/deploy.yml` (`--set-secrets`).
 *
 * Usage:
 *   pnpm secrets:sync-gcp
 *   pnpm secrets:sync-gcp -- --dry-run
 *   pnpm secrets:sync-gcp -- --env-file .env.production.local
 *
 * Project: `GCP_PROJECT_ID` or `GOOGLE_CLOUD_PROJECT`, else `gcloud config get-value project`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';

/** Env var name → Secret Manager secret id (deploy.yml mapping). */
const ENV_TO_SECRET: Record<string, string> = {
	ANTHROPIC_API_KEY: 'anthropic-api-key',
	SURREAL_URL: 'surreal-db-url',
	SURREAL_USER: 'surreal-db-user',
	SURREAL_PASS: 'surreal-db-pass',
	SURREAL_NAMESPACE: 'surreal-db-namespace',
	SURREAL_DATABASE: 'surreal-db-database',
	VOYAGE_API_KEY: 'voyage-api-key',
	GOOGLE_AI_API_KEY: 'google-ai-api-key',
	DATABASE_URL: 'neon-database-url',
	ADMIN_UIDS: 'admin-uids',
	OWNER_UIDS: 'owner-uids',
	PADDLE_API_KEY_PRODUCTION: 'PADDLE_API_KEY_PRODUCTION',
	PADDLE_WEBHOOK_SECRET_PRODUCTION: 'PADDLE_WEBHOOK_SECRET_PRODUCTION',
	PADDLE_PRICE_PRO_GBP_PRODUCTION: 'PADDLE_PRICE_PRO_GBP_PRODUCTION',
	PADDLE_PRICE_PRO_USD_PRODUCTION: 'PADDLE_PRICE_PRO_USD_PRODUCTION',
	PADDLE_PRICE_PREMIUM_GBP_PRODUCTION: 'PADDLE_PRICE_PREMIUM_GBP_PRODUCTION',
	PADDLE_PRICE_PREMIUM_USD_PRODUCTION: 'PADDLE_PRICE_PREMIUM_USD_PRODUCTION',
	PADDLE_PRICE_TOPUP_SMALL_GBP_PRODUCTION: 'PADDLE_PRICE_TOPUP_SMALL_GBP_PRODUCTION',
	PADDLE_PRICE_TOPUP_SMALL_USD_PRODUCTION: 'PADDLE_PRICE_TOPUP_SMALL_USD_PRODUCTION',
	PADDLE_PRICE_TOPUP_LARGE_GBP_PRODUCTION: 'PADDLE_PRICE_TOPUP_LARGE_GBP_PRODUCTION',
	PADDLE_PRICE_TOPUP_LARGE_USD_PRODUCTION: 'PADDLE_PRICE_TOPUP_LARGE_USD_PRODUCTION',
	/** Cloud Run env `PUBLIC_PADDLE_CLIENT_TOKEN_PRODUCTION` ← SM id `PADDLE_CLIENT_TOKEN` */
	PUBLIC_PADDLE_CLIENT_TOKEN_PRODUCTION: 'PADDLE_CLIENT_TOKEN',
	/** Same Neon Auth URL as GitHub Actions `NEON_AUTH_BASE_URL`; optional SM duplicate. */
	NEON_AUTH_BASE_URL: 'neon-auth-base-url'
};

function parseArgs(argv: string[]): {
	dryRun: boolean;
	root: string;
	extraEnvFiles: string[];
} {
	let dryRun = false;
	const extraEnvFiles: string[] = [];
	let root = process.cwd();
	const rest = [...argv];
	while (rest.length) {
		const a = rest.shift()!;
		if (a === '--dry-run') dryRun = true;
		else if (a === '--root' && rest[0]) root = resolve(rest.shift()!);
		else if (a.startsWith('--env-file=')) extraEnvFiles.push(resolve(a.slice('--env-file='.length)));
		else if (a === '--env-file' && rest[0]) extraEnvFiles.push(resolve(rest.shift()!));
		else if (a === '--help' || a === '-h') {
			console.log(`Usage: tsx scripts/sync-gcp-secret-manager-from-env.ts [options]

Options:
  --dry-run              Print actions only
  --root <dir>           Repo root (default: cwd)
  --env-file <path>      Extra file to merge after .env / .env.local (repeatable)
`);
			process.exit(0);
		}
	}
	return { dryRun, root, extraEnvFiles };
}

function loadMergedEnv(root: string, extraEnvFiles: string[]): Record<string, string> {
	const merged: Record<string, string> = {};
	const paths = [
		resolve(root, '.env'),
		resolve(root, '.env.local'),
		...extraEnvFiles
	];
	for (const p of paths) {
		if (!existsSync(p)) continue;
		const parsed = parseDotenv(readFileSync(p, 'utf8'));
		for (const [k, v] of Object.entries(parsed)) {
			if (v !== undefined) merged[k] = v;
		}
	}
	return merged;
}

function gcloudProject(): string {
	const fromEnv =
		process.env.GCP_PROJECT_ID?.trim() ||
		process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
		process.env.CLOUDSDK_CORE_PROJECT?.trim();
	if (fromEnv) return fromEnv;
	const r = spawnSync('gcloud', ['config', 'get-value', 'project'], { encoding: 'utf8' });
	const p = r.stdout?.trim();
	if (!p || r.status !== 0) {
		console.error('Set GCP_PROJECT_ID or run: gcloud config set project YOUR_PROJECT');
		process.exit(1);
	}
	return p;
}

function accessLatest(project: string, secretId: string): { ok: true; value: string } | { ok: false } {
	const r = spawnSync(
		'gcloud',
		['secrets', 'versions', 'access', 'latest', `--secret=${secretId}`, `--project=${project}`],
		{ encoding: 'utf8' }
	);
	if (r.status !== 0) return { ok: false };
	return { ok: true, value: r.stdout.replace(/\r?\n$/, '') };
}

function secretExists(project: string, secretId: string): boolean {
	const r = spawnSync(
		'gcloud',
		['secrets', 'describe', secretId, `--project=${project}`],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
	);
	return r.status === 0;
}

function createSecret(project: string, secretId: string, dryRun: boolean): void {
	if (dryRun) {
		console.log(`[dry-run] would create secret: ${secretId}`);
		return;
	}
	const r = spawnSync(
		'gcloud',
		[
			'secrets',
			'create',
			secretId,
			'--project',
			project,
			'--replication-policy=automatic'
		],
		{ encoding: 'utf8' }
	);
	if (r.status !== 0) {
		console.error(r.stderr || r.stdout);
		process.exit(1);
	}
}

function addVersion(project: string, secretId: string, value: string, dryRun: boolean): void {
	if (dryRun) {
		console.log(`[dry-run] would add version: ${secretId} (${value.length} chars)`);
		return;
	}
	const r = spawnSync(
		'gcloud',
		['secrets', 'versions', 'add', secretId, '--project', project, '--data-file=-'],
		{ input: value, encoding: 'utf8' }
	);
	if (r.status !== 0) {
		console.error(r.stderr || r.stdout);
		process.exit(1);
	}
}

function normalize(s: string): string {
	return s.replace(/\r?\n$/, '');
}

function main(): void {
	const { dryRun, root, extraEnvFiles } = parseArgs(process.argv.slice(2));
	const project = gcloudProject();
	const env = loadMergedEnv(root, extraEnvFiles);

	const mapping: Record<string, string> = { ...ENV_TO_SECRET };

	console.log(`Project: ${project}`);
	if (dryRun) console.log('Dry run — no changes will be made.\n');

	for (const [envKey, secretId] of Object.entries(mapping)) {
		const raw = env[envKey];
		if (raw === undefined || raw === null || String(raw).trim() === '') {
			console.log(`[skip] ${envKey} → ${secretId} (not set in .env / .env.local)`);
			continue;
		}
		const local = normalize(String(raw));

		const exists = secretExists(project, secretId);
		if (!exists) {
			console.log(`[create+add] ${envKey} → ${secretId} (secret missing)`);
			createSecret(project, secretId, dryRun);
			addVersion(project, secretId, local, dryRun);
			continue;
		}

		const remote = accessLatest(project, secretId);
		if (!remote.ok) {
			console.log(`[add] ${envKey} → ${secretId} (could not read latest; adding version)`);
			addVersion(project, secretId, local, dryRun);
			continue;
		}

		if (remote.value === local) {
			console.log(`[unchanged] ${secretId}`);
			continue;
		}

		console.log(`[update] ${envKey} → ${secretId} (value differs)`);
		addVersion(project, secretId, local, dryRun);
	}

	console.log('\nDone. Redeploy Cloud Run if you need a new revision to bind secret versions.');
}

main();
