<script lang="ts">
  let { data } = $props();
</script>

<main class="obs-page">
  <h1>Stoa Observability</h1>
  <p>Grounding mode rates, escalation rate, and error taxonomy.</p>

  <section class="grid">
    <article class="card"><h2>Total events</h2><p>{data.summary.total}</p></article>
    <article class="card"><h2>Graph dense</h2><p>{data.summary.graphDense}</p></article>
    <article class="card"><h2>Lexical fallback</h2><p>{data.summary.lexicalFallback}</p></article>
    <article class="card"><h2>Degraded none</h2><p>{data.summary.degradedNone}</p></article>
    <article class="card"><h2>Escalated</h2><p>{data.summary.escalated}</p></article>
  </section>

  <section class="card">
    <h2>Error taxonomy</h2>
    {#if data.summary.errors.length === 0}
      <p>No recorded errors.</p>
    {:else}
      {#each data.summary.errors as item}
        <p>{item.taxonomy}: {item.count}</p>
      {/each}
    {/if}
  </section>
</main>

<style>
  .obs-page {
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-5) var(--space-4);
    display: grid;
    gap: var(--space-4);
  }
  .grid {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }
  .card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    background: var(--color-surface);
  }
  .card h2 {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--text-meta);
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .card p {
    margin: 0 0 var(--space-2) 0;
  }
</style>

