#!/usr/bin/env node
/**
 * Guardrails for SurrealDB SCHEMAFULL writes (see src/lib/server/surrealRecordSql.ts).
 * Run from repo root: pnpm check:surreal-writes
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const FILES = [
	'scripts/ingest.ts',
	'scripts/backfill-graph-context.ts',
	'scripts/reconcile-thinker-links.ts',
	'scripts/import-thinker-graph.ts'
];

const PATTERNS: { name: string; re: RegExp; hint: string }[] = [
	{
		name: 'type::thing($source)',
		re: /type::thing\(\s*\$source\s*\)/g,
		hint: "Use type::record('source', $source_row_key) with recordKeyForTable(..., 'source')."
	},
	{
		name: 'LET $to = type::thing',
		re: /LET\s+\$to\s*=\s*type::thing/g,
		hint: 'Use type::record for record construction on this Surreal build.'
	},
	{
		name: 'raw source_id binding',
		re: /source_id:\s*\$source_id\b/g,
		hint: 'Use SOURCE_ID_STRING_SQL and source_row_key (string::concat) for SCHEMAFULL string fields.'
	}
];

let failures = 0;
for (const rel of FILES) {
	const file = path.join(ROOT, rel);
	if (!fs.existsSync(file)) continue;
	const text = fs.readFileSync(file, 'utf8');
	for (const { name, re, hint } of PATTERNS) {
		re.lastIndex = 0;
		if (re.test(text)) {
			console.error(`[check-surreal-writes] ${rel}: forbidden pattern "${name}"\n  → ${hint}`);
			failures += 1;
		}
	}
}

if (failures > 0) {
	console.error(`\n[check-surreal-writes] ${failures} issue(s). See surrealRecordSql.ts.`);
	process.exit(1);
}
console.log('[check-surreal-writes] OK');
