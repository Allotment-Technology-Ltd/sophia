<script lang="ts">
  import { goto } from '$app/navigation';
  import { signOutUser } from '$lib/firebase';

  async function handleSignOut() {
    await signOutUser();
    await goto('/');
  }
</script>

<svelte:head>
  <title>Access Denied — SOPHIA</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center px-4" style="background: linear-gradient(135deg, var(--color-bg) 0%, #2a2520 50%, var(--color-surface-raised) 100%);">
  <div class="w-full max-w-md">
    <div class="relative bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-8 shadow-2xl border" style="border-color: var(--color-border); backdrop-filter: blur(10px);">
      <!-- Icon -->
      <div class="text-center mb-6">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4" style="background: rgba(220, 38, 38, 0.1); border: 2px solid #dc2626;">
          <svg class="w-8 h-8" style="color: #dc2626;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
      </div>

      <!-- Message -->
      <h1 class="text-2xl font-bold text-center mb-3" style="color: var(--color-text); font-family: var(--font-display);">Early Access Required</h1>
      <p class="text-center text-sm mb-6" style="color: var(--color-muted);">
        SOPHIA is currently in development and available by invitation only. Your email address does not have access yet.
      </p>

      <!-- Contact Info -->
      <div class="p-4 rounded-lg mb-6" style="background: var(--color-surface); border: 1px solid var(--color-border);">
        <p class="text-xs mb-2" style="color: var(--color-dim);">To request access, contact:</p>
        <p style="color: var(--color-sage); font-family: var(--font-ui); font-size: 0.875rem; margin: 0;">
          <a href="mailto:admin@usesophia.app" style="color: var(--color-sage); text-decoration: none;">admin@usesophia.app</a>
        </p>
      </div>

      <!-- Sign Out Button -->
      <button
        onclick={handleSignOut}
        class="sign-out-btn w-full flex items-center justify-center gap-2 px-6 py-2 rounded-lg text-sm font-medium transition-all"
        style="background: transparent; color: var(--color-muted); border: 1px solid var(--color-border); cursor: pointer; font-family: var(--font-display);"
      >
        Sign out
      </button>
    </div>
  </div>
</div>

<style>
  .sign-out-btn:hover {
    background: var(--color-surface-raised);
    color: var(--color-text);
  }
</style>
