<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { auth, getIdToken, onAuthChange } from '$lib/firebase';
  import type { PageData } from './$types';
  import type { AdminOperationRecord } from '$lib/server/adminOperations';

  let { data }: { data: PageData } = $props();
  type OperationKind = PageData['operationKinds'][number];

  let operations = $state<AdminOperationRecord[]>([]);
  let selectedId = $state<string | null>(null);
  let selectedOperation = $state<AdminOperationRecord | null>(null);
  let selectedKind = $state<OperationKind>('ingest_import');
  let payloadText = $state('');
  let requestState = $state<'idle' | 'submitting'>('idle');
  let pageState = $state<'loading' | 'ready' | 'forbidden'>('loading');
  let currentUserEmail = $state<string | null>(null);
  let errorMessage = $state('');
  let successMessage = $state('');

  const activeOperation = $derived.by(() =>
    operations.find((operation) => operation.id === selectedId) ?? selectedOperation
  );
  const shouldPoll = $derived.by(() =>
    operations.some((operation) => operation.status === 'queued' || operation.status === 'running')
  );

  function templateFor(kind: OperationKind): string {
    return data.payloadTemplates[kind];
  }

  function handleKindChange(kind: string): void {
    selectedKind = kind as OperationKind;
    payloadText = templateFor(selectedKind);
  }

  $effect(() => {
    if (!payloadText) {
      payloadText = templateFor(selectedKind);
    }
  });

  function formatDate(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function badgeClass(status: AdminOperationRecord['status']): string {
    switch (status) {
      case 'succeeded':
        return 'bg-sophia-dark-sage/20 text-sophia-dark-sage border-sophia-dark-sage/40';
      case 'queued':
      case 'running':
        return 'bg-sophia-dark-blue/20 text-sophia-dark-blue border-sophia-dark-blue/40';
      case 'cancelled':
        return 'bg-sophia-dark-surface-raised text-sophia-dark-muted border-sophia-dark-border';
      default:
        return 'bg-sophia-dark-copper/20 text-sophia-dark-copper border-sophia-dark-copper/40';
    }
  }

  async function refreshOperations(): Promise<void> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required');
    const response = await fetch('/api/admin/operations?limit=25', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    const body = await response.json();
    operations = Array.isArray(body.operations) ? body.operations : [];
    if (!selectedId && operations.length > 0) {
      selectedId = operations[0].id;
      selectedOperation = operations[0];
      return;
    }
    if (selectedId) {
      selectedOperation = operations.find((operation) => operation.id === selectedId) ?? selectedOperation;
    }
  }

  async function loadOperation(id: string): Promise<void> {
    selectedId = id;
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required');
    const response = await fetch(`/api/admin/operations/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    const body = await response.json();
    selectedOperation = body.operation ?? null;
    const idx = operations.findIndex((operation) => operation.id === id);
    if (idx >= 0 && selectedOperation) {
      operations[idx] = selectedOperation;
      operations = [...operations];
    }
  }

  async function submitOperation(): Promise<void> {
    requestState = 'submitting';
    errorMessage = '';
    successMessage = '';
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required');
      const payload = JSON.parse(payloadText);
      const response = await fetch('/api/admin/operations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          kind: selectedKind,
          payload
        })
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? `status ${response.status}`);
      }
      successMessage = `${body.operation.requested_action} queued.`;
      selectedId = body.operation.id;
      selectedOperation = body.operation;
      await refreshOperations();
      await loadOperation(body.operation.id);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to submit operation';
    } finally {
      requestState = 'idle';
    }
  }

  async function triggerOperationAction(id: string, action: 'cancel' | 'retry'): Promise<void> {
    errorMessage = '';
    successMessage = '';
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required');
      const response = await fetch(`/api/admin/operations/${id}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? `status ${response.status}`);
      }
      successMessage = action === 'cancel' ? 'Cancellation requested.' : 'Retry queued.';
      selectedOperation = body.operation ?? null;
      await refreshOperations();
      if (selectedOperation) {
        selectedId = selectedOperation.id;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to update operation';
    }
  }

  async function loadAdminContext(): Promise<void> {
    const token = await getIdToken();
    if (!token) {
      pageState = 'forbidden';
      throw new Error('Authentication required');
    }
    const response = await fetch('/api/admin/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await response.json();
    if (response.status === 403 || body.is_admin === false) {
      pageState = 'forbidden';
      currentUserEmail = body.user?.email ?? auth?.currentUser?.email ?? null;
      return;
    }
    if (!response.ok) {
      throw new Error(body.error ?? `status ${response.status}`);
    }
    currentUserEmail = body.user?.email ?? auth?.currentUser?.email ?? null;
    pageState = body.is_admin ? 'ready' : 'forbidden';
    if (pageState === 'ready') {
      await refreshOperations();
    }
  }

  onMount(() => {
    if (!browser) return;
    let interval: number | null = null;

    const startPolling = () => {
      if (interval !== null) return;
      interval = window.setInterval(async () => {
        if (pageState !== 'ready' || !shouldPoll) return;
        try {
          await refreshOperations();
          if (selectedId) {
            await loadOperation(selectedId);
          }
        } catch {
          // keep the last successful state on screen
        }
      }, 4000);
    };

    const sync = async () => {
      if (!auth?.currentUser) {
        pageState = 'forbidden';
        await goto('/auth');
        return;
      }
      try {
        await loadAdminContext();
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Failed to load administrator context';
      }
    };

    void sync();
    const unsubscribe = onAuthChange((user) => {
      if (!user) {
        pageState = 'forbidden';
        void goto('/auth');
        return;
      }
      void sync();
    });
    startPolling();

    return () => {
      unsubscribe();
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  });
</script>

<div class="min-h-screen bg-sophia-dark-bg text-sophia-dark-text">
  <div class="max-w-7xl mx-auto px-6 py-8 space-y-8">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-3xl font-serif text-sophia-dark-text mb-1">Admin Operations Console</h1>
        <p class="text-sophia-dark-muted font-mono text-sm">
          Queue Restormel-backed ingestion, validation, diagnostics, replay, repair, and sync jobs.
        </p>
      </div>
      <div class="flex gap-3">
        <a
          href="/admin/ingestion-routing"
          class="px-4 py-2 bg-sophia-dark-surface-raised border border-sophia-dark-border rounded hover:bg-sophia-dark-surface transition-colors font-mono text-sm"
        >
          Ingestion Routing
        </a>
        <a
          href="/admin"
          class="px-4 py-2 bg-sophia-dark-surface-raised border border-sophia-dark-border rounded hover:bg-sophia-dark-surface transition-colors font-mono text-sm"
        >
          ← Back to Admin
        </a>
      </div>
    </div>

    {#if pageState === 'loading'}
      <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface px-4 py-10 text-center font-mono text-sm text-sophia-dark-muted">
        Loading administrator context…
      </div>
    {:else if pageState === 'forbidden'}
      <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-6 font-mono text-sm text-sophia-dark-copper">
        Administrator access is required for this console.
        {#if currentUserEmail}
          Current account: {currentUserEmail}
        {/if}
      </div>
    {/if}

    {#if errorMessage}
      <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-sm text-sophia-dark-copper">
        {errorMessage}
      </div>
    {/if}
    {#if successMessage}
      <div class="rounded border border-sophia-dark-sage/40 bg-sophia-dark-sage/10 px-4 py-3 font-mono text-sm text-sophia-dark-sage">
        {successMessage}
      </div>
    {/if}

    {#if pageState === 'ready'}
    <div class="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
        <div>
          <div class="text-xs font-mono uppercase tracking-[0.12em] text-sophia-dark-muted mb-2">Launch Operation</div>
          <p class="text-sm text-sophia-dark-muted">
            This is a power console. Payloads are explicit JSON and map directly to admin job handlers.
          </p>
        </div>

        <div class="rounded border border-sophia-dark-copper/40 bg-sophia-dark-copper/10 px-4 py-3 font-mono text-xs text-sophia-dark-copper">
          Full stage-by-stage ingestion routing is not configured here. The current optional
          <code class="mx-1">ingest_provider</code>
          payload field remains a coarse bootstrap or manual fallback hint until Restormel publishes
          public route CRUD, stage-aware resolve, simulation, and publish/rollback APIs.
        </div>

        <label class="block space-y-2">
          <span class="font-mono text-xs text-sophia-dark-muted">Operation Kind</span>
          <select
            value={selectedKind}
            onchange={(event) => handleKindChange((event.currentTarget as HTMLSelectElement).value)}
            class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm text-sophia-dark-text"
          >
            {#each data.operationKinds as kind}
              <option value={kind}>{kind}</option>
            {/each}
          </select>
        </label>

        <label class="block space-y-2">
          <span class="font-mono text-xs text-sophia-dark-muted">Payload JSON</span>
          <textarea
            bind:value={payloadText}
            rows="18"
            class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-3 font-mono text-xs text-sophia-dark-text"
          ></textarea>
        </label>

        <div class="flex flex-wrap gap-3">
          <button
            type="button"
            onclick={submitOperation}
            disabled={requestState === 'submitting'}
            class="rounded border border-sophia-dark-blue/50 px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/10 transition-colors disabled:opacity-50"
          >
            {requestState === 'submitting' ? 'Submitting…' : 'Queue Operation'}
          </button>
          <button
            type="button"
            onclick={refreshOperations}
            class="rounded border border-sophia-dark-border px-4 py-2 font-mono text-sm text-sophia-dark-muted hover:bg-sophia-dark-surface-raised transition-colors"
          >
            Refresh List
          </button>
        </div>
      </section>

      <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs font-mono uppercase tracking-[0.12em] text-sophia-dark-muted mb-2">Recent Jobs</div>
            <p class="text-sm text-sophia-dark-muted">Queued and running jobs are polled automatically.</p>
          </div>
          <span class="font-mono text-xs text-sophia-dark-dim">{operations.length} records</span>
        </div>

        <div class="space-y-3 max-h-[34rem] overflow-auto pr-1">
          {#each operations as operation}
            <button
              type="button"
              onclick={() => loadOperation(operation.id)}
              class="w-full rounded border px-4 py-3 text-left transition-colors {selectedId === operation.id ? 'border-sophia-dark-blue/50 bg-sophia-dark-blue/10' : 'border-sophia-dark-border bg-sophia-dark-bg hover:bg-sophia-dark-surface-raised'}"
            >
              <div class="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div class="font-mono text-sm text-sophia-dark-text">{operation.requested_action}</div>
                  <div class="font-mono text-xs text-sophia-dark-muted mt-1">{operation.kind}</div>
                </div>
                <span class="px-2 py-1 text-xs font-mono border rounded {badgeClass(operation.status)}">
                  {operation.status}
                </span>
              </div>
              <div class="grid grid-cols-2 gap-2 font-mono text-xs text-sophia-dark-dim">
                <div>by {operation.requested_by_uid}</div>
                <div class="text-right">{formatDate(operation.created_at)}</div>
              </div>
            </button>
          {/each}
          {#if operations.length === 0}
            <div class="rounded border border-dashed border-sophia-dark-border px-4 py-8 text-center font-mono text-sm text-sophia-dark-dim">
              No operations queued yet.
            </div>
          {/if}
        </div>
      </section>
    </div>

    <section class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-5 space-y-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-xs font-mono uppercase tracking-[0.12em] text-sophia-dark-muted mb-2">Operation Detail</div>
          <p class="text-sm text-sophia-dark-muted">
            Track lineage, validation, sync status, and the live execution log.
          </p>
        </div>
        {#if activeOperation}
          <div class="flex gap-3">
            <button
              type="button"
              onclick={() => triggerOperationAction(activeOperation.id, 'retry')}
              class="rounded border border-sophia-dark-blue/40 px-3 py-2 font-mono text-xs text-sophia-dark-blue hover:bg-sophia-dark-blue/10 transition-colors"
            >
              Retry
            </button>
            <button
              type="button"
              onclick={() => triggerOperationAction(activeOperation.id, 'cancel')}
              class="rounded border border-sophia-dark-copper/40 px-3 py-2 font-mono text-xs text-sophia-dark-copper hover:bg-sophia-dark-copper/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        {/if}
      </div>

      {#if activeOperation}
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
            <div class="font-mono text-xs text-sophia-dark-muted mb-1">STATUS</div>
            <div class="font-mono text-sm text-sophia-dark-text">{activeOperation.status}</div>
          </div>
          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
            <div class="font-mono text-xs text-sophia-dark-muted mb-1">VALIDATION</div>
            <div class="font-mono text-sm text-sophia-dark-text">{activeOperation.validation_status}</div>
          </div>
          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
            <div class="font-mono text-xs text-sophia-dark-muted mb-1">SURREAL SYNC</div>
            <div class="font-mono text-sm text-sophia-dark-text">{activeOperation.sync_status}</div>
          </div>
          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
            <div class="font-mono text-xs text-sophia-dark-muted mb-1">EXECUTOR</div>
            <div class="font-mono text-sm text-sophia-dark-text">{activeOperation.executor}</div>
          </div>
        </div>

        <div class="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div class="space-y-4">
            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
              <div class="font-mono text-xs text-sophia-dark-muted mb-2">LINEAGE</div>
              <dl class="space-y-2 font-mono text-xs text-sophia-dark-text">
                <div class="flex justify-between gap-4"><dt>Action</dt><dd>{activeOperation.requested_action}</dd></div>
                <div class="flex justify-between gap-4"><dt>Tool</dt><dd>{activeOperation.restormel_tool ?? 'adapter'}</dd></div>
                <div class="flex justify-between gap-4"><dt>Hosted Run</dt><dd>{activeOperation.hosted_run_id ?? '—'}</dd></div>
                <div class="flex justify-between gap-4"><dt>Attempts</dt><dd>{activeOperation.attempts}</dd></div>
                <div class="flex justify-between gap-4"><dt>Created</dt><dd>{formatDate(activeOperation.created_at)}</dd></div>
                <div class="flex justify-between gap-4"><dt>Started</dt><dd>{formatDate(activeOperation.started_at)}</dd></div>
                <div class="flex justify-between gap-4"><dt>Completed</dt><dd>{formatDate(activeOperation.completed_at)}</dd></div>
              </dl>
            </div>

            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
              <div class="font-mono text-xs text-sophia-dark-muted mb-2">PAYLOAD</div>
              <pre class="overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-sophia-dark-text">{JSON.stringify(activeOperation.payload, null, 2)}</pre>
            </div>

            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
              <div class="font-mono text-xs text-sophia-dark-muted mb-2">SUMMARY</div>
              <p class="font-mono text-sm text-sophia-dark-text">{activeOperation.result_summary ?? 'Job is still in progress.'}</p>
              {#if activeOperation.last_error}
                <p class="mt-3 font-mono text-xs text-sophia-dark-copper">{activeOperation.last_error}</p>
              {/if}
            </div>
          </div>

          <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
            <div class="font-mono text-xs text-sophia-dark-muted mb-2">LOG</div>
            <pre class="min-h-[26rem] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-sophia-dark-text">{activeOperation.log_text || 'No logs captured yet.'}</pre>
          </div>
        </div>
      {:else}
        <div class="rounded border border-dashed border-sophia-dark-border px-4 py-10 text-center font-mono text-sm text-sophia-dark-dim">
          Select an operation to inspect its lineage, payload, and live log.
        </div>
      {/if}
    </section>
    {/if}
  </div>
</div>
