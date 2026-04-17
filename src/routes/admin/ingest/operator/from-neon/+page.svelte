<script lang="ts">
  import { getIdToken } from '$lib/authClient';
  import OperatorSourceSetupPanel from '$lib/components/admin/ingest/OperatorSourceSetupPanel.svelte';

  type NeonRow = { id: string; sourceUrl: string; updatedAt: string };
  let awaitingNeon = $state<NeonRow[]>([]);
  let memRuns = $state<Array<{ id: string; status: string; sourceUrl: string }>>([]);
  let loadBusy = $state(false);
  let err = $state('');
  let promoteBusy = $state<Record<string, boolean>>({});

  async function authHeaders(json = false): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required.');
    const h: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function load() {
    loadBusy = true;
    err = '';
    try {
      const h = await authHeaders();
      const res = await fetch('/api/admin/ingest/runs', { headers: h });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Load failed');
      awaitingNeon = Array.isArray(body.awaitingPromoteNeon) ? body.awaitingPromoteNeon : [];
      memRuns = Array.isArray(body.runs)
        ? body.runs.filter((r: { status?: string }) => r.status === 'awaiting_promote')
        : [];
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally {
      loadBusy = false;
    }
  }

  async function promoteRun(runId: string) {
    promoteBusy = { ...promoteBusy, [runId]: true };
    err = '';
    try {
      const h = await authHeaders(true);
      const res = await fetch(`/api/admin/ingest/run/${runId}/promote`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ stop_before_store: true })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Promote failed');
      await load();
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally {
      promoteBusy = { ...promoteBusy, [runId]: false };
    }
  }

  load();
</script>

<svelte:head>
  <title>Continue from Neon — Operator</title>
</svelte:head>

<main class="op-page">
  <nav class="op-crumb"><a href="/admin/ingest/operator">Operator hub</a> / Continue from Neon</nav>
  <h1 class="op-title">Continue from Neon</h1>
  <p class="op-lead">
    These ingest runs stopped after Stage 1 with checkpoints in Neon. Promoting runs relations → embedding → validation
    (as configured) without calling the extraction model again.
  </p>

  <OperatorSourceSetupPanel />

  <button type="button" class="op-btn" disabled={loadBusy} onclick={load}>{loadBusy ? 'Loading…' : 'Refresh'}</button>

  {#if err}
    <p class="op-err" role="alert">{err}</p>
  {/if}

  {#if memRuns.length > 0}
    <h2 class="op-h2">This server (in-memory)</h2>
    <ul class="op-list">
      {#each memRuns as r (r.id)}
        <li class="op-li">
          <code class="op-code">{r.id}</code>
          <span class="op-url">{r.sourceUrl}</span>
          <button
            type="button"
            class="op-btn op-btn-sm"
            disabled={promoteBusy[r.id]}
            onclick={() => promoteRun(r.id)}>{promoteBusy[r.id] ? '…' : 'Promote'}</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if awaitingNeon.length > 0}
    <h2 class="op-h2">Neon (durable)</h2>
    <ul class="op-list">
      {#each awaitingNeon as r (r.id)}
        <li class="op-li">
          <code class="op-code">{r.id}</code>
          <span class="op-url">{r.sourceUrl}</span>
          <button
            type="button"
            class="op-btn op-btn-sm"
            disabled={promoteBusy[r.id]}
            onclick={() => promoteRun(r.id)}>{promoteBusy[r.id] ? '…' : 'Promote'}</button>
        </li>
      {/each}
    </ul>
  {:else if !loadBusy && !err}
    <p class="op-muted">No runs in <code class="op-code">awaiting_promote</code>.</p>
  {/if}
</main>

<style>
  .op-page {
    max-width: 820px;
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
    margin: 0 0 16px;
    max-width: 46rem;
  }
  .op-h2 {
    font-size: 1rem;
    margin: 20px 0 8px;
  }
  .op-btn {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    cursor: pointer;
    font-size: 0.88rem;
  }
  .op-btn-sm {
    padding: 4px 10px;
    font-size: 0.8rem;
  }
  .op-btn:disabled {
    opacity: 0.55;
  }
  .op-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .op-li {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 2fr) auto;
    gap: 10px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    font-size: 0.84rem;
  }
  .op-url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .op-code {
    font-size: 0.72rem;
    word-break: break-all;
  }
  .op-muted {
    font-size: 0.88rem;
    opacity: 0.85;
  }
  .op-err {
    color: #f87171;
    font-size: 0.88rem;
  }
</style>
