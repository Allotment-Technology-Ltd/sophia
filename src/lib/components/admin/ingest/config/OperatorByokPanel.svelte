<script lang="ts">
  import { onMount } from 'svelte';
  import { authorizedFetchJson } from '$lib/authorizedFetchJson';
  import { BYOK_PROVIDER_ORDER, PROVIDER_UI_META, type ByokProvider } from '$lib/types/providers';

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

  let { compactHeader = false } = $props<{ compactHeader?: boolean }>();

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

  function setByokSaving(provider: ByokProvider, saving: boolean): void {
    byokSaving = { ...byokSaving, [provider]: saving };
  }

  async function loadProviders(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/operator-byok/providers');
      targetUid = typeof body.targetUid === 'string' ? body.targetUid : null;
      ownerUidsConfigured = typeof body.ownerUidsConfigured === 'number' ? body.ownerUidsConfigured : null;
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
      const body = await authorizedFetchJson<Record<string, unknown>>(`/api/admin/operator-byok/providers/${provider}`, {
        method: 'PUT',
        jsonBody: { api_key: apiKey }
      });
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
      const body = await authorizedFetchJson<Record<string, unknown>>(
        `/api/admin/operator-byok/providers/${provider}/validate`,
        { method: 'POST' }
      );
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
      await authorizedFetchJson<Record<string, unknown>>(`/api/admin/operator-byok/providers/${provider}`, {
        method: 'DELETE'
      });
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

{#if !compactHeader}
  <div class="op-subhead">
    <p class="op-subhead-title">Operator BYOK</p>
    <p class="op-subhead-muted">Environment-wide provider keys used as operational fallbacks.</p>
  </div>
{/if}

{#if loading}
  <p class="font-mono text-sm text-sophia-dark-muted">Loading operator BYOK…</p>
{:else if loadError}
  <div class="rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-4 font-mono text-sm text-sophia-dark-copper">
    <p>{loadError}</p>
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
              <p class="mt-1 text-xs leading-relaxed text-sophia-dark-muted">{BYOK_PROVIDER_HINTS[provider]}</p>
            </div>
            <div class="text-right font-mono text-xs text-sophia-dark-muted">
              <p>
                <span class="text-sophia-dark-dim">Status</span>
                <span class="ml-2 text-sophia-dark-text">{getByokStatusLabel(status.status)}</span>
              </p>
              <p class="mt-1">
                <span class="text-sophia-dark-dim">Fingerprint</span>
                <span class="ml-2 text-sophia-dark-text">{status.fingerprint_last8 ?? '—'}</span>
              </p>
            </div>
          </div>

          {#if status.last_error}
            <p class="mt-3 rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-2 font-mono text-xs text-sophia-dark-copper">
              {status.last_error}
            </p>
          {/if}

          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <label class="block">
              <span class="font-mono text-xs text-sophia-dark-muted">New API key</span>
              <input
                class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs text-sophia-dark-text outline-none focus:border-sophia-dark-copper/60"
                type="password"
                bind:value={byokInputs[provider]}
                placeholder={BYOK_PROVIDER_PLACEHOLDERS[provider]}
                autocomplete="off"
              />
            </label>
            <div class="grid content-start gap-2">
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="op-btn"
                  disabled={byokSaving[provider]}
                  onclick={() => void saveByokKey(provider)}
                >
                  {byokSaving[provider] ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  class="op-btn"
                  disabled={byokSaving[provider] || !status.configured}
                  onclick={() => void validateByokKey(provider)}
                  title={!status.configured ? 'Configure a key first' : ''}
                >
                  Validate
                </button>
                <button
                  type="button"
                  class="op-btn op-btn-danger"
                  disabled={byokSaving[provider] || !status.configured}
                  onclick={() => void revokeByokKey(provider)}
                  title={!status.configured ? 'Nothing to revoke' : ''}
                >
                  Revoke
                </button>
              </div>
              <div class="font-mono text-[11px] text-sophia-dark-muted">
                <p>
                  <span class="text-sophia-dark-dim">Updated</span>
                  <span class="ml-2 text-sophia-dark-text">{formatDate(status.updated_at)}</span>
                </p>
                <p class="mt-1">
                  <span class="text-sophia-dark-dim">Validated</span>
                  <span class="ml-2 text-sophia-dark-text">{formatDate(status.validated_at)}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if byokError}
    <p class="mt-4 rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-3 font-mono text-xs text-sophia-dark-copper">
      {byokError}
    </p>
  {/if}
  {#if byokMessage}
    <p class="mt-4 rounded border border-sophia-dark-border bg-sophia-dark-bg p-3 font-mono text-xs text-sophia-dark-text">
      {byokMessage}
    </p>
  {/if}
{/if}

<style>
  .op-subhead {
    margin-bottom: 12px;
  }
  .op-subhead-title {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 13px;
    color: var(--sophia-dark-text);
  }
  .op-subhead-muted {
    margin-top: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 12px;
    color: var(--sophia-dark-muted);
  }
</style>

