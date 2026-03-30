import type { RequestHandler } from './$types';
import { streamText } from 'ai';
import { loadInquiryEffectiveProviderApiKeys } from '$lib/server/byok/effectiveKeys';
import { resolveReasoningModelRoute } from '$lib/server/vertex';
import { appendStoaTurns, loadStoaSession } from '$lib/server/stoa/sessionStore';
import { retrieveStoaGrounding } from '$lib/server/stoa/grounding';
import { detectCrisisRisk, detectSuppressionMisuse, buildCrisisSupportMessage } from '$lib/server/stoa/safety';
import { detectStance } from '$lib/server/stoa/stance';
import { buildStoaSystemPrompt, buildStoaUserPrompt } from '$lib/server/stoa/prompt';
import { runDeepEscalationAnalysis, shouldEscalateToDeepAnalysis } from '$lib/server/stoa/escalation';
import type { ConversationTurn, DialogueRequest } from '$lib/server/stoa/types';

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
        const storedSession = await loadStoaSession({ sessionId, userId: uid });
        const requestHistory = normalizeHistory(body.history);
        const history = storedSession.turns.length > 0 ? storedSession.turns : requestHistory;
        const userTurn: ConversationTurn = {
          role: 'user',
          content: message,
          timestamp: new Date().toISOString()
        };
        const fullHistory = [...history, userTurn];

        if (detectCrisisRisk(message)) {
          const response = buildCrisisSupportMessage();
          const agentTurn: ConversationTurn = {
            role: 'agent',
            content: response,
            timestamp: new Date().toISOString(),
            stance: 'hold'
          };
          sendSse(controller, { type: 'start' });
          sendSse(controller, { type: 'metadata', stance: 'hold', escalated: false, sourceClaims: [] });
          sendSse(controller, { type: 'delta', text: response });
          sendSse(controller, { type: 'complete', response, stance: 'hold', frameworksReferenced: [] });
          await appendStoaTurns({ sessionId, userId: uid, turns: [userTurn, agentTurn] });
          controller.close();
          return;
        }

        const stanceDecision = detectStance({ message, history });
        const suppressionMisuse = detectSuppressionMisuse(message);
        const sourceClaims = await retrieveStoaGrounding({ message, history: fullHistory, topK: 5 });
        const systemPrompt = buildStoaSystemPrompt({
          stance: stanceDecision.stance,
          sources: sourceClaims,
          askClarifyingQuestion: stanceDecision.askClarifyingQuestion,
          suppressionMisuse
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

        const escalated = shouldEscalateToDeepAnalysis({ message, history });

        sendSse(controller, {
          type: 'metadata',
          stance: stanceDecision.stance,
          stanceConfidence: stanceDecision.confidence,
          stanceReason: stanceDecision.reason,
          sourceClaims,
          escalated
        });
        if (escalated) {
          sendSse(controller, {
            type: 'escalation_started',
            mode: 'deep',
            note: 'Running deep escalation pass.'
          });
        }
        sendSse(controller, { type: 'start' });

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
        const frameworksReferenced = Array.from(
          new Set(
            sourceClaims
              .filter((claim) =>
                responseText.toLowerCase().includes(claim.sourceText.slice(0, 24).toLowerCase())
              )
              .map((claim) => claim.claimId)
          )
        );

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
          summary: null
        });

        sendSse(controller, {
          type: 'complete',
          response: finalResponse,
          stance: stanceDecision.stance,
          frameworksReferenced,
          sourceClaims,
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
      } catch (error) {
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

