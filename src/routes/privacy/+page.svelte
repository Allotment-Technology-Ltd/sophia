<svelte:head>
  <title>Privacy Policy — SOPHIA</title>
  <meta name="description" content="Privacy policy for SOPHIA, the philosophical reasoning engine by Allotment Technology Ltd." />
</svelte:head>

<div class="legal-page">
  <header class="legal-header">
    <a href="/" class="back-link">← Back to SOPHIA</a>
    <h1>Privacy Policy</h1>
    <p class="meta">Allotment Technology Ltd · Last updated: 9 March 2026</p>
  </header>

  <div class="legal-body">

    <section>
      <h2>1. Who we are</h2>
      <p>
        SOPHIA is operated by <strong>Allotment Technology Ltd</strong>, a company registered in England and
        Wales. Our ICO registration number is ZC092549.
      </p>
      <p>
        If you have any questions about this policy or how we handle your data, contact us at
        <a href="mailto:admin@usesophia.app">admin@usesophia.app</a>.
      </p>
    </section>

    <section>
      <h2>2. What data we collect and why</h2>

      <h3>Account data</h3>
      <p>
        When you sign in, we receive your name, email address, and profile picture from Google via
        Firebase Authentication. We use this to identify your account, associate your query history
        with you, and enforce per-user rate limits. We do not store your Google password.
      </p>

      <h3>Query data</h3>
      <p>
        Queries you submit to SOPHIA are stored in our database, associated with your account, for
        up to 30 days. We store queries to power your personal history panel and to serve cached
        results for repeated queries. Queries are not shared with other users.
      </p>

      <h3>Usage data</h3>
      <p>
        We collect anonymous usage data — including which features are used, how long analyses take,
        and error rates — to improve the service. This data is not linked to your identity.
      </p>

      <h3>Technical data</h3>
      <p>
        Our infrastructure provider (Google Cloud Platform) automatically logs IP addresses,
        request timestamps, and HTTP headers for security and reliability purposes. These logs are
        retained for up to 30 days and are not used for profiling.
      </p>
    </section>

    <section>
      <h2>3. How we store and protect your data</h2>
      <p>
        Your data is stored and processed in Google Cloud Platform infrastructure in the
        <strong>europe-west2 (London)</strong> region. We use the following services:
      </p>
      <ul>
        <li><strong>Firebase Authentication</strong> — identity and session management</li>
        <li><strong>Firestore</strong> — per-user query history and rate-limit counters</li>
        <li><strong>Cloud Run</strong> — application server (stateless; no persistent user data)</li>
        <li><strong>SurrealDB on Google Compute Engine</strong> — philosophical knowledge graph
          (no personally identifiable information stored here)</li>
      </ul>
      <p>
        All data in transit is encrypted via TLS. Data at rest is encrypted by Google Cloud's default
        encryption. Access to production infrastructure is restricted to authorised personnel only,
        using Google Cloud IAM and Identity-Aware Proxy.
      </p>
    </section>

    <section>
      <h2>4. Who we share your data with</h2>
      <p>
        We do not sell your data. We share data only with the following sub-processors, each bound by
        their own data processing terms:
      </p>
      <ul>
        <li><strong>Google LLC</strong> — Firebase Auth, Firestore, Cloud Run, Vertex AI (query
          processing). Google's data processing terms apply. Queries you submit are processed by
          Google's Vertex AI service to generate responses.</li>
        <li><strong>Anthropic PBC</strong> — used only in our offline ingestion pipeline to build
          the knowledge graph. Your queries are never sent to Anthropic at runtime.</li>
      </ul>
      <p>
        We may disclose data if required to by law, regulation, or court order.
      </p>
    </section>

    <section>
      <h2>5. Cookies and local storage</h2>
      <p>
        SOPHIA uses browser local storage to maintain your authentication session (Firebase
        Authentication). We do not use third-party advertising or tracking cookies.
      </p>
    </section>

    <section>
      <h2>6. Your rights</h2>
      <p>
        Under UK GDPR, you have the following rights:
      </p>
      <ul>
        <li><strong>Access</strong> — request a copy of the personal data we hold about you</li>
        <li><strong>Rectification</strong> — ask us to correct inaccurate data</li>
        <li><strong>Erasure</strong> — ask us to delete your account and associated data</li>
        <li><strong>Restriction</strong> — ask us to pause processing of your data</li>
        <li><strong>Portability</strong> — receive your data in a machine-readable format</li>
        <li><strong>Objection</strong> — object to processing based on legitimate interests</li>
      </ul>
      <p>
        To exercise any of these rights, email us at
        <a href="mailto:admin@usesophia.app">admin@usesophia.app</a>. We will respond within 30 days.
        You also have the right to lodge a complaint with the
        <a href="https://ico.org.uk" rel="noopener noreferrer" target="_blank">
          Information Commissioner's Office (ICO)
        </a>.
      </p>
    </section>

    <section>
      <h2>7. Children</h2>
      <p>
        SOPHIA is not intended for users under the age of 18. We do not knowingly collect data from
        children. If you believe we have inadvertently collected data from a child, please contact us
        immediately.
      </p>
    </section>

    <section>
      <h2>8. Data retention</h2>
      <p>
        Query history is retained for 30 days, after which it is automatically deleted. Account data
        (name, email) is retained for as long as your account is active. You may request deletion at
        any time by contacting us.
      </p>
    </section>

    <section>
      <h2>9. Changes to this policy</h2>
      <p>
        We may update this policy as the service evolves. Material changes will be notified via the
        email address associated with your account. Continued use of SOPHIA after the effective date
        of a change constitutes acceptance of the updated policy.
      </p>
    </section>

    <section>
      <h2>10. Contact</h2>
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
    margin: 0;
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
