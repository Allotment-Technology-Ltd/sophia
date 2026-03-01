import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runDialecticalEngine } from '$lib/server/engine';
import type { SSEEvent } from '$lib/types/api';

export const POST: RequestHandler = async ({ request }) => {
  let body: { query?: string; lens?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { query, lens } = body;

  if (!query || typeof query !== 'string' || !query.trim()) {
    return json({ error: 'Query is required and must be a non-empty string' }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: SSEEvent): void {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        await runDialecticalEngine(query.trim(), {
          onPassStart(pass) {
            sendEvent({ type: 'pass_start', pass });
          },
          onPassChunk(pass, content) {
            sendEvent({ type: 'pass_chunk', pass, content });
          },
          onPassComplete(pass) {
            sendEvent({ type: 'pass_complete', pass });
          },
          onClaims(pass, claims, relations) {
            sendEvent({ type: 'claims', pass, claims });
            sendEvent({ type: 'relations', pass, relations });
          },
          onMetadata(totalInputTokens, totalOutputTokens, durationMs, retrieval) {
            sendEvent({
              type: 'metadata',
              total_input_tokens: totalInputTokens,
              total_output_tokens: totalOutputTokens,
              duration_ms: durationMs,
              ...(retrieval ? { claims_retrieved: retrieval.claims_retrieved, arguments_retrieved: retrieval.arguments_retrieved } : {})
            });
          },
          onError(error) {
            sendEvent({ type: 'error', message: error });
          }
        }, { lens });
      } catch (err) {
        sendEvent({
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
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
      'Connection': 'keep-alive'
    }
  });
};
