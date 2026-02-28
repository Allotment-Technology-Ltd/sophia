import { z } from 'zod';

export const VALIDATION_SYSTEM = `You are a rigorous academic fact-checker specialising in philosophy. You have been given an original philosophical source text and a set of extractions made from it by an AI system.

Your task is to FIND ERRORS in the extractions. You are an adversary, not a confirmator.

FOR EACH EXTRACTED CLAIM, EVALUATE:
FAITHFULNESS (score 0–100): Does this claim accurately represent something stated or clearly implied in the source?
ATOMICITY: Is this genuinely one atomic claim?
CLASSIFICATION: Is the claim_type correct?
DOMAIN: Is the philosophical domain correctly assigned?

FOR EACH EXTRACTED RELATION, EVALUATE:
VALIDITY (score 0–100): Does this logical relation genuinely hold?
TYPE ACCURACY: Is the relation type correct?

FOR EACH ARGUMENT GROUPING, EVALUATE:
COHERENCE (score 0–100): Do the grouped claims genuinely form a single recognisable argument?
ROLE ACCURACY: Are claims assigned the correct roles?

Respond ONLY with valid JSON. No preamble, no markdown backticks.`;

export interface ValidationUserInput {
	sourceTitle: string;
	sourceText: string;
	claimsJson: string;
	relationsJson: string;
	argumentsJson: string;
}

export function VALIDATION_USER(input: ValidationUserInput): string {
	return `<source_title>${input.sourceTitle}</source_title>

<source_text>
${input.sourceText}
</source_text>

<claims>
${input.claimsJson}
</claims>

<relations>
${input.relationsJson}
</relations>

<arguments>
${input.argumentsJson}
</arguments>`;
}

// Zod schemas for validation output
export const ValidationClaimIssueSchema = z.object({
	position_in_source: z.number().int().positive(),
	faithfulness_score: z.number().min(0).max(100).describe('0-100 score'),
	faithfulness_issue: z.string().optional().describe('Description if not 100'),
	atomicity_issue: z.string().optional().describe('If not atomic'),
	classification_issue: z.string().optional().describe('If classification wrong'),
	domain_issue: z.string().optional().describe('If domain wrong'),
	quarantine: z.boolean().optional().describe('Should this claim be quarantined?')
});

export const ValidationRelationIssueSchema = z.object({
	from_position: z.number().int().positive(),
	to_position: z.number().int().positive(),
	validity_score: z.number().min(0).max(100),
	validity_issue: z.string().optional().describe('Description if not 100'),
	type_issue: z.string().optional().describe('If relation type wrong'),
	quarantine: z.boolean().optional().describe('Should this relation be quarantined?')
});

export const ValidationArgumentIssueSchema = z.object({
	argument_name: z.string(),
	coherence_score: z.number().min(0).max(100),
	coherence_issue: z.string().optional().describe('Description if not 100'),
	role_issues: z.string().optional().describe('If roles are incorrect'),
	quarantine: z.boolean().optional().describe('Should this argument be quarantined?')
});

export const ValidationOutputSchema = z.object({
	claims: z.array(ValidationClaimIssueSchema).optional(),
	relations: z.array(ValidationRelationIssueSchema).optional(),
	arguments: z.array(ValidationArgumentIssueSchema).optional(),
	quarantine_items: z.array(z.string()).optional().describe('List of items to quarantine'),
	summary: z.string().describe('Summary of validation findings and overall quality assessment')
});

export type ValidationClaimIssue = z.infer<typeof ValidationClaimIssueSchema>;
export type ValidationRelationIssue = z.infer<typeof ValidationRelationIssueSchema>;
export type ValidationArgumentIssue = z.infer<typeof ValidationArgumentIssueSchema>;
export type ValidationOutput = z.infer<typeof ValidationOutputSchema>;
