<script lang="ts">
  interface Props {
    currentPass?: string | null;
    completedPasses?: string[];
  }

  let { currentPass = null, completedPasses = [] }: Props = $props();

  const passes = ['analysis', 'critique', 'synthesis'] as const;
  const labels: Record<string, string> = {
    analysis: 'Analysis',
    critique: 'Critique',
    synthesis: 'Synthesis',
  };
</script>

<div class="tracker" role="list" aria-label="Analysis progress">
  {#each passes as pass, i}
    {#if i > 0}
      <div class="connector" aria-hidden="true"></div>
    {/if}

    <div
      class="pass-node"
      class:active={currentPass === pass}
      class:complete={completedPasses.includes(pass)}
      role="listitem"
    >
      <div class="node" aria-hidden="true"></div>
      <div class="pass-label" class:active={currentPass === pass}>
        {labels[pass]}
      </div>
      <div class="pass-status">
        {#if currentPass === pass}
          Streaming now…
        {:else if completedPasses.includes(pass)}
          Complete
        {:else}
          Waiting
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .tracker {
    display: flex;
    align-items: flex-start;
    gap: 0;
  }

  .connector {
    flex: 1;
    height: 1px;
    background: var(--color-border);
    margin-top: 5px;
    min-width: 24px;
  }

  .pass-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .node {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-dim);
    border: 1px solid var(--color-dim);
    flex-shrink: 0;
  }

  .pass-node.active .node {
    background: var(--color-sage);
    border-color: var(--color-sage);
    animation: nodePulse 2s ease-in-out infinite;
  }

  .pass-node.complete .node {
    background: var(--color-dim);
    border-color: var(--color-dim);
  }

  /* Waiting node: empty circle */
  .pass-node:not(.active):not(.complete) .node {
    background: transparent;
    border: 1px solid var(--color-dim);
  }

  .pass-label {
    font-family: var(--font-ui);
    font-size: 0.6rem;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--color-dim);
    white-space: nowrap;
    transition: color var(--transition-fast);
  }

  .pass-label.active {
    color: var(--color-text);
  }

  .pass-status {
    font-family: var(--font-ui);
    font-size: 0.55rem;
    color: var(--color-dim);
    white-space: nowrap;
  }

  .pass-node.active .pass-status {
    color: var(--color-sage);
  }

  .pass-node.complete .pass-status {
    color: var(--color-dim);
  }

  @media (prefers-reduced-motion: reduce) {
    .pass-node.active .node {
      animation: none;
    }
  }
</style>
