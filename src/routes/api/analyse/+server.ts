import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runDialecticalEngine } from '$lib/server/engine';
import type { SSEEvent } from '$lib/types/api';
import { createHash } from 'node:crypto';
import { query as dbQuery } from '$lib/server/db';

function buildQueryHash(query: string, lens?: string): string {
  const normalized = query.trim().toLowerCase();
  const lensKey = (lens || '').trim().toLowerCase();
  return createHash('sha256').update(`${normalized}::${lensKey}`).digest('hex');
}

type QueryCacheRow = {
  query_hash: string;
  query_text: string;
  lens?: string;
  events: SSEEvent[];
  created_at?: string;
  expires_at?: string;
  hit_count?: number;
};

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

  const queryText = query.trim();
  const queryHash = buildQueryHash(queryText, lens);

  let cachedEvents: SSEEvent[] | null = null;
  let cacheHit = false;
  try {
    const cached = await dbQuery<QueryCacheRow[]>(
      `SELECT * FROM query_cache WHERE query_hash = $query_hash LIMIT 1`,
      { query_hash: queryHash }
    );
    if (Array.isArray(cached) && cached.length > 0) {
      const row = cached[0];
      if (row.expires_at) {
        const expiresAt = new Date(row.expires_at);
        if (expiresAt < new Date()) {
          console.log('[CACHE] Expired entry, cache miss forced');
          cachedEvents = null;
        } else if (Array.isArray(row.events)) {
          cachedEvents = row.events;
          cacheHit = true;
          await dbQuery(
            `UPDATE query_cache SET hit_count = (hit_count ?? 0) + 1 WHERE query_hash = $query_hash`,
            { query_hash: queryHash }
          );
        }
      } else if (Array.isArray(row.events)) {
        // fallback for entries without expires_at
        cachedEvents = row.events;
        cacheHit = true;
        await dbQuery(
          `UPDATE query_cache SET hit_count = (hit_count ?? 0) + 1 WHERE query_hash = $query_hash`,
          { query_hash: queryHash }
        );
      }
    }
  } catch (err) {
    console.warn('[CACHE] Read failed:', err instanceof Error ? err.message : String(err));
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: SSEEvent): void {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      // Replay cached events if available
      if (cachedEvents) {
        for (const event of cachedEvents) {
          sendEvent(event);
        }
        controller.close();
        return;
      }

      // Cache miss: run the engine and collect events
      const replayEvents: SSEEvent[] = [];

      const sendEventWithCapture = (event: SSEEvent): void => {
        replayEvents.push(event);
        sendEvent(event);
      };

      try {
        await runDialecticalEngine(queryText, {
          onPassStart(pass) {
            sendEventWithCapture({ type: 'pass_start', pass });
          },
          onPassChunk(pass, content) {
            sendEventWithCapture({ type: 'pass_chunk', pass, content });
          },
          onPassComplete(pass) {
            sendEventWithCapture({ type: 'pass_complete', pass });
          },
          onPassStructured(pass, sections, wordCount) {
            sendEventWithCapture({ type: 'pass_structured', pass, sections, wordCount });
          },
          onSources(sources) {
            sendEventWithCapture({ type: 'sources', sources });
          },
          onGraphSnapshot(nodes, edges) {
            sendEventWithCapture({ type: 'graph_snapshot', nodes, edges });
          },
          onClaims(pass, claims, relations) {
            sendEventWithCapture({ type: 'claims', pass, claims });
            sendEventWithCapture({ type: 'relations', pass, relations });
          },
          onConfidenceSummary(avgConfidence, lowConfidenceCount, totalClaims) {
            sendEventWithCapture({
              type: 'confidence_summary',
              avgConfidence,
              lowConfidenceCount,
              totalClaims
            });
          },
          onMetadata(totalInputTokens, totalOutputTokens, durationMs, retrieval) {
            sendEventWithCapture({
              type: 'metadata',
              total_input_tokens: totalInputTokens,
              total_output_tokens: totalOutputTokens,
              duration_ms: durationMs,
              ...(retrieval
                ? {
                    claims_retrieved: retrieval.claims_retrieved,
                    arguments_retrieved: retrieval.arguments_retrieved,
                    retrieval_degraded: retrieval.retrieval_degraded,
                    retrieval_degraded_reason: retrieval.retrieval_degraded_reason
                  }
                : {})
            });
          },
          onError(error) {
            sendEventWithCapture({ type: 'error', message: error });
          }
        }, { lens });

        // Persist cache after successful run
        try {
          await dbQuery(`DELETE query_cache WHERE query_hash = $query_hash`, { query_hash: queryHash });
          await dbQuery(
            `CREATE query_cache CONTENT {
              query_hash: $query_hash,
              query_text: $query_text,
              lens: $lens,
              events: $events,
              hit_count: 0,
              created_at: time::now()
            }`,
            { query_hash: queryHash, query_text: queryText, lens: lens ?? null, events: replayEvents }
          );
        } catch (err) {
          console.warn('[CACHE] Write failed:', err instanceof Error ? err.message : String(err));
        }
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
      'Connection': 'keep-alive',
      'X-Cache': cacheHit ? 'HIT' : 'MISS'
    }
  });
};
