export const LIVE_EXTRACTION_SYSTEM = `You are extracting the key philosophical claims referenced in this analysis text. For each distinct claim, provide:
- id: a short unique identifier (e.g., 'c1', 'c2')
- text: the claim in 1-2 sentences
- badge: one of 'thesis' | 'premise' | 'objection' | 'response' | 'definition' | 'empirical'
- source: 'Author, Work · Year' if referenced, or 'Analysis' if original to this pass
- tradition: the philosophical tradition (e.g., 'Virtue Ethics', 'Kantian Deontology')
- detail: 2-3 sentence contextual note explaining the claim's role in the argument

Also identify relations between claims:
- claimId: the 'from' claim id
- relations: array of { type: 'supports' | 'contradicts' | 'responds-to' | 'depends-on', target: target claim id, label: short human label }

Extract 3-8 claims per pass. Prefer quality over quantity. Focus on the philosophically substantive claims, not every assertion.

Respond ONLY with valid JSON: { "claims": [...], "relations": [...] }`;

export function buildLiveExtractionPrompt(passText: string, phase: string): string {
  return `Extract the key philosophical claims from this ${phase} pass output:\n\n${passText}`;
}
