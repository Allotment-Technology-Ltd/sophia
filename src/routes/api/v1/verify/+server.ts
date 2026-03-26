import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyApiKey } from '$lib/server/apiAuth';
import { mergeOwnerEnvFallbackIfEmpty } from '$lib/server/byok/effectiveKeys';
import { loadByokProviderApiKeys } from '$lib/server/byok/store';
import { resolveByokOwnerUid } from '$lib/server/byok/tenantIdentity';
import type { ProviderApiKeys } from '$lib/server/byok/types';
import {
  runVerificationPipeline
} from '$lib/server/verification/pipeline';
import {
  VerificationRequestSchema,
  type VerificationRequest,
  type VerificationResult
} from '@restormel/contracts/verification';
import type { GraphEdge, GraphNode, GroundingSource, PassSection } from '@restormel/contracts/api';
import type { Claim, RelationBundle, SourceReference } from '@restormel/contracts/references';
import type { ReasoningEvent } from '@restormel/contracts/trace';
import { serializeReasoningEvent } from '@restormel/observability';
import { problemJson, resolveRequestId } from '$lib/server/problem';
import { logServerAnalytics } from '$lib/server/analytics';

function buildHeaders(requestId: string, processingTimeMs: number, tokenUsage?: string): HeadersInit {
  return {
    'X-Request-Id': requestId,
    'X-Processing-Time-Ms': String(processingTimeMs),
    ...(tokenUsage ? { 'X-Token-Usage': tokenUsage } : {})
  };
}

function buildVerificationResult(
  requestId: string,
  processingTimeMs: number,
  pipeline: Awaited<ReturnType<typeof runVerificationPipeline>>
): VerificationResult {
  return {
    request_id: requestId,
    extracted_claims: pipeline.extracted_claims,
    logical_relations: pipeline.logical_relations,
    reasoning_quality: pipeline.reasoning_quality,
    constitutional_check: pipeline.constitutional_check,
    pass_outputs: pipeline.pass_outputs,
    metadata: {
      processing_time_ms: processingTimeMs,
      constitution_duration_ms: pipeline.constitution_duration_ms,
      constitution_input_tokens: pipeline.constitution_input_tokens,
      constitution_output_tokens: pipeline.constitution_output_tokens,
      constitution_rule_violations: pipeline.constitution_rule_violations,
      input_length: pipeline.inputText.length,
      model: pipeline.reasoning_model?.modelId ?? 'unknown',
      retrieval: pipeline.retrieval,
      tokens_used: {
        extraction_input: pipeline.extraction_input_tokens,
        extraction_output: pipeline.extraction_output_tokens
      }
    }
  };
}

export const POST: RequestHandler = async ({ request }) => {
  const requestId = resolveRequestId(request);
  const startedAt = Date.now();
  const acceptsStream = request.headers.get('accept')?.includes('text/event-stream') ?? false;

  await logServerAnalytics({
    event: 'developer_playground_request_start',
    request_id: requestId,
    route: '/api/v1/verify',
    mode: acceptsStream ? 'sse' : 'json'
  });

  const auth = await verifyApiKey(request);
  if (!auth.valid) {
    const status = auth.error === 'rate_limited' ? 429 : 401;

    if (auth.error === 'rate_limited') {
      await logServerAnalytics({
        event: 'developer_verify_429',
        request_id: requestId,
        key_id: auth.key_id,
        route: '/api/v1/verify',
        success: false,
        status
      });
    }

    await logServerAnalytics({
      event: 'developer_playground_request_error',
      request_id: requestId,
      key_id: auth.key_id,
      route: '/api/v1/verify',
      success: false,
      status,
      error_code: auth.error ?? 'invalid_api_key',
      latency_ms: Date.now() - startedAt
    });

    return problemJson({
      status,
      title: status === 429 ? 'Rate limit exceeded' : 'Authentication failed',
      detail: `API key ${auth.error ?? 'invalid_api_key'}.`,
      type: `https://docs.usesophia.app/problems/${auth.error ?? 'invalid_api_key'}`,
      requestId,
      headers: {
        ...buildHeaders(requestId, Date.now() - startedAt),
        ...(status === 429 ? { 'Retry-After': '86400' } : {})
      }
    });
  }

  let parsedRequest: VerificationRequest;
  try {
    const body = await request.json();
    parsedRequest = VerificationRequestSchema.parse(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    await logServerAnalytics({
      event: 'developer_playground_request_error',
      request_id: requestId,
      key_id: auth.key_id,
      route: '/api/v1/verify',
      success: false,
      status: 400,
      latency_ms: Date.now() - startedAt,
      error_code: 'invalid_request'
    });
    return problemJson({
      status: 400,
      title: 'Invalid request',
      detail: message,
      type: 'https://docs.usesophia.app/problems/invalid-request',
      requestId,
      headers: buildHeaders(requestId, Date.now() - startedAt)
    });
  }

  const tenantIdentity = resolveByokOwnerUid(request, auth.owner_uid);
  let providerApiKeys: ProviderApiKeys = {};
  if (tenantIdentity.ownerUid) {
    try {
      providerApiKeys = await loadByokProviderApiKeys(tenantIdentity.ownerUid);
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[BYOK] Unable to load provider keys for verify request:', error instanceof Error ? error.message : String(error));
      }
    }
  }
  providerApiKeys = await mergeOwnerEnvFallbackIfEmpty(providerApiKeys, 'v1 verify');

  if (!acceptsStream) {
    try {
      const pipeline = await runVerificationPipeline(parsedRequest, {
        includePassOutputs: true,
        providerApiKeys
      });
      const processingTimeMs = Date.now() - startedAt;
      const response = buildVerificationResult(
        requestId,
        processingTimeMs,
        pipeline
      );

      await logServerAnalytics({
        event: 'developer_playground_request_success',
        request_id: requestId,
        key_id: auth.key_id,
        route: '/api/v1/verify',
        success: true,
        status: 200,
        mode: 'json',
        latency_ms: processingTimeMs
      });

      return json(response, {
        headers: buildHeaders(
          requestId,
          processingTimeMs,
          `${pipeline.extraction_input_tokens}:${pipeline.extraction_output_tokens}`
        )
      });
    } catch (error) {
      await logServerAnalytics({
        event: 'developer_playground_request_error',
        request_id: requestId,
        key_id: auth.key_id,
        route: '/api/v1/verify',
        success: false,
        status: 500,
        mode: 'json',
        latency_ms: Date.now() - startedAt,
        error_code: 'internal_error'
      });

      return problemJson({
        status: 500,
        title: 'Internal server error',
        detail: error instanceof Error ? error.message : String(error),
        type: 'https://docs.usesophia.app/problems/internal-error',
        requestId,
        headers: buildHeaders(requestId, Date.now() - startedAt)
      });
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (event: ReasoningEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(serializeReasoningEvent(event)));
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
        const pipeline = await runVerificationPipeline(parsedRequest, {
          includePassOutputs: true,
          providerApiKeys,
          callbacks: {
            onPassStart(pass) {
              send({ type: 'pass_start', pass });
            },
            onPassChunk(pass, content) {
              send({ type: 'pass_chunk', pass, content });
            },
            onPassComplete(pass) {
              send({ type: 'pass_complete', pass });
            },
            onPassStructured(pass, sections, wordCount) {
              send({
                type: 'pass_structured',
                pass,
                sections: sections as PassSection[],
                wordCount
              });
            },
            onSources(sources) {
              send({ type: 'sources', sources: sources as SourceReference[] });
            },
            onGroundingSources(pass, sources) {
              send({
                type: 'grounding_sources',
                pass,
                sources: sources as GroundingSource[]
              });
            },
            onGraphSnapshot(nodes, edges) {
              send({
                type: 'graph_snapshot',
                nodes: nodes as GraphNode[],
                edges: edges as GraphEdge[]
              } as ReasoningEvent);
            },
            onClaims(pass, claims, relations) {
              send({
                type: 'claims',
                pass: pass as 'analysis' | 'critique' | 'synthesis',
                claims: claims as Claim[]
              } as ReasoningEvent);
              send({
                type: 'relations',
                pass: pass as 'analysis' | 'critique' | 'synthesis',
                relations: relations as RelationBundle[]
              } as ReasoningEvent);
            },
            onConfidenceSummary(avgConfidence, lowConfidenceCount, totalClaims) {
              send({ type: 'confidence_summary', avgConfidence, lowConfidenceCount, totalClaims });
            },
            onMetadata(totalInputTokens, totalOutputTokens, durationMs, retrieval) {
              send({
                type: 'metadata',
                total_input_tokens: totalInputTokens,
                total_output_tokens: totalOutputTokens,
                duration_ms: durationMs,
                ...(retrieval ?? {})
              });
            },
            onExtractionComplete(payload) {
              send({
                type: 'extraction_complete',
                claims: payload.claims,
                relations: payload.relations,
                metadata: payload.metadata
              });
            },
            onReasoningScores(reasoningQuality) {
              send({ type: 'reasoning_scores', reasoning_quality: reasoningQuality });
            },
            onConstitutionCheck(constitutionalCheck) {
              send({ type: 'constitution_check', constitutional_check: constitutionalCheck });
            }
          }
        });

        const processingTimeMs = Date.now() - startedAt;
        const result = buildVerificationResult(
          requestId,
          processingTimeMs,
          pipeline
        );
        send({ type: 'verification_complete', result });

        await logServerAnalytics({
          event: 'developer_playground_request_success',
          request_id: requestId,
          key_id: auth.key_id,
          route: '/api/v1/verify',
          success: true,
          status: 200,
          mode: 'sse',
          latency_ms: processingTimeMs
        });
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        await logServerAnalytics({
          event: 'developer_playground_request_error',
          request_id: requestId,
          key_id: auth.key_id,
          route: '/api/v1/verify',
          success: false,
          status: 500,
          mode: 'sse',
          latency_ms: Date.now() - startedAt,
          error_code: 'stream_error'
        });
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
