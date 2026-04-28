<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authorizedFetchJson } from '$lib/authorizedFetchJson';
  import IngestionSettingsShell from '$lib/components/admin/ingest/IngestionSettingsShell.svelte';
  import IngestionSectionShell from '$lib/components/admin/ingest/IngestionSectionShell.svelte';
  import JobsDlqTab, { type DlqRow } from '$lib/components/admin/ingest/jobs/JobsDlqTab.svelte';
  import JobsDurableRecoveryCard from '$lib/components/admin/ingest/jobs/JobsDurableRecoveryCard.svelte';

  type PanelId = 'dlq' | 'promote' | 'issues' | 'thinker' | 'ops' | 'cleanup';

  /** Single source of truth: URL `panel=` (fixes clicks that previously read stale state after `goto`). */
  const panel = $derived.by((): PanelId => {
    const raw = (page.url.searchParams.get('panel') ?? '').trim();
    if (
      raw === 'dlq' ||
      raw === 'promote' ||
      raw === 'issues' ||
      raw === 'thinker' ||
      raw === 'ops' ||
      raw === 'cleanup'
    ) {
      return raw;
    }
    return 'dlq';
  });

  const PANEL_LABELS: Record<PanelId, string> = {
    dlq: 'Dead letter queue',
    promote: 'Promote queue',
    issues: 'Embedding maintenance',
    thinker: 'Thinker link review',
    ops: 'Operations & recovery',
    cleanup: 'Neon cleanup'
  };

  /** Prefilled from `?jobId=` when opening Monitoring → Recover links. */
  let recoveryJobId = $state('');
  $effect(() => {
    recoveryJobId = page.url.searchParams.get('jobId')?.trim() ?? '';
  });

  function selectPanel(next: PanelId): void {
    if (typeof window === 'undefined') return;
    const url = new URL(page.url.href);
    url.searchParams.set('panel', next);
    void goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true });
    refreshCurrentPanelFor(next);
  }

  function refreshCurrentPanelFor(p: PanelId): void {
    if (p === 'dlq') void loadDlq();
    else if (p === 'promote') void loadPromote();
    else if (p === 'issues') void loadEmbeddingOverview();
    else if (p === 'thinker') void loadThinkerQueue();
    else if (p === 'ops') void loadOperations();
  }

  type NeonPromote = { id: string; sourceUrl: string; updatedAt: string };
  let awaitingNeon = $state<NeonPromote[]>([]);
  let promoteBusy = $state<Record<string, boolean>>({});
  let promoteMsg = $state('');

  async function loadPromote(): Promise<void> {
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/runs');
      awaitingNeon = Array.isArray(body?.awaitingPromoteNeon) ? (body.awaitingPromoteNeon as NeonPromote[]) : [];
    } catch (e) {
      promoteMsg = e instanceof Error ? e.message : 'Promote queue load failed';
      awaitingNeon = [];
    }
  }

  async function promoteNeonRun(runId: string): Promise<void> {
    promoteMsg = '';
    promoteBusy = { ...promoteBusy, [runId]: true };
    try {
      await authorizedFetchJson(`/api/admin/ingest/run/${encodeURIComponent(runId)}/promote`, {
        method: 'POST',
        jsonBody: { stop_before_store: true }
      });
      promoteMsg = 'Promoted.';
      await loadPromote();
    } catch (e) {
      promoteMsg = e instanceof Error ? e.message : 'Promote failed';
    } finally {
      promoteBusy = { ...promoteBusy, [runId]: false };
    }
  }

  // DLQ triage
  let dlqItems = $state<DlqRow[]>([]);
  let dlqLoading = $state(false);
  let dlqMessage = $state('');
  let dlqReplayBusy = $state(false);
  let dlqRemoveBusy = $state(false);
  let dlqSelected = $state<Record<string, boolean>>({});

  function toggleDlq(id: string): void {
    dlqSelected = { ...dlqSelected, [id]: !dlqSelected[id] };
  }

  async function loadDlq(): Promise<void> {
    dlqLoading = true;
    dlqMessage = '';
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/jobs/dlq?limit=200');
      dlqItems = Array.isArray(body?.items) ? (body.items as DlqRow[]) : [];
    } catch (e) {
      dlqMessage = e instanceof Error ? e.message : 'DLQ load failed';
      dlqItems = [];
    } finally {
      dlqLoading = false;
    }
  }

  async function replayDlqSelected(): Promise<void> {
    const ids = dlqItems.filter((x) => dlqSelected[x.itemId]).map((x) => x.itemId);
    if (ids.length === 0) {
      dlqMessage = 'Select at least one row.';
      return;
    }
    dlqReplayBusy = true;
    dlqMessage = '';
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/jobs/dlq', {
        method: 'POST',
        jsonBody: { itemIds: ids }
      });
      dlqMessage = `Replayed ${typeof body?.replayed === 'number' ? body.replayed : 0} item(s).`;
      dlqSelected = {};
      await loadDlq();
    } catch (e) {
      dlqMessage = e instanceof Error ? e.message : 'Replay failed';
    } finally {
      dlqReplayBusy = false;
    }
  }

  async function removeDlqSelected(): Promise<void> {
    const ids = dlqItems.filter((x) => dlqSelected[x.itemId]).map((x) => x.itemId);
    if (ids.length === 0) {
      dlqMessage = 'Select at least one row.';
      return;
    }
    dlqRemoveBusy = true;
    dlqMessage = '';
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/jobs/dlq', {
        method: 'DELETE',
        jsonBody: { itemIds: ids }
      });
      dlqMessage = `Removed ${typeof body?.removed === 'number' ? body.removed : 0} item(s).`;
      dlqSelected = {};
      await loadDlq();
    } catch (e) {
      dlqMessage = e instanceof Error ? e.message : 'Remove failed';
    } finally {
      dlqRemoveBusy = false;
    }
  }

  function exportDlqCsv(): void {
    if (dlqItems.length === 0) return;
    const esc = (s: string | null) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'itemId',
      'jobId',
      'url',
      'failureClass',
      'lastFailureKind',
      'attempts',
      'dlqReplayCount',
      'dlqEnqueuedAt',
      'lastError',
      'jobStatus',
      'jobNotes'
    ];
    const lines = [headers.join(',')];
    for (const r of dlqItems) {
      lines.push(
        [
          r.itemId,
          r.jobId,
          esc(r.url),
          r.failureClass ?? '',
          r.lastFailureKind ?? '',
          String(r.attempts),
          String(r.dlqReplayCount),
          r.dlqEnqueuedAt ?? '',
          esc(r.lastError),
          r.jobStatus ?? '',
          esc(r.jobNotes)
        ].join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sophia-dlq-${new Date().toISOString().slice(0, 19)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Admin operations (audit log) — matches `AdminOperationRecord` from GET /api/admin/operations
  type AdminOperation = {
    id: string;
    kind: string;
    status: string;
    payload: Record<string, unknown>;
    requested_by_email: string | null;
    validation_status: string;
    sync_status: string;
    attempts: number;
    result_summary: string | null;
    last_error: string | null;
    log_text: string;
    created_at: string | null;
    updated_at: string | null;
  };
  let opsBusy = $state(false);
  let opsErr = $state('');
  let operations = $state<AdminOperation[]>([]);
  let opsLimit = $state(25);
  let opsStatusFilter = $state<'all' | 'active' | 'failed' | 'succeeded' | 'cancelled'>('all');
  let opsActionBusy = $state<Record<string, boolean>>({});

  function adminOpKindLabel(kind: string): string {
    switch (kind) {
      case 'ingest_import':
        return 'Ingest / import';
      case 'validate':
        return 'Validate';
      case 'diagnose_doctor':
        return 'Diagnose';
      case 'replay_reingest':
        return 'Replay reingest';
      case 'repair_finalize':
        return 'Repair / finalize';
      case 'sync_to_surreal':
        return 'Sync to Surreal';
      default:
        return kind;
    }
  }

  function adminOpTargetLine(op: AdminOperation): string {
    const p = op.payload ?? {};
    if (typeof p.source_url === 'string' && p.source_url.trim()) return p.source_url.trim();
    if (typeof p.source_file === 'string' && p.source_file.trim()) return p.source_file.trim();
    if (typeof p.canonical_url_hash === 'string' && p.canonical_url_hash.trim()) {
      const h = p.canonical_url_hash.trim();
      return h.length > 14 ? `${h.slice(0, 12)}…` : h;
    }
    return '—';
  }

  function adminOpSummaryLine(op: AdminOperation): string {
    const err = op.last_error?.trim();
    if (err) return err;
    const s = op.result_summary?.trim();
    if (s) return s;
    return '—';
  }

  function formatRelativeTime(iso: string | null): string {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    const diffSec = Math.round((t - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const abs = Math.abs(diffSec);
    if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 604800) return rtf.format(Math.round(diffSec / 86400), 'day');
    return rtf.format(Math.round(diffSec / 604800), 'week');
  }

  function adminOpStatusClass(status: string): string {
    switch (status) {
      case 'succeeded':
        return 'op-pill op-pill--ok';
      case 'queued':
      case 'running':
        return 'op-pill op-pill--pending';
      case 'failed':
      case 'validation_failed':
      case 'sync_failed':
        return 'op-pill op-pill--err';
      case 'cancelled':
        return 'op-pill op-pill--muted';
      default:
        return 'op-pill';
    }
  }

  function passesOpsFilter(op: AdminOperation): boolean {
    switch (opsStatusFilter) {
      case 'all':
        return true;
      case 'active':
        return op.status === 'queued' || op.status === 'running';
      case 'failed':
        return op.status === 'failed' || op.status === 'validation_failed' || op.status === 'sync_failed';
      case 'succeeded':
        return op.status === 'succeeded';
      case 'cancelled':
        return op.status === 'cancelled';
      default:
        return true;
    }
  }

  const opsFiltered = $derived(operations.filter(passesOpsFilter));

  function canRetryAdminOp(op: AdminOperation): boolean {
    return ['failed', 'validation_failed', 'sync_failed', 'cancelled'].includes(op.status);
  }

  function canCancelAdminOp(op: AdminOperation): boolean {
    return op.status === 'queued' || op.status === 'running';
  }

  async function retryAdminOp(id: string): Promise<void> {
    opsErr = '';
    opsActionBusy = { ...opsActionBusy, [id]: true };
    try {
      await authorizedFetchJson(`/api/admin/operations/${encodeURIComponent(id)}/retry`, { method: 'POST' });
      await loadOperations();
    } catch (e) {
      opsErr = e instanceof Error ? e.message : String(e);
    } finally {
      opsActionBusy = { ...opsActionBusy, [id]: false };
    }
  }

  async function cancelAdminOp(id: string): Promise<void> {
    opsErr = '';
    opsActionBusy = { ...opsActionBusy, [id]: true };
    try {
      await authorizedFetchJson(`/api/admin/operations/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      await loadOperations();
    } catch (e) {
      opsErr = e instanceof Error ? e.message : String(e);
    } finally {
      opsActionBusy = { ...opsActionBusy, [id]: false };
    }
  }

  function statusRank(status: string): number {
    if (status === 'running' || status === 'queued') return 0;
    if (status === 'failed' || status === 'sync_failed' || status === 'validation_failed') return 1;
    if (status === 'cancelled') return 2;
    return 3;
  }

  async function loadOperations(): Promise<void> {
    opsBusy = true;
    opsErr = '';
    try {
      const limit = Math.max(5, Math.min(100, Math.trunc(Number(opsLimit) || 25)));
      const body = await authorizedFetchJson<{ operations: AdminOperation[] }>(
        `/api/admin/operations?limit=${encodeURIComponent(String(limit))}`
      );
      const rows = Array.isArray(body?.operations) ? body.operations : [];
      const normalized: AdminOperation[] = rows.map((r) => ({
        ...r,
        payload:
          typeof r.payload === 'object' && r.payload !== null && !Array.isArray(r.payload)
            ? (r.payload as Record<string, unknown>)
            : {},
        validation_status: typeof r.validation_status === 'string' ? r.validation_status : 'pending',
        sync_status: typeof r.sync_status === 'string' ? r.sync_status : 'pending',
        attempts: typeof r.attempts === 'number' ? r.attempts : 0
      }));
      operations = normalized
        .slice()
        .sort((a, b) => {
          const ra = statusRank(a.status);
          const rb = statusRank(b.status);
          if (ra !== rb) return ra - rb;
          const ta = Date.parse(a.updated_at ?? a.created_at ?? '') || 0;
          const tb = Date.parse(b.updated_at ?? b.created_at ?? '') || 0;
          return tb - ta;
        });
    } catch (e) {
      opsErr = e instanceof Error ? e.message : String(e);
      operations = [];
    } finally {
      opsBusy = false;
    }
  }

  // Issue resolution (embedding maintenance)
  type DimBucket = { dim: number | null; count: number };
  type Inventory = {
    targetDim: number;
    noneCount: number;
    dimBuckets: DimBucket[];
    needsWorkCount: number;
  };
  type ReembedJob = {
    id: string;
    status: string;
    stage: string;
    targetDim: number;
    processedCount: number;
    totalCount: number | null;
    batchSize: number;
    lastError: string | null;
    createdAt?: string;
    updatedAt?: string;
    completedAt?: string | null;
  };
  /** Ref-counted: parallel loads (e.g. onMount + panel switch) must not strand `embedBusy` true. */
  let embedLoadsInFlight = $state(0);
  const embedBusy = $derived(embedLoadsInFlight > 0);
  let embedErr = $state('');
  let embedJobsErr = $state('');
  let inventory = $state<Inventory | null>(null);
  let reembedJobs = $state<ReembedJob[]>([]);
  let reembedStartBusy = $state(false);
  let reembedStartMsg = $state('');
  let reembedBatchSize = $state(50);

  function reembedOverviewSignal(): AbortSignal | undefined {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      /* Longer than server inventory cap (180s) so the client does not abort first. */
      return AbortSignal.timeout(200_000);
    }
    return undefined;
  }

  async function loadEmbeddingOverview(): Promise<void> {
    embedLoadsInFlight++;
    embedErr = '';
    embedJobsErr = '';
    try {
      const signal = reembedOverviewSignal();
      const fetchOpts = signal ? { signal } : {};
      const [invResult, jobsResult] = await Promise.allSettled([
        authorizedFetchJson<Record<string, unknown>>('/api/admin/reembed/inventory', fetchOpts),
        authorizedFetchJson<Record<string, unknown>>('/api/admin/reembed/jobs?limit=20', fetchOpts)
      ]);

      if (invResult.status === 'fulfilled') {
        const invBody = invResult.value;
        inventory = (invBody?.inventory as Inventory) ?? null;
      } else {
        inventory = null;
        const r = invResult.reason;
        const msg =
          r instanceof Error
            ? r.name === 'AbortError' || r.message.includes('aborted')
              ? 'Inventory request timed out or was cancelled.'
              : r.message
            : 'Inventory request failed.';
        embedErr = msg;
      }

      if (jobsResult.status === 'fulfilled') {
        const jobsBody = jobsResult.value;
        reembedJobs = Array.isArray(jobsBody?.jobs) ? (jobsBody.jobs as ReembedJob[]) : [];
        embedJobsErr = '';
      } else {
        reembedJobs = [];
        const r = jobsResult.reason;
        const msg =
          r instanceof Error
            ? r.name === 'AbortError' || r.message.includes('aborted')
              ? 'Jobs request timed out or was cancelled.'
              : r.message
            : 'Jobs request failed.';
        embedJobsErr = msg;
      }
    } finally {
      embedLoadsInFlight--;
    }
  }

  async function startReembedJob(): Promise<void> {
    reembedStartBusy = true;
    reembedStartMsg = '';
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/reembed/jobs', {
        method: 'POST',
        jsonBody: { batch_size: Math.max(1, Math.min(500, Math.trunc(Number(reembedBatchSize) || 50))) }
      });
      reembedStartMsg = `Started job ${String(body?.id ?? '').slice(0, 10)}…`;
      await loadEmbeddingOverview();
    } catch (e) {
      reembedStartMsg = e instanceof Error ? e.message : 'Start failed';
    } finally {
      reembedStartBusy = false;
    }
  }

  // Thinker link review (queue triage) — map raw author strings → Wikidata QIDs; creates `thinker` + `authored` in Surreal.
  type ThinkerQueueItem = {
    id: string;
    status: string;
    raw_name: string;
    canonical_name: string;
    source_ids: string[];
    contexts: string[];
    proposed_qids: string[];
    proposed_labels: string[];
    seen_count: number;
    first_seen_at: string | null;
    last_seen_at: string | null;
  };

  type ThinkerSourcePreview = {
    id: string;
    url: string | null;
    title: string | null;
    author: string[] | null;
    source_type: string | null;
  };

  let thinkerBusy = $state(false);
  let thinkerErr = $state('');
  let thinkerMsg = $state('');
  let thinkerStatus = $state<'queued' | 'resolved' | 'rejected' | 'all'>('queued');
  let thinkerLimit = $state(40);
  let thinkerItems = $state<ThinkerQueueItem[]>([]);
  let thinkerSourcePreviewsByQueueId = $state<Record<string, ThinkerSourcePreview[]>>({});
  let thinkerDraftQid = $state<Record<string, string>>({});
  let thinkerDraftLabel = $state<Record<string, string>>({});
  let thinkerDraftNotes = $state<Record<string, string>>({});

  const kpiPromote = $derived(awaitingNeon.length);
  const kpiDlq = $derived(dlqItems.length);
  const kpiEmbedNeedsWork = $derived(inventory?.needsWorkCount ?? 0);
  const kpiThinkerQueued = $derived(thinkerItems.length);
  const kpiOpsNeedsAttention = $derived(
    operations.filter((op) => ['queued', 'running', 'failed', 'sync_failed', 'validation_failed'].includes(op.status)).length
  );

  function pickFirst(arr: unknown, fallback = ''): string {
    return Array.isArray(arr) && typeof arr[0] === 'string' ? (arr[0] as string) : fallback;
  }

  function wikidataSearchUrl(name: string): string {
    return `https://www.wikidata.org/w/index.php?search=${encodeURIComponent(name.trim())}`;
  }

  /** Accepts Q1234 or a wikidata.org wiki/entity URL; returns uppercase QID or ''. */
  function extractWikidataQid(raw: string): string {
    const s = raw.trim();
    if (!s) return '';
    const fromUrl = s.match(/wikidata\.org\/(?:wiki|entity)\/(Q\d+)/i);
    if (fromUrl) return fromUrl[1].toUpperCase();
    const m = s.match(/\bQ\d+\b/i);
    return m ? m[0].toUpperCase() : '';
  }

  function wikidataEntityUrl(qid: string): string {
    const id = extractWikidataQid(qid);
    return id ? `https://www.wikidata.org/wiki/${id}` : wikidataSearchUrl(qid);
  }

  function applyThinkerProposal(queueId: string, qid: string, label: string): void {
    const q = qid.trim();
    const lab = label.trim();
    thinkerDraftQid = { ...thinkerDraftQid, [queueId]: q };
    thinkerDraftLabel = { ...thinkerDraftLabel, [queueId]: lab || thinkerDraftLabel[queueId] || '' };
  }

  async function hydrateThinkerSourcePreviews(items: ThinkerQueueItem[]): Promise<void> {
    const idSet = new Set<string>();
    for (const it of items) {
      for (const sid of it.source_ids ?? []) {
        if (typeof sid === 'string' && sid.trim()) idSet.add(sid.trim());
      }
    }
    const ids = [...idSet].slice(0, 200);
    if (ids.length === 0) {
      thinkerSourcePreviewsByQueueId = {};
      return;
    }
    try {
      const body = await authorizedFetchJson<{ items: ThinkerSourcePreview[] }>('/api/admin/thinker-links/sources', {
        method: 'POST',
        jsonBody: { source_ids: ids }
      });
      const bySourceId = new Map<string, ThinkerSourcePreview>();
      for (const row of body.items ?? []) {
        bySourceId.set(row.id, row);
      }
      const next: Record<string, ThinkerSourcePreview[]> = {};
      for (const it of items) {
        next[it.id] = (it.source_ids ?? [])
          .map((sid) => bySourceId.get(sid))
          .filter((x): x is ThinkerSourcePreview => Boolean(x));
      }
      thinkerSourcePreviewsByQueueId = next;
    } catch {
      thinkerSourcePreviewsByQueueId = {};
    }
  }

  async function loadThinkerQueue(): Promise<void> {
    thinkerBusy = true;
    thinkerErr = '';
    thinkerMsg = '';
    try {
      const limit = Math.max(1, Math.min(200, Math.trunc(Number(thinkerLimit) || 40)));
      const body = await authorizedFetchJson<{ items: ThinkerQueueItem[] }>(
        `/api/admin/thinker-links/unresolved?status=${encodeURIComponent(thinkerStatus)}&limit=${encodeURIComponent(String(limit))}`
      );
      const items = Array.isArray(body?.items) ? body.items : [];
      thinkerItems = items;
      const nextQid: Record<string, string> = {};
      const nextLabel: Record<string, string> = {};
      const nextNotes: Record<string, string> = {};
      for (const it of items) {
        nextQid[it.id] = thinkerDraftQid[it.id] ?? pickFirst(it.proposed_qids, '');
        nextLabel[it.id] = thinkerDraftLabel[it.id] ?? pickFirst(it.proposed_labels, it.raw_name);
        nextNotes[it.id] = thinkerDraftNotes[it.id] ?? '';
      }
      thinkerDraftQid = nextQid;
      thinkerDraftLabel = nextLabel;
      thinkerDraftNotes = nextNotes;
      await hydrateThinkerSourcePreviews(items);
    } catch (e) {
      thinkerErr = e instanceof Error ? e.message : 'Thinker queue failed';
      thinkerItems = [];
      thinkerSourcePreviewsByQueueId = {};
    } finally {
      thinkerBusy = false;
    }
  }

  async function resolveThinkerItem(id: string): Promise<void> {
    thinkerMsg = '';
    thinkerErr = '';
    const wikidata_id = extractWikidataQid(thinkerDraftQid[id] ?? '');
    if (!wikidata_id) {
      thinkerErr = 'Enter a Wikidata QID (e.g. Q1234), paste an entity URL, or use a pipeline proposal.';
      return;
    }
    try {
      const res = await authorizedFetchJson<{ ok?: boolean; linked_sources?: number }>(
        `/api/admin/thinker-links/unresolved/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          jsonBody: {
            action: 'resolve',
            wikidata_id,
            label: (thinkerDraftLabel[id] ?? '').trim() || null,
            notes: (thinkerDraftNotes[id] ?? '').trim() || null
          }
        }
      );
      const n = res.linked_sources;
      thinkerMsg = typeof n === 'number' ? `Resolved · linked ${n} new source edge(s).` : 'Resolved.';
      await loadThinkerQueue();
    } catch (e) {
      thinkerErr = e instanceof Error ? e.message : 'Resolve failed';
    }
  }

  async function rejectThinkerItem(id: string): Promise<void> {
    thinkerMsg = '';
    thinkerErr = '';
    try {
      await authorizedFetchJson(`/api/admin/thinker-links/unresolved/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        jsonBody: { action: 'reject', notes: (thinkerDraftNotes[id] ?? '').trim() || null }
      });
      thinkerMsg = 'Rejected.';
      await loadThinkerQueue();
    } catch (e) {
      thinkerErr = e instanceof Error ? e.message : 'Reject failed';
    }
  }

  // Durable queue tick
  let tickBusy = $state(false);
  let tickMsg = $state('');
  async function tickDurableJobs(): Promise<void> {
    tickBusy = true;
    tickMsg = '';
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/jobs/tick', { method: 'POST' });
      tickMsg = `Ticked. jobs processed: ${String(body?.globalTickJobsProcessed ?? '—')}`;
      await Promise.all([loadDlq(), loadPromote(), loadOperations()]);
    } catch (e) {
      tickMsg = e instanceof Error ? e.message : 'Tick failed';
    } finally {
      tickBusy = false;
    }
  }

  // Cleanup: prune superseded failures
  type PruneResult = {
    candidateRunIds: string[];
    jobItemsDetached: number;
    sophiaDocumentsDeleted: number;
    ingestRunsDeleted: number;
    dryRun: boolean;
  };
  let pruneBusy = $state(false);
  let pruneErr = $state('');
  let prunePreview = $state<PruneResult | null>(null);
  let pruneLimit = $state(500);
  let pruneConfirmText = $state('');

  const pruneCanExecute = $derived(
    Boolean(prunePreview?.dryRun && prunePreview.candidateRunIds.length > 0)
  );

  async function previewPruneSupersededFailedRuns(): Promise<void> {
    pruneBusy = true;
    pruneErr = '';
    prunePreview = null;
    try {
      const body = await authorizedFetchJson<{ ok: true; result: PruneResult }>(
        '/api/admin/ingest/cleanup/prune-superseded-failed',
        { method: 'POST', jsonBody: { dryRun: true, limit: pruneLimit } }
      );
      prunePreview = body.result ?? null;
    } catch (e) {
      pruneErr = e instanceof Error ? e.message : 'Dry-run failed.';
    } finally {
      pruneBusy = false;
    }
  }

  async function executePruneSupersededFailedRuns(): Promise<void> {
    if (!pruneCanExecute) {
      pruneErr = 'Run a dry-run that finds at least one candidate before executing.';
      return;
    }
    if (pruneConfirmText.trim() !== 'PRUNE') {
      pruneErr = 'Type PRUNE in the confirmation field to proceed.';
      return;
    }
    pruneBusy = true;
    pruneErr = '';
    try {
      const body = await authorizedFetchJson<{ ok: true; result: PruneResult }>(
        '/api/admin/ingest/cleanup/prune-superseded-failed',
        { method: 'POST', jsonBody: { dryRun: false, limit: pruneLimit } }
      );
      prunePreview = body.result ?? null;
      pruneConfirmText = '';
      await Promise.all([loadDlq(), loadPromote(), loadOperations()]);
    } catch (e) {
      pruneErr = e instanceof Error ? e.message : 'Execute failed.';
    } finally {
      pruneBusy = false;
    }
  }

  function refreshCurrentPanel(): void {
    refreshCurrentPanelFor(panel);
  }

  onMount(() => {
    void Promise.all([
      loadDlq(),
      loadPromote(),
      loadEmbeddingOverview(),
      loadThinkerQueue(),
      loadOperations()
    ]);
  });
</script>

<svelte:head>
  <title>Triage — Operator</title>
</svelte:head>

<IngestionSettingsShell
  kicker="Admin"
  activeNav="triage"
  title="Triage"
  lead="Action queues for ingestion: replay DLQ items, promote stalled runs, fix embedding drift, resolve thinker links, and recover durable jobs. Use Monitoring for read-only investigation and gate summaries."
>
  <div class="op-panel mb-4 triage-overview">
    <div class="op-actions triage-overview__row" style="align-items:flex-end">
      <div>
        <p class="op-muted" style="margin:0 0 6px"><strong>Queue overview</strong></p>
        <p class="op-muted" style="margin:0; max-width: 40rem">
          Choose a workstream below. Counts refresh on load; use <strong>Refresh panel</strong> for the open queue only.
        </p>
      </div>
      <div class="op-actions triage-overview__actions" style="margin-bottom:0; margin-left:auto">
        <button type="button" class="op-btn op-btn-link" disabled={tickBusy} onclick={tickDurableJobs}>
          {tickBusy ? 'Ticking…' : 'Advance durable queues'}
        </button>
        <button type="button" class="op-btn op-btn-link" onclick={refreshCurrentPanel}>Refresh panel</button>
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/activity?panel=coverage">Monitoring · Inquiry corpus</a>
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/activity">Monitoring · Home</a>
      </div>
    </div>
    {#if tickMsg}
      <p class="op-muted" style="margin:10px 0 0">{tickMsg}</p>
    {/if}
    {#if promoteMsg}
      <p class="op-muted" style="margin:10px 0 0">{promoteMsg}</p>
    {/if}
  </div>

  <div class="op-kpi-grid triage-kpi-grid mb-3" role="tablist" aria-label="Triage workstreams">
    <button
      type="button"
      role="tab"
      class="op-kpi-card"
      class:op-kpi-card--active={panel === 'dlq'}
      aria-selected={panel === 'dlq'}
      onclick={() => selectPanel('dlq')}
    >
      <div class="op-kpi-top">
        <span class="op-kpi-k">DLQ</span>
        <span class="op-kpi-pill">Action</span>
      </div>
      <div class="op-kpi-v">{kpiDlq}</div>
      <div class="op-kpi-sub">Replay, remove, export CSV</div>
    </button>
    <button
      type="button"
      role="tab"
      class="op-kpi-card"
      class:op-kpi-card--active={panel === 'promote'}
      aria-selected={panel === 'promote'}
      onclick={() => selectPanel('promote')}
    >
      <div class="op-kpi-top">
        <span class="op-kpi-k">Promote</span>
        <span class="op-kpi-pill">Action</span>
      </div>
      <div class="op-kpi-v">{kpiPromote}</div>
      <div class="op-kpi-sub">Continue extraction-only runs</div>
    </button>
    <button
      type="button"
      role="tab"
      class="op-kpi-card"
      class:op-kpi-card--active={panel === 'issues'}
      aria-selected={panel === 'issues'}
      onclick={() => selectPanel('issues')}
    >
      <div class="op-kpi-top">
        <span class="op-kpi-k">Embedding</span>
        <span class="op-kpi-pill">Maintenance</span>
      </div>
      <div class="op-kpi-v">{kpiEmbedNeedsWork}</div>
      <div class="op-kpi-sub">Inventory + re-embed jobs</div>
    </button>
    <button
      type="button"
      role="tab"
      class="op-kpi-card"
      class:op-kpi-card--active={panel === 'thinker'}
      aria-selected={panel === 'thinker'}
      onclick={() => selectPanel('thinker')}
    >
      <div class="op-kpi-top">
        <span class="op-kpi-k">Thinker links</span>
        <span class="op-kpi-pill">Governance</span>
      </div>
      <div class="op-kpi-v">{kpiThinkerQueued}</div>
      <div class="op-kpi-sub">Map names → Wikidata</div>
    </button>
    <button
      type="button"
      role="tab"
      class="op-kpi-card"
      class:op-kpi-card--active={panel === 'ops'}
      aria-selected={panel === 'ops'}
      onclick={() => selectPanel('ops')}
    >
      <div class="op-kpi-top">
        <span class="op-kpi-k">Ops</span>
        <span class="op-kpi-pill">Attention</span>
      </div>
      <div class="op-kpi-v">{kpiOpsNeedsAttention}</div>
      <div class="op-kpi-sub">Job recovery + audit log</div>
    </button>
    <button
      type="button"
      role="tab"
      class="op-kpi-card"
      class:op-kpi-card--active={panel === 'cleanup'}
      aria-selected={panel === 'cleanup'}
      title="No queue counter — dry-run and confirm prunes for superseded failures"
      onclick={() => selectPanel('cleanup')}
    >
      <div class="op-kpi-top">
        <span class="op-kpi-k">Cleanup</span>
        <span class="op-kpi-pill">Neon</span>
      </div>
      <div class="op-kpi-v op-kpi-v--muted">Dry-run</div>
      <div class="op-kpi-sub">Prune superseded failed runs</div>
    </button>
  </div>

  <p class="op-triage-focus" role="status" aria-live="polite">
    <span class="op-muted">Now viewing</span>
    <strong class="op-triage-focus__title">{PANEL_LABELS[panel]}</strong>
  </p>

  {#if panel === 'promote'}
    <IngestionSectionShell title="Promote queue" description="Extraction-only runs ready to continue the pipeline.">
      {#if awaitingNeon.length === 0}
        <p class="op-muted">None.</p>
      {:else}
        <table class="op-table">
          <thead>
            <tr><th>Run</th><th>Source</th><th>Updated</th><th class="op-actions-col"></th></tr>
          </thead>
          <tbody>
            {#each awaitingNeon as r (r.id)}
              <tr>
                <td class="op-mono">{r.id.slice(0, 10)}…</td>
                <td class="op-ellip">{r.sourceUrl}</td>
                <td class="op-mono sm">{r.updatedAt}</td>
                <td class="op-actions-col">
                  <button type="button" class="op-mini" disabled={promoteBusy[r.id]} onclick={() => void promoteNeonRun(r.id)}>
                    {promoteBusy[r.id] ? '…' : 'Promote'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </IngestionSectionShell>
  {:else if panel === 'issues'}
    <IngestionSectionShell
      title="Embedding maintenance"
      description="Surreal claim embeddings are counted here; durable re-embed jobs live in Neon (DATABASE_URL + migrations). Default inventory wait is 30s; for slow Surreal Cloud set ADMIN_REEMBED_INVENTORY_TIMEOUT_MS on the server (up to 180000)."
    >
      <button slot="actions" type="button" class="op-btn op-btn-link" disabled={embedBusy} onclick={() => void loadEmbeddingOverview()}>
        {embedBusy ? 'Loading…' : 'Refresh'}
      </button>
      {#if embedBusy}
        <p class="op-muted embed-loading" role="status">Loading inventory (Surreal) and recent jobs (Neon)…</p>
      {/if}
      {#if embedErr}
        <p class="op-err" role="alert">
          <strong>Inventory:</strong>
          {embedErr}
        </p>
      {/if}
      {#if embedJobsErr}
        <p class="op-err" role="alert">
          <strong>Recent jobs:</strong>
          {embedJobsErr}
        </p>
      {/if}
      {#if inventory}
        <div class="op-muted embed-inventory-summary">
          Target dim <span class="op-mono">{inventory.targetDim}</span> · needs work{' '}
          <span class="op-mono">{inventory.needsWorkCount}</span> · missing dim{' '}
          <span class="op-mono">{inventory.noneCount}</span>
        </div>
      {:else if !embedBusy && !embedErr}
        <p class="op-muted embed-inventory-summary">No inventory loaded yet. Use Refresh, or check that Surreal is reachable from the app.</p>
      {/if}
      <div class="op-actions embed-actions">
        <div class="embed-field">
          <label class="embed-field__label" for="reembedBatchSize">Batch size</label>
          <input id="reembedBatchSize" class="op-select embed-batch-input" type="number" min="1" max="500" bind:value={reembedBatchSize} />
        </div>
        <button
          type="button"
          class="op-btn op-btn-primary embed-start-btn"
          disabled={embedBusy || reembedStartBusy}
          onclick={() => void startReembedJob()}
        >
          {reembedStartBusy ? 'Starting…' : 'Start re-embed job'}
        </button>
        {#if reembedStartMsg}
          <span class="op-muted embed-start-msg">{reembedStartMsg}</span>
        {/if}
      </div>
      {#if reembedJobs.length === 0}
        <p class="op-muted">No recent jobs.</p>
      {:else}
        <table class="op-table embed-jobs-table" style="margin-top: 10px">
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Stage</th>
              <th>Progress</th>
              <th>Last error</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {#each reembedJobs as j (j.id)}
              <tr>
                <td class="op-mono">{j.id.slice(0, 12)}…</td>
                <td class="op-mono">{j.status}</td>
                <td class="op-mono sm">{j.stage}</td>
                <td class="op-mono sm">{j.processedCount}/{j.totalCount ?? '—'}</td>
                <td class="embed-job-err" title={j.lastError ?? undefined}>{j.lastError?.trim() ? j.lastError : '—'}</td>
                <td class="op-mono sm">{j.updatedAt ?? j.createdAt ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </IngestionSectionShell>
  {:else if panel === 'thinker'}
    <IngestionSectionShell
      title="Thinker link review (governance)"
      description="Ingestion surfaced author strings that are not yet linked to a Wikidata philosopher. Resolve by choosing the correct QID: the graph gets a thinker record, authored edges to the listed sources, and an alias for future matches. Reject if the string is not a person (fiction, typo, collective)."
    >
      <button slot="actions" type="button" class="op-btn op-btn-link" disabled={thinkerBusy} onclick={() => void loadThinkerQueue()}>
        {thinkerBusy ? 'Loading…' : 'Refresh'}
      </button>
      <div class="op-actions thinker-toolbar" style="margin-top: 0">
        <label class="op-muted" for="thinkerStatus">Status</label>
        <select id="thinkerStatus" class="op-select" bind:value={thinkerStatus} onchange={() => void loadThinkerQueue()}>
          <option value="queued">queued</option>
          <option value="resolved">resolved</option>
          <option value="rejected">rejected</option>
          <option value="all">all</option>
        </select>
        <label class="op-muted" for="thinkerLimit">Limit</label>
        <input id="thinkerLimit" class="op-select" type="number" min="1" max="200" bind:value={thinkerLimit} />
        <button type="button" class="op-btn op-btn-link" onclick={() => void loadThinkerQueue()}>Apply</button>
        {#if thinkerMsg}
          <span class="op-muted">{thinkerMsg}</span>
        {/if}
      </div>
      {#if thinkerErr}
        <p class="op-err" role="alert">{thinkerErr}</p>
      {/if}
      {#if thinkerItems.length === 0}
        <p class="op-muted">No items for this filter.</p>
      {:else}
        <table class="op-table thinker-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Evidence</th>
              <th>Pipeline proposals</th>
              <th>Wikidata</th>
              <th class="op-actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each thinkerItems as it (it.id)}
              {@const previews = thinkerSourcePreviewsByQueueId[it.id] ?? []}
              <tr>
                <td class="thinker-name-cell">
                  <div class="thinker-name">{it.raw_name}</div>
                  <div class="op-subtle">
                    {it.canonical_name} · seen {it.seen_count}
                    {#if it.last_seen_at}
                      · last {it.last_seen_at}
                    {/if}
                  </div>
                  <div class="thinker-name-tools">
                    <a
                      class="op-a"
                      href={wikidataSearchUrl(it.raw_name)}
                      target="_blank"
                      rel="noreferrer"
                      title="Open Wikidata search in a new tab"
                    >
                      Search Wikidata
                    </a>
                  </div>
                </td>
                <td class="thinker-evidence-cell">
                  {#if it.contexts?.length}
                    <ul class="thinker-contexts">
                      {#each it.contexts as ctx (ctx)}
                        <li class="thinker-context-line">{ctx}</li>
                      {/each}
                    </ul>
                  {:else}
                    <span class="op-muted">—</span>
                  {/if}
                  {#if previews.length > 0}
                    <details class="thinker-sources-details">
                      <summary>Sources ({previews.length})</summary>
                      <ul class="thinker-sources-list">
                        {#each previews as s (s.id)}
                          <li>
                            {#if s.url}
                              <a class="op-a" href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a>
                            {:else}
                              <span class="op-mono sm">{s.title ?? s.id}</span>
                            {/if}
                            {#if s.source_type}
                              <span class="op-subtle"> · {s.source_type}</span>
                            {/if}
                            {#if s.author?.length}
                              <span class="op-subtle"> · author: {s.author.join(', ')}</span>
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    </details>
                  {:else if (it.source_ids?.length ?? 0) > 0}
                    <p class="op-muted thinker-sources-pending">Resolving source titles…</p>
                  {/if}
                </td>
                <td class="thinker-proposals-cell">
                  {#if it.proposed_qids?.length}
                    <div class="thinker-proposal-chips">
                      {#each it.proposed_qids as qid, qi (qid + String(qi))}
                        {@const plab = it.proposed_labels[qi] ?? ''}
                        <div class="thinker-proposal-row">
                          <button
                            type="button"
                            class="op-btn op-btn-link thinker-use-proposal"
                            title="Fill Wikidata + label from pipeline"
                            onclick={() => applyThinkerProposal(it.id, qid, plab)}
                          >
                            Use {qid}{plab ? ` · ${plab}` : ''}
                          </button>
                          <a class="op-a thinker-wd-entity" href={wikidataEntityUrl(qid)} target="_blank" rel="noreferrer">
                            View
                          </a>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <span class="op-muted">None yet — search or paste a QID.</span>
                  {/if}
                </td>
                <td class="thinker-wd-cell">
                  <input
                    id="thinker-qid-{it.id}"
                    class="op-select thinker-input"
                    placeholder="Q1234 or paste entity URL"
                    aria-label="Wikidata QID for {it.raw_name}"
                    bind:value={thinkerDraftQid[it.id]}
                  />
                  <input
                    id="thinker-label-{it.id}"
                    class="op-select thinker-input"
                    placeholder="Label (optional)"
                    aria-label="Display label for {it.raw_name}"
                    bind:value={thinkerDraftLabel[it.id]}
                  />
                  <input
                    id="thinker-notes-{it.id}"
                    class="op-select thinker-input"
                    placeholder="Resolver notes (optional)"
                    aria-label="Resolver notes for {it.raw_name}"
                    bind:value={thinkerDraftNotes[it.id]}
                  />
                </td>
                <td class="op-actions-col">
                  <div class="op-btn-row thinker-actions">
                    <button type="button" class="op-mini" disabled={thinkerBusy} onclick={() => void resolveThinkerItem(it.id)}>
                      Resolve
                    </button>
                    <button type="button" class="op-mini" disabled={thinkerBusy} onclick={() => void rejectThinkerItem(it.id)}>
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </IngestionSectionShell>
  {:else if panel === 'ops'}
    <div class="mb-6">
      <JobsDurableRecoveryCard
        bind:jobId={recoveryJobId}
        onAfterAction={async () => {
          await tickDurableJobs();
          await loadOperations();
        }}
      />
    </div>
    <IngestionSectionShell
      title="Admin operations"
      description="Background jobs started from the admin console (ingest, validate, sync). Use filters to focus on failures; open logs for full stdout. Retry re-queues a finished job; cancel stops a queued job or signals a running one."
    >
      <div class="op-actions ops-admin-toolbar">
        <label class="op-muted" for="opsStatusFilter">Show</label>
        <select id="opsStatusFilter" class="op-select" bind:value={opsStatusFilter}>
          <option value="all">All</option>
          <option value="active">Active (queued / running)</option>
          <option value="failed">Failed</option>
          <option value="succeeded">Succeeded</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <label class="op-muted" for="opsLimit">Limit</label>
        <input id="opsLimit" class="op-select" type="number" min="5" max="100" bind:value={opsLimit} />
        <button type="button" class="op-btn op-btn-link" disabled={opsBusy} onclick={loadOperations}>
          {opsBusy ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {#if opsErr}
        <p class="op-err" role="alert">{opsErr}</p>
      {/if}
      {#if operations.length === 0}
        <p class="op-muted">None returned.</p>
      {:else if opsFiltered.length === 0}
        <p class="op-muted">No operations match this filter ({operations.length} loaded).</p>
      {:else}
        <table class="op-table ops-admin-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Target</th>
              <th>Status</th>
              <th>Outcome</th>
              <th>When</th>
              <th class="op-actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each opsFiltered as op (op.id)}
              <tr>
                <td class="ops-admin-op-cell">
                  <div class="ops-admin-kind">{adminOpKindLabel(op.kind)}</div>
                  <div class="op-subtle op-mono sm">
                    {op.id.slice(0, 12)}…{#if op.requested_by_email} · {op.requested_by_email}{/if}
                    {#if op.attempts > 1}
                      · attempt {op.attempts}
                    {/if}
                  </div>
                </td>
                <td class="ops-admin-target">
                  <span class="ops-admin-target-text" title={adminOpTargetLine(op)}>{adminOpTargetLine(op)}</span>
                </td>
                <td>
                  <span class={adminOpStatusClass(op.status)}>{op.status.replace(/_/g, ' ')}</span>
                  {#if !(op.validation_status === 'pending' && op.sync_status === 'pending')}
                    <div class="op-subtle sm ops-admin-substatus">
                      val {op.validation_status} · sync {op.sync_status}
                    </div>
                  {/if}
                </td>
                <td class="ops-admin-outcome">
                  {adminOpSummaryLine(op)}
                </td>
                <td class="ops-admin-when">
                  <span title={op.updated_at ?? op.created_at ?? ''}>{formatRelativeTime(op.updated_at ?? op.created_at)}</span>
                </td>
                <td class="op-actions-col">
                  <div class="op-btn-row ops-admin-row-actions">
                    {#if canRetryAdminOp(op)}
                      <button
                        type="button"
                        class="op-mini"
                        disabled={Boolean(opsActionBusy[op.id])}
                        onclick={() => void retryAdminOp(op.id)}
                      >
                        {opsActionBusy[op.id] ? '…' : 'Retry'}
                      </button>
                    {/if}
                    {#if canCancelAdminOp(op)}
                      <button
                        type="button"
                        class="op-mini"
                        disabled={Boolean(opsActionBusy[op.id])}
                        onclick={() => void cancelAdminOp(op.id)}
                      >
                        Cancel
                      </button>
                    {/if}
                    <details class="ops-admin-details">
                      <summary class="op-a">Logs</summary>
                      {#if op.last_error}
                        <p class="op-err ops-admin-detail-first">{op.last_error}</p>
                      {/if}
                      {#if op.result_summary}
                        <p class="op-muted ops-admin-detail-first">{op.result_summary}</p>
                      {/if}
                      {#if op.log_text}
                        <pre class="op-mono sm ops-admin-log">{op.log_text}</pre>
                      {:else}
                        <p class="op-muted ops-admin-detail-first">No logs.</p>
                      {/if}
                    </details>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </IngestionSectionShell>
  {:else if panel === 'cleanup'}
    <IngestionSectionShell
      title="Cleanup (Neon)"
      description="Remove superseded failed ingest runs from Neon when a later successful run exists for the same source. Always run a dry-run first: it only reads metadata and shows what would be deleted."
    >
      <div class="prune-flow">
        <section class="prune-step" aria-labelledby="prune-step1-title">
          <h3 id="prune-step1-title" class="prune-step__heading">Step 1 — Preview (dry-run)</h3>
          <p class="prune-step__lead">
            Scans up to the limit below for failed runs that are safe to drop because a newer run completed successfully.
            No rows are deleted in this step.
          </p>
          <div class="prune-grid">
            <div class="prune-field">
              <label class="prune-field__label" for="pruneLimit">Max candidates to scan</label>
              <input
                id="pruneLimit"
                class="prune-input"
                type="number"
                min="1"
                max="10000"
                bind:value={pruneLimit}
              />
              <p class="prune-field__hint">Range 1–10,000. Use a lower value if the request is slow or times out.</p>
            </div>
            <div class="prune-field prune-field--btn">
              <button
                type="button"
                class="op-btn op-btn-primary prune-dryrun-btn"
                disabled={pruneBusy}
                onclick={previewPruneSupersededFailedRuns}
              >
                {pruneBusy ? 'Scanning…' : 'Run dry-run'}
              </button>
            </div>
          </div>
        </section>

        {#if pruneErr}
          <p class="op-err prune-alert" role="alert">{pruneErr}</p>
        {/if}

        {#if prunePreview}
          <section
            class="prune-step prune-results"
            class:prune-results--executed={!prunePreview.dryRun}
            aria-labelledby="prune-results-title"
          >
            <h3 id="prune-results-title" class="prune-step__heading">
              {prunePreview.dryRun ? 'Dry-run results' : 'Last execution'}
            </h3>
            {#if prunePreview.dryRun && prunePreview.candidateRunIds.length === 0}
              <p class="prune-results__empty">No superseded failures matched — nothing to prune for this limit.</p>
            {:else}
              <dl class="prune-stats">
                <div class="prune-stat">
                  <dt>Candidate runs</dt>
                  <dd class="op-mono">{prunePreview.candidateRunIds.length}</dd>
                </div>
                <div class="prune-stat">
                  <dt>Job items detached</dt>
                  <dd class="op-mono">{prunePreview.jobItemsDetached}</dd>
                </div>
                <div class="prune-stat">
                  <dt>Sophia documents removed</dt>
                  <dd class="op-mono">{prunePreview.sophiaDocumentsDeleted}</dd>
                </div>
                <div class="prune-stat">
                  <dt>Ingest runs removed</dt>
                  <dd class="op-mono">{prunePreview.ingestRunsDeleted}</dd>
                </div>
              </dl>
              {#if prunePreview.candidateRunIds.length > 0}
                <details class="prune-details">
                  <summary>Candidate run IDs ({prunePreview.candidateRunIds.length})</summary>
                  <pre class="prune-pre">{JSON.stringify(prunePreview.candidateRunIds, null, 2)}</pre>
                </details>
              {/if}
            {/if}
          </section>
        {/if}

        <section
          class="prune-step prune-step--danger"
          class:prune-step--disabled={!pruneCanExecute}
          aria-labelledby="prune-step2-title"
        >
          <h3 id="prune-step2-title" class="prune-step__heading">Step 2 — Execute delete</h3>
          <p class="prune-step__lead">
            {#if !pruneCanExecute}
              Run step 1 and ensure the dry-run reports at least one candidate. Then type <span class="op-mono">PRUNE</span> to
              confirm permanent deletion of the listed rows.
            {:else}
              This will detach job items and delete the superseded failed runs and related documents for the candidates shown
              above. Type <span class="op-mono">PRUNE</span> exactly to confirm.
            {/if}
          </p>
          <div class="prune-execute-row">
            <div class="prune-field prune-field--grow">
              <label class="prune-field__label" for="pruneConfirm">Confirmation</label>
              <input
                id="pruneConfirm"
                class="prune-input prune-input--mono"
                bind:value={pruneConfirmText}
                placeholder="Type PRUNE"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                disabled={!pruneCanExecute || pruneBusy}
              />
            </div>
            <button
              type="button"
              class="op-btn prune-execute-btn"
              disabled={pruneBusy || !pruneCanExecute}
              onclick={executePruneSupersededFailedRuns}
            >
              {pruneBusy ? 'Working…' : 'Delete superseded rows'}
            </button>
          </div>
        </section>
      </div>
    </IngestionSectionShell>
  {:else}
    <div class="mb-6">
      <JobsDurableRecoveryCard
        bind:jobId={recoveryJobId}
        onAfterAction={async () => {
          await loadDlq();
          await tickDurableJobs();
        }}
      />
    </div>
    <JobsDlqTab
      neonDisabled={false}
      {dlqItems}
      {dlqLoading}
      {dlqMessage}
      {dlqReplayBusy}
      {dlqRemoveBusy}
      dlqSelected={dlqSelected}
      onToggleDlq={toggleDlq}
      onReplaySelected={() => void replayDlqSelected()}
      onRemoveSelected={() => void removeDlqSelected()}
      onExportCsv={exportDlqCsv}
      onRefreshDlq={() => void loadDlq()}
      onBackToDashboard={() => (window.location.href = '/admin/ingest')}
    />
  {/if}
</IngestionSettingsShell>

<style>
  .triage-overview__row {
    flex-wrap: wrap;
    gap: 12px;
  }
  .triage-overview__actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* Operator control primitives (this page is not under operator/+page.svelte scoped styles). */
  .op-panel {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 12px;
    padding: 16px;
  }
  .op-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin-top: 12px;
  }
  .op-actions > label.op-muted {
    margin: 0;
    align-self: center;
  }
  .op-btn {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    cursor: pointer;
    font-size: 0.88rem;
    color: var(--color-text);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
  }
  .op-btn-primary {
    border-color: color-mix(in srgb, var(--color-sage) 40%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 12%, var(--color-surface));
  }
  .op-btn-link {
    background: transparent;
  }
  .op-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .op-select {
    min-height: 36px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
    margin-bottom: 0;
    box-sizing: border-box;
  }
  .op-muted {
    font-size: 0.88rem;
    opacity: 0.85;
  }
  .op-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }
  .op-table th,
  .op-table td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
    vertical-align: top;
  }
  .op-actions-col {
    white-space: nowrap;
    width: 1%;
  }
  .op-btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }
  .op-mini {
    font-size: 0.72rem;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--color-border) 90%, transparent);
    background: var(--color-surface);
    cursor: pointer;
    color: var(--color-text);
  }
  .op-mini:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .op-ellip {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .op-mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.78rem;
  }
  .op-mono.sm {
    font-size: 0.72rem;
    word-break: break-all;
  }
  .op-subtle {
    display: block;
    font-size: 0.75rem;
    opacity: 0.75;
    margin-top: 4px;
  }
  .op-a {
    color: var(--color-blue);
  }
  .op-err {
    color: #f87171;
    font-size: 0.88rem;
  }

  .triage-kpi-grid {
    display: grid;
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: 10px;
  }
  @media (min-width: 640px) {
    .triage-kpi-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1100px) {
    .triage-kpi-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .op-kpi-card {
    text-align: left;
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    border-radius: 12px;
    padding: 12px 14px;
    cursor: pointer;
    font: inherit;
    color: inherit;
    width: 100%;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease,
      background 0.12s ease;
  }
  .op-kpi-card:hover {
    border-color: color-mix(in srgb, var(--color-sage) 35%, var(--color-border));
  }
  .op-kpi-card:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-blue) 55%, transparent);
    outline-offset: 2px;
  }
  .op-kpi-card--active {
    border-color: color-mix(in srgb, var(--color-sage) 50%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 12%, var(--color-surface));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-sage) 25%, transparent);
  }

  .op-kpi-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .op-kpi-k {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.85;
  }
  .op-kpi-pill {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.7rem;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    opacity: 0.9;
  }
  .op-kpi-v {
    margin-top: 8px;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 1.55rem;
    color: var(--color-text);
  }
  .op-kpi-v--muted {
    font-size: 1rem;
    opacity: 0.75;
    font-weight: 600;
  }
  .op-kpi-sub {
    margin-top: 6px;
    font-size: 0.82rem;
    opacity: 0.8;
  }

  .op-triage-focus {
    margin: 0 0 16px;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .op-triage-focus__title {
    margin-left: 6px;
    font-weight: 650;
  }

  .thinker-toolbar {
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .thinker-table :is(th, td) {
    vertical-align: top;
  }

  .thinker-name {
    font-weight: 650;
  }

  .thinker-name-tools {
    margin-top: 8px;
    font-size: 0.85rem;
  }

  .thinker-contexts {
    margin: 0;
    padding-left: 1.15rem;
    max-width: min(28rem, 100%);
  }

  .thinker-context-line {
    font-size: 0.84rem;
    line-height: 1.4;
    opacity: 0.92;
  }

  .thinker-sources-details summary {
    cursor: pointer;
    margin-top: 10px;
    font-size: 0.84rem;
  }

  .thinker-sources-list {
    margin: 6px 0 0;
    padding-left: 1.15rem;
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .thinker-sources-pending {
    margin: 8px 0 0;
    font-size: 0.82rem;
  }

  .thinker-proposal-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 12px;
    margin-bottom: 8px;
  }

  .thinker-proposal-row:last-child {
    margin-bottom: 0;
  }

  .thinker-use-proposal {
    text-align: left;
    padding: 0;
    max-width: 100%;
  }

  .thinker-wd-cell .thinker-input {
    display: block;
    width: 100%;
    max-width: 16rem;
    margin-bottom: 0;
  }

  .thinker-wd-cell .thinker-input + .thinker-input {
    margin-top: 8px;
  }

  .thinker-actions {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .op-pill {
    display: inline-block;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  }
  .op-pill--ok {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
    color: color-mix(in srgb, var(--color-sage) 90%, var(--color-text));
    background: color-mix(in srgb, var(--color-sage) 12%, transparent);
  }
  .op-pill--pending {
    border-color: color-mix(in srgb, var(--color-blue) 35%, var(--color-border));
    color: color-mix(in srgb, var(--color-blue) 85%, var(--color-text));
    background: color-mix(in srgb, var(--color-blue) 10%, transparent);
  }
  .op-pill--err {
    border-color: color-mix(in srgb, #f87171 40%, var(--color-border));
    color: color-mix(in srgb, #fecaca 75%, var(--color-text));
    background: color-mix(in srgb, #7f1d1d 18%, transparent);
  }
  .op-pill--muted {
    opacity: 0.88;
  }

  .ops-admin-toolbar {
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .ops-admin-table :is(th, td) {
    vertical-align: top;
  }

  .ops-admin-kind {
    font-weight: 650;
  }

  .ops-admin-target {
    max-width: 14rem;
  }

  .ops-admin-target-text {
    display: block;
    font-size: 0.82rem;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ops-admin-outcome {
    max-width: 18rem;
    font-size: 0.84rem;
    line-height: 1.4;
    word-break: break-word;
  }

  .ops-admin-substatus {
    margin-top: 6px;
    font-size: 0.72rem;
  }

  .ops-admin-when {
    font-size: 0.82rem;
    white-space: nowrap;
  }

  .ops-admin-row-actions {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .ops-admin-details summary {
    cursor: pointer;
  }

  .ops-admin-detail-first {
    margin: 10px 0 0;
  }

  .ops-admin-log {
    margin: 10px 0 0;
    max-height: 240px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Neon cleanup (prune superseded failures) */
  .prune-flow {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .prune-step {
    border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
    border-radius: 12px;
    padding: 16px 18px;
    background: color-mix(in srgb, var(--color-surface) 96%, black 4%);
  }
  .prune-step--danger {
    border-color: color-mix(in srgb, #f87171 28%, var(--color-border));
    background: color-mix(in srgb, #7f1d1d 8%, var(--color-surface));
  }
  .prune-step--disabled.prune-step--danger {
    opacity: 0.72;
    border-color: color-mix(in srgb, var(--color-border) 90%, transparent);
    background: color-mix(in srgb, var(--color-surface) 96%, black 4%);
  }
  .prune-step__heading {
    margin: 0 0 8px;
    font-family: var(--font-serif);
    font-size: 1rem;
    font-weight: 650;
    color: var(--color-text);
  }
  .prune-step__lead {
    margin: 0 0 16px;
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--color-text);
    opacity: 0.92;
    max-width: 52rem;
  }
  .prune-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: 1fr;
    align-items: end;
  }
  @media (min-width: 640px) {
    .prune-grid {
      grid-template-columns: minmax(0, 16rem) auto;
    }
  }
  .prune-field {
    min-width: 0;
  }
  .prune-field--btn {
    display: flex;
    align-items: flex-end;
  }
  .prune-field__label {
    display: block;
    font-size: 0.8rem;
    font-weight: 600;
    margin: 0 0 6px;
    color: var(--color-text);
    opacity: 0.88;
  }
  .prune-field__hint {
    margin: 6px 0 0;
    font-size: 0.78rem;
    line-height: 1.4;
    opacity: 0.75;
  }
  .prune-input {
    width: 100%;
    max-width: 16rem;
    box-sizing: border-box;
    min-height: 40px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.9rem;
  }
  .prune-input:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .prune-input--mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    max-width: none;
  }
  .prune-dryrun-btn {
    min-height: 40px;
  }
  .prune-alert {
    margin: 0;
  }
  .prune-results--executed {
    border-color: color-mix(in srgb, var(--color-sage) 35%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 10%, var(--color-surface));
  }
  .prune-results__empty {
    margin: 0;
    font-size: 0.88rem;
    opacity: 0.88;
  }
  .prune-stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 12px 20px;
    margin: 0;
  }
  .prune-stat {
    margin: 0;
  }
  .prune-stat dt {
    margin: 0;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.78;
  }
  .prune-stat dd {
    margin: 6px 0 0;
    font-size: 1.05rem;
  }
  .prune-details {
    margin-top: 14px;
    font-size: 0.86rem;
  }
  .prune-details summary {
    cursor: pointer;
    color: var(--color-blue);
  }
  .prune-pre {
    margin: 10px 0 0;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    font-size: 0.72rem;
    max-height: 220px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .prune-execute-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: flex-end;
  }
  .prune-field--grow {
    flex: 1;
    min-width: min(100%, 16rem);
  }
  .prune-execute-btn {
    min-height: 40px;
    border-color: color-mix(in srgb, #f87171 45%, var(--color-border));
    background: color-mix(in srgb, #7f1d1d 15%, var(--color-surface));
  }
  .prune-execute-btn:disabled {
    border-color: var(--color-border);
    background: var(--color-surface);
  }

  /* Embedding maintenance panel */
  .embed-loading {
    margin: 0 0 12px;
  }
  .embed-inventory-summary {
    margin: 0 0 12px;
  }
  .embed-actions {
    align-items: flex-end;
    margin-top: 12px;
  }
  .embed-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 8rem;
  }
  .embed-field__label {
    font-size: 0.8rem;
    font-weight: 600;
    margin: 0;
    opacity: 0.88;
  }
  .embed-batch-input {
    margin-bottom: 0;
  }
  .embed-start-btn {
    min-height: 40px;
  }
  .embed-start-msg {
    margin: 0;
    align-self: center;
  }
  .embed-jobs-table .embed-job-err {
    max-width: 14rem;
    font-size: 0.78rem;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
