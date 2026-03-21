<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getIdToken } from '$lib/firebase';
  import {
    DEFAULT_WIZARD_EMBED_ID,
    DEFAULT_WIZARD_EXTRACT_ID,
    DEFAULT_WIZARD_GROUP_ID,
    DEFAULT_WIZARD_VALIDATE_ID
  } from '$lib/adminIngestWizardModels';

  type StageStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';
  type FlowState = 'setup' | 'running' | 'done';

  type Stage = {
    key: string;
    label: string;
    description: string;
    status: StageStatus;
    result?: string;
  };

  const SOURCE_TYPES = [
    { value: 'sep_entry', label: 'Stanford Encyclopedia of Philosophy' },
    { value: 'iep_entry', label: 'Internet Encyclopedia of Philosophy' },
    { value: 'journal_article', label: 'Academic paper / journal article' },
    { value: 'book', label: 'Book (Project Gutenberg or plain text)' },
    { value: 'web_article', label: 'General web source' }
  ] as const;

  const STAGE_TEMPLATE: Stage[] = [
    { key: 'fetch', label: 'Fetch & Parse', description: 'Pull source and prepare raw content.', status: 'idle' },
    { key: 'extract', label: 'Extract Claims', description: 'Extract structured claims and passages.', status: 'idle' },
    { key: 'relate', label: 'Build Relations', description: 'Map support/tension/dependency links.', status: 'idle' },
    { key: 'group', label: 'Group Arguments', description: 'Cluster claims into argument groups.', status: 'idle' },
    { key: 'embed', label: 'Embed Claims', description: 'Create embeddings for retrieval.', status: 'idle' },
    { key: 'validate', label: 'Validate', description: 'Run validation checks.', status: 'idle' },
    { key: 'store', label: 'Store', description: 'Persist records and graph to storage.', status: 'idle' }
  ];

  let flowState = $state<FlowState>('setup');
  let sourceUrl = $state('');
  let sourceType = $state<(typeof SOURCE_TYPES)[number]['value']>('sep_entry');
  let starting = $state(false);
  let runId = $state('');
  let runError = $state('');
  let urlError = $state('');
  let runLog = $state<string[]>([]);
  let stages = $state<Stage[]>(cloneStages());
  let pollingInterval: ReturnType<typeof setInterval> | null = null;

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) {
      throw new Error('Authentication required. Sign in again and retry.');
    }
    return { Authorization: `Bearer ${token}` };
  }

  function cloneStages(): Stage[] {
    return STAGE_TEMPLATE.map((stage) => ({ ...stage, result: undefined, status: stage.key === 'validate' ? 'done' : 'idle' }));
  }

  function validateSource(): boolean {
    urlError = '';
    if (!sourceUrl.trim()) {
      urlError = 'Source URL is required.';
      return false;
    }
    try {
      new URL(sourceUrl.trim());
      return true;
    } catch {
      urlError = 'Enter a valid URL.';
      return false;
    }
  }

  async function startIngestion(): Promise<void> {
    if (starting || !validateSource()) return;
    starting = true;
    runError = '';
    runLog = [];
    stages = cloneStages();

    try {
      const response = await fetch('/api/admin/ingest/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders())
        },
        body: JSON.stringify({
          source_url: sourceUrl.trim(),
          source_type: sourceType,
          validate: false,
          embedding_model: DEFAULT_WIZARD_EMBED_ID,
          model_chain: {
            extract: DEFAULT_WIZARD_EXTRACT_ID,
            relate: DEFAULT_WIZARD_EXTRACT_ID,
            group: DEFAULT_WIZARD_GROUP_ID,
            validate: DEFAULT_WIZARD_VALIDATE_ID
          }
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to start ingestion run.');
      }

      const body = await response.json();
      const id = typeof body?.run_id === 'string' ? body.run_id : '';
      if (!id) throw new Error('Run ID missing from start response.');

      runId = id;
      flowState = 'running';
      runLog = [`Run started: ${runId}`];
      const params = new URLSearchParams(window.location.search);
      params.set('monitor', '1');
      params.set('runId', runId);
      window.history.replaceState({}, '', `/admin/ingest?${params.toString()}`);
      startPolling();
    } catch (error) {
      runError = error instanceof Error ? error.message : 'Failed to start ingestion.';
      flowState = 'setup';
    } finally {
      starting = false;
    }
  }

  function startPolling(): void {
    if (!runId) return;
    if (pollingInterval) clearInterval(pollingInterval);

    pollingInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/admin/ingest/run/${runId}/status`, {
          headers: await authHeaders()
        });
        if (!response.ok) {
          if (response.status === 404) {
            runError = `Run ${runId} not found.`;
            clearPolling();
          }
          return;
        }
        const body = await response.json();
        if (body?.stages && typeof body.stages === 'object') {
          stages = STAGE_TEMPLATE.map((stage) => ({
            ...stage,
            status: (body.stages[stage.key]?.status as StageStatus) ?? stage.status,
            result: typeof body.stages[stage.key]?.summary === 'string' ? body.stages[stage.key].summary : undefined
          }));
        }
        if (Array.isArray(body?.logLines)) {
          runLog = body.logLines as string[];
        }
        if (body?.status === 'done') {
          flowState = 'done';
          clearPolling();
        } else if (body?.status === 'error') {
          runError = typeof body?.error === 'string' ? body.error : 'Ingestion failed.';
          flowState = 'running';
          clearPolling();
        }
      } catch {
        // keep polling through transient errors
      }
    }, 1500);
  }

  function clearPolling(): void {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  function resetFlow(): void {
    clearPolling();
    flowState = 'setup';
    runId = '';
    runError = '';
    runLog = [];
    stages = cloneStages();
    const params = new URLSearchParams(window.location.search);
    params.delete('monitor');
    params.delete('runId');
    const query = params.toString();
    window.history.replaceState({}, '', query ? `/admin/ingest?${query}` : '/admin/ingest');
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const monitor = params.get('monitor');
    const existingRunId = params.get('runId');
    if (monitor === '1' && existingRunId) {
      runId = existingRunId;
      flowState = 'running';
      runLog = [`Monitoring run: ${runId}`];
      startPolling();
    }
  });

  onDestroy(() => clearPolling());
</script>

<svelte:head>
  <title>Ingestion Run — Sophia Admin</title>
</svelte:head>

<div class="mx-auto w-full max-w-4xl px-6 py-8 sm:px-8 lg:px-10">
  <section class="rounded-2xl border border-sophia-dark-border bg-sophia-dark-surface p-6 sm:p-8">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Ingestion</div>
        <h1 class="mt-2 font-serif text-3xl text-sophia-dark-text">
          {flowState === 'setup' ? 'Start ingestion' : 'Ingestion monitor'}
        </h1>
        <p class="mt-2 text-sm leading-6 text-sophia-dark-muted">
          {#if flowState === 'setup'}
            One action: add source URL, press Start, then watch progress to completion.
          {:else}
            Live run status across all ingestion stages.
          {/if}
        </p>
      </div>
      <a
        href="/admin/ingestion-routing"
        class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
      >
        Routing
      </a>
    </div>

    {#if flowState === 'setup'}
      <div class="mt-7 space-y-5">
        <label class="block space-y-2">
          <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Source URL</span>
          <input
            bind:value={sourceUrl}
            type="url"
            placeholder="https://plato.stanford.edu/entries/ethics-deontology/"
            class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text"
          />
          {#if urlError}
            <span class="font-mono text-xs text-sophia-dark-copper">{urlError}</span>
          {/if}
        </label>

        <label class="block space-y-2">
          <span class="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-sophia-dark-dim">Source type</span>
          <select
            bind:value={sourceType}
            class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-sm text-sophia-dark-text"
          >
            {#each SOURCE_TYPES as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>

        <div class="pt-2">
          <button
            type="button"
            onclick={() => void startIngestion()}
            class="rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-5 py-3 font-mono text-sm uppercase tracking-[0.12em] text-sophia-dark-sage hover:bg-sophia-dark-sage/20 disabled:opacity-50"
            disabled={starting}
          >
            {starting ? 'Starting…' : 'Start'}
          </button>
        </div>
      </div>
    {:else}
      <div class="mt-7 space-y-5">
        <div class="rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/60 px-4 py-3 font-mono text-xs text-sophia-dark-muted">
          Run ID: <span class="text-sophia-dark-text">{runId || 'pending'}</span>
        </div>

        <div class="grid gap-3">
          {#each stages as stage}
            <article class="rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/40 px-4 py-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 class="font-serif text-xl text-sophia-dark-text">{stage.label}</h2>
                <span class="rounded-full border px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.12em]
                  {stage.status === 'done' ? 'border-sophia-dark-sage/40 bg-sophia-dark-sage/10 text-sophia-dark-sage' :
                   stage.status === 'running' ? 'border-sophia-dark-blue/40 bg-sophia-dark-blue/10 text-sophia-dark-blue' :
                   stage.status === 'error' ? 'border-sophia-dark-copper/40 bg-sophia-dark-copper/10 text-sophia-dark-copper' :
                   'border-sophia-dark-border text-sophia-dark-muted'}">
                  {stage.status}
                </span>
              </div>
              <p class="mt-1 text-sm text-sophia-dark-muted">{stage.description}</p>
              {#if stage.result}
                <p class="mt-2 font-mono text-xs text-sophia-dark-dim">{stage.result}</p>
              {/if}
            </article>
          {/each}
        </div>

        {#if runLog.length > 0}
          <details class="rounded-lg border border-sophia-dark-border bg-sophia-dark-bg/50 px-4 py-3" open={flowState === 'running'}>
            <summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">
              Run log ({runLog.length})
            </summary>
            <pre class="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-sophia-dark-muted">{runLog.join('\n')}</pre>
          </details>
        {/if}

        {#if runError}
          <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
            {runError}
          </div>
        {/if}

        {#if flowState === 'done'}
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onclick={resetFlow}
              class="rounded border border-sophia-dark-border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted hover:bg-sophia-dark-surface-raised"
            >
              Start another
            </button>
            <a
              href="/admin/review"
              class="rounded border border-sophia-dark-sage/45 bg-sophia-dark-sage/14 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-sage hover:bg-sophia-dark-sage/20"
            >
              Review output
            </a>
          </div>
        {/if}
      </div>
    {/if}
  </section>
</div>
