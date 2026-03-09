import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runDialecticalEngine } from '$lib/server/engine';
import type { SSEEvent } from '$lib/types/api';
import { createHash, randomUUID } from 'node:crypto';
import { query as dbQuery } from '$lib/server/db';
import { adminDb } from '$lib/server/firebase-admin';
import { runVerificationPipeline } from '$lib/server/verification/pipeline';
import { runDepthEnrichment } from '$lib/server/enrichment/pipeline';
import { recordSnapshotLineage } from '$lib/server/enrichment/store';
import type { AnalysisPhase, Claim, RelationBundle } from '$lib/types/references';
import type { GraphEdge, GraphNode, GraphSnapshotMeta } from '$lib/types/api';
import type { ExtractedClaim, ExtractedRelation, ReasoningEvaluation } from '$lib/types/verification';
import { evaluateReasoning } from '$lib/server/reasoningEval';
import { evaluateConstitutionWithTelemetry } from '$lib/server/constitution/evaluator';
import { getAvailableReasoningModels } from '$lib/server/vertex';

// Store only replay-relevant events — excludes high-volume pass_chunk events
const REPLAY_EVENT_TYPES = new Set([
  'pass_start', 'pass_structured', 'pass_complete',
  'sources', 'grounding_sources', 'claims', 'relations',
  'confidence_summary', 'metadata', 'graph_snapshot', 'constitution_check', 'enrichment_status',
  'reasoning_quality', 'constitution_delta'
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
  depthMode: 'quick' | 'standard' | 'deep',
  modelProvider: 'auto' | 'vertex' | 'anthropic',
  modelId: string | undefined,
  domainMode: 'auto' | 'manual',
  domain: 'ethics' | 'philosophy_of_mind' | undefined,
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
        depth_mode: depthMode,
        model_provider: modelProvider,
        model_id: modelId ?? null,
        domain_mode: domainMode,
        domain: domain ?? null,
        events: storageEvents,
        createdAt: new Date()
      });
    console.log(`[FIRESTORE] Saved query for uid=${uid} hash=${queryHash.slice(0, 8)}`);
  } catch (err) {
    console.warn('[FIRESTORE] Cache write failed:', err instanceof Error ? err.message : String(err));
  }
}

function buildQueryHash(
  query: string,
  lens?: string,
  depthMode: 'quick' | 'standard' | 'deep' = 'standard',
  modelProvider: 'auto' | 'vertex' | 'anthropic' = 'auto',
  modelId: string | undefined = undefined,
  domainMode: 'auto' | 'manual' = 'auto',
  domain?: 'ethics' | 'philosophy_of_mind'
): string {
  const normalized = query.trim().toLowerCase();
  const lensKey = (lens || '').trim().toLowerCase();
  const domainKey = domainMode === 'manual' ? (domain ?? 'unknown') : 'auto';
  const modelKey = modelId?.trim().toLowerCase() || 'auto';
  return createHash('sha256').update(`${normalized}::${lensKey}::${depthMode}::${modelProvider}::${modelKey}::${domainMode}::${domainKey}`).digest('hex');
}

type QueryCacheRow = {
  query_hash: string;
  query_text: string;
  lens?: string;
  depth_mode?: 'quick' | 'standard' | 'deep';
  model_provider?: 'auto' | 'vertex' | 'anthropic';
  model_id?: string;
  domain_mode?: 'auto' | 'manual';
  domain?: 'ethics' | 'philosophy_of_mind';
  events: SSEEvent[];
  created_at?: string;
  expires_at?: string;
  hit_count?: number;
};

function mapBadgeToClaimType(badge: Claim['badge']): ExtractedClaim['claim_type'] {
  switch (badge) {
    case 'empirical':
      return 'empirical';
    case 'definition':
      return 'definitional';
    case 'objection':
      return 'normative';
    case 'response':
      return 'explanatory';
    case 'thesis':
      return 'normative';
    case 'premise':
    default:
      return 'explanatory';
  }
}

function mapClaimToExtracted(claim: Claim): ExtractedClaim {
  const claimId = claim.id.startsWith('claim:') ? claim.id.slice(6) : claim.id;
  return {
    id: claimId,
    text: claim.text,
    claim_type: mapBadgeToClaimType(claim.badge),
    scope: 'moderate',
    confidence: claim.confidence ?? 0.65,
    source_span: claim.source
  };
}

function mapRelationsToExtracted(bundles: RelationBundle[]): ExtractedRelation[] {
  const relations: ExtractedRelation[] = [];
  for (const bundle of bundles) {
    for (const relation of bundle.relations) {
      const relationType =
        relation.type === 'depends-on'
          ? 'depends_on'
          : relation.type === 'responds-to'
            ? 'refines'
            : relation.type === 'qualifies'
              ? 'qualifies'
              : relation.type === 'assumes'
                ? 'assumes'
                : relation.type === 'resolves'
                  ? 'refines'
                  : relation.type;

      relations.push({
        from_claim_id: bundle.claimId.startsWith('claim:') ? bundle.claimId.slice(6) : bundle.claimId,
        to_claim_id: relation.target.startsWith('claim:') ? relation.target.slice(6) : relation.target,
        relation_type: relationType,
        confidence: 0.66,
        rationale: relation.label || `${relation.type} relation`
      });
    }
  }
  return relations;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  // A2/A3: uid is guaranteed non-null here — hooks.server.ts already verified the Bearer token
  const uid = locals.user?.uid ?? null;

  let body: {
    query?: string;
    lens?: string;
    depth?: 'quick' | 'standard' | 'deep';
    model_provider?: 'auto' | 'vertex' | 'anthropic';
    model_id?: string;
    domain_mode?: 'auto' | 'manual';
    domain?: 'ethics' | 'philosophy_of_mind';
    reuse?: {
      from_depth?: 'quick' | 'standard';
      analysis?: string;
      critique?: string;
      synthesis?: string;
    };
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { query, lens } = body;
  const depthMode = body.depth ?? 'standard';
  const modelProvider = body.model_provider ?? 'auto';
  const modelId = body.model_id?.trim() || undefined;
  const domainMode = body.domain_mode ?? 'auto';
  const domain = body.domain;
  const reuse = body.reuse;
  const domainOverrideEnabled =
    process.env.ENABLE_DOMAIN_OVERRIDE_UI?.toLowerCase() !== 'false';

  if (domainMode === 'manual' && !domainOverrideEnabled) {
    return json({ error: 'domain override is disabled' }, { status: 400 });
  }

  if (domainMode === 'manual' && domain !== 'ethics' && domain !== 'philosophy_of_mind') {
    return json(
      { error: 'domain is required when domain_mode is manual (ethics | philosophy_of_mind)' },
      { status: 400 }
    );
  }

  if (!query || typeof query !== 'string' || !query.trim()) {
    return json({ error: 'Query is required and must be a non-empty string' }, { status: 400 });
  }

  if (!['quick', 'standard', 'deep'].includes(depthMode)) {
    return json({ error: 'depth must be one of quick|standard|deep' }, { status: 400 });
  }
  if (!['auto', 'vertex', 'anthropic'].includes(modelProvider)) {
    return json({ error: 'model_provider must be one of auto|vertex|anthropic' }, { status: 400 });
  }
  if (modelId && modelProvider === 'auto') {
    return json({ error: 'model_provider must be vertex|anthropic when model_id is provided' }, { status: 400 });
  }
  if (modelId) {
    const available = getAvailableReasoningModels();
    const exists = available.some((option) => option.id === modelId && option.provider === modelProvider);
    if (!exists) {
      return json({ error: `model_id ${modelId} is not available for provider ${modelProvider}` }, { status: 400 });
    }
  }
  if (modelProvider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'Anthropic provider requested but ANTHROPIC_API_KEY is not configured' }, { status: 400 });
  }

  if (reuse) {
    if (reuse.from_depth !== 'quick' && reuse.from_depth !== 'standard') {
      return json({ error: 'reuse.from_depth must be quick|standard' }, { status: 400 });
    }
    if (reuse.analysis !== undefined && typeof reuse.analysis !== 'string') {
      return json({ error: 'reuse.analysis must be a string' }, { status: 400 });
    }
    if (reuse.critique !== undefined && typeof reuse.critique !== 'string') {
      return json({ error: 'reuse.critique must be a string' }, { status: 400 });
    }
    if (reuse.synthesis !== undefined && typeof reuse.synthesis !== 'string') {
      return json({ error: 'reuse.synthesis must be a string' }, { status: 400 });
    }
  }

  const queryText = query.trim();
  const normalizedReuse:
    | {
        fromDepth: 'quick' | 'standard';
        analysis?: string;
        critique?: string;
        synthesis?: string;
      }
    | undefined = reuse
    ? {
        fromDepth: reuse.from_depth as 'quick' | 'standard',
        analysis: reuse.analysis,
        critique: reuse.critique,
        synthesis: reuse.synthesis
      }
    : undefined;
  const queryHash = buildQueryHash(queryText, lens, depthMode, modelProvider, modelId, domainMode, domain);
  const constitutionInAnalyseEnabled =
    process.env.ENABLE_CONSTITUTION_IN_ANALYSE?.toLowerCase() === 'true';

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
      const queryRunId = `run:${randomUUID()}`;
      const passClaims: Partial<Record<AnalysisPhase, Claim[]>> = {};
      const passRelations: Partial<Record<AnalysisPhase, RelationBundle[]>> = {};
      const groundingSources: Array<{ url: string; title?: string; pass: string }> = [];
      let latestGraphNodes: GraphNode[] = [];
      let latestGraphEdges: GraphEdge[] = [];
      let latestGraphMeta: GraphSnapshotMeta | undefined;
      let latestSnapshotId: string | undefined;
      let latestRetrievalMeta:
        | {
            claims_retrieved?: number;
            retrieval_degraded?: boolean;
          }
        | undefined;

      const sendEventWithCapture = (event: SSEEvent): void => {
        replayEvents.push(event);
        sendEvent(event);
      };

      try {
        await runDialecticalEngine(queryText, {
          onPassStart(pass, model) {
            sendEventWithCapture({
              type: 'pass_start',
              pass,
              ...(model
                ? {
                    model_provider: model.provider,
                    model_id: model.modelId
                  }
                : {})
            });
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
            for (const source of sources) {
              groundingSources.push({ url: source.url, title: source.title, pass });
            }
          },
          onGraphSnapshot(nodes, edges, meta, version) {
            latestGraphNodes = nodes;
            latestGraphEdges = edges;
            latestGraphMeta = meta;
            latestSnapshotId = meta?.snapshot_id;
            sendEventWithCapture({ type: 'graph_snapshot', nodes, edges, meta, version });
            if (meta?.snapshot_id) {
              void recordSnapshotLineage({
                snapshot_id: meta.snapshot_id,
                query_run_id: meta.query_run_id ?? queryRunId,
                parent_snapshot_id: meta.parent_snapshot_id,
                pass_sequence: meta.pass_sequence ?? 0,
                nodes,
                edges,
                created_at: new Date().toISOString()
              });
            }
          },
          onClaims(pass, claims, relations) {
            passClaims[pass] = [...(passClaims[pass] ?? []), ...claims];
            passRelations[pass] = [...(passRelations[pass] ?? []), ...relations];
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
          onMetadata(totalInputTokens, totalOutputTokens, durationMs, retrieval, modelCostBreakdown) {
            latestRetrievalMeta = retrieval
              ? {
                  claims_retrieved: retrieval.claims_retrieved,
                  retrieval_degraded: retrieval.retrieval_degraded
                }
              : undefined;
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
                    domain_confidence: retrieval.domain_confidence,
                    selected_domain_mode: retrieval.selected_domain_mode,
                    selected_domain: retrieval.selected_domain
                  }
                : {})
              ,
              ...(modelCostBreakdown
                ? {
                    model_cost_breakdown: modelCostBreakdown
                  }
                : {}),
              depth_mode: depthMode,
              selected_model_provider: modelProvider,
              selected_model_id: modelId,
              query_run_id: queryRunId
            });
          },
          onError(error) {
            sendEventWithCapture({ type: 'error', message: error });
          }
        }, {
          lens,
          depthMode,
          modelProvider,
          modelId,
          domainMode,
          domain,
          queryRunId,
          reuse: normalizedReuse
        });

        const claimsAll = (['analysis', 'critique', 'synthesis'] as const)
          .flatMap((pass) => passClaims[pass] ?? []);
        const relationsAll = (['analysis', 'critique', 'synthesis'] as const)
          .flatMap((pass) => passRelations[pass] ?? []);

        const extractedClaims = claimsAll
          .filter((claim, idx) => claimsAll.findIndex((c) => c.id === claim.id) === idx)
          .map(mapClaimToExtracted);
        const extractedRelations = mapRelationsToExtracted(relationsAll);

        const reasoningQualityEnabled =
          process.env.ENABLE_REASONING_QUALITY_IN_ANALYSE?.toLowerCase() !== 'false';

        if (reasoningQualityEnabled && extractedClaims.length > 0) {
          try {
            const reasoningQuality: ReasoningEvaluation = await evaluateReasoning(
              extractedClaims,
              extractedRelations,
              { text: queryText }
            );
            sendEventWithCapture({
              type: 'reasoning_quality',
              reasoning_quality: reasoningQuality
            });
          } catch (err) {
            console.warn('[ANALYSE] reasoning quality evaluation failed:', err instanceof Error ? err.message : String(err));
          }
        }

        const constitutionPassDeltaEnabled =
          process.env.ENABLE_CONSTITUTION_PASS_DELTAS?.toLowerCase() !== 'false';
        if (constitutionPassDeltaEnabled) {
          let previousViolationIds = new Set<string>();
          const passOrder: AnalysisPhase[] = ['analysis', 'critique', 'synthesis'];

          for (const pass of passOrder) {
            const cumulativeClaims = passOrder
              .slice(0, passOrder.indexOf(pass) + 1)
              .flatMap((p) => passClaims[p] ?? [])
              .filter((claim, idx, arr) => arr.findIndex((c) => c.id === claim.id) === idx)
              .map(mapClaimToExtracted);
            const cumulativeRelations = mapRelationsToExtracted(
              passOrder
                .slice(0, passOrder.indexOf(pass) + 1)
                .flatMap((p) => passRelations[p] ?? [])
            );

            if (cumulativeClaims.length === 0) continue;
            try {
              const constitution = await evaluateConstitutionWithTelemetry(
                cumulativeClaims,
                cumulativeRelations,
                queryText
              );
              const currentViolationIds = new Set(
                constitution.check.violated.map((rule) => rule.rule_id)
              );
              const introduced = [...currentViolationIds].filter((id) => !previousViolationIds.has(id));
              const resolved = [...previousViolationIds].filter((id) => !currentViolationIds.has(id));
              const unresolved = [...currentViolationIds];
              previousViolationIds = currentViolationIds;

              sendEventWithCapture({
                type: 'constitution_delta',
                pass,
                introduced_violations: introduced,
                resolved_violations: resolved,
                unresolved_violations: unresolved,
                overall_compliance: constitution.check.overall_compliance
              });
            } catch (err) {
              console.warn('[ANALYSE] constitution delta evaluation failed:', err instanceof Error ? err.message : String(err));
            }
          }
        }

        const depthEnrichmentEnabled = process.env.ENABLE_DEPTH_ENRICHMENT?.toLowerCase() === 'true';
        if (depthEnrichmentEnabled) {
          const enrichment = await runDepthEnrichment({
            query: queryText,
            queryRunId,
            parentSnapshotId: latestSnapshotId,
            passClaims,
            passRelations,
            baseNodes: latestGraphNodes,
            baseEdges: latestGraphEdges,
            retrieval: {
              claims_retrieved: latestRetrievalMeta?.claims_retrieved,
              retrieval_degraded: latestRetrievalMeta?.retrieval_degraded
            },
            groundingSources
          });

          if (enrichment.snapshotNodes && enrichment.snapshotEdges) {
            sendEventWithCapture({
              type: 'graph_snapshot',
              nodes: enrichment.snapshotNodes,
              edges: enrichment.snapshotEdges,
              meta: {
                ...(latestGraphMeta ?? {}),
                snapshot_id: enrichment.snapshotId,
                query_run_id: enrichment.queryRunId,
                parent_snapshot_id: enrichment.parentSnapshotId,
                pass_sequence: 4
              },
              version: 2
            });
          }

          sendEventWithCapture({
            type: 'enrichment_status',
            status: enrichment.status,
            reason: enrichment.reason,
            stagedCount: enrichment.stagedCount,
            promotedCount: enrichment.promotedCount,
            queryRunId: enrichment.queryRunId
          });
        }

        if (constitutionInAnalyseEnabled) {
          const constitutionStartedAt = Date.now();
          const constitutionResult = await runVerificationPipeline(
            {
              text: queryText
            },
            {
              includePassOutputs: false
            }
          );

          sendEventWithCapture({
            type: 'constitution_check',
            constitutional_check: constitutionResult.constitutional_check
          });

          console.log('[CONSTITUTION][ANALYSE]', {
            constitution_duration_ms: constitutionResult.constitution_duration_ms,
            constitution_input_tokens: constitutionResult.constitution_input_tokens,
            constitution_output_tokens: constitutionResult.constitution_output_tokens,
            constitution_rule_violations: constitutionResult.constitution_rule_violations,
            elapsed_ms: Date.now() - constitutionStartedAt
          });
        }

        // Persist cache only for successful runs (metadata present, no error event)
        const hasErrorEvent = replayEvents.some((event) => event.type === 'error');
        const hasMetadataEvent = replayEvents.some((event) => event.type === 'metadata');

        if (!hasErrorEvent && hasMetadataEvent) {
          // A4: Save to Firestore (per-user)
          if (uid) {
            await saveFirestoreCache(uid, queryHash, queryText, lens, depthMode, modelProvider, modelId, domainMode, domain, replayEvents);
          }

          // Also save to SurrealDB shared cache (best-effort)
          try {
            await dbQuery(`DELETE query_cache WHERE query_hash = $query_hash`, { query_hash: queryHash });
            await dbQuery(
              `CREATE query_cache CONTENT {
                query_hash: $query_hash,
                query_text: $query_text,
                lens: $lens,
                depth_mode: $depth_mode,
                model_provider: $model_provider,
                model_id: $model_id,
                domain_mode: $domain_mode,
                domain: $domain,
                events: $events,
                hit_count: 0,
                created_at: time::now()
              }`,
              {
                query_hash: queryHash,
                query_text: queryText,
                lens: lens ?? null,
                depth_mode: depthMode,
                model_provider: modelProvider,
                model_id: modelId ?? null,
                domain_mode: domainMode,
                domain: domain ?? null,
                events: replayEvents
              }
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
