<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { auth, getIdToken, onAuthChange } from '$lib/authClient';
  import { env as publicEnv } from '$env/dynamic/public';

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

  const learnEnabled = (publicEnv.PUBLIC_ENABLE_LEARN_MODULE ?? 'false').toLowerCase() === 'true';
  let founderOffer = $state<FounderOfferSummary | null>(null);
  let founderBannerVisible = $state(false);

  async function openInquire(): Promise<void> {
    await goto('/app');
  }

  async function openLearn(): Promise<void> {
    if (!learnEnabled) return;
    await goto('/learn');
  }

  async function openStoa(): Promise<void> {
    await goto('/stoa');
  }

  async function fetchFounderOffer(): Promise<void> {
    if (!browser || !auth?.currentUser) {
      founderOffer = null;
      founderBannerVisible = false;
      return;
    }
    try {
      const token = await getIdToken();
      if (!token) return;

      const response = await fetch('/api/billing/entitlements', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) return;

      const body = (await response.json()) as { founder_offer?: FounderOfferSummary | null };
      founderOffer = body.founder_offer ?? null;
      founderBannerVisible = founderOffer?.noticePending === true;

      if (founderOffer?.noticePending) {
        await fetch('/api/billing/founder/ack', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch {
      founderOffer = null;
      founderBannerVisible = false;
    }
  }

  onMount(() => {
    if (!browser) return;
    void fetchFounderOffer();
    return onAuthChange(() => {
      void fetchFounderOffer();
    });
  });
</script>

<svelte:head>
  <title>SOPHIA Home</title>
  <meta name="description" content="Choose your SOPHIA mode: Inquire, Learn, or Stoa." />
</svelte:head>

<main class="home sophia-page-shell">
  {#if founderOffer?.active && founderBannerVisible}
    <section class="founder-banner" role="status" aria-live="polite">
      <p class="founder-title">Founder access unlocked</p>
      <p>
        You are founder #{founderOffer.slot} of {founderOffer.limit}. Premium is included until
        {new Date(founderOffer.expiresAt).toLocaleDateString('en-GB')} and your wallet starts with
        {` £${(founderOffer.bonusWalletCents / 100).toFixed(2)}`}.
      </p>
    </section>
  {/if}

  <header class="hero">
    <p class="eyebrow">Welcome back</p>
    <h1>Choose how you want to work.</h1>
    <p>
      Inquire for deep three-pass reasoning. Learn for guided drills and essays. Stoa for adaptive
      Stoic dialogue.
    </p>
  </header>

  <section class="modes" aria-label="Primary modes">
    <button class="mode-card" onclick={openInquire}>
      <h2>Inquire</h2>
      <p>Run SOPHIA’s analysis, critique, and synthesis engine on any question.</p>
      <span>Open Inquire -></span>
    </button>

    <button class="mode-card" onclick={openLearn} disabled={!learnEnabled}>
      <h2>Learn</h2>
      <p>Train reasoning with daily drills, practice essays, and dialectical feedback.</p>
      <span>{learnEnabled ? 'Open Learn ->' : 'Learn module disabled'}</span>
    </button>

    <button class="mode-card" onclick={openStoa}>
      <h2>Stoa</h2>
      <p>Work through hard decisions with adaptive Stoic dialogue, grounding, and deep analysis.</p>
      <span>Open Stoa -></span>
    </button>
  </section>

  <p class="note">You can switch between modes any time from the header.</p>
</main>

<style>
  .home {
    min-height: calc(100vh - var(--nav-height));
    color: var(--color-text);
  }

  .hero {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 20px;
    background: linear-gradient(140deg, rgba(127, 163, 131, 0.18), rgba(44, 96, 142, 0.14));
  }

  .founder-banner {
    margin-bottom: 12px;
    border: 1px solid var(--color-sage-border);
    border-radius: 12px;
    padding: 14px 16px;
    background: color-mix(in srgb, var(--color-sage) 12%, transparent);
  }

  .founder-title {
    margin: 0 0 4px;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-sage);
  }

  .founder-banner p {
    margin: 0;
    color: var(--color-text);
    line-height: 1.45;
  }

  .eyebrow {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-sage);
  }

  h1 {
    margin: 8px 0;
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 3.4vw, 2.5rem);
  }

  .hero p {
    margin: 0;
    color: var(--color-muted);
    line-height: 1.6;
  }

  .modes {
    margin-top: 14px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }

  .mode-card {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: var(--color-surface);
    padding: 16px;
    text-align: left;
    color: var(--color-text);
    cursor: pointer;
    transition: transform var(--transition-fast), border-color var(--transition-fast);
  }

  .mode-card:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: var(--color-sage);
  }

  .mode-card:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .mode-card h2 {
    margin: 0 0 8px;
    font-family: var(--font-display);
    color: var(--color-text);
  }

  .mode-card p {
    margin: 0;
    color: var(--color-muted);
  }

  .mode-card span {
    display: inline-block;
    margin-top: 12px;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-blue);
  }

  .note {
    margin-top: 12px;
    color: var(--color-dim);
    font-size: 0.85rem;
  }
</style>
