<script lang="ts">
  interface Props {
    pass: 'analysis' | 'critique' | 'synthesis';
  }

  let { pass }: Props = $props();

  const labels: Record<string, string> = {
    analysis: 'Analysis',
    critique: 'Critique',
    synthesis: 'Synthesis',
  };
</script>

<span class="badge badge-{pass}">{labels[pass]}</span>

<style>
  .badge {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 2px;
    display: inline-block;
    white-space: nowrap;
  }

  .badge-analysis {
    background: var(--color-sage-bg);
    border: 1px solid var(--color-sage-border);
    color: var(--color-sage);
  }

  .badge-critique {
    background: var(--color-copper-bg);
    border: 1px solid var(--color-copper-border);
    color: var(--color-copper);
  }

  .badge-synthesis {
    background: var(--color-blue-bg);
    border: 1px solid var(--color-blue-border);
    color: var(--color-blue);
  }
</style>
