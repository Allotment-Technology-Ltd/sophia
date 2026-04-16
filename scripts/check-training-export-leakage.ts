/**
 * Fail if any **train / validation / test** JSONL line references a golden eval URL (canonical match).
 * Does not inspect `golden_holdout*.jsonl` by design.
 *
 *   pnpm ops:check-training-export-leakage -- --export-dir=data/phase1-training-export
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadGoldenExtractionEval } from '../src/lib/server/ingestion/goldenExtractionEval.ts';
import { canonicalizeSourceUrl } from '../src/lib/server/sourceIdentity.ts';

function parseArgs() {
	const dirArg = process.argv.find((x) => x.startsWith('--export-dir='));
	const outDir = dirArg?.slice('--export-dir='.length)?.trim();
	return { outDir: outDir || '' };
}

function isTrainValTestShard(name: string): boolean {
	if (!name.endsWith('.jsonl')) return false;
	if (name.startsWith('golden_holdout')) return false;
	return (
		name === 'train.jsonl' ||
		name.startsWith('train.') ||
		name === 'validation.jsonl' ||
		name.startsWith('validation.') ||
		name === 'test.jsonl' ||
		name.startsWith('test.')
	);
}

function main() {
	const { outDir } = parseArgs();
	if (!outDir) {
		console.error('Usage: pnpm exec tsx scripts/check-training-export-leakage.ts -- --export-dir=data/phase1-training-export');
		process.exit(2);
	}

	const golden = loadGoldenExtractionEval();
	const goldenCanon = new Set<string>();
	for (const it of golden.items) {
		const c = canonicalizeSourceUrl(it.url.trim());
		if (c) goldenCanon.add(c);
	}

	let files: string[];
	try {
		files = readdirSync(outDir).filter(isTrainValTestShard);
	} catch (e) {
		console.error(`Cannot read export dir: ${outDir}`, e);
		process.exit(2);
	}

	if (files.length === 0) {
		console.error(`No train/validation/test *.jsonl shards found under ${outDir}`);
		process.exit(2);
	}

	let leaks = 0;
	for (const f of files) {
		const content = readFileSync(join(outDir, f), 'utf8');
		for (const line of content.split('\n')) {
			if (!line.trim()) continue;
			let obj: { source_url?: string };
			try {
				obj = JSON.parse(line) as { source_url?: string };
			} catch {
				console.error(`Invalid JSONL in ${f}`);
				process.exit(2);
			}
			const url = obj.source_url;
			if (!url || typeof url !== 'string') continue;
			const c = canonicalizeSourceUrl(url);
			if (c && goldenCanon.has(c)) {
				console.error(`Golden URL leak: ${f} — ${url.trim()}`);
				leaks++;
			}
		}
	}

	if (leaks > 0) {
		console.error(`FAILED: ${leaks} golden URL line(s) in train/val/test shards.`);
		process.exit(1);
	}

	console.log(
		JSON.stringify(
			{
				ok: true,
				exportDir: outDir,
				filesChecked: files,
				goldenCanonicalUrls: goldenCanon.size
			},
			null,
			2
		)
	);
}

try {
	main();
} catch (e) {
	console.error(e);
	process.exit(1);
}
