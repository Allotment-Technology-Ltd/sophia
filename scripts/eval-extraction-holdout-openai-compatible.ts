/**
 * Score an OpenAI-compatible extraction endpoint against Phase 1 JSONL labels
 * (golden_holdout / validation / train).
 *
 * Metrics:
 * - **schemaPassRate** — fraction of rows where model output parses as `ExtractionOutputSchema`
 * - **latencyMs** — p50 / p95 of `generateText` wall time per row
 * - **subsetTextMatchRate** — label-aligned for sentence-level JSONL: among rows with a parsable gold label
 *   and ≥1 model claim, fraction where **some** model claim has the same `text` as gold (trimmed). Ignores
 *   `position_in_source`. **Use this for `golden_holdout.jsonl`**, where every row is one sentence and
 *   gold `position_in_source` is document-level (not recoverable from a single-sentence `input`).
 * - **subsetMatchRate** — strict legacy metric: same as above but **also** requires
 *   `position_in_source` to match gold on that claim. Often near-zero on holdout for the reason above;
 *   kept for backward compatibility and for JSONL where positions are meaningful in context.
 *
 * Requires env (same as ingest fine-tuned path):
 * - `EXTRACTION_BASE_URL`, `EXTRACTION_MODEL`
 * - `EXTRACTION_API_KEY` or `OPENAI_API_KEY` (Together: `TOGETHER_API_KEY` when base URL is `api.together.xyz`;
 *   Fireworks: `FIREWORKS_API_KEY` when base URL is `api.fireworks.ai`)
 *
 * Prompt shape: by default **folds** `EXTRACTION_SYSTEM` into the user message (matches Together SFT
 * `user-assistant-folded-system`). Set `EXTRACTION_EVAL_FOLD_SYSTEM=0` to send a separate `system` message.
 *
 * **Fireworks / scale-to-zero:** optional warmup (default on when `EXTRACTION_BASE_URL` is Fireworks) plus
 * outer-loop retries on **503** / **429** / wrapped `AI_RetryError` (`EXTRACTION_EVAL_MAX_TRANSIENT_RETRIES`, default 8).
 * Per-call SDK retries: `EXTRACTION_EVAL_MAX_RETRIES` (default **14** on Fireworks hosts so `DEPLOYMENT_SCALING_UP` can clear; else SDK default **2**).
 * Disable warmup: `EXTRACTION_EVAL_WARMUP=0` or `--no-warmup`.
 *
 * **Fireworks deployment model ids:** the OpenAI SDK treats `accounts/.../deployments/...` as a “reasoning” model and
 * would spam warnings on `temperature`; this script **omits** `temperature` for Fireworks / deployment ids. SDK chat
 * warning spam is silenced by default (`EXTRACTION_EVAL_QUIET_AI_LOG=0` to re-enable).
 *
 * **Debug 0% schema pass:** `EXTRACTION_EVAL_LOG_FIRST_FAILURE=1` logs the first row’s raw model output preview (stderr).
 *
 * **Progress (stderr):** By default this script prints **only** the final JSON report to stdout — nothing in between.
 * It logs **`[eval] start …`** after routing and **`[eval] row k/N inference…`** every 10 rows (row 1 always).
 * Set **`EXTRACTION_EVAL_PROGRESS=1`** to log every row. First calls can take **minutes** (`maxOutputTokens` 8192 + long prompts).
 *
 * **Why subset match is low:** `--mismatch-diagnostics` (or `EXTRACTION_EVAL_MISMATCH_DIAGNOSTICS=1`) adds bucket counts
 * for gold-eligible rows that fail the strict `text` + `position_in_source` check — e.g. `gold_text_wrong_position`
 * (verbatim gold sentence but **wrong `position_in_source`**, often because labels use **document-level** indices while eval passes **one sentence** per call) vs `gold_position_wrong_text` (right index, paraphrased `text`; system prompt encourages paraphrase).
 * Holdout rows usually have `label.text === input` (`goldLabelTextEqualsInputRate` in the report).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/eval-extraction-holdout-openai-compatible.ts -- \
 *     --jsonl data/phase1-training-export/golden_holdout.jsonl \
 *     --limit 100 \
 *     --out data/phase1-training-export/eval-openai-ft-report.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateText } from 'ai';
import { loadServerEnv } from '../src/lib/server/env.ts';
import {
	EXTRACTION_SYSTEM,
	EXTRACTION_USER,
	ExtractionClaimSchema,
	ExtractionOutputSchema,
	type ExtractionClaim,
	type ExtractionOutput
} from '../src/lib/server/prompts/extraction.ts';
import { buildExtractionOpenAiCompatibleRoute } from '../src/lib/server/vertex.ts';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';

type JsonlLine = {
	source_url?: string;
	input?: string;
	label?: Record<string, unknown>;
};

function parseArgs(argv: string[]): {
	jsonl: string;
	limit: number;
	out: string | null;
	warmup: boolean;
	mismatchDiagnostics: boolean;
	mismatchSampleCap: number;
} {
	let jsonl = '';
	let limit = 500;
	let out: string | null = null;
	let warmup = true;
	let mismatchDiagnostics = false;
	let mismatchSampleCap = 20;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--jsonl' && argv[i + 1]) jsonl = argv[++i]!;
		else if (a === '--limit' && argv[i + 1]) limit = Math.max(1, parseInt(argv[++i]!, 10));
		else if (a === '--out' && argv[i + 1]) out = argv[++i]!;
		else if (a === '--no-warmup') warmup = false;
		else if (a === '--mismatch-diagnostics') mismatchDiagnostics = true;
		else if (a === '--mismatch-sample-cap' && argv[i + 1]) {
			mismatchSampleCap = Math.max(0, parseInt(argv[++i]!, 10));
		}
	}
	if (!jsonl) {
		console.error(
			'Usage: --jsonl <file.jsonl> [--limit N] [--out report.json] [--no-warmup] [--mismatch-diagnostics] [--mismatch-sample-cap N]'
		);
		process.exit(2);
	}
	return { jsonl, limit, out, warmup, mismatchDiagnostics, mismatchSampleCap };
}

type SubsetMismatchBucket =
	| 'hit'
	| 'split_across_claims'
	| 'gold_text_wrong_position'
	| 'gold_position_wrong_text'
	| 'neither_literal';

/** Classify why strict gold (exact text + position) is not satisfied. */
function classifyGoldSubsetMismatch(validated: ExtractionOutput, g: ExtractionClaim): SubsetMismatchBucket {
	const gt = g.text.trim();
	const gp = Number(g.position_in_source);
	const hit = validated.some(
		(c) => c.text.trim() === gt && Number(c.position_in_source) === gp
	);
	if (hit) return 'hit';

	const hasText = validated.some((c) => c.text.trim() === gt);
	const hasPos = validated.some((c) => Number(c.position_in_source) === gp);

	if (hasText && hasPos) return 'split_across_claims';
	if (hasText) return 'gold_text_wrong_position';
	if (hasPos) return 'gold_position_wrong_text';
	return 'neither_literal';
}

function truncate(s: string, max: number): string {
	const t = s.trim();
	if (t.length <= max) return t;
	return `${t.slice(0, max)}…`;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
	return sorted[idx]!;
}

/**
 * Parse extraction model output into a JSON **array** of claims.
 * Handles: markdown fences; a single object wrapped as one claim; `{"...}]` (missing `[`); and avoids the
 * naive first-`[`/last-`]` slice which breaks when claims include nested arrays (e.g. `concept_tags`).
 */
function parseExtractionModelJson(raw: string): unknown {
	let t = raw
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();

	// Common fine-tune glitch: one object with a stray closing `]` for an outer array.
	if (t.startsWith('{') && t.endsWith('}]')) {
		t = t.slice(0, -1);
	}

	try {
		const v = JSON.parse(t);
		if (Array.isArray(v)) return v;
		if (v !== null && typeof v === 'object') return [v];
	} catch {
		/* try bracket extraction for leading prose / trailing junk */
	}

	const start = t.indexOf('[');
	const end = t.lastIndexOf(']');
	if (start !== -1 && end !== -1 && end > start) {
		try {
			const parsed = JSON.parse(t.slice(start, end + 1));
			if (Array.isArray(parsed)) return parsed;
		} catch {
			/* fall through */
		}
	}
	throw new Error('No JSON array in model output');
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function httpStatusFromError(e: unknown): number | undefined {
	if (!e || typeof e !== 'object') return undefined;
	const o = e as Record<string, unknown>;
	if (typeof o.statusCode === 'number') return o.statusCode;
	const data = o.data as Record<string, unknown> | undefined;
	if (data && typeof data.statusCode === 'number') return data.statusCode;
	return undefined;
}

/** AI SDK `RetryError` after exhausting inner attempts — unwrap for 503/429 so outer retries can run. */
function httpStatusFromRetryBundle(e: unknown): number | undefined {
	if (!e || typeof e !== 'object') return undefined;
	const o = e as Record<string, unknown>;
	const last = httpStatusFromError(o.lastError);
	if (last !== undefined) return last;
	const errors = o.errors;
	if (Array.isArray(errors)) {
		for (const err of errors) {
			const h = httpStatusFromError(err);
			if (h !== undefined) return h;
		}
	}
	return undefined;
}

function isTransientEvalHttpError(e: unknown): boolean {
	const st = httpStatusFromError(e) ?? httpStatusFromRetryBundle(e);
	if (st === 503 || st === 429) return true;
	if (e && typeof e !== 'object') return false;
	const o = e as Record<string, unknown>;
	if (o.isRetryable === true) return true;
	/** @see https://sdk.vercel.ai — wraps last provider error */
	if (typeof o.name === 'string' && o.name.includes('Retry')) {
		const nested = httpStatusFromRetryBundle(e);
		if (nested === 503 || nested === 429) return true;
	}
	return false;
}

/** Per-`generateText` SDK retries (separate from `EXTRACTION_EVAL_MAX_TRANSIENT_RETRIES` outer loop). */
function generationMaxRetriesForBaseUrl(baseURL: string): number | undefined {
	const raw = process.env.EXTRACTION_EVAL_MAX_RETRIES?.trim();
	if (raw) {
		const n = parseInt(raw, 10);
		if (Number.isFinite(n) && n >= 0) return n;
	}
	/** Fireworks scale-to-zero: default inner retries > SDK default (2) so warmup often succeeds without operator hand-waving. */
	return baseURL.includes('fireworks.ai') ? 14 : undefined;
}

async function withTransientRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const max = Math.max(
		1,
		parseInt(process.env.EXTRACTION_EVAL_MAX_TRANSIENT_RETRIES?.trim() ?? '8', 10)
	);
	let last: unknown;
	for (let attempt = 1; attempt <= max; attempt++) {
		try {
			return await fn();
		} catch (e) {
			last = e;
			if (!isTransientEvalHttpError(e) || attempt === max) throw e;
			const delayMs = Math.min(30_000, 1500 * 2 ** (attempt - 1));
			console.error(
				`[eval:${label}] transient HTTP/SDK error (attempt ${attempt}/${max}), retry in ${delayMs}ms`
			);
			await sleep(delayMs);
		}
	}
	throw last;
}

async function main() {
	loadServerEnv();

	/** Default on: eval runs hundreds of `generateText` calls; AI SDK chat warnings are very noisy. */
	if (
		!['0', 'false', 'no'].includes((process.env.EXTRACTION_EVAL_QUIET_AI_LOG ?? '1').trim().toLowerCase())
	) {
		(globalThis as Record<string, boolean | undefined>).AI_SDK_LOG_WARNINGS = false;
	}

	const {
		jsonl,
		limit,
		out,
		warmup: warmupCli,
		mismatchDiagnostics: mismatchDiagCli,
		mismatchSampleCap
	} = parseArgs(process.argv.slice(2));
	const mismatchDiagnostics =
		mismatchDiagCli ||
		['1', 'true', 'yes'].includes(
			(process.env.EXTRACTION_EVAL_MISMATCH_DIAGNOSTICS ?? '').trim().toLowerCase()
		);

	const route = buildExtractionOpenAiCompatibleRoute();
	if (!route) {
		throw new Error(
			'EXTRACTION_BASE_URL + EXTRACTION_MODEL plus a key (EXTRACTION_API_KEY, OPENAI_API_KEY, or FIREWORKS_API_KEY on Fireworks) must be set.'
		);
	}

	const baseURL = process.env.EXTRACTION_BASE_URL?.trim() ?? '';
	const generationMaxRetries = generationMaxRetriesForBaseUrl(baseURL);
	/** Fireworks deployment ids + OpenAI SDK: non-`gpt-*` ids hit "reasoning model" path → bogus temperature warnings. */
	const omitTemperature =
		baseURL.includes('fireworks.ai') || route.modelId.includes('/deployments/');
	const warmupEnv = (process.env.EXTRACTION_EVAL_WARMUP ?? '').trim().toLowerCase();
	const warmupDefaultOn = baseURL.includes('fireworks.ai');
	const doWarmup =
		warmupCli &&
		!['0', 'false', 'no'].includes(warmupEnv || (warmupDefaultOn ? '1' : '0'));

	const progressEveryRow = ['1', 'true', 'yes'].includes(
		(process.env.EXTRACTION_EVAL_PROGRESS ?? '').trim().toLowerCase()
	);
	const progressInterval = progressEveryRow ? 1 : 10;

	console.error(
		`[eval] start model=${route.modelId} provider=${route.provider} limit=${limit} jsonl=${jsonl} warmup=${doWarmup}\n` +
			`[eval] (stdout is silent until the final JSON report; stderr shows progress every ${progressInterval} row(s); first inference can take minutes)`
	);

	if (doWarmup) {
		console.error('[eval:warmup] one cheap completion to wake scale-from-zero / verify routing…');
		await withTransientRetries('warmup', () =>
			generateText({
				model: route.model,
				messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
				...(omitTemperature ? {} : { temperature: 0 }),
				maxOutputTokens: 8,
				...(generationMaxRetries !== undefined ? { maxRetries: generationMaxRetries } : {})
			})
		);
		console.error('[eval:warmup] done');
	}

	const latencies: number[] = [];
	let okSchema = 0;
	let rows = 0;
	let subsetMatch = 0;
	let subsetTextMatch = 0;
	let subsetEligible = 0;

	const mismatchBuckets: Record<SubsetMismatchBucket, number> = {
		hit: 0,
		split_across_claims: 0,
		gold_text_wrong_position: 0,
		gold_position_wrong_text: 0,
		neither_literal: 0
	};
	let goldLabelTextEqualsInput = 0;
	const mismatchClaimCounts: number[] = [];
	type MismatchSample = {
		evalRow: number;
		bucket: Exclude<SubsetMismatchBucket, 'hit'>;
		goldText: string;
		inputEqualsGoldText: boolean;
		claimCount: number;
		claimsPreview: { position_in_source: number; text: string }[];
	};
	const mismatchSamples: MismatchSample[] = [];

	const foldSystem = !['0', 'false', 'no'].includes(
		(process.env.EXTRACTION_EVAL_FOLD_SYSTEM ?? '1').trim().toLowerCase()
	);

	const rl = readline.createInterface({ input: createReadStream(jsonl, { encoding: 'utf8' }) });

	for await (const line of rl) {
		const t = line.trim();
		if (!t) continue;
		if (rows >= limit) break;
		let row: JsonlLine;
		try {
			row = JSON.parse(t) as JsonlLine;
		} catch {
			continue;
		}
		if (!(row.input ?? '').trim()) continue;

		const userMsg = EXTRACTION_USER(
			(row.source_url ?? 'eval-row').trim() || 'eval-row',
			'Unknown',
			(row.input ?? '').trim()
		);

		const t0 = Date.now();
		const retryOpts =
			generationMaxRetries !== undefined ? { maxRetries: generationMaxRetries } : {};
		const rowOrdinal = rows + 1;
		if (rowOrdinal === 1 || rowOrdinal % progressInterval === 0) {
			console.error(`[eval] row ${rowOrdinal}/${limit} inference…`);
		}
		const result = await withTransientRetries(`row-${rows + 1}`, () =>
			generateText(
				foldSystem
					? {
							model: route.model,
							messages: [
								{
									role: 'user',
									content: `${EXTRACTION_SYSTEM}\n\n${userMsg}`
								}
							],
							...(omitTemperature ? {} : { temperature: 0.1 }),
							maxOutputTokens: 8192,
							...retryOpts
						}
					: {
							model: route.model,
							system: EXTRACTION_SYSTEM,
							messages: [{ role: 'user', content: userMsg }],
							...(omitTemperature ? {} : { temperature: 0.1 }),
							maxOutputTokens: 8192,
							...retryOpts
						}
			)
		);
		latencies.push(Date.now() - t0);
		rows++;

		try {
			const parsed = parseExtractionModelJson(result.text);
			const validated = ExtractionOutputSchema.parse(parsed);
			okSchema++;
			const gold = ExtractionClaimSchema.safeParse(row.label);
			if (gold.success && validated.length >= 1) {
				subsetEligible++;
				const g = gold.data;
				const inputTrim = (row.input ?? '').trim();
				if (inputTrim === g.text.trim()) goldLabelTextEqualsInput++;

				const textHit = validated.some((c) => c.text.trim() === g.text.trim());
				if (textHit) subsetTextMatch++;

				const hit = validated.some(
					(c) =>
						c.text.trim() === g.text.trim() &&
						Number(c.position_in_source) === Number(g.position_in_source)
				);
				if (hit) subsetMatch++;

				if (mismatchDiagnostics) {
					const bucket = classifyGoldSubsetMismatch(validated, g);
					mismatchBuckets[bucket]++;
					if (bucket !== 'hit') {
						mismatchClaimCounts.push(validated.length);
						if (mismatchSamples.length < mismatchSampleCap) {
							mismatchSamples.push({
								evalRow: rows,
								bucket,
								goldText: truncate(g.text, 200),
								inputEqualsGoldText: inputTrim === g.text.trim(),
								claimCount: validated.length,
								claimsPreview: validated.slice(0, 5).map((c) => ({
									position_in_source: c.position_in_source,
									text: truncate(c.text, 140)
								}))
							});
						}
					}
				}
			}
		} catch (err) {
			if (
				rows === 1 &&
				['1', 'true', 'yes'].includes(
					(process.env.EXTRACTION_EVAL_LOG_FIRST_FAILURE ?? '').trim().toLowerCase()
				)
			) {
				const preview = result.text.slice(0, 800);
				console.error(
					`[eval:debug] first row schema/parse failed; model output preview (800 chars):\n${preview}\n---\n${err instanceof Error ? err.message : String(err)}`
				);
			}
		}
	}

	latencies.sort((a, b) => a - b);
	let inferenceHost: string | null = null;
	try {
		inferenceHost = baseURL ? new URL(baseURL).host : null;
	} catch {
		inferenceHost = null;
	}

	const report: Record<string, unknown> = {
		generatedAt: new Date().toISOString(),
		jsonl,
		limit,
		rowsEvaluated: rows,
		schemaOkRows: okSchema,
		schemaFailRows: rows - okSchema,
		schemaPassRate: rows ? okSchema / rows : 0,
		latencyMs: {
			p50: percentile(latencies, 0.5),
			p95: percentile(latencies, 0.95)
		},
		/** Prefer this for `golden_holdout.jsonl` (one sentence per row; gold positions are document-level). */
		subsetTextMatchRate: subsetEligible ? subsetTextMatch / subsetEligible : null,
		/** Strict: gold `text` and `position_in_source` on the same claim. */
		subsetMatchRate: subsetEligible ? subsetMatch / subsetEligible : null,
		subsetEligibleRows: subsetEligible,
		subsetEligibleRowsWhereInputEqualsGoldText: goldLabelTextEqualsInput,
		singleSentenceGoldEvalAllEligibleRows:
			subsetEligible > 0 && goldLabelTextEqualsInput === subsetEligible,
		modelId: route.modelId,
		inferenceHost,
		systemFoldedIntoUser: foldSystem,
		temperatureOmittedForOpenAiSdk: omitTemperature
	};

	if (mismatchDiagnostics && subsetEligible > 0) {
		const mc = mismatchClaimCounts;
		mc.sort((a, b) => a - b);
		const textMatchPerfect =
			subsetTextMatch === subsetEligible &&
			subsetMatch === 0 &&
			goldLabelTextEqualsInput === subsetEligible;
		report.mismatchDiagnostics = {
			note: 'Buckets apply only to subset-eligible rows (parsable gold label + ≥1 model claim). `gold_text_wrong_position`: some claim has exact gold `text` but no claim has gold `position_in_source` — very common when **gold positions are document-level** while each eval row is a **single-sentence `input`**, so the model invents a local index (1, 2, …) that cannot match the label. `gold_position_wrong_text`: some claim matches gold position but not gold text (often paraphrase; see EXTRACTION_SYSTEM). `split_across_claims`: exact text on one claim and gold position on another.',
			...(textMatchPerfect
				? {
						readMeFirst:
							'subsetTextMatchRate is 1 on all eligible rows: the model returned the gold sentence verbatim. Every row lands in gold_text_wrong_position because strict matching also requires gold position_in_source (document-level), which single-sentence eval cannot satisfy — not a failure of claim extraction.'
					}
				: {}),
			subsetEligibleRows: subsetEligible,
			goldLabelTextEqualsInputRate: goldLabelTextEqualsInput / subsetEligible,
			mismatchBucketCounts: {
				hit: mismatchBuckets.hit,
				split_across_claims: mismatchBuckets.split_across_claims,
				gold_text_wrong_position: mismatchBuckets.gold_text_wrong_position,
				gold_position_wrong_text: mismatchBuckets.gold_position_wrong_text,
				neither_literal: mismatchBuckets.neither_literal
			},
			meanClaimCountOnMismatch:
				mc.length > 0 ? mc.reduce((a, b) => a + b, 0) / mc.length : null,
			medianClaimCountOnMismatch: mc.length > 0 ? percentile(mc, 0.5) : null,
			mismatchSamples
		};
	}

	console.log(JSON.stringify(report, null, 2));

	if (out) {
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	}
}

main().catch((e) => {
	const st = httpStatusFromError(e);
	const base = process.env.EXTRACTION_BASE_URL?.trim() ?? '';
	const model = process.env.EXTRACTION_MODEL?.trim() ?? '';
	if (st === 404 && base.includes('fireworks.ai') && model.includes('/deployments/')) {
		console.error(
			'[eval] Fireworks returned 404 (model/deployment not found). EXTRACTION_MODEL likely still points at a deleted deployment — update .env.local with a live deployment Name: from `firectl deployment create`, or comment out EXTRACTION_* until you redeploy. See docs/sophia/extraction-fireworks-deploy.md (teardown / env).'
		);
	}
	console.error(e);
	process.exit(1);
});
