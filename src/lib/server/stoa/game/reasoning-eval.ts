import { generateObject } from 'ai';
import { z } from 'zod';
import { query } from '$lib/server/db';
import { resolveReasoningModelRoute } from '$lib/server/vertex';
import type { ConversationTurn } from '$lib/server/stoa/types';

const reasoningAssessmentSchema = z.object({
  qualityScore: z.number().min(0).max(1),
  dimensions: z.object({
    logicalConsistency: z.number().min(0).max(1),
    frameworkApplication: z.number().min(0).max(1),
    epistemicCalibration: z.number().min(0).max(1),
    dichotomyClarity: z.number().min(0).max(1).nullable(),
    emotionalHonesty: z.number().min(0).max(1)
  }),
  frameworksApplied: z.array(z.string().min(1)).max(6),
  improvementNotes: z.array(z.string().min(1)).max(6),
  frameworkNamedWithoutApplication: z.boolean().default(false)
});

export interface ReasoningAssessmentInput {
  sessionId: string;
  userId: string;
  turnIndex: number;
  userMessage: string;
  agentResponse: string;
  frameworksReferenced: string[];
  conversationHistory: ConversationTurn[];
}

export interface ReasoningAssessment {
  sessionId: string;
  turnIndex: number;
  qualityScore: number;
  dimensions: {
    logicalConsistency: number;
    frameworkApplication: number;
    epistemicCalibration: number;
    dichotomyClarity: number | null;
    emotionalHonesty: number;
  };
  frameworksApplied: string[];
  improvementNotes: string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function countWords(text: string): number {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

function detectNamedWithoutApplication(userMessage: string, frameworksReferenced: string[]): boolean {
  if (frameworksReferenced.length === 0) return false;

  const text = userMessage.toLowerCase();
  const referencesAnyFramework = frameworksReferenced.some((framework) =>
    text.includes(framework.replace(/_/g, ' '))
  );
  if (!referencesAnyFramework) return false;

  const applicationSignals = [
    'i will',
    "i'll",
    'i am going to',
    'so i can',
    'therefore i',
    'which means i',
    'in this situation',
    'for this conversation',
    'for this meeting',
    'for my'
  ];
  return !applicationSignals.some((signal) => text.includes(signal));
}

function normalizeAssessment(
  input: ReasoningAssessmentInput,
  generated: z.infer<typeof reasoningAssessmentSchema>
): ReasoningAssessment {
  const heuristicNamedWithoutApplication = detectNamedWithoutApplication(
    input.userMessage,
    input.frameworksReferenced
  );
  const forceFrameworkZero =
    generated.frameworkNamedWithoutApplication || heuristicNamedWithoutApplication;

  const frameworkApplication = forceFrameworkZero
    ? 0
    : clamp01(generated.dimensions.frameworkApplication);

  const dimensions = {
    logicalConsistency: clamp01(generated.dimensions.logicalConsistency),
    frameworkApplication,
    epistemicCalibration: clamp01(generated.dimensions.epistemicCalibration),
    dichotomyClarity:
      generated.dimensions.dichotomyClarity === null
        ? null
        : clamp01(generated.dimensions.dichotomyClarity),
    // Emotional honesty should never be penalized for vulnerability.
    emotionalHonesty: clamp01(generated.dimensions.emotionalHonesty)
  };

  const qualityScore = clamp01(
    (dimensions.logicalConsistency +
      dimensions.frameworkApplication +
      dimensions.epistemicCalibration +
      (dimensions.dichotomyClarity ?? dimensions.frameworkApplication) +
      dimensions.emotionalHonesty) /
      5
  );

  return {
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    qualityScore,
    dimensions,
    frameworksApplied: Array.from(new Set(generated.frameworksApplied.map((item) => item.trim()))).filter(
      Boolean
    ),
    improvementNotes: generated.improvementNotes.map((item) => item.trim()).filter(Boolean)
  };
}

async function persistAssessment(userId: string, assessment: ReasoningAssessment): Promise<void> {
  await query(
    `UPSERT stoa_reasoning_assessment
     SET session_id = $sessionId,
         user_id = <record<user>>$userRecord,
         turn_index = $turnIndex,
         quality_score = $qualityScore,
         dimensions = $dimensions,
         frameworks_applied = $frameworksApplied,
         assessed_at = time::now()
     WHERE user_id = <record<user>>$userRecord
       AND session_id = $sessionId
       AND turn_index = $turnIndex`,
    {
      sessionId: assessment.sessionId,
      userRecord: `user:${userId}`,
      turnIndex: assessment.turnIndex,
      qualityScore: assessment.qualityScore,
      dimensions: assessment.dimensions,
      frameworksApplied: assessment.frameworksApplied
    }
  );
}

export class ReasoningEvaluator {
  async assess(input: ReasoningAssessmentInput): Promise<ReasoningAssessment | null> {
    if (countWords(input.userMessage) < 20) {
      return null;
    }

    const historyContext = input.conversationHistory
      .slice(-10)
      .map((turn) => `${turn.role}: ${turn.content}`)
      .join('\n');

    try {
      const route = await resolveReasoningModelRoute({
        depthMode: 'quick',
        pass: 'generic',
        routeId: 'stoa.reasoning.assessment'
      });
      const generated = await generateObject({
        model: route.model,
        schema: reasoningAssessmentSchema,
        system: `You evaluate student reasoning quality in Stoic dialogue.
Output scores in [0,1].
Rules:
- Never penalize emotional vulnerability; emotional honesty is HIGH when pain is named directly.
- frameworkApplication MUST be 0 when a framework is merely named but not applied to the student's actual situation.
- Use null for dichotomyClarity when dichotomy of control is not used in reasoning.
- Keep improvementNotes concrete and brief.`,
        prompt: `Assess this dialogue turn.

Session: ${input.sessionId}
Turn index: ${input.turnIndex}
Frameworks referenced by classifier: ${input.frameworksReferenced.join(', ') || '(none)'}

Student message:
${input.userMessage}

Agent response:
${input.agentResponse}

Recent conversation history:
${historyContext || '(none)'}`,
      });

      const assessment = normalizeAssessment(input, generated.object);
      void persistAssessment(input.userId, assessment).catch((error) => {
        console.warn(
          '[STOA] Failed persisting reasoning assessment:',
          error instanceof Error ? error.message : String(error)
        );
      });
      return assessment;
    } catch (error) {
      console.warn(
        '[STOA] Reasoning assessment failed:',
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }
}
