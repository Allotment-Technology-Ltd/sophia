/**
 * Phase 2 Step A — package G1 export shards into Together chat JSONL + token histogram report.
 *
 * Prerequisites: frozen `train.jsonl`, `validation.jsonl`, `test.jsonl` (+ `manifest.json`) from
 * `pnpm ops:phase1-export-training-jsonl` (e.g. with `--g1-policy-cleared`).
 *
 * Writes next to the export dir:
 *   - `train.together.jsonl`, `validation.together.jsonl`, `test.together.jsonl` (skipped if source missing)
 *   - `step-a-together-packaging-report.json` — manifest pointer + per-split converter summaries
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/phase2-step-a-together-packaging.ts -- --export-dir=data/phase1-training-export
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerEnv } from '../src/lib/server/env.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const SPLITS = ['train', 'validation', 'test'] as const;

function parseExportDir(argv: string[]): string {
	let dir = 'data/phase1-training-export';
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--export-dir' && argv[i + 1]) dir = argv[++i]!;
	}
	return dir;
}

async function main() {
	loadServerEnv();
	const exportDir = parseExportDir(process.argv.slice(2));
	const manifestPath = join(exportDir, 'manifest.json');

	if (!existsSync(manifestPath)) {
		console.error(
			`Missing ${manifestPath}. Run first:\n  pnpm ops:phase1-export-training-jsonl -- --g1-policy-cleared --out-dir=${exportDir}`
		);
		process.exit(2);
	}

	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
	const perSplit: Record<string, unknown>[] = [];

	for (const split of SPLITS) {
		const input = join(exportDir, `${split}.jsonl`);
		if (!existsSync(input)) {
			perSplit.push({ split, skipped: true, reason: 'file missing' });
			continue;
		}
		const output = join(exportDir, `${split}.together.jsonl`);
		const statsJson = output.replace(/\.jsonl$/i, '.token-stats.json');
		execFileSync(
			'pnpm',
			[
				'exec',
				'tsx',
				'scripts/convert-phase1-jsonl-to-together-chat.ts',
				'--',
				'--input',
				input,
				'--output',
				output,
				'--emit-stats-json'
			],
			{
				cwd: repoRoot,
				stdio: 'inherit'
			}
		);
		const statsSummary = JSON.parse(readFileSync(statsJson, 'utf8')) as unknown;
		perSplit.push({ split, output, statsJson, converterSummary: statsSummary });
	}

	const cohort = manifest.cohort as { cohortFingerprintSha256_16?: string } | undefined;
	const goldenSet = manifest.goldenSet as { fingerprintSha256_16?: string } | undefined;
	const report = {
		generatedAt: new Date().toISOString(),
		exportDir,
		manifestGeneratedAt: manifest.generatedAt ?? null,
		cohortFingerprintSha256_16: cohort?.cohortFingerprintSha256_16 ?? null,
		goldenFingerprintSha256_16: goldenSet?.fingerprintSha256_16 ?? null,
		manifestPath,
		splits: perSplit
	};

	const reportPath = join(exportDir, 'step-a-together-packaging-report.json');
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	console.log(`\nWrote ${reportPath}`);
	console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
