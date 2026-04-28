<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authorizedFetchJson } from '$lib/authorizedFetchJson';
  import {
    GATE_BOOTSTRAP_QUERY_FLAG,
    GATE_BOOTSTRAP_STORAGE_KEY,
    type CoverageGateAiSuggestionItem,
    type GateFollowUpAction,
    type OperatorGateBootstrapV1
  } from '$lib/ingestion/operatorGateBootstrap';
  import IngestionSettingsShell from '$lib/components/admin/ingest/IngestionSettingsShell.svelte';
  import IngestionSectionShell from '$lib/components/admin/ingest/IngestionSectionShell.svelte';
  import IngestionPipelineActivityTimeline from '$lib/components/admin/ingest/IngestionPipelineActivityTimeline.svelte';

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
  let recentReports = $state<ReportRow[]>([]);
  let busy = $state(false);
  let err = $state('');

  type SavedView = { id: string; label: string; params: Record<string, string> };
  const SAVED_VIEWS_KEY = 'sophia.admin.ingest.monitoring.views.v1';
  const builtinViews: SavedView[] = [
    { id: 'monitor_runs', label: 'Runs (default)', params: {} },
    { id: 'monitor_history', label: 'Run history', params: { panel: 'history' } },
    { id: 'monitor_jobs', label: 'Durable jobs', params: { panel: 'jobs' } },
    { id: 'monitor_coverage', label: 'Inquiry corpus', params: { panel: 'coverage' } }
  ];
  let savedViews = $state<SavedView[]>([]);
  let activeViewId = $state<string>('monitor_runs');
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

  let searchQuery = $state('');

  const kpiJobsRunning = $derived(jobs.filter((j) => (j.status ?? '').toLowerCase() === 'running').length);

  type MonitorTab = 'runs' | 'history' | 'jobs' | 'coverage';

  const MONITOR_TAB_ORDER: MonitorTab[] = ['runs', 'history', 'jobs', 'coverage'];

  const MONITOR_TAB_LABELS: Record<MonitorTab, string> = {
    runs: 'Runs',
    history: 'Run history',
    jobs: 'Jobs',
    coverage: 'Inquiry corpus'
  };

  const activeTab = $derived.by((): MonitorTab => {
    const p = (page.url.searchParams.get('panel') ?? '').trim();
    if (p === 'history' || p === 'jobs' || p === 'coverage') return p;
    return 'runs';
  });

  const filteredRuns = $derived.by(() => {
    const st = (page.url.searchParams.get('status') ?? '').trim().toLowerCase();
    if (!st) return runs;
    return runs.filter((r) => (r.status ?? '').toLowerCase() === st);
  });

  const filteredJobs = $derived.by(() => {
    const st = (page.url.searchParams.get('status') ?? '').trim().toLowerCase();
    if (!st) return jobs;
    return jobs.filter((j) => (j.status ?? '').toLowerCase() === st);
  });

  function setMonitorPanel(next: MonitorTab): void {
    if (next === 'runs') patchUrlParams({ panel: '' });
    else patchUrlParams({ panel: next });
  }

  type RunHistoryStatusFilter = 'all' | 'done' | 'in_progress' | 'error' | 'other';
  type RunHistoryOriginFilter = 'all' | 'gutenberg' | 'sep' | 'iep' | 'paper' | 'web';

  let runHistorySearch = $state('');
  let runHistoryStatusFilter = $state<RunHistoryStatusFilter>('all');
  let runHistoryOriginFilter = $state<RunHistoryOriginFilter>('all');

  function reportOriginKind(url: string): RunHistoryOriginFilter {
    const u = url.trim();
    if (!u) return 'web';
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (host === 'gutenberg.org' || host.endsWith('.gutenberg.org')) return 'gutenberg';
      if (host === 'plato.stanford.edu' || host.endsWith('.plato.stanford.edu')) return 'sep';
      if (host === 'iep.utm.edu' || host.endsWith('.iep.utm.edu')) return 'iep';
      if (host === 'arxiv.org' || host.endsWith('.arxiv.org')) return 'paper';
      return 'web';
    } catch {
      return 'web';
    }
  }

  function matchesRunHistoryStatus(rep: ReportRow, f: RunHistoryStatusFilter): boolean {
    if (f === 'all') return true;
    const s = (rep.status ?? '').toLowerCase();
    if (f === 'done') return s === 'done';
    if (f === 'in_progress') return s === 'running' || s === 'awaiting_sync' || s === 'awaiting_promote';
    if (f === 'error') return s === 'error';
    return !['done', 'running', 'awaiting_sync', 'awaiting_promote', 'error'].includes(s);
  }

  const filteredRunHistory = $derived.by(() => {
    const q = runHistorySearch.trim().toLowerCase();
    return recentReports.filter((rep) => {
      if (!matchesRunHistoryStatus(rep, runHistoryStatusFilter)) return false;
      if (runHistoryOriginFilter !== 'all' && reportOriginKind(rep.sourceUrl) !== runHistoryOriginFilter) {
        return false;
      }
      if (!q) return true;
      const hay = [
        rep.runId,
        rep.sourceUrl,
        rep.sourceType ?? '',
        rep.status ?? '',
        rep.terminalError ?? '',
        rep.lastFailureStageKey ?? '',
        reportStatusLabel(rep.status)
      ]
        .join('\n')
        .toLowerCase();
      return hay.includes(q);
    });
  });

  function clearRunHistoryFilters(): void {
    runHistorySearch = '';
    runHistoryStatusFilter = 'all';
    runHistoryOriginFilter = 'all';
    patchUrlParams({ historyQ: '', historyStatus: '', historyOrigin: '' });
  }

  /** Hydrate run-history controls from the URL (saved views, shared links). */
  $effect(() => {
    void page.url.search;
    runHistorySearch = page.url.searchParams.get('historyQ') ?? '';
    const hs = page.url.searchParams.get('historyStatus');
    runHistoryStatusFilter =
      hs === 'done' || hs === 'in_progress' || hs === 'error' || hs === 'other' ? hs : 'all';
    const ho = page.url.searchParams.get('historyOrigin');
    runHistoryOriginFilter =
      ho === 'gutenberg' || ho === 'sep' || ho === 'iep' || ho === 'paper' || ho === 'web' ? ho : 'all';
  });

  // Queue ticking lives in Triage.

  // Inquiry corpus / coverage panel (answer-readiness for philosophical Q&A)
  type Phase1CohortSlice = {
    uniqueUrls: number;
    withAnyCompletedIngest?: number;
    phase2ReadyCount: number;
    missingFromCorpus: number;
    notValidatePath: number;
    incompletePipeline: number;
    skippedSurrealStore: number;
    sampleNotReady?: string[];
  };
  type CoveragePayload = {
    generatedAt?: string;
    presetGoal?: number;
    presets?: Array<{ id: string; label: string; goal: number; ingestedCount: number }>;
    sepIngestedOutsidePresets?: number;
    totals?: {
      uniqueSourcesCompleted: number;
      trainingAcceptableCount: number;
      trainingNotAcceptableCount: number;
      byOrigin: Record<string, number>;
    };
    phase1Readiness?: {
      allUnionUrlsPhase2Ready: boolean;
      note?: string;
      goldenFingerprint?: string;
      trainingCohortDays?: number;
      trainingUrlCap?: number;
      golden?: Phase1CohortSlice;
      training?: Phase1CohortSlice;
      union?: Phase1CohortSlice;
    } | null;
    phase1ReadinessError?: string | null;
    error?: string;
  };

  function formatCoverageSnapshot(iso: string | undefined): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }

  /** Stable label for gate-summary links (same tab uses client `goto` so the UI actually switches). */
  function labelForCoverageInsightDeepLink(href: string): string {
    try {
      const u = new URL(href, 'https://sophia.invalid');
      if (u.pathname.includes('/triage')) {
        const p = u.searchParams.get('panel') ?? '';
        if (p === 'issues') return 'Triage → Issues';
        if (p === 'ops') return 'Triage → Operations';
        if (p === 'dlq') return 'Triage → DLQ';
        if (p === 'promote') return 'Triage → Promote';
        return 'Triage';
      }
      if (u.pathname.includes('/activity')) {
        const p = (u.searchParams.get('panel') ?? '').trim() || 'runs';
        const map: Record<string, string> = {
          coverage: 'Monitoring → Inquiry corpus',
          runs: 'Monitoring → Runs',
          history: 'Monitoring → Run history',
          jobs: 'Monitoring → Jobs'
        };
        return map[p] ?? `Monitoring → ${p}`;
      }
    } catch {
      /* fall through */
    }
    return href.length > 56 ? `${href.slice(0, 54)}…` : href;
  }

  function dedupeCoverageInsightLinks(links: string[] | undefined): string[] {
    if (!links?.length) return [];
    return [...new Set(links.map((x) => x.trim()).filter(Boolean))];
  }

  const ACTIVITY_MONITOR_PATH = '/admin/ingest/operator/activity';

  function normalizePathname(pathname: string): string {
    if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
    return pathname;
  }

  /**
   * Use the same URL helpers as the KPI cards / tab bar. Plain `goto(href)` with `keepFocus` was a no-op
   * for some same-route query transitions in Monitoring, so clicks felt dead.
   */
  function goCoverageInsightDeepLink(href: string, e: MouseEvent): void {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      const dest = new URL(href, window.location.origin);
      const here = normalizePathname(page.url.pathname);
      const there = normalizePathname(dest.pathname);
      if (there === ACTIVITY_MONITOR_PATH) {
        if (here !== ACTIVITY_MONITOR_PATH) {
          void goto(`${dest.pathname}${dest.search}`, { noScroll: true, replaceState: false });
          return;
        }
        const panel = (dest.searchParams.get('panel') ?? '').trim();
        if (panel === '' || panel === 'runs') {
          replaceUrlParams({ panel: '' });
          return;
        }
        replaceUrlParams({ panel });
        return;
      }
    } catch {
      /* fall through */
    }
    void goto(href, { noScroll: true, replaceState: false });
  }

  function openOperatorWithGateBootstrap(fu: GateFollowUpAction): void {
    if (!fu.operatorBootstrap || typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(GATE_BOOTSTRAP_STORAGE_KEY, JSON.stringify(fu.operatorBootstrap));
    } catch {
      /* ignore */
    }
    void goto(`/admin/ingest/operator?step=sources&${GATE_BOOTSTRAP_QUERY_FLAG}=1`, {
      noScroll: true,
      replaceState: false
    });
  }

  function inferCatalogFromUrls(urls: string[]): 'sep' | 'gutenberg' | undefined {
    for (const x of urls) {
      try {
        const h = new URL(x.trim()).hostname.toLowerCase();
        if (h === 'gutenberg.org' || h.endsWith('.gutenberg.org')) return 'gutenberg';
        if (h.includes('stanford.edu') && h.includes('plato')) return 'sep';
        if (h === 'iep.utm.edu' || h.endsWith('.iep.utm.edu')) return 'sep';
      } catch {
        /* skip */
      }
    }
    return undefined;
  }

  function openOperatorWithAiGateItem(item: CoverageGateAiSuggestionItem): void {
    if (typeof window === 'undefined' || item.urls.length === 0) return;
    const notes = [
      `[AI] ${item.gateTitle}`,
      item.wizardTip ? `Tip: ${item.wizardTip}` : '',
      item.rationale ? `Context: ${item.rationale}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 8000);
    const boot: OperatorGateBootstrapV1 = {
      v: 1,
      urls: item.urls.slice(0, 35),
      validateLlm: true,
      jobValidationTailOnly: false,
      mergeIntoRunningJob: false,
      jobForceReingest: true,
      notes,
      sourceCatalog: inferCatalogFromUrls(item.urls)
    };
    try {
      sessionStorage.setItem(GATE_BOOTSTRAP_STORAGE_KEY, JSON.stringify(boot));
    } catch {
      /* ignore */
    }
    void goto(`/admin/ingest/operator?step=sources&${GATE_BOOTSTRAP_QUERY_FLAG}=1`, {
      noScroll: true,
      replaceState: false
    });
  }
  let coverage = $state<CoveragePayload | null>(null);
  let coverageErr = $state('');
  let coverageBusy = $state(false);
  let coverageInsightsBusy = $state(false);
  let coverageInsightsErr = $state('');
  type CoverageGateInsightRow = {
    gate: string;
    status: string;
    evidence: string;
    next_actions: string[];
    deep_links?: string[];
    suggested_follow_ups?: GateFollowUpAction[];
    ai_suggestion?: CoverageGateAiSuggestionItem;
  };
  let coverageInsights = $state<{
    summary: string;
    gates: CoverageGateInsightRow[];
    ai_error?: string;
    ai_model?: { provider: string; modelId: string };
  } | null>(null);
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

  /** Reset monitoring filters, then set only the given keys (KPI cards, saved views, section picker). */
  function replaceUrlParams(params: Record<string, string>): void {
    const url = new URL(page.url);
    for (const k of ['panel', 'failureClass', 'q', 'status', 'since', 'historyQ', 'historyStatus', 'historyOrigin']) {
      url.searchParams.delete(k);
    }
    for (const [k, v] of Object.entries(params)) {
      const t = String(v).trim();
      if (t !== '') url.searchParams.set(k, t);
    }
    void goto(`${url.pathname}${url.search}`, { replaceState: false, noScroll: true });
  }

  /** Update one or more query keys without wiping the rest (failure class, status, search q). */
  function patchUrlParams(params: Record<string, string>): void {
    const url = new URL(page.url);
    for (const [k, v] of Object.entries(params)) {
      const t = String(v).trim();
      if (t === '') url.searchParams.delete(k);
      else url.searchParams.set(k, t);
    }
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
    replaceUrlParams({ q: raw });
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
    for (const k of ['panel', 'failureClass', 'q', 'status', 'historyQ', 'historyStatus', 'historyOrigin']) {
      const v = page.url.searchParams.get(k);
      if (v && v.trim() !== '') params[k] = v.trim();
    }
    if (activeTab === 'history') {
      params.panel = 'history';
      const hq = runHistorySearch.trim();
      if (hq) params.historyQ = hq;
      else delete params.historyQ;
      if (runHistoryStatusFilter !== 'all') params.historyStatus = runHistoryStatusFilter;
      else delete params.historyStatus;
      if (runHistoryOriginFilter !== 'all') params.historyOrigin = runHistoryOriginFilter;
      else delete params.historyOrigin;
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
    replaceUrlParams({ panel: 'runs', q: runId });
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
    awaitingSync?: boolean;
    awaitingPromote?: boolean;
    stages: unknown;
    logLines: string[];
    issues: unknown[];
    issueCount: number;
    error: string | null;
    currentStageKey?: string | null;
    currentAction?: string | null;
    lastFailureStageKey?: string | null;
    resumable?: boolean;
    validate?: boolean;
    createdAt: number;
    completedAt: number | null;
    excludeFromBatchSuggest?: boolean;
    processAlive?: boolean;
  };

  /** Fields returned by `/status` (incremental logs + full stage snapshot). */
  type LiveRunStatusPoll = {
    id: string;
    status: string;
    awaitingSync?: boolean;
    awaitingPromote?: boolean;
    stages: LiveRunDetail['stages'];
    logLines: string[];
    logLineTotal: number;
    logIncremental?: boolean;
    issues: LiveRunDetail['issues'];
    issueCount: number;
    error: string | null;
    currentStageKey?: string | null;
    currentAction?: string | null;
    lastFailureStageKey?: string | null;
    resumable?: boolean;
    processAlive?: boolean;
    completedAt?: number | null;
    createdAt?: number;
    syncStartedAt?: number | null;
    syncCompletedAt?: number | null;
    excludeFromBatchSuggest?: boolean;
  };

  function runInspectorNeedsPolling(status: string, processAlive?: boolean): boolean {
    if (processAlive) return true;
    return (
      status === 'running' ||
      status === 'queued' ||
      status === 'awaiting_sync' ||
      status === 'awaiting_promote'
    );
  }

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
  let runInspectorSince = $state(0);
  /** Monitoring run inspector only: single-column tabs (does not affect run console). */
  let runInspectorDetailTab = $state<'pipeline' | 'issues' | 'log'>('pipeline');
  /** When false, only summary rows + actions stay visible (tabs / log / report JSON hidden). */
  let runInspectorDetailsExpanded = $state(true);

  const runInspectorStatus = $derived(liveRun?.status ?? '');
  const runInspectorProcessAlive = $derived(liveRun?.processAlive === true);
  const runInspectorPollMs = $derived.by(() => {
    if (!liveRun) return 4000;
    const active =
      runInspectorProcessAlive ||
      runInspectorStatus === 'running' ||
      runInspectorStatus === 'queued';
    const slow =
      runInspectorStatus === 'awaiting_sync' || runInspectorStatus === 'awaiting_promote';
    if (active) return Math.min(780, 560);
    if (slow) return 2200;
    return 5000;
  });

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
    runInspectorSince = 0;
    try {
      // Prefer live in-memory run (pipeline activity + log lines).
      liveRun = await authorizedFetchJson<LiveRunDetail>(`/api/admin/ingest/run/${encodeURIComponent(runId)}`);
      runInspectorSince = liveRun.logLines.length;
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

  async function refreshRunInspectorIncremental(): Promise<void> {
    if (!selectedRunId) return;
    const prev = liveRun;
    if (!prev) return;
    try {
      const url = `/api/admin/ingest/run/${encodeURIComponent(selectedRunId)}/status?since=${runInspectorSince}`;
      const body = await authorizedFetchJson<LiveRunStatusPoll>(url);
      if (body.logIncremental && Array.isArray(body.logLines)) {
        liveRun = {
          ...prev,
          ...body,
          logLines: [...prev.logLines, ...body.logLines],
          validate: prev.validate
        };
      } else {
        liveRun = { ...prev, ...body, validate: prev.validate };
      }
      runInspectorSince =
        typeof body.logLineTotal === 'number' && body.logLineTotal >= 0
          ? body.logLineTotal
          : runInspectorSince + (body.logLines?.length ?? 0);
    } catch {
      /* Run may no longer be in memory on this instance. */
    }
  }

  hydrateSavedViews();
  syncActiveViewFromUrl();
  load();
  void loadCoverage();
  void loadThinkerQueue();

  /** Promote, DLQ, and admin operations live on Triage; forward legacy Monitoring links. */
  $effect(() => {
    if (typeof window === 'undefined') return;
    void page.url.search;
    const p = (page.url.searchParams.get('panel') ?? '').trim();
    if (p !== 'promote' && p !== 'dlq' && p !== 'ops') return;
    const dest = new URL('/admin/ingest/operator/triage', window.location.origin);
    dest.search = page.url.search;
    void goto(`${dest.pathname}${dest.search}`, { replaceState: true });
  });

  $effect(() => {
    // Keep the picker in sync as URL params change.
    void page.url.search;
    syncActiveViewFromUrl();
  });

  $effect(() => {
    void page.url.search;
    const p = (page.url.searchParams.get('panel') ?? '').trim();
    const onRuns = p === '' || p === 'runs';
    const q = (page.url.searchParams.get('q') ?? '').trim();
    if (!onRuns || !q) {
      selectedRunId = '';
      liveRun = null;
      runReport = null;
      runDetailErr = '';
      runInspectorDetailTab = 'pipeline';
      runInspectorDetailsExpanded = true;
      return;
    }
    if (q === selectedRunId) return;
    selectedRunId = q;
    runInspectorDetailTab = 'pipeline';
    runInspectorDetailsExpanded = true;
    void loadRunInspector(q);
  });

  $effect(() => {
    const id = selectedRunId;
    const run = liveRun;
    const ms = runInspectorPollMs;
    if (!id || !run || runDetailBusy) return;
    if (!runInspectorNeedsPolling(run.status, run.processAlive)) return;
    const t = setInterval(() => {
      void refreshRunInspectorIncremental();
    }, ms);
    return () => clearInterval(t);
  });
</script>

<svelte:head>
  <title>Monitoring — Operator</title>
</svelte:head>

<IngestionSettingsShell
  activeNav="monitoring"
  journeyStage="monitor"
  title="Monitoring"
  lead="Filterable monitoring: runs, job queue, inquiry corpus gates, and investigation. Promote, DLQ, embedding maintenance, and admin operations live in Triage."
>
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
          if (v) replaceUrlParams(v.params as Record<string, string>);
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
        value={activeTab}
        onchange={(e) => setMonitorPanel((e.currentTarget as HTMLSelectElement).value as MonitorTab)}
        title="Panel"
      >
        <option value="runs">Runs</option>
        <option value="history">Run history</option>
        <option value="jobs">Jobs</option>
        <option value="coverage">Inquiry corpus</option>
      </select>
      <input
        class="op-select"
        placeholder="q: URL / run id / job id…"
        value={q}
        onkeydown={(e) => {
          if (e.key === 'Enter') patchUrlParams({ q: (e.currentTarget as HTMLInputElement).value.trim() });
        }}
      />
      <select
        class="op-select"
        value={status}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          patchUrlParams({ status: v });
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
          Snapshot of durable jobs and gates. Operator queues (promote, DLQ, ops, embedding) use Triage.
        </p>
      </div>
      <div class="op-actions" style="margin-bottom:0; margin-left:auto">
        <button type="button" class="op-btn op-btn-link" disabled={busy} onclick={load}>{busy ? 'Loading…' : 'Refresh'}</button>
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/triage">Open Triage</a>
      </div>
    </div>
  </div>

  <div class="op-kpi-grid mb-4">
    <button type="button" class="op-kpi-card" onclick={() => replaceUrlParams({ panel: 'jobs' })}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Durable jobs</span>
        <span class="op-kpi-pill">Running</span>
      </div>
      <div class="op-kpi-v">{kpiJobsRunning}</div>
      <div class="op-kpi-sub">Queue health + summaries</div>
    </button>
    <button type="button" class="op-kpi-card" onclick={() => replaceUrlParams({ panel: 'coverage' })}>
      <div class="op-kpi-top">
        <span class="op-kpi-k">Inquiry corpus</span>
        <span class="op-kpi-pill">Grounding</span>
      </div>
      <div class="op-kpi-v">{coverage?.phase1Readiness?.allUnionUrlsPhase2Ready ? 'Ready' : 'Not ready'}</div>
      <div class="op-kpi-sub">Core URLs answer-ready for Q&amp;A</div>
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

  {#if err}
    <p class="op-err" role="alert">{err}</p>
  {/if}

  <div class="op-tabbar" role="tablist" aria-label="Monitoring detail">
    {#each MONITOR_TAB_ORDER as tabId (tabId)}
      <button
        type="button"
        role="tab"
        id="monitor-tab-{tabId}"
        class="op-tab"
        class:op-tab--active={activeTab === tabId}
        aria-selected={activeTab === tabId}
        aria-controls="monitor-panel-{tabId}"
        tabindex={activeTab === tabId ? 0 : -1}
        onclick={() => setMonitorPanel(tabId)}
      >
        {MONITOR_TAB_LABELS[tabId]}
      </button>
    {/each}
  </div>

  <div class="op-tab-panels mt-4">
    {#if activeTab === 'runs'}
      <div id="monitor-panel-runs" role="tabpanel" aria-labelledby="monitor-tab-runs">
        <IngestionSectionShell
          title="This server (in-memory runs)"
          description="Live runs held by this process. Status filter above narrows this table. Use Open for the run inspector."
        >
          {#if filteredRuns.length === 0}
            <p class="op-muted">{runs.length === 0 ? 'None in this process.' : 'No runs match the status filter.'}</p>
          {:else}
            <table class="op-table">
              <thead>
                <tr><th>Run</th><th>Status</th><th>Source</th><th class="op-actions-col"></th></tr>
              </thead>
              <tbody>
                {#each filteredRuns as r (r.id)}
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

          {#if q}
            <div class="mt-4">
              <IngestionSectionShell
                title="Run inspector"
                description="Compact view: pipeline, issues, and log in tabs. Use run console for controls and full layout."
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
                  {#if liveRun || runReport}
                    <button
                      type="button"
                      class="op-btn op-btn-link"
                      aria-expanded={runInspectorDetailsExpanded}
                      onclick={() => (runInspectorDetailsExpanded = !runInspectorDetailsExpanded)}
                    >
                      {runInspectorDetailsExpanded ? 'Hide details' : 'Show details'}
                    </button>
                  {/if}
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
                  <div class="op-run-meta op-run-meta--compact">
                    <span class="op-mono op-run-meta__id">{liveRun.id}</span>
                    <code class="op-code">{liveRun.status}</code>
                    {#if liveRun.awaitingSync}<span class="op-run-meta__pill">sync</span>{/if}
                    {#if liveRun.awaitingPromote}<span class="op-run-meta__pill">promote</span>{/if}
                    {#if liveRun.resumable}<span class="op-run-meta__pill">resumable</span>{/if}
                    <a
                      class="op-a op-run-meta__console"
                      href="/admin/ingest/operator/run-console/{encodeURIComponent(liveRun.id)}">Console</a>
                  </div>
                  {#if liveRun.error}
                    <p class="op-subtle op-run-meta-err" title={liveRun.error}>{liveRun.error}</p>
                  {/if}
                  {#if !runInspectorDetailsExpanded && liveRun.currentAction}
                    <p class="op-muted op-run-inspector-peek" title={liveRun.currentAction}>
                      {truncateUrl(liveRun.currentAction, 140)}
                    </p>
                  {/if}

                  {#if runInspectorDetailsExpanded}
                  <div class="op-run-inspector-tabs" role="tablist" aria-label="Run detail">
                    <button
                      type="button"
                      role="tab"
                      class="op-run-inspector-tab"
                      class:op-run-inspector-tab--active={runInspectorDetailTab === 'pipeline'}
                      aria-selected={runInspectorDetailTab === 'pipeline'}
                      id="run-insp-tab-pipeline"
                      tabindex={runInspectorDetailTab === 'pipeline' ? 0 : -1}
                      onclick={() => (runInspectorDetailTab = 'pipeline')}>Pipeline</button>
                    <button
                      type="button"
                      role="tab"
                      class="op-run-inspector-tab"
                      class:op-run-inspector-tab--active={runInspectorDetailTab === 'issues'}
                      aria-selected={runInspectorDetailTab === 'issues'}
                      id="run-insp-tab-issues"
                      tabindex={runInspectorDetailTab === 'issues' ? 0 : -1}
                      onclick={() => (runInspectorDetailTab = 'issues')}
                      >Issues {(liveRun.issues ?? []).length ? `(${liveRun.issues.length})` : ''}</button>
                    <button
                      type="button"
                      role="tab"
                      class="op-run-inspector-tab"
                      class:op-run-inspector-tab--active={runInspectorDetailTab === 'log'}
                      aria-selected={runInspectorDetailTab === 'log'}
                      id="run-insp-tab-log"
                      tabindex={runInspectorDetailTab === 'log' ? 0 : -1}
                      onclick={() => (runInspectorDetailTab = 'log')}>Raw log</button>
                  </div>

                  <div class="op-run-inspector-panel">
                    {#if runInspectorDetailTab === 'pipeline'}
                      <div role="tabpanel" aria-labelledby="run-insp-tab-pipeline">
                        <IngestionPipelineActivityTimeline
                          compact={true}
                          stages={liveRun.stages}
                          currentStageKey={liveRun.currentStageKey ?? null}
                          currentAction={liveRun.currentAction ?? null}
                          lastFailureStageKey={liveRun.lastFailureStageKey ?? null}
                          logLines={liveRun.logLines ?? []}
                        />
                      </div>
                    {:else if runInspectorDetailTab === 'issues'}
                      <div role="tabpanel" aria-labelledby="run-insp-tab-issues" aria-label="Run issues">
                        {#if (liveRun.issues ?? []).length === 0}
                          <p class="op-muted" style="margin:0">None recorded.</p>
                        {:else}
                          <ul class="op-run-issue-list op-run-issue-list--tabbed">
                            {#each liveRun.issues.slice(0, 24) as iss, i (i)}
                              <li class="op-mono sm">
                                {typeof iss === 'object' && iss !== null && 'message' in iss
                                  ? String((iss as { message?: unknown }).message ?? JSON.stringify(iss))
                                  : JSON.stringify(iss)}
                              </li>
                            {/each}
                          </ul>
                          {#if liveRun.issues.length > 24}
                            <details class="op-muted" style="margin-top:8px">
                              <summary class="op-a" style="cursor:pointer">All issues (JSON)</summary>
                              <pre class="op-mono sm op-run-inspector-json">{JSON.stringify(liveRun.issues, null, 2)}</pre>
                            </details>
                          {/if}
                        {/if}
                      </div>
                    {:else}
                      <div role="tabpanel" aria-labelledby="run-insp-tab-log" aria-label="Raw worker log">
                        <pre class="op-run-log-pre op-mono sm op-run-log-pre--tabbed">{(liveRun.logLines ?? [])
                            .slice(-200)
                            .join('\n')}</pre>
                        <details class="op-muted" style="margin-top:10px">
                          <summary class="op-a" style="cursor:pointer">Stages JSON</summary>
                          <pre class="op-mono sm op-run-inspector-json">{JSON.stringify(liveRun.stages ?? null, null, 2)}</pre>
                        </details>
                      </div>
                    {/if}
                  </div>
                  {/if}
                {:else if runReport}
                  <div class="op-run-meta op-run-meta--compact">
                    <span class="op-mono op-run-meta__id">{runReport.runId}</span>
                    <code class="op-code">{runReport.status ?? '—'}</code>
                    {#if runReport.lastFailureStageKey}<span class="op-run-meta__pill">{runReport.lastFailureStageKey}</span>{/if}
                    <a
                      class="op-a op-run-meta__console"
                      href="/admin/ingest/operator/run-console/{encodeURIComponent(runReport.runId)}">Console</a>
                  </div>
                  {#if runReport.terminalError}
                    <p class="op-subtle op-run-meta-err" title={runReport.terminalError}>
                      {truncateUrl(runReport.terminalError, 96)}
                    </p>
                  {/if}
                  {#if runInspectorDetailsExpanded}
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
                  {/if}
                {:else}
                  <p class="op-muted">Select a run and click “Open”.</p>
                {/if}
              </IngestionSectionShell>
            </div>
          {/if}
        </IngestionSectionShell>

      </div>
    {:else if activeTab === 'history'}
      <div id="monitor-panel-history" role="tabpanel" aria-labelledby="monitor-tab-history">
        <IngestionSectionShell
          title="Run history"
          description="Persisted snapshots from ingestion_run_reports (Firestore). Filter and search below; View report opens the legacy wizard; Open live uses the run console when the run is in memory on this instance."
        >
          <div slot="actions" class="op-actions" style="margin-top:0">
            <button type="button" class="op-btn op-btn-link" disabled={busy} onclick={() => void load()}>
              {busy ? 'Loading…' : 'Refresh list'}
            </button>
          </div>

          <div class="op-run-history-filters">
            <label class="op-run-history-filters__field">
              <span class="op-muted op-run-history-filters__label">Search</span>
              <input
                class="op-input op-run-history-filters__input"
                type="search"
                placeholder="Run id, source URL, status, stage, error…"
                bind:value={runHistorySearch}
                aria-label="Filter run history by text"
              />
            </label>
            <label class="op-run-history-filters__field">
              <span class="op-muted op-run-history-filters__label">Status</span>
              <select class="op-select" bind:value={runHistoryStatusFilter} title="Filter by snapshot status">
                <option value="all">All statuses</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
                <option value="error">Failed</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label class="op-run-history-filters__field">
              <span class="op-muted op-run-history-filters__label">Source</span>
              <select class="op-select" bind:value={runHistoryOriginFilter} title="Filter by source site / type">
                <option value="all">All sources</option>
                <option value="gutenberg">Gutenberg</option>
                <option value="sep">SEP</option>
                <option value="iep">IEP</option>
                <option value="paper">arXiv / paper</option>
                <option value="web">Web / other</option>
              </select>
            </label>
            <button type="button" class="op-btn op-btn-link op-run-history-filters__clear" onclick={clearRunHistoryFilters}>
              Clear filters
            </button>
          </div>

          <p class="op-muted" style="margin:10px 0 12px">
            Showing <strong>{filteredRunHistory.length}</strong> of <strong>{recentReports.length}</strong> snapshot(s).
          </p>

          {#if recentReports.length === 0}
            <p class="op-muted">None returned from the server yet.</p>
          {:else if filteredRunHistory.length === 0}
            <p class="op-muted">No rows match the current filters.</p>
          {:else}
            <table class="op-table">
              <thead>
                <tr
                  ><th>Status</th><th>Completed</th><th>Source</th><th>Run ID</th><th class="op-actions-col"></th></tr
                >
              </thead>
              <tbody>
                {#each filteredRunHistory as rep (rep.runId)}
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
    {:else if activeTab === 'jobs'}
      <div id="monitor-panel-jobs" role="tabpanel" aria-labelledby="monitor-tab-jobs">
        <IngestionSectionShell title="Durable jobs (Neon)" description="Job-level queue state and summary counts.">
          {#if filteredJobs.length === 0}
            <p class="op-muted">{jobs.length === 0 ? 'None returned.' : 'No jobs match the status filter.'}</p>
          {:else}
            <table class="op-table">
              <thead>
                <tr><th>Job</th><th>Status</th><th>Summary</th><th class="op-actions-col">Recover</th></tr>
              </thead>
              <tbody>
                {#each filteredJobs as j (j.id)}
                  <tr>
                    <td>
                      <button type="button" class="op-mini" onclick={() => patchUrlParams({ panel: 'jobs', q: j.id })}>
                        {j.id.slice(0, 14)}…
                      </button>
                    </td>
                    <td>{j.status}</td>
                    <td class="op-mono sm">{JSON.stringify(j.summary ?? {})}</td>
                    <td class="op-actions-col">
                      <a
                        class="op-a"
                        style="font-size: 0.85rem"
                        href="/admin/ingest/operator/triage?panel=ops&jobId={encodeURIComponent(j.id)}"
                        title="Open Triage with this job id for restart / resume"
                      >
                        Recover
                      </a>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          {#if q}
            <p class="op-muted mt-4">
              Drill-down query <code class="op-code">{q}</code> — open <a class="op-a" href="/admin/ingest/operator/triage?panel=ops&jobId={encodeURIComponent(q)}">Triage → Operations</a> for this job.
            </p>
          {/if}
        </IngestionSectionShell>
      </div>
    {:else if activeTab === 'coverage'}
      <div id="monitor-panel-coverage" role="tabpanel" aria-labelledby="monitor-tab-coverage">
        <IngestionSectionShell
          title="Inquiry corpus"
          description="Whether the philosophy content behind user inquiries is actually in the retrieval layer: validated extractions, embeddings, and graph rows—not only jobs marked complete. Fed from Neon."
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
              title="Rule-based gate summary plus AI-suggested SEP / IEP / Gutenberg URLs for failing gates (host-filtered). Set SOPHIA_COVERAGE_GATE_AI=0 to skip the model call."
            >
              {coverageInsightsBusy ? 'Working…' : 'Summarize gates'}
            </button>
          </div>
          {#if coverageErr}
            <p class="op-err" role="alert">{coverageErr}</p>
          {/if}
          {#if !coverage}
            <p class="op-muted">No data.</p>
          {:else}
            <p class="op-coverage-lead">
              <strong>Why this exists:</strong> philosophical inquiries need <strong>retrievable, checked philosophy text</strong>—claims and relations users can ground answers in. This panel tracks whether your
              <em>reference URL set</em> (golden checks ∪ recent validate-on ingests) has finished the full path: cross-check extraction, embeddings, and a real write to the graph—not a thin “complete” status alone.
            </p>

            <div class="op-coverage-meta op-muted">
              <span>Updated <span class="op-mono">{formatCoverageSnapshot(coverage.generatedAt)}</span></span>
              <span class="op-coverage-meta__sep" aria-hidden="true">·</span>
              <span>Reference cohort ~{coverage.phase1Readiness?.trainingCohortDays ?? '—'}d lookback · up to {coverage.phase1Readiness?.trainingUrlCap ?? '—'} URLs</span>
            </div>

            <div class="op-kpi-grid op-kpi-grid--coverage">
              <div class="op-kpi-card op-kpi-card--static">
                <div class="op-kpi-top">
                  <span class="op-kpi-k">Sources in corpus</span>
                </div>
                <div class="op-kpi-v">{coverage.totals?.uniqueSourcesCompleted ?? 0}</div>
                <div class="op-kpi-sub">Distinct URLs with a winning “done” ingest (Neon merge)</div>
              </div>
              <div class="op-kpi-card op-kpi-card--static">
                <div class="op-kpi-top">
                  <span class="op-kpi-k">Grounding-trusted</span>
                </div>
                <div class="op-kpi-v">{coverage.totals?.trainingAcceptableCount ?? 0}</div>
                <div class="op-kpi-sub">Safe to lean on for answers—passes governance + extraction lineage checks</div>
              </div>
              <div class="op-kpi-card op-kpi-card--static">
                <div class="op-kpi-top">
                  <span class="op-kpi-k">Needs review / blocked</span>
                </div>
                <div class="op-kpi-v">{coverage.totals?.trainingNotAcceptableCount ?? 0}</div>
                <div class="op-kpi-sub">Excluded from the trusted slice (governance, degraded routes, or lineage)</div>
              </div>
              {#if typeof coverage.sepIngestedOutsidePresets === 'number'}
                <div class="op-kpi-card op-kpi-card--static">
                  <div class="op-kpi-top">
                    <span class="op-kpi-k">SEP breadth</span>
                  </div>
                  <div class="op-kpi-v">{coverage.sepIngestedOutsidePresets}</div>
                  <div class="op-kpi-sub">SEP entries outside curated topic bundles—often fine for general Q&amp;A</div>
                </div>
              {/if}
            </div>

            {#if coverage.phase1ReadinessError}
              <p class="op-err" role="alert" style="margin: 12px 0 8px">
                Reference cohort block could not load: {coverage.phase1ReadinessError}
              </p>
            {/if}

            {#if coverage.phase1Readiness?.union}
              {@const u = coverage.phase1Readiness.union}
              {@const gateOk = coverage.phase1Readiness.allUnionUrlsPhase2Ready === true}
              {@const pct = u.uniqueUrls > 0 ? Math.min(100, Math.round((100 * u.phase2ReadyCount) / u.uniqueUrls)) : 0}
              <div class="op-coverage-hero">
                <div class="op-coverage-hero-main">
                  <span
                    class="op-coverage-gate"
                    class:op-coverage-gate--ready={gateOk}
                    class:op-coverage-gate--pending={!gateOk}
                    role="status"
                  >
                    {gateOk ? 'Answer-ready: core slice clear' : 'Answer-ready: gaps in core slice'}
                  </span>
                  <p class="op-coverage-hero-caption op-muted">
                    {#if u.uniqueUrls === 0}
                      No reference URLs in this cohort yet—check golden JSON and the Neon validate cohort query.
                    {:else}
                      <span class="op-mono">{u.phase2ReadyCount}</span> of <span class="op-mono">{u.uniqueUrls}</span> reference URLs are fully
                      validated, embedded, and stored for retrieval ({pct}%).
                    {/if}
                  </p>
                  {#if u.uniqueUrls > 0}
                    <div class="op-coverage-bar" aria-hidden="true">
                      <div
                        class="op-coverage-bar__fill"
                        class:op-coverage-bar__fill--ok={pct >= 100}
                        style:width="{pct}%"
                      ></div>
                    </div>
                  {/if}
                </div>
              </div>

              {#if u.uniqueUrls > 0}
                <p class="op-coverage-gap-head op-muted">Why some URLs are not answer-ready yet</p>
                <div class="op-coverage-cohort-grid">
                  <div class="op-coverage-cohort-card">
                    <span class="op-coverage-cohort-card__k">Full pipeline (Q&amp;A-ready)</span>
                    <span class="op-coverage-cohort-card__v op-coverage-cohort-card__v--ok">{u.phase2ReadyCount}</span>
                  </div>
                  <div class="op-coverage-cohort-card">
                    <span class="op-coverage-cohort-card__k">Not in corpus yet</span>
                    <span class="op-coverage-cohort-card__v">{u.missingFromCorpus}</span>
                  </div>
                  <div class="op-coverage-cohort-card">
                    <span class="op-coverage-cohort-card__k">Validate off / wrong path</span>
                    <span class="op-coverage-cohort-card__v">{u.notValidatePath}</span>
                  </div>
                  <div class="op-coverage-cohort-card">
                    <span class="op-coverage-cohort-card__k">Pipeline incomplete</span>
                    <span class="op-coverage-cohort-card__v">{u.incompletePipeline}</span>
                  </div>
                  <div class="op-coverage-cohort-card">
                    <span class="op-coverage-cohort-card__k">Store skipped (no write)</span>
                    <span class="op-coverage-cohort-card__v">{u.skippedSurrealStore}</span>
                  </div>
                </div>
              {/if}

              {#if u.uniqueUrls === 0}
                <p class="op-muted" style="margin-top: 10px">
                  Configure <code class="op-code">golden-extraction-eval.json</code> and ensure the Neon reference cohort query returns URLs.
                </p>
              {:else if !gateOk && u.sampleNotReady?.length}
                <div class="op-coverage-samples">
                  <span class="op-coverage-samples__label op-muted">Examples not yet ready for grounded answers</span>
                  <ul class="op-coverage-samples__list">
                    {#each u.sampleNotReady.slice(0, 5) as s (s)}
                      <li><code class="op-code op-coverage-samples__url" title={s}>{s}</code></li>
                    {/each}
                  </ul>
                </div>
              {/if}
            {/if}

            {#if coverage.presets && coverage.presets.length > 0}
              <details class="op-coverage-details">
                <summary>SEP topic bundles ({coverage.presets.length})</summary>
                <ul class="op-coverage-details-list">
                  {#each coverage.presets as p (p.id)}
                    <li>
                      <strong>{p.label}</strong> — {p.ingestedCount} / {p.goal ?? coverage.presetGoal ?? '—'} ingested
                    </li>
                  {/each}
                </ul>
              </details>
            {/if}

            <details class="op-coverage-details">
              <summary>What “answer-ready” means here</summary>
              <ul class="op-coverage-details-list">
                <li>
                  For each reference URL we use the <strong>latest finished ingest</strong> and check that validation ran, embeddings exist, and the philosophy graph was actually written—not only a “done” flag.
                </li>
                <li>
                  <strong>Operator focus:</strong> clear “pipeline incomplete” and missing corpus rows first; turn on validate for sources you want in the trusted slice; avoid accidental store-skips when users should see that text in Q&amp;A.
                </li>
                <li>
                  <strong>Grounding-trusted</strong> (card above) is separate: it flags sources we trust for lineage and governance. The progress bar is about the <strong>full technical path</strong> into vectors + graph.
                </li>
              </ul>
            </details>

            <details class="op-coverage-details op-coverage-details--technical">
              <summary>Technical criteria (report envelope / timing)</summary>
              <p class="op-muted" style="margin: 0 0 8px">
                {coverage.phase1Readiness?.note ??
                  'Reference cohort block not loaded — see errors above if present.'}
              </p>
              {#if coverage.phase1Readiness?.goldenFingerprint}
                <p class="op-muted" style="margin: 0">
                  Golden fingerprint <code class="op-code">{coverage.phase1Readiness.goldenFingerprint}</code>
                </p>
              {/if}
            </details>
          {/if}

          {#if coverageInsightsErr}
            <p class="op-err" role="alert">{coverageInsightsErr}</p>
          {/if}
          {#if coverageInsights}
            <div class="op-coverage-insights">
              <p class="op-coverage-insights__title">Gate summary</p>
              <p class="op-muted op-coverage-insights__summary">{coverageInsights.summary}</p>
              {#if coverageInsights.ai_error}
                <p class="op-err" role="status">AI suggestions: {coverageInsights.ai_error}</p>
              {:else if coverageInsights.ai_model}
                <p class="op-muted op-coverage-ai-model">
                  AI source ideas:
                  <span class="op-mono">{coverageInsights.ai_model.provider}</span>
                  ·
                  <span class="op-mono">{coverageInsights.ai_model.modelId}</span>
                </p>
              {/if}
              <div class="op-coverage-insights__gates">
                {#each coverageInsights.gates as g, i (i)}
                  <div class="op-coverage-insight-card">
                    <p class="op-coverage-insight-card__head">
                      <strong>{g.gate}</strong>
                      <span
                        class="op-coverage-insight-card__status"
                        class:op-coverage-insight-card__status--pass={g.status === 'pass'}
                        class:op-coverage-insight-card__status--fail={g.status === 'fail'}
                        class:op-coverage-insight-card__status--unknown={g.status === 'unknown'}
                      >{g.status}</span>
                    </p>
                    <p class="op-muted op-coverage-insight-card__evidence">{g.evidence}</p>
                    <ul class="op-muted op-coverage-insight-card__actions">
                      {#each g.next_actions as a (a)}
                        <li>{a}</li>
                      {/each}
                    </ul>
                    {#if g.deep_links?.length}
                      {@const links = dedupeCoverageInsightLinks(g.deep_links)}
                      <div class="op-coverage-insight-card__links-wrap">
                        <span class="op-coverage-insight-card__links-head">Where to act</span>
                        <ul class="op-coverage-insight-card__links">
                          {#each links as href (href)}
                            <li>
                              <a
                                class="op-coverage-insight-card__link"
                                href={href}
                                title={href}
                                onclick={(e) => goCoverageInsightDeepLink(href, e)}
                              >
                                {labelForCoverageInsightDeepLink(href)}
                              </a>
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                    {#if g.suggested_follow_ups?.length}
                      <div class="op-coverage-gate-followups">
                        <span class="op-coverage-gate-ai__head">Suggested fixes</span>
                        {#each g.suggested_follow_ups as fu (fu.id)}
                          <div class="op-coverage-gate-followups__item">
                            <p class="op-coverage-gate-followups__title"><strong>{fu.title}</strong></p>
                            <p class="op-muted op-coverage-gate-followups__desc">{fu.description}</p>
                            <div class="op-coverage-gate-followups__row">
                              <a
                                class="op-btn op-btn-link"
                                href={fu.href}
                                title={fu.href}
                                onclick={(e) => goCoverageInsightDeepLink(fu.href, e)}
                              >
                                {fu.hrefLabel}
                              </a>
                              {#if fu.operatorBootstrap}
                                <button type="button" class="op-btn op-btn-link" onclick={() => openOperatorWithGateBootstrap(fu)}>
                                  Open Operator with settings
                                </button>
                              {/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/if}
                    {#if g.ai_suggestion}
                      <div class="op-coverage-gate-ai">
                        <span class="op-coverage-gate-ai__head">AI-suggested sources</span>
                        <p class="op-muted op-coverage-gate-ai__rationale">{g.ai_suggestion.rationale}</p>
                        {#if g.ai_suggestion.wizardTip}
                          <p class="op-muted op-coverage-gate-ai__tip">
                            <strong>Wizard tip:</strong>
                            {g.ai_suggestion.wizardTip}
                          </p>
                        {/if}
                        <ul class="op-coverage-gate-ai__urls">
                          {#each g.ai_suggestion.urls as u (u)}
                            <li>
                              <a class="op-a" href={u} target="_blank" rel="noreferrer">{u}</a>
                            </li>
                          {/each}
                        </ul>
                        <button
                          type="button"
                          class="op-btn op-btn-link"
                          onclick={() => {
                            const s = g.ai_suggestion;
                            if (s) openOperatorWithAiGateItem(s);
                          }}
                        >
                          Open Operator with these URLs
                        </button>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </IngestionSectionShell>
      </div>
    {/if}
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
  .op-run-history-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px 16px;
    margin-bottom: 4px;
  }
  .op-run-history-filters__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: min(100%, 12rem);
    flex: 1 1 10rem;
  }
  .op-run-history-filters__label {
    font-size: 0.78rem;
  }
  .op-run-history-filters__input {
    margin-bottom: 0;
    min-height: 36px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
    width: 100%;
    box-sizing: border-box;
  }
  .op-run-history-filters__field .op-select {
    margin-bottom: 0;
  }
  .op-run-history-filters__clear {
    margin-bottom: 0;
    align-self: center;
  }
  @media (min-width: 900px) {
    .op-run-history-filters__field:first-child {
      flex: 2 1 18rem;
      min-width: 14rem;
    }
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

  .op-kpi-grid--coverage {
    margin-top: 14px;
    margin-bottom: 4px;
  }
  .op-kpi-card--static {
    cursor: default;
    text-align: left;
  }
  .op-kpi-card--static:hover {
    border-color: color-mix(in srgb, var(--color-border) 85%, transparent);
  }

  .op-coverage-lead {
    margin: 0 0 12px;
    font-size: 0.92rem;
    line-height: 1.55;
    color: var(--color-text);
    opacity: 0.95;
    max-width: 52rem;
  }
  .op-coverage-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 0 0 4px;
    font-size: 0.8rem;
  }
  .op-coverage-meta__sep {
    opacity: 0.5;
  }
  .op-coverage-hero {
    margin: 18px 0 8px;
    padding: 16px 18px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
    background: color-mix(in srgb, var(--color-surface) 94%, black 6%);
  }
  .op-coverage-hero-main {
    min-width: min(100%, 28rem);
  }
  .op-coverage-hero-caption {
    margin: 10px 0 12px;
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .op-coverage-gate {
    display: inline-block;
    font-size: 0.82rem;
    font-weight: 650;
    letter-spacing: 0.02em;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
  }
  .op-coverage-gate--ready {
    background: color-mix(in srgb, var(--color-sage) 24%, transparent);
    border-color: color-mix(in srgb, var(--color-sage) 50%, var(--color-border));
    color: var(--color-text);
  }
  .op-coverage-gate--pending {
    background: color-mix(in srgb, var(--color-copper) 16%, transparent);
    border-color: color-mix(in srgb, var(--color-copper) 42%, var(--color-border));
    color: var(--color-text);
  }
  .op-coverage-bar {
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--color-border) 55%, transparent);
    max-width: 22rem;
  }
  .op-coverage-bar__fill {
    height: 100%;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-copper) 55%, var(--color-sage));
    min-width: 0;
    transition: width 0.25s ease;
  }
  .op-coverage-bar__fill--ok {
    background: color-mix(in srgb, var(--color-sage) 75%, var(--color-border));
  }
  .op-coverage-gap-head {
    margin: 16px 0 8px;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.88;
  }
  .op-coverage-cohort-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 10px;
  }
  .op-coverage-cohort-card {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    background: color-mix(in srgb, var(--color-surface) 90%, black 10%);
  }
  .op-coverage-cohort-card__k {
    display: block;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.82;
    line-height: 1.35;
  }
  .op-coverage-cohort-card__v {
    display: block;
    margin-top: 6px;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 1.35rem;
    font-weight: 600;
    color: var(--color-text);
  }
  .op-coverage-cohort-card__v--ok {
    color: color-mix(in srgb, var(--color-sage) 82%, var(--color-text));
  }
  .op-coverage-samples {
    margin-top: 14px;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px dashed color-mix(in srgb, var(--color-border) 90%, transparent);
    background: color-mix(in srgb, var(--color-surface) 88%, black 12%);
  }
  .op-coverage-samples__label {
    display: block;
    font-size: 0.78rem;
    margin-bottom: 8px;
  }
  .op-coverage-samples__list {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.82rem;
  }
  .op-coverage-samples__url {
    font-size: 0.76rem;
    word-break: break-all;
  }
  .op-coverage-details {
    margin-top: 14px;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
  }
  .op-coverage-details summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.88rem;
    color: var(--color-text);
    padding: 4px 0;
  }
  .op-coverage-details--technical summary {
    font-weight: 500;
    opacity: 0.92;
  }
  .op-coverage-details-list {
    margin: 8px 0 4px;
    padding-left: 1.15rem;
    font-size: 0.84rem;
    line-height: 1.55;
    color: var(--color-text);
    opacity: 0.9;
  }
  .op-coverage-insights {
    margin-top: 20px;
    padding: 16px 18px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
    background: color-mix(in srgb, var(--color-surface) 88%, black 12%);
  }
  .op-coverage-insights__title {
    margin: 0 0 10px;
    font-size: 0.95rem;
    font-weight: 600;
  }
  .op-coverage-insights__summary {
    margin: 0 0 14px;
    white-space: pre-wrap;
    line-height: 1.5;
    font-size: 0.88rem;
  }
  .op-coverage-ai-model {
    margin: 0 0 14px;
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .op-coverage-insights__gates {
    display: grid;
    gap: 12px;
  }
  .op-coverage-insight-card {
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    background: var(--color-surface);
  }
  .op-coverage-insight-card__head {
    margin: 0 0 8px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    font-size: 0.88rem;
  }
  .op-coverage-insight-card__status {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.72rem;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .op-coverage-insight-card__status--pass {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 14%, transparent);
  }
  .op-coverage-insight-card__status--fail {
    border-color: color-mix(in srgb, var(--color-copper) 45%, var(--color-border));
    background: color-mix(in srgb, var(--color-copper) 12%, transparent);
  }
  .op-coverage-insight-card__status--unknown {
    opacity: 0.9;
  }
  .op-coverage-insight-card__evidence {
    margin: 0 0 10px;
    font-size: 0.84rem;
    line-height: 1.5;
  }
  .op-coverage-insight-card__actions {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.84rem;
    line-height: 1.5;
  }
  .op-coverage-insight-card__links-wrap {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  }
  .op-coverage-insight-card__links-head {
    display: block;
    margin: 0 0 8px;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    opacity: 0.88;
  }
  .op-coverage-insight-card__links {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  .op-coverage-insight-card__link {
    display: inline-block;
    max-width: 100%;
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 82%, transparent);
    background: color-mix(in srgb, var(--color-surface) 94%, black 6%);
    color: var(--color-blue);
    font-size: 0.84rem;
    font-weight: 550;
    text-decoration: none;
    line-height: 1.35;
    cursor: pointer;
  }
  .op-coverage-insight-card__link:hover {
    border-color: color-mix(in srgb, var(--color-sage) 42%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 10%, var(--color-surface));
  }
  .op-coverage-insight-card__link:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-blue) 55%, transparent);
    outline-offset: 2px;
  }

  .op-coverage-gate-ai {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px dashed color-mix(in srgb, var(--color-border) 65%, transparent);
  }
  .op-coverage-gate-ai__head {
    display: block;
    margin: 0 0 8px;
    font-size: 0.72rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.9;
  }
  .op-coverage-gate-ai__rationale {
    margin: 0 0 8px;
    font-size: 0.84rem;
    line-height: 1.5;
  }
  .op-coverage-gate-ai__tip {
    margin: 0 0 8px;
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .op-coverage-gate-ai__urls {
    margin: 0 0 10px;
    padding-left: 1.1rem;
    font-size: 0.78rem;
    line-height: 1.5;
    word-break: break-all;
  }
  .op-coverage-gate-ai .op-btn-link {
    margin-bottom: 0;
  }

  .op-coverage-gate-followups {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px dashed color-mix(in srgb, var(--color-border) 65%, transparent);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .op-coverage-gate-followups__item {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--color-border) 82%, transparent);
    background: color-mix(in srgb, var(--color-surface) 96%, black 4%);
  }
  .op-coverage-gate-followups__title {
    margin: 0 0 6px;
    font-size: 0.86rem;
  }
  .op-coverage-gate-followups__desc {
    margin: 0 0 8px;
    line-height: 1.5;
    font-size: 0.82rem;
  }
  .op-coverage-gate-followups__row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
  }
  .op-coverage-gate-followups__row .op-btn-link {
    margin-bottom: 0;
  }

  .op-tabbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: flex-end;
    margin-top: 4px;
    padding-bottom: 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  }
  .op-tab {
    margin-bottom: 0;
    padding: 8px 12px;
    border-radius: 8px 8px 0 0;
    border: 1px solid transparent;
    border-bottom: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.82rem;
    cursor: pointer;
    opacity: 0.82;
  }
  .op-tab:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--color-surface) 88%, black 12%);
  }
  .op-tab--active {
    opacity: 1;
    border-color: color-mix(in srgb, var(--color-border) 85%, transparent);
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    border-bottom: 1px solid color-mix(in srgb, var(--color-surface) 92%, black 8%);
    margin-bottom: -1px;
    padding-bottom: 9px;
    font-weight: 600;
  }
  .op-tab-panels {
    min-height: 120px;
  }

  .op-run-meta {
    margin: 0 0 12px;
  }
  .op-run-meta--compact {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin: 0 0 8px;
    font-size: 0.82rem;
  }
  .op-run-meta__id {
    font-size: 0.76rem;
    word-break: break-all;
  }
  @media (min-width: 720px) {
    .op-run-meta__id {
      max-width: 42ch;
    }
  }
  .op-run-meta__pill {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.8;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  }
  .op-run-meta__console {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .op-run-meta-err {
    margin: 0 0 10px;
    font-size: 0.78rem;
  }
  .op-run-inspector-peek {
    margin: 0 0 8px;
    font-size: 0.76rem;
    line-height: 1.35;
    word-break: break-word;
  }
  .op-run-inspector-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 10px;
  }
  .op-run-inspector-tab {
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    background: color-mix(in srgb, var(--color-surface) 94%, black 6%);
    color: var(--color-text);
    font-size: 0.78rem;
    cursor: pointer;
    opacity: 0.88;
  }
  .op-run-inspector-tab:hover {
    opacity: 1;
  }
  .op-run-inspector-tab--active {
    opacity: 1;
    border-color: color-mix(in srgb, var(--color-blue) 45%, var(--color-border));
    font-weight: 600;
  }
  .op-run-inspector-panel {
    max-height: min(52vh, 440px);
    overflow-y: auto;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent);
    background: color-mix(in srgb, var(--color-surface) 97%, black 3%);
  }
  .op-run-issue-list {
    margin: 0;
    padding-left: 1rem;
    font-size: 0.75rem;
    line-height: 1.35;
    max-height: 360px;
    overflow: auto;
  }
  .op-run-issue-list--tabbed {
    max-height: min(40vh, 320px);
  }
  .op-run-issue-list li {
    margin-bottom: 6px;
  }
  .op-run-log-pre {
    margin: 0;
    white-space: pre-wrap;
    max-height: 360px;
    overflow: auto;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    background: color-mix(in srgb, var(--color-surface) 94%, black 6%);
  }
  .op-run-log-pre--tabbed {
    max-height: min(44vh, 360px);
  }
  .op-run-inspector-json {
    white-space: pre-wrap;
    max-height: 200px;
    overflow: auto;
    margin: 0;
  }
</style>
