<script lang="ts">
  interface Props {
    currentPass?: string | null;
    completedPasses?: string[];
  }

  let { currentPass = null, completedPasses = [] }: Props = $props();

  const passes = ['analysis', 'critique', 'synthesis'] as const;
  const labels: Record<string, string> = {
    analysis: 'Foundations',
    critique: 'Challenges',
    synthesis: 'Resolution',
  };
</script>

<div class="tracker" role="list" aria-label="Inquiry progress">
  {#each passes as pass, i}
    {#if i > 0}
      <div
        class="connector"
        class:filled={completedPasses.includes(passes[i - 1])}
        aria-hidden="true"
      ></div>
    {/if}

    <div
      class="pass-node"
      class:active={currentPass === pass}
      class:complete={completedPasses.includes(pass)}
      role="listitem"
    >
      <div class="node" aria-hidden="true">
        {#if completedPasses.includes(pass)}
          <svg class="check" width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
            <polyline points="1,3 2.5,4.5 5,1.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {/if}
      </div>
      <div class="pass-label" class:active={currentPass === pass} class:complete={completedPasses.includes(pass)}>
        {labels[pass]}
      </div>
      <div class="pass-status">
        {#if currentPass === pass}
          Exploring…
        {:else if completedPasses.includes(pass)}
          Complete
        {:else}
          Queued
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
    transition: background 600ms ease;
  }

  .connector.filled {
    background: var(--color-sage);
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
    background: transparent;
    border: 1px solid var(--color-dim);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 300ms ease, border-color 300ms ease, transform 300ms ease;
  }

  /* Queued → Active: scale in and pulse */
  .pass-node.active .node {
    background: var(--color-sage);
    border-color: var(--color-sage);
    animation: nodePulse 2s ease-in-out infinite, nodeEnter 200ms ease both;
  }

  /* Active → Complete: bright fill, then settle to sage-dim */
  .pass-node.complete .node {
    background: var(--color-sage);
    border-color: var(--color-sage);
    animation: nodeComplete 500ms ease both;
  }

  .check {
    opacity: 0;
    animation: checkAppear 300ms 200ms ease both;
  }

  .pass-label {
    font-family: var(--font-ui);
    font-size: 0.6rem;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--color-muted);
    white-space: nowrap;
    transition: color var(--transition-fast);
  }

  .pass-label.active {
    color: var(--color-sage);
  }

  .pass-label.complete {
    color: var(--color-muted);
  }

  .pass-status {
    font-family: var(--font-ui);
    font-size: 0.55rem;
    color: var(--color-muted);
    white-space: nowrap;
    transition: color var(--transition-fast);
  }

  .pass-node.active .pass-status {
    color: var(--color-sage);
  }

  .pass-node.complete .pass-status {
    color: var(--color-muted);
  }

  @keyframes nodeEnter {
    from { transform: scale(0.4); opacity: 0; }
    to   { transform: scale(1);   opacity: 1; }
  }

  @keyframes nodeComplete {
    0%   { transform: scale(1);    background: var(--color-sage); }
    40%  { transform: scale(1.4);  background: var(--color-text); }
    100% { transform: scale(1);    background: var(--color-sage); }
  }

  @keyframes checkAppear {
    from { opacity: 0; transform: scale(0); }
    to   { opacity: 1; transform: scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .pass-node.active .node {
      animation: none;
    }
    .pass-node.complete .node {
      animation: none;
    }
    .check {
      animation: none;
      opacity: 1;
    }
    .connector {
      transition: none;
    }
  }
</style>
