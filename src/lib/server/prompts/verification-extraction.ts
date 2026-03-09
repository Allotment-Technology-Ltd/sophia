import type { VerificationRequest } from '$lib/types/verification';

export const VERIFICATION_EXTRACTION_SYSTEM_PROMPT = `You extract atomic claims and logical relations from arbitrary domain text.

Return your answer as prose followed by a required sophia-meta fenced code block.
The sophia-meta block must contain valid JSON with this shape:
{
  "claims": [{
    "id": "claim_001",
    "text": "...",
    "claim_type": "empirical|causal|explanatory|normative|predictive|definitional|procedural",
    "scope": "narrow|moderate|broad|universal",
    "confidence": 0.0,
    "source_span": "...",
    "source_span_start": 0,
    "source_span_end": 0
  }],
  "relations": [{
    "from_claim_id": "claim_001",
    "to_claim_id": "claim_002",
    "relation_type": "supports|contradicts|depends_on|refines|qualifies|assumes",
    "confidence": 0.0,
    "rationale": "..."
  }]
}

Requirements:
- Claims must be atomic and self-contained.
- Only include relations where both claim IDs exist.
- Confidence values must be in [0,1].
- Output JSON only in the sophia-meta block; no markdown lists inside it.`;

export function buildVerificationExtractionUserPrompt(request: VerificationRequest): string {
  const parts: string[] = [];

  if (request.domain_hint) {
    parts.push(`DOMAIN CONTEXT: This text is from the ${request.domain_hint} domain. Apply domain-appropriate interpretation.`);
  }

  if (request.question?.trim()) {
    parts.push(`QUESTION:\n${request.question.trim()}`);
  }

  if (request.answer?.trim()) {
    parts.push(`ANSWER:\n${request.answer.trim()}`);
  }

  if (request.text?.trim()) {
    parts.push(`TEXT:\n${request.text.trim()}`);
  }

  parts.push('Extract claims and relations from the provided content.');

  return parts.join('\n\n');
}
