/**
 * Build a **multi-domain, multi-source** extraction eval JSONL from Phase 1 export files
 * (`train.jsonl` / `validation.jsonl` / `test.jsonl`). Same row shape as `golden_holdout.jsonl`
 * so it runs unchanged on **`pnpm ops:eval-extraction-holdout-openai-compatible`**.
 *
 * Goals:
 * - Spread rows across **`label.domain`** (not only philosophy_of_mind / one SEP).
 * - Cap **`max-per-source-url`** so a single Stanford entry does not dominate.
 * - Optional **`--exclude-url-substrings`** (e.g. `aquinas`) to force remit outside a topic.
 *
 * **Train overlap (important):** Together SFT for this spike used **`train.together.jsonl`** from
 * **`train.jsonl`** (see `together-finetune-job-submitted.json`). By default this script reads only
 * **`validation.jsonl`** + **`test.jsonl`**, whose URLs are **stratified out of `train.jsonl`** in
 * `pnpm ops:phase1-export-training-jsonl`, so sampled rows are **not** the same export lines as the
 * SFT training file. Use **`--from train.jsonl,...`** only if you intentionally want an
 * in-distribution / memorization stress check.
 *
 * Usage (repo root, no API keys required):
 *   pnpm ops:sample-extraction-remit-eval-jsonl -- \
 *     --export-dir data/phase1-training-export \
 *     --out eval_remit_multidomain.jsonl \
 *     --total 200 \
 *     --seed 42
 *
 * Then (after deployment):
 *   pnpm ops:eval-extraction-holdout-openai-compatible -- \
 *     --jsonl data/phase1-training-export/eval_remit_multidomain.jsonl \
 *     --limit 200 \
 *     --mismatch-diagnostics \
 *     --out data/phase1-training-export/eval-fireworks-remit.json
 */

import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { ExtractionClaimSchema } from '../src/lib/server/prompts/extraction.ts';

type JsonlRow = Record<string, unknown> & {
	source_url?: string;
	input?: string;
	label?: Record<string, unknown>;
};

function normalizeUrl(raw: string): string {
	const u = raw.trim().split('#')[0] ?? '';
	return u.replace(/\/+$/, '') || 'unknown';
}

function parseArgs(argv: string[]): {
	exportDir: string;
	inputNames: string[];
	outName: string;
	total: number;
	seed: number;
	minPerDomain: number;
	maxPerSourceUrl: number;
	excludeUrlSubstrings: string[];
} {
	let exportDir = 'data/phase1-training-export';
	/** Default excludes `train.jsonl` so eval rows are not the same lines as Together SFT training data. */
	let inputNames = ['validation.jsonl', 'test.jsonl'];
	let outName = 'eval_remit_multidomain.jsonl';
	let total = 200;
	let seed = 42;
	let minPerDomain = 5;
	let maxPerSourceUrl = 25;
	const excludeUrlSubstrings: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--export-dir' && argv[i + 1]) exportDir = argv[++i]!;
		else if (a === '--from' && argv[i + 1]) inputNames = argv[++i]!.split(',').map((s) => s.trim());
		else if (a === '--out' && argv[i + 1]) outName = argv[++i]!;
		else if (a === '--total' && argv[i + 1]) total = Math.max(1, parseInt(argv[++i]!, 10));
		else if (a === '--seed' && argv[i + 1]) seed = parseInt(argv[++i]!, 10);
		else if (a === '--min-per-domain' && argv[i + 1]) minPerDomain = Math.max(0, parseInt(argv[++i]!, 10));
		else if (a === '--max-per-source-url' && argv[i + 1])
			maxPerSourceUrl = Math.max(1, parseInt(argv[++i]!, 10));
		else if (a === '--exclude-url-substrings' && argv[i + 1]) {
			excludeUrlSubstrings.push(
				...argv[++i]!
					.split(',')
					.map((s) => s.trim().toLowerCase())
					.filter(Boolean)
			);
		}
	}
	return {
		exportDir,
		inputNames,
		outName,
		total,
		seed,
		minPerDomain,
		maxPerSourceUrl,
		excludeUrlSubstrings
	};
}

/** Deterministic shuffle (Fisher–Yates) with 32-bit LCG seed. */
function shuffleInPlace<T>(arr: T[], seed: number): void {
	let s = seed >>> 0;
	const rnd = () => {
		s = (Math.imul(1664525, s) + 1013904223) >>> 0;
		return s / 0xffffffff;
	};
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[arr[i], arr[j]] = [arr[j]!, arr[i]!];
	}
}

function urlExcluded(url: string, subs: string[]): boolean {
	const lower = url.toLowerCase();
	return subs.some((s) => lower.includes(s));
}

async function readAllRows(paths: string[], excludeSubs: string[]): Promise<JsonlRow[]> {
	const out: JsonlRow[] = [];
	for (const p of paths) {
		const rl = readline.createInterface({
			input: createReadStream(p, { encoding: 'utf8' }),
			crlfDelay: Infinity
		});
		for await (const line of rl) {
			const t = line.trim();
			if (!t) continue;
			let row: JsonlRow;
			try {
				row = JSON.parse(t) as JsonlRow;
			} catch {
				continue;
			}
			if (!(row.input ?? '').trim()) continue;
			const url = String(row.source_url ?? '');
			if (excludeSubs.length && urlExcluded(url, excludeSubs)) continue;
			const gold = ExtractionClaimSchema.safeParse(row.label);
			if (!gold.success) continue;
			const domain = gold.data.domain;
			out.push({ ...row, label: gold.data as unknown as Record<string, unknown> });
		}
	}
	return out;
}

function pickStratified(
	rows: JsonlRow[],
	total: number,
	seed: number,
	minPerDomain: number,
	maxPerSourceUrl: number
): JsonlRow[] {
	const byDomain = new Map<string, JsonlRow[]>();
	for (const row of rows) {
		const d = String((row.label as { domain?: string })?.domain ?? '(missing)');
		if (!byDomain.has(d)) byDomain.set(d, []);
		byDomain.get(d)!.push(row);
	}
	const domains = [...byDomain.keys()].filter((d) => d !== '(missing)');
	for (const d of domains) {
		shuffleInPlace(byDomain.get(d)!, seed ^ (d.length * 1315423911));
	}

	const picked: JsonlRow[] = [];
	const countDomain = new Map<string, number>();
	const countUrl = new Map<string, number>();
	const usedKey = new Set<string>();

	const tryPick = (row: JsonlRow): boolean => {
		const u = normalizeUrl(String(row.source_url ?? ''));
		if ((countUrl.get(u) ?? 0) >= maxPerSourceUrl) return false;
		const k = `${u}\0${(row.input as string).slice(0, 200)}`;
		if (usedKey.has(k)) return false;
		usedKey.add(k);
		picked.push(row);
		const dom = String((row.label as { domain?: string })?.domain ?? '');
		countDomain.set(dom, (countDomain.get(dom) ?? 0) + 1);
		countUrl.set(u, (countUrl.get(u) ?? 0) + 1);
		return true;
	};

	// Domains with smallest pools first (so we do not exhaust rare domains later).
	const domainsSorted = [...domains].sort((a, b) => byDomain.get(a)!.length - byDomain.get(b)!.length);

	const effMinPerDomain =
		domainsSorted.length === 0 ? 0 : Math.min(minPerDomain, Math.max(0, Math.floor(total / domainsSorted.length)));

	// Phase A: at least effMinPerDomain per domain when possible (clamped so we never exceed --total).
	if (effMinPerDomain > 0) {
		for (const d of domainsSorted) {
			if (picked.length >= total) break;
			const pool = byDomain.get(d)!;
			let got = 0;
			for (const row of pool) {
				if (picked.length >= total) break;
				if (got >= effMinPerDomain) break;
				if (tryPick(row)) got++;
			}
		}
	}

	// Phase B: round-robin fill by domain (largest pools last for stable spread).
	const rr = [...domains].sort((a, b) => byDomain.get(b)!.length - byDomain.get(a)!.length);
	shuffleInPlace(rr, seed + 7);
	const cursors = new Map<string, number>();
	for (const d of rr) cursors.set(d, 0);

	while (picked.length < total) {
		let progressed = false;
		for (const d of rr) {
			if (picked.length >= total) break;
			const pool = byDomain.get(d)!;
			let idx = cursors.get(d) ?? 0;
			while (idx < pool.length) {
				const row = pool[idx]!;
				idx++;
				if (tryPick(row)) {
					progressed = true;
					break;
				}
			}
			cursors.set(d, idx);
		}
		if (!progressed) break;
	}

	shuffleInPlace(picked, seed + 99);
	return picked.slice(0, total);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const paths = args.inputNames.map((n) => join(args.exportDir, n));
	for (const p of paths) {
		if (!existsSync(p)) throw new Error(`Missing input file: ${p}`);
	}

	const rows = await readAllRows(paths, args.excludeUrlSubstrings);
	if (rows.length === 0) throw new Error('No eligible rows after filters.');

	const picked = pickStratified(
		rows,
		args.total,
		args.seed,
		args.minPerDomain,
		args.maxPerSourceUrl
	);
	if (picked.length < args.total) {
		console.error(
			`[sample-remit-eval] warning: only ${picked.length} rows picked (wanted ${args.total}); relax --max-per-source-url or --exclude-url-substrings.`
		);
	}

	const outPath = join(args.exportDir, args.outName);
	mkdirSync(dirname(outPath), { recursive: true });

	const ws = createWriteStream(outPath, { encoding: 'utf8' });
	for (const row of picked) {
		const line = JSON.stringify({
			...row,
			split: 'eval_remit_multidomain'
		});
		ws.write(`${line}\n`);
	}
	await new Promise<void>((resolve, reject) => {
		ws.end(() => resolve());
		ws.on('error', reject);
	});

	const domainCounts: Record<string, number> = {};
	const urlCounts: Record<string, number> = {};
	for (const row of picked) {
		const d = String((row.label as { domain?: string })?.domain ?? '');
		domainCounts[d] = (domainCounts[d] ?? 0) + 1;
		const u = normalizeUrl(String(row.source_url ?? ''));
		urlCounts[u] = (urlCounts[u] ?? 0) + 1;
	}

	const manifestPath = outPath.replace(/\.jsonl$/i, '.manifest.json');
	const manifest = {
		generatedAt: new Date().toISOString(),
		script: 'scripts/sample-extraction-remit-eval-jsonl.ts',
		exportDir: args.exportDir,
		inputs: args.inputNames,
		outJsonl: args.outName,
		totalRequested: args.total,
		totalWritten: picked.length,
		seed: args.seed,
		minPerDomain: args.minPerDomain,
		maxPerSourceUrl: args.maxPerSourceUrl,
		excludeUrlSubstrings: args.excludeUrlSubstrings,
		distinctDomains: Object.keys(domainCounts).length,
		distinctSourceUrls: Object.keys(urlCounts).length,
		domainCounts,
		sourceUrlCounts: urlCounts
	};
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

	console.error(
		`[sample-remit-eval] wrote ${picked.length} lines → ${outPath}\n[sample-remit-eval] manifest → ${manifestPath} (${manifest.distinctDomains} domains, ${manifest.distinctSourceUrls} sources)`
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
