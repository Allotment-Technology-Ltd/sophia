import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { verifyApiKey } from '$lib/server/apiAuth';
import { runDomainAgnosticReasoning } from '$lib/server/reasoningEngine';
import { extractClaims } from '$lib/server/extraction';
import { evaluateReasoning } from '$lib/server/reasoningEval';
import {
  VerificationRequestSchema,
  type VerificationRequest,
  type VerificationResult
} from '$lib/types/verification';
import type { SSEEvent } from '$lib/types/api';
import type { PassType } from '$lib/types/passes';

interface VerifySseEvent {
  type:
    | SSEEvent['type']
    | 'extraction_complete'
    | 'reasoning_scores'
    | 'verification_complete'
    | 'error';
  [key: string]: unknown;
}

function buildInputText(request: VerificationRequest): string {
  return [request.question, request.answer, request.text].filter(Boolean).join('\n\n');
}

function buildHeaders(requestId: string, processingTimeMs: number, tokenUsage?: string): HeadersInit {
  return {
    'X-Request-Id': requestId,
    'X-Processing-Time-Ms': String(processingTimeMs),
    ...(tokenUsage ? { 'X-Token-Usage': tokenUsage } : {})
  };
}

export const POST: RequestHandler = async ({ request }) => {
  const requestId = randomUUID();
  const startedAt = Date.now();

  const auth = await verifyApiKey(request);
  if (!auth.valid) {
    return json(
      { error: auth.error ?? 'invalid_api_key' },
      {
        status: auth.error === 'rate_limited' ? 429 : 401,
        headers: buildHeaders(requestId, Date.now() - startedAt)
      }
    );
  }

  let parsedRequest: VerificationRequest;
  try {
    const body = await request.json();
    parsedRequest = VerificationRequestSchema.parse(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    return json(
      { error: message },
      {
        status: 400,
        headers: buildHeaders(requestId, Date.now() - startedAt)
      }
    );
  }

  const acceptsStream = request.headers.get('accept')?.includes('text/event-stream') ?? false;

  if (!acceptsStream) {
    try {
      const inputText = buildInputText(parsedRequest);
      const passOutputs: Partial<Record<PassType, string>> = {};
      let retrievalMeta: VerificationResult['metadata']['retrieval'];

      await runDomainAgnosticReasoning(inputText, {
        onPassStart() {
          // no-op for JSON mode
        },
        onPassChunk(pass, content) {
          if (pass !== 'verification') {
            passOutputs[pass] = `${passOutputs[pass] ?? ''}${content}`;
          }
        },
        onPassComplete() {
          // no-op
        },
        onPassStructured() {
          // no-op
        },
        onSources() {
          // no-op
        },
        onGroundingSources() {
          // no-op
        },
        onGraphSnapshot() {
          // no-op
        },
        onClaims() {
          // no-op
        },
        onConfidenceSummary() {
          // no-op
        },
        onMetadata(_inputTokens, _outputTokens, _durationMs, retrieval) {
          retrievalMeta = retrieval;
        },
        onError(error) {
          throw new Error(error);
        }
      });

      const extraction = await extractClaims(parsedRequest);
      const reasoningQuality = await evaluateReasoning(extraction.claims, extraction.relations, parsedRequest);

      const processingTimeMs = Date.now() - startedAt;
      const tokenUsage = `${extraction.metadata.tokens_used.input}:${extraction.metadata.tokens_used.output}`;

      const response: VerificationResult = {
        request_id: requestId,
        extracted_claims: extraction.claims,
        logical_relations: extraction.relations,
        reasoning_quality: reasoningQuality,
        pass_outputs: {
          analysis: passOutputs.analysis,
          critique: passOutputs.critique,
          synthesis: passOutputs.synthesis
        },
        metadata: {
          processing_time_ms: processingTimeMs,
          input_length: buildInputText(parsedRequest).length,
          model: process.env.GEMINI_REASONING_MODEL || 'gemini-2.0-flash',
          retrieval: retrievalMeta,
          tokens_used: {
            extraction_input: extraction.metadata.tokens_used.input,
            extraction_output: extraction.metadata.tokens_used.output
          }
        }
      };

      return json(response, {
        headers: buildHeaders(requestId, processingTimeMs, tokenUsage)
      });
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        {
          status: 500,
          headers: buildHeaders(requestId, Date.now() - startedAt)
        }
      );
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const inputText = buildInputText(parsedRequest);
      const passOutputs: Partial<Record<PassType, string>> = {};
      let retrievalMeta: VerificationResult['metadata']['retrieval'];

      const send = (event: VerifySseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      try {
        await runDomainAgnosticReasoning(inputText, {
          onPassStart(pass) {
            send({ type: 'pass_start', pass });
          },
          onPassChunk(pass, content) {
            if (pass !== 'verification') {
              passOutputs[pass] = `${passOutputs[pass] ?? ''}${content}`;
            }
            send({ type: 'pass_chunk', pass, content });
          },
          onPassComplete(pass) {
            send({ type: 'pass_complete', pass });
          },
          onPassStructured(pass, sections, wordCount) {
            send({ type: 'pass_structured', pass, sections, wordCount });
          },
          onSources(sources) {
            send({ type: 'sources', sources });
          },
          onGroundingSources(pass, sources) {
            send({ type: 'grounding_sources', pass, sources });
          },
          onGraphSnapshot(nodes, edges) {
            send({ type: 'graph_snapshot', nodes, edges });
          },
          onClaims(pass, claims, relations) {
            send({ type: 'claims', pass, claims });
            send({ type: 'relations', pass, relations });
          },
          onConfidenceSummary(avgConfidence, lowConfidenceCount, totalClaims) {
            send({ type: 'confidence_summary', avgConfidence, lowConfidenceCount, totalClaims });
          },
          onMetadata(totalInputTokens, totalOutputTokens, durationMs, retrieval) {
            retrievalMeta = retrieval;
            send({
              type: 'metadata',
              total_input_tokens: totalInputTokens,
              total_output_tokens: totalOutputTokens,
              duration_ms: durationMs,
              ...(retrieval ?? {})
            });
          },
          onError(error) {
            send({ type: 'error', message: error });
          }
        });

        const extraction = await extractClaims(parsedRequest);
        send({
          type: 'extraction_complete',
          claims: extraction.claims,
          relations: extraction.relations,
          metadata: extraction.metadata
        });

        const reasoningQuality = await evaluateReasoning(extraction.claims, extraction.relations, parsedRequest);
        send({ type: 'reasoning_scores', reasoning_quality: reasoningQuality });

        const processingTimeMs = Date.now() - startedAt;
        const result: VerificationResult = {
          request_id: requestId,
          extracted_claims: extraction.claims,
          logical_relations: extraction.relations,
          reasoning_quality: reasoningQuality,
          pass_outputs: {
            analysis: passOutputs.analysis,
            critique: passOutputs.critique,
            synthesis: passOutputs.synthesis
          },
          metadata: {
            processing_time_ms: processingTimeMs,
            input_length: inputText.length,
            model: process.env.GEMINI_REASONING_MODEL || 'gemini-2.0-flash',
            retrieval: retrievalMeta,
            tokens_used: {
              extraction_input: extraction.metadata.tokens_used.input,
              extraction_output: extraction.metadata.tokens_used.output
            }
          }
        };

        send({ type: 'verification_complete', result });
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      } finally {
        close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      ...buildHeaders(requestId, 0),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
};
