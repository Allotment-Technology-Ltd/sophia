/**
 * Shared model-call infrastructure for ingestion pipeline stages.
 *
 * Provides callStageModel, fixJsonWithModel, and helpers used across all LLM stages.
 */

import { generateText } from 'ai';
import { estimateCost as estimateRestormelCost, defaultProviders } from '@restormel/keys';
import type { IngestionStagePlan } from '$lib/server/aaif/ingestion-plan.js';
import type {
	StageKey,
	StageBudget,
	StageUsageTracker,
	CostTracker,
	IngestTimingPayload
} from './types.js';

const OPENAI_COMPAT_CHAT_PROVIDERS_FOLD_SYSTEM = new Set([
	'mistral',
	'groq',
	'deepseek',
	'together',
	'cohere',
	'openrouter',
	'perplexity'
]);

function shouldFoldSystemPromptIntoUserForProvider(provider: string | undefined): boolean {
	if (!provider) return false;
	return OPENAI_COMPAT_CHAT_PROVIDERS_FOLD_SYSTEM.has(provider.toLowerCase());
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timeoutId: NodeJS.Timeout | null = null;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timeoutId) clearTimeout(timeoutId);
	});
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.split(/\s+/).length * 1.3);
}

export function parseJsonResponse(text: string): unknown {
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

export function estimateUsageCostUsd(
	modelId: string,
	inputTokens: number,
	outputTokens: number
): number {
	const estimate = estimateRestormelCost(modelId, defaultProviders);
	if (!estimate) return 0;
	return (
		((estimate.inputPerMillion ?? 0) * inputTokens +
			(estimate.outputPerMillion ?? 0) * outputTokens) /
		1_000_000
	);
}

export function trackReasoningCost(
	costs: CostTracker,
	modelId: string,
	inputTokens: number,
	outputTokens: number
): number {
	const usageCostUsd = estimateUsageCostUsd(modelId, inputTokens, outputTokens);
	costs.totalInputTokens += inputTokens;
	costs.totalOutputTokens += outputTokens;
	costs.totalUsd += usageCostUsd;
	return usageCostUsd;
}

export function trackEmbeddingCost(costs: CostTracker, totalChars: number): number {
	const usageCostUsd = (totalChars / 1_000_000) * 0.025;
	costs.vertexChars += totalChars;
	costs.totalUsd += usageCostUsd;
	return usageCostUsd;
}

export function formatModelCallErrorDetails(error: unknown): string {
	if (error instanceof Error) {
		const msg = error.message;
		if (msg.length > 400) return msg.slice(0, 397) + '...';
		return msg;
	}
	return String(error);
}

export function isModelUnavailableError(error: Error): boolean {
	const msg = error.message;
	return (
		/model.*(?:not found|does not exist|unavailable)/i.test(msg) ||
		/(?:retired|deprecated).*model/i.test(msg) ||
		/(?:invalid|unknown).*model/i.test(msg) ||
		msg.includes('404') ||
		msg.includes('model_not_found')
	);
}

export function startStageUsage(
	stage: StageKey,
	costs: CostTracker
): StageUsageTracker {
	return {
		stage,
		startInputTokens: costs.totalInputTokens,
		startOutputTokens: costs.totalOutputTokens,
		startUsd: costs.totalUsd,
		retries: 0
	};
}

export function assertStageBudget(
	stageBudget: StageBudget,
	tracker: StageUsageTracker,
	costs: CostTracker
): void {
	const inputDelta = costs.totalInputTokens - tracker.startInputTokens;
	const outputDelta = costs.totalOutputTokens - tracker.startOutputTokens;
	const usdDelta = costs.totalUsd - tracker.startUsd;

	if (stageBudget.maxInputTokens !== undefined && inputDelta > stageBudget.maxInputTokens) {
		throw new Error(
			`[BUDGET] ${tracker.stage} exceeded input token cap (${inputDelta} > ${stageBudget.maxInputTokens})`
		);
	}
	if (stageBudget.maxOutputTokens !== undefined && outputDelta > stageBudget.maxOutputTokens) {
		throw new Error(
			`[BUDGET] ${tracker.stage} exceeded output token cap (${outputDelta} > ${stageBudget.maxOutputTokens})`
		);
	}
	if (stageBudget.maxUsd !== undefined && usdDelta > stageBudget.maxUsd) {
		throw new Error(
			`[BUDGET] ${tracker.stage} exceeded USD cap (${usdDelta.toFixed(4)} > ${stageBudget.maxUsd})`
		);
	}
}

export function logStageCost(
	label: string,
	tracker: StageUsageTracker,
	plan: IngestionStagePlan,
	costs: CostTracker
): void {
	const inputDelta = costs.totalInputTokens - tracker.startInputTokens;
	const outputDelta = costs.totalOutputTokens - tracker.startOutputTokens;
	const usdDelta = costs.totalUsd - tracker.startUsd;
	if (plan.stage === 'embedding') {
		console.log(
			`  [COST] ${label}: ${plan.provider}/${plan.model} chars=${costs.vertexChars.toLocaleString()} stage=$${usdDelta.toFixed(4)} total=$${costs.totalUsd.toFixed(4)}`
		);
		return;
	}
	console.log(
		`  [COST] ${label}: ${plan.provider}/${plan.model} input=${inputDelta.toLocaleString()} output=${outputDelta.toLocaleString()} stage=$${usdDelta.toFixed(4)} total=$${costs.totalUsd.toFixed(4)}`
	);
}

export async function callStageModel(params: {
	stage: StageKey;
	plan: IngestionStagePlan;
	budget: StageBudget;
	tracker: StageUsageTracker;
	costs: CostTracker;
	timing: IngestTimingPayload | null;
	systemPrompt: string;
	userMessage: string;
	maxTokens?: number;
}): Promise<string> {
	const {
		stage,
		plan,
		budget,
		tracker,
		costs,
		timing,
		systemPrompt,
		userMessage,
		maxTokens = 32768
	} = params;
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= budget.maxRetries; attempt++) {
		try {
			if (attempt > 0) {
				if (tracker.retries >= budget.maxRetries) {
					throw new Error(`[BUDGET] ${stage} exceeded retry cap (${budget.maxRetries})`);
				}
				tracker.retries += 1;
				const delayMs = 1000 * Math.pow(2, attempt - 1);
				if (timing) {
					timing.model_retries += 1;
					timing.retry_backoff_ms_total += delayMs;
				}
				console.log(
					`  [RETRY] ${stage} ${plan.provider}:${plan.model} attempt ${attempt + 1}/${budget.maxRetries + 1} (${delayMs}ms backoff)`
				);
				await sleep(delayMs);
			}

			if (!plan.route) {
				throw new Error(`No executable route available for ${stage}`);
			}

			const callStarted = Date.now();
			const routingProvider = plan.route.provider ?? plan.provider;
			const foldSystem = shouldFoldSystemPromptIntoUserForProvider(routingProvider);
			const result = await withTimeout(
				generateText(
					foldSystem
						? {
								model: plan.route.model,
								messages: [
									{
										role: 'user',
										content: `${systemPrompt}\n\n${userMessage}`
									}
								],
								temperature: 0.1,
								maxOutputTokens: maxTokens
							}
						: {
								model: plan.route.model,
								system: systemPrompt,
								messages: [{ role: 'user', content: userMessage }],
								temperature: 0.1,
								maxOutputTokens: maxTokens
							}
				),
				budget.timeoutMs,
				`${stage} ${plan.provider}:${plan.model}`
			);
			if (timing) {
				const wall = Date.now() - callStarted;
				timing.model_calls[stage] = (timing.model_calls[stage] ?? 0) + 1;
				timing.model_call_wall_ms[stage] =
					(timing.model_call_wall_ms[stage] ?? 0) + wall;
			}
			const inputTokens = result.usage?.inputTokens ?? 0;
			const outputTokens = result.usage?.outputTokens ?? 0;
			const usageCostUsd = trackReasoningCost(costs, plan.model, inputTokens, outputTokens);
			if (result.finishReason === 'length') {
				throw new Error('Model output was truncated (max_tokens reached)');
			}
			console.log(
				`  [ROUTE] ${stage}: ${plan.provider}/${plan.model} source=${plan.routingSource} step=${plan.selectedStepId ?? '—'} order=${plan.selectedOrderIndex ?? '—'} switch=${plan.switchReasonCode ?? '—'} cost~$${usageCostUsd.toFixed(4)}`
			);
			assertStageBudget(budget, tracker, costs);
			return result.text;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			const msg = lastError.message;
			const retryable =
				msg.includes('429') ||
				msg.includes('529') ||
				msg.includes('500') ||
				msg.includes('overloaded') ||
				msg.includes('timeout') ||
				msg.includes('prompt_too_long') ||
				msg.includes('context_length') ||
				/resource exhausted/i.test(msg) ||
				/rate limit|quota|too many requests/i.test(msg);
			console.warn(
				`  [WARN] ${stage} ${plan.provider}:${plan.model} failed: ${formatModelCallErrorDetails(error)}`
			);
			if (isModelUnavailableError(lastError)) break;
			if (!retryable) break;
		}
	}

	const detail =
		lastError != null ? formatModelCallErrorDetails(lastError) : 'Unknown error';
	throw new Error(
		`[${stage}] Planned route exhausted (${plan.provider}:${plan.model}): ${detail}. If this is Anthropic, check the model id is not retired (see https://docs.anthropic.com/en/docs/about-claude/model-deprecations).`
	);
}

export async function fixJsonWithModel(params: {
	repairPlan: IngestionStagePlan;
	repairBudget: StageBudget;
	repairTracker: StageUsageTracker;
	costs: CostTracker;
	timing: IngestTimingPayload | null;
	originalJson: string;
	parseError: string;
	schema: string;
}): Promise<string> {
	const { repairPlan, repairBudget, repairTracker, costs, timing, originalJson, parseError, schema } =
		params;
	if (timing) timing.json_repair_invocations += 1;
	console.log(`  [FIX] Repair route: ${repairPlan.provider}:${repairPlan.model}`);

	const fixPrompt = `The following JSON output was malformed. Please fix it so it is valid JSON matching this schema:

Schema: ${schema}

Error: ${parseError}

Malformed JSON:
${originalJson}

Respond ONLY with the corrected JSON array. No explanation, no markdown backticks.`;

	return callStageModel({
		stage: 'json_repair',
		plan: repairPlan,
		budget: repairBudget,
		tracker: repairTracker,
		costs,
		timing,
		systemPrompt:
			'You are a JSON repair assistant. Fix the malformed JSON to be valid. Respond with only the corrected JSON.',
		userMessage: fixPrompt
	});
}
