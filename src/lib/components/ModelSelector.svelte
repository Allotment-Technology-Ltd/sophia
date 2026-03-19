<script lang="ts">
  export interface ModelOption {
    value: string;
    label: string;
    description: string;
    disabled?: boolean;
  }

  interface Props {
    value?: string;
    options?: ModelOption[];
    disabled?: boolean;
    layout?: 'inline' | 'stacked';
    loading?: boolean;
    errorMessage?: string;
    emptyMessage?: string;
    onRetry?: (() => void) | undefined;
  }

  let {
    value = $bindable<string>('auto'),
    options = [],
    disabled = false,
    layout = 'inline',
    loading = false,
    errorMessage = '',
    emptyMessage = '',
    onRetry
  }: Props = $props();

  const selected = $derived(options.find((option) => option.value === value));
  const hasVisibleChoices = $derived(options.some((option) => !option.disabled));
</script>

<div class="model-row" class:stacked={layout === 'stacked'} aria-label="Model selector">
  <label for="model-select">Choose your model</label>
  <select id="model-select" bind:value disabled={disabled || loading || !!errorMessage || !hasVisibleChoices}>
    {#each options as option}
      <option value={option.value} disabled={option.disabled}>{option.label}</option>
    {/each}
  </select>
  <div class="hint-block">
    <span class="hint">{selected?.description ?? 'Select a model'}</span>
    {#if loading}
      <span class="state loading" role="status">Loading policy-filtered models…</span>
    {:else if errorMessage}
      <div class="state error" role="alert">
        <span>{errorMessage}</span>
        {#if onRetry}
          <button type="button" class="retry-btn" onclick={onRetry}>Retry</button>
        {/if}
      </div>
    {:else if emptyMessage}
      <span class="state empty" role="status">{emptyMessage}</span>
    {/if}
  </div>
</div>

<style>
  .model-row {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(220px, 360px) 1fr;
    gap: var(--space-2);
    align-items: center;
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    color: var(--color-muted);
    text-transform: uppercase;
  }

  .model-row.stacked {
    grid-template-columns: 1fr;
    align-items: start;
    gap: 4px;
  }

  select {
    width: 100%;
    min-width: 0;
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 6px 8px;
    font-size: 0.78rem;
    text-transform: none;
    letter-spacing: 0;
  }

  .hint-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hint {
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.72rem;
    color: var(--color-dim);
  }

  .state {
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.7rem;
    line-height: 1.4;
  }

  .state.loading,
  .state.empty {
    color: var(--color-dim);
  }

  .state.error {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-danger, #d35b5b);
  }

  .retry-btn {
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    border-radius: 3px;
    padding: 3px 8px;
    font-size: 0.7rem;
    cursor: pointer;
  }

  .model-row.stacked .hint {
    font-size: 0.68rem;
    line-height: 1.35;
  }

  @media (max-width: 720px) {
    .model-row {
      grid-template-columns: auto 1fr;
    }

    .hint {
      grid-column: 1 / -1;
    }
  }
</style>
