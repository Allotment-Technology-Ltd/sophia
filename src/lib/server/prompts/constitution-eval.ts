import type { ConstitutionRule } from '$lib/types/constitution';
import type { ExtractedClaim, ExtractedRelation } from '$lib/types/verification';

export interface ConstitutionEvalHeuristics {
  proportional_evidence_low_support_claim_ids?: string[];
}

export const CONSTITUTION_EVAL_SYSTEM_PROMPT = `You are an epistemic quality auditor. You evaluate whether reasoning meets specific standards of intellectual rigour.

You will be given:
1. A set of extracted claims with types and scopes
2. Logical relations between those claims
3. A set of epistemic rules to evaluate

For each rule, determine:
- "satisfied": The reasoning clearly meets this standard
- "violated": The reasoning clearly fails this standard
- "uncertain": Cannot determine from available information
- "not_applicable": The rule does not apply to this text

Be conservative: prefer "uncertain" over false "violated".
Every violation must cite specific claim IDs.
Every violation must include a remediation suggestion.

Return JSON only as an array. Each object must include:
- rule_id
- status
- affected_claim_ids (array of claim IDs)
- rationale
- remediation (required when status is "violated")`;

export function buildConstitutionEvalUserPrompt(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[],
  rules: ConstitutionRule[],
  originalText: string,
  heuristics: ConstitutionEvalHeuristics = {}
): string {
  const payload = {
    original_text_preview: originalText.slice(0, 3000),
    claims: claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      claim_type: claim.claim_type,
      scope: claim.scope,
      confidence: claim.confidence
    })),
    relations,
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      severity: rule.severity,
      applies_to: rule.applies_to
    })),
    heuristics
  };

  return `Evaluate the rules against this argument structure and return JSON only.\n\n${JSON.stringify(
    payload,
    null,
    2
  )}`;
}
