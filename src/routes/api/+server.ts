export async function POST({ request }) {
  try {
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'Query required' }), { status: 400 });
    }

    // Import here to avoid module loading issues
    const { analyzePhilosophical } = await import('$lib/server/claude');
    const { getEthicsContext } = await import('$lib/server/ethics-context');

    const context = getEthicsContext();
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // PASS 1: Analysis
          for await (const chunk of analyzePhilosophical(query, context, 1)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ pass: 'analysis', chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: {"pass":"analysis","done":true}\n\n'));

          // PASS 2: Critique
          for await (const chunk of analyzePhilosophical(query, context, 2)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ pass: 'critique', chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: {"pass":"critique","done":true}\n\n'));

          // PASS 3: Synthesis
          for await (const chunk of analyzePhilosophical(query, context, 3)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ pass: 'synthesis', chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: {"pass":"synthesis","done":true}\n\n'));
          controller.enqueue(encoder.encode('data: {"complete":true}\n\n'));
          controller.close();
        } catch (err) {
          console.error('Error:', err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
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
    console.error('Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
}
