import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query as dbQuery } from '$lib/server/db';
import { consumeIngestionEntitlements } from '$lib/server/billing/entitlements';
import { hasOwnerRole } from '$lib/server/authRoles';

type QueueStatus = 'queued' | 'pending_review' | 'approved' | 'ingesting' | 'ingested' | 'failed' | 'rejected';
type IngestVisibilityScope = 'public_shared' | 'private_user_only';

type LinkQueueRow = {
  id: string;
  status?: QueueStatus;
  source_kinds?: string[];
  submitted_by_uids?: string[];
  pass_hints?: string[];
  user_submission_count?: number;
  total_submission_count?: number;
};

const DEFAULT_TRUSTED_INGESTION_DOMAINS = [
  'plato.stanford.edu',
  'iep.utm.edu',
  'arxiv.org',
  'philpapers.org',
  'stanford.edu',
  'ox.ac.uk',
  'cam.ac.uk'
];

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
  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
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
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

function getTrustedIngestionDomains(): string[] {
  const configured = (process.env.INGESTION_TRUSTED_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_TRUSTED_INGESTION_DOMAINS;
}

function selectQueueStatusForUrl(canonicalUrl: string): QueueStatus {
  try {
    const hostname = new URL(canonicalUrl).hostname.trim().toLowerCase();
    const trusted = getTrustedIngestionDomains().some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
    return trusted ? 'approved' : 'pending_review';
  } catch {
    return 'pending_review';
  }
}

function parseVisibility(value: unknown): IngestVisibilityScope {
  if (typeof value !== 'string') return 'public_shared';
  return value.trim().toLowerCase() === 'private_user_only' ? 'private_user_only' : 'public_shared';
}

function mergeUnique(existing: string[] | undefined, next: string[]): string[] {
  return [...new Set([...(existing ?? []), ...next])];
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const uid = locals.user?.uid ?? null;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: {
    url?: string;
    visibility_scope?: IngestVisibilityScope;
    title_hint?: string;
    acknowledge_public_share?: boolean;
    pass_hint?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.url !== 'string' || !body.url.trim()) {
    return json({ error: 'url is required' }, { status: 400 });
  }

  const canonicalUrl = canonicalizeQueueUrl(body.url);
  if (!canonicalUrl) {
    return json({ error: 'Invalid or blocked URL' }, { status: 400 });
  }

  const visibilityScope = parseVisibility(body.visibility_scope);
  if (
    visibilityScope === 'public_shared' &&
    body.acknowledge_public_share !== true
  ) {
    return json(
      { error: 'acknowledge_public_share=true is required for public source ingestion' },
      { status: 400 }
    );
  }

  const entitlement = await consumeIngestionEntitlements(uid, [visibilityScope], {
    bypassQuota: hasOwnerRole(locals.user)
  });
  if (!entitlement.allowed) {
    return json(
      { error: 'Ingestion quota exceeded for this billing period.', reason: entitlement.reason },
      { status: 429 }
    );
  }

  const hashKey =
    visibilityScope === 'private_user_only'
      ? `private_user_only::${uid}::${canonicalUrl}`
      : `public_shared::${canonicalUrl}`;
  const canonicalUrlHash = createHash('sha256').update(hashKey).digest('hex');
  const status = selectQueueStatusForUrl(canonicalUrl);

  const existingRows = await dbQuery<LinkQueueRow[]>(
    `SELECT id, status, source_kinds, submitted_by_uids, pass_hints, user_submission_count, total_submission_count
     FROM link_ingestion_queue
     WHERE canonical_url_hash = $canonical_url_hash
     LIMIT 1`,
    { canonical_url_hash: canonicalUrlHash }
  );
  const existing = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;

  if (existing?.id) {
    const nextStatus = existing.status === 'queued' ? 'queued' : existing.status === 'ingesting' ? 'ingesting' : status;
    await dbQuery(
      `UPDATE type::thing($id) MERGE {
         status: $status,
         visibility_scope: $visibility_scope,
         submitted_by_uid: $submitted_by_uid,
         submitted_by_uids: $submitted_by_uids,
         source_kinds: $source_kinds,
         pass_hints: $pass_hints,
         title_hint: if title_hint = NONE then $title_hint else title_hint end,
         user_submission_count: $user_submission_count,
         total_submission_count: $total_submission_count,
         last_submitted_at: time::now(),
         updated_at: time::now(),
         approved_at: if $status = 'approved' then time::now() else approved_at end
       } RETURN AFTER`,
      {
        id: existing.id,
        status: nextStatus,
        visibility_scope: visibilityScope,
        submitted_by_uid: uid,
        submitted_by_uids: mergeUnique(existing.submitted_by_uids, [uid]),
        source_kinds: mergeUnique(existing.source_kinds, ['user']),
        pass_hints: mergeUnique(existing.pass_hints, body.pass_hint?.trim() ? [body.pass_hint.trim()] : []),
        title_hint: body.title_hint?.trim() || null,
        user_submission_count: (existing.user_submission_count ?? 0) + 1,
        total_submission_count: (existing.total_submission_count ?? 0) + 1
      }
    );

    return json({
      queued: true,
      record_id: existing.id,
      canonical_url: canonicalUrl,
      status: nextStatus
    });
  }

  const createRows = await dbQuery<Array<{ id: string }>>(
    `CREATE link_ingestion_queue CONTENT {
       canonical_url: $canonical_url,
       canonical_url_hash: $canonical_url_hash,
       hostname: $hostname,
       visibility_scope: $visibility_scope,
       owner_uid: $owner_uid,
       contributor_uid: $contributor_uid,
       deletion_state: 'active',
       status: $status,
       source_kinds: ['user'],
       query_run_ids: [],
       latest_query_run_id: NONE,
       submitted_by_uid: $submitted_by_uid,
       submitted_by_uids: [$submitted_by_uid],
       title_hint: $title_hint,
       pass_hints: $pass_hints,
       user_submission_count: 1,
       grounding_submission_count: 0,
       total_submission_count: 1,
       attempt_count: 0,
       last_error: NONE,
       created_at: time::now(),
       queued_at: time::now(),
       last_submitted_at: time::now(),
       updated_at: time::now(),
       approved_at: if $status = 'approved' then time::now() else NONE end
     }`,
    {
      canonical_url: canonicalUrl,
      canonical_url_hash: canonicalUrlHash,
      hostname: new URL(canonicalUrl).hostname,
      visibility_scope: visibilityScope,
      owner_uid: visibilityScope === 'private_user_only' ? uid : null,
      contributor_uid: visibilityScope === 'public_shared' ? uid : null,
      submitted_by_uid: uid,
      status,
      title_hint: body.title_hint?.trim() || null,
      pass_hints: body.pass_hint?.trim() ? [body.pass_hint.trim()] : []
    }
  );

  return json(
    {
      queued: true,
      record_id: createRows?.[0]?.id ?? null,
      canonical_url: canonicalUrl,
      status
    },
    { status: 201 }
  );
};
