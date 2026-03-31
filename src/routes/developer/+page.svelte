<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { auth, onAuthChange, getIdToken } from '$lib/authClient';
  import { env as publicEnv } from '$env/dynamic/public';
  import { onMount } from 'svelte';
  import {
    BYOK_PROVIDER_ORDER,
    PROVIDER_UI_META,
    type ByokProvider
  } from '$lib/types/providers';

  type PlaygroundMode = 'json' | 'sse';

  interface ApiKeyItem {
    key_id: string;
    owner_uid: string;
    name: string;
    key_prefix: string;
    active: boolean;
    created_at: string | null;
    last_used_at: string | null;
    usage_count: number;
    daily_count: number;
    daily_quota: number;
    daily_reset_at?: string | null;
  }

  interface UsageResponse {
    owner_uid: string;
    totals: {
      usage_count: number;
      daily_count: number;
      daily_quota: number;
      active_keys: number;
      total_keys: number;
    };
    keys: ApiKeyItem[];
  }

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
    return Object.fromEntries(BYOK_PROVIDER_ORDER.map((provider) => [provider, value])) as Record<ByokProvider, T>;
  }

  interface ProblemDetail {
    type?: string;
    title?: string;
    detail?: string;
    status?: number;
    request_id?: string;
  }

  let isSignedIn = $state(false);
  let loadingAccountData = $state(false);
  let accountError = $state('');

  let keys = $state<ApiKeyItem[]>([]);
  let usage = $state<UsageResponse | null>(null);
  let newlyCreatedKey = $state('');

  let newKeyName = $state('My integration');
  let newKeyQuota = $state(100);
  let byokProviders = $state<ByokProviderStatus[]>([]);
  let byokInputs = $state<Record<ByokProvider, string>>(emptyProviderMap(''));
  let byokSaving = $state<Record<ByokProvider, boolean>>(emptyProviderMap(false));
  let byokError = $state('');
  let byokMessage = $state('');

  let playgroundMode = $state<PlaygroundMode>('json');
  let playgroundApiKey = $state('');
  let playgroundBody = $state(JSON.stringify({
    question: 'Should organisations disclose when content is AI-generated?',
    answer: 'Yes, because transparency preserves user autonomy and informed trust.',
    text: 'Organisations should disclose AI-generated content to preserve user autonomy and trust.'
  }, null, 2));
  let playgroundLoading = $state(false);
  let playgroundError = $state('');
  let playgroundHeaders = $state<Record<string, string>>({});
  let playgroundJsonResponse = $state('');
  let playgroundEvents = $state<string[]>([]);
  const zuploPortalUrl = publicEnv.PUBLIC_ZUPLO_DEVELOPER_PORTAL_URL || '';
  const quickstartCurl = `curl -X POST https://usesophia.app/api/v1/verify \\
  -H "Authorization: Bearer sk-sophia-..." \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json" \\
  -d '{
    "question": "Should models explain uncertainty?",
    "answer": "Yes, it supports calibrated trust.",
    "text": "Models should explain uncertainty to prevent overconfident misuse."
  }'`;

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }

  function formatProblem(error: unknown): string {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;

    const asProblem = error as ProblemDetail;
    if (asProblem.title || asProblem.detail) {
      return `${asProblem.title ?? 'Error'}${asProblem.detail ? `: ${asProblem.detail}` : ''}`;
    }

    if (error instanceof Error) return error.message;
    return 'Request failed';
  }

  async function fetchWithFirebase(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getIdToken();
    if (!token) {
      throw new Error('You must be signed in to manage keys and usage.');
    }

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);

    return fetch(path, {
      ...init,
      headers
    });
  }

  async function parseResponseOrThrow(response: Response): Promise<any> {
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw body;
    }

    return body;
  }

  async function loadKeys(): Promise<void> {
    const response = await fetchWithFirebase('/api/v1/keys', { method: 'GET' });
    const body = await parseResponseOrThrow(response);
    keys = Array.isArray(body.keys) ? body.keys : [];
  }

  async function loadUsage(): Promise<void> {
    const response = await fetchWithFirebase('/api/v1/usage', { method: 'GET' });
    const body = await parseResponseOrThrow(response);
    usage = body as UsageResponse;
  }

  function getByokStatusLabel(status: ByokProviderStatus['status']): string {
    if (status === 'active') return 'Active';
    if (status === 'pending_validation') return 'Pending validation';
    if (status === 'invalid') return 'Invalid key';
    if (status === 'revoked') return 'Revoked';
    return 'Not configured';
  }

  async function loadByokProviders(): Promise<void> {
    const response = await fetchWithFirebase('/api/byok/providers', { method: 'GET' });
    const body = await parseResponseOrThrow(response);
    const providers = Array.isArray(body.providers) ? body.providers as ByokProviderStatus[] : [];
    byokProviders = providers;
  }

  function setByokSaving(provider: ByokProvider, saving: boolean): void {
    byokSaving = {
      ...byokSaving,
      [provider]: saving
    };
  }

  async function refreshAccountData(): Promise<void> {
    if (!isSignedIn) {
      keys = [];
      usage = null;
      byokProviders = [];
      byokError = '';
      byokMessage = '';
      return;
    }

    loadingAccountData = true;
    accountError = '';
    byokError = '';
    byokMessage = '';
    try {
      await Promise.all([loadKeys(), loadUsage(), loadByokProviders()]);
    } catch (error) {
      accountError = formatProblem(error);
    } finally {
      loadingAccountData = false;
    }
  }

  async function createKey(): Promise<void> {
    accountError = '';
    newlyCreatedKey = '';

    try {
      const response = await fetchWithFirebase('/api/v1/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: newKeyName,
          daily_quota: newKeyQuota
        })
      });

      const body = await parseResponseOrThrow(response);
      newlyCreatedKey = body.api_key ?? '';
      await Promise.all([loadKeys(), loadUsage(), loadByokProviders()]);
    } catch (error) {
      accountError = formatProblem(error);
    }
  }

  async function revokeKey(keyId: string): Promise<void> {
    accountError = '';
    try {
      const response = await fetchWithFirebase('/api/v1/keys', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key_id: keyId })
      });

      await parseResponseOrThrow(response);
      await Promise.all([loadKeys(), loadUsage(), loadByokProviders()]);
    } catch (error) {
      accountError = formatProblem(error);
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
      const response = await fetchWithFirebase(`/api/byok/providers/${provider}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ api_key: apiKey })
      });
      const body = await parseResponseOrThrow(response);
      byokInputs = {
        ...byokInputs,
        [provider]: ''
      };
      await loadByokProviders();
      const ok = body?.validation?.ok === true;
      byokMessage = ok
        ? `${BYOK_PROVIDER_LABELS[provider]} key saved and validated.`
        : `${BYOK_PROVIDER_LABELS[provider]} key saved but validation failed.`;
    } catch (error) {
      byokError = formatProblem(error);
    } finally {
      setByokSaving(provider, false);
    }
  }

  async function validateByokKey(provider: ByokProvider): Promise<void> {
    byokError = '';
    byokMessage = '';
    setByokSaving(provider, true);
    try {
      const response = await fetchWithFirebase(`/api/byok/providers/${provider}/validate`, {
        method: 'POST'
      });
      const body = await parseResponseOrThrow(response);
      await loadByokProviders();
      const ok = body?.validation?.ok === true;
      byokMessage = ok
        ? `${BYOK_PROVIDER_LABELS[provider]} credential is valid.`
        : `${BYOK_PROVIDER_LABELS[provider]} validation failed.`;
    } catch (error) {
      byokError = formatProblem(error);
    } finally {
      setByokSaving(provider, false);
    }
  }

  async function revokeByokKey(provider: ByokProvider): Promise<void> {
    byokError = '';
    byokMessage = '';
    setByokSaving(provider, true);
    try {
      const response = await fetchWithFirebase(`/api/byok/providers/${provider}`, {
        method: 'DELETE'
      });
      await parseResponseOrThrow(response);
      byokInputs = {
        ...byokInputs,
        [provider]: ''
      };
      await loadByokProviders();
      byokMessage = `${BYOK_PROVIDER_LABELS[provider]} credential revoked.`;
    } catch (error) {
      byokError = formatProblem(error);
    } finally {
      setByokSaving(provider, false);
    }
  }

  function storeResponseHeaders(response: Response): void {
    playgroundHeaders = {
      'X-Request-Id': response.headers.get('X-Request-Id') ?? '—',
      'X-Processing-Time-Ms': response.headers.get('X-Processing-Time-Ms') ?? '—',
      'X-Token-Usage': response.headers.get('X-Token-Usage') ?? '—'
    };
  }

  async function runPlayground(): Promise<void> {
    playgroundLoading = true;
    playgroundError = '';
    playgroundJsonResponse = '';
    playgroundEvents = [];
    playgroundHeaders = {};

    let payload: unknown;
    try {
      payload = JSON.parse(playgroundBody);
    } catch {
      playgroundError = 'Request body must be valid JSON.';
      playgroundLoading = false;
      return;
    }

    if (!playgroundApiKey.trim()) {
      playgroundError = 'Provide an API key to run the playground.';
      playgroundLoading = false;
      return;
    }

    const headers = {
      Authorization: `Bearer ${playgroundApiKey.trim()}`,
      'Content-Type': 'application/json',
      Accept: playgroundMode === 'sse' ? 'text/event-stream' : 'application/json'
    };

    try {
      const response = await fetch('/api/v1/verify', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      storeResponseHeaders(response);

      if (playgroundMode === 'json') {
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        playgroundJsonResponse = JSON.stringify(parsed, null, 2);
        if (!response.ok) {
          throw parsed;
        }
      } else {
        if (!response.ok || !response.body) {
          const text = await response.text();
          const parsed = text ? JSON.parse(text) : {};
          throw parsed;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';

          for (const chunk of chunks) {
            const line = chunk
              .split('\n')
              .find((entry) => entry.startsWith('data: '));
            if (!line) continue;
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const event = JSON.parse(data);
              playgroundEvents = [...playgroundEvents, JSON.stringify(event, null, 2)];
            } catch {
              playgroundEvents = [...playgroundEvents, data];
            }
          }
        }
      }
    } catch (error) {
      playgroundError = formatProblem(error);
    } finally {
      playgroundLoading = false;
    }
  }

  onMount(() => {
    if (!browser) return;

    const initialUser = auth?.currentUser ?? null;
    isSignedIn = Boolean(initialUser);
    refreshAccountData();

    return onAuthChange((user) => {
      isSignedIn = Boolean(user);
      refreshAccountData();
    });
  });
</script>

<svelte:head>
  <title>SOPHIA Developer Portal</title>
  <meta
    name="description"
    content="Developer portal for SOPHIA Reasoning API v1: quickstart, API keys, usage, and playground."
  />
</svelte:head>

<div class="min-h-screen bg-sophia-dark-bg text-sophia-dark-text">
  <div class="mx-auto max-w-6xl px-6 py-12">
    <header class="mb-10">
      <p class="font-mono text-xs uppercase tracking-[0.2em] text-sophia-dark-muted">Developer Portal</p>
      <h1 class="mt-3 font-serif text-4xl">SOPHIA Reasoning API v1</h1>
      <p class="mt-3 max-w-3xl font-mono text-sm text-sophia-dark-muted">
        Verify reasoning quality with extracted claims, logical relations, constitutional checks, and dimensioned scores.
      </p>
      {#if zuploPortalUrl}
        <p class="mt-3 font-mono text-xs text-sophia-dark-blue">
          Hosted portal: <a class="underline" href={zuploPortalUrl} target="_blank" rel="noreferrer">{zuploPortalUrl}</a>
        </p>
      {/if}
    </header>

    <section class="mb-8 rounded border border-sophia-dark-border bg-sophia-dark-surface p-6">
      <h2 class="font-serif text-2xl">Quickstart</h2>
      <ol class="mt-4 list-decimal space-y-2 pl-5 font-mono text-sm text-sophia-dark-muted">
        <li>Sign in with Google to create and manage your API keys.</li>
        <li>Use your key as a bearer token: <code>Authorization: Bearer sk-sophia-...</code>.</li>
        <li>Call <code>POST /api/v1/verify</code> in JSON mode or SSE mode.</li>
      </ol>
      <pre class="mt-5 overflow-x-auto rounded border border-sophia-dark-border bg-sophia-dark-bg p-4 text-xs"><code>{quickstartCurl}</code></pre>

      {#if !isSignedIn}
        <div class="mt-5 flex items-center justify-between rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
          <p class="font-mono text-sm text-sophia-dark-muted">Sign in to create keys and view usage analytics.</p>
          <button
            class="rounded border border-sophia-dark-sage px-3 py-2 font-mono text-sm text-sophia-dark-sage hover:bg-sophia-dark-sage/10"
            onclick={() => goto('/early-access')}
          >
            Sign in
          </button>
        </div>
      {/if}
    </section>

    <section class="mb-8 rounded border border-sophia-dark-border bg-sophia-dark-surface p-6">
      <h2 class="font-serif text-2xl">Bring Your Own Key (BYOK)</h2>
      <p class="mt-3 max-w-3xl font-mono text-sm text-sophia-dark-muted">
        Configure your own model provider credentials to run reasoning calls against your provider budget.
      </p>

      {#if !isSignedIn}
        <p class="mt-4 rounded border border-sophia-dark-border bg-sophia-dark-bg p-3 font-mono text-sm text-sophia-dark-muted">
          Sign in to manage BYOK credentials.
        </p>
      {:else if loadingAccountData && byokProviders.length === 0}
        <p class="mt-4 font-mono text-sm text-sophia-dark-muted">Loading BYOK providers...</p>
      {:else if byokProviders.length === 0}
        <p class="mt-4 rounded border border-sophia-dark-border bg-sophia-dark-bg p-3 font-mono text-sm text-sophia-dark-muted">
          No BYOK providers are enabled in this environment.
        </p>
      {:else}
        <div class="mt-5 grid gap-4">
          {#each byokProviders as status (status.provider)}
            {@const provider = status.provider}
            <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="font-mono text-sm text-sophia-dark-text">{BYOK_PROVIDER_LABELS[provider]}</p>
                  <p class="mt-1 font-mono text-xs text-sophia-dark-muted">{BYOK_PROVIDER_HINTS[provider]}</p>
                </div>
                <div class="text-right font-mono text-xs">
                  <p class="text-sophia-dark-muted">Status</p>
                  <p class={status.status === 'active' ? 'text-sophia-dark-sage' : status.status === 'invalid' ? 'text-sophia-dark-copper' : 'text-sophia-dark-muted'}>
                    {getByokStatusLabel(status.status)}
                  </p>
                </div>
              </div>

              <div class="mt-3 grid gap-2 font-mono text-xs text-sophia-dark-muted sm:grid-cols-3">
                <p>Fingerprint: {status.fingerprint_last8 ? `...${status.fingerprint_last8}` : '—'}</p>
                <p>Validated: {formatDate(status.validated_at)}</p>
                <p>Updated: {formatDate(status.updated_at)}</p>
              </div>
              {#if status.last_error}
                <p class="mt-2 rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-2 font-mono text-xs text-sophia-dark-copper">
                  Last validation error: {status.last_error}
                </p>
              {/if}

              <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <input
                  class="rounded border border-sophia-dark-border bg-sophia-dark-surface px-3 py-2 font-mono text-sm"
                  type="password"
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
                <button
                  class="rounded border border-sophia-dark-sage px-3 py-2 font-mono text-xs text-sophia-dark-sage hover:bg-sophia-dark-sage/10 disabled:opacity-60"
                  onclick={() => saveByokKey(provider)}
                  disabled={byokSaving[provider]}
                >
                  {byokSaving[provider] ? 'Saving...' : 'Save key'}
                </button>
                <button
                  class="rounded border border-sophia-dark-blue px-3 py-2 font-mono text-xs text-sophia-dark-blue hover:bg-sophia-dark-blue/10 disabled:opacity-60"
                  onclick={() => validateByokKey(provider)}
                  disabled={byokSaving[provider] || !status.configured}
                >
                  Validate
                </button>
                <button
                  class="rounded border border-sophia-dark-copper px-3 py-2 font-mono text-xs text-sophia-dark-copper hover:bg-sophia-dark-copper/10 disabled:opacity-60"
                  onclick={() => revokeByokKey(provider)}
                  disabled={byokSaving[provider] || !status.configured}
                >
                  Revoke
                </button>
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
    </section>

    <section class="mb-8 rounded border border-sophia-dark-border bg-sophia-dark-surface p-6">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="font-serif text-2xl">Playground</h2>
        <div class="flex gap-2">
          <button
            class="rounded border px-3 py-1.5 font-mono text-xs {playgroundMode === 'json'
              ? 'border-sophia-dark-sage text-sophia-dark-sage'
              : 'border-sophia-dark-border text-sophia-dark-muted'}"
            onclick={() => (playgroundMode = 'json')}
            disabled={playgroundLoading}
          >
            JSON
          </button>
          <button
            class="rounded border px-3 py-1.5 font-mono text-xs {playgroundMode === 'sse'
              ? 'border-sophia-dark-sage text-sophia-dark-sage'
              : 'border-sophia-dark-border text-sophia-dark-muted'}"
            onclick={() => (playgroundMode = 'sse')}
            disabled={playgroundLoading}
          >
            SSE
          </button>
        </div>
      </div>

      <label class="mb-3 block">
        <span class="mb-2 block font-mono text-xs text-sophia-dark-muted">API KEY</span>
        <input
          class="w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm"
          type="password"
          bind:value={playgroundApiKey}
          placeholder="sk-sophia-..."
        />
      </label>

      <label class="mb-4 block">
        <span class="mb-2 block font-mono text-xs text-sophia-dark-muted">REQUEST BODY (JSON)</span>
        <textarea
          class="min-h-56 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-xs"
          bind:value={playgroundBody}
        ></textarea>
      </label>

      <button
        class="rounded border border-sophia-dark-blue px-4 py-2 font-mono text-sm text-sophia-dark-blue hover:bg-sophia-dark-blue/10 disabled:opacity-60"
        onclick={runPlayground}
        disabled={playgroundLoading}
      >
        {playgroundLoading ? 'Running...' : `Run ${playgroundMode.toUpperCase()} request`}
      </button>

      {#if playgroundError}
        <p class="mt-4 rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-3 font-mono text-xs text-sophia-dark-copper">
          {playgroundError}
        </p>
      {/if}

      {#if Object.keys(playgroundHeaders).length}
        <div class="mt-5 rounded border border-sophia-dark-border bg-sophia-dark-bg p-3">
          <p class="mb-2 font-mono text-xs text-sophia-dark-muted">RESPONSE HEADERS</p>
          <ul class="space-y-1 font-mono text-xs">
            {#each Object.entries(playgroundHeaders) as [key, value]}
              <li><span class="text-sophia-dark-muted">{key}:</span> {value}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if playgroundJsonResponse}
        <pre class="mt-5 overflow-x-auto rounded border border-sophia-dark-border bg-sophia-dark-bg p-4 text-xs"><code>{playgroundJsonResponse}</code></pre>
      {/if}

      {#if playgroundEvents.length}
        <div class="mt-5 space-y-2">
          <p class="font-mono text-xs text-sophia-dark-muted">SSE EVENTS ({playgroundEvents.length})</p>
          {#each playgroundEvents as event, idx}
            <details class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-3">
              <summary class="cursor-pointer font-mono text-xs text-sophia-dark-muted">Event #{idx + 1}</summary>
              <pre class="mt-2 overflow-x-auto font-mono text-xs"><code>{event}</code></pre>
            </details>
          {/each}
        </div>
      {/if}
    </section>

    <section class="grid gap-6 md:grid-cols-2">
      <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-6">
        <h2 class="font-serif text-2xl">My API Keys</h2>

        {#if !isSignedIn}
          <p class="mt-4 font-mono text-sm text-sophia-dark-muted">Sign in to manage API keys.</p>
        {:else if loadingAccountData}
          <p class="mt-4 font-mono text-sm text-sophia-dark-muted">Loading keys...</p>
        {:else}
          <div class="mt-4 grid gap-2">
            <input
              class="rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm"
              bind:value={newKeyName}
              placeholder="Key name"
            />
            <input
              class="rounded border border-sophia-dark-border bg-sophia-dark-bg px-3 py-2 font-mono text-sm"
              type="number"
              min="1"
              bind:value={newKeyQuota}
            />
            <button
              class="rounded border border-sophia-dark-sage px-4 py-2 font-mono text-sm text-sophia-dark-sage hover:bg-sophia-dark-sage/10"
              onclick={createKey}
            >
              Create key
            </button>
          </div>

          {#if newlyCreatedKey}
            <div class="mt-4 rounded border border-sophia-dark-blue/50 bg-sophia-dark-blue/10 p-3 font-mono text-xs text-sophia-dark-blue">
              Save this key now (shown once): <code>{newlyCreatedKey}</code>
            </div>
          {/if}

          <div class="mt-5 space-y-2">
            {#each keys as key}
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-3">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <p class="font-mono text-sm text-sophia-dark-text">{key.name}</p>
                    <p class="font-mono text-xs text-sophia-dark-muted">{key.key_prefix} • {key.active ? 'active' : 'revoked'}</p>
                    <p class="font-mono text-xs text-sophia-dark-muted">Used: {key.usage_count} total, {key.daily_count}/{key.daily_quota} today</p>
                    <p class="font-mono text-xs text-sophia-dark-muted">Last used: {formatDate(key.last_used_at)}</p>
                  </div>
                  {#if key.active}
                    <button
                      class="rounded border border-sophia-dark-copper px-2 py-1 font-mono text-xs text-sophia-dark-copper hover:bg-sophia-dark-copper/10"
                      onclick={() => revokeKey(key.key_id)}
                    >
                      Revoke
                    </button>
                  {/if}
                </div>
              </div>
            {:else}
              <p class="font-mono text-sm text-sophia-dark-muted">No keys yet.</p>
            {/each}
          </div>
        {/if}
      </div>

      <div class="rounded border border-sophia-dark-border bg-sophia-dark-surface p-6">
        <h2 class="font-serif text-2xl">Usage</h2>

        {#if !isSignedIn}
          <p class="mt-4 font-mono text-sm text-sophia-dark-muted">Sign in to view usage.</p>
        {:else if loadingAccountData}
          <p class="mt-4 font-mono text-sm text-sophia-dark-muted">Loading usage...</p>
        {:else if usage}
          <div class="mt-4 space-y-3 font-mono text-sm">
            <p>Total calls: <span class="text-sophia-dark-sage">{usage.totals.usage_count}</span></p>
            <p>Today: <span class="text-sophia-dark-sage">{usage.totals.daily_count}</span> / {usage.totals.daily_quota}</p>
            <p>Active keys: <span class="text-sophia-dark-sage">{usage.totals.active_keys}</span> / {usage.totals.total_keys}</p>
          </div>

          <div class="mt-5 space-y-2">
            {#each usage.keys as key}
              <div class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-3 font-mono text-xs text-sophia-dark-muted">
                <p class="text-sophia-dark-text">{key.name}</p>
                <p>{key.daily_count}/{key.daily_quota} today • reset {formatDate(key.daily_reset_at)}</p>
              </div>
            {/each}
          </div>
        {:else}
          <p class="mt-4 font-mono text-sm text-sophia-dark-muted">No usage data yet.</p>
        {/if}
      </div>
    </section>

    {#if accountError}
      <p class="mt-6 rounded border border-sophia-dark-copper/50 bg-sophia-dark-copper/10 p-3 font-mono text-xs text-sophia-dark-copper">
        {accountError}
      </p>
    {/if}
  </div>
</div>
