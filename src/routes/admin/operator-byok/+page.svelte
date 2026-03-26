<script lang="ts">
  import { onMount } from 'svelte';
  import { getIdToken } from '$lib/firebase';
  import {
    BYOK_PROVIDER_ORDER,
    PROVIDER_UI_META,
    type ByokProvider
  } from '$lib/types/providers';

  interface ByokProviderStatus {
    provider: ByokProvider;
    configured: boolean;
    status: 'not_configured' | 'pending_validation' | 'active' | 'invalid' | 'revoked';
    fingerprint_last8: string | null;
    validated_at: string | null;
    updated_at: string | null;
    last_error: string | null;
  }

  const BYOK_PROVIDER_LABELS: Record<ByokProvider, string> = Object.fromEntries(
    BYOK_PROVIDER_ORDER.map((provider) => [provider, PROVIDER_UI_META[provider].label])
  ) as Record<ByokProvider, string>;
  const BYOK_PROVIDER_HINTS: Record<ByokProvider, string> = Object.fromEntries(
    BYOK_PROVIDER_ORDER.map((provider) => [provider, PROVIDER_UI_META[provider].hint])
  ) as Record<ByokProvider, string>;
  const BYOK_PROVIDER_PLACEHOLDERS: Record<ByokProvider, string> = Object.fromEntries(
    BYOK_PROVIDER_ORDER.map((provider) => [provider, PROVIDER_UI_META[provider].placeholder])
  ) as Record<ByokProvider, string>;

  function emptyProviderMap<T>(value: T): Record<ByokProvider, T> {
    return Object.fromEntries(BYOK_PROVIDER_ORDER.map((provider) => [provider, value])) as Record<
      ByokProvider,
      T
    >;
  }

  let loading = $state(true);
  let loadError = $state('');
  let targetUid = $state<string | null>(null);
  let ownerUidsConfigured = $state<number | null>(null);
  let precedenceNote = $state('');
  let degraded = $state(false);
  let degradedDetail = $state('');

  let byokProviders = $state<ByokProviderStatus[]>([]);
  let byokInputs = $state<Record<ByokProvider, string>>(emptyProviderMap(''));
  let byokSaving = $state<Record<ByokProvider, boolean>>(emptyProviderMap(false));
  let byokError = $state('');
  let byokMessage = $state('');

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }

  function getByokStatusLabel(status: ByokProviderStatus['status']): string {
    if (status === 'active') return 'Active';
    if (status === 'pending_validation') return 'Pending validation';
    if (status === 'invalid') return 'Invalid key';
    if (status === 'revoked') return 'Revoked';
    return 'Not configured';
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
      throw new Error(detail || title || `Request failed (${res.status})`);
    }
    return body;
  }

  function setByokSaving(provider: ByokProvider, saving: boolean): void {
    byokSaving = { ...byokSaving, [provider]: saving };
  }

  async function loadProviders(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const res = await fetch('/api/admin/operator-byok/providers', {
        headers: await authHeaders()
      });
      const body = await parseJsonResponse(res);
      targetUid = typeof body.targetUid === 'string' ? body.targetUid : null;
      ownerUidsConfigured =
        typeof body.ownerUidsConfigured === 'number' ? body.ownerUidsConfigured : null;
      precedenceNote = typeof body.precedenceNote === 'string' ? body.precedenceNote : '';
      degraded = body.degraded === true;
      degradedDetail = typeof body.detail === 'string' ? body.detail : '';
      const providers = Array.isArray(body.providers) ? (body.providers as ByokProviderStatus[]) : [];
      byokProviders = providers;
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load operator BYOK.';
      byokProviders = [];
      targetUid = null;
    } finally {
      loading = false;
    }
  }

  async function saveByokKey(provider: ByokProvider): Promise<void> {
    byokError = '';
    byokMessage = '';
    const apiKey = byokInputs[provider].trim();
    if (!apiKey) {
      byokError = `Enter a ${BYOK_PROVIDER_LABELS[provider]} API key before saving.`;
      return;
    }
    setByokSaving(provider, true);
    try {
      const res = await fetch(`/api/admin/operator-byok/providers/${provider}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders())
        },
        body: JSON.stringify({ api_key: apiKey })
      });
      const body = await parseJsonResponse(res);
      byokInputs = { ...byokInputs, [provider]: '' };
      await loadProviders();
      const ok = (body?.validation as { ok?: boolean } | undefined)?.ok === true;
      byokMessage = ok
        ? `${BYOK_PROVIDER_LABELS[provider]} key saved and validated.`
        : `${BYOK_PROVIDER_LABELS[provider]} key saved but validation failed.`;
    } catch (error) {
      byokError = error instanceof Error ? error.message : 'Save failed.';
    } finally {
      setByokSaving(provider, false);
    }
  }

  async function validateByokKey(provider: ByokProvider): Promise<void> {
    byokError = '';
    byokMessage = '';
    setByokSaving(provider, true);
    try {
      const res = await fetch(`/api/admin/operator-byok/providers/${provider}/validate`, {
        method: 'POST',
        headers: await authHeaders()
      });
      const body = await parseJsonResponse(res);
      await loadProviders();
      const ok = (body?.validation as { ok?: boolean } | undefined)?.ok === true;
      byokMessage = ok
        ? `${BYOK_PROVIDER_LABELS[provider]} credential is valid.`
        : `${BYOK_PROVIDER_LABELS[provider]} validation failed.`;
    } catch (error) {
      byokError = error instanceof Error ? error.message : 'Validation failed.';
    } finally {
      setByokSaving(provider, false);
    }
  }

  async function revokeByokKey(provider: ByokProvider): Promise<void> {
    byokError = '';
    byokMessage = '';
    setByokSaving(provider, true);
    try {
      const res = await fetch(`/api/admin/operator-byok/providers/${provider}`, {
        method: 'DELETE',
        headers: await authHeaders()
      });
      await parseJsonResponse(res);
      byokInputs = { ...byokInputs, [provider]: '' };
      await loadProviders();
      byokMessage = `${BYOK_PROVIDER_LABELS[provider]} credential revoked.`;
    } catch (error) {
      byokError = error instanceof Error ? error.message : 'Revoke failed.';
    } finally {
      setByokSaving(provider, false);
    }
  }

  onMount(() => {
    void loadProviders();
  });
</script>

<svelte:head>
  <title>Operator BYOK — Admin</title>
</svelte:head>

<main class="op-byok-page">
  <header class="op-byok-hero">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin</p>
        <h1 class="mt-2 font-serif text-3xl text-sophia-dark-text sm:text-[2.1rem]">Operator BYOK</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
          Manage provider keys on the <strong class="text-sophia-dark-text">OWNER_UIDS</strong> Firestore bucket (first
          UID). These keys back operational fallbacks when tenant BYOK is empty — see the shared effective-key resolver
          (<code class="font-mono text-xs text-sophia-dark-text">effectiveKeys.ts</code>).
        </p>
      </div>
      <nav class="flex flex-wrap gap-2" aria-label="Admin shortcuts">
        <a href="/admin" class="op-byok-nav-link">Admin home</a>
        <a href="/admin/ingest" class="op-byok-nav-link">Expand</a>
      </nav>
    </div>
  </header>

  <section class="op-byok-section">
    {#if loading}
      <p class="font-mono text-sm text-sophia-dark-muted">Loading operator BYOK…</p>
    {:else if loadError}
      <div class="rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-4 font-mono text-sm text-sophia-dark-copper">
        {loadError}
      </div>
    {:else}
      <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg/40 p-4 font-mono text-xs text-sophia-dark-muted">
        <p>
          <span class="text-sophia-dark-dim">Target UID</span>
          <span class="ml-2 text-sophia-dark-text">{targetUid ?? '—'}</span>
        </p>
        {#if ownerUidsConfigured != null}
          <p class="mt-2">
            <span class="text-sophia-dark-dim">OWNER_UIDS entries</span>
            <span class="ml-2 text-sophia-dark-text">{ownerUidsConfigured}</span>
          </p>
        {/if}
        {#if precedenceNote}
          <p class="mt-3 leading-relaxed">{precedenceNote}</p>
        {/if}
        {#if degraded && degradedDetail}
          <p class="mt-3 rounded border border-sophia-dark-amber/40 bg-sophia-dark-amber/10 p-2 text-sophia-dark-muted">
            {degradedDetail}
          </p>
        {/if}
      </div>

      {#if byokProviders.length === 0}
        <p class="mt-6 rounded border border-sophia-dark-border bg-sophia-dark-bg p-4 font-mono text-sm text-sophia-dark-muted">
          No BYOK providers are enabled in this environment.
        </p>
      {:else}
        <div class="mt-6 grid gap-4">
          {#each byokProviders as status (status.provider)}
            {@const provider = status.provider}
            <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="font-mono text-sm text-sophia-dark-text">{BYOK_PROVIDER_LABELS[provider]}</p>
                  <p class="mt-1 font-mono text-xs text-sophia-dark-muted">{BYOK_PROVIDER_HINTS[provider]}</p>
                </div>
                <div class="text-right font-mono text-xs">
                  <p class="text-sophia-dark-muted">Status</p>
                  <p
                    class={status.status === 'active'
                      ? 'text-sophia-dark-sage'
                      : status.status === 'invalid'
                        ? 'text-sophia-dark-copper'
                        : 'text-sophia-dark-muted'}
                  >
                    {getByokStatusLabel(status.status)}
                  </p>
                </div>
              </div>

              <div class="mt-3 grid gap-2 font-mono text-xs text-sophia-dark-muted sm:grid-cols-3">
                <p>Fingerprint: {status.fingerprint_last8 ? `…${status.fingerprint_last8}` : '—'}</p>
                <p>Validated: {formatDate(status.validated_at)}</p>
                <p>Updated: {formatDate(status.updated_at)}</p>
              </div>
              {#if status.last_error}
                <p class="mt-2 rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-2 font-mono text-xs text-sophia-dark-copper">
                  Last validation error: {status.last_error}
                </p>
              {/if}

              <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
                <input
                  class="min-h-[44px] min-w-0 flex-1 rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-sm text-sophia-dark-text"
                  type="password"
                  autocomplete="off"
                  placeholder={BYOK_PROVIDER_PLACEHOLDERS[provider]}
                  value={byokInputs[provider]}
                  oninput={(event) => {
                    byokInputs = {
                      ...byokInputs,
                      [provider]: (event.currentTarget as HTMLInputElement).value
                    };
                  }}
                  disabled={byokSaving[provider]}
                />
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="min-h-[44px] rounded border border-sophia-dark-sage/55 bg-sophia-dark-sage/14 px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-sage hover:bg-sophia-dark-sage/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-blue disabled:opacity-50"
                    onclick={() => void saveByokKey(provider)}
                    disabled={byokSaving[provider]}
                  >
                    {byokSaving[provider] ? 'Saving…' : 'Save key'}
                  </button>
                  <button
                    type="button"
                    class="min-h-[44px] rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-muted hover:border-sophia-dark-blue/40 hover:text-sophia-dark-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-blue disabled:opacity-50"
                    onclick={() => void validateByokKey(provider)}
                    disabled={byokSaving[provider] || !status.configured}
                  >
                    Validate
                  </button>
                  <button
                    type="button"
                    class="min-h-[44px] rounded border border-sophia-dark-copper/55 bg-sophia-dark-copper/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-copper hover:bg-sophia-dark-copper/16 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-blue disabled:opacity-50"
                    onclick={() => void revokeByokKey(provider)}
                    disabled={byokSaving[provider] || !status.configured}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if byokMessage}
        <p class="mt-4 rounded border border-sophia-dark-blue/50 bg-sophia-dark-blue/10 p-3 font-mono text-xs text-sophia-dark-blue">
          {byokMessage}
        </p>
      {/if}
      {#if byokError}
        <p class="mt-4 rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-3 font-mono text-xs text-sophia-dark-copper">
          {byokError}
        </p>
      {/if}

      <div class="mt-8">
        <button
          type="button"
          class="min-h-[44px] rounded border border-sophia-dark-border bg-sophia-dark-bg px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-muted hover:border-sophia-dark-sage/40 hover:text-sophia-dark-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sophia-dark-blue"
          onclick={() => void loadProviders()}
        >
          Refresh status
        </button>
      </div>
    {/if}
  </section>
</main>

<style>
  .op-byok-page {
    min-height: calc(100vh - var(--nav-height));
    padding: 20px;
    max-width: 1240px;
    margin: 0 auto;
    color: var(--color-text);
  }
  .op-byok-hero {
    border: 1px solid var(--color-border);
    background: linear-gradient(130deg, rgba(44, 96, 142, 0.12), rgba(127, 163, 131, 0.16));
    border-radius: 12px;
    padding: 20px;
  }
  .op-byok-section {
    margin-top: 24px;
  }
  .op-byok-nav-link {
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
  .op-byok-nav-link:hover {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
    color: var(--color-text);
  }
  .op-byok-nav-link:focus-visible {
    outline: 2px solid var(--color-blue);
    outline-offset: 3px;
  }
</style>
