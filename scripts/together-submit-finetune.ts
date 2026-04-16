/**
 * Upload a Together chat JSONL file and start a LoRA fine-tune job (Together REST API).
 *
 * Env: **`TOGETHER_API_KEY`** (required)
 *
 * Defaults (Together-supported LoRA base as of API check 2026-04):
 * - model: `mistralai/Mistral-7B-Instruct-v0.2` (v0.3 rejected LoRA config on Together — override with `--model` if a newer id is supported)
 * - n_epochs: 3, batch_size: 8 (Together API rejected 4: "batch size is lower than 8"), learning_rate: 2e-4
 *
 * Usage:
 *   pnpm exec tsx scripts/together-submit-finetune.ts -- \
 *     --training-file data/phase1-training-export/train.together.jsonl
 *
 *   pnpm exec tsx scripts/together-submit-finetune.ts -- --training-file train.jsonl --dry-run
 *
 * **Not legal advice.** Train only on G1-cleared exports; complete **`pause-after-vendor-ft`** first.
 *
 * API reference: https://docs.together.ai/reference/post-fine-tunes (confirm field names before production runs).
 */

import { basename } from 'node:path';
import { loadServerEnv } from '../src/lib/server/env.ts';

const TOGETHER_API_BASE = 'https://api.together.xyz/v1';

async function uploadTrainingFile(apiKey: string, filePath: string): Promise<{ id: string }> {
	const body = new FormData();
	body.append('purpose', 'fine-tune');
	const buf = await import('node:fs/promises').then((fs) => fs.readFile(filePath));
	const name = basename(filePath);
	body.append('file_name', name);
	body.append('file_type', 'jsonl');
	body.append('file', new Blob([buf], { type: 'application/octet-stream' }), name);

	const res = await fetch(`${TOGETHER_API_BASE}/files/upload`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}` },
		body
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Together file upload failed (${res.status}): ${text}`);
	}
	const json = JSON.parse(text) as { id?: string };
	if (!json.id) throw new Error(`Together file upload: missing id in response: ${text}`);
	return { id: json.id };
}

async function createFineTune(
	apiKey: string,
	body: Record<string, unknown>
): Promise<unknown> {
	const res = await fetch(`${TOGETHER_API_BASE}/fine-tunes`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Together fine-tune create failed (${res.status}): ${text}`);
	}
	return JSON.parse(text) as unknown;
}

function parseArgs(argv: string[]): {
	trainingFile: string;
	validationFile: string | null;
	model: string;
	nEpochs: number;
	batchSize: number;
	learningRate: number;
	dryRun: boolean;
} {
	let trainingFile = '';
	let validationFile: string | null = null;
	let model = 'mistralai/Mistral-7B-Instruct-v0.2';
	let nEpochs = 3;
	let batchSize = 8;
	let learningRate = 2e-4;
	let dryRun = argv.includes('--dry-run');
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--training-file' && argv[i + 1]) trainingFile = argv[++i]!;
		else if (a === '--validation-file' && argv[i + 1]) validationFile = argv[++i]!;
		else if (a === '--model' && argv[i + 1]) model = argv[++i]!;
		else if (a === '--n-epochs' && argv[i + 1]) nEpochs = Math.max(1, parseInt(argv[++i]!, 10));
		else if (a === '--batch-size' && argv[i + 1]) batchSize = Math.max(1, parseInt(argv[++i]!, 10));
		else if (a === '--learning-rate' && argv[i + 1]) learningRate = Number(argv[++i]!);
	}
	if (!trainingFile && !dryRun) {
		console.error(
			'Usage: --training-file <train.together.jsonl> [--validation-file val.jsonl] [--model …] [--n-epochs 3] [--batch-size 4] [--learning-rate 0.0002] [--dry-run]'
		);
		process.exit(2);
	}
	return { trainingFile, validationFile, model, nEpochs, batchSize, learningRate, dryRun };
}

async function main() {
	loadServerEnv();
	const opts = parseArgs(process.argv.slice(2));

	const apiKey = process.env.TOGETHER_API_KEY?.trim();
	if (!opts.dryRun && !apiKey) {
		console.error('Missing TOGETHER_API_KEY (not required for --dry-run)');
		process.exit(2);
	}

	if (opts.dryRun) {
		console.log(
			JSON.stringify(
				{
					dryRun: true,
					wouldUpload: opts.trainingFile || null,
					model: opts.model,
					n_epochs: opts.nEpochs,
					n_checkpoints: 1,
					n_evals: 1,
					batch_size: opts.batchSize,
					learning_rate: opts.learningRate,
					training_method: { method: 'sft', train_on_inputs: 'auto' },
					note: 'LoRA is the API default when training_type is omitted; see POST /fine-tunes OpenAPI.'
				},
				null,
				2
			)
		);
		return;
	}

	if (!opts.trainingFile) {
		console.error('Internal: training file required when not dry-run');
		process.exit(2);
	}

	const trainUp = await uploadTrainingFile(apiKey, opts.trainingFile);
	let validation_file: string | undefined;
	if (opts.validationFile) {
		const v = await uploadTrainingFile(apiKey, opts.validationFile);
		validation_file = v.id;
	}

	const payload: Record<string, unknown> = {
		training_file: trainUp.id,
		model: opts.model,
		n_epochs: opts.nEpochs,
		n_checkpoints: 1,
		n_evals: 1,
		batch_size: opts.batchSize,
		learning_rate: opts.learningRate,
		/** Supervised fine-tuning on chat JSONL (`messages` format). */
		training_method: { method: 'sft', train_on_inputs: 'auto' }
	};
	if (validation_file) payload.validation_file = validation_file;

	const job = await createFineTune(apiKey, payload);
	console.log(JSON.stringify({ ok: true, training_file_id: trainUp.id, job }, null, 2));
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
