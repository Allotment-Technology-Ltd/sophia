#!/usr/bin/env node
/**
 * Guardrails for SurrealDB SCHEMAFULL writes (see src/lib/server/surrealRecordSql.ts).
 * Run from repo root: pnpm check:surreal-writes
 *
 * Catches SurrealDB 2.x parser failures on the ingest / graph write paths:
 * - `RELATE type::record(...)` / `RELATE type::thing(...)` — invalid; use LET + `RELATE $from->edge->$to`.
 * - Legacy `type::thing` in hot paths (ingest) — removed upstream; keep regressions out.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();

/** Files that must stay compatible with SurrealDB 2.x graph + ingest store semantics. */
const FILES = [
	'scripts/ingest.ts',
	'scripts/ingest-testbackup.ts',
	'scripts/ingest-batch.ts',
	'scripts/backfill-graph-context.ts',
	'scripts/reconcile-thinker-links.ts',
	'scripts/import-thinker-graph.ts',
	'scripts/migrate-local-to-prod.ts',
	'src/lib/server/batch-inserter.ts'
];

const PATTERNS: { name: string; re: RegExp; hint: string }[] = [
	{
		name: 'RELATE type::record or type::thing',
		re: /RELATE\s+type::(?:record|thing)\s*\(/g,
		hint:
			'SurrealDB 2.x rejects this syntax. Use: LET $from = type::record($tb,$key); LET $to = …; RELATE $from->table->$to …'
	},
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

/** Ingest entrypoints: never reintroduce type::thing( — server suggests type::record and ingest store breaks. */
const INGEST_NO_THING_FILES = ['scripts/ingest.ts', 'scripts/ingest-batch.ts'] as const;
const TYPE_THING_CALL = /type::thing\s*\(/g;

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

for (const rel of INGEST_NO_THING_FILES) {
	const file = path.join(ROOT, rel);
	if (!fs.existsSync(file)) continue;
	const text = fs.readFileSync(file, 'utf8');
	TYPE_THING_CALL.lastIndex = 0;
	if (TYPE_THING_CALL.test(text)) {
		console.error(
			`[check-surreal-writes] ${rel}: forbidden pattern "type::thing("\n` +
				'  → SurrealDB 2.x: use type::record(table, idPart) or LET + variables; see surrealRecordSql.ts.'
		);
		failures += 1;
	}
}

if (failures > 0) {
	console.error(`\n[check-surreal-writes] ${failures} issue(s). See surrealRecordSql.ts.`);
	process.exit(1);
}
console.log('[check-surreal-writes] OK');
