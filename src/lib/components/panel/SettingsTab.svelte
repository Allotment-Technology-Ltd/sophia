<script lang="ts">
  import { auth, signOutUser, onAuthChange, getIdToken } from '$lib/authClient';
  import { goto, replaceState } from '$app/navigation';
  import { browser } from '$app/environment';
  import {
    BYOK_PROVIDER_ORDER,
    PROVIDER_UI_META,
    type ByokProvider
  } from '$lib/types/providers';
  import { page } from '$app/state';

  interface ByokProviderStatus {
    provider: ByokProvider;
    configured: boolean;
    status: 'not_configured' | 'pending_validation' | 'active' | 'invalid' | 'revoked';
    fingerprint_last8: string | null;
    validated_at: string | null;
    updated_at: string | null;
    last_error: string | null;
  }

  interface BillingEntitlements {
    tier: 'free' | 'premium';
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';
    currency: 'GBP' | 'USD';
    monthKey: string;
    publicUsed: number;
    privateUsed: number;
    publicRemaining: number;
    privateRemaining: number;
    effectivePublicMax: number;
    privateMax: number;
    ownerIngestionUnlimited?: boolean;
  }

  interface BillingProfile {
    tier: 'free' | 'premium';
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';
    currency: 'GBP' | 'USD';
    paddle_customer_id?: string | null;
    paddle_subscription_id?: string | null;
    period_end_at?: string | null;
  }

  interface CheckoutPresentation {
    mode: 'redirect' | 'overlay' | 'inline';
    locale: string | null;
    theme: 'light' | 'dark' | null;
  }

  interface FounderOfferSummary {
    programId: string;
    slot: number;
    grantedAt: string;
    expiresAt: string;
    bonusWalletCents: number;
    noticePending: boolean;
    noticeSeenAt: string | null;
    active: boolean;
    limit: number;
    premiumMonths: number;
  }

  interface PrivateSource {
    id: string;
    title?: string;
    url?: string;
    source_type?: string;
    status?: string;
    claim_count?: number;
    updated_at?: string;
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

  let currentUser = $state(browser ? auth?.currentUser : null);
  let byokProviders = $state<ByokProviderStatus[]>([]);
  let byokInputs = $state<Record<ByokProvider, string>>(emptyProviderMap(''));
  let byokSaving = $state<Record<ByokProvider, boolean>>(emptyProviderMap(false));
  let byokLoading = $state(false);
  let byokError = $state('');
  let byokMessage = $state('');
  let billingLoading = $state(false);
  let billingBusyAction = $state('');
  let billingError = $state('');
  let billingMessage = $state('');
  let billingProfile = $state<BillingProfile | null>(null);
  let billingEntitlements = $state<BillingEntitlements | null>(null);
  let founderOffer = $state<FounderOfferSummary | null>(null);
  let billingCheckoutPresentation = $state<CheckoutPresentation | null>(null);
  let billingSyncing = $state(false);
  let hasBillingCustomer = $derived(Boolean(billingProfile?.paddle_customer_id?.trim()));
  let hasPaddleSubscription = $derived(Boolean(billingProfile?.paddle_subscription_id?.trim()));
  let currentTier = $derived((billingProfile?.tier ?? 'free') as 'free' | 'premium');
  let isPaidTier = $derived(currentTier !== 'free');
  let showBillingCustomerMappingWarning = $derived(
    isPaidTier && hasPaddleSubscription && !hasBillingCustomer
  );
  let privateSources = $state<PrivateSource[]>([]);
  let sourcesLoading = $state(false);
  let deletingSourceId = $state('');
  let sourcesError = $state('');
  let sourcesMessage = $state('');
  type SettingsSubTab = 'general' | 'byok' | 'sources' | 'payments';

  interface Props {
    initialSettingsTab?: SettingsSubTab;
  }

  let { initialSettingsTab = 'general' }: Props = $props();
  let activeSettingsTab = $state<SettingsSubTab>('general');
  const SETTINGS_REQUEST_TIMEOUT_MS = 12_000;

  function setActiveSettingsTab(tab: SettingsSubTab): void {
    activeSettingsTab = tab;
    if (!browser) return;
    const url = new URL(window.location.href);
    if (tab === 'general') {
      url.searchParams.delete('settingsTab');
    } else {
      url.searchParams.set('settingsTab', tab);
    }
    replaceState(url.toString(), page.state);
  }

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString();
  }

  function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = SETTINGS_REQUEST_TIMEOUT_MS): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    }) as Promise<T>;
  }

  async function fetchWithFirebase(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await withTimeout(
      getIdToken(),
      'Authentication timed out while preparing the request. Please retry.'
    );
    if (!token) {
      throw new Error('Sign in required.');
    }
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SETTINGS_REQUEST_TIMEOUT_MS);

    try {
      return await fetch(path, {
        ...init,
        headers,
        signal: controller.signal
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Request timed out while contacting the server. Please retry.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function parseResponseOrThrow(response: Response): Promise<any> {
    const text = await response.text();
    let body: any = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    if (!response.ok) {
      const detail = body?.detail || body?.error || body?.raw || response.statusText || 'Request failed';
      throw new Error(String(detail));
    }
    return body;
  }

  function mergeByokProviderFromResponse(provider: ByokProvider, patch: unknown): void {
    if (!patch || typeof patch !== 'object') return;
    const row = patch as Partial<ByokProviderStatus>;
    if (row.provider !== provider) return;
    byokProviders = byokProviders.map((s) => (s.provider === provider ? { ...s, ...row } : s));
  }

  async function refreshByokProviders(): Promise<void> {
    if (!currentUser) {
      byokProviders = [];
      byokError = '';
      byokMessage = '';
      return;
    }
    byokLoading = true;
    byokError = '';
    try {
      const response = await fetchWithFirebase('/api/byok/providers', { method: 'GET' });
      const body = await parseResponseOrThrow(response);
      const incoming = Array.isArray(body.providers) ? body.providers as ByokProviderStatus[] : [];
      byokProviders = incoming;
    } catch (err) {
      byokError = err instanceof Error ? err.message : String(err);
    } finally {
      byokLoading = false;
    }
  }

  function getByokStatusLabel(status: ByokProviderStatus['status']): string {
    if (status === 'active') return 'Active';
    if (status === 'pending_validation') return 'Pending validation';
    if (status === 'invalid') return 'Invalid key';
    if (status === 'revoked') return 'Revoked';
    return 'Not configured';
  }

  function setByokSaving(provider: ByokProvider, saving: boolean): void {
    byokSaving = {
      ...byokSaving,
      [provider]: saving
    };
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
      await refreshByokProviders();
      mergeByokProviderFromResponse(provider, body?.provider);
      const ok = body?.validation?.ok === true;
      byokMessage = ok
        ? `${BYOK_PROVIDER_LABELS[provider]} key saved and validated.`
        : `${BYOK_PROVIDER_LABELS[provider]} key saved but validation failed.`;
    } catch (err) {
      byokError = err instanceof Error ? err.message : String(err);
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
      await refreshByokProviders();
      mergeByokProviderFromResponse(provider, body?.provider);
      const ok = body?.validation?.ok === true;
      byokMessage = ok
        ? `${BYOK_PROVIDER_LABELS[provider]} credential is valid.`
        : `${BYOK_PROVIDER_LABELS[provider]} validation failed.`;
    } catch (err) {
      byokError = err instanceof Error ? err.message : String(err);
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
      await refreshByokProviders();
      byokMessage = `${BYOK_PROVIDER_LABELS[provider]} credential revoked.`;
    } catch (err) {
      byokError = err instanceof Error ? err.message : String(err);
    } finally {
      setByokSaving(provider, false);
    }
  }

  function formatMoneyFromCents(cents: number, currency: 'GBP' | 'USD'): string {
    const value = Math.max(0, cents) / 100;
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency
    }).format(value);
  }

  async function syncBillingFromProvider(silent = true): Promise<void> {
    try {
      const syncResponse = await fetchWithFirebase('/api/billing/sync', { method: 'POST' });
      await parseResponseOrThrow(syncResponse);
    } catch (err) {
      if (!silent) {
        throw err;
      }
    }
  }

  async function refreshBillingState(withProviderSync = false, silentSyncError = true): Promise<void> {
    if (!currentUser) {
      billingProfile = null;
      billingEntitlements = null;
      founderOffer = null;
      billingCheckoutPresentation = null;
      billingError = '';
      billingMessage = '';
      return;
    }
    billingLoading = true;
    billingError = '';
    try {
      if (withProviderSync) {
        await syncBillingFromProvider(silentSyncError);
      }
      const response = await fetchWithFirebase('/api/billing/entitlements', { method: 'GET' });
      const body = await parseResponseOrThrow(response);
      billingProfile = (body.profile ?? null) as BillingProfile | null;
      billingEntitlements = (body.entitlements ?? null) as BillingEntitlements | null;
      founderOffer = (body.founder_offer ?? null) as FounderOfferSummary | null;
      const checkoutPresentationRaw = (body.checkout_presentation ?? null) as
        | {
            mode?: 'redirect' | 'overlay' | 'inline';
            locale?: string | null;
            theme?: 'light' | 'dark' | null;
          }
        | null;
      billingCheckoutPresentation = checkoutPresentationRaw
        ? {
            mode:
              checkoutPresentationRaw.mode === 'inline' || checkoutPresentationRaw.mode === 'overlay'
                ? checkoutPresentationRaw.mode
                : 'redirect',
            locale:
              typeof checkoutPresentationRaw.locale === 'string' && checkoutPresentationRaw.locale.trim()
                ? checkoutPresentationRaw.locale.trim()
                : null,
            theme:
              checkoutPresentationRaw.theme === 'dark' || checkoutPresentationRaw.theme === 'light'
                ? checkoutPresentationRaw.theme
                : null
          }
        : null;
      if (browser) {
        window.dispatchEvent(new Event('billing:updated'));
      }
    } catch (err) {
      billingError = err instanceof Error ? err.message : String(err);
    } finally {
      billingLoading = false;
    }
  }


  async function beginSubscriptionCheckout(tier: 'premium'): Promise<void> {
    billingError = '';
    billingMessage = '';
    if (!browser) return;
    const destination = new URL('/pricing', window.location.origin);
    destination.searchParams.set('sophia_kind', 'subscription');
    destination.searchParams.set('sophia_plan', tier);
    await goto(destination.toString());
  }

  async function openBillingPortal(): Promise<void> {
    billingError = '';
    billingMessage = '';
    billingBusyAction = 'portal';
    try {
      const response = await fetchWithFirebase('/api/billing/portal', { method: 'POST' });
      const body = await parseResponseOrThrow(response);
      if (!body.portal_url || typeof body.portal_url !== 'string') {
        throw new Error('Missing portal URL from billing response.');
      }
      if (browser) {
        const popup = window.open(body.portal_url, '_blank', 'noopener,noreferrer');
        if (!popup) {
          window.location.href = body.portal_url;
        }
      }
    } catch (err) {
      billingError = err instanceof Error ? err.message : String(err);
    } finally {
      billingBusyAction = '';
    }
  }

  async function refreshBillingStateManual(): Promise<void> {
    billingSyncing = true;
    billingError = '';
    billingMessage = '';
    try {
      await refreshBillingState(true, false);
      billingMessage = 'Billing status refreshed.';
    } catch (err) {
      billingError = err instanceof Error ? err.message : String(err);
    } finally {
      billingSyncing = false;
    }
  }

  async function refreshPrivateSources(): Promise<void> {
    if (!currentUser) {
      privateSources = [];
      sourcesError = '';
      sourcesMessage = '';
      return;
    }
    sourcesLoading = true;
    sourcesError = '';
    try {
      const response = await fetchWithFirebase('/api/sources/private', { method: 'GET' });
      const body = await parseResponseOrThrow(response);
      const rows = Array.isArray(body.sources) ? (body.sources as unknown[]) : [];
      privateSources = rows.filter(
        (row: unknown): row is PrivateSource =>
          !!row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string'
      );
    } catch (err) {
      sourcesError = err instanceof Error ? err.message : String(err);
    } finally {
      sourcesLoading = false;
    }
  }

  async function deletePrivateSource(sourceId: string): Promise<void> {
    sourcesError = '';
    sourcesMessage = '';
    deletingSourceId = sourceId;
    try {
      const response = await fetchWithFirebase(`/api/sources/private/${encodeURIComponent(sourceId)}`, {
        method: 'DELETE'
      });
      await parseResponseOrThrow(response);
      sourcesMessage = 'Private source deleted.';
      await refreshPrivateSources();
    } catch (err) {
      sourcesError = err instanceof Error ? err.message : String(err);
    } finally {
      deletingSourceId = '';
    }
  }

  if (browser) {
    onAuthChange((user) => {
      currentUser = user;
      void refreshByokProviders();
      void refreshBillingState(true, true);
      void refreshPrivateSources();
    });
    void refreshByokProviders();
    void refreshBillingState(true, true);
    void refreshPrivateSources();
  }

  async function handleSignOut() {
    await signOutUser();
    goto('/');
  }

  // Reduce Motion reads system preference and adds a CSS class to <html>
  let prefersReducedMotion = $state(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  // Presence Mode is a placeholder — no behaviour yet
  let presenceMode = $state(false);

  $effect(() => {
    if (typeof document === 'undefined') return;
    if (prefersReducedMotion) {
      document.documentElement.classList.add('reduce-motion');
    } else {
      document.documentElement.classList.remove('reduce-motion');
    }
  });

  // Keep in sync with system preference changes
  $effect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => { prefersReducedMotion = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  $effect(() => {
    if (
      initialSettingsTab === 'general' ||
      initialSettingsTab === 'byok' ||
      initialSettingsTab === 'sources' ||
      initialSettingsTab === 'payments'
    ) {
      activeSettingsTab = initialSettingsTab;
    }
  });
</script>

<div class="settings-tab">
  <div class="settings-subtabs" role="tablist" aria-label="Settings sections">
    <button
      class="settings-subtab"
      class:is-active={activeSettingsTab === 'general'}
      role="tab"
      aria-selected={activeSettingsTab === 'general'}
      onclick={() => setActiveSettingsTab('general')}
    >
      General
    </button>
    <button
      class="settings-subtab"
      class:is-active={activeSettingsTab === 'byok'}
      role="tab"
      aria-selected={activeSettingsTab === 'byok'}
      onclick={() => setActiveSettingsTab('byok')}
    >
      BYOK
    </button>
    <button
      class="settings-subtab"
      class:is-active={activeSettingsTab === 'payments'}
      role="tab"
      aria-selected={activeSettingsTab === 'payments'}
      onclick={() => setActiveSettingsTab('payments')}
    >
      Payments
    </button>
    <button
      class="settings-subtab"
      class:is-active={activeSettingsTab === 'sources'}
      role="tab"
      aria-selected={activeSettingsTab === 'sources'}
      onclick={() => setActiveSettingsTab('sources')}
    >
      Sources
    </button>
  </div>

  {#if activeSettingsTab === 'general'}
    <p class="settings-section-label">Appearance</p>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Reduce Motion</span>
        <span class="setting-desc">Suppress animations and transitions</span>
      </div>
      <button
        class="toggle"
        class:is-on={prefersReducedMotion}
        role="switch"
        aria-checked={prefersReducedMotion}
        aria-label="Reduce motion"
        onclick={() => (prefersReducedMotion = !prefersReducedMotion)}
      >
        <span class="toggle-knob" aria-hidden="true"></span>
      </button>
    </div>

    <p class="settings-section-label">Experimental</p>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Presence Mode</span>
        <span class="setting-desc">Placeholder — not yet active</span>
      </div>
      <button
        class="toggle"
        class:is-on={presenceMode}
        role="switch"
        aria-checked={presenceMode}
        aria-label="Presence mode"
        onclick={() => (presenceMode = !presenceMode)}
      >
        <span class="toggle-knob" aria-hidden="true"></span>
      </button>
    </div>

    <p class="settings-section-label">Account</p>

    {#if currentUser}
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">{currentUser.displayName ?? currentUser.email ?? 'Signed in'}</span>
          <span class="setting-desc">{currentUser.email ?? ''}</span>
        </div>
      </div>
      <div class="setting-row">
        <button class="sign-out-btn" onclick={handleSignOut}>
          Sign out
        </button>
      </div>
    {:else}
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Not signed in</span>
          <span class="setting-desc">Sign in to manage account, BYOK, and payments.</span>
        </div>
      </div>
    {/if}
  {:else if activeSettingsTab === 'byok'}
    <p class="settings-section-label">BYOK (Bring Your Own Key)</p>
    <div class="byok-journey">
      <p class="byok-journey-title">How to use BYOK</p>
      <ol>
        <li>Add or remove provider keys in the Restormel Key Manager.</li>
        <li>Review status badges, validation timestamps, and inline errors directly in the key detail view.</li>
        <li>Use your own provider account through BYOK with no SOPHIA metered surcharge.</li>
      </ol>
      <p>
        BYOK lets you route runs through your own provider account while SOPHIA manages reasoning
        flow and orchestration.
      </p>
    </div>

    {#if !currentUser}
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Sign in required</span>
          <span class="setting-desc">Sign in to configure model provider keys.</span>
        </div>
      </div>
    {:else if byokLoading && byokProviders.length === 0}
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Loading provider status...</span>
        </div>
      </div>
    {:else if byokError && byokProviders.length === 0}
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Unable to load BYOK provider status</span>
          <span class="setting-desc">Retry below. If this persists locally, verify auth/session and backend connectivity.</span>
        </div>
      </div>
    {:else if byokProviders.length === 0}
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">No BYOK providers returned</span>
          <span class="setting-desc">Providers should be available by default. Retry status refresh and check server health if this persists.</span>
        </div>
      </div>
    {:else}
      <div class="byok-native-shell">
        <div class="setting-info">
          <span class="setting-name">Manage provider credentials</span>
          <span class="setting-desc">
            Credentials stay in Sophia custody and are validated through Sophia&apos;s server-side BYOK endpoints.
          </span>
        </div>

        <div class="byok-provider-grid">
          {#each byokProviders as status (status.provider)}
            {@const provider = status.provider}
            <div class="byok-provider-card">
              <div class="byok-provider-head">
                <div class="setting-info">
                  <span class="setting-name byok-provider-name">{BYOK_PROVIDER_LABELS[provider]}</span>
                  <span class="setting-desc">{BYOK_PROVIDER_HINTS[provider]}</span>
                </div>
                <span
                  class="byok-status-badge"
                  class:is-active={status.status === 'active'}
                  class:is-invalid={status.status === 'invalid'}
                >
                  {getByokStatusLabel(status.status)}
                </span>
              </div>

              <div class="byok-provider-meta">
                <span>Fingerprint: {status.fingerprint_last8 ? `...${status.fingerprint_last8}` : '—'}</span>
                <span>Validated: {formatDate(status.validated_at)}</span>
                <span>Updated: {formatDate(status.updated_at)}</span>
              </div>

              {#if status.last_error}
                <p class="byok-message error byok-inline-error">
                  Last validation error: {status.last_error}
                </p>
              {/if}

              <div class="byok-provider-actions">
                <input
                  class="byok-input"
                  type="password"
                  placeholder={BYOK_PROVIDER_PLACEHOLDERS[provider]}
                  autocomplete="off"
                  value={byokInputs[provider]}
                  oninput={(event) => {
                    byokInputs = {
                      ...byokInputs,
                      [provider]: (event.currentTarget as HTMLInputElement).value
                    };
                  }}
                  disabled={byokSaving[provider]}
                />
                <div class="byok-provider-action-buttons">
                  <button
                    class="byok-btn"
                    type="button"
                    onclick={() => saveByokKey(provider)}
                    disabled={byokSaving[provider]}
                  >
                    {byokSaving[provider] ? 'Saving...' : 'Save key'}
                  </button>
                  <button
                    class="byok-btn secondary"
                    type="button"
                    onclick={() => validateByokKey(provider)}
                    disabled={byokSaving[provider] || !status.configured}
                  >
                    Validate
                  </button>
                  <button
                    class="byok-btn danger"
                    type="button"
                    onclick={() => revokeByokKey(provider)}
                    disabled={byokSaving[provider] || !status.configured}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if byokMessage}
      <p class="byok-message success">{byokMessage}</p>
    {/if}
    {#if byokError}
      <div class="byok-feedback">
        <p class="byok-message error">{byokError}</p>
        <button class="byok-btn secondary" type="button" onclick={() => void refreshByokProviders()}>
          Retry BYOK status
        </button>
      </div>
    {/if}
  {:else if activeSettingsTab === 'payments'}
    <p class="settings-section-label">Payments</p>
    <div class="byok-journey">
      <p class="byok-journey-title">Simple Subscription</p>
      <p>
        SOPHIA billing now has two tiers only: Free and Premium. BYOK usage does not require wallet
        top-ups or metered handling fees.
      </p>
    </div>

    {#if !currentUser}
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Sign in required</span>
          <span class="setting-desc">Sign in to manage your subscription.</span>
        </div>
      </div>
    {:else if billingLoading && !billingProfile}
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Loading billing status...</span>
        </div>
      </div>
    {:else}
      <div class="billing-card">
        <div class="setting-info">
          <span class="setting-name">
            Plan: {billingProfile?.tier ?? 'free'} ({billingProfile?.status ?? 'inactive'})
          </span>
          {#if founderOffer}
            <span class="setting-desc founder-status">
              Founder offer #{founderOffer.slot}/{founderOffer.limit} ·
              {founderOffer.active
                ? `Premium included until ${formatDate(founderOffer.expiresAt)}`
                : `Founder access ended ${formatDate(founderOffer.expiresAt)}`}
            </span>
            <span class="setting-desc founder-status">
              Bonus credit: {formatMoneyFromCents(founderOffer.bonusWalletCents, 'GBP')}
            </span>
          {/if}
          <span class="setting-desc billing-purpose">
            Free and Premium tiers include source ingestion limits. BYOK keys are managed separately.
          </span>
          {#if billingEntitlements}
            <span class="setting-desc">
              {#if billingEntitlements.ownerIngestionUnlimited}
                Ingestion: no monthly cap (owner).
              {:else}
                Ingestion remaining this month: public {billingEntitlements.publicRemaining}, private {billingEntitlements.privateRemaining}
              {/if}
            </span>
          {/if}
        </div>

        <div class="billing-actions">
          {#if founderOffer?.active}
            <button
              class="byok-btn"
              disabled
              title="Founder access already includes Premium."
            >
              Founder access includes Premium
            </button>
          {:else if !isPaidTier}
            <button
              class="byok-btn"
              onclick={() => beginSubscriptionCheckout('premium')}
              disabled={billingBusyAction !== '' || currentTier === 'premium'}
            >
              {billingBusyAction === 'checkout:premium' ? 'Opening...' : 'Upgrade to Premium'}
            </button>
          {/if}
          {#if founderOffer?.active}
            <button
              class="byok-btn secondary"
              disabled
              title="Founder access is managed in-app and does not create a Paddle subscription."
            >
              No Paddle subscription (founder access)
            </button>
          {:else}
            <button
              class="byok-btn secondary"
              onclick={openBillingPortal}
              disabled={billingBusyAction !== '' || !hasBillingCustomer}
              title={!hasBillingCustomer ? 'Subscription management becomes available once billing customer mapping completes.' : undefined}
            >
              {billingBusyAction === 'portal'
                ? 'Opening...'
                : isPaidTier
                  ? 'Manage subscription (change plan)'
                  : 'Manage subscription'}
            </button>
          {/if}
          <button
            class="byok-btn secondary"
            onclick={refreshBillingStateManual}
            disabled={billingBusyAction !== '' || billingSyncing}
          >
            {billingSyncing ? 'Refreshing...' : 'Refresh billing status'}
          </button>
        </div>
        {#if showBillingCustomerMappingWarning}
          <p class="billing-warning">
            Your plan appears paid, but customer mapping is missing. Use “Refresh billing status” and check webhook delivery.
          </p>
        {/if}
      </div>
    {/if}

    {#if billingMessage}
      <p class="byok-message success">{billingMessage}</p>
    {/if}
    {#if billingError}
      <p class="byok-message error">{billingError}</p>
    {/if}
  {:else}
    <p class="settings-section-label">Private Sources</p>

    {#if !currentUser}
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Sign in required</span>
          <span class="setting-desc">Sign in to manage your private ingested sources.</span>
        </div>
      </div>
    {:else}
      <div class="sources-card">
        <div class="sources-head">
          <div class="setting-info">
            <span class="setting-name">Your private knowledge sources</span>
            <span class="setting-desc">Only you can query these sources. Deleting removes source-linked graph data.</span>
          </div>
          <button
            class="byok-btn secondary"
            onclick={refreshPrivateSources}
            disabled={sourcesLoading || deletingSourceId !== ''}
          >
            {sourcesLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {#if sourcesLoading && privateSources.length === 0}
          <p class="setting-desc">Loading sources...</p>
        {:else if privateSources.length === 0}
          <p class="setting-desc">No private sources found.</p>
        {:else}
          <div class="sources-list">
            {#each privateSources as source (source.id)}
              <div class="source-row">
                <div class="source-meta">
                  <span class="setting-name">{source.title || source.url || source.id}</span>
                  <span class="setting-desc">
                    {source.source_type || 'source'} · claims {source.claim_count ?? 0} · status {source.status || 'active'}
                  </span>
                  {#if source.url}
                    <a class="source-link" href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a>
                  {/if}
                </div>
                <button
                  class="byok-btn danger"
                  onclick={() => deletePrivateSource(source.id)}
                  disabled={deletingSourceId !== '' || sourcesLoading}
                >
                  {deletingSourceId === source.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if sourcesMessage}
        <p class="byok-message success">{sourcesMessage}</p>
      {/if}
      {#if sourcesError}
        <p class="byok-message error">{sourcesError}</p>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .settings-tab {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .settings-subtabs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    margin-bottom: var(--space-3);
  }

  .settings-subtab {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--color-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 7px 8px;
    cursor: pointer;
    transition: color var(--transition-base), border-color var(--transition-base), background var(--transition-base);
  }

  .settings-subtab:hover {
    color: var(--color-text);
  }

  .settings-subtab.is-active {
    color: var(--color-text);
    border-color: var(--color-sage-border);
    background: color-mix(in srgb, var(--color-sage) 10%, transparent);
  }

  .settings-section-label {
    font-family: var(--font-ui);
    font-size: var(--text-label);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-muted);
    margin: 0 0 var(--space-2);
    padding-top: var(--space-4);
  }

  .settings-section-label:first-child {
    padding-top: 0;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border);
  }

  .setting-row:last-child {
    border-bottom: none;
  }

  .byok-journey {
    display: grid;
    gap: 8px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: color-mix(in srgb, var(--color-surface-raised) 72%, transparent);
    padding: 10px;
    margin: 0 0 12px;
  }

  .byok-journey-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text);
  }

  .byok-journey p {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    line-height: 1.4;
    color: var(--color-muted);
  }

  .byok-journey ol {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 4px;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--color-muted);
  }

  .byok-journey-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .byok-native-shell {
    display: grid;
    gap: 12px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: color-mix(in srgb, var(--color-surface-raised) 68%, transparent);
    padding: 12px;
    margin: 0 0 12px;
  }

  .byok-provider-grid {
    display: grid;
    gap: 10px;
  }

  .byok-provider-card {
    display: grid;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: color-mix(in srgb, var(--color-surface) 82%, transparent);
  }

  .byok-provider-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
  }

  .byok-provider-name {
    font-size: 1rem;
  }

  .byok-status-badge {
    flex-shrink: 0;
    font-family: var(--font-ui);
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 4px 7px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    color: var(--color-muted);
    background: transparent;
  }

  .byok-status-badge.is-active {
    border-color: var(--color-sage-border);
    color: var(--color-sage);
    background: color-mix(in srgb, var(--color-sage) 10%, transparent);
  }

  .byok-status-badge.is-invalid {
    border-color: color-mix(in srgb, var(--color-warning, #e07070) 45%, transparent);
    color: var(--color-warning, #e07070);
    background: color-mix(in srgb, var(--color-warning, #e07070) 10%, transparent);
  }

  .byok-provider-meta {
    display: grid;
    gap: 4px;
    font-family: var(--font-ui);
    font-size: 0.66rem;
    color: var(--color-muted);
  }

  .byok-provider-actions {
    display: grid;
    gap: 10px;
    align-items: stretch;
  }

  .byok-provider-action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .byok-input {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-surface);
    color: var(--color-text);
    padding: 8px 10px;
    font-family: var(--font-ui);
    font-size: 0.78rem;
  }

  .byok-input:disabled {
    opacity: 0.6;
  }

  .byok-inline-error {
    margin: 0;
  }

  .billing-card {
    display: grid;
    gap: 12px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 12px;
    margin: 0 0 12px;
    background: var(--color-surface);
  }

  .billing-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .billing-actions-note {
    width: 100%;
    margin: 2px 0 4px;
    font-size: 0.72rem;
    color: var(--color-muted);
    line-height: 1.35;
  }

  .billing-purpose {
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  .founder-status {
    color: var(--color-sage);
    line-height: 1.4;
  }

  .sources-card {
    display: grid;
    gap: 10px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 12px;
    margin: 0 0 12px;
    background: var(--color-surface);
  }

  .sources-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 8px;
  }

  .sources-list {
    display: grid;
    gap: 8px;
  }

  .source-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 10px;
    background: color-mix(in srgb, var(--color-surface) 80%, transparent);
  }

  .source-meta {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .source-link {
    font-size: 0.66rem;
    color: var(--color-blue);
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  .source-link:hover {
    text-decoration: underline;
  }

  @media (max-width: 860px) {
    .settings-subtabs {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .byok-provider-head,
    .source-row {
      flex-direction: column;
      align-items: stretch;
    }
    .byok-provider-action-buttons {
      flex-direction: column;
      align-items: stretch;
    }

    .byok-provider-action-buttons .byok-btn {
      width: 100%;
      text-align: center;
    }
    .sources-head {
      flex-direction: column;
      align-items: stretch;
    }
  }

  .billing-warning {
    margin: 0;
    padding: 8px 10px;
    border: 1px solid rgba(215, 124, 84, 0.5);
    border-radius: 4px;
    color: #f0c0aa;
    background: rgba(215, 124, 84, 0.12);
    font-size: 0.72rem;
    line-height: 1.35;
  }

  .byok-btn {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    border: 1px solid var(--color-sage-border);
    color: var(--color-sage);
    background: transparent;
    border-radius: 3px;
    padding: 5px 8px;
    cursor: pointer;
  }

  .byok-btn.secondary {
    border-color: var(--color-blue-border, var(--color-border));
    color: var(--color-blue);
  }

  .byok-btn.danger {
    border-color: var(--color-warning, #e07070);
    color: var(--color-warning, #e07070);
  }

  .byok-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .byok-message {
    margin: 0 0 10px;
    font-family: var(--font-ui);
    font-size: 0.66rem;
    line-height: 1.35;
    border-radius: 3px;
    padding: 7px 8px;
    border: 1px solid var(--color-border);
  }

  .byok-message.success {
    color: var(--color-blue);
    background: color-mix(in srgb, var(--color-blue) 10%, transparent);
  }

  .byok-message.error {
    color: var(--color-warning, #e07070);
    background: color-mix(in srgb, var(--color-warning, #e07070) 10%, transparent);
  }

  .byok-feedback {
    display: grid;
    gap: 8px;
    justify-items: start;
    margin-bottom: 10px;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .setting-name {
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: var(--text-body);
    color: var(--color-text);
  }

  .setting-desc {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }

  /* Toggle switch */
  .toggle {
    position: relative;
    width: 40px;
    height: 24px;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: 100px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--transition-base), border-color var(--transition-base);
    padding: 0;
  }

  .toggle.is-on {
    background: var(--color-sage-bg);
    border-color: var(--color-sage-border);
  }

  .toggle-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    background: var(--color-dim);
    border-radius: 50%;
    transition: transform var(--transition-base), background var(--transition-base);
  }

  .toggle.is-on .toggle-knob {
    transform: translateX(16px);
    background: var(--color-sage);
  }

  .sign-out-btn {
    font-family: var(--font-ui);
    font-size: var(--text-body);
    color: var(--color-warning, #e07070);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }

  .sign-out-btn:hover {
    text-decoration: underline;
  }

  /* ── Reduced Motion: suppress toggle transitions ── */
  :global(html.reduce-motion) .toggle {
    transition: none !important;
  }

  :global(html.reduce-motion) .toggle-knob {
    transition: none !important;
  }

  :global(html.reduce-motion) .settings-subtab {
    transition: none !important;
  }
</style>
