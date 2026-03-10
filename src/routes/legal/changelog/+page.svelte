<svelte:head>
  <title>Legal Changelog - SOPHIA</title>
  <meta
    name="description"
    content="Versioned changelog for SOPHIA legal documents."
  />
</svelte:head>

<div class="legal-page">
  <header class="legal-header">
    <a href="/" class="back-link">← Back to SOPHIA</a>
    <h1>Legal Changelog</h1>
    <p class="meta">Allotment Technology Ltd</p>
  </header>

  <div class="legal-body">
    <section>
      <h2>Version 2026-03-10</h2>
      <p class="meta-row">Effective date: 10 March 2026</p>
      <ul>
        <li>Added Paddle merchant-of-record billing and subscription disclosures.</li>
        <li>Added BYOK wallet and 10% handling-fee metering disclosures.</li>
        <li>Added ingestion visibility choices for public vs private sources.</li>
        <li>Added retention schedule details for billing ledgers and source ownership records.</li>
        <li>Added subscription terms, cancellation, price-change notice, and no-refund-except-law language.</li>
        <li>Added contribution licensing terms for public shared sources and deletion rights for private sources.</li>
      </ul>
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
    margin-bottom: 2rem;
  }

  .back-link {
    display: inline-block;
    color: var(--color-muted);
    text-decoration: none;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  .back-link:hover {
    color: var(--color-text);
  }

  h1 {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 400;
    margin: 0 0 0.35rem;
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.2rem;
    font-weight: 500;
  }

  .meta {
    color: var(--color-muted);
    font-size: 0.875rem;
    margin: 0;
  }

  .meta-row {
    color: var(--color-muted);
    margin: 0 0 0.75rem;
  }

  .legal-body section {
    border-top: 1px solid var(--color-dim);
    padding-top: 1.2rem;
  }

  ul {
    margin: 0.4rem 0 0 1.2rem;
    padding: 0;
  }

  li {
    margin-bottom: 0.35rem;
    line-height: 1.5;
  }
</style>
