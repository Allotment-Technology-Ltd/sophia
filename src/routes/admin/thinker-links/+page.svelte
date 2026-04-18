<script lang="ts">
  import { onMount } from 'svelte';
  import { getIdToken } from '$lib/authClient';
  import { extractWikidataThinkerId } from '$lib/thinkerWikidataId';

  type QueueStatus = 'queued' | 'resolved' | 'rejected' | 'all';

  interface UnresolvedQueueItem {
    id: string;
    raw_name: string;
    canonical_name: string;
    source_ids: string[];
    contexts: string[];
    status: 'queued' | 'resolved' | 'rejected';
    seen_count: number;
    proposed_qids: string[];
    proposed_labels: string[];
    resolver_notes: string | null;
    first_seen_at: string | null;
    last_seen_at: string | null;
  }

  interface SourcePreview {
    id: string;
    url: string | null;
    title: string | null;
    author: string[] | null;
    source_type: string | null;
  }

  const STATUS_OPTIONS: { value: QueueStatus; label: string }[] = [
    { value: 'queued', label: 'Queued' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'all', label: 'All' }
  ];

  let loading = $state(true);
  let loadError = $state('');
  let actionError = $state('');
  let actionMessage = $state('');

  let status = $state<QueueStatus>('queued');
  let limit = $state(50);
  let items = $state<UnresolvedQueueItem[]>([]);
  let busyById = $state<Record<string, boolean>>({});
  /** Inline validation / last error for this row (global messages are easy to miss below the fold). */
  let itemMessageById = $state<Record<string, string>>({});
  let qidInputById = $state<Record<string, string>>({});
  let labelInputById = $state<Record<string, string>>({});
  let notesInputById = $state<Record<string, string>>({});
  let sourcePreviewById = $state<Record<string, SourcePreview>>({});

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }

  function setBusy(id: string, busy: boolean): void {
    busyById = { ...busyById, [id]: busy };
  }

  function setItemMessage(id: string, message: string): void {
    itemMessageById = { ...itemMessageById, [id]: message };
  }

  function clearItemMessage(id: string): void {
    const next = { ...itemMessageById };
    delete next[id];
    itemMessageById = next;
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getIdToken();
    if (!token) throw new Error('Authentication required.');
    return { Authorization: `Bearer ${token}` };
  }

  async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    if (!res.ok) {
      const detail = typeof body.detail === 'string' ? body.detail : '';
      const title = typeof body.title === 'string' ? body.title : '';
      const error = typeof body.error === 'string' ? body.error : '';
      throw new Error(error || detail || title || `Request failed (${res.status})`);
    }
    return body;
  }

  function pickSuggestedQid(item: UnresolvedQueueItem): string {
    if (item.proposed_qids.length > 0) return item.proposed_qids[0] ?? '';
    return '';
  }

  function pickSuggestedLabel(item: UnresolvedQueueItem): string {
    if (item.proposed_labels.length > 0) return item.proposed_labels[0] ?? item.raw_name;
    return item.raw_name;
  }

  function hydrateDrafts(queueItems: UnresolvedQueueItem[]): void {
    const qidDraft: Record<string, string> = {};
    const labelDraft: Record<string, string> = {};
    const notesDraft: Record<string, string> = {};
    for (const item of queueItems) {
      qidDraft[item.id] = qidInputById[item.id] ?? pickSuggestedQid(item);
      labelDraft[item.id] = labelInputById[item.id] ?? pickSuggestedLabel(item);
      notesDraft[item.id] = notesInputById[item.id] ?? '';
    }
    qidInputById = qidDraft;
    labelInputById = labelDraft;
    notesInputById = notesDraft;
  }

  async function loadQueue(): Promise<void> {
    loading = true;
    loadError = '';
    actionMessage = '';
    try {
      const params = new URLSearchParams({
        status,
        limit: String(limit)
      });
      const res = await fetch(`/api/admin/thinker-links/unresolved?${params.toString()}`, {
        headers: await authHeaders()
      });
      const body = await parseJsonResponse(res);
      const nextItems = Array.isArray(body.items) ? (body.items as UnresolvedQueueItem[]) : [];
      items = nextItems;
      itemMessageById = {};
      hydrateDrafts(nextItems);
      await loadSourcePreviews(nextItems);
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Failed to load unresolved thinker links.';
      items = [];
      sourcePreviewById = {};
    } finally {
      loading = false;
    }
  }

  async function loadSourcePreviews(queueItems: UnresolvedQueueItem[]): Promise<void> {
    const uniqueSourceIds = Array.from(new Set(queueItems.flatMap((item) => item.source_ids))).slice(0, 500);
    if (uniqueSourceIds.length === 0) {
      sourcePreviewById = {};
      return;
    }
    const res = await fetch('/api/admin/thinker-links/sources', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeaders())
      },
      body: JSON.stringify({ source_ids: uniqueSourceIds })
    });
    const body = await parseJsonResponse(res);
    const previews = Array.isArray(body.items) ? (body.items as SourcePreview[]) : [];
    sourcePreviewById = Object.fromEntries(previews.map((preview) => [preview.id, preview])) as Record<
      string,
      SourcePreview
    >;
  }

  function sourceInspectHref(preview: SourcePreview): string | null {
    if (!preview.url) return null;
    return `/admin/ingest/jobs?prefillUrl=${encodeURIComponent(preview.url)}`;
  }

  function setSuggestion(item: UnresolvedQueueItem, qid: string, label: string): void {
    clearItemMessage(item.id);
    qidInputById = { ...qidInputById, [item.id]: qid };
    labelInputById = { ...labelInputById, [item.id]: label };
  }

  async function resolveItem(item: UnresolvedQueueItem): Promise<void> {
    actionError = '';
    actionMessage = '';
    clearItemMessage(item.id);
    const rawQ = (qidInputById[item.id] ?? '').trim();
    const wikidata_id = extractWikidataThinkerId(rawQ);
    const label = (labelInputById[item.id] ?? '').trim();
    const notes = (notesInputById[item.id] ?? '').trim();
    if (!wikidata_id) {
      setItemMessage(
        item.id,
        rawQ
          ? `Could not read a Wikidata id from "${rawQ.slice(0, 80)}${rawQ.length > 80 ? '…' : ''}". Use a Q-id (e.g. Q9312) or paste a Wikidata entity URL.`
          : `Enter a Wikidata id (e.g. Q9312) or paste a Wikidata URL for "${item.raw_name}".`
      );
      return;
    }
    setBusy(item.id, true);
    try {
      const res = await fetch(`/api/admin/thinker-links/unresolved/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders())
        },
        body: JSON.stringify({
          action: 'resolve',
          wikidata_id,
          label: label || undefined,
          notes: notes || undefined
        })
      });
      const body = await parseJsonResponse(res);
      const linkedSources = typeof body.linked_sources === 'number' ? body.linked_sources : 0;
      actionMessage = `Resolved "${item.raw_name}" to ${wikidata_id}. Linked ${linkedSources} source(s).`;
      await loadQueue();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Resolve failed.';
      setItemMessage(item.id, msg);
      actionError = msg;
    } finally {
      setBusy(item.id, false);
    }
  }

  async function rejectItem(item: UnresolvedQueueItem): Promise<void> {
    actionError = '';
    actionMessage = '';
    clearItemMessage(item.id);
    const notes = (notesInputById[item.id] ?? '').trim();
    setBusy(item.id, true);
    try {
      const res = await fetch(`/api/admin/thinker-links/unresolved/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders())
        },
        body: JSON.stringify({
          action: 'reject',
          notes: notes || undefined
        })
      });
      await parseJsonResponse(res);
      actionMessage = `Rejected "${item.raw_name}".`;
      await loadQueue();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Reject failed.';
      setItemMessage(item.id, msg);
      actionError = msg;
    } finally {
      setBusy(item.id, false);
    }
  }

  onMount(() => {
    void loadQueue();
  });
</script>

<svelte:head>
  <title>Thinker Link Review — Admin</title>
</svelte:head>

<main class="thinker-links-page">
  <header class="thinker-links-hero">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin</p>
        <h1 class="mt-2 font-serif text-3xl text-sophia-dark-text sm:text-[2.1rem]">Thinker link review</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
          Triage unmatched author names queued by the importer, resolve to a Wikidata thinker id, and backfill
          <code class="font-mono text-xs text-sophia-dark-text">thinker -> authored -> source</code> links.
        </p>
      </div>
      <nav class="flex flex-wrap gap-2" aria-label="Admin shortcuts">
        <a href="/admin" class="thinker-nav-link">Admin home</a>
        <a href="/admin/ingest/operator" class="thinker-nav-link">Ingestion</a>
      </nav>
    </div>
  </header>

  <section class="mt-6 rounded border border-sophia-dark-border bg-sophia-dark-bg/30 p-4">
    <div class="flex flex-wrap items-end gap-3">
      <label class="flex flex-col gap-2 font-mono text-xs text-sophia-dark-muted">
        Status
        <select
          class="min-h-[44px] rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 text-sophia-dark-text"
          bind:value={status}
        >
          {#each STATUS_OPTIONS as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>

      <label class="flex flex-col gap-2 font-mono text-xs text-sophia-dark-muted">
        Limit
        <input
          class="min-h-[44px] w-28 rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 text-sophia-dark-text"
          type="number"
          min="1"
          max="200"
          bind:value={limit}
        />
      </label>

      <button
        type="button"
        class="min-h-[44px] rounded border border-sophia-dark-sage/55 bg-sophia-dark-sage/14 px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-sage hover:bg-sophia-dark-sage/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-blue"
        onclick={() => void loadQueue()}
      >
        Refresh queue
      </button>
    </div>
  </section>

  {#if loading}
    <p class="mt-6 font-mono text-sm text-sophia-dark-muted">Loading unresolved thinker references…</p>
  {:else if loadError}
    <p class="mt-6 rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-4 font-mono text-sm text-sophia-dark-copper">
      {loadError}
    </p>
  {:else if items.length === 0}
    <p class="mt-6 rounded border border-sophia-dark-border bg-sophia-dark-surface p-4 font-mono text-sm text-sophia-dark-muted">
      No records found for the selected status.
    </p>
  {:else}
    <section class="mt-6 grid gap-4">
      {#each items as item (item.id)}
        <article class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="font-mono text-sm text-sophia-dark-text">{item.raw_name}</h2>
              <p class="mt-1 font-mono text-xs text-sophia-dark-muted">canonical: {item.canonical_name}</p>
            </div>
            <div class="text-right font-mono text-xs">
              <p class="text-sophia-dark-muted">status</p>
              <p class="text-sophia-dark-text">{item.status}</p>
            </div>
          </div>

          <div class="mt-3 grid gap-2 font-mono text-xs text-sophia-dark-muted sm:grid-cols-3">
            <p>Seen: {item.seen_count}</p>
            <p>First seen: {formatDate(item.first_seen_at)}</p>
            <p>Last seen: {formatDate(item.last_seen_at)}</p>
          </div>

          <p class="mt-3 font-mono text-xs text-sophia-dark-muted">
            Sources:
            <span class="text-sophia-dark-text">
              {item.source_ids.length > 0 ? item.source_ids.join(', ') : '—'}
            </span>
          </p>

          {#if item.source_ids.length > 0}
            <div class="mt-3 flex flex-wrap gap-2">
              {#each item.source_ids as sourceId}
                {@const preview = sourcePreviewById[sourceId]}
                {@const inspectHref = preview ? sourceInspectHref(preview) : null}
                {#if inspectHref}
                  <a
                    class="min-h-[44px] inline-flex items-center rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-muted hover:border-sophia-dark-blue/45 hover:text-sophia-dark-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-blue"
                    href={inspectHref}
                  >
                    Inspect {preview.title ?? sourceId}
                  </a>
                {:else}
                  <span
                    class="min-h-[44px] inline-flex items-center rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-muted"
                  >
                    {preview?.title ?? sourceId}
                  </span>
                {/if}
              {/each}
            </div>
          {/if}

          {#if item.proposed_qids.length > 0}
            <div class="mt-3 flex flex-wrap gap-2">
              {#each item.proposed_qids as qid, idx}
                <button
                  type="button"
                  class="min-h-[44px] rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs text-sophia-dark-muted hover:border-sophia-dark-blue/45 hover:text-sophia-dark-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-blue"
                  onclick={() => setSuggestion(item, qid, item.proposed_labels[idx] ?? item.raw_name)}
                >
                  Use {qid} {item.proposed_labels[idx] ? `(${item.proposed_labels[idx]})` : ''}
                </button>
              {/each}
            </div>
          {/if}

          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-2 font-mono text-xs text-sophia-dark-muted">
              Wikidata id
              <input
                class="min-h-[44px] rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 text-sm text-sophia-dark-text"
                placeholder="Q9312 or paste entity URL"
                bind:value={qidInputById[item.id]}
                oninput={() => clearItemMessage(item.id)}
                disabled={busyById[item.id] === true || item.status !== 'queued'}
              />
            </label>

            <label class="flex flex-col gap-2 font-mono text-xs text-sophia-dark-muted">
              Label (optional)
              <input
                class="min-h-[44px] rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 text-sm text-sophia-dark-text"
                placeholder="Immanuel Kant"
                bind:value={labelInputById[item.id]}
                disabled={busyById[item.id] === true || item.status !== 'queued'}
              />
            </label>
          </div>

          <label class="mt-3 flex flex-col gap-2 font-mono text-xs text-sophia-dark-muted">
            Notes
            <textarea
              class="min-h-[88px] rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 text-sm text-sophia-dark-text"
              placeholder="Optional audit note for why this was resolved or rejected."
              bind:value={notesInputById[item.id]}
              disabled={busyById[item.id] === true || item.status !== 'queued'}
            ></textarea>
          </label>

          {#if itemMessageById[item.id]}
            <p
              class="mt-3 rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-3 font-mono text-xs text-sophia-dark-copper"
              role="alert"
            >
              {itemMessageById[item.id]}
            </p>
          {/if}

          {#if item.status !== 'queued'}
            <p class="mt-3 font-mono text-xs text-sophia-dark-muted" role="note">
              Resolve and reject are only enabled for <span class="text-sophia-dark-text">queued</span> rows.
              Change the status filter above to Queued, or pick another row.
            </p>
          {/if}

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="min-h-[44px] rounded border border-sophia-dark-sage/55 bg-sophia-dark-sage/14 px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-sage hover:bg-sophia-dark-sage/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-blue disabled:opacity-50"
              onclick={() => void resolveItem(item)}
              disabled={busyById[item.id] === true || item.status !== 'queued'}
              title={item.status !== 'queued' ? 'Switch status filter to Queued' : undefined}
            >
              {busyById[item.id] ? 'Saving…' : 'Resolve + link'}
            </button>
            <button
              type="button"
              class="min-h-[44px] rounded border border-sophia-dark-copper/55 bg-sophia-dark-copper/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-copper hover:bg-sophia-dark-copper/16 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-blue disabled:opacity-50"
              onclick={() => void rejectItem(item)}
              disabled={busyById[item.id] === true || item.status !== 'queued'}
              title={item.status !== 'queued' ? 'Switch status filter to Queued' : undefined}
            >
              {busyById[item.id] ? 'Saving…' : 'Reject'}
            </button>
          </div>
        </article>
      {/each}
    </section>
  {/if}

  {#if actionMessage}
    <p class="mt-6 rounded border border-sophia-dark-blue/50 bg-sophia-dark-blue/10 p-3 font-mono text-xs text-sophia-dark-blue">
      {actionMessage}
    </p>
  {/if}
  {#if actionError}
    <p class="mt-6 rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-3 font-mono text-xs text-sophia-dark-copper">
      {actionError}
    </p>
  {/if}
</main>

<style>
  .thinker-links-page {
    min-height: calc(100vh - var(--nav-height));
    padding: 20px;
    max-width: 1240px;
    margin: 0 auto;
    color: var(--color-text);
  }
  .thinker-links-hero {
    border: 1px solid var(--color-border);
    background: linear-gradient(130deg, rgba(127, 163, 131, 0.16), rgba(44, 96, 142, 0.14));
    border-radius: 12px;
    padding: 20px;
  }
  .thinker-nav-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-muted);
    text-decoration: none;
    transition:
      border-color 0.2s ease,
      color 0.2s ease;
  }
  .thinker-nav-link:hover {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
    color: var(--color-text);
  }
  .thinker-nav-link:focus-visible {
    outline: 2px solid var(--color-blue);
    outline-offset: 3px;
  }
</style>
