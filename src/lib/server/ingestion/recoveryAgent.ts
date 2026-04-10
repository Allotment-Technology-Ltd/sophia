/**
 * Reactive ingestion recovery agent — runs only after normal retries fail.
 * Consults a small Vertex-routed model for a bounded JSON decision (no pre-emptive tuning).
 */

import { generateText } from 'ai';
import { z } from 'zod';
import { resolveReasoningModelRoute } from '../vertex.js';

const RecoveryDecisionSchema = z.object({
	action: z.enum(['proceed_to_next_step', 'sleep_and_retry_once']),
	sleep_ms: z.number().int().min(0).optional(),
	rationale: z.string().max(2000).optional()
});

export type IngestionRecoveryDecision = z.infer<typeof RecoveryDecisionSchema>;

export function ingestRecoveryAgentEnabled(): boolean {
	const v = (process.env.INGEST_RECOVERY_AGENT ?? '').trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes';
}

function maxAgentSleepMs(): number {
	const raw = parseInt(process.env.INGEST_RECOVERY_AGENT_MAX_SLEEP_MS ?? '', 10);
	return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 300_000) : 120_000;
}

function agentConsultTimeoutMs(): number {
	const raw = parseInt(process.env.INGEST_RECOVERY_AGENT_TIMEOUT_MS ?? '', 10);
	return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120_000) : 45_000;
}

/** Same heuristics as scripts/ingest.ts `callStageModel` retry loop — transient provider/load issues. */
export function isRetryableIngestModelErrorMessage(message: string): boolean {
	const msg = message;
	return (
		msg.includes('429') ||
		msg.includes('529') ||
		msg.includes('500') ||
		msg.includes('overloaded') ||
		msg.includes('timeout') ||
		msg.includes('prompt_too_long') ||
		msg.includes('context_length') ||
		/resource exhausted/i.test(msg) ||
		/rate limit|quota|too many requests/i.test(msg) ||
		/\btpm\b|tokens per min|token.?per.?min/i.test(msg)
	);
}

function stripJsonFence(text: string): string {
	let cleaned = text.trim();
	if (cleaned.startsWith('```json')) {
		cleaned = cleaned.slice(7);
	} else if (cleaned.startsWith('```')) {
		cleaned = cleaned.slice(3);
	}
	if (cleaned.endsWith('```')) {
		cleaned = cleaned.slice(0, -3);
	}
	return cleaned.trim();
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 3) + '...';
}

/**
 * Ask the recovery agent what to do after deterministic retries are exhausted.
 * On parse/network failure returns `proceed_to_next_step` (safe default).
 */
export async function consultIngestionRecoveryAgent(params: {
	stage: string;
	provider: string;
	model: string;
	errorMessage: string;
}): Promise<IngestionRecoveryDecision> {
	const { stage, provider, model, errorMessage } = params;

	const route = await resolveReasoningModelRoute({
		depthMode: 'quick',
		pass: 'generic',
		failureMode: 'degraded_default',
		restormelContext: {
			workload: 'ingestion_recovery_agent',
			stage: 'recovery_consult',
			task: 'classify_failure_and_suggest_bounded_action',
			attempt: 1
		}
	});

	const maxSleep = maxAgentSleepMs();
	const userPrompt = `You are an ingestion recovery planner. Normal retries for this pipeline stage already failed.

Context:
- stage: ${stage}
- provider: ${provider}
- model: ${model}
- error (truncated): ${truncate(errorMessage, 1800)}

Choose exactly one action:
- "proceed_to_next_step" — give up on this model tier; the operator chain should try fallbacks or fail clearly (auth, bad request, invalid model, non-retryable).
- "sleep_and_retry_once" — error looks like temporary overload, rate limit, or similar; one more attempt on the SAME route may succeed after waiting. Set sleep_ms between 3000 and ${maxSleep} (milliseconds).

Respond with ONLY valid JSON (no markdown):
{"action":"proceed_to_next_step"|"sleep_and_retry_once","sleep_ms":number_optional,"rationale":"short"}`;

	const timeoutMs = agentConsultTimeoutMs();
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);

	try {
		const result = await generateText({
			model: route.model,
			system:
				'You output only compact JSON for operators. No markdown fences, no commentary outside JSON.',
			messages: [{ role: 'user', content: userPrompt }],
			temperature: 0.1,
			maxOutputTokens: 512,
			abortSignal: ctrl.signal
		});

		const parsed = JSON.parse(stripJsonFence(result.text)) as unknown;
		const decision = RecoveryDecisionSchema.safeParse(parsed);
		if (!decision.success) {
			console.warn(
				`  [RECOVERY_AGENT] Invalid decision JSON — proceeding. ${decision.error.message}`
			);
			return { action: 'proceed_to_next_step', rationale: 'parse_error' };
		}
		return decision.data;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.warn(`  [RECOVERY_AGENT] Consult failed — proceeding. ${truncate(msg, 400)}`);
		return { action: 'proceed_to_next_step', rationale: 'consult_error' };
	} finally {
		clearTimeout(timer);
	}
}

export function effectiveRecoverySleepMs(decision: IngestionRecoveryDecision): number {
	if (decision.action !== 'sleep_and_retry_once') return 0;
	const raw = decision.sleep_ms ?? 10_000;
	const cap = maxAgentSleepMs();
	return Math.max(0, Math.min(raw, cap));
}
