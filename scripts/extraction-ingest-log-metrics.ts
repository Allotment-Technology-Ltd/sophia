/**
 * Summarise extraction JSON health signals from a captured `scripts/ingest.ts` log
 * (baseline vs candidate deployment smoke). Reads a file path from argv.
 *
 *   pnpm exec tsx scripts/extraction-ingest-log-metrics.ts /tmp/ingest-candidate.log
 *
 * Counts are line-based substrings (best-effort; resilient to minor log wording drift).
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
	console.error('Usage: tsx scripts/extraction-ingest-log-metrics.ts <logfile>');
	process.exit(2);
}

const text = readFileSync(path, 'utf8');
const lines = text.split('\n');

const countLines = (s: string) => lines.filter((l) => l.includes(s)).length;
const countText = (re: RegExp) => (text.match(re) ?? []).length;

const out = {
	logPath: path,
	bytes: text.length,
	lines: lines.length,
	json_fail_lines: countText(/\[JSON_FAIL\]/g),
	extraction_ok_lines: countLines('[OK] Extracted'),
	extraction_repair_ok_lines: countLines('[OK] Fixed and extracted'),
	batch_split_lines: countLines('[SPLIT] Batch'),
	ingest_model_json_parse_failed_mentions: countText(/ingest_model_json_parse_failed/g)
};

console.log(`${JSON.stringify(out, null, 2)}\n`);
