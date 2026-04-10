import { z } from 'zod';

/**
 * Passage-bounded claim repair after validation — output is strict JSON only.
 * Models must not change ordering keys (position_in_source is checked against input).
 */
export const REMEDIATION_REPAIR_SYSTEM = `You revise a single extracted philosophical claim so it stays faithful to the passage excerpt.

Rules:
- Output ONLY valid JSON (no markdown fences, no commentary).
- The claim must remain one atomic philosophical claim.
- You MUST preserve the given position_in_source exactly — do not renumber or invent positions.
- Revise claim text only when needed so it matches what the passage actually supports; prefer minimal edits.
- If the passage does not support the claim, rewrite the claim to a weaker, accurate formulation grounded in the passage, or state the limitation explicitly in the claim text.
- Do not add citations, line numbers, or text outside the JSON object.`;

export interface RemediationRepairUserInput {
	position_in_source: number;
	passage_excerpt: string;
	claim_json: string;
	validation_issues: string[];
}

export function REMEDIATION_REPAIR_USER(input: RemediationRepairUserInput): string {
	const issues =
		input.validation_issues.length > 0
			? input.validation_issues.map((s) => `- ${s}`).join('\n')
			: '- (none listed — improve faithfulness if needed)';
	return `<position_in_source>${input.position_in_source}</position_in_source>

<passage_excerpt>
${input.passage_excerpt}
</passage_excerpt>

<current_claim_json>
${input.claim_json}
</current_claim_json>

<validation_issues>
${issues}
</validation_issues>

Respond with JSON only:
{"position_in_source":${input.position_in_source},"revised_claim_text":"...","notes":"optional short rationale"}`;
}

export const RemediationRepairOutputSchema = z.object({
	position_in_source: z.number().int().positive(),
	revised_claim_text: z.string().min(1),
	notes: z.string().max(4000).optional()
});

export type RemediationRepairOutput = z.infer<typeof RemediationRepairOutputSchema>;

export function normalizeRemediationRepairOutput(
	raw: unknown,
	expectedPosition: number
): { revised_claim_text: string; notes?: string } {
	const parsed = RemediationRepairOutputSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(`[REMEDIATION] Invalid repair JSON: ${parsed.error.message}`);
	}
	if (parsed.data.position_in_source !== expectedPosition) {
		throw new Error(
			`[REMEDIATION] Model changed position_in_source (${parsed.data.position_in_source} vs ${expectedPosition}) — rejected`
		);
	}
	return {
		revised_claim_text: parsed.data.revised_claim_text.trim(),
		notes: parsed.data.notes?.trim() || undefined
	};
}
