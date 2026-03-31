<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { auth, onAuthChange } from '$lib/authClient';
  import PublicHeader from '$lib/components/shell/PublicHeader.svelte';
  import {
    LEGAL_CHANGELOG_PATH,
    LEGAL_EFFECTIVE_DATE,
    LEGAL_VERSION
  } from '$lib/constants/legal';

  let {
    data
  }: {
    data: {
      isAuthenticated: boolean;
    };
  } = $props();
  let clientAuthResolved = $state(false);
  let clientAuthenticated = $state(false);
  let isAuthenticated = $derived(clientAuthResolved ? clientAuthenticated : Boolean(data.isAuthenticated));

  onMount(() => {
    if (!browser) return;
    clientAuthenticated = Boolean(auth?.currentUser) || Boolean(data.isAuthenticated);
    clientAuthResolved = true;
    const unsubscribe = onAuthChange((user) => {
      clientAuthenticated = Boolean(user);
      clientAuthResolved = true;
    });
    return () => unsubscribe?.();
  });
</script>

<svelte:head>
  <title>Terms of Service - SOPHIA</title>
  <meta
    name="description"
    content="Terms of service for SOPHIA, including subscription, top-up, BYOK handling fees, and source contribution rules."
  />
</svelte:head>

<div class="legal-page sophia-page-shell">
  {#if !isAuthenticated}
    <PublicHeader
      links={[
        { href: '/#learn-track', label: 'Learn' },
        { href: '/#inquire-track', label: 'Think' },
        { href: '/pricing', label: 'Pricing' },
        { href: '/early-access', label: 'Sign In' }
      ]}
    />
  {/if}
  <div class="legal-surface sophia-page-surface">
    <header class="legal-header">
      <h1>Terms of Service</h1>
      <p class="meta">
        Allotment Technology Ltd · Version {LEGAL_VERSION} · Effective {LEGAL_EFFECTIVE_DATE}
      </p>
      <p class="meta">
        <a href={LEGAL_CHANGELOG_PATH}>View legal changelog</a>
      </p>
    </header>

    <div class="legal-body">
    <section>
      <h2>1. Agreement and Eligibility</h2>
      <p>
        By using SOPHIA, you agree to these Terms. If you do not agree, do not use the service.
        You must be at least 18 years old.
      </p>
      <p>
        Operator: <strong>Allotment Technology Ltd</strong>. Contact:
        <a href="mailto:admin@usesophia.app">admin@usesophia.app</a>
      </p>
    </section>

    <section>
      <h2>2. Service Overview</h2>
      <p>
        SOPHIA is a consumer AI reasoning product for philosophical analysis. Outputs are for
        research and learning purposes and are not professional advice.
      </p>
    </section>

    <section>
      <h2>3. Subscription Plans and Entitlements</h2>
      <p>
        SOPHIA offers Free, Pro, and Premium plans. Plan features and limits may change with notice.
      </p>
      <ul>
        <li><strong>Free</strong>: limited usage and ingestion entitlements.</li>
        <li><strong>Pro</strong>: increased limits and access to paid features.</li>
        <li><strong>Premium</strong>: further increased limits and premium capabilities.</li>
      </ul>
      <p>
        Entitlements may depend on billing status and may reset monthly.
      </p>
    </section>

    <section>
      <h2>4. Billing, Auto-Renewal, and Price Changes</h2>
      <p>
        Payments are processed by Paddle as Merchant of Record. Subscriptions auto-renew unless
        canceled through your billing portal before renewal.
      </p>
      <p>
        We may change prices prospectively. Where required by law, we provide advance notice before
        changes take effect.
      </p>
      <p>
        You are responsible for keeping payment details current.
      </p>
    </section>

    <section>
      <h2>5. Subscription Billing and BYOK</h2>
      <p>
        SOPHIA billing is subscription-only with Free and Philosopher&apos;s Desk tiers. BYOK usage
        does not require wallet top-ups and does not incur SOPHIA handling-fee charges.
      </p>
      <p>
        Billing and subscription events are tracked with idempotent event keys for auditability.
      </p>
    </section>

    <section>
      <h2 id="refund-policy">6. Refund Policy</h2>
      <p>
        Payments are non-refundable except where refund rights are required by applicable law.
      </p>
    </section>

    <section>
      <h2>7. Source Ingestion, Ownership, and Contribution License</h2>
      <p>
        You may choose ingestion visibility for submitted sources:
      </p>
      <ul>
        <li><code>private_user_only</code>: source remains available only to your account.</li>
        <li><code>public_shared</code>: source may be added to SOPHIA's shared service knowledge base.</li>
      </ul>
      <p>
        For <code>public_shared</code> submissions, you grant Allotment Technology Ltd a perpetual,
        worldwide, non-exclusive, royalty-free license to host, process, transform, and use the
        contribution to operate and improve SOPHIA.
      </p>
      <p>
        Private sources may be deleted by the owning user through supported controls. Public shared
        sources and shared derivatives are not user-deletable once contributed.
      </p>
      <p>
        You represent that you have rights to submit and share any source you ingest.
      </p>
    </section>

    <section>
      <h2>8. Acceptable Use and Abuse Controls</h2>
      <p>You must not:</p>
      <ul>
        <li>Use SOPHIA for illegal, abusive, or harmful purposes.</li>
        <li>Circumvent limits, billing controls, or authentication.</li>
        <li>Automate abusive scraping, key misuse, or fraudulent top-up behavior.</li>
        <li>Upload content you are not authorized to process or share.</li>
      </ul>
      <p>
        We may rate-limit, suspend, or terminate accounts for abuse, fraud, or policy violations.
      </p>
    </section>

    <section>
      <h2>9. Intellectual Property</h2>
      <p>
        SOPHIA software and service design are protected by applicable IP law. These Terms do not
        transfer ownership of SOPHIA IP to you.
      </p>
      <p>
        You retain rights in your private submissions subject to the licenses needed to operate the
        service.
      </p>
    </section>

    <section>
      <h2>10. Disclaimers</h2>
      <p>
        SOPHIA is provided "as is" and "as available" without warranties of uninterrupted operation,
        accuracy, or fitness for a particular purpose.
      </p>
    </section>

    <section>
      <h2>11. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, Allotment Technology Ltd is not liable for indirect,
        incidental, special, consequential, or punitive damages.
      </p>
      <p>
        Aggregate liability for any claim is limited to amounts paid by you in the previous 12 months
        (or GBP 50 if you have paid nothing), except where such limits are not permitted by law.
      </p>
    </section>

    <section>
      <h2>12. Suspension and Termination</h2>
      <p>
        You may stop using SOPHIA at any time. We may suspend or terminate access for violations,
        abuse, fraud, legal risk, or operational reasons.
      </p>
    </section>

    <section>
      <h2>13. Changes to Terms</h2>
      <p>
        We may update these Terms. Material changes are reflected by a new legal version, effective
        date, and changelog entry.
      </p>
    </section>

    <section>
      <h2>14. Governing Law</h2>
      <p>
        These Terms are governed by the laws of England and Wales, without prejudice to mandatory
        consumer protections in your place of residence where applicable.
      </p>
    </section>

    <section>
      <h2>15. Contact</h2>
      <p>
        Allotment Technology Ltd<br />
        <a href="mailto:admin@usesophia.app">admin@usesophia.app</a>
      </p>
    </section>
    </div>
  </div>
</div>

<style>
  .legal-page {
    color: var(--color-text);
    font-family: var(--font-ui);
  }

  .legal-surface {
    width: 100%;
    margin-top: 16px;
    padding: clamp(20px, 3vw, 36px);
  }

  .legal-header {
    margin-bottom: 3rem;
    max-width: 860px;
  }

  .legal-body {
    max-width: 860px;
  }

  h1 {
    font-family: var(--font-display);
    font-size: 2.25rem;
    font-weight: 400;
    margin: 0 0 0.5rem;
    color: var(--color-text);
  }

  .meta {
    color: var(--color-muted);
    font-size: 0.875rem;
    margin: 0 0 0.35rem;
  }

  .legal-body section {
    margin-bottom: 2.5rem;
    border-top: 1px solid var(--color-dim);
    padding-top: 1.5rem;
  }

  h2 {
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 1.25rem;
    font-weight: 400;
    margin: 0 0 1rem;
    color: var(--color-text);
  }

  p {
    font-size: 0.9375rem;
    line-height: 1.7;
    color: var(--color-text);
    margin: 0 0 0.75rem;
  }

  ul {
    margin: 0.5rem 0 0.75rem 1.25rem;
    padding: 0;
  }

  li {
    font-size: 0.9375rem;
    line-height: 1.7;
    margin-bottom: 0.25rem;
    color: var(--color-text);
  }

  a {
    color: var(--color-blue);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
