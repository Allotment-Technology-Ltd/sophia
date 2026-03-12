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

Respond ONLY with valid JSON. No preamble, no markdown backticks.

Output contract (strict):
{
  "claims": [{"position_in_source": 1, "faithfulness_score": 85, "faithfulness_issue": "optional", "atomicity_issue": "optional", "classification_issue": "optional", "domain_issue": "optional", "quarantine": false}],
  "relations": [{"from_position": 1, "to_position": 2, "validity_score": 78, "validity_issue": "optional", "type_issue": "optional", "quarantine": false}],
  "arguments": [{"argument_name": "name", "coherence_score": 81, "coherence_issue": "optional", "role_issues": "optional", "quarantine": false}],
  "quarantine_items": ["claim:17", "relation:12->18"],
  "summary": "Single plain-text paragraph summarizing validation quality."
}

Critical requirements:
- summary MUST be a plain string, never an object or array.
- scores MUST be numeric 0-100.
- positions MUST be positive integers.`;

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
function toOptionalString(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		const joined = value
			.map((entry) => toOptionalString(entry))
			.filter((entry): entry is string => Boolean(entry))
			.join(' | ');
		return joined.length > 0 ? joined : undefined;
	}
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		for (const key of ['summary', 'text', 'message', 'overall', 'assessment']) {
			const candidate = toOptionalString(record[key]);
			if (candidate) return candidate;
		}
		try {
			return JSON.stringify(value);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function toBoolean(value: unknown, fallback = false): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
		if (['false', 'no', 'n', '0'].includes(normalized)) return false;
	}
	if (typeof value === 'number') return value !== 0;
	return fallback;
}

function toBoundedScore(value: unknown, fallback = 0): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(0, Math.min(100, parsed));
}

function toPositiveInt(value: unknown): number | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	const normalized = Math.trunc(parsed);
	return normalized > 0 ? normalized : null;
}

function normalizeSummary(value: unknown): string {
	const text = toOptionalString(value);
	if (text) return text;
	return 'Validation completed; review required due to non-standard summary output.';
}

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

export function normalizeValidationOutput(raw: unknown): ValidationOutput {
	const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const claimsRaw = Array.isArray(root.claims) ? root.claims : [];
	const relationsRaw = Array.isArray(root.relations) ? root.relations : [];
	const argumentsRaw = Array.isArray(root.arguments) ? root.arguments : [];
	const quarantineRaw = Array.isArray(root.quarantine_items) ? root.quarantine_items : [];

	const claims: z.infer<typeof ValidationClaimIssueSchema>[] = [];
	for (const entry of claimsRaw) {
		if (!entry || typeof entry !== 'object') continue;
		const item = entry as Record<string, unknown>;
		const position =
			toPositiveInt(item.position_in_source) ??
			toPositiveInt(item.position) ??
			toPositiveInt(item.claim_position);
		if (!position) continue;

		const normalizedClaim: z.infer<typeof ValidationClaimIssueSchema> = {
			position_in_source: position,
			faithfulness_score: toBoundedScore(item.faithfulness_score, 0),
			quarantine: toBoolean(item.quarantine, false)
		};
		const faithfulnessIssue = toOptionalString(item.faithfulness_issue);
		const atomicityIssue = toOptionalString(item.atomicity_issue);
		const classificationIssue = toOptionalString(item.classification_issue);
		const domainIssue = toOptionalString(item.domain_issue);
		if (faithfulnessIssue !== undefined) normalizedClaim.faithfulness_issue = faithfulnessIssue;
		if (atomicityIssue !== undefined) normalizedClaim.atomicity_issue = atomicityIssue;
		if (classificationIssue !== undefined) normalizedClaim.classification_issue = classificationIssue;
		if (domainIssue !== undefined) normalizedClaim.domain_issue = domainIssue;
		claims.push(normalizedClaim);
	}

	const relations: z.infer<typeof ValidationRelationIssueSchema>[] = [];
	for (const entry of relationsRaw) {
		if (!entry || typeof entry !== 'object') continue;
		const item = entry as Record<string, unknown>;
		const fromPosition =
			toPositiveInt(item.from_position) ??
			toPositiveInt(item.from) ??
			toPositiveInt(item.from_claim_position);
		const toPosition =
			toPositiveInt(item.to_position) ??
			toPositiveInt(item.to) ??
			toPositiveInt(item.to_claim_position);
		if (!fromPosition || !toPosition) continue;

		const normalizedRelation: z.infer<typeof ValidationRelationIssueSchema> = {
			from_position: fromPosition,
			to_position: toPosition,
			validity_score: toBoundedScore(item.validity_score, 0),
			quarantine: toBoolean(item.quarantine, false)
		};
		const validityIssue = toOptionalString(item.validity_issue);
		const typeIssue = toOptionalString(item.type_issue);
		if (validityIssue !== undefined) normalizedRelation.validity_issue = validityIssue;
		if (typeIssue !== undefined) normalizedRelation.type_issue = typeIssue;
		relations.push(normalizedRelation);
	}

	const arguments_: z.infer<typeof ValidationArgumentIssueSchema>[] = [];
	for (const entry of argumentsRaw) {
		if (!entry || typeof entry !== 'object') continue;
		const item = entry as Record<string, unknown>;
		const argumentName =
			toOptionalString(item.argument_name) ??
			toOptionalString(item.name) ??
			toOptionalString(item.title);
		if (!argumentName) continue;

		const normalizedArgument: z.infer<typeof ValidationArgumentIssueSchema> = {
			argument_name: argumentName,
			coherence_score: toBoundedScore(item.coherence_score, 0),
			quarantine: toBoolean(item.quarantine, false)
		};
		const coherenceIssue = toOptionalString(item.coherence_issue);
		const roleIssues = toOptionalString(item.role_issues);
		if (coherenceIssue !== undefined) normalizedArgument.coherence_issue = coherenceIssue;
		if (roleIssues !== undefined) normalizedArgument.role_issues = roleIssues;
		arguments_.push(normalizedArgument);
	}

	const quarantineItems = quarantineRaw
		.map((entry) => toOptionalString(entry))
		.filter((entry): entry is string => Boolean(entry));

	const normalized: ValidationOutput = {
		summary: normalizeSummary(root.summary)
	};
	if (claims.length > 0) normalized.claims = claims;
	if (relations.length > 0) normalized.relations = relations;
	if (arguments_.length > 0) normalized.arguments = arguments_;
	if (quarantineItems.length > 0) normalized.quarantine_items = quarantineItems;

	return ValidationOutputSchema.parse(normalized);
}

export type ValidationClaimIssue = z.infer<typeof ValidationClaimIssueSchema>;
export type ValidationRelationIssue = z.infer<typeof ValidationRelationIssueSchema>;
export type ValidationArgumentIssue = z.infer<typeof ValidationArgumentIssueSchema>;
export type ValidationOutput = z.infer<typeof ValidationOutputSchema>;
