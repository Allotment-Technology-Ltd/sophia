/**
 * Post-remediation one-shot relations + grouping re-run (no resume checkpoints).
 * Used by scripts/ingest.ts after claim text repairs + deterministic relation drops.
 */

import { isTpmOrRateLimitInError } from '../src/lib/ingestionErrorChain.js';
import { capIngestBatchTargetForPlan } from '../src/lib/server/ingestion/modelBatchCaps.js';
import {
	buildRelationsBatches,
	mergeRelationsDedup
} from '../src/lib/server/ingestion/stages/relations-helpers.js';
import { normalizePositivePosition } from '../src/lib/server/ingestion/stages/extraction-helpers.js';
import {
	analyzeGroupingReferenceHealth,
	buildGroupingBatches,
	mergeGroupingOutputs,
	normalizeGroupingPayload
} from '../src/lib/server/ingestion/stages/grouping-helpers.js';
import type { IngestionPlanningContext, IngestionStagePlan } from '../src/lib/server/aaif/ingestion-plan.js';
import {
	GROUPING_SYSTEM,
	GROUPING_USER,
	GroupingOutputSchema,
	type GroupingOutput
} from '../src/lib/server/prompts/grouping.js';
import {
	RELATIONS_SYSTEM,
	RELATIONS_USER,
	RelationsOutputSchema,
	type RelationsOutput
} from '../src/lib/server/prompts/relations.js';
import type { PhaseOneClaim, PhaseOneRelation } from '../src/lib/server/ingestion/stages/types.js';

type GroupingBatch = { claims: PhaseOneClaim[]; relations: PhaseOneRelation[] };

type StageBudget = {
	maxInputTokens?: number;
	maxOutputTokens?: number;
	maxUsd?: number;
	maxRetries: number;
	timeoutMs: number;
};

type StageUsageTracker = {
	stage: string;
	startInputTokens: number;
	startOutputTokens: number;
	startUsd: number;
	retries: number;
};

function estimateTokens(text: string): number {
	return Math.ceil(text.split(/\s+/).length * 1.3);
}

function parseJsonResponse(text: string): unknown {
	let cleaned = text.trim();
	if (cleaned.startsWith('```json')) {
		cleaned = cleaned.slice(7);
	} else if (cleaned.startsWith('```')) {
		cleaned = cleaned.slice(3);
	}
	if (cleaned.endsWith('```')) {
		cleaned = cleaned.slice(0, -3);
	}
	return JSON.parse(cleaned.trim());
}

function estimateRelationsClaimsJsonTokens(claims: PhaseOneClaim[]): number {
	return estimateTokens(JSON.stringify(claims, null, 2));
}

function splitGroupingBatchInHalf(batch: GroupingBatch): [GroupingBatch, GroupingBatch] | null {
	if (batch.claims.length <= 1) return null;
	const mid = Math.ceil(batch.claims.length / 2);
	const firstClaims = batch.claims.slice(0, mid);
	const secondClaims = batch.claims.slice(mid);
	const rels = batch.relations;
	const sub = (batchClaims: PhaseOneClaim[]): GroupingBatch => {
		const claimPositions = new Set(batchClaims.map((c) => c.position_in_source));
		const batchRelations = rels.filter(
			(r) => claimPositions.has(r.from_position) && claimPositions.has(r.to_position)
		);
		return { claims: batchClaims, relations: batchRelations };
	};
	return [sub(firstClaims), sub(secondClaims)];
}

export async function rerunRelationsAndGroupingForRemediation(opts: {
	allClaims: PhaseOneClaim[];
	relationPlan: IngestionStagePlan;
	groupingPlan: IngestionStagePlan;
	relationBudget: StageBudget;
	groupingBudget: StageBudget;
	jsonRepairPlan: IngestionStagePlan;
	jsonRepairBudget: StageBudget;
	repairTracker: StageUsageTracker;
	relationsTracker: StageUsageTracker;
	groupingTracker: StageUsageTracker;
	basePlanningContext: IngestionPlanningContext;
	relationsBatchTarget: number;
	relationsOverlap: number;
	groupingBatchTarget: number;
	attachRelationMetadata: (relations: RelationsOutput, claims: PhaseOneClaim[]) => PhaseOneRelation[];
	callStageModel: (args: {
		stage: 'relations' | 'grouping' | 'remediation' | 'json_repair';
		plan: IngestionStagePlan;
		budget: StageBudget;
		tracker: StageUsageTracker;
		systemPrompt: string;
		userMessage: string;
		maxTokens?: number;
		planningContext: IngestionPlanningContext;
	}) => Promise<string>;
	fixJsonWithModel: (
		repairPlan: IngestionStagePlan,
		repairBudget: StageBudget,
		repairTracker: StageUsageTracker,
		originalJson: string,
		parseError: string,
		schema: string,
		planningContext: IngestionPlanningContext
	) => Promise<string>;
	logStageCost: (label: string, tracker: StageUsageTracker, plan: IngestionStagePlan) => void;
	ingestFailOnGroupingPositionCollapse: boolean;
	saveGroupingDebugRaw: (slug: string, batchIndex: number, raw: string) => void;
	slug: string;
}): Promise<{ relations: PhaseOneRelation[]; arguments_: GroupingOutput }> {
	const {
		allClaims,
		relationPlan,
		groupingPlan,
		relationBudget,
		groupingBudget,
		jsonRepairPlan,
		jsonRepairBudget,
		repairTracker,
		relationsTracker,
		groupingTracker,
		basePlanningContext,
		relationsBatchTarget,
		relationsOverlap,
		groupingBatchTarget,
		attachRelationMetadata,
		callStageModel,
		fixJsonWithModel,
		logStageCost,
		ingestFailOnGroupingPositionCollapse,
		saveGroupingDebugRaw,
		slug
	} = opts;

	const relationsCap = capIngestBatchTargetForPlan({
		stage: 'relations',
		requested: relationsBatchTarget,
		provider: relationPlan.provider,
		model: relationPlan.model
	});
	let relTarget = relationsCap.value;
	if (relationsCap.capped) {
		console.log(
			`  [INFO] [REMEDIATION RERUN] Relations batch target capped: ${relationsCap.requested.toLocaleString()} → ${relationsCap.value.toLocaleString()}`
		);
	}
	if (relTarget <= 0) relTarget = 12_000;

	const relationsBatches = buildRelationsBatches(allClaims, relTarget, relationsOverlap);
	let workQueue: PhaseOneClaim[][] = relationsBatches.map((b) => [...b]);
	let relations: PhaseOneRelation[] = [];
	const relationsPlanningContext: IngestionPlanningContext = {
		...basePlanningContext,
		claimCount: allClaims.length
	};

	console.log(
		`  [REMEDIATION RERUN] Relations: ${workQueue.length} batch(es), overlap ${relationsOverlap} claim(s)`
	);

	for (let batchIndex = 0; batchIndex < workQueue.length; batchIndex++) {
		while (true) {
			const batchClaims = workQueue[batchIndex]!;
			const claimsJson = JSON.stringify(batchClaims, null, 2);
			const relUserMsg = RELATIONS_USER(claimsJson);
			const tokEst = estimateRelationsClaimsJsonTokens(batchClaims);
			console.log(
				`  [REMEDIATION RERUN] [BATCH ${batchIndex + 1}/${workQueue.length}] ${batchClaims.length} claims (~${tokEst.toLocaleString()} tokens)`
			);
			let relRawResponse: string;
			try {
				relRawResponse = await callStageModel({
					stage: 'relations',
					plan: relationPlan,
					budget: relationBudget,
					tracker: relationsTracker,
					systemPrompt: RELATIONS_SYSTEM,
					userMessage: relUserMsg,
					planningContext: relationsPlanningContext
				});
			} catch (relErr) {
				if (batchClaims.length > 1 && isTpmOrRateLimitInError(relErr)) {
					const mid = Math.ceil(batchClaims.length / 2);
					workQueue.splice(batchIndex, 1, batchClaims.slice(0, mid), batchClaims.slice(mid));
					console.warn(
						`  [REMEDIATION RERUN] [SPLIT] Relations TPM/rate limit — queue now ${workQueue.length} batch(es)`
					);
					continue;
				}
				throw relErr;
			}

			logStageCost('Relations (remediation rerun)', relationsTracker, relationPlan);

			let batchRelations: PhaseOneRelation[] = [];
			try {
				const parsed = parseJsonResponse(relRawResponse);
				batchRelations = attachRelationMetadata(RelationsOutputSchema.parse(parsed), allClaims);
			} catch (parseError) {
				const fixedResponse = await fixJsonWithModel(
					jsonRepairPlan,
					jsonRepairBudget,
					repairTracker,
					relRawResponse,
					parseError instanceof Error ? parseError.message : String(parseError),
					'Array of { from_position, to_position, relation_type, strength, note? }',
					relationsPlanningContext
				);
				const fixedParsed = parseJsonResponse(fixedResponse);
				batchRelations = attachRelationMetadata(RelationsOutputSchema.parse(fixedParsed), allClaims);
			}

			relations = mergeRelationsDedup(relations, batchRelations);
			break;
		}
	}

	const groupingCap = capIngestBatchTargetForPlan({
		stage: 'grouping',
		requested: groupingBatchTarget,
		provider: groupingPlan.provider,
		model: groupingPlan.model
	});
	const grpTarget = groupingCap.value;
	if (groupingCap.capped) {
		console.log(
			`  [INFO] [REMEDIATION RERUN] Grouping batch target capped: ${groupingCap.requested.toLocaleString()} → ${groupingCap.value.toLocaleString()}`
		);
	}

	let groupingBatches = buildGroupingBatches(allClaims, relations, grpTarget);
	console.log(`  [REMEDIATION RERUN] Grouping: ${groupingBatches.length} batch(es)`);

	const groupingPlanningContext: IngestionPlanningContext = {
		...basePlanningContext,
		claimCount: allClaims.length,
		relationCount: relations.length
	};

	const groupedOutputs: GroupingOutput[] = [];
	let batchIndex = 0;
	while (batchIndex < groupingBatches.length) {
		const batch = groupingBatches[batchIndex]!;
		const claimsJson = JSON.stringify(batch.claims, null, 2);
		const relationsJson = JSON.stringify(batch.relations, null, 2);
		const grpUserMsg = GROUPING_USER(claimsJson, relationsJson);
		const grpRawResponse = await callStageModel({
			stage: 'grouping',
			plan: groupingPlan,
			budget: groupingBudget,
			tracker: groupingTracker,
			systemPrompt: GROUPING_SYSTEM,
			userMessage: grpUserMsg,
			planningContext: groupingPlanningContext
		});
		saveGroupingDebugRaw(slug, batchIndex, grpRawResponse);
		logStageCost('Grouping (remediation rerun)', groupingTracker, groupingPlan);

		let batchArguments: GroupingOutput;
		try {
			const parsed = parseJsonResponse(grpRawResponse);
			batchArguments = GroupingOutputSchema.parse(
				normalizeGroupingPayload(parsed, normalizePositivePosition)
			);
		} catch (parseError) {
			const fixedResponse = await fixJsonWithModel(
				jsonRepairPlan,
				jsonRepairBudget,
				repairTracker,
				grpRawResponse,
				parseError instanceof Error ? parseError.message : String(parseError),
				'Array of { name, tradition?, domain, summary, claims: [{ position_in_source, role }] }',
				groupingPlanningContext
			);
			const fixedParsed = parseJsonResponse(fixedResponse);
			batchArguments = GroupingOutputSchema.parse(
				normalizeGroupingPayload(fixedParsed, normalizePositivePosition)
			);
		}

		const batchHealth = analyzeGroupingReferenceHealth(batchArguments);
		if (batchHealth.collapsed) {
			const halves = splitGroupingBatchInHalf(batch);
			if (halves) {
				console.warn(`  [REMEDIATION RERUN] [SPLIT] Grouping batch collapsed refs — splitting`);
				groupingBatches.splice(batchIndex, 1, halves[0], halves[1]);
				continue;
			}
		}

		groupedOutputs.push(batchArguments);
		batchIndex += 1;
	}

	const arguments_ = mergeGroupingOutputs(groupedOutputs);
	const groupingHealth = analyzeGroupingReferenceHealth(arguments_);
	if (groupingHealth.collapsed && ingestFailOnGroupingPositionCollapse) {
		throw new Error(
			`[REMEDIATION RERUN] Grouping claim references collapsed (unique positions: ${groupingHealth.uniquePositions}).`
		);
	}

	return { relations, arguments_ };
}
