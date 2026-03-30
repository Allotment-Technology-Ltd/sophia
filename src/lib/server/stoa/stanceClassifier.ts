import { generateObject } from 'ai';
import { z } from 'zod';
import type { ProviderApiKeys } from '$lib/server/byok/types';
import { resolveReasoningModelRoute } from '$lib/server/vertex';
import { detectStance, type StanceDecision } from './stance';
import type { ConversationTurn } from './types';

const stanceSchema = z.object({
  stance: z.enum(['hold', 'challenge', 'guide', 'teach', 'sit_with']),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().min(4).max(240),
  askClarifyingQuestion: z.boolean(),
  recommendedFrameworks: z.array(z.string()).min(1).max(2),
  frameworkRationale: z.string().min(6).max(260)
});

function normalizeFrameworks(raw: string[]): Array<
  | 'dichotomy_of_control'
  | 'premeditatio_malorum'
  | 'view_from_above'
  | 'amor_fati'
  | 'three_disciplines'
  | 'reserve_clause'
  | 'role_ethics'
  | 'discipline_of_impression'
  | 'sympatheia'
  | 'memento_mori'
> {
  const allowed = new Set([
    'dichotomy_of_control',
    'premeditatio_malorum',
    'view_from_above',
    'amor_fati',
    'three_disciplines',
    'reserve_clause',
    'role_ethics',
    'discipline_of_impression',
    'sympatheia',
    'memento_mori'
  ]);
  return raw.filter((value) => allowed.has(value)) as any;
}

export async function classifyStanceV2(params: {
  message: string;
  history: ConversationTurn[];
  providerApiKeys?: ProviderApiKeys;
}): Promise<{ decision: StanceDecision; source: 'llm' | 'heuristic' }> {
  const heuristic = detectStance({ message: params.message, history: params.history });
  try {
    const route = await resolveReasoningModelRoute({
      depthMode: 'quick',
      pass: 'generic',
      providerApiKeys: params.providerApiKeys,
      routeId: 'stoa.stance.classifier'
    });
    const prompt = `
Classify the best Stoa stance for this user message.
History:
${params.history.slice(-6).map((t) => `${t.role}: ${t.content}`).join('\n') || '(none)'}

User message:
${params.message}
`.trim();
    const generated = await generateObject({
      model: route.model,
      schema: stanceSchema,
      system:
        'You classify Stoa dialogue stance for a stoic mentor assistant. Return strict schema values.',
      prompt
    });
    const frameworks = normalizeFrameworks(generated.object.recommendedFrameworks);
    if (frameworks.length === 0) {
      return { decision: heuristic, source: 'heuristic' };
    }
    return {
      source: 'llm',
      decision: {
        ...heuristic,
        stance: generated.object.stance,
        confidence: generated.object.confidence,
        reason: generated.object.reason,
        askClarifyingQuestion: generated.object.askClarifyingQuestion,
        recommendedFrameworks: frameworks,
        frameworkRationale: generated.object.frameworkRationale
      }
    };
  } catch {
    return { decision: heuristic, source: 'heuristic' };
  }
}

