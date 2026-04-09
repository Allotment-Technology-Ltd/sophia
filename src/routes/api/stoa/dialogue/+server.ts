import type { RequestHandler } from './$types';
import { streamText } from 'ai';
import { loadInquiryEffectiveProviderApiKeys } from '$lib/server/byok/effectiveKeys';
import { resolveReasoningModelRoute } from '$lib/server/vertex';
import {
  appendStoaStateEvents,
  appendStoaTurns,
  listJournalEntries,
  listIncompleteActionItems,
  listRelevantJournalEntries,
  loadStoaProfile,
  loadStoaSession,
  upsertActionItems,
  updateStoaProfileFromTurns
} from '$lib/server/stoa/sessionStore';
import type { StateEvent } from '@restormel/state';
import {
  createStoaHistorySummarizationEvent,
  createStoaTurnDigestEvents
} from '$lib/server/stoa/restormelStoaStateEvents';
import { redactStoaUserTurnDigest } from '$lib/server/stoa/restormelStateDigest';
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
import { QuestEngine } from '$lib/server/stoa/game/quest-engine';
import { getProgress } from '$lib/server/stoa/game/progress-store';
import type { QuestContext } from '$lib/server/stoa/game/types';
import { ReasoningEvaluator } from '$lib/server/stoa/game/reasoning-eval';
import { getReasoningTrend } from '$lib/server/stoa/game/reasoning-progression';
import { ALL_QUESTS } from '$lib/server/stoa/game/quest-definitions';
import { logger } from '$lib/server/cloud-logger';

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

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function computeDaysElapsed(history: ConversationTurn[]): number {
  const timestamps = history
    .map((turn) => Date.parse(turn.timestamp))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return 0;
  const first = Math.min(...timestamps);
  const elapsedMs = Date.now() - first;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
}

function detectQuestSignals(userMessage: string, agentResponse: string): string[] {
  const joined = `${userMessage}\n${agentResponse}`.toLowerCase();
  const signals: string[] = [];
  if (joined.includes('meditations') && (joined.includes('passage') || joined.includes('book '))) {
    signals.push('meditations_passage_discussed');
  }
  return uniq(signals);
}

function getSessionStartHourLocal(history: ConversationTurn[]): number | null {
  const timestamps = history
    .map((turn) => Date.parse(turn.timestamp))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return null;
  const first = new Date(Math.min(...timestamps));
  const hour = first.getHours();
  return Number.isFinite(hour) ? hour : null;
}

function confidenceLevelToReasoningScore(level: GroundingConfidenceLevel): number {
  switch (level) {
    case 'high':
      return 0.8;
    case 'medium':
      return 0.65;
    default:
      return 0.45;
  }
}

const questEngine = new QuestEngine();
const reasoningEvaluator = new ReasoningEvaluator();

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
      let closeHandled = false;
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
        const progressSnapshot = await getProgress(uid);
        const activeQuestSeeds = ALL_QUESTS
          .filter((quest) => progressSnapshot.activeQuestIds.includes(quest.id) && quest.dialogueSeed)
          .map((quest) => `${quest.title}: ${quest.dialogueSeed}`);
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
        const turnIndex = Math.max(0, fullHistory.length - 1);
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
          const crisisRunId = crypto.randomUUID();
          const crisisTs = new Date().toISOString();
          await appendStoaStateEvents({
            sessionId,
            userId: uid,
            events: createStoaTurnDigestEvents({
              id: crypto.randomUUID(),
              ts: crisisTs,
              run_id: crisisRunId,
              user_turn_digest_cell_id: `stoa-digest-${turnIndex}`,
              user_turn_digest: redactStoaUserTurnDigest(message)
            })
          });
          await recordStoaTelemetry({
            uid,
            sessionId,
            route: '/api/stoa/dialogue',
            groundingMode: 'degraded_none',
            escalated: false,
            errorTaxonomy: 'crisis_hard_stop'
          });
          closeHandled = true;
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
        const questGuidance =
          activeQuestSeeds.length > 0
            ? `\n\nActive quest guidance (weave naturally, no announcement):\n${activeQuestSeeds.join('\n')}`
            : '';
        const userPrompt = buildStoaUserPrompt({
          message,
          history,
          sources: sourceClaims
        }) + questGuidance;

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

        const stoaRunId = crypto.randomUUID();
        const stoaTs = new Date().toISOString();
        const stateEvents: StateEvent[] = createStoaTurnDigestEvents({
          id: crypto.randomUUID(),
          ts: stoaTs,
          run_id: stoaRunId,
          user_turn_digest_cell_id: `stoa-digest-${turnIndex}`,
          user_turn_digest: redactStoaUserTurnDigest(message)
        });
        if (escalated && escalationResult?.analysis?.trim()) {
          stateEvents.push(
            createStoaHistorySummarizationEvent({
              id: crypto.randomUUID(),
              ts: new Date().toISOString(),
              run_id: stoaRunId,
              remove_cell_ids: Array.from({ length: turnIndex }, (_, i) => `stoa-digest-${i}`),
              summary_cell_id: `stoa-escalation-summary-${turnIndex}`,
              summary_text: redactStoaUserTurnDigest(escalationResult.analysis),
              pinned: true
            })
          );
        }
        await appendStoaStateEvents({ sessionId, userId: uid, events: stateEvents });

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

        const runQuestEvaluation = async (reasoningScore: number, frameworksUsed: string[]): Promise<void> => {
          if (!uid) return;

          try {
            const journalEntries = await listJournalEntries({ userId: uid, limit: 100 });
            const progressBefore = await getProgress(uid);
            const finalizedHistory = [...fullHistory, agentTurn];
            const questContext: QuestContext = {
              sessionId,
              turnIndex,
              frameworksUsed: uniq(frameworksUsed),
              reasoningScore,
              daysElapsed: computeDaysElapsed(finalizedHistory),
              journalCount: journalEntries.length,
              stance: stanceDecision.stance,
              manualSignals: detectQuestSignals(message, finalResponse),
              sessionStartHourLocal: getSessionStartHourLocal(finalizedHistory)
            };

            const completedQuests = await questEngine.evaluateCompletions(uid, questContext);
            for (const quest of completedQuests) {
              await questEngine.awardCompletion(uid, quest);
            }

            const newlyAvailableQuests = await questEngine.evaluateTriggers(uid, questContext);
            const progressAfter = await getProgress(uid);
            const xpGained = Math.max(0, progressAfter.xp - progressBefore.xp);
            const newUnlocks = progressAfter.unlockedThinkers.filter(
              (thinkerId) => !progressBefore.unlockedThinkers.includes(thinkerId)
            );
            const questsCompleted = completedQuests.map((quest) => quest.id);
            const questsActivated = newlyAvailableQuests.map((quest) => quest.id);

            if (xpGained > 0 || newUnlocks.length > 0 || questsCompleted.length > 0 || questsActivated.length > 0) {
              sendSse(controller, {
                type: 'progress_update',
                xpGained,
                newUnlocks,
                questsCompleted,
                questsActivated
              });
            }

            await logger.info('[STOA] Quest evaluation completed after dialogue response', {
              route: '/api/stoa/dialogue',
              userId: uid,
              sessionId,
              turnIndex,
              reasoningScore,
              frameworksUsed: uniq(frameworksUsed),
              questsCompleted,
              newlyAvailableQuests: newlyAvailableQuests.map((quest) => quest.id),
              xpGained,
              newUnlocks
            });
          } catch (error) {
            await logger.error('[STOA] Quest evaluation failed after dialogue response', {
              route: '/api/stoa/dialogue',
              userId: uid,
              sessionId,
              turnIndex,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        };

        const runReasoningAssessment = async (): Promise<void> => {
          try {
            const assessment = await reasoningEvaluator.assess({
              sessionId,
              userId: uid,
              turnIndex,
              userMessage: userTurn.content,
              agentResponse: finalResponse,
              frameworksReferenced: uniq(frameworksReferenced),
              conversationHistory: [...fullHistory, agentTurn]
            });
            if (!assessment) return;

            const trend = await getReasoningTrend(uid, 10);
            if (assessment.qualityScore > 0.6 && trend.isImproving) {
              sendSse(controller, {
                type: 'reasoning_assessed',
                assessment: {
                  ...assessment,
                  improvementDetected: trend.isImproving
                }
              });
            }

            await runQuestEvaluation(
              assessment.qualityScore,
              assessment.frameworksApplied.length > 0
                ? assessment.frameworksApplied
                : uniq(frameworksReferenced)
            );
          } catch (error) {
            await logger.error('[STOA] Reasoning assessment failed after dialogue response', {
              route: '/api/stoa/dialogue',
              userId: uid,
              sessionId,
              turnIndex,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        };

        const baselineQuestEvaluation = runQuestEvaluation(
          confidenceLevelToReasoningScore(citationQuality.overall),
          uniq(frameworksReferenced)
        );
        const reasoningAssessmentEvaluation = runReasoningAssessment();
        // Defer stream close to background work; skip outer `finally` close to avoid double-close.
        closeHandled = true;
        void Promise.allSettled([baselineQuestEvaluation, reasoningAssessmentEvaluation]).finally(() => {
          controller.close();
        });
        return;
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
        if (!closeHandled) {
          controller.close();
        }
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

