/**
 * Stage 5 (Cross-Model Validation) — helper functions.
 *
 * Extracted from scripts/ingest.ts for testability and reuse.
 */

import type { Argument, GroupingOutput } from '$lib/server/prompts/grouping.js';
import { normalizeValidationOutput, VALIDATION_SYSTEM, VALIDATION_USER, type ValidationOutput } from '$lib/server/prompts/validation.js';
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
		.filter((value): value is number => Number.isFinite(value) && value >= 0);
	const ends = claims
		.map((claim) => claim.source_span_end)
		.filter((value): value is number => Number.isFinite(value) && value > 0);
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
