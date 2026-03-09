/**
 * SOPHIA — Retrieval Validation Script
 *
 * Tests semantic retrieval against the live DB for a given domain.
 * Checks that ≥3 relevant claims are returned for each query.
 *
 * Usage: npx tsx --env-file=.env --env-file=.env.local scripts/validate-retrieval.ts [--domain <domain>]
 */

import { retrieveContext } from '../src/lib/server/retrieval.js';

const TEST_QUERIES: Array<{ query: string; keywords: string[] }> = [
	{
		query: 'What is the hard problem of consciousness and why is it difficult?',
		keywords: ['hard problem', 'consciousness', 'qualia', 'subjective', 'experience']
	},
	{
		query: 'Can a machine or AI system be conscious?',
		keywords: ['machine', 'artificial', 'conscious', 'intelligence', 'Turing', 'functionalism']
	},
	{
		query: 'What are qualia and why do they matter for the philosophy of mind?',
		keywords: ['qualia', 'phenomenal', 'experience', 'what it is like', 'Mary']
	},
	{
		query: 'Does the Chinese Room argument refute strong AI?',
		keywords: ['Chinese Room', 'Searle', 'strong AI', 'intentionality', 'syntax', 'semantics']
	},
	{
		query: 'What is functionalism about mental states?',
		keywords: ['functionalism', 'mental states', 'functional', 'multiple realizability', 'Turing']
	}
];

const PASS_THRESHOLD = 3; // minimum claims per query to pass

async function main() {
	const args = process.argv.slice(2);
	const domainIdx = args.findIndex((a) => a === '--domain');
	const domain = domainIdx !== -1 ? (args[domainIdx + 1] as any) : undefined;

	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║         SOPHIA — RETRIEVAL VALIDATION                       ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	if (domain) console.log(`Domain filter: ${domain}`);
	console.log(`Pass threshold: ≥${PASS_THRESHOLD} claims per query\n`);

	let passed = 0;
	let failed = 0;

	for (let i = 0; i < TEST_QUERIES.length; i++) {
		const { query, keywords } = TEST_QUERIES[i];
		console.log(`─────────────────────────────────────────────────────────────`);
		console.log(`[${i + 1}/${TEST_QUERIES.length}] ${query}`);

		try {
			const result = await retrieveContext(query, { domain, topK: 8 });
			const claimCount = result.claims.length;
			const argCount = result.arguments.length;

			// Check keyword coverage
			const allText = result.claims.map((c) => c.text.toLowerCase()).join(' ');
			const keywordsHit = keywords.filter((k) => allText.includes(k.toLowerCase()));

			const queryPassed = claimCount >= PASS_THRESHOLD;
			if (queryPassed) passed++;
			else failed++;

			console.log(`  ${queryPassed ? '✓' : '✗'} Claims: ${claimCount} | Arguments: ${argCount} | Keywords hit: ${keywordsHit.length}/${keywords.length}`);

			// Show top 3 claims
			result.claims.slice(0, 3).forEach((c, j) => {
				const src = typeof c.source_title === 'string' ? c.source_title : '?';
				console.log(`  [${j + 1}] (${c.domain}) ${c.text.substring(0, 100)}...`);
				console.log(`       — ${src}`);
			});

			if (keywordsHit.length > 0) {
				console.log(`  Keywords matched: ${keywordsHit.join(', ')}`);
			}
		} catch (err) {
			console.error(`  ✗ ERROR: ${err instanceof Error ? err.message : String(err)}`);
			failed++;
		}
		console.log('');
	}

	console.log('═══════════════════════════════════════════════════════════════');
	console.log(`RESULT: ${passed}/${TEST_QUERIES.length} queries passed (≥${PASS_THRESHOLD} claims each)`);
	if (failed === 0) {
		console.log('✓ All queries passed — knowledge base is queryable');
	} else {
		console.log(`✗ ${failed} queries failed — review retrieval or add more sources`);
	}
	console.log('═══════════════════════════════════════════════════════════════\n');

	process.exit(failed > 0 ? 1 : 0);
}

main();
