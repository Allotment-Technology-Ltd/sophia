<svelte:head>
  <title>Graph Filters Guide — SOPHIA</title>
</svelte:head>

<main class="help-shell">
  <article class="help-card">
    <p class="eyebrow">Support Guide</p>
    <h1>Graph Visualisation Filters</h1>
    <p class="lead">
      Use this guide to understand what each map control changes and how to inspect argument quality, traversal depth, and contradictions.
    </p>

    <section>
      <h2>Top Controls</h2>
      <ul>
        <li><strong>Structure / Reasoning Flow / Trust:</strong> Switches visual emphasis from topology to phase progression to confidence hotspots.</li>
        <li><strong>Relation filters:</strong> Toggle edge types like <code>supports</code>, <code>contradicts</code>, and <code>assumes</code>.</li>
        <li><strong>Filter Guide:</strong> Opens this page.</li>
        <li><strong>Share View:</strong> Copies the current map state into a link.</li>
      </ul>
    </section>

    <section>
      <h2>Timeline, Lens, Density</h2>
      <ul>
        <li><strong>Timeline:</strong> Restricts graph edges to a selected reasoning phase.</li>
        <li><strong>Lens:</strong> Focuses on seed nodes, traversed nodes, or run-comparison deltas.</li>
        <li><strong>Density:</strong> <em>Beginner</em> reduces clutter; <em>Expert</em> keeps the full structure.</li>
      </ul>
    </section>

    <section>
      <h2>Expert Filters</h2>
      <ul>
        <li><strong>Pass:</strong> Include/exclude phases quickly.</li>
        <li><strong>Confidence:</strong> Focus on high/medium/low confidence regions.</li>
        <li><strong>Source and Domain:</strong> Narrow the map to specific source clusters.</li>
      </ul>
    </section>

    <section>
      <h2>Comparison Lenses</h2>
      <ul>
        <li><strong>New vs baseline:</strong> Shows claims/relations present in the current run but not the comparison baseline.</li>
        <li><strong>Shared with baseline:</strong> Shows overlap between runs.</li>
      </ul>
    </section>
  </article>
</main>

<style>
  .help-shell {
    min-height: calc(100vh - var(--nav-height));
    padding: var(--space-5) var(--space-4);
    background: var(--color-bg);
    color: var(--color-text);
  }

  .help-card {
    max-width: 860px;
    margin: 0 auto;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 4px;
    padding: var(--space-5);
    display: grid;
    gap: var(--space-4);
  }

  .eyebrow {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  h1 {
    margin: 0;
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 2rem;
    font-weight: 400;
    line-height: 1.2;
  }

  .lead {
    margin: 0;
    font-family: var(--font-ui);
    color: var(--color-muted);
    line-height: 1.55;
  }

  section {
    display: grid;
    gap: 8px;
  }

  h2 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text);
  }

  ul {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 8px;
    font-family: var(--font-ui);
    color: var(--color-muted);
    line-height: 1.5;
  }

  li strong {
    color: var(--color-text);
  }

  @media (max-width: 767px) {
    .help-shell {
      padding: var(--space-3);
    }

    .help-card {
      padding: var(--space-3);
    }

    h1 {
      font-size: 1.55rem;
    }
  }
</style>
