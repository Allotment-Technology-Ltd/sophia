<script lang="ts">
  import { signInWithGoogle } from '$lib/firebase';
  import { goto } from '$app/navigation';

  let isLoading = $state(false);
  let error = $state('');

  const quotes = [
    'Reason is the light that guides understanding.',
    'In dialogue we discover what we truly believe.',
    'The examined question yields the wisest answer.',
    'Evidence and argument: the twin pillars of thought.',
    'Complexity demands structured reasoning.'
  ];

  let quoteIndex = $state(0);

  function rotateQuote() {
    quoteIndex = (quoteIndex + 1) % quotes.length;
  }

  async function handleSignIn() {
    isLoading = true;
    error = '';
    try {
      await signInWithGoogle();
      await goto('/');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      console.error('Auth error:', err);
    } finally {
      isLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Sign In — SOPHIA</title>
</svelte:head>

<div class="min-h-screen relative overflow-hidden flex items-center justify-center px-4" style="background: linear-gradient(135deg, var(--color-bg) 0%, #2a2520 50%, var(--color-surface-raised) 100%);">
  <div class="relative z-10 w-full max-w-md">
    <div class="relative bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-8 shadow-2xl border" style="border-color: var(--color-border); backdrop-filter: blur(10px);">
      <!-- Logo & Branding -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4" style="background: var(--color-sage-bg); border: 2px solid var(--color-sage);">
          <svg class="w-8 h-8" style="color: var(--color-sage);" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" fill="none"/>
            <path d="M12 7 Q 15 9 15 12 Q 15 15 12 17 Q 9 15 9 12 Q 9 9 12 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          </svg>
        </div>
        <h1 class="text-4xl font-bold mb-1" style="font-family: var(--font-display); letter-spacing: 0.08em; color: var(--color-text);">SOPHIA</h1>
        <p class="text-sm tracking-widest uppercase" style="color: var(--color-sage); font-family: var(--font-ui); font-weight: 500;">Philosophical Reasoning Engine</p>
      </div>

      <!-- Value Proposition -->
      <div class="grid grid-cols-3 gap-3 mb-8 pb-8 border-b" style="border-color: var(--color-border);">
        <div class="flex flex-col items-center gap-2 text-xs" style="color: var(--color-muted);">
          <div class="text-lg" style="color: var(--color-sage);">◆</div>
          <span>Structured Reasoning</span>
        </div>
        <div class="flex flex-col items-center gap-2 text-xs" style="color: var(--color-muted);">
          <div class="text-lg" style="color: var(--color-sage);">◆</div>
          <span>Multiple Perspectives</span>
        </div>
        <div class="flex flex-col items-center gap-2 text-xs" style="color: var(--color-muted);">
          <div class="text-lg" style="color: var(--color-sage);">◆</div>
          <span>Grounded Sources</span>
        </div>
      </div>

      <!-- Featured Quote -->
      <div class="quote-card relative mb-8 p-4 rounded-lg" style="background: var(--color-sage-bg); border-left: 3px solid var(--color-sage);">
        <p class="text-sm leading-relaxed" style="color: var(--color-text); font-style: italic; font-family: var(--font-display); margin: 0;">
          {quotes[quoteIndex]}
        </p>
        <button class="quote-btn absolute top-4 right-4 w-6 h-6 flex items-center justify-center rounded-full text-xs" style="background: var(--color-sage); color: var(--color-bg); border: none; cursor: pointer; opacity: 0.7; transition: opacity 0.2s;" onclick={rotateQuote} aria-label="Next quote">→</button>
      </div>

      <!-- Sign In Button -->
      <button
        onclick={handleSignIn}
        disabled={isLoading}
        class="sign-in-btn w-full flex items-center justify-center gap-3 px-6 py-3 rounded-lg font-medium transition-all duration-200"
        style="background: var(--color-sage); color: var(--color-bg); border: none; cursor: pointer; font-family: var(--font-display); font-size: 1rem; letter-spacing: 0.02em; box-shadow: 0 4px 15px rgba(127, 163, 131, 0.3);"
      >
        <svg class="flex-shrink-0" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        <span>{isLoading ? 'Signing in...' : 'Sign in with Google'}</span>
      </button>

      {#if error}
        <div class="mt-4 p-3 rounded-lg flex items-start gap-2 text-sm" style="background: rgba(220, 38, 38, 0.1); border-left: 3px solid #dc2626; color: #fca5a5;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          {error}
        </div>
      {/if}

      <!-- Footer -->
      <div class="text-center mt-6 pt-6 border-t" style="border-color: var(--color-border);">
        <p class="text-xs" style="color: var(--color-dim); margin: 0;">
          By signing in, you agree to our <a href="#terms" class="text-xs underline transition-colors" style="color: var(--color-sage);">Terms of Service</a> and <a href="#privacy" class="text-xs underline transition-colors" style="color: var(--color-sage);">Privacy Policy</a>
        </p>
      </div>
    </div>
  </div>
</div>

<style>
  .quote-btn:hover {
    opacity: 1;
  }

  .sign-in-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(127, 163, 131, 0.4) !important;
    background: #8fb491 !important;
  }

  .sign-in-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .sign-in-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
