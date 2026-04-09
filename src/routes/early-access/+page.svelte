<script lang="ts">
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import DialecticalTriangle from '$lib/components/DialecticalTriangle.svelte';
  import { signInWithGoogle } from '$lib/authClient';

  const POST_OAUTH_PATH_KEY = 'sophia_post_oauth_path';

  let { data }: { data: { googleSignInAvailable: boolean } } = $props();

  let email = $state('');
  let status = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
  let message = $state('');
  let oauthStatus = $state<'idle' | 'loading' | 'error'>('idle');
  let oauthMessage = $state('');

  function resolveNextPath(): string {
    const fromUrl = $page.url.searchParams.get('next');
    if (fromUrl?.startsWith('/') && !fromUrl.startsWith('//')) return fromUrl;
    return '/home';
  }

  async function handleGoogleSignIn(): Promise<void> {
    oauthStatus = 'loading';
    oauthMessage = '';
    try {
      if (browser) {
        sessionStorage.setItem(POST_OAUTH_PATH_KEY, resolveNextPath());
      }
      // OAuth redirect often lands on a fixed path; layout reads POST_OAUTH_PATH_KEY for deep links.
      await signInWithGoogle({ redirectPath: '/home' });
    } catch (e) {
      oauthStatus = 'error';
      oauthMessage =
        e instanceof Error ? e.message : 'Sign-in failed. Please try again or contact support.';
      if (browser) sessionStorage.removeItem(POST_OAUTH_PATH_KEY);
    }
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    status = 'loading';
    message = '';
    try {
      const response = await fetch('/api/early-access/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          sourcePath: $page.url.pathname + $page.url.search
        })
      });
      const payload = (await response.json()) as { ok?: boolean; alreadyRegistered?: boolean; error?: string };
      if (!response.ok) {
        status = 'error';
        message = payload.error ?? 'Something went wrong. Please try again.';
        return;
      }
      status = 'success';
      message = payload.alreadyRegistered
        ? 'You are already on the list. We will be in touch when spots open up.'
        : 'Thanks — you are on the early access list. We will email you when we are ready for the next wave of testers.';
      email = '';
    } catch {
      status = 'error';
      message = 'Network error. Please try again.';
    }
  }
</script>

<svelte:head>
  <title>SOPHIA — Early access</title>
  <meta
    name="description"
    content="SOPHIA is in prototyping. Sign in if you have access, or join the early access waitlist."
  />
</svelte:head>

<div
  class="early-page"
  style="background: linear-gradient(135deg, var(--color-bg) 0%, #2a2520 50%, var(--color-surface-raised) 100%);"
>
  <div class="early-inner">
    <div class="early-card">
      <div class="early-header">
        <div class="logo">
          <DialecticalTriangle mode="logo" size={64} />
        </div>
        <h1 class="early-title">SOPHIA</h1>
        <p class="early-eyebrow">Early access</p>
      </div>

      <div class="early-divider"></div>

      <div class="early-body">
        <p class="lead">
          We are still in a <strong>prototyping</strong> phase. The full product is not open to the public yet, but we
          are actively looking for <strong>early testers</strong> who want to help shape what comes next.
        </p>
        <p>
          If you would like to talk sooner or ask about access, email us at
          <a href="mailto:admin@usesophia.app">admin@usesophia.app</a>.
        </p>

        {#if data.googleSignInAvailable}
          <div class="sign-in-block">
            <h2 class="section-heading">Already invited?</h2>
            <p class="section-help">
              If your email is on the access list, sign in with Google. Everyone else can join the waitlist below.
            </p>
            <button
              type="button"
              class="google-btn"
              disabled={oauthStatus === 'loading'}
              onclick={() => void handleGoogleSignIn()}
            >
              {oauthStatus === 'loading' ? 'Redirecting…' : 'Continue with Google'}
            </button>
            {#if oauthMessage}
              <p class="form-message error" role="status">{oauthMessage}</p>
            {/if}
          </div>
        {:else}
          <p class="config-note" role="note">
            Google sign-in is not configured in this environment. Use the waitlist or contact us by email.
          </p>
        {/if}

        <form class="waitlist-form" onsubmit={handleSubmit}>
          <label class="field-label" for="waitlist-email">Join the waitlist</label>
          <p class="field-help">We will only use this to contact you about early access. No marketing spam.</p>
          <div class="field-row">
            <input
              id="waitlist-email"
              name="email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
              bind:value={email}
              required
              disabled={status === 'loading'}
              class="email-input"
            />
            <button type="submit" class="submit-btn" disabled={status === 'loading'}>
              {status === 'loading' ? 'Sending…' : 'Notify me'}
            </button>
          </div>
          {#if message}
            <p class="form-message" class:error={status === 'error'} class:success={status === 'success'} role="status">
              {message}
            </p>
          {/if}
        </form>
      </div>
    </div>
  </div>
</div>

<style>
  .early-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .early-inner {
    width: 100%;
    max-width: 440px;
  }

  .early-card {
    background: rgba(20, 19, 18, 0.85);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    backdrop-filter: blur(10px);
  }

  .early-header {
    padding: 40px 36px 24px;
    text-align: center;
  }

  .logo {
    display: flex;
    justify-content: center;
    margin-bottom: 8px;
  }

  .early-title {
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied (<32px hero) */
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--color-text);
    margin: 0 0 6px;
  }

  .early-eyebrow {
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--color-sage);
    margin: 0;
  }

  .early-divider {
    height: 1px;
    background: var(--color-border);
  }

  .early-body {
    padding: 28px 36px 36px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .early-body p {
    font-family: var(--font-body); /* was --font-display: landing-only restriction applied */
    font-size: 14px;
    line-height: 1.65;
    color: var(--color-text);
    margin: 0;
  }

  .lead {
    font-size: 15px;
  }

  .early-body a {
    color: var(--color-sage);
    text-decoration: none;
  }

  .early-body a:hover {
    color: var(--color-blue);
  }

  .sign-in-block {
    margin-top: 4px;
    padding: 18px 0 4px;
    border-top: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-heading {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .section-help {
    font-size: 12px;
    color: var(--color-muted);
    line-height: 1.65;
    margin: -4px 0 0;
  }

  .google-btn {
    padding: 10px 20px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 150ms ease,
      border-color 150ms ease;
  }

  .google-btn:hover:not(:disabled) {
    border-color: var(--color-sage);
    background: var(--color-surface-raised);
  }

  .google-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .config-note {
    font-size: 12px;
    color: var(--color-muted);
    line-height: 1.65;
    padding: 12px 0 0;
    border-top: 1px solid var(--color-border);
    margin: 0;
  }

  .waitlist-form {
    margin-top: 8px;
    padding-top: 20px;
    border-top: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .field-label {
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
  }

  .field-help {
    font-size: 12px;
    color: var(--color-muted);
    margin: -4px 0 0;
    line-height: 1.65;
  }

  .field-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: stretch;
  }

  .email-input {
    flex: 1 1 180px;
    min-width: 0;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 14px;
  }

  .email-input:focus {
    outline: 2px solid var(--color-sage);
    outline-offset: 1px;
  }

  .submit-btn {
    padding: 10px 20px;
    border-radius: 6px;
    border: none;
    background: var(--color-sage);
    color: var(--color-bg);
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 150ms ease;
  }

  .submit-btn:hover:not(:disabled) {
    background: #8fb491;
  }

  .submit-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .form-message {
    font-size: 13px;
    margin: 4px 0 0;
    line-height: 1.45;
  }

  .form-message.success {
    color: var(--color-sage);
  }

  .form-message.error {
    color: #fca5a5;
  }

  @media (max-width: 480px) {
    .early-header {
      padding: 32px 24px 20px;
    }

    .early-body {
      padding: 24px 24px 32px;
    }
  }
</style>
