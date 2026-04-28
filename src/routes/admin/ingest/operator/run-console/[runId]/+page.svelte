<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import { authorizedFetchJson } from '$lib/authorizedFetchJson';
  import IngestionSettingsShell from '$lib/components/admin/ingest/IngestionSettingsShell.svelte';

  type StageStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';
  type Stage = { key: string; label: string; description: string; status: StageStatus; result?: string };

  type LiveRunStatus = {
    id: string;
    status: string;
    currentStageKey: string | null;
    currentAction: string | null;
    lastFailureStageKey: string | null;
    resumable: boolean;
    stages: Stage[];
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

  let busy = $state(false);
  let err = $state('');
  let live = $state<LiveRunStatus | null>(null);
  let report = $state<RunReportEnvelope | null>(null);

  let since = $state(0);
  let pollMs = $state(2500);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

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

  async function loadLive(incremental = true): Promise<void> {
    if (!runId) return;
    busy = true;
    err = '';
    try {
      const url = incremental ? `/api/admin/ingest/run/${encodeURIComponent(runId)}/status?since=${since}` : `/api/admin/ingest/run/${encodeURIComponent(runId)}/status`;
      const body = await authorizedFetchJson<LiveRunStatus>(url);
      live = body;
      report = null;
      // Advance incremental cursor using server-provided total.
      since = typeof body.logLineTotal === 'number' && body.logLineTotal >= 0 ? body.logLineTotal : since + (body.logLines?.length ?? 0);
    } catch (e) {
      live = null;
      // Fall back to report snapshot if live run not found in memory.
      try {
        report = await authorizedFetchJson<RunReportEnvelope>(`/api/admin/ingest/reports/${encodeURIComponent(runId)}`);
        err = '';
      } catch (e2) {
        report = null;
        const m1 = e instanceof Error ? e.message : 'Live run lookup failed';
        const m2 = e2 instanceof Error ? e2.message : 'Report lookup failed';
        err = `${m1}. ${m2}.`;
      }
    } finally {
      busy = false;
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

  onMount(() => {
    since = 0;
    void loadLive(false);
    pollTimer = setInterval(() => {
      void loadLive(true);
    }, Math.max(1200, Math.min(8000, Math.trunc(pollMs) || 2500)));
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  $effect(() => {
    void page.params.runId;
    // Reset cursor when navigating between runIds without full reload.
    since = 0;
    live = null;
    report = null;
    err = '';
    void loadLive(false);
  });
</script>

<svelte:head>
  <title>Run console — {runId || '—'}</title>
</svelte:head>

<IngestionSettingsShell
  kicker="Admin"
  activeNav="monitoring"
  journeyStage="monitor"
  title="Run console"
  lead="Operational view for a single ingestion run: live pipeline activity, errors, and recovery actions."
>
  <div class="op-panel">
    <div class="op-actions" style="align-items:flex-end">
      <div>
        <p class="op-muted" style="margin:0 0 6px"><strong class="op-mono">{runId || '—'}</strong></p>
        {#if live}
          <p class="op-muted" style="margin:0">
            Status <code class="op-code">{live.status}</code> · stage <code class="op-code">{live.currentStageKey ?? '—'}</code> · idle {formatDurationMs(live.idleForMs)}
          </p>
        {:else if report}
          <p class="op-muted" style="margin:0">
            Snapshot <code class="op-code">{report.status ?? '—'}</code> · stage <code class="op-code">{report.lastFailureStageKey ?? '—'}</code>
          </p>
        {:else}
          <p class="op-muted" style="margin:0">No data yet.</p>
        {/if}
      </div>
      <div class="op-actions" style="margin-bottom:0; margin-left:auto">
        <button type="button" class="op-btn op-btn-link" disabled={busy} onclick={() => void loadLive(false)}>{busy ? 'Loading…' : 'Refresh'}</button>
        <button type="button" class="op-btn op-btn-link" onclick={exportPipelineActivityJson}>Export pipeline JSON</button>
        <a class="op-btn op-btn-link" href="/admin/ingest/operator/activity?panel=runs&q={encodeURIComponent(runId)}">Back to Monitoring</a>
      </div>
    </div>

    {#if err}
      <p class="op-err" role="alert">{err}</p>
    {/if}

    {#if live}
      <div class="op-actions" style="margin-top: 10px">
        <button type="button" class="op-btn" disabled={!live.resumable} onclick={() => void resumeRun(false)}>
          Resume from failure
        </button>
        <button type="button" class="op-btn" disabled={!live.resumable} onclick={() => void resumeRun(true)} title="Respawn worker from checkpoint (stale worker recovery)">
          Respawn stale worker
        </button>
        <button type="button" class="op-btn" disabled={!live.processAlive} onclick={() => void cancelRun()}>
          Cancel run
        </button>
        <button type="button" class="op-btn" disabled={!live.awaitingSync} onclick={() => void startSyncToSurreal()}>
          Sync to Surreal
        </button>
        <label class="op-muted" style="margin-left:auto" for="pollMs">Poll (ms)</label>
        <input id="pollMs" class="op-select" type="number" min="1200" max="8000" bind:value={pollMs} />
      </div>

      <div class="op-split" style="margin-top: 14px">
        <div class="op-cardbox" style="min-width: 0">
          <h3 class="op-h3">Pipeline activity</h3>
          <p class="op-muted" style="margin:0 0 10px">
            Showing last <span class="op-mono">{Math.min(300, live.logLines.length)}</span> lines (incremental).
          </p>
          <pre class="op-mono sm" style="white-space:pre-wrap; max-height: 560px; overflow:auto;">{(live.logLines ?? []).slice(-300).join('\n')}</pre>
        </div>
        <div class="op-cardbox" style="min-width: 0">
          <h3 class="op-h3">Run details</h3>
          <div class="op-muted" style="margin:0 0 8px">
            Created <span class="op-mono">{formatWhenMs(live.createdAt)}</span>
          </div>
          <div class="op-muted" style="margin:0 0 8px">
            Process: <code class="op-code">{live.processAlive ? 'alive' : 'stopped'}</code> · pid <span class="op-mono">{live.processId ?? '—'}</span>
          </div>
          {#if live.error}
            <p class="op-err" style="margin:10px 0 0">{live.error}</p>
          {/if}
          <details class="op-muted" open style="margin-top: 12px">
            <summary class="op-a" style="cursor:pointer">Stages</summary>
            <pre class="op-mono sm" style="white-space:pre-wrap; max-height: 260px; overflow:auto;">{JSON.stringify(live.stages ?? null, null, 2)}</pre>
          </details>
          <details class="op-muted" style="margin-top: 12px">
            <summary class="op-a" style="cursor:pointer">Issues ({live.issueCount})</summary>
            <pre class="op-mono sm" style="white-space:pre-wrap; max-height: 260px; overflow:auto;">{JSON.stringify(live.issues ?? [], null, 2)}</pre>
          </details>
        </div>
      </div>
    {:else if report}
      <div class="op-cardbox" style="margin-top: 14px">
        <h3 class="op-h3">Report snapshot</h3>
        <p class="op-muted" style="margin:0 0 10px">
          This run is not in memory on this instance. You can still export the snapshot for AI review.
        </p>
        <div class="op-muted" style="margin:0 0 8px">
          Created <span class="op-mono">{formatWhenMs(report.createdAtMs)}</span> · Completed <span class="op-mono">{formatWhenMs(report.completedAtMs)}</span>
        </div>
        {#if report.terminalError}
          <p class="op-err" style="margin:10px 0 0">{report.terminalError}</p>
        {/if}
        <details class="op-muted" open style="margin-top: 12px">
          <summary class="op-a" style="cursor:pointer">Full snapshot JSON</summary>
          <pre class="op-mono sm" style="white-space:pre-wrap; max-height: 520px; overflow:auto;">{JSON.stringify(report, null, 2)}</pre>
        </details>
      </div>
    {/if}
  </div>
</IngestionSettingsShell>

