import { z } from 'zod';

export const EXTRACTION_SYSTEM = `You are a philosophical text analyst specialising in argument mining. Your task is to extract every atomic philosophical claim from the source text provided.

DEFINITION: An atomic claim is a single, self-contained assertion that could be true or false. It expresses one idea. It is not a paragraph. It is not a compound statement connected by "and" or "but."

FOR EACH CLAIM, PROVIDE:
- text: The claim in clear, concise language. Paraphrase if needed for clarity, but preserve philosophical precision. Do not simply quote — ensure the claim is intelligible without the surrounding context.
- claim_type: One of: thesis | premise | objection | response | definition | thought_experiment | empirical | methodological
- domain: One of: ethics | epistemology | metaphysics | philosophy_of_mind | political_philosophy | logic | aesthetics | philosophy_of_science | philosophy_of_language | applied_ethics | philosophy_of_ai
- section_context: The section or heading this claim appears under
- position_in_source: Sequential integer (1, 2, 3...) for ordering within the source
- confidence: Float 0.0–1.0. Use 1.0 for explicit, unambiguous claims. Use 0.7–0.9 for implied or reconstructed claims. Use below 0.7 only for highly interpretive extractions.

CLAIM TYPE DEFINITIONS:
- thesis: The main position or conclusion the author is arguing for
- premise: A claim offered as evidence or reasoning in support of a thesis
- objection: A challenge or counterargument to a position
- response: A direct reply to an objection
- definition: A philosophical definition of a key term (must be philosophically substantive, not dictionary)
- thought_experiment: A hypothetical scenario and what we should conclude from it
- empirical: A factual assertion that could in principle be verified or falsified
- methodological: A claim about how philosophical enquiry should be conducted

RULES:
- Extract CLAIMS, not summaries. 'Mill argues that...' is a summary. 'The only proof that something is desirable is that people actually desire it' is a claim.
- Distinguish premises from conclusions. If claim A is offered as evidence for claim B, A is a premise and B is a thesis.
- Include definitions when they are philosophically substantive.
- Include thought experiments as claims about what we should conclude from them.
- Do not extract claims that are purely expository (e.g., 'In this section I will argue...').
- If a claim is clearly stated multiple times, extract it once with the earliest position_in_source.

Respond ONLY with a valid JSON array. No preamble, no markdown backticks, no explanation.`;

export function EXTRACTION_USER(
	sourceTitle: string,
	sourceAuthor: string,
	sourceText: string
): string {
	return `Source: "${sourceTitle}" by ${sourceAuthor}\n\n<source_text>\n${sourceText}\n</source_text>`;
}

// Zod schema for extracted claims
export const ExtractionClaimSchema = z.object({
	text: z.string().describe('The claim in clear, concise language'),
	claim_type: z.enum([
		'thesis',
		'premise',
		'objection',
		'response',
		'definition',
		'thought_experiment',
		'empirical',
		'methodological'
	]),
	domain: z.enum([
		'ethics',
		'epistemology',
		'metaphysics',
		'philosophy_of_mind',
		'political_philosophy',
		'logic',
		'aesthetics',
		'philosophy_of_science',
		'philosophy_of_language',
		'applied_ethics',
		'philosophy_of_ai'
	]),
	section_context: z.string().nullable().optional().describe('The section or heading'),
	position_in_source: z.number().int().positive().describe('Sequential position in source'),
	confidence: z.number().min(0).max(1).describe('Confidence score 0.0-1.0')
});

export const ExtractionOutputSchema = z.array(ExtractionClaimSchema);

export type ExtractionClaim = z.infer<typeof ExtractionClaimSchema>;
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
