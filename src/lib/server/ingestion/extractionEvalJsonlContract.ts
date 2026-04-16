/**
 * Shared contract checks for Phase-1-style extraction eval JSONL rows
 * (`scripts/eval-extraction-holdout-openai-compatible.ts`, Step A / Together chat export).
 *
 * CI uses committed fixtures; operators may append G1-cleared rows from Neon manifests.
 */

import { ExtractionClaimSchema } from '../prompts/extraction.ts';

export type ExtractionEvalJsonlRow = {
	source_url?: string;
	input?: string;
	label?: unknown;
	/** Extra fields (split, run_id, …) are ignored by eval scripts. */
	[key: string]: unknown;
};

export function parseExtractionEvalJsonlLine(raw: string): ExtractionEvalJsonlRow | null {
	const t = raw.trim();
	if (!t) return null;
	try {
		return JSON.parse(t) as ExtractionEvalJsonlRow;
	} catch {
		return null;
	}
}

export function validateExtractionEvalJsonlRow(row: ExtractionEvalJsonlRow): { ok: true } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	if (!(typeof row.input === 'string' && row.input.trim().length > 0)) {
		errors.push('missing_nonempty_input');
	}
	if (row.label !== undefined) {
		const g = ExtractionClaimSchema.safeParse(row.label);
		if (!g.success) {
			errors.push(`label_invalid:${g.error.flatten().formErrors.join(';')}`);
		}
	}
	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** Count `<passage` open tags — batch-shaped prompts from `renderPassageBatch`. */
export function countPassageOpenTagsInInput(input: string): number {
	const m = input.match(/<passage\b/gi);
	return m?.length ?? 0;
}
