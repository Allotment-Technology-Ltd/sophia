/**
 * Convert Phase 1 training JSONL (`pnpm ops:phase1-export-training-jsonl`) to Together-style
 * chat JSONL: one object per line with `{ "messages": [ {role, content}, ... ] }`.
 *
 * Default supervision: **claim-level** — each line is one `(passage text, single-claim JSON array)`.
 * The assistant target is a JSON array with exactly one claim (`ExtractionOutputSchema`-compatible).
 *
 * Optional **`--aggregate-url`** — one example per `canonical_url_hash` (or `source_url` fallback):
 * assistant content is the JSON array of all claims sorted by `position_in_source`. User text
 * concatenates distinct `input` spans with separators (best-effort; prefer **claim-level** unless
 * you are intentionally training multi-claim completions per URL).
 *
 * **Together / Mistral LoRA:** by default the exporter **does not** emit a `system` role — the
 * model template rejects it (`Found system role in messages, but the model does not support it`).
 * Instead **`EXTRACTION_SYSTEM`** is prepended to the **user** message (same idea as ingest’s
 * fold-system path). Use **`--include-system-role`** only if your fine-tune stack supports a
 * separate system turn.
 *
 * **Token histogram (Step A):** rough token counts (chars/4) over the folded user + assistant text.
 *
 * Usage:
 *   pnpm exec tsx scripts/convert-phase1-jsonl-to-together-chat.ts -- \
 *     --input data/phase1-training-export/train.jsonl \
 *     --output data/phase1-training-export/train.together.jsonl
 *
 *   pnpm exec tsx scripts/convert-phase1-jsonl-to-together-chat.ts -- \
 *     --input train.jsonl --stats-only --stats-json train.token-stats.json
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import readline from 'node:readline';
import {
	EXTRACTION_SYSTEM,
	EXTRACTION_USER,
	ExtractionClaimSchema
} from '../src/lib/server/prompts/extraction.ts';

type JsonlLine = {
	source_url?: string;
	canonical_url_hash?: string | null;
	input?: string;
	label?: Record<string, unknown>;
	split?: string;
	passage_context_excerpt?: string | null;
};

type TogetherLine = {
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
};

function foldExtractionSystemIntoUser(userTurn: string): string {
	return `${EXTRACTION_SYSTEM}\n\n${userTurn}`;
}

function parseArgs(argv: string[]): {
	input: string;
	output: string;
	statsOnly: boolean;
	aggregateUrl: boolean;
	includePassageContext: boolean;
	statsJson: string | null;
	emitStatsJson: boolean;
	includeSystemRole: boolean;
} {
	let input = '';
	let output = '';
	let statsOnly = false;
	let aggregateUrl = false;
	let includePassageContext = false;
	let statsJson: string | null = null;
	let emitStatsJson = false;
	let includeSystemRole = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--input' && argv[i + 1]) input = argv[++i]!;
		else if (a === '--output' && argv[i + 1]) output = argv[++i]!;
		else if (a === '--stats-only') statsOnly = true;
		else if (a === '--aggregate-url') aggregateUrl = true;
		else if (a === '--include-passage-context') includePassageContext = true;
		else if (a === '--stats-json' && argv[i + 1]) statsJson = argv[++i]!;
		else if (a === '--emit-stats-json') emitStatsJson = true;
		else if (a === '--include-system-role') includeSystemRole = true;
	}
	if (!input) {
		console.error(
			'Usage: --input <train.jsonl> [--output <out.jsonl>] [--stats-only] [--aggregate-url] [--include-passage-context] [--include-system-role] [--stats-json <path>] [--emit-stats-json]'
		);
		process.exit(2);
	}
	if (!statsOnly && !output) {
		console.error('Provide --output <path> or use --stats-only');
		process.exit(2);
	}
	return {
		input,
		output,
		statsOnly,
		aggregateUrl,
		includePassageContext,
		statsJson,
		emitStatsJson,
		includeSystemRole
	};
}

function roughTokenEstimate(s: string): number {
	return Math.max(1, Math.ceil(s.length / 4));
}

function summarizeRoughTokens(lens: number[]): {
	count: number;
	min: number;
	max: number;
	mean: number;
	p50: number;
	p90: number;
	p95: number;
	p99: number;
	fracRoughGt2048: number;
	fracRoughGt4096: number;
	fracRoughGt8192: number;
	fracRoughGt16384: number;
} | null {
	if (lens.length === 0) return null;
	const sorted = [...lens].sort((a, b) => a - b);
	const pick = (p: number) => {
		if (sorted.length === 1) return sorted[0]!;
		const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * (sorted.length - 1))));
		return sorted[idx]!;
	};
	const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
	const fracOver = (t: number) => lens.filter((x) => x > t).length / lens.length;
	return {
		count: lens.length,
		min: sorted[0]!,
		max: sorted[sorted.length - 1]!,
		mean,
		p50: pick(0.5),
		p90: pick(0.9),
		p95: pick(0.95),
		p99: pick(0.99),
		fracRoughGt2048: fracOver(2048),
		fracRoughGt4096: fracOver(4096),
		fracRoughGt8192: fracOver(8192),
		fracRoughGt16384: fracOver(16384)
	};
}

function buildMessagesForExample(
	userTurn: string,
	assistant: string,
	includeSystemRole: boolean
): TogetherLine['messages'] {
	if (includeSystemRole) {
		return [
			{ role: 'system', content: EXTRACTION_SYSTEM },
			{ role: 'user', content: userTurn },
			{ role: 'assistant', content: assistant }
		];
	}
	return [
		{ role: 'user', content: foldExtractionSystemIntoUser(userTurn) },
		{ role: 'assistant', content: assistant }
	];
}

function buildUserContent(line: JsonlLine, includePassageContext: boolean): string {
	const title = (line.source_url ?? 'unknown source').trim() || 'unknown source';
	const body = (line.input ?? '').trim();
	const excerpt = (line.passage_context_excerpt ?? '').trim();
	if (includePassageContext && excerpt) {
		return EXTRACTION_USER(title, 'Unknown', `${body}\n\n<context_excerpt>\n${excerpt}\n</context_excerpt>`);
	}
	return EXTRACTION_USER(title, 'Unknown', body);
}

async function main() {
	const {
		input,
		output,
		statsOnly,
		aggregateUrl,
		includePassageContext,
		statsJson,
		emitStatsJson,
		includeSystemRole
	} = parseArgs(process.argv.slice(2));

	if (!statsOnly) {
		mkdirSync(dirname(output), { recursive: true });
	}

	const byUrl = new Map<string, JsonlLine[]>();
	const claimRows: TogetherLine[] = [];
	const roughTokPerExample: number[] = [];

	let linesIn = 0;
	let linesOut = 0;
	let skippedInvalid = 0;
	let maxRoughTok = 0;

	const recordFullPromptRough = (full: string) => {
		const r = roughTokenEstimate(full);
		roughTokPerExample.push(r);
		maxRoughTok = Math.max(maxRoughTok, r);
	};

	const rl = readline.createInterface({ input: createReadStream(input, { encoding: 'utf8' }) });

	for await (const raw of rl) {
		const t = raw.trim();
		if (!t) continue;
		linesIn++;
		let line: JsonlLine;
		try {
			line = JSON.parse(t) as JsonlLine;
		} catch {
			skippedInvalid++;
			continue;
		}

		if (aggregateUrl) {
			const key = (line.canonical_url_hash ?? line.source_url ?? '').trim() || `row-${linesIn}`;
			const arr = byUrl.get(key) ?? [];
			arr.push(line);
			byUrl.set(key, arr);
			continue;
		}

		const parsed = ExtractionClaimSchema.safeParse(line.label);
		if (!parsed.success || !(line.input ?? '').trim()) {
			skippedInvalid++;
			continue;
		}
		const userContent = buildUserContent(line, includePassageContext);
		const assistant = JSON.stringify([parsed.data]);
		const userForCount = includeSystemRole
			? EXTRACTION_SYSTEM + userContent
			: foldExtractionSystemIntoUser(userContent);
		recordFullPromptRough(userForCount + assistant);
		const row: TogetherLine = {
			messages: buildMessagesForExample(userContent, assistant, includeSystemRole)
		};
		if (!statsOnly) claimRows.push(row);
		linesOut++;
	}

	const rows: TogetherLine[] = aggregateUrl ? [] : statsOnly ? [] : claimRows;

	if (aggregateUrl) {
		// Per-URL aggregate: replace per-line rough counts with one per aggregated example
		roughTokPerExample.length = 0;
		let aggOut = 0;
		for (const [, agg] of byUrl) {
			const sorted = [...agg].sort(
				(a, b) =>
					(Number((a.label as { position_in_source?: number })?.position_in_source) || 0) -
					(Number((b.label as { position_in_source?: number })?.position_in_source) || 0)
			);
			const first = sorted[0];
			if (!first) continue;
			const claims: unknown[] = [];
			for (const row of sorted) {
				const p = ExtractionClaimSchema.safeParse(row.label);
				if (!p.success) {
					skippedInvalid++;
					continue;
				}
				claims.push(p.data);
			}
			if (claims.length === 0) continue;
			const title = (first.source_url ?? 'unknown source').trim() || 'unknown source';
			const combinedInput = sorted
				.map((r) => (r.input ?? '').trim())
				.filter(Boolean)
				.join('\n\n---\n\n');
			const userContent = EXTRACTION_USER(title, 'Unknown', combinedInput);
			const assistant = JSON.stringify(claims);
			const userForCount = includeSystemRole
				? EXTRACTION_SYSTEM + userContent
				: foldExtractionSystemIntoUser(userContent);
			recordFullPromptRough(userForCount + assistant);
			aggOut++;
			if (!statsOnly) {
				rows.push({
					messages: buildMessagesForExample(userContent, assistant, includeSystemRole)
				});
			}
		}
		linesOut = aggOut;
	}

	if (!statsOnly) {
		const outStream = createWriteStream(output, { flags: 'w' });
		for (const r of rows) {
			outStream.write(`${JSON.stringify(r)}\n`);
		}
		await new Promise<void>((resolve, reject) => {
			outStream.end(() => resolve());
			outStream.on('error', reject);
		});
	}

	const tokenHistogram = summarizeRoughTokens(roughTokPerExample);
	const summary = {
		generatedAt: new Date().toISOString(),
		input,
		output: statsOnly ? null : output,
		linesIn,
		linesOut,
		skippedInvalid,
		maxRoughTokensPerExample: maxRoughTok,
		tokenHistogram,
		note: 'Rough tokens = ceil(chars/4) over the training text passed to the model (folded user + assistant by default); use your real tokenizer for Together limits.',
		mode: aggregateUrl ? 'aggregate-url' : 'claim',
		includePassageContext,
		includeSystemRole,
		messagesFormat: includeSystemRole ? 'system-user-assistant' : 'user-assistant-folded-system'
	};

	const statsPath =
		statsJson ??
		(emitStatsJson && !statsOnly ? output.replace(/\.jsonl$/i, '.token-stats.json') : null);
	if (statsPath) {
		mkdirSync(dirname(statsPath), { recursive: true });
		writeFileSync(statsPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
	}

	console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
