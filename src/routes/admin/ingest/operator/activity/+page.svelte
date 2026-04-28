<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authorizedFetchJson } from '$lib/authorizedFetchJson';
  import IngestionSettingsShell from '$lib/components/admin/ingest/IngestionSettingsShell.svelte';
  import IngestionSectionShell from '$lib/components/admin/ingest/IngestionSectionShell.svelte';
  import type { DlqRow } from '$lib/components/admin/ingest/jobs/JobsDlqTab.svelte';

  type RunRow = {
    id: string;
    status: string;
    sourceUrl: string;
    createdAt: number;
    error?: string;
    currentStageKey?: string | null;
  };
  type JobRow = {
    id: string;
    status: string;
    summary?: Record<string, number>;
    updatedAt?: string;
  };
  type NeonPromote = { id: string; sourceUrl: string; updatedAt: string };
  type ReportRow = {
    runId: string;
    status: string;
    sourceUrl: string;
    sourceType: string;
    createdAtMs: number;
    completedAtMs: number;
    terminalError: string | null;
    lastFailureStageKey: string | null;
  };

  let runs = $state<RunRow[]>([]);
  let jobs = $state<JobRow[]>([]);
  let awaitingNeon = $state<NeonPromote[]>([]);
  let recentReports = $state<ReportRow[]>([]);
  let busy = $state(false);
  let err = $state('');

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
    started_at: string | null;
    completed_at: string | null;
  };

  type SavedView = { id: string; label: string; params: Record<string, string> };
  const SAVED_VIEWS_KEY = 'sophia.admin.ingest.monitoring.views.v1';
  const builtinViews: SavedView[] = [
    { id: 'my_triage', label: 'My triage view', params: { panel: 'dlq' } },
    { id: 'dlq_permanent', label: 'Permanent failures', params: { panel: 'dlq', failureClass: 'permanent' } },
    {
      id: 'dlq_retryable_exhausted',
      label: 'Retryable exhausted',
      params: { panel: 'dlq', failureClass: 'retryable_exhausted' }
    },
    { id: 'awaiting_promote', label: 'Awaiting promote', params: { panel: 'promote' } }
  ];
  let savedViews = $state<SavedView[]>([]);
  let activeViewId = $state<string>('my_triage');
  let viewsMsg = $state('');

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

  let opsBusy = $state(false);
  let opsErr = $state('');
  let operations = $state<AdminOperation[]>([]);
  let opsLimit = $state(25);

  let searchQuery = $state('');

  // DLQ counts for overview cards (actions live in Triage).
  let dlqItems = $state<DlqRow[]>([]);
  let dlqLoading = $state(false);
  let dlqMessage = $state('');

  async function loadDlq(): Promise<void> {
    dlqLoading = true;
    dlqMessage = '';
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/jobs/dlq?limit=120');
      dlqItems = Array.isArray(body?.items) ? (body.items as DlqRow[]) : [];
    } catch (e) {
      dlqMessage = e instanceof Error ? e.message : 'DLQ load failed';
      dlqItems = [];
    } finally {
      dlqLoading = false;
    }
  }
  // Promote + DLQ actions are intentionally not present on Monitoring.

  const kpiPromote = $derived(awaitingNeon.length);
  const kpiDlq = $derived(dlqItems.length);
  const kpiJobsRunning = $derived(jobs.filter((j) => (j.status ?? '').toLowerCase() === 'running').length);
  const kpiOpsNeedsAttention = $derived(
    operations.filter((op) => ['queued', 'running', 'failed', 'sync_failed', 'validation_failed'].includes(op.status)).length
  );

  // Queue ticking lives in Triage.

  // Dataset coverage (read-only panel)
  type CoveragePayload = {
    generatedAt?: string;
    presetGoal?: number;
    totals?: {
      uniqueSourcesCompleted: number;
      trainingAcceptableCount: number;
      trainingNotAcceptableCount: number;
      byOrigin: Record<string, number>;
    };
    phase1Readiness?: { allUnionUrlsPhase2Ready: boolean; note?: string } | null;
    error?: string;
  };
  let coverage = $state<CoveragePayload | null>(null);
  let coverageErr = $state('');
  let coverageBusy = $state(false);
  let coverageInsightsBusy = $state(false);
  let coverageInsightsErr = $state('');
  let coverageInsights = $state<{ summary: string; gates: Array<{ gate: string; status: string; evidence: string; next_actions: string[]; deep_links?: string[] }> } | null>(null);
  async function loadCoverage(): Promise<void> {
    coverageBusy = true;
    coverageErr = '';
    try {
      coverage = await authorizedFetchJson<CoveragePayload>('/api/admin/metrics/dataset-coverage');
    } catch (e) {
      coverageErr = e instanceof Error ? e.message : 'Coverage load failed';
      coverage = null;
    } finally {
      coverageBusy = false;
    }
  }

  async function generateCoverageGateInsights(): Promise<void> {
    coverageInsightsBusy = true;
    coverageInsightsErr = '';
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/metrics/dataset-coverage/insights', {
        method: 'POST'
      });
      if (body.ok !== true) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Insights failed');
      }
      coverageInsights = body.insights as typeof coverageInsights;
    } catch (e) {
      coverageInsightsErr = e instanceof Error ? e.message : 'Insights failed';
      coverageInsights = null;
    } finally {
      coverageInsightsBusy = false;
    }
  }

  // Thinker link review (lightweight queue triage)
  type ThinkerQueueStatus = 'queued' | 'resolved' | 'rejected' | 'all';
  type ThinkerQueueItem = {
    id: string;
    raw_name: string;
    canonical_name: string;
    source_ids: string[];
    contexts: string[];
    status: 'queued' | 'resolved' | 'rejected';
    seen_count: number;
    proposed_qids: string[];
    proposed_labels: string[];
    resolver_notes: string | null;
  };
  let thinkerStatus = $state<ThinkerQueueStatus>('queued');
  let thinkerLimit = $state(25);
  let thinkerBusy = $state(false);
  let thinkerErr = $state('');
  let thinkerMsg = $state('');
  let thinkerItems = $state<ThinkerQueueItem[]>([]);
  let thinkerDraftQid = $state<Record<string, string>>({});
  let thinkerDraftLabel = $state<Record<string, string>>({});
  let thinkerDraftNotes = $state<Record<string, string>>({});

  function pickFirst(v: string[] | undefined, fallback = ''): string {
    return Array.isArray(v) && v.length > 0 ? (v[0] ?? fallback) : fallback;
  }

  async function loadThinkerQueue(): Promise<void> {
    thinkerBusy = true;
    thinkerErr = '';
    thinkerMsg = '';
    try {
      const params = new URLSearchParams();
      params.set('status', thinkerStatus);
      params.set('limit', String(Math.max(1, Math.min(200, Math.trunc(Number(thinkerLimit) || 25)))));
      const body = await authorizedFetchJson<{ items: ThinkerQueueItem[] }>(
        `/api/admin/thinker-links/unresolved?${params.toString()}`
      );
      thinkerItems = Array.isArray(body?.items) ? body.items : [];
      const qid: Record<string, string> = {};
      const label: Record<string, string> = {};
      const notes: Record<string, string> = { ...thinkerDraftNotes };
      for (const it of thinkerItems) {
        qid[it.id] = thinkerDraftQid[it.id] ?? pickFirst(it.proposed_qids, '');
        label[it.id] = thinkerDraftLabel[it.id] ?? pickFirst(it.proposed_labels, it.raw_name);
        notes[it.id] = notes[it.id] ?? '';
      }
      thinkerDraftQid = qid;
      thinkerDraftLabel = label;
      thinkerDraftNotes = notes;
    } catch (e) {
      thinkerErr = e instanceof Error ? e.message : 'Thinker queue load failed';
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
      thinkerErr = 'Enter a Wikidata QID first (e.g. Q1234).';
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

  // Issue resolution (embedding re-embed jobs overview)
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
      await load();
    } catch (e) {
      pruneErr = e instanceof Error ? e.message : 'Execute failed.';
    } finally {
      pruneBusy = false;
    }
  }

  function hydrateSavedViews(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(SAVED_VIEWS_KEY);
      if (!raw) {
        savedViews = [];
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        savedViews = [];
        return;
      }
      const cleaned: SavedView[] = [];
      for (const row of parsed) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const id = typeof r.id === 'string' ? r.id.trim() : '';
        const label = typeof r.label === 'string' ? r.label.trim() : '';
        const params = r.params && typeof r.params === 'object' && !Array.isArray(r.params) ? (r.params as Record<string, unknown>) : {};
        if (!id || !label) continue;
        const p: Record<string, string> = {};
        for (const [k, v] of Object.entries(params)) {
          if (typeof v === 'string' && v.trim() !== '') p[k] = v.trim();
        }
        cleaned.push({ id, label, params: p });
      }
      savedViews = cleaned.slice(0, 50);
    } catch {
      savedViews = [];
    }
  }

  function persistSavedViews(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews));
    } catch {
      /* ignore */
    }
  }

  function applyParams(params: Record<string, string>): void {
    const url = new URL(page.url);
    // Clear known params first (so switching views doesn't accumulate junk).
    for (const k of ['panel', 'failureClass', 'q', 'status', 'since']) url.searchParams.delete(k);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    void goto(`${url.pathname}${url.search}`, { replaceState: false, noScroll: true });
  }

  function handleGlobalSearch(): void {
    const raw = searchQuery.trim();
    if (!raw) return;
    // URL → prefill wizard sources list
    try {
      const u = new URL(raw);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        window.location.href = `/admin/ingest/operator?step=sources&prefillUrl=${encodeURIComponent(raw)}`;
        return;
      }
    } catch {
      /* not a url */
    }
    applyParams({ q: raw });
  }

  function viewOptions(): SavedView[] {
    return [...builtinViews, ...savedViews];
  }

  function syncActiveViewFromUrl(): void {
    const panel = page.url.searchParams.get('panel') ?? '';
    const failureClass = page.url.searchParams.get('failureClass') ?? '';
    const opts = viewOptions();
    const match = opts.find((v) => {
      const p = v.params.panel ?? '';
      const f = v.params.failureClass ?? '';
      return p === panel && f === failureClass;
    });
    if (match) activeViewId = match.id;
  }

  function saveCurrentView(): void {
    viewsMsg = '';
    if (typeof window === 'undefined') return;
    const label = prompt('Name this view', 'My triage view') ?? '';
    const t = label.trim();
    if (!t) return;
    const id = `custom_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    const params: Record<string, string> = {};
    for (const k of ['panel', 'failureClass', 'q', 'status']) {
      const v = page.url.searchParams.get(k);
      if (v && v.trim() !== '') params[k] = v.trim();
    }
    savedViews = [{ id, label: t.slice(0, 60), params }, ...savedViews].slice(0, 50);
    persistSavedViews();
    activeViewId = id;
    viewsMsg = 'Saved.';
  }

  function deleteActiveCustomView(): void {
    viewsMsg = '';
    if (!activeViewId.startsWith('custom_')) {
      viewsMsg = 'Built-in views cannot be deleted.';
      return;
    }
    const existing = savedViews.find((v) => v.id === activeViewId);
    if (!existing) return;
    if (!confirm(`Delete saved view "${existing.label}"?`)) return;
    savedViews = savedViews.filter((v) => v.id !== activeViewId);
    persistSavedViews();
    activeViewId = 'my_triage';
    viewsMsg = 'Deleted.';
  }

  function formatWhen(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function truncateUrl(url: string, max = 56): string {
    const u = url.trim();
    if (u.length <= max) return u;
    return `${u.slice(0, max - 1)}…`;
  }

  function reportStatusLabel(s: string): string {
    if (s === 'running' || s === 'awaiting_sync') return 'In progress (snapshot)';
    if (s === 'done') return 'Done';
    if (s === 'error') return 'Failed';
    return s;
  }

  async function copyRunId(runId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(runId);
    } catch {
      /* ignore */
    }
  }

  function openRunMonitor(runId: string): void {
    window.location.href = `/admin/ingest/operator/run-console/${encodeURIComponent(runId)}`;
  }

  function viewSavedReport(runId: string): void {
    applyParams({ panel: 'runs', q: runId });
  }

  async function load() {
    busy = true;
    err = '';
    try {
      const [rBody, jBody] = await Promise.all([
        authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/runs'),
        authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/jobs?limit=40')
      ]);
      runs = Array.isArray(rBody.runs) ? (rBody.runs as RunRow[]) : [];
      awaitingNeon = Array.isArray(rBody.awaitingPromoteNeon) ? (rBody.awaitingPromoteNeon as NeonPromote[]) : [];
      recentReports = Array.isArray(rBody.recentReports) ? (rBody.recentReports as ReportRow[]) : [];
      jobs = Array.isArray(jBody.jobs) ? (jBody.jobs as JobRow[]) : [];
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  type LiveRunDetail = {
    id: string;
    status: string;
    stages: unknown;
    logLines: string[];
    issues: unknown[];
    issueCount: number;
    error: string | null;
    createdAt: number;
    completedAt: number | null;
    excludeFromBatchSuggest?: boolean;
  };

  type RunReportEnvelope = {
    runId: string;
    status: string | null;
    sourceUrl: string;
    sourceType: string;
    modelChain: unknown | null;
    pipelinePreset: unknown | null;
    embeddingModel: unknown | null;
    validate: boolean;
    issueCount: number;
    issueSummary: unknown;
    terminalError: string | null;
    lastFailureStageKey: string | null;
    timingTelemetry: unknown | null;
    routingStats: unknown | null;
    metricsAdvisory: unknown | null;
    completedAtMs: number | null;
    createdAtMs: number | null;
  };

  let selectedRunId = $state<string>('');
  let runDetailBusy = $state(false);
  let runDetailErr = $state('');
  let liveRun = $state<LiveRunDetail | null>(null);
  let runReport = $state<RunReportEnvelope | null>(null);

  function downloadJson(filename: string, data: unknown): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function loadRunInspector(runId: string): Promise<void> {
    runDetailBusy = true;
    runDetailErr = '';
    liveRun = null;
    runReport = null;
    try {
      // Prefer live in-memory run (pipeline activity + log lines).
      liveRun = await authorizedFetchJson<LiveRunDetail>(`/api/admin/ingest/run/${encodeURIComponent(runId)}`);
    } catch (e) {
      // Not in memory on this instance; fall back to report snapshot (Neon/Firestore).
      try {
        runReport = await authorizedFetchJson<RunReportEnvelope>(
          `/api/admin/ingest/reports/${encodeURIComponent(runId)}`
        );
      } catch (e2) {
        const m1 = e instanceof Error ? e.message : 'Run lookup failed';
        const m2 = e2 instanceof Error ? e2.message : 'Report lookup failed';
        runDetailErr = `${m1}. ${m2}.`;
      }
    } finally {
      runDetailBusy = false;
    }
  }

  hydrateSavedViews();
  syncActiveViewFromUrl();
  load();
  void loadOperations();
  void loadDlq();
  void loadCoverage();
  void loadThinkerQueue();
  void loadEmbeddingOverview();

  $effect(() => {
    // Keep the picker in sync as URL params change.
    void page.url.search;
    syncActiveViewFromUrl();
  });

  $effect(() => {
    void page.url.search;
    const p = page.url.searchParams.get('panel') ?? '';
    const q = (page.url.searchParams.get('q') ?? '').trim();
    if (p !== 'runs' || !q) {
      selectedRunId = '';
      liveRun = null;
      runReport = null;
      runDetailErr = '';
      return;
    }
    if (q === selectedRunId) return;
    selectedRunId = q;
    void loadRunInspector(q);
  });
</script>

<svelte:head>
  <title>Monitoring — Operator</title>
</svelte:head>

<IngestionSettingsShell
  activeNav="monitoring"
  journeyStage="monitor"
  title="Monitoring"
  lead="Filterable, progressive-disclosure monitoring: runs/jobs, health gates, governance, and investigation. Action queues live in Triage."
>
  {@const panel = page.url.searchParams.get('panel') ?? ''}
  {@const failureClass = page.url.searchParams.get('failureClass') ?? ''}
  {@const q = page.url.searchParams.get('q') ?? ''}
  {@const status = page.url.searchParams.get('status') ?? ''}

  <div class="op-panel mb-4">
    <div class="op-actions">
      <label class="op-muted" for="viewSelect"><strong>Views</strong></label>
      <select
        id="viewSelect"
        class="op-select"
        bind:value={activeViewId}
        onchange={() => {
          const v = viewOptions().find((x) => x.id === activeViewId);
          if (v) applyParams(v.params);
        }}
      >
        {#each viewOptions() as v (v.id)}
          <option value={v.id}>{v.label}</option>
        {/each}
      </select>
      <button type="button" class="op-btn op-btn-link" onclick={saveCurrentView}>Save current</button>
      <button type="button" class="op-btn op-btn-link" onclick={deleteActiveCustomView}>Delete</button>
      {#if viewsMsg}
        <span class="op-muted">{viewsMsg}</span>
      {/if}

      <span class="op-muted" style="margin-left:auto"><strong>Filters</strong></span>
      <select
        class="op-select"
        value={panel}
        onchange={(e) => applyParams({ panel: (e.currentTarget as HTMLSelectElement).value })}
        title="Panel"
      >
        <option value="">All</option>
        <option value="promote">Promote queue</option>
        <option value="dlq">DLQ</option>
        <option value="jobs">Jobs</option>
        <option value="runs">Runs</option>
        <option value="ops">Ops</option>
        <option value="coverage">Coverage</option>
      </select>
      <select
        class="op-select"
        value={failureClass}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          applyParams(v ? { failureClass: v } : {});
        }}
        title="Failure class"
      >
        <option value="">Failure class: any</option>
        <option value="permanent">permanent</option>
        <option value="retryable_exhausted">retryable_exhausted</option>
        <option value="retryable">retryable</option>
        <option value="unknown">unknown</option>
      </select>
      <input
        class="op-select"
        placeholder="q: URL / run id / job id…"
        value={q}
        onkeydown={(e) => {
          if (e.key === 'Enter') applyParams({ q: (e.currentTarget as HTMLInputElement).value.trim() });
        }}
      />
      <select
        class="op-select"
        value={status}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          applyParams(v ? { status: v } : {});
        }}
        title="Status"
      >
        <option value="">Status: any</option>
        <option value="running">running</option>
        <option value="queued">queued</option>
        <option value="done">done</option>
        <option value="error">error</option>
        <option value="awaiting_promote">awaiting_promote</option>
        <option value="awaiting_tail">awaiting_tail</option>
      </select>

      <span class="op-muted"><strong>Search</strong></span>
      <input
        class="op-select"
        placeholder="URL / run id / job id…"
        bind:value={searchQuery}
        onkeydown={(e) => {
          if (e.key === 'Enter') handleGlobalSearch();
        }}
      />
      <button type="button" class="op-btn op-btn-link" onclick={handleGlobalSearch}>Go</button>
    </div>
  </div>

  <div class="op-panel mb-4">
    <div class="op-actions" style="align-items:flex-end">
      <div>
        <p class="op-muted" style="margin:0 0 6px"><strong>Overview</strong></p>
        <p class="op-muted" style="margin:0">
          Snapshot of queues + gates. Click a card to drill down.
        </p>
      </div>
      <div class="op-actions" style="margin-bottom:0; margin-left:auto">
        <button type="button" class="op-btn op-btn-link" disabled={busy} onclick={load}>{busy ? 'Loading…' : 'Refresh'}</button>
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/triage">Open Triage</a>
      </div>
    </div>
  </div>

  <div class="op-kpi-grid mb-4">
    <button type="button" class="op-kpi-card" onclick={() => (window.location.href = '/admin/ingest/operator/triage?panel=promote')}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Promote queue</span>
        <span class="op-kpi-pill">Neon</span>
      </div>
      <div class="op-kpi-v">{kpiPromote}</div>
      <div class="op-kpi-sub">Extraction done → promote to continue tail</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => (window.location.href = '/admin/ingest/operator/triage?panel=dlq')}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">DLQ</span>
        <span class="op-kpi-pill">Canonical</span>
      </div>
      <div class="op-kpi-v">{kpiDlq}</div>
      <div class="op-kpi-sub">Replay / remove / export (bulk)</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => applyParams({ panel: 'jobs' })}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Durable jobs</span>
        <span class="op-kpi-pill">Running</span>
      </div>
      <div class="op-kpi-v">{kpiJobsRunning}</div>
      <div class="op-kpi-sub">Queue health + summaries</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => (window.location.href = '/admin/ingest/operator/triage?panel=ops')}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Ops</span>
        <span class="op-kpi-pill">Attention</span>
      </div>
      <div class="op-kpi-v">{kpiOpsNeedsAttention}</div>
      <div class="op-kpi-sub">Queued / running / failed operations</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => applyParams({ panel: 'coverage' })}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Coverage gate</span>
        <span class="op-kpi-pill">Phase</span>
      </div>
      <div class="op-kpi-v">{coverage?.phase1Readiness?.allUnionUrlsPhase2Ready ? 'Ready' : 'Not ready'}</div>
      <div class="op-kpi-sub">Dataset readiness KPIs</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => (window.location.href = '/admin/ingest/operator/triage?panel=issues')}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Embedding issues</span>
        <span class="op-kpi-pill">Maintenance</span>
      </div>
      <div class="op-kpi-v">{inventory?.needsWorkCount ?? '—'}</div>
      <div class="op-kpi-sub">Re-embed / dimension mismatches</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => (window.location.href = '/admin/ingest/operator/triage?panel=thinker')}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Thinker links</span>
        <span class="op-kpi-pill">Governance</span>
      </div>
      <div class="op-kpi-v">{thinkerItems.length}</div>
      <div class="op-kpi-sub">Queued unresolved names</div>
    </button>
  </div>

  <div class="op-panel mb-4">
    <div class="op-actions" style="align-items:flex-end">
      <div>
        <p class="op-muted" style="margin:0 0 6px"><strong>Action queues</strong></p>
        <p class="op-muted" style="margin:0">
          DLQ, promote backlog, operations, and cleanup actions live in <a class="op-a" href="/admin/ingest/operator/triage">Triage</a>.
        </p>
      </div>
      <div class="op-actions" style="margin-bottom:0; margin-left:auto">
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/triage?panel=dlq">Open DLQ</a>
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/triage?panel=promote">Open promote</a>
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/triage?panel=ops">Open operations</a>
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/triage?panel=cleanup">Open cleanup</a>
      </div>
    </div>
  </div>

  {#if err}
    <p class="op-err" role="alert">{err}</p>
  {/if}

  <details class="mt-6" open={false}>
    <summary class="op-a" style="cursor:pointer">Promote queue</summary>
    <div class="mt-4">
      <IngestionSectionShell title="Promote queue" description="Moved to Triage to keep Monitoring read-only.">
        <p class="op-muted">
          Promote backlog: <span class="op-mono">{kpiPromote}</span>. Go to <a class="op-a" href="/admin/ingest/operator/triage?panel=promote">Triage → Promote</a>.
        </p>
      </IngestionSectionShell>
    </div>
  </details>

  <details class="mt-6" open={panel === '' || panel === 'runs'}>
    <summary class="op-a" style="cursor:pointer">Runs</summary>
    <div class="mt-4">
      <IngestionSectionShell
        title="This server (in-memory runs)"
        description="Live runs held by this process. Use run console for realtime inspection."
      >
    {#if runs.length === 0}
      <p class="op-muted">None in this process.</p>
    {:else}
      <table class="op-table">
        <thead>
          <tr><th>Run</th><th>Status</th><th>Source</th><th class="op-actions-col"></th></tr>
        </thead>
        <tbody>
          {#each runs as r (r.id)}
            <tr>
              <td class="op-mono">{r.id.slice(0, 10)}…</td>
              <td>{r.status}</td>
              <td class="op-ellip">{r.sourceUrl}</td>
              <td class="op-actions-col">
                <button type="button" class="op-mini" onclick={() => openRunMonitor(r.id)}>Open</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if q && panel === 'runs'}
      <div class="mt-4">
        <IngestionSectionShell
          title="Run inspector"
          description="Live pipeline activity when the run is in memory on this server; otherwise a persisted report snapshot."
        >
          <div slot="actions" class="op-actions" style="margin-top:0">
            <button
              type="button"
              class="op-btn op-btn-link"
              disabled={runDetailBusy || !selectedRunId}
              onclick={() => selectedRunId && void loadRunInspector(selectedRunId)}
            >
              {runDetailBusy ? 'Loading…' : 'Refresh'}
            </button>
            {#if liveRun}
              <button
                type="button"
                class="op-btn op-btn-link"
                onclick={() => liveRun && downloadJson(`sophia-run-${liveRun.id}.json`, liveRun)}
              >
                Download JSON
              </button>
            {:else if runReport}
              <button
                type="button"
                class="op-btn op-btn-link"
                onclick={() => runReport && downloadJson(`sophia-run-report-${runReport.runId}.json`, runReport)}
              >
                Download report JSON
              </button>
            {/if}
          </div>

          {#if runDetailErr}
            <p class="op-err" role="alert">{runDetailErr}</p>
          {/if}

          {#if runDetailBusy && !liveRun && !runReport}
            <p class="op-muted">Loading…</p>
          {:else if liveRun}
            <div class="op-muted" style="margin:0 0 10px">
              <strong class="op-mono">{liveRun.id}</strong> · <code class="op-code">{liveRun.status}</code>
              {#if liveRun.error}
                <span class="op-subtle" title={liveRun.error}>{liveRun.error}</span>
              {/if}
            </div>
            <details class="op-muted" open>
              <summary class="op-a" style="cursor:pointer">Pipeline activity (log lines)</summary>
              <pre class="op-mono sm" style="white-space:pre-wrap; max-height: 360px; overflow:auto;">
{(liveRun.logLines ?? []).slice(-240).join('\n')}
              </pre>
            </details>
            <details class="op-muted" style="margin-top: 10px;">
              <summary class="op-a" style="cursor:pointer">Issues ({liveRun.issueCount ?? (liveRun.issues?.length ?? 0)})</summary>
              <pre class="op-mono sm" style="white-space:pre-wrap; max-height: 360px; overflow:auto;">
{JSON.stringify(liveRun.issues ?? [], null, 2)}
              </pre>
            </details>
            <details class="op-muted" style="margin-top: 10px;">
              <summary class="op-a" style="cursor:pointer">Stages</summary>
              <pre class="op-mono sm" style="white-space:pre-wrap; max-height: 360px; overflow:auto;">
{JSON.stringify(liveRun.stages ?? null, null, 2)}
              </pre>
            </details>
          {:else if runReport}
            <div class="op-muted" style="margin:0 0 10px">
              <strong class="op-mono">{runReport.runId}</strong> · <code class="op-code">{runReport.status ?? '—'}</code>
              {#if runReport.lastFailureStageKey}
                <span class="op-subtle">stage: {runReport.lastFailureStageKey}</span>
              {/if}
              {#if runReport.terminalError}
                <span class="op-subtle" title={runReport.terminalError}>{truncateUrl(runReport.terminalError, 96)}</span>
              {/if}
            </div>
            <p class="op-muted" style="margin:0 0 10px">
              This run is not currently in memory on this instance. You can still use this snapshot; for live activity,
              open the run while it’s executing on the same server process.
            </p>
            <details class="op-muted" open>
              <summary class="op-a" style="cursor:pointer">Report snapshot</summary>
              <pre class="op-mono sm" style="white-space:pre-wrap; max-height: 360px; overflow:auto;">
{JSON.stringify(runReport, null, 2)}
              </pre>
            </details>
          {:else}
            <p class="op-muted">Select a run and click “Open”.</p>
          {/if}
        </IngestionSectionShell>
      </div>
    {/if}
      </IngestionSectionShell>
    </div>
  </details>

  <details class="mt-6" open={false}>
    <summary class="op-a" style="cursor:pointer">Admin operations (audit log)</summary>
    <div class="mt-4">
      <IngestionSectionShell title="Admin operations" description="Moved to Triage to keep Monitoring read-only.">
        <p class="op-muted">
          Ops attention: <span class="op-mono">{kpiOpsNeedsAttention}</span>. Go to <a class="op-a" href="/admin/ingest/operator/triage?panel=ops">Triage → Operations</a>.
        </p>
      </IngestionSectionShell>
    </div>
  </details>

  <details class="mt-6" open={false}>
    <summary class="op-a" style="cursor:pointer">DLQ</summary>
    <div class="mt-4">
      <IngestionSectionShell title="DLQ" description="Moved to Triage to keep Monitoring read-only.">
        <p class="op-muted">
          DLQ count: <span class="op-mono">{kpiDlq}</span>. Go to <a class="op-a" href="/admin/ingest/operator/triage?panel=dlq">Triage → DLQ</a>.
        </p>
      </IngestionSectionShell>
    </div>
  </details>

  <details class="mt-6" open={panel === '' || panel === 'jobs'}>
    <summary class="op-a" style="cursor:pointer">Jobs</summary>
    <div class="mt-4">
      <IngestionSectionShell title="Durable jobs (Neon)" description="Job-level queue state and summary counts.">
    {#if jobs.length === 0}
      <p class="op-muted">None returned.</p>
    {:else}
      <table class="op-table">
        <thead>
          <tr><th>Job</th><th>Status</th><th>Summary</th></tr>
        </thead>
        <tbody>
          {#each jobs as j (j.id)}
            <tr>
              <td>
                <button type="button" class="op-mini" onclick={() => applyParams({ panel: 'jobs', q: j.id })}>
                  {j.id.slice(0, 14)}…
                </button>
              </td>
              <td>{j.status}</td>
              <td class="op-mono sm">{JSON.stringify(j.summary ?? {})}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
      </IngestionSectionShell>
    </div>
  </details>

  <details class="mt-6" open={panel === '' || panel === 'coverage'}>
    <summary class="op-a" style="cursor:pointer">Dataset coverage</summary>
    <div class="mt-4">
      <IngestionSectionShell
        title="Dataset coverage (read-only)"
        description="Preset coverage and Phase readiness gates (from /api/admin/metrics/dataset-coverage)."
      >
        <div slot="actions" class="op-actions" style="margin-top:0">
          <button type="button" class="op-btn op-btn-link" disabled={coverageBusy} onclick={() => void loadCoverage()}>
            {coverageBusy ? 'Loading…' : 'Refresh'}
          </button>
          <button
            type="button"
            class="op-btn op-btn-link"
            disabled={coverageInsightsBusy}
            onclick={() => void generateCoverageGateInsights()}
            title="User-triggered LLM summary"
          >
            {coverageInsightsBusy ? 'Thinking…' : 'Generate gate insights'}
          </button>
        </div>
        {#if coverageErr}
          <p class="op-err" role="alert">{coverageErr}</p>
        {/if}
        {#if !coverage}
          <p class="op-muted">No data.</p>
        {:else}
          <div class="op-muted" style="margin: 0 0 10px">
            Generated <span class="op-mono">{coverage.generatedAt ?? '—'}</span> · completed
            <span class="op-mono">{coverage.totals?.uniqueSourcesCompleted ?? 0}</span> · training ok
            <span class="op-mono">{coverage.totals?.trainingAcceptableCount ?? 0}</span>
          </div>
          <p class="op-muted" style="margin: 0">
            Phase1 readiness gate:{' '}
            <code class="op-code">{coverage.phase1Readiness?.allUnionUrlsPhase2Ready ? 'ready' : 'not_ready'}</code>
          </p>
          {#if coverage.phase1Readiness?.note}
            <p class="op-muted" style="margin-top: 8px">{coverage.phase1Readiness.note}</p>
          {/if}
        {/if}

        {#if coverageInsightsErr}
          <p class="op-err" role="alert">{coverageInsightsErr}</p>
        {/if}
        {#if coverageInsights}
          <div class="mt-4 rounded border border-[var(--color-border)] bg-black/10 p-4">
            <p class="op-muted" style="margin:0 0 10px"><strong>AI summary</strong></p>
            <p class="op-muted" style="margin:0 0 12px; white-space:pre-wrap">{coverageInsights.summary}</p>
            <div class="grid gap-3">
              {#each coverageInsights.gates as g, i (i)}
                <div class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <p class="op-muted" style="margin:0 0 6px"><strong>{g.gate}</strong> · <code class="op-code">{g.status}</code></p>
                  <p class="op-muted" style="margin:0 0 10px; white-space:pre-wrap">{g.evidence}</p>
                  <ul class="op-muted" style="margin:0 0 10px; padding-left: 18px">
                    {#each g.next_actions as a (a)}
                      <li>{a}</li>
                    {/each}
                  </ul>
                  {#if g.deep_links?.length}
                    <div class="op-actions" style="margin-top:0">
                      {#each g.deep_links as href (href)}
                        <a class="op-btn op-btn-link" href={href}>Open</a>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </IngestionSectionShell>
    </div>
  </details>


  <div class="mt-6">
  <IngestionSectionShell
    title="Recent Firestore reports"
    description="Saved snapshots in ingestion_run_reports."
  >
    <p class="op-muted op-note">
      Saved snapshots in <code class="op-code">ingestion_run_reports</code>. <strong>View report</strong> opens the legacy
      wizard read-only. <strong>Open</strong> needs the run to still be in memory on this instance.
    </p>
    {#if recentReports.length === 0}
      <p class="op-muted">None returned.</p>
    {:else}
      <table class="op-table">
        <thead>
          <tr
            ><th>Status</th><th>Completed</th><th>Source</th><th>Run ID</th><th class="op-actions-col"></th></tr
          >
        </thead>
        <tbody>
          {#each recentReports as rep (rep.runId)}
            <tr>
              <td>
                {reportStatusLabel(rep.status)}
                {#if rep.lastFailureStageKey}
                  <span class="op-subtle">{rep.lastFailureStageKey}</span>
                {/if}
                {#if rep.terminalError}
                  <span class="op-subtle" title={rep.terminalError}>{truncateUrl(rep.terminalError, 72)}</span>
                {/if}
              </td>
              <td class="op-mono">{formatWhen(rep.completedAtMs)}</td>
              <td class="op-ellip">{rep.sourceUrl}</td>
              <td class="op-mono">{rep.runId.slice(0, 12)}…</td>
              <td class="op-actions-col">
                <div class="op-btn-row">
                  <button type="button" class="op-mini" onclick={() => void copyRunId(rep.runId)}>Copy</button>
                  <button type="button" class="op-mini" onclick={() => viewSavedReport(rep.runId)}>View report</button>
                  <button
                    type="button"
                    class="op-mini"
                    disabled={!runs.some((x) => x.id === rep.runId)}
                    title={runs.some((x) => x.id === rep.runId)
                      ? 'Live monitor'
                      : 'Not in memory on this instance'}
                    onclick={() => openRunMonitor(rep.runId)}>Open live</button
                  >
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </IngestionSectionShell>
  </div>
</IngestionSettingsShell>

<style>
  .op-code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.85em;
  }
  .op-btn {
    margin-bottom: 18px;
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    cursor: pointer;
  }
  .op-btn-link {
    margin-bottom: 18px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }
  .op-btn-link:hover {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
  }
  .op-select {
    margin-bottom: 18px;
    min-height: 36px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
  }
  .op-muted {
    font-size: 0.88rem;
    opacity: 0.85;
  }
  .op-note {
    margin: 0 0 12px;
    max-width: 48rem;
  }
  .op-subtle {
    display: block;
    font-size: 0.75rem;
    opacity: 0.75;
    margin-top: 4px;
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
  .op-a {
    color: var(--color-blue);
  }
  .op-err {
    color: #f87171;
    font-size: 0.88rem;
  }

  .op-kpi-grid {
    display: grid;
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: 10px;
  }
  @media (min-width: 720px) {
    .op-kpi-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1080px) {
    .op-kpi-grid {
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
  }
  .op-kpi-card:hover {
    border-color: color-mix(in srgb, var(--color-sage) 35%, var(--color-border));
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
  .op-kpi-sub {
    margin-top: 6px;
    font-size: 0.82rem;
    opacity: 0.8;
  }
</style>
