import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runVerificationPass } from '$lib/server/engine';
import type { Claim } from '$lib/types/references';

interface VerifyRequest {
  claims: Claim[];
  synthesisText: string;
}

export const POST: RequestHandler = async ({ request }) => {
  let body: VerifyRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { claims, synthesisText } = body;

  if (!claims || !Array.isArray(claims)) {
    return json({ error: 'Claims array is required' }, { status: 400 });
  }

  if (!synthesisText || typeof synthesisText !== 'string') {
    return json({ error: 'Synthesis text is required' }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(type: string, data: any): void {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
      }

      try {
        sendEvent('verification_start', {});

        const result = await runVerificationPass(claims, synthesisText, {
          onPassStart() {
            // Not used in verification context
          },
          onPassChunk(_pass, content) {
            sendEvent('verification_chunk', { content });
          },
          onPassComplete() {
            // Not used in verification context
          },
          onPassStructured() {
            // Not used in verification context
          },
          onGraphSnapshot() {
            // Not used in verification context
          },
          onSources() {
            // Not used in verification context
          },
          onClaims() {
            // Not used in verification context
          },
          onMetadata() {
            // Not used in verification context
          },
          onError(error) {
            sendEvent('error', { message: error });
          }
        });

        sendEvent('verification_complete', {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens
        });
      } catch (err) {
        sendEvent('error', {
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
