<script lang="ts">
  interface Props {
    activePass?: string;
    completedPasses?: string[];
    availablePasses?: string[];
    showVerification?: boolean;
    onSelect?: (pass: string) => void;
  }

  let {
    activePass = 'analysis',
    completedPasses = [],
    availablePasses = ['analysis'],
    showVerification = false,
    onSelect
  }: Props = $props();

  const corePasses = ['analysis', 'critique', 'synthesis'] as const;

  const labels: Record<string, string> = {
    analysis: 'Foundations',
    critique: 'Challenges',
    synthesis: 'Resolution',
    verification: 'Evidence & Sources',
  };
</script>

<nav class="navigator" aria-label="Pass navigation">
  {#each corePasses as pass}
    <button
      class="nav-item"
      class:active={activePass === pass}
      class:disabled={!availablePasses.includes(pass)}
      onclick={() => onSelect?.(pass)}
      aria-current={activePass === pass ? 'page' : undefined}
      disabled={!availablePasses.includes(pass)}
    >
      <span class="nav-label">{labels[pass]}</span>
      {#if completedPasses.includes(pass)}
        <span class="check" aria-label="Complete">✓</span>
      {/if}
    </button>
  {/each}

  {#if showVerification}
    <button
      class="nav-item verification-item"
      class:active={activePass === 'verification'}
      class:disabled={!availablePasses.includes('verification')}
      onclick={() => onSelect?.('verification')}
      aria-current={activePass === 'verification' ? 'page' : undefined}
      disabled={!availablePasses.includes('verification')}
    >
      <span class="nav-label">{labels.verification}</span>
      {#if completedPasses.includes('verification')}
        <span class="check" aria-label="Complete">✓</span>
      {/if}
    </button>
  {/if}
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
    font-family: var(--font-ui); /* was --font-display: landing-only restriction applied */
    font-size: 0.9rem;
    font-weight: 400;
    color: var(--color-muted);
    background: none;
    border: none;
    border-left: 2px solid transparent;
    cursor: pointer;
    text-align: left;
    transition: color var(--transition-fast), border-color var(--transition-fast);
  }

  .nav-item.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .nav-item:hover {
    color: var(--color-text);
  }

  .nav-item:focus-visible {
    outline: 2px solid var(--color-sage);
    outline-offset: -2px;
  }

  .nav-item.active {
    color: var(--color-text);
    border-left-color: var(--color-sage);
  }

  /* Verification entry has amber accent */
  .verification-item.active {
    border-left-color: var(--color-amber);
  }

  .verification-item .nav-label {
    color: var(--color-amber);
  }

  .verification-item:not(.active) .nav-label {
    color: var(--color-muted);
  }

  .nav-label {
    flex: 1;
  }

  .check {
    font-family: var(--font-ui);
    font-size: 0.6rem;
    color: var(--color-muted);
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

    .verification-item.active {
      border-bottom-color: var(--color-amber);
    }
  }
</style>
