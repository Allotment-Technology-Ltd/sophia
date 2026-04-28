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
  let panel = $state<PanelId>('dlq');
  /** Prefilled from `?jobId=` when opening Monitoring → Recover links. */
  let recoveryJobId = $state('');

  function hydratePanelFromUrl(): void {
    const p = page.url.searchParams.get('panel');
    if (p === 'dlq' || p === 'promote' || p === 'issues' || p === 'thinker' || p === 'ops' || p === 'cleanup')
      panel = p;
    const jid = page.url.searchParams.get('jobId')?.trim();
    if (jid) recoveryJobId = jid;
  }

  function applyParams(next: Partial<Record<'panel', string>>): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(next)) {
      if (!v) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    void goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true });
    hydratePanelFromUrl();
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

  // Admin operations (audit log)
  type AdminOperation = {
    id: string;
    kind: string;
    status: string;
    requested_by_email: string | null;
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
      operations = rows
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
  let embedBusy = $state(false);
  let embedErr = $state('');
  let inventory = $state<Inventory | null>(null);
  let reembedJobs = $state<ReembedJob[]>([]);
  let reembedStartBusy = $state(false);
  let reembedStartMsg = $state('');
  let reembedBatchSize = $state(50);

  async function loadEmbeddingOverview(): Promise<void> {
    embedBusy = true;
    embedErr = '';
    try {
      const [invBody, jobsBody] = await Promise.all([
        authorizedFetchJson<Record<string, unknown>>('/api/admin/reembed/inventory'),
        authorizedFetchJson<Record<string, unknown>>('/api/admin/reembed/jobs?limit=20')
      ]);
      inventory = (invBody?.inventory as Inventory) ?? null;
      reembedJobs = Array.isArray(jobsBody?.jobs) ? (jobsBody.jobs as ReembedJob[]) : [];
    } catch (e) {
      embedErr = e instanceof Error ? e.message : 'Embedding overview failed';
      inventory = null;
      reembedJobs = [];
    } finally {
      embedBusy = false;
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

  // Thinker link review (queue triage)
  type ThinkerQueueItem = {
    id: string;
    status: string;
    raw_name: string;
    canonical_name: string;
    proposed_qids: string[];
    seen_count: number;
    created_at: string | null;
    updated_at: string | null;
  };

  let thinkerBusy = $state(false);
  let thinkerErr = $state('');
  let thinkerMsg = $state('');
  let thinkerStatus = $state<'queued' | 'resolved' | 'rejected' | 'all'>('queued');
  let thinkerLimit = $state(40);
  let thinkerItems = $state<ThinkerQueueItem[]>([]);
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

  async function loadThinkerQueue(): Promise<void> {
    thinkerBusy = true;
    thinkerErr = '';
    thinkerMsg = '';
    try {
      const limit = Math.max(1, Math.min(200, Math.trunc(Number(thinkerLimit) || 40)));
      const body = await authorizedFetchJson<{ items: ThinkerQueueItem[] }>(
        `/api/admin/thinker-links/unresolved?status=${encodeURIComponent(thinkerStatus)}&limit=${encodeURIComponent(String(limit))}`
      );
      thinkerItems = Array.isArray(body?.items) ? body.items : [];
      const nextQid: Record<string, string> = {};
      const nextLabel: Record<string, string> = {};
      const nextNotes: Record<string, string> = {};
      for (const it of thinkerItems) {
        nextQid[it.id] = thinkerDraftQid[it.id] ?? '';
        nextLabel[it.id] = thinkerDraftLabel[it.id] ?? '';
        nextNotes[it.id] = thinkerDraftNotes[it.id] ?? '';
      }
      thinkerDraftQid = nextQid;
      thinkerDraftLabel = nextLabel;
      thinkerDraftNotes = nextNotes;
    } catch (e) {
      thinkerErr = e instanceof Error ? e.message : 'Thinker queue failed';
      thinkerItems = [];
    } finally {
      thinkerBusy = false;
    }
  }

  async function resolveThinkerItem(id: string): Promise<void> {
    thinkerMsg = '';
    thinkerErr = '';
    const wikidata_id = (thinkerDraftQid[id] ?? '').trim();
    if (!wikidata_id) {
      thinkerErr = 'Enter a Wikidata QID (e.g. Q1234).';
      return;
    }
    try {
      await authorizedFetchJson(`/api/admin/thinker-links/unresolved/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        jsonBody: {
          action: 'resolve',
          wikidata_id,
          label: (thinkerDraftLabel[id] ?? '').trim() || null,
          notes: (thinkerDraftNotes[id] ?? '').trim() || null
        }
      });
      thinkerMsg = 'Resolved.';
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
    if (pruneConfirmText.trim() !== 'PRUNE') {
      pruneErr = 'Type PRUNE to confirm.';
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
    if (panel === 'dlq') void loadDlq();
    else if (panel === 'promote') void loadPromote();
    else if (panel === 'issues') void loadEmbeddingOverview();
    else if (panel === 'thinker') void loadThinkerQueue();
    else if (panel === 'ops') void loadOperations();
  }

  onMount(() => {
    hydratePanelFromUrl();
    void Promise.all([
      loadDlq(),
      loadPromote(),
      panel === 'issues' ? loadEmbeddingOverview() : Promise.resolve(),
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
  lead="Action-focused work: restart or resume failed durable jobs, DLQ replay, promote backlog, and operator operations."
>
  <div class="op-panel mb-4">
    <div class="op-actions" style="align-items:flex-end">
      <div>
        <p class="op-muted" style="margin:0 0 6px"><strong>Queues</strong></p>
        <p class="op-muted" style="margin:0">Pick a panel, take actions, then go back to Monitoring for investigation.</p>
      </div>
      <div class="op-actions" style="margin-bottom:0; margin-left:auto">
        <button type="button" class="op-btn op-btn-link" disabled={tickBusy} onclick={tickDurableJobs}>
          {tickBusy ? 'Ticking…' : 'Advance durable queues'}
        </button>
        <button type="button" class="op-btn op-btn-link" onclick={refreshCurrentPanel}>Refresh panel</button>
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/activity">Open Monitoring</a>
      </div>
    </div>
    {#if tickMsg}
      <p class="op-muted" style="margin:10px 0 0">{tickMsg}</p>
    {/if}
    {#if promoteMsg}
      <p class="op-muted" style="margin:10px 0 0">{promoteMsg}</p>
    {/if}
  </div>

  <div class="op-kpi-grid mb-4">
    <button type="button" class="op-kpi-card" onclick={() => applyParams({ panel: 'dlq' })}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">DLQ</span>
        <span class="op-kpi-pill">Action</span>
      </div>
      <div class="op-kpi-v">{kpiDlq}</div>
      <div class="op-kpi-sub">Replay / remove / export</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => applyParams({ panel: 'promote' })}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Promote</span>
        <span class="op-kpi-pill">Action</span>
      </div>
      <div class="op-kpi-v">{kpiPromote}</div>
      <div class="op-kpi-sub">Continue extraction-only runs</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => applyParams({ panel: 'issues' })}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Embedding</span>
        <span class="op-kpi-pill">Maintenance</span>
      </div>
      <div class="op-kpi-v">{kpiEmbedNeedsWork}</div>
      <div class="op-kpi-sub">Start re-embed jobs</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => applyParams({ panel: 'thinker' })}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Thinker links</span>
        <span class="op-kpi-pill">Governance</span>
      </div>
      <div class="op-kpi-v">{kpiThinkerQueued}</div>
      <div class="op-kpi-sub">Resolve / reject queue</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => applyParams({ panel: 'ops' })}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Ops</span>
        <span class="op-kpi-pill">Attention</span>
      </div>
      <div class="op-kpi-v">{kpiOpsNeedsAttention}</div>
      <div class="op-kpi-sub">Restart/resume jobs + audit log</div>
    </button>
  </div>

  <div class="op-actions" style="margin: 0 0 10px;">
    <button type="button" class="op-btn op-btn-link" class:active={panel === 'dlq'} onclick={() => applyParams({ panel: 'dlq' })}>
      DLQ
    </button>
    <button type="button" class="op-btn op-btn-link" class:active={panel === 'promote'} onclick={() => applyParams({ panel: 'promote' })}>
      Promote queue
    </button>
    <button type="button" class="op-btn op-btn-link" class:active={panel === 'issues'} onclick={() => applyParams({ panel: 'issues' })}>
      Issue resolution
    </button>
    <button type="button" class="op-btn op-btn-link" class:active={panel === 'thinker'} onclick={() => applyParams({ panel: 'thinker' })}>
      Thinker review
    </button>
    <button type="button" class="op-btn op-btn-link" class:active={panel === 'ops'} onclick={() => applyParams({ panel: 'ops' })}>
      Operations
    </button>
    <button type="button" class="op-btn op-btn-link" class:active={panel === 'cleanup'} onclick={() => applyParams({ panel: 'cleanup' })}>
      Cleanup
    </button>
  </div>

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
      description="Corpus inventory + re-embed job controls (from /api/admin/reembed/*)."
    >
      <button slot="actions" type="button" class="op-btn op-btn-link" disabled={embedBusy} onclick={() => void loadEmbeddingOverview()}>
        {embedBusy ? 'Loading…' : 'Refresh'}
      </button>
      {#if embedErr}
        <p class="op-err" role="alert">{embedErr}</p>
      {/if}
      {#if inventory}
        <div class="op-muted" style="margin: 0 0 10px">
          Target dim <span class="op-mono">{inventory.targetDim}</span> · needs work{' '}
          <span class="op-mono">{inventory.needsWorkCount}</span> · missing dim{' '}
          <span class="op-mono">{inventory.noneCount}</span>
        </div>
      {/if}
      <div class="op-actions" style="margin-top: 10px">
        <label class="op-muted" for="reembedBatchSize"><strong>Batch size</strong></label>
        <input id="reembedBatchSize" class="op-select" type="number" min="1" max="500" bind:value={reembedBatchSize} />
        <button type="button" class="op-btn op-btn-link" disabled={reembedStartBusy} onclick={() => void startReembedJob()}>
          {reembedStartBusy ? 'Starting…' : 'Start re-embed job'}
        </button>
        {#if reembedStartMsg}
          <span class="op-muted">{reembedStartMsg}</span>
        {/if}
      </div>
      {#if reembedJobs.length === 0}
        <p class="op-muted">No recent jobs.</p>
      {:else}
        <table class="op-table" style="margin-top: 10px">
          <thead>
            <tr><th>Job</th><th>Status</th><th>Progress</th><th>Updated</th></tr>
          </thead>
          <tbody>
            {#each reembedJobs as j (j.id)}
              <tr>
                <td class="op-mono">{j.id.slice(0, 10)}…</td>
                <td class="op-mono">{j.status}</td>
                <td class="op-mono sm">{j.processedCount}/{j.totalCount ?? '—'}</td>
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
      description="Resolve unresolved author names to Wikidata QIDs (post-ingestion governance)."
    >
      <button slot="actions" type="button" class="op-btn op-btn-link" disabled={thinkerBusy} onclick={() => void loadThinkerQueue()}>
        {thinkerBusy ? 'Loading…' : 'Refresh'}
      </button>
      <div class="op-actions" style="margin-top: 0">
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
        <p class="op-muted">No items.</p>
      {:else}
        <table class="op-table">
          <thead>
            <tr><th>Name</th><th>Proposed</th><th>Resolve</th><th class="op-actions-col"></th></tr>
          </thead>
          <tbody>
            {#each thinkerItems as it (it.id)}
              <tr>
                <td>
                  <div class="op-mono">{it.raw_name}</div>
                  <div class="op-subtle">{it.canonical_name} · seen {it.seen_count}</div>
                </td>
                <td class="op-mono sm">{pickFirst(it.proposed_qids, '—')}</td>
                <td>
                  <input class="op-select" style="margin-bottom: 0" placeholder="Q1234" bind:value={thinkerDraftQid[it.id]} />
                  <input class="op-select" style="margin-bottom: 0; margin-top: 6px" placeholder="Label (optional)" bind:value={thinkerDraftLabel[it.id]} />
                  <input class="op-select" style="margin-bottom: 0; margin-top: 6px" placeholder="Notes (optional)" bind:value={thinkerDraftNotes[it.id]} />
                </td>
                <td class="op-actions-col">
                  <div class="op-btn-row">
                    <button type="button" class="op-mini" disabled={thinkerBusy} onclick={() => void resolveThinkerItem(it.id)}>Resolve</button>
                    <button type="button" class="op-mini" disabled={thinkerBusy} onclick={() => void rejectThinkerItem(it.id)}>Reject</button>
                    <a class="op-mini op-mini-link" href="/admin/users">User mgmt</a>
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
    <IngestionSectionShell title="Admin operations" description="Queued/running/failed operator operations (audit log).">
      <div class="op-actions">
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
      {:else}
        <table class="op-table">
          <thead>
            <tr><th>Operation</th><th>Status</th><th>When</th><th class="op-actions-col"></th></tr>
          </thead>
          <tbody>
            {#each operations as op (op.id)}
              <tr>
                <td>
                  <div class="op-mono">{op.kind}</div>
                  <div class="op-subtle">
                    {op.id.slice(0, 12)}…{#if op.requested_by_email} · {op.requested_by_email}{/if}
                  </div>
                </td>
                <td class="op-mono">{op.status}</td>
                <td class="op-mono sm">{op.updated_at ?? op.created_at ?? '—'}</td>
                <td class="op-actions-col">
                  <details>
                    <summary class="op-a" style="cursor:pointer">View</summary>
                    {#if op.last_error}
                      <p class="op-err" style="margin:10px 0 0">{op.last_error}</p>
                    {/if}
                    {#if op.result_summary}
                      <p class="op-muted" style="margin:10px 0 0">{op.result_summary}</p>
                    {/if}
                    {#if op.log_text}
                      <pre class="op-mono sm" style="margin:10px 0 0; white-space:pre-wrap">{op.log_text}</pre>
                    {:else}
                      <p class="op-muted" style="margin:10px 0 0">No logs.</p>
                    {/if}
                  </details>
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
      description="Prune superseded ingest_runs failures when a later done exists. Use dry-run first."
    >
      <div class="op-actions" style="margin-bottom:0">
        <label class="op-muted" for="pruneLimit">Limit</label>
        <input id="pruneLimit" class="op-select" type="number" min="1" max="10000" bind:value={pruneLimit} />
        <button type="button" class="op-btn op-btn-link" disabled={pruneBusy} onclick={previewPruneSupersededFailedRuns}>
          {pruneBusy ? 'Working…' : 'Dry-run'}
        </button>
      </div>
      {#if pruneErr}
        <p class="op-err" role="alert">{pruneErr}</p>
      {/if}
      {#if prunePreview}
        <div class="op-muted" style="margin: 12px 0">
          {prunePreview.dryRun ? 'Dry-run:' : 'Executed:'}
          candidates <span class="op-mono">{prunePreview.candidateRunIds.length}</span> · detached
          <span class="op-mono">{prunePreview.jobItemsDetached}</span> · reports
          <span class="op-mono">{prunePreview.sophiaDocumentsDeleted}</span> · runs
          <span class="op-mono">{prunePreview.ingestRunsDeleted}</span>
        </div>
        <details class="op-muted" style="margin-bottom:12px">
          <summary class="op-a" style="cursor:pointer">Show candidate run ids</summary>
          <pre class="op-mono sm">{JSON.stringify(prunePreview.candidateRunIds, null, 2)}</pre>
        </details>
      {/if}
      <div class="op-actions" style="margin-bottom:0">
        <label class="op-muted" for="pruneConfirm">Type PRUNE</label>
        <input id="pruneConfirm" class="op-select" bind:value={pruneConfirmText} placeholder="PRUNE" />
        <button type="button" class="op-btn" disabled={pruneBusy} onclick={executePruneSupersededFailedRuns}>Execute</button>
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

