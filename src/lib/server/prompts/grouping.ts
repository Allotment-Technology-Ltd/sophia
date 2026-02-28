import { z } from 'zod';

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

Respond ONLY with a valid JSON array. No preamble, no markdown backticks.`;

export function GROUPING_USER(claimsJson: string, relationsJson: string): string {
	return `<claims>\n${claimsJson}\n</claims>\n\n<relations>\n${relationsJson}\n</relations>`;
}

// Zod schema for arguments
export const ArgumentClaimSchema = z.object({
	position_in_source: z.number().int().positive(),
	role: z.enum([
		'conclusion',
		'key_premise',
		'supporting_premise',
		'assumption',
		'objection',
		'response'
	])
});

export const ArgumentSchema = z.object({
	name: z.string().describe('Standard or descriptive name of the argument'),
	tradition: z.string().nullable().optional().describe('Philosophical school/tradition'),
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
	summary: z.string().describe('1-2 sentence description of what the argument establishes'),
	claims: z.array(ArgumentClaimSchema).describe('Claims with roles in this argument')
});

export const GroupingOutputSchema = z.array(ArgumentSchema);

export type ArgumentClaim = z.infer<typeof ArgumentClaimSchema>;
export type Argument = z.infer<typeof ArgumentSchema>;
export type GroupingOutput = z.infer<typeof GroupingOutputSchema>;
