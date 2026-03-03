<script lang="ts">
  import { auth, signOutUser, onAuthChange } from '$lib/firebase';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';

  interface Props {
    contextQuery?: string;      // Current question shown centred on results/loading screens
    streamingPass?: string;     // e.g. 'Pass 1 of 3' — shown right of contextQuery when loading
    menuDotVisible?: boolean;   // Shows live dot on panel toggle when references are streaming
    panelOpen?: boolean;        // Current panel open state (for aria-expanded)
    onMenuToggle?: () => void;  // Fires when panel toggle / hamburger is tapped
    onNew?: () => void;         // Fires when + New is tapped
  }

  let { contextQuery, streamingPass, menuDotVisible, panelOpen = false, onMenuToggle, onNew }: Props = $props();

  let currentUser = $state(browser ? auth?.currentUser ?? null : null);
  let userMenuOpen = $state(false);

  if (browser) {
    onAuthChange((user) => { currentUser = user; });
  }

  async function handleSignOut() {
    try {
      await signOutUser();
      userMenuOpen = false;
      await goto('/auth');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }
</script>

<a href="#main" class="skip-link">Skip to content</a>

<nav
  class="top-bar"
  aria-label="Main navigation"
>
  <!-- Left: wordmark -->
  <a href="/" class="wordmark" aria-label="SOPHIA home">
    <!-- Circular brand mark — matches favicon.svg -->
    <svg
      class="wordmark-mark"
      viewBox="0 0 32 32"
      width="18"
      height="18"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="16" cy="16" r="13" stroke="var(--color-sage)" stroke-width="1.5"/>
      <path d="M 9 11 A 9 9 0 0 1 23 11" stroke="var(--color-copper)" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M 23 21 A 9 9 0 0 1 9 21" stroke="var(--color-blue)" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="16" cy="16" r="2" fill="var(--color-sage)"/>
    </svg>
    <span class="wordmark-text">SOPHIA</span>
  </a>

  <!-- Centre: context query (results / loading screens only) -->
  {#if contextQuery}
    <div class="context-display" aria-live="polite">
      <span class="context-query">{contextQuery}</span>
      {#if streamingPass}
        <span class="streaming-status" aria-label="Status: {streamingPass}">
          <span class="streaming-dot" aria-hidden="true">●</span>
          {streamingPass}
        </span>
      {/if}
    </div>
  {/if}

  <!-- Right: actions -->
  <div class="nav-actions">
    <!-- Desktop: + New button -->
    <button class="nav-btn desktop-only" onclick={onNew} aria-label="New conversation">
      + New
    </button>

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
            <button
              class="dropdown-item"
              onclick={handleSignOut}
              role="menuitem"
            >
              Sign out
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Desktop: panel toggle -->
    <button
      class="panel-toggle desktop-only"
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

    <!-- Mobile: hamburger -->
    <button
      class="menu-toggle mobile-only"
      aria-label="Open menu"
      aria-expanded={panelOpen}
      aria-controls="side-panel"
      onclick={onMenuToggle}
    >
      <span class="hamburger-bar" aria-hidden="true"></span>
      <span class="hamburger-bar" aria-hidden="true"></span>
      <span class="hamburger-bar" aria-hidden="true"></span>
      {#if menuDotVisible}
        <span class="menu-dot" aria-hidden="true"></span>
      {/if}
    </button>
  </div>
</nav>

<style>
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
    gap: var(--space-2);
    text-decoration: none;
    flex-shrink: 0;
  }

  .wordmark-mark {
    color: var(--color-sage);
    flex-shrink: 0;
  }

  .wordmark-text {
    font-family: var(--font-display);
    font-weight: 300;
    font-size: 1.3rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--color-text);
    line-height: 1;
  }

  /* Context display (results / loading) */
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
    gap: 5px;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-sage);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .streaming-dot {
    font-size: 0.5rem;
    animation: symbol-breathe 2s ease-in-out infinite;
  }

  /* Nav actions */
  .nav-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
  }

  /* Nav button (+ New) */
  .nav-btn {
    font-family: var(--font-ui);
    font-size: var(--text-label);
    letter-spacing: 0.10em;
    color: var(--color-dim);
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    transition: color var(--transition-fast);
  }

  .nav-btn:hover {
    color: var(--color-muted);
  }

  /* Panel toggle (desktop) */
  .panel-toggle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    color: var(--color-dim);
    transition: color var(--transition-fast);
  }

  .panel-toggle:hover {
    color: var(--color-muted);
  }

  /* Hamburger (mobile) */
  .menu-toggle {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 5px;
    width: 44px;
    height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    color: var(--color-muted);
  }

  .hamburger-bar {
    display: block;
    width: 18px;
    height: 1px;
    background: currentColor;
    transition: opacity var(--transition-fast);
  }

  .menu-toggle:hover .hamburger-bar {
    opacity: 0.8;
  }

  /* Live dot on toggle buttons */
  .menu-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-sage);
    animation: symbol-breathe 2s ease-in-out infinite;
  }

  /* User profile */
  .user-profile {
    position: relative;
  }

  .user-button {
    display: flex;
    align-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: none;
    cursor: pointer;
    padding: 0;
    overflow: hidden;
  }

  .user-avatar,
  .user-avatar-fallback {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 500;
    font-size: 0.875rem;
    background: var(--color-sage);
    color: white;
  }

  .user-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: var(--space-2);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    min-width: 220px;
    z-index: 1000;
  }

  .user-info {
    padding: var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }

  .user-name {
    font-weight: 500;
    font-size: var(--text-label);
    color: var(--color-text);
  }

  .user-email {
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
    color: var(--color-text);
    transition: background-color var(--transition-fast);
  }

  .dropdown-item:hover {
    background-color: var(--color-hover);
  }

  /* Responsive visibility */
  .mobile-only { display: none; }
  .desktop-only { display: flex; }

  @media (max-width: 767px) {
    .mobile-only { display: flex; }
    .desktop-only { display: none; }

    .context-query {
      max-width: 160px;
    }
  }
</style>
