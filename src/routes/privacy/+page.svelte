<script lang="ts">
  import {
    LEGAL_CHANGELOG_PATH,
    LEGAL_EFFECTIVE_DATE,
    LEGAL_VERSION
  } from '$lib/constants/legal';
</script>

<svelte:head>
  <title>Privacy Policy - SOPHIA</title>
  <meta
    name="description"
    content="Privacy policy for SOPHIA, including billing, BYOK wallet metering, and ingestion visibility controls."
  />
</svelte:head>

<div class="legal-page">
  <header class="legal-header">
    <a href="/" class="back-link">← Back to SOPHIA</a>
    <h1>Privacy Policy</h1>
    <p class="meta">
      Allotment Technology Ltd · Version {LEGAL_VERSION} · Effective {LEGAL_EFFECTIVE_DATE}
    </p>
    <p class="meta">
      <a href={LEGAL_CHANGELOG_PATH}>View legal changelog</a>
    </p>
  </header>

  <div class="legal-body">
    <section>
      <h2>1. Who We Are</h2>
      <p>
        SOPHIA is operated by <strong>Allotment Technology Ltd</strong> (England and Wales).
        We act as the controller for personal data described in this policy. ICO registration:
        ZC092549.
      </p>
      <p>
        Contact: <a href="mailto:admin@usesophia.app">admin@usesophia.app</a>
      </p>
    </section>

    <section>
      <h2>2. Data We Process</h2>

      <h3>Account and Authentication</h3>
      <p>
        We receive your name, email address, and account identifiers from Firebase Authentication
        when you sign in.
      </p>

      <h3>Billing and Payments (Paddle as Merchant of Record)</h3>
      <p>
        Paddle processes subscription and top-up payments as Merchant of Record. We do not store
        your full card details. We store billing profile metadata such as tier, subscription status,
        currency, provider customer/subscription IDs, and legal acceptance version records.
      </p>

      <h3>BYOK Wallet and Handling-Fee Metering</h3>
      <p>
        For BYOK usage, we maintain a prepaid wallet and billing ledger entries. On eligible
        non-cached BYOK runs, we may compute and charge a handling fee based on estimated model cost.
        We store idempotent run-linked ledger events for audit and dispute handling.
      </p>

      <h3>Queries, Sources, and Ingestion Preferences</h3>
      <p>
        We store query history, selected runtime links, and ingestion preferences. If you mark a
        source as <code>public_shared</code>, it may be incorporated into SOPHIA's shared
        knowledge base. If you mark a source as <code>private_user_only</code>, retrieval and
        management are restricted to your account.
      </p>

      <h3>Operational and Security Data</h3>
      <p>
        We process request metadata (for example IP address, user agent, timestamps, and service
        logs) for reliability, fraud prevention, abuse control, and incident response.
      </p>
    </section>

    <section>
      <h2>3. Why We Process Data (Legal Bases)</h2>
      <ul>
        <li><strong>Contract</strong>: provide the app, subscriptions, top-ups, and account features.</li>
        <li><strong>Legitimate interests</strong>: service security, abuse prevention, diagnostics, and product improvement.</li>
        <li><strong>Legal obligation</strong>: tax/accounting records, law enforcement requests, and consumer law compliance.</li>
        <li><strong>Consent</strong>: explicit confirmations for public source sharing and legal-acceptance flows.</li>
      </ul>
      <p>
        For UK and EU users, rights are provided under UK GDPR/EU GDPR. For US users, we apply a
        baseline consumer disclosure approach and honor applicable state rights requests where required.
      </p>
    </section>

    <section>
      <h2>4. Sharing and Sub-processors</h2>
      <p>
        We do not sell personal data. We share data with vendors only to provide SOPHIA:
      </p>
      <ul>
        <li><strong>Google</strong>: Firebase Auth, Firestore, Cloud infrastructure, and model/runtime services.</li>
        <li><strong>Paddle</strong>: billing checkout, subscriptions, customer portal, payment administration.</li>
        <li><strong>Model providers</strong>: BYOK and platform model calls according to your selected run configuration.</li>
      </ul>
      <p>
        We may disclose data where required by law, regulation, or valid legal process.
      </p>
    </section>

    <section>
      <h2>5. International Transfers</h2>
      <p>
        Some processors may handle data outside the UK/EEA, including in the US. Where required,
        we rely on appropriate transfer mechanisms (for example contractual safeguards and equivalent
        protections made available by our providers).
      </p>
    </section>

    <section>
      <h2>6. Retention Schedule</h2>
      <ul>
        <li><strong>Query history/cache events</strong>: typically up to 30 days unless longer retention is required for active debugging or legal compliance.</li>
        <li><strong>Billing profile and subscription records</strong>: retained while account is active and as required for finance/tax obligations.</li>
        <li><strong>Billing ledger events (wallet, top-ups, BYOK fees)</strong>: up to 7 years for accounting, fraud, and audit purposes.</li>
        <li><strong>Private sources</strong>: retained until user deletion or account deletion, subject to backup and legal retention windows.</li>
        <li><strong>Public contribution records</strong>: retained as part of the shared service knowledge base and associated audit trail.</li>
        <li><strong>Infrastructure/security logs</strong>: typically up to 30 days unless needed for incident response.</li>
      </ul>
    </section>

    <section>
      <h2>7. Your Rights</h2>
      <p>
        Depending on your location and applicable law, you may request access, correction,
        deletion, portability, restriction, or objection. You may also request account deletion,
        private-source deletion, and billing-data access.
      </p>
      <p>
        Send requests to <a href="mailto:admin@usesophia.app">admin@usesophia.app</a>. We may
        verify identity before acting.
      </p>
      <p>
        UK users can complain to the
        <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer">ICO</a>.
      </p>
    </section>

    <section>
      <h2>8. Children</h2>
      <p>
        SOPHIA is intended for users 18+ and is not directed to children.
      </p>
    </section>

    <section>
      <h2>9. Security</h2>
      <p>
        We use technical and organizational controls, including encryption in transit,
        role-based access controls, and production access restrictions.
      </p>
    </section>

    <section>
      <h2>10. Changes</h2>
      <p>
        We may update this policy. Material updates will be reflected by a new legal version,
        effective date, and changelog entry.
      </p>
    </section>

    <section>
      <h2>11. Contact</h2>
      <p>
        Allotment Technology Ltd<br />
        <a href="mailto:admin@usesophia.app">admin@usesophia.app</a>
      </p>
    </section>
  </div>
</div>

<style>
  .legal-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 3rem 1.5rem 5rem;
    color: var(--color-text);
    font-family: var(--font-ui);
  }

  .legal-header {
    margin-bottom: 3rem;
  }

  .back-link {
    display: inline-block;
    color: var(--color-muted);
    text-decoration: none;
    font-size: 0.875rem;
    margin-bottom: 1.5rem;
  }

  .back-link:hover {
    color: var(--color-text);
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
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 400;
    margin: 0 0 1rem;
    color: var(--color-text);
  }

  h3 {
    font-size: 0.9rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted);
    margin: 1.25rem 0 0.5rem;
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
