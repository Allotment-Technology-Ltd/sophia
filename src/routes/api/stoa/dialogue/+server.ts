import type { RequestHandler } from './$types';
import { streamText } from 'ai';
import { loadInquiryEffectiveProviderApiKeys } from '$lib/server/byok/effectiveKeys';
import { resolveReasoningModelRoute } from '$lib/server/vertex';
import {
  appendStoaTurns,
  listIncompleteActionItems,
  listRelevantJournalEntries,
  loadStoaProfile,
  loadStoaSession,
  upsertActionItems,
  updateStoaProfileFromTurns
} from '$lib/server/stoa/sessionStore';
import {
  buildGroundingExplainer,
  retrieveStoaGroundingWithMode,
  scoreCitationQuality
} from '$lib/server/stoa/grounding';
import { detectCrisisRisk, detectSuppressionMisuse, buildCrisisSupportMessage } from '$lib/server/stoa/safety';
import { buildStoaSystemPrompt, buildStoaUserPrompt } from '$lib/server/stoa/prompt';
import { decideEscalation, runDeepEscalationAnalysis } from '$lib/server/stoa/escalation';
import type {
  ConversationTurn,
  DialogueRequest,
  GroundingConfidenceLevel
} from '$lib/server/stoa/types';
import { STOIC_FRAMEWORKS } from '$lib/server/stoa/frameworks';
import { classifyStanceV2 } from '$lib/server/stoa/stanceClassifier';
import { buildActionLoop, detectActionSuggestions } from '$lib/server/stoa/actionLoop';
import { recordStoaTelemetry } from '$lib/server/stoa/observability';
import { questEngine } from '$lib/server/stoa/game/quest-engine.js';
import type { QuestContext } from '$lib/server/stoa/game/quest-definitions/types.js';
import { getProgress } from '$lib/server/stoa/game/progress-store.js';

function sendSse(controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown): void {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function normalizeHistory(history?: ConversationTurn[]): ConversationTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'agent'))
    .map((turn) => ({
      role: turn.role,
      content: typeof turn.content === 'string' ? turn.content : '',
      timestamp: typeof turn.timestamp === 'string' ? turn.timestamp : new Date().toISOString(),
      stance: turn.stance,
      frameworksReferenced: Array.isArray(turn.frameworksReferenced)
        ? turn.frameworksReferenced
        : undefined
    }));
}

function extractFrameworkReferences(responseText: string): string[] {
  const low = responseText.toLowerCase();
  return STOIC_FRAMEWORKS
    .filter((framework) => low.includes(framework.label.toLowerCase()))
    .map((framework) => framework.id);
}

function buildSessionSummary(history: ConversationTurn[]): string {
  const recent = history.slice(-6);
  return recent
    .map((turn) => `${turn.role === 'user' ? 'U' : 'A'}: ${turn.content.slice(0, 180)}`)
    .join(' | ')
    .slice(0, 1200);
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body: DialogueRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const message = body.message?.trim();
  const sessionId = body.sessionId?.trim();
  if (!message || !sessionId) {
    return new Response(JSON.stringify({ error: 'message and sessionId are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const providerApiKeys = await loadInquiryEffectiveProviderApiKeys(locals.user, 'stoa dialogue route');
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let storedSession: Awaited<ReturnType<typeof loadStoaSession>>;
        try {
          storedSession = await loadStoaSession({ sessionId, userId: uid });
        } catch (error) {
          if (process.env.NODE_ENV !== 'test') {
            console.warn(
              '[STOA] Session load failed; continuing with request history only:',
              error instanceof Error ? error.message : String(error)
            );
          }
          storedSession = { sessionId, userId: uid, summary: null, turns: [], updatedAt: null };
        }
        const requestHistory = normalizeHistory(body.history);
        const history = storedSession.turns.length > 0 ? storedSession.turns : requestHistory;
        const profile = await loadStoaProfile(uid);
        const pendingActions = await listIncompleteActionItems({ userId: uid, lookbackDays: 14 });
        const relevantJournal = await listRelevantJournalEntries({
          userId: uid,
          message,
          limit: 3
        });
        const userTurn: ConversationTurn = {
          role: 'user',
          content: message,
          timestamp: new Date().toISOString()
        };
        const fullHistory = [...history, userTurn];
        const crisisHardStop = (process.env.STOA_CRISIS_HARD_STOP ?? 'true').toLowerCase() !== 'false';

        if (detectCrisisRisk(message) && crisisHardStop) {
          const response = buildCrisisSupportMessage();
          const agentTurn: ConversationTurn = {
            role: 'agent',
            content: response,
            timestamp: new Date().toISOString(),
            stance: 'hold'
          };
          sendSse(controller, { type: 'start' });
          sendSse(controller, {
            type: 'stance',
            stance: 'hold',
            frameworksReferenced: []
          });
          sendSse(controller, {
            type: 'metadata',
            stance: 'hold',
            escalated: false,
            sourceClaims: [],
            groundingMode: 'degraded_none',
            groundingWarning: 'Crisis protocol active: routed to immediate support guidance.'
          });
          sendSse(controller, { type: 'delta', text: response });
          sendSse(controller, { type: 'complete', response, stance: 'hold', frameworksReferenced: [] });
          await appendStoaTurns({ sessionId, userId: uid, turns: [userTurn, agentTurn] });
          await recordStoaTelemetry({
            uid,
            sessionId,
            route: '/api/stoa/dialogue',
            groundingMode: 'degraded_none',
            escalated: false,
            errorTaxonomy: 'crisis_hard_stop'
          });
          controller.close();
          return;
        }

        const stanceClassification = await classifyStanceV2({
          message,
          history,
          providerApiKeys
        });
        const stanceDecision = stanceClassification.decision;
        const suppressionMisuse = detectSuppressionMisuse(message);
        let sourceClaims: Awaited<ReturnType<typeof retrieveStoaGroundingWithMode>>['claims'] = [];
        let groundingMode: Awaited<ReturnType<typeof retrieveStoaGroundingWithMode>>['mode'] = 'degraded_none';
        let groundingConfidence: GroundingConfidenceLevel = 'low';
        let groundingWarning: string | undefined;
        try {
          const grounding = await retrieveStoaGroundingWithMode({ message, history: fullHistory, topK: 5 });
          sourceClaims = grounding.claims;
          groundingMode = grounding.mode;
          groundingConfidence = grounding.confidence;
          groundingWarning = grounding.warning;
        } catch (error) {
          if (process.env.NODE_ENV !== 'test') {
            console.warn(
              '[STOA] Grounding retrieval failed; continuing without source claims:',
              error instanceof Error ? error.message : String(error)
            );
          }
        }
        const systemPrompt = buildStoaSystemPrompt({
          stance: stanceDecision.stance,
          sources: sourceClaims,
          askClarifyingQuestion: stanceDecision.askClarifyingQuestion,
          suppressionMisuse,
          recommendedFrameworks: stanceDecision.recommendedFrameworks,
          frameworkRationale: stanceDecision.frameworkRationale,
          profile
        });
        const userPrompt = buildStoaUserPrompt({
          message,
          history,
          sources: sourceClaims
        });

        const modelRoute = await resolveReasoningModelRoute({
          depthMode: 'standard',
          pass: 'generic',
          providerApiKeys,
          routeId: 'stoa.dialogue.default',
          restormelContext: {
            workload: 'stoa-dialogue',
            stage: 'conversation',
            task: 'mode6-reply',
            estimatedInputChars: userPrompt.length + systemPrompt.length
          }
        });

        const escalationDecision = decideEscalation({ message, history });
        const escalated = escalationDecision.escalate;

        sendSse(controller, { type: 'start' });
        sendSse(controller, {
          type: 'stance',
          stance: stanceDecision.stance,
          frameworksReferenced: stanceDecision.recommendedFrameworks
        });
        sendSse(controller, {
          type: 'metadata',
          stance: stanceDecision.stance,
          stanceConfidence: stanceDecision.confidence,
          stanceReason: stanceDecision.reason,
          stanceClassifierSource: stanceClassification.source,
          frameworkRecommendation: stanceDecision.recommendedFrameworks,
          frameworkRationale: stanceDecision.frameworkRationale,
          sourceClaims,
          groundingMode,
          groundingConfidence,
          groundingWarning,
          pendingActions,
          relevantJournal,
          escalated,
          escalationReasons: escalationDecision.reasons
        });
        if (escalated) {
          sendSse(controller, {
            type: 'escalation_started',
            mode: 'deep',
            note: 'Running deep escalation pass.',
            reasons: escalationDecision.reasons
          });
        }

        const streamResult = streamText({
          model: modelRoute.model as any,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          onError: ({ error }) => {
            sendSse(controller, {
              type: 'error',
              message: error instanceof Error ? error.message : String(error)
            });
          }
        });

        let responseText = '';
        for await (const delta of streamResult.textStream) {
          responseText += delta;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`));
        }

        const usage = await streamResult.totalUsage;
        const finishReason = await streamResult.finishReason;
        const frameworksReferenced = extractFrameworkReferences(responseText);
        const citationQuality = scoreCitationQuality({
          responseText,
          sourceClaims
        });
        const groundingExplainer = buildGroundingExplainer({
          groundingMode,
          confidence: citationQuality.overall,
          sourceClaims,
          citationQuality: citationQuality.details
        });

        let escalationResult: Awaited<ReturnType<typeof runDeepEscalationAnalysis>> | null = null;
        if (escalated) {
          escalationResult = await runDeepEscalationAnalysis({
            message,
            history: fullHistory,
            draftResponse: responseText,
            sourceClaims,
            providerApiKeys
          });
          if (escalationResult.analysis) {
            sendSse(controller, {
              type: 'escalation_result',
              analysis: escalationResult.analysis,
              usage: escalationResult.usage,
              route: escalationResult.route
            });
          }
        }

        const finalResponse =
          escalationResult?.analysis?.trim().length
            ? `${responseText}\n\n---\n\nDeep analysis:\n${escalationResult.analysis}`
            : responseText;
        const actionLoop = buildActionLoop({ responseText: finalResponse, stance: stanceDecision.stance });
        const actionSuggestions = detectActionSuggestions(finalResponse);
        if (actionSuggestions.length > 0) {
          await upsertActionItems({
            userId: uid,
            sessionId,
            items: actionSuggestions.map((item) => ({
              text: item.text,
              timeframe: item.timeframe,
              origin: 'auto_detected',
              confidenceScore: item.confidenceScore
            }))
          });
        }

        const agentTurn: ConversationTurn = {
          role: 'agent',
          content: finalResponse,
          timestamp: new Date().toISOString(),
          stance: stanceDecision.stance,
          frameworksReferenced
        };

        await appendStoaTurns({
          sessionId,
          userId: uid,
          turns: [userTurn, agentTurn],
          summary: buildSessionSummary([...fullHistory, agentTurn])
        });
        await updateStoaProfileFromTurns({
          userId: uid,
          turns: [...fullHistory, agentTurn]
        });
        await recordStoaTelemetry({
          uid,
          sessionId,
          route: '/api/stoa/dialogue',
          groundingMode,
          escalated,
          errorTaxonomy: null
        });

        sendSse(controller, {
          type: 'complete',
          response: finalResponse,
          stance: stanceDecision.stance,
          frameworksReferenced,
          sourceClaims,
          groundingMode,
          groundingWarning: groundingWarning ?? null,
          groundingConfidence: citationQuality.overall,
          groundingReasons: groundingExplainer.reasons,
          groundingExplainer: groundingExplainer.explanation,
          citationQuality: citationQuality.details,
          actionLoop,
          actionSuggestions,
          pendingActions,
          relevantJournal,
          profile,
          escalated,
          escalationResult: escalationResult
            ? {
                analysis: escalationResult.analysis,
                usage: escalationResult.usage,
                route: escalationResult.route
              }
            : null,
          finishReason,
          usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            totalTokens: usage.totalTokens ?? 0
          }
        });

        // Async quest evaluation - fire and forget, do not block SSE stream
        // Errors are logged but not surfaced to the client
        (async () => {
          try {
            const progress = await getProgress(uid);
            const questContext: QuestContext = {
              sessionId,
              userId: uid,
              frameworksUsed: frameworksReferenced,
              unlockedThinkers: progress.unlockedThinkers,
              activeQuestIds: progress.activeQuestIds,
              completedQuestIds: progress.completedQuestIds
            };

            // Evaluate completions (triggers are auto-started by the engine)
            const completedQuests = await questEngine.evaluateCompletions(uid, questContext);
            const newlyAvailable = await questEngine.evaluateTriggers(uid, questContext);

            // Award completions (idempotent - safe to call multiple times)
            let xpGained = 0;
            const questsCompleted: string[] = [];
            const newUnlocks: string[] = [];

            for (const quest of completedQuests) {
              await questEngine.awardCompletion(uid, quest, sessionId);
              xpGained += quest.reward.xp;
              questsCompleted.push(quest.id);
              if (quest.reward.unlockThinkerId) {
                newUnlocks.push(quest.reward.unlockThinkerId);
              }
            }

            // Emit progress_update event if anything changed
            if (xpGained > 0 || newUnlocks.length > 0 || questsCompleted.length > 0) {
              sendSse(controller, {
                type: 'progress_update',
                xpGained,
                newUnlocks,
                questsCompleted
              });
            }

            // Log quest evaluation results
            await recordStoaTelemetry({
              uid,
              sessionId,
              route: '/api/stoa/dialogue/quest-evaluation',
              groundingMode,
              escalated,
              errorTaxonomy: null
            });
          } catch (questError) {
            // Log errors but do not surface to SSE stream
            if (process.env.NODE_ENV !== 'test') {
              console.warn(
                '[STOA] Quest evaluation error (non-blocking):',
                questError instanceof Error ? questError.message : String(questError)
              );
            }
            await recordStoaTelemetry({
              uid,
              sessionId,
              route: '/api/stoa/dialogue/quest-evaluation',
              groundingMode: 'degraded_none',
              escalated: false,
              errorTaxonomy: 'quest_evaluation_error'
            });
          }
        })();
      } catch (error) {
        await recordStoaTelemetry({
          uid,
          sessionId,
          route: '/api/stoa/dialogue',
          groundingMode: 'degraded_none',
          escalated: false,
          errorTaxonomy: 'runtime_error'
        });
        sendSse(controller, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
};

