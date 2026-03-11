import { generateObject } from 'ai';
import { z } from 'zod';
import { parseReasoningProvider, type ModelProvider } from '$lib/types/providers';
import {
  type EssayFeedback,
  EssayFeedbackSchema,
  type LearnDomain,
  type ShortAnswerMiniReview,
  ShortAnswerMiniReviewSchema,
  SkillScoresSchema,
  type SkillScores
} from '$lib/types/learn';
import type { ProviderApiKeys } from '$lib/server/byok/types';
import { getReasoningModelRoute } from '$lib/server/vertex';
import {
  LEARN_ANALYSIS_SYSTEM_PROMPT,
  LEARN_BREAKDOWN_SYSTEM_PROMPT,
  LEARN_CRITIQUE_SYSTEM_PROMPT,
  LEARN_SYNTHESIS_SYSTEM_PROMPT,
  SHORT_ANSWER_REVIEW_SYSTEM_PROMPT,
  LEARNING_PROGRESS_SYSTEM_PROMPT,
  buildLearnAnalysisPrompt,
  buildLearnBreakdownPrompt,
  buildLearnCritiquePrompt,
  buildLearnSynthesisPrompt,
  buildShortAnswerReviewPrompt
} from '$lib/server/prompts/learn';

const BreakdownSchema = z.object({
  domain: z.enum(['ethics', 'politics', 'epistemology', 'metaphysics', 'logic']),
  claims: z.array(z.string().min(1)).min(1),
  premises: z.array(z.string().min(1)).default([]),
  conclusions: z.array(z.string().min(1)).default([]),
  rhetorical_sentences: z.array(z.string()).default([]),
  argumentative_sentences: z.array(z.string()).default([])
});

const AnalysisSchema = z.object({
  analysis_summary: z.string().min(1),
  thesis: z.string().min(1),
  logical_structure: z.string().min(1),
  missing_definitions: z.array(z.string()).default([])
});

const CritiqueSchema = z.object({
  critique_points: z.array(z.string().min(1)).min(2).max(4),
  unsupported_assumptions: z.array(z.string().min(1)).default([]),
  contradictions: z.array(z.string().min(1)).default([]),
  referenced_thinkers: z.array(z.string().min(1)).default([])
});

const SynthesisSchema = z.object({
  synthesis_suggestions: z.string().min(1),
  revised_argument: z.string().min(1),
  score_rationale: z.string().min(1),
  summary_score: z.number().min(0).max(100),
  dimension_scores: SkillScoresSchema,
  recommended_lessons: z.array(z.string().min(1)).default([])
});

const ProgressRecommendationSchema = z.object({
  recommendation: z.string().min(1)
});

interface LearnModelOptions {
  providerApiKeys?: ProviderApiKeys;
  modelProvider?: ModelProvider;
  modelId?: string;
  depthMode?: 'quick' | 'standard' | 'deep';
}

async function generateStructuredWithRetry<T extends z.ZodTypeAny>(
  schema: T,
  system: string,
  prompt: string,
  opts: LearnModelOptions,
  pass: 'analysis' | 'critique' | 'synthesis',
  maxAttempts = 3
): Promise<z.infer<T>> {
  const requestedProvider =
    opts.modelProvider && opts.modelProvider !== 'auto' ? opts.modelProvider : undefined;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const route = getReasoningModelRoute({
        pass,
        depthMode: opts.depthMode ?? 'standard',
        requestedProvider,
        requestedModelId: opts.modelId,
        providerApiKeys: opts.providerApiKeys
      });

      const result = await generateObject({
        model: route.model,
        schema,
        system,
        prompt: `${prompt}\n\nReturn strictly valid JSON only. Attempt ${attempt}/${maxAttempts}.`,
        temperature: 0.4,
        maxTokens: 1500
      });

      return schema.parse(result.object);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Learn structured generation failed after retries');
}

function fallbackRecommendations(domain: LearnDomain): string[] {
  if (domain === 'ethics') return ['ethics_intro_02', 'ethics_intro_04'];
  if (domain === 'logic') return ['logic_intro_02', 'logic_intro_03'];
  if (domain === 'epistemology') return ['logic_intro_04', 'logic_intro_05'];
  return ['ethics_intro_03', 'logic_intro_01'];
}

export async function generateEssayFeedback(
  question: string,
  text: string,
  options: LearnModelOptions = {}
): Promise<EssayFeedback> {
  const breakdown = await generateStructuredWithRetry(
    BreakdownSchema,
    LEARN_BREAKDOWN_SYSTEM_PROMPT,
    buildLearnBreakdownPrompt(question, text),
    options,
    'analysis'
  );

  const analysis = await generateStructuredWithRetry(
    AnalysisSchema,
    LEARN_ANALYSIS_SYSTEM_PROMPT,
    buildLearnAnalysisPrompt(question, text, JSON.stringify(breakdown)),
    options,
    'analysis'
  );

  const critique = await generateStructuredWithRetry(
    CritiqueSchema,
    LEARN_CRITIQUE_SYSTEM_PROMPT,
    buildLearnCritiquePrompt(question, text, JSON.stringify(breakdown), JSON.stringify(analysis)),
    options,
    'critique'
  );

  const synthesis = await generateStructuredWithRetry(
    SynthesisSchema,
    LEARN_SYNTHESIS_SYSTEM_PROMPT,
    buildLearnSynthesisPrompt(
      question,
      text,
      JSON.stringify(breakdown),
      JSON.stringify(analysis),
      JSON.stringify(critique)
    ),
    options,
    'synthesis'
  );

  return EssayFeedbackSchema.parse({
    domain: breakdown.domain,
    analysis_summary: analysis.analysis_summary,
    critique_points: critique.critique_points,
    synthesis_suggestions: synthesis.synthesis_suggestions,
    referenced_thinkers: critique.referenced_thinkers,
    score_rationale: synthesis.score_rationale,
    recommended_lessons:
      synthesis.recommended_lessons.length > 0
        ? synthesis.recommended_lessons
        : fallbackRecommendations(breakdown.domain),
    summary_score: synthesis.summary_score,
    dimension_scores: synthesis.dimension_scores,
    pass_feedback: {
      analysis: [analysis.analysis_summary, `Logical structure: ${analysis.logical_structure}`]
        .filter(Boolean)
        .join('\n\n'),
      critique: critique.critique_points.join('\n- ').replace(/^/, '- '),
      synthesis: synthesis.revised_argument
    }
  });
}

export async function generateEssayRevision(
  question: string,
  revisedText: string,
  priorFeedback: EssayFeedback | null,
  options: LearnModelOptions = {}
): Promise<EssayFeedback> {
  const seededQuestion = priorFeedback
    ? `${question}\n\nPrior score context: ${priorFeedback.summary_score}/100. Improve clarity while preserving learner intent.`
    : question;

  return generateEssayFeedback(seededQuestion, revisedText, options);
}

export async function generateShortAnswerReview(
  question: string,
  responseText: string,
  options: LearnModelOptions = {}
): Promise<ShortAnswerMiniReview> {
  return generateStructuredWithRetry(
    ShortAnswerMiniReviewSchema,
    SHORT_ANSWER_REVIEW_SYSTEM_PROMPT,
    buildShortAnswerReviewPrompt(question, responseText),
    options,
    'analysis'
  );
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function generateProgressRecommendation(input: {
  skills: SkillScores;
  trajectoryDelta: number;
  completedUnits: number;
  essayCount: number;
}): Promise<string> {
  const route = getReasoningModelRoute({ pass: 'synthesis', depthMode: 'quick' });
  try {
    const result = await generateObject({
      model: route.model,
      schema: ProgressRecommendationSchema,
      system: LEARNING_PROGRESS_SYSTEM_PROMPT,
      prompt: `METRICS\n${JSON.stringify(input)}`,
      temperature: 0.3,
      maxOutputTokens: 180
    });
    return result.object.recommendation;
  } catch {
    return 'Focus on evaluating counterarguments before final synthesis; your structure is improving.';
  }
}

export function computeSkillScoresFromHistory(
  dimensionRows: SkillScores[]
): SkillScores {
  return SkillScoresSchema.parse({
    clarity: Math.round(average(dimensionRows.map((row) => row.clarity))),
    coherence: Math.round(average(dimensionRows.map((row) => row.coherence))),
    critique_depth: Math.round(average(dimensionRows.map((row) => row.critique_depth))),
    originality: Math.round(average(dimensionRows.map((row) => row.originality)))
  });
}

export function computeTrajectoryDelta(summaryScores: number[]): number {
  if (summaryScores.length < 2) return 0;
  const sorted = [...summaryScores];
  const midpoint = Math.floor(sorted.length / 2);
  const older = average(sorted.slice(midpoint));
  const newer = average(sorted.slice(0, midpoint || 1));
  return Math.round(newer - older);
}

export function resolveRequestedProvider(raw: unknown): ModelProvider {
  if (typeof raw !== 'string') return 'auto';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'auto') return 'auto';
  const parsed = parseReasoningProvider(normalized);
  return parsed ?? 'auto';
}
