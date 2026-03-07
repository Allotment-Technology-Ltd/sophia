<script lang="ts">
  interface Props {
    activePass?: string;
    completedPasses?: string[];
    onSelect?: (pass: string) => void;
  }

  let { activePass = 'analysis', completedPasses = [], onSelect }: Props = $props();

  const passes = ['analysis', 'critique', 'synthesis'] as const;
  const labels: Record<string, string> = {
    analysis: 'Analysis',
    critique: 'Critique',
    synthesis: 'Synthesis',
  };
</script>

<nav class="navigator" aria-label="Pass navigation">
  {#each passes as pass}
    <button
      class="nav-item"
      class:active={activePass === pass}
      onclick={() => onSelect?.(pass)}
      aria-current={activePass === pass ? 'page' : undefined}
    >
      <span class="nav-label">{labels[pass]}</span>
      {#if completedPasses.includes(pass)}
        <span class="check" aria-label="Complete">✓</span>
      {/if}
    </button>
  {/each}
</nav>

<style>
  .navigator {
    width: 200px;
    display: flex;
    flex-direction: column;
  }

  .nav-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    font-family: var(--font-display);
    font-size: 0.9rem;
    font-weight: 300;
    color: var(--color-muted);
    background: none;
    border: none;
    border-left: 2px solid transparent;
    cursor: pointer;
    text-align: left;
    transition: color var(--transition-fast), border-color var(--transition-fast);
  }

  .nav-item:hover {
    color: var(--color-text);
  }

  .nav-item.active {
    color: var(--color-text);
    border-left-color: var(--color-sage);
  }

  .nav-label {
    flex: 1;
  }

  .check {
    font-family: var(--font-ui);
    font-size: 0.6rem;
    color: var(--color-dim);
    margin-left: var(--space-2);
  }

  @media (max-width: 767px) {
    .navigator {
      width: 100%;
      flex-direction: row;
      overflow-x: auto;
      border-bottom: 1px solid var(--color-border);
      padding-bottom: 0;
    }

    .nav-item {
      border-left: none;
      border-bottom: 2px solid transparent;
      white-space: nowrap;
      padding: 10px 16px;
    }

    .nav-item.active {
      border-left-color: transparent;
      border-bottom-color: var(--color-sage);
    }
  }
</style>
