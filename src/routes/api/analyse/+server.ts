import { json, error as httpError } from '@sveltejs/kit';
import { analyzePhilosophical } from '$lib/server/claude';
import { getEthicsContext } from '$lib/server/ethics-context';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string') {
      return httpError(400, 'Query is required and must be a string');
    }

    const context = getEthicsContext();
    const encoder = new TextEncoder();
    let controller: ReadableStreamController<Uint8Array>;

    const readable = new ReadableStream<Uint8Array>({
      async start(c) {
        controller = c;

        try {
          // PASS 1: Analysis
          let analysisText = '';
          for await (const chunk of analyzePhilosophical(query, context, 1)) {
            analysisText += chunk;
            controller.enqueue(
              encoder.encode(\`data: \${JSON.stringify({ pass: 'analysis', chunk })}\n\n\`)
            );
          }
          controller.enqueue(encoder.encode('data: {"pass":"analysis","done":true}\n\n'));

          // PASS 2: Critique
          let critiqueText = '';
          for await (const chunk of analyzePhilosophical(query, context, 2)) {
            critiqueText += chunk;
            controller.enqueue(
              encoder.encode(\`data: \${JSON.stringify({ pass: 'critique', chunk })}\n\n\`)
            );
          }
          controller.enqueue(encoder.encode('data: {"pass":"critique","done":true}\n\n'));

          // PASS 3: Synthesis
          let synthesisText = '';
          for await (const chunk of analyzePhilosophical(query, context, 3)) {
            synthesisText += chunk;
            controller.enqueue(
              encoder.encode(\`data: \${JSON.stringify({ pass: 'synthesis', chunk })}\n\n\`)
            );
          }
          controller.enqueue(encoder.encode('data: {"pass":"synthesis","done":true}\n\n'));
          controller.enqueue(encoder.encode('data: {"complete":true}\n\n'));
          controller.close();
        } catch (err) {
          console.error('Error during analysis:', err);
          controller.enqueue(
            encoder.encode(\`data: \${JSON.stringify({ error: String(err) })}\n\n\`)
          );
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });
  } catch (err) {
    console.error('Error parsing request:', err);
    return httpError(500, 'Internal server error');
  }
};
