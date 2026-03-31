<script lang="ts">
  interface PassDelta {
    pass: 'analysis' | 'critique' | 'synthesis';
    introduced_violations: string[];
    resolved_violations: string[];
    unresolved_violations: string[];
    overall_compliance: 'pass' | 'partial' | 'fail';
  }

  interface Props {
    deltas?: PassDelta[];
  }

  let { deltas = [] }: Props = $props();

  function passLabel(pass: PassDelta['pass']): string {
    if (pass === 'analysis') return 'Analysis';
    if (pass === 'critique') return 'Critique';
    return 'Synthesis';
  }
</script>

{#if deltas.length > 0}
  <section class="constitution-panel" aria-label="Constitution impact by pass">
    <header>
      <h3>Constitution Impact</h3>
      <p>How rule-violations changed across passes.</p>
    </header>

    <div class="rows">
      {#each deltas as delta}
        <article class="row">
          <strong>{passLabel(delta.pass)}</strong>
          <span>+{delta.introduced_violations.length} introduced</span>
          <span>-{delta.resolved_violations.length} resolved</span>
          <span>{delta.unresolved_violations.length} unresolved</span>
          <span class="compliance {delta.overall_compliance}">{delta.overall_compliance}</span>
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .constitution-panel {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 3px;
    padding: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }

  header h3 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.85rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text);
  }

  header p {
    margin: 4px 0 0;
    font-family: var(--font-ui);
    font-size: 0.74rem;
    color: var(--color-muted);
  }

  .rows {
    display: grid;
    gap: 6px;
  }

  .row {
    display: grid;
    grid-template-columns: 100px repeat(4, minmax(0, 1fr));
    gap: 8px;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-muted);
    align-items: center;
  }

  .compliance {
    justify-self: end;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .compliance.pass { color: var(--color-sage); }
  .compliance.partial { color: var(--color-amber); }
  .compliance.fail { color: var(--color-copper); }

  @media (max-width: 780px) {
    .row {
      grid-template-columns: 1fr 1fr;
    }

    .compliance {
      justify-self: start;
    }
  }
</style>
