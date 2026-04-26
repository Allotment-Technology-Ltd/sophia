import { generateText } from 'ai';
import { z } from 'zod';
import { resolveReasoningModelRoute, trackTokens } from './vertex';
import type { ProviderApiKeys } from './byok/types';
import {
  ReasoningScoreSchema,
  type ExtractedClaim,
  type ExtractedRelation,
  type ReasoningEvaluation,
  type VerificationRequest
} from '$lib/types/verification';
import { buildReasoningEvalUserPrompt, REASONING_EVAL_SYSTEM_PROMPT } from './prompts/reasoning-eval';

const ReasoningScoresArraySchema = z.array(ReasoningScoreSchema).length(6);

const WEIGHTS: Record<string, number> = {
  logical_structure: 0.25,
  evidence_grounding: 0.2,
  counterargument_coverage: 0.2,
  scope_calibration: 0.15,
  assumption_transparency: 0.1,
  internal_consistency: 0.1
};

function computeOverallScore(scores: z.infer<typeof ReasoningScoreSchema>[]): number {
  const weighted = scores.reduce((sum, score) => {
    const weight = WEIGHTS[score.dimension] ?? 0;
    return sum + score.score * weight;
  }, 0);

  return Number(weighted.toFixed(4));
}

function extractJson(text: string): string {
  // Strip markdown fences if present: ```json ... ``` or ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Find first [ or { and take from there
  const start = text.search(/[\[{]/);
  return start >= 0 ? text.slice(start) : text;
}

function parseScores(text: string): z.infer<typeof ReasoningScoreSchema>[] {
  const parsed = JSON.parse(extractJson(text));
  return ReasoningScoresArraySchema.parse(parsed);
}

export interface ReasoningEvaluationResult {
  evaluation: ReasoningEvaluation;
  route: {
    provider: string;
    modelId: string;
    routeId: string | null;
    reason: string | null;
  };
}

export async function evaluateReasoning(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[],
  request: VerificationRequest,
  options?: { providerApiKeys?: ProviderApiKeys }
): Promise<ReasoningEvaluationResult> {
  const originalText = [request.question, request.answer, request.text].filter(Boolean).join('\n\n');
  const prompt = buildReasoningEvalUserPrompt(claims, relations, originalText);
  const route = await resolveReasoningModelRoute({
    pass: 'verification',
    depthMode: request.depth ?? 'standard',
    providerApiKeys: options?.providerApiKeys,
    failureMode: 'error'
  });

  let responseText = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await generateText({
      model: route.model,
      system: REASONING_EVAL_SYSTEM_PROMPT,
      prompt: attempt === 0 ? prompt : `${prompt}\n\nReturn ONLY valid JSON.`,
      maxOutputTokens: 1200
    });

    const usage = result.usage;
    trackTokens(usage?.inputTokens ?? 0, usage?.outputTokens ?? 0);
    responseText = result.text;

    try {
      const dimensions = parseScores(responseText);
      return {
        evaluation: {
          overall_score: computeOverallScore(dimensions),
          dimensions
        },
        route: {
          provider: route.provider,
          modelId: route.modelId,
          routeId: route.resolvedRouteId ?? null,
          reason: route.resolvedExplanation ?? null
        }
      };
    } catch {
      if (attempt === 1) {
        throw new Error('Failed to parse reasoning evaluation JSON output');
      }
    }
  }

  throw new Error('Reasoning evaluation failed unexpectedly');
}
