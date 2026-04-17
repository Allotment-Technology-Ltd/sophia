/**
 * Stage 5 (Cross-Model Validation) — helper functions.
 *
 * Extracted from scripts/ingest.ts for testability and reuse.
 */

import type { Argument, GroupingOutput } from '../../prompts/grouping.js';
import {
	normalizeValidationOutput,
	VALIDATION_SYSTEM,
	VALIDATION_USER,
	type ValidationOutput
} from '../../prompts/validation.js';
import type { PhaseOneClaim, PhaseOneRelation, ValidationBatch, ValidationBatchExecContext } from './types.js';
import { estimateTokens, callStageModel, fixJsonWithModel, parseJsonResponse } from './model-call.js';
import { splitClaimsIntoGroupingBatches } from './grouping-helpers.js';

export function buildValidationSourceSnippet(
	claims: PhaseOneClaim[],
	sourceText: string,
	maxChars: number,
	contextChars: number
): string {
	if (!sourceText || sourceText.length === 0) return '';
	if (claims.length === 0) {
		return sourceText.slice(0, maxChars);
	}

	const starts = claims
		.map((claim) => claim.source_span_start)
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
	const ends = claims
		.map((claim) => claim.source_span_end)
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
	if (starts.length === 0 || ends.length === 0) {
		return sourceText.slice(0, maxChars);
	}

	const start = Math.max(0, Math.min(...starts) - contextChars);
	const end = Math.min(sourceText.length, Math.max(...ends) + contextChars);
	const snippet = sourceText.slice(start, end);
	if (snippet.length <= maxChars) return snippet;
	return snippet.slice(0, maxChars);
}

export function buildValidationBatch(
	batchClaims: PhaseOneClaim[],
	relations: PhaseOneRelation[],
	arguments_: GroupingOutput,
	sourceText: string,
	sourceTitle: string,
	maxChars: number,
	contextChars: number,
	tokenEstimateMultiplier: number
): ValidationBatch {
	const claimPositions = new Set(batchClaims.map((claim) => claim.position_in_source));
	const batchRelations = relations.filter(
		(relation) =>
			claimPositions.has(relation.from_position) &&
			claimPositions.has(relation.to_position)
	);
	const batchArguments = arguments_
		.map((argument) => {
			const claims = argument.claims.filter((claimRef) =>
				claimPositions.has(claimRef.position_in_source)
			);
			if (claims.length === 0) return null;
			return { ...argument, claims };
		})
		.filter((argument): argument is Argument => Boolean(argument));
	const batchSourceText = buildValidationSourceSnippet(
		batchClaims,
		sourceText,
		maxChars,
		contextChars
	);

	const claimsJson = JSON.stringify(batchClaims, null, 2);
	const relationsJson = JSON.stringify(batchRelations, null, 2);
	const argumentsJson = JSON.stringify(batchArguments, null, 2);
	const promptText =
		VALIDATION_SYSTEM +
		'\n\n' +
		VALIDATION_USER({
			sourceTitle,
			sourceText: batchSourceText,
			claimsJson,
			relationsJson,
			argumentsJson
		});
	const estimatedPromptTokens = Math.ceil(
		estimateTokens(promptText) * tokenEstimateMultiplier
	);

	return {
		claims: batchClaims,
		relations: batchRelations,
		arguments: batchArguments,
		sourceText: batchSourceText,
		estimatedPromptTokens
	};
}

export function buildValidationBatches(
	claims: PhaseOneClaim[],
	relations: PhaseOneRelation[],
	arguments_: GroupingOutput,
	sourceText: string,
	sourceTitle: string,
	targetTokens: number,
	tokenEstimateMultiplier: number,
	maxChars: number,
	contextChars: number
): ValidationBatch[] {
	const seedBatches = splitClaimsIntoGroupingBatches(claims, targetTokens, tokenEstimateMultiplier);
	const queue = [...seedBatches];
	const result: ValidationBatch[] = [];

	while (queue.length > 0) {
		const nextClaims = queue.shift()!;
		const batch = buildValidationBatch(
			nextClaims,
			relations,
			arguments_,
			sourceText,
			sourceTitle,
			maxChars,
			contextChars,
			tokenEstimateMultiplier
		);
		if (batch.estimatedPromptTokens > targetTokens && nextClaims.length > 1) {
			const midpoint = Math.ceil(nextClaims.length / 2);
			const firstHalf = nextClaims.slice(0, midpoint);
			const secondHalf = nextClaims.slice(midpoint);
			if (secondHalf.length > 0) {
				queue.unshift(secondHalf);
			}
			if (firstHalf.length > 0) {
				queue.unshift(firstHalf);
			}
			continue;
		}
		result.push(batch);
	}

	return result.length > 0
		? result
		: [
				buildValidationBatch(
					claims,
					relations,
					arguments_,
					sourceText,
					sourceTitle,
					maxChars,
					contextChars,
					tokenEstimateMultiplier
				)
			];
}

function mergeValidationIssueText(existing?: string, incoming?: string): string | undefined {
	const parts = new Set<string>();
	for (const value of [existing, incoming]) {
		if (!value) continue;
		for (const token of value.split('|').map((t) => t.trim())) {
			if (token) parts.add(token);
		}
	}
	if (parts.size === 0) return undefined;
	return [...parts].join(' | ');
}

export function mergeValidationOutputs(outputs: ValidationOutput[]): ValidationOutput {
	const claimMap = new Map<number, NonNullable<ValidationOutput['claims']>[number]>();
	const relationMap = new Map<string, NonNullable<ValidationOutput['relations']>[number]>();
	const argumentMap = new Map<string, NonNullable<ValidationOutput['arguments']>[number]>();
	const quarantineItems = new Set<string>();
	const summaries: string[] = [];

	for (const [index, output] of outputs.entries()) {
		if (output.summary?.trim()) {
			summaries.push(`Batch ${index + 1}: ${output.summary.trim()}`);
		}
		for (const item of output.quarantine_items ?? []) {
			if (item) quarantineItems.add(item);
		}

		for (const claim of output.claims ?? []) {
			const existing = claimMap.get(claim.position_in_source);
			if (!existing) {
				claimMap.set(claim.position_in_source, { ...claim });
			} else {
				existing.faithfulness_score = Math.min(
					existing.faithfulness_score,
					claim.faithfulness_score
				);
				existing.quarantine = Boolean(existing.quarantine || claim.quarantine);
				existing.faithfulness_issue = mergeValidationIssueText(
					existing.faithfulness_issue,
					claim.faithfulness_issue
				);
				existing.atomicity_issue = mergeValidationIssueText(
					existing.atomicity_issue,
					claim.atomicity_issue
				);
				existing.classification_issue = mergeValidationIssueText(
					existing.classification_issue,
					claim.classification_issue
				);
				existing.domain_issue = mergeValidationIssueText(
					existing.domain_issue,
					claim.domain_issue
				);
			}
			if (claim.quarantine) quarantineItems.add(`claim:${claim.position_in_source}`);
		}

		for (const relation of output.relations ?? []) {
			const key = `${relation.from_position}->${relation.to_position}`;
			const existing = relationMap.get(key);
			if (!existing) {
				relationMap.set(key, { ...relation });
			} else {
				existing.validity_score = Math.min(
					existing.validity_score,
					relation.validity_score
				);
				existing.quarantine = Boolean(existing.quarantine || relation.quarantine);
				existing.validity_issue = mergeValidationIssueText(
					existing.validity_issue,
					relation.validity_issue
				);
				existing.type_issue = mergeValidationIssueText(
					existing.type_issue,
					relation.type_issue
				);
			}
			if (relation.quarantine) quarantineItems.add(`relation:${key}`);
		}

		for (const argumentIssue of output.arguments ?? []) {
			const key = argumentIssue.argument_name.trim().toLowerCase();
			const existing = argumentMap.get(key);
			if (!existing) {
				argumentMap.set(key, { ...argumentIssue });
			} else {
				existing.coherence_score = Math.min(
					existing.coherence_score,
					argumentIssue.coherence_score
				);
				existing.quarantine = Boolean(existing.quarantine || argumentIssue.quarantine);
				existing.coherence_issue = mergeValidationIssueText(
					existing.coherence_issue,
					argumentIssue.coherence_issue
				);
				existing.role_issues = mergeValidationIssueText(
					existing.role_issues,
					argumentIssue.role_issues
				);
			}
			if (argumentIssue.quarantine)
				quarantineItems.add(`argument:${argumentIssue.argument_name}`);
		}
	}

	const merged: ValidationOutput = {
		claims: [...claimMap.values()].sort(
			(a, b) => a.position_in_source - b.position_in_source
		),
		relations: [...relationMap.values()].sort((a, b) =>
			a.from_position === b.from_position
				? a.to_position - b.to_position
				: a.from_position - b.from_position
		),
		arguments: [...argumentMap.values()].sort((a, b) =>
			a.argument_name.localeCompare(b.argument_name)
		),
		quarantine_items: [...quarantineItems].sort(),
		summary:
			summaries.join(' ').trim() || 'Validation completed across batched prompts.'
	};

	return normalizeValidationOutput(merged);
}

export type RemediationRevalidationClaimRow = {
	position_in_source: number;
	faithfulness_pass1: number;
	faithfulness_pass2: number;
	min_faithfulness: number;
	quarantine_pass1: boolean;
	quarantine_pass2: boolean;
	/** Pass-2 score is strictly lower than pass-1 (merge takes min). */
	second_pass_lowered_min: boolean;
	/** Merged quarantine is true while pass-1 alone was false (`!q1 && q2`). */
	quarantine_tightened_by_second: boolean;
};

export type RemediationRevalidationRelationRow = {
	key: string;
	from_position: number;
	to_position: number;
	validity_pass1: number;
	validity_pass2: number;
	min_validity: number;
	quarantine_pass1: boolean;
	quarantine_pass2: boolean;
	second_pass_lowered_min: boolean;
	quarantine_tightened_by_second: boolean;
};

export type RemediationRevalidationArgumentRow = {
	key: string;
	argument_name: string;
	coherence_pass1: number;
	coherence_pass2: number;
	min_coherence: number;
	quarantine_pass1: boolean;
	quarantine_pass2: boolean;
	second_pass_lowered_min: boolean;
	quarantine_tightened_by_second: boolean;
};

export type RemediationRevalidationDiff = {
	version: 1;
	claims: {
		compared: number;
		missing_in_second_pass: number;
		second_lowered_min: number;
		second_raised_min: number;
		second_same_score: number;
		quarantine_tightened_by_second: number;
		mean_faithfulness_pass1: number | null;
		mean_faithfulness_pass2: number | null;
		mean_min_faithfulness: number | null;
	};
	relations: {
		compared: number;
		missing_in_second_pass: number;
		second_lowered_min: number;
		second_raised_min: number;
		second_same_score: number;
		quarantine_tightened_by_second: number;
		mean_validity_pass1: number | null;
		mean_validity_pass2: number | null;
		mean_min_validity: number | null;
	};
	arguments: {
		compared: number;
		missing_in_second_pass: number;
		second_lowered_min: number;
		second_raised_min: number;
		second_same_score: number;
		quarantine_tightened_by_second: number;
		mean_coherence_pass1: number | null;
		mean_coherence_pass2: number | null;
		mean_min_coherence: number | null;
	};
	perClaim?: RemediationRevalidationClaimRow[];
	perRelation?: RemediationRevalidationRelationRow[];
	perArgument?: RemediationRevalidationArgumentRow[];
};

function mean(nums: number[]): number | null {
	if (nums.length === 0) return null;
	let sum = 0;
	for (const n of nums) sum += n;
	return sum / nums.length;
}

/**
 * Compare the **pre-remediation** validation snapshot vs the **post-repair revalidation**
 * output (second pass only), before `mergeValidationOutputs` combines them with the first pass.
 * Scores are not on identical claim text: pass 1 reflects pre-repair extractions; pass 2 reflects
 * post-remediation text (and possibly fewer relations after edge drops).
 * Merge semantics elsewhere: min(scores), quarantine OR — second pass only changes merged
 * results when it is stricter (lower score or adds quarantine).
 */
export function summarizeRemediationRevalidationDiff(
	firstPass: ValidationOutput,
	secondPass: ValidationOutput,
	options?: { includePerEntityRows?: boolean }
): RemediationRevalidationDiff {
	const includeRows = options?.includePerEntityRows === true;

	const claims1 = firstPass.claims ?? [];
	const claimMap2 = new Map<number, NonNullable<ValidationOutput['claims']>[number]>();
	for (const c of secondPass.claims ?? []) {
		claimMap2.set(c.position_in_source, c);
	}

	let missingClaims = 0;
	const claimRows: RemediationRevalidationClaimRow[] = [];
	let cLower = 0;
	let cRaise = 0;
	let cSame = 0;
	let cQtight = 0;
	const mins: number[] = [];
	const s1s: number[] = [];
	const s2s: number[] = [];

	for (const c1 of claims1) {
		const pos = c1.position_in_source;
		const c2 = claimMap2.get(pos);
		if (!c2) {
			missingClaims++;
			continue;
		}
		const s1 = c1.faithfulness_score;
		const s2 = c2.faithfulness_score;
		const q1 = Boolean(c1.quarantine);
		const q2 = Boolean(c2.quarantine);
		const minScore = Math.min(s1, s2);
		const lowered = s2 < s1;
		const raised = s2 > s1;
		const same = s2 === s1;
		if (lowered) cLower++;
		else if (raised) cRaise++;
		else if (same) cSame++;

		const qtight = !q1 && q2;
		if (qtight) cQtight++;

		mins.push(minScore);
		s1s.push(s1);
		s2s.push(s2);

		const row: RemediationRevalidationClaimRow = {
			position_in_source: pos,
			faithfulness_pass1: s1,
			faithfulness_pass2: s2,
			min_faithfulness: minScore,
			quarantine_pass1: q1,
			quarantine_pass2: q2,
			second_pass_lowered_min: lowered,
			quarantine_tightened_by_second: qtight
		};
		claimRows.push(row);
	}

	const rel1 = firstPass.relations ?? [];
	const relMap2 = new Map<string, NonNullable<ValidationOutput['relations']>[number]>();
	for (const r of secondPass.relations ?? []) {
		relMap2.set(`${r.from_position}->${r.to_position}`, r);
	}

	let missingRel = 0;
	const relRows: RemediationRevalidationRelationRow[] = [];
	let rLower = 0;
	let rRaise = 0;
	let rSame = 0;
	let rQtight = 0;
	const rMins: number[] = [];
	const r1s: number[] = [];
	const r2s: number[] = [];

	for (const a of rel1) {
		const key = `${a.from_position}->${a.to_position}`;
		const b = relMap2.get(key);
		if (!b) {
			missingRel++;
			continue;
		}
		const s1 = a.validity_score;
		const s2 = b.validity_score;
		const q1 = Boolean(a.quarantine);
		const q2 = Boolean(b.quarantine);
		const minScore = Math.min(s1, s2);
		if (s2 < s1) rLower++;
		else if (s2 > s1) rRaise++;
		else if (s2 === s1) rSame++;

		const qtight = !q1 && q2;
		if (qtight) rQtight++;

		rMins.push(minScore);
		r1s.push(s1);
		r2s.push(s2);

		relRows.push({
			key,
			from_position: a.from_position,
			to_position: a.to_position,
			validity_pass1: s1,
			validity_pass2: s2,
			min_validity: minScore,
			quarantine_pass1: q1,
			quarantine_pass2: q2,
			second_pass_lowered_min: s2 < s1,
			quarantine_tightened_by_second: qtight
		});
	}

	const arg1 = firstPass.arguments ?? [];
	const argMap2 = new Map<string, NonNullable<ValidationOutput['arguments']>[number]>();
	for (const a of secondPass.arguments ?? []) {
		argMap2.set(a.argument_name.trim().toLowerCase(), a);
	}

	let missingArg = 0;
	const argRows: RemediationRevalidationArgumentRow[] = [];
	let gLower = 0;
	let gRaise = 0;
	let gSame = 0;
	let gQtight = 0;
	const gMins: number[] = [];
	const g1s: number[] = [];
	const g2s: number[] = [];

	for (const a of arg1) {
		const key = a.argument_name.trim().toLowerCase();
		const b = argMap2.get(key);
		if (!b) {
			missingArg++;
			continue;
		}
		const s1 = a.coherence_score;
		const s2 = b.coherence_score;
		const q1 = Boolean(a.quarantine);
		const q2 = Boolean(b.quarantine);
		const minScore = Math.min(s1, s2);
		if (s2 < s1) gLower++;
		else if (s2 > s1) gRaise++;
		else if (s2 === s1) gSame++;

		const qtight = !q1 && q2;
		if (qtight) gQtight++;

		gMins.push(minScore);
		g1s.push(s1);
		g2s.push(s2);

		argRows.push({
			key,
			argument_name: a.argument_name,
			coherence_pass1: s1,
			coherence_pass2: s2,
			min_coherence: minScore,
			quarantine_pass1: q1,
			quarantine_pass2: q2,
			second_pass_lowered_min: s2 < s1,
			quarantine_tightened_by_second: qtight
		});
	}

	const comparedClaims = claims1.length - missingClaims;

	const out: RemediationRevalidationDiff = {
		version: 1,
		claims: {
			compared: comparedClaims,
			missing_in_second_pass: missingClaims,
			second_lowered_min: cLower,
			second_raised_min: cRaise,
			second_same_score: cSame,
			quarantine_tightened_by_second: cQtight,
			mean_faithfulness_pass1: mean(s1s),
			mean_faithfulness_pass2: mean(s2s),
			mean_min_faithfulness: mean(mins)
		},
		relations: {
			compared: rel1.length - missingRel,
			missing_in_second_pass: missingRel,
			second_lowered_min: rLower,
			second_raised_min: rRaise,
			second_same_score: rSame,
			quarantine_tightened_by_second: rQtight,
			mean_validity_pass1: mean(r1s),
			mean_validity_pass2: mean(r2s),
			mean_min_validity: mean(rMins)
		},
		arguments: {
			compared: arg1.length - missingArg,
			missing_in_second_pass: missingArg,
			second_lowered_min: gLower,
			second_raised_min: gRaise,
			second_same_score: gSame,
			quarantine_tightened_by_second: gQtight,
			mean_coherence_pass1: mean(g1s),
			mean_coherence_pass2: mean(g2s),
			mean_min_coherence: mean(gMins)
		}
	};

	if (includeRows) {
		out.perClaim = claimRows;
		out.perRelation = relRows;
		out.perArgument = argRows;
	}

	return out;
}

const MAX_VALIDATION_CONTEXT_SPLIT_DEPTH = 8;

export async function runValidationBatchWithContextSplitting(
	batch: ValidationBatch,
	ctx: ValidationBatchExecContext,
	depth: number,
	batchLabel: string
): Promise<ValidationOutput | null> {
	if (depth > MAX_VALIDATION_CONTEXT_SPLIT_DEPTH) {
		console.warn(
			`  [WARN] ${batchLabel}: Exceeded max context-split depth (${MAX_VALIDATION_CONTEXT_SPLIT_DEPTH}); skipping batch.`
		);
		return null;
	}

	try {
		const rawText = await executeValidationBatchModelCall(batch, ctx);
		return parseValidationResponseWithRepair(rawText, ctx, batchLabel);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		const isContextError =
			msg.includes('context_length') ||
			msg.includes('prompt_too_long') ||
			msg.includes('exceeds the context window') ||
			msg.includes('too many tokens');

		if (!isContextError || batch.claims.length <= 1) {
			console.warn(`  [WARN] ${batchLabel}: Non-context error — skipping: ${msg}`);
			return null;
		}

		console.log(
			`  [SPLIT] ${batchLabel}: Context overflow — splitting ${batch.claims.length} claims at depth ${depth + 1}`
		);
		const midpoint = Math.ceil(batch.claims.length / 2);
		const b1 = buildValidationBatch(
			batch.claims.slice(0, midpoint),
			ctx.relations,
			ctx.arguments_,
			ctx.sourceText,
			ctx.sourceTitle,
			24_000,
			800,
			1.0
		);
		const b2 = buildValidationBatch(
			batch.claims.slice(midpoint),
			ctx.relations,
			ctx.arguments_,
			ctx.sourceText,
			ctx.sourceTitle,
			24_000,
			800,
			1.0
		);
		const left = await runValidationBatchWithContextSplitting(
			b1,
			ctx,
			depth + 1,
			`${batchLabel} (left)`
		);
		const right = await runValidationBatchWithContextSplitting(
			b2,
			ctx,
			depth + 1,
			`${batchLabel} (right)`
		);
		if (!left && !right) return null;
		if (!left) return right;
		if (!right) return left;
		return mergeValidationOutputs([left, right]);
	}
}

async function executeValidationBatchModelCall(
	batch: ValidationBatch,
	ctx: ValidationBatchExecContext
): Promise<string> {
	const claimsJson = JSON.stringify(batch.claims, null, 2);
	const relationsJson = JSON.stringify(batch.relations, null, 2);
	const argumentsJson = JSON.stringify(batch.arguments, null, 2);
	const validationPrompt =
		VALIDATION_SYSTEM +
		'\n\n' +
		VALIDATION_USER({
			sourceTitle: ctx.sourceTitle,
			sourceText: batch.sourceText,
			claimsJson,
			relationsJson,
			argumentsJson
		});
	return callStageModel({
		stage: 'validation',
		plan: ctx.validationPlan,
		budget: ctx.validationBudget,
		tracker: ctx.validationTracker,
		costs: { totalInputTokens: 0, totalOutputTokens: 0, vertexChars: 0, totalUsd: 0 },
		timing: null,
		systemPrompt: 'You are a strict validation assistant. Return JSON only.',
		userMessage: validationPrompt
	});
}

async function parseValidationResponseWithRepair(
	rawText: string,
	ctx: ValidationBatchExecContext,
	batchLabel: string
): Promise<ValidationOutput | null> {
	try {
		const parsed = parseJsonResponse(rawText);
		return normalizeValidationOutput(parsed as ValidationOutput);
	} catch (parseError) {
		console.warn(
			`  [WARN] ${batchLabel}: Validation JSON parse error — attempting repair`
		);
		try {
			const repaired = await fixJsonWithModel({
				repairPlan: ctx.jsonRepairPlan,
				repairBudget: ctx.jsonRepairBudget,
				repairTracker: ctx.repairTracker,
				costs: { totalInputTokens: 0, totalOutputTokens: 0, vertexChars: 0, totalUsd: 0 },
				timing: null,
				originalJson: rawText,
				parseError: parseError instanceof Error ? parseError.message : String(parseError),
				schema: '{ claims: [{position_in_source, faithfulness_score, ...}], relations: [...], arguments: [...], quarantine_items: [...], summary: "..." }'
			});
			const parsed = parseJsonResponse(repaired);
			return normalizeValidationOutput(parsed as ValidationOutput);
		} catch (repairError) {
			console.warn(
				`  [WARN] ${batchLabel}: Validation repair also failed — skipping batch`
			);
			return null;
		}
	}
}
