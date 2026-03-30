import type { ConversationTurn } from './types';
import type { ClaimReference } from './types';
import { generateText } from 'ai';
import { resolveReasoningModelRoute, trackTokens } from '$lib/server/vertex';
import type { ProviderApiKeys } from '$lib/server/byok/types';

export function shouldEscalateToDeepAnalysis(params: {
  message: string;
  history: ConversationTurn[];
}): boolean {
  const { message, history } = params;
  const low = message.toLowerCase();
  const complexityMarkers = [
    'on the one hand',
    'tradeoff',
    'contradiction',
    'multiple values',
    'conflicted',
    'both true',
    'long term vs short term'
  ];
  const hasMarker = complexityMarkers.some((marker) => low.includes(marker));
  const recentUserTurns = history.filter((turn) => turn.role === 'user').slice(-3);
  const repeatedQuestion = recentUserTurns.length >= 2 && recentUserTurns.every((turn) => turn.content.length > 140);
  return hasMarker || repeatedQuestion;
}

export interface DeepEscalationResult {
  analysis: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  route: {
    provider: string;
    modelId: string;
    routeId: string | null;
    reason: string | null;
  };
}

function summarizeHistory(history: ConversationTurn[]): string {
  if (history.length === 0) return '(no prior turns)';
  return history
    .slice(-8)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');
}

function summarizeSources(sourceClaims: ClaimReference[]): string {
  if (sourceClaims.length === 0) return '(no retrieved source claims)';
  return sourceClaims
    .slice(0, 6)
    .map(
      (claim) =>
        `- [${claim.claimId}] ${claim.sourceText} (${claim.sourceAuthor}, ${claim.sourceWork})`
    )
    .join('\n');
}

export async function runDeepEscalationAnalysis(params: {
  message: string;
  history: ConversationTurn[];
  draftResponse: string;
  sourceClaims: ClaimReference[];
  providerApiKeys?: ProviderApiKeys;
}): Promise<DeepEscalationResult> {
  const route = await resolveReasoningModelRoute({
    depthMode: 'deep',
    pass: 'synthesis',
    providerApiKeys: params.providerApiKeys,
    routeId: 'stoa.dialogue.deep-escalation',
    restormelContext: {
      workload: 'stoa-dialogue',
      stage: 'conversation',
      task: 'deep-escalation',
      complexity: 'high'
    }
  });

  const prompt = `
The user message and first-pass Stoa response may involve competing values or unresolved tradeoffs.
Produce a deeper Stoic analysis that is still practical and compassionate.

Constraints:
1) Keep to 160-280 words.
2) Surface at least one concrete tension.
3) Reconcile with one Stoic principle and one practical next action.
4) If useful, cite claims by id like [claim:abc123].

Conversation summary:
${summarizeHistory(params.history)}

User message:
${params.message}

First-pass response:
${params.draftResponse}

Retrieved source claims:
${summarizeSources(params.sourceClaims)}
`.trim();

  const result = await generateText({
    model: route.model,
    system:
      'You are SOPHIA deep escalation mode. Refine nuanced reasoning without losing emotional calibration.',
    prompt,
    maxOutputTokens: 500
  });

  const usage = result.usage;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? 0;
  trackTokens(inputTokens, outputTokens);

  return {
    analysis: result.text.trim(),
    usage: {
      inputTokens,
      outputTokens,
      totalTokens
    },
    route: {
      provider: route.provider,
      modelId: route.modelId,
      routeId: route.resolvedRouteId ?? null,
      reason: route.resolvedExplanation ?? null
    }
  };
}

