<script lang="ts">
  import { getIdToken } from '$lib/authClient';

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

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required.');
    return { Authorization: `Bearer ${token}` };
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
    const params = new URLSearchParams();
    params.set('runId', runId);
    params.set('monitor', '1');
    window.location.href = `/admin/ingest/legacy-wizard?${params.toString()}`;
  }

  function viewSavedReport(runId: string): void {
    const params = new URLSearchParams();
    params.set('reportRunId', runId);
    window.location.href = `/admin/ingest/legacy-wizard?${params.toString()}`;
  }

  async function load() {
    busy = true;
    err = '';
    try {
      const h = await authHeaders();
      const [rRes, jRes] = await Promise.all([
        fetch('/api/admin/ingest/runs', { headers: h }),
        fetch('/api/admin/ingest/jobs?limit=40', { headers: h })
      ]);
      const rBody = await rRes.json().catch(() => ({}));
      const jBody = await jRes.json().catch(() => ({}));
      if (!rRes.ok) throw new Error(typeof rBody.error === 'string' ? rBody.error : 'Runs fetch failed');
      if (!jRes.ok) throw new Error(typeof jBody.error === 'string' ? jBody.error : 'Jobs fetch failed');
      runs = Array.isArray(rBody.runs) ? (rBody.runs as RunRow[]) : [];
      awaitingNeon = Array.isArray(rBody.awaitingPromoteNeon) ? rBody.awaitingPromoteNeon : [];
      recentReports = Array.isArray(rBody.recentReports) ? (rBody.recentReports as ReportRow[]) : [];
      jobs = Array.isArray(jBody.jobs) ? jBody.jobs : [];
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  load();
</script>

<svelte:head>
  <title>Activity — Operator</title>
</svelte:head>

<main class="op-page">
  <nav class="op-crumb"><a href="/admin/ingest/operator">Operator hub</a> / Activity</nav>
  <h1 class="op-title">Activity</h1>
  <p class="op-lead">
    One place for Neon staging (<code class="op-code">awaiting_promote</code>), this server’s in-memory runs, durable jobs,
    and recent Firestore report snapshots. Open live monitoring only while the same process still holds the run.
  </p>

  <button type="button" class="op-btn" disabled={busy} onclick={load}>{busy ? 'Loading…' : 'Refresh'}</button>

  {#if err}
    <p class="op-err" role="alert">{err}</p>
  {/if}

  <section class="op-sec" aria-labelledby="h-neon">
    <h2 id="h-neon" class="op-h2">Neon · awaiting promote (extraction done)</h2>
    {#if awaitingNeon.length === 0}
      <p class="op-muted">None.</p>
    {:else}
      <table class="op-table">
        <thead>
          <tr><th>Run</th><th>Source</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {#each awaitingNeon as r (r.id)}
            <tr>
              <td>
                <a class="op-a" href="/admin/ingest/legacy-wizard?runId={encodeURIComponent(r.id)}&monitor=1"
                  >{r.id.slice(0, 10)}…</a>
              </td>
              <td class="op-ellip">{r.sourceUrl}</td>
              <td class="op-mono">{r.updatedAt}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="op-sec" aria-labelledby="h-mem">
    <h2 id="h-mem" class="op-h2">This server (in-memory runs)</h2>
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
  </section>

  <section class="op-sec" aria-labelledby="h-jobs">
    <h2 id="h-jobs" class="op-h2">Durable jobs (Neon)</h2>
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
              <td><a class="op-a" href="/admin/ingest/jobs/{j.id}">{j.id.slice(0, 14)}…</a></td>
              <td>{j.status}</td>
              <td class="op-mono sm">{JSON.stringify(j.summary ?? {})}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="op-sec" aria-labelledby="h-reports">
    <h2 id="h-reports" class="op-h2">Recent Firestore reports</h2>
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
  </section>
</main>

<style>
  .op-page {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 20px 48px;
  }
  .op-crumb {
    font-size: 0.82rem;
    margin-bottom: 12px;
  }
  .op-crumb a {
    color: var(--color-blue);
  }
  .op-title {
    font-family: var(--font-serif);
    font-size: 1.5rem;
    margin: 0 0 8px;
  }
  .op-lead {
    font-size: 0.9rem;
    line-height: 1.55;
    margin: 0 0 14px;
    max-width: 50rem;
  }
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
  .op-sec {
    margin-bottom: 28px;
  }
  .op-h2 {
    font-size: 1rem;
    margin: 0 0 10px;
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
</style>
