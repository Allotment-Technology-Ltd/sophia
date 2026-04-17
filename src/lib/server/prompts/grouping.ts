import { z } from 'zod';
import { DOMAIN_VALUES, preprocessDomainForEnum } from './domainZod.js';

export const GROUPING_SYSTEM = `You are a philosophical argument cartographer. You have been given claims and relations extracted from a philosophical source. Your task is to identify the named argument structures they form.

A NAMED ARGUMENT is a recognisable philosophical position or line of reasoning with:
- A name — either a standard philosophical name or a clear descriptive name for novel arguments
- A tradition — the philosophical school it belongs to
- A domain — the primary philosophical domain
- A summary — 1–2 sentences describing what the argument establishes
- A set of claims with defined roles

CLAIM ROLES WITHIN AN ARGUMENT:
- conclusion: The main claim the argument establishes (usually 1)
- key_premise: A premise essential to the argument
- supporting_premise: A premise that strengthens but is not essential
- assumption: A background claim the argument relies on but does not argue for
- objection: A claim that challenges the argument
- response: A claim that replies to an objection

RULES:
- Not every claim belongs to a named argument.
- A claim can participate in multiple arguments with different roles.
- Use standard philosophical names where they exist.
- Each argument must have at least a conclusion and one key premise.
- **Role discipline:** each named argument should have **exactly one** \`conclusion\` role among its claims (the main claim that argument establishes). Do not label every claim as \`conclusion\`.
- **Output size:** prefer **fewer, sharper** arguments over many shallow ones. As a guide, emit **at most** \`ceil(N/4)\` named arguments for a batch of N claims (hard cap **20** arguments per response). Large encyclopedia batches should still stay sparse.
- **Positions:** every \`position_in_source\` in your output **must** match a claim in the provided \`<claims>\` JSON for this batch only. Never invent positions or copy positions from claims not listed in this batch.
- domain must be a single snake_case string matching the extraction taxonomy (same list as claim domain). Never output an array or comma-separated list for domain. If unsure, use philosophy_general.

OUTPUT — MACHINE-PARSEABLE JSON ONLY (pick **one** shape; the pipeline accepts both):
- **Preferred:** one JSON object \`{"named_arguments":[ ... ]}\` where the array holds the argument objects. First non-whitespace character \`{\`, last \`}\`.
- **Legacy:** a bare JSON array \`[ ... ]\` only (no wrapper). First non-whitespace \`[\`, last \`]\`.
- Use double quotes for keys and strings. No trailing commas. No markdown fences or commentary outside the JSON value.

Respond ONLY with that JSON (object or array). No preamble, no markdown backticks.`;

export function GROUPING_USER(claimsJson: string, relationsJson: string): string {
	return `<claims>\n${claimsJson}\n</claims>\n\n<relations>\n${relationsJson}\n</relations>`;
}

// Zod schema for arguments
const ARGUMENT_ROLE_VALUES = [
	'conclusion',
	'key_premise',
	'supporting_premise',
	'assumption',
	'objection',
	'response'
] as const;

function normalizeLabel(value: unknown): string | unknown {
	if (typeof value !== 'string') return value;
	return value.toLowerCase().trim().replace(/[\s-]+/g, '_');
}

function coercePositiveInt(value: unknown): unknown {
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue)) return value;
	return Math.max(1, Math.trunc(numberValue));
}

function normalizeArgumentRole(value: unknown): unknown {
	const normalized = normalizeLabel(value);
	if (typeof normalized !== 'string') return normalized;
	const roleMap: Record<string, (typeof ARGUMENT_ROLE_VALUES)[number]> = {
		conclusion: 'conclusion',
		thesis: 'conclusion',
		main_claim: 'conclusion',
		key_premise: 'key_premise',
		keypremise: 'key_premise',
		premise: 'key_premise',
		supporting_premise: 'supporting_premise',
		supportingpremise: 'supporting_premise',
		assumption: 'assumption',
		objection: 'objection',
		counterargument: 'objection',
		counter_argument: 'objection',
		response: 'response',
		reply: 'response',
		rebuttal: 'response'
	};
	if (roleMap[normalized]) return roleMap[normalized];
	if (normalized.includes('conclusion') || normalized.includes('thesis')) return 'conclusion';
	if (normalized.includes('supporting') && normalized.includes('premise')) return 'supporting_premise';
	if (normalized.includes('premise')) return 'key_premise';
	if (normalized.includes('assumption')) return 'assumption';
	if (
		normalized.includes('objection') ||
		normalized.includes('counter') ||
		normalized.includes('critique')
	)
		return 'objection';
	if (
		normalized.includes('response') ||
		normalized.includes('reply') ||
		normalized.includes('rebut') ||
		normalized.includes('defense') ||
		normalized.includes('defence')
	)
		return 'response';
	return normalized;
}

export const ArgumentClaimSchema = z.object({
	position_in_source: z.preprocess(coercePositiveInt, z.number().int().positive()),
	role: z.preprocess(normalizeArgumentRole, z.enum(ARGUMENT_ROLE_VALUES))
});

export const ArgumentSchema = z.object({
	name: z.string().describe('Standard or descriptive name of the argument'),
	tradition: z.string().nullable().optional().describe('Philosophical school/tradition'),
	domain: z.preprocess(preprocessDomainForEnum, z.enum(DOMAIN_VALUES)),
	summary: z.string().describe('1-2 sentence description of what the argument establishes'),
	claims: z.array(ArgumentClaimSchema).describe('Claims with roles in this argument')
});

export const GroupingOutputSchema = z.array(ArgumentSchema);

/** Root object for schema-constrained `generateObject` calls (ingest Stage 3). */
export const GroupingStructuredRootSchema = z.object({
	named_arguments: GroupingOutputSchema
});

export type ArgumentClaim = z.infer<typeof ArgumentClaimSchema>;
export type Argument = z.infer<typeof ArgumentSchema>;
export type GroupingOutput = z.infer<typeof GroupingOutputSchema>;
