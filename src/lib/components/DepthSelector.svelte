<script lang="ts">
  type DepthMode = 'quick' | 'standard' | 'deep';

  interface Props {
    value?: DepthMode;
    disabled?: boolean;
  }

  let { value = $bindable<DepthMode>('standard'), disabled = false }: Props = $props();

  const options: Array<{ value: DepthMode; label: string; eta: string; description: string }> = [
    {
      value: 'quick',
      label: 'Quick',
      eta: '~10s',
      description: 'Analysis pass only'
    },
    {
      value: 'standard',
      label: 'Standard',
      eta: '~25s',
      description: 'Three-pass dialectic'
    },
    {
      value: 'deep',
      label: 'Deep',
      eta: '~40s',
      description: 'Extended three-pass detail'
    }
  ];
</script>

<div class="depth-wrap" aria-label="Depth mode selector">
  <span class="label">Depth</span>
  <div class="chips" role="radiogroup" aria-label="Analysis depth mode">
    {#each options as option}
      <button
        type="button"
        role="radio"
        aria-checked={value === option.value}
        class="chip"
        class:active={value === option.value}
        disabled={disabled}
        onclick={() => (value = option.value)}
      >
        <strong>{option.label}</strong>
        <span>{option.eta}</span>
        <small>{option.description}</small>
      </button>
    {/each}
  </div>
</div>

<style>
  .depth-wrap {
    width: min(700px, 100%);
    display: grid;
    gap: var(--space-2);
  }

  .label {
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    color: var(--color-muted);
    text-transform: uppercase;
  }

  .chips {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .chip {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-muted);
    border-radius: 3px;
    padding: 8px 10px;
    text-align: left;
    display: grid;
    gap: 2px;
    cursor: pointer;
    transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
  }

  .chip strong {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    color: inherit;
  }

  .chip span,
  .chip small {
    font-family: var(--font-ui);
    font-size: 0.68rem;
    color: var(--color-dim);
  }

  .chip.active {
    border-color: var(--color-sage-border);
    color: var(--color-text);
    background: var(--color-surface-raised);
  }

  .chip:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (max-width: 720px) {
    .chips {
      grid-template-columns: 1fr;
    }
  }
</style>
