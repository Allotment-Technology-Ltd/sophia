/**
 * Create Fireworks datasets (train + optional val) and start a supervised fine-tuning job
 * via the Fireworks REST API — **same chat JSONL** as Together (`train.together.jsonl` from
 * `pnpm ops:phase2-step-a-together-packaging`).
 *
 * **Prerequisites**
 * - `FIREWORKS_API_KEY`
 * - `FIREWORKS_ACCOUNT_ID` **or** `EXTRACTION_MODEL` like `accounts/<account_id>/deployments/...`
 *   (account id is inferred from the latter).
 * - G1-cleared export; see `docs/sophia/extraction-ft-lean-plan.md`.
 *
 * **Starting weights (exactly one):**
 * - **`--base-model`** — Fireworks **Tunable** model id. For Sophia’s uploaded merged extraction
 *   weights (Together → HF → `firectl model create`), use **`accounts/adam-boon1984-17nryg/models/sophia-extract-m7b-ft`**
 *   **only if** `firectl model get sophia-extract-m7b-ft` shows **`Tunable: true`** (vendor policy).
 * - **`--warm-start-from`** — Continue from a **prior Fireworks SFT output** (PEFT on platform); mutually exclusive with `--base-model` per Fireworks API.
 *
 * **API reference (confirm before production):**
 * - https://docs.fireworks.ai/api-reference/create-dataset
 * - https://docs.fireworks.ai/api-reference/create-supervised-fine-tuning-job
 *
 * **Alternative (no script):** `firectl dataset create …` then `firectl sftj create …` per
 * https://docs.fireworks.ai/fine-tuning/fine-tuning-models
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/fireworks-submit-sft.ts -- --dry-run \
 *     --training-file data/phase1-training-export/train.together.jsonl \
 *     --base-model accounts/adam-boon1984-17nryg/models/sophia-extract-m7b-ft \
 *     --output-model sophia-extract-sft-iter1
 *
 *   pnpm exec tsx --env-file=.env scripts/fireworks-submit-sft.ts -- \
 *     --training-file data/phase1-training-export/train.together.jsonl \
 *     --validation-file data/phase1-training-export/validation.together.jsonl \
 *     --warm-start-from accounts/adam-boon1984-17nryg/models/my-prior-sft-output \
 *     --output-model sophia-extract-sft-iter2 \
 *     --write-report data/phase1-training-export/fireworks-sft-job-submitted.json
 */

import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import readline from 'node:readline';
import { loadServerEnv } from '../src/lib/server/env.ts';

const FW_API = 'https://api.fireworks.ai';

function inferAccountId(): string | null {
	const fromEnv = process.env.FIREWORKS_ACCOUNT_ID?.trim();
	if (fromEnv) return fromEnv;
	const model = process.env.EXTRACTION_MODEL?.trim() ?? '';
	const m = model.match(/^accounts\/([^/]+)\/(?:deployments|models)\//);
	return m?.[1] ?? null;
}

async function countJsonlExamples(filePath: string): Promise<number> {
	let n = 0;
	const rl = readline.createInterface({
		input: createReadStream(filePath, { encoding: 'utf8' }),
		crlfDelay: Infinity
	});
	for await (const line of rl) {
		if (line.trim()) n++;
	}
	return n;
}

function parseArgs(argv: string[]): {
	trainingFile: string;
	validationFile: string | null;
	accountId: string | null;
	baseModel: string;
	warmStartFrom: string;
	outputModel: string;
	trainDatasetId: string | null;
	valDatasetId: string | null;
	epochs: number;
	loraRank: number | null;
	dryRun: boolean;
	writeReport: string | null;
} {
	let trainingFile = '';
	let validationFile: string | null = null;
	let accountId: string | null = null;
	let baseModel = '';
	let warmStartFrom = '';
	let outputModel = '';
	let trainDatasetId: string | null = null;
	let valDatasetId: string | null = null;
	let epochs = 1;
	let loraRank: number | null = null;
	let dryRun = argv.includes('--dry-run');
	let writeReport: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--training-file' && argv[i + 1]) trainingFile = argv[++i]!;
		else if (a === '--validation-file' && argv[i + 1]) validationFile = argv[++i]!;
		else if (a === '--account-id' && argv[i + 1]) accountId = argv[++i]!;
		else if (a === '--base-model' && argv[i + 1]) baseModel = argv[++i]!;
		else if (a === '--warm-start-from' && argv[i + 1]) warmStartFrom = argv[++i]!;
		else if (a === '--output-model' && argv[i + 1]) outputModel = argv[++i]!;
		else if (a === '--train-dataset-id' && argv[i + 1]) trainDatasetId = argv[++i]!;
		else if (a === '--val-dataset-id' && argv[i + 1]) valDatasetId = argv[++i]!;
		else if (a === '--epochs' && argv[i + 1]) epochs = Math.max(0.1, Number(argv[++i]!));
		else if (a === '--lora-rank' && argv[i + 1]) loraRank = parseInt(argv[++i]!, 10);
		else if (a === '--write-report' && argv[i + 1]) writeReport = argv[++i]!;
	}
	return {
		trainingFile,
		validationFile,
		accountId,
		baseModel,
		warmStartFrom,
		outputModel,
		trainDatasetId,
		valDatasetId,
		epochs,
		loraRank,
		dryRun,
		writeReport
	};
}

async function fwFetch(
	apiKey: string,
	path: string,
	init: RequestInit & { jsonBody?: unknown } = {}
): Promise<Response> {
	const { jsonBody, ...rest } = init;
	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		...(rest.headers as Record<string, string> | undefined)
	};
	let body: BodyInit | undefined = rest.body;
	if (jsonBody !== undefined) {
		headers['Content-Type'] = 'application/json';
		body = JSON.stringify(jsonBody);
	}
	return fetch(`${FW_API}${path}`, { ...rest, headers, body });
}

async function createDataset(
	apiKey: string,
	accountId: string,
	datasetId: string,
	exampleCount: number
): Promise<unknown> {
	const path = `/v1/accounts/${encodeURIComponent(accountId)}/datasets`;
	const res = await fwFetch(apiKey, path, {
		method: 'POST',
		jsonBody: {
			datasetId,
			dataset: {
				userUploaded: {},
				exampleCount: String(exampleCount),
				format: 'CHAT'
			}
		}
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Fireworks create dataset (${datasetId}) ${res.status}: ${text}`);
	}
	return JSON.parse(text) as unknown;
}

async function uploadDatasetJsonl(
	apiKey: string,
	accountId: string,
	datasetId: string,
	filePath: string
): Promise<void> {
	const buf = await readFile(filePath);
	const path = `/v1/accounts/${encodeURIComponent(accountId)}/datasets/${encodeURIComponent(datasetId)}:upload`;
	const form = new FormData();
	form.append('file', new Blob([buf], { type: 'application/x-ndjson' }), basename(filePath));
	const res = await fetch(`${FW_API}${path}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}` },
		body: form
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Fireworks dataset upload (${datasetId}) ${res.status}: ${text}`);
	}
}

async function createSupervisedFineTuningJob(
	apiKey: string,
	accountId: string,
	body: Record<string, unknown>
): Promise<unknown> {
	const path = `/v1/accounts/${encodeURIComponent(accountId)}/supervisedFineTuningJobs`;
	const res = await fwFetch(apiKey, path, { method: 'POST', jsonBody: body });
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Fireworks create supervisedFineTuningJob ${res.status}: ${text}`);
	}
	return JSON.parse(text) as unknown;
}

function slugDatasetId(prefix: string): string {
	const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
	const safe = prefix.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 40);
	return `${safe}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

async function main(): Promise<void> {
	loadServerEnv();
	const opts = parseArgs(process.argv.slice(2));
	const apiKey = process.env.FIREWORKS_API_KEY?.trim();
	const accountId = opts.accountId ?? inferAccountId();

	if (!opts.trainingFile && !opts.dryRun) {
		console.error(
			'Usage: --training-file <train.together.jsonl> [--validation-file val.jsonl] \\\n' +
				'  (--base-model <accounts/.../models/...> | --warm-start-from <accounts/.../models/...>) \\\n' +
				'  --output-model <slug> [--account-id …] [--train-dataset-id …] [--val-dataset-id …] \\\n' +
				'  [--epochs 1] [--lora-rank 8] [--write-report path.json] [--dry-run]'
		);
		process.exit(2);
	}

	if (!opts.dryRun && !apiKey) {
		console.error('Missing FIREWORKS_API_KEY (omit for --dry-run only)');
		process.exit(2);
	}
	if (!opts.dryRun && !accountId) {
		console.error(
			'Missing account id: set FIREWORKS_ACCOUNT_ID or EXTRACTION_MODEL=accounts/<id>/deployments/...'
		);
		process.exit(2);
	}
	if (!opts.outputModel.trim()) {
		console.error('Required: --output-model');
		process.exit(2);
	}
	const base = opts.baseModel.trim();
	const warm = opts.warmStartFrom.trim();
	if ((base && warm) || (!base && !warm)) {
		console.error('Provide exactly one of --base-model or --warm-start-from (Fireworks API).');
		process.exit(2);
	}

	let trainExamples = 0;
	let valExamples = 0;
	if (opts.trainingFile) {
		trainExamples = await countJsonlExamples(opts.trainingFile);
	}
	if (opts.validationFile) {
		valExamples = await countJsonlExamples(opts.validationFile);
	}

	const trainDatasetId = opts.trainDatasetId ?? slugDatasetId('sophia-train');
	const valDatasetId = opts.valDatasetId ?? (opts.validationFile ? slugDatasetId('sophia-val') : null);

	const jobPayload: Record<string, unknown> = {
		dataset: trainDatasetId,
		outputModel: opts.outputModel.trim(),
		epochs: opts.epochs
	};
	if (warm) {
		jobPayload.warmStartFrom = warm;
	} else {
		jobPayload.baseModel = base;
	}
	if (opts.validationFile && valDatasetId) {
		jobPayload.evaluationDataset = valDatasetId;
	}
	if (opts.loraRank != null && Number.isFinite(opts.loraRank)) {
		jobPayload.loraRank = opts.loraRank;
	}

	if (opts.dryRun) {
		console.log(
			JSON.stringify(
				{
					dryRun: true,
					accountId: accountId ?? '(infer from FIREWORKS_ACCOUNT_ID or EXTRACTION_MODEL)',
					trainDatasetId,
					valDatasetId,
					trainingFile: opts.trainingFile || null,
					validationFile: opts.validationFile,
					trainExamples,
					valExamples,
					wouldPostJob: jobPayload,
					note: 'Confirm datasetId naming rules: https://docs.fireworks.ai/getting-started/concepts#resource-names-and-ids'
				},
				null,
				2
			)
		);
		return;
	}

	await createDataset(apiKey!, accountId!, trainDatasetId, trainExamples);
	await uploadDatasetJsonl(apiKey!, accountId!, trainDatasetId, opts.trainingFile);

	if (opts.validationFile && valDatasetId) {
		await createDataset(apiKey!, accountId!, valDatasetId, valExamples);
		await uploadDatasetJsonl(apiKey!, accountId!, valDatasetId, opts.validationFile);
	}

	const job = await createSupervisedFineTuningJob(apiKey!, accountId!, jobPayload);
	const out = {
		ok: true,
		generatedAt: new Date().toISOString(),
		accountId,
		trainDatasetId,
		valDatasetId,
		trainingFile: opts.trainingFile,
		validationFile: opts.validationFile,
		trainExamples,
		valExamples,
		jobPayload,
		job
	};
	console.log(JSON.stringify(out, null, 2));

	if (opts.writeReport) {
		const { mkdirSync, writeFileSync } = await import('node:fs');
		const { dirname } = await import('node:path');
		mkdirSync(dirname(opts.writeReport), { recursive: true });
		writeFileSync(opts.writeReport, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
		console.error(`Wrote ${opts.writeReport}`);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
