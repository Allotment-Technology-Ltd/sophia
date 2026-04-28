<script lang="ts">
  import { onMount } from 'svelte';
  import { authorizedFetchJson } from '$lib/authorizedFetchJson';
  import IngestionSettingsShell from '$lib/components/admin/ingest/IngestionSettingsShell.svelte';
  import IngestionSectionShell from '$lib/components/admin/ingest/IngestionSectionShell.svelte';

  type CoveragePayload = {
    generatedAt?: string;
    presetGoal?: number;
    totals?: {
      uniqueSourcesCompleted: number;
      trainingAcceptableCount: number;
      trainingNotAcceptableCount: number;
      byOrigin: Record<string, number>;
    };
    phase1Readiness?: { allUnionUrlsPhase2Ready: boolean } | null;
    error?: string;
  };

  type RunsPayload = {
    runs: Array<{ id: string; status: string; sourceUrl: string; createdAt: number; currentStageKey?: string | null }>;
    awaitingPromoteNeon: Array<{ id: string; sourceUrl: string; status: string; updatedAt: string }>;
    recentReports: Array<{ runId: string; status: string; sourceUrl: string; createdAtMs: number; completedAtMs: number }>;
  };

  type JobsPayload = { jobs: Array<{ id: string; status: string; summary?: Record<string, number>; updatedAt?: string }> };
  type DlqPayload = { items: Array<{ itemId: string; jobId: string; url: string; failureClass: string | null }> };

  type CoachPayload = { ok?: boolean; error?: string; summary?: string; tasks?: unknown; raw?: unknown };

  let loading = $state(true);
  let err = $state('');

  let coverage = $state<CoveragePayload | null>(null);
  let runs = $state<RunsPayload | null>(null);
  let jobs = $state<JobsPayload | null>(null);
  let dlq = $state<DlqPayload | null>(null);

  let coachBusy = $state(false);
  let coachErr = $state('');
  let coach = $state<CoachPayload | null>(null);

  type CleanupProposal = {
    title: string;
    priority: 'low' | 'medium' | 'high';
    rationale: string;
    operations: Array<{ kind: 'prune_superseded_failed_ingest_runs_neon'; limit: number; notes?: string }>;
  };
  let cleanupBusy = $state(false);
  let cleanupErr = $state('');
  let cleanupProposal = $state<CleanupProposal | null>(null);

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
  let searchMsg = $state('');

  const DASH_SNAPSHOT_KEY = 'sophia.admin.ingest.dashboard.snapshot.v1';
  type DashSnapshot = { capturedAtMs: number; kpiPromote: number; kpiDlq: number; kpiJobsRunning: number };
  let lastSnapshot = $state<DashSnapshot | null>(null);

  function n(v: number | undefined | null): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }

  const kpiPromote = $derived((runs?.awaitingPromoteNeon?.length ?? 0) || 0);
  const kpiDlq = $derived((dlq?.items?.length ?? 0) || 0);
  const kpiJobsRunning = $derived((jobs?.jobs ?? []).filter((j) => j.status === 'running').length);
  const kpiCoverageReady = $derived(Boolean(coverage?.phase1Readiness?.allUnionUrlsPhase2Ready));

  const dPromote = $derived(lastSnapshot ? kpiPromote - lastSnapshot.kpiPromote : 0);
  const dDlq = $derived(lastSnapshot ? kpiDlq - lastSnapshot.kpiDlq : 0);
  const dJobsRunning = $derived(lastSnapshot ? kpiJobsRunning - lastSnapshot.kpiJobsRunning : 0);

  function formatDelta(d: number): string {
    if (!d) return '—';
    return d > 0 ? `+${d}` : String(d);
  }

  function hydrateLastSnapshot(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(DASH_SNAPSHOT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<DashSnapshot>;
      if (
        typeof parsed.capturedAtMs === 'number' &&
        typeof parsed.kpiPromote === 'number' &&
        typeof parsed.kpiDlq === 'number' &&
        typeof parsed.kpiJobsRunning === 'number'
      ) {
        lastSnapshot = parsed as DashSnapshot;
      }
    } catch {
      /* ignore */
    }
  }

  function persistSnapshot(): void {
    if (typeof window === 'undefined') return;
    try {
      const snap: DashSnapshot = {
        capturedAtMs: Date.now(),
        kpiPromote,
        kpiDlq,
        kpiJobsRunning
      };
      localStorage.setItem(DASH_SNAPSHOT_KEY, JSON.stringify(snap));
      lastSnapshot = snap;
    } catch {
      /* ignore */
    }
  }

  async function loadAll(): Promise<void> {
    loading = true;
    err = '';
    try {
      const [covBody, runsBody, jobsBody, dlqBody] = await Promise.all([
        authorizedFetchJson<CoveragePayload>('/api/admin/metrics/dataset-coverage'),
        authorizedFetchJson<RunsPayload>('/api/admin/ingest/runs'),
        authorizedFetchJson<JobsPayload>('/api/admin/ingest/jobs?limit=40'),
        authorizedFetchJson<DlqPayload>('/api/admin/ingest/jobs/dlq?limit=80')
      ]);

      coverage = covBody;
      runs = runsBody;
      jobs = jobsBody;
      dlq = dlqBody;
      persistSnapshot();
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      coverage = null;
      runs = null;
      jobs = null;
      dlq = null;
    } finally {
      loading = false;
    }
  }

  async function generateInsights(): Promise<void> {
    coachBusy = true;
    coachErr = '';
    coach = null;
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/coach', {
        method: 'POST',
        jsonBody: {
          limit: 40,
          dashboard_snapshot: {
            kpis: {
              promoteAwaiting: kpiPromote,
              dlqCount: kpiDlq,
              jobsRunning: kpiJobsRunning,
              coverageReady: kpiCoverageReady
            },
            coverage: coverage ?? null
          }
        }
      });
      coach = {
        ok: true,
        raw: body,
        summary: typeof body?.summary === 'string' ? body.summary : undefined,
        tasks: body?.tasks
      };
    } catch (e) {
      coachErr = e instanceof Error ? e.message : 'Insights failed.';
    } finally {
      coachBusy = false;
    }
  }

  function openMonitoringWith(params: Record<string, string>): void {
    const qs = new URLSearchParams(params);
    window.location.href = `/admin/ingest/operator/activity?${qs.toString()}`;
  }

  function downloadJson(filename: string, payload: unknown): void {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportIncidentBundle(): void {
    const nowIso = new Date().toISOString().replace(/[:.]/g, '-');
    const payload = {
      kind: 'sophia.ingest.incident_bundle.v1',
      generatedAt: new Date().toISOString(),
      route: '/admin/ingest',
      kpis: {
        awaitingPromote: kpiPromote,
        dlqCount: kpiDlq,
        jobsRunning: kpiJobsRunning,
        coverageReady: kpiCoverageReady
      },
      deltasSinceLastSnapshot: lastSnapshot
        ? {
            capturedAtMs: lastSnapshot.capturedAtMs,
            awaitingPromote: dPromote,
            dlqCount: dDlq,
            jobsRunning: dJobsRunning
          }
        : null,
      dashboardFilters: null,
      coverage: coverage ?? null,
      awaitingPromoteNeon: runs?.awaitingPromoteNeon ?? [],
      topJobs: (jobs?.jobs ?? []).slice(0, 40),
      dlq: (dlq?.items ?? []).slice(0, 200),
      recentReports: runs?.recentReports ?? [],
      coach: coach ?? null,
      links: {
        dashboard: '/admin/ingest',
        wizard: '/admin/ingest/operator?step=configure',
        monitoring: '/admin/ingest/operator/activity',
        coverageReport: '/admin/metrics/dataset-coverage',
        issueResolutionEmbedding: '/admin/issue-resolution?tab=embedding'
      }
    };

    downloadJson(`ingestion-incident-bundle-${nowIso}.json`, payload);
  }

  async function openEmbeddingHealth(): Promise<void> {
    try {
      // authorizedFetchJson is JSON-only; embedding-health returns text.
      const token = await (await import('$lib/authClient')).getIdToken();
      const res = await fetch('/api/admin/ingest/embedding-health', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const text = await res.text();
      const w = window.open('', '_blank', 'noopener,noreferrer');
      if (w) {
        w.document.write(
          `<!DOCTYPE html><meta charset="utf-8"><pre style="white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;padding:16px;background:#111;color:#eee">${text.replace(
            /</g,
            '&lt;'
          )}</pre>`
        );
        w.document.close();
      }
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    hydrateLastSnapshot();
    void loadAll();
  });

  function isProbablyUuidLike(s: string): boolean {
    const t = s.trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
  }

  function handleGlobalSearch(): void {
    searchMsg = '';
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
    // Otherwise → Monitoring search (q) with a best-guess panel.
    const panel = isProbablyUuidLike(raw) || raw.length > 24 ? 'jobs' : 'runs';
    window.location.href = `/admin/ingest/operator/activity?panel=${encodeURIComponent(panel)}&q=${encodeURIComponent(raw)}`;
  }

  async function generateCleanupProposal(): Promise<void> {
    cleanupBusy = true;
    cleanupErr = '';
    cleanupProposal = null;
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/cleanup/propose', {
        method: 'POST',
        jsonBody: {
          snapshot: {
            kpis: {
              awaitingPromote: kpiPromote,
              dlqCount: kpiDlq,
              jobsRunning: kpiJobsRunning,
              coverageReady: kpiCoverageReady
            },
            dlqTop: (dlq?.items ?? []).slice(0, 30),
            awaitingPromoteNeon: (runs?.awaitingPromoteNeon ?? []).slice(0, 30),
            topJobs: (jobs?.jobs ?? []).slice(0, 20),
            coverage: coverage ?? null
          }
        }
      });
      cleanupProposal = body?.proposal as CleanupProposal;
      // Prefill prune limit when applicable.
      const op = cleanupProposal?.operations?.[0];
      if (op && op.kind === 'prune_superseded_failed_ingest_runs_neon' && typeof op.limit === 'number') {
        pruneLimit = Math.max(1, Math.min(10_000, Math.trunc(op.limit)));
      }
    } catch (e) {
      cleanupErr = e instanceof Error ? e.message : 'Proposal failed.';
    } finally {
      cleanupBusy = false;
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
      // Refresh KPIs after destructive change.
      await loadAll();
    } catch (e) {
      pruneErr = e instanceof Error ? e.message : 'Execute failed.';
    } finally {
      pruneBusy = false;
    }
  }
</script>

<svelte:head>
  <title>Ingestion dashboard — Admin</title>
</svelte:head>

<IngestionSettingsShell
  activeNav="dashboard"
  journeyStage={null}
  title="Ingestion"
  lead="A single landing dashboard for what matters now: promote backlog, DLQ, job health, and dataset coverage gates. Generate AI insights on demand."
>
  {#if err}
    <p class="dash-err" role="alert">{err}</p>
  {/if}

  <IngestionSectionShell title="Now" description="Key signals and next actions.">
    <div class="dash-kpis" aria-label="KPIs">
      <div class="dash-kpi">
        <p class="dash-kpi-k">Awaiting promote</p>
        <p class="dash-kpi-v">{kpiPromote}</p>
      </div>
      <div class="dash-kpi">
        <p class="dash-kpi-k">DLQ</p>
        <p class="dash-kpi-v">{kpiDlq}</p>
      </div>
      <div class="dash-kpi">
        <p class="dash-kpi-k">Jobs running</p>
        <p class="dash-kpi-v">{kpiJobsRunning}</p>
      </div>
      <div class="dash-kpi">
        <p class="dash-kpi-k">Coverage gate</p>
        <p class="dash-kpi-v">{kpiCoverageReady ? 'Ready' : 'Not ready'}</p>
      </div>
    </div>

    <div class="dash-cta-row">
      <a class="dash-btn dash-btn-primary" href="/admin/ingest/operator?step=configure">Start new run</a>
      <a class="dash-btn" href="/admin/ingest/operator/activity">Open monitoring</a>
      <button type="button" class="dash-btn" disabled={loading} onclick={loadAll}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
      <button type="button" class="dash-btn" disabled={loading} onclick={exportIncidentBundle}>Export incident bundle</button>
      <button type="button" class="dash-btn" disabled={coachBusy || loading} onclick={generateInsights}>
        {coachBusy ? 'Generating…' : 'Generate AI insights'}
      </button>
    </div>
    <div class="dash-search-row">
      <input
        class="dash-input"
        placeholder="Search URL / run id / job id…"
        bind:value={searchQuery}
        onkeydown={(e) => {
          if (e.key === 'Enter') handleGlobalSearch();
        }}
      />
      <button type="button" class="dash-btn" onclick={handleGlobalSearch}>Go</button>
      {#if searchMsg}
        <span class="dash-muted">{searchMsg}</span>
      {/if}
    </div>

    {#if coachErr}
      <p class="dash-err mt-3" role="alert">{coachErr}</p>
    {/if}
    {#if coach?.summary}
      <div class="dash-insights mt-3" aria-label="AI insights">
        <p class="dash-insights-title">AI summary</p>
        <p class="dash-insights-body">{coach.summary}</p>
      </div>
    {:else if coach?.raw}
      <div class="dash-insights mt-3" aria-label="AI insights raw">
        <p class="dash-insights-title">AI output</p>
        <pre class="dash-pre">{JSON.stringify(coach.raw, null, 2)}</pre>
      </div>
    {/if}
  </IngestionSectionShell>

  <div class="mt-6">
    <IngestionSectionShell title="Runbooks" description="Common incidents with safe next actions.">
      <div class="dash-runbooks">
        <section class="dash-card">
          <h3 class="dash-card-title">DLQ spike</h3>
          <p class="dash-card-desc">
            DLQ <span class="dash-mono">{kpiDlq}</span>
            {#if lastSnapshot}
              <span class="dash-card-meta">({formatDelta(dDlq)} since last)</span>
            {/if}
            — triage failures first; then decide replay vs remove.
          </p>
          <div class="dash-card-actions">
            <button type="button" class="dash-mini" onclick={() => openMonitoringWith({ panel: 'dlq' })}>Open DLQ</button>
            <button type="button" class="dash-mini" onclick={() => openMonitoringWith({ panel: 'dlq', failureClass: 'permanent' })}>
              Permanent
            </button>
            <button type="button" class="dash-mini" onclick={() => openMonitoringWith({ panel: 'dlq', failureClass: 'retryable_exhausted' })}>
              Retryable exhausted
            </button>
          </div>
        </section>

        <section class="dash-card">
          <h3 class="dash-card-title">Promote backlog</h3>
          <p class="dash-card-desc">
            Awaiting promote <span class="dash-mono">{kpiPromote}</span>
            {#if lastSnapshot}
              <span class="dash-card-meta">({formatDelta(dPromote)} since last)</span>
            {/if}
            — complete extract-then-promote tails to unblock downstream steps.
          </p>
          <div class="dash-card-actions">
            <a class="dash-mini" href="/admin/ingest/operator/triage?panel=promote">Open promote queue</a>
            <a class="dash-mini" href="/admin/ingest/operator?step=mode">Start extract-then-promote</a>
          </div>
        </section>

        <section class="dash-card">
          <h3 class="dash-card-title">Embedding dim mismatch</h3>
          <p class="dash-card-desc">
            Jobs running <span class="dash-mono">{kpiJobsRunning}</span>
            {#if lastSnapshot}
              <span class="dash-card-meta">({formatDelta(dJobsRunning)} since last)</span>
            {/if}
            — check embedding health, then re-embed if the corpus is out of spec.
          </p>
          <div class="dash-card-actions">
            <button type="button" class="dash-mini" onclick={() => void openEmbeddingHealth()}>Embedding health</button>
            <a class="dash-mini" href="/admin/issue-resolution?tab=embedding">Open issue resolution</a>
            <a class="dash-mini" href="/admin/ingest/operator/activity?panel=issues">Open monitoring</a>
          </div>
        </section>
      </div>
    </IngestionSectionShell>
  </div>

  <div class="mt-6">
    <IngestionSectionShell
      title="Cleanup proposals (destructive)"
      description="AI can draft a cleanup proposal. Always dry-run first, then confirm before executing."
    >
      <div class="dash-cta-row">
        <button type="button" class="dash-btn" disabled={cleanupBusy || loading} onclick={generateCleanupProposal}>
          {cleanupBusy ? 'Proposing…' : 'Generate cleanup proposal'}
        </button>
        <button type="button" class="dash-btn" disabled={pruneBusy || loading} onclick={previewPruneSupersededFailedRuns}>
          {pruneBusy ? 'Working…' : 'Dry-run prune (Neon)'}
        </button>
      </div>
      {#if cleanupErr}
        <p class="dash-err mt-3" role="alert">{cleanupErr}</p>
      {/if}
      {#if cleanupProposal}
        <div class="dash-insights mt-3">
          <p class="dash-insights-title">Proposal · {cleanupProposal.priority}</p>
          <p class="dash-insights-body"><strong>{cleanupProposal.title}</strong></p>
          <p class="dash-insights-body">{cleanupProposal.rationale}</p>
          <pre class="dash-pre">{JSON.stringify(cleanupProposal, null, 2)}</pre>
        </div>
      {/if}

      <div class="mt-3 dash-cleanup-grid">
        <div class="dash-cleanup-card">
          <p class="dash-kpi-k">Neon · prune superseded failed runs</p>
          <p class="dash-muted mt-2">
            Deletes <code class="dash-mono">ingest_runs</code> in <code class="dash-mono">error</code> state only when a later
            <code class="dash-mono">done</code> exists for the same canonical identity. Also detaches any job items pointing at deleted runs.
          </p>
          <div class="dash-cleanup-row mt-3">
            <label class="dash-kpi-k" for="pruneLimit">Limit</label>
            <input id="pruneLimit" class="dash-input" type="number" min="1" max="10000" bind:value={pruneLimit} />
          </div>
          {#if pruneErr}
            <p class="dash-err mt-3" role="alert">{pruneErr}</p>
          {/if}
          {#if prunePreview}
            <div class="dash-insights mt-3">
              <p class="dash-insights-title">{prunePreview.dryRun ? 'Dry-run result' : 'Executed'}</p>
              <p class="dash-insights-body">
                Candidate runs: <span class="dash-mono">{prunePreview.candidateRunIds.length}</span> · Detached job items:
                <span class="dash-mono">{prunePreview.jobItemsDetached}</span> · Deleted reports:
                <span class="dash-mono">{prunePreview.sophiaDocumentsDeleted}</span> · Deleted runs:
                <span class="dash-mono">{prunePreview.ingestRunsDeleted}</span>
              </p>
              <details class="mt-2">
                <summary class="dash-link">Show candidate run ids</summary>
                <pre class="dash-pre">{JSON.stringify(prunePreview.candidateRunIds, null, 2)}</pre>
              </details>
            </div>
          {/if}
          <div class="dash-cleanup-row mt-3">
            <label class="dash-kpi-k" for="pruneConfirm">Type PRUNE</label>
            <input id="pruneConfirm" class="dash-input" bind:value={pruneConfirmText} placeholder="PRUNE" />
            <button type="button" class="dash-btn dash-btn-primary" disabled={pruneBusy || loading} onclick={executePruneSupersededFailedRuns}>
              Execute prune
            </button>
          </div>
        </div>
      </div>
    </IngestionSectionShell>
  </div>

  <div class="mt-6">
    <IngestionSectionShell
      title="Inquiry corpus (snapshot)"
      description="Scale of philosophy sources and the grounding-trusted slice used for safe Q&A—not model-training KPIs."
    >
      {#if loading}
        <p class="dash-muted">Loading…</p>
      {:else if coverage?.totals}
        <div class="dash-kpis">
          <div class="dash-kpi">
            <p class="dash-kpi-k">Sources in corpus</p>
            <p class="dash-kpi-v">{n(coverage.totals.uniqueSourcesCompleted)}</p>
          </div>
          <div class="dash-kpi">
            <p class="dash-kpi-k">Grounding-trusted</p>
            <p class="dash-kpi-v">{n(coverage.totals.trainingAcceptableCount)}</p>
          </div>
          <div class="dash-kpi">
            <p class="dash-kpi-k">Needs review</p>
            <p class="dash-kpi-v">{n(coverage.totals.trainingNotAcceptableCount)}</p>
          </div>
        </div>
        <p class="dash-muted mt-3">
          Updated {coverage.generatedAt ?? '—'}. <a class="dash-link" href="/admin/ingest/operator/activity?panel=coverage">Open Inquiry corpus</a>
          or <a class="dash-link" href="/admin/metrics/dataset-coverage">metrics JSON</a>.
        </p>
      {:else}
        <p class="dash-muted">{coverage?.error ?? 'No coverage data.'}</p>
      {/if}
    </IngestionSectionShell>
  </div>
</IngestionSettingsShell>

<style>
  .dash-err {
    border: 1px solid color-mix(in srgb, var(--color-copper) 45%, var(--color-border));
    background: color-mix(in srgb, var(--color-copper) 14%, transparent);
    border-radius: 12px;
    padding: 12px 14px;
    color: color-mix(in srgb, var(--color-text) 92%, var(--color-copper));
    font-size: 14px;
    line-height: 1.5;
  }
  .dash-muted {
    color: var(--color-muted);
    font-size: 13px;
    line-height: 1.6;
  }
  .dash-link {
    color: var(--color-text);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .dash-kpis {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  @media (min-width: 900px) {
    .dash-kpis {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .dash-kpi {
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    border-radius: 12px;
    padding: 12px;
  }
  .dash-kpi-k {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-muted);
    margin: 0;
  }
  .dash-kpi-v {
    margin: 6px 0 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 18px;
    color: var(--color-text);
  }
  .dash-cta-row {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .dash-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 38px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    color: var(--color-text);
    text-decoration: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .dash-btn:hover {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
  }
  .dash-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .dash-btn-primary {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
    background: linear-gradient(160deg, color-mix(in srgb, var(--color-sage) 10%, var(--color-surface)) 0%, var(--color-surface) 60%);
  }
  .dash-insights {
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    border-radius: 12px;
    padding: 12px;
  }
  .dash-insights-title {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-muted);
  }
  .dash-insights-body {
    margin: 10px 0 0;
    font-size: 14px;
    line-height: 1.6;
    color: var(--color-text);
  }
  .dash-pre {
    margin: 10px 0 0;
    padding: 10px;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: rgba(0, 0, 0, 0.25);
    color: var(--color-text);
    font-size: 12px;
    overflow: auto;
    max-height: 280px;
  }
  .dash-runbooks {
    display: grid;
    gap: 12px;
  }
  @media (min-width: 900px) {
    .dash-runbooks {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .dash-card {
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    border-radius: 12px;
    padding: 14px;
  }
  .dash-card-title {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text);
  }
  .dash-card-desc {
    margin: 10px 0 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-muted);
  }
  .dash-card-meta {
    color: color-mix(in srgb, var(--color-muted) 70%, var(--color-text));
    margin-left: 6px;
  }
  .dash-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    color: var(--color-text);
  }
  .dash-card-actions {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .dash-mini {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 34px;
    padding: 6px 8px;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    text-decoration: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .dash-mini:hover {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
  }
  .dash-cleanup-grid {
    display: grid;
    gap: 12px;
  }
  .dash-cleanup-card {
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    border-radius: 12px;
    padding: 14px;
  }
  .dash-cleanup-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .dash-input {
    min-height: 36px;
    padding: 6px 10px;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    color: var(--color-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 12px;
  }
  .dash-search-row {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
</style>

