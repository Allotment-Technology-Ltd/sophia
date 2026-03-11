<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { auth, getIdToken, onAuthChange } from '$lib/firebase';
  import { LEGAL_CHANGELOG_PATH, LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from '$lib/constants/legal';

  let {
    data
  }: {
    data: {
      paddleRuntime: 'sandbox' | 'production';
      paddleClientToken: string | null;
      isAuthenticated: boolean;
      checkoutSettings: {
        locale: string | null;
        theme: 'light' | 'dark' | null;
        variant: 'one-page' | 'multi-page' | null;
        allowLogout: boolean;
        showAddTaxId: boolean;
      };
    };
  } = $props();
  let hasPtxn = $state(false);
  let checkoutTransactionId = $state<string | null>(null);
  let checkoutIntent = $state<'subscription' | 'topup' | null>(null);
  let checkoutPlan = $state<'pro' | 'premium' | null>(null);
  let checkoutPack = $state<'small' | 'large' | null>(null);
  let selectedCheckoutCard = $state<'pro' | 'premium' | 'topup_small' | 'topup_large' | null>(null);
  let checkoutReady = $state(false);
  let checkoutOpening = $state(false);
  let autoCheckoutAttempted = $state(false);
  let ptxnMissingToken = $state(false);
  let ptxnCheckoutError = $state('');
  let acceptTerms = $state(false);
  let acceptPrivacy = $state(false);
  let paddleClient: any = null;
  let paddleInitialized = $state(false);
  let paddleInitInFlight: Promise<void> | null = null;
  let isAuthenticated = $state(false);
  let showCheckoutFlow = $derived(isAuthenticated || hasPtxn || checkoutIntent !== null);

  type CheckoutCard = 'pro' | 'premium' | 'topup_small' | 'topup_large';

  function canSelectCard(card: CheckoutCard): boolean {
    if (!showCheckoutFlow) return false;
    return card === 'pro' || card === 'premium' || card === 'topup_small' || card === 'topup_large';
  }

  function selectCard(card: CheckoutCard): void {
    if (!canSelectCard(card)) return;
    selectedCheckoutCard = card;
  }

  function selectionMatchesCurrentTransaction(selected: CheckoutCard | null): boolean {
    if (!selected) return false;
    if (selected === 'pro' || selected === 'premium') {
      return checkoutIntent === 'subscription' && checkoutPlan === selected;
    }
    const selectedPack = selected === 'topup_small' ? 'small' : 'large';
    return checkoutIntent === 'topup' && checkoutPack === selectedPack;
  }

  let canResumeExistingTransaction = $derived.by(() =>
    Boolean(checkoutTransactionId && selectionMatchesCurrentTransaction(selectedCheckoutCard))
  );
  let legalAcceptanceRequired = $derived(isAuthenticated && !canResumeExistingTransaction);

  function normalizeLocalCheckoutUrl(rawUrl: string): string {
    if (!browser) return rawUrl;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return rawUrl;
    }
    const current = new URL(window.location.href);
    const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isLocalHost) {
      parsed.protocol = current.protocol === 'https:' ? 'https:' : 'http:';
      parsed.hostname = current.hostname;
      parsed.port = current.port;
    }
    return parsed.toString();
  }

  async function ensurePaddleReady(): Promise<void> {
    if (!browser) throw new Error('Checkout requires a browser environment.');
    if (checkoutReady && paddleClient?.Checkout?.open) return;
    if (paddleInitInFlight) {
      await paddleInitInFlight;
      return;
    }

    paddleInitInFlight = (async () => {
      const clientToken = data.paddleClientToken?.trim();
      if (!clientToken) {
        ptxnMissingToken = true;
        throw new Error(
          `Checkout is waiting for Paddle client token configuration (${data.paddleRuntime === 'sandbox'
            ? 'PUBLIC_PADDLE_CLIENT_TOKEN_SANDBOX'
            : 'PUBLIC_PADDLE_CLIENT_TOKEN_PRODUCTION'}).`
        );
      }

      const scriptSrc = 'https://cdn.paddle.com/paddle/v2/paddle.js';
      if (!document.querySelector(`script[src="${scriptSrc}"]`)) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = scriptSrc;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Paddle.js'));
          document.head.appendChild(script);
        });
      }

      const paddle = (window as Window & { Paddle?: any }).Paddle;
      if (!paddle) {
        throw new Error('Paddle.js loaded but Paddle runtime is unavailable on window.');
      }
      if (data.paddleRuntime === 'sandbox' && paddle.Environment?.set) {
        paddle.Environment.set('sandbox');
      }

      const settings = {
        allowLogout: data.checkoutSettings.allowLogout,
        showAddTaxId: data.checkoutSettings.showAddTaxId,
        ...(data.checkoutSettings.locale ? { locale: data.checkoutSettings.locale } : {}),
        ...(data.checkoutSettings.theme ? { theme: data.checkoutSettings.theme } : {}),
        ...(data.checkoutSettings.variant ? { variant: data.checkoutSettings.variant } : {})
      };

      if (!paddleInitialized) {
        try {
          paddle.Initialize({
            token: clientToken,
            checkout: {
              settings
            },
            eventCallback: (event: any) => {
              if (!event || typeof event !== 'object') return;
              const name = typeof event.name === 'string' ? event.name : '';
              if (!name.toLowerCase().includes('error')) return;
              const parts: string[] = [];
              if (typeof event.type === 'string' && event.type) parts.push(`type=${event.type}`);
              if (typeof event.code === 'string' && event.code) parts.push(`code=${event.code}`);
              if (typeof event.detail === 'string' && event.detail) parts.push(`detail=${event.detail}`);
              if (typeof event.documentation_url === 'string' && event.documentation_url) {
                parts.push(`docs=${event.documentation_url}`);
              }
              if (event.data) {
                try {
                  parts.push(`data=${JSON.stringify(event.data)}`);
                } catch {
                  parts.push(`data=${String(event.data)}`);
                }
              }
              ptxnCheckoutError = `Paddle event ${name}${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
            }
          });
          paddleInitialized = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/already\s+initialized/i.test(message)) throw error;
          paddleInitialized = true;
        }
      }

      paddleClient = paddle;
      checkoutReady = Boolean(paddleClient?.Checkout?.open);
      if (!checkoutReady) {
        throw new Error('Paddle checkout client is not ready.');
      }
    })();

    try {
      await paddleInitInFlight;
    } finally {
      paddleInitInFlight = null;
    }
  }

  onMount(() => {
    if (!browser) return;
    isAuthenticated = Boolean(auth?.currentUser) || Boolean(data.isAuthenticated);
    const unsubscribeAuth = onAuthChange((user) => {
      isAuthenticated = Boolean(user);
    });

    const init = async () => {
      const url = new URL(window.location.href);
      const transactionId = url.searchParams.get('_ptxn');
      hasPtxn = Boolean(transactionId);
      checkoutTransactionId = transactionId;
      const kind = url.searchParams.get('sophia_kind');
      checkoutIntent = kind === 'subscription' || kind === 'topup' ? kind : null;
      const plan = url.searchParams.get('sophia_plan');
      checkoutPlan = plan === 'pro' || plan === 'premium' ? plan : null;
      const pack = url.searchParams.get('sophia_pack');
      checkoutPack = pack === 'small' || pack === 'large' ? pack : null;
      if (checkoutIntent === 'subscription' && checkoutPlan) {
        selectedCheckoutCard = checkoutPlan;
      } else if (checkoutIntent === 'topup' && checkoutPack) {
        selectedCheckoutCard = checkoutPack === 'small' ? 'topup_small' : 'topup_large';
      } else if (isAuthenticated) {
        selectedCheckoutCard = 'pro';
      }
      if (!transactionId) return;
      try {
        await ensurePaddleReady();
      } catch (error) {
        ptxnCheckoutError = error instanceof Error ? error.message : 'Failed to initialize checkout.';
      }
    };

    void init();
    return () => {
      unsubscribeAuth?.();
    };
  });

  async function openCheckoutFromSelection(): Promise<void> {
    checkoutOpening = true;
    ptxnCheckoutError = '';
    try {
      const selected = selectedCheckoutCard;
      if (!selected) return;

      const currentMatchesSelected = selectionMatchesCurrentTransaction(selected);

      if (checkoutTransactionId && currentMatchesSelected) {
        await ensurePaddleReady();
        await paddleClient.Checkout.open({
          transactionId: checkoutTransactionId
        });
        return;
      }

      if (legalAcceptanceRequired && (!acceptTerms || !acceptPrivacy)) {
        throw new Error('You must accept the latest Terms and Privacy Policy to continue.');
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error('Sign in required to start checkout.');
      }

      const endpoint = selected === 'pro' || selected === 'premium'
        ? '/api/billing/checkout'
        : '/api/billing/topups';
      const body =
        selected === 'pro' || selected === 'premium'
          ? {
              tier: selected,
              currency: 'GBP',
              accept_terms: acceptTerms,
              accept_privacy: acceptPrivacy,
              legal_terms_version: LEGAL_VERSION,
              legal_privacy_version: LEGAL_VERSION
            }
          : {
              pack: selected === 'topup_small' ? 'small' : 'large',
              currency: 'GBP',
              accept_terms: acceptTerms,
              accept_privacy: acceptPrivacy,
              legal_terms_version: LEGAL_VERSION,
              legal_privacy_version: LEGAL_VERSION
            };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || payload?.detail || `Checkout request failed (${response.status})`);
      }
      const checkoutUrlRaw = payload?.checkout_url;
      if (typeof checkoutUrlRaw !== 'string' || !checkoutUrlRaw) {
        throw new Error('Missing checkout URL from billing response.');
      }

      const checkoutUrl = new URL(checkoutUrlRaw);
      checkoutUrl.searchParams.set(
        'sophia_kind',
        selected === 'pro' || selected === 'premium' ? 'subscription' : 'topup'
      );
      if (selected === 'pro' || selected === 'premium') {
        checkoutUrl.searchParams.set('sophia_plan', selected);
      } else {
        checkoutUrl.searchParams.set('sophia_pack', selected === 'topup_small' ? 'small' : 'large');
      }
      window.location.href = normalizeLocalCheckoutUrl(checkoutUrl.toString());
    } catch (err) {
      ptxnCheckoutError = err instanceof Error ? err.message : 'Unable to open checkout.';
    } finally {
      checkoutOpening = false;
    }
  }

  $effect(() => {
    if (!browser) return;
    if (autoCheckoutAttempted) return;
    if (!hasPtxn || !checkoutTransactionId || !checkoutIntent || !selectedCheckoutCard) return;
    if (checkoutOpening) return;
    autoCheckoutAttempted = true;
    void openCheckoutFromSelection();
  });
</script>

<svelte:head>
  <title>SOPHIA Pricing</title>
  <meta
    name="description"
    content="SOPHIA pricing for Free, Pro, and Premium plans, including ingestion allowances and API key wallet top-ups."
  />
</svelte:head>

<main class="pricing">
  <header class="header">
    <p class="eyebrow">Pricing</p>
    <h1>Simple plans for thoughtful people.</h1>
    <p>
      Start free, then upgrade if you want SOPHIA to explore more ideas each month.
      Payments and taxes are managed securely through Paddle.
    </p>
  </header>

  <section class="plans">
    <article class="plan">
      <h2>Curious Thinker</h2>
      <p class="price">£0</p>
      <ul>
        <li>Core SOPHIA query experience</li>
        <li>Monthly ingestion: 2 public, 0 private</li>
        <li>Bring your own API key (BYOK)available with wallet limits</li>
      </ul>
    </article>
    <article
      class="plan"
      class:is-selected={selectedCheckoutCard === 'pro'}
      class:is-disabled={
        !canSelectCard('pro')
      }
    >
      <button
        class="plan-select"
        type="button"
        disabled={!canSelectCard('pro')}
        onclick={() => selectCard('pro')}
      >
        <h2>Deep Inquirer</h2>
        <p class="price">from £6.99 / month</p>
        <ul>
          <li>Higher usage limits</li>
          <li>Monthly ingestion: 3 public, or 1 private + 2 public</li>
          <li>API wallet + 10% handling-fee metering</li>
        </ul>
      </button>
    </article>
    <article
      class="plan"
      class:is-selected={selectedCheckoutCard === 'premium'}
      class:is-disabled={
        !canSelectCard('premium')
      }
    >
      <button
        class="plan-select"
        type="button"
        disabled={!canSelectCard('premium')}
        onclick={() => selectCard('premium')}
      >
        <h2>Philosopher's Desk</h2>
        <p class="price">from £11.99 / month</p>
        <ul>
          <li>Highest consumer plan allowances</li>
          <li>Monthly ingestion: 5 public, or 1 private + 3 public</li>
          <li>Priority access to premium capabilities</li>
        </ul>
      </button>
    </article>
  </section>

  <section class="plans topups">
    <article
      class="plan"
      class:is-selected={selectedCheckoutCard === 'topup_small'}
      class:is-disabled={!canSelectCard('topup_small')}
    >
      <button
        class="plan-select"
        type="button"
        disabled={!canSelectCard('topup_small')}
        onclick={() => selectCard('topup_small')}
      >
        <h2>Insight Credits (Small)</h2>
        <p class="price">£5.00</p>
        <ul>
          <li>Prepaid wallet credit</li>
          <li>Used for API handling fees</li>
          <li>Used for paid private ingestion charges</li>
        </ul>
      </button>
    </article>
    <article
      class="plan"
      class:is-selected={selectedCheckoutCard === 'topup_large'}
      class:is-disabled={!canSelectCard('topup_large')}
    >
      <button
        class="plan-select"
        type="button"
        disabled={!canSelectCard('topup_large')}
        onclick={() => selectCard('topup_large')}
      >
        <h2>Insight Credits (Large)</h2>
        <p class="price">£15.00</p>
        <ul>
          <li>Prepaid wallet credit</li>
          <li>Used for API handling fees</li>
          <li>Used for paid private ingestion charges</li>
        </ul>
      </button>
    </article>
  </section>

  <section class="notes">
    {#if showCheckoutFlow}
      <p class="resource-note">
        Review your selection, then proceed when you are ready.
      </p>
      {#if isAuthenticated}
        <div class="legal-acks">
          <label class="legal-ack">
            <input type="checkbox" bind:checked={acceptTerms} />
            <span>I accept the latest <a href="/terms">Terms</a> (v{LEGAL_VERSION}).</span>
          </label>
          <label class="legal-ack">
            <input type="checkbox" bind:checked={acceptPrivacy} />
            <span>I accept the latest <a href="/privacy">Privacy Policy</a> (v{LEGAL_VERSION}).</span>
          </label>
        </div>
        <p class="legal-meta">
          Effective {LEGAL_EFFECTIVE_DATE} · <a href={LEGAL_CHANGELOG_PATH}>Legal changelog</a>
        </p>
      {/if}
      <div class="cta-row">
        <button
          class="button primary"
          type="button"
          disabled={!selectedCheckoutCard || checkoutOpening || (legalAcceptanceRequired && (!acceptTerms || !acceptPrivacy))}
          onclick={openCheckoutFromSelection}
        >
          {checkoutOpening ? 'Opening checkout…' : 'Proceed Securely →'}
        </button>
      </div>
    {/if}
    {#if ptxnMissingToken}
      <p class="error-note">
        Checkout is waiting for Paddle client token configuration. Set
        {data.paddleRuntime === 'sandbox'
          ? 'PUBLIC_PADDLE_CLIENT_TOKEN_SANDBOX'
          : 'PUBLIC_PADDLE_CLIENT_TOKEN_PRODUCTION'}
        and reload this page.
      </p>
    {/if}
    {#if ptxnCheckoutError}
      <p class="error-note">{ptxnCheckoutError}</p>
    {/if}
    <h2>Insight Credits and Billing Notes</h2>
    <ul>
      <li>Insight credits cover deeper reasoning or API usage. They never expire.</li>
      <li>Top-ups are pre-paid and used for deeper runs. Refunds are only provided where the law requires.</li>
      <li>Taxes and payment administration are handled by Paddle as Merchant of Record.</li>
    </ul>
    <p>
      Read <a href="/terms">Terms of Service</a>,
      <a href="/privacy">Privacy Policy</a>,
      and <a href="/terms#refund-policy">Refund policy</a>.
    </p>
    <div class="cta-row">
      {#if showCheckoutFlow}
        <a class="button primary" href="/app">Back to SOPHIA</a>
      {/if}
      {#if !isAuthenticated}
        <a class="button primary" href="/auth">Get started</a>
      {/if}
    </div>
  </section>
</main>

<style>
  .pricing {
    min-height: 100vh;
    max-width: 1040px;
    margin: 0 auto;
    padding: 56px 20px 72px;
    color: var(--color-text);
  }

  .header {
    max-width: 66ch;
  }

  .eyebrow {
    margin: 0 0 8px;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--color-sage);
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 4.2vw, 2.8rem);
    line-height: 1.1;
  }

  .header p {
    margin: 14px 0 0;
    color: var(--color-muted);
    line-height: 1.6;
  }

  .plans {
    margin-top: 24px;
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .plan {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: var(--color-surface);
    padding: 18px;
  }

  .plan.is-selected {
    border-color: var(--color-sage);
    box-shadow: 0 0 0 1px rgba(127, 163, 131, 0.45);
  }

  .plan.is-disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .plan h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.16rem;
  }

  .plan-select {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: inherit;
    padding: 0;
    cursor: pointer;
    font: inherit;
  }

  .plan-select:disabled {
    cursor: not-allowed;
  }

  .price {
    margin: 8px 0 12px;
    font-family: var(--font-display);
    font-size: 1.4rem;
    color: var(--color-text);
  }

  .plan ul {
    margin: 0;
    padding-left: 18px;
    color: var(--color-muted);
    line-height: 1.55;
    font-size: 0.94rem;
  }

  .notes {
    margin-top: 28px;
    border-top: 1px solid var(--color-border);
    padding-top: 18px;
  }

  .notes h2 {
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-size: 1.12rem;
  }

  .notes ul {
    margin: 0;
    padding-left: 18px;
    color: var(--color-muted);
    line-height: 1.55;
    font-size: 0.94rem;
  }

  .notes p {
    margin: 12px 0 0;
    color: var(--color-muted);
  }

  .resource-note {
    margin: 8px 0 0;
    font-size: 0.88rem;
    color: var(--color-muted);
  }

  .notes a {
    color: var(--color-blue);
    text-decoration: none;
  }

  .notes a:hover {
    text-decoration: underline;
  }

  .legal-ack {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-family: var(--font-ui);
    font-size: 0.86rem;
    color: var(--color-muted);
    line-height: 1.45;
  }

  .legal-acks {
    margin-top: 10px;
    display: grid;
    gap: 8px;
  }

  .legal-meta {
    margin-top: 6px;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    color: var(--color-dim);
  }

  .error-note {
    margin: 0 0 12px;
    padding: 10px 12px;
    border: 1px solid rgba(211, 96, 96, 0.5);
    border-radius: 8px;
    color: #f3b6b6;
    background: rgba(211, 96, 96, 0.12);
    font-family: var(--font-ui);
    font-size: 0.86rem;
  }

  .cta-row {
    margin-top: 16px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .button {
    border: 1px solid transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: 0 16px;
    border-radius: 8px;
    text-decoration: none;
    font-family: var(--font-ui);
    font-size: 0.88rem;
    transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    cursor: pointer;
  }

  .button:hover {
    transform: translateY(-1px);
  }

  .button.primary {
    background: var(--color-sage);
    color: var(--color-bg);
    border-color: transparent;
  }

  .button:disabled {
    opacity: 0.5;
    cursor: default;
    transform: none;
  }

</style>
