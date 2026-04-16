/**
 * Validate **`manifest.json`** from a training JSONL export directory (Phase 2 G0/G1 hygiene).
 *
 *   pnpm ops:audit-training-export-manifest -- --export-dir=data/g1-policy
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs() {
	const dirArg = process.argv.find((x) => x.startsWith('--export-dir='));
	const outDir = dirArg?.slice('--export-dir='.length)?.trim() || '';
	return { outDir };
}

function main() {
	const { outDir } = parseArgs();
	if (!outDir) {
		console.error('Usage: pnpm exec tsx scripts/audit-training-export-manifest.ts -- --export-dir=<path>');
		process.exit(2);
	}

	const manifestPath = join(outDir, 'manifest.json');
	if (!existsSync(manifestPath)) {
		console.error(`Missing ${manifestPath}`);
		process.exit(1);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (e) {
		console.error('Invalid JSON in manifest.json', e);
		process.exit(1);
	}

	const m = raw as Record<string, unknown>;
	const errors: string[] = [];

	const need = (key: string, pred: (v: unknown) => boolean) => {
		const v = m[key];
		if (!pred(v)) errors.push(`manifest.${key}: missing or invalid`);
	};

	need('generatedAt', (v) => typeof v === 'string' && v.length > 0);
	need('phase', (v) => typeof v === 'string' && v.length > 0);
	need('extractionClaimSchemaPointer', (v) => typeof v === 'string' && v.length > 0);

	const cohort = m.cohort as Record<string, unknown> | undefined;
	if (!cohort || typeof cohort.cohortFingerprintSha256_16 !== 'string') {
		errors.push('manifest.cohort.cohortFingerprintSha256_16: missing');
	}

	const counts = m.counts as Record<string, unknown> | undefined;
	if (!counts) {
		errors.push('manifest.counts: missing');
	}

	const prov = m.provenance as Record<string, unknown> | undefined;
	if (!prov) {
		errors.push('manifest.provenance: missing');
	} else {
		const ids = prov.neon_run_ids;
		if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === 'string')) {
			errors.push('manifest.provenance.neon_run_ids: must be non-empty string[]');
		}
		const byRun = prov.extraction_model_by_run_id;
		if (!byRun || typeof byRun !== 'object' || Array.isArray(byRun)) {
			errors.push('manifest.provenance.extraction_model_by_run_id: must be object');
		}
	}

	if (errors.length > 0) {
		for (const e of errors) console.error(e);
		process.exit(1);
	}

	console.log(
		JSON.stringify(
			{
				ok: true,
				exportDir: outDir,
				phase: m.phase,
				generatedAt: m.generatedAt,
				neonRunCount: Array.isArray((m.provenance as { neon_run_ids?: unknown }).neon_run_ids)
					? (m.provenance as { neon_run_ids: string[] }).neon_run_ids.length
					: 0
			},
			null,
			2
		)
	);
}

main();
