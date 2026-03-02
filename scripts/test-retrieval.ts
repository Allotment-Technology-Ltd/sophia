/**
 * SOPHIA — End-to-End Retrieval Test
 *
 * Tests that argument-aware retrieval returns meaningful context for
 * the Phase 1 test queries. Run after each ingestion wave to verify
 * retrieval health.
 *
 * Usage: npx tsx --env-file=.env scripts/test-retrieval.ts
 *
 * Requires: Wave 1+ data ingested and VOYAGE_API_KEY set.
 * Note: Queries 8–10 are outside the current ethics domain — EMPTY/PARTIAL
 *       results for those are expected and are not counted as failures.
 */

import * as fs from 'fs';
import * as path from 'path';

// Import via relative path (tsx resolves these; no $lib alias needed)
import { retrieveContext } from '../src/lib/server/retrieval.js';
import { closeDb } from '../src/lib/server/db.js';
import type { RetrievalResult } from '../src/lib/server/retrieval.js';

// ─── Test queries ─────────────────────────────────────────────────────────────
const TEST_QUERIES = [
	// Queries 1-7: ethics — expect GOOD once data is ingested
	'Is moral relativism defensible?',
	'My employer wants me to implement an AI surveillance system. How should I think about this?',
	'Is it ethical to use AI triage systems when they perform worse for elderly patients?',
	'Assess the utilitarian vs deontological reasoning on organ transplant allocation',
	'Assess the ethical assumptions behind the EU AI Act',
	'Should I have children given climate change?',
	'Is there a coherent concept of AI rights?',
	// Queries 8-10: outside current ethics corpus — EMPTY/PARTIAL expected
	'When is it rational to believe something without evidence?',
	'Is consciousness an illusion?',
	'Evaluate the case for and against universal basic income'
] as const;

// 0-indexed positions of queries outside the current ethics domain
const OUT_OF_DOMAIN = new Set([7, 8, 9]);

// ─── Types ───────────────────────────────────────────────────────────────────
type Score = 'GOOD' | 'PARTIAL' | 'EMPTY';

interface QueryResult {
	index: number;
	query: string;
	claims_retrieved: number;
	arguments_retrieved: number;
	relations_in_context: number;
	top_claims: Array<{
		text: string;
		source_title: string;
		claim_type: string;
		domain: string;
	}>;
	arguments_found: Array<{ name: string; tradition: string | null }>;
	score: Score;
	out_of_domain: boolean;
	duration_ms: number;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
function score(result: RetrievalResult): Score {
	if (result.claims.length === 0) return 'EMPTY';
	if (result.claims.length >= 3 && result.arguments.length >= 1) return 'GOOD';
	return 'PARTIAL';
}

// ─── Display ─────────────────────────────────────────────────────────────────
const WIDE = '═'.repeat(60);
const THIN = '─'.repeat(60);

function scoreTag(s: Score, outOfDomain: boolean): string {
	const base = s === 'GOOD' ? '✓ GOOD' : s === 'PARTIAL' ? '~ PARTIAL' : '✗ EMPTY';
	return outOfDomain ? `${base}  (expected — outside current domain coverage)` : base;
}

function trunc(text: string, max: number): string {
	return text.length > max ? text.substring(0, max - 3) + '...' : text;
}

function printResult(qr: QueryResult, total: number): void {
	console.log(`\nQuery ${qr.index + 1}/${total}: "${qr.query}"`);
	console.log(THIN);
	console.log(`  Claims retrieved:     ${qr.claims_retrieved}`);
	console.log(`  Arguments retrieved:  ${qr.arguments_retrieved}`);
	console.log(`  Relations in context: ${qr.relations_in_context}`);
	console.log(`  Duration:             ${qr.duration_ms}ms`);

	if (qr.top_claims.length > 0) {
		console.log('');
		console.log('  Top 3 claims:');
		for (const c of qr.top_claims) {
			console.log(`    [${c.claim_type}, ${c.domain}]`);
			console.log(`    "${trunc(c.text, 90)}"`);
			console.log(`    — ${c.source_title}`);
		}
	}

	if (qr.arguments_found.length > 0) {
		console.log('');
		console.log('  Arguments found:');
		for (const a of qr.arguments_found) {
			const trad = a.tradition ? ` (${a.tradition})` : '';
			console.log(`    • "${a.name}"${trad}`);
		}
	}

	console.log('');
	console.log(`  Score: ${scoreTag(qr.score, qr.out_of_domain)}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
	const REPORTS_DIR = './data/reports';

	console.log(WIDE);
	console.log('SOPHIA — END-TO-END RETRIEVAL TEST');
	console.log(WIDE);
	console.log('');
	console.log(`  ${TEST_QUERIES.length} queries  |  ethics corpus (Wave 1–3)`);
	console.log('  Queries 8–10: non-ethics domain — EMPTY/PARTIAL is expected');
	console.log('');

	// Suppress the retrieval module's verbose progress logs so our output stays clean.
	// Errors and warnings are also suppressed: retrieval.ts never throws — an error
	// there just means EMPTY, which the score captures.
	const origLog = console.log;
	const origError = console.error;
	const origWarn = console.warn;

	const results: QueryResult[] = [];

	for (let i = 0; i < TEST_QUERIES.length; i++) {
		const queryText = TEST_QUERIES[i];

		process.stdout.write(`  [${String(i + 1).padStart(2)}/${TEST_QUERIES.length}] Running... `);

		// Silence retrieval module output during the call
		console.log = () => {};
		console.error = () => {};
		console.warn = () => {};

		const t0 = Date.now();
		const result = await retrieveContext(queryText, { topK: 5, domain: 'ethics' });
		const duration = Date.now() - t0;

		console.log = origLog;
		console.error = origError;
		console.warn = origWarn;

		const s = score(result);
		const tag = s === 'GOOD' ? '✓' : s === 'PARTIAL' ? '~' : '✗';
		process.stdout.write(
			`${tag} ${result.claims.length} claims, ${result.arguments.length} args  (${duration}ms)\n`
		);

		results.push({
			index: i,
			query: queryText,
			claims_retrieved: result.claims.length,
			arguments_retrieved: result.arguments.length,
			relations_in_context: result.relations.length,
			top_claims: result.claims.slice(0, 3).map((c) => ({
				text: c.text,
				source_title: c.source_title,
				claim_type: c.claim_type,
				domain: c.domain
			})),
			arguments_found: result.arguments.map((a) => ({
				name: a.name,
				tradition: a.tradition
			})),
			score: s,
			out_of_domain: OUT_OF_DOMAIN.has(i),
			duration_ms: duration
		});
	}

	await closeDb();

	// ── Per-query detail ────────────────────────────────────────────────────
	console.log('\n\n' + WIDE);
	console.log('DETAILED RESULTS');
	console.log(WIDE);
	for (const qr of results) {
		printResult(qr, TEST_QUERIES.length);
	}

	// ── Summary ──────────────────────────────────────────────────────────────
	const good = results.filter((r) => r.score === 'GOOD').length;
	const partial = results.filter((r) => r.score === 'PARTIAL').length;
	const empty = results.filter((r) => r.score === 'EMPTY').length;
	const total = results.length;

	const inDomain = results.filter((r) => !r.out_of_domain);
	const inDomainGood = inDomain.filter((r) => r.score === 'GOOD').length;
	const inDomainPartial = inDomain.filter((r) => r.score === 'PARTIAL').length;

	// Coverage: GOOD = 1.0, PARTIAL = 0.5, EMPTY = 0
	const coverage = Math.round(((good + partial * 0.5) / total) * 100);
	const inDomainCoverage =
		inDomain.length > 0
			? Math.round(((inDomainGood + inDomainPartial * 0.5) / inDomain.length) * 100)
			: 0;

	console.log('\n' + WIDE);
	console.log('SUMMARY');
	console.log(WIDE);
	console.log('');
	console.log(`  Results: ${good} GOOD, ${partial} PARTIAL, ${empty} EMPTY`);
	console.log(`  Retrieval coverage (all queries):  ${coverage}%`);
	console.log(
		`  In-domain coverage (queries 1–7):  ${inDomainCoverage}%` +
			`  (${inDomainGood} GOOD, ${inDomainPartial} PARTIAL)`
	);

	const outOfDomain = results.filter((r) => r.out_of_domain);
	if (outOfDomain.length > 0) {
		console.log('');
		console.log('  Out-of-domain queries (non-ethics — gaps are expected):');
		for (const r of outOfDomain) {
			console.log(`    Q${r.index + 1}: "${trunc(r.query, 55)}"  → ${r.score}`);
		}
	}

	console.log('');
	if (inDomainCoverage < 30 && inDomain.some((r) => r.score !== 'GOOD')) {
		console.log('  ⚠ WARNING: In-domain coverage is very low. Possible causes:');
		console.log('      – No data ingested yet (run ./scripts/run-wave.sh 1)');
		console.log('      – Embeddings were not stored (check ingest.ts Stage 4)');
		console.log('      – DB connection failed (check SURREAL_URL in .env)');
		console.log('      – VOYAGE_API_KEY not set (needed to embed the test queries)');
	} else if (inDomainCoverage >= 70) {
		console.log('  ✓ In-domain retrieval is healthy.');
	} else {
		console.log('  ~ In-domain coverage is partial. More waves may improve it.');
	}

	// ── Save report ──────────────────────────────────────────────────────────
	if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
	const filePath = path.join(REPORTS_DIR, `retrieval-test-${ts}.json`);

	fs.writeFileSync(
		filePath,
		JSON.stringify(
			{
				timestamp: new Date().toISOString(),
				summary: {
					good,
					partial,
					empty,
					total,
					coverage_pct: coverage,
					in_domain_coverage_pct: inDomainCoverage
				},
				results
			},
			null,
			2
		),
		'utf-8'
	);

	console.log('');
	console.log(`  Report saved: ${filePath}`);
	console.log(WIDE);
}

main().catch((err) => {
	console.error('[ERROR]', err instanceof Error ? err.message : err);
	process.exit(1);
});
