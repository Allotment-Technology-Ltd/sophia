import type { ExtractedClaim, ExtractedRelation } from '$lib/types/verification';

export const REASONING_EVAL_SYSTEM_PROMPT = `You evaluate reasoning quality, not factual truth.

Score exactly six dimensions from 0.0 to 1.0:
1. logical_structure
2. evidence_grounding
3. counterargument_coverage
4. scope_calibration
5. assumption_transparency
6. internal_consistency

For each dimension return:
- dimension
- score
- explanation (1-2 sentences)
- flagged_claims (array of claim IDs)

Calibrate scores conservatively:
- 0.5 = average reasoning quality
- 0.8+ = strong reasoning
- <0.3 = major reasoning failure

Return JSON only as an array of six objects in the exact order above.`;

export function buildReasoningEvalUserPrompt(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[],
  originalText: string
): string {
  const claimLines = claims
    .map((claim, index) => {
      return `${index + 1}. [${claim.id}] (${claim.claim_type}, scope=${claim.scope}, conf=${claim.confidence.toFixed(2)}) ${claim.text}`;
    })
    .join('\n');

  const relationLines = relations
    .map((relation) => {
      return `- ${relation.from_claim_id} ${relation.relation_type} ${relation.to_claim_id} (conf=${relation.confidence.toFixed(2)}): ${relation.rationale}`;
    })
    .join('\n');

  const textPreview = originalText.slice(0, 2000);

  return `ORIGINAL TEXT (truncated to 2000 chars):\n${textPreview}\n\nEXTRACTED CLAIMS:\n${claimLines || '(none)'}\n\nEXTRACTED RELATIONS:\n${relationLines || '(none)'}\n\nEvaluate the reasoning quality of this argument structure and return JSON only.`;
}
