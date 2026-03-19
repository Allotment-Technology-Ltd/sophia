<script lang="ts">
  import { ModelSelector as RestormelModelSelector } from '@restormel/keys-svelte';
  import '@restormel/keys-svelte/theme.css';
  import { resolveProviderId, type KeysInstance, type ProviderDefinition } from '@restormel/keys';

  interface Props {
    value?: string;
    keys: KeysInstance;
    providers: ProviderDefinition[];
    disabled?: boolean;
    layout?: 'inline' | 'stacked';
    loading?: boolean;
    errorMessage?: string;
    emptyMessage?: string;
    onRetry?: (() => void) | undefined;
    onSelect?: ((providerId: string, modelId: string) => void) | undefined;
  }

  let {
    value = $bindable<string>('auto'),
    keys,
    providers,
    disabled = false,
    layout = 'inline',
    loading = false,
    errorMessage = '',
    emptyMessage = '',
    onRetry,
    onSelect
  }: Props = $props();

  const explicitSelection = $derived.by(() => {
    if (!value || value === 'auto') return null;
    const splitIdx = value.indexOf('::');
    if (splitIdx <= 0) return null;
    const providerId = value.slice(0, splitIdx);
    const modelId = value.slice(splitIdx + 2);
    if (!modelId) return null;
    const provider = resolveProviderId(providerId, providers);
    return {
      providerName: provider?.name ?? providerId,
      modelId
    };
  });
  const hasProviders = $derived(providers.length > 0);

  function handleAutoSelect(): void {
    value = 'auto';
  }

  function handleSelect(modelId: string, providerId: string): void {
    value = `${providerId}::${modelId}`;
    onSelect?.(providerId, modelId);
  }
</script>

<div class="restormel-model-shell" class:stacked={layout === 'stacked'} aria-label="Model selector">
  <div class="restormel-model-header">
    <span class="restormel-model-label">Choose your model</span>
    <button
      type="button"
      class="restormel-auto-btn"
      class:active={value === 'auto'}
      onclick={handleAutoSelect}
      disabled={disabled}
      aria-pressed={value === 'auto'}
    >
      Use automatic routing
    </button>
  </div>

  <div class="restormel-model-summary" role="status" aria-live="polite">
    {#if explicitSelection}
      Selected: {explicitSelection.providerName} · {explicitSelection.modelId}
    {:else}
      Selected: Automatic route selection
    {/if}
  </div>

  {#if loading}
    <div class="restormel-model-state" role="status">Loading policy-filtered models…</div>
  {:else if errorMessage}
    <div class="restormel-model-state error" role="alert">
      <span>{errorMessage}</span>
      {#if onRetry}
        <button type="button" class="restormel-retry-btn" onclick={onRetry}>Retry</button>
      {/if}
    </div>
  {:else if !hasProviders}
    <div class="restormel-model-state" role="status">
      {emptyMessage || 'No explicit models are currently available for this key source.'}
    </div>
  {:else}
    <div class="restormel-theme-shell" class:is-disabled={disabled}>
      <RestormelModelSelector {keys} {providers} onSelect={handleSelect} />
    </div>
    {#if emptyMessage}
      <div class="restormel-model-state" role="status">{emptyMessage}</div>
    {/if}
  {/if}
</div>

<style>
  .restormel-model-shell {
    width: 100%;
    display: grid;
    gap: var(--space-2);
    font-family: var(--font-ui);
  }

  .restormel-model-shell.stacked {
    gap: 6px;
  }

  .restormel-model-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }

  .restormel-model-label {
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .restormel-auto-btn,
  .restormel-retry-btn {
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    border-radius: 999px;
    padding: 5px 10px;
    font-size: 0.72rem;
    cursor: pointer;
  }

  .restormel-auto-btn.active {
    background: color-mix(in oklab, var(--color-sage) 22%, transparent);
    border-color: color-mix(in oklab, var(--color-sage) 55%, var(--color-border));
  }

  .restormel-auto-btn:disabled,
  .restormel-retry-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .restormel-model-summary {
    font-size: 0.72rem;
    color: var(--color-dim);
  }

  .restormel-model-state {
    font-size: 0.72rem;
    color: var(--color-dim);
  }

  .restormel-model-state.error {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    color: var(--color-danger, #d35b5b);
  }

  .restormel-theme-shell {
    --rk-bg: color-mix(in oklab, var(--color-surface) 92%, transparent);
    --rk-text: var(--color-text);
    --rk-accent: var(--color-sage);
    --rk-border: color-mix(in oklab, var(--color-border) 80%, transparent);
    --rk-error: var(--color-danger, #d35b5b);
    --rk-success: #5aa36f;
    border: 1px solid color-mix(in oklab, var(--color-border) 70%, transparent);
    border-radius: 10px;
    padding: 0.7rem;
    background: color-mix(in oklab, var(--color-surface) 90%, transparent);
  }

  .restormel-theme-shell.is-disabled {
    opacity: 0.6;
    pointer-events: none;
  }

  @media (max-width: 720px) {
    .restormel-model-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .restormel-auto-btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>
