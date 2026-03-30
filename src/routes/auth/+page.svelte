<script lang="ts">
  import { signInWithGoogle } from '$lib/authClient';
  import { goto } from '$app/navigation';
  import DialecticalTriangle from '$lib/components/DialecticalTriangle.svelte';

  let isLoading = $state(false);
  let error = $state('');

  async function handleSignIn() {
    isLoading = true;
    error = '';
    try {
      await signInWithGoogle();
      await goto('/home');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      console.error('Auth error:', err);
    } finally {
      isLoading = false;
    }
  }
</script>

<svelte:head>
  <title>SOPHIA — Sign In</title>
</svelte:head>

<div class="auth-page" style="background: linear-gradient(135deg, var(--color-bg) 0%, #2a2520 50%, var(--color-surface-raised) 100%);">
  <div class="auth-container">
    <!-- Main Card -->
    <div class="auth-card">
      <!-- Header with logo -->
      <div class="auth-header">
        <div class="logo">
          <DialecticalTriangle mode="logo" size={72} />
        </div>
        <h1 class="auth-title">SOPHIA</h1>
        <p class="auth-subtitle">Structured ontological and philosophical reasoning platform</p>
      </div>

      <!-- Divider -->
      <div class="auth-divider"></div>

      <!-- Content -->
      <div class="auth-content">
        <p class="auth-description">
          Apply structured reasoning to complex philosophical questions. Draws from curated knowledge and live sources.
        </p>

        <!-- Sign In Button -->
        <button
          onclick={handleSignIn}
          disabled={isLoading}
          class="sign-in-btn"
        >
          <svg class="google-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          <span>{isLoading ? 'Signing in...' : 'Continue with Google'}</span>
        </button>

        {#if error}
          <div class="error-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="auth-footer">
        <p>By signing in, you agree to our <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a></p>
      </div>
    </div>
  </div>
</div>

<style>
  .auth-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .auth-container {
    width: 100%;
    max-width: 400px;
  }

  .auth-card {
    background: rgba(20, 19, 18, 0.8);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    backdrop-filter: blur(10px);
  }

  .auth-header {
    padding: 48px 40px 32px;
    text-align: center;
  }

  .logo {
    display: flex;
    justify-content: center;
    margin-bottom: 8px;
  }

  .auth-title {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--color-text);
    margin: 0 0 12px;
    line-height: 1.2;
  }

  .auth-subtitle {
    font-family: var(--font-display);
    font-size: 14px;
    color: var(--color-sage);
    font-weight: 500;
    letter-spacing: 0.02em;
    margin: 0;
    line-height: 1.4;
  }

  .auth-divider {
    height: 1px;
    background: var(--color-border);
    margin: 0;
  }

  .auth-content {
    padding: 40px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .auth-description {
    font-family: var(--font-display);
    font-size: 15px;
    color: var(--color-muted);
    line-height: 1.6;
    margin: 0;
  }

  .sign-in-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 11px 28px;
    margin: 0 auto;
    background: var(--color-sage);
    color: var(--color-bg);
    border: none;
    border-radius: 6px;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition: all 200ms cubic-bezier(0.2, 0, 0, 1);
    box-shadow: 0 2px 8px rgba(127, 163, 131, 0.25);
  }

  .sign-in-btn:hover:not(:disabled) {
    background: #8fb491;
    box-shadow: 0 4px 16px rgba(127, 163, 131, 0.35);
    transform: translateY(-1px);
  }

  .sign-in-btn:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 1px 4px rgba(127, 163, 131, 0.2);
  }

  .sign-in-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .google-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .error-box {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    background: rgba(220, 38, 38, 0.08);
    border: 1px solid rgba(220, 38, 38, 0.25);
    border-radius: 6px;
    font-size: 13px;
    color: #fca5a5;
  }

  .error-box svg {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .auth-footer {
    padding: 24px 40px;
    border-top: 1px solid var(--color-border);
    text-align: center;
  }

  .auth-footer p {
    font-size: 12px;
    color: var(--color-dim);
    margin: 0;
    line-height: 1.5;
  }

  .auth-footer a {
    color: var(--color-sage);
    text-decoration: none;
    transition: color 150ms ease;
  }

  .auth-footer a:hover {
    color: var(--color-blue);
  }

  @media (max-width: 480px) {
    .auth-header {
      padding: 40px 24px 24px;
    }

    .auth-title {
      font-size: 28px;
    }

    .auth-content {
      padding: 32px 24px;
      gap: 24px;
    }

    .auth-footer {
      padding: 20px 24px;
    }
  }
</style>
