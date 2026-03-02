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
        const startTime = Date.now();
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        try {
          // PASS 1: Analysis
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pass_start', pass: 'analysis' })}\n\n`));
          for await (const chunk of analyzePhilosophical(query, context, 1)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pass_chunk', pass: 'analysis', content: chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pass_complete', pass: 'analysis' })}\n\n`));

          // PASS 2: Critique
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pass_start', pass: 'critique' })}\n\n`));
          for await (const chunk of analyzePhilosophical(query, context, 2)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pass_chunk', pass: 'critique', content: chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pass_complete', pass: 'critique' })}\n\n`));

          // PASS 3: Synthesis
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pass_start', pass: 'synthesis' })}\n\n`));
          for await (const chunk of analyzePhilosophical(query, context, 3)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pass_chunk', pass: 'synthesis', content: chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'pass_complete', pass: 'synthesis' })}\n\n`));

          // Send metadata
          const duration = Date.now() - startTime;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'metadata', 
            total_input_tokens: totalInputTokens, 
            total_output_tokens: totalOutputTokens, 
            duration_ms: duration 
          })}\n\n`));
          
          controller.close();
        } catch (err) {
          console.error('Error:', err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`));
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
