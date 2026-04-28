<script lang="ts">
  import { page } from '$app/state';
  import { authorizedFetchJson } from '$lib/authorizedFetchJson';
  import IngestionSettingsShell from '$lib/components/admin/ingest/IngestionSettingsShell.svelte';

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

  const PIPELINE_ORDER = [
    'fetch',
    'extract',
    'relate',
    'group',
    'embed',
    'validate',
    'remediation',
    'store'
  ] as const;

  const STAGE_LABELS: Record<string, string> = {
    fetch: 'Fetch & parse',
    extract: 'Extract',
    relate: 'Relate',
    group: 'Group',
    embed: 'Embed',
    validate: 'Validate',
    remediation: 'Remediate',
    store: 'Store'
  };

  const runId = $derived((page.params.runId ?? '').trim());

  let busy = $state(false);
  let err = $state('');
  let live = $state<LiveRunStatus | null>(null);
  let report = $state<RunReportEnvelope | null>(null);
  /** Durable snapshot for cost/routing sidebar (may load while live). */
  let sidebarReport = $state<RunReportEnvelope | null>(null);

  let since = $state(0);
  let pollMs = $state(2500);
  let liveUpdates = $state(true);
  let logsFilter = $state<'all' | 'errors'>('all');
  let logSearch = $state('');

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

  function statusHeroClass(status: string | undefined): string {
    const s = (status ?? '').toLowerCase();
    if (s === 'error' || s === 'failed') return 'rc-hero rc-hero--err';
    if (s === 'running' || s === 'queued') return 'rc-hero rc-hero--run';
    if (s === 'done') return 'rc-hero rc-hero--ok';
    if (s === 'awaiting_sync' || s === 'awaiting_promote') return 'rc-hero rc-hero--wait';
    return 'rc-hero';
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

  $effect(() => {
    void page.params.runId;
    since = 0;
    live = null;
    report = null;
    sidebarReport = null;
    err = '';
    void loadLive(false);
  });

  $effect(() => {
    if (!runId) return;
    const ms = Math.max(1200, Math.min(8000, Math.trunc(pollMs) || 2500));
    const t = setInterval(() => {
      if (!liveUpdates) return;
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
          <div class={statusHeroClass(live.status)}>
            <div class="rc-hero__row">
              <span class="rc-hero__status">{live.status}</span>
              {#if live.currentStageKey}
                <span class="rc-hero__stage"
                  >Current stage: <strong class="font-mono">{live.currentStageKey}</strong></span
                >
              {/if}
            </div>
            {#if live.currentAction}
              <p class="rc-hero__action">{live.currentAction}</p>
            {/if}
            <p class="rc-hero__sub">
              Idle <span class="font-mono">{formatDurationMs(live.idleForMs)}</span> · Process
              <span class="font-mono">{live.processAlive ? 'alive' : 'stopped'}</span>
              {#if live.processId}
                · pid <span class="font-mono">{live.processId}</span>
              {/if}
            </p>
          </div>
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
        <button type="button" class="op-btn op-btn-link" onclick={exportPipelineActivityJson}>Export JSON</button>
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/activity?panel=runs&q={encodeURIComponent(runId)}"
          >Monitoring</a
        >
      </div>
    </header>

    {#if err}
      <p class="op-err" role="alert">{err}</p>
    {/if}

    {#if live}
      <section class="rc-recovery" aria-labelledby="rc-recovery-h">
        <h2 id="rc-recovery-h" class="rc-h2">Resume from failure</h2>
        <p class="rc-recovery__lead">
          If the worker exited (OOM, rate limit, deploy), fix the cause then resume from the last Neon checkpoint. Use
          <strong>Respawn</strong> when this instance lost the child process but the run should continue.
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
      </section>

      <div class="rc-layout">
        <div class="rc-main">
          <section class="rc-card" aria-labelledby="rc-pipeline-h">
            <h2 id="rc-pipeline-h" class="rc-h2">Pipeline progress</h2>
            <p class="rc-muted">Stage tiles reflect the ingest worker state machine (fetch → … → store).</p>
            <div class="rc-grid">
              {#each PIPELINE_ORDER as key (key)}
                {#if live.stages && live.stages[key]}
                  {@const st = live.stages[key]}
                  <div class={stageTileClass(st.status)}>
                    <div class="rc-tile__label">{STAGE_LABELS[key] ?? key}</div>
                    <div class="rc-tile__status font-mono text-xs uppercase">{st.status}</div>
                    {#if st.summary}
                      <p class="rc-tile__sum">{st.summary}</p>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          </section>

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

        <aside class="rc-side">
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
    margin-bottom: 1.25rem;
    padding-bottom: 1rem;
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
  .rc-recovery {
    margin-bottom: 1.25rem;
    padding: 1.1rem 1.2rem;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-sage) 35%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 6%, var(--color-surface));
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
  .rc-layout {
    display: grid;
    grid-template-columns: 1fr min(340px, 32vw);
    gap: 1.25rem;
    align-items: start;
  }
  @media (max-width: 1024px) {
    .rc-layout {
      grid-template-columns: 1fr;
    }
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
  .rc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.6rem;
  }
  .rc-tile {
    border-radius: 10px;
    padding: 0.65rem 0.7rem;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, black 12%, var(--color-surface));
  }
  .rc-tile--done {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
  }
  .rc-tile--run {
    border-color: color-mix(in srgb, #3b82f6 50%, var(--color-border));
    box-shadow: 0 0 0 1px color-mix(in srgb, #3b82f6 25%, transparent);
  }
  .rc-tile--err {
    border-color: color-mix(in srgb, #f87171 55%, var(--color-border));
    background: color-mix(in srgb, #ef4444 10%, var(--color-surface));
  }
  .rc-tile--skip {
    opacity: 0.55;
  }
  .rc-tile--idle {
    opacity: 0.75;
  }
  .rc-tile__label {
    font-size: 0.78rem;
    font-weight: 600;
    margin-bottom: 0.2rem;
  }
  .rc-tile__status {
    opacity: 0.9;
    margin-bottom: 0.25rem;
  }
  .rc-tile__sum {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.35;
    opacity: 0.85;
  }
  .rc-active__text {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.5;
    max-width: 48rem;
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
