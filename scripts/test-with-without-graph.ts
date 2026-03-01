/**
 * SOPHIA — Three-Pass Comparison Test
 *
 * Runs the dialectical engine with and without graph context on 10 test queries
 * to measure the knowledge-graph improvement.
 *
 * Usage: npx tsx --env-file=.env scripts/test-with-without-graph.ts
 *
 * ⚠  COST WARNING: 10 queries × (6 Sonnet passes + 1 Haiku scoring call) ≈ £0.80–1.30.
 *    The Phase 3b checklist estimates £0.30–0.50 — actual cost depends on output length.
 *    Run --dry-run to print the test plan without making any API calls.
 *
 * Phase 3b quality gate: with-graph must beat without-graph on ≥6/10 queries.
 */

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// Relative imports — these modules use process.env, not SvelteKit $env
import { retrieveContext, buildContextBlock } from '../src/lib/server/retrieval.js';
import { closeDb } from '../src/lib/server/db.js';
import {
	getAnalysisSystemPrompt,
	buildAnalysisUserPrompt
} from '../src/lib/server/prompts/analysis.js';
import {
	getCritiqueSystemPrompt,
	buildCritiqueUserPrompt
} from '../src/lib/server/prompts/critique.js';
import {
	getSynthesisSystemPrompt,
	buildSynthesisUserPrompt
} from '../src/lib/server/prompts/synthesis.js';

// ─── Configuration ─────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MAIN_MODEL = 'claude-sonnet-4-5-20250929';
const SCORING_MODEL = 'claude-haiku-4-5-20251001'; // Cheaper for the meta-scoring call
const REPORTS_DIR = './data/reports';

// ─── Test queries ─────────────────────────────────────────────────────────────
const TEST_QUERIES = [
	// 1–7: ethics domain — expect GOOD retrieval once data is ingested
	'Is moral relativism defensible?',
	'My employer wants me to implement an AI surveillance system. How should I think about this?',
	'Is it ethical to use AI triage systems when they perform worse for elderly patients?',
	'Assess the utilitarian vs deontological reasoning on organ transplant allocation',
	'Assess the ethical assumptions behind the EU AI Act',
	'Should I have children given climate change?',
	'Is there a coherent concept of AI rights?',
	// 8–10: outside current ethics corpus — context improvement not expected
	'When is it rational to believe something without evidence?',
	'Is consciousness an illusion?',
	'Evaluate the case for and against universal basic income'
] as const;

const OUT_OF_DOMAIN = new Set([7, 8, 9]);

// ─── Types ─────────────────────────────────────────────────────────────────
interface PassOutputs {
	analysis: string;
	critique: string;
	synthesis: string;
	claims_retrieved: number;
	arguments_retrieved: number;
	input_tokens: number;
	output_tokens: number;
	duration_ms: number;
}

interface ScoreResult {
	specificity_a: number;
	specificity_b: number;
	accuracy_a: number;
	accuracy_b: number;
	depth_a: number;
	depth_b: number;
	balance_a: number;
	balance_b: number;
	winner: 'A' | 'B' | 'tie';
	reason: string;
}

interface QueryComparison {
	index: number;
	query: string;
	out_of_domain: boolean;
	without: PassOutputs;
	with: PassOutputs;
	scores: ScoreResult | null;
	score_error?: string;
}

// ─── Engine helpers ───────────────────────────────────────────────────────────
function makeAnthropicClient(): Anthropic {
	if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');
	return new Anthropic({ apiKey: ANTHROPIC_API_KEY });
}

async function runPass(
	client: Anthropic,
	systemPrompt: string,
	userPrompt: string,
	maxTokens: number
): Promise<{ text: string; input_tokens: number; output_tokens: number }> {
	const stream = client.messages.stream({
		model: MAIN_MODEL,
		max_tokens: maxTokens,
		system: systemPrompt,
		messages: [{ role: 'user', content: userPrompt }]
	});

	let text = '';
	for await (const event of stream) {
		if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
			text += event.delta.text;
		}
	}

	const msg = await stream.finalMessage();
	return {
		text,
		input_tokens: msg.usage.input_tokens,
		output_tokens: msg.usage.output_tokens
	};
}

async function runThreePasses(
	client: Anthropic,
	query: string,
	contextBlock: string
): Promise<PassOutputs> {
	const t0 = Date.now();
	let totalInput = 0;
	let totalOutput = 0;

	// Pass 1: Analysis
	const p1 = await runPass(
		client,
		getAnalysisSystemPrompt(contextBlock),
		buildAnalysisUserPrompt(query),
		2048
	);
	totalInput += p1.input_tokens;
	totalOutput += p1.output_tokens;

	// Pass 2: Critique
	const p2 = await runPass(
		client,
		getCritiqueSystemPrompt(contextBlock),
		buildCritiqueUserPrompt(query, p1.text),
		1536
	);
	totalInput += p2.input_tokens;
	totalOutput += p2.output_tokens;

	// Pass 3: Synthesis
	const p3 = await runPass(
		client,
		getSynthesisSystemPrompt(contextBlock),
		buildSynthesisUserPrompt(query, p1.text, p2.text),
		2560
	);
	totalInput += p3.input_tokens;
	totalOutput += p3.output_tokens;

	return {
		analysis: p1.text,
		critique: p2.text,
		synthesis: p3.text,
		claims_retrieved: 0, // filled by caller
		arguments_retrieved: 0,
		input_tokens: totalInput,
		output_tokens: totalOutput,
		duration_ms: Date.now() - t0
	};
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
const SCORING_PROMPT = `Compare these two philosophical analyses of the same question. Output A had no knowledge base context. Output B had structured argument graph context injected into its system prompt.

Score each 1-10 on:
- Specificity (names specific philosophers, positions, arguments by name)
- Accuracy (claims are philosophically accurate and well-grounded)
- Depth (engages with the question at appropriate philosophical depth)
- Balance (considers multiple perspectives fairly without strawmanning)

Output ONLY a JSON object with no markdown wrapping:
{ "specificity_a": N, "specificity_b": N, "accuracy_a": N, "accuracy_b": N, "depth_a": N, "depth_b": N, "balance_a": N, "balance_b": N, "winner": "A" | "B" | "tie", "reason": "one sentence explaining the key difference" }`;

async function scoreComparison(
	client: Anthropic,
	query: string,
	synthA: string,
	synthB: string
): Promise<ScoreResult | null> {
	const userContent = `QUESTION: ${query}

--- OUTPUT A (no graph context) ---
${synthA}

--- OUTPUT B (with graph context) ---
${synthB}`;

	try {
		const response = await client.messages.create({
			model: SCORING_MODEL,
			max_tokens: 400,
			system: SCORING_PROMPT,
			messages: [{ role: 'user', content: userContent }]
		});

		const raw = response.content[0].type === 'text' ? response.content[0].text : '';
		// Extract JSON — model sometimes wraps in markdown even when told not to
		const jsonMatch = raw.match(/\{[\s\S]*\}/);
		if (!jsonMatch) throw new Error(`No JSON object in scoring response: ${raw.substring(0, 200)}`);

		return JSON.parse(jsonMatch[0]) as ScoreResult;
	} catch (err) {
		return null;
	}
}

// ─── File output ─────────────────────────────────────────────────────────────
function buildMarkdown(query: string, mode: 'WITHOUT' | 'WITH', outputs: PassOutputs): string {
	const lines: string[] = [];
	lines.push(`# Query: ${query}`);
	lines.push(`# Mode: ${mode} graph context`);
	if (mode === 'WITH') {
		lines.push(`# Retrieved: ${outputs.claims_retrieved} claims, ${outputs.arguments_retrieved} arguments`);
	}
	lines.push(`# Tokens: ${outputs.input_tokens} in / ${outputs.output_tokens} out`);
	lines.push(`# Duration: ${(outputs.duration_ms / 1000).toFixed(1)}s`);
	lines.push('');
	lines.push('---');
	lines.push('');
	lines.push('## Pass 1: Analysis (Proponent)');
	lines.push('');
	lines.push(outputs.analysis);
	lines.push('');
	lines.push('---');
	lines.push('');
	lines.push('## Pass 2: Critique (Adversary)');
	lines.push('');
	lines.push(outputs.critique);
	lines.push('');
	lines.push('---');
	lines.push('');
	lines.push('## Pass 3: Synthesis');
	lines.push('');
	lines.push(outputs.synthesis);
	return lines.join('\n');
}

// ─── Display ─────────────────────────────────────────────────────────────────
const WIDE = '═'.repeat(62);
const THIN = '─'.repeat(62);

function avgScore(s: ScoreResult, side: 'a' | 'b'): number {
	return (
		(s[`specificity_${side}`] + s[`accuracy_${side}`] + s[`depth_${side}`] + s[`balance_${side}`]) /
		4
	);
}

function printComparison(qr: QueryComparison): void {
	const tag = qr.out_of_domain ? ' [out-of-domain]' : '';
	console.log(`\nQuery ${qr.index + 1}/10: "${qr.query}"${tag}`);
	console.log(THIN);

	const w = qr.without;
	const g = qr.with;

	console.log(
		`  Without:  ${w.input_tokens}t in / ${w.output_tokens}t out  (${(w.duration_ms / 1000).toFixed(1)}s)`
	);
	console.log(
		`  With:     ${g.input_tokens}t in / ${g.output_tokens}t out  (${(g.duration_ms / 1000).toFixed(1)}s)  ` +
			`[${g.claims_retrieved} claims, ${g.arguments_retrieved} args retrieved]`
	);

	if (qr.scores) {
		const s = qr.scores;
		const avgA = avgScore(s, 'a').toFixed(1);
		const avgB = avgScore(s, 'b').toFixed(1);
		const diff = (avgScore(s, 'b') - avgScore(s, 'a')).toFixed(1);
		const diffStr = parseFloat(diff) >= 0 ? `+${diff}` : diff;
		console.log('');
		console.log(`  Scores (without → with):`);
		console.log(
			`    Specificity: ${s.specificity_a} → ${s.specificity_b}   ` +
				`Accuracy: ${s.accuracy_a} → ${s.accuracy_b}`
		);
		console.log(
			`    Depth:       ${s.depth_a} → ${s.depth_b}   ` +
				`Balance:  ${s.balance_a} → ${s.balance_b}`
		);
		console.log(`    Avg: ${avgA} → ${avgB}  (${diffStr})`);
		console.log('');

		const winLabel =
			s.winner === 'B'
				? '✓ WITH graph wins'
				: s.winner === 'A'
					? '✗ WITHOUT graph wins'
					: '~ Tie';
		console.log(`  ${winLabel}`);
		console.log(`  Reason: "${s.reason}"`);
	} else if (qr.score_error) {
		console.log(`  Score: (failed — ${qr.score_error})`);
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
	const dryRun = process.argv.includes('--dry-run');

	console.log(WIDE);
	console.log('SOPHIA — THREE-PASS COMPARISON TEST');
	console.log(WIDE);
	console.log('');
	console.log(`  Model:          ${MAIN_MODEL}`);
	console.log(`  Scoring model:  ${SCORING_MODEL}`);
	console.log(`  Queries:        ${TEST_QUERIES.length}`);
	console.log(`  API calls:      ~${TEST_QUERIES.length * 7} (6 passes + 1 scoring each)`);
	console.log(`  Estimated cost: £0.80–1.30 (see script header for details)`);
	console.log('');

	if (dryRun) {
		console.log('DRY RUN — queries that would be tested:');
		TEST_QUERIES.forEach((q, i) => {
			const tag = OUT_OF_DOMAIN.has(i) ? ' [out-of-domain]' : '';
			console.log(`  ${String(i + 1).padStart(2)}. ${q}${tag}`);
		});
		console.log('');
		console.log('Run without --dry-run to execute (will make Claude API calls).');
		return;
	}

	if (!ANTHROPIC_API_KEY) {
		console.error('[ERROR] ANTHROPIC_API_KEY not set in .env');
		process.exit(1);
	}

	// Create output directory
	const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
	const outDir = path.join(REPORTS_DIR, `comparison-${ts}`);
	fs.mkdirSync(outDir, { recursive: true });
	console.log(`  Output dir: ${outDir}`);
	console.log('');

	const client = makeAnthropicClient();
	const comparisons: QueryComparison[] = [];

	// Silence verbose module logs during runs
	const origLog = console.log;
	const origError = console.error;
	const origWarn = console.warn;

	for (let i = 0; i < TEST_QUERIES.length; i++) {
		const query = TEST_QUERIES[i];
		const padded = String(i + 1).padStart(2);
		const tag = OUT_OF_DOMAIN.has(i) ? ' [out-of-domain]' : '';

		process.stdout.write(`[${padded}/10] "${query.substring(0, 50)}"${tag}\n`);

		// ── Run WITHOUT graph ───────────────────────────────────────────────
		process.stdout.write(`         without graph...`);
		console.log = console.error = console.warn = () => {};
		const withoutResult = await runThreePasses(client, query, '');
		console.log = origLog;
		console.error = origError;
		console.warn = origWarn;
		process.stdout.write(
			` ${withoutResult.output_tokens}t out (${(withoutResult.duration_ms / 1000).toFixed(0)}s)\n`
		);

		// ── Retrieve context for WITH run ────────────────────────────────────
		process.stdout.write(`         retrieving context...`);
		console.log = console.error = console.warn = () => {};
		const retrieval = await retrieveContext(query, { topK: 5 });
		const contextBlock = buildContextBlock(retrieval);
		console.log = origLog;
		console.error = origError;
		console.warn = origWarn;
		process.stdout.write(
			` ${retrieval.claims.length} claims, ${retrieval.arguments.length} args\n`
		);

		// ── Run WITH graph ──────────────────────────────────────────────────
		process.stdout.write(`         with graph...`);
		console.log = console.error = console.warn = () => {};
		const withResult = await runThreePasses(client, query, contextBlock);
		console.log = origLog;
		console.error = origError;
		console.warn = origWarn;
		withResult.claims_retrieved = retrieval.claims.length;
		withResult.arguments_retrieved = retrieval.arguments.length;
		process.stdout.write(
			` ${withResult.output_tokens}t out (${(withResult.duration_ms / 1000).toFixed(0)}s)\n`
		);

		// ── Score ────────────────────────────────────────────────────────────
		process.stdout.write(`         scoring...`);
		console.log = console.error = console.warn = () => {};
		const scores = await scoreComparison(client, query, withoutResult.synthesis, withResult.synthesis);
		console.log = origLog;
		console.error = origError;
		console.warn = origWarn;
		const winnerTag = scores
			? scores.winner === 'B'
				? ' ✓ B wins'
				: scores.winner === 'A'
					? ' ✗ A wins'
					: ' ~ tie'
			: ' (score failed)';
		process.stdout.write(`${winnerTag}\n`);

		// ── Save files ───────────────────────────────────────────────────────
		const qNum = String(i + 1).padStart(2, '0');
		fs.writeFileSync(
			path.join(outDir, `query-${qNum}-without.md`),
			buildMarkdown(query, 'WITHOUT', withoutResult),
			'utf-8'
		);
		fs.writeFileSync(
			path.join(outDir, `query-${qNum}-with.md`),
			buildMarkdown(query, 'WITH', withResult),
			'utf-8'
		);

		comparisons.push({
			index: i,
			query,
			out_of_domain: OUT_OF_DOMAIN.has(i),
			without: withoutResult,
			with: withResult,
			scores,
			score_error: scores ? undefined : 'scoring API call failed'
		});
	}

	await closeDb();

	// ── Detailed results ──────────────────────────────────────────────────────
	console.log('\n\n' + WIDE);
	console.log('DETAILED RESULTS');
	console.log(WIDE);
	for (const qr of comparisons) printComparison(qr);

	// ── Aggregate summary ─────────────────────────────────────────────────────
	const scored = comparisons.filter((c) => c.scores !== null);
	const bWins = scored.filter((c) => c.scores!.winner === 'B').length;
	const aWins = scored.filter((c) => c.scores!.winner === 'A').length;
	const ties = scored.filter((c) => c.scores!.winner === 'tie').length;

	// Dimension averages
	const dims = ['specificity', 'accuracy', 'depth', 'balance'] as const;
	const dimAvgA: Record<string, number> = {};
	const dimAvgB: Record<string, number> = {};
	for (const d of dims) {
		dimAvgA[d] = scored.reduce((sum, c) => sum + c.scores![`${d}_a`], 0) / Math.max(scored.length, 1);
		dimAvgB[d] = scored.reduce((sum, c) => sum + c.scores![`${d}_b`], 0) / Math.max(scored.length, 1);
	}
	const overallA = Object.values(dimAvgA).reduce((s, v) => s + v, 0) / dims.length;
	const overallB = Object.values(dimAvgB).reduce((s, v) => s + v, 0) / dims.length;
	const overallDiff = overallB - overallA;

	// In-domain only
	const inDomainScored = scored.filter((c) => !c.out_of_domain);
	const inDomainBWins = inDomainScored.filter((c) => c.scores!.winner === 'B').length;

	const totalTokensIn = comparisons.reduce((s, c) => s + c.without.input_tokens + c.with.input_tokens, 0);
	const totalTokensOut = comparisons.reduce((s, c) => s + c.without.output_tokens + c.with.output_tokens, 0);
	const totalCostUsd = (totalTokensIn * 3 + totalTokensOut * 15) / 1_000_000;

	console.log('\n' + WIDE);
	console.log('SUMMARY');
	console.log(WIDE);
	console.log('');
	console.log(`  Graph context improved analysis on: ${bWins}/${scored.length} queries`);
	console.log(
		`  Without graph wins: ${aWins}   Ties: ${ties}` +
			(scored.length < TEST_QUERIES.length
				? `   (${TEST_QUERIES.length - scored.length} scoring failures)`
				: '')
	);
	console.log('');
	console.log('  Average scores across all queries:');
	for (const d of dims) {
		const diff = dimAvgB[d] - dimAvgA[d];
		const diffStr = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
		console.log(
			`    ${d.padEnd(12)}  without=${dimAvgA[d].toFixed(1)}  with=${dimAvgB[d].toFixed(1)}  (${diffStr})`
		);
	}
	const diffStr = overallDiff >= 0 ? `+${overallDiff.toFixed(1)}` : overallDiff.toFixed(1);
	console.log(`    ${'overall'.padEnd(12)}  without=${overallA.toFixed(1)}  with=${overallB.toFixed(1)}  (${diffStr})`);
	console.log('');
	console.log(`  Total tokens:   ${totalTokensIn.toLocaleString()} in / ${totalTokensOut.toLocaleString()} out`);
	console.log(`  Actual cost:    $${totalCostUsd.toFixed(3)} USD ≈ £${(totalCostUsd * 0.79).toFixed(2)}`);
	console.log('');

	// Quality gate
	const GATE_TARGET = 6;
	const gatePassed = inDomainBWins >= GATE_TARGET;
	console.log(
		`  Phase 3b quality gate (with-graph wins ≥${GATE_TARGET}/7 in-domain): ` +
			(gatePassed ? `✓ PASSED  (${inDomainBWins}/7)` : `✗ NOT MET  (${inDomainBWins}/7)`)
	);
	if (!gatePassed && inDomainScored.length > 0) {
		console.log('');
		console.log('  To improve: check docs/prompt-tuning-log.md for common fixes,');
		console.log('  or ensure Wave 1 data is ingested (./scripts/run-wave.sh 1).');
	}
	console.log('');

	// ── Save JSON + summary MD ────────────────────────────────────────────────
	const jsonReport = {
		timestamp: new Date().toISOString(),
		model: MAIN_MODEL,
		scoring_model: SCORING_MODEL,
		summary: {
			b_wins: bWins,
			a_wins: aWins,
			ties,
			in_domain_b_wins: inDomainBWins,
			overall_avg_without: parseFloat(overallA.toFixed(2)),
			overall_avg_with: parseFloat(overallB.toFixed(2)),
			overall_improvement: parseFloat(overallDiff.toFixed(2)),
			gate_passed: gatePassed,
			total_cost_usd: parseFloat(totalCostUsd.toFixed(3))
		},
		results: comparisons.map((c) => ({
			index: c.index,
			query: c.query,
			out_of_domain: c.out_of_domain,
			claims_retrieved: c.with.claims_retrieved,
			arguments_retrieved: c.with.arguments_retrieved,
			scores: c.scores,
			avg_without: c.scores ? parseFloat(avgScore(c.scores, 'a').toFixed(2)) : null,
			avg_with: c.scores ? parseFloat(avgScore(c.scores, 'b').toFixed(2)) : null,
			winner: c.scores?.winner ?? null
		}))
	};

	fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(jsonReport, null, 2), 'utf-8');

	// Results summary markdown table
	const mdLines = [
		`# SOPHIA — Comparison Test Results`,
		``,
		`Generated: ${new Date().toISOString()}`,
		``,
		`## Summary`,
		``,
		`| Metric | Value |`,
		`|--------|-------|`,
		`| With-graph wins | ${bWins}/${scored.length} |`,
		`| Average improvement | ${diffStr} pts |`,
		`| Quality gate (≥${GATE_TARGET}/7 in-domain) | ${gatePassed ? '✓ PASSED' : '✗ NOT MET'} |`,
		`| Total cost | $${totalCostUsd.toFixed(3)} ≈ £${(totalCostUsd * 0.79).toFixed(2)} |`,
		``,
		`## Per-Query Results`,
		``,
		`| # | Query | Avg Without | Avg With | Diff | Winner |`,
		`|---|-------|-------------|----------|------|--------|`
	];

	for (const c of comparisons) {
		if (c.scores) {
			const a = avgScore(c.scores, 'a').toFixed(1);
			const b = avgScore(c.scores, 'b').toFixed(1);
			const d = (avgScore(c.scores, 'b') - avgScore(c.scores, 'a')).toFixed(1);
			const w = c.scores.winner === 'B' ? 'B ✓' : c.scores.winner === 'A' ? 'A ✗' : 'tie';
			const ood = c.out_of_domain ? ' *(ood)*' : '';
			mdLines.push(
				`| ${c.index + 1} | ${c.query.substring(0, 45)}${ood} | ${a} | ${b} | ${parseFloat(d) >= 0 ? '+' : ''}${d} | ${w} |`
			);
		} else {
			mdLines.push(`| ${c.index + 1} | ${c.query.substring(0, 45)} | – | – | – | (failed) |`);
		}
	}

	mdLines.push('', '*(ood) = out-of-domain query, gaps expected*');

	fs.writeFileSync(path.join(outDir, 'results.md'), mdLines.join('\n'), 'utf-8');

	console.log(`  Output saved: ${outDir}/`);
	console.log(WIDE);
}

main().catch((err) => {
	console.error('[ERROR]', err instanceof Error ? err.message : err);
	process.exit(1);
});
