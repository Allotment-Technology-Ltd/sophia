<script lang="ts">
  import { auth, signOutUser, onAuthChange } from '$lib/firebase';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';

  let currentUser = $state(browser ? auth?.currentUser : null);

  if (browser) {
    onAuthChange((user) => { currentUser = user; });
  }

  async function handleSignOut() {
    await signOutUser();
    goto('/auth');
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
</script>

<div class="settings-tab">
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
      onclick={() => prefersReducedMotion = !prefersReducedMotion}
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
      onclick={() => presenceMode = !presenceMode}
    >
      <span class="toggle-knob" aria-hidden="true"></span>
    </button>
  </div>

  <p class="settings-section-label">Account</p>

  <div class="setting-row">
    <div class="setting-info">
      <span class="setting-name">{currentUser?.displayName ?? currentUser?.email ?? 'Signed in'}</span>
      <span class="setting-desc">{currentUser?.email ?? ''}</span>
    </div>
  </div>

  <div class="setting-row">
    <button class="sign-out-btn" onclick={handleSignOut}>
      Sign out
    </button>
  </div>
</div>

<style>
  .settings-tab {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .settings-section-label {
    font-family: var(--font-ui);
    font-size: var(--text-label);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-dim);
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

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .setting-name {
    font-family: var(--font-display);
    font-size: var(--text-body);
    color: var(--color-text);
  }

  .setting-desc {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: var(--color-dim);
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
</style>
