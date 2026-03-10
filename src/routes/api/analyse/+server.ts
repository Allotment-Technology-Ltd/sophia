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
import { extractFromSource } from '$lib/server/enrichment/sourceExtractor';
import type { AnalysisPhase, Claim, RelationBundle } from '$lib/types/references';
import type { GraphEdge, GraphNode, GraphSnapshotMeta } from '$lib/types/api';
import type { ExtractedClaim, ExtractedRelation, ReasoningEvaluation } from '$lib/types/verification';
import { evaluateReasoning } from '$lib/server/reasoningEval';
import { evaluateConstitutionWithTelemetry } from '$lib/server/constitution/evaluator';
import { getAvailableReasoningModels } from '$lib/server/vertex';
import { isIP } from 'node:net';

// Store only replay-relevant events — excludes high-volume pass_chunk events
const REPLAY_EVENT_TYPES = new Set([
  'pass_start', 'pass_structured', 'pass_complete',
  'sources', 'grounding_sources', 'claims', 'relations',
  'confidence_summary', 'metadata', 'graph_snapshot', 'constitution_check', 'enrichment_status',
  'reasoning_quality', 'constitution_delta'
]);

const FIRESTORE_CACHE_TTL_DAYS = 30;
const MAX_USER_LINKS = 5;

type ResourceMode = 'standard' | 'expanded';
type QueueSourceKind = 'user' | 'grounding';
type QueueStatus = 'queued' | 'pending_review' | 'approved' | 'ingesting' | 'ingested' | 'failed' | 'rejected';

const DEFAULT_TRUSTED_INGESTION_DOMAINS = [
  'plato.stanford.edu',
  'iep.utm.edu',
  'arxiv.org',
  'philpapers.org',
  'stanford.edu',
  'ox.ac.uk',
  'cam.ac.uk'
];

type QueueCandidateRollup = {
  canonicalUrl: string;
  canonicalUrlHash: string;
  titleHint?: string;
  passHints: Set<string>;
  sourceKinds: Set<QueueSourceKind>;
  userSubmissionCount: number;
  groundingSubmissionCount: number;
};

type LinkQueueRow = {
  status?: QueueStatus;
  source_kinds?: string[];
  query_run_ids?: string[];
  submitted_by_uids?: string[];
  pass_hints?: string[];
  user_submission_count?: number;
  grounding_submission_count?: number;
  total_submission_count?: number;
};

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
  domain?: 'ethics' | 'philosophy_of_mind',
  resourceMode: ResourceMode = 'standard',
  userLinks: string[] = [],
  queueForNightlyIngest = false
): string {
  const normalized = query.trim().toLowerCase();
  const lensKey = (lens || '').trim().toLowerCase();
  const domainKey = domainMode === 'manual' ? (domain ?? 'unknown') : 'auto';
  const modelKey = modelId?.trim().toLowerCase() || 'auto';
  const linksKey = userLinks.join('|');
  const queueKey = queueForNightlyIngest ? 'queue:yes' : 'queue:no';
  return createHash('sha256').update(
    `${normalized}::${lensKey}::${depthMode}::${modelProvider}::${modelKey}::${domainMode}::${domainKey}::${resourceMode}::${linksKey}::${queueKey}`
  ).digest('hex');
}

function isDisallowedHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home.arpa')
  ) {
    return true;
  }

  if (!isIP(normalized)) return false;

  if (normalized === '::1') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  const octets = normalized.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
  const [a, b] = octets;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function canonicalizeQueueUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (isDisallowedHost(parsed.hostname)) return null;
  parsed.hash = '';
  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
  return parsed.toString();
}

function getTrustedIngestionDomains(): string[] {
  const configured = (process.env.INGESTION_TRUSTED_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_TRUSTED_INGESTION_DOMAINS;
}

function isTrustedIngestionHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  return getTrustedIngestionDomains().some(
    (trusted) => normalized === trusted || normalized.endsWith(`.${trusted}`)
  );
}

function selectQueueStatusForUrl(canonicalUrl: string): QueueStatus {
  try {
    const hostname = new URL(canonicalUrl).hostname;
    return isTrustedIngestionHost(hostname) ? 'approved' : 'pending_review';
  } catch {
    return 'pending_review';
  }
}

function normalizeAndValidateUserLinks(input: unknown): { links: string[]; error?: string } {
  if (input === undefined) return { links: [] };
  if (!Array.isArray(input)) {
    return { links: [], error: 'user_links must be an array of URLs' };
  }
  if (input.length > MAX_USER_LINKS) {
    return { links: [], error: `user_links must contain at most ${MAX_USER_LINKS} URLs` };
  }

  const deduped = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') {
      return { links: [], error: 'user_links entries must be strings' };
    }
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { links: [], error: `Invalid URL in user_links: ${trimmed}` };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { links: [], error: `Unsupported URL protocol in user_links: ${trimmed}` };
    }
    if (isDisallowedHost(parsed.hostname)) {
      return { links: [], error: `Blocked private/local URL in user_links: ${trimmed}` };
    }
    parsed.hash = '';
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    deduped.add(parsed.toString());
  }

  return { links: [...deduped] };
}

function buildQueueCandidateRollup(
  userLinks: string[],
  groundingSources: Array<{ url: string; title?: string; pass: string }>
): Map<string, QueueCandidateRollup> {
  const byCanonicalUrl = new Map<string, QueueCandidateRollup>();

  const upsert = (
    url: string,
    sourceKind: QueueSourceKind,
    titleHint?: string,
    passHint?: string
  ): void => {
    const canonicalUrl = canonicalizeQueueUrl(url);
    if (!canonicalUrl) return;
    const existing = byCanonicalUrl.get(canonicalUrl);
    if (existing) {
      existing.sourceKinds.add(sourceKind);
      if (sourceKind === 'user') existing.userSubmissionCount += 1;
      if (sourceKind === 'grounding') existing.groundingSubmissionCount += 1;
      if (!existing.titleHint && titleHint?.trim()) existing.titleHint = titleHint.trim();
      if (passHint?.trim()) existing.passHints.add(passHint.trim());
      return;
    }
    byCanonicalUrl.set(canonicalUrl, {
      canonicalUrl,
      canonicalUrlHash: createHash('sha256').update(canonicalUrl).digest('hex'),
      titleHint: titleHint?.trim() || undefined,
      passHints: new Set(passHint?.trim() ? [passHint.trim()] : []),
      sourceKinds: new Set([sourceKind]),
      userSubmissionCount: sourceKind === 'user' ? 1 : 0,
      groundingSubmissionCount: sourceKind === 'grounding' ? 1 : 0
    });
  };

  for (const url of userLinks) {
    upsert(url, 'user');
  }
  for (const source of groundingSources) {
    upsert(source.url, 'grounding', source.title, source.pass);
  }

  return byCanonicalUrl;
}

function mergeUnique(existing: string[] | undefined, next: string[]): string[] {
  return [...new Set([...(existing ?? []), ...next])];
}

function resolveUpdatedQueueStatus(
  existingStatus: QueueStatus | undefined,
  requestedStatus: QueueStatus
): QueueStatus {
  if (!existingStatus) return requestedStatus;
  if (existingStatus === 'queued') return requestedStatus;
  if (existingStatus === 'failed' && requestedStatus === 'approved') return 'approved';
  return existingStatus;
}

async function upsertQueueCandidate(
  candidate: QueueCandidateRollup,
  uid: string | null,
  queryRunId: string
): Promise<void> {
  const requestedStatus = selectQueueStatusForUrl(candidate.canonicalUrl);
  const selectExisting = async (): Promise<LinkQueueRow | null> => {
    const rows = await dbQuery<LinkQueueRow[]>(
      `SELECT status, source_kinds, query_run_ids, submitted_by_uids, pass_hints, user_submission_count, grounding_submission_count, total_submission_count
       FROM link_ingestion_queue
       WHERE canonical_url_hash = $canonical_url_hash
       LIMIT 1`,
      { canonical_url_hash: candidate.canonicalUrlHash }
    );
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  };

  const updateExisting = async (existing: LinkQueueRow): Promise<void> => {
    const nextUserCount = (existing.user_submission_count ?? 0) + candidate.userSubmissionCount;
    const nextGroundingCount =
      (existing.grounding_submission_count ?? 0) + candidate.groundingSubmissionCount;
    const nextTotal = (existing.total_submission_count ?? 0) + candidate.userSubmissionCount + candidate.groundingSubmissionCount;
    const nextStatus = resolveUpdatedQueueStatus(existing.status, requestedStatus);

    await dbQuery(
      `UPDATE link_ingestion_queue
       SET
         source_kinds = $source_kinds,
         query_run_ids = $query_run_ids,
         submitted_by_uids = $submitted_by_uids,
         pass_hints = $pass_hints,
         latest_query_run_id = $latest_query_run_id,
         submitted_by_uid = $submitted_by_uid,
         user_submission_count = $user_submission_count,
         grounding_submission_count = $grounding_submission_count,
         total_submission_count = $total_submission_count,
         status = $status,
         last_submitted_at = time::now(),
         updated_at = time::now(),
         approved_at = if $status = 'approved' then time::now() else approved_at end
       WHERE canonical_url_hash = $canonical_url_hash`,
      {
        canonical_url_hash: candidate.canonicalUrlHash,
        source_kinds: mergeUnique(existing.source_kinds, [...candidate.sourceKinds]),
        query_run_ids: mergeUnique(existing.query_run_ids, [queryRunId]),
        submitted_by_uids: uid ? mergeUnique(existing.submitted_by_uids, [uid]) : (existing.submitted_by_uids ?? []),
        pass_hints: mergeUnique(existing.pass_hints, [...candidate.passHints]),
        latest_query_run_id: queryRunId,
        submitted_by_uid: uid,
        user_submission_count: nextUserCount,
        grounding_submission_count: nextGroundingCount,
        total_submission_count: nextTotal,
        status: nextStatus
      }
    );
  };

  const existing = await selectExisting();
  if (existing) {
    await updateExisting(existing);
    return;
  }

  try {
    await dbQuery(
      `CREATE link_ingestion_queue CONTENT {
        canonical_url: $canonical_url,
        canonical_url_hash: $canonical_url_hash,
        hostname: $hostname,
        status: $status,
        source_kinds: $source_kinds,
        query_run_ids: $query_run_ids,
        latest_query_run_id: $latest_query_run_id,
        submitted_by_uid: $submitted_by_uid,
        submitted_by_uids: $submitted_by_uids,
        title_hint: $title_hint,
        pass_hints: $pass_hints,
        user_submission_count: $user_submission_count,
        grounding_submission_count: $grounding_submission_count,
        total_submission_count: $total_submission_count,
        attempt_count: 0,
        last_error: NONE,
        created_at: time::now(),
        queued_at: time::now(),
        last_submitted_at: time::now(),
        updated_at: time::now(),
        approved_at: if $status = 'approved' then time::now() else NONE end
      }`,
      {
        canonical_url: candidate.canonicalUrl,
        canonical_url_hash: candidate.canonicalUrlHash,
        hostname: new URL(candidate.canonicalUrl).hostname,
        status: requestedStatus,
        source_kinds: [...candidate.sourceKinds],
        query_run_ids: [queryRunId],
        latest_query_run_id: queryRunId,
        submitted_by_uid: uid,
        submitted_by_uids: uid ? [uid] : [],
        title_hint: candidate.titleHint ?? null,
        pass_hints: [...candidate.passHints],
        user_submission_count: candidate.userSubmissionCount,
        grounding_submission_count: candidate.groundingSubmissionCount,
        total_submission_count: candidate.userSubmissionCount + candidate.groundingSubmissionCount
      }
    );
  } catch {
    // A concurrent insert can race against this create; fallback to merge-update.
    const concurrentExisting = await selectExisting();
    if (!concurrentExisting) throw new Error('queue upsert failed: record not visible after create conflict');
    await updateExisting(concurrentExisting);
  }
}

async function enqueueDeferredLinkIngestion(params: {
  uid: string | null;
  queryRunId: string;
  userLinks: string[];
  groundingSources: Array<{ url: string; title?: string; pass: string }>;
}): Promise<number> {
  const candidates = buildQueueCandidateRollup(params.userLinks, params.groundingSources);
  if (candidates.size === 0) return 0;

  let successfulUpserts = 0;
  for (const candidate of candidates.values()) {
    try {
      await upsertQueueCandidate(candidate, params.uid, params.queryRunId);
      successfulUpserts += 1;
    } catch (err) {
      console.warn('[QUEUE] Failed to enqueue link candidate', {
        url: candidate.canonicalUrl,
        hash: candidate.canonicalUrlHash.slice(0, 12),
        err: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return successfulUpserts;
}

async function buildRuntimeExternalContext(
  links: string[],
  mode: ResourceMode
): Promise<{ block: string; processedCount: number }> {
  if (links.length === 0) return { block: '', processedCount: 0 };

  const maxSyncLinks = mode === 'expanded' ? 3 : 2;
  const candidates = links.slice(0, maxSyncLinks);
  const budget =
    mode === 'expanded'
      ? { maxBytes: 350_000, maxLatencyMs: 2_500 }
      : { maxBytes: 180_000, maxLatencyMs: 1_200 };

  const extracted = await Promise.all(
    candidates.map(async (link) => {
      const mimeType = link.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/html';
      const result = await extractFromSource({
        url: link,
        mimeType,
        budget
      });
      if (!result.text) return null;
      const excerpt = result.text.slice(0, 700).replace(/\s+/g, ' ').trim();
      if (!excerpt) return null;
      return `- ${link}\n  Excerpt: ${excerpt}`;
    })
  );

  const items = extracted.filter((entry): entry is string => Boolean(entry));
  if (items.length === 0) return { block: '', processedCount: 0 };
  return {
    processedCount: items.length,
    block: `USER-PROVIDED RESEARCH LINKS (RUNTIME CONTEXT)\nUse these links as high-priority context.\n${items.join('\n')}`
  };
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
    resource_mode?: ResourceMode;
    user_links?: string[];
    queue_for_nightly_ingest?: boolean;
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
  const requestedResourceMode = body.resource_mode ?? 'standard';
  const queueForNightlyIngest = body.queue_for_nightly_ingest ?? false;
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
  if (requestedResourceMode !== 'standard' && requestedResourceMode !== 'expanded') {
    return json({ error: 'resource_mode must be one of standard|expanded' }, { status: 400 });
  }
  if (typeof queueForNightlyIngest !== 'boolean') {
    return json({ error: 'queue_for_nightly_ingest must be a boolean' }, { status: 400 });
  }
  const normalizedUserLinksResult = normalizeAndValidateUserLinks(body.user_links);
  if (normalizedUserLinksResult.error) {
    return json({ error: normalizedUserLinksResult.error }, { status: 400 });
  }
  const normalizedUserLinks = normalizedUserLinksResult.links;
  const resourceMode: ResourceMode = normalizedUserLinks.length > 0 ? 'expanded' : requestedResourceMode;

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
  const queryHash = buildQueryHash(
    queryText,
    lens,
    depthMode,
    modelProvider,
    modelId,
    domainMode,
    domain,
    resourceMode,
    normalizedUserLinks,
    queueForNightlyIngest
  );
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
      const nightlyIngestionEnabled =
        process.env.ENABLE_NIGHTLY_LINK_INGESTION?.toLowerCase() !== 'false';
      let queuePreviewCount = 0;
      const { block: externalContextBlock, processedCount: runtimeLinksProcessed } =
        await buildRuntimeExternalContext(normalizedUserLinks, resourceMode);

      const sendEventWithCapture = (event: SSEEvent): void => {
        replayEvents.push(event);
        sendEvent(event);
      };

      try {
        const runtimeQueryText = externalContextBlock
          ? `${queryText}\n\n${externalContextBlock}`
          : queryText;
        await runDialecticalEngine(runtimeQueryText, {
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
            if (queueForNightlyIngest && nightlyIngestionEnabled) {
              queuePreviewCount = buildQueueCandidateRollup(
                normalizedUserLinks,
                groundingSources
              ).size;
            } else {
              queuePreviewCount = 0;
            }
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
              resource_mode: resourceMode,
              user_links_count: normalizedUserLinks.length,
              runtime_links_processed: runtimeLinksProcessed,
              nightly_queue_enqueued: queuePreviewCount,
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
          if (queueForNightlyIngest && nightlyIngestionEnabled) {
            const enqueued = await enqueueDeferredLinkIngestion({
              uid,
              queryRunId,
              userLinks: normalizedUserLinks,
              groundingSources
            });
            if (enqueued !== queuePreviewCount) {
              console.log('[QUEUE] enqueue count mismatch', {
                preview: queuePreviewCount,
                committed: enqueued,
                queryRunId
              });
            }
          }

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
