<svelte:head>
  <title>SOPHIA — Structured Philosophical Reasoning</title>
  <meta
    name="description"
    content="SOPHIA is a consumer philosophical reasoning app with structured analysis, critique, and synthesis."
  />
</svelte:head>

<main class="landing">
  <section class="hero">
    <p class="eyebrow">Structured Philosophical Intelligence</p>
    <h1>SOPHIA helps you pressure-test difficult ideas.</h1>
    <p class="summary">
      Ask a philosophical question and SOPHIA runs a three-pass method: build the strongest case,
      challenge it, then synthesize what survives.
    </p>
    <div class="actions">
      <a class="button primary" href="/auth">Try SOPHIA</a>
      <a class="button secondary" href="/pricing">View pricing</a>
    </div>
  </section>

  <section class="grid">
    <article class="card">
      <h2>Three-pass reasoning</h2>
      <p>
        Every run includes analysis, critique, and synthesis so outputs are less hand-wavy and more
        defensible.
      </p>
    </article>
    <article class="card">
      <h2>Source-aware responses</h2>
      <p>
        Include your own links, choose whether they are private or public contributions, and keep
        control over what gets ingested.
      </p>
    </article>
    <article class="card">
      <h2>Consumer-friendly plans</h2>
      <p>
        Start free, upgrade for higher ingestion allowances, and use BYOK with prepaid wallet
        handling-fee metering.
      </p>
    </article>
  </section>

  <section class="trust">
    <h2>Before you sign in</h2>
    <p>
      Read our policies and plan details first:
      <a href="/terms">Terms</a>,
      <a href="/privacy">Privacy</a>,
      <a href="/pricing">Pricing</a>.
    </p>
  </section>
</main>

<style>
  .landing {
    min-height: 100vh;
    padding: 56px 20px 72px;
    max-width: 980px;
    margin: 0 auto;
    color: var(--color-text);
  }

  .hero {
    background: linear-gradient(145deg, rgba(127, 163, 131, 0.16), rgba(44, 96, 142, 0.12));
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: clamp(28px, 4vw, 44px);
  }

  .eyebrow {
    margin: 0 0 10px;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--color-sage);
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 4.6vw, 3rem);
    line-height: 1.1;
    max-width: 18ch;
  }

  .summary {
    margin: 16px 0 0;
    max-width: 62ch;
    color: var(--color-muted);
    font-size: 1.02rem;
    line-height: 1.6;
  }

  .actions {
    margin-top: 22px;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: 0 16px;
    border-radius: 8px;
    text-decoration: none;
    font-family: var(--font-ui);
    font-size: 0.88rem;
    letter-spacing: 0.01em;
    transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
  }

  .button:hover {
    transform: translateY(-1px);
  }

  .button.primary {
    background: var(--color-sage);
    color: var(--color-bg);
    border: 1px solid transparent;
  }

  .button.secondary {
    border: 1px solid var(--color-border);
    color: var(--color-text);
    background: var(--color-surface);
  }

  .grid {
    margin-top: 28px;
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .card {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: var(--color-surface);
    padding: 18px;
  }

  .card h2 {
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-size: 1.08rem;
  }

  .card p {
    margin: 0;
    color: var(--color-muted);
    line-height: 1.55;
    font-size: 0.95rem;
  }

  .trust {
    margin-top: 26px;
    border-top: 1px solid var(--color-border);
    padding-top: 16px;
  }

  .trust h2 {
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-size: 1.15rem;
  }

  .trust p {
    margin: 0;
    color: var(--color-muted);
  }

  .trust a {
    color: var(--color-blue);
    text-decoration: none;
  }

  .trust a:hover {
    text-decoration: underline;
  }
</style>

