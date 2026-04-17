import { z } from 'zod';
import { CLAIM_ORIGIN_VALUES, CLAIM_SCOPE_VALUES } from '../ingestion/contracts.js';
import { DOMAIN_VALUES, preprocessDomainForEnum } from './domainZod.js';

export const EXTRACTION_SYSTEM = `You are a philosophical text analyst specialising in argument mining. Your task is to extract every atomic philosophical claim from the argumentative passages provided.

COVERAGE (read carefully — common failure mode):
- A single API call may include **many** <passage> blocks. You must return a **JSON array with many claim objects** when the text supports them—typically **several claims per passage** for dense argumentative prose (definitions, distinctions, objections, replies, methodological points each become separate claims when each is atomic).
- **Do not** return one mega-claim or one vague summary for a whole multi-passage batch. **Do not** collapse a section into a single "the author discusses X" claim unless the passages truly contain no further assertible content.
- Work **passage by passage**: for each passage id, ask what distinct assertions it supports; list them as separate objects with the correct passage_id and position_in_source.
- Long encyclopedia articles often pack multiple theses and supporting steps in one passage—split them into separate atomic claims rather than one long compound "text" field.

DEFINITION: An atomic claim is a single, self-contained assertion that could be true or false. It expresses one idea. It is not a paragraph. It is not a compound statement connected by "and" or "but."

FOR EACH CLAIM, PROVIDE:
- text: The claim in clear, concise language. Paraphrase if needed for clarity, but preserve philosophical precision. Do not simply quote — ensure the claim is intelligible without the surrounding context.
- claim_type: One of: thesis | premise | objection | response | definition | thought_experiment | empirical | methodological
- claim_origin: One of: source_grounded | interpretive | synthetic | user_generated
- domain: One snake_case slug from the taxonomy (examples): aesthetics, applied_ethics, comparative_philosophy, epistemology, ethics, feminist_philosophy, history_of_philosophy, logic, metaphilosophy, metaphysics, philosophy_general, philosophy_of_ai, philosophy_of_biology, philosophy_of_language, philosophy_of_law, philosophy_of_mathematics, philosophy_of_mind, philosophy_of_religion, philosophy_of_science, philosophy_of_social_science, political_philosophy. Use philosophy_general only when no closer fit applies.
- subdomain: A short subdomain label such as normative_ethics, metaethics, consciousness, skepticism
- thinker: The primary thinker most directly associated with the claim, if clear
- tradition: The primary philosophical tradition most directly associated with the claim, if clear
- era: A short era label such as ancient, early_modern, modern, contemporary
- claim_scope: One of: normative | descriptive | metaphilosophical | empirical
- concept_tags: 1-5 short concept tags for the claim
- passage_id: The id of the <passage> block where the claim appears
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
- Use the supplied passage ids exactly as given.
- **Passage-only grounding (critical):** Every claim must be supportable from the text inside the <passage> block whose id you assign to the passage_id field. Do not import facts from outside the supplied source text (no prior encyclopedia knowledge, no other sections, no bibliography). If something is only implied by background knowledge and not by the passage, either omit it or mark claim_origin as interpretive with lower confidence.
- For long or encyclopedia-style sources, stay within the passage you tag: do not “complete” the article from memory.
- Distinguish premises from conclusions. If claim A is offered as evidence for claim B, A is a premise and B is a thesis.
- Use source_grounded unless the claim is clearly interpretive or synthetic. user_generated should be extremely rare in ingestion.
- Include definitions when they are philosophically substantive.
- Include thought experiments as claims about what we should conclude from them.
- Do not extract claims that are purely expository (e.g., 'In this section I will argue...').
- If a claim is clearly stated multiple times, extract it once with the earliest position_in_source.
- Prefer **recall** over excessive merging: if unsure whether two sentences are one claim or two, split into two claims with appropriate confidence.

OUTPUT — MACHINE-PARSEABLE JSON ONLY:
- Return exactly one JSON array of claim objects. No wrapper object, no key wrapping the array.
- The first non-whitespace character must be "[" and the last must be "]".
- Never emit a bare single object as the full response (wrong: {"text":"…",…}). Never concatenate multiple top-level objects without an array (wrong: {"text":"…"} , {"text":"…"}). If you have one claim, respond as a one-element array: [{"text":"…",…}].
- Do not prefix or suffix the array with an extra object, summary, or duplicate closing brackets.
- Use double quotes for every key and string value. Escape literal double-quotes inside strings as \\" and line breaks as \\n.
- **In each "text" value, write plain prose only.** Never paste raw \`<passage>…</passage>\` XML, HTML, or other angle-bracket markup into JSON strings — it breaks JSON escaping and invalidates the output. Paraphrase the claim; use **passage_id** to reference the passage.
- No trailing commas after the last property or array element. No comments, no NaN/Infinity, no undefined.
- Do not wrap the array in markdown code fences or add any text before or after the array.

Example shape (illustrative): [{"text":"…","claim_type":"premise",…}]

Respond ONLY with that JSON array. No preamble, no markdown, no explanation.`;

export type ExtractionUserOptions = {
	/** When >1, appends a scope reminder so the model does not emit a single claim for an entire batch. */
	passageCount?: number;
};

export function EXTRACTION_USER(
	sourceTitle: string,
	sourceAuthor: string,
	sourceText: string,
	options?: ExtractionUserOptions
): string {
	const base = `Source: "${sourceTitle}" by ${sourceAuthor}\n\n<source_text>\n${sourceText}\n</source_text>`;
	const n = options?.passageCount;
	if (typeof n === 'number' && Number.isFinite(n) && n > 1) {
		return `${base}

---
SCOPE FOR THIS REQUEST:
- The <source_text> above contains **${n}** distinct <passage> blocks (each with an id).
- Your JSON array must usually include **multiple** claim objects—often **several per passage** when the material is argumentative. One claim for all ${n} passages is almost always incorrect.
- Enumerate claims in passage order; use each passage's id in passage_id and keep position_in_source consistent with the source ordering rules.`;
	}
	return base;
}

// Zod schema for extracted claims
const CLAIM_TYPE_VALUES = [
	'thesis',
	'premise',
	'objection',
	'response',
	'definition',
	'thought_experiment',
	'empirical',
	'methodological'
] as const;

function normalizeStringList(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value
			.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
			.filter(Boolean)
			.slice(0, 8);
	}
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean)
			.slice(0, 8);
	}
	return value;
}

function normalizeLabel(value: unknown): string | unknown {
	if (typeof value !== 'string') return value;
	return value.toLowerCase().trim().replace(/[\s-]+/g, '_');
}

function coercePositiveInt(value: unknown): unknown {
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue)) return value;
	return Math.max(1, Math.trunc(numberValue));
}

function normalizeClaimType(value: unknown): unknown {
	const normalized = normalizeLabel(value);
	if (typeof normalized !== 'string') return normalized;
	const claimTypeMap: Record<string, (typeof CLAIM_TYPE_VALUES)[number]> = {
		thesis: 'thesis',
		premise: 'premise',
		objection: 'objection',
		counterargument: 'objection',
		counter_argument: 'objection',
		response: 'response',
		reply: 'response',
		rebuttal: 'response',
		definition: 'definition',
		thought_experiment: 'thought_experiment',
		thoughtexperiment: 'thought_experiment',
		empirical: 'empirical',
		methodological: 'methodological'
	};
	return claimTypeMap[normalized] ?? normalized;
}

/** LLMs often emit `null` for optional fields; Zod `.optional()` does not accept `null`. */
function nullishOptionalString(value: unknown): unknown {
	if (value === null || value === undefined) return undefined;
	if (typeof value === 'string') {
		const t = value.trim();
		return t === '' ? undefined : t;
	}
	return value;
}

export const ExtractionClaimSchema = z.object({
	text: z.string().describe('The claim in clear, concise language'),
	claim_type: z.preprocess(normalizeClaimType, z.enum(CLAIM_TYPE_VALUES)),
	claim_origin: z.preprocess(normalizeLabel, z.enum(CLAIM_ORIGIN_VALUES)).optional(),
	domain: z.preprocess(preprocessDomainForEnum, z.enum(DOMAIN_VALUES)),
	subdomain: z.preprocess(nullishOptionalString, z.string().optional()),
	thinker: z.preprocess(nullishOptionalString, z.string().min(1).optional()),
	tradition: z.preprocess(nullishOptionalString, z.string().min(1).optional()),
	era: z.preprocess(nullishOptionalString, z.string().min(1).optional()),
	claim_scope: z.preprocess(normalizeLabel, z.enum(CLAIM_SCOPE_VALUES)).optional(),
	concept_tags: z.preprocess(normalizeStringList, z.array(z.string()).max(8)).optional(),
	passage_id: z
		.preprocess(nullishOptionalString, z.string().optional())
		.describe('Passage id where the claim appears (omit or null if unknown — attachPassageMetadata grounds)'),
	section_context: z.string().nullable().optional().describe('The section or heading'),
	position_in_source: z.preprocess(coercePositiveInt, z.number().int().positive()).describe('Sequential position in source'),
	confidence: z.coerce.number().min(0).max(1).describe('Confidence score 0.0-1.0')
});

export const ExtractionOutputSchema = z.array(ExtractionClaimSchema);

export type ExtractionClaim = z.infer<typeof ExtractionClaimSchema>;
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
