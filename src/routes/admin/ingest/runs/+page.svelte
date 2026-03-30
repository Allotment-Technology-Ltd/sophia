<script lang="ts">
  import { onMount } from 'svelte';
  import { getIdToken } from '$lib/authClient';

  type RunRow = {
    id: string;
    status: 'running' | 'awaiting_sync' | 'done' | 'error';
    createdAt: number;
    completedAt?: number;
    sourceUrl: string;
    sourceType: string;
    currentStageKey?: string | null;
    error?: string;
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
  let recentReports = $state<ReportRow[]>([]);
  let loadError = $state('');
  let loading = $state(true);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required.');
    return { Authorization: `Bearer ${token}` };
  }

  async function loadRuns(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const res = await fetch('/api/admin/ingest/runs', { headers: await authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load runs.');
      }
      runs = Array.isArray(body?.runs) ? (body.runs as RunRow[]) : [];
      recentReports = Array.isArray(body?.recentReports) ? (body.recentReports as ReportRow[]) : [];
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load runs.';
      runs = [];
      recentReports = [];
    } finally {
      loading = false;
    }
  }

  function openRun(runId: string): void {
    const params = new URLSearchParams();
    params.set('runId', runId);
    params.set('monitor', '1');
    window.location.href = `/admin/ingest?${params.toString()}`;
  }

  function viewSavedReport(runId: string): void {
    const params = new URLSearchParams();
    params.set('reportRunId', runId);
    window.location.href = `/admin/ingest?${params.toString()}`;
  }

  async function copyRunId(runId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(runId);
    } catch {
      /* ignore */
    }
  }

  function reportStatusLabel(s: string): string {
    if (s === 'running' || s === 'awaiting_sync') return 'In progress (snapshot)';
    if (s === 'done') return 'Done';
    if (s === 'error') return 'Failed';
    return s;
  }

  function formatWhen(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function truncateUrl(url: string, max = 56): string {
    const u = url.trim();
    if (u.length <= max) return u;
    return `${u.slice(0, max - 1)}…`;
  }

  function statusLabel(s: RunRow['status']): string {
    switch (s) {
      case 'running':
        return 'Running';
      case 'awaiting_sync':
        return 'Awaiting SurrealDB sync';
      case 'done':
        return 'Done';
      case 'error':
        return 'Failed';
      default:
        return s;
    }
  }

  function statusClass(s: RunRow['status']): string {
    switch (s) {
      case 'running':
        return 'text-sophia-dark-sage';
      case 'awaiting_sync':
        return 'text-sophia-dark-amber';
      case 'done':
        return 'text-sophia-dark-sage';
      case 'error':
        return 'text-sophia-dark-copper';
      default:
        return 'text-sophia-dark-muted';
    }
  }

  onMount(() => {
    void loadRuns();
  });
</script>

<svelte:head>
  <title>Ingestion runs — Admin</title>
</svelte:head>

<main class="expand-page">
  <header class="expand-hero">
    <p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin</p>
    <div class="mt-2 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="font-serif text-3xl text-sophia-dark-text sm:text-[2.1rem]">Ingestion runs</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
          <strong class="text-sophia-dark-text">In-memory list</strong> — only runs held by the current app instance (clears
          on deploy, scale-to-zero, or restart). Use it to reopen live monitoring.
        </p>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
          <strong class="text-sophia-dark-text">Firestore reports</strong> — durable rows in
          <code class="font-mono text-xs text-sophia-dark-text">ingestion_run_reports</code> (merged on completion,
          failure, cancel, and periodically while running). The app does not auto-delete them; retention is your Firestore
          / lifecycle policy.
        </p>
      </div>
      <nav class="flex flex-wrap items-center gap-2" aria-label="Admin shortcuts">
        <a href="/admin" class="admin-hub-action">Admin home</a>
        <a href="/admin/ingest" class="admin-hub-action">Expand</a>
      </nav>
    </div>
  </header>

  <section class="mt-6">
    <div class="expand-card">
      <div class="expand-card-inner">
        <div class="runs-toolbar-row">
          <div class="runs-toolbar-message">
            {#if loadError}
              <p class="font-mono text-sm text-sophia-dark-copper">{loadError}</p>
            {:else if loading && runs.length === 0 && recentReports.length === 0}
              <p class="text-sm text-sophia-dark-muted">Loading…</p>
            {:else if runs.length === 0 && recentReports.length === 0}
              <p class="text-sm text-sophia-dark-muted">
                No in-memory runs and no Firestore reports returned. Start a run from Expand or check Firestore access.
              </p>
            {/if}
          </div>
          <button type="button" class="admin-hub-action shrink-0" onclick={() => void loadRuns()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {#if !loadError && runs.length > 0}
          <h2 class="mt-6 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-dim">This instance</h2>
          <div class="mt-2 overflow-auto rounded border border-sophia-dark-border">
            <table class="min-w-full text-left font-mono text-xs text-sophia-dark-muted">
              <thead class="border-b border-sophia-dark-border bg-sophia-dark-bg/50 text-sophia-dark-dim">
                <tr>
                  <th class="px-3 py-2 font-medium uppercase tracking-[0.08em]">Status</th>
                  <th class="px-3 py-2 font-medium uppercase tracking-[0.08em]">Started</th>
                  <th class="px-3 py-2 font-medium uppercase tracking-[0.08em]">Source</th>
                  <th class="px-3 py-2 font-medium uppercase tracking-[0.08em]">Run ID</th>
                  <th class="px-3 py-2 font-medium uppercase tracking-[0.08em]"></th>
                </tr>
              </thead>
              <tbody>
                {#each runs as run}
                  <tr class="border-b border-sophia-dark-border/60 last:border-b-0">
                    <td class="px-3 py-2 align-top">
                      <span class={statusClass(run.status)}>{statusLabel(run.status)}</span>
                      {#if run.status === 'running' && run.currentStageKey}
                        <span class="mt-1 block text-[0.65rem] text-sophia-dark-dim"
                          >{run.currentStageKey}</span
                        >
                      {/if}
                      {#if run.status === 'error' && run.error}
                        <span class="mt-1 block max-w-xs text-[0.65rem] text-sophia-dark-copper" title={run.error}
                          >{truncateUrl(run.error, 80)}</span
                        >
                      {/if}
                    </td>
                    <td class="px-3 py-2 align-top text-sophia-dark-text">{formatWhen(run.createdAt)}</td>
                    <td class="px-3 py-2 align-top">
                      <span class="text-sophia-dark-text" title={run.sourceUrl}>{truncateUrl(run.sourceUrl)}</span>
                      <span class="mt-0.5 block text-[0.65rem] text-sophia-dark-dim">{run.sourceType}</span>
                    </td>
                    <td class="px-3 py-2 align-top font-mono text-[0.65rem] text-sophia-dark-dim">{run.id}</td>
                    <td class="px-3 py-2 align-top text-right">
                      <button
                        type="button"
                        class="rounded border border-sophia-dark-border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-sage hover:bg-sophia-dark-surface-raised"
                        onclick={() => openRun(run.id)}>Open</button
                      >
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        {#if !loadError && recentReports.length > 0}
          <h2 class="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-dim">
            Recent Firestore reports
          </h2>
          <p class="mt-1 text-xs text-sophia-dark-muted">
            <strong class="text-sophia-dark-text">Open</strong> only works while this Cloud Run instance still holds the run
            in memory (lost after deploy or scale-to-zero).
            Use <strong class="text-sophia-dark-text">View report</strong> to load the saved Firestore snapshot on Expand
            (read-only: no live log polling). To continue ingestion, use the same source URL so the worker can pick up
            <code class="font-mono text-[0.65rem] text-sophia-dark-text">*-partial.json</code> checkpoints on disk.
          </p>
          <div class="mt-2 overflow-auto rounded border border-sophia-dark-border">
            <table class="min-w-full text-left font-mono text-xs text-sophia-dark-muted">
              <thead class="border-b border-sophia-dark-border bg-sophia-dark-bg/50 text-sophia-dark-dim">
                <tr>
                  <th class="px-3 py-2 font-medium uppercase tracking-[0.08em]">Status</th>
                  <th class="px-3 py-2 font-medium uppercase tracking-[0.08em]">Completed</th>
                  <th class="px-3 py-2 font-medium uppercase tracking-[0.08em]">Source</th>
                  <th class="px-3 py-2 font-medium uppercase tracking-[0.08em]">Run ID</th>
                  <th class="px-3 py-2 font-medium uppercase tracking-[0.08em]"></th>
                </tr>
              </thead>
              <tbody>
                {#each recentReports as rep}
                  <tr class="border-b border-sophia-dark-border/60 last:border-b-0">
                    <td class="px-3 py-2 align-top text-sophia-dark-text">
                      {reportStatusLabel(rep.status)}
                      {#if rep.lastFailureStageKey}
                        <span class="mt-1 block text-[0.65rem] text-sophia-dark-dim">Stage: {rep.lastFailureStageKey}</span>
                      {/if}
                      {#if rep.terminalError}
                        <span class="mt-1 block max-w-xs text-[0.65rem] text-sophia-dark-copper" title={rep.terminalError}
                          >{truncateUrl(rep.terminalError, 80)}</span
                        >
                      {/if}
                    </td>
                    <td class="px-3 py-2 align-top text-sophia-dark-text">{formatWhen(rep.completedAtMs)}</td>
                    <td class="px-3 py-2 align-top">
                      <span class="text-sophia-dark-text" title={rep.sourceUrl}>{truncateUrl(rep.sourceUrl)}</span>
                      <span class="mt-0.5 block text-[0.65rem] text-sophia-dark-dim">{rep.sourceType}</span>
                    </td>
                    <td class="px-3 py-2 align-top font-mono text-[0.65rem] text-sophia-dark-dim">{rep.runId}</td>
                    <td class="px-3 py-2 align-top text-right">
                      <div class="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          class="rounded border border-sophia-dark-border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
                          onclick={() => void copyRunId(rep.runId)}>Copy ID</button
                        >
                        <button
                          type="button"
                          class="rounded border border-sophia-dark-border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-text hover:bg-sophia-dark-surface-raised"
                          title="Load saved Firestore report on Expand (works after restarts)"
                          onclick={() => viewSavedReport(rep.runId)}>View report</button
                        >
                        <button
                          type="button"
                          class="rounded border border-sophia-dark-border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-sage hover:bg-sophia-dark-surface-raised disabled:opacity-40"
                          disabled={!runs.some((r) => r.id === rep.runId)}
                          title={runs.some((r) => r.id === rep.runId)
                            ? 'Live monitor for this run (same server instance only)'
                            : 'Run is not in memory on this instance — use View report or same source URL + checkpoints'}
                          onclick={() => openRun(rep.runId)}>Open live</button
                        >
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>
  </section>
</main>

<style>
  .expand-page {
    min-height: calc(100vh - var(--nav-height));
    padding: 20px;
    max-width: 1240px;
    margin: 0 auto;
    color: var(--color-text);
  }
  .expand-hero {
    border: 1px solid var(--color-border);
    background: linear-gradient(130deg, rgba(127, 163, 131, 0.2), rgba(44, 96, 142, 0.14));
    border-radius: 12px;
    padding: 20px;
  }
  .expand-card {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: var(--color-surface);
  }
  .expand-card-inner {
    padding: 20px;
  }
  .runs-toolbar-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 16px;
    width: 100%;
  }
  .runs-toolbar-message {
    flex: 1;
    min-width: min(100%, 12rem);
  }
  .runs-toolbar-message :first-child {
    margin: 0;
  }
</style>
