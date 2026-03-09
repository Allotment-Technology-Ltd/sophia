import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runDialecticalEngine } from '$lib/server/engine';
import type { SSEEvent } from '$lib/types/api';
import { createHash } from 'node:crypto';
import { query as dbQuery } from '$lib/server/db';
import { adminDb } from '$lib/server/firebase-admin';

// Store only replay-relevant events — excludes high-volume pass_chunk events
const REPLAY_EVENT_TYPES = new Set([
  'pass_start', 'pass_structured', 'pass_complete',
  'sources', 'grounding_sources', 'claims', 'relations',
  'confidence_summary', 'metadata', 'graph_snapshot'
]);

const FIRESTORE_CACHE_TTL_DAYS = 30;

async function loadFirestoreCache(uid: string, queryHash: string): Promise<SSEEvent[] | null> {
  try {
    const snapshot = await adminDb
      .collection('users').doc(uid)
      .collection('queries')
      .where('queryHash', '==', queryHash)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const data = snapshot.docs[0].data();
    const createdAt: Date = data.createdAt?.toDate?.() ?? new Date(0);
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs > FIRESTORE_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) return null;
    return Array.isArray(data.events) ? (data.events as SSEEvent[]) : null;
  } catch (err) {
    console.warn('[FIRESTORE] Cache read failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function saveFirestoreCache(
  uid: string,
  queryHash: string,
  queryText: string,
  lens: string | undefined,
  events: SSEEvent[]
): Promise<void> {
  try {
    const storageEvents = events.filter((e) => REPLAY_EVENT_TYPES.has(e.type));
    await adminDb
      .collection('users').doc(uid)
      .collection('queries')
      .add({
        queryHash,
        query: queryText,
        lens: lens ?? null,
        events: storageEvents,
        createdAt: new Date()
      });
    console.log(`[FIRESTORE] Saved query for uid=${uid} hash=${queryHash.slice(0, 8)}`);
  } catch (err) {
    console.warn('[FIRESTORE] Cache write failed:', err instanceof Error ? err.message : String(err));
  }
}

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

export const POST: RequestHandler = async ({ request, locals }) => {
  // A2/A3: uid is guaranteed non-null here — hooks.server.ts already verified the Bearer token
  const uid = locals.user?.uid ?? null;

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

  // A5: Check Firestore (per-user) first
  if (uid) {
    const firestoreCached = await loadFirestoreCache(uid, queryHash);
    if (firestoreCached) {
      cachedEvents = firestoreCached;
      cacheHit = true;
      console.log(`[FIRESTORE] Cache HIT for uid=${uid} hash=${queryHash.slice(0, 8)}`);
    }
  }

  // Fall back to SurrealDB shared cache
  if (!cachedEvents) {
  try {
    const cached = await dbQuery<QueryCacheRow[]>(
      `SELECT * FROM query_cache WHERE query_hash = $query_hash LIMIT 1`,
      { query_hash: queryHash }
    );
    if (Array.isArray(cached) && cached.length > 0) {
      const row = cached[0];
      const hasErrorEvent = Array.isArray(row.events) && row.events.some((event) => event?.type === 'error');
      const hasMetadataEvent = Array.isArray(row.events) && row.events.some((event) => event?.type === 'metadata');

      if (hasErrorEvent || !hasMetadataEvent) {
        console.log('[CACHE] Ignoring stale failed/incomplete cached events');
        await dbQuery(`DELETE query_cache WHERE query_hash = $query_hash`, { query_hash: queryHash });
      }

      if (row.expires_at) {
        const expiresAt = new Date(row.expires_at);
        if (expiresAt < new Date()) {
          console.log('[CACHE] Expired entry, cache miss forced');
          cachedEvents = null;
        } else if (Array.isArray(row.events) && !hasErrorEvent && hasMetadataEvent) {
          cachedEvents = row.events;
          cacheHit = true;
          await dbQuery(
            `UPDATE query_cache SET hit_count = (hit_count ?? 0) + 1 WHERE query_hash = $query_hash`,
            { query_hash: queryHash }
          );
        }
      } else if (Array.isArray(row.events) && !hasErrorEvent && hasMetadataEvent) {
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
  } // end if (!cachedEvents)

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let controllerClosed = false;

      function sendEvent(event: SSEEvent): void {
        if (controllerClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch (err) {
          controllerClosed = true;
          console.warn('[SSE] enqueue failed (client disconnected):', err instanceof Error ? err.message : String(err));
        }
      }

      function closeController(): void {
        if (controllerClosed) return;
        controllerClosed = true;
        try {
          controller.close();
        } catch {
          // no-op
        }
      }

      // Replay cached events if available
      if (cachedEvents) {
        for (const event of cachedEvents) {
          sendEvent(event);
        }
        closeController();
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
          onGroundingSources(pass, sources) {
            sendEventWithCapture({ type: 'grounding_sources', pass, sources });
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
                    retrieval_degraded_reason: retrieval.retrieval_degraded_reason,
                    detected_domain: retrieval.detected_domain,
                    domain_confidence: retrieval.domain_confidence
                  }
                : {})
            });
          },
          onError(error) {
            sendEventWithCapture({ type: 'error', message: error });
          }
        }, { lens });

        // Persist cache only for successful runs (metadata present, no error event)
        const hasErrorEvent = replayEvents.some((event) => event.type === 'error');
        const hasMetadataEvent = replayEvents.some((event) => event.type === 'metadata');

        if (!hasErrorEvent && hasMetadataEvent) {
          // A4: Save to Firestore (per-user)
          if (uid) {
            await saveFirestoreCache(uid, queryHash, queryText, lens, replayEvents);
          }

          // Also save to SurrealDB shared cache (best-effort)
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
            console.warn('[CACHE] SurrealDB write failed:', err instanceof Error ? err.message : String(err));
          }
        } else {
          console.log('[CACHE] Skipping cache write for failed or incomplete run', { hasErrorEvent, hasMetadataEvent });
        }
      } catch (err) {
        sendEvent({
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
        });
      } finally {
        closeController();
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
