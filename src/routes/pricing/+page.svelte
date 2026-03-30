<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { auth, getIdToken, onAuthChange } from '$lib/authClient';
  import { LEGAL_CHANGELOG_PATH, LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from '$lib/constants/legal';
  import PublicHeader from '$lib/components/shell/PublicHeader.svelte';
  import { trackEvent } from '$lib/utils/analytics';

  let {
    data
  }: {
    data: {
      paddleRuntime: 'sandbox' | 'production';
      paddleClientToken: string | null;
      proMonthlyPriceIds: {
        GBP: string | null;
        USD: string | null;
      };
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
  let hasPtxn = $state(false);
  let checkoutTransactionId = $state<string | null>(null);
  let checkoutIntent = $state<'subscription' | null>(null);
  let checkoutPlan = $state<'premium' | null>(null);
  let selectedCheckoutCard = $state<'premium' | null>(null);
  let selectedCurrency = $state<'GBP' | 'USD'>('GBP');
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
  let clientAuthResolved = $state(false);
  let clientAuthenticated = $state(false);
  let founderOffer = $state<FounderOfferSummary | null>(null);
  let isAuthenticated = $derived(
    clientAuthResolved ? clientAuthenticated : Boolean(data.isAuthenticated)
  );
  let showCheckoutFlow = $derived(isAuthenticated || hasPtxn || checkoutIntent !== null);
  let founderSubscriptionLocked = $derived(founderOffer?.active === true);
  let founderExpiryLabel = $derived.by(() => {
    if (!founderOffer?.expiresAt) return 'the end of your founder period';
    return new Date(founderOffer.expiresAt).toLocaleDateString('en-GB');
  });

  type CheckoutCard = 'premium';

  function canSelectCard(card: CheckoutCard): boolean {
    if (!showCheckoutFlow) return false;
    if (founderSubscriptionLocked && card === 'premium') return false;
    return card === 'premium';
  }

  function selectCard(card: CheckoutCard): void {
    if (!canSelectCard(card)) return;
    selectedCheckoutCard = card;
  }

  function selectionMatchesCurrentTransaction(selected: CheckoutCard | null): boolean {
    if (!selected) return false;
    return checkoutIntent === 'subscription' && checkoutPlan === selected;
  }

  let canResumeExistingTransaction = $derived.by(() =>
    Boolean(checkoutTransactionId && selectionMatchesCurrentTransaction(selectedCheckoutCard))
  );
  let legalAcceptanceRequired = $derived(isAuthenticated && !canResumeExistingTransaction);
  let currencyOptionAvailability = $derived.by(() => ({
    GBP: Boolean(data.proMonthlyPriceIds.GBP),
    USD: Boolean(data.proMonthlyPriceIds.USD)
  }));
  let canCheckoutSelectedCurrency = $derived.by(
    () => currencyOptionAvailability[selectedCurrency]
  );
  let selectedCurrencyLabel = $derived.by(() =>
    selectedCurrency === 'GBP' ? 'GBP £5/month' : 'USD $6.35/month'
  );

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

  async function refreshBillingContext(): Promise<void> {
    if (!browser || !clientAuthenticated) {
      founderOffer = null;
      return;
    }
    try {
      const token = await getIdToken();
      if (!token) {
        founderOffer = null;
        return;
      }
      const response = await fetch('/api/billing/entitlements', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        founderOffer = null;
        return;
      }
      const body = (await response.json()) as { founder_offer?: FounderOfferSummary | null };
      founderOffer = body.founder_offer ?? null;
    } catch {
      founderOffer = null;
    }
  }

  onMount(() => {
    if (!browser) return;
    clientAuthenticated = Boolean(auth?.currentUser) || Boolean(data.isAuthenticated);
    clientAuthResolved = true;
    const unsubscribeAuth = onAuthChange((user) => {
      clientAuthenticated = Boolean(user);
      clientAuthResolved = true;
      void refreshBillingContext();
    });

    const init = async () => {
      const url = new URL(window.location.href);
      const transactionId = url.searchParams.get('_ptxn');
      hasPtxn = Boolean(transactionId);
      checkoutTransactionId = transactionId;
      const kind = url.searchParams.get('sophia_kind');
      checkoutIntent = kind === 'subscription' ? kind : null;
      const plan = url.searchParams.get('sophia_plan');
      checkoutPlan = plan === 'premium' ? plan : null;
      if (checkoutIntent === 'subscription' && checkoutPlan) {
        selectedCheckoutCard = checkoutPlan;
      } else if (isAuthenticated) {
        selectedCheckoutCard = 'premium';
      }
      if (!currencyOptionAvailability.GBP && currencyOptionAvailability.USD) {
        selectedCurrency = 'USD';
      }
      if (!transactionId) return;
      try {
        await ensurePaddleReady();
      } catch (error) {
        ptxnCheckoutError = error instanceof Error ? error.message : 'Failed to initialize checkout.';
      }
    };

    void refreshBillingContext();
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
      if (founderSubscriptionLocked && selected === 'premium') {
        throw new Error(
          `Founder access already includes Premium until ${founderExpiryLabel}.`
        );
      }

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

      const endpoint = '/api/billing/checkout';
      const body = {
        tier: 'pro',
        currency: selectedCurrency,
        accept_terms: acceptTerms,
        accept_privacy: acceptPrivacy,
        legal_terms_version: LEGAL_VERSION,
        legal_privacy_version: LEGAL_VERSION
      };

      trackEvent('pricing_upgrade_clicked', {
        tier: 'pro',
        currency: selectedCurrency
      });

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
      checkoutUrl.searchParams.set('sophia_kind', 'subscription');
      checkoutUrl.searchParams.set('sophia_plan', selected);
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

  $effect(() => {
    if (!founderSubscriptionLocked) return;
    if (selectedCheckoutCard === 'premium') {
      selectedCheckoutCard = null;
    }
  });
</script>

<svelte:head>
  <title>SOPHIA Pricing</title>
  <meta
    name="description"
    content="SOPHIA pricing for Free and Premium plans, with simple subscription billing."
  />
</svelte:head>

<main class="pricing sophia-page-shell">
  {#if !isAuthenticated}
    <PublicHeader
      links={[
        { href: '/#learn-track', label: 'Learn' },
        { href: '/#inquire-track', label: 'Think' },
        { href: '/pricing', label: 'Pricing' },
        { href: '/auth', label: 'Sign In' }
      ]}
    />
  {/if}

  <div class="pricing-content sophia-page-surface">
    <header class="header">
      <p class="eyebrow">Pricing</p>
      <h1>Simple plans for thoughtful people.</h1>
      <p>
        Start free, then upgrade to run more inquiries each month.
        Payments and taxes are managed securely through Paddle.
      </p>
      <p class="resource-note">
        Platform-funded daily inquiry allowances (without BYOK): Free 5 standard; Premium 20
        standard + 3 deep + 1 premium.
      </p>
      {#if founderOffer?.active}
        <p class="founder-callout">
          Founder access active: Premium included until {founderExpiryLabel} with
          {` £${(founderOffer.bonusWalletCents / 100).toFixed(2)}`} starter bonus credit.
        </p>
      {:else}
        <p class="founder-callout">
          Founder offer: first 50 users receive 12 months of Premium access.
        </p>
      {/if}
    </header>

    <section class="plans">
    <article class="plan">
      <h2>Curious Thinker</h2>
      <p class="price">£0</p>
      <ul>
        <li>Core SOPHIA query experience</li>
        <li>Daily platform inquiries: 5 standard runs (quick/standard)</li>
        <li>Monthly source additions: 2 shared references</li>
        <li>Learn quota: 2 micro-lessons + 1 short-answer review / month</li>
        <li>Bring your own API key (BYOK) supported without SOPHIA usage surcharges</li>
      </ul>
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
        <p class="price">{selectedCurrency === 'GBP' ? '£5 / month' : '$6.35 / month'}</p>
        {#if founderSubscriptionLocked}
          <p class="founder-tag">Included with Founder access</p>
        {/if}
        <ul>
          <li>Daily platform inquiries: 20 standard + 3 deep + 1 premium (no BYOK required)</li>
          <li>Monthly source additions: 5 shared, or 1 private + 3 shared</li>
          <li>Learn quota: unlimited micro/short lessons + 10 essay reviews / month</li>
          <li>Priority access to premium capabilities</li>
        </ul>
      </button>
      <div class="currency-controls">
        <label for="pro-currency-select">Checkout currency</label>
        <select
          id="pro-currency-select"
          bind:value={selectedCurrency}
          disabled={founderSubscriptionLocked}
        >
          <option value="GBP" disabled={!currencyOptionAvailability.GBP}>GBP (£)</option>
          <option value="USD" disabled={!currencyOptionAvailability.USD}>USD ($)</option>
        </select>
        {#if !canCheckoutSelectedCurrency}
          <p class="currency-hint">Selected currency is not configured for checkout.</p>
        {:else}
          <p class="currency-hint">You are upgrading on {selectedCurrencyLabel} pricing.</p>
        {/if}
      </div>
    </article>
    </section>

  <section class="notes">
    {#if showCheckoutFlow}
      <p class="resource-note">
        Review your selection, then proceed when you are ready.
      </p>
      {#if founderSubscriptionLocked}
        <p class="resource-note founder-note">
          Founder access already includes Premium. Subscription checkout is disabled until your founder period ends.
        </p>
      {/if}
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
          disabled={
            !selectedCheckoutCard
            || checkoutOpening
            || (legalAcceptanceRequired && (!acceptTerms || !acceptPrivacy))
            || !canCheckoutSelectedCurrency
            || (founderSubscriptionLocked && selectedCheckoutCard === 'premium')
          }
          onclick={openCheckoutFromSelection}
        >
          {checkoutOpening
            ? 'Opening checkout…'
            : `Upgrade to Pro (${selectedCurrency}) →`}
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
    <h2>Billing Notes</h2>
    <ul>
      <li>Billing is subscription-only with Free and Premium tiers.</li>
      <li>BYOK usage does not incur SOPHIA wallet fees or metered top-ups.</li>
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
  </div>
</main>

<style>
  .pricing {
    min-height: 100vh;
    color: var(--color-text);
  }

  .pricing-content {
    margin-top: 16px;
    padding: clamp(18px, 2.8vw, 32px);
  }

  .header {
    margin-top: 16px;
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

  .founder-callout {
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid var(--color-sage-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-sage) 12%, transparent);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 0.86rem;
    line-height: 1.45;
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

  .founder-tag {
    margin: 0 0 10px;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-sage);
  }

  .currency-controls {
    margin-top: 12px;
    display: grid;
    gap: 8px;
  }

  .currency-controls label {
    font-family: var(--font-ui);
    font-size: 0.82rem;
    color: var(--color-muted);
  }

  .currency-controls select {
    min-height: 36px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-surface-2, var(--color-surface));
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 0.9rem;
    padding: 8px 12px;
  }

  .currency-hint {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.8rem;
    color: var(--color-dim);
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

  .founder-note {
    color: var(--color-sage);
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
    min-height: 44px;
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
