/**
 * Run the two canonical extraction eval slices (golden holdout + remit multidomain)
 * and write one JSON file for easy diff between FT iterations.
 *
 * Usage:
 *   pnpm ops:eval-extraction-compare
 *     (defaults: --export-dir data/phase1-training-export --limit 200 --out <export-dir>/eval-compare.json)
 *
 *   pnpm ops:eval-extraction-compare -- --export-dir data/phase1-training-export --limit 200 --out data/phase1-training-export/eval-compare-baseline.json
 *
 * Requires the same env as scripts/eval-extraction-holdout-openai-compatible.ts (EXTRACTION_*).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs(argv: string[]): {
	exportDir: string;
	limit: number;
	out: string;
	skipRemitSample: boolean;
} {
	let exportDir = 'data/phase1-training-export';
	let limit = 200;
	let out = '';
	let skipRemitSample = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--export-dir' && argv[i + 1]) exportDir = argv[++i]!;
		else if (a === '--limit' && argv[i + 1]) limit = Math.max(1, parseInt(argv[++i]!, 10));
		else if (a === '--out' && argv[i + 1]) out = argv[++i]!;
		else if (a === '--skip-remit-sample') skipRemitSample = true;
	}
	if (!out) {
		out = join(exportDir, 'eval-compare.json');
		console.error(`[eval-compare] default --out ${out} (pass --out to override)`);
	}
	return { exportDir, limit, out, skipRemitSample };
}

function runEval(jsonl: string, limit: number, outPath: string, mismatchDiagnostics: boolean): void {
	const args = [
		'exec',
		'tsx',
		'scripts/eval-extraction-holdout-openai-compatible.ts',
		'--',
		'--jsonl',
		jsonl,
		'--limit',
		String(limit),
		'--out',
		outPath
	];
	if (mismatchDiagnostics) args.push('--mismatch-diagnostics');
	const r = spawnSync('pnpm', args, {
		cwd: process.cwd(),
		env: process.env,
		stdio: ['inherit', 'pipe', 'pipe'],
		encoding: 'utf8'
	});
	if (r.status !== 0) {
		console.error(r.stderr || r.stdout || `eval failed with exit ${r.status}`);
		process.exit(r.status ?? 1);
	}
}

function readReport(path: string): Record<string, unknown> {
	if (!existsSync(path)) {
		throw new Error(`Expected eval output missing: ${path}`);
	}
	const raw = readFileSync(path, 'utf8');
	return JSON.parse(raw) as Record<string, unknown>;
}

function readManifestFingerprints(exportDir: string): {
	cohortFingerprintSha256_16: string | null;
	goldenFingerprintSha256_16: string | null;
	manifestGeneratedAt: string | null;
} {
	const mPath = join(exportDir, 'manifest.json');
	if (!existsSync(mPath)) {
		return { cohortFingerprintSha256_16: null, goldenFingerprintSha256_16: null, manifestGeneratedAt: null };
	}
	try {
		const m = JSON.parse(readFileSync(mPath, 'utf8')) as Record<string, unknown>;
		const cohort = (m.cohort as Record<string, unknown> | undefined)?.cohortFingerprintSha256_16;
		const golden = (m.goldenSet as Record<string, unknown> | undefined)?.fingerprintSha256_16;
		const generatedAt = typeof m.generatedAt === 'string' ? m.generatedAt : null;
		return {
			cohortFingerprintSha256_16: typeof cohort === 'string' ? cohort : null,
			goldenFingerprintSha256_16: typeof golden === 'string' ? golden : null,
			manifestGeneratedAt: generatedAt
		};
	} catch {
		return { cohortFingerprintSha256_16: null, goldenFingerprintSha256_16: null, manifestGeneratedAt: null };
	}
}

async function main(): Promise<void> {
	const { exportDir, limit, out, skipRemitSample } = parseArgs(process.argv.slice(2));
	const goldenJsonl = join(exportDir, 'golden_holdout.jsonl');
	const remitJsonl = join(exportDir, 'eval_remit_multidomain.jsonl');
	const goldenReportPath = join(exportDir, `.eval-compare-golden-${limit}.tmp.json`);
	const remitReportPath = join(exportDir, `.eval-compare-remit-${limit}.tmp.json`);

	if (!existsSync(goldenJsonl)) {
		console.error(`Missing ${goldenJsonl}`);
		process.exit(2);
	}

	if (!skipRemitSample && !existsSync(remitJsonl)) {
		console.log(`[eval-compare] Sampling remit JSONL → ${remitJsonl}`);
		const samp = spawnSync(
			'pnpm',
			[
				'exec',
				'tsx',
				'scripts/sample-extraction-remit-eval-jsonl.ts',
				'--',
				'--export-dir',
				exportDir,
				'--out',
				remitJsonl,
				'--total',
				String(limit),
				'--seed',
				'42'
			],
			{ cwd: process.cwd(), env: process.env, stdio: 'inherit' }
		);
		if (samp.status !== 0) process.exit(samp.status ?? 1);
	}

	if (!existsSync(remitJsonl)) {
		console.error(`Missing ${remitJsonl} (run sample script or drop --skip-remit-sample)`);
		process.exit(2);
	}

	console.log(`[eval-compare] Golden holdout → ${goldenReportPath}`);
	runEval(goldenJsonl, limit, goldenReportPath, true);
	console.log(`[eval-compare] Remit multidomain → ${remitReportPath}`);
	runEval(remitJsonl, limit, remitReportPath, true);

	const golden = readReport(goldenReportPath);
	const remit = readReport(remitReportPath);
	const fingerprints = readManifestFingerprints(exportDir);

	const combined = {
		generatedAt: new Date().toISOString(),
		kind: 'extraction_eval_compare',
		exportDir,
		limit,
		manifestFingerprints: fingerprints,
		goldenHoldout: { jsonl: goldenJsonl, reportPath: goldenReportPath, report: golden },
		remitMultidomain: { jsonl: remitJsonl, reportPath: remitReportPath, report: remit },
		summary: {
			golden: {
				schemaPassRate: golden.schemaPassRate,
				subsetTextMatchRate: golden.subsetTextMatchRate,
				subsetMatchRate: golden.subsetMatchRate,
				latencyMs: golden.latencyMs,
				modelId: golden.modelId
			},
			remit: {
				schemaPassRate: remit.schemaPassRate,
				subsetTextMatchRate: remit.subsetTextMatchRate,
				subsetMatchRate: remit.subsetMatchRate,
				latencyMs: remit.latencyMs,
				modelId: remit.modelId
			}
		}
	};

	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(combined, null, 2)}\n`, 'utf8');
	try {
		unlinkSync(goldenReportPath);
	} catch {
		/* ignore */
	}
	try {
		unlinkSync(remitReportPath);
	} catch {
		/* ignore */
	}
	console.log(`[eval-compare] Wrote ${out}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
