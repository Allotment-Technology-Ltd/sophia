<script lang="ts">
  import { getIdToken } from '$lib/authClient';
  import OperatorSourceSetupPanel from '$lib/components/admin/ingest/OperatorSourceSetupPanel.svelte';
  import { MAX_DURABLE_INGEST_JOB_CONCURRENCY } from '$lib/ingestionJobConcurrency';

  let step = $state(1);
  let urlsInput = $state('');
  let concurrency = $state(3);
  let notes = $state('bulk extraction (stop-after-extraction)');
  let mergeIntoRunning = $state(false);
  let submitBusy = $state(false);
  let submitMsg = $state('');
  let jobId = $state('');

  type NeonRow = { id: string; sourceUrl: string; updatedAt: string };
  let awaitingNeon = $state<NeonRow[]>([]);
  let memRuns = $state<Array<{ id: string; status: string; sourceUrl: string }>>([]);
  let loadBusy = $state(false);
  let promoteBusy = $state<Record<string, boolean>>({});

  async function authHeaders(json = false): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required.');
    const h: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function refreshStaging() {
    loadBusy = true;
    try {
      const h = await authHeaders();
      const res = await fetch('/api/admin/ingest/runs', { headers: h });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Failed to load runs');
      awaitingNeon = Array.isArray(body.awaitingPromoteNeon) ? body.awaitingPromoteNeon : [];
      memRuns = Array.isArray(body.runs)
        ? body.runs.filter((r: { status?: string }) => r.status === 'awaiting_promote')
        : [];
    } catch (e) {
      submitMsg = e instanceof Error ? e.message : String(e);
    } finally {
      loadBusy = false;
    }
  }

  async function submitJob() {
    submitBusy = true;
    submitMsg = '';
    try {
      const urls = urlsInput
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (urls.length === 0) {
        submitMsg = 'Add at least one URL.';
        return;
      }
      const h = await authHeaders(true);
      const res = await fetch('/api/admin/ingest/jobs', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          urls,
          concurrency: Math.max(1, Math.min(MAX_DURABLE_INGEST_JOB_CONCURRENCY, concurrency)),
          notes: notes.trim() || undefined,
          stop_after_extraction: true,
          merge_into_latest_running_job: mergeIntoRunning,
          worker_defaults: { extractionConcurrency: Math.min(8, concurrency) }
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Job create failed');
      jobId = typeof body.jobId === 'string' ? body.jobId : '';
      submitMsg = body.merged ? `Merged into running job.` : `Job started: ${jobId}`;
      step = 3;
      void refreshStaging();
    } catch (e) {
      submitMsg = e instanceof Error ? e.message : String(e);
    } finally {
      submitBusy = false;
    }
  }

  async function promoteRun(runId: string) {
    promoteBusy = { ...promoteBusy, [runId]: true };
    submitMsg = '';
    try {
      const h = await authHeaders(true);
      const res = await fetch(`/api/admin/ingest/run/${runId}/promote`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ stop_before_store: true })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Promote failed');
      await refreshStaging();
    } catch (e) {
      submitMsg = e instanceof Error ? e.message : String(e);
    } finally {
      promoteBusy = { ...promoteBusy, [runId]: false };
    }
  }
</script>

<svelte:head>
  <title>Bulk extraction — Operator</title>
</svelte:head>

<main class="op-page">
  <nav class="op-crumb" aria-label="Breadcrumb">
    <a href="/admin/ingest/operator">Operator hub</a>
    <span aria-hidden="true"> / </span>
    <span>Bulk extraction</span>
  </nav>

  <h1 class="op-title">Bulk extraction (Fireworks window)</h1>
  <p class="op-lead">
    Run many sources through Stage 1 only while your Fireworks deployment is up; promote each run to relations→store
    as soon as you are ready (does not block on the rest of the batch).
  </p>

  <ol class="op-steps" aria-label="Steps">
    <li class:op-step-active={step === 1} class:op-step-done={step > 1}>
      <button type="button" class="op-step-h" onclick={() => (step = 1)}>1. Enable Fireworks</button>
    </li>
    <li class:op-step-active={step === 2} class:op-step-done={step > 2}>
      <button type="button" class="op-step-h" onclick={() => (step = 2)}>2. Run bulk extraction job</button>
    </li>
    <li class:op-step-active={step === 3} class:op-step-done={step > 3}>
      <button type="button" class="op-step-h" onclick={() => (step = 3)}>3. Disable / teardown</button>
    </li>
    <li class:op-step-active={step === 4}>
      <button
        type="button"
        class="op-step-h"
        onclick={() => {
          step = 4;
          void refreshStaging();
        }}>4. Promote to pipeline tail</button>
    </li>
  </ol>

  {#if step === 1}
    <section class="op-block" aria-labelledby="s1">
      <h2 id="s1" class="op-h2">Checklist: enable deployment</h2>
      <ul class="op-checklist">
        <li>Open <a href="https://app.fireworks.ai/" rel="noreferrer">Fireworks dashboard</a> and enable your extraction deployment.</li>
        <li>Confirm <code class="op-code">EXTRACTION_*</code> in your env points at the live deployment (see repo docs).</li>
        <li>When ready, go to step 2 and start the job — keep the deployment up until extractions finish.</li>
      </ul>
      <button type="button" class="op-btn" onclick={() => (step = 2)}>Next</button>
    </section>
  {:else if step === 2}
    <OperatorSourceSetupPanel>
      <label class="op-label" for="urls">URLs (one per line)</label>
      <textarea id="urls" class="op-textarea" rows={8} bind:value={urlsInput} placeholder="https://…"></textarea>
      <div class="op-row">
        <label class="op-label" for="conc">Concurrency (1–{MAX_DURABLE_INGEST_JOB_CONCURRENCY})</label>
        <input
          id="conc"
          class="op-input"
          type="number"
          min="1"
          max={MAX_DURABLE_INGEST_JOB_CONCURRENCY}
          bind:value={concurrency}
        />
      </div>
      <div class="op-row">
        <label class="op-label" for="notes">Notes (optional)</label>
        <input id="notes" class="op-input" type="text" bind:value={notes} />
      </div>
      <label class="op-check">
        <input type="checkbox" bind:checked={mergeIntoRunning} />
        Merge into latest running job (optional)
      </label>
      <p class="op-hint">
        This starts a <strong>durable job</strong> with <code class="op-code">stop_after_extraction</code> on each child run.
      </p>
      <button type="button" class="op-btn op-btn-primary" disabled={submitBusy} onclick={submitJob}>
        {submitBusy ? 'Starting…' : 'Start bulk extraction job'}
      </button>
    </OperatorSourceSetupPanel>
  {:else if step === 3}
    <section class="op-block" aria-labelledby="s3">
      <h2 id="s3" class="op-h2">Checklist: teardown</h2>
      <ul class="op-checklist">
        <li>When extractions are done (or you need to stop), disable or delete the Fireworks deployment to avoid GPU billing.</li>
        <li>
          Optional: open <a href="/admin/ingest/jobs">Durable jobs</a>{#if jobId}
            — last job id: <code class="op-code">{jobId}</code>{/if}.
        </li>
      </ul>
      <button
        type="button"
        class="op-btn"
        onclick={() => {
          step = 4;
          void refreshStaging();
        }}>Go to promote</button>
    </section>
  {:else}
    <section class="op-block" aria-labelledby="s4">
      <h2 id="s4" class="op-h2">Promote completed extractions</h2>
      <p class="op-muted">
        Each row is a run with Neon checkpoints after Stage 1. Promoting continues from <strong>relations</strong> (no Fireworks
        extraction call). Fireworks can stay off.
      </p>
      <button type="button" class="op-btn op-btn-ghost" disabled={loadBusy} onclick={refreshStaging}>
        {loadBusy ? 'Loading…' : 'Refresh'}
      </button>
      {#if memRuns.length > 0}
        <h3 class="op-h3">This server (in-memory)</h3>
        <ul class="op-list">
          {#each memRuns as r (r.id)}
            <li class="op-li">
              <span class="op-li-id">{r.id.slice(0, 8)}…</span>
              <span class="op-li-url">{r.sourceUrl}</span>
              <button
                type="button"
                class="op-btn op-btn-small"
                disabled={promoteBusy[r.id]}
                onclick={() => promoteRun(r.id)}>{promoteBusy[r.id] ? '…' : 'Promote'}</button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if awaitingNeon.length > 0}
        <h3 class="op-h3">Neon (durable)</h3>
        <ul class="op-list">
          {#each awaitingNeon as r (r.id)}
            <li class="op-li">
              <span class="op-li-id">{r.id.slice(0, 8)}…</span>
              <span class="op-li-url">{r.sourceUrl}</span>
              <button
                type="button"
                class="op-btn op-btn-small"
                disabled={promoteBusy[r.id]}
                onclick={() => promoteRun(r.id)}>{promoteBusy[r.id] ? '…' : 'Promote'}</button>
            </li>
          {/each}
        </ul>
      {:else if !loadBusy}
        <p class="op-muted">No <code class="op-code">awaiting_promote</code> rows found.</p>
      {/if}
    </section>
  {/if}

  {#if submitMsg}
    <p class="op-msg" role="status">{submitMsg}</p>
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
    color: var(--color-text);
    opacity: 0.85;
  }
  .op-crumb a {
    color: var(--color-blue);
  }
  .op-title {
    font-family: var(--font-serif);
    font-size: 1.55rem;
    margin: 0 0 10px;
  }
  .op-lead {
    margin: 0 0 20px;
    font-size: 0.9rem;
    line-height: 1.55;
    max-width: 46rem;
  }
  .op-steps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    list-style: none;
    margin: 0 0 22px;
    padding: 0;
  }
  .op-step-h {
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    background: var(--color-surface);
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 0.78rem;
    cursor: pointer;
    color: var(--color-text);
  }
  .op-step-active .op-step-h {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
    font-weight: 600;
  }
  .op-step-done .op-step-h {
    opacity: 0.75;
  }
  .op-block {
    margin-bottom: 20px;
  }
  .op-h2 {
    font-size: 1.05rem;
    margin: 0 0 10px;
  }
  .op-h3 {
    font-size: 0.92rem;
    margin: 16px 0 8px;
  }
  .op-checklist {
    margin: 0 0 14px 1rem;
    font-size: 0.88rem;
    line-height: 1.55;
  }
  .op-checklist a {
    color: var(--color-blue);
  }
  .op-label {
    display: block;
    font-size: 0.82rem;
    margin-bottom: 4px;
  }
  .op-textarea,
  .op-input {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.88rem;
    margin-bottom: 12px;
  }
  .op-row {
    margin-bottom: 4px;
  }
  .op-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.86rem;
    margin-bottom: 12px;
  }
  .op-hint {
    font-size: 0.82rem;
    opacity: 0.9;
    margin: 0 0 12px;
  }
  .op-code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.82em;
  }
  .op-btn {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.88rem;
  }
  .op-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .op-btn-primary {
    border-color: color-mix(in srgb, var(--color-sage) 40%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 12%, var(--color-surface));
  }
  .op-btn-ghost {
    margin-bottom: 12px;
  }
  .op-btn-small {
    padding: 4px 10px;
    font-size: 0.8rem;
  }
  .op-muted {
    font-size: 0.86rem;
    opacity: 0.9;
    margin: 0 0 10px;
  }
  .op-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .op-li {
    display: grid;
    grid-template-columns: 88px 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    font-size: 0.84rem;
  }
  .op-li-url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .op-li-id {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.78rem;
    opacity: 0.85;
  }
  .op-msg {
    margin-top: 16px;
    font-size: 0.88rem;
    color: var(--color-text);
  }
</style>
