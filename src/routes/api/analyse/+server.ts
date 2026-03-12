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
import { loadByokProviderApiKeys } from '$lib/server/byok/store';
import type { ByokProvider, ProviderApiKeys } from '$lib/server/byok/types';
import {
  REASONING_PROVIDER_ORDER,
  getModelProviderLabel,
  isReasoningProvider,
  parseByokProvider as parseSharedByokProvider,
  parseReasoningProvider,
  type ModelProvider
} from '$lib/types/providers';
import { consumePlatformBudget, type QueryKind } from '$lib/server/rateLimit';
import {
  consumeIngestionEntitlements,
  getEntitlementSummary
} from '$lib/server/billing/entitlements';
import {
  assertByokWalletBalance,
  ensureWallet,
  computeByokFeeCents,
  debitByokHandlingFee
} from '$lib/server/billing/wallet';
import {
  TIER_INGESTION_RULES,
  type EntitlementSummary,
  type IngestVisibilityScope
} from '$lib/server/billing/types';
import {
  BILLING_FEATURE_ENABLED,
  BYOK_WALLET_CHARGING_ENABLED,
  BYOK_WALLET_SHADOW_MODE,
  INGEST_VISIBILITY_MODE_ENABLED
} from '$lib/server/billing/flags';
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

type CredentialMode = 'auto' | 'platform' | 'byok';

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
  visibilityScope: IngestVisibilityScope;
  titleHint?: string;
  passHints: Set<string>;
  sourceKinds: Set<QueueSourceKind>;
  userSubmissionCount: number;
  groundingSubmissionCount: number;
};

type LinkIngestionPreference = {
  url: string;
  ingest_selected: boolean;
  ingest_visibility: IngestVisibilityScope;
  acknowledge_public_share?: boolean;
};

type LinkQueueRow = {
  status?: QueueStatus;
  visibility_scope?: IngestVisibilityScope;
  owner_uid?: string | null;
  contributor_uid?: string | null;
  deletion_state?: string | null;
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
  modelProvider: ModelProvider,
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
  modelProvider: ModelProvider = 'auto',
  modelId: string | undefined = undefined,
  domainMode: 'auto' | 'manual' = 'auto',
  domain?: 'ethics' | 'philosophy_of_mind',
  resourceMode: ResourceMode = 'standard',
  userLinks: string[] = [],
  ingestionPreferencesKey = 'ingest:none',
  queueForNightlyIngest = false
): string {
  const normalized = query.trim().toLowerCase();
  const lensKey = (lens || '').trim().toLowerCase();
  const domainKey = domainMode === 'manual' ? (domain ?? 'unknown') : 'auto';
  const modelKey = modelId?.trim().toLowerCase() || 'auto';
  const linksKey = userLinks.join('|');
  const ingestKey = ingestionPreferencesKey || 'ingest:none';
  const queueKey = queueForNightlyIngest ? 'queue:yes' : 'queue:no';
  return createHash('sha256').update(
    `${normalized}::${lensKey}::${depthMode}::${modelProvider}::${modelKey}::${domainMode}::${domainKey}::${resourceMode}::${linksKey}::${ingestKey}::${queueKey}`
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

function parseIngestVisibility(value: unknown): IngestVisibilityScope {
  if (typeof value !== 'string') return 'public_shared';
  const normalized = value.trim().toLowerCase();
  return normalized === 'private_user_only' ? 'private_user_only' : 'public_shared';
}

function normalizeAndValidateLinkPreferences(
  input: unknown,
  validatedLinks: string[]
): { preferences: LinkIngestionPreference[]; error?: string } {
  if (input === undefined) return { preferences: [] };
  if (!Array.isArray(input)) {
    return { preferences: [], error: 'link_preferences must be an array' };
  }

  const allowedLinks = new Set(validatedLinks);
  const mergedByUrl = new Map<string, LinkIngestionPreference>();

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      return { preferences: [], error: 'link_preferences entries must be objects' };
    }
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.url !== 'string' || !candidate.url.trim()) {
      return { preferences: [], error: 'link_preferences.url must be a non-empty string' };
    }
    const canonicalUrl = canonicalizeQueueUrl(candidate.url.trim());
    if (!canonicalUrl || !allowedLinks.has(canonicalUrl)) {
      return {
        preferences: [],
        error: 'link_preferences URLs must match normalized user_links values for this request'
      };
    }

    const pref: LinkIngestionPreference = {
      url: canonicalUrl,
      ingest_selected: candidate.ingest_selected === true,
      ingest_visibility: parseIngestVisibility(candidate.ingest_visibility),
      acknowledge_public_share: candidate.acknowledge_public_share === true
    };
    if (
      pref.ingest_selected &&
      pref.ingest_visibility === 'public_shared' &&
      pref.acknowledge_public_share !== true
    ) {
      return {
        preferences: [],
        error:
          'Public source ingestion requires acknowledge_public_share=true for each selected link.'
      };
    }
    mergedByUrl.set(canonicalUrl, pref);
  }

  return { preferences: [...mergedByUrl.values()] };
}

function buildEffectiveLinkPreferences(
  validatedLinks: string[],
  explicitPreferences: LinkIngestionPreference[],
  visibilityModeEnabled: boolean
): LinkIngestionPreference[] {
  if (!visibilityModeEnabled) {
    return validatedLinks.map((url) => ({
      url,
      ingest_selected: true,
      ingest_visibility: 'public_shared',
      acknowledge_public_share: true
    }));
  }

  const explicitByUrl = new Map(explicitPreferences.map((pref) => [pref.url, pref]));
  return validatedLinks.map((url) => {
    const explicit = explicitByUrl.get(url);
    if (explicit) return explicit;
    return {
      url,
      ingest_selected: false,
      ingest_visibility: 'public_shared',
      acknowledge_public_share: false
    };
  });
}

function serializeIngestionPreferences(preferences: LinkIngestionPreference[]): string {
  if (preferences.length === 0) return 'ingest:none';
  const sorted = [...preferences]
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((pref) => `${pref.url}|${pref.ingest_selected ? '1' : '0'}|${pref.ingest_visibility}`);
  return sorted.join('::');
}

function evaluateIngestionSelection(
  summary: EntitlementSummary,
  visibilities: IngestVisibilityScope[]
): { allowed: boolean; reason?: string } {
  const rules = TIER_INGESTION_RULES[summary.tier];
  let publicUsed = summary.publicUsed;
  let privateUsed = summary.privateUsed;

  for (const visibility of visibilities) {
    if (visibility === 'private_user_only') {
      if (rules.privateMax === 0) {
        return { allowed: false, reason: 'private_not_allowed' };
      }
      if (privateUsed >= rules.privateMax) {
        return { allowed: false, reason: 'private_limit_reached' };
      }
      if (publicUsed > rules.publicMaxWhenPrivateUsed) {
        return { allowed: false, reason: 'combo_limit_reached' };
      }
      privateUsed += 1;
      continue;
    }

    const publicMax = privateUsed > 0 ? rules.publicMaxWhenPrivateUsed : rules.publicMax;
    if (publicUsed >= publicMax) {
      return { allowed: false, reason: 'public_limit_reached' };
    }
    publicUsed += 1;
  }

  return { allowed: true };
}

function formatIngestionLimitError(reason: string | undefined): string {
  if (reason === 'private_not_allowed') {
    return 'Private source ingestion is not available on your current plan.';
  }
  if (reason === 'private_limit_reached') {
    return 'Private source ingestion limit reached for this month.';
  }
  if (reason === 'combo_limit_reached') {
    return 'Public/private ingestion combination limit reached for this month.';
  }
  if (reason === 'public_limit_reached') {
    return 'Public source ingestion limit reached for this month.';
  }
  if (reason === 'billing_inactive') {
    return 'Your paid subscription is inactive. Please update billing to use paid ingestion limits.';
  }
  return 'Ingestion quota exceeded for this billing period.';
}

function buildQueueCandidateRollup(
  links: Array<{ url: string; visibilityScope: IngestVisibilityScope }>,
  uid: string | null
): Map<string, QueueCandidateRollup> {
  const byCanonicalUrl = new Map<string, QueueCandidateRollup>();

  const upsert = (
    url: string,
    sourceKind: QueueSourceKind,
    visibilityScope: IngestVisibilityScope,
    titleHint?: string,
    passHint?: string
  ): void => {
    const canonicalUrl = canonicalizeQueueUrl(url);
    if (!canonicalUrl) return;
    const hashKey =
      visibilityScope === 'private_user_only'
        ? `private_user_only::${uid ?? 'anonymous'}::${canonicalUrl}`
        : `public_shared::${canonicalUrl}`;
    const canonicalUrlHash = createHash('sha256').update(hashKey).digest('hex');
    const existing = byCanonicalUrl.get(canonicalUrlHash);
    if (existing) {
      existing.sourceKinds.add(sourceKind);
      if (sourceKind === 'user') existing.userSubmissionCount += 1;
      if (sourceKind === 'grounding') existing.groundingSubmissionCount += 1;
      if (!existing.titleHint && titleHint?.trim()) existing.titleHint = titleHint.trim();
      if (passHint?.trim()) existing.passHints.add(passHint.trim());
      return;
    }
    byCanonicalUrl.set(canonicalUrlHash, {
      canonicalUrl,
      canonicalUrlHash,
      visibilityScope,
      titleHint: titleHint?.trim() || undefined,
      passHints: new Set(passHint?.trim() ? [passHint.trim()] : []),
      sourceKinds: new Set([sourceKind]),
      userSubmissionCount: sourceKind === 'user' ? 1 : 0,
      groundingSubmissionCount: sourceKind === 'grounding' ? 1 : 0
    });
  };

  for (const link of links) {
    upsert(link.url, 'user', link.visibilityScope);
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
  const ownerUid = candidate.visibilityScope === 'private_user_only' ? uid : null;
  const contributorUid = candidate.visibilityScope === 'public_shared' ? uid : null;
  const selectExisting = async (): Promise<LinkQueueRow | null> => {
    const rows = await dbQuery<LinkQueueRow[]>(
      `SELECT status, visibility_scope, owner_uid, contributor_uid, deletion_state, source_kinds, query_run_ids, submitted_by_uids, pass_hints, user_submission_count, grounding_submission_count, total_submission_count
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
         visibility_scope = if visibility_scope = NONE then $visibility_scope else visibility_scope end,
         owner_uid = if $owner_uid = NONE then owner_uid else $owner_uid end,
         contributor_uid = if $contributor_uid = NONE then contributor_uid else $contributor_uid end,
         deletion_state = 'active',
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
        visibility_scope: candidate.visibilityScope,
        owner_uid: ownerUid,
        contributor_uid: contributorUid,
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
        visibility_scope: $visibility_scope,
        owner_uid: $owner_uid,
        contributor_uid: $contributor_uid,
        deletion_state: 'active',
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
        visibility_scope: candidate.visibilityScope,
        owner_uid: ownerUid,
        contributor_uid: contributorUid,
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
  links: Array<{ url: string; visibilityScope: IngestVisibilityScope }>;
}): Promise<number> {
  const candidates = buildQueueCandidateRollup(params.links, params.uid);
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
  model_provider?: ModelProvider;
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
      let relationType: ExtractedRelation['relation_type'];
      switch (relation.type) {
        case 'supports':
        case 'contradicts':
        case 'defines':
        case 'qualifies':
          relationType = relation.type;
          break;
        case 'depends-on':
          relationType = 'depends_on';
          break;
        case 'responds-to':
          relationType = 'responds_to';
          break;
        case 'assumes':
          relationType = 'depends_on';
          break;
        case 'resolves':
          relationType = 'qualifies';
          break;
        default:
          relationType = 'supports';
      }

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

function parseCredentialMode(value: unknown): CredentialMode {
  if (typeof value !== 'string') return 'auto';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'platform' || normalized === 'byok') return normalized;
  return 'auto';
}

function parseByokProvider(value: unknown): ByokProvider | undefined {
  if (typeof value !== 'string') return undefined;
  return parseSharedByokProvider(value);
}

function parseModelProvider(value: unknown): ModelProvider | undefined {
  if (typeof value !== 'string') return 'auto';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto') return 'auto';
  return parseReasoningProvider(normalized);
}

function parseQueryKind(value: unknown): QueryKind {
  if (typeof value !== 'string') return 'new';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'follow_up') return 'follow_up';
  if (normalized === 'rerun') return 'rerun';
  return 'new';
}

function selectEffectiveProviderApiKeys(
  allByokKeys: ProviderApiKeys,
  mode: CredentialMode,
  byokProvider?: ByokProvider
): ProviderApiKeys {
  if (mode === 'platform') return {};
  if (mode === 'byok' && byokProvider) {
    const key = allByokKeys[byokProvider];
    return key ? { [byokProvider]: key } : {};
  }
  return allByokKeys;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  // A2/A3: uid is guaranteed non-null here — hooks.server.ts already verified the Bearer token
  const uid = locals.user?.uid ?? null;
  let providerApiKeys: ProviderApiKeys = {};
  if (uid) {
    try {
      providerApiKeys = await loadByokProviderApiKeys(uid);
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[BYOK] Failed to load provider keys for analyse route:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  let body: {
    query?: string;
    lens?: string;
    depth?: 'quick' | 'standard' | 'deep';
    query_kind?: 'new' | 'follow_up' | 'rerun';
    credential_mode?: CredentialMode;
    byok_provider?: ByokProvider;
    model_provider?: ModelProvider;
    model_id?: string;
    domain_mode?: 'auto' | 'manual';
    domain?: 'ethics' | 'philosophy_of_mind';
    resource_mode?: ResourceMode;
    user_links?: string[];
    link_preferences?: LinkIngestionPreference[];
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
  const queryKind = parseQueryKind(body.query_kind);
  const credentialMode = parseCredentialMode(body.credential_mode);
  const byokProvider = parseByokProvider(body.byok_provider);
  const parsedModelProvider = parseModelProvider(body.model_provider);
  if (!parsedModelProvider) {
    return json({ error: `model_provider must be one of auto|${REASONING_PROVIDER_ORDER.join('|')}` }, { status: 400 });
  }
  const modelProvider = parsedModelProvider;
  const modelId = body.model_id?.trim() || undefined;
  const domainMode = body.domain_mode ?? 'auto';
  const domain = body.domain;
  const requestedResourceMode = body.resource_mode ?? 'standard';
  const requestedNightlyQueue = body.queue_for_nightly_ingest;
  const reuse = body.reuse;
  const effectiveProviderApiKeys = selectEffectiveProviderApiKeys(providerApiKeys, credentialMode, byokProvider);
  const usingByok = Object.keys(effectiveProviderApiKeys).some((provider) => isReasoningProvider(provider));
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
  if (requestedNightlyQueue !== undefined && typeof requestedNightlyQueue !== 'boolean') {
    return json({ error: 'queue_for_nightly_ingest must be a boolean' }, { status: 400 });
  }
  const normalizedUserLinksResult = normalizeAndValidateUserLinks(body.user_links);
  if (normalizedUserLinksResult.error) {
    return json({ error: normalizedUserLinksResult.error }, { status: 400 });
  }
  const normalizedUserLinks = normalizedUserLinksResult.links;
  const linkPreferencesResult = normalizeAndValidateLinkPreferences(
    body.link_preferences,
    normalizedUserLinks
  );
  if (linkPreferencesResult.error) {
    return json({ error: linkPreferencesResult.error }, { status: 400 });
  }
  const effectiveLinkPreferences = buildEffectiveLinkPreferences(
    normalizedUserLinks,
    linkPreferencesResult.preferences,
    INGEST_VISIBILITY_MODE_ENABLED
  );
  const selectedIngestionLinks = effectiveLinkPreferences
    .filter((pref) => pref.ingest_selected)
    .map((pref) => ({
      url: pref.url,
      visibilityScope: pref.ingest_visibility
    }));
  const queueForNightlyIngest = INGEST_VISIBILITY_MODE_ENABLED
    ? selectedIngestionLinks.length > 0
    : normalizedUserLinks.length > 0 || requestedNightlyQueue === true;
  const ingestionPreferenceKey = serializeIngestionPreferences(effectiveLinkPreferences);
  const resourceMode: ResourceMode = normalizedUserLinks.length > 0 ? 'expanded' : requestedResourceMode;

  if (!['quick', 'standard', 'deep'].includes(depthMode)) {
    return json({ error: 'depth must be one of quick|standard|deep' }, { status: 400 });
  }
  if (credentialMode === 'byok' && byokProvider && !isReasoningProvider(byokProvider)) {
    return json({ error: `${byokProvider} keys are not used for reasoning model runs yet.` }, { status: 400 });
  }
  if (credentialMode === 'byok' && !usingByok) {
    return json({ error: 'BYOK credential mode selected, but no active BYOK key is configured for the selected provider.' }, { status: 400 });
  }
  if (depthMode === 'deep' && !usingByok) {
    return json({ error: 'Deep searches require an active BYOK key. Select your key from Settings and run again.' }, { status: 403 });
  }
  if (credentialMode === 'platform' && modelProvider !== 'auto' && modelProvider !== 'vertex') {
    const providerLabel = getModelProviderLabel(modelProvider);
    return json(
      { error: `${providerLabel} models are BYOK only. Select your ${providerLabel} key to run this model.` },
      { status: 400 }
    );
  }
  if (credentialMode === 'byok' && byokProvider && modelProvider !== 'auto' && modelProvider !== byokProvider) {
    return json(
      { error: `Selected BYOK provider is ${byokProvider}, so model_provider must be ${byokProvider} or auto.` },
      { status: 400 }
    );
  }
  if (credentialMode === 'byok' && modelProvider !== 'auto') {
    const hasRequestedProviderKey = !!effectiveProviderApiKeys[modelProvider];
    if (!hasRequestedProviderKey) {
      return json(
        { error: `No active BYOK key is configured for provider ${modelProvider}.` },
        { status: 400 }
      );
    }
  }
  const effectiveModelProvider: ModelProvider =
    modelProvider === 'auto' && credentialMode === 'byok' && byokProvider && isReasoningProvider(byokProvider)
      ? byokProvider
      : modelProvider;

  if (modelId && modelProvider === 'auto') {
    return json({ error: `model_provider must be one of ${REASONING_PROVIDER_ORDER.join('|')} when model_id is provided` }, { status: 400 });
  }
  if (effectiveModelProvider !== 'auto') {
    const available = getAvailableReasoningModels({
      providerApiKeys: effectiveProviderApiKeys,
      includePlatformProviders: credentialMode !== 'byok',
      allowedProviders: [effectiveModelProvider]
    });
    if (available.length === 0) {
      return json({ error: `No active key is configured for provider ${effectiveModelProvider}.` }, { status: 400 });
    }
    if (modelId) {
      const exists = available.some((option) => option.id === modelId && option.provider === effectiveModelProvider);
      if (!exists) {
        return json({ error: `model_id ${modelId} is not available for provider ${effectiveModelProvider}` }, { status: 400 });
      }
    }
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
    effectiveModelProvider,
    modelId,
    domainMode,
    domain,
    resourceMode,
    normalizedUserLinks,
    ingestionPreferenceKey,
    queueForNightlyIngest
  );
  const constitutionInAnalyseEnabled =
    process.env.ENABLE_CONSTITUTION_IN_ANALYSE?.toLowerCase() === 'true';
  const billingEnabled = BILLING_FEATURE_ENABLED;
  const byokChargingEnabled = billingEnabled && BYOK_WALLET_CHARGING_ENABLED && usingByok;
  const byokShadowMode = byokChargingEnabled && BYOK_WALLET_SHADOW_MODE;

  if (
    selectedIngestionLinks.some((link) => link.visibilityScope === 'private_user_only') &&
    !uid
  ) {
    return json(
      { error: 'Authentication is required for private source ingestion.' },
      { status: 401 }
    );
  }

  let entitlementSummarySnapshot: EntitlementSummary | null = null;
  let walletSnapshot: Awaited<ReturnType<typeof ensureWallet>> | null = null;

  if (uid && billingEnabled) {
    try {
      [entitlementSummarySnapshot, walletSnapshot] = await Promise.all([
        getEntitlementSummary(uid),
        ensureWallet(uid)
      ]);
    } catch (err) {
      console.warn(
        '[BILLING] Failed to load billing snapshots for analyse:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (uid && selectedIngestionLinks.length > 0 && entitlementSummarySnapshot) {
    const preview = evaluateIngestionSelection(
      entitlementSummarySnapshot,
      selectedIngestionLinks.map((link) => link.visibilityScope)
    );
    if (!preview.allowed) {
      return json(
        {
          error: formatIngestionLimitError(preview.reason),
          reason: preview.reason,
          entitlements: entitlementSummarySnapshot
        },
        { status: 429 }
      );
    }
  }

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

  if (!cachedEvents && uid && byokChargingEnabled && !byokShadowMode) {
    const walletCheck = await assertByokWalletBalance(uid);
    if (!walletCheck.ok) {
      return json(
        {
          error:
            'Insufficient BYOK wallet balance for handling fees. Please top up your wallet to continue.',
          required_cents: walletCheck.requiredCents,
          available_cents: walletCheck.availableCents
        },
        { status: 402 }
      );
    }
    walletSnapshot = {
      availableCents: walletCheck.availableCents,
      currency: walletSnapshot?.currency ?? 'GBP'
    };
  }

  if (process.env.NODE_ENV !== 'test' && !cachedEvents && uid && !usingByok) {
    const budget = await consumePlatformBudget(uid, {
      depthMode,
      queryKind
    });
    if (!budget.allowed) {
      if (budget.reason === 'deep_requires_byok') {
        return json({ error: 'Deep searches require an active BYOK key.' }, { status: 403 });
      }
      if (budget.reason === 'standard_limit_reached') {
        return json(
          {
            error: 'Daily standard-search limit reached (3). Add BYOK for additional standard/deep runs.'
          },
          { status: 429 }
        );
      }
      if (budget.reason === 'follow_up_limit_reached') {
        return json(
          {
            error: 'Follow-up limit reached for your current standard runs. Start a new standard run or add BYOK.'
          },
          { status: 429 }
        );
      }
      return json(
        {
          error: 'Daily platform token budget reached. Add BYOK to continue running queries today.'
        },
        { status: 429 }
      );
    }
  }

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
      let latestQueueCommitCount = 0;
      let latestModelCostBreakdown:
        | {
            total_estimated_cost_usd: number;
          }
        | undefined;
      let byokEstimatedFeeCents = 0;
      let byokChargedFeeCents = 0;
      let byokFeeChargeStatus:
        | 'not_applicable'
        | 'pending'
        | 'shadow'
        | 'charged'
        | 'skipped'
        | 'insufficient' = usingByok
        ? byokChargingEnabled
          ? byokShadowMode
            ? 'shadow'
            : 'pending'
          : 'skipped'
        : 'not_applicable';
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
            latestModelCostBreakdown = modelCostBreakdown
              ? {
                  total_estimated_cost_usd: modelCostBreakdown.total_estimated_cost_usd
                }
              : undefined;
            byokEstimatedFeeCents = computeByokFeeCents(
              latestModelCostBreakdown?.total_estimated_cost_usd ?? 0
            );
            if (queueForNightlyIngest && nightlyIngestionEnabled) {
              queuePreviewCount = buildQueueCandidateRollup(
                selectedIngestionLinks,
                uid
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
              ...(entitlementSummarySnapshot
                ? {
                    billing_tier: entitlementSummarySnapshot.tier,
                    billing_status: entitlementSummarySnapshot.status,
                    billing_currency: entitlementSummarySnapshot.currency,
                    entitlement_month_key: entitlementSummarySnapshot.monthKey,
                    ingestion_public_used: entitlementSummarySnapshot.publicUsed,
                    ingestion_public_remaining: entitlementSummarySnapshot.publicRemaining,
                    ingestion_private_used: entitlementSummarySnapshot.privateUsed,
                    ingestion_private_remaining: entitlementSummarySnapshot.privateRemaining,
                    ingestion_selected_count: selectedIngestionLinks.length
                  }
                : {}),
              ...(walletSnapshot
                ? {
                    byok_wallet_currency: walletSnapshot.currency,
                    byok_wallet_available_cents: walletSnapshot.availableCents
                  }
                : {}),
              byok_fee_estimated_cents: byokEstimatedFeeCents,
              byok_fee_charged_cents: byokChargedFeeCents,
              byok_fee_charge_status: byokFeeChargeStatus,
              depth_mode: depthMode,
              selected_model_provider: effectiveModelProvider,
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
          modelProvider: effectiveModelProvider,
          modelId,
          domainMode,
          domain,
          viewerUid: uid,
          queryRunId,
          reuse: normalizedReuse,
          providerApiKeys: effectiveProviderApiKeys
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
              {
                text: queryText
              },
              { providerApiKeys: effectiveProviderApiKeys }
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
                queryText,
                { providerApiKeys: effectiveProviderApiKeys }
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
              includePassOutputs: false,
              providerApiKeys: effectiveProviderApiKeys
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
        const metadataEvent = replayEvents.find((event) => event.type === 'metadata') as
          | Record<string, unknown>
          | undefined;

        const patchMetadataEvent = (patch: Record<string, unknown>): void => {
          if (!metadataEvent) return;
          Object.assign(metadataEvent, patch);
        };

        if (!hasErrorEvent && hasMetadataEvent) {
          if (queueForNightlyIngest && nightlyIngestionEnabled && uid && selectedIngestionLinks.length > 0) {
            const entitlementConsume = await consumeIngestionEntitlements(
              uid,
              selectedIngestionLinks.map((link) => link.visibilityScope)
            );
            if (entitlementConsume.allowed) {
              entitlementSummarySnapshot = entitlementConsume.summary;
              latestQueueCommitCount = await enqueueDeferredLinkIngestion({
                uid,
                queryRunId,
                links: selectedIngestionLinks
              });
            } else {
              latestQueueCommitCount = 0;
              console.warn('[QUEUE] entitlement check failed at queue commit', {
                reason: entitlementConsume.reason,
                queryRunId
              });
            }
          } else {
            latestQueueCommitCount = 0;
          }

          if (latestQueueCommitCount !== queuePreviewCount) {
            console.log('[QUEUE] enqueue count mismatch', {
              preview: queuePreviewCount,
              committed: latestQueueCommitCount,
              queryRunId
            });
          }

          patchMetadataEvent({
            nightly_queue_enqueued: latestQueueCommitCount,
            ...(entitlementSummarySnapshot
              ? {
                  billing_tier: entitlementSummarySnapshot.tier,
                  billing_status: entitlementSummarySnapshot.status,
                  billing_currency: entitlementSummarySnapshot.currency,
                  entitlement_month_key: entitlementSummarySnapshot.monthKey,
                  ingestion_public_used: entitlementSummarySnapshot.publicUsed,
                  ingestion_public_remaining: entitlementSummarySnapshot.publicRemaining,
                  ingestion_private_used: entitlementSummarySnapshot.privateUsed,
                  ingestion_private_remaining: entitlementSummarySnapshot.privateRemaining,
                  ingestion_selected_count: selectedIngestionLinks.length
                }
              : {})
          });

          const estimatedRunCostUsd = latestModelCostBreakdown?.total_estimated_cost_usd ?? 0;
          byokEstimatedFeeCents = computeByokFeeCents(estimatedRunCostUsd);

          if (uid && byokChargingEnabled) {
            if (byokEstimatedFeeCents <= 0) {
              byokFeeChargeStatus = 'skipped';
              byokChargedFeeCents = 0;
            } else if (byokShadowMode) {
              byokFeeChargeStatus = 'shadow';
              byokChargedFeeCents = 0;
            } else {
              const byokCharge = await debitByokHandlingFee({
                uid,
                queryRunId,
                estimatedRunCostUsd,
                currency: walletSnapshot?.currency
              });
              byokChargedFeeCents = byokCharge.charged ? byokCharge.amountCents : 0;
              byokFeeChargeStatus = byokCharge.insufficient
                ? 'insufficient'
                : byokCharge.charged
                  ? 'charged'
                  : 'skipped';
              walletSnapshot = {
                availableCents: byokCharge.availableCents,
                currency: walletSnapshot?.currency ?? 'GBP'
              };
            }
          } else if (usingByok) {
            byokFeeChargeStatus = byokChargingEnabled ? 'pending' : 'skipped';
          } else {
            byokFeeChargeStatus = 'not_applicable';
          }

          patchMetadataEvent({
            byok_fee_estimated_cents: byokEstimatedFeeCents,
            byok_fee_charged_cents: byokChargedFeeCents,
            byok_fee_charge_status: byokFeeChargeStatus,
            ...(walletSnapshot
              ? {
                  byok_wallet_currency: walletSnapshot.currency,
                  byok_wallet_available_cents: walletSnapshot.availableCents
                }
              : {})
          });

          // A4: Save to Firestore (per-user)
          if (uid) {
            await saveFirestoreCache(uid, queryHash, queryText, lens, depthMode, effectiveModelProvider, modelId, domainMode, domain, replayEvents);
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
                model_provider: effectiveModelProvider,
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
