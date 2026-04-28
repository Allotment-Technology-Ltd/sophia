<script lang="ts">
  import { page } from '$app/state';
  import { authorizedFetchJson } from '$lib/authorizedFetchJson';
  import IngestionSettingsShell from '$lib/components/admin/ingest/IngestionSettingsShell.svelte';
  import {
    INGEST_PIPELINE_DISPLAY_ORDER,
    INGEST_STAGE_LABELS
  } from '$lib/admin/ingest/pipelinePresentModel';

  type StageState = { status: string; summary?: string };
  type StagesMap = Record<string, StageState>;

  type LiveRunStatus = {
    id: string;
    status: string;
    currentStageKey: string | null;
    currentAction: string | null;
    lastFailureStageKey: string | null;
    resumable: boolean;
    stages: StagesMap;
    logLines: string[];
    logLineTotal: number;
    logIncremental: boolean;
    issues: unknown[];
    issueCount: number;
    error: string | null;
    processAlive: boolean;
    processId: number | null;
    processStartedAt: number | null;
    processExitedAt: number | null;
    lastActivityAt: number | null;
    idleForMs: number | null;
    createdAt: number;
    completedAt: number | null;
    awaitingSync: boolean;
    awaitingPromote: boolean;
    syncStartedAt: number | null;
    syncCompletedAt: number | null;
  };

  type RunReportEnvelope = {
    runId: string;
    status: string | null;
    sourceUrl: string;
    sourceType: string;
    issueCount: number;
    issueSummary: unknown;
    terminalError: string | null;
    lastFailureStageKey: string | null;
    timingTelemetry: unknown | null;
    routingStats: unknown | null;
    metricsAdvisory: unknown | null;
    completedAtMs: number | null;
    createdAtMs: number | null;
    modelChain: unknown | null;
    pipelinePreset: unknown | null;
    embeddingModel: unknown | null;
    validate: boolean;
  };

  const runId = $derived((page.params.runId ?? '').trim());

  const pipelineActivityDownloadHref = $derived(
    runId ? `/api/admin/ingest/run/${encodeURIComponent(runId)}/pipeline-activity` : '#'
  );
  const pipelineActivityDownloadFilename = $derived(
    runId ? `sophia-pipeline-activity-${runId}.json` : 'sophia-pipeline-activity.json'
  );

  let busy = $state(false);
  let err = $state('');
  let live = $state<LiveRunStatus | null>(null);
  let report = $state<RunReportEnvelope | null>(null);
  /** Durable snapshot for cost/routing sidebar (may load while live). */
  let sidebarReport = $state<RunReportEnvelope | null>(null);

  let since = $state(0);
  let pollMs = $state(2000);
  let liveUpdates = $state(true);
  let logsFilter = $state<'all' | 'errors'>('all');
  let logSearch = $state('');
  /** Recovery panel in bento strip; collapsed by default to keep pipeline high on the page. */
  let recoveryExpanded = $state(false);

  function formatWhenMs(ms: number | null | undefined): string {
    if (!ms || !Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleString();
  }

  function formatDurationMs(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms)) return '—';
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
  }

  function downloadJson(filename: string, data: unknown): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function stageTileClass(status: string | undefined): string {
    const s = (status ?? 'idle').toLowerCase();
    if (s === 'done') return 'rc-tile rc-tile--done';
    if (s === 'running') return 'rc-tile rc-tile--run';
    if (s === 'error') return 'rc-tile rc-tile--err';
    if (s === 'skipped') return 'rc-tile rc-tile--skip';
    return 'rc-tile rc-tile--idle';
  }

  function stageBadgeClass(status: string | undefined): string {
    const s = (status ?? 'idle').toLowerCase();
    if (s === 'done') return 'rc-tile__badge rc-tile__badge--done';
    if (s === 'running') return 'rc-tile__badge rc-tile__badge--running';
    if (s === 'error') return 'rc-tile__badge rc-tile__badge--error';
    if (s === 'skipped') return 'rc-tile__badge rc-tile__badge--skipped';
    return 'rc-tile__badge rc-tile__badge--idle';
  }

  /** Compact status strip in bento (mirrors former hero tones). */
  function stripToneClass(status: string | undefined): string {
    const s = (status ?? '').toLowerCase();
    if (s === 'error' || s === 'failed') return 'rc-strip-tile rc-strip-tile--err';
    if (s === 'running' || s === 'queued') return 'rc-strip-tile rc-strip-tile--run';
    if (s === 'done') return 'rc-strip-tile rc-strip-tile--ok';
    if (s === 'awaiting_sync' || s === 'awaiting_promote') return 'rc-strip-tile rc-strip-tile--wait';
    return 'rc-strip-tile';
  }

  function telemetryCostSnippet(tt: unknown): string | null {
    if (!tt || typeof tt !== 'object') return null;
    const o = tt as Record<string, unknown>;
    const costs = o.costs;
    if (costs && typeof costs === 'object' && costs !== null) {
      const c = costs as Record<string, unknown>;
      if (typeof c.totalUsd === 'number' && Number.isFinite(c.totalUsd)) {
        return `Est. total (telemetry): $${c.totalUsd.toFixed(4)}`;
      }
    }
    if (typeof o.totalUsd === 'number' && Number.isFinite(o.totalUsd)) {
      return `Est. total (telemetry): $${o.totalUsd.toFixed(4)}`;
    }
    return null;
  }

  const displayLogLines = $derived.by(() => {
    const raw = live?.logLines ?? [];
    let lines = raw;
    if (logsFilter === 'errors') {
      lines = raw.filter((ln) => /\b(ERROR|FATAL|fatal error|Memory limit|exited with code)\b/i.test(ln));
    }
    const q = logSearch.trim().toLowerCase();
    if (q) lines = lines.filter((ln) => ln.toLowerCase().includes(q));
    return lines.slice(-400);
  });

  async function enrichSidebarReport(): Promise<void> {
    if (!runId) return;
    try {
      sidebarReport = await authorizedFetchJson<RunReportEnvelope>(
        `/api/admin/ingest/reports/${encodeURIComponent(runId)}`
      );
    } catch {
      sidebarReport = null;
    }
  }

  async function loadLive(incremental = true): Promise<void> {
    if (!runId) return;
    if (!incremental) {
      busy = true;
      err = '';
    }
    try {
      const url = incremental
        ? `/api/admin/ingest/run/${encodeURIComponent(runId)}/status?since=${since}`
        : `/api/admin/ingest/run/${encodeURIComponent(runId)}/status`;
      const body = await authorizedFetchJson<LiveRunStatus>(url);
      const prev = live;
      if (incremental && prev && body.id === prev.id && Array.isArray(body.logLines)) {
        live = {
          ...body,
          logLines: [...prev.logLines, ...body.logLines]
        };
      } else {
        live = body;
      }
      report = null;
      since =
        typeof body.logLineTotal === 'number' && body.logLineTotal >= 0
          ? body.logLineTotal
          : since + (body.logLines?.length ?? 0);
      void enrichSidebarReport();
    } catch (e) {
      live = null;
      try {
        report = await authorizedFetchJson<RunReportEnvelope>(`/api/admin/ingest/reports/${encodeURIComponent(runId)}`);
        sidebarReport = report;
        err = '';
      } catch (e2) {
        report = null;
        sidebarReport = null;
        const m1 = e instanceof Error ? e.message : 'Live run lookup failed';
        const m2 = e2 instanceof Error ? e2.message : 'Report lookup failed';
        err = `${m1} ${m2}`;
      }
    } finally {
      if (!incremental) busy = false;
    }
  }

  async function resumeRun(respawnStaleWorker = false): Promise<void> {
    if (!runId) return;
    try {
      await authorizedFetchJson(`/api/admin/ingest/run/${encodeURIComponent(runId)}/resume`, {
        method: 'POST',
        jsonBody: { respawn_stale_worker: respawnStaleWorker }
      });
      await loadLive(false);
    } catch (e) {
      err = e instanceof Error ? e.message : 'Resume failed';
    }
  }

  async function cancelRun(): Promise<void> {
    if (!runId) return;
    if (!confirm('Cancel this run?')) return;
    try {
      await authorizedFetchJson(`/api/admin/ingest/run/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
      await loadLive(false);
    } catch (e) {
      err = e instanceof Error ? e.message : 'Cancel failed';
    }
  }

  async function startSyncToSurreal(): Promise<void> {
    if (!runId) return;
    try {
      await authorizedFetchJson(`/api/admin/ingest/run/${encodeURIComponent(runId)}/sync-surreal`, { method: 'POST' });
      await loadLive(false);
    } catch (e) {
      err = e instanceof Error ? e.message : 'Sync failed';
    }
  }

  function exportPipelineActivityJson(): void {
    if (!runId) return;
    const payload = live
      ? {
          runId: live.id,
          status: live.status,
          currentStageKey: live.currentStageKey,
          currentAction: live.currentAction,
          lastFailureStageKey: live.lastFailureStageKey,
          error: live.error,
          stages: live.stages,
          issues: live.issues,
          logLines: live.logLines
        }
      : report
        ? report
        : { runId, error: err || 'No data' };
    downloadJson(`sophia-pipeline-activity-${runId}.json`, payload);
  }

  function copyRunId(): void {
    if (!runId || typeof navigator === 'undefined') return;
    void navigator.clipboard.writeText(runId);
  }

  /** Poll faster while a worker is active so stage tiles track log-driven activity without multi-second lag. */
  const liveStatus = $derived(live?.status ?? '');
  const liveProcessAlive = $derived(live?.processAlive === true);
  const activeRunPollMs = $derived.by(() => {
    const base = Math.max(800, Math.min(8000, Math.trunc(pollMs) || 2000));
    const active =
      liveProcessAlive || liveStatus === 'running' || liveStatus === 'queued';
    return active ? Math.min(800, Math.max(450, Math.floor(base * 0.38))) : base;
  });

  $effect(() => {
    void page.params.runId;
    since = 0;
    live = null;
    report = null;
    sidebarReport = null;
    err = '';
    recoveryExpanded = false;
    void loadLive(false);
  });

  $effect(() => {
    if (!runId) return;
    if (!liveUpdates) return;
    const ms = activeRunPollMs;
    const t = setInterval(() => {
      void loadLive(true);
    }, ms);
    return () => clearInterval(t);
  });
</script>

<svelte:head>
  <title>Live run console — {runId || '—'}</title>
</svelte:head>

<IngestionSettingsShell
  kicker="Admin"
  activeNav="monitoring"
  journeyStage="monitor"
  title="Live run console"
  lead="Monitor one ingestion run on this server instance: pipeline stages, threaded worker logs, failure context, and recovery. Live state is in-memory; open a saved report when the run is not on this worker."
>
  <div class="rc-root op-panel">
    <header class="rc-header">
      <div class="rc-header__meta">
        <p class="rc-run-id">
          <span class="font-mono text-sm tracking-tight">{runId || '—'}</span>
          <button type="button" class="rc-icon-btn" title="Copy run id" onclick={copyRunId}>Copy</button>
        </p>
        {#if live}
          <!-- Status lives in bento strip so pipeline starts higher -->
        {:else if report}
          <div class="rc-hero rc-hero--snap">
            <div class="rc-hero__row">
              <span class="rc-hero__status">Report snapshot</span>
              <span class="rc-hero__stage">Not in memory on this instance</span>
            </div>
            <p class="rc-hero__sub">
              Status <span class="font-mono">{report.status ?? '—'}</span> · source
              <span class="rc-hero__ellip" title={report.sourceUrl}>{report.sourceUrl || '—'}</span>
            </p>
          </div>
        {:else}
          <p class="op-muted" style="margin:0">No data yet.</p>
        {/if}
      </div>
      <div class="rc-header__actions op-actions" style="margin-bottom:0">
        <label class="rc-check">
          <input type="checkbox" bind:checked={liveUpdates} />
          Live updates
        </label>
        <button type="button" class="op-btn op-btn-link" disabled={busy} onclick={() => void loadLive(false)}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
        {#if live}
          <a
            class="op-btn op-btn-link"
            href={pipelineActivityDownloadHref}
            download={pipelineActivityDownloadFilename}
            title="Full pipeline activity from this server (stages, logs, issues)"
          >
            Download pipeline JSON
          </a>
        {:else}
          <button type="button" class="op-btn op-btn-link" onclick={exportPipelineActivityJson}>
            {report ? 'Download snapshot JSON' : 'Download JSON'}
          </button>
        {/if}
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/activity?panel=runs&q={encodeURIComponent(runId)}"
          >Monitoring</a
        >
      </div>
    </header>

    {#if err}
      <p class="op-err" role="alert">{err}</p>
    {/if}

    {#if live}
      <div class="rc-bento">
        <div class="rc-bento__pipeline">
          <section class="rc-card rc-card--pipeline" aria-labelledby="rc-pipeline-h">
            <div class="rc-card-head rc-card-head--stack">
              <h2 id="rc-pipeline-h" class="rc-h2">Pipeline</h2>
              <a
                class="op-btn op-btn-link rc-card-head__action"
                href={pipelineActivityDownloadHref}
                download={pipelineActivityDownloadFilename}
                title="Download stages, log buffer, and issues as JSON (this server)"
              >
                Download JSON
              </a>
            </div>
            <p class="rc-muted rc-muted--tight">
              <strong>fetch → store</strong> top to bottom. Summaries wrap; use the page scroll if the list is long.
            </p>
            <div class="rc-pipeline-track">
              <div class="rc-pipeline rc-pipeline--vertical" role="list" aria-label="Pipeline stages in execution order">
                {#each INGEST_PIPELINE_DISPLAY_ORDER as key, stageIndex (key)}
                  {#if live.stages && live.stages[key]}
                    {@const st = live.stages[key]}
                    {#if stageIndex > 0}
                      <span class="rc-pipeline__link rc-pipeline__link--v" aria-hidden="true">
                        <span class="rc-pipeline__link-line rc-pipeline__link-line--v"></span>
                      </span>
                    {/if}
                    <div class="rc-pipeline__slot rc-pipeline__slot--vertical" role="listitem">
                      <div
                        class={stageTileClass(st.status)}
                        class:rc-tile--focus={live.currentStageKey === key}
                      >
                        <div class="rc-tile__head">
                          <span class="rc-tile__idx">{stageIndex + 1}</span>
                          <span class="rc-tile__label">{INGEST_STAGE_LABELS[key] ?? key}</span>
                        </div>
                        <div class="rc-tile__statusrow">
                          <span class={stageBadgeClass(st.status)}>{st.status}</span>
                        </div>
                        {#if st.summary}
                          <p class="rc-tile__sum">{st.summary}</p>
                        {/if}
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          </section>
        </div>

        <div class="rc-bento__strip">
          <div class={stripToneClass(live.status)}>
            <div class="rc-strip-tile__row">
              <span class="rc-strip-tile__status">{live.status}</span>
              {#if live.currentStageKey}
                <span class="rc-strip-tile__stage"
                  >Stage <strong class="font-mono">{live.currentStageKey}</strong></span
                >
              {/if}
            </div>
            {#if live.currentAction}
              <p class="rc-strip-tile__action">{live.currentAction}</p>
            {/if}
            <p class="rc-strip-tile__meta">
              Idle <span class="font-mono">{formatDurationMs(live.idleForMs)}</span> · Process
              <span class="font-mono">{live.processAlive ? 'alive' : 'stopped'}</span>
              {#if live.processId}
                · pid <span class="font-mono">{live.processId}</span>
              {/if}
            </p>
          </div>

          <details class="rc-bento-recovery" bind:open={recoveryExpanded} aria-labelledby="rc-recovery-summary">
            <summary class="rc-bento-recovery__summary" id="rc-recovery-summary">
              <span class="rc-bento-recovery__summary-title">Recovery & controls</span>
              <span class="rc-bento-recovery__summary-hint">Resume, respawn, cancel, sync, poll…</span>
            </summary>
            <div class="rc-bento-recovery__body">
              <p class="rc-recovery__lead rc-recovery__lead--compact">
                If the worker exited (OOM, rate limit, deploy), fix the cause then resume from the last Neon checkpoint.
                Use <strong>Respawn</strong> when this instance lost the child process but the run should continue.
              </p>
              {#if live.error}
                <div class="rc-fatal" role="alert">
                  <p class="rc-fatal__label">Last error</p>
                  <pre class="rc-fatal__text">{live.error}</pre>
                </div>
              {/if}
              <div class="rc-recovery__btns">
                <button type="button" class="rc-btn rc-btn--primary" disabled={!live.resumable} onclick={() => void resumeRun(false)}>
                  Resume from failure
                </button>
                <button
                  type="button"
                  class="rc-btn"
                  disabled={!live.resumable}
                  onclick={() => void resumeRun(true)}
                  title="Respawn worker from checkpoint (stale worker recovery)"
                >
                  Respawn stale worker
                </button>
                <button type="button" class="rc-btn rc-btn--danger" disabled={!live.processAlive} onclick={() => void cancelRun()}>
                  Cancel run
                </button>
                <button type="button" class="rc-btn" disabled={!live.awaitingSync} onclick={() => void startSyncToSurreal()}>
                  Sync to Surreal
                </button>
              </div>
              <div class="rc-poll">
                <label class="op-muted" for="pollMs">Poll interval (ms)</label>
                <input id="pollMs" class="op-select" type="number" min="1200" max="8000" bind:value={pollMs} />
              </div>
            </div>
          </details>
        </div>

        <div class="rc-bento__main">
          <section class="rc-card" aria-labelledby="rc-active-h">
            <h2 id="rc-active-h" class="rc-h2">Active stage</h2>
            {#if live.currentAction}
              <p class="rc-active__text">{live.currentAction}</p>
            {:else if live.currentStageKey && live.stages[live.currentStageKey]?.summary}
              <p class="rc-active__text">{live.stages[live.currentStageKey]?.summary}</p>
            {:else}
              <p class="rc-muted">No stage narrative yet — follow detailed logs below.</p>
            {/if}
          </section>

          <section class="rc-card" aria-labelledby="rc-logs-h">
            <div class="rc-logs-head">
              <h2 id="rc-logs-h" class="rc-h2" style="margin:0">Detailed logs</h2>
              <div class="rc-logs-tools">
                <label class="rc-check">
                  <input type="radio" name="logfilt" value="all" bind:group={logsFilter} /> All
                </label>
                <label class="rc-check">
                  <input type="radio" name="logfilt" value="errors" bind:group={logsFilter} /> Errors / fatals
                </label>
                <input
                  class="rc-search"
                  type="search"
                  placeholder="Filter lines…"
                  bind:value={logSearch}
                  aria-label="Filter log lines"
                />
              </div>
            </div>
            <p class="rc-muted">
              Showing <span class="font-mono">{displayLogLines.length}</span> lines
              {#if live.logLineTotal > 0}
                · total buffered <span class="font-mono">{live.logLineTotal}</span>
              {/if}
            </p>
            <pre class="rc-logs">{displayLogLines.join('\n')}</pre>
          </section>
        </div>

        <aside class="rc-bento__side">
          <div class="rc-card">
            <h3 class="rc-h3">Cost & telemetry</h3>
            {#if telemetryCostSnippet(sidebarReport?.timingTelemetry ?? null)}
              <p class="rc-side__strong">{telemetryCostSnippet(sidebarReport?.timingTelemetry ?? null)}</p>
            {:else}
              <p class="rc-muted">Costs appear when a durable report snapshot exists (may lag live).</p>
            {/if}
            {#if sidebarReport?.metricsAdvisory}
              <details class="rc-details">
                <summary>Metrics advisory</summary>
                <pre class="rc-pre">{JSON.stringify(sidebarReport.metricsAdvisory, null, 2)}</pre>
              </details>
            {/if}
            {#if sidebarReport?.routingStats}
              <details class="rc-details">
                <summary>Routing stats</summary>
                <pre class="rc-pre">{JSON.stringify(sidebarReport.routingStats, null, 2)}</pre>
              </details>
            {/if}
          </div>

          <div class="rc-card">
            <h3 class="rc-h3">Process</h3>
            <ul class="rc-kv">
              <li><span>Created</span> <span class="font-mono">{formatWhenMs(live.createdAt)}</span></li>
              <li><span>Completed</span> <span class="font-mono">{formatWhenMs(live.completedAt)}</span></li>
              <li><span>Last activity</span> <span class="font-mono">{formatWhenMs(live.lastActivityAt)}</span></li>
              <li><span>Sync</span> <span class="font-mono">{live.awaitingSync ? 'awaiting' : '—'}</span></li>
              <li><span>Promote</span> <span class="font-mono">{live.awaitingPromote ? 'awaiting' : '—'}</span></li>
            </ul>
          </div>

          <div class="rc-card">
            <h3 class="rc-h3">Issues ({live.issueCount})</h3>
            {#if live.issues.length === 0}
              <p class="rc-muted">None recorded.</p>
            {:else}
              <ul class="rc-issues">
                {#each live.issues.slice(0, 12) as iss, i (i)}
                  <li class="font-mono text-xs">
                    {typeof iss === 'object' && iss !== null && 'message' in iss
                      ? String((iss as { message?: unknown }).message ?? JSON.stringify(iss))
                      : JSON.stringify(iss)}
                  </li>
                {/each}
              </ul>
              {#if live.issues.length > 12}
                <details class="rc-details">
                  <summary>All issues (JSON)</summary>
                  <pre class="rc-pre">{JSON.stringify(live.issues, null, 2)}</pre>
                </details>
              {/if}
            {/if}
          </div>
        </aside>
      </div>
    {:else if report}
      <section class="rc-card rc-snapshot">
        <h2 class="rc-h2">Report snapshot</h2>
        <p class="rc-muted">
          This run is not in memory on this instance. Below is the persisted envelope (same shape operators use for
          postmortems).
        </p>
        <div class="rc-kv rc-kv--block">
          <p>
            <span class="rc-muted">Source</span><br /><span class="font-mono text-sm break-all">{report.sourceUrl}</span>
          </p>
          <p>
            <span class="rc-muted">Created / completed</span><br /><span class="font-mono"
              >{formatWhenMs(report.createdAtMs)} — {formatWhenMs(report.completedAtMs)}</span
            >
          </p>
        </div>
        {#if report.terminalError}
          <div class="rc-fatal" role="alert">
            <p class="rc-fatal__label">Terminal error</p>
            <pre class="rc-fatal__text">{report.terminalError}</pre>
          </div>
        {/if}
        {#if telemetryCostSnippet(report.timingTelemetry)}
          <p class="rc-side__strong">{telemetryCostSnippet(report.timingTelemetry)}</p>
        {/if}
        <details class="rc-details" open>
          <summary>Full snapshot JSON</summary>
          <pre class="rc-pre">{JSON.stringify(report, null, 2)}</pre>
        </details>
      </section>
    {/if}
  </div>
</IngestionSettingsShell>

<style>
  .rc-root {
    max-width: 1400px;
  }
  .rc-header {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.85rem;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
  }
  .rc-run-id {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.5rem;
  }
  .rc-icon-btn {
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }
  .rc-icon-btn:hover {
    border-color: color-mix(in srgb, var(--color-sage) 40%, var(--color-border));
  }
  .rc-hero {
    border-radius: 12px;
    padding: 1rem 1.1rem;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 92%, black);
  }
  .rc-hero--run {
    border-color: color-mix(in srgb, #3b82f6 45%, var(--color-border));
    background: color-mix(in srgb, #3b82f6 12%, var(--color-surface));
  }
  .rc-hero--ok {
    border-color: color-mix(in srgb, var(--color-sage) 50%, var(--color-border));
  }
  .rc-hero--err {
    border-color: color-mix(in srgb, #f87171 45%, var(--color-border));
    background: color-mix(in srgb, #ef4444 10%, var(--color-surface));
  }
  .rc-hero--wait {
    border-color: color-mix(in srgb, #eab308 40%, var(--color-border));
    background: color-mix(in srgb, #eab308 8%, var(--color-surface));
  }
  .rc-hero--snap {
    border-style: dashed;
  }
  .rc-hero__row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.25rem;
    align-items: baseline;
  }
  .rc-hero__status {
    font-size: 1.15rem;
    font-weight: 600;
    font-family: var(--font-serif, ui-serif, Georgia, serif);
    text-transform: capitalize;
  }
  .rc-hero__stage {
    font-size: 0.9rem;
    opacity: 0.92;
  }
  .rc-hero__action {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.45;
    max-width: 52rem;
  }
  .rc-hero__sub {
    margin: 0.5rem 0 0;
    font-size: 0.82rem;
    opacity: 0.85;
  }
  .rc-hero__ellip {
    display: inline-block;
    max-width: 28rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
  .rc-check {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    cursor: pointer;
    margin-right: 0.5rem;
  }
  .rc-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    margin-bottom: 0.35rem;
  }
  .rc-card-head .rc-h2 {
    margin: 0;
  }
  .rc-card-head__action {
    margin-bottom: 0 !important;
    flex-shrink: 0;
  }
  .rc-card-head--stack {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }
  .rc-muted--tight {
    margin: 0 0 0.5rem !important;
    font-size: 0.8rem;
    max-width: none;
  }
  .rc-h2 {
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
    font-family: var(--font-serif, ui-serif, Georgia, serif);
    font-weight: 600;
    color: var(--color-text);
  }
  .rc-h3 {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    font-family: var(--font-serif, ui-serif, Georgia, serif);
  }
  .rc-muted {
    margin: 0 0 0.75rem;
    font-size: 0.88rem;
    line-height: 1.45;
    opacity: 0.88;
    max-width: 50rem;
  }
  .rc-recovery__lead {
    margin: 0 0 1rem;
    font-size: 0.9rem;
    line-height: 1.5;
    max-width: 48rem;
  }
  .rc-recovery__btns {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .rc-btn {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .rc-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .rc-btn--primary {
    border-color: color-mix(in srgb, var(--color-sage) 50%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 18%, var(--color-surface));
  }
  .rc-btn--danger {
    border-color: color-mix(in srgb, #f87171 50%, var(--color-border));
    background: color-mix(in srgb, #ef4444 12%, var(--color-surface));
  }
  .rc-poll {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .rc-fatal {
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, #f87171 45%, var(--color-border));
    background: color-mix(in srgb, #ef4444 8%, transparent);
  }
  .rc-fatal__label {
    margin: 0 0 0.35rem;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.85;
  }
  .rc-fatal__text {
    margin: 0;
    white-space: pre-wrap;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8rem;
    line-height: 1.4;
  }
  /* Bento: pipeline column spans rows; strip spans top of cols 2–3; main + side share row 2 */
  .rc-bento {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(220px, min(26vw, 280px)) minmax(0, 1fr) minmax(240px, min(32vw, 300px));
    grid-template-rows: auto 1fr;
    align-items: start;
  }
  .rc-bento__pipeline {
    grid-column: 1;
    grid-row: 1 / -1;
    min-width: 0;
  }
  .rc-bento__strip {
    grid-column: 2 / -1;
    grid-row: 1;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    min-width: 0;
  }
  .rc-bento__main {
    grid-column: 2;
    grid-row: 2;
    min-width: 0;
  }
  .rc-bento__side {
    grid-column: 3;
    grid-row: 2;
    min-width: 0;
  }
  @media (min-width: 1101px) {
    .rc-bento__pipeline {
      position: sticky;
      top: 0.65rem;
      align-self: start;
    }
  }
  @media (max-width: 1100px) {
    .rc-bento {
      display: flex;
      flex-direction: column;
    }
    .rc-bento__strip {
      order: 1;
    }
    .rc-bento__pipeline {
      order: 2;
      position: static;
      max-height: none;
    }
    .rc-bento__main {
      order: 3;
    }
    .rc-bento__side {
      order: 4;
      width: 100%;
    }
  }

  .rc-strip-tile {
    border-radius: 12px;
    padding: 0.55rem 0.85rem;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 92%, black);
  }
  .rc-strip-tile--run {
    border-color: color-mix(in srgb, #3b82f6 45%, var(--color-border));
    background: color-mix(in srgb, #3b82f6 11%, var(--color-surface));
  }
  .rc-strip-tile--ok {
    border-color: color-mix(in srgb, var(--color-sage) 48%, var(--color-border));
  }
  .rc-strip-tile--err {
    border-color: color-mix(in srgb, #f87171 45%, var(--color-border));
    background: color-mix(in srgb, #ef4444 9%, var(--color-surface));
  }
  .rc-strip-tile--wait {
    border-color: color-mix(in srgb, #eab308 38%, var(--color-border));
    background: color-mix(in srgb, #eab308 7%, var(--color-surface));
  }
  .rc-strip-tile__row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: baseline;
  }
  .rc-strip-tile__status {
    font-size: 1rem;
    font-weight: 600;
    font-family: var(--font-serif, ui-serif, Georgia, serif);
    text-transform: capitalize;
  }
  .rc-strip-tile__stage {
    font-size: 0.82rem;
    opacity: 0.92;
  }
  .rc-strip-tile__action {
    margin: 0.35rem 0 0;
    font-size: 0.82rem;
    line-height: 1.45;
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .rc-strip-tile__meta {
    margin: 0.35rem 0 0;
    font-size: 0.74rem;
    opacity: 0.82;
  }

  .rc-bento-recovery {
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-sage) 32%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 5%, var(--color-surface));
    overflow: hidden;
  }
  .rc-bento-recovery__summary {
    cursor: pointer;
    list-style: none;
    padding: 0.5rem 0.85rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem 1rem;
  }
  .rc-bento-recovery__summary::-webkit-details-marker {
    display: none;
  }
  .rc-bento-recovery__summary-title {
    font-weight: 650;
    font-size: 0.88rem;
  }
  .rc-bento-recovery__summary-hint {
    font-size: 0.76rem;
    opacity: 0.75;
  }
  .rc-bento-recovery__body {
    padding: 0 0.85rem 0.85rem;
    border-top: 1px solid color-mix(in srgb, var(--color-border) 65%, transparent);
  }
  .rc-recovery__lead--compact {
    margin: 0 0 0.65rem;
    font-size: 0.82rem;
    line-height: 1.45;
    max-width: none;
  }

  .rc-card {
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 95%, black);
    padding: 1rem 1.1rem;
    margin-bottom: 1rem;
  }
  .rc-snapshot {
    margin-top: 0.5rem;
  }
  .rc-pipeline-track {
    position: relative;
    margin-top: 0.35rem;
    padding: 0.55rem 0.45rem 0.65rem;
    border-radius: 14px;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-surface) 92%, black 8%) 0%,
      color-mix(in srgb, black 18%, var(--color-surface)) 100%
    );
    border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 6%, transparent);
    overflow: visible;
  }
  .rc-pipeline.rc-pipeline--vertical {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    width: 100%;
    min-width: 0;
    padding: 0.15rem 0.1rem;
    margin: 0;
  }
  .rc-pipeline__link--v {
    display: flex;
    justify-content: center;
    align-items: stretch;
    width: 100%;
    flex: 0 0 auto;
    padding: 1px 0 3px;
    min-height: 14px;
  }
  .rc-pipeline__link-line--v {
    position: relative;
    width: 3px;
    height: 14px;
    min-height: 14px;
    border-radius: 3px;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-border) 50%, transparent),
      color-mix(in srgb, var(--color-sage) 42%, var(--color-border) 58%)
    );
    opacity: 0.95;
  }
  .rc-pipeline__link-line--v::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -5px;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 6px 5px 0 5px;
    border-color: color-mix(in srgb, var(--color-sage) 48%, var(--color-border)) transparent transparent transparent;
  }
  .rc-pipeline__slot--vertical {
    flex: 0 0 auto;
    width: 100%;
    min-width: 0;
    max-width: none;
    display: flex;
  }
  .rc-tile {
    width: 100%;
    min-width: 0;
    border-radius: 12px;
    padding: 0.55rem 0.6rem 0.6rem;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, black 16%, var(--color-surface));
    display: flex;
    flex-direction: column;
    align-items: stretch;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
  }
  .rc-tile--done {
    border-color: color-mix(in srgb, var(--color-sage) 48%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 10%, var(--color-surface));
  }
  .rc-tile--run {
    border-color: color-mix(in srgb, #3b82f6 55%, var(--color-border));
    animation: rc-tile-run-glow 2.8s ease-in-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .rc-tile--run {
      animation: none;
      box-shadow: 0 0 0 1px color-mix(in srgb, #3b82f6 25%, transparent);
    }
  }
  @keyframes rc-tile-run-glow {
    0%,
    100% {
      box-shadow:
        0 0 0 1px color-mix(in srgb, #3b82f6 22%, transparent),
        0 2px 12px color-mix(in srgb, #3b82f6 8%, transparent);
    }
    50% {
      box-shadow:
        0 0 0 2px color-mix(in srgb, #3b82f6 32%, transparent),
        0 4px 22px color-mix(in srgb, #3b82f6 14%, transparent);
    }
  }
  .rc-tile--err {
    border-color: color-mix(in srgb, #f87171 55%, var(--color-border));
    background: color-mix(in srgb, #ef4444 14%, var(--color-surface));
  }
  .rc-tile--skip {
    opacity: 0.58;
  }
  .rc-tile--idle {
    opacity: 0.82;
  }
  .rc-tile--focus {
    outline: 2px solid color-mix(in srgb, var(--color-blue) 55%, transparent);
    outline-offset: 2px;
  }
  .rc-tile__head {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    margin-bottom: 0.4rem;
    min-width: 0;
  }
  .rc-tile__idx {
    flex-shrink: 0;
    width: 1.35rem;
    height: 1.35rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.68rem;
    font-weight: 700;
    font-family: var(--font-mono, ui-monospace, monospace);
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-border) 55%, transparent);
    color: var(--color-text);
    line-height: 1;
  }
  .rc-tile--run .rc-tile__idx {
    background: color-mix(in srgb, #3b82f6 42%, var(--color-surface));
    color: #f8fafc;
    border: 1px solid color-mix(in srgb, #60a5fa 40%, transparent);
  }
  .rc-tile__label {
    font-size: 0.74rem;
    font-weight: 650;
    line-height: 1.28;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: var(--color-text);
    min-width: 0;
  }
  .rc-tile__statusrow {
    margin-bottom: 0.15rem;
  }
  .rc-tile__badge {
    display: inline-block;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.22rem 0.5rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    line-height: 1.2;
  }
  .rc-tile__badge--idle {
    opacity: 0.88;
    background: color-mix(in srgb, var(--color-surface) 80%, black 20%);
  }
  .rc-tile__badge--running {
    background: color-mix(in srgb, #3b82f6 26%, var(--color-surface));
    border-color: color-mix(in srgb, #3b82f6 50%, var(--color-border));
    color: #e0f2fe;
  }
  .rc-tile__badge--done {
    background: color-mix(in srgb, var(--color-sage) 22%, var(--color-surface));
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
  }
  .rc-tile__badge--error {
    background: color-mix(in srgb, #ef4444 22%, var(--color-surface));
    border-color: color-mix(in srgb, #f87171 50%, var(--color-border));
    color: #fecaca;
  }
  .rc-tile__badge--skipped {
    opacity: 0.75;
    background: color-mix(in srgb, var(--color-surface) 70%, black 30%);
  }
  .rc-tile__sum {
    margin: 0.35rem 0 0;
    padding-top: 0.35rem;
    border-top: 1px solid color-mix(in srgb, var(--color-border) 45%, transparent);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.66rem;
    line-height: 1.45;
    opacity: 0.9;
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: normal;
    hyphens: auto;
    min-width: 0;
  }
  .rc-active__text {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.5;
    max-width: none;
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .rc-logs-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .rc-logs-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
  }
  .rc-search {
    min-width: 160px;
    padding: 0.35rem 0.5rem;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
  }
  .rc-logs {
    margin: 0.5rem 0 0;
    max-height: min(560px, 55vh);
    overflow: auto;
    padding: 0.75rem;
    border-radius: 8px;
    background: color-mix(in srgb, black 25%, var(--color-surface));
    border: 1px solid var(--color-border);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.72rem;
    line-height: 1.35;
    white-space: pre-wrap;
  }
  .rc-side__strong {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .rc-kv {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.82rem;
  }
  .rc-kv li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
  }
  .rc-kv li span:first-child {
    opacity: 0.75;
  }
  .rc-kv--block p {
    margin: 0 0 0.75rem;
  }
  .rc-issues {
    margin: 0;
    padding-left: 1rem;
    max-height: 200px;
    overflow: auto;
  }
  .rc-issues li {
    margin-bottom: 0.35rem;
    line-height: 1.35;
  }
  .rc-details {
    margin-top: 0.5rem;
    font-size: 0.85rem;
  }
  .rc-details summary {
    cursor: pointer;
    opacity: 0.9;
  }
  .rc-pre {
    margin: 0.5rem 0 0;
    max-height: 220px;
    overflow: auto;
    font-size: 0.7rem;
    white-space: pre-wrap;
  }
</style>
