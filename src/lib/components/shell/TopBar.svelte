<script lang="ts">
  import { auth, signOutUser, onAuthChange, getIdToken } from '$lib/authClient';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { env as publicEnv } from '$env/dynamic/public';
  import { onMount } from 'svelte';
  import DialecticalTriangle from '$lib/components/DialecticalTriangle.svelte';

  interface Props {
    contextQuery?: string;
    streamingPass?: string;
    streamingModel?: string;
    menuDotVisible?: boolean;
    panelOpen?: boolean;
    onMenuToggle?: () => void;
    onNew?: () => void;
  }

  let { contextQuery, streamingPass, streamingModel, menuDotVisible, panelOpen = false, onMenuToggle, onNew }: Props = $props();

  let currentUser = $state(browser ? auth?.currentUser ?? null : null);
  let billingTier = $state<'free' | 'premium' | null>(null);
  let founderActive = $state(false);
  let showAdminNav = $state(false);
  let userMenuOpen = $state(false);
  const learnEnabled = (publicEnv.PUBLIC_ENABLE_LEARN_MODULE ?? 'false').toLowerCase() === 'true';

  async function refreshBillingTier(): Promise<void> {
    if (!browser || !currentUser) {
      billingTier = null;
      founderActive = false;
      return;
    }
    try {
      const token = await getIdToken();
      if (!token) {
        billingTier = null;
        founderActive = false;
        return;
      }
      const response = await fetch('/api/billing/entitlements', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        billingTier = null;
        founderActive = false;
        return;
      }
      const body = (await response.json()) as {
        profile?: { tier?: 'free' | 'premium' };
        effective_tier?: 'free' | 'premium';
        founder_offer?: { active?: boolean } | null;
      };
      const tier = body.effective_tier ?? body?.profile?.tier;
      billingTier = tier === 'premium' || tier === 'free' ? tier : 'free';
      founderActive = body?.founder_offer?.active === true;
    } catch {
      billingTier = null;
      founderActive = false;
    }
  }

  async function refreshOwnerAdminNav(): Promise<void> {
    if (!browser || !currentUser) {
      showAdminNav = false;
      return;
    }
    try {
      const token = await getIdToken();
      if (!token) {
        showAdminNav = false;
        return;
      }
      const response = await fetch('/api/admin/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        showAdminNav = false;
        return;
      }
      const body = (await response.json()) as { is_owner?: boolean };
      showAdminNav = body.is_owner === true;
    } catch {
      showAdminNav = false;
    }
  }

  if (browser) {
    onAuthChange((user) => {
      currentUser = user;
      void refreshBillingTier();
      void refreshOwnerAdminNav();
    });
    void refreshBillingTier();
    void refreshOwnerAdminNav();
  }

  onMount(() => {
    if (!browser) return;
    const refresh = () => {
      void refreshBillingTier();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('billing:updated', refresh as EventListener);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('billing:updated', refresh as EventListener);
    };
  });

  async function handleSignOut() {
    try {
      await signOutUser();
      userMenuOpen = false;
      await goto('/');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }
</script>

<a href="#main" class="skip-link">Skip to content</a>

<nav class="top-bar" aria-label="Main navigation">
  <!-- Left: wordmark -->
  <a href="/home" class="wordmark" aria-label="SOPHIA home">
    <DialecticalTriangle mode="logo" size={22} />
    <span class="wordmark-text">SOPHIA</span>
  </a>

  <div class="mode-links" aria-label="App sections">
    <a href="/home" class="mode-link" aria-current={$page.url.pathname.startsWith('/home') ? 'page' : undefined}>Mode</a>
    {#if learnEnabled}
      <a href="/learn" class="mode-link" aria-current={$page.url.pathname.startsWith('/learn') ? 'page' : undefined}>Learn</a>
    {/if}
    {#if showAdminNav}
      <a href="/admin" class="mode-link" aria-current={$page.url.pathname.startsWith('/admin') ? 'page' : undefined}>Admin</a>
    {/if}
  </div>

  <!-- Centre: context query (results / loading screens only) -->
  {#if contextQuery}
    <div class="context-display" aria-live="polite">
      <span class="context-query">{contextQuery}</span>
      {#if streamingPass}
        <span class="streaming-status" aria-label="Status: {streamingPass}">
          <span class="streaming-dot" aria-hidden="true"></span>
          {streamingPass}
          {#if streamingModel}
            <span class="streaming-model">· {streamingModel}</span>
          {/if}
        </span>
      {/if}
    </div>
  {/if}

  <!-- Right: actions -->
  <div class="nav-actions">
    <button class="nav-btn-ghost" onclick={onNew} aria-label="New conversation">
      + New Inquiry
    </button>

    {#if currentUser}
      <span class="plan-badge" aria-label="Current subscription tier">
        {founderActive ? 'FOUNDER' : (billingTier ?? 'free').toUpperCase()}
      </span>
    {/if}

    <!-- User profile dropdown -->
    {#if currentUser}
      <div class="user-profile">
        <button
          class="user-button"
          onclick={() => userMenuOpen = !userMenuOpen}
          aria-label="User menu"
          aria-expanded={userMenuOpen}
        >
          {#if currentUser.photoURL}
            <img src={currentUser.photoURL} alt="" class="user-avatar" referrerpolicy="no-referrer" />
          {:else}
            <div class="user-avatar-fallback">{currentUser.displayName?.[0] ?? '?'}</div>
          {/if}
        </button>

        {#if userMenuOpen}
          <div class="user-dropdown" role="menu">
            <div class="user-info">
              <div class="user-name">{currentUser.displayName}</div>
              <div class="user-email">{currentUser.email}</div>
            </div>
            {#if showAdminNav}
              <a class="dropdown-item" href="/admin" role="menuitem">
                Admin
              </a>
            {/if}
            <button class="dropdown-item" onclick={handleSignOut} role="menuitem">
              Sign out
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Panel toggle -->
    <button
      class="panel-toggle"
      aria-label="Toggle panel"
      aria-expanded={panelOpen}
      aria-controls="side-panel"
      onclick={onMenuToggle}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1" y="3" width="14" height="1" rx="0.5" fill="currentColor"/>
        <rect x="1" y="7.5" width="14" height="1" rx="0.5" fill="currentColor"/>
        <rect x="1" y="12" width="14" height="1" rx="0.5" fill="currentColor"/>
      </svg>
      {#if menuDotVisible}
        <span class="menu-dot" aria-hidden="true"></span>
      {/if}
    </button>
  </div>
</nav>

<style>
  .skip-link {
    position: absolute;
    top: -100%;
    left: var(--space-3);
    z-index: 9999;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    text-decoration: none;
  }

  .skip-link:focus {
    top: var(--space-2);
  }

  .top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--nav-height);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: 0 var(--space-4);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }

  /* Wordmark */
  .wordmark {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    flex-shrink: 0;
  }

  .mode-links {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-right: auto;
    margin-left: 10px;
  }

  .mode-link {
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-muted);
    text-decoration: none;
    padding: 4px 6px;
    border-radius: 6px;
    border: 1px solid transparent;
  }

  .mode-link:hover,
  .mode-link[aria-current='page'] {
    color: var(--color-text);
    border-color: var(--color-border);
    background: var(--color-surface-raised);
  }

  .wordmark-text {
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 1.1rem;
    letter-spacing: 0.08em;
    color: var(--color-text);
    line-height: 1;
  }

  /* Context display */
  .context-display {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    flex: 1;
    justify-content: center;
  }

  .context-query {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 0.85rem;
    color: var(--color-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 400px;
  }

  .streaming-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-sage);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .streaming-model {
    color: var(--color-muted);
  }

  .streaming-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    animation: symbolBreathe 2s ease-in-out infinite;
  }

  /* Nav actions */
  .nav-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
  }

  /* + New Inquiry ghost button */
  .nav-btn-ghost {
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--color-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 2px;
    padding: 6px 14px;
    cursor: pointer;
    transition: border-color var(--transition-fast), color var(--transition-fast);
  }

  .nav-btn-ghost:hover {
    border-color: var(--color-dim);
    color: var(--color-text);
  }

  .plan-badge {
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-sage);
    border: 1px solid var(--color-sage-border);
    border-radius: 999px;
    padding: 4px 10px;
    background: color-mix(in srgb, var(--color-sage) 10%, transparent);
  }

  /* Panel toggle */
  .panel-toggle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    color: var(--color-muted);
    transition: color var(--transition-fast);
  }

  .panel-toggle:hover {
    color: var(--color-muted);
  }

  .menu-dot {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-sage);
    animation: symbolBreathe 2s ease-in-out infinite;
  }

  /* User profile */
  .user-profile {
    position: relative;
  }

  .user-button {
    display: flex;
    align-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid var(--color-border);
    background: none;
    cursor: pointer;
    padding: 0;
    overflow: hidden;
    transition: border-color var(--transition-fast);
  }

  .user-button:hover {
    border-color: var(--color-dim);
  }

  .user-avatar,
  .user-avatar-fallback {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 400;
    font-size: 0.75rem;
    background: var(--color-sage-bg);
    color: var(--color-sage);
  }

  .user-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: var(--space-2);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    min-width: 220px;
    z-index: 1000;
  }

  .user-info {
    padding: var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }

  .user-name {
    font-family: var(--font-display);
    font-size: 0.9rem;
    font-weight: 400;
    color: var(--color-text);
  }

  .user-email {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-muted);
    margin-top: 2px;
  }

  .dropdown-item {
    display: block;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: var(--text-label);
    color: var(--color-muted);
    transition: color var(--transition-fast);
  }

  .dropdown-item:hover {
    color: var(--color-text);
  }

  @media (max-width: 1100px) {
    .context-display {
      display: none;
    }
  }

  @media (max-width: 920px) {
    .top-bar {
      gap: var(--space-2);
      padding: 0 var(--space-2);
    }

    .mode-links {
      display: none;
    }

    .nav-actions {
      margin-left: auto;
      gap: var(--space-2);
    }

    .nav-btn-ghost,
    .plan-badge {
      display: none;
    }

    .panel-toggle {
      color: var(--color-text);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: var(--color-surface-raised);
    }
  }

  @media (max-width: 767px) {
    .context-query {
      max-width: 140px;
    }

    .wordmark-text {
      font-size: 1rem;
      letter-spacing: 0.06em;
    }

    .user-button {
      width: 28px;
      height: 28px;
    }
  }

  @media (max-width: 420px) {
    .user-profile {
      display: none;
    }
  }
</style>
